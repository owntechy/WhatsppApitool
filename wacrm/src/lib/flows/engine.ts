/**
 * Flow runner.
 *
 * The single entry point `dispatchInboundToFlows` is called by the
 * WhatsApp webhook on every inbound message *for an account that has
 * opted into the Flows beta*. It decides whether the message belongs
 * to an active conversation flow (advance it) or matches the entry
 * trigger of an active flow (start a new run) — and reports back to
 * the webhook so the webhook knows whether to also fire automations.
 *
 * Architecture in a sentence: the runner walks the customer through
 * a DB-stored node graph, suspending only at nodes that need
 * customer input. Each tap or text reply wakes it back up.
 *
 * What lives here vs elsewhere:
 *   - Pure decision logic (which button matched, where to advance to,
 *     when to fallback) — here.
 *   - DB shape (table reads/writes) — here.
 *   - Meta API calls — `meta-send.ts` (engineSendInteractive*).
 *   - Policy resolution (reprompt vs handoff vs end) — `fallback.ts`.
 *   - Type definitions — `types.ts`.
 *
 * Concurrency model:
 *   - Idempotency on `meta_message_id`: the runner refuses to advance
 *     an active run twice for the same Meta message — protects against
 *     Meta's retries.
 *   - Optimistic UPDATE with `current_node_key` precondition: two
 *     simultaneous taps for the same run collide at the DB layer; the
 *     second is a no-op.
 *   - Partial unique index `idx_one_active_run_per_contact`: two
 *     simultaneous starts for the same contact collide; the second
 *     INSERT raises 23505 and the runner catches & exits.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendText,
} from "./meta-send";
import { decideFallback, resolveFallbackPolicy } from "./fallback";
import {
  type CollectInputNodeConfig,
  type ConditionNodeConfig,
  type DispatchInboundInput,
  type DispatchInboundResult,
  type ParsedInbound,
  type SendButtonsNodeConfig,
  type SendListNodeConfig,
  type SendMessageNodeConfig,
  type SetTagNodeConfig,
  type StartNodeConfig,
  type KeywordTriggerConfig,
} from "./types";

// ============================================================
// Pure helpers — extracted so engine.test.ts can exercise them
// without a Supabase / Meta mock.
// ============================================================

/**
 * Given a node + the customer's reply_id, return the next_node_key
 * to advance to, or `null` if no option matches.
 */
export function matchReplyId(
  node: { node_type: string; config: Record<string, unknown> },
  reply_id: string,
): string | null {
  if (node.node_type === "send_buttons") {
    const cfg = node.config as unknown as SendButtonsNodeConfig;
    const hit = cfg.buttons?.find((b) => b.reply_id === reply_id);
    return hit?.next_node_key ?? null;
  }
  if (node.node_type === "send_list") {
    const cfg = node.config as unknown as SendListNodeConfig;
    for (const section of cfg.sections ?? []) {
      const hit = section.rows?.find((r) => r.reply_id === reply_id);
      if (hit) return hit.next_node_key;
    }
    return null;
  }
  return null;
}

/**
 * Case-insensitive contains/exact match against a list of keywords.
 * Used by the trigger evaluator. Stable enough that the v3 builder
 * UI can preview matches by passing canned strings.
 */
export function matchesKeywordTrigger(
  text: string,
  cfg: KeywordTriggerConfig,
): boolean {
  if (!text || !cfg.keywords?.length) return false;
  const matchType = cfg.match_type ?? "contains";
  const haystack = cfg.case_sensitive ? text : text.toLowerCase();
  for (const raw of cfg.keywords) {
    if (!raw) continue;
    const needle = cfg.case_sensitive ? raw : raw.toLowerCase();
    if (matchType === "exact" ? haystack === needle : haystack.includes(needle)) {
      return true;
    }
  }
  return false;
}

/** Nodes that advance to a next_node_key without waiting for input. */
export function isAutoAdvancing(node_type: string): boolean {
  return (
    node_type === "start" ||
    node_type === "send_message" ||
    node_type === "condition" ||
    node_type === "set_tag"
  );
}

/** Nodes that send a prompt and suspend awaiting a customer reply. */
export function isSuspending(node_type: string): boolean {
  return (
    node_type === "send_buttons" ||
    node_type === "send_list" ||
    node_type === "collect_input"
  );
}

/** Nodes that end the run. */
export function isTerminal(node_type: string): boolean {
  return node_type === "handoff" || node_type === "end";
}

