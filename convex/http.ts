import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./lib/signature";

// Endpoints called by n8n. Every request must carry a fresh HMAC signature over
// timestamp + method + path + body; anything else gets a bare 401 with no detail.
const http = httpRouter();

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function authenticated(req: Request, body: string) {
  return verify({
    secret: process.env.LENDLOOP_N8N_SECRET,
    signature: req.headers.get(SIGNATURE_HEADER),
    timestamp: req.headers.get(TIMESTAMP_HEADER),
    method: req.method,
    path: new URL(req.url).pathname,
    body,
  });
}

http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!(await authenticated(req, "")).ok) return json(401, { error: "unauthorized" });
    const loans = await ctx.runQuery(internal.automation.overdueForReminders, {});
    return json(200, { today: new Date().toISOString().slice(0, 10), loans });
  }),
});

http.route({
  path: "/n8n/reminder-result",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    if (body.length > 10_000) return json(413, { error: "too large" });
    if (!(await authenticated(req, body)).ok) return json(401, { error: "unauthorized" });
    let data: { reminderKey?: unknown; loanId?: unknown; status?: unknown; detail?: unknown };
    try {
      data = JSON.parse(body);
    } catch {
      return json(400, { error: "invalid JSON" });
    }
    if (typeof data.reminderKey !== "string" || typeof data.loanId !== "string" || (data.status !== "sent" && data.status !== "failed"))
      return json(400, { error: "expected reminderKey, loanId and status" });
    try {
      const result = await ctx.runMutation(internal.automation.recordReminder, {
        reminderKey: data.reminderKey,
        loanId: data.loanId as Id<"loans">,
        status: data.status,
        detail: typeof data.detail === "string" ? data.detail : undefined,
      });
      return json(result.ok ? 200 : 404, result);
    } catch {
      return json(400, { error: "invalid loanId" });
    }
  }),
});

http.route({
  path: "/n8n/workflow-error",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.text();
    if (body.length > 10_000) return json(413, { error: "too large" });
    if (!(await authenticated(req, body)).ok) return json(401, { error: "unauthorized" });
    let d: Record<string, unknown>;
    try {
      d = JSON.parse(body);
    } catch {
      return json(400, { error: "invalid JSON" });
    }
    const s = (x: unknown) => (typeof x === "string" ? x : String(x ?? "")).slice(0, 200);
    await ctx.runMutation(internal.automation.recordWorkflowError, { executionId: s(d.executionId), workflow: s(d.workflow), node: s(d.node), message: s(d.message) });
    return json(200, { ok: true });
  }),
});

export default http;
