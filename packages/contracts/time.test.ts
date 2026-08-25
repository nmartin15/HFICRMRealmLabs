import { describe, expect, it } from "vitest";
import {
  DISPLAY_TIME_ZONE,
  todayBoundsUtc,
  yesterdayBoundsUtc,
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
  });
});