/**
 * Evaluate a `condition` node's predicate against the current run
 * state. Exported pure for unit testing — the engine wraps it with a
 * DB lookup for `tag` / `contact_field` subjects.
 */
export function evaluateConditionPredicate(args: {
  operator: ConditionNodeConfig["operator"];
  /**
   * Resolved value of the subject. `undefined` means the subject is
   * absent (no var with that key / no such tag / contact field is
   * null). Pure function: caller does the DB lookup.
   */
  subjectValue: string | undefined;
  /** The configured comparison value, when applicable. */
  configValue: string | undefined;
}): boolean {
  switch (args.operator) {
    case "present":
      return args.subjectValue !== undefined && args.subjectValue !== "";
    case "absent":
      return args.subjectValue === undefined || args.subjectValue === "";
    case "equals":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue === (args.configValue ?? "");
    case "contains":
      if (args.subjectValue === undefined) return false;
      return args.subjectValue.includes(args.configValue ?? "");
  }
}

// ============================================================
// DB I/O — wrapped in tiny helpers so the dispatch flow stays
// readable. Errors surface as thrown — the entry point catches.
// ============================================================

async function loadActiveRunForContact(
  userId: string,
  contactId: string,
): Promise<{
  id: string;
  flowId: string;
  userId: string;
  contactId: string | null;
  conversationId: string | null;
  status: string;
  currentNodeKey: string | null;
  lastPromptMessageId: string | null;
  vars: Record<string, unknown>;
  repromptCount: number;
  startedAt: Date;
  lastAdvancedAt: Date;
  endedAt: Date | null;
  endReason: string | null;
} | null> {
  // The partial unique index `idx_one_active_run_per_contact` makes
  // "two active runs for one contact" impossible by design. But a
  // future migration glitch or manual SQL could create one, and
  // .maybeSingle() throws on >1 row — which would kill dispatch for
  // that contact's webhook entirely. .limit(1) is forgiving: pick the
  // newest, let the cron sweep clean up the stale one.
  const rows = await prisma.flowRun.findMany({
    where: { userId, contactId, status: "active" },
    orderBy: { startedAt: "desc" },
    take: 1,
  });
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    flowId: r.flowId,
    userId: r.userId,
    contactId: r.contactId,
    conversationId: r.conversationId,
    status: r.status,
    currentNodeKey: r.currentNodeKey,
    lastPromptMessageId: r.lastPromptMessageId,
    vars: r.vars as Record<string, unknown>,
    repromptCount: r.repromptCount,
    startedAt: r.startedAt,
    lastAdvancedAt: r.lastAdvancedAt,
    endedAt: r.endedAt,
    endReason: r.endReason,
  };
}

async function loadFlow(flowId: string): Promise<{
  id: string;
  userId: string;
  entryNodeId: string | null;
  fallbackPolicy: unknown;
  triggerType: string;
} | null> {
  const flow = await prisma.flow.findUnique({ where: { id: flowId } });
  if (!flow) return null;
  return {
    id: flow.id,
    userId: flow.userId,
    entryNodeId: flow.entryNodeId,
    fallbackPolicy: flow.fallbackPolicy,
    triggerType: flow.triggerType,
  };
}

/**
 * Load every node of a flow in one round trip and key them by
 * `node_key`. The advance loop is then in-memory — a 5-node
 * auto-advancing chain costs one SELECT, not five.
 *
 * Returns an empty map on error so the caller can still dispatch
 * cleanly (every subsequent .get() returns undefined → the run
 * fails with node_not_found, same as the old per-node lookup).
 */
async function loadAllNodes(
  flowId: string,
): Promise<Map<string, { node_key: string; node_type: string; config: Record<string, unknown> }>> {
  const data = await prisma.flowNode.findMany({ where: { flowId } });
  const map = new Map<string, { node_key: string; node_type: string; config: Record<string, unknown> }>();
  for (const row of data) {
    map.set(row.nodeKey, {
      node_key: row.nodeKey,
      node_type: row.nodeType,
      config: row.config as Record<string, unknown>,
    });
  }
  return map;
}

