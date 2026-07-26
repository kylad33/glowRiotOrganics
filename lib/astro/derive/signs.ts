/**
 * Zodiac sign derivation and the fixed correspondences that hang off it.
 *
 * Pure functions over ecliptic longitude — no engine, no dates. The synthesis
 * layer keys off the tables here, so they are the single source of truth for
 * element, modality and rulership.
 */

import {
  SIGNS,
  type BodyId,
  type Element,
  type Modality,
  type Polarity,
  type ZodiacSign,
} from "@/lib/astro/types";

export const DEGREES_PER_SIGN = 30;

/** Which sign a given ecliptic longitude falls in. */
export function signFromLongitude(longitude: number): ZodiacSign {
  const normalized = ((longitude % 360) + 360) % 360;
  const index = Math.floor(normalized / DEGREES_PER_SIGN) % 12;
  return SIGNS[index]!;
}

/** Position within the sign, 0 to <30 degrees. */
export function degreeInSign(longitude: number): number {
  const normalized = ((longitude % 360) + 360) % 360;
  return normalized % DEGREES_PER_SIGN;
}

/** Ecliptic longitude at which a sign begins. */
export function signStartLongitude(sign: ZodiacSign): number {
  return SIGNS.indexOf(sign) * DEGREES_PER_SIGN;
}

export const SIGN_ELEMENT: Record<ZodiacSign, Element> = {
  aries: "fire",
  taurus: "earth",
  gemini: "air",
  cancer: "water",
  leo: "fire",
  virgo: "earth",
  libra: "air",
  scorpio: "water",
  sagittarius: "fire",
  capricorn: "earth",
  aquarius: "air",
  pisces: "water",
};

export const SIGN_MODALITY: Record<ZodiacSign, Modality> = {
  aries: "cardinal",
  taurus: "fixed",
  gemini: "mutable",
  cancer: "cardinal",
  leo: "fixed",
  virgo: "mutable",
  libra: "cardinal",
  scorpio: "fixed",
  sagittarius: "mutable",
  capricorn: "cardinal",
  aquarius: "fixed",
  pisces: "mutable",
};

/** Fire and air are traditionally active/positive; earth and water receptive. */
export const SIGN_POLARITY: Record<ZodiacSign, Polarity> = {
  aries: "positive",
  taurus: "negative",
  gemini: "positive",
  cancer: "negative",
  leo: "positive",
  virgo: "negative",
  libra: "positive",
  scorpio: "negative",
  sagittarius: "positive",
  capricorn: "negative",
  aquarius: "positive",
  pisces: "negative",
};

/** Modern rulerships, assigning the outer planets. */
export const SIGN_RULER: Record<ZodiacSign, BodyId> = {
  aries: "mars",
  taurus: "venus",
  gemini: "mercury",
  cancer: "moon",
  leo: "sun",
  virgo: "mercury",
  libra: "venus",
  scorpio: "pluto",
  sagittarius: "jupiter",
  capricorn: "saturn",
  aquarius: "uranus",
  pisces: "neptune",
};

/**
 * Traditional rulerships, using only the seven visible bodies. Every sign but
 * Leo and Cancer shares its ruler with one other sign.
 */
export const TRADITIONAL_SIGN_RULER: Record<ZodiacSign, BodyId> = {
  aries: "mars",
  taurus: "venus",
  gemini: "mercury",
  cancer: "moon",
  leo: "sun",
  virgo: "mercury",
  libra: "venus",
  scorpio: "mars",
  sagittarius: "jupiter",
  capricorn: "saturn",
  aquarius: "saturn",
  pisces: "jupiter",
};

export function elementOf(longitude: number): Element {
  return SIGN_ELEMENT[signFromLongitude(longitude)];
}

export function modalityOf(longitude: number): Modality {
  return SIGN_MODALITY[signFromLongitude(longitude)];
}

/** Formats a longitude as degrees, minutes and seconds within its sign. */
export function formatDegreeInSign(longitude: number): string {
  const inSign = degreeInSign(longitude);
  const degrees = Math.floor(inSign);
  const minutesFloat = (inSign - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.round((minutesFloat - minutes) * 60);

  // Rounding seconds can carry into minutes and degrees.
  let d = degrees;
  let m = minutes;
  let s = seconds;
  if (s === 60) {
    s = 0;
    m += 1;
  }
  if (m === 60) {
    m = 0;
    d += 1;
  }

  return `${d}°${String(m).padStart(2, "0")}'${String(s).padStart(2, "0")}"`;
}
