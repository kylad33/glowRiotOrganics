/**
 * Aspects — the angular relationships that turn a list of placements into a
 * connected chart.
 *
 * Orbs are configurable because there is no single correct set: traditions
 * differ, and the luminaries are conventionally allowed wider orbs than the
 * rest. Defaults live in `ASPECT_DEFINITIONS`.
 */

import {
  ASPECT_DEFINITIONS,
  INTERPRETED_BODIES,
  type Aspect,
  type AspectType,
  type BodyId,
  type BodyPosition,
} from "@/lib/astro/types";

/** Angular separation between two longitudes, folded to [0, 180]. */
export function separation(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360) + 360) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export interface AspectOptions {
  /** Which aspect types to look for. Defaults to the five major aspects. */
  types?: readonly AspectType[];
  /** Per-type orb overrides, in degrees. */
  orbs?: Partial<Record<AspectType, number>>;
  /** Which bodies participate. Defaults to the ten interpreted bodies. */
  bodies?: readonly BodyId[];
  /**
   * Extra orb allowed when the Sun or Moon is involved. Conventional, and
   * defaults to 2 degrees; set to 0 for uniform orbs.
   */
  luminaryBonus?: number;
}

const LUMINARIES: ReadonlySet<BodyId> = new Set<BodyId>(["sun", "moon"]);

const DEFAULT_TYPES: readonly AspectType[] = ASPECT_DEFINITIONS.filter(
  (d) => d.major,
).map((d) => d.type);

/** Days used for the linear step that decides applying vs separating. */
const APPLYING_STEP_DAYS = 0.01;

export function computeAspects(
  bodies: readonly BodyPosition[],
  options: AspectOptions = {},
): Aspect[] {
  const types = options.types ?? DEFAULT_TYPES;
  const allowed = new Set(options.bodies ?? INTERPRETED_BODIES);
  const luminaryBonus = options.luminaryBonus ?? 2;

  const definitions = ASPECT_DEFINITIONS.filter((d) => types.includes(d.type));
  const participants = bodies.filter((b) => allowed.has(b.id));
  const aspects: Aspect[] = [];

  for (let i = 0; i < participants.length; i += 1) {
    for (let j = i + 1; j < participants.length; j += 1) {
      const a = participants[i]!;
      const b = participants[j]!;
      const sep = separation(a.longitude, b.longitude);

      const bonus =
        LUMINARIES.has(a.id) || LUMINARIES.has(b.id) ? luminaryBonus : 0;

      // Where orbs overlap, the tightest aspect is the real one.
      let best: Aspect | null = null;
      for (const def of definitions) {
        const orb = (options.orbs?.[def.type] ?? def.defaultOrb) + bonus;
        const deviation = Math.abs(sep - def.angle);
        if (deviation > orb) continue;
        if (best && deviation >= best.orb) continue;

        best = {
          a: a.id,
          b: b.id,
          type: def.type,
          exactAngle: def.angle,
          separation: sep,
          orb: deviation,
          applying: isApplying(a, b, def.angle),
        };
      }

      if (best) aspects.push(best);
    }
  }

  // Tightest first: that is the order they matter in.
  return aspects.sort((x, y) => x.orb - y.orb);
}

/**
 * Whether the pair is closing on exactness.
 *
 * Extrapolates both longitudes forward by a small step and asks whether the
 * deviation from exact shrank. This handles retrograde motion and the 0/360
 * wrap without special-casing either.
 */
function isApplying(
  a: BodyPosition,
  b: BodyPosition,
  exactAngle: number,
): boolean | null {
  if (a.speed === null || b.speed === null) return null;

  const now = Math.abs(separation(a.longitude, b.longitude) - exactAngle);
  const later = Math.abs(
    separation(
      a.longitude + a.speed * APPLYING_STEP_DAYS,
      b.longitude + b.speed * APPLYING_STEP_DAYS,
    ) - exactAngle,
  );

  if (later === now) return null;
  return later < now;
}

/** Aspects involving a particular body, tightest first. */
export function aspectsFor(aspects: readonly Aspect[], body: BodyId): Aspect[] {
  return aspects.filter((x) => x.a === body || x.b === body);
}
