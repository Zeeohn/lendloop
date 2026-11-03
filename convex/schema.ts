import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const category = v.union(
  v.literal("power_tools"), v.literal("hand_tools"), v.literal("garden"), v.literal("kitchen"),
  v.literal("camping"), v.literal("cleaning"), v.literal("other"),
);
export const condition = v.union(v.literal("new"), v.literal("good"), v.literal("fair"), v.literal("worn"));
export const loanStatus = v.union(
  v.literal("requested"), v.literal("approved"), v.literal("declined"), v.literal("cancelled"), v.literal("returned"),
);

export default defineSchema({
  // One row per Clerk user. Role lives here (not in Clerk metadata) so every
  // authorization decision is made inside Convex.
  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
  }).index("by_clerkId", ["clerkId"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category,
    condition,
    description: v.string(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD, inclusive
    endDate: v.string(),
    status: loanStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tool", ["toolId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_status_end", ["status", "endDate"]),

  // Audit trail of every automation attempt. `key` makes delivery idempotent:
  // the same notification or daily reminder is recorded (and sent) only once.
  automationEvents: defineTable({
    key: v.string(),
    loanId: v.optional(v.id("loans")),
    kind: v.union(v.literal("loan_notification"), v.literal("overdue_reminder"), v.literal("workflow_error")),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    attempts: v.number(),
    detail: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_loan", ["loanId"])
    .index("by_status", ["status"]),
});
