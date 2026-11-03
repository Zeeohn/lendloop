import { internalMutation } from "./_generated/server";
import { ConvexError } from "convex/values";
import { queueNotification } from "./loans";
import { todayUtc } from "./lib/rules";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * Demo data for local review: `npx convex run seed:demo`.
 * Internal only, and refuses to run on a deployment that already has users.
 */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.db.query("users").take(1)).length) throw new ConvexError("Database not empty; seed is for fresh dev deployments only.");
    const now = Date.now();
    const ada = await ctx.db.insert("users", { clerkId: "seed_ada", name: "Ada Lender", email: "ada@example.com", role: "user", trustedLender: true });
    const ben = await ctx.db.insert("users", { clerkId: "seed_ben", name: "Ben Borrower", email: "ben@example.com", role: "user", trustedLender: false });
    const drill = await ctx.db.insert("tools", { ownerId: ada, name: "Cordless drill", category: "power_tools", condition: "good", description: "18V, two batteries.", createdAt: now });
    const tent = await ctx.db.insert("tools", { ownerId: ada, name: "4-person tent", category: "camping", condition: "fair", description: "Pegs included.", createdAt: now });
    await ctx.db.insert("tools", { ownerId: ben, name: "Hedge trimmer", category: "garden", condition: "new", description: "", createdAt: now });
    // Overdue: Ben borrowed the drill and should have returned it three days ago.
    const overdue = await ctx.db.insert("loans", { toolId: drill, lenderId: ada, borrowerId: ben, startDate: day(-6), endDate: day(-3), status: "approved", createdAt: now, updatedAt: now });
    // Pending: Ben wants the tent next weekend; Ada gets notified.
    const pending = await ctx.db.insert("loans", { toolId: tent, lenderId: ada, borrowerId: ben, startDate: day(5), endDate: day(7), status: "requested", createdAt: now, updatedAt: now });
    await queueNotification(ctx, (await ctx.db.get(pending))!);
    return { today: todayUtc(), overdueLoan: overdue, pendingLoan: pending };
  },
});

/** Adds a fresh overdue loan so the reminder workflow has something to do: `npx convex run seed:overdueLoan`. */
export const overdueLoan = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").take(10);
    const lender = users.find((u) => u.clerkId === "seed_ada");
    const borrower = users.find((u) => u.clerkId === "seed_ben");
    if (!lender || !borrower) throw new ConvexError("Run seed:demo first.");
    const now = Date.now();
    const toolId = await ctx.db.insert("tools", { ownerId: lender._id, name: "Pressure washer", category: "cleaning", condition: "good", description: "", createdAt: now });
    return ctx.db.insert("loans", { toolId, lenderId: lender._id, borrowerId: borrower._id, startDate: day(-4), endDate: day(-1), status: "approved", createdAt: now, updatedAt: now });
  },
});
