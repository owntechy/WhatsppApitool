import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    const userId = session.user.id

    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      conversation_id,
      message_type,
      content_text,
      media_url,
      template_name,
      template_params,
      reply_to_message_id,
    } = body

    if (!conversation_id || !message_type) {
      return NextResponse.json(
        { error: 'conversation_id and message_type are required' },
        { status: 400 }
      )
    }

    if (message_type === 'text' && !content_text) {
      return NextResponse.json(
        { error: 'content_text is required for text messages' },
        { status: 400 }
      )
    }

    if (message_type === 'template' && !template_name) {
      return NextResponse.json(
        { error: 'template_name is required for template messages' },
        { status: 400 }
      )
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversation_id },
      include: { contact: true },
    })

    if (!conversation || conversation.userId !== userId) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const contact = conversation.contact
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 }
      )
    }

    const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    const config = await prisma.whatsAppConfig.findUnique({
      where: { userId },
    })

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured. Please set up your WhatsApp integration first.' },
        { status: 400 }
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.accessToken)
    } catch (err) {
      console.error('[whatsapp/send] Token decryption failed:', err)
      return NextResponse.json(
        {
          error:
            'WhatsApp configuration is corrupted — the stored access token cannot be decrypted. ' +
            'Go to Settings → WhatsApp Integration, click "Reset Configuration", then re-save.',
          needs_reset: true,
        },
        { status: 400 },
      )
    }

    if (isLegacyFormat(config.accessToken)) {
      prisma.whatsAppConfig
        .update({
          where: { id: config.id },
          data: { accessToken: encrypt(accessToken) },
        })
        .then(() => {})
        .catch((err) => {
          console.warn(
            '[whatsapp/send] access_token GCM upgrade failed:',
            err instanceof Error ? err.message : err,
          )
        })
    }

    let contextMessageId: string | undefined
    if (reply_to_message_id) {
      const parent = await prisma.message.findUnique({
        where: { id: reply_to_message_id },
        select: { id: true, messageId: true, conversationId: true },
      })

      if (!parent || parent.conversationId !== conversation_id) {
        return NextResponse.json(
          { error: 'reply_to_message_id not found in this conversation' },
          { status: 400 }
        )
      }
      if (!parent.messageId) {
        console.warn(
          '[whatsapp/send] reply target has no Meta message_id; sending without context'
        )
      } else {
        contextMessageId = parent.messageId
      }
    }

    let waMessageId = ''
    let workingPhone = sanitizedPhone

    const attempt = async (phone: string): Promise<string> => {
      if (message_type === 'template') {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phoneNumberId,
          accessToken,
          to: phone,
          templateName: template_name,
          params: template_params || [],
          contextMessageId,
        })
        return result.messageId
      }
      const result = await sendTextMessage({
        phoneNumberId: config.phoneNumberId,
        accessToken,
        to: phone,
        text: content_text,
        contextMessageId,
      })
      return result.messageId
    }

    try {
      const variants = phoneVariants(sanitizedPhone)
      let lastError: unknown = null

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant)
          workingPhone = variant
          lastError = null
          break
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (!isRecipientNotAllowedError(message)) {
            throw err
          }
          lastError = err
          console.warn(`[whatsapp/send] variant "${variant}" rejected by Meta, trying next\u2026`)
        }
      }

      if (lastError) throw lastError
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API send failed for all variants:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 }
      )
    }

    if (workingPhone !== sanitizedPhone) {
      console.log(
        `[whatsapp/send] Auto-corrected contact phone: ${sanitizedPhone} \u2192 ${workingPhone}`
      )
      await prisma.contact.update({
        where: { id: contact.id },
        data: { phone: workingPhone },
      })
    }

    const messageRecord = await prisma.message.create({
      data: {
        conversationId: conversation_id,
        senderType: 'agent',
        contentType: message_type,
        contentText: content_text || null,
        mediaUrl: media_url || null,
        templateName: template_name || null,
        messageId: waMessageId,
        status: 'sent',
        replyToMessageId: reply_to_message_id || null,
      },
    })

    await prisma.conversation.update({
      where: { id: conversation_id },
      data: {
        lastMessageText: content_text || `[${message_type}]`,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      },
    })

    try {
      await prisma.flowRun.updateMany({
        where: {
          userId,
          contactId: contact.id,
          status: 'active',
        },
        data: {
          status: 'paused_by_agent',
          endedAt: new Date(),
          endReason: 'agent_replied',
        },
      })
    } catch (err) {
      console.error(
        '[flows] pause-on-agent-send failed:',
        err instanceof Error ? err.message : err,
      )
    }

    return NextResponse.json({
      success: true,
      message_id: messageRecord.id,
      whatsapp_message_id: waMessageId,
    })
  } catch (error) {
    console.error('Error in WhatsApp send POST:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    )
  }
}