async function logEvent(
  flowRunId: string,
  event_type:
    | "started"
    | "node_entered"
    | "message_sent"
    | "reply_received"
    | "fallback_fired"
    | "handoff"
    | "timeout"
    | "error"
    | "completed",
  node_key: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await prisma.flowRunEvent.create({
      data: {
        flowRunId,
        eventType: event_type,
        nodeKey: node_key,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Logging failure is non-fatal — surface but don't throw.
    console.error("[flows] logEvent error:", err instanceof Error ? err.message : err);
  }
}

/**
 * Idempotency check — has a `reply_received` event with this Meta
 * message_id already been recorded for any of the contact's flow
 * runs? If yes, the inbound is a duplicate (Meta retry) and we
 * exit without re-advancing.
 *
 * Implementation note: scoped to runs belonging to this user/contact
 * so the lookup is cheap (the index on flow_run_events(flow_run_id,
 * event_type) plus the small set of runs per contact).
 */
async function isDuplicateInbound(
  userId: string,
  contactId: string,
  metaMessageId: string,
): Promise<boolean> {
  // Fetch ALL run ids for this contact (active + historical). Bounded
  // by how many flows the customer has been through — small.
  const runs = await prisma.flowRun.findMany({
    where: { userId, contactId },
    select: { id: true },
  });
  if (!runs.length) return false;
  const runIds = runs.map((r) => r.id);

  const events = await prisma.flowRunEvent.findMany({
    where: { flowRunId: { in: runIds }, eventType: "reply_received" },
    select: { payload: true },
  });
  const count = events.filter((e) => {
    const p = e.payload as Record<string, unknown>;
    return p?.meta_message_id === metaMessageId;
  }).length;
  return count > 0;
}

async function findEntryFlow(
  userId: string,
  message: ParsedInbound,
  isFirstInbound: boolean,
): Promise<{
  id: string;
  userId: string;
  entryNodeId: string | null;
  triggerType: string;
  triggerConfig: unknown;
} | null> {
  // Only text messages can match an entry trigger. Interactive replies
  // are responses to existing prompts; they never start a new flow.
  if (message.kind !== "text") return null;

  // Pull all active flows for this user. Active set is bounded (the
  // builder discourages double-trigger overlap; partial index makes
  // the lookup index-supported).
  const flows = await prisma.flow.findMany({
    where: { userId, status: "active" },
    orderBy: { createdAt: "asc" },
  });
  if (!flows.length) return null;

  for (const flow of flows) {
    if (flow.triggerType === "keyword") {
      if (matchesKeywordTrigger(
        message.text,
        flow.triggerConfig as unknown as KeywordTriggerConfig,
      )) {
        return {
          id: flow.id,
          userId: flow.userId,
          entryNodeId: flow.entryNodeId,
          triggerType: flow.triggerType,
          triggerConfig: flow.triggerConfig,
        };
      }
    } else if (flow.triggerType === "first_inbound_message" && isFirstInbound) {
      return {
        id: flow.id,
        userId: flow.userId,
        entryNodeId: flow.entryNodeId,
        triggerType: flow.triggerType,
        triggerConfig: flow.triggerConfig,
      };
    }
    // 'manual' triggers do not auto-start from inbound messages.
  }
  return null;
}

// ============================================================
// Node executors — each handles ONE node type. send_buttons and
// send_list also persist `last_prompt_message_id` so the inbox
// thread can quote the prompt the customer is replying to.
// ============================================================

async function sendButtonsAndSuspend(
  run: { id: string; user_id: string; conversation_id: string; contact_id: string },
  node: { node_key: string; config: Record<string, unknown> },
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendButtonsNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveButtons({
    userId: run.user_id,
    conversationId: run.conversation_id,
    contactId: run.contact_id,
    bodyText: cfg.text,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    buttons: cfg.buttons.map((b) => ({ id: b.reply_id, title: b.title })),
  });
  await logEvent(run.id, "message_sent", node.node_key, {
    node_type: "send_buttons",
    whatsapp_message_id,
  });
  // Look up our internal message id so we can stash it on the run.
  // Cheap — indexed on `messages.message_id`.
  const msg = await prisma.message.findFirst({
    where: { messageId: whatsapp_message_id },
    select: { id: true },
  });
  await prisma.flowRun.update({
    where: { id: run.id },
    data: { lastPromptMessageId: msg?.id ?? null },
  });
  return { outcome: "advanced", node_key: node.node_key };
}

async function sendListAndSuspend(
  run: { id: string; user_id: string; conversation_id: string; contact_id: string },
  node: { node_key: string; config: Record<string, unknown> },
): Promise<{ outcome: "advanced"; node_key: string }> {
  const cfg = node.config as unknown as SendListNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveList({
    userId: run.user_id,
    conversationId: run.conversation_id,
    contactId: run.contact_id,
    bodyText: cfg.text,
    buttonLabel: cfg.button_label,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    sections: cfg.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({
        id: r.reply_id,
        title: r.title,
        description: r.description,
      })),
    })),
  });
  await logEvent(run.id, "message_sent", node.node_key, {
    node_type: "send_list",
    whatsapp_message_id,
  });
  const msg = await prisma.message.findFirst({
    where: { messageId: whatsapp_message_id },
    select: { id: true },
  });
  await prisma.flowRun.update({
    where: { id: run.id },
    data: { lastPromptMessageId: msg?.id ?? null },
  });
  return { outcome: "advanced", node_key: node.node_key };
}

