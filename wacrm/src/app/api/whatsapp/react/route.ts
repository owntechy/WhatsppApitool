import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { sendReactionMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const limit = checkRateLimit(`react:${userId}`, RATE_LIMITS.react);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const { message_id, emoji } = body as {
      message_id?: string;
      emoji?: string;
    };

    if (!message_id || typeof emoji !== 'string') {
      return NextResponse.json(
        { error: 'message_id and emoji are required' },
        { status: 400 },
      );
    }

    const targetMessage = await prisma.message.findUnique({
      where: { id: message_id },
      select: { id: true, messageId: true, conversationId: true },
    });

    if (!targetMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (!targetMessage.messageId) {
      return NextResponse.json(
        { error: 'Cannot react to a message that has not been sent to WhatsApp' },
        { status: 400 },
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: targetMessage.conversationId },
      include: { contact: { select: { phone: true } } },
    });

    if (!conversation || conversation.userId !== userId) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }

    const contact = conversation.contact;
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 },
      );
    }

    const config = await prisma.whatsAppConfig.findUnique({
      where: { userId },
      select: { phoneNumberId: true, accessToken: true },
    });

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured.' },
        { status: 400 },
      );
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.accessToken);
    } catch (err) {
      console.error('[react] Token decryption failed:', err);
      return NextResponse.json(
        {
          error:
            'WhatsApp configuration is corrupted — the stored access token cannot be decrypted. ' +
            'Go to Settings → WhatsApp Integration, click "Reset Configuration", then re-save.',
          needs_reset: true,
        },
        { status: 400 },
      );
    }
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone);

    try {
      await sendReactionMessage({
        phoneNumberId: config.phoneNumberId,
        accessToken,
        to: sanitizedPhone,
        targetMessageId: targetMessage.messageId,
        emoji,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('[whatsapp/react] Meta send failed:', message);
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 },
      );
    }

    if (emoji === '') {
      await prisma.messageReaction.deleteMany({
        where: {
          messageId: targetMessage.id,
          actorType: 'agent',
          actorId: userId,
        },
      });
    } else {
      await prisma.messageReaction.upsert({
        where: {
          messageId_actorType_actorId: {
            messageId: targetMessage.id,
            actorType: 'agent',
            actorId: userId,
          },
        },
        create: {
          messageId: targetMessage.id,
          conversationId: targetMessage.conversationId,
          actorType: 'agent',
          actorId: userId,
          emoji,
        },
        update: { emoji },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in WhatsApp react POST:', error);
    return NextResponse.json(
      { error: 'Failed to react to message' },
      { status: 500 },
    );
  }
}
