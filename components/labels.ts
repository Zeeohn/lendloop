export const CATEGORY_LABEL: Record<string, string> = {
  power_tools: "Power tools", hand_tools: "Hand tools", garden: "Garden", kitchen: "Kitchen",
  camping: "Camping", cleaning: "Cleaning", other: "Other",
};
export const CONDITION_LABEL: Record<string, string> = { new: "New", good: "Good", fair: "Fair", worn: "Worn" };
export const STATUS_STYLE: Record<string, string> = {
  requested: "bg-amber-100 text-amber-800", approved: "bg-teal-100 text-teal-800", declined: "bg-stone-200 text-stone-700",
  cancelled: "bg-stone-200 text-stone-700", returned: "bg-sky-100 text-sky-800",
};

/** Human message from a Convex error (ConvexError carries a string in `data`). */
export function errorText(e: unknown): string {
  const data = (e as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return "Something went wrong. Please try again.";
}

export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24); return `${d} day${d === 1 ? "" : "s"} ago`;
}
