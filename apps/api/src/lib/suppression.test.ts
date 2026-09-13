import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "@realm-labs/db";
import { canonicalEmail } from "@realm-labs/contracts";
import { emailSuppressionHash } from "./suppression.js";

const KEY = "ab".repeat(32);

describe("emailSuppressionHash", () => {
  it("hashes canonicalEmail so plus aliases collide", () => {
    expect(emailSuppressionHash("Jane+Jobs@Example.COM", KEY)).toBe(
      hmacSha256Hex(KEY, canonicalEmail("jane@example.com")),
    );
    expect(emailSuppressionHash("jane+jobs@example.com", KEY)).toBe(
      emailSuppressionHash("jane@example.com", KEY),
    );
    expect(emailSuppressionHash("other@example.com", KEY)).not.toBe(
      emailSuppressionHash("jane@example.com", KEY),
    );
  });
});
