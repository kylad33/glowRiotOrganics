/**
 * Default ephemeris engine: Moshier, via circular-natal-horoscope-js.
 *
 * Public domain (Unlicense), accurate to roughly an arcsecond — far below the
 * threshold at which any astrological reading would differ. No licence
 * obligations, which is what makes it a safe default while the commercial
 * question is open.
 *
 * Two things about the underlying library shape this file:
 *
 * 1. `Origin` derives its own timezone from lat/lon (tz-lookup +
 *    moment-timezone) and exposes no offset parameter. We need authoritative
 *    control of the instant — users can override the offset, and pre-1970
 *    tzdata is approximate — so we back-solve the wall clock that makes the
 *    library's internal conversion land on our UTC. See `originForUtc`.
 *
 * 2. Per-body result shapes are inconsistent. Longitude is uniform
 *    (`position.apparentLongitude`, degrees) but latitude and distance live
 *    under `apparentGeocentric` for most bodies and `equinoxEclipticLonLat`
 *    for the Sun, in radians, with the Moon's distance in Earth radii rather
 *    than AU. `readGeocentric` normalises all of it. Note `position.polar`
 *    looks like a tempting shortcut and is NOT one: it is geocentric for the
 *    Moon but heliocentric for the outer planets.
 */

import { Origin, Horoscope } from "circular-natal-horoscope-js";
import type { BodyId, BodyPosition, HouseCusps } from "@/lib/astro/types";
import type {
  EphemerisEngine,
  EphemerisRequest,
  EphemerisResult,
} from "@/lib/astro/ephemeris/types";

const RAD_TO_DEG = 180 / Math.PI;
const EARTH_RADIUS_KM = 6378.137;
const AU_KM = 149_597_870.7;
const EARTH_RADII_TO_AU = EARTH_RADIUS_KM / AU_KM;

/** Half-width of the centred finite difference used for speed, in days. */
const SPEED_STEP_DAYS = 0.125; // +/- 3 hours

/** Bodies the library exposes as `CelestialBodies`, minus the fixed star. */
const EPHEMERIS_BODIES: readonly BodyId[] = [
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
];

/** Calculated points, which the library exposes separately. */
const EPHEMERIS_POINTS: readonly BodyId[] = ["northnode", "southnode", "lilith"];

export function normalizeDegrees(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed angular difference b - a, wrapped to (-180, 180]. */
export function angularDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (value && typeof (value as { valueOf?: () => unknown }).valueOf === "function") {
    const v = (value as { valueOf: () => unknown }).valueOf();
    if (typeof v === "number") return v;
  }
  return new Date(String(value)).getTime();
}

export interface BacksolvedOrigin {
  origin: InstanceType<typeof Origin>;
  /** How far the library's UTC ended up from the target, in ms. */
  residualMs: number;
  /**
   * Degrees that must be ADDED to `origin.localSiderealTime` to correct for a
   * probe longitude. Zero on the direct path.
   */
  lstCorrectionDeg: number;
}

/** Tolerance for considering the back-solve converged. */
const BACKSOLVE_TOLERANCE_MS = 500;

/**
 * Longitudes tried when the direct back-solve cannot reach the target, as
 * offsets from the true longitude. A point roughly half a world away is in
 * local daytime and so cannot be sitting on a DST transition at the same
 * instant, which is what makes this escape hatch reliable.
 */
const PROBE_LONGITUDE_OFFSETS = [180, 90, -90, 45, -45, 135, -135];

function wrapLongitude(deg: number): number {
  const r = ((deg + 180) % 360 + 360) % 360;
  return r - 180;
}

function backsolveAt(
  targetMs: number,
  latitude: number,
  longitude: number,
  maxIterations: number,
): { origin: InstanceType<typeof Origin>; residualMs: number } {
  let guessMs = targetMs;
  let best: InstanceType<typeof Origin> | null = null;
  let bestResidual = Number.POSITIVE_INFINITY;

  for (let i = 0; i < maxIterations; i += 1) {
    const g = new Date(guessMs);
    const origin = new Origin({
      year: g.getUTCFullYear(),
      month: g.getUTCMonth(), // library months are 0-indexed
      date: g.getUTCDate(),
      hour: g.getUTCHours(),
      minute: g.getUTCMinutes(),
      second: g.getUTCSeconds(),
      latitude,
      longitude,
    });

    const residual = targetMs - toMillis(origin.utcTime);
    if (Math.abs(residual) < Math.abs(bestResidual)) {
      best = origin;
      bestResidual = residual;
    }
    if (Math.abs(residual) < BACKSOLVE_TOLERANCE_MS) {
      return { origin, residualMs: residual };
    }
    guessMs += residual;
  }

  if (!best) throw new Error("backsolveAt: failed to construct an Origin.");
  return { origin: best, residualMs: bestResidual };
}

