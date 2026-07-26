import { describe, it, expect } from "vitest";
import { SIGNS, INTERPRETED_BODIES, type BodyId, type BodyPosition, type HouseCusps } from "@/lib/astro/types";
import {
  DEGREES_PER_SIGN,
  SIGN_ELEMENT,
  SIGN_MODALITY,
  SIGN_POLARITY,
  SIGN_RULER,
  TRADITIONAL_SIGN_RULER,
  degreeInSign,
  formatDegreeInSign,
  signFromLongitude,
  signStartLongitude,
} from "@/lib/astro/derive/signs";
import {
  hasGreatCircleBoundaries,
  houseOfLongitude,
  houseWidths,
  quadrantOf,
} from "@/lib/astro/derive/houses";
import { computeAspects, separation } from "@/lib/astro/derive/aspects";
import {
  chartShape,
  chartSignals,
  elementBalance,
  findFinalDispositors,
  findStelliums,
  modalityBalance,
} from "@/lib/astro/derive/patterns";

/** Places the ten interpreted bodies at the given longitudes, in order. */
function spread(longitudes: number[]): BodyPosition[] {
  return longitudes.map((longitude, i) => ({
    id: INTERPRETED_BODIES[i]!,
    longitude,
    latitude: 0,
    speed: 1,
    retrograde: false,
  }));
}

function at(map: Partial<Record<BodyId, number>>): BodyPosition[] {
  return Object.entries(map).map(([id, longitude]) => ({
    id: id as BodyId,
    longitude: longitude as number,
    latitude: 0,
    speed: 1,
    retrograde: false,
  }));
}

/** Equal houses starting at `ascendant`, for placement tests. */
function equalHouses(ascendant: number): HouseCusps {
  return {
    system: "equal-house",
    cusps: Array.from({ length: 12 }, (_, i) => (ascendant + i * 30) % 360),
    ascendant,
    midheaven: (ascendant + 270) % 360,
  };
}

describe("signs", () => {
  it("maps each 30-degree segment to its sign", () => {
    SIGNS.forEach((sign, i) => {
      expect(signFromLongitude(i * DEGREES_PER_SIGN)).toBe(sign);
      expect(signFromLongitude(i * DEGREES_PER_SIGN + 29.999)).toBe(sign);
    });
  });

  it("puts sign boundaries at exact multiples of 30", () => {
    expect(signFromLongitude(0)).toBe("aries");
    expect(signFromLongitude(29.9999)).toBe("aries");
    expect(signFromLongitude(30)).toBe("taurus");
    expect(signFromLongitude(359.9999)).toBe("pisces");
  });

  it("wraps longitudes outside [0, 360)", () => {
    expect(signFromLongitude(360)).toBe("aries");
    expect(signFromLongitude(-1)).toBe("pisces");
    expect(signFromLongitude(720 + 45)).toBe("taurus");
  });

  it("reports the degree within the sign", () => {
    expect(degreeInSign(0)).toBeCloseTo(0, 9);
    expect(degreeInSign(45)).toBeCloseTo(15, 9);
    expect(degreeInSign(359)).toBeCloseTo(29, 9);
    expect(degreeInSign(-1)).toBeCloseTo(29, 9);
  });

  it("round-trips sign start longitudes", () => {
    for (const sign of SIGNS) {
      expect(signFromLongitude(signStartLongitude(sign))).toBe(sign);
    }
  });

  it("defines element, modality, polarity and rulers for every sign", () => {
    for (const sign of SIGNS) {
      expect(SIGN_ELEMENT[sign]).toBeDefined();
      expect(SIGN_MODALITY[sign]).toBeDefined();
      expect(SIGN_POLARITY[sign]).toBeDefined();
      expect(SIGN_RULER[sign]).toBeDefined();
      expect(TRADITIONAL_SIGN_RULER[sign]).toBeDefined();
    }
  });

  it("distributes elements and modalities evenly, as the zodiac requires", () => {
    const elements = new Map<string, number>();
    const modalities = new Map<string, number>();
    for (const sign of SIGNS) {
      elements.set(SIGN_ELEMENT[sign], (elements.get(SIGN_ELEMENT[sign]) ?? 0) + 1);
      modalities.set(SIGN_MODALITY[sign], (modalities.get(SIGN_MODALITY[sign]) ?? 0) + 1);
    }
    // Four elements of three signs each; three modalities of four each.
    for (const count of elements.values()) expect(count).toBe(3);
    for (const count of modalities.values()) expect(count).toBe(4);
  });

  it("alternates polarity around the wheel", () => {
    SIGNS.forEach((sign, i) => {
      expect(SIGN_POLARITY[sign]).toBe(i % 2 === 0 ? "positive" : "negative");
    });
  });

  it("formats degrees within the sign", () => {
    expect(formatDegreeInSign(280.5)).toBe("10°30'00\"");
    expect(formatDegreeInSign(0)).toBe("0°00'00\"");
  });

  it("carries rounding out of seconds without producing 60", () => {
    const formatted = formatDegreeInSign(30 - 1e-9);
    expect(formatted).not.toContain("60'");
    expect(formatted).not.toContain("60\"");
  });
});

