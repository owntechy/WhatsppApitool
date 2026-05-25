import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { toSnakeCase } from "@/lib/utils";

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function mapKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[snakeToCamel(k)] = v;
  }
  return result;
}

async function handleSelect(table: string, body: Record<string, unknown>) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const where: Record<string, unknown> = {};

    if (body.eq && typeof body.eq === "object") {
      Object.assign(where, mapKeys(body.eq as Record<string, string>));
    }

    if (body.gte && typeof body.gte === "object") {
      for (const [k, v] of Object.entries(mapKeys(body.gte as Record<string, string>))) {
        where[k] = { gte: new Date(v as string) };
      }
    }

    if (body.lt && typeof body.lt === "object") {
      for (const [k, v] of Object.entries(mapKeys(body.lt as Record<string, string>))) {
        where[k] = { lt: new Date(v as string) };
      }
    }

    if (body.in && typeof body.in === "object") {
      for (const [k, v] of Object.entries(mapKeys(body.in as Record<string, string[]>))) {
        where[k] = { in: v };
      }
    }

    if (body.is && typeof body.is === "object") {
      for (const [k, v] of Object.entries(mapKeys(body.is as Record<string, unknown>))) {
        where[k] = v === null ? null : v;
      }
    }

    if (body.ilike && typeof body.ilike === "object") {
      for (const [k, v] of Object.entries(mapKeys(body.ilike as Record<string, string>))) {
        where[k] = { contains: (v as string).replace(/^%|%$/g, "") };
      }
    }

    if (body.neq && typeof body.neq === "object") {
      for (const [k, v] of Object.entries(mapKeys(body.neq as Record<string, string>))) {
        where[k] = { not: v };
      }
    }

    if (body.or && typeof body.or === "string") {
      const orConditions = parseOrFilter(body.or as string);
      if (orConditions.length > 0) {
        where.OR = orConditions;
      }
    }

    const model = getPrismaModel(table);
    if (!model) {
      return NextResponse.json({ error: `Unknown table: ${table}` }, { status: 400 });
    }

    const query: Record<string, unknown> = { where };

    if (body.order && typeof body.order === "object") {
      const o = body.order as Record<string, unknown>;
      query.orderBy = { [snakeToCamel(o.column as string)]: o.ascending ? "asc" : "desc" };
    }

    if (typeof body.limit === "number") {
      query.take = body.limit;
    }

    if (typeof body.offset === "number") {
      query.skip = body.offset;
    }

    if (body.select) {
      const include = parseJoins(body.select as string);
      if (include && Object.keys(include).length > 0) {
        query.include = include;
      }
    }

    let countResult: number | null = null;
    if (body.count) {
      countResult = await (model as { count: Function }).count({ where });
    }

    let result;
    if (body.single) {
      result = await (model as { findFirst: Function }).findFirst(query);
    } else {
      result = await (model as { findMany: Function }).findMany(query);
    }

    return NextResponse.json({ data: toSnakeCase(result) ?? null, error: null, count: countResult });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "Internal server error" },
      { status: 500 },
    );
  }
}