/**
 * Builds an `Origin` whose internally-derived UTC equals `target`.
 *
 * The library converts wall clock -> UTC using the zone at lat/lon and exposes
 * no offset parameter, so we invert it: find the wall clock that maps to our
 * instant. This is a fixed-point iteration and converges in two steps.
 *
 * It cannot converge inside the repeated hour of a DST fall-back: that wall
 * clock maps to two instants and the library always resolves it to the first,
 * leaving the second genuinely unreachable. Rather than silently returning a
 * chart an hour wrong, we rebuild at a probe longitude whose zone has no
 * transition at that instant, and report the LST correction needed to undo the
 * longitude shift. Because LST = GMST(UTC) + longitude, that correction is
 * exactly the longitude difference — verified exact to ~1e-11 degrees.
 *
 * Latitude is never altered, so house computation is unaffected.
 */
export function originForUtc(
  target: Date,
  latitude: number,
  longitude: number,
  maxIterations = 6,
): BacksolvedOrigin {
  const targetMs = target.getTime();

  const direct = backsolveAt(targetMs, latitude, longitude, maxIterations);
  if (Math.abs(direct.residualMs) < BACKSOLVE_TOLERANCE_MS) {
    return { ...direct, lstCorrectionDeg: 0 };
  }

  for (const offset of PROBE_LONGITUDE_OFFSETS) {
    const probeLongitude = wrapLongitude(longitude + offset);
    const probe = backsolveAt(targetMs, latitude, probeLongitude, maxIterations);
    if (Math.abs(probe.residualMs) < BACKSOLVE_TOLERANCE_MS) {
      return {
        origin: probe.origin,
        residualMs: probe.residualMs,
        lstCorrectionDeg: longitude - probeLongitude,
      };
    }
  }

  // Every route failed. Surface it rather than return a wrong chart.
  throw new Error(
    `originForUtc: could not reach ${target.toISOString()} at ` +
      `(${latitude}, ${longitude}); closest was ${direct.residualMs}ms off.`,
  );
}

interface Geocentric {
  latitudeDeg: number;
  distanceAu: number | null;
}

/**
 * Pulls geocentric ecliptic latitude and distance out of a raw ephemeris
 * result, normalising the per-body shape differences described at the top.
 */
