import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── Party types ────────────────────────────────────────────────────────────────
type NlPartyId =
  | 'D66' | 'PVV' | 'VVD' | 'GLPVDA' | 'CDA'
  | 'JA21' | 'FVD' | 'BBB' | 'DENK' | 'SGP'
  | 'PVDD' | 'CU' | 'SP' | 'PLUS50' | 'VOLT' | 'DNA';

type NlParty = {
  id: NlPartyId;
  name: string;
  fullName: string;
  color: string;
  seats2025: number;
  leader: string;
  wikiTitle?: string;
  leader2026?: string;
  wikiTitle2026?: string;
};

const NL_PARTIES: NlParty[] = [
  { id: 'D66',    name: 'D66',     fullName: 'Democrats 66',                            color: '#009E60', seats2025: 26, leader: 'Rob Jetten',            wikiTitle: 'Rob_Jetten' },
  { id: 'PVV',    name: 'PVV',     fullName: 'Party for Freedom',                       color: '#003082', seats2025: 26, leader: 'Geert Wilders',          wikiTitle: 'Geert_Wilders' },
  { id: 'VVD',    name: 'VVD',     fullName: "People's Party for Freedom & Democracy",  color: '#0065AB', seats2025: 22, leader: 'Dilan Yeşilgöz',         wikiTitle: 'Dilan_Yeşilgöz-Zegerius' },
  { id: 'GLPVDA', name: 'GL-PvdA', fullName: 'GreenLeft–Labour Party',                  color: '#CC0000', seats2025: 20, leader: 'Frans Timmermans',       wikiTitle: 'Frans_Timmermans',       leader2026: 'Jesse Klaver',         wikiTitle2026: 'Jesse_Klaver' },
  { id: 'CDA',    name: 'CDA',     fullName: 'Christian Democratic Appeal',             color: '#007B5F', seats2025: 18, leader: 'Henri Bontenbal',         wikiTitle: 'Henri_Bontenbal' },
  { id: 'JA21',   name: 'JA21',    fullName: 'Right Answer 2021',                       color: '#1B3C78', seats2025:  9, leader: 'Joost Eerdmans',          wikiTitle: 'Joost_Eerdmans' },
  { id: 'FVD',    name: 'FvD',     fullName: 'Forum for Democracy',                     color: '#821622', seats2025:  7, leader: 'Lidewij de Vos',          wikiTitle: 'Lidewij_de_Vos' },
  { id: 'BBB',    name: 'BBB',     fullName: 'Farmer Citizen Movement',                 color: '#6CA23B', seats2025:  4, leader: 'Caroline van der Plas',   wikiTitle: 'Caroline_van_der_Plas',  leader2026: 'Henk Vermeer',         wikiTitle2026: 'Henk_Vermeer' },
  { id: 'DENK',   name: 'DENK',    fullName: 'DENK',                                    color: '#005B96', seats2025:  3, leader: 'Stephan van Baarle',      wikiTitle: 'Stephan_van_Baarle' },
  { id: 'SGP',    name: 'SGP',     fullName: 'Reformed Political Party',                color: '#CC6600', seats2025:  3, leader: 'Chris Stoffer',            wikiTitle: 'Chris_Stoffer' },
  { id: 'PVDD',   name: 'PvdD',    fullName: 'Party for the Animals',                   color: '#2E7D32', seats2025:  3, leader: 'Esther Ouwehand',          wikiTitle: 'Esther_Ouwehand' },
  { id: 'CU',     name: 'CU',      fullName: 'ChristianUnion',                          color: '#3380B0', seats2025:  3, leader: 'Mirjam Bikker',            wikiTitle: 'Mirjam_Bikker' },
  { id: 'SP',     name: 'SP',      fullName: 'Socialist Party',                         color: '#BB0000', seats2025:  3, leader: 'Jimmy Dijk',               wikiTitle: 'Jimmy_Dijk' },
  { id: 'PLUS50', name: '50Plus',  fullName: '50Plus',                                  color: '#8B0086', seats2025:  2, leader: 'Jan Struijs',              wikiTitle: 'Jan_Struijs' },
  { id: 'VOLT',   name: 'Volt',    fullName: 'Volt Netherlands',                        color: '#5C2D91', seats2025:  1, leader: 'Laurens Dassen',           wikiTitle: 'Laurens_Dassen' },
  { id: 'DNA',    name: 'DNA',     fullName: 'Dutch Nationalist Party',                 color: '#8B5E3C', seats2025:  0, leader: 'DNA Leader',               wikiTitle: undefined },
];

const NL_PARTY_MAP = Object.fromEntries(NL_PARTIES.map(p => [p.id, p])) as Record<NlPartyId, NlParty>;
const NL_TOTAL_SEATS = 150;
const NL_MAJORITY = 76;

// 2025 actual national vote percentages — source: Kiesraad
const NL_VOTE_PCT_2025: Record<NlPartyId, number> = {
  D66:    16.94, PVV:   16.66, VVD:    14.24, GLPVDA: 12.79,
  CDA:    11.79, JA21:   5.95, FVD:     4.54, BBB:     2.65,
  DENK:    2.37, SGP:    2.25, PVDD:    2.08, CU:      1.90,
  SP:      1.89, PLUS50: 1.43, VOLT:    1.10, DNA:     0.00,
};

// Exact raw vote counts — Kiesraad, valid votes 10 571 990
const NL_VOTE_RAW_2025: Record<NlPartyId, number> = {
  D66:    1_790_634, PVV:   1_760_966, VVD:   1_505_829, GLPVDA: 1_352_163,
  CDA:    1_246_874, JA21:    628_517, FVD:     480_393, BBB:      279_916,
  DENK:     250_368, SGP:     238_093, PVDD:    219_371, CU:       201_361,
  SP:       199_585, PLUS50:  151_053, VOLT:    116_468, DNA:            0,
};
const NL_GRAND_TOTAL_VOTES = 10_571_990;

// 2026 polling scenario — calibrated to produce D'Hondt seats:
// GL-PvdA 24, VVD 21, D66 20, PVV 19, CDA 15, JA21 13, FvD 11,
// PvdD 5, SP 4, CU 4, DENK 4, 50Plus 4, SGP 3, Volt 2, BBB 1, DNA 0
const NL_VOTE_PCT_2026: Record<NlPartyId, number> = {
  GLPVDA: 16.0, VVD:   14.0, D66:    13.3, PVV:    12.7,
  CDA:    10.0, JA21:   8.7, FVD:     7.3, PVDD:    3.3,
  SP:      2.7, CU:     2.7, DENK:    2.7, PLUS50:  2.7,
  SGP:     2.0, VOLT:   1.3, BBB:     0.8, DNA:     0.3,
};

// ── Province types ─────────────────────────────────────────────────────────────
type NlProvId = 'GR' | 'FR' | 'DR' | 'OV' | 'FL' | 'GE' | 'UT' | 'NH' | 'ZH' | 'ZE' | 'NB' | 'LB' | 'BES' | 'ABROAD';

type NlProvince = { id: NlProvId; name: string };

const NL_PROVINCES: NlProvince[] = [
  { id: 'GR', name: 'Groningen'          }, { id: 'FR', name: 'Fryslân'            },
  { id: 'DR', name: 'Drenthe'            }, { id: 'OV', name: 'Overijssel'         },
  { id: 'FL', name: 'Flevoland'          }, { id: 'GE', name: 'Gelderland'         },
  { id: 'UT', name: 'Utrecht'            }, { id: 'NH', name: 'Noord-Holland'      },
  { id: 'ZH', name: 'Zuid-Holland'       }, { id: 'ZE', name: 'Zeeland'            },
  { id: 'NB', name: 'Noord-Brabant'      }, { id: 'LB', name: 'Limburg'            },
  { id: 'BES', name: 'Caribisch Nederland' }, { id: 'ABROAD', name: 'Postal / Abroad' },
];

// GeoJSON statnaam property → province ID
const NL_STATNAAM_TO_ID: Record<string, NlProvId> = {
  'Groningen': 'GR', 'Fryslân': 'FR', 'Drenthe': 'DR', 'Overijssel': 'OV',
  'Flevoland': 'FL', 'Gelderland': 'GE', 'Utrecht': 'UT', 'Noord-Holland': 'NH',
  'Zuid-Holland': 'ZH', 'Zeeland': 'ZE', 'Noord-Brabant': 'NB', 'Limburg': 'LB',
};

// ── D'Hondt seat allocation ────────────────────────────────────────────────────
function calcDHondt(
  votePcts: Partial<Record<NlPartyId, number>>,
  totalSeats = NL_TOTAL_SEATS,
): Partial<Record<NlPartyId, number>> {
  const grandTotal = Object.values(votePcts).reduce((s, v) => s + (v ?? 0), 0);
  if (grandTotal === 0) return {};

  const quotients: { id: NlPartyId; q: number }[] = [];
  for (const [id, v] of Object.entries(votePcts) as [NlPartyId, number][]) {
    if ((v ?? 0) <= 0) continue;
    for (let d = 1; d <= totalSeats; d++) {
      quotients.push({ id, q: v / d });
    }
  }

  quotients.sort((a, b) => b.q - a.q);
  const seats: Partial<Record<NlPartyId, number>> = {};
  for (let i = 0; i < Math.min(totalSeats, quotients.length); i++) {
    seats[quotients[i].id] = (seats[quotients[i].id] ?? 0) + 1;
  }
  return seats;
}

// Province population weights (relative) for partial simulation
const NL_PROV_WEIGHTS: Record<NlProvId, number> = {
  GR: 3.6, FR: 4.0, DR: 2.9, OV: 7.5, FL: 2.5, GE: 12.5,
  UT: 8.5, NH: 17.5, ZH: 22.0, ZE: 2.3, NB: 14.5, LB: 6.2,
  BES: 0.2, ABROAD: 0.5,
};