async function executeHandoff(
  run: { id: string; conversationId: string | null },
  node: { node_key: string; config: Record<string, unknown> },
): Promise<void> {
  const cfg = node.config as { assign_to?: string; note?: string };
  const convData: Record<string, unknown> = {
    status: "pending",
  };
  if (cfg.assign_to) convData.assignedAgentId = cfg.assign_to;
  if (run.conversationId) {
    await prisma.conversation.update({
      where: { id: run.conversationId },
      data: convData as any,
    });
  }
  await logEvent(run.id, "handoff", node.node_key, {
    note: cfg.note ?? null,
    assigned_to: cfg.assign_to ?? null,
  });
  await endRun(run.id, "handed_off", "handoff_node");
}

/**
 * Resolve a condition node's subject value from DB / run state, then
 * call the pure `evaluateConditionPredicate`. Splits out so the
 * predicate itself stays unit-testable without a Supabase mock.
 *
 * Subject sources:
 *   - `var` → `flow_runs.vars[subject_key]` (captured by collect_input
 *     or http_fetch in v2).
 *   - `tag` → present iff `contact_tags(contact_id, tag_id)` exists.
 *     `subject_key` IS the tag UUID; the SELECT returns 1 row or 0.
 *   - `contact_field` → one of name/email/phone/company on `contacts`.
 */
async function evaluateConditionNode(
  run: { vars: Record<string, unknown>; contactId: string | null },
  cfg: ConditionNodeConfig,
): Promise<boolean> {
  let subjectValue: string | undefined;
  if (cfg.subject === "var") {
    const v = run.vars[cfg.subject_key];
    subjectValue = typeof v === "string" ? v : v === undefined ? undefined : String(v);
  } else if (cfg.subject === "tag") {
    const count = await prisma.contactTag.count({
      where: { contactId: run.contactId!, tagId: cfg.subject_key },
    });
    // For tags, "present" really is the only meaningful test — the
    // `present`/`absent` operators are the natural fit. equals/contains
    // against a tag UUID would still work mechanically (compare its
    // existence to the value).
    subjectValue = count > 0 ? cfg.subject_key : undefined;
  } else {
    const ALLOWED = ["name", "email", "phone", "company"] as const;
    type AllowedField = (typeof ALLOWED)[number];
    if (!ALLOWED.includes(cfg.subject_key as AllowedField)) {
      throw new Error(`unsupported contact_field: ${cfg.subject_key}`);
    }
    const contact = await prisma.contact.findUnique({
      where: { id: run.contactId! },
      select: { [cfg.subject_key]: true },
    });
    const raw = (contact as Record<string, unknown> | null)?.[cfg.subject_key];
    subjectValue = typeof raw === "string" && raw.length > 0 ? raw : undefined;
  }
  return evaluateConditionPredicate({
    operator: cfg.operator,
    subjectValue,
    configValue: cfg.value,
  });
}

/**
 * Tiny `{{vars.foo}}` interpolation. Used by send_message + collect_input
 * prompt text so a captured `name` can show up in the next prompt
 * ("Thanks {{vars.name}}, what's your email?"). Missing vars render as
 * empty string — the same behavior as the automations engine.
 */
