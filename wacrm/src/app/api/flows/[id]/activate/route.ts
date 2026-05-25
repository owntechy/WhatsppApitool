import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { validateFlowForActivation } from '@/lib/flows/validate'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const body = (await request.json().catch(() => null)) as
    | { status?: 'draft' | 'active' | 'archived' }
    | null
  const status = body?.status
  if (!status || !['draft', 'active', 'archived'].includes(status)) {
    return NextResponse.json(
      { error: "status must be one of 'draft' | 'active' | 'archived'" },
      { status: 400 },
    )
  }

  const existing = await prisma.flow.findUnique({
    where: { id },
    select: { id: true, userId: true },
  })
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (status === 'active') {
    const [flow, nodes] = await Promise.all([
      prisma.flow.findUnique({
        where: { id },
        select: { name: true, triggerType: true, triggerConfig: true, entryNodeId: true },
      }),
      prisma.flowNode.findMany({
        where: { flowId: id },
        select: { nodeKey: true, nodeType: true, config: true },
      }),
    ])
    if (!flow) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const issues = validateFlowForActivation(
      {
        name: flow.name,
        trigger_type: flow.triggerType as 'keyword' | 'first_inbound_message' | 'manual',
        trigger_config: flow.triggerConfig as any,
        entry_node_id: flow.entryNodeId,
      },
      (nodes ?? []).map((n) => ({
        node_key: n.nodeKey,
        node_type: n.nodeType,
        config: n.config as any,
      })),
    )
    const blockers = issues.filter((i) => i.severity === 'error')
    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot activate flow — fix the issues below first.',
          issues,
        },
        { status: 422 },
      )
    }
  }

  const updated = await prisma.flow.update({
    where: { id },
    data: { status, updatedAt: new Date() },
  })

  return NextResponse.json({ flow: updated })
}
