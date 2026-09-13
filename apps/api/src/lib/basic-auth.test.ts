import { describe, expect, it } from "vitest";
import { basicAuthMatches, parseBasicAuth } from "./basic-auth.js";

describe("basic auth", () => {
  it("accepts matching credentials", () => {
    const header = `Basic ${Buffer.from("hook:secret").toString("base64")}`;
    expect(parseBasicAuth(header)).toEqual({ user: "hook", password: "secret" });
    expect(basicAuthMatches(header, "hook", "secret")).toBe(true);
    expect(basicAuthMatches(header, "hook", "nope")).toBe(false);
    expect(basicAuthMatches(undefined, "hook", "secret")).toBe(false);
  });
});
