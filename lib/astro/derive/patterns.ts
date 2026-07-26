/**
 * Synthesis signals — the derived structure the interpretation layer keys off.
 *
 * Individual placements say "Mars in Virgo in the 6th". These functions say
 * what the chart is like as a whole: where its weight sits, what it keeps
 * returning to, and what shape it makes. The career, relationship and
 * life-theme writeups are driven from here rather than from placement text.
 */

import {
  INTERPRETED_BODIES,
  type BodyId,
  type BodyPosition,
  type Element,
  type HouseCusps,
  type Modality,
  type Polarity,
  type ZodiacSign,
} from "@/lib/astro/types";
import {
  SIGN_ELEMENT,
  SIGN_MODALITY,
  SIGN_POLARITY,
  SIGN_RULER,
  signFromLongitude,
} from "@/lib/astro/derive/signs";
import { houseOfLongitude, quadrantOf } from "@/lib/astro/derive/houses";

/**
 * Default weighting for balance counts.
 *
 * Weighting is a convention, not a fact — the luminaries and the Ascendant
 * describe a person more than Neptune's slow generational placement does, so
 * counting all ten equally overstates the outer planets. Pass your own to
 * change it, or a uniform map to disable weighting entirely.
 */
export const DEFAULT_BODY_WEIGHTS: Readonly<Partial<Record<BodyId, number>>> = {
  sun: 3,
  moon: 3,
  mercury: 2,
  venus: 2,
  mars: 2,
  jupiter: 1.5,
  saturn: 1.5,
  uranus: 1,
  neptune: 1,
  pluto: 1,
};

export type ElementBalance = Record<Element, number>;
export type ModalityBalance = Record<Modality, number>;
export type PolarityBalance = Record<Polarity, number>;

export type ChartShape =
  | "bundle"
  | "bowl"
  | "bucket"
  | "locomotive"
  | "seesaw"
  | "splash"
  | "splay";

export interface Stellium {
  kind: "sign" | "house";
  /** Sign name, or house number as a string. */
  key: string;
  bodies: BodyId[];
}

export interface ShapeResult {
  shape: ChartShape;
  /** The isolated body, for bucket patterns. */
  handle: BodyId | null;
  /** Degrees of the occupied arc. */
  span: number;
  /** Degrees of the widest empty arc. */
  largestGap: number;
}

export interface ChartSignals {
  elements: ElementBalance;
  modalities: ModalityBalance;
  polarities: PolarityBalance;
  dominantElement: Element;
  dominantModality: Modality;
  /** Ruler of the Ascendant's sign — the chart's "driver". */
  chartRuler: BodyId | null;
  chartRulerSign: ZodiacSign | null;
  chartRulerHouse: number | null;
  stelliums: Stellium[];
  /** Bodies in the 1st, 4th, 7th or 10th — the loudest placements. */
  angularBodies: BodyId[];
  /** Bodies in the sign they rule, which anchor dispositor chains. */
  finalDispositors: BodyId[];
  shape: ShapeResult;
}

function emptyElements(): ElementBalance {
  return { fire: 0, earth: 0, air: 0, water: 0 };
}

function emptyModalities(): ModalityBalance {
  return { cardinal: 0, fixed: 0, mutable: 0 };
}