describe("houses", () => {
  const houses = equalHouses(15);

  it("places a longitude in the arc that contains it", () => {
    expect(houseOfLongitude(20, houses.cusps)).toBe(1);
    expect(houseOfLongitude(50, houses.cusps)).toBe(2);
    expect(houseOfLongitude(10, houses.cusps)).toBe(12);
  });

  it("assigns a body exactly on a cusp to the house that cusp opens", () => {
    expect(houseOfLongitude(15, houses.cusps)).toBe(1);
    expect(houseOfLongitude(45, houses.cusps)).toBe(2);
  });

  it("handles arcs that wrap through zero", () => {
    const wrapping = equalHouses(350);
    expect(houseOfLongitude(355, wrapping.cusps)).toBe(1);
    expect(houseOfLongitude(5, wrapping.cusps)).toBe(1);
    expect(houseOfLongitude(25, wrapping.cusps)).toBe(2);
  });

  it("covers the whole circle", () => {
    // Every degree must land in exactly one house.
    for (let lon = 0; lon < 360; lon += 0.5) {
      const house = houseOfLongitude(lon, houses.cusps);
      expect(house).toBeGreaterThanOrEqual(1);
      expect(house).toBeLessThanOrEqual(12);
    }
  });

  it("has widths summing to a full circle", () => {
    const total = houseWidths(houses.cusps).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(360, 9);
  });

  it("rejects a malformed cusp list rather than guessing", () => {
    expect(() => houseOfLongitude(10, [0, 30, 60])).toThrow(/12 cusps/);
  });

  it("classifies house quadrants", () => {
    expect(quadrantOf(1)).toBe("angular");
    expect(quadrantOf(10)).toBe("angular");
    expect(quadrantOf(2)).toBe("succedent");
    expect(quadrantOf(3)).toBe("cadent");
  });

  // The 3D scene relies on this to avoid drawing invented geometry: Placidus
  // and Koch divide time, not space, so they have no boundary planes.
  it("reports which systems have true great-circle boundaries", () => {
    expect(hasGreatCircleBoundaries(equalHouses(0))).toBe(true);
    expect(
      hasGreatCircleBoundaries({ ...equalHouses(0), system: "whole-sign" }),
    ).toBe(true);
    expect(hasGreatCircleBoundaries({ ...equalHouses(0), system: "placidus" })).toBe(false);
    expect(hasGreatCircleBoundaries({ ...equalHouses(0), system: "koch" })).toBe(false);
    expect(
      hasGreatCircleBoundaries({ ...equalHouses(0), system: "topocentric" }),
    ).toBe(false);
  });
});

