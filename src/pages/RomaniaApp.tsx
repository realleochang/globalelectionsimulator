import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── Party types ────────────────────────────────────────────────────────────────
type RoPartyId = 'PSD' | 'AUR' | 'PNL' | 'USR' | 'UDMR' | 'SOS' | 'POT';

type RoParty = {
  id: RoPartyId;
  name: string;
  fullName: string;
  color: string;
  seats2024: number;
  // Current (2026) leader + photo
  leader: string;
  wikiTitle?: string;
  // Dec-2024 baseline leader + photo
  leader2024: string;
  wikiTitle2024?: string;
  // Threshold category:
  //   'standard'  → must clear 5% national hurdle
  //   'regional'  → may also qualify via ≥20% in ≥4 counties (alt. threshold)
  //   'minority'  → constitutionally reserved seat (bypasses threshold entirely)
  thresholdType?: 'standard' | 'regional' | 'minority';
};

const RO_PARTIES: RoParty[] = [
  { id: 'PSD',  name: 'PSD',  fullName: 'Social Democratic Party',
    color: '#CC0000', seats2024: 86,
    leader: 'Sorin Grindeanu',      wikiTitle: 'Sorin_Grindeanu',
    leader2024: 'Marcel Ciolacu',   wikiTitle2024: 'Marcel_Ciolacu' },
  { id: 'AUR',  name: 'AUR',  fullName: 'Alliance for the Union of Romanians',
    color: '#C8960C', seats2024: 63,
    leader: 'George Simion',        wikiTitle: 'George_Simion',
    leader2024: 'George Simion',    wikiTitle2024: 'George_Simion' },
  { id: 'PNL',  name: 'PNL',  fullName: 'National Liberal Party',
    color: '#F9A800', seats2024: 49,
    leader: 'Ilie Bolojan',         wikiTitle: 'Ilie_Bolojan',
    leader2024: 'Nicolae Ciucă',    wikiTitle2024: 'Nicolae_Ciucă' },
  { id: 'USR',  name: 'USR',  fullName: 'Save Romania Union',
    color: '#003DA5', seats2024: 40,
    leader: 'Dominic Fritz',        wikiTitle: 'Dominic_Fritz',
    leader2024: 'Elena Lasconi',    wikiTitle2024: 'Elena_Lasconi' },
  { id: 'SOS',  name: 'SOS',  fullName: 'SOS Romania',
    color: '#B71C1C', seats2024: 28,
    leader: 'Diana Șoșoacă',        wikiTitle: 'Diana_Șoșoacă',
    leader2024: 'Diana Șoșoacă',    wikiTitle2024: 'Diana_Șoșoacă' },
  { id: 'POT',  name: 'POT',  fullName: 'Party of Young People',
    color: '#E65100', seats2024: 24,
    leader: 'Anamaria Gavrilă',     wikiTitle: 'Anamaria_Gavrilă',
    leader2024: 'Anamaria Gavrilă', wikiTitle2024: 'Anamaria_Gavrilă' },
  { id: 'UDMR', name: 'UDMR', fullName: 'Dem. Union of Hungarians in Romania',
    color: '#2E7D32', seats2024: 22,
    thresholdType: 'regional',
    leader: 'Kelemen Hunor',        wikiTitle: 'Kelemen_Hunor',
    leader2024: 'Kelemen Hunor',    wikiTitle2024: 'Kelemen_Hunor' },
];

const RO_PARTY_MAP = Object.fromEntries(RO_PARTIES.map(p => [p.id, p])) as Record<RoPartyId, RoParty>;

// ── Seat-count constants ───────────────────────────────────────────────────────
// Romania's Camera Deputaților 2024: 331 total seats
//   • 312 contested proportionally (308 county Hare-quota seats + 4 diaspora seats, all via two-stage PR)
//   • 19 reserved for national minority organisations (1 seat each, bypasses the vote threshold)
// Majority = floor(331/2)+1 = 166 (always calculated from the full 331-seat chamber)
const RO_PROP_SEATS     = 312;   // proportional seats — parties compete for these (308 county + 4 diaspora)
const RO_MINORITY_SEATS = 19;    // fixed minority seats — always present, not proportional
const RO_CAMERA_SEATS   = RO_PROP_SEATS + RO_MINORITY_SEATS;  // 331 total
const RO_CAMERA_MAJORITY = 166;
const RO_THRESHOLD       = 5.0;

// ── Real 2024 national results (Camera Deputaților) ───────────────────────────
// Source: Permanent Electoral Authority / Wikipedia official count
// Percentages are % of ALL valid votes cast (sub-threshold parties account for the remaining ~14%)
const RO_VOTE_PCT_2024: Record<RoPartyId, number> = {
  PSD: 21.96, AUR: 18.01, PNL: 13.20, USR: 12.40, SOS: 7.36, POT: 6.46, UDMR: 6.33,
};

// ── 2026 polling average ───────────────────────────────────────────────────────
// Average of 8 polls (Mar–May 2026): INSCOP, CURS, Avangarde, Sociopol, ARP, IRES
// AUR surges to ~35%; SOS and POT both fall below the 5% threshold
const RO_VOTE_PCT_2026_POLLING: Record<RoPartyId, number> = {
  AUR: 35.5, PSD: 20.2, PNL: 17.0, USR: 11.6, UDMR: 4.6, SOS: 3.2, POT: 2.1,
};
const RO_VOTE_RAW_2024: Record<RoPartyId, number> = {
  PSD: 2_030_144, AUR: 1_665_143, PNL: 1_219_810, USR: 1_146_357,
  SOS: 679_967, POT: 596_745, UDMR: 585_397,
};
// Total valid votes cast (including sub-threshold parties) — used for raw-vote scaling
const RO_GRAND_TOTAL_VOTES = 9_243_641;

// ── County types ───────────────────────────────────────────────────────────────
type RoCountyId =
  'AB'|'AR'|'AG'|'BC'|'BH'|'BN'|'BT'|'BR'|'BV'|'B'|
  'BZ'|'CL'|'CS'|'CJ'|'CT'|'CV'|'DB'|'DJ'|'GL'|'GR'|
  'GJ'|'HR'|'HD'|'IL'|'IS'|'IF'|'MM'|'MH'|'MS'|'NT'|
  'OT'|'PH'|'SJ'|'SM'|'SB'|'SV'|'TR'|'TM'|'TL'|'VL'|'VS'|'VN';

type RoCounty = { id: RoCountyId; name: string; pop: number };

const RO_COUNTIES: RoCounty[] = [
  { id: 'AB', name: 'Alba',              pop:  360_000 },
  { id: 'AR', name: 'Arad',              pop:  450_000 },
  { id: 'AG', name: 'Argeș',             pop:  640_000 },
  { id: 'BC', name: 'Bacău',             pop:  640_000 },
  { id: 'BH', name: 'Bihor',             pop:  600_000 },
  { id: 'BN', name: 'Bistrița-Năsăud',  pop:  310_000 },
  { id: 'BT', name: 'Botoșani',          pop:  450_000 },
  { id: 'BR', name: 'Brăila',            pop:  335_000 },
  { id: 'BV', name: 'Brașov',            pop:  640_000 },
  { id: 'B',  name: 'București',         pop: 2_100_000 },
  { id: 'BZ', name: 'Buzău',             pop:  450_000 },
  { id: 'CL', name: 'Călărași',          pop:  315_000 },
  { id: 'CS', name: 'Caraș-Severin',     pop:  320_000 },
  { id: 'CJ', name: 'Cluj',              pop:  800_000 },
  { id: 'CT', name: 'Constanța',         pop:  780_000 },
  { id: 'CV', name: 'Covasna',           pop:  215_000 },
  { id: 'DB', name: 'Dâmbovița',         pop:  550_000 },
  { id: 'DJ', name: 'Dolj',              pop:  670_000 },
  { id: 'GL', name: 'Galați',            pop:  640_000 },
  { id: 'GR', name: 'Giurgiu',           pop:  280_000 },
  { id: 'GJ', name: 'Gorj',              pop:  340_000 },
  { id: 'HR', name: 'Harghita',          pop:  330_000 },
  { id: 'HD', name: 'Hunedoara',         pop:  420_000 },
  { id: 'IL', name: 'Ialomița',          pop:  285_000 },
  { id: 'IS', name: 'Iași',              pop:  880_000 },
  { id: 'IF', name: 'Ilfov',             pop:  490_000 },
  { id: 'MM', name: 'Maramureș',         pop:  520_000 },
  { id: 'MH', name: 'Mehedinți',         pop:  285_000 },
  { id: 'MS', name: 'Mureș',             pop:  570_000 },
  { id: 'NT', name: 'Neamț',             pop:  455_000 },
  { id: 'OT', name: 'Olt',              pop:  400_000 },
  { id: 'PH', name: 'Prahova',           pop:  820_000 },
  { id: 'SJ', name: 'Sălaj',             pop:  240_000 },
  { id: 'SM', name: 'Satu Mare',         pop:  350_000 },
  { id: 'SB', name: 'Sibiu',             pop:  440_000 },
  { id: 'SV', name: 'Suceava',           pop:  700_000 },
  { id: 'TR', name: 'Teleorman',         pop:  380_000 },
  { id: 'TM', name: 'Timiș',             pop:  760_000 },
  { id: 'TL', name: 'Tulcea',            pop:  250_000 },
  { id: 'VL', name: 'Vâlcea',            pop:  400_000 },
  { id: 'VS', name: 'Vaslui',            pop:  450_000 },
  { id: 'VN', name: 'Vrancea',           pop:  385_000 },
];
const RO_COUNTY_MAP = Object.fromEntries(RO_COUNTIES.map(c => [c.id, c])) as Record<RoCountyId, RoCounty>;

// GeoJSON `name` property → county ID
const RO_NAME_TO_ID: Record<string, RoCountyId> = {
  'Alba': 'AB',          'Arad': 'AR',           'Arges': 'AG',          'Bacau': 'BC',
  'Bihor': 'BH',         'Bistrita-Nasaud': 'BN', 'Botosani': 'BT',       'Braila': 'BR',
  'Brasov': 'BV',        'Bucuresti': 'B',        'Buzau': 'BZ',          'Calarasi': 'CL',
  'Caras-Severin': 'CS', 'Cluj': 'CJ',            'Constanta': 'CT',      'Covasna': 'CV',
  'Dambovita': 'DB',     'Dolj': 'DJ',            'Galati': 'GL',         'Giurgiu': 'GR',
  'Gorj': 'GJ',          'Harghita': 'HR',        'Hunedoara': 'HD',      'Ialomita': 'IL',
  'Iasi': 'IS',          'Ilfov': 'IF',           'Maramures': 'MM',      'Mehedinti': 'MH',
  'Mures': 'MS',         'Neamt': 'NT',           'Olt': 'OT',            'Prahova': 'PH',
  'Salaj': 'SJ',         'Satu Mare': 'SM',       'Sibiu': 'SB',          'Suceava': 'SV',
  'Teleorman': 'TR',     'Timis': 'TM',           'Tulcea': 'TL',         'Valcea': 'VL',
  'Vaslui': 'VS',        'Vrancea': 'VN',
};

// ── Official valid votes cast per county (Camera Deputaților 2024) ────────────
// Source: rezultatevot.ro API, election ID 93, fetched May 2026
const RO_COUNTY_VALID_VOTES_2024: Record<RoCountyId, number> = {
  AB: 156_641, AR: 180_523, AG: 265_229, BC: 237_158, BH: 275_704,
  BN: 122_418, BT: 148_132, BR: 124_366, BV: 258_512, B:  859_470,
  BZ: 181_880, CL: 107_842, CS: 105_736, CJ: 335_422, CT: 286_738,
  CV:  94_180, DB: 201_333, DJ: 276_240, GL: 215_575, GR: 104_466,
  GJ: 147_707, HR: 152_826, HD: 175_216, IL:  90_599, IS: 323_080,
  IF: 227_456, MM: 181_442, MH: 112_690, MS: 233_574, NT: 189_511,
  OT: 175_454, PH: 309_352, SJ: 102_204, SM: 137_384, SB: 179_655,
  SV: 263_887, TR: 131_463, TM: 303_386, TL:  78_492, VL: 154_155,
  VS: 135_275, VN: 133_444,
};

// Sum of all 42 county valid votes (excludes ~767k diaspora) — used for reporting % widget
const RO_TOTAL_MAINLAND_VOTES = Object.values(RO_COUNTY_VALID_VOTES_2024).reduce((s, v) => s + v, 0);

// ── Official Camera Deputaților seats per county (2024) ───────────────────────
// Source: Romanian Electoral Authority (AEP) — constituency mandates, 2024 election.
// 42 counties sum to 308 mainland seats; + 4 diaspora (Constituency 43) = 312 proportional.
// Plus 19 minority reserved seats → 331 total Camera seats.
// Diaspora seats fall into Stage 2 redistribution (not modelled county-by-county).
const RO_COUNTY_CAMERA_SEATS: Partial<Record<RoCountyId, number>> = {
  //           Seats
  AB:  5,  // Alba
  AR:  7,  // Arad
  AG:  9,  // Argeș
  BC: 10,  // Bacău
  BH:  9,  // Bihor
  BN:  5,  // Bistrița-Năsăud
  BT:  6,  // Botoșani
  BR:  5,  // Brăila
  BV:  9,  // Brașov
  B:  29,  // Bucharest (Constituency 42)
  BZ:  7,  // Buzău
  CL:  4,  // Călărași
  CS:  5,  // Caraș-Severin
  CJ: 10,  // Cluj
  CT: 11,  // Constanța
  CV:  4,  // Covasna
  DB:  7,  // Dâmbovița
  DJ: 10,  // Dolj
  GL:  9,  // Galați
  GJ:  5,  // Gorj
  GR:  4,  // Giurgiu
  HD:  6,  // Hunedoara
  HR:  5,  // Harghita
  IF:  5,  // Ilfov
  IL:  4,  // Ialomița
  IS: 12,  // Iași
  MH:  4,  // Mehedinți
  MM:  7,  // Maramureș
  MS:  8,  // Mureș
  NT:  8,  // Neamț
  OT:  6,  // Olt
  PH: 11,  // Prahova
  SB:  6,  // Sibiu
  SJ:  4,  // Sălaj
  SM:  5,  // Satu Mare
  SV: 10,  // Suceava
  TL:  4,  // Tulcea
  TM: 10,  // Timiș
  TR:  5,  // Teleorman
  VL:  6,  // Vâlcea
  VN:  5,  // Vrancea
  VS:  7,  // Vaslui
  // Total: 308 mainland seats
};