// Compute partial D'Hondt seats; provFractions maps provId → 0-1 fraction reported
function calcPartialSeats(
  natPcts: Record<NlPartyId, number>,
  provFractions: Partial<Record<NlProvId, number>>,
  provOverrides?: Partial<Record<NlProvId, Partial<Record<NlPartyId, number>>>>,
): Partial<Record<NlPartyId, number>> {
  const entries = Object.entries(provFractions) as [NlProvId, number][];
  if (entries.length === 0) return {};
  const weighted: Partial<Record<NlPartyId, number>> = {};
  let totalWeight = 0;
  for (const [provId, fraction] of entries) {
    if (!fraction) continue;
    const w = (NL_PROV_WEIGHTS[provId] ?? 0) * fraction;
    const pv = calcProvVotes(natPcts, provId, provOverrides?.[provId]);
    for (const p of NL_PARTIES) {
      weighted[p.id] = (weighted[p.id] ?? 0) + (pv[p.id] ?? 0) * w;
    }
    totalWeight += w;
  }
  if (totalWeight === 0) return {};
  const normalized: Partial<Record<NlPartyId, number>> = {};
  for (const p of NL_PARTIES) normalized[p.id] = (weighted[p.id] ?? 0) / totalWeight;
  return calcDHondt(normalized);
}

const NL_TOTAL_PROV_WEIGHT = Object.values(NL_PROV_WEIGHTS).reduce((s, v) => s + v, 0);

// ── Actual 2025 province-level results — source: Kiesraad "By province" table ──
// Percentages as reported; "Others" remainder (<3%) not tracked — normalised in calcProvVotes.
const NL_PROV_RESULTS_2025: Record<NlProvId, Partial<Record<NlPartyId, number>>> = {
  GR: { D66:16.8, PVV:16.4, VVD:11.2, GLPVDA:16.6, CDA:11.1, JA21: 3.8, FVD:5.1, BBB:3.5, DENK:0.7, SGP: 1.1, PVDD:2.5, CU:3.1, SP:4.4, PLUS50:1.2, VOLT:1.2, DNA:0 },
  FR: { D66:13.3, PVV:17.2, VVD:12.0, GLPVDA:12.2, CDA:15.4, JA21: 5.6, FVD:6.8, BBB:5.0, DENK:0.4, SGP: 1.3, PVDD:1.5, CU:2.5, SP:2.1, PLUS50:1.3, VOLT:0.7, DNA:0 },
  DR: { D66:14.0, PVV:19.2, VVD:14.5, GLPVDA:11.8, CDA:12.8, JA21: 5.4, FVD:6.2, BBB:5.1, DENK:0.5, SGP: 1.0, PVDD:1.4, CU:2.4, SP:2.3, PLUS50:1.8, VOLT:0.7, DNA:0 },
  OV: { D66:13.8, PVV:16.7, VVD:13.0, GLPVDA: 9.9, CDA:15.7, JA21: 6.3, FVD:5.3, BBB:4.8, DENK:1.3, SGP: 3.3, PVDD:1.3, CU:3.4, SP:1.7, PLUS50:1.3, VOLT:0.9, DNA:0 },
  FL: { D66:13.9, PVV:19.0, VVD:13.7, GLPVDA:10.7, CDA: 9.4, JA21: 5.8, FVD:6.0, BBB:3.0, DENK:3.6, SGP: 4.5, PVDD:1.8, CU:2.6, SP:1.9, PLUS50:1.5, VOLT:0.8, DNA:0 },
  GE: { D66:16.2, PVV:15.9, VVD:13.9, GLPVDA:12.4, CDA:12.8, JA21: 5.8, FVD:4.5, BBB:3.1, DENK:1.4, SGP: 4.4, PVDD:1.9, CU:2.6, SP:1.7, PLUS50:1.3, VOLT:1.0, DNA:0 },
  UT: { D66:20.4, PVV:11.9, VVD:13.6, GLPVDA:15.8, CDA:11.3, JA21: 5.1, FVD:3.4, BBB:1.6, DENK:3.2, SGP: 2.9, PVDD:2.7, CU:2.7, SP:1.5, PLUS50:1.0, VOLT:1.6, DNA:0 },
  NH: { D66:20.4, PVV:13.2, VVD:15.3, GLPVDA:16.7, CDA: 8.1, JA21: 5.3, FVD:4.2, BBB:2.2, DENK:3.4, SGP: 0.4, PVDD:3.1, CU:1.0, SP:2.0, PLUS50:1.3, VOLT:1.4, DNA:0 },
  ZH: { D66:16.7, PVV:16.4, VVD:13.7, GLPVDA:12.8, CDA:10.8, JA21: 6.6, FVD:4.3, BBB:1.5, DENK:4.0, SGP: 3.1, PVDD:2.3, CU:2.2, SP:1.7, PLUS50:1.4, VOLT:1.2, DNA:0 },
  ZE: { D66:12.0, PVV:17.6, VVD:13.6, GLPVDA: 9.1, CDA:13.3, JA21: 6.1, FVD:5.2, BBB:3.1, DENK:0.8, SGP:10.2, PVDD:1.3, CU:2.7, SP:1.7, PLUS50:1.6, VOLT:0.6, DNA:0 },
  NB: { D66:17.8, PVV:19.1, VVD:16.7, GLPVDA:10.1, CDA:13.0, JA21: 6.7, FVD:4.0, BBB:2.4, DENK:1.8, SGP: 0.5, PVDD:1.5, CU:0.6, SP:1.9, PLUS50:1.8, VOLT:1.0, DNA:0 },
  LB: { D66:14.0, PVV:25.6, VVD:14.0, GLPVDA:10.5, CDA:13.3, JA21: 6.1, FVD:4.8, BBB:2.6, DENK:1.2, SGP: 0.1, PVDD:1.5, CU:0.4, SP:2.0, PLUS50:1.9, VOLT:0.8, DNA:0 },
  // BES islands (Bonaire, Sint Eustatius, Saba) — note: high CU due to island demographics
  BES:    { D66:24.4, PVV:11.1, VVD:11.3, GLPVDA:13.5, CDA: 7.1, JA21: 2.9, FVD:4.4, BBB:1.3, DENK:0.3, SGP: 0.4, PVDD:1.8, CU:13.8, SP:2.0, PLUS50:0.0, VOLT:2.2, DNA:0 },
  // Postal / overseas voters — note: GL-PvdA very strong among diaspora
  ABROAD: { D66:18.6, PVV: 8.6, VVD: 9.7, GLPVDA:29.1, CDA:10.3, JA21: 4.5, FVD:3.6, BBB:1.4, DENK:0.4, SGP: 0.7, PVDD:3.9, CU:1.3, SP:1.8, PLUS50:0.5, VOLT:4.2, DNA:0 },
};

// ── Simulation helpers ─────────────────────────────────────────────────────────
function nlRandNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function nlBellCurveTimes(n: number, totalMs: number): number[] {
  const raw = Array.from({ length: n }, () =>
    Math.max(0.02, Math.min(0.98, 0.5 + nlRandNormal() * 0.18))
  ).sort((a, b) => a - b);
  return raw.map(t => Math.round(t * totalMs));
}