function interpolateVars(template: string, vars: Record<string, unknown>): string {
  if (!template) return "";
  return template.replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

async function endRun(
  runId: string,
  status: "completed" | "handed_off" | "timed_out" | "failed",
  reason: string,
): Promise<void> {
  await prisma.flowRun.update({
    where: { id: runId },
    data: {
      status,
      endedAt: new Date(),
      endReason: reason,
    },
  });
}

// ============================================================
// The synchronous advance loop. Walks through auto-advance nodes
// until it hits one that suspends (send_buttons/send_list) or
// terminates (handoff/end). Each suspending node persists the
// new current_node_key before returning.
// ============================================================

async function advanceFromNodeKey(
  run: {
    id: string;
    user_id: string;
    conversation_id: string;
    contact_id: string;
    current_node_key: string | null;
    vars: Record<string, unknown>;
  },
  startNodeKey: string,
  nodes: Map<string, { node_key: string; node_type: string; config: Record<string, unknown> }>,
): Promise<{ outcome: "advanced" | "completed" | "handed_off" }> {
  let currentKey: string | null = startNodeKey;
  // Defensive cap — if a flow has a cycle (which the validator
  // SHOULD catch but doesn't yet in v1), we bail rather than loop.
  for (let safety = 0; safety < 64; safety += 1) {
    if (!currentKey) {
      await logEvent(run.id, "error", null, {
        reason: "next_node_key was null mid-advance",
      });
      await endRun(run.id, "failed", "missing_next_node");
      return { outcome: "completed" };
    }
    const node: { node_key: string; node_type: string; config: Record<string, unknown> } | null = nodes.get(currentKey) ?? null;
    if (!node) {
      await logEvent(run.id, "error", currentKey, {
        reason: "node_not_found",
      });
      await endRun(run.id, "failed", "node_not_found");
      return { outcome: "completed" };
    }
    await logEvent(run.id, "node_entered", node.node_key, {
      node_type: node.node_type,
    });

    if (node.node_type === "start") {
      currentKey = (node.config as unknown as StartNodeConfig).next_node_key;
      continue;
    }
    if (node.node_type === "send_message") {
      const cfg = node.config as unknown as SendMessageNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          userId: run.user_id,
          conversationId: run.conversation_id,
          contactId: run.contact_id,
          text: interpolateVars(cfg.text, run.vars),
        });
        await logEvent(run.id, "message_sent", node.node_key, {
          node_type: "send_message",
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "send_text_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "send_text_failed");
        return { outcome: "completed" };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "collect_input") {
      // Send the prompt and suspend. Customer's next TEXT reply will
      // wake us up via handleReplyForActiveRun's collect_input branch.
      const cfg = node.config as unknown as CollectInputNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          userId: run.user_id,
          conversationId: run.conversation_id,
          contactId: run.contact_id,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
        await logEvent(run.id, "message_sent", node.node_key, {
          node_type: "collect_input",
          whatsapp_message_id,
        });
        const msg = await prisma.message.findFirst({
          where: { messageId: whatsapp_message_id },
          select: { id: true },
        });
        await prisma.flowRun.update({
          where: { id: run.id },
          data: { lastPromptMessageId: msg?.id ?? null },
        });
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "collect_input_prompt_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "collect_input_prompt_failed");
        return { outcome: "completed" };
      }
      const advanced = await advanceCurrentNodeKey(
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "condition") {
      const cfg = node.config as unknown as ConditionNodeConfig;
      let branch: "true" | "false";
      try {
        branch = (await evaluateConditionNode(
          { vars: run.vars, contactId: run.contact_id },
          cfg,
        ))
          ? "true"
          : "false";
      } catch (err) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "condition_evaluation_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(run.id, "failed", "condition_evaluation_failed");
        return { outcome: "completed" };
      }
      currentKey =
        branch === "true" ? cfg.true_next : cfg.false_next;
      await logEvent(run.id, "node_entered", node.node_key, {
        condition_result: branch,
        advancing_to: currentKey,
      });
      continue;
    }
    if (node.node_type === "set_tag") {
      const cfg = node.config as unknown as SetTagNodeConfig;
      try {
        if (cfg.mode === "add") {
          await prisma.contactTag.upsert({
            where: { contactId_tagId: { contactId: run.contact_id!, tagId: cfg.tag_id } },
            create: { contactId: run.contact_id!, tagId: cfg.tag_id },
            update: {},
          });
        } else {
          await prisma.contactTag.deleteMany({
            where: { contactId: run.contact_id!, tagId: cfg.tag_id },
          });
        }
      } catch (err) {
        // Non-fatal — log + advance. A tag-write failure shouldn't
        // strand the customer mid-flow.
        await logEvent(run.id, "error", node.node_key, {
          reason: "set_tag_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === "send_buttons") {
      await sendButtonsAndSuspend(run, node);
      // Persist the new current_node_key via optimistic UPDATE.
      const advanced = await advanceCurrentNodeKey(
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "send_list") {
      await sendListAndSuspend(run, node);
      const advanced = await advanceCurrentNodeKey(
        run.id,
        run.current_node_key,
        node.node_key,
      );
      if (!advanced) {
        await logEvent(run.id, "error", node.node_key, {
          reason: "lost_race_during_advance",
        });
      }
      return { outcome: "advanced" };
    }
    if (node.node_type === "handoff") {
      await executeHandoff(
        { id: run.id, conversationId: run.conversation_id },
        node,
      );
      return { outcome: "handed_off" };
    }
    if (node.node_type === "end") {
      await logEvent(run.id, "completed", node.node_key);
      await endRun(run.id, "completed", "end_node");
      return { outcome: "completed" };
    }
    // Unknown node type — shouldn't happen given the CHECK constraint.
    await logEvent(run.id, "error", node.node_key, {
      reason: `unknown_node_type:${node.node_type}`,
    });
    await endRun(run.id, "failed", "unknown_node_type");
    return { outcome: "completed" };
  }
  // Safety break — log + fail.
  await logEvent(run.id, "error", currentKey, {
    reason: "advance_loop_safety_break",
  });
  await endRun(run.id, "failed", "advance_loop_overflow");
  return { outcome: "completed" };
}

/**
 * Optimistic UPDATE — only advance current_node_key when it matches
 * the value we read at the top of dispatch. If another webhook beat
 * us, the row's pointer has already moved and our UPDATE returns
 * zero rows; we treat that as a no-op and let the other run continue.
 */
async function advanceCurrentNodeKey(
  runId: string,
  expectedOldKey: string | null,
  newKey: string,
): Promise<boolean> {
  const result = await prisma.flowRun.updateMany({
    where: {
      id: runId,
      status: "active",
      ...(expectedOldKey === null
        ? { currentNodeKey: null }
        : { currentNodeKey: expectedOldKey }),
    },
    data: {
      currentNodeKey: newKey,
      lastAdvancedAt: new Date(),
    },
  });
  if (result.count === 0) {
    console.error("[flows] advanceCurrentNodeKey: no rows matched (lost race)");
    return false;
  }
  return true;
}

// ============================================================
// Public entry point — the webhook calls this on every inbound.
// ============================================================

export async function dispatchInboundToFlows(
  input: DispatchInboundInput & { isFirstInboundMessage: boolean },
): Promise<DispatchInboundResult> {
  try {
    const activeRun = await loadActiveRunForContact(
      input.userId,
      input.contactId,
    );

    // Idempotency — only matters if there's already a run for this
    // contact. For new runs, the partial unique index catches duplicate
    // starts at INSERT time.
    if (activeRun) {
      const dupe = await isDuplicateInbound(
        input.userId,
        input.contactId,
        input.message.meta_message_id,
      );
      if (dupe) {
        return {
          consumed: true,
          flow_run_id: activeRun.id,
          outcome: "duplicate_inbound_ignored",
        };
      }
      // One SELECT for the whole flow's nodes — advance loop is now
      // in-memory. See loadAllNodes.
      const nodes = await loadAllNodes(activeRun.flowId);
      return handleReplyForActiveRun(activeRun, input.message, nodes);
    }

    // No active run → look for a flow whose entry trigger matches.
    const flow = await findEntryFlow(
      input.userId,
      input.message,
      input.isFirstInboundMessage,
    );
    if (!flow || !flow.entryNodeId) {
      return { consumed: false, outcome: "no_match" };
    }
    const nodes = await loadAllNodes(flow.id);
    return startNewRun(flow, input, nodes);
  } catch (err) {
    console.error(
      "[flows] dispatchInboundToFlows threw:",
      err instanceof Error ? err.message : err,
    );
    return { consumed: false, outcome: "no_match" };
  }
}

async function handleReplyForActiveRun(
  run: {
    id: string;
    flowId: string;
    userId: string;
    contactId: string | null;
    conversationId: string | null;
    status: string;
    currentNodeKey: string | null;
    lastPromptMessageId: string | null;
    vars: Record<string, unknown>;
    repromptCount: number;
  },
  message: ParsedInbound,
  nodes: Map<string, { node_key: string; node_type: string; config: Record<string, unknown> }>,
): Promise<DispatchInboundResult> {
  // Note: we intentionally do NOT persist the raw customer text. A
  // `collect_input` prompt that asks "what's your card number?" would
  // otherwise leave the PAN sitting in flow_run_events.payload forever,
  // visible to anyone with access to the runs viewer or the events
  // table. Length is enough for "did they actually reply?" debugging;
  // for the captured value itself, the `node_entered` event already
  // records `captured_key` + `captured_length` after the var is stored.
  await logEvent(run.id, "reply_received", run.currentNodeKey, {
    meta_message_id: message.meta_message_id,
    reply_kind: message.kind,
    reply_id: message.kind === "interactive_reply" ? message.reply_id : null,
    text_length: message.kind === "text" ? message.text.length : null,
  });

  if (!run.currentNodeKey) {
    // Defensive — a run with status='active' but no current node is
    // malformed. Fail the run rather than spin.
    await endRun(run.id, "failed", "active_run_missing_current_node");
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: "no_match",
    };
  }

  const currentNode = nodes.get(run.currentNodeKey) ?? null;
  if (!currentNode) {
    await endRun(run.id, "failed", "current_node_not_found");
    return { consumed: true, flow_run_id: run.id, outcome: "no_match" };
  }

  // Two ways a reply can advance:
  //   1. Interactive button/list tap on a send_buttons/send_list node.
  //   2. Text reply on a collect_input node — capture into vars.
  //
  // Everything else falls through to the fallback policy below.
  let matched: string | null = null;
  if (
    message.kind === "interactive_reply" &&
    (currentNode.node_type === "send_buttons" ||
      currentNode.node_type === "send_list")
  ) {
    matched = matchReplyId(currentNode, message.reply_id);
  } else if (
    message.kind === "text" &&
    currentNode.node_type === "collect_input"
  ) {
    const cfg = currentNode.config as unknown as CollectInputNodeConfig;
    const captured = message.text.trim();
    if (captured.length > 0 && cfg.var_key) {
      // Persist captured value + reset reprompt count atomically.
      const newVars = { ...run.vars, [cfg.var_key]: captured };
      try {
        await prisma.flowRun.update({
          where: { id: run.id },
          data: {
            vars: newVars as Prisma.InputJsonValue,
            repromptCount: 0,
          },
        });
        // Mirror the UPDATE in-memory so downstream interpolation in
        // the advance loop sees the captured var without us having to
        // re-SELECT the whole row.
        run.vars = newVars;
        run.repromptCount = 0;
        await logEvent(run.id, "node_entered", currentNode.node_key, {
          captured_key: cfg.var_key,
          captured_length: captured.length,
        });
        matched = cfg.next_node_key;
      } catch {
        // Prisma threw — the capture failed; fall through to fallback.
      }
    }
  }

  if (matched) {
    // Reset reprompt count on a successful match. Skip the write when
    // already 0 — the collect_input capture branch above already
    // zeroed it, and interactive-reply matches against a fresh run
    // (post-prior-reset) are also already 0. The previous re-read of
    // the whole row was needed only because we weren't mirroring the
    // capture UPDATE into the in-memory `run`; now that we do, the
    // local copy is the source of truth.
    if (run.repromptCount !== 0) {
      try {
        await prisma.flowRun.update({
          where: { id: run.id },
          data: { repromptCount: 0 },
        });
        run.repromptCount = 0;
      } catch {
        // Non-fatal — continue with the in-memory value.
      }
    }
    const outcome = await advanceFromNodeKey(
      {
        id: run.id,
        user_id: run.userId,
        conversation_id: run.conversationId!,
        contact_id: run.contactId!,
        current_node_key: run.currentNodeKey,
        vars: run.vars,
      },
      matched,
      nodes,
    );
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: outcome.outcome,
    };
  }

  // No match → fallback. Apply the policy.
  const flowRecord = await loadFlow(run.flowId);
  const policy = resolveFallbackPolicy(
    flowRecord?.fallbackPolicy as
      | { on_unknown_reply?: string; max_reprompts?: number; on_timeout_hours?: number; on_exhaust?: string }
      | undefined,
  );
  const newReprompts = run.repromptCount + 1;
  await prisma.flowRun.update({
    where: { id: run.id },
    data: { repromptCount: newReprompts },
  });

  const action = decideFallback({ policy, reprompt_count: newReprompts });
  await logEvent(run.id, "fallback_fired", run.currentNodeKey, {
    action: action.type,
    reprompt_count: newReprompts,
  });
  if (action.type === "ignore") {
    // Don't consume — let automations have a shot at it.
    return { consumed: false, flow_run_id: run.id, outcome: "no_match" };
  }
  if (action.type === "reprompt") {
    // Re-send the same prompt. Same node, no current_node_key change.
    if (currentNode.node_type === "send_buttons") {
      await sendButtonsAndSuspend(
        { id: run.id, user_id: run.userId, conversation_id: run.conversationId!, contact_id: run.contactId! },
        currentNode,
      );
    } else if (currentNode.node_type === "send_list") {
      await sendListAndSuspend(
        { id: run.id, user_id: run.userId, conversation_id: run.conversationId!, contact_id: run.contactId! },
        currentNode,
      );
    } else if (currentNode.node_type === "collect_input") {
      // Customer typed something we couldn't accept (empty after trim,
      // or var_key missing — rare). Re-send the prompt so they try again.
      const cfg = currentNode.config as unknown as CollectInputNodeConfig;
      try {
        await engineSendText({
          userId: run.userId,
          conversationId: run.conversationId!,
          contactId: run.contactId!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
      } catch (err) {
        await logEvent(run.id, "error", currentNode.node_key, {
          reason: "reprompt_send_failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { consumed: true, flow_run_id: run.id, outcome: "fallback_fired" };
  }
  if (action.type === "handoff") {
    if (run.conversationId) {
      await prisma.conversation.update({
        where: { id: run.conversationId },
        data: { status: "pending" },
      });
    }
    await logEvent(run.id, "handoff", run.currentNodeKey, {
      reason: "fallback_exhausted",
    });
    await endRun(run.id, "handed_off", "fallback_exhausted");
    return { consumed: true, flow_run_id: run.id, outcome: "handed_off" };
  }
  // action.type === 'end'
  await endRun(run.id, "completed", "fallback_exhausted_end");
  return { consumed: true, flow_run_id: run.id, outcome: "completed" };
}

async function startNewRun(
  flow: {
    id: string;
    userId: string;
    entryNodeId: string | null;
    triggerType: string;
  },
  input: DispatchInboundInput,
  nodes: Map<string, { node_key: string; node_type: string; config: Record<string, unknown> }>,
): Promise<DispatchInboundResult> {
  // INSERT — partial unique index `idx_one_active_run_per_contact`
  // catches concurrent inserts with 23505. We catch and return as
  // consumed:true (the parallel webhook handles it).
  let run: Awaited<ReturnType<typeof prisma.flowRun.create>>;
  try {
    run = await prisma.flowRun.create({
      data: {
        flowId: flow.id,
        userId: flow.userId,
        contactId: input.contactId,
        conversationId: input.conversationId,
        status: "active",
        currentNodeKey: flow.entryNodeId,
      },
    });
  } catch (err) {
    // P2002 = unique constraint violation → another webhook is starting the run.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { consumed: true, outcome: "duplicate_inbound_ignored" };
    }
    console.error("[flows] startNewRun insert error:", err instanceof Error ? err.message : err);
    return { consumed: false, outcome: "no_match" };
  }

  await logEvent(run.id, "started", flow.entryNodeId, {
    flow_id: flow.id,
    trigger_type: flow.triggerType,
    meta_message_id: input.message.meta_message_id,
  });

  // Bump the flow's execution counter — used by the builder UI to
  // surface "X runs since activation" on the flow card.
  //
  // Atomic RPC (migration 012) rather than read-modify-write: two
  // concurrent webhooks starting runs for different contacts on the
  // same flow would otherwise both read N and both write N+1, losing
  // a count. Mirrors the automations engine's use of
  // `increment_automation_execution_count` (migration 007).
  try {
    await prisma.flow.update({
      where: { id: flow.id },
      data: { executionCount: { increment: 1 } },
    });
  } catch (incErr) {
    // Non-fatal — the run itself succeeded; only the counter is off.
    console.error("[flows] execution_count increment error:", incErr instanceof Error ? incErr.message : incErr);
  }

  // Run the advance loop starting from the entry node.
  const outcome = await advanceFromNodeKey(
    {
      id: run.id,
      user_id: run.userId,
      conversation_id: run.conversationId!,
      contact_id: run.contactId!,
      current_node_key: run.currentNodeKey,
      vars: run.vars as Record<string, unknown>,
    },
    flow.entryNodeId!,
    nodes,
  );
  return {
    consumed: true,
    flow_run_id: run.id,
    outcome: outcome.outcome === "advanced" ? "started" : outcome.outcome,
  };
}
