import { describe, it, expect } from "vitest";
import {
  classifyLocalTime,
  formatOffset,
  julianDayFromUtc,
  resolveBirthTime,
  utcFromJulianDay,
  type BirthInput,
} from "@/lib/astro/time";

function input(overrides: Partial<BirthInput> = {}): BirthInput {
  return {
    year: 1990,
    month: 6,
    day: 15,
    hour: 14,
    minute: 30,
    latitude: 40.7128,
    longitude: -74.006,
    zone: "America/New_York",
    timeKnown: true,
    ...overrides,
  };
}

describe("Julian Day", () => {
  it("matches the J2000.0 epoch", () => {
    // JD 2451545.0 is 2000-01-01T12:00:00Z by definition.
    expect(julianDayFromUtc(new Date("2000-01-01T12:00:00Z"))).toBeCloseTo(2451545.0, 9);
  });

  it("matches the Unix epoch", () => {
    expect(julianDayFromUtc(new Date("1970-01-01T00:00:00Z"))).toBeCloseTo(2440587.5, 9);
  });

  it("round-trips", () => {
    const d = new Date("1985-07-04T23:45:17Z");
    expect(utcFromJulianDay(julianDayFromUtc(d)).toISOString()).toBe(d.toISOString());
  });

  it("advances by exactly one per day", () => {
    const a = julianDayFromUtc(new Date("2000-01-01T00:00:00Z"));
    const b = julianDayFromUtc(new Date("2000-01-02T00:00:00Z"));
    expect(b - a).toBeCloseTo(1, 12);
  });
});

describe("classifyLocalTime", () => {
  it("flags a time the clock skipped over", () => {
    // US spring-forward 2024: 02:00 -> 03:00, so 02:30 never happened.
    expect(
      classifyLocalTime(
        { year: 2024, month: 3, day: 10, hour: 2, minute: 30 },
        "America/New_York",
      ),
    ).toBe("nonexistent");
  });

  it("flags a time the clock passed through twice", () => {
    // US fall-back 2024: 02:00 -> 01:00, so 01:30 occurred twice.
    expect(
      classifyLocalTime(
        { year: 2024, month: 11, day: 3, hour: 1, minute: 30 },
        "America/New_York",
      ),
    ).toBe("ambiguous");
  });

  it("accepts an ordinary time", () => {
    expect(
      classifyLocalTime(
        { year: 2024, month: 6, day: 15, hour: 14, minute: 30 },
        "America/New_York",
      ),
    ).toBe("unique");
  });

  it("rejects an unknown zone", () => {
    expect(
      classifyLocalTime(
        { year: 2024, month: 6, day: 15, hour: 14, minute: 30 },
        "Mars/Olympus_Mons",
      ),
    ).toBe("invalid-zone");
  });
});

describe("resolveBirthTime", () => {
  it("converts a summer New York birth using EDT", () => {
    const r = resolveBirthTime(input());
    expect(r.offsetMinutes).toBe(-240);
    expect(r.utc.toISOString()).toBe("1990-06-15T18:30:00.000Z");
    expect(r.offsetSource).toBe("iana");
  });

  it("converts a winter New York birth using EST", () => {
    const r = resolveBirthTime(input({ month: 1, day: 15 }));
    expect(r.offsetMinutes).toBe(-300);
    expect(r.utc.toISOString()).toBe("1990-01-15T19:30:00.000Z");
  });

  it("honours a half-hour zone", () => {
    const r = resolveBirthTime(
      input({ zone: "Asia/Kolkata", latitude: 22.5726, longitude: 88.3639 }),
    );
    expect(r.offsetMinutes).toBe(330);
  });

  it("honours a 45-minute zone", () => {
    const r = resolveBirthTime(
      input({ zone: "Asia/Kathmandu", latitude: 27.7172, longitude: 85.324 }),
    );
    expect(r.offsetMinutes).toBe(345);
  });

  it("lets an explicit offset override the zone", () => {
    const r = resolveBirthTime(input({ utcOffsetMinutes: -300 }));
    expect(r.offsetSource).toBe("override");
    expect(r.offsetMinutes).toBe(-300);
    expect(r.utc.toISOString()).toBe("1990-06-15T19:30:00.000Z");
    expect(r.warnings).toContain("offset-overridden");
  });

  it("warns that pre-1970 tzdata is approximate", () => {
    const r = resolveBirthTime(input({ year: 1952 }));
    expect(r.warnings).toContain("pre-1970-tzdata");
  });

  it("does not warn about tzdata for modern births", () => {
    expect(resolveBirthTime(input()).warnings).not.toContain("pre-1970-tzdata");
  });

  it("warns on an ambiguous local time", () => {
    const r = resolveBirthTime(
      input({ year: 2024, month: 11, day: 3, hour: 1, minute: 30 }),
    );
    expect(r.warnings).toContain("dst-ambiguous");
  });

  it("warns on a local time that never occurred", () => {
    const r = resolveBirthTime(
      input({ year: 2024, month: 3, day: 10, hour: 2, minute: 30 }),
    );
    expect(r.warnings).toContain("dst-nonexistent");
  });

  it("charts an unknown birth time at noon and says so", () => {
    const r = resolveBirthTime(input({ timeKnown: false, hour: 3, minute: 17 }));
    expect(r.warnings).toContain("time-unknown");
    expect(r.timeKnown).toBe(false);
    // Noon local, not the supplied hour.
    expect(r.utc.toISOString()).toBe("1990-06-15T16:00:00.000Z");
  });

  it("refuses to guess when neither zone nor offset is given", () => {
    expect(() => resolveBirthTime(input({ zone: undefined }))).toThrow(/zone/);
  });

  it("rejects an unknown zone rather than falling back silently", () => {
    expect(() => resolveBirthTime(input({ zone: "Nowhere/Nothing" }))).toThrow();
  });
});

describe("formatOffset", () => {
  it.each([
    [0, "+00:00"],
    [-300, "-05:00"],
    [330, "+05:30"],
    [345, "+05:45"],
    [-570, "-09:30"],
  ])("formats %i as %s", (minutes, expected) => {
    expect(formatOffset(minutes)).toBe(expected);
  });
});
