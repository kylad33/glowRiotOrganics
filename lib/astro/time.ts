/**
 * Local civil time -> UTC -> Julian Day.
 *
 * This is the layer that most astrology software gets quietly wrong, so it is
 * deliberately explicit: every resolution reports which offset it used, where
 * that offset came from, and what it is uncertain about. The UI is expected to
 * surface `warnings` rather than present a possibly-wrong chart as fact.
 */

import { DateTime } from "luxon";

/** Days between the Unix epoch (1970-01-01T00:00Z) and JD 0. */
const JD_UNIX_EPOCH = 2440587.5;
const MS_PER_DAY = 86_400_000;

export type TimeWarning =
  | "time-unknown"
  | "pre-1970-tzdata"
  | "dst-ambiguous"
  | "dst-nonexistent"
  | "offset-overridden";

export interface BirthInput {
  year: number;
  /** 1-12, calendar convention. */
  month: number;
  day: number;
  /** 0-23. Ignored when `timeKnown` is false. */
  hour: number;
  minute: number;
  latitude: number;
  longitude: number;
  /**
   * IANA zone, e.g. "America/New_York". When omitted the caller is expected to
   * have resolved it from lat/lon via `lib/astro/geo.ts`.
   */
  zone?: string;
  /**
   * Explicit UTC offset in minutes, east-positive. Wins over `zone` when set.
   * This exists because IANA tzdata is not a reliable record of local civil
   * timekeeping before 1970, and because some birth records state their offset.
   */
  utcOffsetMinutes?: number;
  /**
   * False when the birth time is unknown. Houses, Ascendant and MC are not
   * meaningful in that case and downstream code must suppress them.
   */
  timeKnown: boolean;
}

export interface ResolvedTime {
  /** The authoritative instant. */
  utc: Date;
  /** Julian Day number (UT). */
  julianDay: number;
  /** Offset actually applied, minutes east of UTC. */
  offsetMinutes: number;
  zone: string | null;
  offsetSource: "override" | "iana";
  warnings: TimeWarning[];
  /** Mirrors the input, so downstream code cannot lose track of it. */
  timeKnown: boolean;
}

export function julianDayFromUtc(utc: Date): number {
  return utc.getTime() / MS_PER_DAY + JD_UNIX_EPOCH;
}

export function utcFromJulianDay(jd: number): Date {
  return new Date((jd - JD_UNIX_EPOCH) * MS_PER_DAY);
}

/**
 * Classifies a wall-clock reading against a zone's DST rules.
 *
 * - `nonexistent`: the clock skipped this time (spring forward).
 * - `ambiguous`: the clock passed through it twice (fall back).
 */
export function classifyLocalTime(
  fields: { year: number; month: number; day: number; hour: number; minute: number },
  zone: string,
): "unique" | "ambiguous" | "nonexistent" | "invalid-zone" {
  const dt = DateTime.fromObject(fields, { zone });
  if (!dt.isValid) return "invalid-zone";

  // Luxon maps a nonexistent local time forward past the gap, so a field
  // round-trip mismatch is exactly the spring-forward case.
  const roundTrips =
    dt.year === fields.year &&
    dt.month === fields.month &&
    dt.day === fields.day &&
    dt.hour === fields.hour &&
    dt.minute === fields.minute;
  if (!roundTrips) return "nonexistent";

  // If the same wall clock also exists an hour later in absolute time, the
  // reading occurred twice and Luxon silently picked the first.
  const alt = DateTime.fromMillis(dt.toMillis() + 3_600_000, { zone });
  const repeats =
    alt.year === fields.year &&
    alt.month === fields.month &&
    alt.day === fields.day &&
    alt.hour === fields.hour &&
    alt.minute === fields.minute;

  return repeats ? "ambiguous" : "unique";
}

export function resolveBirthTime(input: BirthInput): ResolvedTime {
  const warnings: TimeWarning[] = [];

  // An unknown birth time is charted at 12:00 local purely so the slow bodies
  // land in the right sign. Callers MUST suppress houses and angles; the
  // warning is the contract that tells them to.
  const hour = input.timeKnown ? input.hour : 12;
  const minute = input.timeKnown ? input.minute : 0;
  if (!input.timeKnown) warnings.push("time-unknown");

  const fields = {
    year: input.year,
    month: input.month,
    day: input.day,
    hour,
    minute,
  };

  let utc: Date;
  let offsetMinutes: number;
  let offsetSource: "override" | "iana";
  const zone = input.zone ?? null;

  if (input.utcOffsetMinutes !== undefined) {
    offsetMinutes = input.utcOffsetMinutes;
    offsetSource = "override";
    warnings.push("offset-overridden");
    utc = new Date(
      Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute) -
        offsetMinutes * 60_000,
    );
  } else {
    if (!zone) {
      throw new Error(
        "resolveBirthTime: either `zone` or `utcOffsetMinutes` must be provided. " +
          "Resolve the zone from coordinates with lib/astro/geo.ts first.",
      );
    }

    const classification = classifyLocalTime(fields, zone);
    if (classification === "invalid-zone") {
      throw new Error(`resolveBirthTime: unknown IANA zone "${zone}".`);
    }
    if (classification === "ambiguous") warnings.push("dst-ambiguous");
    if (classification === "nonexistent") warnings.push("dst-nonexistent");

    const dt = DateTime.fromObject(fields, { zone });
    utc = dt.toJSDate();
    offsetMinutes = dt.offset;
    offsetSource = "iana";

    // IANA tzdata records legal time reasonably well back to 1970 and only
    // approximately before it; many pre-1970 entries are Local Mean Time
    // placeholders. Professional software licenses the ACS Atlas for this.
    if (input.year < 1970) warnings.push("pre-1970-tzdata");
  }

  return {
    utc,
    julianDay: julianDayFromUtc(utc),
    offsetMinutes,
    zone,
    offsetSource,
    warnings,
    timeKnown: input.timeKnown,
  };
}

/** Formats an offset in minutes as "+05:30" / "-05:00", for display. */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60).toString().padStart(2, "0");
  const m = (abs % 60).toString().padStart(2, "0");
  return `${sign}${h}:${m}`;
}
