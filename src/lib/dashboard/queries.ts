"use server"

import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import {
  daysAgoStart,
  DOW_SHORT_MON_FIRST,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from './date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  PipelineStageSlice,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from './types'

async function getCurrentUserId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }
  return session.user.id
}

export async function loadMetrics(): Promise<MetricsBundle> {
  const userId = await getCurrentUserId()
  const todayStart = startOfLocalDay()
  const yesterdayStart = daysAgoStart(1)

  const [
    openConvCur,
    newConvToday,
    newConvYesterday,
    newContactsToday,
    newContactsYesterday,
    openDeals,
    messagesToday,
    messagesYesterday,
  ] = await Promise.all([
    prisma.conversation.count({
      where: { userId, status: 'open' },
    }),
    prisma.conversation.count({
      where: { userId, status: 'open', createdAt: { gte: todayStart } },
    }),
    prisma.conversation.count({
      where: {
        userId,
        status: 'open',
        createdAt: { gte: yesterdayStart, lt: todayStart },
      },
    }),
    prisma.contact.count({
      where: { userId, createdAt: { gte: todayStart } },
    }),
    prisma.contact.count({
      where: { userId, createdAt: { gte: yesterdayStart, lt: todayStart } },
    }),
    prisma.deal.findMany({
      where: { userId, status: 'open' },
      select: { value: true, status: true },
    }),
    prisma.message.count({
      where: {
        conversation: { userId },
        senderType: 'agent',
        createdAt: { gte: todayStart },
      },
    }),
    prisma.message.count({
      where: {
        conversation: { userId },
        senderType: 'agent',
        createdAt: { gte: yesterdayStart, lt: todayStart },
      },
    }),
  ])

  const openDealsValue = openDeals.reduce((sum, d) => sum + d.value.toNumber(), 0)

  return {
    activeConversations: {
      current: openConvCur,
      previous: newConvToday - newConvYesterday,
    },
    newContactsToday: {
      current: newContactsToday,
      previous: newContactsYesterday,
    },
    openDealsValue,
    openDealsCount: openDeals.length,
    messagesSentToday: {
      current: messagesToday,
      previous: messagesYesterday,
    },
  }
}

export async function loadConversationsSeries(
  rangeDays: number,
): Promise<ConversationsSeriesPoint[]> {
  const userId = await getCurrentUserId()
  const start = daysAgoStart(rangeDays - 1)
  const data = await prisma.message.findMany({
    where: { conversation: { userId }, createdAt: { gte: start } },
    select: { createdAt: true, senderType: true },
    orderBy: { createdAt: 'asc' },
  })

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const row of data) {
    const key = localDayKey(row.createdAt.toISOString())
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (row.senderType === 'customer') bucket.incoming += 1
    else bucket.outgoing += 1
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

export async function loadPipelineDonut(): Promise<PipelineDonutData> {
  const userId = await getCurrentUserId()
  const [stages, deals] = await Promise.all([
    prisma.pipelineStage.findMany({
      where: { pipeline: { userId } },
      select: { id: true, name: true, color: true, pipelineId: true, position: true },
      orderBy: { position: 'asc' },
    }),
    prisma.deal.findMany({
      where: { userId, status: 'open' },
      select: { stageId: true, value: true, status: true },
    }),
  ])

  const byStage = new Map<string, { count: number; total: number }>()
  for (const d of deals) {
    const row = byStage.get(d.stageId) ?? { count: 0, total: 0 }
    row.count += 1
    row.total += d.value.toNumber()
    byStage.set(d.stageId, row)
  }

  const slices: PipelineStageSlice[] = stages
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color || '#64748b',
      dealCount: byStage.get(s.id)?.count ?? 0,
      totalValue: byStage.get(s.id)?.total ?? 0,
    }))
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)

  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

export async function loadResponseTime(): Promise<ResponseTimeSummary> {
  const userId = await getCurrentUserId()
  const fourteenDaysAgo = daysAgoStart(13)
  const data = await prisma.message.findMany({
    where: { conversation: { userId }, createdAt: { gte: fourteenDaysAgo } },
    select: { conversationId: true, senderType: true, createdAt: true },
    orderBy: [{ conversationId: 'asc' }, { createdAt: 'asc' }],
  })

  interface Sample {
    customerAt: Date
    responseAt: Date
  }
  const samples: Sample[] = []

  let currentConv = ''
  let pendingCustomer: Date | null = null
  for (const row of data) {
    if (row.conversationId !== currentConv) {
      currentConv = row.conversationId
      pendingCustomer = null
    }
    const ts = row.createdAt
    if (row.senderType === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts })
      pendingCustomer = null
    }
  }

  const now = new Date()
  const thisWeekStart = daysAgoStart(mondayIndex(now))
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7)

  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const thisWeekMins: number[] = []
  const lastWeekMins: number[] = []

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    const dow = mondayIndex(s.customerAt)
    byDow.get(dow)!.push(diffMin)
    if (s.customerAt >= thisWeekStart) {
      thisWeekMins.push(diffMin)
    } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
      lastWeekMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => {
    const samples = byDow.get(dow) ?? []
    return {
      dow,
      avgMinutes: avg(samples),
      samples: samples.length,
    }
  })

  void DOW_SHORT_MON_FIRST

  return {
    buckets,
    thisWeekAvg: avg(thisWeekMins),
    lastWeekAvg: avg(lastWeekMins),
  }
}

export async function loadActivity(limit = 20): Promise<ActivityItem[]> {
  const userId = await getCurrentUserId()
  const [msgs, contacts, deals, broadcasts, autoLogs] = await Promise.all([
    prisma.message.findMany({
      where: { conversation: { userId }, senderType: 'customer' },
      select: {
        id: true,
        contentText: true,
        senderType: true,
        createdAt: true,
        conversationId: true,
        conversation: {
          select: {
            contactId: true,
            contact: { select: { name: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.contact.findMany({
      where: { userId },
      select: { id: true, name: true, phone: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.deal.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        stage: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
    prisma.broadcast.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        status: true,
        totalRecipients: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.automationLog.findMany({
      where: { userId },
      select: {
        id: true,
        triggerEvent: true,
        status: true,
        createdAt: true,
        automation: { select: { name: true } },
        contact: { select: { name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ])

  const items: ActivityItem[] = []

  for (const m of msgs) {
    const contact = m.conversation?.contact
    const who = contact?.name || contact?.phone || 'Unknown'
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `New message from ${who}`,
      at: m.createdAt.toISOString(),
      href: `/inbox?c=${m.conversationId}`,
    })
  }

  for (const c of contacts) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `New contact: ${c.name || c.phone}`,
      at: c.createdAt.toISOString(),
      href: '/contacts',
    })
  }

  for (const d of deals) {
    const stage = d.stage
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: stage?.name
        ? `Deal "${d.title}" in ${stage.name}`
        : `Deal "${d.title}" updated`,
      at: d.updatedAt.toISOString(),
      href: '/pipelines',
    })
  }

  for (const b of broadcasts) {
    const label =
      b.status === 'sent'
        ? `sent to ${b.totalRecipients} contacts`
        : `${b.status} (${b.totalRecipients} recipients)`
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Broadcast "${b.name}" ${label}`,
      at: b.createdAt.toISOString(),
      href: '/broadcasts',
    })
  }

  for (const l of autoLogs) {
    const automation = l.automation
    const contact = l.contact
    const who = contact?.name || contact?.phone || 'a contact'
    const autoName = automation?.name || 'Automation'
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: `Automation "${autoName}" ${l.status === 'failed' ? 'failed for' : 'triggered for'} ${who}`,
      at: l.createdAt.toISOString(),
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
