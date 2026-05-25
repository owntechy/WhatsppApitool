import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { getFlowTemplate } from '@/lib/flows/templates'

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) {
    return null
  }
  return session.user.id
}

export async function GET() {
  const userId = await requireUser()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const data = await prisma.flow.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ flows: data ?? [] })
}

export async function POST(request: Request) {
  const userId = await requireUser()
  
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as
    | {
        name?: string
        description?: string | null
        trigger_type?: 'keyword' | 'first_inbound_message' | 'manual'
        trigger_config?: Record<string, unknown>
        template_slug?: string
      }
    | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.template_slug) {
    const template = getFlowTemplate(body.template_slug)
    if (!template) {
      return NextResponse.json(
        { error: `Unknown template_slug "${body.template_slug}"` },
        { status: 400 },
      )
    }
    const flow = await prisma.flow.create({
      data: {
        userId,
        name: body.name?.trim() || template.name,
        description: template.description,
        status: 'draft',
        triggerType: template.trigger_type,
        triggerConfig: template.trigger_config as any,
        entryNodeId: template.entry_node_id,
      },
    })

    if (template.nodes.length > 0) {
      try {
        await prisma.flowNode.createMany({
          data: template.nodes.map((n: any) => ({
            flowId: flow.id,
            nodeKey: n.node_key as string,
            nodeType: n.node_type as string,
            config: n.config as any,
          })),
        })
      } catch (nodesErr) {
        await prisma.flow.delete({ where: { id: flow.id } })
        return NextResponse.json(
          { error: nodesErr instanceof Error ? nodesErr.message : 'nodes insert failed' },
          { status: 500 },
        )
      }
    }
    return NextResponse.json({ flow }, { status: 201 })
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  const trigger_type = body.trigger_type ?? 'keyword'

  const data = await prisma.flow.create({
    data: {
      userId,
      name: body.name.trim(),
      description: body.description ?? null,
      status: 'draft',
      triggerType: trigger_type,
      triggerConfig: (body.trigger_config ?? {}) as any,
    },
  })

  if (!data) {
    return NextResponse.json(
      { error: 'insert failed' },
      { status: 500 },
    )
  }
  return NextResponse.json({ flow: data }, { status: 201 })
}
