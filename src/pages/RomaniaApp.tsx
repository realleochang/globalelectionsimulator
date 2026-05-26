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
  leader: string;
  wikiTitle?: string;
};

const RO_PARTIES: RoParty[] = [
  { id: 'PSD',  name: 'PSD',  fullName: 'Partidul Social Democrat',               color: '#CC0000', seats2024: 88, leader: 'Marcel Ciolacu',  wikiTitle: 'Marcel_Ciolacu' },
  { id: 'AUR',  name: 'AUR',  fullName: 'Alianța pentru Unirea Românilor',        color: '#C8960C', seats2024: 70, leader: 'George Simion',   wikiTitle: 'George_Simion' },
  { id: 'PNL',  name: 'PNL',  fullName: 'Partidul Național Liberal',              color: '#F9A800', seats2024: 56, leader: 'Nicolae Ciucă',   wikiTitle: 'Nicolae_Ciucă' },
  { id: 'USR',  name: 'USR',  fullName: 'Uniunea Salvați România',                color: '#003DA5', seats2024: 49, leader: 'Cătălin Drulă',   wikiTitle: 'Cătălin_Drulă' },
  { id: 'UDMR', name: 'UDMR', fullName: 'Uniunea Democrată Maghiară din România', color: '#2E7D32', seats2024: 25, leader: 'Kelemen Hunor',   wikiTitle: 'Kelemen_Hunor' },
  { id: 'SOS',  name: 'SOS',  fullName: 'SOS România',                            color: '#B71C1C', seats2024: 22, leader: 'Diana Șoșoacă',   wikiTitle: 'Diana_Șoșoacă' },
  { id: 'POT',  name: 'POT',  fullName: 'Partidul Oamenilor Tineri',              color: '#E65100', seats2024: 21, leader: 'Călin Georgescu' },
];

const RO_PARTY_MAP = Object.fromEntries(RO_PARTIES.map(p => [p.id, p])) as Record<RoPartyId, RoParty>;
const RO_CAMERA_SEATS   = 331;
const RO_CAMERA_MAJORITY = 166;
const RO_SENATE_SEATS   = 137;
const RO_SENATE_MAJORITY = 69;
const RO_THRESHOLD = 5.0;

const RO_VOTE_PCT_2024: Record<RoPartyId, number> = {
  PSD: 26.6, AUR: 21.3, PNL: 17.0, USR: 14.8, UDMR: 7.5, SOS: 6.4, POT: 6.4,
};
const RO_VOTE_RAW_2024: Record<RoPartyId, number> = {
  PSD: 2_480_000, AUR: 1_990_000, PNL: 1_590_000, USR: 1_380_000,
  UDMR: 700_000, SOS: 600_000, POT: 600_000,
};
const RO_GRAND_TOTAL_VOTES = 9_340_000;

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