// ── 2024 county results — official percentages of all valid votes cast ────────
// Source: rezultatevot.ro API, election ID 93, fetched May 2026
// POT absent from GL/IL/MS — party did not field candidates in those counties
const RO_COUNTY_RESULTS_2024: Record<RoCountyId, Partial<Record<RoPartyId, number>>> = {
  AB: { PSD:17.23, AUR:19.17, PNL:23.40, USR: 8.64, SOS: 5.16, POT: 9.20, UDMR: 3.65 },
  AR: { PSD:15.61, AUR:23.50, PNL:19.88, USR: 9.03, SOS: 7.27, POT: 7.05, UDMR: 7.12 },
  AG: { PSD:27.49, AUR:20.75, PNL:10.74, USR:11.62, SOS: 6.44, POT: 8.12, UDMR: 0.15 },
  BC: { PSD:23.91, AUR:17.26, PNL:11.23, USR:10.53, SOS:10.51, POT: 6.41, UDMR: 1.38 },
  BH: { PSD:13.22, AUR:11.39, PNL:32.04, USR: 3.09, SOS: 3.53, POT: 4.36, UDMR:22.55 },
  BN: { PSD:31.29, AUR:16.97, PNL:15.64, USR: 6.78, SOS: 5.92, POT: 8.52, UDMR: 4.61 },
  BT: { PSD:30.94, AUR:18.90, PNL:18.14, USR: 5.18, SOS: 7.89, POT: 6.37, UDMR: 0.57 },
  BR: { PSD:30.56, AUR:18.49, PNL:14.62, USR: 7.51, SOS: 9.68, POT: 5.53, UDMR: 0.31 },
  BV: { PSD:17.37, AUR:15.66, PNL:15.48, USR:19.22, SOS: 5.99, POT: 6.16, UDMR: 5.68 },
  B:  { PSD:21.81, AUR:12.60, PNL:13.50, USR:23.44, SOS: 6.13, POT: 5.16, UDMR: 0.35 },
  BZ: { PSD:43.43, AUR:15.12, PNL: 7.99, USR: 7.56, SOS: 6.25, POT: 5.97, UDMR: 0.21 },
  CL: { PSD:30.16, AUR:21.34, PNL:17.24, USR: 6.35, SOS: 7.78, POT: 5.10, UDMR: 0.27 },
  CS: { PSD:29.68, AUR:20.39, PNL:12.15, USR: 6.91, SOS: 6.17, POT: 6.69, UDMR: 1.05 },
  CJ: { PSD:13.50, AUR:14.41, PNL:19.78, USR:14.91, SOS: 4.21, POT: 5.12, UDMR:12.87 },
  CT: { PSD:18.20, AUR:20.29, PNL:13.03, USR:13.12, SOS:10.41, POT: 6.77, UDMR: 0.30 },
  CV: { PSD: 5.44, AUR: 4.20, PNL: 2.90, USR: 2.57, SOS: 1.64, POT: 1.24, UDMR:76.95 },
  DB: { PSD:35.24, AUR:17.84, PNL:11.95, USR: 8.57, SOS: 7.62, POT: 7.91, UDMR: 0.16 },
  DJ: { PSD:41.26, AUR:17.67, PNL:11.60, USR: 9.17, SOS: 4.48, POT: 5.99, UDMR: 0.24 },
  GL: { PSD:29.84, AUR:21.12, PNL:10.57, USR:10.83, SOS: 8.86,             UDMR: 0.34 },
  GR: { PSD:19.46, AUR:18.50, PNL:34.73, USR: 5.46, SOS: 6.74, POT: 5.63, UDMR: 0.25 },
  GJ: { PSD:33.92, AUR:25.99, PNL:10.15, USR: 9.55, SOS: 4.96, POT: 6.50, UDMR: 0.48 },
  HR: { PSD: 3.00, AUR: 2.32, PNL: 1.52, USR: 1.13, SOS: 0.94, POT: 0.76, UDMR:88.00 },
  HD: { PSD:26.30, AUR:20.03, PNL:13.86, USR: 8.24, SOS: 5.94, POT: 9.36, UDMR: 2.94 },
  IL: { PSD:34.49, AUR:23.69, PNL: 8.78, USR: 8.05, SOS:10.38,             UDMR: 0.36 },
  IS: { PSD:21.39, AUR:16.64, PNL:14.59, USR:14.04, SOS: 7.66, POT: 6.00, UDMR: 0.32 },
  IF: { PSD:14.50, AUR:17.84, PNL:20.50, USR:17.63, SOS: 6.71, POT: 7.96, UDMR: 0.21 },
  MM: { PSD:21.55, AUR:17.84, PNL:13.97, USR: 9.62, SOS: 5.38, POT: 5.65, UDMR: 6.14 },
  MH: { PSD:41.05, AUR:20.60, PNL:16.20, USR: 4.70, SOS: 5.30, POT: 5.04, UDMR: 0.23 },
  MS: { PSD:13.87, AUR:13.87, PNL:10.12, USR: 7.62, SOS: 5.07,             UDMR:39.12 },
  NT: { PSD:23.99, AUR:21.45, PNL:12.60, USR: 9.89, SOS: 9.44, POT: 6.46, UDMR: 0.75 },
  OT: { PSD:41.30, AUR:18.03, PNL:10.25, USR: 6.03, SOS: 6.04, POT: 5.93, UDMR: 0.17 },
  PH: { PSD:23.48, AUR:17.00, PNL:13.22, USR:11.56, SOS: 8.16, POT: 9.22, UDMR: 0.23 },
  SJ: { PSD:20.70, AUR:12.67, PNL:18.17, USR: 6.81, SOS: 3.77, POT: 4.83, UDMR:24.29 },
  SM: { PSD:12.52, AUR: 9.88, PNL:13.33, USR: 5.98, SOS: 3.64, POT: 3.83, UDMR:41.55 },
  SB: { PSD:14.22, AUR:16.99, PNL:18.99, USR:16.22, SOS: 7.73, POT: 7.47, UDMR: 1.89 },
  SV: { PSD:21.02, AUR:25.26, PNL:12.48, USR: 6.96, SOS: 8.95, POT: 6.63, UDMR: 0.39 },
  TR: { PSD:40.32, AUR:17.29, PNL:14.26, USR: 5.46, SOS: 5.34, POT: 4.98, UDMR: 0.24 },
  TM: { PSD:18.03, AUR:18.38, PNL:12.63, USR:19.59, SOS: 6.83, POT: 6.45, UDMR: 3.01 },
  TL: { PSD:23.98, AUR:22.84, PNL:10.24, USR: 8.34, SOS:10.53, POT: 7.46, UDMR: 0.34 },
  VL: { PSD:29.12, AUR:21.65, PNL:12.56, USR: 7.43, SOS: 5.77, POT: 6.34, UDMR: 0.25 },
  VS: { PSD:30.53, AUR:18.21, PNL: 8.34, USR: 9.76, SOS: 7.97, POT: 5.98, UDMR: 0.40 },
  VN: { PSD:25.28, AUR:20.47, PNL:17.19, USR: 7.13, SOS: 6.30, POT: 5.34, UDMR: 0.20 },
};

// Returns each party's estimated % of ALL valid votes in the county (sums to ≤100, not forced to 100).
// Parties absent from real county data get a small estimated baseline drawn from the
// "other votes" remainder, split proportionally to their national share — so the
// swing model always has something to scale from.
function calcCountyVotes(natPcts: Record<RoPartyId, number>, countyId: RoCountyId): Record<RoPartyId, number> {
  const base = RO_COUNTY_RESULTS_2024[countyId];

  // How much of the county vote our 7 parties explicitly captured in real data
  const capturedSum = RO_PARTIES.reduce((s, p) => s + (base[p.id] ?? 0), 0);
  // The remainder went to sub-threshold parties outside our 7
  const remainderPct = Math.max(0, 100 - capturedSum);

  // National share of the unlisted group — used to split the remainder
  const unlistedNatSum = RO_PARTIES
    .filter(p => !((base[p.id] ?? 0) > 0))
    .reduce((s, p) => s + (RO_VOTE_PCT_2024[p.id] ?? 0), 0);

  const raw: Record<RoPartyId, number> = {} as Record<RoPartyId, number>;
  let newTotal = 0;

  for (const p of RO_PARTIES) {
    const oldNat = RO_VOTE_PCT_2024[p.id] ?? 0;
    const newNat = natPcts[p.id] ?? 0;
    // Effective county baseline: real data if listed, otherwise proportional share of remainder
    const baseVal = base[p.id] ?? 0;
    const countyBase = baseVal > 0
      ? baseVal
      : unlistedNatSum > 0 ? (oldNat / unlistedNatSum) * remainderPct : 0;

    const v = newNat === 0 ? 0 : oldNat === 0 ? newNat : countyBase * (newNat / oldNat);
    raw[p.id] = Math.max(0, v);
    newTotal += raw[p.id];
  }

  // Soft cap only: if a large swing pushes totals past 100%, scale back proportionally.
  // Never inflate — real-data counties where totals are naturally < 100 stay that way.
  if (newTotal > 100) {
    const scale = 100 / newTotal;
    for (const p of RO_PARTIES) raw[p.id] *= scale;
  }

  return raw;
}

// ── County Stage-1 seats (Hare quota floor, single county) ────────────────────
// Used by the county breakdown panel to show per-party seat estimates per county.
// Returns { partyId → Stage-1 seats } for all qualifying parties in that county.
function calcCountySeatStage1(
  countyId: RoCountyId,
  countyVotes: Partial<Record<RoPartyId, number>>,
  qualifying: Set<RoPartyId>,
): Partial<Record<RoPartyId, number>> {
  const countySeats = RO_COUNTY_CAMERA_SEATS[countyId] ?? 0;
  const countyValidVotes = RO_COUNTY_VALID_VOTES_2024[countyId] ?? 0;
  if (countySeats === 0 || countyValidVotes === 0) return {};

  let qualSum = 0;
  const partyVotes: Partial<Record<RoPartyId, number>> = {};
  for (const id of qualifying) {
    const v = Math.round((countyVotes[id] ?? 0) / 100 * countyValidVotes);
    partyVotes[id] = v;
    qualSum += v;
  }
  if (qualSum === 0) return {};

  const quota = qualSum / countySeats;
  const result: Partial<Record<RoPartyId, number>> = {};
  for (const id of qualifying) {
    const s = Math.floor((partyVotes[id] ?? 0) / quota);
    if (s > 0) result[id] = s;
  }
  return result;
}

// ── Two-stage proportional seat allocation (Romania's real system) ────────────
// Stage 0 – threshold: ≥5% nationally, OR ≥20% in ≥4 counties (alternative threshold for UDMR etc.)
// Stage 1 – county Hare quota: floor(partyVotes / quota) seats per county; remainder votes accumulate nationally
// Stage 2 – national D'Hondt: unallocated seats (= totalSeats − stage1Total) distributed by remainder votes
function calcSeatsTwoStage(
  natPcts: Record<RoPartyId, number>,
  overrides?: Record<string, Record<RoPartyId, number>>,
  totalSeats = RO_PROP_SEATS,
  threshold = RO_THRESHOLD,
): Partial<Record<RoPartyId, number>> {
  // ── Stage 0: qualifying parties ────────────────────────────────────────────
  const qualifying = new Set<RoPartyId>();
  for (const [id, v] of Object.entries(natPcts) as [RoPartyId, number][]) {
    if ((v ?? 0) >= threshold) qualifying.add(id);
  }
  // Alternative threshold: ≥20% in ≥4 counties (protects ethnic-minority parties like UDMR)
  const countyOver20: Partial<Record<RoPartyId, number>> = {};
  for (const countyId of Object.keys(RO_COUNTY_CAMERA_SEATS) as RoCountyId[]) {
    const cv = overrides?.[countyId] ?? calcCountyVotes(natPcts, countyId);
    for (const p of RO_PARTIES) {
      if ((cv[p.id] ?? 0) >= 20) countyOver20[p.id] = (countyOver20[p.id] ?? 0) + 1;
    }
  }
  for (const [id, cnt] of Object.entries(countyOver20) as [RoPartyId, number][]) {
    if (cnt >= 4) qualifying.add(id);
  }
  if (qualifying.size === 0) return {};

  // ── Stage 1: Hare quota per county (floor only — no largest-remainder here) ─
  const seats: Partial<Record<RoPartyId, number>> = {};
  const natRemVotes: Partial<Record<RoPartyId, number>> = {};
  let stage1Total = 0;

  for (const countyId of Object.keys(RO_COUNTY_CAMERA_SEATS) as RoCountyId[]) {
    const countySeats = RO_COUNTY_CAMERA_SEATS[countyId] ?? 0;
    const countyValidVotes = RO_COUNTY_VALID_VOTES_2024[countyId] ?? 0;
    if (countySeats === 0 || countyValidVotes === 0) continue;

    const cv = overrides?.[countyId] ?? calcCountyVotes(natPcts, countyId);

    // Estimate qualifying-party raw votes in this county
    const partyVotes: Partial<Record<RoPartyId, number>> = {};
    let qualSum = 0;
    for (const id of qualifying) {
      const v = Math.round((cv[id] ?? 0) / 100 * countyValidVotes);
      partyVotes[id] = v;
      qualSum += v;
    }
    if (qualSum === 0) continue;

    // Hare quota = total qualifying votes / county seats
    const quota = qualSum / countySeats;

    for (const id of qualifying) {
      const v = partyVotes[id] ?? 0;
      const floorSeats = Math.floor(v / quota);
      seats[id] = (seats[id] ?? 0) + floorSeats;
      stage1Total += floorSeats;
      // Remainder votes bubble up to Stage 2
      natRemVotes[id] = (natRemVotes[id] ?? 0) + (v - floorSeats * quota);
    }
  }

  // ── Stage 2: D'Hondt on aggregated remainder votes (fills remaining seats) ──
  // Remaining seats = total − stage1 allocated (includes the 4 diaspora seats + any county gaps)
  const stage2Seats = totalSeats - stage1Total;
  if (stage2Seats > 0) {
    const quotients: { id: RoPartyId; q: number }[] = [];
    for (const [id, v] of Object.entries(natRemVotes) as [RoPartyId, number][]) {
      for (let d = 1; d <= stage2Seats; d++) quotients.push({ id, q: v / d });
    }
    quotients.sort((a, b) => b.q - a.q);
    for (let i = 0; i < Math.min(stage2Seats, quotients.length); i++) {
      seats[quotients[i].id] = (seats[quotients[i].id] ?? 0) + 1;
    }
  }

  return seats;
}

type PartialSeatsResult = { camera: Partial<Record<RoPartyId, number>>; senate: Partial<Record<RoPartyId, number>> };

// ── Alt-threshold qualifier check (reused by analysis panel + sim panel) ─────
// Returns the set of parties that clear the ≥20% in ≥4 counties bar, regardless
// of whether they also clear the 5% national bar.
function getAltThresholdQualifiers(
  natPcts: Record<RoPartyId, number>,
  overrides?: Record<string, Record<RoPartyId, number>>,
): Set<RoPartyId> {
  const countyOver20: Partial<Record<RoPartyId, number>> = {};
  for (const countyId of Object.keys(RO_COUNTY_CAMERA_SEATS) as RoCountyId[]) {
    const cv = overrides?.[countyId] ?? calcCountyVotes(natPcts, countyId);
    for (const p of RO_PARTIES) {
      if ((cv[p.id] ?? 0) >= 20) countyOver20[p.id] = (countyOver20[p.id] ?? 0) + 1;
    }
  }
  const result = new Set<RoPartyId>();
  for (const [id, cnt] of Object.entries(countyOver20) as [RoPartyId, number][]) {
    if (cnt >= 4) result.add(id as RoPartyId);
  }
  return result;
}

function calcPartialSeats(
  natPcts: Record<RoPartyId, number>,
  declaredCounties: Set<RoCountyId>,
): PartialSeatsResult {
  if (declaredCounties.size === 0) return { camera: {}, senate: {} };
  const weighted: Partial<Record<RoPartyId, number>> = {};
  let totalPop = 0;
  for (const cId of declaredCounties) {
    const c = RO_COUNTY_MAP[cId]; if (!c) continue;
    const cv = calcCountyVotes(natPcts, cId);
    for (const p of RO_PARTIES) weighted[p.id] = (weighted[p.id] ?? 0) + (cv[p.id] ?? 0) * c.pop;
    totalPop += c.pop;
  }
  if (totalPop === 0) return { camera: {}, senate: {} };
  const norm: Record<RoPartyId, number> = {} as Record<RoPartyId, number>;
  for (const p of RO_PARTIES) norm[p.id] = (weighted[p.id] ?? 0) / totalPop;
  // Use two-stage system so alt-threshold parties (UDMR) are included correctly
  return { camera: calcSeatsTwoStage(norm), senate: {} };
}

