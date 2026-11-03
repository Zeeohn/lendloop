"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORY_LABEL, CONDITION_LABEL, STATUS_STYLE, errorText, timeAgo } from "./labels";

type Tab = "browse" | "listings" | "incoming" | "requests" | "admin";
const CATEGORIES = Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[];
const CONDITIONS = Object.keys(CONDITION_LABEL);
type Cat = "power_tools" | "hand_tools" | "garden" | "kitchen" | "camping" | "cleaning" | "other";
type Cond = "new" | "good" | "fair" | "worn";

function useRun() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null); setBusy(true);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return { error, busy, run };
}

export function Dashboard() {
  const ensure = useMutation(api.users.ensure);
  const me = useQuery(api.users.me);
  const [tab, setTab] = useState<Tab>("browse");
  useEffect(() => { void ensure(); }, [ensure]);

  const tabs: [Tab, string][] = [["browse", "Browse"], ["listings", "My listings"], ["incoming", "Incoming requests"], ["requests", "My requests"]];
  if (me?.role === "admin") tabs.push(["admin", "Admin"]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-teal-800">LendLoop</Link>
        <div className="flex items-center gap-3 text-sm">
          {me?.trustedLender && <span className="badge bg-teal-100 text-teal-800">Trusted Lender</span>}
          {me?.role === "admin" && <span className="badge bg-violet-100 text-violet-800">Admin</span>}
          <UserButton />
        </div>
      </header>
      <nav className="mb-6 flex flex-wrap gap-2">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={tab === key ? "btn-primary" : "btn-ghost"}>{label}</button>
        ))}
      </nav>
      {me === undefined ? <p className="text-stone-500">Loading…</p> : (
        <>
          {tab === "browse" && <Browse />}
          {tab === "listings" && <MyListings />}
          {tab === "incoming" && <LoanList kind="incoming" />}
          {tab === "requests" && <LoanList kind="requests" />}
          {tab === "admin" && me?.role === "admin" && <Admin />}
        </>
      )}
    </main>
  );
}