// ── 2024 county results (approx., each row sums to 100) ────────────────────────
const RO_COUNTY_RESULTS_2024: Record<RoCountyId, Record<RoPartyId, number>> = {
  AB: { PSD:22, AUR:18, PNL:25, USR:17, UDMR: 5, SOS:7,  POT:6  },
  AR: { PSD:20, AUR:19, PNL:26, USR:15, UDMR: 9, SOS:6,  POT:5  },
  AG: { PSD:32, AUR:18, PNL:18, USR:14, UDMR: 2, SOS:8,  POT:8  },
  BC: { PSD:30, AUR:20, PNL:16, USR:13, UDMR: 2, SOS:9,  POT:10 },
  BH: { PSD:18, AUR:17, PNL:22, USR:13, UDMR:20, SOS:5,  POT:5  },
  BN: { PSD:24, AUR:20, PNL:25, USR:14, UDMR: 5, SOS:6,  POT:6  },
  BT: { PSD:33, AUR:22, PNL:15, USR:11, UDMR: 1, SOS:10, POT:8  },
  BR: { PSD:31, AUR:20, PNL:17, USR:12, UDMR: 1, SOS:9,  POT:10 },
  BV: { PSD:20, AUR:19, PNL:22, USR:20, UDMR: 8, SOS:6,  POT:5  },
  B:  { PSD:19, AUR:15, PNL:20, USR:26, UDMR: 2, SOS:8,  POT:10 },
  BZ: { PSD:32, AUR:21, PNL:17, USR:12, UDMR: 1, SOS:9,  POT:8  },
  CL: { PSD:34, AUR:20, PNL:16, USR:10, UDMR: 1, SOS:10, POT:9  },
  CS: { PSD:28, AUR:19, PNL:20, USR:14, UDMR: 3, SOS:8,  POT:8  },
  CJ: { PSD:17, AUR:16, PNL:22, USR:27, UDMR: 6, SOS:6,  POT:6  },
  CT: { PSD:28, AUR:20, PNL:19, USR:15, UDMR: 1, SOS:8,  POT:9  },
  CV: { PSD:12, AUR:10, PNL:12, USR:10, UDMR:48, SOS:4,  POT:4  },
  DB: { PSD:35, AUR:20, PNL:17, USR:11, UDMR: 1, SOS:8,  POT:8  },
  DJ: { PSD:35, AUR:21, PNL:17, USR:10, UDMR: 1, SOS:8,  POT:8  },
  GL: { PSD:32, AUR:21, PNL:16, USR:12, UDMR: 1, SOS:9,  POT:9  },
  GR: { PSD:38, AUR:20, PNL:16, USR: 9, UDMR: 1, SOS:8,  POT:8  },
  GJ: { PSD:37, AUR:21, PNL:16, USR: 9, UDMR: 1, SOS:8,  POT:8  },
  HR: { PSD: 9, AUR: 9, PNL:10, USR: 8, UDMR:57, SOS:4,  POT:3  },
  HD: { PSD:27, AUR:18, PNL:22, USR:14, UDMR: 6, SOS:7,  POT:6  },
  IL: { PSD:35, AUR:21, PNL:16, USR:10, UDMR: 1, SOS:9,  POT:8  },
  IS: { PSD:27, AUR:19, PNL:16, USR:18, UDMR: 1, SOS:9,  POT:10 },
  IF: { PSD:21, AUR:17, PNL:21, USR:22, UDMR: 2, SOS:8,  POT:9  },
  MM: { PSD:24, AUR:21, PNL:24, USR:14, UDMR: 7, SOS:6,  POT:4  },
  MH: { PSD:36, AUR:21, PNL:17, USR: 9, UDMR: 1, SOS:8,  POT:8  },
  MS: { PSD:24, AUR:17, PNL:18, USR:13, UDMR:20, SOS:4,  POT:4  },
  NT: { PSD:30, AUR:22, PNL:17, USR:13, UDMR: 1, SOS:9,  POT:8  },
  OT: { PSD:36, AUR:21, PNL:16, USR: 9, UDMR: 1, SOS:9,  POT:8  },
  PH: { PSD:27, AUR:19, PNL:23, USR:14, UDMR: 1, SOS:8,  POT:8  },
  SJ: { PSD:23, AUR:19, PNL:25, USR:13, UDMR:10, SOS:5,  POT:5  },
  SM: { PSD:20, AUR:18, PNL:22, USR:12, UDMR:19, SOS:5,  POT:4  },
  SB: { PSD:19, AUR:17, PNL:25, USR:21, UDMR: 5, SOS:7,  POT:6  },
  SV: { PSD:28, AUR:21, PNL:22, USR:13, UDMR: 1, SOS:8,  POT:7  },
  TR: { PSD:41, AUR:20, PNL:15, USR: 8, UDMR: 1, SOS:8,  POT:7  },
  TM: { PSD:19, AUR:17, PNL:27, USR:21, UDMR: 5, SOS:5,  POT:6  },
  TL: { PSD:31, AUR:20, PNL:18, USR:12, UDMR: 1, SOS:9,  POT:9  },
  VL: { PSD:32, AUR:20, PNL:20, USR:12, UDMR: 1, SOS:8,  POT:7  },
  VS: { PSD:38, AUR:22, PNL:14, USR:10, UDMR: 1, SOS:8,  POT:7  },
  VN: { PSD:34, AUR:22, PNL:16, USR:11, UDMR: 1, SOS:8,  POT:8  },
};

// ── D'Hondt with 5% threshold ──────────────────────────────────────────────────
function calcSeats(
  votePcts: Partial<Record<RoPartyId, number>>,
  totalSeats = RO_CAMERA_SEATS,
  threshold = RO_THRESHOLD,
): Partial<Record<RoPartyId, number>> {
  const qualifying: Partial<Record<RoPartyId, number>> = {};
  let qualSum = 0;
  for (const [id, v] of Object.entries(votePcts) as [RoPartyId, number][]) {
    if ((v ?? 0) >= threshold) { qualifying[id] = v; qualSum += v; }
  }
  if (qualSum === 0) return {};
  const quotients: { id: RoPartyId; q: number }[] = [];
  for (const [id, v] of Object.entries(qualifying) as [RoPartyId, number][]) {
    for (let d = 1; d <= totalSeats; d++) quotients.push({ id, q: v / d });
  }
  quotients.sort((a, b) => b.q - a.q);
  const seats: Partial<Record<RoPartyId, number>> = {};
  for (let i = 0; i < Math.min(totalSeats, quotients.length); i++) {
    seats[quotients[i].id] = (seats[quotients[i].id] ?? 0) + 1;
  }
  return seats;
}