function redistributePcts(
  current: Record<RoPartyId, number>,
  changedId: RoPartyId,
  newRaw: number,
  locks: Set<RoPartyId>,
): Record<RoPartyId, number> {
  const ids = Object.keys(current) as RoPartyId[];
  // Preserve the existing total (not hardcoded 100) — works for both the national
  // sliders (total ≈ 85.72% in 2024 mode) and the county panel (total = 100%).
  const totalSum = ids.reduce((s, id) => s + (current[id] ?? 0), 0);
  const lockedSum = ids.filter(id => locks.has(id) && id !== changedId).reduce((s, id) => s + (current[id] ?? 0), 0);
  const clamped = Math.min(Math.max(newRaw, 0), totalSum - lockedSum);
  const unlocked = ids.filter(id => !locks.has(id) && id !== changedId);
  const remaining = totalSum - lockedSum - clamped;
  const unlockedSum = unlocked.reduce((s, id) => s + (current[id] ?? 0), 0);
  const next: Record<RoPartyId, number> = { ...current, [changedId]: clamped };
  if (unlockedSum > 0) for (const id of unlocked) next[id] = ((current[id] ?? 0) / unlockedSum) * remaining;
  else if (unlocked.length > 0) for (const id of unlocked) next[id] = remaining / unlocked.length;
  return next;
}

function partyColor(id: RoPartyId): string { return RO_PARTY_MAP[id]?.color ?? '#888'; }

function getCountyFill(natPcts: Record<RoPartyId, number>, countyId: RoCountyId, dark: boolean, overrides?: Record<string, Record<RoPartyId, number>>): string {
  const cv = overrides?.[countyId] ?? calcCountyVotes(natPcts, countyId);
  const sorted = (Object.entries(cv) as [RoPartyId, number][]).sort(([, a], [, b]) => b - a);
  if (!sorted.length) return dark ? '#374151' : '#E5E7EB';
  const [winner, winPct] = sorted[0];
  const runnerUp = sorted[1]?.[1] ?? 0;
  const t = Math.min(Math.max((winPct - runnerUp) / 25, 0), 1);
  const c = hsl(partyColor(winner as RoPartyId));
  c.l = dark ? 0.52 - t * 0.28 : 0.80 - t * 0.44;
  return c.formatHex();
}

function roRandNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random(); while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function roBellCurveTimes(n: number, totalMs: number): number[] {
  return Array.from({ length: n }, () => Math.max(0.02, Math.min(0.98, 0.5 + roRandNormal() * 0.18)))
    .sort((a, b) => a - b).map(t => Math.round(t * totalMs));
}

function fmtN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return String(n);
}
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h;
  const r = parseInt(full.slice(0,2),16), g = parseInt(full.slice(2,4),16), b = parseInt(full.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Tooltip type ───────────────────────────────────────────────────────────────
type CountyTooltipState = {
  x: number; y: number; name: string;
  parties: { id: RoPartyId; pct: number; rawVotes: number }[];
  totalVotes: number;
  leader: RoPartyId | null;
} | null;

// ── Political left → right order for hemicycle ────────────────────────────────
const RO_LR_ORDER: RoPartyId[] = ['PSD', 'UDMR', 'PNL', 'USR', 'POT', 'AUR', 'SOS'];

// ── Scoreboard tile ────────────────────────────────────────────────────────────
function RoScoreboardTile({ partyId, seats, pct, rawVotes, belowThreshold, isLeader, isWinner, isBaseline }: {
  partyId: RoPartyId; seats: number; pct: number; rawVotes: number;
  belowThreshold: boolean; isLeader: boolean; isWinner: boolean; isBaseline?: boolean;
}) {
  const party = RO_PARTY_MAP[partyId];
  // Swap between 2024 and current leaders depending on mode
  const leaderName  = isBaseline ? party.leader2024 : party.leader;
  const wikiKey     = isBaseline ? party.wikiTitle2024 : party.wikiTitle;

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!wikiKey) { setPhotoUrl(null); return; }
    let cancelled = false;
    fetchWikiPhoto(wikiKey).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [wikiKey]);

  const initials = leaderName.split(' ').map((w: string) => w[0]).join('').slice(0, 2);
  const color = partyColor(partyId);
  const colorAlpha = hexToRgba(color, 0.13);

  return (
    <div
      className={`cand-col${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`}
      style={{
        '--cand-color': color, '--cand-color-alpha': colorAlpha,
        borderColor: (isLeader || isWinner) ? color : hexToRgba(color, belowThreshold && seats === 0 ? 0.18 : 0.30),
        opacity: belowThreshold && seats === 0 ? 0.55 : 1,
      } as React.CSSProperties}
    >
      <div style={{ position: 'relative' }}>
        <div className="cand-circle-frame">
          {photoUrl
            ? <img src={photoUrl} alt={leaderName} onError={() => setPhotoUrl(null)} />
            : <span className="cand-initials">{initials}</span>
          }
        </div>
        {isWinner && (
          <span className="called-tick">
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="8.5" fill={color}/>
              <path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        )}
        {belowThreshold && party.thresholdType !== 'regional' && (
          <span style={{ position:'absolute', bottom:2, right:2, fontSize:8, background:'rgba(0,0,0,0.45)', color:'#fff', borderRadius:2, padding:'0 2px', fontFamily:'monospace' }}>
            &lt;5%
          </span>
        )}
      </div>
      <span className="cand-leader-name" title={leaderName}>{leaderName.split(' ').pop()}</span>
      <span className="cand-party-abbrev">{party.name}</span>
      <span className="cand-seats">{seats}</span>
      <span className="cand-party-name" title={party.fullName}>{party.fullName}</span>
      <div style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:1 }}>
        <span style={{ fontSize:6.5, fontFamily:'"JetBrains Mono",monospace', fontWeight:600, color:hexToRgba(color, 0.48), letterSpacing:'0.10em', textTransform:'uppercase' }}>VOTES</span>
        <span style={{ fontSize:11, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ width:'100%', textAlign:'right', marginBottom:3 }}>
        <span className="cand-votes-full" style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', color:hexToRgba(color,0.65) }}>{rawVotes.toLocaleString()}</span>
        <span className="cand-votes-compact" style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', color:hexToRgba(color,0.65) }}>{fmtN(rawVotes)}</span>
      </div>
      <div className="cand-bar-track" style={{ width:'100%', height:3, borderRadius:2, background:'var(--bar-track)' }}>
        <div style={{ height:'100%', borderRadius:2, background:color, width:`${Math.min(pct/30*100,100)}%`, transition:'width 0.3s ease' }} />
      </div>
    </div>
  );
}

// ── Scoreboard ─────────────────────────────────────────────────────────────────
function RoScoreboard({ natPcts, simCameraSeats, isBaseline, totalVotesBase, dark: _dark }: {
  natPcts: Record<RoPartyId, number>;
  simCameraSeats?: Partial<Record<RoPartyId, number>>;
  isBaseline?: boolean;
  totalVotesBase?: number;
  dark?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault(); el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const seats = useMemo(() => simCameraSeats ?? calcSeatsTwoStage(natPcts), [simCameraSeats, natPcts]);

  const sorted = useMemo(
    () => RO_PARTIES
      .filter(p => (seats[p.id] ?? 0) > 0 || (natPcts[p.id] ?? 0) > 0)
      .sort((a, b) => (seats[b.id] ?? 0) - (seats[a.id] ?? 0) || (natPcts[b.id] ?? 0) - (natPcts[a.id] ?? 0)),
    [seats, natPcts],
  );

  const leader = sorted[0]?.id ?? null;
  const winner = leader && (seats[leader] ?? 0) >= RO_CAMERA_MAJORITY ? leader : null;

  const votesBase       = totalVotesBase ?? RO_GRAND_TOTAL_VOTES;
  const trackedPctSum   = useMemo(() => RO_PARTIES.reduce((s, p) => s + (natPcts[p.id] ?? 0), 0), [natPcts]);
  const otherPct        = Math.max(0, 100 - trackedPctSum);
  const otherRawVotes   = isBaseline
    ? RO_GRAND_TOTAL_VOTES - RO_PARTIES.reduce((s, p) => s + (RO_VOTE_RAW_2024[p.id] ?? 0), 0)
    : Math.round(otherPct / 100 * votesBase);
  // Seats not allocated to tracked parties = minority reserved seats + any unallocated remainder
  const trackedSeatSum  = useMemo(() => RO_PARTIES.reduce((s, p) => s + (seats[p.id] ?? 0), 0), [seats]);
  const othersSeats     = RO_CAMERA_SEATS - trackedSeatSum;

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {sorted.map(party => {
            const s = seats[party.id] ?? 0;
            const pct = natPcts[party.id] ?? 0;
            const rawVotes = isBaseline
              ? RO_VOTE_RAW_2024[party.id]
              : Math.round(pct / 100 * votesBase);
            const belowThreshold = pct < RO_THRESHOLD;
            return (
              <RoScoreboardTile key={party.id} partyId={party.id} seats={s} pct={pct}
                rawVotes={rawVotes} belowThreshold={belowThreshold}
                isLeader={party.id === leader && !winner} isWinner={party.id === winner}
                isBaseline={isBaseline} />
            );
          })}
          {/* Others tile — minority reserved seats + untracked minor parties */}
          <div className="cand-col" style={{
            '--cand-color': '#8B93A5', '--cand-color-alpha': 'rgba(139,147,165,0.13)',
            borderColor: 'rgba(139,147,165,0.28)', opacity: 0.75,
          } as React.CSSProperties}>
            <div style={{ position:'relative' }}>
              <div className="cand-circle-frame" style={{ background:'rgba(139,147,165,0.12)', border:'1.5px solid rgba(139,147,165,0.28)' }}>
                <span className="cand-initials" style={{ color:'#8B93A5', fontSize:11 }}>MN</span>
              </div>
            </div>
            <span className="cand-leader-name" style={{ color:'#8B93A5' }}>Reserved</span>
            <span className="cand-party-abbrev" style={{ color:'#8B93A5' }}>Min+Oth</span>
            <span className="cand-seats" style={{ color:'#8B93A5' }}>{othersSeats}</span>
            <span className="cand-party-name" style={{ color:'#8B93A5' }}>
              {RO_MINORITY_SEATS} minority reserved · minor parties
            </span>
            <div style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:1 }}>
              <span style={{ fontSize:6.5, fontFamily:'"JetBrains Mono",monospace', fontWeight:600, color:'rgba(139,147,165,0.48)', letterSpacing:'0.10em', textTransform:'uppercase' }}>VOTES</span>
              <span style={{ fontSize:11, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color:'#8B93A5' }}>{otherPct.toFixed(1)}%</span>
            </div>
            <div style={{ width:'100%', textAlign:'right', marginBottom:3 }}>
              <span className="cand-votes-full" style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', color:'rgba(139,147,165,0.60)' }}>{otherRawVotes.toLocaleString()}</span>
              <span className="cand-votes-compact" style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', color:'rgba(139,147,165,0.60)' }}>{fmtN(otherRawVotes)}</span>
            </div>
            <div className="cand-bar-track" style={{ width:'100%', height:3, borderRadius:2, background:'var(--bar-track)' }}>
              <div style={{ height:'100%', borderRadius:2, background:'#8B93A5', width:`${Math.min(otherPct/30*100,100)}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Map controller ─────────────────────────────────────────────────────────────
function MapController({ layerRef }: { layerRef: React.MutableRefObject<L.GeoJSON | null> }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);
  useEffect(() => {
    const h = () => layerRef.current?.eachLayer((l: L.Layer) => { (l as any).options && ((l as any).options.smoothFactor = 0); });
    map.on('zoomend', h); return () => { map.off('zoomend', h); };
  }, [map, layerRef]);
  return null;
}

// ── Bubble overlay ─────────────────────────────────────────────────────────────
type BubbleEntry = { marker: L.CircleMarker; baseRadius: number };
function zoomScale(zoom: number): number { return Math.max(0.40, Math.min(1.0, (zoom - 5) / (10 - 5))); }

function RoBubbleLayer({
  geoData, natPcts, containerRef, setTooltip, onSelect, natPctsRef, declaredCounties,
  overrides, overridesRef, blankMode, projectedCounties,
}: {
  geoData: any; natPcts: Record<RoPartyId, number>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setTooltip: (t: CountyTooltipState) => void;
  onSelect: (id: RoCountyId) => void;
  natPctsRef: React.MutableRefObject<Record<RoPartyId, number>>;
  declaredCounties?: Set<RoCountyId>;
  overrides?: Record<string, Record<RoPartyId, number>>;
  overridesRef: React.MutableRefObject<Record<string, Record<RoPartyId, number>> | undefined>;
  blankMode?: boolean;
  projectedCounties?: Set<RoCountyId>;
}) {
  const map = useMap();
  const bubblesRef = useRef<BubbleEntry[]>([]);

  useEffect(() => {
    const onZoom = () => {
      const scale = zoomScale(map.getZoom());
      for (const { marker, baseRadius } of bubblesRef.current) marker.setRadius(baseRadius * scale);
    };
    map.on('zoomend', onZoom); return () => { map.off('zoomend', onZoom); };
  }, [map]);

  useEffect(() => {
    for (const { marker } of bubblesRef.current) marker.remove();
    bubblesRef.current = [];
    const scale = zoomScale(map.getZoom());

    L.geoJSON(geoData).eachLayer((layer: L.Layer) => {
      const countyName: string = (layer as any).feature?.properties?.name ?? '';
      const countyId = RO_NAME_TO_ID[countyName];
      if (!countyId) return;
      if (declaredCounties && !declaredCounties.has(countyId)) return;
      if (blankMode && !(projectedCounties?.has(countyId))) return;
      const bounds = (layer as any).getBounds?.();
      if (!bounds?.isValid()) return;
      const center = bounds.getCenter();
      // Bubble colour/size: honour county-level overrides if present
      const cv = overrides?.[countyId] ?? calcCountyVotes(natPcts, countyId);
      const sorted = (Object.entries(cv) as [RoPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      if (!sorted.length) return;
      const [winId, winPct] = sorted[0];
      const margin = winPct - (sorted[1]?.[1] ?? 0);
      const baseRadius = 5 + Math.min(margin / 20, 1) * 14;
      const color = partyColor(winId as RoPartyId);
      const marker = L.circleMarker(center, { radius: baseRadius * scale, color, fillColor: color, fillOpacity: 0.72, weight: 1, opacity: 0.9 }).addTo(map);
      marker.on('click', () => { setTooltip(null); onSelect(countyId); });
      marker.on('mousemove', (e: L.LeafletMouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        // Use override if present, otherwise swing model — same source as the county panel
        const cur = overridesRef.current?.[countyId] ?? calcCountyVotes(natPctsRef.current, countyId);
        const totalVotes = RO_COUNTY_VALID_VOTES_2024[countyId] ?? 0;
        const parties = (Object.entries(cur) as [RoPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 7).map(([id, pct]) => ({ id: id as RoPartyId, pct, rawVotes: Math.round(pct / 100 * totalVotes) }));
        setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name: countyName, parties, totalVotes, leader: parties[0]?.id ?? null });
      });
      marker.on('mouseout', () => setTooltip(null));
      bubblesRef.current.push({ marker, baseRadius });
    });
    return () => { for (const { marker } of bubblesRef.current) marker.remove(); bubblesRef.current = []; };
  }, [map, geoData, natPcts, overrides, blankMode, projectedCounties]);

  return null;
}

// ── Map view ───────────────────────────────────────────────────────────────────
function RoMapView({ natPcts, selectedCounty, onSelect, dark, bubbleMap, declaredCounties, overrides, blankMode, projectedCounties }: {
  natPcts: Record<RoPartyId, number>; selectedCounty: RoCountyId | null;
  onSelect: (id: RoCountyId) => void; dark: boolean; bubbleMap: boolean;
  declaredCounties?: Set<RoCountyId>;
  overrides?: Record<string, Record<RoPartyId, number>>;
  blankMode?: boolean;
  projectedCounties?: Set<RoCountyId>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef     = useRef<L.GeoJSON | null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltip, setTooltip] = useState<CountyTooltipState>(null);

  const natPctsRef   = useRef(natPcts);
  const selectedRef  = useRef(selectedCounty);
  const darkRef      = useRef(dark);
  const bubbleRef    = useRef(bubbleMap);
  const onSelectRef  = useRef(onSelect);
  const declaredRef  = useRef(declaredCounties);
  const overridesRef = useRef(overrides);
  const blankModeRef = useRef(blankMode ?? false);
  const projectedRef = useRef(projectedCounties ?? new Set<RoCountyId>());
  useEffect(() => { natPctsRef.current  = natPcts;        }, [natPcts]);
  useEffect(() => { selectedRef.current = selectedCounty; }, [selectedCounty]);
  useEffect(() => { darkRef.current     = dark;           }, [dark]);
  useEffect(() => { bubbleRef.current   = bubbleMap;      }, [bubbleMap]);
  useEffect(() => { onSelectRef.current = onSelect;       }, [onSelect]);
  useEffect(() => { declaredRef.current  = declaredCounties;         }, [declaredCounties]);
  useEffect(() => { overridesRef.current = overrides;                }, [overrides]);
  useEffect(() => { blankModeRef.current = blankMode ?? false;       }, [blankMode]);
  useEffect(() => { projectedRef.current = projectedCounties ?? new Set(); }, [projectedCounties]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}romania-counties.geojson`)
      .then(r => r.json()).then(setGeoData).catch(console.error);
  }, []);

  const getStyle = useCallback((feature: any): L.PathOptions => {
    const countyName: string = feature?.properties?.name ?? '';
    const countyId = RO_NAME_TO_ID[countyName];
    const isSelected = countyId === selectedRef.current;
    const borderColor = darkRef.current ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)';
    if (bubbleRef.current) return { fillOpacity:0, weight:0.4, color: darkRef.current ? 'rgba(255,255,255,0.18)':'rgba(0,0,0,0.18)', opacity:0.6 };
    if (!countyId) return { fillColor: darkRef.current?'#374151':'#E5E7EB', fillOpacity:0.5, weight:0.4, color:borderColor, opacity:1 };
    // Blank mode: only colour counties that have been explicitly projected
    if (blankModeRef.current && !projectedRef.current.has(countyId)) {
      return { fillColor: darkRef.current?'#1f2937':'#d1d5db', fillOpacity:0.7, weight:isSelected?2:0.4, color:isSelected?'#c8a020':borderColor, opacity:1 };
    }
    const isDeclared = !declaredRef.current || declaredRef.current.has(countyId);
    if (!isDeclared) return { fillColor: darkRef.current?'#1f2937':'#d1d5db', fillOpacity:0.7, weight:0.4, color:borderColor, opacity:1 };
    const fill = getCountyFill(natPctsRef.current, countyId, darkRef.current, overridesRef.current);
    return { fillColor:fill, fillOpacity:0.80, weight: isSelected?2:0.5, color: isSelected?'#c8a020':borderColor, opacity:1 };
  }, []);

  useEffect(() => { layerRef.current?.setStyle((f: any) => getStyle(f)); }, [natPcts, selectedCounty, dark, bubbleMap, declaredCounties, overrides, blankMode, projectedCounties, getStyle]);

  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const countyName: string = feature?.properties?.name ?? '';
    const countyId = RO_NAME_TO_ID[countyName];
    layer.on('click', () => { if (countyId) onSelectRef.current(countyId); });
    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleRef.current || !countyId) { setTooltip(null); return; }
      if (blankModeRef.current && !projectedRef.current.has(countyId)) { setTooltip(null); return; }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Use override if present — same source as the county panel slider values
      const cv = overridesRef.current?.[countyId] ?? calcCountyVotes(natPctsRef.current, countyId);
      const totalVotes = RO_COUNTY_VALID_VOTES_2024[countyId] ?? 0;
      const parties = (Object.entries(cv) as [RoPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 7).map(([id, pct]) => ({ id: id as RoPartyId, pct, rawVotes: Math.round(pct / 100 * totalVotes) }));
      setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name: countyName, parties, totalVotes, leader: parties[0]?.id ?? null });
    });
    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[45.8, 25.0]} zoom={7} minZoom={3} maxZoom={13}
        style={{ width:'100%', height:'100%' }} zoomControl worldCopyJump={false}>
        <TileLayer key={dark?'dark':'light'}
          url={dark
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
          attribution='&copy; OpenStreetMap &copy; CARTO'
          subdomains="abcd" updateWhenZooming={false} updateWhenIdle maxZoom={20} />
        <MapController layerRef={layerRef} />
        {geoData && <GeoJSON ref={layerRef as any} data={geoData} style={(f:any)=>getStyle(f)} onEachFeature={onEachFeature} {...({smoothFactor:0} as any)} />}
        {geoData && bubbleMap && (
          <RoBubbleLayer geoData={geoData} natPcts={natPcts} containerRef={containerRef}
            setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef} declaredCounties={declaredCounties}
            overrides={overrides} overridesRef={overridesRef}
            blankMode={blankMode} projectedCounties={projectedCounties} />
        )}
      </MapContainer>
      {tooltip && (() => {
        const cw = containerRef.current?.clientWidth ?? 9999;
        const TW = 248;
        const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const tt = {
          bg:     dark ? 'rgba(18,24,44,0.97)'       : 'rgba(255,255,255,0.97)',
          border: dark ? 'rgba(255,255,255,0.09)'    : 'rgba(0,0,0,0.08)',
          shadow: dark ? '0 6px 28px rgba(0,0,0,0.5)' : '0 6px 28px rgba(0,0,0,0.13)',
          title:  dark ? 'rgba(255,255,255,0.92)'    : 'rgba(0,0,0,0.85)',
          sub:    dark ? 'rgba(255,255,255,0.38)'    : 'rgba(0,0,0,0.40)',
          body:   dark ? 'rgba(255,255,255,0.85)'    : 'rgba(0,0,0,0.78)',
          divider:dark ? 'rgba(255,255,255,0.07)'    : 'rgba(0,0,0,0.07)',
          track:  dark ? 'rgba(255,255,255,0.08)'    : 'rgba(0,0,0,0.07)',
        };
        const maxPct = tooltip.parties[0]?.pct ?? 1;
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top: Math.max(6, tooltip.y - 20), width: TW }}>
            <div style={{ background:tt.bg, borderRadius:10, border:`1px solid ${tt.border}`, boxShadow:tt.shadow, backdropFilter:'blur(10px)', overflow:'hidden' }}>
              {/* Header */}
              <div style={{ padding:'11px 14px 9px' }}>
                <div style={{ fontSize:14, fontWeight:700, color:tt.title, lineHeight:1.2 }}>{tooltip.name}</div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginTop:3 }}>
                  <span style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', color:tt.sub }}>Est. county result</span>
                  {tooltip.totalVotes > 0 && (
                    <span style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', color:tt.sub }}>{tooltip.totalVotes.toLocaleString()} votes</span>
                  )}
                </div>
              </div>
              {/* Party rows */}
              <div style={{ padding:'2px 14px 12px' }}>
                {(() => {
                  const shownSum = tooltip.parties.reduce((s, x) => s + x.pct, 0);
                  const otherPct = Math.max(0, 100 - shownSum);
                  const otherRaw = tooltip.totalVotes > 0 ? Math.round(otherPct / 100 * tooltip.totalVotes) : 0;
                  const allRows = [
                    ...tooltip.parties.map(p => ({ ...p, isOther: false })),
                    ...(otherPct >= 0.05 ? [{ id: null as any, pct: otherPct, rawVotes: otherRaw, isOther: true }] : []),
                  ];
                  return allRows.map(({ id, pct, rawVotes, isOther }, i) => {
                  const pColor = isOther ? '#888888' : partyColor(id);
                  const barW = maxPct > 0 ? Math.round((pct / maxPct) * 100) : 0;
                  return (
                    <div key={isOther ? '__other' : id} style={{ marginBottom: i < allRows.length - 1 ? 9 : 0 }}>
                      {/* Name + votes + % */}
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                        <span style={{ width:8, height:8, borderRadius:2, flexShrink:0, background:pColor, opacity: isOther ? 0.5 : 1 }} />
                        <span style={{ flex:1, fontSize:11, fontWeight:i===0?600:400, color:tt.body, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', opacity: isOther ? 0.7 : 1 }}>
                          {isOther ? 'Others' : (id ? (RO_PARTY_MAP[id as RoPartyId]?.name ?? id) : id)}
                        </span>
                        {rawVotes > 0 && (
                          <span style={{ fontSize:9.5, fontFamily:'"JetBrains Mono",monospace', color:hexToRgba(pColor, 0.72), whiteSpace:'nowrap' }}>
                            {rawVotes.toLocaleString()}
                          </span>
                        )}
                        <span style={{ fontSize:12, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color:pColor, minWidth:38, textAlign:'right' }}>
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div style={{ height:3, borderRadius:2, background:tt.track, marginLeft:14 }}>
                        <div style={{ height:'100%', borderRadius:2, background:pColor, width:`${barW}%`, transition:'width 0.2s' }} />
                      </div>
                    </div>
                  );
                  });
                })()}
              </div>
              {/* Footer divider */}
              <div style={{ borderTop:`1px solid ${tt.divider}`, padding:'6px 14px', display:'flex', justifyContent:'flex-end' }}>
                <span style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', color:tt.sub }}>Chamber of Deputies · 2024</span>
              </div>
            </div>
          </div>
        );
      })()}
      <div className="absolute bottom-2 right-2 text-[10px] text-ink-3 select-none z-[1000] font-mono">Scroll to zoom · Click to open</div>
    </div>
  );
}

