import { describe, expect, it } from "vitest";
import {
  DISPLAY_TIME_ZONE,
  isWithinUtcBounds,
  todayBoundsUtc,
  yesterdayBoundsUtc,
  zonedDatetimeLocalToUtc,
  zonedIsoDate,
  zonedYmd,
} from "./time";

describe("yesterday bounds in America/Los_Angeles", () => {
  it("uses Pacific time, not UTC calendar date", () => {
    // 2026-08-24 17:30 PDT = 2026-08-25 00:30 UTC
    const now = new Date("2026-08-25T00:30:00.000Z");
    expect(zonedYmd(now, DISPLAY_TIME_ZONE)).toEqual({
      year: 2026,
      month: 8,
      day: 24,
    });

    const { start, end } = yesterdayBoundsUtc(now);
    // 2026-08-23 00:00 PDT = 07:00 UTC during PDT
    expect(start.toISOString()).toBe("2026-08-23T07:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-24T07:00:00.000Z");
  });

  it("uses Pacific calendar date for today bounds", () => {
    const now = new Date("2026-08-25T00:30:00.000Z");
    expect(zonedIsoDate(now)).toBe("2026-08-24");
    const { start, end } = todayBoundsUtc(now);
    expect(start.toISOString()).toBe("2026-08-24T07:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-25T07:00:00.000Z");
    expect(
      isWithinUtcBounds(new Date("2026-08-24T16:00:00.000Z"), { start, end }),
    ).toBe(true);
    expect(
      isWithinUtcBounds(new Date("2026-08-24T06:59:59.000Z"), { start, end }),
    ).toBe(false);
  });
});

describe("zonedDatetimeLocalToUtc", () => {
  it("treats datetime-local as America/Los_Angeles, not the host offset", () => {
    expect(zonedDatetimeLocalToUtc("2026-08-24T09:00").toISOString()).toBe(
      "2026-08-24T16:00:00.000Z",
    );
    expect(zonedDatetimeLocalToUtc("2026-01-15T09:00").toISOString()).toBe(
      "2026-01-15T17:00:00.000Z",
    );
  });

  it("rejects values the datetime-local input cannot produce", () => {
    expect(() => zonedDatetimeLocalToUtc("2026-08-24 09:00")).toThrow(
      "Invalid datetime-local value",
    );
  });
});