function calcCountyVotes(natPcts: Record<RoPartyId, number>, countyId: RoCountyId): Record<RoPartyId, number> {
  const base = RO_COUNTY_RESULTS_2024[countyId];
  const raw: Record<RoPartyId, number> = {} as Record<RoPartyId, number>;
  let total = 0;
  for (const p of RO_PARTIES) {
    const swing = (natPcts[p.id] ?? 0) - (RO_VOTE_PCT_2024[p.id] ?? 0);
    const v = Math.max(0, (base[p.id] ?? 0) + swing);
    raw[p.id] = v; total += v;
  }
  if (total === 0) return raw;
  for (const p of RO_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
  return raw;
}

function calcPartialSeats(
  natPcts: Record<RoPartyId, number>,
  declaredCounties: Set<RoCountyId>,
): Partial<Record<RoPartyId, number>> {
  if (declaredCounties.size === 0) return {};
  const weighted: Partial<Record<RoPartyId, number>> = {};
  let totalPop = 0;
  for (const cId of declaredCounties) {
    const c = RO_COUNTY_MAP[cId]; if (!c) continue;
    const cv = calcCountyVotes(natPcts, cId);
    for (const p of RO_PARTIES) weighted[p.id] = (weighted[p.id] ?? 0) + (cv[p.id] ?? 0) * c.pop;
    totalPop += c.pop;
  }
  if (totalPop === 0) return {};
  const norm: Partial<Record<RoPartyId, number>> = {};
  for (const p of RO_PARTIES) norm[p.id] = (weighted[p.id] ?? 0) / totalPop;
  return calcSeats(norm);
}

function redistributePcts(
  current: Record<RoPartyId, number>,
  changedId: RoPartyId,
  newRaw: number,
  locks: Set<RoPartyId>,
): Record<RoPartyId, number> {
  const ids = Object.keys(current) as RoPartyId[];
  const lockedSum = ids.filter(id => locks.has(id) && id !== changedId).reduce((s, id) => s + (current[id] ?? 0), 0);
  const clamped = Math.min(Math.max(newRaw, 0), 100 - lockedSum);
  const unlocked = ids.filter(id => !locks.has(id) && id !== changedId);
  const remaining = 100 - lockedSum - clamped;
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
  parties: { id: RoPartyId; pct: number }[];
  leader: RoPartyId | null;
} | null;

// ── Political left → right order for hemicycle ────────────────────────────────
const RO_LR_ORDER: RoPartyId[] = ['PSD', 'UDMR', 'PNL', 'USR', 'POT', 'AUR', 'SOS'];

// ── Scoreboard tile ────────────────────────────────────────────────────────────
function RoScoreboardTile({ partyId, seats, pct, rawVotes, belowThreshold, isLeader, isWinner }: {
  partyId: RoPartyId; seats: number; pct: number; rawVotes: number;
  belowThreshold: boolean; isLeader: boolean; isWinner: boolean;
}) {
  const party = RO_PARTY_MAP[partyId];
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!party.wikiTitle) { setPhotoUrl(null); return; }
    let cancelled = false;
    fetchWikiPhoto(party.wikiTitle).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [party.wikiTitle]);

  const initials = party.leader.split(' ').map((w: string) => w[0]).join('').slice(0, 2);
  const color = partyColor(partyId);
  const colorAlpha = hexToRgba(color, 0.13);

  return (
    <div
      className={`cand-col${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`}
      style={{
        '--cand-color': color, '--cand-color-alpha': colorAlpha,
        borderColor: (isLeader || isWinner) ? color : hexToRgba(color, belowThreshold ? 0.18 : 0.30),
        opacity: belowThreshold ? 0.55 : 1,
      } as React.CSSProperties}
    >
      <div style={{ position: 'relative' }}>
        <div className="cand-circle-frame">
          {photoUrl
            ? <img src={photoUrl} alt={party.leader} onError={() => setPhotoUrl(null)} />
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
        {belowThreshold && (
          <span style={{ position:'absolute', bottom:2, right:2, fontSize:8, background:'rgba(0,0,0,0.45)', color:'#fff', borderRadius:2, padding:'0 2px', fontFamily:'monospace' }}>
            &lt;5%
          </span>
        )}
      </div>
      <span className="cand-leader-name" title={party.leader}>{party.leader.split(' ').pop()}</span>
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
function RoScoreboard({ natPcts, simSeats, isBaseline, dark: _dark }: {
  natPcts: Record<RoPartyId, number>;
  simSeats?: Partial<Record<RoPartyId, number>>;
  isBaseline?: boolean;
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

  const seats = useMemo(() => simSeats ?? calcSeats(natPcts), [simSeats, natPcts]);
  const pctTotal = Object.values(natPcts).reduce((s, v) => s + (v ?? 0), 0);

  const sorted = useMemo(
    () => RO_PARTIES
      .filter(p => (seats[p.id] ?? 0) > 0 || (natPcts[p.id] ?? 0) > 0)
      .sort((a, b) => (seats[b.id] ?? 0) - (seats[a.id] ?? 0) || (natPcts[b.id] ?? 0) - (natPcts[a.id] ?? 0)),
    [seats, natPcts],
  );

  const leader = sorted[0]?.id ?? null;
  const winner = leader && (seats[leader] ?? 0) >= RO_CAMERA_MAJORITY ? leader : null;

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {sorted.map(party => {
            const s = seats[party.id] ?? 0;
            const pct = pctTotal > 0 ? (natPcts[party.id] ?? 0) / pctTotal * 100 : 0;
            const rawVotes = isBaseline
              ? RO_VOTE_RAW_2024[party.id]
              : Math.round((natPcts[party.id] ?? 0) / 100 * RO_GRAND_TOTAL_VOTES);
            const belowThreshold = (natPcts[party.id] ?? 0) < RO_THRESHOLD;
            return (
              <RoScoreboardTile key={party.id} partyId={party.id} seats={s} pct={pct}
                rawVotes={rawVotes} belowThreshold={belowThreshold}
                isLeader={party.id === leader && !winner} isWinner={party.id === winner} />
            );
          })}
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
}: {
  geoData: any; natPcts: Record<RoPartyId, number>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setTooltip: (t: CountyTooltipState) => void;
  onSelect: (id: RoCountyId) => void;
  natPctsRef: React.MutableRefObject<Record<RoPartyId, number>>;
  declaredCounties?: Set<RoCountyId>;
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
      const bounds = (layer as any).getBounds?.();
      if (!bounds?.isValid()) return;
      const center = bounds.getCenter();
      const cv = calcCountyVotes(natPcts, countyId);
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
        const cur = calcCountyVotes(natPctsRef.current, countyId);
        const parties = (Object.entries(cur) as [RoPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 5).map(([id, pct]) => ({ id: id as RoPartyId, pct }));
        setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name: countyName, parties, leader: parties[0]?.id ?? null });
      });
      marker.on('mouseout', () => setTooltip(null));
      bubblesRef.current.push({ marker, baseRadius });
    });
    return () => { for (const { marker } of bubblesRef.current) marker.remove(); bubblesRef.current = []; };
  }, [map, geoData, natPcts]);

  return null;
}