// ── County panel (editable) ────────────────────────────────────────────────────
function RoCountyPanel({ countyId, natPcts, onUpdate, onClose, dark, override, isBlankMode, isProjected, onProject }: {
  countyId: RoCountyId; natPcts: Record<RoPartyId, number>;
  onUpdate: (id: RoCountyId, pcts: Record<RoPartyId, number>) => void;
  onClose: () => void; dark?: boolean;
  override?: Record<RoPartyId, number>;
  isBlankMode?: boolean;
  isProjected?: boolean;
  onProject?: () => void;
}) {
  const initPcts = () => {
    if (override) return { ...override };
    const cv = calcCountyVotes(natPcts, countyId);
    return Object.fromEntries(RO_PARTIES.map(p => [p.id, cv[p.id] ?? 0])) as Record<RoPartyId, number>;
  };
  const [pcts, setPcts] = useState<Record<RoPartyId, number>>(initPcts);
  const [panelLocks, setPanelLocks] = useState<Set<RoPartyId>>(new Set());
  const [editId, setEditId] = useState<RoPartyId | null>(null);
  const [editVal, setEditVal] = useState('');
  const pctsRef = useRef(pcts);
  useEffect(() => { pctsRef.current = pcts; }, [pcts]);

  // Reset UI state when the selected county changes
  useEffect(() => {
    setPanelLocks(new Set()); setEditId(null);
  }, [countyId]);

  // Keep displayed pcts in sync with natPcts changes AND county changes.
  // If the user has made manual edits (override exists) honour those; otherwise
  // recompute from the current national slider values so the panel always agrees
  // with the tooltip.
  useEffect(() => {
    if (override) {
      setPcts({ ...override });
    } else {
      const cv = calcCountyVotes(natPcts, countyId);
      setPcts(Object.fromEntries(RO_PARTIES.map(p => [p.id, cv[p.id] ?? 0])) as Record<RoPartyId, number>);
    }
  }, [countyId, natPcts, override]);

  function applyChange(id: RoPartyId, val: number) {
    const next = redistributePcts(pctsRef.current, id, val, panelLocks);
    pctsRef.current = next; setPcts(next); onUpdate(countyId, next);
  }
  function commitEdit(id: RoPartyId, raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) applyChange(id, Math.max(0, Math.min(100, n)));
    setEditId(null); setEditVal('');
  }

  // Fixed render order — never reshuffled while dragging
  const partyRows = useMemo(() => RO_PARTIES.map(p => ({ ...p, pct: pcts[p.id] ?? 0 })), [pcts]);
  // Winner derived separately so the top-badge stays accurate without affecting order
  const winner = useMemo(
    () => partyRows.reduce<typeof partyRows[0] | null>((best, p) => (!best || p.pct > best.pct) ? p : best, null),
    [partyRows],
  );
  const county = RO_COUNTY_MAP[countyId];
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold text-ink leading-tight truncate">{county?.name ?? countyId}</h2>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {isBlankMode && !isProjected ? 'Not yet projected' : override ? 'Custom result · click % to edit' : 'Estimated result · click % to edit'}
            </p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        {winner && (
          <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-[4px] border border-default" style={{ borderColor:`${winner.color}33` }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background:winner.color }} />
            <span className="text-[11px] font-medium text-ink flex-1 truncate">{winner.fullName}</span>
            <span className="text-[9px] font-mono text-ink-3">{winner.pct.toFixed(1)}%</span>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-2.5">
        {partyRows.filter(p => p.pct >= 0.1 || panelLocks.has(p.id)).map(p => {
          const pct = pcts[p.id] ?? 0; const isLocked = panelLocks.has(p.id);
          return (
            <div key={p.id}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background:p.color }} />
                <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{p.fullName}</span>
                {pct < RO_THRESHOLD && pct > 0 && p.thresholdType !== 'regional' && <span className="text-[7px] font-mono text-red-400 shrink-0">&lt;5%</span>}
                {editId === p.id
                  ? <input type="number" min={0} max={100} step={0.1} value={editVal} autoFocus
                      className="w-14 text-[11px] font-mono text-right border border-default rounded px-1 bg-canvas text-ink"
                      onChange={e => setEditVal(e.target.value)}
                      onBlur={() => commitEdit(p.id, editVal)}
                      onKeyDown={e => { if (e.key==='Enter') commitEdit(p.id, editVal); if (e.key==='Escape') { setEditId(null); setEditVal(''); } }} />
                  : <button onClick={() => { if (!isLocked) { setEditId(p.id); setEditVal(pct.toFixed(1)); } }}
                      className={`text-[10px] font-mono font-semibold tabular-nums ${isLocked?'cursor-default':'hover:underline cursor-text'}`}
                      style={{ color:p.color }}>{pct.toFixed(1)}%</button>
                }
                <button onClick={() => setPanelLocks(prev => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}
                  className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked?'text-gold':'text-ink-3 hover:text-ink'}`} title={isLocked?'Unlock':'Lock'}>
                  {isLocked
                    ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                    : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                  }
                </button>
              </div>
              <input type="range" min={0} max={100} step={0.1} value={pct} disabled={isLocked}
                onChange={e => applyChange(p.id, parseFloat(e.target.value))}
                className="br-party-slider w-full"
                style={{ '--party-color': p.color, '--pct': `${pct}%` } as React.CSSProperties} />
            </div>
          );
        })}
        {/* Others row */}
        {(() => {
          const otherPct = Math.max(0, 100 - Object.values(pcts).reduce((s, v) => s + (v ?? 0), 0));
          if (otherPct < 0.05) return null;
          return (
            <div style={{ opacity: 0.55 }}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background:'#888' }} />
                <span className="text-[10px] font-medium text-ink-3 flex-1 truncate leading-none">Others (minor parties)</span>
                <span className="text-[10px] font-mono font-semibold text-ink-3">{otherPct.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-black/10 overflow-hidden">
                <div className="h-full rounded-full bg-gray-400" style={{ width:`${Math.min(otherPct,100)}%` }} />
              </div>
            </div>
          );
        })()}
        <div className="pt-2 border-t border-default space-y-2">
          <div>
            <div className="text-[8.5px] font-mono text-ink-3 uppercase tracking-wide mb-1">Population (approx.)</div>
            <div className="text-[11px] font-mono font-semibold text-ink">{county?.pop.toLocaleString()}</div>
          </div>
          {isBlankMode && !isProjected && (
            <button onClick={onProject}
              className="w-full h-8 rounded-[4px] bg-gold text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-gold-deep transition-colors">
              ▶ Project Results
            </button>
          )}
          {isBlankMode && isProjected && (
            <div className="text-[9px] font-mono text-emerald-500 text-center py-1">✓ Projected</div>
          )}
          {override && (
            <button onClick={() => {
              const cv = calcCountyVotes(natPcts, countyId);
              const reset = Object.fromEntries(RO_PARTIES.map(p => [p.id, cv[p.id] ?? 0])) as Record<RoPartyId, number>;
              setPcts(reset); setPanelLocks(new Set()); onUpdate(countyId, reset);
            }} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
              Reset to Estimate
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

// ── Parliament panel ───────────────────────────────────────────────────────────
function RoParliamentPanel({ cameraSeats, onClose, exiting, dark }: {
  cameraSeats: Partial<Record<RoPartyId, number>>;
  onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const seatsMap = cameraSeats;
  const MINORITY_COLOR = '#8B93A5';

  const seatColors: string[] = [];
  const legend: { id: RoPartyId; count: number; color: string }[] = [];
  for (const id of RO_LR_ORDER) {
    const n = seatsMap[id] ?? 0; if (n === 0) continue;
    const color = partyColor(id);
    legend.push({ id, count: n, color });
    for (let i = 0; i < n; i++) seatColors.push(color);
  }
  // 18 minority seats are always present (reserved for national minority organisations)
  for (let i = 0; i < RO_MINORITY_SEATS; i++) seatColors.push(MINORITY_COLOR);
  const partySeatsTotal = seatColors.length - RO_MINORITY_SEATS;

  // ── Semicircle geometry ─────────────────────────────────────────────────────
  // Wide SVG for a proper congress-arch look
  const W = 420, H = 230;
  const cx = W / 2, cy = H - 8;
  const innerR = 58, rowSpacing = 14, rows = 8;
  const dotR = 3.2;

  const arcLengths = Array.from({ length: rows }, (_, i) => Math.PI * (innerR + i * rowSpacing));
  const totalArc   = arcLengths.reduce((s, v) => s + v, 0);
  const floors     = arcLengths.map(a => Math.floor((a / totalArc) * RO_CAMERA_SEATS));
  const remainder  = RO_CAMERA_SEATS - floors.reduce((s, v) => s + v, 0);
  arcLengths
    .map((a, i) => ({ i, frac: (a / totalArc) * RO_CAMERA_SEATS - floors[i] }))
    .sort((a, b) => b.frac - a.frac)
    .slice(0, remainder)
    .forEach(({ i }) => { floors[i]++; });

  const rawPos: { x: number; y: number; θ: number; r: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const r = innerR + row * rowSpacing;
    const n = floors[row];
    for (let j = 0; j < n; j++) {
      const θ = Math.PI * (n - j - 0.5) / n;
      rawPos.push({ x: cx + r * Math.cos(θ), y: cy - r * Math.sin(θ), θ, r });
    }
  }
  // Sort left-to-right (by θ desc) then inner-to-outer: determines colour assignment
  rawPos.sort((a, b) => b.θ - a.θ || a.r - b.r);

  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-r border-default flex flex-col overflow-hidden ${exiting?'panel-exit-left':'panel-slide-left'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Chamber of Deputies</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">{RO_CAMERA_SEATS} seats · majority {RO_CAMERA_MAJORITY} · {RO_MINORITY_SEATS} minority reserved</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll">
        {partySeatsTotal === 0 && (
          <div className="flex items-center justify-center h-10 text-ink-3 text-[10px] font-mono px-4 text-center">Adjust sliders to allocate party seats</div>
        )}
        <>
            {/* Hemicycle */}
            <div className="px-1 pt-3 pb-0">
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block' }}>
                {/* Centre line */}
                <line
                  x1={cx} y1={cy - innerR + 4}
                  x2={cx} y2={cy - (innerR + (rows - 1) * rowSpacing) - 10}
                  stroke={dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}
                  strokeWidth="1" strokeDasharray="3,3"
                />
                {rawPos.map(({ x, y }, i) => (
                  <circle key={i} cx={x} cy={y} r={dotR}
                    fill={i < seatColors.length ? seatColors[i] : (dark ? '#374151' : '#e5e7eb')}
                  />
                ))}
              </svg>
            </div>
            {/* Majority bar */}
            <div className="px-3.5 pb-2 pt-1">
              <div className="h-2 rounded-full bg-black/8 overflow-hidden mb-1">
                <div className="flex h-full">
                  {RO_LR_ORDER.filter(id => (seatsMap[id] ?? 0) > 0).map(id => (
                    <div key={id} style={{ width:`${((seatsMap[id]??0)/RO_CAMERA_SEATS)*100}%`, background:partyColor(id), transition:'width 0.3s' }} />
                  ))}
                  {/* 18 minority seats always occupy a fixed slice */}
                  <div style={{ width:`${(RO_MINORITY_SEATS/RO_CAMERA_SEATS)*100}%`, background:MINORITY_COLOR, flexShrink:0 }} />
                </div>
              </div>
              <div className="flex justify-between text-[7.5px] font-mono text-ink-3">
                <span>0</span>
                <span className="font-bold text-ink">{RO_CAMERA_MAJORITY} majority</span>
                <span>{RO_CAMERA_SEATS}</span>
              </div>
            </div>
            {/* Legend */}
            <div className="px-3.5 pb-4">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {legend.map(({ id, count, color }) => (
                  <div key={id} className="flex items-center gap-1.5">
                    <div style={{ width:9, height:9, borderRadius:2, background:color, flexShrink:0 }} />
                    <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">{RO_PARTY_MAP[id].name}</span>
                    <span className="text-[9.5px] font-mono font-bold text-ink">{count}</span>
                  </div>
                ))}
                {/* Minority orgs — always 18, reserved seats */}
                <div className="flex items-center gap-1.5">
                  <div style={{ width:9, height:9, borderRadius:2, background:MINORITY_COLOR, flexShrink:0 }} />
                  <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">Nat. Minorities</span>
                  <span className="text-[9.5px] font-mono font-bold text-ink">{RO_MINORITY_SEATS}</span>
                </div>
              </div>
            </div>
          </>
      </div>
    </aside>
  );
}

// ── Coalition builder ──────────────────────────────────────────────────────────
const RO_PRESET_COALITIONS: { name: string; emoji: string; parties: RoPartyId[] }[] = [
  { name: 'PSD-PNL-UDMR',    emoji: '🤝', parties: ['PSD','PNL','UDMR'] },
  { name: 'Opoziția Unită',   emoji: '🔵', parties: ['PNL','USR','AUR','UDMR'] },
  { name: 'Front Naționalist',emoji: '🦅', parties: ['AUR','SOS','POT'] },
  { name: 'Marea Coaliție',   emoji: '🇷🇴', parties: ['PSD','PNL','USR','UDMR'] },
];

function RoCoalitionPanel({ cameraSeats, onClose, exiting, dark }: {
  cameraSeats: Partial<Record<RoPartyId, number>>;
  onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const [selected, setSelected] = useState<Set<RoPartyId>>(new Set(['PSD','PNL','UDMR']));
  const toggle = (id: RoPartyId) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const totalCoalSeats = [...selected].reduce((s, id) => s + (cameraSeats[id] ?? 0), 0);
  const hasMajority = totalCoalSeats >= RO_CAMERA_MAJORITY;

  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Coalition Builder</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Majority: {RO_CAMERA_MAJORITY} · {RO_PROP_SEATS} party + {RO_MINORITY_SEATS} minority</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="px-3.5 pt-3 pb-2 border-b border-default shrink-0">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {RO_PRESET_COALITIONS.map(coal => (
            <button key={coal.name} onClick={() => setSelected(new Set(coal.parties))}
              className="text-left px-2 py-1.5 rounded-[4px] border border-default hover:bg-hover transition-colors">
              <div className="text-[8px] font-bold text-ink truncate">{coal.emoji} {coal.name}</div>
              <div className="text-[7px] font-mono text-ink-3">{coal.parties.map(id => RO_PARTY_MAP[id]?.name).join(' + ')}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Toggle Parties</div>
        <div className="space-y-1.5">
          {RO_LR_ORDER.map(id => {
            const party = RO_PARTY_MAP[id];
            const isIn = selected.has(id); const color = partyColor(id);
            return (
              <button key={id} onClick={() => toggle(id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-[4px] border transition-colors ${isIn ? 'border-transparent' : 'border-default hover:bg-hover'}`}
                style={isIn ? { background: hexToRgba(color, 0.12), borderColor: hexToRgba(color, 0.40) } : {}}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="flex-1 text-[10px] font-medium text-ink truncate text-left">{party.fullName}</span>
                <span className="text-[9px] font-mono font-bold" style={{ color }}>{cameraSeats[id] ?? 0}</span>
                {isIn && <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M2 4.5l1.8 1.8L7 2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/></svg>}
              </button>
            );
          })}
        </div>
      </div>
      <div className={`px-3.5 py-3 border-t border-default shrink-0 ${hasMajority ? 'bg-emerald-500/10' : ''}`}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono font-bold text-ink">Coalition total</span>
          <span className="text-[20px] font-black font-mono" style={{ color: hasMajority ? '#16a34a' : '#ef4444' }}>{totalCoalSeats}</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-black/8 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300" style={{ width:`${Math.min(totalCoalSeats/RO_CAMERA_SEATS*100,100)}%`, background: hasMajority ? '#16a34a' : '#ef4444' }} />
        </div>
        <div className={`mt-1.5 text-[9px] font-mono text-center font-bold ${hasMajority ? 'text-emerald-600' : 'text-red-500'}`}>
          {hasMajority ? `✓ MAJORITY (need ${RO_CAMERA_MAJORITY})` : `✗ ${RO_CAMERA_MAJORITY - totalCoalSeats} seats short of majority`}
        </div>
      </div>
    </aside>
  );
}

