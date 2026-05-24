import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import type { GeoJsonObject, Feature } from 'geojson';

// ── Parties ───────────────────────────────────────────────────────────────────
const USA_PARTIES = [
  { id: 'DEM', name: 'Democratic', color: '#232066' },
  { id: 'GOP', name: 'Republican', color: '#BF0A30' },
  { id: 'LIB', name: 'Libertarian', color: '#FDB825' },
  { id: 'GRN', name: 'Green',       color: '#17AA5C' },
  { id: 'OTH', name: 'Other',       color: '#888888' },
] as const;
type UsaPartyId = 'DEM' | 'GOP' | 'LIB' | 'GRN' | 'OTH';
const ALL_PIDS: UsaPartyId[] = ['DEM', 'GOP', 'LIB', 'GRN', 'OTH'];
const DEFAULT_PCTS: Record<UsaPartyId, number> = { DEM: 50, GOP: 50, LIB: 0, GRN: 0, OTH: 0 };
const PARTY_MAP = Object.fromEntries(USA_PARTIES.map(p => [p.id, p])) as Record<string, { id: string; name: string; color: string }>;
const DEFAULT_LOCKED: Set<UsaPartyId> = new Set(['LIB', 'GRN', 'OTH']);

// ── Presidential nominees by cycle ───────────────────────────────────────────
type NomineeRecord = Record<UsaPartyId, { name: string; lastName: string; photo: string; initials?: string }>;
const USA_NOMINEES_2024: NomineeRecord = {
  DEM: { name: 'Kamala Harris',     lastName: 'Harris', photo: 'leaders/harris.jpg'  },
  GOP: { name: 'Donald Trump',      lastName: 'Trump',  photo: 'leaders/trump.jpg'   },
  LIB: { name: 'Chase Oliver',      lastName: 'Oliver', photo: 'leaders/oliver.jpg'  },
  GRN: { name: 'Jill Stein',        lastName: 'Stein',  photo: 'leaders/stein.jpg'   },
  OTH: { name: 'Other Candidates',  lastName: 'Others', photo: '', initials: 'OTHER' },
};
const USA_NOMINEES_2026: NomineeRecord = {
  ...USA_NOMINEES_2024,
  GOP: { name: 'JD Vance', lastName: 'Vance', photo: 'leaders/vance.jpg' },
};

// ── Blank map 2024 candidate options (DEM + GOP) ──────────────────────────────
const BLANK_DEM_CANDIDATES: Array<{ name: string; lastName: string; photo: string }> = [
  { name: 'Kamala Harris', lastName: 'Harris', photo: 'leaders/harris.jpg' },
  { name: 'Gavin Newsom',  lastName: 'Newsom',  photo: 'leaders/newsom.jpg' },
];
const BLANK_GOP_CANDIDATES: Array<{ name: string; lastName: string; photo: string }> = [
  { name: 'JD Vance',    lastName: 'Vance', photo: 'leaders/vance.jpg' },
  { name: 'Marco Rubio', lastName: 'Rubio', photo: 'leaders/rubio.jpg' },
];

const MAJORITY_EV = 270;

// ── Electoral votes by state FIPS ─────────────────────────────────────────────
// ME and NE: 2 at-large EVs each; remaining EVs are per congressional district
const EV: Record<string, number> = {
  '01':9,'02':3,'04':11,'05':6,'06':54,'08':10,'09':7,
  '10':3,'11':3,'12':30,'13':16,'15':4,'16':4,'17':19,
  '18':11,'19':6,'20':6,'21':8,'22':8,'23':2,'24':10,
  '25':11,'26':15,'27':10,'28':6,'29':10,'30':4,'31':2,
  '32':6,'33':4,'34':14,'35':5,'36':28,'37':16,'38':3,
  '39':17,'40':7,'41':8,'42':19,'44':4,'45':9,'46':3,
  '47':11,'48':40,'49':6,'50':3,'51':13,'53':12,'54':4,
  '55':10,'56':3,
  // Maine congressional districts (1 EV each)
  '23-01':1, '23-02':1,
  // Nebraska congressional districts (1 EV each)
  '31-01':1, '31-02':1, '31-03':1,
};

// ── States that split EVs by congressional district ───────────────────────────
const SPLIT_STATES: Record<string, Array<{ key: string; label: string; desc: string }>> = {
  '23': [
    { key: '23-01', label: 'CD-1', desc: 'Portland / Coastal' },
    { key: '23-02', label: 'CD-2', desc: 'Northern Maine' },
  ],
  '31': [
    { key: '31-01', label: 'CD-1', desc: 'Lincoln' },
    { key: '31-02', label: 'CD-2', desc: 'Omaha' },
    { key: '31-03', label: 'CD-3', desc: 'Western NE' },
  ],
};

// ── 2024 actual presidential total votes by state ─────────────────────────────
const STATE_VOTES: Record<string, number> = {
  '01':2265090, '02':338177,  '04':3390161, '05':1182676, '06':15865475,
  '08':3192745, '09':1759010, '10':512912,  '11':325869,  '12':10893752,
  '13':5250905, '15':516701,  '16':905057,  '17':5633310, '18':2936677,
  '19':1663506, '20':1327591, '21':2074530, '22':2006975, '23':831375,
  '24':3038334, '25':3473668, '26':5664186, '27':3253920, '28':1228008,
  '29':2995327, '30':602990,  '31':952182,  '32':1484840, '33':826189,
  '34':4272725, '35':923403,  '36':8262495, '37':5699141, '38':368155,
  '39':5767788, '40':1566173, '41':2244493, '42':7058732, '44':513386,
  '45':2548140, '46':428922,  '47':3063942, '48':11388674,'49':1488494,
  '50':369422,  '51':4505941, '53':3924243, '54':762582,  '55':3422918,
  '56':269048,
};

// ── 2024 actual presidential total votes by congressional district (ME / NE) ──
const CD_VOTES: Record<string, number> = {
  '23-01': 433709, // ME-1 (Portland / Coastal)
  '23-02': 397666, // ME-2 (Northern Maine)
  '31-01': 320194, // NE-1 (Lincoln area)
  '31-02': 318646, // NE-2 (Omaha)
  '31-03': 313342, // NE-3 (Western Nebraska)
};

// ── Poll-close timezone zones (0 = earliest East, 5 = latest West) ───────────
const USA_STATE_TZ: Record<string, number> = {
  '13':0,'18':0,'21':0,'45':0,'51':0,'50':0,          // 7:00 PM ET
  '37':1,'39':1,'54':1,                                 // 7:30 PM ET
  '01':2,'09':2,'11':2,'10':2,'12':2,'17':2,'23':2,    // 8:00 PM ET
  '24':2,'25':2,'26':2,'28':2,'29':2,'33':2,'34':2,
  '36':2,'40':2,'42':2,'44':2,'47':2,
  '05':3,'04':3,'08':3,'20':3,'22':3,'27':3,'31':3,    // 9:00 PM ET
  '35':3,'38':3,'46':3,'48':3,'55':3,'56':3,
  '19':4,'16':4,'30':4,'32':4,'41':4,'49':4,           // 10:00 PM ET
  '02':5,'06':5,'15':5,'53':5,                         // 11:00 PM ET
  '23-01':2,'23-02':2,'31-01':3,'31-02':3,'31-03':3,
};
const USA_TZ_WINDOWS: [number, number][] = [
  [0.00,0.18],[0.08,0.30],[0.15,0.50],
  [0.35,0.72],[0.55,0.88],[0.72,1.00],
];
function randNormalUsa(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function pctsFromResults(r?: Record<string, number>): Record<UsaPartyId, number> {
  if (!r) return { ...DEFAULT_PCTS };
  const total = Object.values(r).reduce((s, v) => s + v, 0);
  if (total === 0) return { ...DEFAULT_PCTS };
  const out = { ...DEFAULT_PCTS };
  for (const p of ALL_PIDS) out[p] = ((r[p] ?? 0) / total) * 100;
  return out;
}

// Blank-map seed: LIB/GRN/OTH from 2024 baseline, DEM/GOP split remaining equally
function blankInitPcts(key: string): Record<UsaPartyId, number> {
  const r = RESULTS_2024[key] as Record<string, number> | undefined;
  if (!r) return { ...DEFAULT_PCTS };
  const total = ALL_PIDS.reduce((s, p) => s + (r[p] ?? 0), 0);
  if (total === 0) return { ...DEFAULT_PCTS };
  const libPct = ((r.LIB ?? 0) / total) * 100;
  const grnPct = ((r.GRN ?? 0) / total) * 100;
  const othPct = ((r.OTH ?? 0) / total) * 100;
  const remaining = Math.max(0, 100 - libPct - grnPct - othPct);
  return { DEM: remaining / 2, GOP: remaining / 2, LIB: libPct, GRN: grnPct, OTH: othPct };
}

function toRawResults(pcts: Record<UsaPartyId, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of ALL_PIDS) out[p] = Math.round((pcts[p] ?? 0) * 1000);
  return out;
}

// Proportional redistribution: moving one party's slider scales all others inversely
function applySlide(
  current: Record<UsaPartyId, number>,
  movedPid: UsaPartyId,
  newVal: number,
  locked: Set<UsaPartyId> = new Set(),
): Record<UsaPartyId, number> {
  if (locked.has(movedPid)) return current;
  const lockedSum = ALL_PIDS.filter(p => p !== movedPid && locked.has(p))
    .reduce((s, p) => s + (current[p] ?? 0), 0);
  const available = Math.max(0, 100 - lockedSum);
  const capped = Math.min(Math.min(100, Math.max(0, newVal)), available);
  const unlockedOthers = ALL_PIDS.filter(p => p !== movedPid && !locked.has(p));
  const unlockedSum = unlockedOthers.reduce((s, p) => s + (current[p] ?? 0), 0);
  const remaining = Math.max(0, available - capped);
  const result: Record<UsaPartyId, number> = { ...current, [movedPid]: capped };
  if (unlockedSum < 1e-9) {
    if (unlockedOthers.length > 0) {
      const share = remaining / unlockedOthers.length;
      for (const p of unlockedOthers) result[p] = share;
    }
  } else {
    for (const p of unlockedOthers) result[p] = ((current[p] ?? 0) / unlockedSum) * remaining;
  }
  return result;
}

function fmtVotes(n: number): string {
  return n.toLocaleString();
}

// ── State names by FIPS ───────────────────────────────────────────────────────
const STATE_NAMES: Record<string, string> = {
  '01':'Alabama','02':'Alaska','04':'Arizona','05':'Arkansas','06':'California',
  '08':'Colorado','09':'Connecticut','10':'Delaware','11':'District of Columbia',
  '12':'Florida','13':'Georgia','15':'Hawaii','16':'Idaho','17':'Illinois',
  '18':'Indiana','19':'Iowa','20':'Kansas','21':'Kentucky','22':'Louisiana',
  '23':'Maine','24':'Maryland','25':'Massachusetts','26':'Michigan',
  '27':'Minnesota','28':'Mississippi','29':'Missouri','30':'Montana',
  '31':'Nebraska','32':'Nevada','33':'New Hampshire','34':'New Jersey',
  '35':'New Mexico','36':'New York','37':'North Carolina','38':'North Dakota',
  '39':'Ohio','40':'Oklahoma','41':'Oregon','42':'Pennsylvania',
  '44':'Rhode Island','45':'South Carolina','46':'South Dakota',
  '47':'Tennessee','48':'Texas','49':'Utah','50':'Vermont',
  '51':'Virginia','53':'Washington','54':'West Virginia','55':'Wisconsin','56':'Wyoming',
};

// ── 2024 Official Results — vote share × 10 per state (DEM+GOP+LIB+GRN+OTH ≈ 1000) ──
const RESULTS_2024: Record<string, { DEM:number; GOP:number; LIB:number; GRN:number; OTH:number }> = {
  '01':{ DEM:341, GOP:646, LIB: 2, GRN: 2, OTH: 9 }, // Alabama
  '02':{ DEM:414, GOP:545, LIB: 9, GRN: 7, OTH:25 }, // Alaska
  '04':{ DEM:467, GOP:522, LIB: 5, GRN: 5, OTH: 1 }, // Arizona
  '05':{ DEM:336, GOP:642, LIB: 5, GRN: 4, OTH:13 }, // Arkansas
  '06':{ DEM:585, GOP:383, LIB: 4, GRN:11, OTH:17 }, // California
  '08':{ DEM:541, GOP:431, LIB: 7, GRN: 5, OTH:16 }, // Colorado
  '09':{ DEM:564, GOP:419, LIB: 4, GRN: 8, OTH: 5 }, // Connecticut
  '10':{ DEM:565, GOP:418, LIB: 4, GRN: 2, OTH:11 }, // Delaware
  '11':{ DEM:903, GOP: 65, LIB: 0, GRN: 0, OTH:32 }, // DC
  '12':{ DEM:430, GOP:561, LIB: 3, GRN: 4, OTH: 2 }, // Florida
  '13':{ DEM:485, GOP:507, LIB: 4, GRN: 3, OTH: 1 }, // Georgia
  '15':{ DEM:606, GOP:375, LIB: 5, GRN: 8, OTH: 6 }, // Hawaii
  '16':{ DEM:304, GOP:669, LIB: 5, GRN: 3, OTH:19 }, // Idaho
  '17':{ DEM:544, GOP:435, LIB: 1, GRN: 6, OTH:14 }, // Illinois
  '18':{ DEM:396, GOP:586, LIB: 7, GRN: 0, OTH:11 }, // Indiana
  '19':{ DEM:425, GOP:557, LIB: 4, GRN: 0, OTH:14 }, // Iowa
  '20':{ DEM:410, GOP:572, LIB: 6, GRN: 0, OTH:12 }, // Kansas
  '21':{ DEM:339, GOP:645, LIB: 3, GRN: 4, OTH: 9 }, // Kentucky
  '22':{ DEM:382, GOP:602, LIB: 3, GRN: 4, OTH: 9 }, // Louisiana
  '23':{ DEM:524, GOP:455, LIB: 6, GRN:11, OTH: 4 }, // Maine (statewide)
  '24':{ DEM:626, GOP:341, LIB: 5, GRN:11, OTH:17 }, // Maryland
  '25':{ DEM:612, GOP:360, LIB: 5, GRN: 8, OTH:15 }, // Massachusetts
  '26':{ DEM:483, GOP:497, LIB: 4, GRN: 8, OTH: 8 }, // Michigan
  '27':{ DEM:509, GOP:467, LIB: 5, GRN: 5, OTH:14 }, // Minnesota
  '28':{ DEM:380, GOP:609, LIB: 2, GRN: 2, OTH: 7 }, // Mississippi
  '29':{ DEM:401, GOP:585, LIB: 8, GRN: 6, OTH: 0 }, // Missouri
  '30':{ DEM:385, GOP:584, LIB: 7, GRN: 5, OTH:19 }, // Montana
  '31':{ DEM:389, GOP:593, LIB: 7, GRN: 3, OTH: 8 }, // Nebraska (statewide)
  '32':{ DEM:475, GOP:506, LIB: 4, GRN: 0, OTH:15 }, // Nevada
  '33':{ DEM:507, GOP:479, LIB: 5, GRN: 4, OTH: 5 }, // New Hampshire
  '34':{ DEM:520, GOP:461, LIB: 2, GRN: 9, OTH: 8 }, // New Jersey
  '35':{ DEM:519, GOP:459, LIB: 4, GRN: 5, OTH:13 }, // New Mexico
  '36':{ DEM:559, GOP:433, LIB: 1, GRN: 6, OTH: 1 }, // New York
  '37':{ DEM:477, GOP:509, LIB: 4, GRN: 4, OTH: 6 }, // North Carolina
  '38':{ DEM:305, GOP:670, LIB:17, GRN: 0, OTH: 8 }, // North Dakota
  '39':{ DEM:439, GOP:551, LIB: 5, GRN: 0, OTH: 5 }, // Ohio
  '40':{ DEM:319, GOP:662, LIB: 6, GRN: 0, OTH:13 }, // Oklahoma
  '41':{ DEM:553, GOP:410, LIB: 4, GRN: 9, OTH:24 }, // Oregon
  '42':{ DEM:485, GOP:502, LIB: 5, GRN: 5, OTH: 3 }, // Pennsylvania
  '44':{ DEM:555, GOP:418, LIB: 3, GRN: 6, OTH:18 }, // Rhode Island
  '45':{ DEM:404, GOP:582, LIB: 5, GRN: 3, OTH: 6 }, // South Carolina
  '46':{ DEM:342, GOP:634, LIB: 6, GRN: 0, OTH:18 }, // South Dakota
  '47':{ DEM:345, GOP:642, LIB: 0, GRN: 3, OTH:10 }, // Tennessee
  '48':{ DEM:425, GOP:561, LIB: 6, GRN: 7, OTH: 1 }, // Texas
  '49':{ DEM:378, GOP:594, LIB:11, GRN: 6, OTH:11 }, // Utah
  '50':{ DEM:638, GOP:323, LIB: 5, GRN: 2, OTH:32 }, // Vermont
  '51':{ DEM:518, GOP:461, LIB: 4, GRN: 8, OTH: 9 }, // Virginia
  '53':{ DEM:572, GOP:390, LIB: 4, GRN: 8, OTH:26 }, // Washington
  '54':{ DEM:281, GOP:700, LIB: 4, GRN: 3, OTH:12 }, // West Virginia
  '55':{ DEM:487, GOP:496, LIB: 3, GRN: 4, OTH:10 }, // Wisconsin
  '56':{ DEM:258, GOP:716, LIB:16, GRN: 0, OTH:10 }, // Wyoming
  // Maine congressional districts
  '23-01':{ DEM:597, GOP:381, LIB: 6, GRN:11, OTH: 5 }, // ME-1 Portland/Coastal
  '23-02':{ DEM:445, GOP:535, LIB: 6, GRN:10, OTH: 4 }, // ME-2 Northern Maine
  // Nebraska congressional districts
  '31-01':{ DEM:425, GOP:555, LIB: 8, GRN: 3, OTH: 9 }, // NE-1 Lincoln
  '31-02':{ DEM:513, GOP:467, LIB: 6, GRN: 3, OTH:11 }, // NE-2 Omaha
  '31-03':{ DEM:224, GOP:760, LIB: 6, GRN: 2, OTH: 8 }, // NE-3 Western NE
};

