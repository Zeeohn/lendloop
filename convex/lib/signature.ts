// HMAC-SHA256 request signing shared by Convex (sender and receiver) and
// mirrored in the n8n Code nodes. Signed message: `${timestamp}.${method} ${path}.${body}`.
// Binding the method and path stops a signature for one endpoint being replayed
// against another; the timestamp window stops old requests being replayed later.

export const SIGNATURE_HEADER = "x-lendloop-signature";
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const TOLERANCE_SECONDS = 300;

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function signedMessage(timestamp: string, method: string, path: string, body: string): string {
  return `${timestamp}.${method.toUpperCase()} ${path}.${body}`;
}

export async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Constant-time comparison of two hex strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type VerifyInput = {
  secret: string | undefined;
  signature: string | null;
  timestamp: string | null;
  method: string;
  path: string;
  body: string;
  nowSeconds?: number;
};

export async function verify(input: VerifyInput): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { secret, signature, timestamp, method, path, body } = input;
  if (!secret || secret.length < 32) return { ok: false, reason: "server secret not configured" };
  if (!signature || !timestamp) return { ok: false, reason: "missing signature headers" };
  if (!/^\d{10}$/.test(timestamp)) return { ok: false, reason: "bad timestamp" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > TOLERANCE_SECONDS) return { ok: false, reason: "timestamp outside window" };
  const expected = await sign(secret, signedMessage(timestamp, method, path, body));
  return safeEqual(expected, signature.toLowerCase()) ? { ok: true } : { ok: false, reason: "bad signature" };
}