function readGeocentric(key: string, raw: unknown): Geocentric {
  const result = raw as
    | {
        position?: {
          apparentGeocentric?: Record<string | number, unknown>;
          equinoxEclipticLonLat?: Record<string | number, unknown>;
        };
      }
    | undefined;

  const position = result?.position;
  const source = position?.apparentGeocentric ?? position?.equinoxEclipticLonLat;
  if (!source) return { latitudeDeg: 0, distanceAu: null };

  const pick = (named: string, indexed: number): number | null => {
    const v = source[named] ?? source[indexed];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const latRad = pick("latitude", 1);
  const distance = pick("distance", 2);

  return {
    latitudeDeg: latRad === null ? 0 : latRad * RAD_TO_DEG,
    // The Moon alone is reported in Earth radii.
    distanceAu:
      distance === null
        ? null
        : key === "moon"
          ? distance * EARTH_RADII_TO_AU
          : distance,
  };
}

interface RawChart {
  longitudes: Map<BodyId, number>;
  latitudes: Map<BodyId, number>;
  retrograde: Map<BodyId, boolean | null>;
  houses: number[];
  ascendant: number;
  midheaven: number;
  localSiderealTime: number;
  julianDate: number;
}

function buildChart(request: EphemerisRequest, utc: Date): RawChart {
  const { origin, lstCorrectionDeg } = originForUtc(
    utc,
    request.latitude,
    request.longitude,
  );

  // When the DST escape hatch was used, the origin carries the probe
  // longitude's sidereal time. Correcting it here — before Horoscope reads it
  // — is what keeps the angles and house cusps tied to the true meridian.
  if (lstCorrectionDeg !== 0) {
    const mutable = origin as unknown as { localSiderealTime: number };
    mutable.localSiderealTime = normalizeDegrees(
      mutable.localSiderealTime + lstCorrectionDeg,
    );
  }

  const horoscope = new Horoscope({
    origin,
    houseSystem: request.houseSystem,
    zodiac: request.zodiac,
    // Aspects are derived in our own layer, so we ask for none here.
    aspectPoints: [],
    aspectWithPoints: [],
    aspectTypes: [],
    language: "en",
  }) as unknown as {
    CelestialBodies: Record<string, unknown>;
    CelestialPoints: Record<string, unknown>;
    Ephemeris: { Results: Array<{ _key?: string }> };
    Houses: unknown[];
    Ascendant: unknown;
    Midheaven: unknown;
  };

  const eclipticDegrees = (node: unknown): number | null => {
    const v = (
      node as
        | { ChartPosition?: { Ecliptic?: { DecimalDegrees?: unknown } } }
        | undefined
    )?.ChartPosition?.Ecliptic?.DecimalDegrees;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const longitudes = new Map<BodyId, number>();
  const latitudes = new Map<BodyId, number>();
  const retrograde = new Map<BodyId, boolean | null>();

  const rawByKey = new Map<string, unknown>();
  for (const r of horoscope.Ephemeris?.Results ?? []) {
    if (r && typeof r._key === "string") rawByKey.set(r._key, r);
  }

  for (const id of EPHEMERIS_BODIES) {
    const node = horoscope.CelestialBodies[id];
    const lon = eclipticDegrees(node);
    if (lon === null) continue;
    longitudes.set(id, normalizeDegrees(lon));
    latitudes.set(id, readGeocentric(id, rawByKey.get(id)).latitudeDeg);
    const flag = (node as { isRetrograde?: unknown }).isRetrograde;
    retrograde.set(id, typeof flag === "boolean" ? flag : null);
  }

  for (const id of EPHEMERIS_POINTS) {
    const lon = eclipticDegrees(horoscope.CelestialPoints[id]);
    if (lon === null) continue;
    longitudes.set(id, normalizeDegrees(lon));
    // The lunar nodes are by definition the points where the Moon's orbit
    // crosses the ecliptic, so their ecliptic latitude is exactly zero.
    // Mean Lilith is conventionally charted on the ecliptic too.
    latitudes.set(id, 0);
    retrograde.set(id, null);
  }

  const houses = (horoscope.Houses ?? [])
    .map((h) => {
      const v = (
        h as {
          ChartPosition?: { StartPosition?: { Ecliptic?: { DecimalDegrees?: unknown } } };
        }
      )?.ChartPosition?.StartPosition?.Ecliptic?.DecimalDegrees;
      return typeof v === "number" ? normalizeDegrees(v) : Number.NaN;
    })
    .filter((v) => Number.isFinite(v));

  return {
    longitudes,
    latitudes,
    retrograde,
    houses,
    ascendant: normalizeDegrees(eclipticDegrees(horoscope.Ascendant) ?? 0),
    midheaven: normalizeDegrees(eclipticDegrees(horoscope.Midheaven) ?? 0),
    localSiderealTime: normalizeDegrees(
      (origin as unknown as { localSiderealTime: number }).localSiderealTime,
    ),
    julianDate: (origin as unknown as { julianDate: number }).julianDate,
  };
}

export const moshierEngine: EphemerisEngine = {
  id: "moshier",
  label: "Moshier ephemeris (circular-natal-horoscope-js)",
  license: "Unlicense (public domain)",

  compute(request: EphemerisRequest): EphemerisResult {
    const centre = buildChart(request, request.utc);

    // Speed is not exposed by the library, so we take a centred finite
    // difference. Second-order accurate, and it gives us both retrograde
    // cross-checking and applying/separating aspects.
    const stepMs = SPEED_STEP_DAYS * 86_400_000;
    const before = buildChart(request, new Date(request.utc.getTime() - stepMs));
    const after = buildChart(request, new Date(request.utc.getTime() + stepMs));

    const bodies: BodyPosition[] = [];
    for (const [id, longitude] of centre.longitudes) {
      const lonBefore = before.longitudes.get(id);
      const lonAfter = after.longitudes.get(id);

      let speed: number | null = null;
      if (lonBefore !== undefined && lonAfter !== undefined) {
        speed = angularDelta(lonBefore, lonAfter) / (2 * SPEED_STEP_DAYS);
      }

      // Prefer the library's own retrograde flag; fall back to speed sign.
      const flagged = centre.retrograde.get(id) ?? null;
      const retro = flagged ?? (speed === null ? null : speed < 0);

      bodies.push({
        id,
        longitude,
        latitude: centre.latitudes.get(id) ?? 0,
        speed,
        retrograde: retro,
      });
    }

    const houses: HouseCusps = {
      system: request.houseSystem,
      cusps: centre.houses,
      ascendant: centre.ascendant,
      midheaven: centre.midheaven,
    };

    return {
      bodies,
      houses,
      localSiderealTime: centre.localSiderealTime,
      julianDay: centre.julianDate,
    };
  },
};
