# LendLoop

**Borrow what you need. Lend what you don't.**

LendLoop is a neighbourhood tool-lending board:
- Neighbours list tools, request them for a date range, and approve, decline or return loans.
- Two n8n workflows handle notifications and overdue reminders.

**Stack:** Next.js 16 (App Router) · Clerk · Convex · n8n · TypeScript

## What's in the box

| Requirement | Where |
|---|---|
| Public page: tools (name and category only), "Sign in to lend or borrow" | `app/page.tsx`, `convex/tools.ts → publicList` |
| List, request, approve/decline, return; availability; category filter; my listings / my requests / incoming views | `components/Dashboard.tsx`, `convex/tools.ts`, `convex/loans.ts` |
| Roles (`admin` / `user`), enforced in Convex functions | `convex/lib/auth.ts`, `convex/lib/rules.ts` |
| Admin: remove any listing, view all loans, mark "Trusted Lender" | Admin tab, `users.setTrustedLender`, `tools.remove`, `loans.allForAdmin` |
| n8n workflow 1: request notifications | `n8n/workflows/loan-notifications.json` |
| n8n workflow 2: daily overdue reminders with write-back | `n8n/workflows/overdue-reminders.json` |
| Error workflow, so failed runs are visible | `n8n/workflows/error-handler.json` → admin "Automation health" |
| Signed webhooks in both directions, idempotent write-backs, retries | `convex/lib/signature.ts`, `convex/automation.ts`, `convex/http.ts` |
| Bonus: automation activity per loan ("Notification sent 2 min ago") | `loans.present → lastAutomation` |

## Architecture

```
Browser (Next.js + Clerk)
   │  Convex React client, Clerk JWT on every call
   ▼
Convex
  mutations/queries ── every call re-checks the identity + role ──► tables
  │  status change → automationEvents row (unique key) → scheduled action
  ▼
  action: HMAC-signed POST ───────────────► n8n "Loan notifications"
          retry with backoff (1, 2, 4, 8 min; 5 tries)  │ verify signature on the raw body
                                                         │ notify the one recipient (mock)
                                                         └ 200 / 401
  HTTP routes (/n8n/*)  ◄── HMAC-signed GET  ── n8n "Overdue reminders" (daily 09:00)
                        ◄── HMAC-signed POST ── write-back {reminderKey, status}
                        ◄── HMAC-signed POST ── n8n "Error handler" (any failed run)
```

**Data model:** `users`, `tools`, `loans`, `automationEvents` (see `convex/schema.ts`).
- Loans move `requested → approved | declined | cancelled` and `approved → returned`. The state machine lives in `convex/lib/rules.ts`.
- An approval re-checks the calendar, so two overlapping requests can't both be approved.

## Security and data-minimisation decisions

**Authorization:**
- Authorization is done in Convex, never only in the UI.
- Every function derives the user from the verified Clerk JWT (`ctx.auth`); a client-supplied user id is never trusted.
- Only the lender can approve, decline or return. Only the borrower can cancel. Only owners edit their listings. Owners or admins remove them.
- Admins can see everything but can't act on other people's loans.
- The admin role can't be self-assigned: it's granted only by an internal function (`npx convex run users:promoteToAdmin`), which the browser can't call.

**Webhook signing, both ways:**
- HMAC-SHA256 over `timestamp.METHOD path.body`, with a 5-minute window and a constant-time comparison.
- Binding the method and path stops a signature for one endpoint being replayed against another.
- n8n verifies against the *raw* request body; it never re-serialises JSON.
- Convex answers a bare `401` with no detail on any failure.

**Secrets:**
- In Convex environment variables, n8n's environment, and `.env` (git-ignored).
- The exported workflow JSON reads the secret from `$env` and contains no secrets.
- Convex refuses to verify anything when the secret is missing or shorter than 32 characters.

**Idempotency:**
- Each loan notification has the key `loan:<id>:<status>` and each daily reminder `overdue:<loanId>:<day>`.
- Retries, n8n re-runs and duplicate write-backs reuse the same record and never send twice.
- Write-backs are scoped: a reminder key must belong to the loan it names.