// Proportional swing: province_pct = base_2025_pct × (new_national / old_national), then normalised.
// This ensures 0% nationally always produces 0% in every province.
function calcProvVotes(
  natPcts: Record<NlPartyId, number>,
  provId: NlProvId,
  override?: Partial<Record<NlPartyId, number>>,
): Record<NlPartyId, number> {
  if (override && Object.keys(override).length > 0) {
    const raw: Record<NlPartyId, number> = {} as Record<NlPartyId, number>;
    let total = 0;
    for (const p of NL_PARTIES) { raw[p.id] = Math.max(0, override[p.id] ?? 0); total += raw[p.id]; }
    if (total === 0) return raw;
    for (const p of NL_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
    return raw;
  }
  const base = NL_PROV_RESULTS_2025[provId] ?? {};
  const raw: Record<NlPartyId, number> = {} as Record<NlPartyId, number>;
  let total = 0;
  for (const p of NL_PARTIES) {
    const newNat = natPcts[p.id] ?? 0;
    const oldNat = NL_VOTE_PCT_2025[p.id] ?? 0;
    const basePct = base[p.id] ?? 0;
    // Party with 0% nationally gets 0% everywhere.
    // New party (oldNat=0): use national share uniformly as province base.
    const v = newNat === 0 ? 0 : oldNat === 0 ? newNat : basePct * (newNat / oldNat);
    raw[p.id] = v;
    total += v;
  }
  if (total === 0) return raw;
  for (const p of NL_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
  return raw;
}

// ── Tooltip type ───────────────────────────────────────────────────────────────
type ProvTooltipState = {
  x: number; y: number;
  name: string;
  parties: { id: NlPartyId; pct: number }[];
  leader: NlPartyId | null;
} | null;

// ── Helpers ────────────────────────────────────────────────────────────────────
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

function partyColor(id: NlPartyId): string {
  return NL_PARTY_MAP[id]?.color ?? '#888';
}

function getProvFill(natPcts: Record<NlPartyId, number>, provId: NlProvId, dark: boolean, override?: Partial<Record<NlPartyId, number>>): string {
  const pv = calcProvVotes(natPcts, provId, override);
  const sorted = (Object.entries(pv) as [NlPartyId, number][])
    .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return dark ? '#374151' : '#E5E7EB';
  const [winner, winnerPct] = sorted[0];
  const runnerUp = sorted[1]?.[1] ?? 0;
  const margin = winnerPct - runnerUp;
  const color = partyColor(winner);
  const t = Math.min(Math.max(margin / 20, 0), 1);
  const c = hsl(color);
  c.l = dark ? 0.55 - t * 0.29 : 0.82 - t * 0.46;
  return c.formatHex();
}

// Redistribute percentages across parties when one slider is moved
function redistributePcts(
  current: Record<NlPartyId, number>,
  changedId: NlPartyId,
  newRaw: number,
  locks: Set<NlPartyId>,
): Record<NlPartyId, number> {
  const ids = Object.keys(current) as NlPartyId[];
  const lockedSum = ids.filter(id => locks.has(id) && id !== changedId).reduce((s, id) => s + (current[id] ?? 0), 0);
  const clamped = Math.min(Math.max(newRaw, 0), 100 - lockedSum);
  const unlocked = ids.filter(id => !locks.has(id) && id !== changedId);
  const remaining = 100 - lockedSum - clamped;
  const unlockedSum = unlocked.reduce((s, id) => s + (current[id] ?? 0), 0);
  const next: Record<NlPartyId, number> = { ...current, [changedId]: clamped };
  if (unlockedSum > 0) {
    for (const id of unlocked) next[id] = ((current[id] ?? 0) / unlockedSum) * remaining;
  } else if (unlocked.length > 0) {
    const share = remaining / unlocked.length;
    for (const id of unlocked) next[id] = share;
  }
  return next;
}

// ── Scoreboard tile ────────────────────────────────────────────────────────────
function NlScoreboardTile({
  partyId, seats, pct, rawVotes, isLeader, isWinner, is2026, dark: _dark,
}: {
  partyId: NlPartyId;
  seats: number;
  pct: number;
  rawVotes?: number;
  isLeader: boolean;
  isWinner: boolean;
  is2026?: boolean;
  dark?: boolean;
}) {
  const party = NL_PARTY_MAP[partyId];
  const leaderName  = (is2026 && party.leader2026)   ? party.leader2026   : party.leader;
  const leaderWiki  = (is2026 && party.wikiTitle2026) ? party.wikiTitle2026 : party.wikiTitle;

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!leaderWiki) { setPhotoUrl(null); return; }
    let cancelled = false;
    fetchWikiPhoto(leaderWiki).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [leaderWiki]);

  const initials = leaderName.split(' ').map((w: string) => w[0]).join('').slice(0, 2);
  const color = partyColor(partyId);
  const colorAlpha = hexToRgba(color, 0.13);

  return (
    <div
      className={`cand-col${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`}
      style={{
        '--cand-color': color, '--cand-color-alpha': colorAlpha,
        borderColor: (isLeader || isWinner) ? color : hexToRgba(color, 0.30),
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
      </div>
      <span className="cand-leader-name" title={leaderName}>{leaderName.split(' ').pop()}</span>
      <span className="cand-party-abbrev">{party.name}</span>
      <span className="cand-seats">{seats}</span>
      <span className="cand-party-name" title={party.fullName}>{party.fullName}</span>

      <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1 }}>
        <span style={{ fontSize: 6.5, fontFamily: '"JetBrains Mono",monospace', fontWeight: 600, color: hexToRgba(color, 0.48), letterSpacing: '0.10em', textTransform: 'uppercase' }}>VOTES</span>
        <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color }}>{pct.toFixed(1)}%</span>
      </div>
      {rawVotes != null && (
        <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
          <span className="cand-votes-full" style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: hexToRgba(color, 0.65) }}>
            {rawVotes.toLocaleString()}
          </span>
          <span className="cand-votes-compact" style={{ fontSize: 8.5, fontFamily: '"JetBrains Mono",monospace', color: hexToRgba(color, 0.65) }}>
            {fmtN(rawVotes)}
          </span>
        </div>
      )}

      <div className="cand-bar-track" style={{ width: '100%', height: 3, borderRadius: 2, background: 'var(--bar-track)' }}>
        <div className="cand-bar-fill" style={{ height: '100%', borderRadius: 2, background: color, width: `${Math.min(pct / 25 * 100, 100)}%`, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

// ── Scoreboard ─────────────────────────────────────────────────────────────────
function NlScoreboard({ natPcts, simSeats, isBaseline, is2026, dark }: {
  natPcts: Record<NlPartyId, number>;
  simSeats?: Partial<Record<NlPartyId, number>>;
  isBaseline?: boolean;
  is2026?: boolean;
  dark?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const seats = useMemo(
    () => simSeats ?? calcDHondt(natPcts),
    [simSeats, natPcts],
  );

  const pctTotal = Object.values(natPcts).reduce((s, v) => s + (v ?? 0), 0);

  const sorted = useMemo(
    () => NL_PARTIES
      .filter(p => (seats[p.id] ?? 0) > 0 || (natPcts[p.id] ?? 0) > 0)
      .sort((a, b) => (seats[b.id] ?? 0) - (seats[a.id] ?? 0) || (natPcts[b.id] ?? 0) - (natPcts[a.id] ?? 0)),
    [seats, natPcts],
  );

  const leader = sorted[0]?.id ?? null;
  const winner = leader && (seats[leader] ?? 0) >= NL_MAJORITY ? leader : null;

  // Others = votes not captured by any tracked party
  const otherPct      = Math.max(0, 100 - pctTotal);
  const otherRawVotes = isBaseline
    ? NL_GRAND_TOTAL_VOTES - NL_PARTIES.reduce((s, p) => s + (NL_VOTE_RAW_2025[p.id] ?? 0), 0)
    : Math.round(otherPct / 100 * NL_GRAND_TOTAL_VOTES);

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {sorted.map(party => {
            const s = seats[party.id] ?? 0;
            const pct = pctTotal > 0 ? (natPcts[party.id] ?? 0) / pctTotal * 100 : 0;
            const rawVotes = isBaseline
              ? NL_VOTE_RAW_2025[party.id]
              : Math.round((natPcts[party.id] ?? 0) / 100 * NL_GRAND_TOTAL_VOTES);
            return (
              <NlScoreboardTile
                key={party.id}
                partyId={party.id}
                seats={s}
                pct={pct}
                rawVotes={rawVotes}
                isLeader={party.id === leader && !winner}
                isWinner={party.id === winner}
                is2026={is2026}
                dark={dark}
              />
            );
          })}
          {/* Others tile — all non-tracked parties combined */}
          {otherPct >= 0.05 && (
            <div className="cand-col" style={{
              '--cand-color': '#888888', '--cand-color-alpha': 'rgba(136,136,136,0.13)',
              borderColor: 'rgba(136,136,136,0.22)', opacity: 0.65,
            } as React.CSSProperties}>
              <div style={{ position:'relative' }}>
                <div className="cand-circle-frame" style={{ background:'rgba(136,136,136,0.12)', border:'1.5px solid rgba(136,136,136,0.25)' }}>
                  <span className="cand-initials" style={{ color:'#888', fontSize:13 }}>···</span>
                </div>
              </div>
              <span className="cand-leader-name" style={{ color:'#999' }}>Minor</span>
              <span className="cand-party-abbrev" style={{ color:'#888' }}>Others</span>
              <span className="cand-seats" style={{ color:'#999' }}>—</span>
              <span className="cand-party-name" style={{ color:'#888' }}>All other parties (sub-threshold + untracked)</span>
              <div style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:1 }}>
                <span style={{ fontSize:6.5, fontFamily:'"JetBrains Mono",monospace', fontWeight:600, color:'rgba(136,136,136,0.48)', letterSpacing:'0.10em', textTransform:'uppercase' }}>VOTES</span>
                <span style={{ fontSize:11, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color:'#888' }}>{otherPct.toFixed(1)}%</span>
              </div>
              <div style={{ width:'100%', display:'flex', justifyContent:'flex-end', marginBottom:2 }}>
                <span className="cand-votes-full" style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', color:'rgba(136,136,136,0.65)' }}>{otherRawVotes.toLocaleString()}</span>
                <span className="cand-votes-compact" style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', color:'rgba(136,136,136,0.65)' }}>{fmtN(otherRawVotes)}</span>
              </div>
              <div className="cand-bar-track" style={{ width:'100%', height:3, borderRadius:2, background:'var(--bar-track)' }}>
                <div className="cand-bar-fill" style={{ height:'100%', borderRadius:2, background:'#888', width:`${Math.min(otherPct/25*100,100)}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Map controller (invalidates size on container resize) ──────────────────────
function MapController({ layerRef }: { layerRef: React.MutableRefObject<L.GeoJSON | null> }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);

  useEffect(() => {
    const h = () => {
      layerRef.current?.eachLayer((l: L.Layer) => {
        const p = l as any;
        if (p.options) p.options.smoothFactor = 0;
      });
    };
    map.on('zoomend', h);
    return () => { map.off('zoomend', h); };
  }, [map, layerRef]);

  return null;
}

// ── Bubble overlay ─────────────────────────────────────────────────────────────
type BubbleEntry = { marker: L.CircleMarker; baseRadius: number };

function zoomScale(zoom: number): number {
  return Math.max(0.15, Math.min(2.0, (zoom - 5) / (9 - 5)));
}

function NlBubbleLayer({
  geoData, natPcts, containerRef, setTooltip, onSelect, natPctsRef, declaredProvs,
  provOverrides, provOverridesRef, blankMode, projectedProvs,
}: {
  geoData: any;
  natPcts: Record<NlPartyId, number>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setTooltip: (t: ProvTooltipState) => void;
  onSelect: (id: NlProvId) => void;
  natPctsRef: React.MutableRefObject<Record<NlPartyId, number>>;
  declaredProvs?: Set<NlProvId>;
  provOverrides?: Partial<Record<NlProvId, Partial<Record<NlPartyId, number>>>>;
  provOverridesRef: React.MutableRefObject<Partial<Record<NlProvId, Partial<Record<NlPartyId, number>>>>>;
  blankMode?: boolean;
  projectedProvs?: Set<NlProvId>;
}) {
  const map = useMap();
  const bubblesRef = useRef<BubbleEntry[]>([]);

  useEffect(() => {
    const onZoom = () => {
      const scale = zoomScale(map.getZoom());
      for (const { marker, baseRadius } of bubblesRef.current) marker.setRadius(baseRadius * scale);
    };
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, [map]);

  useEffect(() => {
    for (const { marker } of bubblesRef.current) marker.remove();
    bubblesRef.current = [];
    const scale = zoomScale(map.getZoom());

    L.geoJSON(geoData).eachLayer((layer: L.Layer) => {
      const path = layer as any;
      const statnaam: string = path.feature?.properties?.statnaam ?? '';
      const provId = NL_STATNAAM_TO_ID[statnaam];
      if (!provId) return;
      if (declaredProvs && !declaredProvs.has(provId)) return;
      if (blankMode && !(projectedProvs?.has(provId))) return;
      const bounds = (layer as any).getBounds?.();
      if (!bounds?.isValid()) return;
      const center = bounds.getCenter();

      const pv = calcProvVotes(natPcts, provId, provOverrides?.[provId]);
      const sorted = (Object.entries(pv) as [NlPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      if (sorted.length === 0) return;
      const [winId, winPct] = sorted[0];
      const runnerUp = sorted[1]?.[1] ?? 0;
      const margin = winPct - runnerUp;
      const baseRadius = 14 + Math.min(margin / 10, 1) * 24;
      const color = partyColor(winId);

      const marker = L.circleMarker(center, {
        radius: baseRadius * scale, color, fillColor: color, fillOpacity: 0.72, weight: 1, opacity: 0.9,
      }).addTo(map);

      marker.on('click', () => { setTooltip(null); onSelect(provId); });

      marker.on('mousemove', (e: L.LeafletMouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cur = calcProvVotes(natPctsRef.current, provId, provOverridesRef.current?.[provId]);
        const parties = (Object.entries(cur) as [NlPartyId, number][])
          .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 6)
          .map(([id, pct]) => ({ id, pct }));
        const leader = parties[0]?.id ?? null;
        setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name: statnaam, parties, leader });
      });

      marker.on('mouseout', () => setTooltip(null));
      bubblesRef.current.push({ marker, baseRadius });
    });

    return () => { for (const { marker } of bubblesRef.current) marker.remove(); bubblesRef.current = []; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geoData, natPcts, blankMode, projectedProvs]);

  return null;
}

// ── Caribbean Netherlands dot ─────────────────────────────────────────────────
const NL_OVERSEAS_MARKERS = [
  { id: 'BES' as NlProvId, name: 'Caribbean Netherlands', lat: 12.18, lng: -68.27 },
];

function NlOverseasLayer({
  natPcts, containerRef, setTooltip, onSelect, natPctsRef, provOverrides, provOverridesRef,
  blankMode, projectedProvs,
}: {
  natPcts: Record<NlPartyId, number>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setTooltip: (t: ProvTooltipState) => void;
  onSelect: (id: NlProvId) => void;
  natPctsRef: React.MutableRefObject<Record<NlPartyId, number>>;
  provOverrides?: Partial<Record<NlProvId, Partial<Record<NlPartyId, number>>>>;
  provOverridesRef: React.MutableRefObject<Partial<Record<NlProvId, Partial<Record<NlPartyId, number>>>>>;
  blankMode?: boolean;
  projectedProvs?: Set<NlProvId>;
}) {
  const map = useMap();

  useEffect(() => {
    const markers: L.CircleMarker[] = [];
    for (const ov of NL_OVERSEAS_MARKERS) {
      if (blankMode && !(projectedProvs?.has(ov.id))) continue;
      const pv = calcProvVotes(natPcts, ov.id, provOverrides?.[ov.id]);
      const sorted = (Object.entries(pv) as [NlPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      const [winId] = sorted[0] ?? [];
      const color = winId ? partyColor(winId) : '#888';

      const marker = L.circleMarker([ov.lat, ov.lng], {
        radius: 16, color, fillColor: color, fillOpacity: 0.78, weight: 2.5, opacity: 1,
      }).addTo(map);

      marker.on('click', () => { setTooltip(null); onSelect(ov.id); });
      marker.on('mousemove', (e: L.LeafletMouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cur = calcProvVotes(natPctsRef.current, ov.id, provOverridesRef.current?.[ov.id]);
        const parties = (Object.entries(cur) as [NlPartyId, number][])
          .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 6)
          .map(([id, pct]) => ({ id, pct }));
        setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name: ov.name, parties, leader: parties[0]?.id ?? null });
      });
      marker.on('mouseout', () => setTooltip(null));
      markers.push(marker);
    }
    return () => { for (const m of markers) m.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, natPcts, provOverrides, blankMode, projectedProvs]);

  return null;
}

// ── Map view ───────────────────────────────────────────────────────────────────
function NlMapView({
  natPcts, selectedProv, onSelect, dark, bubbleMap, declaredProvs, provOverrides, blankMode, projectedProvs,
}: {
  natPcts: Record<NlPartyId, number>;
  selectedProv: NlProvId | null;
  onSelect: (id: NlProvId) => void;
  dark: boolean;
  bubbleMap: boolean;
  declaredProvs?: Set<NlProvId>;
  provOverrides?: Partial<Record<NlProvId, Partial<Record<NlPartyId, number>>>>;
  blankMode?: boolean;
  projectedProvs?: Set<NlProvId>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef     = useRef<L.GeoJSON | null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltip, setTooltip] = useState<ProvTooltipState>(null);

  const natPctsRef         = useRef(natPcts);
  const selectedRef        = useRef(selectedProv);
  const darkRef            = useRef(dark);
  const bubbleRef          = useRef(bubbleMap);
  const onSelectRef        = useRef(onSelect);
  const declaredProvsRef   = useRef(declaredProvs);
  const provOverridesRef   = useRef(provOverrides ?? {});
  const blankModeRef       = useRef(blankMode ?? false);
  const projectedProvsRef  = useRef(projectedProvs ?? new Set<NlProvId>());
  useEffect(() => { natPctsRef.current        = natPcts;              }, [natPcts]);
  useEffect(() => { selectedRef.current       = selectedProv;         }, [selectedProv]);
  useEffect(() => { darkRef.current           = dark;                 }, [dark]);
  useEffect(() => { bubbleRef.current         = bubbleMap;            }, [bubbleMap]);
  useEffect(() => { onSelectRef.current       = onSelect;             }, [onSelect]);
  useEffect(() => { declaredProvsRef.current  = declaredProvs;        }, [declaredProvs]);
  useEffect(() => { provOverridesRef.current  = provOverrides ?? {};  }, [provOverrides]);
  useEffect(() => { blankModeRef.current      = blankMode ?? false;   }, [blankMode]);
  useEffect(() => { projectedProvsRef.current = projectedProvs ?? new Set(); }, [projectedProvs]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}netherlands-provinces.geojson`)
      .then(r => r.json()).then(setGeoData).catch(console.error);
  }, []);

  const getStyle = useCallback((feature: any): L.PathOptions => {
    const statnaam: string = feature?.properties?.statnaam ?? '';
    const provId = NL_STATNAAM_TO_ID[statnaam];
    const isSelected = provId === selectedRef.current;
    const borderColor = darkRef.current ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)';

    if (bubbleRef.current) {
      return {
        fillOpacity: 0, weight: 0.4,
        color: darkRef.current ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)', opacity: 0.6,
      };
    }
    if (!provId) return { fillColor: darkRef.current ? '#374151' : '#E5E7EB', fillOpacity: 0.5, weight: 0.4, color: borderColor, opacity: 1 };

    // Blank mode: only color provinces that have been overridden
    if (blankModeRef.current) {
      const hasOverride = !!provOverridesRef.current[provId] && Object.keys(provOverridesRef.current[provId]!).length > 0;
      if (!hasOverride) return { fillColor: darkRef.current ? '#1f2937' : '#d1d5db', fillOpacity: 0.7, weight: isSelected ? 2 : 0.4, color: isSelected ? '#c8a020' : borderColor, opacity: 1 };
    }

    const isDeclared = !declaredProvsRef.current || declaredProvsRef.current.has(provId);
    if (!isDeclared) return { fillColor: darkRef.current ? '#1f2937' : '#d1d5db', fillOpacity: 0.7, weight: 0.4, color: borderColor, opacity: 1 };

    const fill = getProvFill(natPctsRef.current, provId, darkRef.current, provOverridesRef.current?.[provId]);
    return {
      fillColor: fill, fillOpacity: 0.78,
      weight: isSelected ? 2 : 0.4,
      color: isSelected ? '#c8a020' : borderColor,
      opacity: 1,
    };
  }, []);

  useEffect(() => {
    layerRef.current?.setStyle((f: any) => getStyle(f));
  }, [natPcts, selectedProv, dark, bubbleMap, declaredProvs, provOverrides, blankMode, projectedProvs, getStyle]);

  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const statnaam: string = feature?.properties?.statnaam ?? '';
    const provId = NL_STATNAAM_TO_ID[statnaam];

    layer.on('click', () => { if (provId) onSelectRef.current(provId); });

    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleRef.current || !provId) { setTooltip(null); return; }
      if (blankModeRef.current) {
        const hasOverride = !!provOverridesRef.current[provId] && Object.keys(provOverridesRef.current[provId]!).length > 0;
        if (!hasOverride) { setTooltip(null); return; }
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pv = calcProvVotes(natPctsRef.current, provId, provOverridesRef.current?.[provId]);
      const parties = (Object.entries(pv) as [NlPartyId, number][])
        .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 6)
        .map(([id, pct]) => ({ id, pct }));
      const leader = parties[0]?.id ?? null;
      setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name: statnaam, parties, leader });
    });

    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer
        center={[52.3, 5.3]} zoom={7}
        style={{ width: '100%', height: '100%' }}
        zoomControl worldCopyJump={false}
      >
        <TileLayer
          key={dark ? 'dark' : 'light'}
          url={dark
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
          attribution='&copy; OpenStreetMap &copy; CARTO'
          subdomains="abcd" updateWhenZooming={false} updateWhenIdle={true} maxZoom={20}
        />
        <MapController layerRef={layerRef} />
        {geoData && (
          <GeoJSON
            ref={layerRef as any}
            data={geoData}
            style={(f: any) => getStyle(f)}
            onEachFeature={onEachFeature}
            {...({ smoothFactor: 0 } as any)}
          />
        )}
        {geoData && bubbleMap && (
          <NlBubbleLayer
            geoData={geoData}
            natPcts={natPcts}
            containerRef={containerRef}
            setTooltip={setTooltip}
            onSelect={onSelect}
            natPctsRef={natPctsRef}
            declaredProvs={declaredProvs}
            provOverrides={provOverrides}
            provOverridesRef={provOverridesRef}
            blankMode={blankMode}
            projectedProvs={projectedProvs}
          />
        )}
        <NlOverseasLayer
          natPcts={natPcts}
          containerRef={containerRef}
          setTooltip={setTooltip}
          onSelect={onSelect}
          natPctsRef={natPctsRef}
          provOverrides={provOverrides}
          provOverridesRef={provOverridesRef}
          blankMode={blankMode}
          projectedProvs={projectedProvs}
        />
      </MapContainer>

      {tooltip && (() => {
        const cw = containerRef.current?.clientWidth ?? 9999;
        const TW = 220;
        const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const tt = {
          bg: dark ? 'rgba(18,24,44,0.96)' : 'rgba(255,255,255,0.97)',
          border: dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)',
          shadow: dark ? '0 6px 28px rgba(0,0,0,0.5)' : '0 6px 28px rgba(0,0,0,0.12)',
          title: dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)',
          sub: dark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.42)',
          body: dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.78)',
          muted: dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.40)',
        };
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top: Math.max(6, tooltip.y - 20), width: TW }}>
            <div style={{ background: tt.bg, borderRadius: 10, border: `1px solid ${tt.border}`, boxShadow: tt.shadow, backdropFilter: 'blur(10px)', padding: '12px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: tt.title, lineHeight: 1.2 }}>{tooltip.name}</div>
              <div style={{ fontSize: 9, fontFamily: '"JetBrains Mono",monospace', color: tt.sub, marginTop: 2 }}>Estimated province result</div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tooltip.parties.map(({ id, pct }, i) => {
                  const p = NL_PARTY_MAP[id];
                  const pColor = partyColor(id);
                  return (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: pColor }} />
                      <span style={{ flex: 1, fontSize: 11, fontWeight: i === 0 ? 600 : 400, color: tt.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.name ?? id}</span>
                      <span style={{ fontSize: 12, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: pColor }}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      <div className="absolute bottom-2 right-2 text-[10px] text-ink-3 select-none z-[1000] font-mono">
        Scroll to zoom · Click to open
      </div>
    </div>
  );
}

// ── Political order (left → right) for hemicycle ──────────────────────────────
const NL_LR_ORDER: NlPartyId[] = [
  'SP', 'GLPVDA', 'PVDD', 'DENK', 'D66', 'VOLT', 'CU', 'CDA', 'VVD', 'BBB', 'PLUS50', 'SGP', 'JA21', 'FVD', 'PVV', 'DNA',
];

// ── Coalition builder presets ──────────────────────────────────────────────────
const NL_PRESET_COALITIONS: { name: string; emoji: string; parties: NlPartyId[] }[] = [
  { name: 'Schoof Cabinet',   emoji: '🇳🇱', parties: ['PVV','VVD','CDA','JA21'] },
  { name: 'Progressive Bloc', emoji: '🌹',  parties: ['D66','GLPVDA','SP','PVDD','CU','VOLT'] },
  { name: 'Broad Coalition',  emoji: '🤝',  parties: ['D66','VVD','GLPVDA','CDA'] },
  { name: 'Right Bloc',       emoji: '⚡',  parties: ['PVV','VVD','JA21','FVD','BBB'] },
];

// ── Parties visibility panel ───────────────────────────────────────────────────
function NlPartiesPanel({ hiddenParties, onToggle, onClose, dark }: {
  hiddenParties: Set<NlPartyId>;
  onToggle: (id: NlPartyId) => void;
  onClose: () => void;
  dark?: boolean;
}) {
  const allHidden = NL_LR_ORDER.every(id => hiddenParties.has(id));
  return (
    <aside className={`w-56 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-bold text-ink leading-none">Parties</h2>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Show in sliders</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 thin-scroll">
        {NL_LR_ORDER.map(id => {
          const party = NL_PARTY_MAP[id];
          const hidden = hiddenParties.has(id);
          return (
            <button key={id} onClick={() => onToggle(id)}
              className={`w-full flex items-center gap-2 px-3.5 py-1.5 text-left transition-colors hover:bg-hover ${hidden ? 'opacity-40' : ''}`}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: party.color }} />
              <span className="text-[10.5px] font-medium text-ink flex-1 truncate">{party.name}</span>
              <span className={`w-3.5 h-3.5 rounded-sm flex items-center justify-center shrink-0 ${hidden ? 'border border-default' : ''}`}
                style={hidden ? {} : { background: party.color }}>
                {!hidden && (
                  <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                    <path d="M1 3l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="px-3.5 pb-3 pt-2 border-t border-default shrink-0 space-y-1.5">
        <button
          onClick={() => {
            if (allHidden) { for (const id of NL_LR_ORDER) if (hiddenParties.has(id)) onToggle(id); }
            else { for (const id of NL_LR_ORDER) if (!hiddenParties.has(id)) onToggle(id); }
          }}
          className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors"
        >
          {allHidden ? 'Show All' : 'Hide All'}
        </button>
      </div>
    </aside>
  );
}

// ── Province breakdown panel ────────────────────────────────────────────────────
function NlProvPanel({ provId, natPcts, provOverride, onOverride, onResetOverride, onClose,
  isBlankMode, isProjected, reportingPct, onProject, onReportingPctChange, hiddenParties, dark }: {
  provId: NlProvId;
  natPcts: Record<NlPartyId, number>;
  provOverride?: Partial<Record<NlPartyId, number>>;
  onOverride: (pcts: Partial<Record<NlPartyId, number>>) => void;
  onResetOverride: () => void;
  onClose: () => void;
  isBlankMode?: boolean;
  isProjected?: boolean;
  reportingPct?: number;
  onProject?: () => void;
  onReportingPctChange?: (pct: number) => void;
  hiddenParties?: Set<NlPartyId>;
  dark?: boolean;
}) {
  const [locks, setLocks] = useState<Set<NlPartyId>>(new Set());
  useEffect(() => { setLocks(new Set()); }, [provId]);

  const pv = useMemo(() => calcProvVotes(natPcts, provId, provOverride), [natPcts, provId, provOverride]);

  // Stable sort: capture initial order once per provId mount (key={provId} on parent ensures remount)
  const [sortedIds] = useState<NlPartyId[]>(() => {
    const initPv = calcProvVotes(natPcts, provId, provOverride);
    return NL_PARTIES.map(p => p.id).sort((a, b) => (initPv[b] ?? 0) - (initPv[a] ?? 0));
  });

  // Hidden parties are treated as locked for redistribution purposes
  const effectiveLocks = useMemo(
    () => new Set<NlPartyId>([...locks, ...(hiddenParties ?? [])]),
    [locks, hiddenParties],
  );
  const prov = NL_PROVINCES.find(p => p.id === provId);
  // Live winner (highest current %) — separate from stable sort order
  const winner = [...NL_PARTIES].sort((a, b) => (pv[b.id] ?? 0) - (pv[a.id] ?? 0))[0];
  const hasOverride = !!provOverride && Object.keys(provOverride).length > 0;

  return (
    <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold text-ink leading-tight truncate">{prov?.name ?? provId}</h2>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {hasOverride ? 'Custom override · drag sliders' : 'Estimated · drag sliders to adjust'}
            </p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        {winner && (
          <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-[4px] border border-default" style={{ borderColor: `${winner.color}33`, background: dark ? 'rgba(255,255,255,0.04)' : '#f8f7f4' }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: winner.color }} />
            <span className="text-[11px] font-medium text-ink flex-1 truncate">{winner.fullName}</span>
            <span className="text-[9px] font-mono text-ink-3">{(pv[winner.id] ?? 0).toFixed(1)}%</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-2.5">
        {sortedIds
          .filter(id => !hiddenParties?.has(id) && (isBlankMode || (pv[id] ?? 0) >= 0.1 || locks.has(id)))
          .map(id => {
            const p = NL_PARTY_MAP[id];
            const pct = pv[id] ?? 0;
            const isLocked = locks.has(id);
            const color = p.color;
            return (
              <div key={id}>
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{p.fullName}</span>
                  <button
                    onClick={() => setLocks(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })}
                    className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked ? 'text-gold' : 'text-ink-3 hover:text-ink'}`}
                    title={isLocked ? 'Unlock' : 'Lock'}
                  >
                    {isLocked
                      ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                      : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                    }
                  </button>
                  <input
                    type="number" min={0} max={70} step={0.1}
                    value={pct.toFixed(1)}
                    disabled={isLocked}
                    onChange={e => {
                      const v = Math.max(0, Math.min(70, parseFloat(e.target.value) || 0));
                      onOverride(redistributePcts(pv, id, v, effectiveLocks));
                    }}
                    onFocus={e => e.target.select()}
                    className="text-[10px] font-mono font-semibold tabular-nums w-10 text-right bg-transparent border-b border-transparent focus:border-current outline-none disabled:opacity-40"
                    style={{ color }}
                  />
                </div>
                <input
                  type="range" min={0} max={70} step={0.1} value={pct} disabled={isLocked}
                  onChange={e => {
                    onOverride(redistributePcts(pv, id, parseFloat(e.target.value), effectiveLocks));
                  }}
                  className="br-party-slider w-full"
                  style={{ '--party-color': color, '--pct': `${(pct / 70) * 100}%` } as React.CSSProperties}
                />
              </div>
            );
          })}
      </div>

      {hasOverride && !isBlankMode && (
        <div className="px-3.5 py-2.5 border-t border-default shrink-0">
          <button
            onClick={onResetOverride}
            className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors"
          >
            Reset to calculated
          </button>
        </div>
      )}

      {isBlankMode && (
        <div className="px-3.5 py-2.5 border-t border-default shrink-0 space-y-2">
          <button
            onClick={onProject}
            className={`w-full h-8 rounded-[4px] text-[11px] font-mono font-semibold uppercase tracking-wide transition-colors ${
              isProjected
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {isProjected ? '✓ Update Projection' : '📍 Project Result'}
          </button>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-mono font-bold uppercase tracking-[0.13em] text-ink-3">% Reporting</span>
              <span className="text-[10px] font-mono font-semibold tabular-nums" style={{ color: isProjected ? '#16a34a' : undefined }}>
                {reportingPct ?? 100}%
              </span>
            </div>
            <input
              type="range" min={0} max={100} step={1} value={reportingPct ?? 100}
              onChange={e => onReportingPctChange?.(parseInt(e.target.value))}
              className="br-party-slider w-full"
              style={{ '--party-color': '#6b7280', '--pct': `${reportingPct ?? 100}%` } as React.CSSProperties}
            />
          </div>
          {hasOverride && (
            <button
              onClick={onResetOverride}
              className="w-full h-6 rounded-[4px] border border-default text-ink-3 text-[9px] font-mono uppercase tracking-wide hover:bg-hover transition-colors"
            >
              Clear sliders
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

// ── Parliament hemicycle panel ──────────────────────────────────────────────────
function NlParliamentPanel({ seats: seatsMap, onClose, exiting, dark }: {
  seats: Partial<Record<NlPartyId, number>>;
  onClose: () => void;
  exiting?: boolean;
  dark?: boolean;
}) {
  const seatColors: string[] = [];
  const legend: { id: NlPartyId; count: number; color: string }[] = [];
  for (const id of NL_LR_ORDER) {
    const n = seatsMap[id] ?? 0;
    if (n === 0) continue;
    const color = partyColor(id);
    legend.push({ id, count: n, color });
    for (let i = 0; i < n; i++) seatColors.push(color);
  }
  const totalSeats = seatColors.length;

  const W = 310, H = 178, cx = W / 2, cy = H - 5;
  const innerR = 52, rowSpacing = 9, rows = 6;
  const arcLengths = Array.from({ length: rows }, (_, i) => Math.PI * (innerR + i * rowSpacing));
  const totalArc = arcLengths.reduce((s, v) => s + v, 0);
  const floors = arcLengths.map(a => Math.floor((a / totalArc) * NL_TOTAL_SEATS));
  const remainder = NL_TOTAL_SEATS - floors.reduce((s, v) => s + v, 0);
  arcLengths.map((a, i) => ({ i, frac: (a / totalArc) * NL_TOTAL_SEATS - floors[i] }))
    .sort((a, b) => b.frac - a.frac).slice(0, remainder).forEach(({ i }) => floors[i]++);

  const rawPos: { x: number; y: number; θ: number; r: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const r = innerR + row * rowSpacing;
    const n = floors[row];
    for (let j = 0; j < n; j++) {
      const θ = Math.PI * (n - j - 0.5) / n;
      rawPos.push({ x: cx + r * Math.cos(θ), y: cy - r * Math.sin(θ), θ, r });
    }
  }
  rawPos.sort((a, b) => b.θ - a.θ || a.r - b.r);

  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-r border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit-left' : 'panel-slide-left'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">House of Representatives Hemicycle</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">{totalSeats} seats · majority {NL_MAJORITY}</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll">
        {totalSeats === 0 ? (
          <div className="flex items-center justify-center h-40 text-ink-3 text-[11px] font-mono px-4 text-center">Load results or run simulation first</div>
        ) : (
          <>
            <div className="px-2.5 pt-5 pb-1">
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
                <line x1={cx} y1={cy - innerR + 4} x2={cx} y2={cy - (innerR + (rows-1)*rowSpacing) - 8}
                  stroke="rgba(0,0,0,0.10)" strokeWidth="1" strokeDasharray="3,3" />
                {rawPos.map(({ x, y }, i) => (
                  <circle key={i} cx={x} cy={y} r={2.8}
                    fill={i < seatColors.length ? seatColors[i] : (dark ? '#374151' : '#e5e7eb')} />
                ))}
              </svg>
            </div>
            <div className="px-3.5 pb-4">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {legend.map(({ id, count, color }) => (
                  <div key={id} className="flex items-center gap-1.5">
                    <div style={{ width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0 }} />
                    <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">{NL_PARTY_MAP[id].name}</span>
                    <span className="text-[9.5px] font-mono font-bold text-ink">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

// ── Coalition builder panel ────────────────────────────────────────────────────
function NlCoalitionPanel({ seats, onClose, exiting, dark }: { seats: Partial<Record<NlPartyId, number>>; onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const [selected, setSelected] = useState<Set<NlPartyId>>(new Set(['PVV','VVD','CDA','JA21']));
  const toggle = (id: NlPartyId) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const totalCoalSeats = [...selected].reduce((s, id) => s + (seats[id] ?? 0), 0);
  const hasMajority = totalCoalSeats >= NL_MAJORITY;
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Coalition Builder</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Majority: {NL_MAJORITY} seats · {NL_TOTAL_SEATS} total</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      {/* Presets */}
      <div className="px-3.5 pt-3 pb-2 border-b border-default shrink-0">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {NL_PRESET_COALITIONS.map(coal => (
            <button key={coal.name} onClick={() => setSelected(new Set(coal.parties))}
              className="text-left px-2 py-1.5 rounded-[4px] border border-default hover:bg-hover transition-colors">
              <div className="text-[8px] font-bold text-ink truncate">{coal.emoji} {coal.name}</div>
              <div className="text-[7px] font-mono text-ink-3">{coal.parties.map(id => NL_PARTY_MAP[id]?.name).join(' + ')}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Party toggles */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Toggle Parties</div>
        <div className="space-y-1.5">
          {NL_LR_ORDER.map(id => {
            const party = NL_PARTY_MAP[id]; const s = seats[id] ?? 0;
            const isIn = selected.has(id); const color = partyColor(id);
            return (
              <button key={id} onClick={() => toggle(id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-[4px] border transition-colors ${isIn ? 'border-transparent' : 'border-default hover:bg-hover'}`}
                style={isIn ? { background: hexToRgba(color, 0.12), borderColor: hexToRgba(color, 0.40) } : {}}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="flex-1 text-[10px] font-medium text-ink truncate text-left">{party.fullName}</span>
                <span className="text-[9px] font-mono font-bold" style={{ color }}>{s}s</span>
                {isIn && <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M2 4.5l1.8 1.8L7 2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/></svg>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Coalition total */}
      <div className={`px-3.5 py-3 border-t border-default shrink-0 ${hasMajority ? 'bg-emerald-500/10' : ''}`}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono font-bold text-ink">Coalition total</span>
          <span className="text-[20px] font-black font-mono" style={{ color: hasMajority ? '#16a34a' : '#ef4444' }}>{totalCoalSeats}</span>
        </div>
        <div className="mt-1 h-2 rounded-full bg-black/8 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300" style={{ width:`${Math.min(totalCoalSeats/NL_TOTAL_SEATS*100, 100)}%`, background: hasMajority ? '#16a34a' : '#ef4444' }} />
        </div>
        <div className={`mt-1.5 text-[9px] font-mono text-center font-bold ${hasMajority ? 'text-emerald-600' : 'text-red-500'}`}>
          {hasMajority ? `✓ MAJORITY (need ${NL_MAJORITY})` : `✗ ${NL_MAJORITY - totalCoalSeats} seats short of majority`}
        </div>
      </div>
    </aside>
  );
}

