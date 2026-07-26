# glowRiot Natal

An interactive 3D natal chart system: enter a birth date, exact time and place,
and explore the sky as it was at that moment — Sun, Moon, Rising and the
planets by sign and house — rendered as a navigable celestial sphere, with
interpretation covering personality, relationships, career and life themes.

Status: **Milestone 1 complete.** The astronomy core is built and tested. UI
and the 3D scene come next.

## Why the architecture looks like this

Planetary positions are a solved problem. The two things that actually break
astrology software are handled explicitly here.

**Local birth time to UTC.** This needs the IANA zone at that place on that
date, including historical DST. Pre-1970 tzdata is approximate — it is not a
faithful record of local civil timekeeping, which is why professional software
licenses the ACS Atlas. `resolveBirthTime` therefore reports which offset it
used, where that came from, and what it is uncertain about, and accepts an
explicit override. Callers surface `warnings` rather than presenting a
possibly-wrong chart as fact.

**Unknown birth time.** Houses, Ascendant and MC are meaningless without an
exact time, and the Moon can change sign within a day. Setting `timeKnown:
false` charts at local noon and emits a `time-unknown` warning; downstream code
must suppress houses and angles rather than defaulting to noon silently.

## Ephemeris licensing

Swiss Ephemeris is dual-licensed: free under **AGPL**, or a paid Professional
License (~CHF 700–750 one-time). AGPL covers network use, so a hosted web app
using it under AGPL must release its entire source. Astrodienst requires the
choice to be made *before* any public service goes live.

The default engine is therefore the **public-domain Moshier** implementation
(Unlicense), accurate to roughly an arcsecond — far below the threshold at
which any reading would differ. Swiss Ephemeris can be dropped in behind the
same `EphemerisEngine` interface if precision or the 8000-year range ever
justifies the license. That interface is the entire reason this decision is not
on the critical path.

## Layout

```
lib/astro/
  types.ts              domain types; no library types cross this boundary
  time.ts               local civil time -> UTC -> Julian Day, with warnings
  geo.ts                coordinates -> IANA zone (server only)
  ephemeris/
    types.ts            EphemerisEngine — the swap point
    moshier.ts          default engine
  derive/               pure, heavily tested
    signs.ts            sign, element, modality, rulership
    houses.ts           house placement
    aspects.ts          aspects, orbs, applying/separating
    patterns.ts         synthesis signals for interpretation
```

### Two things worth knowing before editing `moshier.ts`

1. `Origin` derives its own timezone from lat/lon and exposes no offset
   parameter, so the instant is **back-solved** by inverting that conversion.
   The repeated hour of a DST fall-back is genuinely unreachable this way — the
   library always resolves an ambiguous wall clock to the first occurrence — so
   it falls back to a probe longitude and corrects sidereal time via
   `LST = GMST(UTC) + longitude`. Latitude is never altered, so houses are
   unaffected.

2. Per-body result shapes are inconsistent. Longitude is uniform, but latitude
   and distance live under different keys, in radians, with the Moon's distance
   in Earth radii rather than AU. **Do not use `position.polar`** — it is
   geocentric for the Moon and heliocentric for the outer planets.

### A constraint the 3D layer must respect

Placidus, Koch and Topocentric divide *time*, not space. Their cusps are points
on the ecliptic with no great-circle boundary, so rendering them as planes
would present an invented shape as though it were the real division. Check
`hasGreatCircleBoundaries()` before drawing house geometry.

## Testing

```bash
npm test          # 171 tests
npm run typecheck
```

Correctness is validated against physically defined reference points rather
than values echoed back from the library: the Sun's apparent longitude is
exactly 0/90/180/270 degrees at the equinoxes and solstices. Also covered are
orbital-inclination bounds on ecliptic latitude (which catch the
geocentric/heliocentric mix-up above), known retrograde periods, house-cusp
invariants across all seven systems, and historical DST traps including the US
1974 early-DST start and the 1940 Paris shift.