function Browse() {
  const [category, setCategory] = useState<Cat | "">("");
  const tools = useQuery(api.tools.browse, category ? { category } : {});
  const [open, setOpen] = useState<Id<"tools"> | null>(null);
  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm text-stone-600" htmlFor="cat">Category</label>
        <select id="cat" className="input max-w-xs" value={category} onChange={(e) => setCategory(e.target.value as Cat | "")}>
          <option value="">All</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
      </div>
      {tools === undefined ? <p className="text-stone-500">Loading…</p> : tools.length === 0 ? <p className="text-stone-500">No tools in this category yet.</p> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tools.map((t) => (
            <li key={t._id} className="card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{t.name}</p>
                  <p className="text-sm text-stone-500">{CATEGORY_LABEL[t.category]} · {CONDITION_LABEL[t.condition]} · lent by {t.lenderFirstName}{t.trustedLender ? " ✓ Trusted" : ""}</p>
                </div>
                <span className={`badge ${t.available ? "bg-teal-100 text-teal-800" : "bg-stone-200 text-stone-700"}`}>{t.available ? "Available" : "On loan"}</span>
              </div>
              {t.description && <p className="mt-2 text-sm text-stone-700">{t.description}</p>}
              {!t.isMine && (open === t._id ? <RequestForm toolId={t._id} onDone={() => setOpen(null)} /> :
                <button className="btn-ghost mt-3" onClick={() => setOpen(t._id)}>Request to borrow</button>)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestForm({ toolId, onDone }: { toolId: Id<"tools">; onDone: () => void }) {
  const request = useMutation(api.loans.request);
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const { error, busy, run } = useRun();
  return (
    <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await request({ toolId, startDate: start, endDate: end }); onDone(); }); }}>
      <div className="flex gap-2">
        <label className="flex-1 text-xs text-stone-600">From<input type="date" className="input" min={today} value={start} onChange={(e) => setStart(e.target.value)} required /></label>
        <label className="flex-1 text-xs text-stone-600">To<input type="date" className="input" min={start} value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>Send request</button>
        <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function ToolForm({ initial, onSave, onCancel }: {
  initial?: { name: string; category: Cat; condition: Cond; description: string };
  onSave: (v: { name: string; category: Cat; condition: Cond; description: string }) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(initial ?? { name: "", category: "power_tools" as Cat, condition: "good" as Cond, description: "" });
  const { error, busy, run } = useRun();
  return (
    <form className="card space-y-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await onSave(v); if (!initial) setV({ name: "", category: "power_tools", condition: "good", description: "" }); onCancel?.(); }); }}>
      <input className="input" placeholder="Tool name, e.g. Cordless drill" maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
      <div className="flex gap-2">
        <select className="input" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as Cat })}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <select className="input" value={v.condition} onChange={(e) => setV({ ...v, condition: e.target.value as Cond })}>
          {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
        </select>
      </div>
      <textarea className="input" placeholder="Short description (optional)" maxLength={500} rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{initial ? "Save" : "List tool"}</button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function MyListings() {
  const tools = useQuery(api.tools.mine);
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);
  const [editing, setEditing] = useState<Id<"tools"> | null>(null);
  const { error, run } = useRun();
  return (
    <section className="grid gap-6 md:grid-cols-[1fr_1.4fr]">
      <div>
        <h2 className="mb-2 font-semibold">List a tool</h2>
        <ToolForm onSave={(v) => create(v)} />
      </div>
      <div>
        <h2 className="mb-2 font-semibold">Your listings</h2>
        {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
        {tools === undefined ? <p className="text-stone-500">Loading…</p> : tools.length === 0 ? <p className="text-stone-500">You haven&apos;t listed anything yet.</p> : (
          <ul className="space-y-3">
            {tools.map((t) => editing === t._id ? (
              <li key={t._id}><ToolForm initial={t} onSave={(v) => update({ toolId: t._id, ...v })} onCancel={() => setEditing(null)} /></li>
            ) : (
              <li key={t._id} className="card flex items-center justify-between gap-2">
                <div><p className="font-medium">{t.name}</p><p className="text-sm text-stone-500">{CATEGORY_LABEL[t.category]} · {CONDITION_LABEL[t.condition]}</p></div>
                <div className="flex gap-2">
                  <button className="btn-ghost" onClick={() => setEditing(t._id)}>Edit</button>
                  <button className="btn-danger" onClick={() => { if (confirm(`Remove "${t.name}"?`)) void run(() => remove({ toolId: t._id })); }}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Activity({ a }: { a: { kind: string; status: string; at: number } | null }) {
  if (!a) return null;
  const what = a.kind === "overdue_reminder" ? "Reminder" : "Notification";
  const verb = a.status === "sent" ? "sent" : a.status === "pending" ? "queued" : "failed, retrying";
  return <p className="mt-1 text-xs text-stone-500">{what} {verb} {timeAgo(a.at)}</p>;
}

function LoanList({ kind }: { kind: "incoming" | "requests" }) {
  const loans = useQuery(kind === "incoming" ? api.loans.incoming : api.loans.myRequests);
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const cancel = useMutation(api.loans.cancel);
  const markReturned = useMutation(api.loans.markReturned);
  const { error, busy, run } = useRun();
  const who = kind === "incoming" ? "Borrower" : "Lender";
  return (
    <section>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {loans === undefined ? <p className="text-stone-500">Loading…</p> : loans.length === 0 ? (
        <p className="text-stone-500">{kind === "incoming" ? "No requests for your tools yet." : "You haven't requested anything yet."}</p>
      ) : (
        <ul className="space-y-3">
          {loans.map((l) => (
            <li key={l._id} className="card flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{l.toolName} <span className={`badge ml-1 ${STATUS_STYLE[l.status]}`}>{l.status}</span>{l.overdue && <span className="badge ml-1 bg-red-100 text-red-800">overdue</span>}</p>
                <p className="text-sm text-stone-500">{l.startDate} → {l.endDate} · {who}: {l.counterpartName}</p>
                <Activity a={l.lastAutomation} />
              </div>
              <div className="flex gap-2">
                {kind === "incoming" && l.status === "requested" && <>
                  <button className="btn-primary" disabled={busy} onClick={() => void run(() => approve({ loanId: l._id }))}>Approve</button>
                  <button className="btn-ghost" disabled={busy} onClick={() => void run(() => decline({ loanId: l._id }))}>Decline</button>
                </>}
                {kind === "incoming" && l.status === "approved" && <button className="btn-ghost" disabled={busy} onClick={() => void run(() => markReturned({ loanId: l._id }))}>Mark returned</button>}
                {kind === "requests" && l.status === "requested" && <button className="btn-ghost" disabled={busy} onClick={() => void run(() => cancel({ loanId: l._id }))}>Cancel request</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Admin() {
  const users = useQuery(api.users.listForAdmin);
  const tools = useQuery(api.tools.browse, {});
  const loans = useQuery(api.loans.allForAdmin);
  const events = useQuery(api.automation.recentForAdmin);
  const setTrusted = useMutation(api.users.setTrustedLender);
  const remove = useMutation(api.tools.remove);
  const { error, run } = useRun();
  return (
    <section className="space-y-8">
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div>
        <h2 className="mb-2 font-semibold">Automation health</h2>
        <ul className="space-y-1 text-sm">
          {(events ?? []).map((e) => (
            <li key={e._id} className="flex gap-2">
              <span className={`badge ${e.status === "failed" ? "bg-red-100 text-red-800" : e.status === "sent" ? "bg-teal-100 text-teal-800" : "bg-amber-100 text-amber-800"}`}>{e.status}</span>
              <span>{e.kind.replace("_", " ")}</span>
              <span className="text-stone-500">{e.detail ?? ""} · {e.attempts} attempt(s) · {timeAgo(e.updatedAt)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="mb-2 font-semibold">Lenders</h2>
        <ul className="space-y-2">
          {(users ?? []).map((u) => (
            <li key={u._id} className="card flex items-center justify-between">
              <span>{u.name} <span className="text-sm text-stone-500">{u.email}</span> {u.role === "admin" && <span className="badge bg-violet-100 text-violet-800">admin</span>}</span>
              <button className={u.trustedLender ? "btn-primary" : "btn-ghost"} onClick={() => void run(() => setTrusted({ userId: u._id, trusted: !u.trustedLender }))}>
                {u.trustedLender ? "Trusted Lender ✓" : "Mark as Trusted Lender"}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="mb-2 font-semibold">All listings</h2>
        <ul className="space-y-2">
          {(tools ?? []).map((t) => (
            <li key={t._id} className="card flex items-center justify-between">
              <span>{t.name} <span className="text-sm text-stone-500">by {t.lenderFirstName}</span></span>
              <button className="btn-danger" onClick={() => { if (confirm(`Remove "${t.name}" for everyone?`)) void run(() => remove({ toolId: t._id })); }}>Remove</button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="mb-2 font-semibold">All loans</h2>
        <ul className="space-y-1 text-sm">
          {(loans ?? []).map((l) => (
            <li key={l._id}>{l.toolName} · {l.startDate} → {l.endDate} · <span className={`badge ${STATUS_STYLE[l.status]}`}>{l.status}</span>{l.overdue && <span className="badge ml-1 bg-red-100 text-red-800">overdue</span>}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
