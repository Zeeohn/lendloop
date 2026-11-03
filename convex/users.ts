import { mutation, query, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { currentUser, requireAdmin } from "./lib/auth";
import { cleanText } from "./lib/rules";

/** Creates or refreshes the caller's user row from their verified Clerk identity. */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in first.");
    const name = cleanText(identity.name ?? identity.nickname ?? "Neighbour", 80);
    const email = (identity.email ?? "").toLowerCase();
    const existing = await currentUser(ctx);
    if (existing) {
      if (existing.name !== name || existing.email !== email) await ctx.db.patch(existing._id, { name, email });
      return existing._id;
    }
    return await ctx.db.insert("users", { clerkId: identity.subject, name, email, role: "user", trustedLender: false });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    return { _id: user._id, name: user.name, role: user.role, trustedLender: user.trustedLender };
  },
});

export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(500);
    return users.map((u) => ({ _id: u._id, name: u.name, email: u.email, role: u.role, trustedLender: u.trustedLender }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/**
 * Bootstrap only: `npx convex run users:promoteToAdmin '{"email":"you@example.com"}'`.
 * Internal, so it can't be called from the browser; there is no self-service path to admin.
 */
export const promoteToAdmin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const users = await ctx.db.query("users").take(1000);
    const user = users.find((u) => u.email === email.toLowerCase());
    if (!user) throw new ConvexError("No user with that email has signed in yet.");
    await ctx.db.patch(user._id, { role: "admin" });
    return user._id;
  },
});
