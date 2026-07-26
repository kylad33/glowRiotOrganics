/**
 * House placement.
 *
 * Houses are unequal arcs in most systems, so placement is "which arc contains
 * this longitude", not "longitude divided by 30". Everything wraps through
 * 0/360, which is the usual source of off-by-one-house bugs.
 */

import type { HouseCusps } from "@/lib/astro/types";

function normalize(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/**
 * The house (1-12) containing a longitude.
 *
 * A body sitting exactly on a cusp belongs to the house the cusp opens.
 */
export function houseOfLongitude(longitude: number, cusps: readonly number[]): number {
  if (cusps.length !== 12) {
    throw new Error(`houseOfLongitude: expected 12 cusps, received ${cusps.length}`);
  }

  const lon = normalize(longitude);
  for (let i = 0; i < 12; i += 1) {
    const start = cusps[i]!;
    const end = cusps[(i + 1) % 12]!;
    const arc = normalize(end - start);
    const offset = normalize(lon - start);
    // `arc` is 0 only in a degenerate chart; treat it as a full circle so we
    // always return something rather than falling through the loop.
    if (offset < (arc === 0 ? 360 : arc)) return i + 1;
  }

  // Unreachable for well-formed cusps, but never silently mis-place a body.
  throw new Error(
    `houseOfLongitude: ${longitude} matched no house arc; cusps may be malformed.`,
  );
}

/** Width in degrees of each house, indexed 0-11 for houses 1-12. */
export function houseWidths(cusps: readonly number[]): number[] {
  return cusps.map((start, i) => normalize(cusps[(i + 1) % 12]! - start));
}

/** The four angular houses, where placements carry the most weight. */
export const ANGULAR_HOUSES = [1, 4, 7, 10] as const;
export const SUCCEDENT_HOUSES = [2, 5, 8, 11] as const;
export const CADENT_HOUSES = [3, 6, 9, 12] as const;

export type HouseQuadrant = "angular" | "succedent" | "cadent";

export function quadrantOf(house: number): HouseQuadrant {
  if ((ANGULAR_HOUSES as readonly number[]).includes(house)) return "angular";
  if ((SUCCEDENT_HOUSES as readonly number[]).includes(house)) return "succedent";
  return "cadent";
}

/**
 * Whether this house system's boundaries can be drawn as great circles.
 *
 * Placidus, Koch and Topocentric divide time rather than space: their cusps
 * are points on the ecliptic with no corresponding boundary plane. The 3D
 * scene must consult this before rendering house geometry, or it will present
 * an invented shape as if it were the real division.
 */
export function hasGreatCircleBoundaries(houses: HouseCusps): boolean {
  return (
    houses.system === "whole-sign" ||
    houses.system === "equal-house" ||
    houses.system === "campanus" ||
    houses.system === "regiomontanus"
  );
}
