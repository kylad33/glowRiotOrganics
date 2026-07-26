import { describe, it, expect } from "vitest";
import {
  moshierEngine,
  originForUtc,
  angularDelta,
  normalizeDegrees,
} from "@/lib/astro/ephemeris/moshier";
import type { EphemerisRequest } from "@/lib/astro/ephemeris/types";
import type { BodyId } from "@/lib/astro/types";

const GREENWICH = { latitude: 51.4779, longitude: 0 };

function request(utc: Date, overrides: Partial<EphemerisRequest> = {}): EphemerisRequest {
  return {
    utc,
    latitude: GREENWICH.latitude,
    longitude: GREENWICH.longitude,
    houseSystem: "placidus",
    zodiac: "tropical",
    ...overrides,
  };
}

function sunLongitude(utc: Date): number {
  const result = moshierEngine.compute(request(utc));
  const sun = result.bodies.find((b) => b.id === "sun");
  if (!sun) throw new Error("no sun in result");
  return sun.longitude;
}

describe("angle helpers", () => {
  it("normalises into [0, 360)", () => {
    expect(normalizeDegrees(370)).toBeCloseTo(10, 10);
    expect(normalizeDegrees(-10)).toBeCloseTo(350, 10);
    expect(normalizeDegrees(0)).toBe(0);
  });

  it("wraps signed deltas across 0/360", () => {
    expect(angularDelta(350, 10)).toBeCloseTo(20, 10);
    expect(angularDelta(10, 350)).toBeCloseTo(-20, 10);
    expect(angularDelta(0, 180)).toBeCloseTo(180, 10);
  });
});

describe("originForUtc back-solve", () => {
  // The library derives its own zone from lat/lon, so this inversion is the
  // only thing keeping our authoritative instant intact. If it regresses,
  // every chart silently shifts by the local UTC offset.
  const locations: Array<[string, number, number]> = [
    ["Greenwich", 51.4779, 0],
    ["New York", 40.7128, -74.006],
    ["Tokyo", 35.6762, 139.6503],
    ["Sydney", -33.8688, 151.2093],
    ["Kolkata", 22.5726, 88.3639], // half-hour offset
    ["Kathmandu", 27.7172, 85.324], // 45-minute offset
    ["Reykjavik", 64.1466, -21.9426],
  ];

  const instants = [
    new Date("2000-01-01T12:00:00Z"),
    new Date("1985-07-04T23:45:00Z"),
    new Date("1969-12-31T00:30:00Z"),
    new Date("2024-03-10T07:00:00Z"), // US spring-forward morning
    new Date("2024-11-03T06:00:00Z"), // US fall-back morning
  ];

  for (const [name, latitude, longitude] of locations) {
    for (const utc of instants) {
      it(`recovers ${utc.toISOString()} at ${name}`, () => {
        const { origin, residualMs } = originForUtc(utc, latitude, longitude);
        expect(Math.abs(residualMs)).toBeLessThan(500);
        // Julian Day must match the target instant independently of the
        // library's timezone handling.
        const expectedJd = utc.getTime() / 86_400_000 + 2440587.5;
        expect(origin.julianDate).toBeCloseTo(expectedJd, 4);
      });
    }
  }
});

describe("DST fall-back hole", () => {
  // 2024-11-03T06:00Z is inside New York's repeated hour. The wall clock
  // 01:00 EST maps there, but the library resolves that reading to the first
  // (EDT) occurrence, so the instant is unreachable by direct inversion.
  const utc = new Date("2024-11-03T06:00:00Z");
  const NY = { latitude: 40.7128, longitude: -74.006 };

  it("still reaches the instant, via a probe longitude", () => {
    const solved = originForUtc(utc, NY.latitude, NY.longitude);
    expect(Math.abs(solved.residualMs)).toBeLessThan(500);
    expect(solved.lstCorrectionDeg).not.toBe(0);
  });

  it("lands on the correct Julian Day", () => {
    const solved = originForUtc(utc, NY.latitude, NY.longitude);
    const expectedJd = utc.getTime() / 86_400_000 + 2440587.5;
    expect(solved.origin.julianDate).toBeCloseTo(expectedJd, 6);
  });

  // The correction the escape hatch applies rests on LST = GMST(UTC) +
  // longitude. Verify that identity through the public API at an instant
  // where both longitudes resolve directly, so the fallback's arithmetic is
  // proven rather than assumed.
  it("preserves the LST/longitude identity used to correct the probe", () => {
    const clean = new Date("1990-06-15T18:30:00Z");
    const here = originForUtc(clean, NY.latitude, NY.longitude);
    const shifted = originForUtc(clean, NY.latitude, NY.longitude + 90);
    expect(here.lstCorrectionDeg).toBe(0);
    expect(shifted.lstCorrectionDeg).toBe(0);

    const corrected = normalizeDegrees(shifted.origin.localSiderealTime - 90);
    expect(
      Math.abs(angularDelta(corrected, here.origin.localSiderealTime)),
    ).toBeLessThan(1e-6);
  });

  it("produces a chart rather than throwing", () => {
    const result = moshierEngine.compute(request(utc, NY));
    expect(result.bodies.length).toBeGreaterThan(5);
    expect(result.houses.cusps).toHaveLength(12);
  });
});

