import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireAdmin } from "./lib/auth";
import { MAX_ATTEMPTS, retryDelayMs, todayUtc, isOverdue, reminderKey, daysBetween, type LoanStatus } from "./lib/rules";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, signedMessage } from "./lib/signature";

// Who needs to hear about each status change. Only that person's name and email
// leave Convex; the other party's details are never sent to n8n.
const RECIPIENT: Record<LoanStatus, "lender" | "borrower"> = {
  requested: "lender",
  cancelled: "lender",
  approved: "borrower",
  declined: "borrower",
  returned: "borrower",
};

export const notificationPayload = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const event = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!event || event.status === "sent" || !event.loanId) return null;
    const loan = await ctx.db.get(event.loanId);
    if (!loan) return null;
    const tool = await ctx.db.get(loan.toolId);
    const recipient = await ctx.db.get(RECIPIENT[loan.status] === "lender" ? loan.lenderId : loan.borrowerId);
    if (!recipient) return null;
    return {
      attempts: event.attempts,
      payload: {
        event: `loan.${loan.status}`,
        idempotencyKey: key,
        loanId: loan._id,
        toolName: tool?.name ?? "a tool",
        startDate: loan.startDate,
        endDate: loan.endDate,
        recipient: { name: recipient.name, email: recipient.email },
      },
    };
  },
});

export const recordAttempt = internalMutation({
  args: { key: v.string(), status: v.union(v.literal("sent"), v.literal("failed")), detail: v.optional(v.string()) },
  handler: async (ctx, { key, status, detail }) => {
    const event = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!event || event.status === "sent") return event?.attempts ?? 0;
    const attempts = event.attempts + 1;
    await ctx.db.patch(event._id, { status, attempts, detail: detail?.slice(0, 300), updatedAt: Date.now() });
    return attempts;
  },
});

/** Sends one signed notification to n8n; on failure, reschedules itself with backoff. */
export const deliverLoanNotification = internalAction({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const job = await ctx.runQuery(internal.automation.notificationPayload, { key });
    if (!job) return;
    const url = process.env.N8N_LOAN_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_N8N_SECRET;
    let failure: string | null = null;
    if (!url || !secret) failure = "n8n webhook URL or shared secret not configured";
    else {
      const body = JSON.stringify(job.payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = await sign(secret, signedMessage(timestamp, "POST", new URL(url).pathname, body));
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature, "x-idempotency-key": key },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) failure = `n8n responded ${res.status}`;
      } catch (e) {
        failure = `request failed: ${(e as Error).message}`;
      }
    }
    const attempts = await ctx.runMutation(internal.automation.recordAttempt, { key, status: failure ? "failed" : "sent", detail: failure ?? undefined });
    if (failure && attempts < MAX_ATTEMPTS) await ctx.scheduler.runAfter(retryDelayMs(attempts), internal.automation.deliverLoanNotification, { key });
  },
});

/** Overdue loans that haven't had today's reminder yet. Minimal fields only. */
export const overdueForReminders = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const loans = await ctx.db.query("loans").withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", today)).take(500);
    const out = [];
    for (const loan of loans) {
      if (!isOverdue(loan, today)) continue;
      const key = reminderKey(loan._id, today);
      const done = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", key)).unique();
      if (done?.status === "sent") continue;
      const borrower = await ctx.db.get(loan.borrowerId);
      const tool = await ctx.db.get(loan.toolId);
      if (!borrower) continue;
      out.push({
        reminderKey: key,
        loanId: loan._id,
        toolName: tool?.name ?? "a tool",
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
        borrower: { name: borrower.name, email: borrower.email },
      });
    }
    return out;
  },
});

/** Idempotent write-back from n8n: retries of the same reminder never create a second record. */
export const recordReminder = internalMutation({
  args: { reminderKey: v.string(), loanId: v.id("loans"), status: v.union(v.literal("sent"), v.literal("failed")), detail: v.optional(v.string()) },
  handler: async (ctx, { reminderKey: key, loanId, status, detail }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan || !key.startsWith(`overdue:${loanId}:`)) return { ok: false as const, reason: "unknown loan or key" };
    const existing = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", key)).unique();
    const now = Date.now();
    if (!existing) {
      await ctx.db.insert("automationEvents", { key, loanId, kind: "overdue_reminder", status, attempts: 1, detail: detail?.slice(0, 300), updatedAt: now });
      return { ok: true as const, duplicate: false };
    }
    if (existing.status === "sent") return { ok: true as const, duplicate: true };
    await ctx.db.patch(existing._id, { status, attempts: existing.attempts + 1, detail: detail?.slice(0, 300), updatedAt: now });
    return { ok: true as const, duplicate: false };
  },
});

export const recordWorkflowError = internalMutation({
  args: { executionId: v.string(), workflow: v.string(), node: v.string(), message: v.string() },
  handler: async (ctx, a) => {
    const key = `wferr:${a.executionId}`;
    const existing = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (existing) return;
    await ctx.db.insert("automationEvents", {
      key,
      kind: "workflow_error",
      status: "failed",
      attempts: 1,
      detail: `${a.workflow} › ${a.node}: ${a.message}`.slice(0, 300),
      updatedAt: Date.now(),
    });
  },
});

/** Admin view of automation health: failures and the latest activity. */
export const recentForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const events = await ctx.db.query("automationEvents").order("desc").take(50);
    return events.map((e) => ({ _id: e._id, kind: e.kind, status: e.status, attempts: e.attempts, detail: e.detail ?? null, updatedAt: e.updatedAt }));
  },
});
