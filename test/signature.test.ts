import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { safeEqual, sign, signedMessage, verify } from "../convex/lib/signature";

const secret = "x".repeat(64);
const now = 1_793_700_000;

describe("HMAC signing", () => {
  it("matches Node's crypto (what the n8n Code nodes use)", async () => {
    const msg = signedMessage(String(now), "post", "/webhook/lendloop", '{"a":1}');
    expect(msg).toBe(`${now}.POST /webhook/lendloop.{"a":1}`);
    expect(await sign(secret, msg)).toBe(createHmac("sha256", secret).update(msg).digest("hex"));
  });

  it("accepts a fresh, correct signature", async () => {
    const sig = await sign(secret, signedMessage(String(now), "GET", "/n8n/overdue-loans", ""));
    expect(await verify({ secret, signature: sig, timestamp: String(now), method: "GET", path: "/n8n/overdue-loans", body: "", nowSeconds: now + 10 })).toEqual({ ok: true });
  });

  it("rejects a signature replayed against another endpoint", async () => {
    const sig = await sign(secret, signedMessage(String(now), "GET", "/n8n/overdue-loans", ""));
    const r = await verify({ secret, signature: sig, timestamp: String(now), method: "POST", path: "/n8n/reminder-result", body: "", nowSeconds: now });
    expect(r.ok).toBe(false);
  });

  it("rejects stale timestamps and tampered bodies", async () => {
    const sig = await sign(secret, signedMessage(String(now), "POST", "/p", "a"));
    expect((await verify({ secret, signature: sig, timestamp: String(now), method: "POST", path: "/p", body: "a", nowSeconds: now + 301 })).ok).toBe(false);
    expect((await verify({ secret, signature: sig, timestamp: String(now), method: "POST", path: "/p", body: "b", nowSeconds: now })).ok).toBe(false);
  });

  it("refuses to run with a missing or weak secret", async () => {
    expect((await verify({ secret: "short", signature: "00", timestamp: String(now), method: "GET", path: "/", body: "", nowSeconds: now })).ok).toBe(false);
  });

  it("compares in constant time", () => {
    expect(safeEqual("abcd", "abcd")).toBe(true);
    expect(safeEqual("abcd", "abce")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