// ── Analysis panel ─────────────────────────────────────────────────────────────
function RoAnalysisPanel({ natPcts, cameraSeats, onClose, exiting, dark }: {
  natPcts: Record<RoPartyId, number>;
  cameraSeats: Partial<Record<RoPartyId, number>>;
  onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  // ── Core stats computation ──────────────────────────────────────────────────
  // A party qualifies if it clears the 5% national bar OR the ≥20%/4-county alt-threshold
  const altQualifiers = useMemo(() => getAltThresholdQualifiers(natPcts), [natPcts]);
  const qualifyingParties = useMemo(
    () => RO_PARTIES.filter(p => (natPcts[p.id] ?? 0) >= RO_THRESHOLD || altQualifiers.has(p.id)),
    [natPcts, altQualifiers]
  );
  const belowThreshold = useMemo(
    () => RO_PARTIES.filter(p =>
      (natPcts[p.id] ?? 0) > 0 &&
      (natPcts[p.id] ?? 0) < RO_THRESHOLD &&
      !altQualifiers.has(p.id)   // only truly eliminated parties
    ),
    [natPcts, altQualifiers]
  );

  // Effective Number of Parties — votes (Laakso-Taagepera)
  const totalVotePct = useMemo(() => RO_PARTIES.reduce((s, p) => s + (natPcts[p.id] ?? 0), 0), [natPcts]);
  const enpVotes = useMemo(() => {
    if (totalVotePct === 0) return 0;
    const ss = RO_PARTIES.reduce((s, p) => { const v = (natPcts[p.id] ?? 0) / totalVotePct; return s + v * v; }, 0);
    return ss > 0 ? 1 / ss : 0;
  }, [natPcts, totalVotePct]);

  // Effective Number of Parties — seats
  const totalSeats = useMemo(() => RO_PARTIES.reduce((s, p) => s + (cameraSeats[p.id] ?? 0), 0), [cameraSeats]);
  const enpSeats = useMemo(() => {
    if (totalSeats === 0) return 0;
    const ss = RO_PARTIES.reduce((s, p) => { const v = (cameraSeats[p.id] ?? 0) / totalSeats; return s + v * v; }, 0);
    return ss > 0 ? 1 / ss : 0;
  }, [cameraSeats, totalSeats]);

  // Gallagher Disproportionality Index
  const gallagher = useMemo(() => {
    if (totalVotePct === 0 || totalSeats === 0) return 0;
    const sumSq = RO_PARTIES.reduce((s, p) => {
      const v = (natPcts[p.id] ?? 0) / totalVotePct * 100;
      const seats = totalSeats > 0 ? (cameraSeats[p.id] ?? 0) / totalSeats * 100 : 0;
      const diff = v - seats;
      return s + diff * diff;
    }, 0);
    return Math.sqrt(sumSq / 2);
  }, [natPcts, cameraSeats, totalVotePct, totalSeats]);

  // County wins per party
  const countyWins = useMemo(() => {
    const wins: Partial<Record<RoPartyId, number>> = {};
    for (const county of RO_COUNTIES) {
      const cv = calcCountyVotes(natPcts, county.id);
      const sorted = (Object.entries(cv) as [RoPartyId, number][]).sort(([, a], [, b]) => b - a);
      if (sorted.length > 0) {
        const winner = sorted[0][0] as RoPartyId;
        wins[winner] = (wins[winner] ?? 0) + 1;
      }
    }
    return wins;
  }, [natPcts]);

  // Strongest & weakest county per party
  const partyExtremes = useMemo(() => {
    const best: Partial<Record<RoPartyId, { county: RoCounty; pct: number }>> = {};
    const worst: Partial<Record<RoPartyId, { county: RoCounty; pct: number }>> = {};
    for (const county of RO_COUNTIES) {
      const cv = calcCountyVotes(natPcts, county.id);
      for (const p of RO_PARTIES) {
        const pct = cv[p.id] ?? 0;
        if (!best[p.id] || pct > best[p.id]!.pct) best[p.id] = { county, pct };
        if (!worst[p.id] || pct < worst[p.id]!.pct) worst[p.id] = { county, pct };
      }
    }
    return { best, worst };
  }, [natPcts]);

  // Most competitive / most dominant counties
  const countyMargins = useMemo(() => {
    return RO_COUNTIES.map(county => {
      const cv = calcCountyVotes(natPcts, county.id);
      const sorted = (Object.entries(cv) as [RoPartyId, number][]).sort(([, a], [, b]) => b - a);
      const margin = sorted.length >= 2 ? sorted[0][1] - sorted[1][1] : (sorted[0]?.[1] ?? 0);
      const winner = sorted[0]?.[0] as RoPartyId | undefined;
      return { county, margin, winner };
    });
  }, [natPcts]);

  const mostCompetitive = useMemo(
    () => [...countyMargins].sort((a, b) => a.margin - b.margin).slice(0, 5),
    [countyMargins]
  );
  const mostDominant = useMemo(
    () => [...countyMargins].sort((a, b) => b.margin - a.margin).slice(0, 5),
    [countyMargins]
  );

  // Seats-to-votes ratio
  const seatsToVotes = useMemo(() => {
    return RO_PARTIES
      .filter(p => (natPcts[p.id] ?? 0) > 0)
      .map(p => {
        const vPct = totalVotePct > 0 ? (natPcts[p.id] ?? 0) / totalVotePct * 100 : 0;
        const sPct = totalSeats > 0 ? (cameraSeats[p.id] ?? 0) / totalSeats * 100 : 0;
        return { id: p.id, vPct, sPct, ratio: vPct > 0 ? sPct / vPct : 0 };
      })
      .filter(x => x.vPct > 0)
      .sort((a, b) => b.ratio - a.ratio);
  }, [natPcts, cameraSeats, totalVotePct, totalSeats]);

  // Swing vs 2024
  const swings = useMemo(() => {
    return RO_PARTIES.map(p => ({
      id: p.id,
      cur: natPcts[p.id] ?? 0,
      base: RO_VOTE_PCT_2024[p.id] ?? 0,
      delta: (natPcts[p.id] ?? 0) - (RO_VOTE_PCT_2024[p.id] ?? 0),
    })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [natPcts]);

  // Votes "wasted" below threshold
  const wastedVotePct = useMemo(
    () => belowThreshold.reduce((s, p) => s + (natPcts[p.id] ?? 0), 0),
    [belowThreshold, natPcts]
  );

  const Sec = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.15em] text-gold mt-5 mb-1.5 first:mt-0">{children}</div>
  );
  const StatRow = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="flex items-baseline justify-between py-0.5">
      <span className="text-[10px] text-ink-3 flex-1 pr-2">{label}</span>
      <span className="text-[11px] font-mono font-bold text-ink tabular-nums">{value}</span>
      {sub && <span className="text-[8.5px] font-mono text-ink-3 ml-1">{sub}</span>}
    </div>
  );

  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Election Analysis</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Nerdy stats · Romania 2024 base</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">

        {/* ── System health ─── */}
        <Sec>System Health</Sec>
        <StatRow label="Effective parties (votes)" value={enpVotes.toFixed(2)} />
        <StatRow label="Effective parties (seats)" value={enpSeats.toFixed(2)} />
        <StatRow label="Gallagher disproportionality" value={gallagher.toFixed(2) + '%'} sub={gallagher < 5 ? '(fair)' : gallagher < 10 ? '(mild)' : '(high)'} />
        <StatRow label="Parties in parliament" value={String(qualifyingParties.length)} sub={`of ${RO_PARTIES.length} · 5% or alt`} />
        <StatRow label="Votes wasted (truly eliminated)" value={wastedVotePct.toFixed(1) + '%'} />

        {/* ── County map ─── */}
        <Sec>County Wins (42 total)</Sec>
        <div className="space-y-1">
          {RO_PARTIES
            .map(p => ({ p, wins: countyWins[p.id] ?? 0 }))
            .sort((a, b) => b.wins - a.wins)
            .filter(x => x.wins > 0)
            .map(({ p, wins }) => (
              <div key={p.id} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="text-[10px] font-medium text-ink flex-1">{p.name}</span>
                <div className="flex items-center gap-1">
                  <div className="w-20 h-1.5 rounded-full bg-black/8 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(wins/42)*100}%`, background: p.color }} />
                  </div>
                  <span className="text-[10px] font-mono font-bold text-ink w-5 text-right">{wins}</span>
                </div>
              </div>
            ))}
        </div>

        {/* ── Seats-to-votes ─── */}
        {seatsToVotes.length > 0 && (
          <>
            <Sec>Seats ÷ Votes (D'Hondt bonus/penalty)</Sec>
            <div className="space-y-0.5">
              {seatsToVotes.map(({ id, vPct, sPct, ratio }) => {
                const p = RO_PARTY_MAP[id]; if (!p) return null;
                const bonus = ratio > 1;
                return (
                  <div key={id} className="flex items-center gap-2 py-0.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className="text-[10px] text-ink flex-1">{p.name}</span>
                    <span className="text-[9px] font-mono text-ink-3">{vPct.toFixed(1)}% v</span>
                    <span className="text-[9px] font-mono text-ink-3">{sPct.toFixed(1)}% s</span>
                    <span className={`text-[9.5px] font-mono font-bold ${bonus?'text-emerald-500':'text-red-400'}`}>
                      {bonus ? '▲' : '▼'}{Math.abs(sPct - vPct).toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── Swing vs 2024 ─── */}
        <Sec>Swing vs 2024 Actual</Sec>
        <div className="space-y-0.5">
          {swings.map(({ id, cur, base, delta }) => {
            const p = RO_PARTY_MAP[id]; if (!p) return null;
            const up = delta >= 0;
            return (
              <div key={id} className="flex items-center gap-2 py-0.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="text-[10px] text-ink flex-1">{p.name}</span>
                <span className="text-[9px] font-mono text-ink-3">{base.toFixed(1)}%→{cur.toFixed(1)}%</span>
                <span className={`text-[10px] font-mono font-bold w-12 text-right ${up?'text-emerald-500':'text-red-400'}`}>
                  {up?'+':''}{delta.toFixed(1)}pp
                </span>
              </div>
            );
          })}
        </div>

        {/* ── Battleground counties ─── */}
        <Sec>🔥 Most Competitive Counties</Sec>
        <div className="space-y-1">
          {mostCompetitive.map(({ county, margin, winner }) => (
            <div key={county.id} className="flex items-center gap-2">
              {winner && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: partyColor(winner) }} />}
              <span className="text-[10px] text-ink flex-1">{county.name}</span>
              <span className="text-[9.5px] font-mono font-bold text-amber-500">{margin.toFixed(1)}pp margin</span>
            </div>
          ))}
        </div>

        {/* ── Strongholds ─── */}
        <Sec>💪 Most Dominant Counties</Sec>
        <div className="space-y-1">
          {mostDominant.map(({ county, margin, winner }) => (
            <div key={county.id} className="flex items-center gap-2">
              {winner && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: partyColor(winner) }} />}
              <span className="text-[10px] text-ink flex-1">{county.name}</span>
              <span className="text-[9.5px] font-mono font-bold text-ink-3">{margin.toFixed(1)}pp</span>
            </div>
          ))}
        </div>

        {/* ── Party heartlands ─── */}
        <Sec>🏆 Party Heartlands (best county)</Sec>
        <div className="space-y-1.5">
          {qualifyingParties.map(p => {
            const b = partyExtremes.best[p.id];
            if (!b) return null;
            return (
              <div key={p.id} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="text-[10px] text-ink flex-1">{p.name}</span>
                <span className="text-[9px] font-mono text-ink-3">{b.county.name}</span>
                <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: p.color }}>{b.pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>

        {/* ── Worst areas ─── */}
        <Sec>📉 Weakest County per Party</Sec>
        <div className="space-y-1.5">
          {qualifyingParties.map(p => {
            const w = partyExtremes.worst[p.id];
            if (!w) return null;
            return (
              <div key={p.id} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="text-[10px] text-ink flex-1">{p.name}</span>
                <span className="text-[9px] font-mono text-ink-3">{w.county.name}</span>
                <span className="text-[10px] font-mono font-bold tabular-nums text-ink-3">{w.pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>

        {/* ── Majority math ─── */}
        <Sec>🔢 Majority Math (Camera, {RO_CAMERA_MAJORITY} needed)</Sec>
        {totalSeats > 0 ? (
          <>
            <StatRow label="Largest single party" value={
              (() => {
                const [top] = Object.entries(cameraSeats).sort(([,a],[,b]) => (b??0)-(a??0));
                return top ? `${RO_PARTY_MAP[top[0] as RoPartyId]?.name} (${top[1]})` : '—';
              })()
            } />
            <StatRow label="Seats from threshold parties"
              value={qualifyingParties.reduce((s, p) => s + (cameraSeats[p.id] ?? 0), 0).toString()}
              sub={`/ ${RO_CAMERA_SEATS}`} />
            <StatRow label="Seats short if top 2 ally"
              value={(() => {
                const top2 = Object.entries(cameraSeats).sort(([,a],[,b]) => (b??0)-(a??0)).slice(0, 2);
                const combined = top2.reduce((s, [,v]) => s + (v??0), 0);
                const short = RO_CAMERA_MAJORITY - combined;
                return short <= 0 ? '✓ Have majority' : `${short} short`;
              })()}
            />
            <StatRow label="Smallest winning coalition"
              value={(() => {
                // Greedy: add parties by seat count until majority
                const sorted = Object.entries(cameraSeats)
                  .sort(([,a],[,b]) => (b??0)-(a??0));
                let total = 0; let count = 0;
                for (const [, v] of sorted) {
                  total += v ?? 0; count++;
                  if (total >= RO_CAMERA_MAJORITY) break;
                }
                return `${count} part${count === 1 ? 'y' : 'ies'}`;
              })()}
            />
          </>
        ) : (
          <div className="text-[10px] text-ink-3 font-mono">Adjust sliders to compute seats</div>
        )}

        {/* ── Fun facts ─── */}
        <Sec>💡 Fun Facts</Sec>
        <div className="text-[10px] text-ink leading-relaxed space-y-2">
          <p>Romania uses <strong>D'Hondt</strong> — mathematically the most seat-generous to large parties, explaining why ENP(seats) &lt; ENP(votes).</p>
          <p>The Gallagher index above <strong>10%</strong> signals high disproportionality. Germany's PR usually scores ~1–3%; Romania's 5% threshold boosts it.</p>
          <p>Covasna (CV) and Harghita (HR) are unique: <strong>UDMR dominates</strong> with 40–88% in counties with large Hungarian minorities.</p>
          <p>București (B) is Romania's electoral heavyweight: <strong>{(RO_COUNTY_VALID_VOTES_2024['B']/RO_GRAND_TOTAL_VOTES*100).toFixed(1)}%</strong> of all valid votes in 2024.</p>
        </div>
      </div>
    </aside>
  );
}

// ── County Breakdown panel ─────────────────────────────────────────────────────
function RoCountyBreakdownPanel({ natPcts, countyOverrides, onClose, exiting, dark }: {
  natPcts: Record<RoPartyId, number>;
  countyOverrides?: Record<string, Record<RoPartyId, number>>;
  onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  type SortKey = 'name' | 'seats' | 'winner';
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [query, setQuery]   = useState('');

  // Determine qualifying parties (threshold check) — same as calcSeatsTwoStage Stage 0
  const qualifying = useMemo(() => {
    const altQ = getAltThresholdQualifiers(natPcts, countyOverrides);
    const q = new Set<RoPartyId>();
    for (const p of RO_PARTIES) {
      if ((natPcts[p.id] ?? 0) >= RO_THRESHOLD || altQ.has(p.id)) q.add(p.id);
    }
    return q;
  }, [natPcts, countyOverrides]);

  const rows = useMemo(() => RO_COUNTIES.map(county => {
    const cv = countyOverrides?.[county.id] ?? calcCountyVotes(natPcts, county.id);
    const sorted = (Object.entries(cv) as [RoPartyId, number][])
      .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
    const winner    = sorted[0]?.[0] as RoPartyId | undefined;
    const winnerPct = sorted[0]?.[1] ?? 0;
    const seats     = RO_COUNTY_CAMERA_SEATS[county.id] ?? 0;
    const stage1Seats = calcCountySeatStage1(county.id, cv, qualifying);
    return { county, sorted, winner, winnerPct, seats, stage1Seats };
  }), [natPcts, countyOverrides, qualifying]);

  const displayRows = useMemo(() => {
    const q = query.toLowerCase();
    let filtered = q
      ? rows.filter(r => r.county.name.toLowerCase().includes(q) || r.county.id.toLowerCase().includes(q))
      : rows;
    if (sortBy === 'seats')  return [...filtered].sort((a, b) => b.seats - a.seats || a.county.name.localeCompare(b.county.name));
    if (sortBy === 'winner') return [...filtered].sort((a, b) => (a.winner ?? 'Z').localeCompare(b.winner ?? 'Z') || a.county.name.localeCompare(b.county.name));
    return filtered; // 'name' — already alphabetical
  }, [rows, sortBy, query]);

  // County wins summary
  const countyWins = useMemo(() => {
    const w: Partial<Record<RoPartyId, number>> = {};
    for (const r of rows) if (r.winner) w[r.winner] = (w[r.winner] ?? 0) + 1;
    return Object.entries(w).sort(([, a], [, b]) => b - a) as [RoPartyId, number][];
  }, [rows]);

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button onClick={() => setSortBy(k)}
      className={`px-2 py-0.5 rounded text-[8.5px] font-mono font-semibold uppercase tracking-wide transition-colors ${sortBy === k ? 'bg-gold text-white' : 'text-ink-3 hover:text-ink hover:bg-hover'}`}>
      {label}
    </button>
  );

  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">County Results</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">42 constituencies · Camera Deputaților</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      {/* County-wins summary */}
      <div className="px-3.5 py-2 border-b border-default shrink-0">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-1.5">County wins</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {countyWins.map(([id, n]) => (
            <div key={id} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: partyColor(id) }} />
              <span className="text-[9.5px] font-mono font-bold text-ink">{RO_PARTY_MAP[id]?.name}</span>
              <span className="text-[9.5px] font-mono text-ink-3">{n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Search + sort */}
      <div className="px-3.5 py-2 border-b border-default shrink-0 flex items-center gap-2">
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Filter counties…"
          className="flex-1 h-6 px-2 text-[10px] font-mono rounded border border-default bg-canvas text-ink placeholder:text-ink-3 outline-none focus:border-gold"
        />
        <div className="flex gap-0.5">
          <SortBtn k="name"   label="A–Z" />
          <SortBtn k="winner" label="Party" />
          <SortBtn k="seats"  label="Seats" />
        </div>
      </div>

      {/* County rows */}
      <div className="flex-1 overflow-y-auto thin-scroll">
        {displayRows.map(({ county, sorted, winner, seats, stage1Seats }) => {
          const wColor = winner ? partyColor(winner) : '#888';
          const top4 = sorted.slice(0, 4);
          // Seat allocation bar: show stage-1 seats as blocks (each block = 1 seat)
          const seatEntries = (Object.entries(stage1Seats) as [RoPartyId, number][])
            .filter(([, n]) => n > 0)
            .sort(([, a], [, b]) => b - a);
          const stage1Total = seatEntries.reduce((s, [, n]) => s + n, 0);
          const unallocated = seats - stage1Total; // seats not yet claimed in Stage 1
          return (
            <div key={county.id}
              className={`px-3.5 py-2.5 border-b border-default hover:bg-hover transition-colors cursor-default`}
              style={{ borderLeftWidth: 3, borderLeftColor: wColor }}>
              {/* Row 1: code · name · seats badge */}
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[9px] font-mono font-bold w-6 shrink-0 tabular-nums" style={{ color: wColor }}>{county.id}</span>
                <span className="text-[10px] font-semibold text-ink flex-1 truncate">{county.name}</span>
                <span className="text-[8px] font-mono text-ink-3 shrink-0">{seats} seats</span>
              </div>
              {/* Row 2: vote-share bar (proportional to vote, NOT seats) */}
              <div className="flex items-center gap-1 mb-1">
                <span className="text-[7px] font-mono text-ink-3 w-7 shrink-0">votes</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden flex" style={{ background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }}>
                  {top4.map(([id, pct]) => {
                    const total = top4.reduce((s, [, v]) => s + v, 0);
                    return <div key={id} style={{ width: `${(pct / (total || 1)) * 100}%`, background: partyColor(id as RoPartyId), flexShrink: 0 }} />;
                  })}
                </div>
              </div>
              {/* Row 3: seat-allocation bar (each pip = 1 Stage-1 seat) */}
              <div className="flex items-center gap-1 mb-1">
                <span className="text-[7px] font-mono text-ink-3 w-7 shrink-0">seats</span>
                <div className="flex-1 flex gap-px">
                  {seatEntries.map(([id, n]) =>
                    Array.from({ length: n }, (_, i) => (
                      <div key={`${id}-${i}`} style={{ flex: 1, height: 6, background: partyColor(id as RoPartyId), borderRadius: 1, maxWidth: 16 }} />
                    ))
                  )}
                  {Array.from({ length: unallocated }, (_, i) => (
                    <div key={`u-${i}`} style={{ flex: 1, height: 6, background: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)', borderRadius: 1, maxWidth: 16 }} />
                  ))}
                </div>
              </div>
              {/* Row 4: top parties with vote % and seat count */}
              <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                {top4.slice(0, 3).map(([id, pct]) => {
                  const n = stage1Seats[id as RoPartyId] ?? 0;
                  return (
                    <div key={id} className="flex items-center gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: partyColor(id as RoPartyId) }} />
                      <span className="text-[8px] font-mono" style={{ color: partyColor(id as RoPartyId) }}>
                        {RO_PARTY_MAP[id as RoPartyId]?.name ?? id} {pct.toFixed(1)}%{n > 0 ? ` ·${n}✦` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ── Tutorial panel ─────────────────────────────────────────────────────────────
function RoTutorialPanel({ onClose, exiting, dark }: { onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const H2 = ({ children }: { children: React.ReactNode }) => <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-5 mb-1.5 first:mt-0">{children}</div>;
  const P  = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] text-ink leading-relaxed mb-2">{children}</p>;
  const Note = ({ children }: { children: React.ReactNode }) => <div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{children}</div>;
  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Romanian Elections Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">

        <H2>🗺 Map Presets</H2>
        <P><strong>2024 Baseline</strong> loads the real December 2024 election result. <strong>2026 Polling</strong> loads the current polling average (AUR surging, SOS/POT below threshold). <strong>Blank Map</strong> starts with no counties projected — click each county to call it manually.</P>

        <H2>🏛 Two-Stage Proportional System</H2>
        <P>Romania uses a <strong>two-stage PR</strong> system under Law 208/2015. <strong>Stage 1</strong> allocates seats county-by-county via Hare quota (floor). <strong>Stage 2</strong> pools each party's remainder votes nationally and runs D'Hondt to fill the leftover seats (including 4 diaspora).</P>
        <Note>This simulator models the real system: 331 seats, Hare per county → D'Hondt on remainders.</Note>

        <H2>🚧 Entry Thresholds</H2>
        <P><strong>National (5%):</strong> win ≥ 5% of all valid votes nationwide. Parties below this appear faded in the scoreboard.</P>
        <P><strong>Alternative (Law 208/2015):</strong> win <strong>≥ 20% in at least 4 counties</strong> to enter even below 5% nationally. This protects <strong>UDMR</strong>, dominant in Harghita, Covasna, Mureș, and Satu Mare.</P>
        <Note>In the Simulation panel: <strong>"alt"</strong> badge = qualifies via 4-county route; <strong>"elim"</strong> = truly eliminated.</Note>

        <H2>🗂 County Results (Counties button)</H2>
        <P>Click <strong>Counties</strong> in the toolbar for a full table of all 42 constituencies — stacked vote-share bars, leading party, and Camera seats per county. Filter by name or sort by party / seats.</P>

        <H2>🖱 County Panel (click map)</H2>
        <P>Click any county on the map to open its breakdown. View estimated vote splits and manually adjust percentages. In <strong>Blank Map</strong> mode, use <strong>▶ Project Results</strong> to call that county.</P>

        <H2>▶ Simulation</H2>
        <P>Open <strong>▶ Simulation</strong> and type national vote shares for each party. No auto-redistribution — adjust freely. If tracked parties exceed 100% the Run button is disabled.</P>
        <P>Click <strong>▶ Run Simulation</strong>: the map resets to blank and all 42 counties report in <strong>5 random batches</strong> on a bell-curve schedule. Seats update live. The <strong>↩ Reference</strong> button shows the last preset's shares for comparison.</P>

        <H2>🏟 Parliament</H2>
        <P>Click <strong>Parliament</strong> for the parliamentary-composition diagram (Camera Deputaților, 331 seats) with a majority bar and left-to-right party ordering.</P>

        <H2>🤝 Coalition Builder</H2>
        <P>Click <strong>Coalition</strong> to toggle parties in/out and check whether a combination reaches the <strong>166-seat majority</strong>.</P>

        <H2>📊 Analysis</H2>
        <P>Click <strong>Analysis</strong> for ENP (votes & seats), Gallagher index, county wins, most competitive / dominant counties, seats-to-votes ratios, and swing vs 2024.</P>

        <H2>🫧 Bubble Map</H2>
        <P>Toggle <strong>Bubble Map</strong> to overlay circles: colour = winner, size = winning margin. Hover for the county breakdown.</P>

        <H2>🇷🇴 Parties</H2>
        <P><strong>PSD</strong> Social Democrats · <strong>AUR</strong> far-right nationalist · <strong>PNL</strong> centre-right liberals · <strong>USR</strong> reformist anti-corruption · <strong>SOS</strong> hard-right · <strong>POT</strong> Georgescu-linked populist · <strong>UDMR</strong> Hungarian minority.</P>
      </div>
    </aside>
  );
}

// ── Reporting widget (bottom-left of map, Canada-style) ───────────────────────
function RoReportingWidget({ projectedCounties, declaredCounties, isSim, dark }: {
  projectedCounties: Set<RoCountyId>;
  declaredCounties?: Set<RoCountyId>;
  isSim: boolean;
  dark?: boolean;
}) {
  const bg     = dark ? 'rgba(7,13,28,0.88)'      : 'rgba(255,255,255,0.92)';
  const border = dark ? 'rgba(255,255,255,0.09)'   : 'rgba(0,0,0,0.09)';
  const ink2   = dark ? 'rgba(255,255,255,0.45)'   : 'rgba(0,0,0,0.42)';
  const accentColor = isSim ? '#3b82f6' : '#16a34a';

  const counties = isSim ? (declaredCounties ?? new Set<RoCountyId>()) : projectedCounties;
  const count    = counties.size;
  const total    = RO_COUNTIES.length; // 42 mainland

  let reportedVotes = 0;
  for (const id of counties) reportedVotes += RO_COUNTY_VALID_VOTES_2024[id as RoCountyId] ?? 0;
  const reportedPct = total > 0 ? Math.min(100, (reportedVotes / RO_TOTAL_MAINLAND_VOTES) * 100) : 0;

  return (
    <div className="absolute bottom-8 left-3 z-[1001] pointer-events-none select-none"
      style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10,
        backdropFilter: 'blur(10px)', padding: '10px 13px', minWidth: 176,
        boxShadow: '0 4px 20px rgba(0,0,0,0.18)' }}>
      <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.15em] mb-1.5" style={{ color: ink2 }}>
        {isSim ? '⚡ Live Count' : '📊 Results'}
      </div>
      <div className="text-[13px] font-black font-mono text-ink leading-none">
        {count} <span className="text-[10px] font-semibold" style={{ color: ink2 }}>/ {total}</span>
      </div>
      <div className="text-[9px] font-mono mt-0.5 mb-2" style={{ color: ink2 }}>
        {isSim ? 'counties declared' : 'counties projected'}
      </div>
      <div className="h-1.5 rounded-full overflow-hidden"
        style={{ background: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)' }}>
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${reportedPct}%`, background: accentColor }} />
      </div>
      <div className="text-[9px] font-mono font-bold mt-1 text-right" style={{ color: accentColor }}>
        {reportedPct.toFixed(1)}% of votes
      </div>
    </div>
  );
}

// ── Main app ───────────────────────────────────────────────────────────────────
export default function RomaniaApp() {
  const navigate = useNavigate();

  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  const [preset, setPreset]   = useState<'2024'|'polling2026'|'blank'|'custom'>('polling2026');
  const [natPcts, setNatPcts] = useState<Record<RoPartyId, number>>(() => ({ ...RO_VOTE_PCT_2026_POLLING }));
  const [projectedCounties, setProjectedCounties] = useState<Set<RoCountyId>>(new Set());

  function load2024()        { setNatPcts({ ...RO_VOTE_PCT_2024 }); setPreset('2024'); setProjectedCounties(new Set()); resetSim(); }
  function loadPolling2026() { setNatPcts({ ...RO_VOTE_PCT_2026_POLLING }); setPreset('polling2026'); setProjectedCounties(new Set()); resetSim(); }
  function loadBlank() {
    setNatPcts({ ...RO_VOTE_PCT_2024 });   // keep 2024 as the swing base
    setPreset('blank');
    setProjectedCounties(new Set());
    resetSim();
  }

  const [selectedCounty, setSelectedCounty]       = useState<RoCountyId | null>(null);
  const [countyOverrides, setCountyOverrides]     = useState<Record<string, Record<RoPartyId, number>>>({});
  const [bubbleMap, setBubbleMap]                 = useState(false);
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [simOpen, setSimOpen]                     = useState(false);
  const [parliOpen, setParliOpen]                 = useState(false);
  const [coalitionOpen, setCoalitionOpen]         = useState(false);
  const [analysisOpen, setAnalysisOpen]           = useState(false);
  const [breakdownOpen, setBreakdownOpen]         = useState(false);
  const [tutorialOpen, setTutorialOpen]           = useState(false);
  const [exitPanel, setExitPanel]                 = useState<string | null>(null);
  const exitTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  const triggerExit = useCallback((panel: string) => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    setExitPanel(panel);
    exitTimerRef.current = setTimeout(() => setExitPanel(null), 280);
  }, []);

  const [simCameraSeats, setSimCameraSeats]   = useState<Partial<Record<RoPartyId, number>> | undefined>();
  const [simProgress, setSimProgress]         = useState(0);
  const [simRunning, setSimRunning]           = useState(false);
  const [declaredCounties, setDeclaredCounties] = useState<Set<RoCountyId> | undefined>();
  const simTimersRef      = useRef<ReturnType<typeof setTimeout>[]>([]);
  const natPctsAtSimStart = useRef<Record<RoPartyId, number>>(natPcts);

  // Reference snapshot (last loaded preset) for the ↩ popup in sim panel
  const [simRefPcts,  setSimRefPcts]  = useState<Record<RoPartyId, number> | null>(null);
  const [simRefLabel, setSimRefLabel] = useState<string>('');
  const [refOpen,     setRefOpen]     = useState(false);

  // Draft inputs for sim panel — ISOLATED from natPcts so typing doesn't update the map
  const [simDraftPcts,   setSimDraftPcts]   = useState<Record<RoPartyId, number>>(() => ({ ...natPcts }));
  // Edit buffer: raw string shown while an input is focused, committed on blur
  const [simEditBuf, setSimEditBuf] = useState<{ key: string; raw: string } | null>(null);

  // Others is also a free-typed independent value — not auto-computed
  const [simDraftOthers, setSimDraftOthers] = useState<number>(() => {
    const s = RO_PARTIES.reduce((acc, p) => acc + (natPcts[p.id] ?? 0), 0);
    return Math.max(0, parseFloat((100 - s).toFixed(1)));
  });

  // Stable sort order: captured when sim panel opens, not reshuffled on every keystroke
  const [simSortOrder, setSimSortOrder] = useState<RoPartyId[]>(() =>
    [...RO_PARTIES].sort((a, b) => (RO_VOTE_PCT_2026_POLLING[b.id] ?? 0) - (RO_VOTE_PCT_2026_POLLING[a.id] ?? 0)).map(p => p.id)
  );
  useEffect(() => {
    if (!simOpen) { setRefOpen(false); return; }
    setSimSortOrder([...RO_PARTIES].sort((a, b) => (natPcts[b.id] ?? 0) - (natPcts[a.id] ?? 0)).map(p => p.id));
    // Re-seed draft from current map state each time the panel opens
    setSimDraftPcts({ ...natPcts });
    const s = RO_PARTIES.reduce((acc, p) => acc + (natPcts[p.id] ?? 0), 0);
    setSimDraftOthers(Math.max(0, parseFloat((100 - s).toFixed(1))));
    // Capture the reference snapshot
    setSimRefPcts({ ...natPcts });
    setSimRefLabel(
      preset === '2024'         ? '2024 Baseline' :
      preset === 'polling2026'  ? '2026 Polling'  :
      preset === 'blank'        ? '2024 Reference' : 'Custom'
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simOpen]); // natPcts / preset intentionally omitted — captures snapshot at panel-open only

  function stopSim() { simTimersRef.current.forEach(clearTimeout); simTimersRef.current = []; setSimRunning(false); }
  function resetSim() { stopSim(); setSimCameraSeats(undefined); setDeclaredCounties(undefined); setSimProgress(0); }

  useEffect(() => {
    const el = headerScrollRef.current; if (!el) return;
    const h = (e: WheelEvent) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft += e.deltaY; };
    el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h);
  }, []);

  // In blank mode: weighted-average pcts of projected counties (zeros when none projected)
  const blankDisplayPcts = useMemo<Record<RoPartyId, number>>(() => {
    const zero = Object.fromEntries(RO_PARTIES.map(p => [p.id, 0])) as Record<RoPartyId, number>;
    if (preset !== 'blank' || projectedCounties.size === 0) return zero;
    const weighted: Partial<Record<RoPartyId, number>> = {};
    let totalV = 0;
    for (const id of projectedCounties) {
      const cv = (countyOverrides[id] as Record<RoPartyId, number> | undefined) ?? calcCountyVotes(natPcts, id);
      const votes = RO_COUNTY_VALID_VOTES_2024[id as RoCountyId] ?? 0;
      for (const p of RO_PARTIES) weighted[p.id] = (weighted[p.id] ?? 0) + (cv[p.id] ?? 0) * votes;
      totalV += votes;
    }
    if (totalV === 0) return zero;
    return Object.fromEntries(RO_PARTIES.map(p => [p.id, (weighted[p.id] ?? 0) / totalV])) as Record<RoPartyId, number>;
  }, [preset, projectedCounties, natPcts, countyOverrides]);

  const blankTotalVotes = useMemo(
    () => preset === 'blank' ? [...projectedCounties].reduce((s, id) => s + (RO_COUNTY_VALID_VOTES_2024[id as RoCountyId] ?? 0), 0) : RO_GRAND_TOTAL_VOTES,
    [preset, projectedCounties],
  );

  const displayPcts = preset === 'blank' ? blankDisplayPcts : natPcts;

  const cameraSeats = useMemo(() => simCameraSeats ?? calcSeatsTwoStage(displayPcts, countyOverrides), [simCameraSeats, displayPcts, countyOverrides]);

  const btnBase   = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold   = `${btnBase} bg-gold text-white hover:bg-gold-deep`;
  const btnMuted  = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive = `${btnBase} bg-ink/8 border border-default text-ink`;

  const showCounty    = !!selectedCounty && !simOpen;
  const showTutorial  = tutorialOpen   || exitPanel === 'tutorial';
  const showParli     = parliOpen      || exitPanel === 'parli';
  const showCoal      = coalitionOpen  || exitPanel === 'coal';
  const showAnalysis  = analysisOpen   || exitPanel === 'analysis';
  const showBreakdown = breakdownOpen  || exitPanel === 'breakdown';

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="ro">

      {/* ── Topbar ───────────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark?'bg-[rgba(7,13,28,0.94)]':'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
        </button>

        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={load2024}        className={preset==='2024'        ? btnGold : btnMuted}>2024 Baseline</button>
          <button onClick={loadPolling2026} className={preset==='polling2026' ? btnGold : btnMuted}>2026 Polling</button>
          <button onClick={loadBlank}       className={preset==='blank'       ? btnGold : btnMuted}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={() => setSimOpen(v => !v)} className={simOpen ? btnActive : btnMuted}>▶ Simulation</button>
          <button onClick={() => setScoreboardVisible(v => !v)} className={scoreboardVisible ? btnActive : btnMuted}>Scoreboard</button>
          <button onClick={() => {
            if (parliOpen) { setParliOpen(false); triggerExit('parli'); }
            else { setParliOpen(true); setCoalitionOpen(false); }
          }} className={parliOpen ? btnActive : btnMuted}>Parliament</button>
          <button onClick={() => {
            if (coalitionOpen) { setCoalitionOpen(false); triggerExit('coal'); }
            else { setCoalitionOpen(true); setParliOpen(false); }
          }} className={coalitionOpen ? btnActive : btnMuted}>Coalition</button>
          <button onClick={() => {
            if (analysisOpen) { setAnalysisOpen(false); triggerExit('analysis'); }
            else { setAnalysisOpen(true); setBreakdownOpen(false); setTutorialOpen(false); }
          }} className={analysisOpen ? btnActive : btnMuted}>Analysis</button>
          <button onClick={() => {
            if (breakdownOpen) { setBreakdownOpen(false); triggerExit('breakdown'); }
            else { setBreakdownOpen(true); setAnalysisOpen(false); setTutorialOpen(false); }
          }} className={breakdownOpen ? btnActive : btnMuted}>Counties</button>
          <button onClick={() => setBubbleMap(v => !v)}
            className={bubbleMap ? `${btnBase} bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700` : btnMuted}>
            Bubble Map
          </button>
          <button onClick={() => {
            if (tutorialOpen) { setTutorialOpen(false); triggerExit('tutorial'); }
            else { setTutorialOpen(true); setAnalysisOpen(false); }
          }} className={tutorialOpen ? btnActive : btnMuted}>Tutorial</button>
        </div>

        <div className="shrink-0 flex items-center gap-2 pr-4">
          <button onClick={() => setDark(v => !v)} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:text-ink transition-colors">
            {dark ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {/* ── Scoreboard ───────────────────────────────────────────────────── */}
      {scoreboardVisible && !(preset === 'blank' && projectedCounties.size === 0) && (
        <RoScoreboard natPcts={displayPcts} simCameraSeats={simCameraSeats} isBaseline={preset==='2024'}
          totalVotesBase={preset==='blank' ? blankTotalVotes : undefined} dark={dark} />
      )}

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Parliament — LEFT */}
        {showParli && (
          <RoParliamentPanel
            cameraSeats={cameraSeats}
            onClose={() => { setParliOpen(false); triggerExit('parli'); }}
            exiting={exitPanel==='parli'} dark={dark}
          />
        )}

        {/* Map + reporting widget */}
        <div className="relative flex-1 min-w-0 min-h-0">
          <RoMapView
            natPcts={natPcts} selectedCounty={selectedCounty}
            onSelect={id => setSelectedCounty(prev => prev === id ? null : id)}
            dark={dark} bubbleMap={bubbleMap} declaredCounties={declaredCounties}
            overrides={countyOverrides}
            blankMode={preset === 'blank'} projectedCounties={projectedCounties}
          />
          {/* Reporting widget — shown in blank map mode or during/after sim */}
          {(preset === 'blank' || simRunning || simCameraSeats != null) && (
            <RoReportingWidget
              projectedCounties={projectedCounties}
              declaredCounties={declaredCounties}
              isSim={simRunning || (simCameraSeats != null && preset !== 'blank')}
              dark={dark}
            />
          )}
        </div>

        {/* Simulation panel — wrapped in relative so reference popup can float left */}
        {simOpen && (
          <div className="relative shrink-0">

            {/* ── Reference popup (floats LEFT of sim panel) ── */}
            {refOpen && simRefPcts && (
              <div className="absolute right-full top-0 bottom-0 w-52 z-[1002] overflow-y-auto thin-scroll"
                style={{
                  background: dark ? 'rgba(7,13,28,0.97)' : 'rgba(255,255,255,0.98)',
                  borderLeft: `1px solid ${dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)'}`,
                  borderRight: `1px solid ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'}`,
                  boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
                }}>
                <div className="px-3 pt-3 pb-2 border-b border-default flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold text-ink leading-none">Reference</p>
                    <p className="text-[8px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{simRefLabel}</p>
                  </div>
                  <button onClick={() => setRefOpen(false)} className="w-5 h-5 flex items-center justify-center rounded text-ink-3 hover:text-ink hover:bg-hover text-sm">×</button>
                </div>
                <div className="px-3 py-2 space-y-2">
                  {simSortOrder.map(id => {
                    const party = RO_PARTY_MAP[id]; if (!party) return null;
                    const refPct  = simRefPcts[id] ?? 0;
                    const curPct  = natPcts[id] ?? 0;
                    const delta   = curPct - refPct;
                    const color   = partyColor(id);
                    return (
                      <div key={id}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                          <span className="text-[9px] font-medium text-ink flex-1 truncate">{party.name}</span>
                          <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color }}>{refPct.toFixed(1)}%</span>
                          {Math.abs(delta) >= 0.1 && (
                            <span className={`text-[8px] font-mono tabular-nums ${delta > 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                            </span>
                          )}
                        </div>
                        <div className="h-1 rounded-full overflow-hidden" style={{ background: hexToRgba(color, 0.12) }}>
                          <div style={{ width: `${Math.min(refPct / 50 * 100, 100)}%`, background: color, height: '100%', borderRadius: '9999px' }} />
                        </div>
                      </div>
                    );
                  })}
                  {(() => {
                    const refOther = Math.max(0, 100 - Object.values(simRefPcts).reduce((s, v) => s + v, 0));
                    return refOther >= 0.1 ? (
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-gray-400" />
                          <span className="text-[9px] font-medium text-ink-3 flex-1">Others</span>
                          <span className="text-[10px] font-mono font-bold tabular-nums text-ink-3">{refOther.toFixed(1)}%</span>
                        </div>
                        <div className="h-1 rounded-full overflow-hidden bg-ink/8">
                          <div style={{ width: `${Math.min(refOther / 50 * 100, 100)}%`, background: '#9CA3AF', height: '100%', borderRadius: '9999px' }} />
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
            )}

            <aside className={`w-72 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide h-full`}>
              <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2>
                  <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Two-stage PR · 5% / alt threshold</p>
                </div>
                {/* Reference popup toggle */}
                <button
                  onClick={() => setRefOpen(v => !v)}
                  title={`Compare against ${simRefLabel}`}
                  className={`shrink-0 h-6 px-2 rounded-[4px] text-[9px] font-mono font-semibold uppercase tracking-wide transition-colors border ${
                    refOpen
                      ? 'bg-gold/15 border-gold/40 text-gold'
                      : 'border-default text-ink-3 hover:text-ink hover:bg-hover'
                  }`}>
                  ↩ {simRefLabel}
                </button>
                <button onClick={() => setSimOpen(false)} className="w-6 h-6 shrink-0 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
              </div>

              {/* ── Party input rows — each value is INDEPENDENT, no auto-redistribution ── */}
              {(() => {
                const draftTrackedSum = RO_PARTIES.reduce((s, p) => s + (simDraftPcts[p.id] ?? 0), 0);
                const grandTotal      = draftTrackedSum + simDraftOthers;
                const overflow        = grandTotal > 100.05;
                const underflow       = grandTotal < 99.95;
                const totalInvalid    = overflow || underflow;
                return (
                  <>
                    <div className="flex-1 overflow-y-auto px-3 py-3 thin-scroll space-y-2">
                      {simSortOrder.map(partyId => {
                        const party = RO_PARTY_MAP[partyId];
                        if (!party) return null;
                        const pct      = simDraftPcts[party.id] ?? 0;
                        const color    = partyColor(party.id);
                        const isRegional = party.thresholdType === 'regional';
                        const belowStd   = pct < RO_THRESHOLD;
                        const altQualifies = isRegional && (() => {
                          let cnt = 0;
                          for (const cId of Object.keys(RO_COUNTY_CAMERA_SEATS) as RoCountyId[]) {
                            if ((calcCountyVotes(simDraftPcts as Record<RoPartyId,number>, cId)[partyId] ?? 0) >= 20) cnt++;
                          }
                          return cnt >= 4;
                        })();
                        return (
                          <div key={party.id} className={`rounded-lg px-2.5 py-2 transition-colors ${dark ? 'bg-white/[0.04] hover:bg-white/[0.07]' : 'bg-black/[0.025] hover:bg-black/[0.05]'}`}>
                            {/* Row 1: dot · name · threshold badge */}
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                              <span className="text-[10px] font-semibold text-ink flex-1 truncate leading-none">{party.fullName}</span>
                              {isRegional ? (
                                belowStd && !altQualifies
                                  ? <span title="Below 5% AND alt-threshold unreachable" className="text-[7px] font-mono text-red-400 shrink-0 px-1 py-px rounded border border-red-400/30">elim</span>
                                  : belowStd && altQualifies
                                    ? <span title="Qualifies via ≥20% in 4+ counties" className="text-[7px] font-mono text-amber-500 shrink-0 px-1 py-px rounded border border-amber-500/30">alt</span>
                                    : null
                              ) : (
                                belowStd && pct > 0 && (
                                  <span title="Below 5% threshold" className="text-[7px] font-mono text-red-400 shrink-0 px-1 py-px rounded border border-red-400/30">&lt;5%</span>
                                )
                              )}
                            </div>
                            {/* Row 2: abbrev · bar · input */}
                            <div className="flex items-center gap-2">
                              <span className="text-[8px] font-mono font-bold w-7 shrink-0" style={{ color: hexToRgba(color, 0.7) }}>{party.name}</span>
                              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: hexToRgba(color, 0.12) }}>
                                <div style={{ width: `${Math.min(pct / 55 * 100, 100)}%`, background: color, height: '100%', borderRadius: '9999px', transition: 'width 0.15s ease' }} />
                              </div>
                              <input
                                type="text" inputMode="decimal"
                                value={simEditBuf?.key === party.id ? simEditBuf.raw : pct.toFixed(1)}
                                onFocus={e => { setSimEditBuf({ key: party.id, raw: pct.toFixed(1) }); e.target.select(); }}
                                onChange={e => setSimEditBuf({ key: party.id, raw: e.target.value })}
                                onBlur={() => {
                                  if (simEditBuf?.key === party.id) {
                                    const v = Math.max(0, Math.min(100, parseFloat(simEditBuf.raw) || 0));
                                    setSimDraftPcts(prev => ({ ...prev, [party.id]: v }));
                                    setSimEditBuf(null);
                                  }
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                }}
                                className="w-14 text-[12px] font-mono font-bold tabular-nums text-center rounded-md outline-none transition-colors"
                                style={{
                                  color,
                                  background: hexToRgba(color, 0.10),
                                  border: `1.5px solid ${hexToRgba(color, 0.35)}`,
                                  padding: '3px 4px',
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}

                      {/* ── Others — fully editable, independent of party inputs ─── */}
                      <div className={`rounded-lg px-2.5 py-2 transition-colors ${dark ? 'bg-white/[0.04] hover:bg-white/[0.07]' : 'bg-black/[0.025] hover:bg-black/[0.05]'}`}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0 bg-gray-400" />
                          <span className="text-[10px] font-semibold text-ink-3 flex-1 leading-none">Others</span>
                          <span className="text-[7.5px] font-mono text-ink-3 opacity-60">sub-threshold + minor</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] font-mono font-bold w-7 shrink-0 text-gray-400">OTH</span>
                          <div className="flex-1 h-2 rounded-full overflow-hidden bg-ink/8">
                            <div style={{ width: `${Math.min(simDraftOthers / 55 * 100, 100)}%`, background: '#9CA3AF', height: '100%', borderRadius: '9999px', transition: 'width 0.15s ease' }} />
                          </div>
                          <input
                            type="text" inputMode="decimal"
                            value={simEditBuf?.key === '__others' ? simEditBuf.raw : simDraftOthers.toFixed(1)}
                            onFocus={e => { setSimEditBuf({ key: '__others', raw: simDraftOthers.toFixed(1) }); e.target.select(); }}
                            onChange={e => setSimEditBuf({ key: '__others', raw: e.target.value })}
                            onBlur={() => {
                              if (simEditBuf?.key === '__others') {
                                const v = Math.max(0, Math.min(100, parseFloat(simEditBuf.raw) || 0));
                                setSimDraftOthers(v);
                                setSimEditBuf(null);
                              }
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            }}
                            className="w-14 text-[12px] font-mono font-bold tabular-nums text-center rounded-md outline-none transition-colors"
                            style={{
                              color: '#9CA3AF',
                              background: 'rgba(156,163,175,0.10)',
                              border: '1.5px solid rgba(156,163,175,0.35)',
                              padding: '3px 4px',
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* ── Total validity strip — always visible ── */}
                    <div className={`mx-3 mb-2 px-3 py-2 rounded-lg border text-[9px] font-mono flex items-center justify-between gap-2 ${
                      overflow
                        ? 'border-red-500/30 bg-red-500/8 text-red-400'
                        : underflow
                          ? 'border-amber-500/30 bg-amber-500/6 text-amber-500'
                          : 'border-emerald-500/30 bg-emerald-500/8 text-emerald-500'
                    }`}>
                      <span className="leading-tight">
                        {overflow
                          ? `⚠ Over 100% — reduce by ${(grandTotal - 100).toFixed(1)}pp`
                          : underflow
                            ? `⚠ ${(100 - grandTotal).toFixed(1)}pp unaccounted — adjust values`
                            : `✓ Adds up to 100% — ready to run`}
                      </span>
                      <span className="font-bold tabular-nums shrink-0">
                        {grandTotal.toFixed(1)}%
                      </span>
                    </div>

                    <div className="px-3.5 pb-3.5 pt-0 border-t border-default shrink-0 space-y-2 pt-2">
                      <button
                        disabled={simRunning || totalInvalid}
                        onClick={() => {
                          stopSim();
                          // Commit draft → natPcts so map updates when sim starts
                          const pcts = { ...simDraftPcts } as Record<RoPartyId, number>;
                          natPctsAtSimStart.current = pcts;
                          setNatPcts(pcts);
                          // Switch to blank map so the map starts gray and counties
                          // light up one batch at a time (election-night feel)
                          setPreset('blank');
                          setProjectedCounties(new Set());

                    // 5 random batches — first fires immediately, rest on bell-curve schedule
                    const shuffled = [...RO_COUNTIES].sort(() => Math.random() - 0.5);
                    const N = 5;
                    const batches: RoCounty[][] = Array.from({ length: N }, () => []);
                    shuffled.forEach((c, i) => batches[i % N].push(c));

                    // Bell-curve times for batches 1-4 (batch 0 = immediate)
                    const laterTimes = roBellCurveTimes(N - 1, 26_000).map(t => t + 3_000);
                    const times = [0, ...laterTimes];

                    setSimRunning(true); setSimProgress(0); setSimCameraSeats(undefined); setDeclaredCounties(new Set());
                    const localDeclared = new Set<RoCountyId>();
                    const timers: ReturnType<typeof setTimeout>[] = [];

                    for (let bi = 0; bi < N; bi++) {
                      const batch = batches[bi]; const t = times[bi];
                      timers.push(setTimeout(() => {
                        for (const c of batch) localDeclared.add(c.id);
                        const snap = new Set(localDeclared);
                        setDeclaredCounties(snap);
                        // Also project each declared county so blank-map colouring kicks in
                        setProjectedCounties(new Set(snap) as Set<RoCountyId>);
                        setSimProgress(snap.size);
                        const partial = calcPartialSeats(natPctsAtSimStart.current, snap);
                        setSimCameraSeats(partial.camera);
                        if (snap.size >= RO_COUNTIES.length) {
                          setSimCameraSeats(calcSeatsTwoStage(natPctsAtSimStart.current));
                          setSimRunning(false);
                        }
                      }, t));
                    }
                    simTimersRef.current = timers;
                  }}
                  className="w-full h-8 rounded-[4px] bg-blue-600 text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {simRunning
                    ? `${simProgress}/${RO_COUNTIES.length} counties reporting…`
                    : '▶ Run Simulation'}
                </button>
                {(simCameraSeats || declaredCounties) && (
                  <button onClick={() => { resetSim(); }} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
                    Reset
                  </button>
                )}
              </div>
                  </>
                );
              })()}
            </aside>
          </div>
        )}

        {/* Coalition — right */}
        {showCoal && !simOpen && (
          <RoCoalitionPanel cameraSeats={cameraSeats}
            onClose={() => { setCoalitionOpen(false); triggerExit('coal'); }}
            exiting={exitPanel==='coal'} dark={dark} />
        )}

        {/* County panel — right */}
        {showCounty && selectedCounty && !simOpen && !showCoal && (
          <RoCountyPanel countyId={selectedCounty} natPcts={natPcts}
            onUpdate={(id, pcts) => setCountyOverrides(prev => ({ ...prev, [id]: pcts }))}
            onClose={() => setSelectedCounty(null)} dark={dark}
            override={countyOverrides[selectedCounty]}
            isBlankMode={preset === 'blank'}
            isProjected={projectedCounties.has(selectedCounty)}
            onProject={() => setProjectedCounties(prev => new Set([...prev, selectedCounty]))}
          />
        )}

        {/* Analysis — right */}
        {showAnalysis && !simOpen && !showCoal && (
          <RoAnalysisPanel
            natPcts={displayPcts} cameraSeats={cameraSeats}
            onClose={() => { setAnalysisOpen(false); triggerExit('analysis'); }}
            exiting={exitPanel==='analysis'} dark={dark} />
        )}

        {/* County Breakdown — right */}
        {showBreakdown && !simOpen && !showCoal && !showAnalysis && (
          <RoCountyBreakdownPanel
            natPcts={displayPcts} countyOverrides={countyOverrides}
            onClose={() => { setBreakdownOpen(false); triggerExit('breakdown'); }}
            exiting={exitPanel==='breakdown'} dark={dark} />
        )}

        {/* Tutorial — right */}
        {showTutorial && !simOpen && !showCoal && !showAnalysis && !showBreakdown && (
          <RoTutorialPanel
            onClose={() => { setTutorialOpen(false); triggerExit('tutorial'); }}
            exiting={exitPanel==='tutorial'} dark={dark} />
        )}
      </div>
    </div>
  );
}