describe("solar longitude at equinoxes and solstices", () => {
  // These are physical definitions, not values read back from this library:
  // at the instant of each event the Sun's apparent ecliptic longitude is
  // exactly 0/90/180/270 degrees. Published event times are quoted to the
  // minute, and the Sun moves ~0.0007 deg/min, so a 0.05 deg tolerance is
  // dominated by the quoted precision rather than by ephemeris error.
  const events: Array<[string, string, number]> = [
    ["2000 March equinox", "2000-03-20T07:35:00Z", 0],
    ["2000 June solstice", "2000-06-21T01:48:00Z", 90],
    ["2000 September equinox", "2000-09-22T17:27:00Z", 180],
    ["2000 December solstice", "2000-12-21T13:37:00Z", 270],
    ["2020 March equinox", "2020-03-20T03:50:00Z", 0],
    ["2020 June solstice", "2020-06-20T21:43:00Z", 90],
  ];

  for (const [label, iso, expected] of events) {
    it(`${label}: Sun at ${expected} deg`, () => {
      const actual = sunLongitude(new Date(iso));
      expect(Math.abs(angularDelta(expected, actual))).toBeLessThan(0.05);
    });
  }
});

describe("body positions", () => {
  const result = moshierEngine.compute(request(new Date("2000-01-01T12:00:00Z")));

  it("returns the ten interpreted bodies plus points", () => {
    const ids = new Set(result.bodies.map((b) => b.id));
    for (const id of [
      "sun",
      "moon",
      "mercury",
      "venus",
      "mars",
      "jupiter",
      "saturn",
      "uranus",
      "neptune",
      "pluto",
    ] as BodyId[]) {
      expect(ids.has(id)).toBe(true);
    }
    expect(ids.has("northnode")).toBe(true);
  });

  it("excludes the fixed star Sirius, which the library bundles with bodies", () => {
    expect(result.bodies.some((b) => (b.id as string) === "sirius")).toBe(false);
  });

  it("keeps every longitude in [0, 360)", () => {
    for (const b of result.bodies) {
      expect(b.longitude).toBeGreaterThanOrEqual(0);
      expect(b.longitude).toBeLessThan(360);
    }
  });

  // Ecliptic latitude is bounded by each body's orbital inclination. This is
  // the check that catches the heliocentric/geocentric mix-up in the library's
  // `polar` field, which would put Pluto tens of degrees off.
  const maxLatitude: Partial<Record<BodyId, number>> = {
    sun: 0.01,
    moon: 5.3,
    mercury: 7.1,
    venus: 3.5,
    mars: 2.0,
    jupiter: 1.4,
    saturn: 2.6,
    uranus: 0.9,
    neptune: 1.9,
    pluto: 17.5,
  };

  it("keeps ecliptic latitude within each body's orbital inclination", () => {
    for (const body of result.bodies) {
      const bound = maxLatitude[body.id];
      if (bound === undefined) continue;
      expect(Math.abs(body.latitude)).toBeLessThanOrEqual(bound);
    }
  });

  it("places the lunar nodes exactly on the ecliptic", () => {
    for (const id of ["northnode", "southnode"] as BodyId[]) {
      const node = result.bodies.find((b) => b.id === id);
      if (!node) continue;
      expect(node.latitude).toBe(0);
    }
  });

  it("puts the nodes exactly 180 degrees apart", () => {
    const north = result.bodies.find((b) => b.id === "northnode");
    const south = result.bodies.find((b) => b.id === "southnode");
    if (!north || !south) throw new Error("nodes missing");
    expect(Math.abs(angularDelta(north.longitude, south.longitude))).toBeCloseTo(180, 3);
  });

  it("derives speeds with the right magnitude and sign", () => {
    const sun = result.bodies.find((b) => b.id === "sun");
    const moon = result.bodies.find((b) => b.id === "moon");
    // The Sun and Moon are never retrograde, and their daily motion is
    // tightly bounded by orbital mechanics.
    expect(sun?.speed).toBeGreaterThan(0.95);
    expect(sun?.speed).toBeLessThan(1.02);
    expect(moon?.speed).toBeGreaterThan(11.7);
    expect(moon?.speed).toBeLessThan(15.5);
  });

  it("agrees between the retrograde flag and the sign of speed", () => {
    for (const body of result.bodies) {
      if (body.retrograde === null || body.speed === null) continue;
      if (body.id === "northnode" || body.id === "southnode") continue;
      expect(body.retrograde).toBe(body.speed < 0);
    }
  });
});