// ── Tutorial panel ──────────────────────────────────────────────────────────────
function NlTutorialPanel({ onClose, exiting, dark }: { onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const H2 = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-5 mb-1.5 first:mt-0">{children}</div>
  );
  const P = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[11px] text-ink leading-relaxed mb-2">{children}</p>
  );
  const Note = ({ children }: { children: React.ReactNode }) => (
    <div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{children}</div>
  );
  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">House of Representatives Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2>The Dutch Electoral System</H2>
        <P>The Netherlands uses <strong>Party-List Proportional Representation</strong>. The entire country is one constituency — voters cast a single vote for a party list.</P>
        <Note>All 150 seats in the House of Representatives (lower house) are allocated using the <strong>D'Hondt method</strong>.</Note>

        <H2>D'Hondt Explained</H2>
        <P>The D'Hondt method divides each party's votes by 1, 2, 3, … The 150 highest quotients each win a seat.</P>
        <P>Example: if Party A has 30% and Party B has 15%, Party A gets roughly twice as many seats — but not exactly proportional due to rounding and which divisors win.</P>
        <Note>The <strong>kiesdeler</strong> (electoral quota) is total votes ÷ 150. A party needs roughly one kiesdeler (~0.67%) to win a seat. There is no formal threshold.</Note>

        <H2>Provinces on the Map</H2>
        <P>The 12 provinces are shown for geographic context only — seats are allocated nationally, not by province. Province colours show which party would likely lead there based on estimated local vote shares.</P>

        <H2>Simulation</H2>
        <P>Click <strong>▶ Simulation</strong> to open the panel. Use sliders to set your predicted national vote shares, then click <strong>Run Simulation</strong>. Provinces will declare one by one (in random order) with partial seat counts updating live.</P>

        <H2>Parliament</H2>
        <P>Click <strong>Parliament</strong> to open the hemicycle — seats arranged left→right by ideology, coloured by party.</P>
      </div>
    </aside>
  );
}