**Failures are visible:**
- Convex retries failed deliveries with exponential backoff and records every attempt.
- n8n HTTP nodes retry 3 times. Any failed run triggers the error workflow, which reports to Convex.
- The admin's "Automation health" list shows every failure.

**Data minimisation:**
- The public page returns only tool names and categories.
- The signed-in view shows lenders' first names only.
- Payloads to n8n carry only the recipient's name and email, the tool name and the dates; the other party's details are never sent.
- Overdue reminders carry only the borrower's contact.
- Input is length-limited and whitespace-normalised.

**Headers:** `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, and no `X-Powered-By`.

## Local setup

**Requirements:** Node 24, a Clerk account (free), a Convex account (free), and Docker (or `npx n8n`).

1. `npm install`
2. **Convex:** `npx convex dev`. This creates a project and writes `NEXT_PUBLIC_CONVEX_URL` to `.env.local`.
3. **Clerk:**
   - Create an application.
   - Under **JWT templates**, create the **Convex** template.
   - Copy its Issuer URL, then: `npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your>.clerk.accounts.dev`
   - Put `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `.env.local`.
4. **Shared secret:**
   - `openssl rand -hex 32`
   - Then `npx convex env set LENDLOOP_N8N_SECRET <value>`, and put the same value in `.env` for n8n.
5. **n8n:**
   - Set `LENDLOOP_CONVEX_SITE_URL` in `.env` (your Convex HTTP actions URL, ending `.convex.site`), then run `docker compose up -d`.
   - Import the workflows: `docker compose exec n8n n8n import:workflow --separate --input=/workflows`
   - Open http://localhost:5678 and publish *Loan notifications* and *Overdue reminders*.
   - Run: `npx convex env set N8N_LOAN_WEBHOOK_URL http://localhost:5678/webhook/lendloop-loan-events`
   - If n8n runs in Docker and Convex is local, use your machine's LAN IP instead of `localhost`.
6. **Next.js:** `npm run dev`, then open http://localhost:3000 and sign in.
7. **Make yourself admin:** `npx convex run users:promoteToAdmin '{"email":"you@example.com"}'`

**Demo data:**
- `npx convex run seed:demo` (a fresh deployment only) creates two users, tools, an overdue loan and a pending request.
- `npx convex run seed:overdueLoan` adds another overdue loan.
- In n8n, open *Overdue reminders* and press **Run now (manual)**.

**Tests:** `npm test` runs 22 unit tests covering the state machine, permissions, date rules, retry backoff, and HMAC signing. One test checks Web Crypto against Node's `crypto`, the same way n8n signs.

### Verified end to end

Checked on a local Convex deployment with n8n 2.46:
- A request and an approval each produced one signed notification, which n8n verified and acknowledged.
- An injected 503 was retried after 60 s with the same idempotency key.
- The overdue workflow fetched, "sent" and wrote back. Running it again created no duplicate.
- Unsigned or wrong-signature calls to n8n got `401`.
- Bad signatures, stale timestamps and a forged reminder key were rejected by Convex (`401` / `401` / `404`).
- A borrower trying to approve their own request was refused.

## What I'd change for production

- **Real delivery:** swap the mock nodes for Email or Slack nodes using n8n credentials, with per-user notification preferences and unsubscribe.
- **Secret rotation:** accept two secrets during a rotation window, and give each direction its own secret.
- **Queueing at scale:** use Convex's workpool component for delivery with concurrency limits; paginate the overdue query.
- **Calendar consistency:** keep a per-tool "booked days" index, so approval doesn't scan every loan for a tool.
- **Observability:** send structured logs to a log drain, alert on failed-automation counts, and add n8n execution retention and an alert channel.
- **Abuse limits:** rate-limit requests per user (Convex rate-limiter component); give admins moderation and audit logs.
- **Privacy:** add data export and deletion (GDPR), and a retention policy for `automationEvents`.
- **Hosting:** Vercel for Next.js, Convex Cloud, and n8n Cloud or self-hosted n8n behind HTTPS with a private webhook path.
