import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { requireAdmin, requireUser } from "./lib/auth";
import { blocksCalendar, checkTransition, notificationKey, rangesOverlap, todayUtc, validateRange, type LoanAction } from "./lib/rules";

export async function queueNotification(ctx: MutationCtx, loan: Doc<"loans">) {
  const key = notificationKey(loan._id, loan.status);
  const existing = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (existing) return; // already queued or sent for this status: never notify twice
  await ctx.db.insert("automationEvents", { key, loanId: loan._id, kind: "loan_notification", status: "pending", attempts: 0, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.automation.deliverLoanNotification, { key });
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Tool not found.");
    if (tool.ownerId === me._id) throw new ConvexError("You can't borrow your own tool.");
    const bad = validateRange(startDate, endDate, todayUtc());
    if (bad) throw new ConvexError(bad);
    const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
    if (loans.some((l) => blocksCalendar(l.status) && rangesOverlap(l.startDate, l.endDate, startDate, endDate)))
      throw new ConvexError("The tool is already lent out for some of those dates.");
    if (loans.some((l) => l.borrowerId === me._id && l.status === "requested"))
      throw new ConvexError("You already have a pending request for this tool.");
    const now = Date.now();
    const id = await ctx.db.insert("loans", { toolId, lenderId: tool.ownerId, borrowerId: me._id, startDate, endDate, status: "requested", createdAt: now, updatedAt: now });
    await queueNotification(ctx, (await ctx.db.get(id))!);
    return id;
  },
});

async function act(ctx: MutationCtx, loanId: Id<"loans">, action: LoanAction) {
  const me = await requireUser(ctx);
  const loan = await ctx.db.get(loanId);
  if (!loan) throw new ConvexError("Loan not found.");
  const check = checkTransition({ userId: me._id, role: me.role }, loan, action);
  if (!check.ok) throw new ConvexError(check.error);
  if (action === "approve") {
    // Re-check the calendar at approval time: two requests may overlap.
    const others = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", loan.toolId)).collect();
    if (others.some((l) => l._id !== loan._id && blocksCalendar(l.status) && rangesOverlap(l.startDate, l.endDate, loan.startDate, loan.endDate)))
      throw new ConvexError("Those dates now clash with another approved loan.");
  }
  await ctx.db.patch(loanId, { status: check.to, updatedAt: Date.now() });
  await queueNotification(ctx, (await ctx.db.get(loanId))!);
}

export const approve = mutation({ args: { loanId: v.id("loans") }, handler: (ctx, a) => act(ctx, a.loanId, "approve") });
export const decline = mutation({ args: { loanId: v.id("loans") }, handler: (ctx, a) => act(ctx, a.loanId, "decline") });
export const cancel = mutation({ args: { loanId: v.id("loans") }, handler: (ctx, a) => act(ctx, a.loanId, "cancel") });
export const markReturned = mutation({ args: { loanId: v.id("loans") }, handler: (ctx, a) => act(ctx, a.loanId, "return") });

async function present(ctx: QueryCtx, loans: Doc<"loans">[], viewer: "lender" | "borrower" | "admin") {
  return Promise.all(
    loans.map(async (l) => {
      const tool = await ctx.db.get(l.toolId);
      const other = await ctx.db.get(viewer === "lender" ? l.borrowerId : l.lenderId);
      const events = await ctx.db.query("automationEvents").withIndex("by_loan", (q) => q.eq("loanId", l._id)).collect();
      const latest = events.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      return {
        _id: l._id,
        toolName: tool?.name ?? "(removed tool)",
        startDate: l.startDate,
        endDate: l.endDate,
        status: l.status,
        overdue: l.status === "approved" && l.endDate < todayUtc(),
        counterpartName: other?.name ?? "Unknown",
        lastAutomation: latest ? { kind: latest.kind, status: latest.status, at: latest.updatedAt } : null,
      };
    }),
  );
}

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db.query("loans").withIndex("by_borrower", (q) => q.eq("borrowerId", me._id)).order("desc").take(100);
    return present(ctx, loans, "borrower");
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db.query("loans").withIndex("by_lender", (q) => q.eq("lenderId", me._id)).order("desc").take(100);
    return present(ctx, loans, "lender");
  },
});

export const allForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(200);
    return present(ctx, loans, "admin");
  },
});
