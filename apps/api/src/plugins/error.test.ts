import { describe, expect, it } from "vitest";
import { clientErrorPayload, httpError } from "./error.js";

describe("clientErrorPayload", () => {
  it("does not leak a drizzle query dump to the client", () => {
    const err = new Error(
      'Failed query: select "people"."stay_in_touch_opted_out" from "people"\nparams: false: column people.stay_in_touch_opted_out does not exist',
    );
    expect(clientErrorPayload(err, 500)).toEqual({
      code: "INTERNAL",
      message: "Unexpected error",
    });
  });

  it("keeps planned httpError messages", () => {
    const err = httpError(
      409,
      "EMAIL_EXISTS",
      "A contact with this email already exists",
    );
    expect(clientErrorPayload(err, 409)).toEqual({
      code: "EMAIL_EXISTS",
      message: "A contact with this email already exists",
    });
  });

  it("keeps an explicit 500 from httpError", () => {
    const err = httpError(500, "INTERNAL", "Failed to create person");
    expect(clientErrorPayload(err, 500)).toEqual({
      code: "INTERNAL",
      message: "Failed to create person",
    });
  });
});