async function handleMutate(table: string, body: Record<string, unknown>) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const model = getPrismaModel(table);
  if (!model) {
    return NextResponse.json({ error: `Unknown table: ${table}` }, { status: 400 });
  }

  const action = body.action as string;
  const rawData = body.data as Record<string, unknown> | undefined;
  const rawEq = body.eq as Record<string, string> | undefined;

  try {
    let result;
    const data = rawData
      ? Array.isArray(rawData)
        ? (rawData as Record<string, unknown>[]).map((item) => mapKeys(item))
        : mapKeys(rawData)
      : undefined;
    const eq = rawEq ? mapKeys(rawEq) : undefined;

    if (action === "insert" && data) {
      if (Array.isArray(data)) {
        const m = model as { create: Function };
        const records: unknown[] = [];
        for (const item of data) {
          records.push(await m.create({ data: item }));
        }
        result = records;
      } else {
        const m = model as { create: Function };
        result = await m.create({ data });
      }
    } else if (action === "update" && data && !Array.isArray(data)) {
      const where: Record<string, unknown> = {};
      if (eq) Object.assign(where, eq);
      if (body.is && typeof body.is === "object") {
        for (const [k, v] of Object.entries(mapKeys(body.is as Record<string, unknown>))) {
          where[k] = v === null ? null : v;
        }
      }
      result = await (model as { updateMany: Function }).updateMany({ where, data });
    } else if (action === "upsert" && data && !Array.isArray(data)) {
      const onConflict = body.onConflict as string | undefined;
      const where: Record<string, unknown> = {};
      if (onConflict) {
        const keys = onConflict.split(",").map((k) => k.trim());
        for (const key of keys) {
          const camel = snakeToCamel(key);
          if (data[camel] !== undefined) where[camel] = data[camel];
        }
      }
      result = await (model as { upsert: Function }).upsert({
        where,
        create: data,
        update: data,
      });
    } else if (action === "delete") {
      const where: Record<string, unknown> = {};
      if (eq) Object.assign(where, eq);
      result = await (model as { deleteMany: Function }).deleteMany({ where });
    }

    return NextResponse.json({ data: toSnakeCase(result) ?? null, error: null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  return handleSelect(body.table as string, body);
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  return handleMutate(body.table as string, body);
}

// Parse Supabase-style join selectors like "*, contact:contacts(*)" or "id, tag_id, tags(*)"
// into Prisma include objects like { contact: true, tag: true }
function parseJoins(selectStr: string): Record<string, unknown> | null {
  // Match patterns: alias:tablename(fields) OR tablename(fields)
  // Must NOT be preceded by a bare word character (i.e. not part of a column name)
  const joinPattern = /(?:^|,\s*)(?:(\w+):)?(\w+)(?:!\w+)?\(([^)]*)\)/g;
  const include: Record<string, unknown> = {};
  let match;

  while ((match = joinPattern.exec(selectStr)) !== null) {
    const alias = match[1];
    const _tableName = match[2];
    const _fields = match[3];

    const relationName = alias || snakeToCamel(_tableName);
    include[relationName] = true;
  }

  return Object.keys(include).length > 0 ? include : null;
}

function parseOrFilter(orStr: string): Record<string, unknown>[] {
  if (!orStr) return [];
  return orStr.split(",").map((part) => {
    const parts = part.split(".");
    const field = parts[0];
    const op = parts[1];
    const value = parts.slice(2).join(".").replace(/^%|%$/g, "");
    const camelField = snakeToCamel(field);
    if (op === "ilike") return { [camelField]: { contains: value } };
    if (op === "eq") return { [camelField]: value };
    return { [camelField]: value };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPrismaModel(table: string): any {
  const mapping: Record<string, string> = {
    profiles: "profile",
    contacts: "contact",
    tags: "tag",
    contact_tags: "contactTag",
    custom_fields: "customField",
    contact_custom_values: "contactCustomValue",
    contact_notes: "contactNote",
    conversations: "conversation",
    messages: "message",
    message_reactions: "messageReaction",
    whatsapp_config: "whatsAppConfig",
    message_templates: "messageTemplate",
    pipelines: "pipeline",
    pipeline_stages: "pipelineStage",
    deals: "deal",
    broadcasts: "broadcast",
    broadcast_recipients: "broadcastRecipient",
    automations: "automation",
    automation_steps: "automationStep",
    automation_logs: "automationLog",
    automation_pending_executions: "automationPendingExecution",
    flows: "flow",
    flow_nodes: "flowNode",
    flow_runs: "flowRun",
    flow_run_events: "flowRunEvent",
    users: "user",
  };

  const modelName = mapping[table];
  if (!modelName) return null;
  return (prisma as unknown as Record<string, unknown>)[modelName];
}