// ── 2026 demographic-adjusted polling ─────────────────────────────────────────
// Per-state DEM pp swing from 2024 baseline.
// Hispanic/Black/White demographic shifts drive magnitude:
//   Big elastic states (NY, CA, FL, TX, GA) +5.5–8.5
//   Blue-wall battlegrounds (PA, MI, WI, VA, NJ) +3.0–5.0
//   Deep-red states with locked electorates +0.5–2.5
const DEM_SWING_2026: Record<string, number> = {
  // Big shifts left (+5.5–8.5)
  '36':8.5, // New York — snaps back from compressed 2024 margins
  '06':7.5, // California — metro turnout recovery
  '12':7.0, // Florida — suburban + volatile Latino coalitions
  '48':6.5, // Texas — urban/suburban expansion
  '13':6.5, // Georgia — suburban-dependent battleground
  '04':6.0, // Arizona — Independent/moderate swing voters
  '37':5.5, // North Carolina — high-education research hubs
  '32':5.5, // Nevada — working-class service union bounce-back
  // Some shift left (+3.0–5.0)
  '42':5.0, // Pennsylvania
  '26':4.5, // Michigan
  '55':4.5, // Wisconsin
  '51':4.5, // Virginia
  '34':4.5, // New Jersey
  '24':4.0, // Maryland
  '08':4.0, // Colorado
  '27':4.0, // Minnesota
  '15':4.0, // Hawaii
  '10':4.0, // Delaware
  '44':4.0, // Rhode Island
  '33':3.5, // New Hampshire
  '35':3.5, // New Mexico
  '17':3.5, // Illinois
  '09':3.5, // Connecticut
  '25':3.5, // Massachusetts
  '53':3.0, // Washington
  '41':3.0, // Oregon
  '11':3.0, // DC
  '50':3.0, // Vermont
  // Barely any shift (+0.5–2.5)
  '39':2.5, // Ohio
  '19':2.5, // Iowa
  '23':2.5, // Maine (statewide)
  '49':2.0, // Utah
  '20':2.0, // Kansas
  '18':2.0, // Indiana
  '45':2.0, // South Carolina
  '02':1.5, // Alaska
  '29':1.5, // Missouri
  '30':1.5, // Montana
  '31':1.5, // Nebraska (statewide)
  '21':1.0, // Kentucky
  '47':1.0, // Tennessee
  '01':0.5, // Alabama
  '28':0.5, // Mississippi
  '22':0.5, // Louisiana
  '05':0.5, // Arkansas
  '40':0.5, // Oklahoma
  '16':0.5, // Idaho
  '38':0.5, // North Dakota
  '46':0.5, // South Dakota
  '54':0.5, // West Virginia
  '56':0.5, // Wyoming
  // Maine & Nebraska CDs
  '23-01':3.0, '23-02':2.0,
  '31-01':2.5, '31-02':4.0, '31-03':0.5,
};

function buildResults2026(): typeof RESULTS_2024 {
  // Scale factors to hit national LIB ≈ 0.7% and GRN ≈ 0.7%
  let totalW = 0, nationalLib = 0, nationalGrn = 0;
  for (const [fips, r] of Object.entries(RESULTS_2024)) {
    const w = STATE_VOTES[fips];
    if (!w) continue;
    const tot = r.DEM + r.GOP + r.LIB + r.GRN + r.OTH;
    nationalLib += (r.LIB / tot) * w;
    nationalGrn += (r.GRN / tot) * w;
    totalW += w;
  }
  const libScale = totalW > 0 && nationalLib > 0 ? (0.007 * totalW) / nationalLib : 1;
  const grnScale = totalW > 0 && nationalGrn > 0 ? (0.007 * totalW) / nationalGrn : 1;

  const out = {} as typeof RESULTS_2024;
  for (const [fips, r] of Object.entries(RESULTS_2024) as [string, { DEM:number; GOP:number; LIB:number; GRN:number; OTH:number }][]) {
    const tot = r.DEM + r.GOP + r.LIB + r.GRN + r.OTH;
    const dem = (r.DEM / tot) * 100;
    const gop = (r.GOP / tot) * 100;
    const lib = (r.LIB / tot) * 100;
    const grn = (r.GRN / tot) * 100;
    const oth = (r.OTH / tot) * 100;

    // Swing is a MARGIN shift: DEM gains swing/2, GOP loses swing/2
    // e.g. FL +7.0 → DEM +3.5pp, GOP -3.5pp → margin goes from -13 to -6 (stays red)
    const swing = DEM_SWING_2026[fips] ?? 3.5;
    const half = swing / 2;
    const newDem = Math.min(dem + half, 99.5);
    const newLib = Math.max(0, lib * libScale);
    const newGrn = Math.max(0, grn * grnScale);
    const newOth = oth;
    const newGop = Math.max(0, gop - half);

    const sum = newDem + newGop + newLib + newGrn + newOth;
    const sc = 1000 / sum;
    out[fips as keyof typeof RESULTS_2024] = {
      DEM: Math.round(newDem * sc), GOP: Math.round(newGop * sc),
      LIB: Math.round(newLib * sc), GRN: Math.round(newGrn * sc), OTH: Math.round(newOth * sc),
    };
  }
  return out;
}
const RESULTS_2026 = buildResults2026();

// ── UNS result generator for Election Night simulation ────────────────────────
function generateUsaResultUNS(
  fips: string,
  targetPcts: Record<UsaPartyId, number>,
  nationalBaselines: Record<UsaPartyId, number>,
): Record<string, number> {
  const stateVotes = (fips.includes('-') ? CD_VOTES[fips] : STATE_VOTES[fips]) ?? 0;
  const base = RESULTS_2024[fips];
  if (!base || stateVotes === 0) return {};
  const tot = ALL_PIDS.reduce((s, p) => s + (base[p] ?? 0), 0);
  if (tot === 0) return {};
  const raw: Partial<Record<UsaPartyId, number>> = {};
  for (const p of ALL_PIDS) {
    const baseVotes = ((base[p] ?? 0) / tot) * stateVotes;
    const swing = (targetPcts[p] ?? 0) / 100 - (nationalBaselines[p] ?? 0);
    raw[p] = Math.max(0, baseVotes + swing * stateVotes);
  }
  const total = ALL_PIDS.reduce((s, p) => s + (raw[p] ?? 0), 0);
  if (total <= 0) return Object.fromEntries(ALL_PIDS.map(p => [p, Math.round(((base[p] ?? 0) / tot) * stateVotes)]));
  const scale = stateVotes / total;
  const sorted = ALL_PIDS.filter(p => (raw[p] ?? 0) > 0).sort((a, b) => (raw[b] ?? 0) - (raw[a] ?? 0));
  const out: Record<string, number> = {};
  let dist = 0;
  for (let i = 0; i < sorted.length - 1; i++) { out[sorted[i]] = Math.round((raw[sorted[i]] ?? 0) * scale); dist += out[sorted[i]]; }
  if (sorted.length > 0) out[sorted[sorted.length - 1]] = Math.max(0, stateVotes - dist);
  return out;
}

// ── Coloring ──────────────────────────────────────────────────────────────────
const BLANK_LIGHT = '#E5E7EB';
const BLANK_DARK  = '#374151';

function stateFill(results: Record<string, number>, dark: boolean): string {
  const blankColor = dark ? BLANK_DARK : BLANK_LIGHT;
  const total = Object.values(results).reduce((s, v) => s + v, 0);
  if (total === 0) return blankColor;
  const sorted = Object.entries(results)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return blankColor;
  const [winnerId, winnerVotes] = sorted[0];
  const runnerUpVotes = sorted[1]?.[1] ?? 0;
  const margin = ((winnerVotes - runnerUpVotes) / total) * 100;
  const baseColor = PARTY_MAP[winnerId]?.color ?? '#888888';
  const t = Math.min(Math.max(margin / 30, 0), 1);
  const lightness = dark
    ? 55 - t * (55 - 28)   // dark mode: mid-tone → deep
    : 82 - t * (82 - 38);  // light mode: pale → deep
  const c = hsl(baseColor);
  c.l = lightness / 100;
  return c.formatHex() as string;
}

// ── Globe logo ────────────────────────────────────────────────────────────────
function GlobeLogo({ size = 34 }: { size?: number }) {
  const lats: [number, number, number, string][] = [
    [7.6,  11.2, 2.8, '#12B6CF'],
    [13.2, 13.7, 3.4, '#02A95B'],
    [16.0, 14.0, 3.6, '#E4003B'],
    [18.8, 13.7, 3.4, '#FAA61A'],
    [24.4, 11.2, 2.8, '#0087DC'],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0" aria-hidden="true">
      <defs>
        <clipPath id="usa-logo-clip"><circle cx="16" cy="16" r="14" /></clipPath>
        <radialGradient id="usa-logo-shine" cx="32%" cy="24%" r="52%">
          <stop offset="0%"   stopColor="white" stopOpacity="0.80" />
          <stop offset="45%"  stopColor="white" stopOpacity="0.12" />
          <stop offset="100%" stopColor="white" stopOpacity="0"    />
        </radialGradient>
        <radialGradient id="usa-logo-depth" cx="70%" cy="72%" r="55%">
          <stop offset="0%"   stopColor="rgba(20,60,120,0.18)" />
          <stop offset="100%" stopColor="rgba(20,60,120,0)"    />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="rgba(180,215,255,0.09)" clipPath="url(#usa-logo-clip)" />
      <g clipPath="url(#usa-logo-clip)" fill="none" strokeLinecap="round">
        {lats.map(([y, rx, ry, color]) => (
          <path key={`bk-${y}`} d={`M${16-rx} ${y} A${rx} ${ry} 0 0 0 ${16+rx} ${y}`}
            stroke={color} strokeWidth="1.05" strokeOpacity="0.42" strokeDasharray="2 2" />
        ))}
      </g>
      <g clipPath="url(#usa-logo-clip)" fill="none" strokeLinecap="round"
         stroke="rgba(80,140,210,0.22)" strokeWidth="0.6" strokeDasharray="2 2">
        <ellipse cx="16" cy="16" rx="8" ry="14" />
        <ellipse cx="16" cy="16" rx="4" ry="14" />
      </g>
      <g clipPath="url(#usa-logo-clip)" fill="none" strokeLinecap="round">
        {lats.map(([y, rx, ry, color]) => (
          <path key={`ft-${y}`} d={`M${16-rx} ${y} A${rx} ${ry} 0 0 1 ${16+rx} ${y}`}
            stroke={color} strokeWidth="1.30" strokeOpacity="0.90" />
        ))}
      </g>
      <g clipPath="url(#usa-logo-clip)" fill="none" stroke="rgba(80,140,210,0.32)" strokeLinecap="round">
        <line x1="16" y1="2" x2="16" y2="30" strokeWidth="0.70" />
        <ellipse cx="16" cy="16" rx="8" ry="14" strokeWidth="0.65" />
        <ellipse cx="16" cy="16" rx="4" ry="14" strokeWidth="0.55" />
      </g>
      <circle cx="16" cy="16" r="14" fill="url(#usa-logo-depth)" />
      <circle cx="16" cy="16" r="14" fill="url(#usa-logo-shine)" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(140,195,255,0.55)" strokeWidth="1.1" />
      <circle cx="16" cy="16" r="13.4" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.5" />
    </svg>
  );
}

