"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABEL } from "./labels";

/** Signed-out view: only name and category, straight from Convex's publicList. */
export function PublicTools() {
  const tools = useQuery(api.tools.publicList, {});
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Available now</h2>
      {tools === undefined ? (
        <p className="text-stone-500">Loading…</p>
      ) : tools.length === 0 ? (
        <p className="text-stone-500">Nothing listed yet. Be the first to lend something.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tools.map((t) => (
            <li key={t._id} className="card flex items-center justify-between">
              <span className="font-medium">{t.name}</span>
              <span className="badge bg-stone-100 text-stone-700">{CATEGORY_LABEL[t.category]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
