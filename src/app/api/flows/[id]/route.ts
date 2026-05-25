import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { toSnakeCase } from '@/lib/utils'

async function requireOwnership(
  flowId: string,
): Promise<
  | {
      ok: true
      userId: string
    }
  | { ok: false; status: number; body: { error: string } }
> {
  const session = await auth()
  if (!session?.user?.id) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } }
  }
  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    select: { id: true, userId: true },
  })
  if (!flow || flow.userId !== session.user.id) {
    return { ok: false, status: 404, body: { error: 'Not found' } }
  }
  return { ok: true, userId: session.user.id }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const guard = await requireOwnership(id)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const [flow, nodes] = await Promise.all([
    prisma.flow.findUnique({ where: { id } }),
    prisma.flowNode.findMany({
      where: { flowId: id },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  if (!flow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({
    flow: toSnakeCase(flow),
    nodes: toSnakeCase(nodes ?? []),
  })
}

interface PutBody {
  name?: string
  description?: string | null
  trigger_type?: 'keyword' | 'first_inbound_message' | 'manual'
  trigger_config?: Record<string, unknown>
  entry_node_id?: string | null
  fallback_policy?: Record<string, unknown>
  nodes?: Array<{
    node_key: string
    node_type: string
    config: Record<string, unknown>
    position_x?: number
    position_y?: number
  }>
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const guard = await requireOwnership(id)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = (await request.json().catch(() => null)) as PutBody | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json(
      { error: 'name cannot be empty' },
      { status: 400 },
    )
  }

  const flowPatch: Record<string, unknown> = {
    updatedAt: new Date(),
  }
  if (body.name !== undefined) flowPatch.name = body.name.trim()
  if (body.description !== undefined)
    flowPatch.description = body.description
  if (body.trigger_type !== undefined) flowPatch.triggerType = body.trigger_type
  if (body.trigger_config !== undefined)
    flowPatch.triggerConfig = body.trigger_config as any
  if (body.entry_node_id !== undefined)
    flowPatch.entryNodeId = body.entry_node_id
  if (body.fallback_policy !== undefined)
    flowPatch.fallbackPolicy = body.fallback_policy as any

  const flow = await prisma.flow.update({
    where: { id },
    data: flowPatch,
  })

  if (body.nodes !== undefined) {
    await prisma.flowNode.deleteMany({
      where: { flowId: id },
    })
    if (body.nodes.length > 0) {
      await prisma.flowNode.createMany({
        data: body.nodes.map((n) => ({
          flowId: id,
          nodeKey: n.node_key,
          nodeType: n.node_type,
          config: n.config as any,
          positionX: n.position_x ?? 0,
          positionY: n.position_y ?? 0,
        })),
      })
    }
  }

  const [updatedFlow, updatedNodes] = await Promise.all([
    prisma.flow.findUnique({ where: { id } }),
    prisma.flowNode.findMany({
      where: { flowId: id },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  return NextResponse.json({ flow: toSnakeCase(updatedFlow), nodes: toSnakeCase(updatedNodes ?? []) })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const guard = await requireOwnership(id)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  await prisma.flow.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