// ── Canada-style reporting widget ─────────────────────────────────────────────
function NlReportingWidget({ projectedProvs, provReportingPct, simProvFractions, isSim, dark }: {
  projectedProvs: Set<NlProvId>;
  provReportingPct: Partial<Record<NlProvId, number>>;
  simProvFractions: Partial<Record<NlProvId, number>>;
  isSim: boolean;
  dark?: boolean;
}) {
  const bg     = dark ? 'rgba(7,13,28,0.88)' : 'rgba(255,255,255,0.92)';
  const border = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';
  const ink2   = dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.42)';

  let reportedW = 0;
  let projCount = 0;

  if (isSim) {
    for (const [provId, frac] of Object.entries(simProvFractions) as [NlProvId, number][]) {
      reportedW += (NL_PROV_WEIGHTS[provId] ?? 0) * (frac ?? 0);
      if (frac > 0) projCount++;
    }
  } else {
    for (const provId of projectedProvs) {
      const rPct = (provReportingPct[provId] ?? 100) / 100;
      reportedW += (NL_PROV_WEIGHTS[provId] ?? 0) * rPct;
      projCount++;
    }
  }

  const totalProvs = NL_PROVINCES.length;
  const reportedPct = Math.min(100, (reportedW / NL_TOTAL_PROV_WEIGHT) * 100);
  const label = isSim ? 'provinces declared' : 'provinces projected';

  return (
    <div className="absolute bottom-8 left-3 z-[1001] pointer-events-none"
      style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, backdropFilter: 'blur(10px)', padding: '10px 13px', minWidth: 170, boxShadow: '0 4px 20px rgba(0,0,0,0.18)' }}>
      <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.15em] mb-1.5" style={{ color: ink2 }}>
        {isSim ? '⚡ Live Count' : '📊 Results'}
      </div>
      <div className="text-[13px] font-black font-mono text-ink leading-none">
        {projCount} <span className="text-[10px] font-semibold" style={{ color: ink2 }}>/ {totalProvs}</span>
      </div>
      <div className="text-[9px] font-mono mt-0.5 mb-2" style={{ color: ink2 }}>{label}</div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)' }}>
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${reportedPct}%`, background: isSim ? '#3b82f6' : '#16a34a' }} />
      </div>
      <div className="text-[9px] font-mono font-bold mt-1 text-right" style={{ color: isSim ? '#3b82f6' : '#16a34a' }}>
        {reportedPct.toFixed(1)}% of votes
      </div>
    </div>
  );
}

// ── Main app ────────────────────────────────────────────────────────────────────
export default function NetherlandsApp() {
  const navigate = useNavigate();

  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  // ── Election state ──────────────────────────────────────────────────────────
  const [preset, setPreset] = useState<'baseline' | 'blank' | 'polling2026' | 'custom'>('polling2026');
  const [natPcts, setNatPcts] = useState<Record<NlPartyId, number>>(() => ({ ...NL_VOTE_PCT_2026 }));

  function loadBaseline() {
    setNatPcts({ ...NL_VOTE_PCT_2025 });
    setPreset('baseline');
    setSimSeats(undefined);
    setDeclaredProvs(undefined);
    setProvOverrides({});
    setProjectedProvs(new Set());
    setProvReportingPct({});
    setSimProvFractions({});
    stopSim();
  }
  function loadPolling2026() {
    setNatPcts({ ...NL_VOTE_PCT_2026 });
    setPreset('polling2026');
    setSimSeats(undefined);
    setDeclaredProvs(undefined);
    setProvOverrides({});
    setProjectedProvs(new Set());
    setProvReportingPct({});
    setSimProvFractions({});
    stopSim();
  }
  function loadBlank() {
    const equalPct = 100 / NL_PARTIES.length;
    setNatPcts(Object.fromEntries(NL_PARTIES.map(p => [p.id, equalPct])) as Record<NlPartyId, number>);
    setPreset('blank');
    setSimSeats(undefined);
    setDeclaredProvs(undefined);
    setProvOverrides({});
    setProjectedProvs(new Set());
    setProvReportingPct({});
    setSimProvFractions({});
    stopSim();
  }

  // ── Province overrides ──────────────────────────────────────────────────────
  const [provOverrides, setProvOverrides] = useState<Partial<Record<NlProvId, Partial<Record<NlPartyId, number>>>>>({});

  // ── Blank-map projection state ──────────────────────────────────────────────
  const [projectedProvs, setProjectedProvs] = useState<Set<NlProvId>>(new Set());
  const [provReportingPct, setProvReportingPct] = useState<Partial<Record<NlProvId, number>>>({});

  // Weighted-average pcts from projected provinces (used as display pcts in blank mode)
  const blankDisplayPcts = useMemo<Record<NlPartyId, number>>(() => {
    const zero = Object.fromEntries(NL_PARTIES.map(p => [p.id, 0])) as Record<NlPartyId, number>;
    if (preset !== 'blank' || projectedProvs.size === 0) return zero;
    const weighted: Partial<Record<NlPartyId, number>> = {};
    let totalW = 0;
    for (const provId of projectedProvs) {
      const pv = calcProvVotes(natPcts, provId, provOverrides[provId]);
      const rPct = (provReportingPct[provId] ?? 100) / 100;
      const w = (NL_PROV_WEIGHTS[provId] ?? 0) * rPct;
      for (const p of NL_PARTIES) weighted[p.id] = (weighted[p.id] ?? 0) + (pv[p.id] ?? 0) * w;
      totalW += w;
    }
    if (totalW === 0) return zero;
    return Object.fromEntries(NL_PARTIES.map(p => [p.id, (weighted[p.id] ?? 0) / totalW])) as Record<NlPartyId, number>;
  }, [preset, projectedProvs, provOverrides, provReportingPct, natPcts]);

  const displayPcts = preset === 'blank' ? blankDisplayPcts : natPcts;

  const handleProvOverride = useCallback((provId: NlProvId, pcts: Partial<Record<NlPartyId, number>>) => {
    setProvOverrides(prev => ({ ...prev, [provId]: pcts }));
  }, []);

  const handleProvResetOverride = useCallback((provId: NlProvId) => {
    setProvOverrides(prev => { const n = { ...prev }; delete n[provId]; return n; });
  }, []);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [selectedProv, setSelectedProv] = useState<NlProvId | null>(null);
  const [bubbleMap, setBubbleMap] = useState(false);
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [locks, setLocks] = useState<Set<NlPartyId>>(new Set());
  const [hiddenParties, setHiddenParties] = useState<Set<NlPartyId>>(new Set());
  const [simOpen, setSimOpen] = useState(false);
  const [partiesOpen, setPartiesOpen] = useState(false);
  const [parliOpen, setParliOpen] = useState(false);
  const [coalitionOpen, setCoalitionOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [exitPanel, setExitPanel] = useState<string | null>(null);

  // Stable sim-panel sort order: captured when sim panel opens, not recomputed during slider drags
  const [simSortOrder, setSimSortOrder] = useState<NlPartyId[]>(() =>
    [...NL_PARTIES].sort((a, b) => (NL_VOTE_PCT_2026[b.id] ?? 0) - (NL_VOTE_PCT_2026[a.id] ?? 0)).map(p => p.id)
  );
  useEffect(() => {
    if (!simOpen) return;
    setSimSortOrder([...NL_PARTIES].sort((a, b) => (natPcts[b.id] ?? 0) - (natPcts[a.id] ?? 0)).map(p => p.id));
    setSimTouched(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simOpen]); // natPcts intentionally omitted — captures order at panel open only

  const toggleHiddenParty = useCallback((id: NlPartyId) => {
    setHiddenParties(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  // Effective locks for sim panel: hidden parties treated as locked during redistribution
  const simEffectiveLocks = useMemo(
    () => new Set<NlPartyId>([...locks, ...hiddenParties]),
    [locks, hiddenParties],
  );
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  const triggerExit = useCallback((panel: string) => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    setExitPanel(panel);
    exitTimerRef.current = setTimeout(() => setExitPanel(null), 280);
  }, []);

  // ── Simulation state ────────────────────────────────────────────────────────
  const [simSeats, setSimSeats]         = useState<Partial<Record<NlPartyId, number>> | undefined>();
  const [simProgress, setSimProgress]   = useState(0);
  const [simRunning, setSimRunning]     = useState(false);
  const [simTouched, setSimTouched]     = useState(false);
  const [declaredProvs, setDeclaredProvs] = useState<Set<NlProvId> | undefined>();
  const [simProvFractions, setSimProvFractions] = useState<Partial<Record<NlProvId, number>>>({});
  const simTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const natPctsAtSimStart = useRef<Record<NlPartyId, number>>(natPcts);

  function stopSim() {
    simTimersRef.current.forEach(clearTimeout);
    simTimersRef.current = [];
    setSimRunning(false);
  }

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

  const displaySeats = useMemo(
    () => simSeats ?? calcDHondt(displayPcts),
    [simSeats, displayPcts],
  );

  const btnBase   = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold   = `${btnBase} bg-gold text-white hover:bg-gold-deep`;
  const btnMuted  = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive = `${btnBase} bg-ink/8 border border-default text-ink`;

  const showProv      = !!selectedProv && !simOpen && !simRunning;
  const showTutorial  = tutorialOpen || exitPanel === 'tutorial';
  const showParli     = parliOpen || exitPanel === 'parli';
  const showCoalition = coalitionOpen || exitPanel === 'coalition';

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="nl">

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
        </button>

        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={loadBaseline}    className={preset === 'baseline'    ? btnGold : btnMuted}>2025 Baseline</button>
          <button onClick={loadPolling2026} className={preset === 'polling2026' ? btnGold : btnMuted}>2026 Polling</button>
          <button onClick={loadBlank}       className={preset === 'blank'       ? btnGold : btnMuted}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          <button onClick={() => setSimOpen(v => !v)}
            className={simOpen ? btnActive : btnMuted}>▶ Simulation</button>

          <button
            onClick={() => setPartiesOpen(v => !v)}
            className={partiesOpen ? btnActive : btnMuted}>Parties</button>

          <button onClick={() => setScoreboardVisible(v => !v)}
            className={scoreboardVisible ? btnActive : btnMuted}>Scoreboard</button>

          <button
            onClick={() => {
              if (coalitionOpen) { setCoalitionOpen(false); triggerExit('coalition'); }
              else { setCoalitionOpen(true); }
            }}
            className={coalitionOpen ? btnActive : btnMuted}>Coalition</button>

          <button
            onClick={() => {
              if (parliOpen) { setParliOpen(false); triggerExit('parli'); }
              else { setParliOpen(true); }
            }}
            className={parliOpen ? btnActive : btnMuted}>Parliament</button>

          <button onClick={() => setBubbleMap(v => !v)}
            className={bubbleMap ? `${btnBase} bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700` : btnMuted}>Bubble Map</button>

          <button
            onClick={() => {
              if (tutorialOpen) { setTutorialOpen(false); triggerExit('tutorial'); }
              else { setTutorialOpen(true); }
            }}
            className={tutorialOpen ? btnActive : btnMuted}>Tutorial</button>
        </div>

        <div className="shrink-0 flex items-center gap-2 pr-4">
          <button onClick={() => setDark(v => !v)} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:text-ink transition-colors" title="Toggle dark mode">
            {dark ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {/* ── Scoreboard ─────────────────────────────────────────────────────── */}
      {scoreboardVisible && (
        <NlScoreboard natPcts={displayPcts} simSeats={simSeats} isBaseline={preset === 'baseline'} is2026={preset !== 'baseline'} dark={dark} />
      )}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Parties panel — LEFT */}
        {partiesOpen && (
          <NlPartiesPanel
            hiddenParties={hiddenParties}
            onToggle={toggleHiddenParty}
            onClose={() => setPartiesOpen(false)}
            dark={dark}
          />
        )}

        {/* Parliament panel — LEFT */}
        {showParli && (
          <NlParliamentPanel
            seats={displaySeats}
            onClose={() => { setParliOpen(false); triggerExit('parli'); }}
            exiting={exitPanel === 'parli'}
            dark={dark}
          />
        )}

        {/* Map + reporting widget */}
        <div className="relative flex-1 min-w-0 min-h-0">
          <NlMapView
            natPcts={natPcts}
            selectedProv={selectedProv}
            onSelect={p => setSelectedProv(prev => prev === p ? null : p)}
            dark={dark}
            bubbleMap={bubbleMap}
            declaredProvs={declaredProvs}
            provOverrides={provOverrides}
            blankMode={preset === 'blank'}
            projectedProvs={projectedProvs}
          />
          {(preset === 'blank' || simRunning || (simSeats != null)) && (
            <NlReportingWidget
              projectedProvs={projectedProvs}
              provReportingPct={provReportingPct}
              simProvFractions={simProvFractions}
              isSim={simRunning || (simSeats != null && preset !== 'blank')}
              dark={dark}
            />
          )}
        </div>

        {/* Right panels (one at a time: sim > prov > tutorial) */}
        {simOpen && (
          <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2>
                <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">National vote shares · D'Hondt</p>
              </div>
              <button onClick={() => setSimOpen(false)} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base" title="Close panel (simulation continues)">×</button>
            </div>

            <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">
              {simSortOrder.filter(id => !hiddenParties.has(id)).map(id => {
                const party = NL_PARTY_MAP[id];
                const pct = natPcts[id] ?? 0;
                const isLocked = locks.has(id);
                const color = partyColor(id);
                return (
                  <div key={id}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{party.fullName}</span>
                      <button
                        onClick={() => setLocks(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })}
                        className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked ? 'text-gold' : 'text-ink-3 hover:text-ink'}`}
                        title={isLocked ? 'Unlock' : 'Lock'}
                      >
                        {isLocked ? (
                          <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                        ) : (
                          <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                        )}
                      </button>
                      <input
                        type="number" min={0} max={50} step={0.1}
                        value={pct.toFixed(1)}
                        disabled={isLocked}
                        onChange={e => {
                          const v = Math.max(0, Math.min(50, parseFloat(e.target.value) || 0));
                          setNatPcts(redistributePcts(natPcts, id, v, simEffectiveLocks));
                          setPreset('custom');
                          setSimTouched(true);
                        }}
                        onFocus={e => e.target.select()}
                        className="text-[10px] font-mono font-semibold tabular-nums w-10 text-right bg-transparent border-b border-transparent focus:border-ink-3 outline-none disabled:opacity-40"
                        style={{ color }}
                      />
                    </div>
                    <input type="range" min={0} max={50} step={0.1} value={pct} disabled={isLocked}
                      onChange={e => {
                        setNatPcts(redistributePcts(natPcts, id, parseFloat(e.target.value), simEffectiveLocks));
                        setPreset('custom');
                        setSimTouched(true);
                      }}
                      className="br-party-slider w-full"
                      style={{ '--party-color': color, '--pct': `${(pct / 50) * 100}%` } as React.CSSProperties}
                    />
                    <div className="mt-0.5">
                      <span className="text-[8px] font-mono text-ink-3">{party.name}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-3.5 pb-3.5 pt-2 border-t border-default shrink-0 space-y-2">
              <button
                disabled={simRunning || !simTouched}
                onClick={() => {
                  stopSim();
                  setSimTouched(false);
                  natPctsAtSimStart.current = { ...natPcts };
                  // 5-part reporting: 14 provinces × 5 phases = 70 events
                  // Phase k uses time slots [k*14 .. k*14+13] from sorted time array
                  // → all phase-k times < all phase-(k+1) times, preserving order
                  const PARTS = 5;
                  const totalProvs = NL_PROVINCES.length;
                  const times = nlBellCurveTimes(PARTS * totalProvs, 13_000);
                  const provIds = NL_PROVINCES.map(p => p.id).sort(() => Math.random() - 0.5);
                  const events: { provId: NlProvId; fraction: number; t: number }[] = [];
                  for (let phase = 0; phase < PARTS; phase++) {
                    const phaseOrder = [...provIds].sort(() => Math.random() - 0.5);
                    for (let i = 0; i < phaseOrder.length; i++) {
                      events.push({ provId: phaseOrder[i], fraction: (phase + 1) / PARTS, t: times[phase * totalProvs + i] });
                    }
                  }
                  events.sort((a, b) => a.t - b.t);

                  setSimRunning(true);
                  setSimProgress(0);
                  setSimSeats(undefined);
                  setDeclaredProvs(new Set());
                  setSimProvFractions({});

                  const localFractions: Partial<Record<NlProvId, number>> = {};
                  const localDeclared = new Set<NlProvId>();
                  const timers: ReturnType<typeof setTimeout>[] = [];

                  for (const ev of events) {
                    timers.push(setTimeout(() => {
                      localFractions[ev.provId] = ev.fraction;
                      localDeclared.add(ev.provId);
                      const fracSnap = { ...localFractions };
                      const declSnap = new Set(localDeclared);
                      setSimProvFractions(fracSnap);
                      setDeclaredProvs(declSnap);
                      setSimProgress(declSnap.size);
                      setSimSeats(calcPartialSeats(natPctsAtSimStart.current, fracSnap, provOverrides));
                      const allDone = declSnap.size >= totalProvs && Object.values(fracSnap).every(f => f === 1);
                      if (allDone) {
                        setSimSeats(calcDHondt(natPctsAtSimStart.current));
                        setSimRunning(false);
                      }
                    }, ev.t));
                  }
                  simTimersRef.current = timers;
                }}
                className="w-full h-8 rounded-[4px] bg-blue-600 text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {simRunning
                  ? `${simProgress}/${NL_PROVINCES.length} provinces reporting…`
                  : '▶ Run Simulation'}
              </button>
              {(simSeats || declaredProvs) && (
                <button onClick={() => { stopSim(); setSimSeats(undefined); setDeclaredProvs(undefined); setSimProgress(0); setSimProvFractions({}); setSimTouched(false); }}
                  className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
                  Reset
                </button>
              )}
            </div>
          </aside>
        )}

        {showProv && selectedProv && !simOpen && (
          <NlProvPanel
            key={selectedProv}
            provId={selectedProv}
            natPcts={natPcts}
            provOverride={provOverrides[selectedProv]}
            onOverride={pcts => handleProvOverride(selectedProv, pcts)}
            onResetOverride={() => {
              handleProvResetOverride(selectedProv);
              setProjectedProvs(prev => { const n = new Set(prev); n.delete(selectedProv); return n; });
            }}
            onClose={() => setSelectedProv(null)}
            isBlankMode={preset === 'blank'}
            isProjected={projectedProvs.has(selectedProv)}
            reportingPct={provReportingPct[selectedProv] ?? 100}
            onProject={() => setProjectedProvs(prev => new Set([...prev, selectedProv]))}
            onReportingPctChange={pct => setProvReportingPct(prev => ({ ...prev, [selectedProv]: pct }))}
            hiddenParties={hiddenParties}
            dark={dark}
          />
        )}

        {showTutorial && !simOpen && (
          <NlTutorialPanel
            onClose={() => { setTutorialOpen(false); triggerExit('tutorial'); }}
            exiting={exitPanel === 'tutorial'}
            dark={dark}
          />
        )}

        {showCoalition && !simOpen && (
          <NlCoalitionPanel
            seats={displaySeats}
            onClose={() => { setCoalitionOpen(false); triggerExit('coalition'); }}
            exiting={exitPanel === 'coalition'}
            dark={dark}
          />
        )}
      </div>
    </div>
  );
}