// ── Map view ───────────────────────────────────────────────────────────────────
function RoMapView({ natPcts, selectedCounty, onSelect, dark, bubbleMap, declaredCounties, overrides }: {
  natPcts: Record<RoPartyId, number>; selectedCounty: RoCountyId | null;
  onSelect: (id: RoCountyId) => void; dark: boolean; bubbleMap: boolean;
  declaredCounties?: Set<RoCountyId>;
  overrides?: Record<string, Record<RoPartyId, number>>;
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
  useEffect(() => { natPctsRef.current  = natPcts;        }, [natPcts]);
  useEffect(() => { selectedRef.current = selectedCounty; }, [selectedCounty]);
  useEffect(() => { darkRef.current     = dark;           }, [dark]);
  useEffect(() => { bubbleRef.current   = bubbleMap;      }, [bubbleMap]);
  useEffect(() => { onSelectRef.current = onSelect;       }, [onSelect]);
  useEffect(() => { declaredRef.current = declaredCounties; }, [declaredCounties]);
  useEffect(() => { overridesRef.current = overrides;     }, [overrides]);

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
    const isDeclared = !declaredRef.current || declaredRef.current.has(countyId);
    if (!isDeclared) return { fillColor: darkRef.current?'#1f2937':'#d1d5db', fillOpacity:0.7, weight:0.4, color:borderColor, opacity:1 };
    const fill = getCountyFill(natPctsRef.current, countyId, darkRef.current, overridesRef.current);
    return { fillColor:fill, fillOpacity:0.80, weight: isSelected?2:0.5, color: isSelected?'#c8a020':borderColor, opacity:1 };
  }, []);

  useEffect(() => { layerRef.current?.setStyle((f: any) => getStyle(f)); }, [natPcts, selectedCounty, dark, bubbleMap, declaredCounties, overrides, getStyle]);

  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const countyName: string = feature?.properties?.name ?? '';
    const countyId = RO_NAME_TO_ID[countyName];
    layer.on('click', () => { if (countyId) onSelectRef.current(countyId); });
    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleRef.current || !countyId) { setTooltip(null); return; }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cv = calcCountyVotes(natPctsRef.current, countyId);
      const parties = (Object.entries(cv) as [RoPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 5).map(([id, pct]) => ({ id: id as RoPartyId, pct }));
      setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name: countyName, parties, leader: parties[0]?.id ?? null });
    });
    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[45.8, 25.0]} zoom={7} minZoom={6} maxZoom={13}
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
            setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef} declaredCounties={declaredCounties} />
        )}
      </MapContainer>
      {tooltip && (() => {
        const cw = containerRef.current?.clientWidth ?? 9999;
        const TW = 220; const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const tt = { bg: dark?'rgba(18,24,44,0.96)':'rgba(255,255,255,0.97)', border: dark?'rgba(255,255,255,0.09)':'rgba(0,0,0,0.08)',
          shadow: dark?'0 6px 28px rgba(0,0,0,0.5)':'0 6px 28px rgba(0,0,0,0.12)',
          title: dark?'rgba(255,255,255,0.92)':'rgba(0,0,0,0.85)', body: dark?'rgba(255,255,255,0.85)':'rgba(0,0,0,0.78)' };
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top: Math.max(6, tooltip.y - 20), width: TW }}>
            <div style={{ background:tt.bg, borderRadius:10, border:`1px solid ${tt.border}`, boxShadow:tt.shadow, backdropFilter:'blur(10px)', padding:'12px 14px' }}>
              <div style={{ fontSize:13, fontWeight:700, color:tt.title }}>{tooltip.name}</div>
              <div style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', color: dark?'rgba(255,255,255,0.40)':'rgba(0,0,0,0.42)', marginTop:2 }}>Est. county result</div>
              <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
                {tooltip.parties.map(({ id, pct }, i) => {
                  const pColor = partyColor(id);
                  return (
                    <div key={id} style={{ display:'flex', alignItems:'center', gap:7 }}>
                      <span style={{ width:8, height:8, borderRadius:2, flexShrink:0, background:pColor }} />
                      <span style={{ flex:1, fontSize:11, fontWeight:i===0?600:400, color:tt.body, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{RO_PARTY_MAP[id]?.name ?? id}</span>
                      <span style={{ fontSize:12, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color:pColor }}>{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
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
function RoCountyPanel({ countyId, natPcts, onUpdate, onClose, dark, override }: {
  countyId: RoCountyId; natPcts: Record<RoPartyId, number>;
  onUpdate: (id: RoCountyId, pcts: Record<RoPartyId, number>) => void;
  onClose: () => void; dark?: boolean;
  override?: Record<RoPartyId, number>;
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

  useEffect(() => {
    if (override) setPcts({ ...override });
    else {
      const cv = calcCountyVotes(natPcts, countyId);
      setPcts(Object.fromEntries(RO_PARTIES.map(p => [p.id, cv[p.id] ?? 0])) as Record<RoPartyId, number>);
    }
    setPanelLocks(new Set()); setEditId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countyId]);

  function applyChange(id: RoPartyId, val: number) {
    const next = redistributePcts(pctsRef.current, id, val, panelLocks);
    pctsRef.current = next; setPcts(next); onUpdate(countyId, next);
  }
  function commitEdit(id: RoPartyId, raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) applyChange(id, Math.max(0, Math.min(100, n)));
    setEditId(null); setEditVal('');
  }

  const sorted = useMemo(() => RO_PARTIES.map(p => ({ ...p, pct: pcts[p.id] ?? 0 })).sort((a, b) => b.pct - a.pct), [pcts]);
  const county = RO_COUNTY_MAP[countyId]; const winner = sorted[0];
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold text-ink leading-tight truncate">{county?.name ?? countyId}</h2>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{override ? 'Custom result · click % to edit' : 'Estimated result · click % to edit'}</p>
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
        {sorted.filter(p => p.pct >= 0.1 || panelLocks.has(p.id)).map(p => {
          const pct = pcts[p.id] ?? 0; const isLocked = panelLocks.has(p.id);
          return (
            <div key={p.id}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background:p.color }} />
                <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{p.fullName}</span>
                {pct < RO_THRESHOLD && pct > 0 && <span className="text-[7px] font-mono text-red-400 shrink-0">&lt;5%</span>}
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
              <input type="range" min={0} max={55} step={0.1} value={pct} disabled={isLocked}
                onChange={e => applyChange(p.id, parseFloat(e.target.value))}
                className="br-party-slider w-full"
                style={{ '--party-color': p.color, '--pct': `${(pct/55)*100}%` } as React.CSSProperties} />
            </div>
          );
        })}
        <div className="pt-2 border-t border-default space-y-2">
          <div>
            <div className="text-[8.5px] font-mono text-ink-3 uppercase tracking-wide mb-1">Population (approx.)</div>
            <div className="text-[11px] font-mono font-semibold text-ink">{county?.pop.toLocaleString()}</div>
          </div>
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
function RoParliamentPanel({ cameraSeats, senateSeats, onClose, exiting, dark }: {
  cameraSeats: Partial<Record<RoPartyId, number>>;
  senateSeats: Partial<Record<RoPartyId, number>>;
  onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const [chamber, setChamber] = useState<'camera' | 'senate'>('camera');
  const seatsMap        = chamber === 'camera' ? cameraSeats : senateSeats;
  const totalSeatsConst = chamber === 'camera' ? RO_CAMERA_SEATS   : RO_SENATE_SEATS;
  const majorityConst   = chamber === 'camera' ? RO_CAMERA_MAJORITY : RO_SENATE_MAJORITY;

  const seatColors: string[] = [];
  const legend: { id: RoPartyId; count: number; color: string }[] = [];
  for (const id of RO_LR_ORDER) {
    const n = seatsMap[id] ?? 0; if (n === 0) continue;
    const color = partyColor(id);
    legend.push({ id, count: n, color });
    for (let i = 0; i < n; i++) seatColors.push(color);
  }
  const totalSeats = seatColors.length;
  const W = 310, H = 180, cx = W/2, cy = H - 4, innerR = 52, rowSpacing = 9;
  const rows = chamber === 'camera' ? 6 : 5;
  const arcLengths = Array.from({ length: rows }, (_, i) => Math.PI * (innerR + i * rowSpacing));
  const totalArc = arcLengths.reduce((s, v) => s + v, 0);
  const floors = arcLengths.map(a => Math.floor((a / totalArc) * totalSeatsConst));
  const remainder = totalSeatsConst - floors.reduce((s, v) => s + v, 0);
  arcLengths
    .map((a, i) => ({ i, frac: (a / totalArc) * totalSeatsConst - floors[i] }))
    .sort((a, b) => b.frac - a.frac)
    .slice(0, remainder)
    .forEach(({ i }) => floors[i]++);
  const rawPos: { x: number; y: number; θ: number; r: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const r = innerR + row * rowSpacing; const n = floors[row];
    for (let j = 0; j < n; j++) {
      const θ = Math.PI * (n - j - 0.5) / n;
      rawPos.push({ x: cx + r * Math.cos(θ), y: cy - r * Math.sin(θ), θ, r });
    }
  }
  rawPos.sort((a, b) => b.θ - a.θ || a.r - b.r);

  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-r border-default flex flex-col overflow-hidden ${exiting?'panel-exit-left':'panel-slide-left'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Parlamentul României</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">{totalSeatsConst} seats · majority {majorityConst} · 5% threshold</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      {/* Chamber toggle */}
      <div className="flex px-3.5 pt-3 pb-2 gap-2 shrink-0">
        {(['camera','senate'] as const).map(ch => (
          <button key={ch} onClick={() => setChamber(ch)}
            className={`flex-1 h-7 rounded-[4px] text-[10px] font-mono font-semibold uppercase tracking-wide transition-colors ${chamber===ch ? 'bg-gold text-white' : 'border border-default text-ink-3 hover:bg-hover'}`}>
            {ch === 'camera' ? `Camera (${RO_CAMERA_SEATS})` : `Senat (${RO_SENATE_SEATS})`}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll">
        {totalSeats === 0
          ? <div className="flex items-center justify-center h-40 text-ink-3 text-[11px] font-mono px-4 text-center">Load results or run simulation first</div>
          : <>
            <div className="px-2.5 pt-3 pb-1">
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block' }}>
                <line x1={cx} y1={cy-innerR+4} x2={cx} y2={cy-(innerR+(rows-1)*rowSpacing)-8}
                  stroke="rgba(0,0,0,0.10)" strokeWidth="1" strokeDasharray="3,3" />
                {rawPos.map(({ x, y }, i) => (
                  <circle key={i} cx={x} cy={y} r={2.8}
                    fill={i < seatColors.length ? seatColors[i] : (dark?'#374151':'#e5e7eb')} />
                ))}
              </svg>
            </div>
            {/* Majority progress bar */}
            <div className="px-3.5 pb-2">
              <div className="h-2 rounded-full bg-black/8 overflow-hidden mb-1">
                <div className="flex h-full">
                  {RO_LR_ORDER.filter(id => (seatsMap[id] ?? 0) > 0).map(id => (
                    <div key={id} style={{ width:`${((seatsMap[id]??0)/totalSeatsConst)*100}%`, background:partyColor(id), transition:'width 0.3s' }} />
                  ))}
                </div>
              </div>
              <div className="flex justify-between text-[7.5px] font-mono text-ink-3">
                <span>0</span>
                <span className="font-bold text-ink">{majorityConst} needed</span>
                <span>{totalSeatsConst}</span>
              </div>
            </div>
            <div className="px-3.5 pb-4">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {legend.map(({ id, count, color }) => (
                  <div key={id} className="flex items-center gap-1.5">
                    <div style={{ width:9, height:9, borderRadius:2, background:color, flexShrink:0 }} />
                    <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">{RO_PARTY_MAP[id].name}</span>
                    <span className="text-[9.5px] font-mono font-bold text-ink">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        }
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

function RoCoalitionPanel({ seats, onClose, exiting, dark }: {
  seats: Partial<Record<RoPartyId, number>>; onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const [selected, setSelected] = useState<Set<RoPartyId>>(new Set(['PSD','PNL','UDMR']));
  const toggle = (id: RoPartyId) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const totalCoalSeats = [...selected].reduce((s, id) => s + (seats[id] ?? 0), 0);
  const hasMajority = totalCoalSeats >= RO_CAMERA_MAJORITY;

  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Coalition Builder</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Camera majority: {RO_CAMERA_MAJORITY} · {RO_CAMERA_SEATS} total</div>
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
            const party = RO_PARTY_MAP[id]; const s = seats[id] ?? 0;
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
        <H2>Sistemul Electoral</H2>
        <P>Romania uses <strong>D'Hondt proportional representation</strong> for both the Camera Deputaților and Senat. Seats are allocated at the national level using party list votes.</P>
        <Note>This simulator uses a <strong>simplified national proportional</strong> model with a 5% threshold — parties below this get <strong>zero seats</strong>.</Note>
        <H2>Camera Deputaților</H2>
        <P>The lower house has <strong>331 seats</strong>. A majority requires <strong>166 seats</strong>. The Camera is the primary chamber for confidence votes and forming a government.</P>
        <H2>Senat</H2>
        <P>The upper house has <strong>137 seats</strong>. A majority requires <strong>69 seats</strong>. Toggle between Camera and Senat in the Parliament panel (left side).</P>
        <H2>5% Threshold</H2>
        <P>Individual parties need at least <strong>5%</strong> nationally to receive any seats. In the scoreboard, parties below this threshold appear faded with a "&lt;5%" badge.</P>
        <H2>Romanian Parties</H2>
        <P><strong>PSD</strong> (Social Democrats) leads a coalition with <strong>PNL</strong> (Liberals) and <strong>UDMR</strong> (Hungarian minority). The far-right bloc of <strong>AUR</strong>, <strong>SOS</strong>, and <strong>POT</strong> surged in 2024. <strong>USR</strong> is the main reformist anti-corruption force.</P>
        <H2>Sliders</H2>
        <P>Open <strong>▶ Simulation</strong> to adjust party vote shares. Lock a party (🔒) to keep it fixed while others adjust proportionally.</P>
        <H2>Simulation</H2>
        <P>Click <strong>▶ Rulează Simularea</strong> to watch Romania's 42 counties report results one by one, with live seat updates.</P>
        <H2>Coalition Builder</H2>
        <P>Click <strong>Coalition</strong> to toggle parties and check if a combination can reach the 166-seat Camera majority.</P>
        <H2>Map Modes</H2>
        <P>Toggle <strong>Bubble Map</strong> for circles sized by winning margin, or leave off for choropleth coloring. Click any county to see its full breakdown.</P>
      </div>
    </aside>
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

  const [preset, setPreset]   = useState<'2024'|'blank'|'custom'>('2024');
  const [natPcts, setNatPcts] = useState<Record<RoPartyId, number>>(() => ({ ...RO_VOTE_PCT_2024 }));

  function load2024()  { setNatPcts({ ...RO_VOTE_PCT_2024 }); setPreset('2024'); resetSim(); }
  function loadBlank() {
    setNatPcts(Object.fromEntries(RO_PARTIES.map(p => [p.id, 100 / RO_PARTIES.length])) as Record<RoPartyId, number>);
    setPreset('blank'); resetSim();
  }

  const [selectedCounty, setSelectedCounty]       = useState<RoCountyId | null>(null);
  const [countyOverrides, setCountyOverrides]     = useState<Record<string, Record<RoPartyId, number>>>({});
  const [bubbleMap, setBubbleMap]                 = useState(false);
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [locks, setLocks]                         = useState<Set<RoPartyId>>(new Set());
  const [simOpen, setSimOpen]                     = useState(false);
  const [parliOpen, setParliOpen]                 = useState(false);
  const [coalitionOpen, setCoalitionOpen]         = useState(false);
  const [tutorialOpen, setTutorialOpen]           = useState(false);
  const [exitPanel, setExitPanel]                 = useState<string | null>(null);
  const exitTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  const triggerExit = useCallback((panel: string) => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    setExitPanel(panel);
    exitTimerRef.current = setTimeout(() => setExitPanel(null), 280);
  }, []);

  const [simSeats, setSimSeats]               = useState<Partial<Record<RoPartyId, number>> | undefined>();
  const [simProgress, setSimProgress]         = useState(0);
  const [simRunning, setSimRunning]           = useState(false);
  const [declaredCounties, setDeclaredCounties] = useState<Set<RoCountyId> | undefined>();
  const simTimersRef      = useRef<ReturnType<typeof setTimeout>[]>([]);
  const natPctsAtSimStart = useRef<Record<RoPartyId, number>>(natPcts);

  function stopSim() { simTimersRef.current.forEach(clearTimeout); simTimersRef.current = []; setSimRunning(false); }
  function resetSim() { stopSim(); setSimSeats(undefined); setDeclaredCounties(undefined); setSimProgress(0); }

  useEffect(() => {
    const el = headerScrollRef.current; if (!el) return;
    const h = (e: WheelEvent) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft += e.deltaY; };
    el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h);
  }, []);

  const cameraSeats = useMemo(() => simSeats ?? calcSeats(natPcts, RO_CAMERA_SEATS), [simSeats, natPcts]);
  const senateSeats = useMemo(() => calcSeats(natPcts, RO_SENATE_SEATS), [natPcts]);

  const btnBase   = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold   = `${btnBase} bg-gold text-white hover:bg-gold-deep`;
  const btnMuted  = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive = `${btnBase} bg-ink/8 border border-default text-ink`;

  const showCounty   = !!selectedCounty && !simOpen;
  const showTutorial = tutorialOpen  || exitPanel === 'tutorial';
  const showParli    = parliOpen     || exitPanel === 'parli';
  const showCoal     = coalitionOpen || exitPanel === 'coal';

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="ro">

      {/* ── Topbar ───────────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark?'bg-[rgba(7,13,28,0.94)]':'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
        </button>

        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={load2024}  className={preset==='2024'  ? btnGold : btnMuted}>2024 Results</button>
          <button onClick={loadBlank} className={preset==='blank' ? btnGold : btnMuted}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={() => setSimOpen(v => !v)} className={simOpen ? btnActive : btnMuted}>▶ Simulation</button>
          <button onClick={() => setBubbleMap(v => !v)}
            className={bubbleMap ? `${btnBase} bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700` : btnMuted}>
            Bubble Map
          </button>
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
            if (tutorialOpen) { setTutorialOpen(false); triggerExit('tutorial'); }
            else setTutorialOpen(true);
          }} className={tutorialOpen ? btnActive : btnMuted}>Tutorial</button>
        </div>

        <div className="shrink-0 flex items-center gap-2 pr-4">
          <button onClick={() => setDark(v => !v)} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:text-ink transition-colors">
            {dark ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {/* ── Scoreboard ───────────────────────────────────────────────────── */}
      {scoreboardVisible && (
        <RoScoreboard natPcts={natPcts} simSeats={simSeats} isBaseline={preset==='2024'} dark={dark} />
      )}

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Parliament — LEFT */}
        {showParli && (
          <RoParliamentPanel
            cameraSeats={cameraSeats} senateSeats={senateSeats}
            onClose={() => { setParliOpen(false); triggerExit('parli'); }}
            exiting={exitPanel==='parli'} dark={dark}
          />
        )}

        {/* Map */}
        <RoMapView
          natPcts={natPcts} selectedCounty={selectedCounty}
          onSelect={id => setSelectedCounty(prev => prev === id ? null : id)}
          dark={dark} bubbleMap={bubbleMap} declaredCounties={declaredCounties}
          overrides={countyOverrides}
        />

        {/* Simulation panel */}
        {simOpen && (
          <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2>
                <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Vote shares · D'Hondt · 5% threshold</p>
              </div>
              <button onClick={() => setSimOpen(false)} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">
              {([...RO_PARTIES] as RoParty[])
                .sort((a, b) => (natPcts[b.id]??0) - (natPcts[a.id]??0))
                .map((party: RoParty) => {
                  const pct = natPcts[party.id] ?? 0;
                  const isLocked = locks.has(party.id);
                  const color = partyColor(party.id);
                  return (
                    <div key={party.id}>
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background:color }} />
                        <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{party.fullName}</span>
                        {pct < RO_THRESHOLD && pct > 0 && <span className="text-[7px] font-mono text-red-400">&lt;5%</span>}
                        <button
                          onClick={() => setLocks(prev => { const n = new Set(prev); n.has(party.id) ? n.delete(party.id) : n.add(party.id); return n; })}
                          className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked?'text-gold':'text-ink-3 hover:text-ink'}`}
                          title={isLocked?'Unlock':'Lock'}>
                          {isLocked
                            ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                            : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                          }
                        </button>
                      </div>
                      <input type="range" min={0} max={50} step={0.1} value={pct} disabled={isLocked}
                        onChange={e => {
                          setNatPcts(redistributePcts(natPcts, party.id, parseFloat(e.target.value), locks));
                          setPreset('custom');
                        }}
                        className="br-party-slider w-full"
                        style={{ '--party-color': color, '--pct': `${(pct/50)*100}%` } as React.CSSProperties} />
                      <div className="flex justify-between mt-0.5">
                        <span className="text-[8px] font-mono text-ink-3">{party.name}</span>
                        <span className="text-[8.5px] font-mono tabular-nums text-ink-3">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
            </div>
            <div className="px-3.5 pb-3.5 pt-2 border-t border-default shrink-0 space-y-2">
              <button
                disabled={simRunning}
                onClick={() => {
                  stopSim();
                  natPctsAtSimStart.current = { ...natPcts };
                  const allCounties = [...RO_COUNTIES].sort(() => Math.random() - 0.5);
                  const NCHUNKS = 12;
                  const chunkTimes = roBellCurveTimes(NCHUNKS, 30_000);
                  const chunks: RoCounty[][] = Array.from({ length: NCHUNKS }, () => []);
                  allCounties.forEach((c, i) => chunks[i % NCHUNKS].push(c));
                  setSimRunning(true); setSimProgress(0); setSimSeats(undefined); setDeclaredCounties(new Set());
                  let declared = new Set<RoCountyId>();
                  const timers: ReturnType<typeof setTimeout>[] = [];
                  for (let ci = 0; ci < NCHUNKS; ci++) {
                    const chunk = chunks[ci]; const t = chunkTimes[ci];
                    timers.push(setTimeout(() => {
                      for (const c of chunk) declared.add(c.id);
                      const snap = new Set(declared);
                      setDeclaredCounties(snap);
                      setSimProgress(snap.size);
                      setSimSeats(calcPartialSeats(natPctsAtSimStart.current, snap));
                      if (snap.size >= RO_COUNTIES.length) {
                        setSimSeats(calcSeats(natPctsAtSimStart.current));
                        setSimRunning(false);
                      }
                    }, t));
                  }
                  simTimersRef.current = timers;
                }}
                className="w-full h-8 rounded-[4px] bg-blue-600 text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {simRunning
                  ? `${simProgress}/${RO_COUNTIES.length} județe raportează…`
                  : '▶ Rulează Simularea'}
              </button>
              {(simSeats || declaredCounties) && (
                <button onClick={resetSim} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
                  Reset
                </button>
              )}
            </div>
          </aside>
        )}

        {/* Coalition — right */}
        {showCoal && !simOpen && (
          <RoCoalitionPanel seats={cameraSeats}
            onClose={() => { setCoalitionOpen(false); triggerExit('coal'); }}
            exiting={exitPanel==='coal'} dark={dark} />
        )}

        {/* County panel — right */}
        {showCounty && selectedCounty && !simOpen && !showCoal && (
          <RoCountyPanel countyId={selectedCounty} natPcts={natPcts}
            onUpdate={(id, pcts) => setCountyOverrides(prev => ({ ...prev, [id]: pcts }))}
            onClose={() => setSelectedCounty(null)} dark={dark}
            override={countyOverrides[selectedCounty]} />
        )}

        {/* Tutorial — right */}
        {showTutorial && !simOpen && !showCoal && (
          <RoTutorialPanel
            onClose={() => { setTutorialOpen(false); triggerExit('tutorial'); }}
            exiting={exitPanel==='tutorial'} dark={dark} />
        )}
      </div>
    </div>
  );
}
