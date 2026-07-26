/**
 * Coordinates -> IANA timezone.
 *
 * SERVER ONLY. `geo-tz` loads packed timezone boundary polygons from disk, so
 * this module must not be pulled into a client bundle. The browser gets its
 * zone from the place-picker payload instead: the GeoNames dataset ships an
 * IANA zone per city, so a chosen place already carries its own zone.
 */

import "server-only";
import { find } from "geo-tz";

export interface Place {
  name: string;
  /** Admin region, e.g. "New York" — for disambiguating same-named cities. */
  admin1?: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  /** IANA zone, carried with the place so the client never needs a lookup. */
  zone: string;
}

/**
 * Resolves the IANA zone for a coordinate pair.
 *
 * `geo-tz` can return more than one zone where boundaries are disputed or a
 * point sits on a border; we take the first but return the full list so
 * callers can surface the ambiguity rather than hide it.
 */
export function resolveZone(
  latitude: number,
  longitude: number,
): { zone: string; alternatives: string[] } {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError(`resolveZone: latitude out of range: ${latitude}`);
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError(`resolveZone: longitude out of range: ${longitude}`);
  }

  const zones = find(latitude, longitude);
  if (zones.length === 0) {
    // Open ocean and a few uninhabited areas have no zone. Fall back to the
    // nautical zone implied by longitude — 15 degrees per hour — which is the
    // maritime convention and better than failing outright.
    const nauticalOffset = Math.round(longitude / 15);
    const sign = nauticalOffset <= 0 ? "+" : "-"; // Etc/GMT signs are inverted
    return {
      zone: `Etc/GMT${sign}${Math.abs(nauticalOffset)}`,
      alternatives: [],
    };
  }

  return { zone: zones[0]!, alternatives: zones.slice(1) };
}