function normalize(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

function interpreted(bodies: readonly BodyPosition[]): BodyPosition[] {
  const allowed = new Set(INTERPRETED_BODIES);
  return bodies.filter((b) => allowed.has(b.id));
}

export function elementBalance(
  bodies: readonly BodyPosition[],
  weights: Readonly<Partial<Record<BodyId, number>>> = DEFAULT_BODY_WEIGHTS,
): ElementBalance {
  const totals = emptyElements();
  for (const body of interpreted(bodies)) {
    const weight = weights[body.id] ?? 1;
    totals[SIGN_ELEMENT[signFromLongitude(body.longitude)]] += weight;
  }
  return totals;
}

export function modalityBalance(
  bodies: readonly BodyPosition[],
  weights: Readonly<Partial<Record<BodyId, number>>> = DEFAULT_BODY_WEIGHTS,
): ModalityBalance {
  const totals = emptyModalities();
  for (const body of interpreted(bodies)) {
    const weight = weights[body.id] ?? 1;
    totals[SIGN_MODALITY[signFromLongitude(body.longitude)]] += weight;
  }
  return totals;
}

export function polarityBalance(
  bodies: readonly BodyPosition[],
  weights: Readonly<Partial<Record<BodyId, number>>> = DEFAULT_BODY_WEIGHTS,
): PolarityBalance {
  const totals: PolarityBalance = { positive: 0, negative: 0 };
  for (const body of interpreted(bodies)) {
    const weight = weights[body.id] ?? 1;
    totals[SIGN_POLARITY[signFromLongitude(body.longitude)]] += weight;
  }
  return totals;
}

function dominantKey<K extends string>(totals: Record<K, number>): K {
  const entries = Object.entries(totals) as Array<[K, number]>;
  // Ties resolve to the first in canonical order, which keeps output stable.
  return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
}

/** Groups of three or more bodies sharing a sign, or a house. */
export function findStelliums(
  bodies: readonly BodyPosition[],
  houses: HouseCusps | null,
  minimum = 3,
): Stellium[] {
  const found: Stellium[] = [];
  const list = interpreted(bodies);

  const bySign = new Map<string, BodyId[]>();
  for (const body of list) {
    const sign = signFromLongitude(body.longitude);
    const bucket = bySign.get(sign) ?? [];
    bucket.push(body.id);
    bySign.set(sign, bucket);
  }
  for (const [sign, members] of bySign) {
    if (members.length >= minimum) {
      found.push({ kind: "sign", key: sign, bodies: members });
    }
  }

  // Houses are only meaningful when the birth time is known, so the caller
  // passes null to suppress them rather than us inventing a placement.
  if (houses && houses.cusps.length === 12) {
    const byHouse = new Map<number, BodyId[]>();
    for (const body of list) {
      const house = houseOfLongitude(body.longitude, houses.cusps);
      const bucket = byHouse.get(house) ?? [];
      bucket.push(body.id);
      byHouse.set(house, bucket);
    }
    for (const [house, members] of byHouse) {
      if (members.length >= minimum) {
        found.push({ kind: "house", key: String(house), bodies: members });
      }
    }
  }

  return found;
}

/** Bodies occupying the sign they rule; dispositor chains terminate on these. */
export function findFinalDispositors(bodies: readonly BodyPosition[]): BodyId[] {
  return interpreted(bodies)
    .filter((b) => SIGN_RULER[signFromLongitude(b.longitude)] === b.id)
    .map((b) => b.id);
}

/**
 * Classifies the chart's overall distribution (the Jones patterns).
 *
 * Works from the sorted gaps between consecutive bodies: the widest empty arc
 * determines how concentrated the chart is, and the runner-up distinguishes a
 * bucket's isolated handle from a genuine two-group seesaw.
 */
export function chartShape(bodies: readonly BodyPosition[]): ShapeResult {
  const list = interpreted(bodies);
  if (list.length < 3) {
    return { shape: "splay", handle: null, span: 0, largestGap: 0 };
  }

  const sorted = [...list].sort((a, b) => a.longitude - b.longitude);
  const gaps = sorted.map((body, i) =>
    normalize(sorted[(i + 1) % sorted.length]!.longitude - body.longitude),
  );

  const largestGap = Math.max(...gaps);
  const span = 360 - largestGap;
  const wideGaps = gaps.filter((g) => g >= 60);

  // A bucket is a cluster plus one body standing alone opposite it. Test it
  // before the coarse span thresholds, since the handle inflates the span.
  const handle = findBucketHandle(sorted);
  if (handle && span > 180) {
    return { shape: "bucket", handle, span, largestGap };
  }

  let shape: ChartShape;
  if (span <= 120) shape = "bundle";
  else if (span <= 180) shape = "bowl";
  else if (wideGaps.length === 2) shape = "seesaw";
  else if (span <= 240) shape = "locomotive";
  else if (largestGap < 60) shape = "splash";
  else shape = "splay";

  return { shape, handle: null, span, largestGap };
}

/**
 * Finds the single body that, if removed, leaves the rest inside a 180-degree
 * bowl — and which is itself well clear of that bowl.
 */
function findBucketHandle(sorted: readonly BodyPosition[]): BodyId | null {
  for (let i = 0; i < sorted.length; i += 1) {
    const candidate = sorted[i]!;
    const rest = sorted.filter((_, idx) => idx !== i);
    if (rest.length < 2) continue;

    const restGaps = rest.map((body, j) =>
      normalize(rest[(j + 1) % rest.length]!.longitude - body.longitude),
    );
    const restSpan = 360 - Math.max(...restGaps);
    if (restSpan > 180) continue;

    // The handle must be genuinely separated, not just at the bowl's rim.
    const separations = rest.map((body) => {
      const d = normalize(candidate.longitude - body.longitude);
      return Math.min(d, 360 - d);
    });
    if (Math.min(...separations) >= 60) return candidate.id;
  }
  return null;
}

export function chartSignals(
  bodies: readonly BodyPosition[],
  houses: HouseCusps | null,
  weights: Readonly<Partial<Record<BodyId, number>>> = DEFAULT_BODY_WEIGHTS,
): ChartSignals {
  const elements = elementBalance(bodies, weights);
  const modalities = modalityBalance(bodies, weights);
  const polarities = polarityBalance(bodies, weights);

  let chartRuler: BodyId | null = null;
  let chartRulerSign: ZodiacSign | null = null;
  let chartRulerHouse: number | null = null;

  if (houses) {
    chartRuler = SIGN_RULER[signFromLongitude(houses.ascendant)];
    const rulerBody = bodies.find((b) => b.id === chartRuler);
    if (rulerBody) {
      chartRulerSign = signFromLongitude(rulerBody.longitude);
      if (houses.cusps.length === 12) {
        chartRulerHouse = houseOfLongitude(rulerBody.longitude, houses.cusps);
      }
    }
  }

  const angularBodies =
    houses && houses.cusps.length === 12
      ? interpreted(bodies)
          .filter(
            (b) => quadrantOf(houseOfLongitude(b.longitude, houses.cusps)) === "angular",
          )
          .map((b) => b.id)
      : [];

  return {
    elements,
    modalities,
    polarities,
    dominantElement: dominantKey(elements),
    dominantModality: dominantKey(modalities),
    chartRuler,
    chartRulerSign,
    chartRulerHouse,
    stelliums: findStelliums(bodies, houses),
    angularBodies,
    finalDispositors: findFinalDispositors(bodies),
    shape: chartShape(bodies),
  };
}