// ── Geometry helpers ──────────────────────────────────────────────────────────
// Geographic centers for all states (bounding-box midpoint is wrong for irregular shapes)
const CENTROID_OVERRIDES: Record<string, [number, number]> = {
  '01': [32.806671,  -86.791130], // Alabama
  '02': [64.200841, -152.404419], // Alaska (interior — Aleutians cross antimeridian)
  '04': [34.048927, -111.093731], // Arizona
  '05': [34.969704,  -92.373123], // Arkansas
  '06': [36.778261, -119.417932], // California
  '08': [39.113014, -105.358887], // Colorado
  '09': [41.597782,  -72.755371], // Connecticut
  '10': [38.910832,  -75.527670], // Delaware
  '11': [38.897438,  -77.026817], // DC
  '12': [27.994402,  -81.760254], // Florida
  '13': [32.678140,  -83.223184], // Georgia
  '15': [20.798363, -156.331925], // Hawaii
  '16': [44.068203, -114.742043], // Idaho
  '17': [40.349457,  -88.986137], // Illinois
  '18': [39.849426,  -86.258278], // Indiana
  '19': [42.011539,  -93.210526], // Iowa
  '20': [38.526600,  -96.726486], // Kansas
  '21': [37.839333,  -84.270020], // Kentucky
  '22': [30.984298,  -91.962333], // Louisiana
  '23': [45.253783,  -69.445469], // Maine
  '24': [39.045755,  -76.641271], // Maryland
  '25': [42.407211,  -71.382437], // Massachusetts
  '26': [44.314844,  -85.602364], // Michigan
  '27': [46.729553,  -94.685900], // Minnesota
  '28': [32.354668,  -89.398528], // Mississippi
  '29': [37.964253,  -91.831833], // Missouri
  '30': [46.879682, -110.362566], // Montana
  '31': [41.492537,  -99.901810], // Nebraska
  '32': [38.802610, -116.419389], // Nevada
  '33': [43.193852,  -71.572395], // New Hampshire
  '34': [40.058324,  -74.405661], // New Jersey
  '35': [34.307144, -106.018066], // New Mexico
  '36': [42.886447,  -76.083746], // New York (upstate center)
  '37': [35.759573,  -79.019300], // North Carolina
  '38': [47.551493, -101.002012], // North Dakota
  '39': [40.417287,  -82.907123], // Ohio
  '40': [35.007752,  -97.092877], // Oklahoma
  '41': [43.804133, -120.554201], // Oregon
  '42': [41.203322,  -77.194527], // Pennsylvania
  '44': [41.580095,  -71.477429], // Rhode Island
  '45': [33.836081,  -81.163725], // South Carolina
  '46': [43.969515,  -99.901810], // South Dakota
  '47': [35.517491,  -86.580447], // Tennessee
  '48': [31.968599,  -99.901810], // Texas
  '49': [39.320980, -111.093731], // Utah
  '50': [44.558803,  -72.577841], // Vermont
  '51': [37.431573,  -78.656894], // Virginia
  '53': [47.751074, -120.740139], // Washington
  '54': [38.597626,  -80.454903], // West Virginia
  '55': [43.784440,  -88.787868], // Wisconsin
  '56': [43.075968, -107.290284], // Wyoming
};

function computeCentroid(geometry: any): [number, number] {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const visit = (c: any) => {
    if (typeof c[0] === 'number') {
      if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
      if (c[0] < minLng) minLng = c[0]; if (c[0] > maxLng) maxLng = c[0];
    } else { for (const ch of c) visit(ch); }
  };
  visit(geometry.coordinates);
  if (!isFinite(minLat)) return [0, 0];
  return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
}

function enforceNoSmooth(geoLayer: L.GeoJSON) {
  geoLayer.eachLayer((layer: L.Layer) => {
    const p = layer as any;
    if (p.options) p.options.smoothFactor = 0;
  });
}

function UsaMapController({ layerRef }: { layerRef: { current: L.GeoJSON | null } }) {
  const map = useMap();
  useEffect(() => {
    const onZoomEnd = () => {
      if (!layerRef.current) return;
      enforceNoSmooth(layerRef.current);
    };
    map.on('zoomend', onZoomEnd);
    return () => { map.off('zoomend', onZoomEnd); };
  }, [map, layerRef]);
  return null;
}

// ── Auto-fit map (one-shot — never re-fires on zoom/pan/re-render) ────────────
function MapFitter({ geojson }: { geojson: GeoJsonObject }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !geojson) return;
    map.fitBounds([[24.5, -125.0], [49.5, -66.5]], { padding: [10, 10] });
    fitted.current = true;
  }, [map, geojson]);
  return null;
}

// ── Bubble map layer (imperative — matches Australia pattern) ─────────────────
interface UsaBubbleLayerProps {
  geojson: GeoJsonObject;
  currentResults: Record<string, Record<string, number>>;
  dark: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  blankSliderMemoryRef: React.MutableRefObject<Record<string, Record<UsaPartyId, number>>>;
  blankReportingMemoryRef: React.MutableRefObject<Record<string, string>>;
  currentResultsRef: React.MutableRefObject<Record<string, Record<string, number>>>;
  stateReportingRef: React.MutableRefObject<Record<string, number>>;
  multiSelectModeRef: React.MutableRefObject<boolean>;
  activePresetRef: React.MutableRefObject<string | null>;
  setTooltip: (t: any) => void;
  setSelectedFips: (fn: (prev: string | null) => string | null) => void;
  setSelectedFipsSet: (fn: (prev: Set<string>) => Set<string>) => void;
}

function UsaBubbleLayer({
  geojson, currentResults, dark,
  containerRef, blankSliderMemoryRef, blankReportingMemoryRef,
  currentResultsRef, stateReportingRef, multiSelectModeRef, activePresetRef,
  setTooltip, setSelectedFips, setSelectedFipsSet,
}: UsaBubbleLayerProps) {
  const map = useMap();
  const markersRef = useRef<L.CircleMarker[]>([]);

  useEffect(() => {
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    for (const feature of (geojson as any).features ?? []) {
      const fips: string = feature.properties?.STATE ?? '';
      const name: string = feature.properties?.NAME ?? '';
      if (!fips) continue;
      const results = currentResults[fips] ?? {};
      const sorted = Object.values(results).filter((v): v is number => v > 0).sort((a, b) => b - a);
      const total = sorted.reduce((s, v) => s + v, 0);
      if (sorted.length === 0 || total === 0) continue;
      const marginShare = sorted.length >= 2 ? sorted[0] - sorted[1] : sorted[0];
      const marginPct = (marginShare / total) * 100;
      const radius = 3 + Math.min(marginPct / 30, 1) * 10;
      const color = stateFill(results, dark);
      const center: [number, number] = CENTROID_OVERRIDES[fips] ?? computeCentroid(feature.geometry);

      const marker = L.circleMarker(center, {
        radius,
        color: 'rgba(255,255,255,0.7)',
        fillColor: color,
        fillOpacity: 0.85,
        weight: 0.8,
        opacity: 0.9,
      }).addTo(map);

      marker.on('click', () => {
        if (multiSelectModeRef.current) {
          setSelectedFipsSet(prev => { const n = new Set(prev); n.has(fips) ? n.delete(fips) : n.add(fips); return n; });
          return;
        }
        setSelectedFips(prev => prev === fips ? null : fips);
      });

      marker.on('mousemove', (e: L.LeafletMouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const isBlank = activePresetRef.current === 'blank';
        const blankRptPct = isBlank ? (parseFloat(blankReportingMemoryRef.current[fips] ?? '') || 0) : 0;
        const blankPcts = isBlank ? blankSliderMemoryRef.current[fips] : undefined;
        setTooltip({
          x: e.originalEvent.clientX - rect.left,
          y: e.originalEvent.clientY - rect.top,
          name,
          fips,
          results: blankPcts
            ? Object.fromEntries(Object.entries(blankPcts).map(([k, v]) => [k, Math.round(v * 1000)]))
            : currentResultsRef.current[fips] ?? {},
          stateVotes: isBlank
            ? (blankRptPct > 0 ? Math.round((STATE_VOTES[fips] ?? 0) * blankRptPct / 100) : 0)
            : (STATE_VOTES[fips] ?? 0),
          reportingPct: isBlank
            ? (blankRptPct > 0 ? blankRptPct : undefined)
            : stateReportingRef.current[fips],
        });
      });

      marker.on('mouseout', () => setTooltip(null));

      markersRef.current.push(marker);
    }

    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
    };
  }, [map, geojson, currentResults, dark]);

  return null;
}

// ── Nominee photo circle ──────────────────────────────────────────────────────
function UsaNomineePhoto({ partyId, isWinner, size = 52, nominees = USA_NOMINEES_2024 }: {
  partyId:   UsaPartyId;
  isWinner:  boolean;
  size?:     number;
  nominees?: NomineeRecord;
}) {
  const color = PARTY_MAP[partyId]?.color ?? '#888';
  const nominee = nominees[partyId];
  const [imgOk, setImgOk] = useState(!!nominee?.photo);
  useEffect(() => { setImgOk(!!nominee?.photo); }, [nominee?.photo]);
  const initials = nominee?.initials ?? nominee?.lastName.slice(0, 2).toUpperCase() ?? partyId.slice(0, 2);

  return (
    <div className="relative">
      <div
        className="rounded-full overflow-hidden shrink-0 flex items-center justify-center"
        style={{
          width: size, height: size,
          background: isWinner ? color : `${color}18`,
          border: `2.5px solid ${color}`,
          transition: 'background 0.3s',
        }}
      >
        {imgOk && nominee?.photo ? (
          <img
            src={`${import.meta.env.BASE_URL}${nominee.photo}`}
            alt={nominee.lastName}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }}
            onError={() => setImgOk(false)}
          />
        ) : (
          <span
            className="font-display font-black tracking-tight leading-none text-center"
            style={{ color: isWinner ? '#fff' : color, fontSize: initials.length > 2 ? 9 : 15 }}
          >{initials}</span>
        )}
      </div>
      {isWinner && (
        <span className="absolute -bottom-0.5 -right-0.5">
          <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="8.5" fill={color}/>
            <path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      )}
    </div>
  );
}

