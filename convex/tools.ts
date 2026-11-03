import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { category, condition } from "./schema";
import { requireUser } from "./lib/auth";
import { canEditTool, canRemoveTool, cleanText, rangesOverlap, todayUtc } from "./lib/rules";
import { queueNotification } from "./loans";

const PAGE = 200;

async function onLoanToday(ctx: QueryCtx, toolId: Id<"tools">, today: string): Promise<boolean> {
  const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
  return loans.some((l) => l.status === "approved" && rangesOverlap(l.startDate, l.endDate, today, today));
}

/** Public (signed-out) view: name and category only, no owner details. */
export const publicList = query({
  args: { category: v.optional(category) },
  handler: async (ctx, args) => {
    const today = todayUtc();
    const tools = args.category
      ? await ctx.db.query("tools").withIndex("by_category", (q) => q.eq("category", args.category!)).take(PAGE)
      : await ctx.db.query("tools").order("desc").take(PAGE);
    const out: { _id: Id<"tools">; name: string; category: Doc<"tools">["category"] }[] = [];
    for (const t of tools) if (!(await onLoanToday(ctx, t._id, today))) out.push({ _id: t._id, name: t.name, category: t.category });
    return out;
  },
});

/** Signed-in view: every tool with availability, plus the lender's first name and trust badge. */
export const browse = query({
  args: { category: v.optional(category) },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const today = todayUtc();
    const tools = args.category
      ? await ctx.db.query("tools").withIndex("by_category", (q) => q.eq("category", args.category!)).take(PAGE)
      : await ctx.db.query("tools").order("desc").take(PAGE);
    return Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        return {
          _id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          description: t.description,
          available: !(await onLoanToday(ctx, t._id, today)),
          isMine: t.ownerId === me._id,
          lenderFirstName: owner?.name.split(" ")[0] ?? "Neighbour",
          trustedLender: owner?.trustedLender ?? false,
        };
      }),
    );
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    return ctx.db.query("tools").withIndex("by_owner", (q) => q.eq("ownerId", me._id)).collect();
  },
});

const fields = { name: v.string(), category, condition, description: v.string() };

function clean(args: { name: string; description: string }) {
  const name = cleanText(args.name, 80);
  const description = cleanText(args.description, 500);
  if (name.length < 2) throw new ConvexError("Give the tool a name.");
  return { name, description };
}

export const create = mutation({
  args: fields,
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    return ctx.db.insert("tools", { ownerId: me._id, ...clean(args), category: args.category, condition: args.condition, createdAt: Date.now() });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), ...fields },
  handler: async (ctx, { toolId, ...args }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Tool not found.");
    if (!canEditTool({ userId: me._id, role: me.role }, tool.ownerId)) throw new ConvexError("You can only edit your own listings.");
    await ctx.db.patch(toolId, { ...clean(args), category: args.category, condition: args.condition });
  },
});

export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Tool not found.");
    if (!canRemoveTool({ userId: me._id, role: me.role }, tool.ownerId)) throw new ConvexError("You can't remove this listing.");
    const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
    if (loans.some((l) => l.status === "approved")) throw new ConvexError("This tool is on loan; mark it returned first.");
    // Open requests can't be fulfilled any more: close them so borrowers aren't left waiting.
    for (const l of loans) {
      if (l.status !== "requested") continue;
      await ctx.db.patch(l._id, { status: "declined", updatedAt: Date.now() });
      await queueNotification(ctx, (await ctx.db.get(l._id))!);
    }
    await ctx.db.delete(toolId);
  },
});