describe("aspects", () => {
  it("folds separation into [0, 180]", () => {
    expect(separation(0, 90)).toBeCloseTo(90, 9);
    expect(separation(0, 270)).toBeCloseTo(90, 9);
    expect(separation(350, 10)).toBeCloseTo(20, 9);
    expect(separation(0, 180)).toBeCloseTo(180, 9);
  });

  it("finds an exact conjunction", () => {
    const found = computeAspects(at({ sun: 100, moon: 100 }));
    expect(found).toHaveLength(1);
    expect(found[0]!.type).toBe("conjunction");
    expect(found[0]!.orb).toBeCloseTo(0, 9);
  });

  it("finds the major aspects at their exact angles", () => {
    const cases: Array<[number, string]> = [
      [0, "conjunction"],
      [60, "sextile"],
      [90, "square"],
      [120, "trine"],
      [180, "opposition"],
    ];
    for (const [angle, type] of cases) {
      const found = computeAspects(at({ mars: 0, saturn: angle }));
      expect(found[0]?.type).toBe(type);
    }
  });

  it("respects orb limits", () => {
    // Square has a 7 degree default orb and no luminary bonus here.
    expect(computeAspects(at({ mars: 0, saturn: 96 }))).toHaveLength(1);
    expect(computeAspects(at({ mars: 0, saturn: 98 }))).toHaveLength(0);
  });

  it("widens orbs when a luminary is involved", () => {
    // 9 degrees from exact: outside Mars/Saturn's 7, inside the Sun's 7+2.
    expect(computeAspects(at({ mars: 0, saturn: 99 }))).toHaveLength(0);
    expect(computeAspects(at({ sun: 0, saturn: 99 }))).toHaveLength(1);
  });

  it("can disable the luminary bonus", () => {
    expect(
      computeAspects(at({ sun: 0, saturn: 99 }), { luminaryBonus: 0 }),
    ).toHaveLength(0);
  });

  it("ignores minor aspects unless asked", () => {
    expect(computeAspects(at({ mars: 0, saturn: 150 }))).toHaveLength(0);
    expect(
      computeAspects(at({ mars: 0, saturn: 150 }), { types: ["quincunx"] }),
    ).toHaveLength(1);
  });

  it("returns the tightest aspect when orbs overlap", () => {
    const found = computeAspects(at({ mars: 0, saturn: 2 }), {
      types: ["conjunction", "semisextile"],
      orbs: { conjunction: 10, semisextile: 30 },
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.type).toBe("conjunction");
  });

  it("sorts tightest first", () => {
    const found = computeAspects(at({ sun: 0, moon: 90.1, mars: 180.5, venus: 120 }));
    for (let i = 1; i < found.length; i += 1) {
      expect(found[i]!.orb).toBeGreaterThanOrEqual(found[i - 1]!.orb);
    }
  });

  it("marks a closing aspect as applying", () => {
    // Moon at 85 moving fast toward a square with the Sun at 0.
    const bodies: BodyPosition[] = [
      { id: "sun", longitude: 0, latitude: 0, speed: 1, retrograde: false },
      { id: "moon", longitude: 85, latitude: 0, speed: 13, retrograde: false },
    ];
    expect(computeAspects(bodies)[0]!.applying).toBe(true);
  });

  it("marks a widening aspect as separating", () => {
    const bodies: BodyPosition[] = [
      { id: "sun", longitude: 0, latitude: 0, speed: 1, retrograde: false },
      { id: "moon", longitude: 95, latitude: 0, speed: 13, retrograde: false },
    ];
    expect(computeAspects(bodies)[0]!.applying).toBe(false);
  });

  it("reports applying as unknown when speed is unavailable", () => {
    const bodies: BodyPosition[] = [
      { id: "sun", longitude: 0, latitude: 0, speed: null, retrograde: null },
      { id: "moon", longitude: 90, latitude: 0, speed: null, retrograde: null },
    ];
    expect(computeAspects(bodies)[0]!.applying).toBeNull();
  });

  it("never pairs a body with itself", () => {
    const found = computeAspects(at({ sun: 0, moon: 0, mars: 0 }));
    for (const aspect of found) expect(aspect.a).not.toBe(aspect.b);
  });
});

describe("balances", () => {
  it("weights the luminaries above the outer planets by default", () => {
    // Sun in Aries (fire, weight 3) vs Pluto in Leo (fire, weight 1).
    const totals = elementBalance(at({ sun: 10, pluto: 130 }));
    expect(totals.fire).toBe(4);
    expect(totals.water).toBe(0);
  });

  it("supports uniform weighting", () => {
    const uniform = Object.fromEntries(
      INTERPRETED_BODIES.map((id) => [id, 1]),
    ) as Record<BodyId, number>;
    const totals = elementBalance(at({ sun: 10, pluto: 130 }), uniform);
    expect(totals.fire).toBe(2);
  });

  it("counts modalities", () => {
    // Aries is cardinal, Taurus fixed, Gemini mutable.
    const totals = modalityBalance(at({ sun: 10, moon: 40, mercury: 70 }));
    expect(totals.cardinal).toBe(3);
    expect(totals.fixed).toBe(3);
    expect(totals.mutable).toBe(2);
  });

  it("ignores calculated points, which have no sign weight", () => {
    const totals = elementBalance(at({ sun: 10, northnode: 10, lilith: 10 }));
    expect(totals.fire).toBe(3);
  });
});

describe("stelliums", () => {
  it("finds three or more bodies sharing a sign", () => {
    const found = findStelliums(at({ sun: 5, moon: 12, mercury: 25, pluto: 200 }), null);
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe("sign");
    expect(found[0]!.key).toBe("aries");
    expect(found[0]!.bodies).toEqual(["sun", "moon", "mercury"]);
  });

  it("does not count two bodies as a stellium", () => {
    expect(findStelliums(at({ sun: 5, moon: 12 }), null)).toHaveLength(0);
  });

  it("finds house stelliums when houses are known", () => {
    const found = findStelliums(
      at({ sun: 20, moon: 25, mercury: 30 }),
      equalHouses(15),
    );
    expect(found.some((s) => s.kind === "house" && s.key === "1")).toBe(true);
  });

  it("suppresses house stelliums when the birth time is unknown", () => {
    const found = findStelliums(at({ sun: 20, moon: 25, mercury: 30 }), null);
    expect(found.every((s) => s.kind === "sign")).toBe(true);
  });
});

describe("dispositors", () => {
  it("finds bodies in the sign they rule", () => {
    // Mars in Aries and Venus in Taurus both rule their own sign.
    const found = findFinalDispositors(at({ mars: 10, venus: 40, moon: 200 }));
    expect(found).toEqual(["mars", "venus"]);
  });

  it("returns none when no body rules its sign", () => {
    expect(findFinalDispositors(at({ mars: 40, venus: 10 }))).toEqual([]);
  });
});

describe("chart shape", () => {
  it("detects a bundle when everything sits inside 120 degrees", () => {
    const result = chartShape(spread([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]));
    expect(result.shape).toBe("bundle");
    expect(result.span).toBeLessThanOrEqual(120);
  });

  it("detects a bowl when everything sits inside a hemisphere", () => {
    const result = chartShape(spread([0, 18, 36, 54, 72, 90, 108, 126, 144, 162]));
    expect(result.shape).toBe("bowl");
  });

  it("detects a splash when bodies are spread evenly", () => {
    const result = chartShape(spread([0, 36, 72, 108, 144, 180, 216, 252, 288, 324]));
    expect(result.shape).toBe("splash");
    expect(result.largestGap).toBeLessThan(60);
  });

  it("detects a bucket and names its handle", () => {
    // Nine bodies in a bowl, Pluto alone on the far side.
    const result = chartShape(spread([0, 15, 30, 45, 60, 75, 90, 105, 120, 260]));
    expect(result.shape).toBe("bucket");
    expect(result.handle).toBe("pluto");
  });

  it("detects a seesaw of two opposed groups", () => {
    const result = chartShape(spread([0, 10, 20, 30, 40, 180, 190, 200, 210, 220]));
    expect(result.shape).toBe("seesaw");
  });

  it("reports span and largest gap consistently", () => {
    const result = chartShape(spread([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]));
    expect(result.span + result.largestGap).toBeCloseTo(360, 9);
  });
});

describe("chartSignals", () => {
  const bodies = spread([0, 15, 30, 45, 60, 75, 90, 105, 120, 260]);
  const houses = equalHouses(15);

  it("names the chart ruler from the Ascendant's sign", () => {
    // Ascendant at 15 degrees is Aries, ruled by Mars in modern rulership.
    const signals = chartSignals(bodies, houses);
    expect(signals.chartRuler).toBe("mars");
    expect(signals.chartRulerHouse).toBeGreaterThanOrEqual(1);
    expect(signals.chartRulerHouse).toBeLessThanOrEqual(12);
  });

  it("suppresses ruler and angular bodies without houses", () => {
    const signals = chartSignals(bodies, null);
    expect(signals.chartRuler).toBeNull();
    expect(signals.chartRulerHouse).toBeNull();
    expect(signals.angularBodies).toEqual([]);
  });

  it("picks dominant element and modality", () => {
    const signals = chartSignals(bodies, houses);
    expect(["fire", "earth", "air", "water"]).toContain(signals.dominantElement);
    expect(["cardinal", "fixed", "mutable"]).toContain(signals.dominantModality);
  });

  it("produces balances that sum to the total weight", () => {
    const signals = chartSignals(bodies, houses);
    const elementTotal = Object.values(signals.elements).reduce((a, b) => a + b, 0);
    const modalityTotal = Object.values(signals.modalities).reduce((a, b) => a + b, 0);
    const polarityTotal = Object.values(signals.polarities).reduce((a, b) => a + b, 0);
    expect(elementTotal).toBeCloseTo(modalityTotal, 9);
    expect(elementTotal).toBeCloseTo(polarityTotal, 9);
  });
});
