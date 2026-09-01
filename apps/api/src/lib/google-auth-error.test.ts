import { describe, expect, it } from "vitest";
import { googleAuthErrorMessage } from "./google.js";

describe("googleAuthErrorMessage", () => {
  it("explains invalid_client as a secret mismatch", () => {
    expect(
      googleAuthErrorMessage({
        message: "invalid_client",
        response: { data: { error: "invalid_client", error_description: "Unauthorized" } },
      }),
    ).toMatch(/GOOGLE_CLIENT_SECRET/);
  });

  it("passes through Google error_description when present", () => {
    expect(
      googleAuthErrorMessage({
        message: "invalid_grant",
        response: {
          data: {
            error: "invalid_grant",
            error_description: "Bad Request",
          },
        },
      }),
    ).toBe("Bad Request");
  });
});
