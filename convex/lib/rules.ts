// Pure, framework-free business rules. Every Convex function calls these, and
// the unit tests in /test exercise them directly.

export const CATEGORIES = ["power_tools", "hand_tools", "garden", "kitchen", "camping", "cleaning", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CONDITIONS = ["new", "good", "fair", "worn"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const LOAN_STATUSES = ["requested", "approved", "declined", "cancelled", "returned"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export type Role = "admin" | "user";

/** Dates are plain calendar days, "YYYY-MM-DD", compared as strings. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(s: string): boolean {
  if (!DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function todayUtc(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export const MAX_LOAN_DAYS = 30;

export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/** Returns an error message, or null when the range is acceptable. */
export function validateRange(start: string, end: string, today: string): string | null {
  if (!isIsoDay(start) || !isIsoDay(end)) return "Dates must be YYYY-MM-DD.";
  if (start < today) return "The loan can't start in the past.";
  if (end < start) return "The end date must be on or after the start date.";
  if (daysBetween(start, end) + 1 > MAX_LOAN_DAYS) return `Loans are limited to ${MAX_LOAN_DAYS} days.`;
  return null;
}

/** Inclusive date ranges overlap if neither ends before the other starts. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Statuses that hold the tool for their date range. */
export function blocksCalendar(status: LoanStatus): boolean {
  return status === "approved";
}

export type LoanAction = "approve" | "decline" | "cancel" | "return";

const TRANSITIONS: Record<LoanAction, { from: LoanStatus[]; to: LoanStatus; by: "lender" | "borrower" }> = {
  approve: { from: ["requested"], to: "approved", by: "lender" },
  decline: { from: ["requested"], to: "declined", by: "lender" },
  cancel: { from: ["requested"], to: "cancelled", by: "borrower" },
  return: { from: ["approved"], to: "returned", by: "lender" },
};

export type Actor = { userId: string; role: Role };
export type LoanParties = { lenderId: string; borrowerId: string; status: LoanStatus };

/**
 * Decides whether `actor` may perform `action` on a loan. Only the party the
 * transition belongs to may act (admins can read everything but don't act on
 * other people's loans), and only from an allowed status.
 */
export function checkTransition(actor: Actor, loan: LoanParties, action: LoanAction): { ok: true; to: LoanStatus } | { ok: false; error: string } {
  const t = TRANSITIONS[action];
  const party = t.by === "lender" ? loan.lenderId : loan.borrowerId;
  if (actor.userId !== party) return { ok: false, error: `Only the ${t.by} can ${action} this loan.` };
  if (!t.from.includes(loan.status)) return { ok: false, error: `Can't ${action} a loan that is ${loan.status}.` };
  return { ok: true, to: t.to };
}

/** Owners manage their own listings; admins may remove any listing. */
export function canEditTool(actor: Actor, ownerId: string): boolean {
  return actor.userId === ownerId;
}
export function canRemoveTool(actor: Actor, ownerId: string): boolean {
  return actor.userId === ownerId || actor.role === "admin";
}

export function isOverdue(loan: { status: LoanStatus; endDate: string }, today: string): boolean {
  return loan.status === "approved" && loan.endDate < today;
}

/** One reminder per loan per day; retries reuse the same key, so they can't double-send. */
export function reminderKey(loanId: string, day: string): string {
  return `overdue:${loanId}:${day}`;
}

export function notificationKey(loanId: string, status: LoanStatus): string {
  return `loan:${loanId}:${status}`;
}

/** Exponential backoff with a cap, in milliseconds. Attempt starts at 1. */
export function retryDelayMs(attempt: number): number {
  return Math.min(60_000 * 2 ** (attempt - 1), 30 * 60_000);
}
export const MAX_ATTEMPTS = 5;

/** Trim and bound user text so listings can't carry megabytes of data. */
export function cleanText(s: string, max: number): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}
