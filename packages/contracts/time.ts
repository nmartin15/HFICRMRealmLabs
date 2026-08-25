export const DISPLAY_TIME_ZONE = "America/Los_Angeles";

export type CalendarYmd = {
  year: number;
  month: number;
  day: number;
};

function partNumber(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  return Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
}

export function zonedYmd(date: Date, timeZone: string): CalendarYmd {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    year: partNumber(parts, "year"),
    month: partNumber(parts, "month"),
    day: partNumber(parts, "day"),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const asUtc = Date.UTC(
    partNumber(parts, "year"),
    partNumber(parts, "month") - 1,
    partNumber(parts, "day"),
    partNumber(parts, "hour"),
    partNumber(parts, "minute"),
    partNumber(parts, "second"),
  );
  return asUtc - date.getTime();
}

export function zonedLocalToUtc(
  ymd: CalendarYmd,
  timeZone: string,
  hours = 0,
  minutes = 0,
  seconds = 0,
): Date {
  const utcGuess = Date.UTC(
    ymd.year,
    ymd.month - 1,
    ymd.day,
    hours,
    minutes,
    seconds,
  );
  const first = new Date(utcGuess - timeZoneOffsetMs(new Date(utcGuess), timeZone));
  return new Date(utcGuess - timeZoneOffsetMs(first, timeZone));
}

function addCalendarDays(ymd: CalendarYmd, days: number): CalendarYmd {
  const utc = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

export function zonedDayBoundsUtc(
  ymd: CalendarYmd,
  timeZone: string,
): { start: Date; end: Date } {
  const start = zonedLocalToUtc(ymd, timeZone);
  const end = zonedLocalToUtc(addCalendarDays(ymd, 1), timeZone);
  return { start, end };
}

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function zonedIsoDate(
  now: Date,
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  const ymd = zonedYmd(now, timeZone);
  return `${ymd.year}-${pad2(ymd.month)}-${pad2(ymd.day)}`;
}

/** Today in `timeZone` (default America/Los_Angeles), as UTC bounds. */
export function todayBoundsUtc(
  now: Date,
  timeZone: string = DISPLAY_TIME_ZONE,
): { start: Date; end: Date } {
  return zonedDayBoundsUtc(zonedYmd(now, timeZone), timeZone);
}

/** Yesterday in `timeZone` (default America/Los_Angeles), as UTC bounds. */
export function yesterdayBoundsUtc(
  now: Date,
  timeZone: string = DISPLAY_TIME_ZONE,
): { start: Date; end: Date } {
  const today = zonedYmd(now, timeZone);
  return zonedDayBoundsUtc(addCalendarDays(today, -1), timeZone);
}
