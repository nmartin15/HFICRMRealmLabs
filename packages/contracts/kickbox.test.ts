import { describe, expect, it } from "vitest";
import {
  kickboxBlocksSend,
  shouldVerifyFormIntakeEmail,
} from "./kickbox";

describe("kickbox form-intake scope", () => {
  it("verifies only new form contacts that are not already verified", () => {
    expect(
      shouldVerifyFormIntakeEmail({ isNewPerson: true, alreadyVerified: false }),
    ).toBe(true);
    expect(
      shouldVerifyFormIntakeEmail({ isNewPerson: true, alreadyVerified: true }),
    ).toBe(false);
    expect(
      shouldVerifyFormIntakeEmail({
        isNewPerson: false,
        alreadyVerified: false,
      }),
    ).toBe(false);
  });

  it("blocks send only for undeliverable results", () => {
    expect(kickboxBlocksSend("undeliverable")).toBe(true);
    expect(kickboxBlocksSend("deliverable")).toBe(false);
    expect(kickboxBlocksSend("risky")).toBe(false);
    expect(kickboxBlocksSend(null)).toBe(false);
  });
});
