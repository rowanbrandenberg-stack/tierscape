import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "./stripe";

describe("Stripe webhook signatures", () => {
  const secret = "whsec_test";
  const body = '{"id":"evt_1"}';
  const sign = (t: number, b = body) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${b}`).digest("hex")}`;
  it("accepts a fresh, correct signature", () => {
    expect(verifyStripeSignature(body, sign(1000), secret, 1000)).toBe(true);
  });
  it("rejects tampered bodies, wrong secrets, old timestamps and missing headers", () => {
    expect(verifyStripeSignature('{"id":"evt_2"}', sign(1000), secret, 1000)).toBe(false);
    expect(verifyStripeSignature(body, sign(1000), "whsec_other", 1000)).toBe(false);
    expect(verifyStripeSignature(body, sign(1000), secret, 1000 + 301)).toBe(false);
    expect(verifyStripeSignature(body, null, secret, 1000)).toBe(false);
  });
});
