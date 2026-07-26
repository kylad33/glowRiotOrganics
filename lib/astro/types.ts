/**
 * Core domain types for the natal chart engine.
 *
 * Everything here is plain data: no library types leak across this boundary.
 * That is what lets the ephemeris implementation be swapped (see
 * `lib/astro/ephemeris/types.ts`) without touching derivation or UI code.
 */

export const SIGNS = [
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
] as const;

export type ZodiacSign = (typeof SIGNS)[number];

/** Classical + modern bodies, plus the calculated points we chart. */
export const BODIES = [
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
  "chiron",
  "northnode",
  "southnode",
  "lilith",
] as const;

export type BodyId = (typeof BODIES)[number];

/** The seven bodies visible to the naked eye — used for traditional rulership. */
export const CLASSICAL_BODIES: readonly BodyId[] = [
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
] as const;

/**
 * Bodies that carry sign/house interpretation weight. Excludes the calculated
 * points, which are interpreted differently and have no meaningful "speed".
 */
export const INTERPRETED_BODIES: readonly BodyId[] = [
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
] as const;

export type HouseSystem =
  | "placidus"
  | "koch"
  | "campanus"
  | "regiomontanus"
  | "topocentric"
  | "whole-sign"
  | "equal-house";

/**
 * House systems whose boundaries are genuine great circles on the celestial
 * sphere, and can therefore be drawn honestly as planes in the 3D scene.
 *
 * Placidus, Koch and Topocentric divide *time*, not space — their cusps are
 * points along the ecliptic with no great-circle boundary. Rendering them as
 * planes would be a fabrication, so the 3D layer must check this set before
 * drawing house boundary geometry.
 */
export const GREAT_CIRCLE_HOUSE_SYSTEMS: ReadonlySet<HouseSystem> = new Set([
  "whole-sign",
  "equal-house",
  "campanus",
  "regiomontanus",
]);

export type Zodiac = "tropical" | "sidereal";

/** A body's position at a moment, in geocentric ecliptic coordinates. */
export interface BodyPosition {
  id: BodyId;
  /** Ecliptic longitude, degrees [0, 360). */
  longitude: number;
  /** Ecliptic latitude, degrees; positive north of the ecliptic. */
  latitude: number;
  /** Longitudinal speed, degrees/day. Negative means retrograde. */
  speed: number | null;
  /** Derived from `speed < 0`. Null when the engine reports no speed. */
  retrograde: boolean | null;
}

/**
 * The twelve house cusps plus the chart angles.
 *
 * `cusps[0]` is the 1st house cusp, which equals the Ascendant in every system
 * we support. All values are ecliptic longitude in degrees [0, 360).
 */
export interface HouseCusps {
  system: HouseSystem;
  cusps: number[];
  ascendant: number;
  midheaven: number;
}

/** A geometric relationship between two chart points. */
export interface Aspect {
  a: BodyId;
  b: BodyId;
  type: AspectType;
  /** Exact angle of this aspect type, degrees. */
  exactAngle: number;
  /** Actual separation, degrees [0, 180]. */
  separation: number;
  /** Absolute deviation from exact, degrees. */
  orb: number;
  /** True when the faster body is closing on exactness. */
  applying: boolean | null;
}

export const ASPECT_TYPES = [
  "conjunction",
  "opposition",
  "trine",
  "square",
  "sextile",
  "quincunx",
  "semisextile",
  "semisquare",
  "sesquiquadrate",
] as const;

export type AspectType = (typeof ASPECT_TYPES)[number];

export interface AspectDefinition {
  type: AspectType;
  angle: number;
  major: boolean;
  /** Default orb in degrees, before per-body widening. */
  defaultOrb: number;
}

export const ASPECT_DEFINITIONS: readonly AspectDefinition[] = [
  { type: "conjunction", angle: 0, major: true, defaultOrb: 8 },
  { type: "opposition", angle: 180, major: true, defaultOrb: 8 },
  { type: "trine", angle: 120, major: true, defaultOrb: 7 },
  { type: "square", angle: 90, major: true, defaultOrb: 7 },
  { type: "sextile", angle: 60, major: true, defaultOrb: 5 },
  { type: "quincunx", angle: 150, major: false, defaultOrb: 3 },
  { type: "semisextile", angle: 30, major: false, defaultOrb: 2 },
  { type: "semisquare", angle: 45, major: false, defaultOrb: 2 },
  { type: "sesquiquadrate", angle: 135, major: false, defaultOrb: 2 },
];

export type Element = "fire" | "earth" | "air" | "water";
export type Modality = "cardinal" | "fixed" | "mutable";
export type Polarity = "positive" | "negative";