describe("known retrograde periods", () => {
  // Mercury was retrograde 2000-02-21 to 2000-03-14; Saturn was retrograde
  // on 2000-01-01. Independent of this library.
  it("has Mercury retrograde on 2000-03-01", () => {
    const result = moshierEngine.compute(request(new Date("2000-03-01T12:00:00Z")));
    const mercury = result.bodies.find((b) => b.id === "mercury");
    expect(mercury?.speed).toBeLessThan(0);
  });

  it("has Mercury direct on 2000-01-01", () => {
    const result = moshierEngine.compute(request(new Date("2000-01-01T12:00:00Z")));
    const mercury = result.bodies.find((b) => b.id === "mercury");
    expect(mercury?.speed).toBeGreaterThan(0);
  });
});

describe("houses and angles", () => {
  const systems = [
    "placidus",
    "koch",
    "campanus",
    "regiomontanus",
    "topocentric",
    "whole-sign",
    "equal-house",
  ] as const;

  for (const system of systems) {
    describe(system, () => {
      const result = moshierEngine.compute(
        request(new Date("1990-06-15T14:30:00Z"), {
          latitude: 40.7128,
          longitude: -74.006,
          houseSystem: system,
        }),
      );

      it("returns twelve cusps", () => {
        expect(result.houses.cusps).toHaveLength(12);
      });

      it("starts the first house at the Ascendant", () => {
        // Whole-sign is the deliberate exception: its 1st house begins at 0
        // degrees of the sign CONTAINING the Ascendant, not at the Ascendant
        // degree itself. That case is asserted separately below.
        if (system === "whole-sign") return;
        expect(
          Math.abs(angularDelta(result.houses.cusps[0]!, result.houses.ascendant)),
        ).toBeLessThan(0.01);
      });

      it("places the Ascendant inside the first house", () => {
        const first = result.houses.cusps[0]!;
        const second = result.houses.cusps[1]!;
        const arc = normalizeDegrees(second - first);
        const offset = normalizeDegrees(result.houses.ascendant - first);
        expect(offset).toBeLessThanOrEqual(arc + 1e-6);
      });

      it("has cusp arcs summing to a full circle", () => {
        let total = 0;
        for (let i = 0; i < 12; i += 1) {
          const from = result.houses.cusps[i]!;
          const to = result.houses.cusps[(i + 1) % 12]!;
          total += normalizeDegrees(to - from);
        }
        expect(total).toBeCloseTo(360, 6);
      });

      it("advances cusps in zodiacal order", () => {
        for (let i = 0; i < 12; i += 1) {
          const arc = normalizeDegrees(
            result.houses.cusps[(i + 1) % 12]! - result.houses.cusps[i]!,
          );
          expect(arc).toBeGreaterThan(0);
          expect(arc).toBeLessThan(180);
        }
      });
    });
  }

  it("starts the whole-sign first house at 0 degrees of the Ascendant's sign", () => {
    const result = moshierEngine.compute(
      request(new Date("1990-06-15T14:30:00Z"), {
        latitude: 40.7128,
        longitude: -74.006,
        houseSystem: "whole-sign",
      }),
    );
    const expected = Math.floor(result.houses.ascendant / 30) * 30;
    expect(result.houses.cusps[0]).toBeCloseTo(expected, 6);
  });

  it("puts whole-sign cusps exactly on sign boundaries", () => {
    const result = moshierEngine.compute(
      request(new Date("1990-06-15T14:30:00Z"), {
        latitude: 40.7128,
        longitude: -74.006,
        houseSystem: "whole-sign",
      }),
    );
    for (const cusp of result.houses.cusps) {
      expect(cusp % 30).toBeCloseTo(0, 6);
    }
  });

  it("reports a local sidereal time in range", () => {
    const result = moshierEngine.compute(request(new Date("2000-01-01T12:00:00Z")));
    expect(result.localSiderealTime).toBeGreaterThanOrEqual(0);
    expect(result.localSiderealTime).toBeLessThan(360);
  });
});
