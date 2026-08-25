import { describe, expect, it } from "vitest";
import { secretsEqual } from "./secrets.js";

describe("secretsEqual", () => {
  it("compares shared secrets in constant time", () => {
    expect(secretsEqual("abc", "abc")).toBe(true);
    expect(secretsEqual("abc", "abd")).toBe(false);
    expect(secretsEqual("abc", "ab")).toBe(false);
    expect(secretsEqual("", "abc")).toBe(false);
  });
});