// ── Candidate picker (blank map) ──────────────────────────────────────────────
function CandidateOption({ c, i, color, selected, onChange, onClose }: {
  c: { name: string; lastName: string; photo: string };
  i: number; color: string; selected: boolean;
  onChange: (i: number) => void; onClose: () => void;
}) {
  const [ok, setOk] = useState(true);
  return (
    <button
      onClick={() => { onChange(i); onClose(); }}
      className={`flex items-center gap-2 w-full px-2.5 py-2 text-left transition-colors ${selected ? 'bg-[#f8f7f4]' : 'hover:bg-hover'}`}
    >
      <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
        style={{ border: `1.5px solid ${color}`, background: `${color}18` }}>
        {ok ? (
          <img src={`${import.meta.env.BASE_URL}${c.photo}`} alt={c.lastName}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }}
            onError={() => setOk(false)} />
        ) : (
          <span style={{ color, fontSize: 8, fontWeight: 800 }}>{c.lastName.slice(0, 2).toUpperCase()}</span>
        )}
      </div>
      <span className="text-[10px] font-mono text-ink leading-none">{c.name}</span>
      {selected && (
        <svg className="ml-auto shrink-0" width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1.5 4L3.2 5.8L6.5 2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}

function CandidatePicker({ partyId, candidates, selectedIdx, onChange }: {
  partyId: UsaPartyId;
  candidates: Array<{ name: string; lastName: string; photo: string }>;
  selectedIdx: number;
  onChange: (idx: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const color = PARTY_MAP[partyId]?.color ?? '#888';
  const current = candidates[selectedIdx];

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + 4, left: r.left + r.width / 2 });
    }
    setOpen(o => !o);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="flex items-center gap-0.5 mt-1.5 leading-none hover:opacity-70 transition-opacity cursor-pointer"
        title="Change candidate"
      >
        <span className="text-[11px] font-mono text-ink-3 leading-none">{current.lastName}</span>
        <svg width="6" height="4" viewBox="0 0 6 4" fill="none" className="shrink-0 mt-px">
          <path d="M0.5 0.5L3 3L5.5 0.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" className="text-ink-3"/>
        </svg>
      </button>

      {open && dropPos && (
        <>
          <div className="fixed inset-0 z-[1999]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[2000] bg-white border border-default rounded-lg shadow-xl py-1 min-w-[170px]"
            style={{ top: dropPos.top, left: dropPos.left, transform: 'translateX(-50%)' }}
          >
            {candidates.map((c, i) => (
              <CandidateOption key={i} c={c} i={i} color={color} selected={i === selectedIdx} onChange={onChange} onClose={() => setOpen(false)} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ── Party cards scoreboard ────────────────────────────────────────────────────
function UsaScoreboard({ tally, votePcts, rawVotes, activePreset, nominees: nomineesOverride, blankDemIdx, blankGopIdx, onChangeBlankCandidate, hiddenParties }: {
  tally:        Record<string, number>;
  votePcts:     Record<string, number>;
  rawVotes:     Record<string, number>;
  activePreset: string | null;
  nominees?:    NomineeRecord;
  blankDemIdx?: number;
  blankGopIdx?: number;
  onChangeBlankCandidate?: (partyId: UsaPartyId, idx: number) => void;
  hiddenParties?: Set<UsaPartyId>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  const sortedParties = useMemo(() => {
    return [...USA_PARTIES].sort((a, b) => {
      if (a.id === 'OTH') return 1;
      if (b.id === 'OTH') return -1;
      const evDiff = (tally[b.id] ?? 0) - (tally[a.id] ?? 0);
      if (evDiff !== 0) return evDiff;
      return (votePcts[b.id] ?? 0) - (votePcts[a.id] ?? 0);
    });
  }, [tally, votePcts]);

  const visibleParties = hiddenParties && hiddenParties.size > 0
    ? sortedParties.filter(p => !hiddenParties.has(p.id as UsaPartyId))
    : sortedParties;

  return (
    <div className="shrink-0 border-b border-default bg-canvas">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 items-stretch pt-2 pb-2 mx-auto w-fit">
          {visibleParties.map(p => {
            const evCount  = tally[p.id] ?? 0;
            const pct      = votePcts[p.id];
            const votes    = rawVotes[p.id];
            const isWinner = evCount >= MAJORITY_EV;
            const nominees = nomineesOverride ?? (activePreset === '2026' ? USA_NOMINEES_2026 : USA_NOMINEES_2024);
            const nominee  = nominees[p.id as UsaPartyId];

            return (
              <div
                key={p.id}
                className="relative flex flex-col items-center rounded-[6px] px-2 pt-2.5 pb-2 min-w-[90px] border bg-white"
                style={{
                  borderColor: isWinner ? p.color : `${p.color}22`,
                  boxShadow: isWinner
                    ? `0 0 0 1.5px ${p.color}, 0 3px 12px rgba(0,0,0,0.09)`
                    : undefined,
                  overflow: isWinner ? 'hidden' : undefined,
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
              >
                {/* Shimmer sweep for winner */}
                {isWinner && (
                  <div
                    className="absolute inset-0 pointer-events-none z-[2]"
                    style={{
                      background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.26) 50%, transparent 70%)',
                      animation: 'shimmerSweep 2.2s ease-in-out infinite',
                    }}
                  />
                )}

                {/* Nominee photo */}
                <UsaNomineePhoto partyId={p.id as UsaPartyId} isWinner={isWinner} size={52} nominees={nominees} />

                {/* Candidate last name — clickable picker in blank mode for DEM/GOP */}
                {activePreset === 'blank' && (p.id === 'DEM' || p.id === 'GOP') && onChangeBlankCandidate ? (
                  <CandidatePicker
                    partyId={p.id as UsaPartyId}
                    candidates={p.id === 'DEM' ? BLANK_DEM_CANDIDATES : BLANK_GOP_CANDIDATES}
                    selectedIdx={p.id === 'DEM' ? (blankDemIdx ?? 0) : (blankGopIdx ?? 0)}
                    onChange={idx => onChangeBlankCandidate(p.id as UsaPartyId, idx)}
                  />
                ) : (
                  <span className="text-[11px] font-sans text-ink-3 mt-1.5 leading-none truncate max-w-full">
                    {nominee?.lastName ?? ''}
                  </span>
                )}

                {/* Party name (replaces "STATES" label) */}
                <span className="text-[10px] font-sans font-bold uppercase tracking-[0.12em] leading-none mt-1 text-ink-3">
                  {p.name}
                </span>

                {/* Electoral vote count */}
                <span
                  className="text-[32px] font-display font-black leading-none tabular-nums mt-1"
                  style={{ color: p.color }}
                >
                  {evCount}
                </span>

                {/* Vote percentage */}
                <span className="text-[11px] font-sans text-ink-3 leading-none mt-0.5">
                  {pct !== undefined ? `${pct.toFixed(1)}%` : '—'}
                </span>

                {/* Raw popular vote */}
                <span className="text-[9.5px] font-sans text-ink-3 leading-none mt-0.5 opacity-60">
                  <span className="cand-votes-full">{votes !== undefined ? Math.round(votes).toLocaleString() : '—'}</span>
                  <span className="cand-votes-compact">{votes !== undefined ? fmtVotes(Math.round(votes)) : '—'}</span>
                </span>

                {/* Progress bar — popular vote % */}
                <div className="w-full mt-1.5 h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--bar-track)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct ?? 0}%`, background: p.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Congressional district slider (fully controlled — state lives in StatePanel) ──
function CdSlider({ cdKey, label, desc, pcts, onSlide, locked, onToggleLock }: {
  cdKey: string;
  label: string;
  desc: string;
  pcts: Record<UsaPartyId, number>;
  onSlide: (cdKey: string, pid: UsaPartyId, val: number) => void;
  locked: Set<UsaPartyId>;
  onToggleLock: (pid: UsaPartyId) => void;
}) {
  const totalVotes = CD_VOTES[cdKey] ?? 0;
  const winner = ALL_PIDS.reduce<UsaPartyId | null>(
    (best, p) => (pcts[p] ?? 0) > (pcts[best ?? p] ?? 0) ? p : best, null
  );

  return (
    <div className="pt-3 first:pt-0 border-t border-default first:border-t-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[9px] font-mono font-bold text-ink shrink-0">{label}</span>
          <span className="text-[8px] font-mono text-ink-3 truncate">{desc}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-1">
          <span className="text-[8px] font-mono text-ink-3">1 EV</span>
          {winner && (
            <span className="text-[7px] font-mono font-bold uppercase tracking-wide px-1.5 py-0.5 rounded text-white"
              style={{ background: PARTY_MAP[winner]?.color }}>{winner}</span>
          )}
        </div>
      </div>
      <div className="space-y-3.5">
        {USA_PARTIES.map(p => {
          const pid = p.id as UsaPartyId;
          const pct = pcts[pid] ?? 0;
          const votes = totalVotes ? Math.round(pct / 100 * totalVotes) : null;
          const isLocked = locked.has(pid);
          return (
            <div key={p.id}>
              <div className="flex items-center gap-1 mb-1">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="text-[9.5px] font-medium text-ink flex-1 leading-none truncate">{p.name}</span>
                <button
                  onClick={() => onToggleLock(pid)}
                  title={isLocked ? 'Unlock' : 'Lock'}
                  className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked ? 'text-[#c8a020]' : 'text-ink-3 hover:text-ink'}`}
                >
                  {isLocked ? (
                    <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                  ) : (
                    <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                  )}
                </button>
                <span
                  className="text-[9.5px] font-mono font-semibold tabular-nums"
                  style={{ color: p.color, minWidth: 36, textAlign: 'right' }}
                >{pct.toFixed(1)}%</span>
              </div>
              <input type="range" min={0} max={100} step={0.1} value={pct}
                disabled={isLocked}
                onChange={e => onSlide(cdKey, pid, parseFloat(e.target.value))}
                className="ca-party-slider w-full"
                style={{ '--party-color': p.color, '--pct': `${pct}%` } as React.CSSProperties}
              />
              <div className="text-right text-[8px] font-mono text-ink-3 opacity-60 -mt-0.5">
                {votes !== null ? votes.toLocaleString() : ''}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 h-1.5 rounded-full overflow-hidden flex">
        {USA_PARTIES.map(p => (
          <div key={p.id} style={{ width: `${pcts[p.id as UsaPartyId] ?? 0}%`, background: p.color, transition: 'width 0.2s' }} />
        ))}
      </div>
    </div>
  );
}

// ── State detail panel ────────────────────────────────────────────────────────
interface StatePanelProps {
  fips: string;
  name: string;
  results?: Record<string, number>;
  onClose: () => void;
  onResultsChange: (fips: string, results: Record<string, number>) => void;
  onReportingCommit?: (fips: string, pct: number) => void;
  activePreset: string | null;
  splitCds?: Array<{ key: string; label: string; desc: string }>;
  cdResultsMap?: Record<string, Record<string, number>>;
  blankSliderMemory?: React.MutableRefObject<Record<string, Record<UsaPartyId, number>>>;
  blankReportingMemory?: React.MutableRefObject<Record<string, string>>;
}

function StatePanel({ fips, name, results, onClose, onResultsChange, onReportingCommit, activePreset, splitCds, cdResultsMap, blankSliderMemory, blankReportingMemory }: StatePanelProps) {
  const ev = EV[fips] ?? 0;
  const cdEvTotal = splitCds?.reduce((s, cd) => s + (EV[cd.key] ?? 0), 0) ?? 0;

  // All slider state lives here so statewide ↔ CD sync can happen in one place
  const initPcts = (key: string, r?: Record<string, number>) => {
    if (activePreset === 'blank') {
      const saved = blankSliderMemory?.current[key];
      if (saved) return saved;
      if (!r) return blankInitPcts(key);
    }
    return pctsFromResults(r);
  };

  const initCdDerivedState = (cdMap: Record<string, Record<UsaPartyId, number>>) => {
    const agg = { ...DEFAULT_PCTS };
    let totalW = 0;
    for (const cd of splitCds ?? []) {
      const w = CD_VOTES[cd.key] ?? 1; totalW += w;
      for (const p of ALL_PIDS) agg[p] += (cdMap[cd.key]?.[p] ?? 0) * w;
    }
    if (totalW > 0) for (const p of ALL_PIDS) agg[p] /= totalW;
    return agg;
  };

  const [cdPcts, setCdPcts] = useState<Record<string, Record<UsaPartyId, number>>>(() => {
    if (!splitCds) return {};
    return Object.fromEntries(splitCds.map(cd => [cd.key, initPcts(cd.key, cdResultsMap?.[cd.key])]));
  });
  const [statePcts, setStatePcts] = useState<Record<UsaPartyId, number>>(() => {
    // ME/NE blank mode: statewide is always derived from CDs, never set independently
    if (splitCds && splitCds.length > 0 && activePreset === 'blank') {
      const initCds = Object.fromEntries(splitCds.map(cd => [cd.key, initPcts(cd.key, cdResultsMap?.[cd.key])]));
      return initCdDerivedState(initCds);
    }
    return initPcts(fips, results);
  });
  const [locked, setLocked] = useState<Set<UsaPartyId>>(() => new Set(DEFAULT_LOCKED));
  const [projected, setProjected] = useState(false);
  const [reporting, setReporting] = useState(() =>
    activePreset === 'blank' ? (blankReportingMemory?.current[fips] ?? '') : ''
  );

  // Reset when the user selects a different state or loads a preset
  useEffect(() => {
    const r2 = (key: string, r?: Record<string, number>) => {
      if (activePreset === 'blank') {
        const saved = blankSliderMemory?.current[key];
        if (saved) return saved;
        if (!r) return blankInitPcts(key);
      }
      return pctsFromResults(r);
    };
    if (splitCds && splitCds.length > 0 && activePreset === 'blank') {
      // ME/NE blank: statewide derived from CDs
      const newCds = Object.fromEntries(splitCds.map(cd => [cd.key, r2(cd.key, cdResultsMap?.[cd.key])]));
      setCdPcts(newCds);
      setStatePcts(initCdDerivedState(newCds));
    } else {
      setStatePcts(r2(fips, results));
      if (splitCds) setCdPcts(Object.fromEntries(splitCds.map(cd => [cd.key, r2(cd.key, cdResultsMap?.[cd.key])])));
    }
    setLocked(new Set(DEFAULT_LOCKED));
    setProjected(false);
    setReporting(activePreset === 'blank' ? (blankReportingMemory?.current[fips] ?? '') : '');
  // Only reset on explicit navigation / preset change, not on every slider move
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fips, activePreset]);

  // Use refs so callbacks always see fresh values without needing them as deps
  const statePctsRef = useRef(statePcts);
  statePctsRef.current = statePcts;
  const cdPctsRef = useRef(cdPcts);
  cdPctsRef.current = cdPcts;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const toggleLock = useCallback((pid: UsaPartyId) => {
    setLocked(prev => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  }, []);

  // Statewide slider → proportional redistribution, then apply same per-party deltas to CDs
  const handleStateSlide = useCallback((pid: UsaPartyId, val: number) => {
    const prevState = statePctsRef.current;
    const newState  = applySlide(prevState, pid, val, lockedRef.current);
    setStatePcts(newState);
    if (activePreset === 'blank') {
      if (blankSliderMemory) blankSliderMemory.current[fips] = newState;
      if (splitCds && splitCds.length > 0) {
        const deltas = ALL_PIDS.reduce((acc, p) => { acc[p] = (newState[p] ?? 0) - (prevState[p] ?? 0); return acc; }, {} as Record<UsaPartyId, number>);
        const newCdPcts = { ...cdPctsRef.current };
        for (const cd of splitCds) {
          const cur = newCdPcts[cd.key] ?? { ...DEFAULT_PCTS };
          const shifted = { ...DEFAULT_PCTS };
          for (const p of ALL_PIDS) shifted[p] = Math.max(0, (cur[p] ?? 0) + deltas[p]);
          const total = ALL_PIDS.reduce((s, p) => s + shifted[p], 0);
          if (total > 0) for (const p of ALL_PIDS) shifted[p] = (shifted[p] / total) * 100;
          newCdPcts[cd.key] = shifted;
          if (blankSliderMemory) blankSliderMemory.current[cd.key] = shifted;
        }
        setCdPcts(newCdPcts);
      }
      setProjected(false);
      return;
    }

    if (splitCds && splitCds.length > 0) {
      const deltas = ALL_PIDS.reduce((acc, p) => {
        acc[p] = (newState[p] ?? 0) - (prevState[p] ?? 0);
        return acc;
      }, {} as Record<UsaPartyId, number>);
      const newCdPcts = { ...cdPctsRef.current };
      for (const cd of splitCds) {
        const cur = newCdPcts[cd.key] ?? { ...DEFAULT_PCTS };
        const shifted = { ...DEFAULT_PCTS };
        for (const p of ALL_PIDS) shifted[p] = Math.max(0, (cur[p] ?? 0) + deltas[p]);
        const total = ALL_PIDS.reduce((s, p) => s + shifted[p], 0);
        if (total > 0) for (const p of ALL_PIDS) shifted[p] = (shifted[p] / total) * 100;
        newCdPcts[cd.key] = shifted;
        onResultsChange(cd.key, toRawResults(shifted));
      }
      setCdPcts(newCdPcts);
    }
    onResultsChange(fips, toRawResults(newState));
  }, [fips, splitCds, onResultsChange, activePreset, blankSliderMemory]);

  // CD slider → proportional redistribution within that CD, then recompute statewide weighted avg
  const handleCdSlide = useCallback((cdKey: string, pid: UsaPartyId, val: number) => {
    const newEntry  = applySlide(cdPctsRef.current[cdKey] ?? { ...DEFAULT_PCTS }, pid, val, lockedRef.current);
    const newCdPcts = { ...cdPctsRef.current, [cdKey]: newEntry };
    setCdPcts(newCdPcts);

    if (splitCds) {
      const newState = { ...DEFAULT_PCTS };
      let totalW = 0;
      for (const cd of splitCds) {
        const w = CD_VOTES[cd.key] ?? 1;
        totalW += w;
        for (const p of ALL_PIDS) newState[p] += (newCdPcts[cd.key]?.[p] ?? 0) * w;
      }
      if (totalW > 0) for (const p of ALL_PIDS) newState[p] /= totalW;
      setStatePcts(newState);
      if (activePreset !== 'blank') onResultsChange(fips, toRawResults(newState));
      else if (blankSliderMemory) { blankSliderMemory.current[cdKey] = newEntry; blankSliderMemory.current[fips] = newState; }
    }

    if (activePreset === 'blank') { setProjected(false); return; }
    onResultsChange(cdKey, toRawResults(newEntry));
  }, [fips, splitCds, onResultsChange, activePreset, blankSliderMemory]);

  const handleCommit = useCallback(() => {
    onResultsChange(fips, toRawResults(statePctsRef.current));
    if (splitCds) {
      for (const cd of splitCds) {
        onResultsChange(cd.key, toRawResults(cdPctsRef.current[cd.key] ?? { ...DEFAULT_PCTS }));
      }
    }
    onReportingCommit?.(fips, parseFloat(reporting) || 0);
    setProjected(true);
  }, [fips, splitCds, onResultsChange, onReportingCommit, reporting]);

  // Auto-reset "Result Updated" badge so the button can be pressed again
  useEffect(() => {
    if (!projected) return;
    const t = setTimeout(() => setProjected(false), 1500);
    return () => clearTimeout(t);
  }, [projected]);

  const winner = ALL_PIDS.reduce<UsaPartyId | null>(
    (best, p) => (statePcts[p] ?? 0) > (statePcts[best ?? p] ?? 0) ? p : best, null
  );
  const winnerColor = winner ? PARTY_MAP[winner]?.color : undefined;
  const [editPid, setEditPid] = useState<UsaPartyId | null>(null);
  const [editVal, setEditVal] = useState('');

  return (
    <div className="w-[260px] shrink-0 border-l border-default bg-surface flex flex-col overflow-y-auto z-10">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-default">
        <span className="text-[10.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">State</span>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded text-ink-3 hover:text-ink hover:bg-hover transition-colors">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="px-3.5 py-3 border-b border-default">
        <div className="font-display text-[17px] font-black uppercase tracking-tight text-ink leading-tight">{name}</div>
        <div className="mt-1.5 flex items-center gap-2">
          {splitCds ? (
            <span className="text-[11px] font-mono text-ink-3 uppercase tracking-wide">
              {ev} at-large + {splitCds.length} CDs = {ev + cdEvTotal} total EVs
            </span>
          ) : (
            <span className="text-[11px] font-mono text-ink-3 uppercase tracking-wide">
              {ev} Electoral Vote{ev !== 1 ? 's' : ''}
            </span>
          )}
          {winner && winnerColor && (
            <span className="text-[9px] font-mono font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full text-white" style={{ background: winnerColor }}>
              {PARTY_MAP[winner]?.name ?? winner}
            </span>
          )}
        </div>
      </div>

      {/* Commit button — blank map only */}
      {activePreset === 'blank' && (
        <div className="px-3.5 py-2 border-b border-default">
          <button
            onClick={handleCommit}
            className="relative overflow-hidden w-full h-9 rounded-[5px] text-white text-[11px] font-mono font-bold uppercase tracking-wide transition-colors"
            style={{ background: projected ? '#16a34a' : '#c8a020' }}
          >
            {!projected && (
              <span className="absolute inset-0 pointer-events-none" style={{ width: '45%', background: 'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)', animation: 'shimmerSweep 2.2s ease-in-out infinite' }} />
            )}
            <span className="relative z-10 flex items-center justify-center gap-1.5">
              {projected ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="6" fill="rgba(255,255,255,0.25)"/>
                    <path d="M3 6l2.2 2.2L9 4" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Result Updated
                </>
              ) : 'Update Result'}
            </span>
          </button>
        </div>
      )}

      {/* % Reporting slider — blank map only */}
      {activePreset === 'blank' && (
        <div className="px-3.5 py-3 border-b border-default">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">% Reporting</div>
            <span className="text-[12px] font-mono font-semibold tabular-nums text-ink">
              {Math.round(parseFloat(reporting) || 0)}%
            </span>
          </div>
          <input
            type="range" min={0} max={100} step={1}
            value={parseFloat(reporting) || 0}
            onChange={e => { setReporting(e.target.value); setProjected(false); if (blankReportingMemory) blankReportingMemory.current[fips] = e.target.value; }}
            className="ca-party-slider w-full"
            style={{ '--party-color': '#c8a020', '--pct': `${parseFloat(reporting) || 0}%` } as React.CSSProperties}
          />
        </div>
      )}

      {/* Statewide vote share sliders — hidden for ME/NE blank mode (derived from CDs) */}
      {!(splitCds && splitCds.length > 0 && activePreset === 'blank') && (
      <div className="px-3.5 py-3 border-b border-default">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">
            {splitCds ? `Vote Share — Statewide (${ev} EV${ev !== 1 ? 's' : ''})` : 'Vote Share'}
          </div>
        </div>

        {(true) ? (
          <div className="space-y-3.5">
            {USA_PARTIES.map(p => {
              const pid = p.id as UsaPartyId;
              const pct = statePcts[pid] ?? 0;
              const isEditing = editPid === pid;
              const isLocked = locked.has(pid);
              const totalVotes = STATE_VOTES[fips] ?? 0;
              const reportingPct = activePreset === 'blank' ? (parseFloat(reporting) || 0) : 100;
              const rawVotes = Math.round((pct / 100) * totalVotes * (reportingPct / 100));
              return (
                <div key={p.id}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className="text-[11px] font-medium text-ink flex-1 leading-none truncate">{p.name}</span>
                    <button
                      onClick={() => toggleLock(pid)}
                      title={isLocked ? 'Unlock' : 'Lock'}
                      className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked ? 'text-[#c8a020]' : 'text-ink-3 hover:text-ink'}`}
                    >
                      {isLocked ? (
                        <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                      ) : (
                        <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                      )}
                    </button>
                    {isEditing ? (
                      <input
                        autoFocus
                        type="number" min={0} max={100} step={0.1}
                        value={editVal}
                        onChange={e => setEditVal(e.target.value)}
                        onBlur={() => { const n = parseFloat(editVal); if (!isNaN(n)) handleStateSlide(pid, n); setEditPid(null); }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { const n = parseFloat(editVal); if (!isNaN(n)) handleStateSlide(pid, n); setEditPid(null); }
                          if (e.key === 'Escape') setEditPid(null);
                        }}
                        className="w-14 h-5 text-[11px] font-mono font-semibold tabular-nums text-right px-1 rounded border border-default focus:outline-none bg-white"
                        style={{ color: p.color, borderColor: p.color }}
                      />
                    ) : (
                      <span
                        onClick={() => { if (!isLocked) { setEditPid(pid); setEditVal(pct.toFixed(1)); } }}
                        className="text-[11px] font-mono font-semibold tabular-nums"
                        style={{ color: p.color, minWidth: 40, textAlign: 'right', cursor: isLocked ? 'default' : 'text' }}
                        title={isLocked ? undefined : 'Click to edit'}
                      >{pct.toFixed(1)}%</span>
                    )}
                  </div>
                  {totalVotes > 0 && (
                    <div className="text-[9.5px] font-mono text-ink-3 tabular-nums text-right mb-1">
                      {rawVotes.toLocaleString()}
                    </div>
                  )}
                  <input
                    type="range" min={0} max={100} step={0.1}
                    value={pct}
                    disabled={isLocked}
                    onChange={e => handleStateSlide(pid, parseFloat(e.target.value))}
                    className="ca-party-slider w-full"
                    style={{ '--party-color': p.color, '--pct': `${pct}%` } as React.CSSProperties}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-4 text-center">
            <div className="text-[10px] font-mono text-ink-3 italic">Slide % Reporting above to unlock</div>
          </div>
        )}
      </div>
      )} {/* end !(splitCds && blank) guard */}

      {/* ME/NE blank mode: statewide derived from CDs — show aggregate read-out */}
      {splitCds && splitCds.length > 0 && activePreset === 'blank' && (
        <div className="px-3.5 py-3 border-b border-default">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-2">
            Statewide ({ev} at-large EV{ev !== 1 ? 's' : ''})
          </div>
          <div className="rounded-[5px] border border-default bg-[#f8f7f4] px-2.5 py-2 text-[9px] font-mono text-ink-3 leading-relaxed">
            Statewide vote share is automatically calculated from the congressional district results below. Set each CD to determine the {ev} at-large electoral vote{ev !== 1 ? 's' : ''}.
          </div>
          {(parseFloat(reporting) || 0) > 0 && (
            <div className="mt-2 space-y-1">
              {ALL_PIDS.filter(p => (statePcts[p] ?? 0) > 0.05).sort((a, b) => (statePcts[b] ?? 0) - (statePcts[a] ?? 0)).map(pid => {
                const pct = statePcts[pid] ?? 0;
                const party = PARTY_MAP[pid];
                return (
                  <div key={pid} className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: party?.color }} />
                    <span className="text-[9.5px] font-mono text-ink-3 flex-1">{party?.name}</span>
                    <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: party?.color }}>{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Congressional districts (Maine / Nebraska only) */}
      {splitCds && splitCds.length > 0 && (
        <div className="px-3.5 py-3 border-b border-default">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-3">Congressional Districts</div>
          <div className="space-y-4">
            {splitCds.map(cd => (
              <CdSlider
                key={cd.key}
                cdKey={cd.key}
                label={cd.label}
                desc={cd.desc}
                pcts={cdPcts[cd.key] ?? { DEM: 50, GOP: 50 }}
                onSlide={handleCdSlide}
                locked={locked}
                onToggleLock={toggleLock}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
interface TooltipState {
  x: number; y: number;
  name: string; fips: string;
  results: Record<string, number>;
  stateVotes: number;
  reportingPct?: number;
}

function MapTooltip({ tooltip, containerW, containerH, dark = true }: { tooltip: TooltipState; containerW: number; containerH: number; dark?: boolean }) {
  const ev = (EV[tooltip.fips] ?? 0) +
    (SPLIT_STATES[tooltip.fips]?.reduce((s, cd) => s + (EV[cd.key] ?? 0), 0) ?? 0);
  const total = Object.values(tooltip.results).reduce((s, v) => s + v, 0);
  const sorted = Object.entries(tooltip.results)
    .filter(([, v]) => v > 0)
    .sort(([pidA, a], [pidB, b]) => {
      if (pidA === 'OTH') return 1;
      if (pidB === 'OTH') return -1;
      return b - a;
    });

  const w = 210, h = sorted.length > 0 ? 90 + sorted.length * 4 : 65;
  let left = tooltip.x + 14;
  let top  = tooltip.y - h / 2;
  if (left + w > containerW - 8) left = tooltip.x - w - 14;
  if (top < 8) top = 8;
  if (top + h > containerH - 8) top = containerH - h - 8;

  const tt = {
    bg:     dark ? 'rgba(18,24,44,0.96)'        : 'rgba(255,255,255,0.97)',
    border: dark ? 'rgba(255,255,255,0.09)'     : 'rgba(0,0,0,0.08)',
    shadow: dark ? '0 6px 28px rgba(0,0,0,0.5)': '0 6px 28px rgba(0,0,0,0.12)',
    title:  dark ? 'rgba(255,255,255,0.92)'     : 'rgba(0,0,0,0.85)',
    sub:    dark ? 'rgba(255,255,255,0.40)'     : 'rgba(0,0,0,0.42)',
    body:   dark ? 'rgba(255,255,255,0.58)'     : 'rgba(0,0,0,0.65)',
    dim:    dark ? 'rgba(255,255,255,0.28)'     : 'rgba(0,0,0,0.35)',
    pct:    dark ? 'rgba(255,255,255,0.88)'     : 'rgba(0,0,0,0.80)',
    divider:dark ? 'rgba(255,255,255,0.06)'     : 'rgba(0,0,0,0.07)',
    nodataColor: dark ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.32)',
  };

  return (
    <div
      className="absolute pointer-events-none z-[500]"
      style={{ left, top, minWidth: w }}
    >
      <div style={{
        background: tt.bg,
        borderRadius: 10,
        border: `1px solid ${tt.border}`,
        boxShadow: tt.shadow,
        backdropFilter: 'blur(10px)',
        padding: '12px 14px',
      }}>
        <div style={{ fontSize: 14, fontFamily: '"Barlow Condensed",sans-serif', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.01em', color: tt.title, lineHeight: 1.1 }}>
          {tooltip.name}
        </div>
        <div style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', color: tt.sub, marginTop: 3 }}>
          {ev} electoral vote{ev !== 1 ? 's' : ''}{tooltip.reportingPct !== undefined ? <> · <span style={{ color: '#c8a020', fontWeight: 700 }}>{tooltip.reportingPct}% reporting</span></> : ''}
        </div>
        {sorted.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {sorted.map(([pid, share]) => {
              const pct = total > 0 ? (share / total * 100) : 0;
              const rawVotes = tooltip.stateVotes > 0 ? Math.round(pct / 100 * tooltip.stateVotes) : null;
              const party = PARTY_MAP[pid];
              return (
                <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: party?.color ?? '#888' }} />
                  <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', color: tt.body, flex: 1 }}>{party?.name ?? pid}</span>
                  {rawVotes !== null && (
                    <span style={{ fontSize: 9.5, fontFamily: '"JetBrains Mono",monospace', color: tt.dim, marginRight: 4 }}>{rawVotes.toLocaleString()}</span>
                  )}
                  <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: tt.pct }}>{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        )}
        {sorted.length > 0 && tooltip.stateVotes > 0 && (
          <div style={{ marginTop: 8, paddingTop: 7, borderTop: `1px solid ${tt.divider}`, fontSize: 9, fontFamily: '"JetBrains Mono",monospace', color: tt.dim }}>
            {tooltip.stateVotes.toLocaleString()} votes cast
          </div>
        )}
        {sorted.length === 0 && (
          <div style={{ marginTop: 6, fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: tt.nodataColor, fontStyle: 'italic' }}>No data</div>
        )}
      </div>
    </div>
  );
}

// ── Swing panel ───────────────────────────────────────────────────────────────
function UsaSwingPanel({
  onClose, onApply, activePreset,
}: {
  onClose: () => void;
  onApply: (swings: Record<UsaPartyId, number>) => void;
  activePreset: string | null;
}) {
  const [inputs, setInputs] = useState<Record<UsaPartyId, string>>({ DEM: '', GOP: '', LIB: '', GRN: '', OTH: '' });

  const handleApply = () => {
    const swings = { DEM: 0, GOP: 0, LIB: 0, GRN: 0, OTH: 0 } as Record<UsaPartyId, number>;
    for (const pid of ALL_PIDS) { const v = parseFloat(inputs[pid] ?? ''); if (!isNaN(v)) swings[pid] = v; }
    onApply(swings);
    setInputs({ DEM: '', GOP: '', LIB: '', GRN: '', OTH: '' });
  };

  const baseLabel = activePreset === '2026' ? '2026 Polling' : '2024 Baseline';

  return (
    <div className="w-[230px] shrink-0 border-l border-default bg-surface flex flex-col z-10">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-default">
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">National Swing</div>
          <div className="text-[8px] font-mono text-ink-3 mt-0.5">from {baseLabel}</div>
        </div>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded text-ink-3 hover:text-ink text-base leading-none">×</button>
      </div>
      <div className="px-3.5 py-3 flex-1 space-y-2.5">
        <div className="text-[8px] font-mono text-ink-3 pb-1">±pp applied uniformly to every state</div>
        {USA_PARTIES.map(p => {
          const pid = p.id as UsaPartyId;
          return (
            <div key={pid} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
              <span className="text-[9px] font-mono text-ink flex-1 truncate">{p.name}</span>
              <input
                type="number" step={0.1} placeholder="±pp"
                value={inputs[pid]}
                onChange={e => setInputs(prev => ({ ...prev, [pid]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleApply()}
                className="w-14 h-6 text-[9.5px] font-mono text-right px-1.5 rounded border border-default focus:outline-none focus:border-ink-3 bg-white text-ink tabular-nums"
              />
              <span className="text-[8px] font-mono text-ink-3 w-3">pp</span>
            </div>
          );
        })}
      </div>
      <div className="px-3.5 py-3 border-t border-default">
        <button onClick={handleApply}
          className="w-full h-8 rounded-[4px] text-[11px] font-mono font-bold uppercase tracking-wide bg-ink text-canvas hover:opacity-90 transition-opacity">
          Apply Swing
        </button>
      </div>
    </div>
  );
}

// ── Multi-select panel ────────────────────────────────────────────────────────
function UsaMultiSelectPanel({
  selectedFipsSet, currentResults, onResultsChange, onClear,
}: {
  selectedFipsSet: Set<string>;
  currentResults: Record<string, Record<string, number>>;
  onResultsChange: (fips: string, results: Record<string, number>) => void;
  onClear: () => void;
}) {
  const selected = useMemo(() => [...selectedFipsSet], [selectedFipsSet]);

  const totalEv = useMemo(() => selected.reduce((s, fips) => {
    return s + (EV[fips] ?? 0) + (SPLIT_STATES[fips]?.reduce((ss, cd) => ss + (EV[cd.key] ?? 0), 0) ?? 0);
  }, 0), [selected]);

  const aggregate = useMemo<Record<UsaPartyId, number>>(() => {
    const raw: Record<UsaPartyId, number> = { DEM: 0, GOP: 0, LIB: 0, GRN: 0, OTH: 0 };
    let totalW = 0;
    for (const fips of selected) {
      const w = STATE_VOTES[fips] ?? 1;
      totalW += w;
      const pcts = pctsFromResults(currentResults[fips]);
      for (const pid of ALL_PIDS) raw[pid] += pcts[pid] * w;
    }
    if (totalW > 0) for (const pid of ALL_PIDS) raw[pid] /= totalW;
    return raw;
  }, [selected, currentResults]);

  const [locked, setLocked] = useState<Set<UsaPartyId>>(() => new Set(DEFAULT_LOCKED));
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const toggleLock = useCallback((pid: UsaPartyId) => {
    setLocked(prev => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  }, []);

  const handleSlide = useCallback((pid: UsaPartyId, newVal: number) => {
    for (const fips of selected) {
      const pcts = pctsFromResults(currentResults[fips]);
      onResultsChange(fips, toRawResults(applySlide(pcts, pid, newVal, lockedRef.current)));
    }
  }, [selected, currentResults, onResultsChange]);

  const winner = ALL_PIDS.reduce<UsaPartyId | null>(
    (best, p) => (aggregate[p] ?? 0) > (aggregate[best ?? p] ?? 0) ? p : best, null
  );

  return (
    <div className="w-[260px] shrink-0 border-l border-default bg-surface flex flex-col overflow-y-auto z-10">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-default">
        <div>
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">Multi-Select</div>
          <div className="text-[8px] font-mono text-ink-3 mt-0.5">{selected.length} state{selected.length !== 1 ? 's' : ''} · {totalEv} EV{totalEv !== 1 ? 's' : ''}</div>
        </div>
        <button onClick={onClear} className="text-[8px] font-mono text-ink-3 hover:text-ink border border-default rounded px-1.5 py-0.5 transition-colors">Clear</button>
      </div>
      {winner && (
        <div className="px-3.5 py-2 border-b border-default">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-hover">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: PARTY_MAP[winner]?.color }} />
            <span className="text-[10px] font-mono text-ink flex-1">{PARTY_MAP[winner]?.name}</span>
            <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: PARTY_MAP[winner]?.color }}>
              {aggregate[winner].toFixed(1)}%
            </span>
          </div>
        </div>
      )}
      <div className="px-3.5 py-3 space-y-3.5">
        {USA_PARTIES.map(p => {
          const pid = p.id as UsaPartyId;
          const pct = aggregate[pid] ?? 0;
          const isLocked = locked.has(pid);
          return (
            <div key={pid}>
              <div className="flex items-center gap-1 mb-1">
                <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="text-[9.5px] font-medium text-ink flex-1 leading-none">{p.name}</span>
                <button onClick={() => toggleLock(pid)}
                  className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked ? 'text-[#c8a020]' : 'text-ink-3 hover:text-ink'}`}>
                  {isLocked
                    ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                    : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                  }
                </button>
                <span className="text-[9.5px] font-mono font-semibold tabular-nums" style={{ color: p.color, minWidth: 36, textAlign: 'right' }}>
                  {pct.toFixed(1)}%
                </span>
              </div>
              <input type="range" min={0} max={100} step={0.1} value={pct}
                disabled={isLocked}
                onChange={e => handleSlide(pid, parseFloat(e.target.value))}
                className="ca-party-slider w-full"
                style={{ '--party-color': p.color, '--pct': `${pct}%` } as React.CSSProperties}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Election Night simulation panel ──────────────────────────────────────────
function UsaSimulationPanel({
  exiting = false,
  onApplyResults,
  onUpdateState,
  onUpdateReporting,
  onClose,
  simRunning,
  simProgress,
  timersRef,
  setSimRunning,
  setSimProgress,
  stopSim,
}: {
  exiting?: boolean;
  onApplyResults: (r: Record<string, Record<string, number>>) => void;
  onUpdateState: (fips: string, r: Record<string, number>) => void;
  onUpdateReporting: (fips: string, pct: number) => void;
  onClose: () => void;
  simRunning: boolean;
  simProgress: number;
  timersRef: React.MutableRefObject<ReturnType<typeof setTimeout>[]>;
  setSimRunning: (v: boolean) => void;
  setSimProgress: React.Dispatch<React.SetStateAction<number>>;
  stopSim: () => void;
}) {
  const [inputs, setInputs] = useState<Record<UsaPartyId, string>>(
    () => Object.fromEntries(ALL_PIDS.map(p => [p, ''])) as Record<UsaPartyId, string>
  );
  const [duration, setDuration] = useState<60 | 120 | 300 | 600>(60);

  const parseNum = (s: string) => { const n = parseFloat(s); return isNaN(n) ? 0 : Math.max(0, n); };
  const partySum = ALL_PIDS.reduce((s, p) => s + parseNum(inputs[p] ?? ''), 0);
  const isValid  = partySum <= 100.05;

  // 2024 national baselines weighted by state turnout
  const nationalBaselines = useMemo((): Record<UsaPartyId, number> => {
    let totalVotes = 0;
    const totals: Record<UsaPartyId, number> = { DEM:0, GOP:0, LIB:0, GRN:0, OTH:0 };
    for (const [fips, votes] of Object.entries(STATE_VOTES)) {
      const r = RESULTS_2024[fips]; if (!r) continue;
      const tot = ALL_PIDS.reduce((s, p) => s + (r[p] ?? 0), 0);
      for (const p of ALL_PIDS) totals[p] += ((r[p] ?? 0) / tot) * votes;
      totalVotes += votes;
    }
    const bl: Record<UsaPartyId, number> = { DEM:0, GOP:0, LIB:0, GRN:0, OTH:0 };
    if (totalVotes > 0) for (const p of ALL_PIDS) bl[p] = totals[p] / totalVotes;
    return bl;
  }, []);

  const allFips = useMemo(() => [...Object.keys(STATE_VOTES), ...Object.keys(CD_VOTES)], []);
  const totalUnits = allFips.length;

  const handleRun = useCallback(() => {
    if (simRunning) { stopSim(); return; }
    const targetPcts: Record<UsaPartyId, number> = { DEM:0, GOP:0, LIB:0, GRN:0, OTH:0 };
    for (const p of ALL_PIDS) targetPcts[p] = parseNum(inputs[p] ?? '');

    const allResults: Record<string, Record<string, number>> = {};
    for (const fips of allFips) allResults[fips] = generateUsaResultUNS(fips, targetPcts, nationalBaselines);

    onApplyResults({});
    const totalMs = duration * 1000;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let declared = 0;

    const byTz: string[][] = [[],[],[],[],[],[]];
    for (const fips of allFips) byTz[Math.min(USA_STATE_TZ[fips] ?? 2, 5)].push(fips);

    for (let tz = 0; tz < 6; tz++) {
      const [wf, ef] = USA_TZ_WINDOWS[tz];
      const wStart = wf * totalMs, wEnd = ef * totalMs;
      const mean = (wStart + wEnd) / 2, std = (wEnd - wStart) / 6;
      for (const fips of byTz[tz]) {
        const final = allResults[fips];
        if (!final || Object.keys(final).length === 0) continue;
        const t0 = Math.max(wStart + 500, Math.min(wEnd - 2000, Math.round(mean + std * randNormalUsa())));
        const cuts: number[] = [];
        let cutFrac = 0.08 + Math.random() * 0.14;
        cuts.push(cutFrac);
        for (let bi = 1; bi < 4; bi++) {
          cutFrac = Math.min(cutFrac + 0.08 + Math.random() * 0.18, 0.95);
          cuts.push(cutFrac);
        }
        const gaps = Array.from({ length: 4 }, () => Math.round(1200 + Math.random() * 6000));
        const partial = (frac: number) => Object.fromEntries(Object.entries(final).filter(([,v]) => v > 0).map(([k,v]) => [k, Math.round(v * frac)]));
        let delay = t0;
        for (let bi = 0; bi < 4; bi++) {
          const cut = cuts[bi]; const d = delay;
          timers.push(setTimeout(() => { onUpdateReporting(fips, Math.round(cut * 100)); onUpdateState(fips, partial(cut)); }, d));
          delay += gaps[bi];
        }
        timers.push(setTimeout(() => { onUpdateReporting(fips, 100); onUpdateState(fips, final); declared++; setSimProgress(declared); }, delay));
      }
    }
    timers.push(setTimeout(() => setSimRunning(false), totalMs + 5000));
    timersRef.current = timers;
    setSimRunning(true);
    setSimProgress(0);
  }, [simRunning, stopSim, allFips, inputs, nationalBaselines, duration, onApplyResults, onUpdateState, onUpdateReporting]);

  return (
    <aside className={`w-72 shrink-0 bg-card border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[15px] font-bold text-ink leading-tight">Election Night</h1>
          <p className="text-[9.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">US Presidential Simulation</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base leading-none shrink-0 mt-0.5">×</button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        <section className="px-3.5 pt-3 pb-1">
          <div className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-2">National vote share</div>
          <div className="mb-3 rounded-[5px] border border-amber-200 bg-amber-50 px-2.5 py-2 text-[9px] font-mono text-amber-800 leading-relaxed">
            <span className="font-bold">Realistic inputs only.</span> This simulator uses real 2024 state-level data to project results via swing modelling. Absurd vote shares (e.g. Libertarian 99%) will produce meaningless projections — garbage in, garbage out.
          </div>
          {USA_PARTIES.map(p => (
            <div key={p.id} className="flex items-center gap-2 mb-2">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
              <span className="flex-1 text-[10.5px] font-medium text-ink leading-none truncate">{p.name}</span>
              <input type="number" min="0" max="100" step="0.1"
                value={inputs[p.id as UsaPartyId]} disabled={simRunning}
                onChange={e => setInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                placeholder="0"
                className="w-14 h-7 text-[11px] font-mono text-right px-2 rounded-[4px] border border-default bg-white focus:outline-none focus:border-ink-3 disabled:opacity-50 tabular-nums"
              />
              <span className="text-[10px] font-mono text-ink-3 w-3">%</span>
            </div>
          ))}
        </section>

        <div className="mx-3.5 mt-1 mb-3 rounded-[6px] border border-default bg-[#f8f7f4] px-3 py-2.5 font-mono space-y-0.5">
          <div className="text-[8.5px] font-bold uppercase tracking-[0.12em] text-ink-3 mb-1.5">Allocation</div>
          {USA_PARTIES.map(p => {
            const val = parseNum(inputs[p.id as UsaPartyId] ?? '');
            return val > 0 ? (
              <div key={p.id} className="flex justify-between text-[10px] text-ink-3">
                <span>{p.name}</span><span className="font-semibold text-ink">{val.toFixed(1)}%</span>
              </div>
            ) : null;
          })}
          <div className={`flex justify-between border-t pt-1 text-[10px] font-bold ${isValid ? 'text-emerald-600 border-emerald-200' : 'text-red-500 border-red-200'}`}>
            <span>Total</span><span>{partySum.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      <div className="px-3.5 py-3 border-t border-default space-y-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[9.5px] font-mono text-ink-3 uppercase tracking-wide shrink-0">Duration</span>
          {([60, 120, 300, 600] as const).map(d => (
            <button key={d} onClick={() => !simRunning && setDuration(d)} disabled={simRunning}
              className={`flex-1 h-7 text-[10px] font-mono font-medium rounded-[4px] border transition-colors disabled:opacity-40 ${
                duration === d ? 'bg-ink/8 border-ink/20 text-ink' : 'border-default text-ink-3 hover:bg-hover hover:text-ink'
              }`}>
              {d === 60 ? '1m' : d === 120 ? '2m' : d === 300 ? '5m' : '10m'}
            </button>
          ))}
        </div>

        {simRunning && (
          <div>
            <div className="flex justify-between text-[9.5px] font-mono text-ink-3 mb-1">
              <span>{simProgress} / {totalUnits} called</span>
              <span>{Math.round((simProgress / totalUnits) * 100)}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bar-track)' }}>
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${(simProgress / totalUnits) * 100}%` }} />
            </div>
          </div>
        )}

        {!isValid && <p className="text-[9.5px] font-mono text-red-500 text-center">Party totals exceed 100% ({partySum.toFixed(1)}%)</p>}

        <button onClick={handleRun} disabled={!isValid && !simRunning}
          className={`w-full h-9 rounded-[5px] text-[12px] font-mono font-bold uppercase tracking-wide transition-colors shadow-sm ${
            simRunning ? 'bg-[#B91C1C] text-white hover:bg-[#991B1B]' : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed'
          }`}>
          {simRunning ? '⏹  Stop Simulation' : '▶  Run Election Night Simulation'}
        </button>
      </div>
    </aside>
  );
}

// ── Reporting bubble ──────────────────────────────────────────────────────────
function ReportingBubble({ pct, dark }: { pct: number; dark: boolean }) {
  const radius = 27;
  const circ   = 2 * Math.PI * radius;
  const offset = circ * (1 - Math.min(pct, 100) / 100);

  const bg     = dark ? 'rgba(8, 12, 26, 0.88)' : 'rgba(255,255,255,0.92)';
  const border = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const ink    = dark ? '#f0f2f8' : '#0f1117';
  const muted  = dark ? 'rgba(240,242,248,0.36)' : 'rgba(15,17,23,0.38)';
  const track  = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';

  return (
    <div className="absolute bottom-10 left-3 z-[900] pointer-events-none select-none">
      <div style={{
        background: bg,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderRadius: 22,
        border: `1px solid ${border}`,
        boxShadow: '0 8px 36px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)',
        padding: '12px 14px 10px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        minWidth: 88,
      }}>
        {/* Ring + centered number */}
        <div style={{ position: 'relative', width: 68, height: 68 }}>
          <svg width={68} height={68} viewBox="0 0 68 68" style={{ display: 'block' }}>
            {/* Track */}
            <circle cx="34" cy="34" r={radius} fill="none" stroke={track} strokeWidth="5.5" />
            {/* Progress */}
            <circle cx="34" cy="34" r={radius} fill="none"
              stroke="#10b981" strokeWidth="5.5"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform="rotate(-90 34 34)"
              style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1)' }}
            />
          </svg>
          {/* Number inside ring */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 0,
          }}>
            <span style={{ fontSize: 15, fontWeight: 900, fontFamily: 'ui-monospace,"Fira Mono",monospace', lineHeight: 1, color: ink, letterSpacing: '-0.5px' }}>
              {pct.toFixed(1)}
            </span>
            <span style={{ fontSize: 9, fontWeight: 700, fontFamily: 'ui-monospace,"Fira Mono",monospace', color: muted, letterSpacing: '0.06em', lineHeight: 1.2 }}>
              %
            </span>
          </div>
        </div>
        {/* Live dot + label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: '#10b981', display: 'inline-block',
            animation: 'livePulse 1.6s ease-in-out infinite',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 8, fontWeight: 700, fontFamily: 'ui-monospace,"Fira Mono",monospace', letterSpacing: '0.16em', textTransform: 'uppercase', color: muted }}>
            Reporting
          </span>
        </div>
      </div>
    </div>
  );
}

// ── US Census regions ─────────────────────────────────────────────────────────
const USA_REGIONS: { name: string; fips: string[] }[] = [
  { name: 'Northeast', fips: ['09','23','25','33','44','50','34','36','42'] },
  { name: 'Midwest',   fips: ['17','18','26','39','55','19','20','27','29','31','38','46'] },
  { name: 'South',     fips: ['10','12','13','24','37','45','51','11','54','01','21','28','47','05','22','40','48'] },
  { name: 'West',      fips: ['04','08','16','30','32','35','49','56','02','06','15','41','53'] },
];

function UsaSummaryPanel({ currentResults, exiting = false, onClose }: {
  currentResults: Record<string, Record<string, number>>;
  exiting?: boolean;
  onClose: () => void;
}) {
  const regions = useMemo(() => {
    return USA_REGIONS.map(region => {
      const partyTotals: Record<string, number> = {};
      let grandTotal = 0;
      for (const fips of region.fips) {
        const stateVotes = STATE_VOTES[fips] ?? 0;
        const results = currentResults[fips];
        if (!results) continue;
        const shareTotal = Object.values(results).reduce((s, v) => s + v, 0);
        if (shareTotal === 0) continue;
        for (const pid of ALL_PIDS) {
          const votes = ((results[pid] ?? 0) / shareTotal) * stateVotes;
          partyTotals[pid] = (partyTotals[pid] ?? 0) + votes;
          grandTotal += votes;
        }
      }
      const sorted = ALL_PIDS
        .filter(p => (partyTotals[p] ?? 0) > 0)
        .sort((a, b) => (partyTotals[b] ?? 0) - (partyTotals[a] ?? 0));
      return { name: region.name, partyTotals, grandTotal, sorted };
    });
  }, [currentResults]);

  const overallTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    let grand = 0;
    for (const region of regions) {
      for (const pid of ALL_PIDS) {
        totals[pid] = (totals[pid] ?? 0) + (region.partyTotals[pid] ?? 0);
        grand += region.partyTotals[pid] ?? 0;
      }
    }
    return { totals, grand };
  }, [regions]);

  return (
    <aside className={`w-[300px] shrink-0 bg-card border-r border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit-left' : 'panel-slide-left'}`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default flex items-start justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-[14px] font-bold text-ink leading-tight">Regional Summary</h2>
          <p className="text-[9px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Vote share by region</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base leading-none shrink-0 mt-0.5">×</button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {/* National totals */}
        {overallTotals.grand > 0 && (
          <div className="px-3.5 py-3 border-b border-default bg-[#f8f7f4] dark:bg-[#1a1f2e]">
            <div className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-2">National Total</div>
            <div className="flex h-2 rounded-full overflow-hidden mb-2">
              {ALL_PIDS.filter(p => (overallTotals.totals[p] ?? 0) > 0)
                .sort((a, b) => (overallTotals.totals[b] ?? 0) - (overallTotals.totals[a] ?? 0))
                .map(pid => (
                  <div key={pid}
                    style={{ width: `${(overallTotals.totals[pid] / overallTotals.grand) * 100}%`, background: PARTY_MAP[pid]?.color }}
                  />
                ))}
            </div>
            <div className="space-y-1">
              {ALL_PIDS.filter(p => (overallTotals.totals[p] ?? 0) > 0)
                .sort((a, b) => (overallTotals.totals[b] ?? 0) - (overallTotals.totals[a] ?? 0))
                .map(pid => {
                  const votes = overallTotals.totals[pid] ?? 0;
                  const pct = (votes / overallTotals.grand) * 100;
                  const party = PARTY_MAP[pid];
                  return (
                    <div key={pid} className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: party?.color }} />
                      <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">{party?.name}</span>
                      <span className="text-[8.5px] font-mono text-ink-3 tabular-nums opacity-60 mr-0.5">{Math.round(votes).toLocaleString()}</span>
                      <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: party?.color, minWidth: 34, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Per-region breakdown */}
        {regions.map(region => {
          const leader = region.sorted[0];
          const leaderColor = leader ? PARTY_MAP[leader]?.color : '#888';
          const hasData = region.grandTotal > 0;
          return (
            <div key={region.name} className="px-3.5 py-3 border-b border-default">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  {leader && hasData && (
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: leaderColor }} />
                  )}
                  <span className="text-[11px] font-bold uppercase tracking-wide text-ink">{region.name}</span>
                </div>
                {hasData && (
                  <span className="text-[8.5px] font-mono text-ink-3 tabular-nums">{Math.round(region.grandTotal).toLocaleString()}</span>
                )}
              </div>

              {hasData ? (
                <>
                  <div className="flex h-1.5 rounded-full overflow-hidden mb-2">
                    {region.sorted.map(pid => (
                      <div key={pid}
                        style={{ width: `${(region.partyTotals[pid] / region.grandTotal) * 100}%`, background: PARTY_MAP[pid]?.color }}
                      />
                    ))}
                  </div>
                  <div className="space-y-1">
                    {region.sorted.map(pid => {
                      const votes = region.partyTotals[pid] ?? 0;
                      const pct = (votes / region.grandTotal) * 100;
                      const party = PARTY_MAP[pid];
                      return (
                        <div key={pid} className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: party?.color }} />
                          <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">{party?.name}</span>
                          <span className="text-[8.5px] font-mono text-ink-3 tabular-nums opacity-60 mr-0.5">{Math.round(votes).toLocaleString()}</span>
                          <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: party?.color, minWidth: 34, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="text-[9px] font-mono text-ink-3 italic">No data</div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function USAApp() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  const [geojson, setGeojson] = useState<GeoJsonObject | null>(null);
  const [currentResults, setCurrentResults] = useState<Record<string, Record<string, number>>>({});
  const [stateReporting, setStateReporting] = useState<Record<string, number>>({});
  const [selectedFips, setSelectedFips] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [bubbleMapMode, setBubbleMapMode] = useState(false);
  const [swingOpen, setSwingOpen] = useState(false);
  const [summaryOpen, setSummaryOpen]     = useState(false);
  const [summaryExiting, setSummaryExiting] = useState(false);
  const [blankDemIdx, setBlankDemIdx] = useState(0);
  const [blankGopIdx, setBlankGopIdx] = useState(0);
  const blankNominees = useMemo<NomineeRecord>(() => ({
    ...USA_NOMINEES_2024,
    DEM: BLANK_DEM_CANDIDATES[blankDemIdx],
    GOP: BLANK_GOP_CANDIDATES[blankGopIdx],
  }), [blankDemIdx, blankGopIdx]);
  const [simOpen, setSimOpen]     = useState(false);
  const [simExiting, setSimExiting] = useState(false);
  const [simRunning, setSimRunning] = useState(false);
  const [simProgress, setSimProgress] = useState(0);
  const simTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [hiddenParties, setHiddenParties] = useState<Set<UsaPartyId>>(new Set());
  const [partiesOpen, setPartiesOpen] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedFipsSet, setSelectedFipsSet] = useState<Set<string>>(new Set());
  const layerRef              = useRef<L.GeoJSON | null>(null);
  const containerRef          = useRef<HTMLDivElement | null>(null);
  const headerScrollRef       = useRef<HTMLDivElement>(null);
  const initialLoadRef        = useRef(false);
  const blankSliderMemoryRef  = useRef<Record<string, Record<UsaPartyId, number>>>({});
  const blankReportingMemoryRef = useRef<Record<string, string>>({});
  const currentResultsRef     = useRef(currentResults);
  const stateReportingRef     = useRef(stateReporting);
  const bubbleModeRef         = useRef(bubbleMapMode);
  const multiSelectModeRef    = useRef(multiSelectMode);
  const activePresetRef       = useRef(activePreset);
  useEffect(() => { currentResultsRef.current = currentResults; }, [currentResults]);
  useEffect(() => { stateReportingRef.current = stateReporting; }, [stateReporting]);
  useEffect(() => { bubbleModeRef.current = bubbleMapMode; }, [bubbleMapMode]);
  useEffect(() => { multiSelectModeRef.current = multiSelectMode; }, [multiSelectMode]);
  useEffect(() => { activePresetRef.current = activePreset; }, [activePreset]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  useEffect(() => {
    const el = headerScrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Load GeoJSON, strip Puerto Rico
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}usa-states.geojson`)
      .then(r => r.json())
      .then((data: any) => {
        data.features = data.features.filter((f: any) => f.properties?.STATE !== '72');
        setGeojson(data as GeoJsonObject);
      })
      .catch(console.error);
  }, []);

  // ── Tally EVs ──────────────────────────────────────────────────────────────
  const tally = useMemo(() => {
    const t: Record<string, number> = {};
    for (const [fips, results] of Object.entries(currentResults)) {
      if (!EV[fips]) continue;
      const sorted = Object.entries(results).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      const winner = sorted[0]?.[0];
      if (!winner) continue;
      if (activePreset === 'blank' || activePreset === 'sim') {
        // blank: CDs inherit parent state reporting; sim: each fips has its own reporting
        const repFips = (activePreset === 'blank' && fips.includes('-')) ? fips.split('-')[0] : fips;
        const rep = stateReporting[repFips] ?? 0;
        if (rep === 0) continue;
        const shareTotal = Object.values(results).reduce((s, v) => s + v, 0);
        const marginFraction = shareTotal > 0 ? (sorted[0][1] - (sorted[1]?.[1] ?? 0)) / shareTotal : 0;
        const stateTotalVotes = (fips.includes('-') ? CD_VOTES[fips] : STATE_VOTES[fips]) ?? 0;
        const marginVotes = marginFraction * stateTotalVotes * rep / 100;
        const remainingVotes = stateTotalVotes * (1 - rep / 100);
        if (rep < 100 && marginVotes <= remainingVotes) continue;
      }
      t[winner] = (t[winner] ?? 0) + (EV[fips] ?? 0);
    }
    return t;
  }, [currentResults, activePreset, stateReporting]);

  // ── National reporting % (blank map + simulation) ─────────────────────────
  const nationalReportingPct = useMemo(() => {
    if (activePreset !== 'blank' && activePreset !== 'sim') return null;
    let weightedSum = 0;
    let totalVotes = 0;
    for (const [fips, votes] of Object.entries(STATE_VOTES)) {
      if (activePreset === 'sim' && SPLIT_STATES[fips]) {
        // sim sets reporting per CD, not state-level — aggregate from CDs
        const cds = SPLIT_STATES[fips];
        let cdW = 0, cdT = 0;
        for (const cd of cds) { const v = CD_VOTES[cd.key] ?? 0; cdW += (stateReporting[cd.key] ?? 0) * v; cdT += v; }
        weightedSum += cdT > 0 ? (cdW / cdT) * votes : 0;
      } else {
        weightedSum += (stateReporting[fips] ?? 0) * votes;
      }
      totalVotes += votes;
    }
    return totalVotes > 0 ? weightedSum / totalVotes : 0;
  }, [activePreset, stateReporting]);

  // ── Vote pcts + raw votes ─────────────────────────────────────────────────
  const { votePcts, rawVotes } = useMemo(() => {
    const raw: Record<string, number> = {};
    let grandTotal = 0;
    for (const [fips, results] of Object.entries(currentResults)) {
      if (fips.includes('-')) continue;
      const stateVotes = STATE_VOTES[fips];
      if (!stateVotes) continue;
      const shareTotal = Object.values(results).reduce((s, v) => s + v, 0);
      if (shareTotal === 0) continue;
      const reportingFraction = (activePreset === 'blank' || activePreset === 'sim')
        ? (stateReporting[fips] ?? 100) / 100
        : 1;
      grandTotal += stateVotes * reportingFraction;
      for (const [pid, share] of Object.entries(results)) {
        raw[pid] = (raw[pid] ?? 0) + (share / shareTotal) * stateVotes * reportingFraction;
      }
    }
    const pcts: Record<string, number> = {};
    if (grandTotal > 0) {
      for (const [pid, v] of Object.entries(raw)) pcts[pid] = (v / grandTotal) * 100;
    }
    return { votePcts: pcts, rawVotes: raw };
  }, [currentResults, activePreset, stateReporting]);

  // ── Re-style layer whenever results/selection/dark/bubbleMode changes ────
  useEffect(() => {
    if (!layerRef.current) return;
    enforceNoSmooth(layerRef.current);
    const lineColor = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
    layerRef.current.eachLayer((layer: L.Layer) => {
      const path = layer as L.Path & { feature?: Feature };
      const fips = (path.feature?.properties as Record<string, string> | undefined)?.STATE ?? '';
      const isSelected = multiSelectMode ? selectedFipsSet.has(fips) : fips === selectedFips;
      const results = currentResults[fips];
      const hasFill = !!results && Object.values(results).some(v => v > 0);
      path.setStyle({
        fillColor: hasFill ? stateFill(results!, dark) : 'transparent',
        fillOpacity: hasFill ? 0.6 : 0,
        color: isSelected ? '#c8a020' : lineColor,
        weight: isSelected ? 2 : 0.5,
        opacity: 1,
      });
    });
  }, [currentResults, selectedFips, selectedFipsSet, multiSelectMode, dark, geojson, bubbleMapMode]);

  // ── Presets ────────────────────────────────────────────────────────────────
  const load2024 = useCallback(() => {
    const results: Record<string, Record<string, number>> = {};
    for (const [fips, r] of Object.entries(RESULTS_2024)) results[fips] = { ...r };
    setCurrentResults(results);
    setActivePreset('2024');
    setSelectedFips(null);
    setSelectedFipsSet(new Set());
    setMultiSelectMode(false);
  }, []);

  const load2026 = useCallback(() => {
    const results: Record<string, Record<string, number>> = {};
    for (const [fips, r] of Object.entries(RESULTS_2026)) results[fips] = { ...r };
    setCurrentResults(results);
    setActivePreset('2026');
    setSelectedFips(null);
    setSelectedFipsSet(new Set());
    setMultiSelectMode(false);
  }, []);

  const loadBlank = useCallback(() => {
    setCurrentResults({});
    setStateReporting({});
    setActivePreset('blank');
    setSelectedFips(null);
    setSelectedFipsSet(new Set());
    setMultiSelectMode(false);
    setSwingOpen(false);
    blankSliderMemoryRef.current = {};
    blankReportingMemoryRef.current = {};
  }, []);

  const stopSim = useCallback(() => {
    for (const t of simTimersRef.current) clearTimeout(t);
    simTimersRef.current = [];
    setSimRunning(false);
    setSimProgress(0);
  }, []);

  const toggleSummary = useCallback(() => {
    if (summaryOpen) {
      setSummaryExiting(true);
      setTimeout(() => { setSummaryOpen(false); setSummaryExiting(false); }, 260);
    } else {
      setSummaryOpen(true);
      setSummaryExiting(false);
    }
  }, [summaryOpen]);

  const toggleSim = useCallback(() => {
    if (simOpen) {
      setSimExiting(true);
      setTimeout(() => { setSimOpen(false); setSimExiting(false); }, 260);
    } else {
      setSimOpen(true);
      setSimExiting(false);
    }
  }, [simOpen]);

  const handleApplySwing = useCallback((swings: Record<UsaPartyId, number>) => {
    setCurrentResults(prev => {
      const next: typeof prev = {};
      for (const [fips, results] of Object.entries(prev)) {
        const pcts = pctsFromResults(results);
        const newPcts: Record<UsaPartyId, number> = { ...DEFAULT_PCTS };
        for (const pid of ALL_PIDS) newPcts[pid] = Math.max(0, (pcts[pid] ?? 0) + (swings[pid] ?? 0));
        const total = ALL_PIDS.reduce((s, p) => s + newPcts[p], 0);
        if (total > 0) for (const p of ALL_PIDS) newPcts[p] = (newPcts[p] / total) * 100;
        next[fips] = toRawResults(newPcts);
      }
      return next;
    });
  }, []);


  // Default to blank map on first load
  useEffect(() => {
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      loadBlank();
    }
  }, [loadBlank]);

  // ── Results change ─────────────────────────────────────────────────────────
  const handleResultsChange = useCallback((fips: string, results: Record<string, number>) => {
    setCurrentResults(prev => ({ ...prev, [fips]: results }));
    if (activePreset === null) setActivePreset('blank');
  }, [activePreset]);

  const handleReportingCommit = useCallback((fips: string, pct: number) => {
    setStateReporting(prev => ({ ...prev, [fips]: pct }));
  }, []);

  // ── Map style + handlers ───────────────────────────────────────────────────
  const geoStyle = useCallback((): L.PathOptions => ({
    fillColor: 'transparent',
    fillOpacity: 0,
    color: dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
    weight: 0.5,
    opacity: 1,
  }), [dark]);

  const handleEachFeature = useCallback((_feature: Feature, layer: L.Layer) => {
    const props = (_feature.properties as Record<string, string>);
    const fips = props.STATE ?? '';
    const name = props.NAME ?? '';

    layer.on('click', () => {
      if (multiSelectModeRef.current) {
        setSelectedFipsSet(prev => {
          const next = new Set(prev);
          if (next.has(fips)) next.delete(fips); else next.add(fips);
          return next;
        });
        return;
      }
      setSelectedFips(prev => prev === fips ? null : fips);
    });

    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleModeRef.current) { setTooltip(null); return; }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const isBlank = activePresetRef.current === 'blank';
      const blankReportingPct = isBlank ? (parseFloat(blankReportingMemoryRef.current[fips] ?? '') || 0) : 0;
      const blankPcts = isBlank ? blankSliderMemoryRef.current[fips] : undefined;
      setTooltip({
        x: e.originalEvent.clientX - rect.left,
        y: e.originalEvent.clientY - rect.top,
        name, fips,
        results: blankPcts
          ? Object.fromEntries(Object.entries(blankPcts).map(([k, v]) => [k, Math.round(v * 1000)]))
          : currentResultsRef.current[fips] ?? {},
        stateVotes: isBlank
          ? (blankReportingPct > 0 ? Math.round((STATE_VOTES[fips] ?? 0) * blankReportingPct / 100) : 0)
          : (STATE_VOTES[fips] ?? 0),
        reportingPct: isBlank
          ? (blankReportingPct > 0 ? blankReportingPct : undefined)
          : stateReportingRef.current[fips],
      });
    });

    layer.on('mouseout', () => setTooltip(null));
  }, []);

  // ── Button styles ──────────────────────────────────────────────────────────
  const btnBase      = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnMuted     = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive    = `${btnBase} border-[#c8a020] bg-[#c8a020] text-white`;
  const btn2024Class  = activePreset === '2024'  ? `${btnBase} border-[#BF0A30] bg-[#BF0A30] text-white` : btnMuted;
  const btn2026Class  = activePreset === '2026'  ? `${btnBase} border-[#4F46E5] bg-[#4F46E5] text-white` : btnMuted;
  const btnBlankClass = activePreset === 'blank' ? `${btnBase} border-[#c8a020] bg-[#c8a020] text-white` : btnMuted;

  const selectedName = selectedFips ? STATE_NAMES[selectedFips] ?? selectedFips : null;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden">

      {/* ── Topbar ─────────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>

        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
          <div className="hidden sm:flex flex-col justify-center mr-2 leading-none">
            <span className="font-display font-black uppercase tracking-[0.04em] text-[14px] text-ink leading-none">Global Election Simulator</span>
            <span className="text-[7.5px] font-mono uppercase tracking-[0.13em] text-ink-3 leading-none mt-[3px]">White House Edition</span>
          </div>
        </button>

        <div ref={headerScrollRef} className="flex-1 min-w-0 header-scroll-strip flex items-center gap-2 px-2">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={load2024} className={btn2024Class}>2024 Baseline</button>
          <button onClick={load2026} className={btn2026Class}>2026 Polling</button>
          <button onClick={loadBlank} className={btnBlankClass}>Blank Map</button>

          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          <button
            onClick={toggleSim}
            className={`${btnBase} flex items-center gap-1.5 ${simOpen ? 'border-[#c8a020] bg-[#c8a020] text-white' : btnMuted}`}
          >
            <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor" aria-hidden="true">
              <path d="M1 1.2L6 4L1 6.8V1.2Z" strokeLinejoin="round"/>
            </svg>
            Simulation
          </button>
          {(activePreset === 'blank' || simOpen) && (
            <div className="relative shrink-0">
              <button
                onClick={() => setPartiesOpen(o => !o)}
                className={`${btnBase} flex items-center gap-1 ${partiesOpen ? 'border-[#c8a020] bg-[#c8a020] text-white' : btnMuted}`}
              >
                Parties
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true" style={{ marginTop: 1 }}>
                  <path d="M1.5 2.5L4 5.5L6.5 2.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {partiesOpen && (
                <>
                  <div className="fixed inset-0 z-[99]" onClick={() => setPartiesOpen(false)} />
                  <div className="absolute left-0 top-[calc(100%+6px)] z-[100] w-44 rounded-[8px] bg-white border border-default overflow-hidden shadow-md">
                    <div className="px-3 py-2 border-b border-default">
                      <span className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">Toggle Parties</span>
                    </div>
                    <div className="py-1">
                      {USA_PARTIES.map(p => {
                        const hidden = hiddenParties.has(p.id as UsaPartyId);
                        return (
                          <label key={p.id} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-hover cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!hidden}
                              onChange={() => setHiddenParties(prev => {
                                const n = new Set(prev);
                                if (n.has(p.id as UsaPartyId)) n.delete(p.id as UsaPartyId); else n.add(p.id as UsaPartyId);
                                return n;
                              })}
                              className="w-3 h-3 rounded"
                              style={{ accentColor: p.color }}
                            />
                            <span className="text-[11px] font-mono" style={{ color: p.color, fontWeight: 600 }}>{p.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          <button
            onClick={() => {
              if (multiSelectMode) { setMultiSelectMode(false); setSelectedFipsSet(new Set()); }
              else { setMultiSelectMode(true); setSelectedFips(null); }
            }}
            className={multiSelectMode ? btnActive : btnMuted}
          >
            {multiSelectMode ? `⊕ ${selectedFipsSet.size} sel.` : 'Multi-Select'}
          </button>
          {(activePreset === '2024' || activePreset === '2026') && (
            <button onClick={() => setSwingOpen(s => !s)} className={swingOpen ? btnActive : btnMuted}>Swing</button>
          )}
          <button
            onClick={() => setBubbleMapMode(b => !b)}
            className={bubbleMapMode ? btnActive : btnMuted}
          >
            Bubble Map
          </button>
          <button onClick={toggleSummary} className={summaryOpen ? btnActive : btnMuted}>
            Summary
          </button>
        </div>

        <div className="shrink-0 flex items-center gap-2.5 pr-4">
          <button
            onClick={() => setDark(d => !d)}
            className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="2.7" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                <line x1="7" y1="0.5" x2="7" y2="2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="7" y1="11.8" x2="7" y2="13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="0.5" y1="7" x2="2.2" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="11.8" y1="7" x2="13.5" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="2.5" y1="2.5" x2="3.6" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="10.4" y1="10.4" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="11.5" y1="2.5" x2="10.4" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="3.6" y1="10.4" x2="2.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <path d="M11 7.8A5.5 5.5 0 0 1 5.2 2a5.5 5.5 0 1 0 5.8 5.8z" stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 relative">

        {/* Collapsible scoreboard */}
        <div className="relative shrink-0">
          <div style={{
            display: 'grid',
            gridTemplateRows: scoreboardVisible ? '1fr' : '0fr',
            transition: 'grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1)',
          }}>
            <div className="overflow-hidden">
              <UsaScoreboard
                tally={tally} votePcts={votePcts} rawVotes={rawVotes} activePreset={activePreset}
                nominees={activePreset === 'blank' ? blankNominees : undefined}
                blankDemIdx={blankDemIdx} blankGopIdx={blankGopIdx}
                onChangeBlankCandidate={(pid, idx) => { if (pid === 'DEM') setBlankDemIdx(idx); else setBlankGopIdx(idx); }}
                hiddenParties={hiddenParties}
              />
            </div>
          </div>
          <button
            onClick={() => setScoreboardVisible(v => !v)}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-[1001] h-4 px-3 rounded-full bg-white border border-default shadow-sm hover:bg-hover text-ink-3 hover:text-ink transition-colors flex items-center gap-1"
          >
            <svg width="8" height="5" viewBox="0 0 8 5" fill="none" aria-hidden="true">
              {scoreboardVisible
                ? <path d="M7 4L4 1L1 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              }
            </svg>
            <span className="text-[7.5px] font-mono uppercase tracking-wider leading-none">
              {scoreboardVisible ? 'Hide' : 'Results'}
            </span>
          </button>
        </div>

        {/* Map + panel row */}
        <div className="flex flex-1 min-h-0 relative">
          {(summaryOpen || summaryExiting) && (
            <UsaSummaryPanel
              currentResults={currentResults}
              exiting={summaryExiting}
              onClose={toggleSummary}
            />
          )}
          <div className="flex-1 min-w-0 relative">
            {geojson ? (
              <div ref={containerRef} className="relative w-full h-full">
                <MapContainer
                  style={{ width: '100%', height: '100%' }}
                  center={[38, -98]}
                  zoom={4}
                  zoomControl={true}
                  attributionControl={false}
                  preferCanvas={true}
                >
                  <TileLayer
                    key={dark ? 'dark' : 'light'}
                    url={dark
                      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
                    }
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    subdomains="abcd"
                    maxZoom={20}
                    updateWhenZooming={false}
                    updateWhenIdle={true}
                  />
                  <UsaMapController layerRef={layerRef} />
                  {!bubbleMapMode && (
                    <GeoJSON
                      key="usa-states"
                      data={geojson}
                      style={geoStyle}
                      onEachFeature={handleEachFeature}
                      ref={layerRef as any}
                      {...({ smoothFactor: 0 } as any)}
                    />
                  )}
                  {bubbleMapMode && activePreset !== 'blank' && (
                    <UsaBubbleLayer
                      geojson={geojson}
                      currentResults={currentResults}
                      dark={dark}
                      containerRef={containerRef}
                      blankSliderMemoryRef={blankSliderMemoryRef}
                      blankReportingMemoryRef={blankReportingMemoryRef}
                      currentResultsRef={currentResultsRef}
                      stateReportingRef={stateReportingRef}
                      multiSelectModeRef={multiSelectModeRef}
                      activePresetRef={activePresetRef}
                      setTooltip={setTooltip}
                      setSelectedFips={setSelectedFips}
                      setSelectedFipsSet={setSelectedFipsSet}
                    />
                  )}
                  <MapFitter geojson={geojson} />
                </MapContainer>

                {tooltip && containerRef.current && (
                  <MapTooltip
                    tooltip={tooltip}
                    containerW={containerRef.current.clientWidth}
                    containerH={containerRef.current.clientHeight}
                    dark={dark}
                  />
                )}

              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-[11px] font-mono text-ink-3 uppercase tracking-wider animate-pulse">Loading map…</span>
              </div>
            )}

            {nationalReportingPct !== null && (
              <ReportingBubble pct={nationalReportingPct} dark={dark} />
            )}
          </div>

          {/* Right panels — simulation, swing, multiselect, or single state */}
          {(simOpen || simExiting) && (
            <UsaSimulationPanel
              exiting={simExiting}
              onApplyResults={(r) => { setCurrentResults(r); setStateReporting({}); setActivePreset('sim'); setSelectedFips(null); setSelectedFipsSet(new Set()); setMultiSelectMode(false); }}
              onUpdateState={handleResultsChange}
              onUpdateReporting={(fips, pct) => setStateReporting(prev => ({ ...prev, [fips]: pct }))}
              onClose={toggleSim}
              simRunning={simRunning}
              simProgress={simProgress}
              timersRef={simTimersRef}
              setSimRunning={setSimRunning}
              setSimProgress={setSimProgress}
              stopSim={stopSim}
            />
          )}
          {swingOpen && (activePreset === '2024' || activePreset === '2026') && (
            <UsaSwingPanel
              onClose={() => setSwingOpen(false)}
              onApply={handleApplySwing}
              activePreset={activePreset}
            />
          )}
          {multiSelectMode && selectedFipsSet.size > 0 && (
            <UsaMultiSelectPanel
              selectedFipsSet={selectedFipsSet}
              currentResults={currentResults}
              onResultsChange={handleResultsChange}
              onClear={() => setSelectedFipsSet(new Set())}
            />
          )}
          {!multiSelectMode && selectedFips && selectedName && (
            <StatePanel
              fips={selectedFips}
              name={selectedName}
              results={currentResults[selectedFips]}
              onClose={() => setSelectedFips(null)}
              onResultsChange={handleResultsChange}
              onReportingCommit={handleReportingCommit}
              activePreset={activePreset}
              splitCds={SPLIT_STATES[selectedFips]}
              cdResultsMap={SPLIT_STATES[selectedFips]
                ? Object.fromEntries(
                    SPLIT_STATES[selectedFips].map(cd => [cd.key, currentResults[cd.key] ?? {}])
                  )
                : undefined}
              blankSliderMemory={blankSliderMemoryRef}
              blankReportingMemory={blankReportingMemoryRef}
            />
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-30 flex items-center justify-between px-3 py-1 bg-ink/60">
          <span className="text-[10px] text-white/70 font-mono tracking-wide uppercase">Global Election Simulator — US Presidential Edition</span>
          {nationalReportingPct !== null ? (
            <span className="text-[10px] text-white/80 font-mono tabular-nums">
              {nationalReportingPct.toFixed(1)}% reporting
            </span>
          ) : (
            <span className="text-[10px] text-white/40 font-mono">{typeof window !== 'undefined' ? window.location.hostname : ''}</span>
          )}
        </div>
      </div>

    </div>
  );
}
