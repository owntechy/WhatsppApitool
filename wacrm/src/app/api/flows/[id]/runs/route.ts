import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const flow = await prisma.flow.findUnique({
    where: { id },
    select: { id: true, name: true, userId: true },
  })
  if (!flow || flow.userId !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const runs = await prisma.flowRun.findMany({
    where: { flowId: id },
    include: {
      contact: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { startedAt: 'desc' },
    take: 50,
  })

  const runIds = runs.map((r) => r.id)
  let events: Array<{
    flowRunId: string
    eventType: string
    nodeKey: string | null
    payload: Record<string, unknown>
    createdAt: Date
  }> = []
  if (runIds.length > 0) {
    try {
      const evs = await prisma.flowRunEvent.findMany({
        where: { flowRunId: { in: runIds } },
        orderBy: { createdAt: 'asc' },
        select: { flowRunId: true, eventType: true, nodeKey: true, payload: true, createdAt: true },
      })
      events = evs as typeof events
    } catch (evsErr) {
      console.error('[flows-runs] events fetch failed:', evsErr instanceof Error ? evsErr.message : evsErr)
    }
  }

  return NextResponse.json({
    flow: { id: flow.id, name: flow.name },
    runs: runs ?? [],
    events,
  })
}
