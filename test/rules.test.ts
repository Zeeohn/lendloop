import { describe, expect, it } from "vitest";
import { checkTransition, canRemoveTool, canEditTool, isOverdue, rangesOverlap, reminderKey, retryDelayMs, validateRange, isIsoDay, cleanText } from "../convex/lib/rules";

const lender = { userId: "u_lender", role: "user" as const };
const borrower = { userId: "u_borrower", role: "user" as const };
const admin = { userId: "u_admin", role: "admin" as const };
const loan = (status: "requested" | "approved" | "declined" | "cancelled" | "returned") => ({ lenderId: "u_lender", borrowerId: "u_borrower", status });

describe("date validation", () => {
  it("accepts a valid future range", () => expect(validateRange("2026-11-10", "2026-11-12", "2026-11-03")).toBeNull());
  it("rejects past starts", () => expect(validateRange("2026-11-01", "2026-11-05", "2026-11-03")).toMatch(/past/));
  it("rejects end before start", () => expect(validateRange("2026-11-10", "2026-11-09", "2026-11-03")).toMatch(/after/));
  it("rejects impossible dates", () => expect(isIsoDay("2026-02-30")).toBe(false));
  it("caps loan length at 30 days", () => expect(validateRange("2026-11-10", "2026-12-10", "2026-11-03")).toMatch(/30 days/));
});

describe("overlap", () => {
  it("detects inclusive overlaps", () => {
    expect(rangesOverlap("2026-11-10", "2026-11-12", "2026-11-12", "2026-11-14")).toBe(true);
    expect(rangesOverlap("2026-11-10", "2026-11-12", "2026-11-13", "2026-11-14")).toBe(false);
  });
});

describe("loan state machine and permissions", () => {
  it("lets only the lender approve a requested loan", () => {
    expect(checkTransition(lender, loan("requested"), "approve")).toEqual({ ok: true, to: "approved" });
    expect(checkTransition(borrower, loan("requested"), "approve").ok).toBe(false);
  });
  it("does not let admins act on other people's loans", () => expect(checkTransition(admin, loan("requested"), "approve").ok).toBe(false));
  it("lets only the borrower cancel", () => {
    expect(checkTransition(borrower, loan("requested"), "cancel")).toEqual({ ok: true, to: "cancelled" });
    expect(checkTransition(lender, loan("requested"), "cancel").ok).toBe(false);
  });
  it("only returns approved loans", () => {
    expect(checkTransition(lender, loan("approved"), "return")).toEqual({ ok: true, to: "returned" });
    expect(checkTransition(lender, loan("requested"), "return").ok).toBe(false);
  });
  it("blocks re-deciding a finished loan", () => expect(checkTransition(lender, loan("declined"), "approve").ok).toBe(false));
  it("listing rules: owner edits, owner or admin removes", () => {
    expect(canEditTool(lender, "u_lender")).toBe(true);
    expect(canEditTool(admin, "u_lender")).toBe(false);
    expect(canRemoveTool(admin, "u_lender")).toBe(true);
    expect(canRemoveTool(borrower, "u_lender")).toBe(false);
  });
});

describe("automation helpers", () => {
  it("flags overdue approved loans only", () => {
    expect(isOverdue({ status: "approved", endDate: "2026-11-01" }, "2026-11-03")).toBe(true);
    expect(isOverdue({ status: "returned", endDate: "2026-11-01" }, "2026-11-03")).toBe(false);
    expect(isOverdue({ status: "approved", endDate: "2026-11-03" }, "2026-11-03")).toBe(false);
  });
  it("uses one reminder key per loan per day", () => expect(reminderKey("L1", "2026-11-03")).toBe("overdue:L1:2026-11-03"));
  it("backs off exponentially with a cap", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(240_000);
    expect(retryDelayMs(20)).toBe(30 * 60_000);
  });
  it("cleans and bounds user text", () => expect(cleanText("  a \n  b  ", 2)).toBe("a "));
});
