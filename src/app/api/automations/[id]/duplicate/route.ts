import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const original = await prisma.automation.findUnique({
    where: { id },
  })
  if (!original || original.userId !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const copy = await prisma.automation.create({
    data: {
      userId,
      name: `${original.name} (Copy)`,
      description: original.description,
      triggerType: original.triggerType,
      triggerConfig: original.triggerConfig as any,
      isActive: false,
    },
  })

  const steps = await prisma.automationStep.findMany({
    where: { automationId: id },
    orderBy: { position: 'asc' },
  })

  if (steps.length > 0) {
    const idMap = new Map<string, string>()
    const uid = () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
    for (const row of steps) idMap.set(row.id, uid())

    const rows = steps.map((row: typeof steps[number]) => ({
      id: idMap.get(row.id)!,
      automationId: copy.id,
      parentStepId: row.parentStepId ? idMap.get(row.parentStepId) : null,
      branch: row.branch,
      stepType: row.stepType,
      stepConfig: row.stepConfig as any,
      position: row.position,
    }))
    await prisma.automationStep.createMany({ data: rows })
  }

  return NextResponse.json({ automation: copy }, { status: 201 })
}
