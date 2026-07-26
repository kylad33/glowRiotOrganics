/**
 * The ephemeris seam.
 *
 * This is the ONLY place astronomy implementations plug in. Everything
 * downstream — derivation, interpretation, the 3D scene — depends on this
 * interface and never on a concrete engine.
 *
 * Why it exists: Swiss Ephemeris is dual-licensed AGPL / commercial, and AGPL
 * covers network use, so a hosted app using it under AGPL must open-source
 * itself entirely. The default engine is therefore the public-domain Moshier
 * implementation. If precision or the 8000-year range ever justifies buying
 * the Professional License, swapping engines is a one-file change.
 */

import type {
  BodyPosition,
  HouseCusps,
  HouseSystem,
  Zodiac,
} from "@/lib/astro/types";

export interface EphemerisRequest {
  /** The authoritative instant, from `resolveBirthTime`. */
  utc: Date;
  /** Geographic latitude, degrees north-positive. */
  latitude: number;
  /** Geographic longitude, degrees east-positive. */
  longitude: number;
  houseSystem: HouseSystem;
  zodiac: Zodiac;
}

export interface EphemerisResult {
  bodies: BodyPosition[];
  houses: HouseCusps;
  /** Local sidereal time in degrees — drives the 3D horizon and meridian. */
  localSiderealTime: number;
  /** Julian Day the engine actually used, for cross-checking. */
  julianDay: number;
}

export interface EphemerisEngine {
  /** Stable identifier, e.g. "moshier". Recorded on charts for provenance. */
  readonly id: string;
  /** Human-readable, for the UI's data-provenance note. */
  readonly label: string;
  /** Licence of the underlying ephemeris data. */
  readonly license: string;

  /**
   * Computes bodies and houses together.
   *
   * These are deliberately one call rather than two: they derive from a single
   * moment, and splitting them invites the two halves drifting out of sync.
   */
  compute(request: EphemerisRequest): EphemerisResult;
}
