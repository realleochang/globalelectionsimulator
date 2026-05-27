import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

type SaPartyId = 'ANC' | 'DA' | 'MK' | 'EFF' | 'IFP' | 'PA' | 'FFP' | 'ASA' | 'UDM' | 'ACDP' | 'RISE' | 'ATM' | 'NCC' | 'AJ' | 'BOSA' | 'GOOD' | 'PAC' | 'UAT';
type SaParty = { id: SaPartyId; name: string; fullName: string; color: string; seats2024: number; leader: string; wikiTitle?: string; leader2024?: string; wikiTitle2024?: string };

const SA_PARTIES: SaParty[] = [
  // Leaders current as of May 2026
  { id: 'ANC',  name: 'ANC',       fullName: 'African National Congress',          color: '#007A4D', seats2024: 159, leader: 'Cyril Ramaphosa',     wikiTitle: 'Cyril_Ramaphosa' },
  // DA: Steenhuisen stepped down Feb 2026 → Geordin Hill-Lewis elected leader Apr 12 2026
  { id: 'DA',   name: 'DA',        fullName: 'Democratic Alliance',                color: '#1565C0', seats2024:  87, leader: 'Geordin Hill-Lewis',  wikiTitle: 'Geordin_Hill-Lewis',  leader2024: 'John Steenhuisen', wikiTitle2024: 'John_Steenhuisen' },
  { id: 'MK',   name: 'MK',        fullName: 'uMkhonto we Sizwe Party',            color: '#1B5E20', seats2024:  58, leader: 'Jacob Zuma',          wikiTitle: 'Jacob_Zuma' },
  { id: 'EFF',  name: 'EFF',       fullName: 'Economic Freedom Fighters',          color: '#E53935', seats2024:  39, leader: 'Julius Malema',       wikiTitle: 'Julius_Malema' },
  { id: 'IFP',  name: 'IFP',       fullName: 'Inkatha Freedom Party',              color: '#6A1B9A', seats2024:  17, leader: 'Velenkosini Hlabisa', wikiTitle: 'Velenkosini_Hlabisa' },
  { id: 'PA',   name: 'PA',        fullName: 'Patriotic Alliance',                 color: '#E65100', seats2024:   9, leader: 'Gayton McKenzie',     wikiTitle: 'Gayton_McKenzie' },
  // FF+: Groenewald became NA Speaker (Jun 2024) → Corné Mulder elected leader Feb 22 2025
  { id: 'FFP',  name: 'FF+',       fullName: 'Freedom Front Plus',                 color: '#FF8F00', seats2024:   6, leader: 'Corné Mulder',        wikiTitle: 'Corné_Mulder',        leader2024: 'Pieter Groenewald', wikiTitle2024: 'Pieter_Groenewald' },
  { id: 'ASA',  name: 'ActionSA',  fullName: 'ActionSA',                           color: '#00ACC1', seats2024:   6, leader: 'Herman Mashaba',      wikiTitle: 'Herman_Mashaba' },
  { id: 'UDM',  name: 'UDM',       fullName: 'United Democratic Movement',         color: '#558B2F', seats2024:   3, leader: 'Bantu Holomisa',      wikiTitle: 'Bantu_Holomisa' },
  { id: 'ACDP', name: 'ACDP',      fullName: 'African Christian Democratic Party', color: '#1A237E', seats2024:   3, leader: 'Kenneth Meshoe',      wikiTitle: 'Kenneth_Meshoe' },
  { id: 'RISE', name: 'Rise',      fullName: 'Rise Mzansi',                        color: '#00838F', seats2024:   2, leader: 'Songezo Zibi',        wikiTitle: 'Songezo_Zibi' },
  // ATM: Zungula removed as party president Jun 2025 → Caesar Nongqunga (party founder) installed
  { id: 'ATM',  name: 'ATM',       fullName: 'African Transformation Movement',    color: '#880E4F', seats2024:   2, leader: 'Caesar Nongqunga',    wikiTitle: undefined,             leader2024: 'Vuyo Zungula',     wikiTitle2024: 'Vuyo_Zungula' },
  // NCC: Fadiel Adams is and has been the leader (Nic Koornhof had no NCC connection)
  { id: 'NCC',  name: 'NCC',       fullName: 'National Coloured Congress',         color: '#78909C', seats2024:   2, leader: 'Fadiel Adams',        wikiTitle: 'Fadiel_Adams' },
  { id: 'AJ',   name: 'Al Jama-ah',fullName: 'Al Jama-ah',                         color: '#2E7D32', seats2024:   2, leader: 'Ganief Hendricks',    wikiTitle: 'Ganief_Hendricks' },
  { id: 'BOSA', name: 'BOSA',      fullName: 'Build One South Africa',             color: '#0288D1', seats2024:   2, leader: 'Mmusi Maimane',       wikiTitle: 'Mmusi_Maimane' },
  { id: 'GOOD', name: 'GOOD',      fullName: 'Good Party',                         color: '#43A047', seats2024:   1, leader: 'Patricia de Lille',   wikiTitle: 'Patricia_de_Lille' },
  // PAC: Narius Moloto's presidency declared invalid; Mzwanele Nyhontso confirmed & re-elected Dec 2025
  { id: 'PAC',  name: 'PAC',       fullName: 'Pan Africanist Congress',            color: '#9C27B0', seats2024:   1, leader: 'Mzwanele Nyhontso',  wikiTitle: 'Mzwanele_Nyhontso' },
  // UAT: Wonder Mahlatsi is the president and sole MP (Mzwandile Maphanga was incorrect)
  { id: 'UAT',  name: 'UAT',       fullName: 'United Africans Transformation',     color: '#795548', seats2024:   1, leader: 'Wonder Mahlatsi',     wikiTitle: 'Wonder_Mahlatsi' },
];

const SA_PARTY_MAP = Object.fromEntries(SA_PARTIES.map(p => [p.id, p])) as Record<SaPartyId, SaParty>;
const SA_TOTAL_SEATS = 400;
const SA_MAJORITY = 201;

// Official 2024 IEC national results
const SA_VOTE_PCT_2024: Record<SaPartyId, number> = {
  ANC: 40.18, DA: 21.81, MK: 14.58, EFF: 9.52, IFP: 3.85, PA: 2.06,
  FFP: 1.36, ASA: 1.20, UDM: 0.49, ACDP: 0.60, RISE: 0.42, ATM: 0.40,
  BOSA: 0.41, AJ: 0.24, NCC: 0.23, PAC: 0.23, UAT: 0.22, GOOD: 0.18,
};
const SA_VOTE_RAW_2024: Record<SaPartyId, number> = {
  ANC: 6_459_683, DA: 3_505_735, MK: 2_344_309, EFF: 1_529_961,
  IFP:   618_207, PA:   330_425, FFP:   218_850, ASA:   192_373,
  UDM:    78_448, ACDP:  96_575, RISE:   67_975, ATM:    63_554,
  BOSA:   65_912, AJ:    39_067, NCC:    37_422, PAC:    36_716,
  UAT:    35_679, GOOD:  29_501,
};
const SA_GRAND_TOTAL_VOTES = 16_076_719;

// Official 2024 seat allocation (total = list + regional)
const SA_SEATS_2024: Record<SaPartyId, number> = {
  ANC: 159, DA: 87, MK: 58, EFF: 39, IFP: 17, PA: 9,
  FFP: 6,   ASA: 6, UDM: 3, ACDP: 3, RISE: 2, ATM: 2,
  NCC: 2,   AJ: 2,  BOSA: 2, GOOD: 1, PAC: 1, UAT: 1,
};

// ── Two-ballot system ─────────────────────────────────────────────────────────
// 200 seats from National Compensatory Ballot (national list, purely proportional)
// 200 seats from Regional Ballot (9 provinces, each apportioned by population)
const SA_LIST_SEATS_TOTAL = 200;
// SA_REG_SEATS_TOTAL = 200 — encoded in SA_REGIONAL_SEAT_QUOTA (sum = 200)

// Regional seat quotas: 200 seats split by province population (59,054,000 total)
const SA_REGIONAL_SEAT_QUOTA: Record<SaProvId, number> = {
  GP: 51, KZN: 39, WC: 24, EC: 22, LP: 20, MP: 16, NC: 4, NW: 14, FS: 10,
};

// 2026 Social Research Foundation polling (Feb–Mar 2026, n=2222)
// ANC 39, DA 28, MK 10, EFF 6, IFP 5 — others scaled proportionally to fill 12%
const POLL_2026_PCTS: Record<SaPartyId, number> = {
  ANC: 39.0, DA: 28.0, MK: 10.0, EFF: 6.0,  IFP: 5.0,
  PA:   3.1, FFP:  2.0, ASA: 1.8, ACDP: 0.9, UDM: 0.7,
  RISE: 0.6, BOSA: 0.6, ATM: 0.6, AJ:   0.4, NCC: 0.3,
  PAC:  0.3, UAT:  0.3, GOOD: 0.4,
};

type SaProvId = 'GP' | 'KZN' | 'WC' | 'EC' | 'LP' | 'MP' | 'NC' | 'NW' | 'FS';
type SaProvince = { id: SaProvId; name: string; pop: number; lat: number; lng: number; votes2024: number };

const SA_PROVINCES: SaProvince[] = [
  { id: 'GP',  name: 'Gauteng',       pop: 15_176_000, lat: -26.2, lng: 28.0, votes2024: 4_850_000 },
  { id: 'KZN', name: 'KwaZulu-Natal', pop: 11_514_000, lat: -29.1, lng: 30.7, votes2024: 3_600_000 },
  { id: 'WC',  name: 'Western Cape',  pop:  7_052_000, lat: -33.2, lng: 21.9, votes2024: 2_450_000 },
  { id: 'EC',  name: 'Eastern Cape',  pop:  6_498_000, lat: -32.3, lng: 26.4, votes2024: 1_900_000 },
  { id: 'LP',  name: 'Limpopo',       pop:  5_928_000, lat: -23.4, lng: 29.4, votes2024: 1_600_000 },
  { id: 'MP',  name: 'Mpumalanga',    pop:  4_679_000, lat: -25.6, lng: 30.5, votes2024: 1_380_000 },
  { id: 'NC',  name: 'Northern Cape', pop:  1_293_000, lat: -29.0, lng: 21.9, votes2024:   400_000 },
  { id: 'NW',  name: 'North West',    pop:  4_027_000, lat: -26.5, lng: 25.6, votes2024: 1_100_000 },
  { id: 'FS',  name: 'Free State',    pop:  2_887_000, lat: -28.5, lng: 26.8, votes2024:   850_000 },
];
const SA_PROV_MAP = Object.fromEntries(SA_PROVINCES.map(p => [p.id, p])) as Record<SaProvId, SaProvince>;


const SA_PROV_RESULTS_2024: Record<SaProvId, Record<SaPartyId, number>> = {
  //         ANC    DA    MK    EFF   IFP   PA    FFP   ASA   UDM  ACDP  RISE  ATM   NCC   AJ    BOSA  GOOD  PAC   UAT
  GP:  { ANC:35.0, DA:28.0, MK:11.0, EFF:12.0, IFP:3.0,  PA:4.5, FFP:2.0, ASA:2.5, UDM:0.5, ACDP:0.7, RISE:0.8, ATM:0.4, NCC:0.1, AJ:0.1, BOSA:0.5, GOOD:0.1, PAC:0.2, UAT:0.2 },
  KZN: { ANC:17.0, DA:9.0,  MK:45.0, EFF:6.0,  IFP:13.0, PA:2.0, FFP:1.0, ASA:1.0, UDM:0.5, ACDP:0.3, RISE:0.3, ATM:0.3, NCC:0.1, AJ:0.2, BOSA:0.3, GOOD:0.1, PAC:0.2, UAT:0.1 },
  WC:  { ANC:20.0, DA:56.0, MK:4.0,  EFF:5.0,  IFP:0.5,  PA:4.0, FFP:3.0, ASA:1.0, UDM:0.3, ACDP:1.0, RISE:2.0, ATM:0.2, NCC:1.5, AJ:0.8, BOSA:0.8, GOOD:0.7, PAC:0.2, UAT:0.2 },
  EC:  { ANC:56.0, DA:12.0, MK:10.0, EFF:12.0, IFP:0.5,  PA:2.0, FFP:0.4, ASA:0.5, UDM:2.5, ACDP:0.5, RISE:1.5, ATM:1.0, NCC:0.1, AJ:0.1, BOSA:0.3, GOOD:0.1, PAC:0.3, UAT:0.1 },
  LP:  { ANC:65.0, DA:5.0,  MK:10.0, EFF:13.0, IFP:0.5,  PA:1.0, FFP:0.4, ASA:0.5, UDM:1.0, ACDP:0.3, RISE:0.3, ATM:0.5, NCC:0.1, AJ:0.1, BOSA:0.2, GOOD:0.1, PAC:0.2, UAT:0.1 },
  MP:  { ANC:52.0, DA:10.0, MK:18.0, EFF:10.0, IFP:3.0,  PA:2.0, FFP:1.0, ASA:1.0, UDM:0.5, ACDP:0.3, RISE:0.3, ATM:0.4, NCC:0.1, AJ:0.1, BOSA:0.3, GOOD:0.1, PAC:0.2, UAT:0.1 },
  NC:  { ANC:47.0, DA:26.0, MK:8.0,  EFF:9.0,  IFP:0.3,  PA:5.0, FFP:2.0, ASA:1.0, UDM:0.2, ACDP:0.5, RISE:0.3, ATM:0.2, NCC:1.0, AJ:0.3, BOSA:0.3, GOOD:0.1, PAC:0.2, UAT:0.1 },
  NW:  { ANC:50.0, DA:13.0, MK:16.0, EFF:11.0, IFP:1.5,  PA:3.0, FFP:1.0, ASA:1.0, UDM:0.3, ACDP:0.3, RISE:0.3, ATM:0.5, NCC:0.1, AJ:0.1, BOSA:0.3, GOOD:0.1, PAC:0.2, UAT:0.1 },
  FS:  { ANC:55.0, DA:15.0, MK:11.0, EFF:13.0, IFP:0.5,  PA:2.0, FFP:1.0, ASA:0.8, UDM:0.3, ACDP:0.3, RISE:0.3, ATM:0.4, NCC:0.1, AJ:0.1, BOSA:0.3, GOOD:0.1, PAC:0.2, UAT:0.1 },
};

// Left-Right ordering for hemicycle
const SA_LR_ORDER: SaPartyId[] = ['EFF','ATM','PAC','MK','ANC','UDM','GOOD','AJ','NCC','RISE','BOSA','ASA','IFP','PA','ACDP','FFP','DA','UAT'];

// ── Seat calculation (D'Hondt) ─────────────────────────────────────────────────
function calcSeats(votePcts: Partial<Record<SaPartyId, number>>, totalSeats = SA_TOTAL_SEATS): Partial<Record<SaPartyId, number>> {
  const qualifying: Partial<Record<SaPartyId, number>> = {};
  let qualSum = 0;
  for (const [id, v] of Object.entries(votePcts) as [SaPartyId, number][]) {
    if ((v ?? 0) > 0) { qualifying[id] = v; qualSum += v; }
  }
  if (qualSum === 0) return {};
  const quotients: { id: SaPartyId; q: number }[] = [];
  for (const [id, v] of Object.entries(qualifying) as [SaPartyId, number][]) {
    for (let d = 1; d <= totalSeats; d++) quotients.push({ id, q: v / d });
  }
  quotients.sort((a, b) => b.q - a.q);
  const seats: Partial<Record<SaPartyId, number>> = {};
  for (let i = 0; i < Math.min(totalSeats, quotients.length); i++) {
    seats[quotients[i].id] = (seats[quotients[i].id] ?? 0) + 1;
  }
  return seats;
}

function calcProvVotes(natPcts: Record<SaPartyId, number>, provId: SaProvId): Record<SaPartyId, number> {
  const base = SA_PROV_RESULTS_2024[provId];
  const raw: Record<SaPartyId, number> = {} as Record<SaPartyId, number>;
  let total = 0;
  for (const p of SA_PARTIES) {
    // If a party has 0% nationally (excluded or set to 0 in sim), zero it at province
    // level too — don't let the 2024 base "carry" votes for absent parties.
    if ((natPcts[p.id] ?? 0) <= 0) { raw[p.id] = 0; continue; }
    const swing = (natPcts[p.id] ?? 0) - (SA_VOTE_PCT_2024[p.id] ?? 0);
    const v = Math.max(0, (base[p.id] ?? 0) + swing);
    raw[p.id] = v; total += v;
  }
  if (total === 0) return raw;
  // Renormalise so province shares still sum to 100%
  for (const p of SA_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
  return raw;
}

function calcPartialSeats(natPcts: Record<SaPartyId, number>, declaredProvs: Set<SaProvId>): Partial<Record<SaPartyId, number>> {
  if (declaredProvs.size === 0) return {};
  const weighted: Partial<Record<SaPartyId, number>> = {};
  let totalPop = 0;
  for (const provId of declaredProvs) {
    const prov = SA_PROV_MAP[provId]; if (!prov) continue;
    const rv = calcProvVotes(natPcts, provId);
    for (const p of SA_PARTIES) weighted[p.id] = (weighted[p.id] ?? 0) + (rv[p.id] ?? 0) * prov.pop;
    totalPop += prov.pop;
  }
  if (totalPop === 0) return {};
  const norm: Partial<Record<SaPartyId, number>> = {};
  for (const p of SA_PARTIES) norm[p.id] = (weighted[p.id] ?? 0) / totalPop;
  return calcSeats(norm);
}

/** Regional ballot: allocate 200 seats across 9 provinces by population quota, D'Hondt within each */
function calcRegSeats(
  natPcts: Record<SaPartyId, number>,
  overrides?: Record<string, Record<SaPartyId, number>>,
): Partial<Record<SaPartyId, number>> {
  const totals: Partial<Record<SaPartyId, number>> = {};
  for (const prov of SA_PROVINCES) {
    const provPcts = overrides?.[prov.id] ?? calcProvVotes(natPcts, prov.id);
    const provSeats = calcSeats(provPcts, SA_REGIONAL_SEAT_QUOTA[prov.id]);
    for (const [id, n] of Object.entries(provSeats) as [SaPartyId, number][]) {
      totals[id] = (totals[id] ?? 0) + n;
    }
  }
  return totals;
}

/** Merge two seat maps (list + regional → total) */
function mergeSeats(
  a: Partial<Record<SaPartyId, number>>,
  b: Partial<Record<SaPartyId, number>>,
): Partial<Record<SaPartyId, number>> {
  const result: Partial<Record<SaPartyId, number>> = {};
  for (const p of SA_PARTIES) {
    const sum = (a[p.id] ?? 0) + (b[p.id] ?? 0);
    if (sum > 0) result[p.id] = sum;
  }
  return result;
}

function redistributePcts(current: Record<SaPartyId, number>, changedId: SaPartyId, newRaw: number, locks: Set<SaPartyId>): Record<SaPartyId, number> {
  const ids = Object.keys(current) as SaPartyId[];
  const lockedSum = ids.filter(id => locks.has(id) && id !== changedId).reduce((s, id) => s + (current[id] ?? 0), 0);
  const clamped = Math.min(Math.max(newRaw, 0), 100 - lockedSum);
  const unlocked = ids.filter(id => !locks.has(id) && id !== changedId);
  const remaining = 100 - lockedSum - clamped;
  const unlockedSum = unlocked.reduce((s, id) => s + (current[id] ?? 0), 0);
  const next: Record<SaPartyId, number> = { ...current, [changedId]: clamped };
  if (unlockedSum > 0) for (const id of unlocked) next[id] = ((current[id] ?? 0) / unlockedSum) * remaining;
  else if (unlocked.length > 0) for (const id of unlocked) next[id] = remaining / unlocked.length;
  return next;
}

function partyColor(id: SaPartyId): string { return SA_PARTY_MAP[id]?.color ?? '#888'; }

function saRandNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
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

// ── HSL colour helpers (port of Germany's getWkFill logic) ────────────────────
function hexToHsl(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0,2),16)/255, g = parseInt(h.slice(2,4),16)/255, b = parseInt(h.slice(4,6),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (1 - Math.abs(2*l - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return [hue * 60, s, l];
}
function hslToHex(h: number, s: number, l: number): string {
  s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2*l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r=c; g=x; } else if (h < 120) { r=x; g=c; }
  else if (h < 180) { g=c; b=x; } else if (h < 240) { g=x; b=c; }
  else if (h < 300) { r=x; b=c; } else { r=c; b=x; }
  const toH = (n: number) => Math.round((n+m)*255).toString(16).padStart(2,'0');
  return `#${toH(r)}${toH(g)}${toH(b)}`;
}
/** Winner-colour fill scaled by margin — identical logic to Germany's getWkFill */
function getProvFill(color: string, margin: number, dark: boolean): string {
  const t = Math.min(Math.max(margin / 30, 0), 1);
  const [h, s] = hexToHsl(color);
  const newL = dark ? 0.55 - t * 0.29 : 0.82 - t * 0.46;
  return hslToHex(h, s, newL);
}

type ProvTooltipState = {
  x: number; y: number; name: string;
  parties: { id: SaPartyId; pct: number; raw: number }[];
  leader: SaPartyId | null;
  reportingPct?: number; // % of votes reported (from province panel slider)
} | null;

// ── Map controller (enforces smoothFactor:0 on zoom, like Germany) ────────────
function enforceNoSmooth(layer: L.GeoJSON) {
  layer.eachLayer((l) => { if ((l as L.Path).options) (l as L.Path & { options: { smoothFactor?: number } }).options.smoothFactor = 0; });
}
function MapController({ layerRef }: { layerRef: React.MutableRefObject<L.GeoJSON | null> }) {
  const map = useMap();
  useEffect(() => {
    const onZoom = () => { if (layerRef.current) enforceNoSmooth(layerRef.current); };
    map.on('zoomend', onZoom);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => { map.off('zoomend', onZoom); ro.disconnect(); };
  }, [map, layerRef]);
  return null;
}

// ── Choropleth: province GeoJSON, thin visible borders, coloured by winner ────
function SaChoroplethLayer({ natPcts, containerRef, setTooltip, onSelect, natPctsRef, declaredProvs, overrides, provReporting, dark }: {
  natPcts: Record<SaPartyId, number>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setTooltip: (t: ProvTooltipState) => void;
  onSelect: (id: SaProvId) => void;
  natPctsRef: React.MutableRefObject<Record<SaPartyId, number>>;
  overrides?: Record<string, Record<SaPartyId, number>>;
  provReporting?: Partial<Record<SaProvId, number>>;
  declaredProvs?: Set<SaProvId>;
  dark?: boolean;
}) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  // Mutable refs — updated before every setStyle/tooltip call so closures always read current values
  const declaredProvsRef  = useRef(declaredProvs);
  const overridesRef      = useRef(overrides);
  const provReportingRef  = useRef(provReporting);
  const darkRef           = useRef(dark);
  // Tracks the last hovered province so the tooltip can be rebuilt when data changes
  const lastHoverRef      = useRef<{ provId: SaProvId; clientX: number; clientY: number } | null>(null);

  const [geoData, setGeoData] = useState<GeoJSON.FeatureCollection | null>(null);
  useEffect(() => {
    fetch('/south-africa-province-outlines.geojson').then(r => r.json()).then(setGeoData).catch(() => {});
  }, []);

  // Stable style function — reads from mutable refs, never recreated
  const getFeatureStyle = useCallback((feature: GeoJSON.Feature | undefined): L.PathOptions => {
    const dk = darkRef.current ?? false;
    const borderColor = dk ? 'rgba(255,255,255,0.28)' : 'rgba(20,20,20,0.22)';
    const undeclaredFill = dk ? '#1e2a3a' : '#d1d5db';
    const provId = feature?.properties?.province_id as SaProvId | undefined;
    if (!provId) return { fillColor: undeclaredFill, fillOpacity: 0.55, weight: 0.5, color: borderColor, opacity: 1 };
    if (declaredProvsRef.current && !declaredProvsRef.current.has(provId)) {
      return { fillColor: undeclaredFill, fillOpacity: 0.55, weight: 0.5, color: borderColor, opacity: 1 };
    }
    const rv = overridesRef.current?.[provId] ?? calcProvVotes(natPctsRef.current, provId);
    const sorted = (Object.entries(rv) as [SaPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
    const winnerId = sorted[0]?.[0] as SaPartyId | undefined;
    const baseColor = winnerId ? partyColor(winnerId) : '#888';
    const margin = (sorted[0]?.[1] ?? 0) - (sorted[1]?.[1] ?? 0);
    return { fillColor: getProvFill(baseColor, margin, dk), fillOpacity: 0.88, weight: 0.5, color: borderColor, opacity: 1 };
  }, [natPctsRef]);

  // Hoisted tooltip builder — reads everything from refs so it's always current.
  // Called on mousemove AND by effect ② so the tooltip refreshes instantly after
  // a province's "Project Result" button is pressed (even without moving the mouse).
  const rebuildTooltip = useCallback(() => {
    const h = lastHoverRef.current;
    if (!h) return;
    const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
    const provVotes = SA_PROV_MAP[h.provId]?.votes2024 ?? 0;
    // Blank-map / simulation mode: declaredProvs is a Set (even if empty)
    const inEventMode = declaredProvsRef.current !== undefined;
    const storedRpt   = provReportingRef.current?.[h.provId];
    // Scale raw votes by the province's reporting % (matches what the slider panel shows)
    const reportingScale = (storedRpt ?? 100) / 100;
    const cur = overridesRef.current?.[h.provId] ?? calcProvVotes(natPctsRef.current, h.provId);
    const parties = (Object.entries(cur) as [SaPartyId, number][])
      .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a).slice(0, 6)
      .map(([id, pct]) => ({ id, pct, raw: Math.round(pct / 100 * reportingScale * provVotes) }));
    // In event mode (blank map / sim): always show % Reporting badge, defaulting to 0
    //   for provinces that haven't started reporting yet.
    // In polling / baseline mode: never show the badge.
    const reportingPct = inEventMode ? (storedRpt ?? 0) : undefined;
    setTooltip({
      x: h.clientX - rect.left, y: h.clientY - rect.top,
      name: SA_PROV_MAP[h.provId]?.name ?? h.provId,
      parties, leader: parties[0]?.id ?? null,
      reportingPct,
    });
  }, [containerRef, natPctsRef, setTooltip]); // all stable refs → callback never recreated

  // ① CREATE layer once — only when geoData changes
  useEffect(() => {
    if (!geoData) return;
    if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }

    const layer = L.geoJSON(geoData as GeoJSON.GeoJsonObject, {
      ...(({ smoothFactor: 0 }) as unknown as object),
      style: (feature) => getFeatureStyle(feature as GeoJSON.Feature),
      onEachFeature: (feature, lyr) => {
        const provId = (feature as GeoJSON.Feature)?.properties?.province_id as SaProvId | undefined;
        if (!provId) return;

        lyr.on('click', () => { setTooltip(null); lastHoverRef.current = null; onSelectRef.current(provId); });
        lyr.on('mouseover', (e: L.LeafletMouseEvent) => {
          if (lyr instanceof L.Path) lyr.setStyle({ fillOpacity: 0.98, weight: 1.2 });
          lastHoverRef.current = { provId, clientX: e.originalEvent.clientX, clientY: e.originalEvent.clientY };
          rebuildTooltip();
        });
        lyr.on('mousemove', (e: L.LeafletMouseEvent) => {
          lastHoverRef.current = { provId, clientX: e.originalEvent.clientX, clientY: e.originalEvent.clientY };
          rebuildTooltip();
        });
        lyr.on('mouseout', () => {
          if (lyr instanceof L.Path) layer.resetStyle(lyr);
          lastHoverRef.current = null;
          setTooltip(null);
        });
      },
    }).addTo(map);

    layerRef.current = layer;
    return () => { layer.remove(); layerRef.current = null; };
  }, [map, geoData]); // ← stable; rebuildTooltip/getFeatureStyle are also stable

  // ② UPDATE styles + refs — also re-fires tooltip so it reflects new data instantly
  useEffect(() => {
    declaredProvsRef.current  = declaredProvs;
    overridesRef.current      = overrides;
    provReportingRef.current  = provReporting;
    darkRef.current           = dark;
    if (layerRef.current) layerRef.current.setStyle((f) => getFeatureStyle(f as GeoJSON.Feature));
    rebuildTooltip(); // instant update if mouse is still over a province
  }, [natPcts, declaredProvs, overrides, provReporting, dark, getFeatureStyle, rebuildTooltip]);

  return null;
}


// ── Map view ───────────────────────────────────────────────────────────────────
function SaMapView({ natPcts, onSelect, dark, declaredProvs, overrides, provReporting }: {
  natPcts: Record<SaPartyId, number>; onSelect: (id: SaProvId) => void;
  dark: boolean; declaredProvs?: Set<SaProvId>;
  overrides?: Record<string, Record<SaPartyId, number>>;
  provReporting?: Partial<Record<SaProvId, number>>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<ProvTooltipState>(null);
  const natPctsRef = useRef(natPcts);
  const layerRef = useRef<L.GeoJSON | null>(null);
  useEffect(() => { natPctsRef.current = natPcts; }, [natPcts]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[-29, 25]} zoom={5} minZoom={2} maxZoom={13}
        style={{ width:'100%', height:'100%' }} zoomControl worldCopyJump={false}>
        <TileLayer key={dark ? 'dark' : 'light'}
          url={dark
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
          attribution='&copy; OpenStreetMap &copy; CARTO'
          subdomains="abcd" updateWhenZooming={false} updateWhenIdle maxZoom={20} />
        <MapController layerRef={layerRef} />
        {/* Choropleth always rendered */}
        <SaChoroplethLayer natPcts={natPcts} containerRef={containerRef}
          setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef}
          declaredProvs={declaredProvs} overrides={overrides}
          provReporting={provReporting} dark={dark} />
      </MapContainer>
      {tooltip && (() => {
        const cw = containerRef.current?.clientWidth ?? 9999;
        const TW = 248; const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const tt = {
          bg: dark ? 'rgba(18,24,44,0.96)' : 'rgba(255,255,255,0.97)',
          border: dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)',
          shadow: dark ? '0 6px 28px rgba(0,0,0,0.5)' : '0 6px 28px rgba(0,0,0,0.12)',
          title: dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)',
          body: dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.78)',
          sub: dark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.40)',
        };
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top: Math.max(6, tooltip.y - 20), width: TW }}>
            <div style={{ background:tt.bg, borderRadius:10, border:`1px solid ${tt.border}`, boxShadow:tt.shadow, backdropFilter:'blur(10px)', padding:'12px 14px' }}>
              <div style={{ fontSize:13, fontWeight:700, color:tt.title }}>{tooltip.name}</div>
              {tooltip.reportingPct !== undefined && (
                <div style={{ marginTop:4, display:'inline-flex', alignItems:'center', gap:4,
                  background:'rgba(245,158,11,0.13)', border:'1px solid rgba(245,158,11,0.30)',
                  borderRadius:4, padding:'2px 7px' }}>
                  <span style={{ width:5, height:5, borderRadius:'50%', background:'#f59e0b', flexShrink:0, display:'inline-block' }} />
                  <span style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', fontWeight:700,
                    color:'#d97706', letterSpacing:'0.08em', textTransform:'uppercase' }}>
                    {tooltip.reportingPct}% Reporting
                  </span>
                </div>
              )}
              <div style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', color:tt.sub, marginTop:tooltip.reportingPct !== undefined ? 2 : 2 }}>Provincial result · click to expand</div>
              <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:5 }}>
                {tooltip.parties.map(({ id, pct, raw }, i) => {
                  const c = partyColor(id);
                  return (
                    <div key={id} style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:8, height:8, borderRadius:2, flexShrink:0, background:c }} />
                      <span style={{ flex:1, fontSize:11, fontWeight:i===0?600:400, color:tt.body, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{SA_PARTY_MAP[id]?.name ?? id}</span>
                      <span style={{ fontSize:11, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color:c }}>{pct.toFixed(1)}%</span>
                      <span style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', color:tt.sub, minWidth:60, textAlign:'right' }}>{raw.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
      <div className="absolute bottom-2 right-2 text-[9.5px] text-ink-3 select-none z-[1000] font-mono">
        Scroll to zoom · Click province to open
      </div>
    </div>
  );
}

// ── Scoreboard tile — Germany dual-row style (NAT LIST + REGIONAL) ────────────
const SaScoreboardTile = React.memo(function SaScoreboardTile({ partyId, listSeats, regSeats, listPct, regPct, listRaw, regRaw, isLeader, isWinner, isBaseline }: {
  partyId: SaPartyId;
  listSeats: number; regSeats: number;
  listPct: number;   regPct: number;
  listRaw: number;   regRaw: number;
  isLeader: boolean; isWinner: boolean;
  isBaseline?: boolean;
}) {
  const party = SA_PARTY_MAP[partyId];
  // Show 2024-era leader on the baseline results dashboard; current leader everywhere else
  const leaderName  = (isBaseline && party.leader2024)   ? party.leader2024   : party.leader;
  const wikiTitle   = (isBaseline && party.wikiTitle2024 !== undefined) ? party.wikiTitle2024 : party.wikiTitle;

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!wikiTitle) { setPhotoUrl(null); return; }
    let cancelled = false;
    fetchWikiPhoto(wikiTitle).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [wikiTitle]);

  const initials = leaderName.split(' ').map((w: string) => w[0]).join('').slice(0, 2);
  const color = partyColor(partyId);
  const colorAlpha = hexToRgba(color, 0.13);

  return (
    <div
      className={`cand-col${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`}
      style={{ '--cand-color': color, '--cand-color-alpha': colorAlpha, borderColor: (isLeader || isWinner) ? color : hexToRgba(color, 0.30) } as React.CSSProperties}
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
      {/* Total seats — large number */}
      <span className="cand-seats">{listSeats + regSeats}</span>
      <span className="cand-party-name" title={party.fullName}>{party.fullName}</span>

      {/* NAT LIST row (top, prominent) — mirrors Germany's LIST/Zweitstimme row */}
      <div style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:1 }}>
        <span style={{ fontSize:6.5, fontFamily:'"JetBrains Mono",monospace', fontWeight:600, color:hexToRgba(color,0.48), letterSpacing:'0.10em', textTransform:'uppercase' }}>NAT LIST</span>
        <span style={{ fontSize:11, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color }}>{listPct.toFixed(1)}%</span>
      </div>
      <div style={{ width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:2 }}>
        <span style={{ fontSize:8, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color, opacity:0.75 }}>{listSeats}L</span>
        <span className="cand-votes-full" style={{ fontSize:8, fontFamily:'"JetBrains Mono",monospace', color:hexToRgba(color,0.55) }}>{listRaw.toLocaleString()}</span>
        <span className="cand-votes-compact" style={{ fontSize:8, fontFamily:'"JetBrains Mono",monospace', color:hexToRgba(color,0.55) }}>{fmtN(listRaw)}</span>
      </div>

      {/* Separator */}
      <div style={{ width:'100%', height:1, background:'var(--border-default,rgba(0,0,0,0.08))', marginBottom:2, opacity:0.6 }} />

      {/* REGIONAL row (dimmed) — mirrors Germany's ERST/Erststimme row */}
      <div style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:1, opacity:0.55 }}>
        <span style={{ fontSize:6.5, fontFamily:'"JetBrains Mono",monospace', fontWeight:600, color:hexToRgba(color,0.48), letterSpacing:'0.10em', textTransform:'uppercase' }}>REGIONAL</span>
        <span style={{ fontSize:10, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color }}>{regPct.toFixed(1)}%</span>
      </div>
      <div style={{ width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3, opacity:0.55 }}>
        <span style={{ fontSize:8, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color }}>{regSeats}R</span>
        <span className="cand-votes-full" style={{ fontSize:8, fontFamily:'"JetBrains Mono",monospace', color:hexToRgba(color,0.55) }}>{regRaw.toLocaleString()}</span>
        <span className="cand-votes-compact" style={{ fontSize:8, fontFamily:'"JetBrains Mono",monospace', color:hexToRgba(color,0.55) }}>{fmtN(regRaw)}</span>
      </div>

      {/* Colour bar */}
      <div className="cand-bar-track" style={{ width:'100%', height:3, borderRadius:2, background:'var(--bar-track)' }}>
        <div style={{ height:'100%', borderRadius:2, background:color, width:`${Math.min(listPct/45*100,100)}%`, transition:'width 0.3s ease' }} />
      </div>
    </div>
  );
}); // React.memo — prevents re-renders when seats/pcts haven't changed

// ── Scoreboard ─────────────────────────────────────────────────────────────────
const SaScoreboard = React.memo(function SaScoreboard({ natListPcts, natRegPcts, provOverrides, simTotalSeats, isBaseline, provReportedRawVotes }: {
  natListPcts: Record<SaPartyId, number>;
  natRegPcts: Record<SaPartyId, number>;
  provOverrides?: Record<string, Record<SaPartyId, number>>;
  simTotalSeats?: Partial<Record<SaPartyId, number>>;
  isBaseline?: boolean;
  /** Reporting-scaled raw vote totals from declared provinces (blank-map mode) */
  provReportedRawVotes?: Partial<Record<SaPartyId, number>>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const handler = (e: WheelEvent) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft += e.deltaY; };
    el.addEventListener('wheel', handler, { passive: false }); return () => el.removeEventListener('wheel', handler);
  }, []);

  // Compute list seats (200) and regional seats (200) separately
  const listSeatsMap = useMemo(() => {
    if (isBaseline) {
      // Approximate from official total: half list, half regional (proportional split)
      const computed = calcSeats(SA_VOTE_PCT_2024, SA_LIST_SEATS_TOTAL);
      return computed;
    }
    return calcSeats(natListPcts, SA_LIST_SEATS_TOTAL);
  }, [natListPcts, isBaseline]);

  const regSeatsMap = useMemo(() => {
    if (isBaseline) return calcRegSeats(SA_VOTE_PCT_2024);
    return calcRegSeats(natRegPcts, provOverrides);
  }, [natRegPcts, provOverrides, isBaseline]);

  const totalSeatsMap = useMemo(() => {
    if (simTotalSeats) return simTotalSeats;
    if (isBaseline) return SA_SEATS_2024 as Partial<Record<SaPartyId, number>>;
    return mergeSeats(listSeatsMap, regSeatsMap);
  }, [simTotalSeats, listSeatsMap, regSeatsMap, isBaseline]);

  const listPctTotal = Object.values(natListPcts).reduce((s, v) => s + v, 0);
  const regPctTotal  = Object.values(natRegPcts).reduce((s, v) => s + v, 0);

  // When provinces have been declared (blank-map / sim) use their reporting-scaled raw
  // totals to compute a meaningful regional-ballot percentage display.
  const totalProvRaw = useMemo(
    () => provReportedRawVotes
      ? Object.values(provReportedRawVotes).reduce((s, v) => s + v, 0)
      : 0,
    [provReportedRawVotes],
  );

  const sorted = useMemo(
    () => SA_PARTIES
      .filter(p =>
        (totalSeatsMap[p.id] ?? 0) > 0 ||
        (natListPcts[p.id] ?? 0) > 0 ||
        (provReportedRawVotes?.[p.id] ?? 0) > 0,   // include parties with raw votes from declared provinces
      )
      .sort((a, b) =>
        (totalSeatsMap[b.id] ?? 0) - (totalSeatsMap[a.id] ?? 0) ||
        (natListPcts[b.id] ?? 0) - (natListPcts[a.id] ?? 0) ||
        (provReportedRawVotes?.[b.id] ?? 0) - (provReportedRawVotes?.[a.id] ?? 0),
      ),
    [totalSeatsMap, natListPcts, provReportedRawVotes],
  );

  const leader = sorted[0]?.id ?? null;
  const winner = leader && (totalSeatsMap[leader] ?? 0) >= SA_MAJORITY ? leader : null;

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {sorted.map(party => {
            const lSeats = isBaseline
              ? Math.round((SA_SEATS_2024[party.id] ?? 0) * SA_LIST_SEATS_TOTAL / SA_TOTAL_SEATS)
              : (listSeatsMap[party.id] ?? 0);
            const rSeats = isBaseline
              ? (SA_SEATS_2024[party.id] ?? 0) - lSeats
              : (regSeatsMap[party.id] ?? 0);
            const listPct = listPctTotal > 0 ? (natListPcts[party.id] ?? 0) / listPctTotal * 100 : 0;
            // Derive regional % from actual reported raw votes when available (blank map / sim),
            // so the % column isn't misleadingly 0% while provinces are being declared.
            const regPct = provReportedRawVotes && totalProvRaw > 0
              ? (provReportedRawVotes[party.id] ?? 0) / totalProvRaw * 100
              : regPctTotal > 0 ? (natRegPcts[party.id] ?? 0) / regPctTotal * 100 : 0;
            const listRaw = isBaseline
              ? Math.round((SA_VOTE_RAW_2024[party.id] ?? 0))
              : Math.round((natListPcts[party.id] ?? 0) / 100 * SA_GRAND_TOTAL_VOTES);
            const regRaw = isBaseline
              ? Math.round((SA_VOTE_RAW_2024[party.id] ?? 0))
              : provReportedRawVotes
                ? (provReportedRawVotes[party.id] ?? 0)
                : Math.round((natRegPcts[party.id] ?? 0) / 100 * SA_GRAND_TOTAL_VOTES);
            return (
              <SaScoreboardTile key={party.id} partyId={party.id}
                listSeats={lSeats} regSeats={rSeats}
                listPct={listPct} regPct={regPct}
                listRaw={listRaw} regRaw={regRaw}
                isLeader={party.id === leader && !winner}
                isWinner={party.id === winner}
                isBaseline={isBaseline} />
            );
          })}
        </div>
      </div>
    </div>
  );
}); // React.memo

// ── Province panel — WahlkreisPanel style (sliders + lock + edit + delta + ref) ─
function SaProvPanel({ provId, natPcts, onUpdate, onClose, onDeclare, onReportingChange, activeParties, dark, override, storedReportingPct }: {
  provId: SaProvId; natPcts: Record<SaPartyId, number>;
  onUpdate: (id: SaProvId, pcts: Record<SaPartyId, number>) => void;
  /** Called when "Project Result" is clicked — declares this province on the map */
  onDeclare?: (pcts: Record<SaPartyId, number>, reportingPct: number) => void;
  /** Called on every % Reporting slider change so tooltip refreshes live */
  onReportingChange?: (pct: number) => void;
  activeParties: Set<SaPartyId>;
  onClose: () => void; dark?: boolean;
  override?: Record<SaPartyId, number>;
  /** Last saved % Reporting for this province — restored when re-opening the panel */
  storedReportingPct?: number;
}) {
  const initFromNat = useCallback((): Record<SaPartyId, number> => {
    if (override) return { ...override };
    const rv = calcProvVotes(natPcts, provId);
    return Object.fromEntries(SA_PARTIES.map(p => [p.id, rv[p.id] ?? 0])) as Record<SaPartyId, number>;
  }, [override, natPcts, provId]);

  const [pcts, setPcts]               = useState<Record<SaPartyId, number>>(initFromNat);
  const [locks, setLocks]             = useState<Set<SaPartyId>>(new Set());
  const [editId, setEditId]           = useState<SaPartyId | null>(null);
  const [editVal, setEditVal]         = useState('');
  const [showRef, setShowRef]         = useState(false);
  const [reportingPct, setReportingPct] = useState(100);
  const pctsRef = useRef(pcts);
  useEffect(() => { pctsRef.current = pcts; }, [pcts]);

  // Keep a stable ref to onReportingChange so the province-change effect doesn't need it as a dep
  const onReportingChangeRef = useRef(onReportingChange);
  useEffect(() => { onReportingChangeRef.current = onReportingChange; }, [onReportingChange]);

  // Re-init when province changes — restore the saved reporting % instead of resetting to 100.
  // Don't push anything to the parent here; only "Project Result" commits data upstream.
  useEffect(() => {
    setPcts(initFromNat()); setLocks(new Set()); setEditId(null);
    setReportingPct(storedReportingPct ?? 100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provId]);

  function applyChange(id: SaPartyId, val: number) {
    // Lock inactive parties at 0 so redistribution never spills into them
    const effectiveLocks = new Set([...locks, ...SA_PARTIES.map(p => p.id).filter(pid => !activeParties.has(pid))]);
    const next = redistributePcts(pctsRef.current, id, val, effectiveLocks);
    pctsRef.current = next; setPcts(next);
    // On blank map (onDeclare defined) sliders are draft-only — commit happens on "Project Result".
    // On polling/baseline (onDeclare undefined) live-update the map.
    if (!onDeclare) onUpdate(provId, next);
  }
  function toggleLock(id: SaPartyId) {
    setLocks(prev => {
      const next = new Set(prev);
      const activeUnlocked = sorted.filter(p => !next.has(p.id) && p.id !== id);
      if (!next.has(id) && activeUnlocked.length < 1) return prev;
      next.has(id) ? next.delete(id) : next.add(id); return next;
    });
  }
  function commitEdit(id: SaPartyId, raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) applyChange(id, Math.max(0, Math.min(100, n)));
    setEditId(null); setEditVal('');
  }

  // Show all active parties sorted by current %, even if at 0 (important for blank map)
  const sorted = useMemo(
    () => SA_PARTIES.filter(p => activeParties.has(p.id))
      .map(p => ({ ...p, pct: pcts[p.id] ?? 0 }))
      .sort((a, b) => b.pct - a.pct),
    [pcts, activeParties],
  );
  const prov = SA_PROV_MAP[provId];
  const winner = sorted.find(p => p.pct > 0);
  const baseline2024 = SA_PROV_RESULTS_2024[provId];
  const pctSum = sorted.reduce((s, p) => s + p.pct, 0);
  const totalVotes = prov?.votes2024 ?? 0;

  return (
    <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      {/* Header */}
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold text-ink leading-tight truncate">{prov?.name ?? provId}</h2>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {override ? 'Custom result' : 'Estimated result'} · click % to edit
            </p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        {winner && (
          <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-[4px] border" style={{ borderColor:`${winner.color}33` }}>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: winner.color }} />
            <span className="text-[11px] font-medium text-ink flex-1 truncate">{winner.fullName}</span>
            <span className="text-[9px] font-mono text-ink-3">{winner.pct.toFixed(1)}%</span>
          </div>
        )}

        {/* % Reporting slider — only in blank-map / election-night mode */}
        {onDeclare && (
          <div className="mt-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[8.5px] font-mono font-bold uppercase tracking-[0.12em] text-ink-3">% Reporting</span>
              <span className="text-[9px] font-mono font-bold tabular-nums"
                style={{ color: reportingPct === 100 ? '#16a34a' : '#f59e0b' }}>
                {reportingPct}%
              </span>
            </div>
            <input type="range" min={0} max={100} step={1} value={reportingPct}
              onChange={e => setReportingPct(Number(e.target.value))}
              className="party-slider w-full"
              style={{ '--party-color': reportingPct === 100 ? '#16a34a' : '#f59e0b', '--pct': `${reportingPct}%` } as React.CSSProperties} />
            <div className="flex justify-between mt-0.5">
              <span className="text-[7.5px] font-mono text-ink-3">0%</span>
              <span className="text-[7.5px] font-mono text-ink-3 tabular-nums">
                {Math.round(reportingPct / 100 * totalVotes).toLocaleString()} votes counted
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Sliders — all active parties always shown */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">
        {sorted.map(p => {
          const pct = pcts[p.id] ?? 0;
          const isLocked = locks.has(p.id);
          const base2024 = baseline2024?.[p.id] ?? 0;
          const delta = pct - base2024;
          const rawVotes = Math.round(pct / 100 * reportingPct / 100 * totalVotes);
          return (
            <div key={p.id}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{p.fullName}</span>
                {/* Lock */}
                <button onClick={() => toggleLock(p.id)} title={isLocked ? 'Unlock' : 'Lock'}
                  className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked ? 'text-gold' : 'text-ink-3 hover:text-ink'}`}>
                  {isLocked
                    ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                    : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                  }
                </button>
                {/* Editable % */}
                {editId === p.id ? (
                  <input type="number" min={0} max={100} step={0.1} value={editVal} autoFocus
                    className="w-12 h-5 text-[10px] font-mono font-semibold tabular-nums text-right px-1 rounded border border-default focus:outline-none focus:border-ink-3 bg-white text-ink-2"
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={() => commitEdit(p.id, editVal)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(p.id, editVal); } if (e.key === 'Escape') { setEditId(null); setEditVal(''); } }} />
                ) : (
                  <span onClick={() => { if (!isLocked) { setEditId(p.id); setEditVal(pct.toFixed(1)); } }}
                    className="text-[10px] font-mono font-semibold text-ink-2 tabular-nums min-w-[38px] text-right leading-none"
                    style={{ cursor: isLocked ? 'default' : 'text', color: p.color }}>
                    {pct.toFixed(1)}%
                  </span>
                )}
              </div>
              <input type="range" min={0} max={75} step={0.1} value={pct} disabled={isLocked}
                onChange={e => applyChange(p.id, parseFloat(e.target.value))}
                className="party-slider w-full"
                style={{ '--party-color': p.color, '--pct': `${(pct / 75) * 100}%` } as React.CSSProperties} />
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[8px] font-mono tabular-nums text-ink-3">{rawVotes.toLocaleString()} votes</span>
                {Math.abs(delta) > 0.05 && (
                  <span className={`text-[8px] font-mono tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {delta > 0 ? '+' : ''}{delta.toFixed(1)}pp
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Reference section (2024 baseline) */}
        <div className="pt-2 border-t border-default">
          <button onClick={() => setShowRef(v => !v)}
            className="flex items-center gap-1.5 w-full text-left text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 hover:text-ink transition-colors mb-1">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d={showRef ? 'M1 6l3-4 3 4' : 'M1 2l3 4 3-4'} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            2024 Reference
          </button>
          {showRef && (
            <div className="space-y-1 mt-1.5">
              {[...SA_PARTIES].sort((a, b) => (baseline2024[b.id] ?? 0) - (baseline2024[a.id] ?? 0))
                .filter(p => (baseline2024[p.id] ?? 0) >= 0.1)
                .map(p => {
                  const refPct = baseline2024[p.id] ?? 0;
                  const curPct = pcts[p.id] ?? 0;
                  const d = curPct - refPct;
                  return (
                    <div key={p.id} className="flex items-center gap-1.5">
                      <span style={{ width:6, height:6, borderRadius:1, background:p.color, flexShrink:0, display:'inline-block' }} />
                      <span className="text-[9px] text-ink-3 flex-1 truncate">{p.name}</span>
                      <span className="text-[9px] font-mono text-ink-3 tabular-nums">{refPct.toFixed(1)}%</span>
                      {Math.abs(d) > 0.05 && (
                        <span className={`text-[8px] font-mono tabular-nums ${d > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {d > 0 ? '+' : ''}{d.toFixed(1)}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Province stats + reset */}
        <div className="pt-2 border-t border-default space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[8px] font-mono text-ink-3 uppercase tracking-wide mb-0.5">Population</div>
              <div className="text-[10px] font-mono font-semibold text-ink">{prov?.pop.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[8px] font-mono text-ink-3 uppercase tracking-wide mb-0.5">2024 Votes</div>
              <div className="text-[10px] font-mono font-semibold text-ink">{prov?.votes2024.toLocaleString()}</div>
            </div>
          </div>
          {override && (
            <button onClick={() => {
              const rv = calcProvVotes(natPcts, provId);
              const reset = Object.fromEntries(SA_PARTIES.map(p => [p.id, rv[p.id] ?? 0])) as Record<SaPartyId, number>;
              setPcts(reset); setLocks(new Set());
              if (!onDeclare) onUpdate(provId, reset);
            }} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
              Reset to Estimate
            </button>
          )}
        </div>
      </div>

      {/* Project Result footer — declares this province on the map */}
      {onDeclare && (() => {
        const canDeclare = pctSum > 0.5;
        return (
          <div className="px-3.5 py-2.5 border-t border-default shrink-0">
            <button
              onClick={() => {
                if (!canDeclare) return;
                // Normalise to 100% if sliders don't yet sum to 100
                let projected: Record<SaPartyId, number> = { ...pcts };
                if (Math.abs(pctSum - 100) > 0.5) {
                  for (const p of SA_PARTIES) projected[p.id] = (pcts[p.id] ?? 0) / pctSum * 100;
                }
                onDeclare(projected, reportingPct);
              }}
              disabled={!canDeclare}
              className={`w-full py-2 text-[11px] font-mono font-bold rounded-[4px] border transition-colors ${
                canDeclare
                  ? 'border-blue-500 text-blue-500 hover:bg-blue-500 hover:text-white'
                  : 'border-default text-ink-3 cursor-not-allowed opacity-50'
              }`}>
              ⊞ Project Result
            </button>
          </div>
        );
      })()}
    </aside>
  );
}

// ── Parliament hemicycle — fixed 12-row geometry matching Germany ──────────────
function SaParliamentPanel({ seats: seatsMap, onClose, exiting, dark }: {
  seats: Partial<Record<SaPartyId, number>>; onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const seatColors: string[] = [];
  const legend: { id: SaPartyId; count: number; color: string }[] = [];
  for (const id of SA_LR_ORDER) {
    const n = seatsMap[id] ?? 0; if (n === 0) continue;
    const color = partyColor(id);
    legend.push({ id, count: n, color });
    for (let i = 0; i < n; i++) seatColors.push(color);
  }
  const totalSeats = seatColors.length;

  // Geometry — 12 rows like Germany (innerR=58, rowSpacing=8, seatR=2.7)
  const W = 310, H = 178, cx = W / 2, cy = H - 5;
  const innerR = 58, rowSpacing = 8, rows = 12, seatR = 2.7;
  const arcLengths = Array.from({ length: rows }, (_, i) => Math.PI * (innerR + i * rowSpacing));
  const totalArc = arcLengths.reduce((s, v) => s + v, 0);
  const floors = arcLengths.map(a => Math.floor((a / totalArc) * SA_TOTAL_SEATS));
  const remainder = SA_TOTAL_SEATS - floors.reduce((s, v) => s + v, 0);
  arcLengths.map((a, i) => ({ i, frac: (a / totalArc) * SA_TOTAL_SEATS - floors[i] }))
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
  // Sort: descending angle (left→right), then inner row first (like Germany)
  rawPos.sort((a, b) => b.θ - a.θ || a.r - b.r);

  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-r border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit-left' : 'panel-slide-left'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">National Assembly</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">{totalSeats} seats · majority {SA_MAJORITY} · no threshold</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll">
        {totalSeats === 0
          ? <div className="flex items-center justify-center h-40 text-ink-3 text-[11px] font-mono px-4 text-center">Load results or run simulation first</div>
          : <>
            <div className="px-2.5 pt-5 pb-1">
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
                {/* Centre axis dashes */}
                <line x1={cx} y1={cy - innerR + 4} x2={cx} y2={cy - (innerR + (rows-1)*rowSpacing) - 8}
                  stroke="rgba(0,0,0,0.10)" strokeWidth="1" strokeDasharray="3,3" />
                {/* Majority arc marker */}
                <text x={cx + 2} y={cy - innerR - 4} fontSize="7" fontFamily="monospace" fill="rgba(0,0,0,0.28)" textAnchor="middle">201</text>
                {rawPos.map(({ x, y }, i) => (
                  <circle key={i} cx={x} cy={y} r={seatR}
                    fill={i < seatColors.length ? seatColors[i] : (dark ? '#374151' : '#e5e7eb')} />
                ))}
              </svg>
            </div>
            <div className="px-3.5 pb-4">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {legend.map(({ id, count, color }) => (
                  <div key={id} className="flex items-center gap-1.5">
                    <div style={{ width:9, height:9, borderRadius:2, background:color, flexShrink:0 }} />
                    <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">{SA_PARTY_MAP[id].name}</span>
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
const SA_PRESET_COALITIONS: { name: string; emoji: string; parties: SaPartyId[] }[] = [
  { name: 'GNU (Current)',      emoji: '🇿🇦', parties: ['ANC','DA','IFP','PA','FFP','ASA','UDM','RISE','ACDP','BOSA','GOOD','PAC'] },
  { name: 'ANC + MK + EFF',    emoji: '✊',  parties: ['ANC','MK','EFF'] },
  { name: 'DA-Led Opposition',  emoji: '🔵', parties: ['DA','IFP','FFP','ASA','RISE','PA','BOSA'] },
  { name: 'ANC + MK',          emoji: '🤝', parties: ['ANC','MK'] },
];

function SaCoalitionPanel({ seats, onClose, exiting, dark }: {
  seats: Partial<Record<SaPartyId, number>>; onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const [selected, setSelected] = useState<Set<SaPartyId>>(
    new Set(['ANC','DA','IFP','PA','FFP','ASA','UDM','RISE','ACDP','BOSA','GOOD','PAC'])
  );
  const toggle = (id: SaPartyId) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const totalCoalSeats = [...selected].reduce((s, id) => s + (seats[id] ?? 0), 0);
  const hasMajority = totalCoalSeats >= SA_MAJORITY;

  return (
    <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Coalition Builder</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Majority: {SA_MAJORITY} seats · {SA_TOTAL_SEATS} total</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="px-3.5 pt-3 pb-2 border-b border-default shrink-0">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {SA_PRESET_COALITIONS.map(coal => (
            <button key={coal.name} onClick={() => setSelected(new Set(coal.parties))}
              className="text-left px-2 py-1.5 rounded-[4px] border border-default hover:bg-hover transition-colors">
              <div className="text-[8px] font-bold text-ink truncate">{coal.emoji} {coal.name}</div>
              <div className="text-[7px] font-mono text-ink-3 truncate">{coal.parties.map(id => SA_PARTY_MAP[id]?.name).join(' + ')}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Toggle Parties</div>
        <div className="space-y-1.5">
          {SA_LR_ORDER.map(id => {
            const party = SA_PARTY_MAP[id]; const s = seats[id] ?? 0;
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
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width:`${Math.min(totalCoalSeats/SA_TOTAL_SEATS*100,100)}%`, background: hasMajority ? '#16a34a' : '#ef4444' }} />
        </div>
        <div className={`mt-1.5 text-[9px] font-mono text-center font-bold ${hasMajority ? 'text-emerald-600' : 'text-red-500'}`}>
          {hasMajority ? `✓ MAJORITY (need ${SA_MAJORITY})` : `✗ ${SA_MAJORITY - totalCoalSeats} seats short of majority`}
        </div>
      </div>
    </aside>
  );
}

// ── Breakdown panel — per-province results table + national seat bar ───────────
function SaBreakdownPanel({ natPcts, displaySeats, onClose, exiting, dark }: {
  natPcts: Record<SaPartyId, number>;
  displaySeats: Partial<Record<SaPartyId, number>>;
  onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const seatsSorted = SA_PARTIES
    .filter(p => (displaySeats[p.id] ?? 0) > 0)
    .sort((a, b) => (displaySeats[b.id] ?? 0) - (displaySeats[a.id] ?? 0));
  const totalDisplayed = seatsSorted.reduce((s, p) => s + (displaySeats[p.id] ?? 0), 0);

  // Majority line position
  const majPct = (SA_MAJORITY / SA_TOTAL_SEATS) * 100;

  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Province Breakdown</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">{SA_TOTAL_SEATS} seats · majority {SA_MAJORITY}</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      {/* National seat bar */}
      <div className="px-3.5 py-3 border-b border-default shrink-0">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">
          National Assembly — {totalDisplayed} / {SA_TOTAL_SEATS} seats
        </div>
        {/* Stacked seat bar */}
        <div className="relative h-5 rounded overflow-hidden flex gap-px">
          {seatsSorted.map(p => (
            <div key={p.id}
              style={{ flex: displaySeats[p.id] ?? 0, background: p.color, minWidth: 0 }}
              title={`${p.name}: ${displaySeats[p.id]}`} />
          ))}
          {/* Majority marker */}
          <div className="absolute top-0 bottom-0 w-px bg-white/80 z-10"
            style={{ left: `${majPct}%` }} />
          <div className="absolute top-0 text-[7px] font-mono text-white/80 font-bold z-10"
            style={{ left: `${majPct + 0.5}%` }}>201</div>
        </div>
        {/* Mini legend */}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {seatsSorted.map(p => (
            <div key={p.id} className="flex items-center gap-1">
              <div style={{ width:6, height:6, borderRadius:1, background:p.color, flexShrink:0 }} />
              <span className="text-[8px] font-mono text-ink-3">{p.name}</span>
              <span className="text-[8px] font-mono font-bold text-ink">{displaySeats[p.id]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Province rows */}
      <div className="flex-1 overflow-y-auto thin-scroll divide-y divide-default">
        {SA_PROVINCES.map(prov => {
          const rv = calcProvVotes(natPcts, prov.id);
          const sorted = (Object.entries(rv) as [SaPartyId, number][])
            .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
          const winnerId  = sorted[0]?.[0] as SaPartyId;
          const winPct    = sorted[0]?.[1] ?? 0;
          const runner1Id = sorted[1]?.[0] as SaPartyId;
          const runner1Pct= sorted[1]?.[1] ?? 0;
          const runner2Id = sorted[2]?.[0] as SaPartyId;
          const runner2Pct= sorted[2]?.[1] ?? 0;
          const margin    = winPct - runner1Pct;
          const winColor  = winnerId ? partyColor(winnerId) : '#888';

          return (
            <div key={prov.id} className="px-3.5 py-3">
              {/* Province name + votes */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-ink">{prov.name}</span>
                <span className="text-[8px] font-mono text-ink-3">{(prov.votes2024 / 1_000_000).toFixed(2)}M votes</span>
              </div>
              {/* Winner row */}
              <div className="flex items-center gap-2 mb-1">
                <div style={{ width:10, height:10, borderRadius:2, background:winColor, flexShrink:0 }} />
                <span className="text-[11px] font-bold" style={{ color: winColor }}>
                  {SA_PARTY_MAP[winnerId]?.name ?? '—'}
                </span>
                <span className="text-[11px] font-mono font-bold" style={{ color: winColor }}>
                  {winPct.toFixed(1)}%
                </span>
                <span className="text-[8.5px] font-mono text-ink-3 ml-auto">+{margin.toFixed(1)}pp</span>
              </div>
              {/* Runner-ups */}
              <div className="flex items-center gap-4">
                {[{ id: runner1Id, pct: runner1Pct }, { id: runner2Id, pct: runner2Pct }]
                  .filter(x => x.id)
                  .map(({ id, pct }) => (
                  <div key={id} className="flex items-center gap-1">
                    <span style={{ width:6, height:6, borderRadius:1, background:partyColor(id), flexShrink:0, display:'inline-block' }} />
                    <span className="text-[8.5px] font-mono text-ink-3">{SA_PARTY_MAP[id]?.name}</span>
                    <span className="text-[8.5px] font-mono text-ink-3">{pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
              {/* Win margin bar */}
              <div className="mt-1.5 h-1 rounded-full overflow-hidden"
                style={{ background: dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)' }}>
                <div className="h-full rounded-full transition-all duration-300"
                  style={{ width:`${Math.min(winPct / 70 * 100, 100)}%`, background: winColor }} />
              </div>
            </div>
          );
        })}
        <div className="px-3.5 py-3">
          <p className="text-[9px] font-mono text-ink-3 leading-relaxed">
            Provincial results are estimated by applying the national swing to 2024 IEC baseline figures.
            Click any province on the map to see the full breakdown and adjust sliders.
          </p>
        </div>
      </div>
    </aside>
  );
}

// ── Simulation panel — Germany DeSimulationPanel style ────────────────────────
function SaSimulationPanel({ onStart, onClose, simRunning, simProgress, stopSim, natPcts, activeParties, dark }: {
  onStart: (pcts: Record<SaPartyId, number>, durationMs: number) => void;
  onClose: () => void;
  simRunning: boolean;
  simProgress: number;
  stopSim: () => void;
  natPcts: Record<SaPartyId, number>;
  activeParties: Set<SaPartyId>;
  dark?: boolean;
}) {
  const [pcts, setPcts]       = useState<Record<SaPartyId, number>>(() => ({ ...natPcts }));
  const [locks, setLocks]     = useState<Set<SaPartyId>>(new Set());
  const [editId, setEditId]   = useState<SaPartyId | null>(null);
  const [editVal, setEditVal] = useState('');
  const [duration, setDuration] = useState(60_000); // 1 minute default

  const pctsRef  = useRef(pcts);
  const locksRef = useRef(locks);
  useEffect(() => { pctsRef.current = pcts; }, [pcts]);
  useEffect(() => { locksRef.current = locks; }, [locks]);

  // Sync when parent's activeParties or natPcts changes (e.g. preset switch or party toggled)
  useEffect(() => {
    setPcts(prev => {
      const next = { ...prev };
      for (const p of SA_PARTIES) {
        if (!activeParties.has(p.id)) next[p.id] = 0;
        else if ((natPcts[p.id] ?? 0) !== (prev[p.id] ?? 0)) next[p.id] = natPcts[p.id] ?? 0;
      }
      return next;
    });
    setLocks(prev => { const n = new Set(prev); for (const id of [...n]) { if (!activeParties.has(id)) n.delete(id); } return n; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeParties]);

  // Only count active parties for sum check
  const pctSum = useMemo(
    () => SA_PARTIES.filter(p => activeParties.has(p.id)).reduce((s, p) => s + (pcts[p.id] ?? 0), 0),
    [pcts, activeParties],
  );
  const sumOk  = Math.abs(pctSum - 100) < 0.5;
  const canPlay = sumOk && !simRunning;

  // Only show active parties in slider list
  const sorted = useMemo(
    () => SA_PARTIES.filter(p => activeParties.has(p.id)).sort((a, b) => (pcts[b.id] ?? 0) - (pcts[a.id] ?? 0)),
    [pcts, activeParties],
  );

  function applyChange(id: SaPartyId, val: number) {
    // Also lock out inactive parties so their 0% stays 0%
    const effectiveLocks = new Set([...locksRef.current, ...SA_PARTIES.map(p => p.id).filter(pid => !activeParties.has(pid))]);
    const next = redistributePcts(pctsRef.current, id, val, effectiveLocks);
    pctsRef.current = next; setPcts(next);
  }
  function toggleLock(id: SaPartyId) {
    setLocks(prev => {
      const next = new Set(prev);
      if (!next.has(id) && sorted.filter(p => !next.has(p.id) && p.id !== id).length < 1) return prev;
      next.has(id) ? next.delete(id) : next.add(id); return next;
    });
  }
  function commitEdit(id: SaPartyId, raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) applyChange(id, Math.max(0, Math.min(100, n)));
    setEditId(null); setEditVal('');
  }

  const DURATIONS = [
    { label: '30s', ms: 30_000 }, { label: '1m', ms: 60_000 },
    { label: '2m', ms: 120_000 }, { label: '5m', ms: 300_000 },
  ];

  return (
    <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      {/* Header */}
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-bold text-ink leading-tight">Election Night</h1>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">South Africa Simulation</p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-4">
        {/* Vote share sliders */}
        <div>
          <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-ink-3 mb-2">
            Vote Shares
          </div>
          <div className="space-y-3">
            {sorted.map(party => {
              const pct = pcts[party.id] ?? 0;
              const base = SA_VOTE_PCT_2024[party.id] ?? 0;
              const delta = pct - base;
              const isLocked = locks.has(party.id);
              const color = partyColor(party.id);
              const rawVotes = Math.round(pct / 100 * SA_GRAND_TOTAL_VOTES);
              return (
                <div key={party.id}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{party.fullName}</span>
                    {/* Lock */}
                    <button onClick={() => toggleLock(party.id)} title={isLocked ? 'Unlock' : 'Lock'}
                      className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked ? 'text-gold' : 'text-ink-3 hover:text-ink'}`}>
                      {isLocked
                        ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                        : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                      }
                    </button>
                    {/* Editable % */}
                    {editId === party.id ? (
                      <input type="number" min={0} max={100} step={0.1} value={editVal} autoFocus
                        className="w-12 h-5 text-[10px] font-mono font-semibold tabular-nums text-right px-1 rounded border border-default focus:outline-none focus:border-ink-3 bg-white text-ink-2"
                        onChange={e => setEditVal(e.target.value)}
                        onBlur={() => commitEdit(party.id, editVal)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(party.id, editVal); } if (e.key === 'Escape') { setEditId(null); setEditVal(''); } }} />
                    ) : (
                      <span onClick={() => { if (!isLocked) { setEditId(party.id); setEditVal(pct.toFixed(1)); } }}
                        className="text-[10px] font-mono font-semibold tabular-nums min-w-[38px] text-right leading-none"
                        style={{ color, cursor: isLocked ? 'default' : 'text' }}>
                        {pct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <input type="range" min={0} max={60} step={0.1} value={pct} disabled={isLocked}
                    onChange={e => applyChange(party.id, parseFloat(e.target.value))}
                    className="party-slider w-full"
                    style={{ '--party-color': color, '--pct': `${(pct / 60) * 100}%` } as React.CSSProperties} />
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[8px] font-mono tabular-nums text-ink-3">{fmtN(rawVotes)} votes</span>
                    {Math.abs(delta) > 0.05 && (
                      <span className={`text-[8px] font-mono tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(1)}pp vs 2024
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Sum check */}
          <div className={`text-[8.5px] font-mono font-bold text-right pt-2 border-t border-default mt-2 ${sumOk ? 'text-emerald-600' : 'text-red-500'}`}>
            Total: {pctSum.toFixed(1)}%
          </div>
        </div>

        {/* Duration picker */}
        <div>
          <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-ink-3 mb-2">Duration</div>
          <div className="flex gap-1.5">
            {DURATIONS.map(d => (
              <button key={d.label} onClick={() => setDuration(d.ms)} disabled={simRunning}
                className={`flex-1 py-1.5 text-[9.5px] font-mono rounded-[4px] border transition-colors ${duration === d.ms ? 'bg-gold text-white border-gold' : 'border-default text-ink-3 hover:bg-hover disabled:opacity-40'}`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Progress bar */}
        {simRunning && (
          <div>
            <div className="text-[9px] font-mono text-ink-3 mb-1">{simProgress} / {SA_PROVINCES.length} provinces reporting</div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.07)' }}>
              <div className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${(simProgress / SA_PROVINCES.length) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Run / Stop / Project */}
      <div className="px-3.5 py-2.5 border-t border-default shrink-0 space-y-1.5">
        {simRunning
          ? <button onClick={stopSim}
              className="w-full py-2 text-[11px] font-mono font-bold rounded-[4px] bg-red-600 text-white hover:bg-red-700 transition-colors">
              ■ Stop Simulation
            </button>
          : <>
              <button onClick={() => { if (canPlay) onStart(pcts, duration); }} disabled={!canPlay}
                className={`w-full py-2 text-[11px] font-mono font-bold rounded-[4px] transition-colors ${canPlay ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-ink/10 text-ink-3 cursor-not-allowed'}`}>
                {!sumOk ? '⚠ Shares must sum to 100%' : '▶ Run Simulation'}
              </button>
            </>
        }
      </div>
    </aside>
  );
}

// ── National List Panel — like Germany's ZweitstimmenPanel ────────────────────
function SaListPanel({ natListPcts, onListPctsChange, regSeatsMap, activeParties, onClose, onProject, exiting, dark }: {
  natListPcts: Record<SaPartyId, number>;
  /** Live callback — only passed on polling/baseline; undefined on blank map (draft-only) */
  onListPctsChange?: (pcts: Record<SaPartyId, number>) => void;
  regSeatsMap: Partial<Record<SaPartyId, number>>;
  activeParties: Set<SaPartyId>;
  onProject?: (pcts: Record<SaPartyId, number>) => void;
  onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const [pcts, setPcts]       = useState<Record<SaPartyId, number>>({ ...natListPcts });
  const [editId, setEditId]   = useState<SaPartyId | null>(null);
  const [editVal, setEditVal] = useState('');
  const pctsRef = useRef(pcts);
  useEffect(() => { pctsRef.current = pcts; }, [pcts]);

  // Sync when parent changes (preset switch or activeParties change)
  useEffect(() => { setPcts({ ...natListPcts }); }, [natListPcts]);

  const listSeats = useMemo(() => calcSeats(pcts, SA_LIST_SEATS_TOTAL), [pcts]);

  const pctTotal = Object.values(pcts).reduce((s, v) => s + v, 0);
  // Only show active parties that have votes or are active
  const sorted = useMemo(
    () => SA_PARTIES.filter(p => activeParties.has(p.id))
      .sort((a, b) => (pcts[b.id] ?? 0) - (pcts[a.id] ?? 0)),
    [pcts, activeParties],
  );

  function applyChange(id: SaPartyId, val: number) {
    // Lock out inactive parties so their 0% stays 0%
    const inactiveLocks = new Set(SA_PARTIES.map(p => p.id).filter(pid => !activeParties.has(pid)));
    const next = redistributePcts(pctsRef.current, id, val, inactiveLocks);
    pctsRef.current = next; setPcts(next);
    // On blank map onListPctsChange is undefined — sliders are draft-only until "Project Result".
    // On polling/baseline it is defined — live-update the scoreboard.
    onListPctsChange?.(next);
  }
  function commitEdit(id: SaPartyId, raw: string) {
    const n = parseFloat(raw);
    if (!isNaN(n)) applyChange(id, Math.max(0, Math.min(100, n)));
    setEditId(null); setEditVal('');
  }

  // Grand totals for summary bar
  const totalListSeats = Object.values(listSeats).reduce((s, v) => s + v, 0);
  const totalRegSeats  = Object.values(regSeatsMap).reduce((s, v) => s + v, 0);

  return (
    <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      {/* Header */}
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-bold text-ink leading-tight">National List Seats</h2>
            <p className="text-[9px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">200 seats · National Compensatory Ballot</p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        {/* Seat summary: L + R = T */}
        <div className="mt-2.5 flex items-center justify-between px-2 py-1.5 rounded-[4px] bg-ink/4 border border-default">
          <div className="text-center">
            <div className="text-[16px] font-black font-mono text-ink">{totalListSeats}</div>
            <div className="text-[7px] font-mono text-ink-3 uppercase tracking-wide">List</div>
          </div>
          <div className="text-ink-3 text-[12px] font-mono">+</div>
          <div className="text-center">
            <div className="text-[16px] font-black font-mono text-ink">{totalRegSeats}</div>
            <div className="text-[7px] font-mono text-ink-3 uppercase tracking-wide">Regional</div>
          </div>
          <div className="text-ink-3 text-[12px] font-mono">=</div>
          <div className="text-center">
            <div className="text-[16px] font-black font-mono" style={{ color: (totalListSeats + totalRegSeats) >= SA_MAJORITY ? '#16a34a' : '#ef4444' }}>
              {totalListSeats + totalRegSeats}
            </div>
            <div className="text-[7px] font-mono text-ink-3 uppercase tracking-wide">Total</div>
          </div>
        </div>
      </div>

      {/* Party rows with slider + L+R=T breakdown */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">
        {sorted.map(party => {
          const pct = pcts[party.id] ?? 0;
          const normPct = pctTotal > 0 ? pct / pctTotal * 100 : 0;
          const l = listSeats[party.id] ?? 0;
          const r = regSeatsMap[party.id] ?? 0;
          const t = l + r;
          const color = partyColor(party.id);
          const base = SA_VOTE_PCT_2024[party.id] ?? 0;
          const delta = pct - base;
          const rawVotes = Math.round(normPct / 100 * SA_GRAND_TOTAL_VOTES);

          return (
            <div key={party.id}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{party.fullName}</span>
                {/* L+R=T seats */}
                <span className="text-[8.5px] font-mono tabular-nums shrink-0" style={{ color }}>
                  {l}+{r}={t}
                </span>
                {/* Editable % */}
                {editId === party.id ? (
                  <input type="number" min={0} max={100} step={0.1} value={editVal} autoFocus
                    className="w-12 h-5 text-[10px] font-mono font-semibold tabular-nums text-right px-1 rounded border border-default focus:outline-none focus:border-ink-3 bg-white text-ink-2"
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={() => commitEdit(party.id, editVal)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(party.id, editVal); } if (e.key === 'Escape') { setEditId(null); setEditVal(''); } }} />
                ) : (
                  <span onClick={() => { setEditId(party.id); setEditVal(pct.toFixed(1)); }}
                    className="text-[10px] font-mono font-semibold tabular-nums min-w-[38px] text-right leading-none cursor-text"
                    style={{ color }}>
                    {normPct.toFixed(1)}%
                  </span>
                )}
              </div>
              <input type="range" min={0} max={60} step={0.1} value={pct}
                onChange={e => applyChange(party.id, parseFloat(e.target.value))}
                className="party-slider w-full"
                style={{ '--party-color': color, '--pct': `${(pct / 60) * 100}%` } as React.CSSProperties} />
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[8px] font-mono tabular-nums text-ink-3">{fmtN(rawVotes)} votes</span>
                {Math.abs(delta) > 0.05 && (
                  <span className={`text-[8px] font-mono tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {delta > 0 ? '+' : ''}{delta.toFixed(1)}pp
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3.5 py-2.5 border-t border-default shrink-0 space-y-2">
        {onProject && (() => {
          const pctSum = Object.values(pcts).reduce((s, v) => s + v, 0);
          const canProject = pctSum > 0.5;
          return (
            <button
              onClick={() => {
                if (!canProject) return;
                // Normalize to 100% if needed (e.g. blank-map mode where sliders start at 0)
                let projected: Record<SaPartyId, number> = { ...pcts };
                if (Math.abs(pctSum - 100) > 0.5) {
                  for (const p of SA_PARTIES) projected[p.id] = (pcts[p.id] ?? 0) / pctSum * 100;
                }
                onProject(projected);
              }}
              disabled={!canProject}
              className={`w-full py-2 text-[11px] font-mono font-bold rounded-[4px] border transition-colors ${
                canProject
                  ? 'border-blue-500 text-blue-500 hover:bg-blue-500 hover:text-white'
                  : 'border-default text-ink-3 cursor-not-allowed opacity-50'
              }`}>
              ⊞ Project Result
            </button>
          );
        })()}
        <p className="text-[8px] font-mono text-ink-3 text-center uppercase tracking-wide leading-relaxed">
          National Compensatory Ballot · 200 seats · click % to edit exactly
        </p>
      </div>
    </aside>
  );
}

// ── Tutorial panel ─────────────────────────────────────────────────────────────
// ── Parties panel — toggle which parties participate in the election ───────────
function SaPartiesPanel({ activeParties, onToggle, onSetActive, natPcts, onClose, exiting, dark }: {
  activeParties: Set<SaPartyId>;
  onToggle: (id: SaPartyId) => void;
  onSetActive: (ids: Set<SaPartyId>) => void;
  natPcts: Record<SaPartyId, number>;
  onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const sorted = useMemo(
    () => [...SA_PARTIES].sort((a, b) => (natPcts[b.id] ?? 0) - (natPcts[a.id] ?? 0)),
    [natPcts],
  );
  const activeCount = activeParties.size;

  return (
    <aside className={`w-64 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      {/* Header */}
      <div className="px-3.5 pt-3 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-bold text-ink leading-tight">Parties</h2>
            <p className="text-[9px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {activeCount} / {SA_PARTIES.length} active · click to toggle
            </p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        {/* Quick-select buttons */}
        <div className="flex gap-1.5 mt-2">
          <button
            onClick={() => onSetActive(new Set(SA_PARTIES.map(p => p.id)))}
            className="flex-1 h-6 text-[9px] font-mono rounded-[3px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors">
            All
          </button>
          <button
            onClick={() => {
              // keep parties currently polling ≥ 1% (or with seats)
              const major = new Set(SA_PARTIES.filter(p => (natPcts[p.id] ?? 0) >= 1 || p.seats2024 >= 6).map(p => p.id));
              if (major.size < 2) return;
              onSetActive(major);
            }}
            className="flex-1 h-6 text-[9px] font-mono rounded-[3px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors">
            Major
          </button>
          <button
            onClick={() => {
              // 3-party race: keep top 3 by current %
              const top3 = new Set(sorted.slice(0, 3).map(p => p.id));
              onSetActive(top3);
            }}
            className="flex-1 h-6 text-[9px] font-mono rounded-[3px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors">
            Top 3
          </button>
        </div>
      </div>

      {/* Party list */}
      <div className="flex-1 overflow-y-auto thin-scroll py-1">
        {sorted.map(party => {
          const isActive = activeParties.has(party.id);
          const pct = natPcts[party.id] ?? 0;
          const color = party.color;
          return (
            <button
              key={party.id}
              onClick={() => onToggle(party.id)}
              disabled={isActive && activeCount <= 1}
              className={`w-full flex items-center gap-2.5 px-3.5 py-1.5 text-left transition-all ${
                isActive
                  ? 'opacity-100'
                  : 'opacity-40 hover:opacity-60'
              } ${isActive && activeCount <= 1 ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-hover'}`}
            >
              {/* Party color strip */}
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all ${isActive ? '' : 'grayscale'}`}
                style={{ background: isActive ? color : '#9ca3af' }} />
              {/* Name */}
              <span className={`flex-1 text-[10.5px] font-medium truncate ${isActive ? 'text-ink' : 'text-ink-3 line-through'}`}>
                {party.name}
              </span>
              {/* Vote % */}
              {pct > 0 && (
                <span className="text-[9px] font-mono tabular-nums shrink-0" style={{ color: isActive ? color : '#9ca3af' }}>
                  {pct.toFixed(1)}%
                </span>
              )}
              {/* Checkbox */}
              <span className={`w-4 h-4 rounded-[3px] border flex items-center justify-center shrink-0 transition-colors ${
                isActive
                  ? 'border-transparent'
                  : 'border-default bg-transparent'
              }`}
              style={isActive ? { background: color } : {}}>
                {isActive && (
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1.5 4l2 2 3-3" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer note */}
      <div className="px-3.5 py-2 border-t border-default shrink-0">
        <p className="text-[8px] font-mono text-ink-3 leading-relaxed">
          Deselected parties are excluded from all seat calculations and slider panels. Votes redistribute proportionally.
        </p>
      </div>
    </aside>
  );
}

function SaTutorialPanel({ onClose, exiting, dark }: { onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const H2   = ({ children }: { children: React.ReactNode }) => <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-5 mb-1.5 first:mt-0">{children}</div>;
  const P    = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] text-ink leading-relaxed mb-2">{children}</p>;
  const Note = ({ children }: { children: React.ReactNode }) => <div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{children}</div>;
  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">South African Elections Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2>Electoral System</H2>
        <P>South Africa uses a <strong>two-ballot system</strong>. The 400 National Assembly seats are split equally: <strong>200 National Compensatory seats</strong> (pure national list, set via the List Seats panel) and <strong>200 Regional seats</strong> (9 provinces, each with a fixed quota). Both ballots use D'Hondt proportional allocation.</P>
        <Note>There is <strong>no formal threshold</strong>. Even tiny parties win seats — roughly 0.25% of the national vote earns a single seat.</Note>

        <H2>2024 Historic Election</H2>
        <P>In May 2024, the <strong>ANC fell below 50%</strong> for the first time since 1994, winning only 40.2%. The result was a <strong>Government of National Unity (GNU)</strong>: ANC + DA + IFP + 9 smaller parties holding 275+ seats.</P>

        <H2>Presets</H2>
        <P><strong>2024 Baseline</strong> loads the official IEC national ballot figures. <strong>2026 Polling</strong> (default) loads the Social Research Foundation poll (Feb–Mar 2026, n=2222): ANC 39%, DA 28%, MK 10%, EFF 6%, IFP 5%. <strong>Blank Map</strong> resets everything to zero so you can enter results by hand.</P>

        <H2>Choropleth Map</H2>
        <P>The map colours each of the <strong>9 provinces</strong> by winning party. Colour intensity scales with the winner's margin of victory. Hover over any province for a live tooltip showing the top parties, their vote shares, raw vote counts, and — once you've projected a result — a gold <em>% Reporting</em> badge.</P>

        <H2>Province Panel</H2>
        <P>Click any province to open its detail panel. Drag <strong>party-coloured sliders</strong> to adjust vote shares; lock any party (🔒) to hold it fixed while the others redistribute proportionally. Click any percentage to type an exact value. The <strong>delta</strong> (±pp) shows the swing from the 2024 baseline; expand <em>2024 Reference</em> to compare.</P>
        <P>The <strong>% Reporting</strong> slider scales the raw vote count shown — useful when only a fraction of ballots are in. Click <strong>⊞ Project Result</strong> to declare that province on the map and send its reporting-scaled raw votes to the scoreboard. The scoreboard and tooltip update live as you move the slider.</P>

        <H2>List Seats Panel</H2>
        <P>Open <strong>List Seats</strong> to set the <strong>National Compensatory Ballot</strong> percentages independently. Click <em>Project Result</em> there to push those percentages to the list-seat column of the scoreboard without touching the province results you've entered by hand.</P>

        <H2>Parties Panel</H2>
        <P>Use the <strong>Parties</strong> panel to enable or disable individual parties. Deactivating a party zeros its vote share and redistributes proportionally. Quick-select buttons let you jump to <em>Major</em>, <em>Top 5</em>, or <em>All</em> parties.</P>

        <H2>Simulation</H2>
        <P>Open <strong>▶ Simulation</strong> to set national vote shares and a <strong>duration</strong> (30s → 5m). Click <em>Run</em> and watch provinces declare one by one, updating the scoreboard and parliament in real time. The map auto-switches to Blank Map and reveals provinces as they come in.</P>

        <H2>% Reporting Overlay</H2>
        <P>In Blank Map and Simulation modes a widget in the bottom-left corner tracks how many of the <strong>9 provinces</strong> have been declared and what share of the total 2024 vote they represent.</P>

        <H2>Parliament</H2>
        <P>The <strong>Parliament</strong> button opens the National Assembly hemicycle — 400 seats across 12 arcs, coloured by party in left-to-right ideological order.</P>

        <H2>Breakdown</H2>
        <P>The <strong>Breakdown</strong> panel shows the national seat bar and a province-by-province results table: winner, margin, and top challengers for each of the 9 provinces.</P>

        <H2>Coalition Builder</H2>
        <P>Toggle parties on and off to see whether a combination clears the <strong>201-seat majority</strong> threshold. Use the preset buttons for common coalition scenarios.</P>
      </div>
    </aside>
  );
}

// ── Main app ───────────────────────────────────────────────────────────────────
export default function SouthAfricaApp() {
  const navigate = useNavigate();

  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  // ── Election state ───────────────────────────────────────────────────────────
  const [preset, setPreset]           = useState<'baseline' | 'polling2026' | 'blank' | 'custom'>('polling2026');
  // natRegPcts  = Regional ballot (9 provinces, drives map colouring + 200 regional seats)
  const [natPcts, setNatPcts]         = useState<Record<SaPartyId, number>>(() => ({ ...POLL_2026_PCTS }));
  // natListPcts = National Compensatory Ballot (200 list seats, edited via List Seats panel)
  const [natListPcts, setNatListPcts] = useState<Record<SaPartyId, number>>(() => ({ ...POLL_2026_PCTS }));
  // activeParties = which parties participate; inactive ones are forced to 0% and their votes redistribute
  const [activeParties, setActiveParties] = useState<Set<SaPartyId>>(() => new Set(SA_PARTIES.map(p => p.id)));

  /** Toggle one party in/out — deactivating redistributes its votes proportionally */
  function handlePartyToggle(id: SaPartyId) {
    if (activeParties.has(id)) {
      if (activeParties.size <= 1) return; // keep at least 1
      // Build locks = all currently inactive parties (already 0%, should stay 0%)
      const locks = new Set(SA_PARTIES.map(p => p.id).filter(pid => !activeParties.has(pid)));
      setNatPcts(prev => redistributePcts(prev, id, 0, locks));
      setNatListPcts(prev => redistributePcts(prev, id, 0, locks));
      setActiveParties(prev => { const n = new Set(prev); n.delete(id); return n; });
    } else {
      // Reactivate at 0% — user adjusts via slider
      setActiveParties(prev => new Set([...prev, id]));
    }
    if (preset !== 'baseline') setPreset('custom');
  }

  /** Batch-set the active party set (used by "Major", "Top 3", "All" quick buttons) */
  function handleSetActiveParties(newActive: Set<SaPartyId>) {
    // Deactivate each newly-excluded party one at a time so votes redistribute sequentially
    const toDeactivate = [...activeParties].filter(id => !newActive.has(id));
    const toActivate   = [...newActive].filter(id => !activeParties.has(id));
    let pcts     = { ...natPcts };
    let listPcts = { ...natListPcts };
    let current  = new Set(activeParties);
    for (const id of toDeactivate) {
      if (current.size <= 1) break;
      const locks = new Set(SA_PARTIES.map(p => p.id).filter(pid => !current.has(pid)));
      pcts     = redistributePcts(pcts,     id, 0, locks);
      listPcts = redistributePcts(listPcts, id, 0, locks);
      current.delete(id);
    }
    for (const id of toActivate) current.add(id); // re-activated parties start at 0%
    setNatPcts(pcts);
    setNatListPcts(listPcts);
    setActiveParties(current);
    if (preset !== 'baseline') setPreset('custom');
  }

  function loadBaseline() {
    setNatPcts({ ...SA_VOTE_PCT_2024 }); setNatListPcts({ ...SA_VOTE_PCT_2024 });
    setPreset('baseline'); resetSim(); setProvOverrides({});
  }
  function loadPolling2026() {
    setNatPcts({ ...POLL_2026_PCTS }); setNatListPcts({ ...POLL_2026_PCTS });
    setPreset('polling2026'); resetSim(); setProvOverrides({});
  }
  function loadBlank() {
    const zero = Object.fromEntries(SA_PARTIES.map(p => [p.id, 0])) as Record<SaPartyId, number>;
    setNatPcts(zero); setNatListPcts(zero);
    setPreset('blank'); resetSim();
    setProvOverrides({}); setScoreboardVisible(false);
    // Blank map: declare no provinces yet so map is fully grey
    setDeclaredProvs(new Set());
  }

  // ── Province overrides ───────────────────────────────────────────────────────
  const [provOverrides, setProvOverrides] = useState<Record<string, Record<SaPartyId, number>>>({});

  // ── Simulation state ─────────────────────────────────────────────────────────
  const [simSeats, setSimSeats]           = useState<Partial<Record<SaPartyId, number>> | undefined>();
  const [simProgress, setSimProgress]     = useState(0);
  const [simRunning, setSimRunning]       = useState(false);
  const [declaredProvs, setDeclaredProvs] = useState<Set<SaProvId> | undefined>();
  // Per-province reporting % (set when "Project Result" is clicked in province panel)
  const [provReporting, setProvReporting] = useState<Partial<Record<SaProvId, number>>>({});
  const simTimersRef      = useRef<ReturnType<typeof setTimeout>[]>([]);
  const natPctsAtSimStart = useRef<Record<SaPartyId, number>>(natPcts);

  function stopSim() {
    simTimersRef.current.forEach(clearTimeout);
    simTimersRef.current = [];
    setSimRunning(false);
  }
  function resetSim() {
    stopSim();
    setSimSeats(undefined);
    setDeclaredProvs(preset === 'blank' ? new Set() : undefined);
    setSimProgress(0);
  }

  function handleSimStart(pcts: Record<SaPartyId, number>, durationMs: number) {
    stopSim();
    natPctsAtSimStart.current = { ...pcts };
    setNatPcts(pcts);
    setNatListPcts(pcts); // keep list ballot in sync with regional when simulation runs
    setPreset('blank');
    setProvOverrides({});
    setProvReporting({});
    setDeclaredProvs(new Set());
    setSimSeats(undefined);
    setSimProgress(0);
    setSimRunning(true);
    setScoreboardVisible(true); // show scoreboard immediately for live results

    // ── Pre-compute each province's final vote shares ────────────────────────
    const provVoteShares: Partial<Record<SaProvId, Record<SaPartyId, number>>> = {};
    for (const prov of SA_PROVINCES) {
      provVoteShares[prov.id] = calcProvVotes(pcts, prov.id);
    }

    // ── Bell-curve batch scheduling ──────────────────────────────────────────
    const N_BATCHES = 5;

    const schedules: Array<{
      provId: SaProvId;
      batchTimes: number[];   // absolute ms from t=0 (after normalisation)
      cumPcts: number[];      // cumulative reporting % at each batch [e.g. 18,41,63,82,100]
    }> = [];

    for (const prov of SA_PROVINCES) {
      // Province "centre" time: normal(mean=0.5, σ=0.20), clamped [0.12, 0.88]
      const centerFrac = Math.max(0.12, Math.min(0.88, 0.5 + saRandNormal() * 0.20));
      const centerMs   = centerFrac * durationMs;

      // Spread window: each province's 5 batches span 20–30 % of duration
      const spreadMs = (0.20 + Math.random() * 0.10) * durationMs;
      const lo = centerMs - spreadMs / 2;
      const hi = centerMs + spreadMs / 2;

      // 5 batch times drawn uniformly from that window, then sorted
      const batchTimes = Array.from({ length: N_BATCHES }, () => lo + Math.random() * (hi - lo))
        .sort((a, b) => a - b);

      // 4 random cut-points → cumulative reporting %: e.g. [18, 41, 63, 82, 100]
      const cuts = Array.from({ length: N_BATCHES - 1 }, () => Math.random() * 100)
        .sort((a, b) => a - b);
      const cumPcts = [...cuts, 100];

      schedules.push({ provId: prov.id, batchTimes, cumPcts });
    }

    // Normalise: shift all times so the earliest first-batch fires at t=0 (immediate)
    const minFirst = Math.min(...schedules.map(s => s.batchTimes[0]));
    const maxAllowed = durationMs * 0.98;
    for (const s of schedules) {
      s.batchTimes = s.batchTimes.map(t => Math.min(Math.max(0, t - minFirst), maxAllowed));
    }

    // ── Schedule all batch timers ─────────────────────────────────────────────
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Mutable closure state — avoids React closure staleness; updated synchronously
    // in each callback before calling setState.
    let curDeclared  = new Set<SaProvId>();
    let curOverrides: Record<string, Record<SaPartyId, number>> = {};
    let curReporting: Partial<Record<SaProvId, number>> = {};
    let fullyDone    = 0; // provinces that have reached 100 %

    for (const { provId, batchTimes, cumPcts } of schedules) {
      for (let b = 0; b < N_BATCHES; b++) {
        const rptPct  = Math.round(cumPcts[b]);
        const isFirst = b === 0;
        const isFinal = b === N_BATCHES - 1;
        const t       = batchTimes[b];

        timers.push(setTimeout(() => {
          // First batch: province appears on map and gets its vote-share override
          if (isFirst) {
            curDeclared  = new Set([...curDeclared, provId]);
            curOverrides = { ...curOverrides, [provId]: provVoteShares[provId]! };
          }
          curReporting = { ...curReporting, [provId]: rptPct };
          if (isFinal) fullyDone++;

          // Push all state together so React batches into one render
          setDeclaredProvs(new Set(curDeclared));
          setProvOverrides({ ...curOverrides });
          setProvReporting({ ...curReporting });
          setSimProgress(curDeclared.size); // provinces reporting (≥ 1st batch)
          setSimSeats(calcPartialSeats(natPctsAtSimStart.current, curDeclared));

          // All provinces at 100 % — compute final authoritative seat tally
          if (isFinal && fullyDone >= SA_PROVINCES.length) {
            setSimSeats(mergeSeats(
              calcSeats(natPctsAtSimStart.current, SA_LIST_SEATS_TOTAL),
              calcRegSeats(natPctsAtSimStart.current),
            ));
            setSimRunning(false);
          }
        }, t));
      }
    }

    simTimersRef.current = timers;
  }

  /**
   * Project ONLY the national list ballot pcts (from the List Seats panel).
   * Does NOT touch natPcts, provOverrides, or declaredProvs — the player
   * enters regional/province results by hand via province panels.
   */
  function handleProjectListOnly(pcts: Record<SaPartyId, number>) {
    setNatListPcts(pcts);
    setScoreboardVisible(true);
    if (preset !== 'blank') setPreset('custom');
  }

  /** Declare a single province result — marks it as reported on the map */
  function handleDeclareProvince(provId: SaProvId, pcts: Record<SaPartyId, number>, reportingPct = 100) {
    setProvOverrides(prev => ({ ...prev, [provId]: pcts }));
    setProvReporting(prev => ({ ...prev, [provId]: reportingPct }));
    setDeclaredProvs(prev => {
      const next = new Set(prev ?? []); // if undefined (non-blank mode), start a fresh set
      next.add(provId);
      return next;
    });
    setScoreboardVisible(true);
  }

  // Auto-show scoreboard when provinces start declaring
  useEffect(() => {
    if (preset === 'blank' && simProgress > 0) setScoreboardVisible(true);
  }, [preset, simProgress]);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [selectedProv, setSelectedProv]       = useState<SaProvId | null>(null);
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [simOpen, setSimOpen]                 = useState(false);
  const [simExiting, setSimExiting]           = useState(false);
  const [listOpen, setListOpen]               = useState(false);
  const [listExiting, setListExiting]         = useState(false);
  const [parliOpen, setParliOpen]             = useState(false);
  const [coalitionOpen, setCoalitionOpen]     = useState(false);
  const [breakdownOpen, setBreakdownOpen]     = useState(false);
  const [breakdownExiting, setBreakdownExiting] = useState(false);
  const [tutorialOpen, setTutorialOpen]       = useState(false);
  const [tutorialExiting, setTutorialExiting] = useState(false);
  const [partiesOpen, setPartiesOpen]         = useState(false);
  const [partiesExiting, setPartiesExiting]   = useState(false);
  const [exitPanel, setExitPanel]             = useState<string | null>(null);
  const exitTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  const triggerExit = useCallback((panel: string) => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    setExitPanel(panel);
    exitTimerRef.current = setTimeout(() => setExitPanel(null), 280);
  }, []);

  // Horizontal scroll on header strip via vertical wheel (like Germany)
  useEffect(() => {
    const el = headerScrollRef.current; if (!el) return;
    const h = (e: WheelEvent) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft += e.deltaY; };
    el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h);
  }, []);

  /** Live-update reportingPct for the currently-selected province (slider moves without clicking Project Result) */
  const handleReportingChange = useCallback((pct: number) => {
    if (!selectedProv) return;
    setProvReporting(prev => ({ ...prev, [selectedProv]: pct }));
  }, [selectedProv]);

  // Derived seats — two-ballot
  const listSeatsMap = useMemo(() => calcSeats(natListPcts, SA_LIST_SEATS_TOTAL), [natListPcts]);
  const regSeatsMap  = useMemo(() => calcRegSeats(natPcts, provOverrides), [natPcts, provOverrides]);
  const displaySeats = useMemo(() => {
    if (simSeats) return simSeats;
    if (preset === 'baseline') return SA_SEATS_2024 as Partial<Record<SaPartyId, number>>;
    return mergeSeats(listSeatsMap, regSeatsMap);
  }, [simSeats, listSeatsMap, regSeatsMap, preset]);

  /**
   * Aggregate raw votes from declared provinces, scaled by each province's % reporting.
   * Used by SaScoreboard to show real raw vote counts instead of synthetic national totals.
   * Only defined when at least one province has been declared (blank-map mode).
   */
  const provReportedRawVotes = useMemo<Partial<Record<SaPartyId, number>> | undefined>(() => {
    if (!declaredProvs || declaredProvs.size === 0) return undefined;
    const totals: Partial<Record<SaPartyId, number>> = {};
    for (const provId of declaredProvs) {
      const prov = SA_PROV_MAP[provId]; if (!prov) continue;
      const pcts = provOverrides[provId]; if (!pcts) continue;
      const rpt  = (provReporting[provId] ?? 100) / 100;
      for (const p of SA_PARTIES) {
        totals[p.id] = (totals[p.id] ?? 0) + Math.round((pcts[p.id] ?? 0) / 100 * rpt * prov.votes2024);
      }
    }
    return totals;
  }, [declaredProvs, provReporting, provOverrides]);

  // Button styles
  const btnBase   = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold   = `${btnBase} bg-gold text-white hover:bg-gold-deep`;
  const btnMuted  = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive = `${btnBase} bg-ink/8 border border-default text-ink`;

  // Panel visibility
  const showParli     = parliOpen     || exitPanel === 'parli';
  const showCoal      = coalitionOpen || exitPanel === 'coal';
  const showProv      = !!selectedProv && !simOpen;
  const showTutorial  = tutorialOpen  || tutorialExiting;
  const showBreakdown = breakdownOpen || breakdownExiting;
  const showList      = listOpen      || listExiting;
  const showSim       = simOpen       || simExiting;
  const showParties   = partiesOpen   || partiesExiting;
  const inactiveCount = SA_PARTIES.length - activeParties.size;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="za">

      {/* ── Topbar ──────────────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>

        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
        </button>

        {/* Scrollable button strip */}
        <div ref={headerScrollRef} className="flex-1 min-w-0 header-scroll-strip flex items-center gap-2 px-2">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          {/* Presets */}
          <button onClick={loadBaseline}    className={preset === 'baseline'    ? btnGold : btnMuted}>2024 Baseline</button>
          <button onClick={loadPolling2026} className={preset === 'polling2026' ? btnGold : btnMuted}>2026 Polling</button>
          <button onClick={() => { if (!simRunning) loadBlank(); }} disabled={simRunning}
            className={simRunning ? `${btnBase} border border-default text-ink-3 opacity-40 cursor-not-allowed` : preset === 'blank' ? btnGold : btnMuted}
            title={simRunning ? 'Unavailable during simulation' : undefined}>Blank Map</button>

          {/* Parties — toggle which parties participate */}
          <button
            onClick={() => {
              if (simRunning) return;
              if (partiesOpen) { setPartiesExiting(true); setTimeout(() => { setPartiesExiting(false); setPartiesOpen(false); }, 280); }
              else { setPartiesOpen(true); }
            }}
            disabled={simRunning}
            className={simRunning
              ? `${btnBase} border border-default text-ink-3 opacity-40 cursor-not-allowed`
              : partiesOpen ? btnActive : inactiveCount > 0
                ? `${btnBase} border border-amber-400 text-amber-600 hover:bg-amber-400 hover:text-white`
                : btnMuted}
            title={simRunning ? 'Unavailable during simulation' : inactiveCount > 0 ? `${inactiveCount} parties excluded` : 'Select parties for the election'}
          >
            {inactiveCount > 0 ? `Parties (${activeParties.size})` : 'Parties'}
          </button>

          {/* List Seats — locked during live simulation */}
          <button
            onClick={() => {
              if (simRunning) return;
              if (listOpen) { setListExiting(true); setTimeout(() => { setListExiting(false); setListOpen(false); }, 280); }
              else { setListOpen(true); }
            }}
            disabled={simRunning}
            title={simRunning ? 'Unavailable during simulation' : undefined}
            className={simRunning
              ? `${btnBase} border border-default text-ink-3 opacity-40 cursor-not-allowed`
              : listOpen ? btnActive : preset === 'blank'
                ? `${btnBase} border-2 border-gold text-gold animate-pulse hover:bg-gold hover:text-white`
                : btnMuted}
          >List Seats</button>

          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          {/* Simulation */}
          <button
            onClick={() => {
              if (simOpen) { setSimExiting(true); setTimeout(() => { setSimExiting(false); setSimOpen(false); }, 280); }
              else { setSimOpen(true); }
            }}
            className={simOpen ? btnActive : btnMuted}
          >▶ Simulation</button>

          {/* Parliament */}
          <button
            onClick={() => {
              if (parliOpen) { setParliOpen(false); triggerExit('parli'); }
              else { setParliOpen(true); setCoalitionOpen(false); }
            }}
            className={parliOpen ? btnActive : btnMuted}
          >Parliament</button>

          {/* Breakdown */}
          <button
            onClick={() => {
              if (breakdownOpen) { setBreakdownExiting(true); setTimeout(() => { setBreakdownExiting(false); setBreakdownOpen(false); }, 280); }
              else { setBreakdownOpen(true); }
            }}
            className={breakdownOpen ? btnActive : btnMuted}
          >Breakdown</button>

          {/* Coalition */}
          <button
            onClick={() => {
              if (coalitionOpen) { setCoalitionOpen(false); triggerExit('coal'); }
              else { setCoalitionOpen(true); setParliOpen(false); }
            }}
            className={coalitionOpen ? btnActive : btnMuted}
          >Coalition</button>

          {/* Tutorial */}
          <button
            onClick={() => {
              if (tutorialOpen) { setTutorialExiting(true); setTimeout(() => { setTutorialExiting(false); setTutorialOpen(false); }, 280); }
              else { setTutorialOpen(true); }
            }}
            className={tutorialOpen ? btnActive : btnMuted}
          >Tutorial</button>

        </div>

        {/* Right controls */}
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

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 relative">

        {/* Collapsible scoreboard — Germany animated grid-rows trick */}
        <div className="relative shrink-0">
          <div style={{
            display: 'grid',
            gridTemplateRows: scoreboardVisible ? '1fr' : '0fr',
            transition: 'grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1)',
          }}>
            <div className="overflow-hidden">
              <SaScoreboard
                natListPcts={natListPcts}
                natRegPcts={natPcts}
                provOverrides={provOverrides}
                simTotalSeats={simSeats}
                isBaseline={preset === 'baseline'}
                provReportedRawVotes={provReportedRawVotes}
              />
            </div>
          </div>
          {/* Toggle chevron */}
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

        {/* Map + panels row */}
        <div className="flex flex-1 min-h-0 relative">

          {/* Parliament — LEFT side */}
          {showParli && (
            <SaParliamentPanel
              seats={displaySeats}
              onClose={() => { setParliOpen(false); triggerExit('parli'); }}
              exiting={exitPanel === 'parli'}
              dark={dark}
            />
          )}

          {/* Map — centre */}
          <div className="flex-1 min-w-0 relative">
            <SaMapView
              natPcts={natPcts}
              onSelect={id => { if (!simRunning) setSelectedProv(prev => prev === id ? null : id); }}
              dark={dark}
              declaredProvs={declaredProvs}
              overrides={provOverrides}
              provReporting={provReporting}
            />

            {/* ── % Reporting widget — blank map + simulation modes only ── */}
            {declaredProvs !== undefined && (() => {
              const declared  = declaredProvs.size;
              const total     = SA_PROVINCES.length;
              // Weight each declared province by its actual reporting % so we get
              // "votes actually counted so far", not the province's full 2024 turnout.
              // Cap at 100 in case approximate province votes2024 values sum > grand total.
              const votePct   = Math.min(100, SA_PROVINCES.reduce(
                (s, p) => {
                  if (!declaredProvs.has(p.id)) return s;
                  const rpt = (provReporting[p.id] ?? 100) / 100;
                  return s + p.votes2024 * rpt;
                }, 0,
              ) / SA_GRAND_TOTAL_VOTES * 100);
              const barPct    = (declared / total) * 100;
              const isDone    = declared === total && !simRunning; // only after all batches complete
              const accentClr = isDone ? '#16a34a' : simRunning ? '#f59e0b' : '#3b82f6';
              const bg        = dark ? 'rgba(13,27,46,0.93)' : 'rgba(255,255,255,0.95)';
              const border    = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.09)';
              const titleClr  = dark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.38)';
              const bigClr    = dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.84)';
              const subClr    = dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.46)';
              const trackClr  = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)';

              return (
                <div className="absolute bottom-8 left-3 z-[1000] pointer-events-none select-none"
                  style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10,
                    boxShadow: dark ? '0 4px 22px rgba(0,0,0,0.45)' : '0 4px 22px rgba(0,0,0,0.11)',
                    backdropFilter: 'blur(10px)', padding: '10px 14px', minWidth: 172 }}>

                  {/* Header label */}
                  <div style={{ fontSize: 8, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700,
                    letterSpacing: '0.12em', textTransform: 'uppercase', color: titleClr, marginBottom: 6,
                    display: 'flex', alignItems: 'center', gap: 5 }}>
                    {simRunning && (
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: accentClr,
                        display: 'inline-block', animation: 'pulse 1.4s ease-in-out infinite' }} />
                    )}
                    {isDone ? 'Final Result' : simRunning ? 'Live Count' : 'Reporting'}
                  </div>

                  {/* X / 9 provinces */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginBottom: 6 }}>
                    <span style={{ fontSize: 26, fontFamily: '"JetBrains Mono",monospace', fontWeight: 900,
                      color: bigClr, lineHeight: 1 }}>{declared}</span>
                    <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', color: subClr }}>
                      / {total} provinces
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div style={{ width: '100%', height: 5, borderRadius: 3, background: trackClr,
                    overflow: 'hidden', marginBottom: 5 }}>
                    <div style={{ height: '100%', width: `${barPct}%`, background: accentClr,
                      borderRadius: 3, transition: 'width 0.5s ease' }} />
                  </div>

                  {/* Vote % sub-label */}
                  <div style={{ fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: subClr }}>
                    {votePct.toFixed(1)}% of national vote
                  </div>
                </div>
              );
            })()}
          </div>

          {/* ── RIGHT PANELS (only one visible at a time, left-to-right priority) ── */}

          {/* Simulation panel */}
          {showSim && (
            <SaSimulationPanel
              onStart={handleSimStart}
              onClose={() => { setSimExiting(true); setTimeout(() => { setSimExiting(false); setSimOpen(false); }, 280); }}
              simRunning={simRunning}
              simProgress={simProgress}
              stopSim={stopSim}
              natPcts={natPcts}
              activeParties={activeParties}
              dark={dark}
            />
          )}

          {/* National List panel */}
          {showList && !simOpen && (
            <SaListPanel
              natListPcts={natListPcts}
              onListPctsChange={preset !== 'blank' ? (pcts => {
                setNatListPcts(pcts);
                setPreset('custom');
              }) : undefined}
              regSeatsMap={regSeatsMap}
              activeParties={activeParties}
              onProject={handleProjectListOnly}
              onClose={() => {
                setListExiting(true);
                setTimeout(() => { setListExiting(false); setListOpen(false); }, 280);
              }}
              exiting={listExiting}
              dark={dark}
            />
          )}

          {/* Province detail panel — shown when not sim-open */}
          {showProv && selectedProv && !simOpen && (
            <SaProvPanel
              provId={selectedProv}
              natPcts={natPcts}
              activeParties={activeParties}
              onUpdate={(id, pcts) => {
                setProvOverrides(prev => ({ ...prev, [id]: pcts }));
                if (preset !== 'blank') setPreset('custom');
              }}
              onDeclare={preset === 'blank' ? (pcts, rpt) => handleDeclareProvince(selectedProv, pcts, rpt) : undefined}
              onReportingChange={preset === 'blank' ? handleReportingChange : undefined}
              onClose={() => setSelectedProv(null)}
              dark={dark}
              override={provOverrides[selectedProv]}
              storedReportingPct={provReporting[selectedProv]}
            />
          )}

          {/* Coalition panel */}
          {showCoal && !simOpen && (
            <SaCoalitionPanel
              seats={displaySeats}
              onClose={() => { setCoalitionOpen(false); triggerExit('coal'); }}
              exiting={exitPanel === 'coal'}
              dark={dark}
            />
          )}

          {/* Breakdown panel */}
          {showBreakdown && !simOpen && (
            <SaBreakdownPanel
              natPcts={natPcts}
              displaySeats={displaySeats}
              onClose={() => { setBreakdownExiting(true); setTimeout(() => { setBreakdownExiting(false); setBreakdownOpen(false); }, 280); }}
              exiting={breakdownExiting}
              dark={dark}
            />
          )}

          {/* Parties panel */}
          {showParties && !simOpen && (
            <SaPartiesPanel
              activeParties={activeParties}
              onToggle={handlePartyToggle}
              onSetActive={handleSetActiveParties}
              natPcts={natPcts}
              onClose={() => { setPartiesExiting(true); setTimeout(() => { setPartiesExiting(false); setPartiesOpen(false); }, 280); }}
              exiting={partiesExiting}
              dark={dark}
            />
          )}

          {/* Tutorial panel */}
          {showTutorial && !simOpen && (
            <SaTutorialPanel
              onClose={() => { setTutorialExiting(true); setTimeout(() => { setTutorialExiting(false); setTutorialOpen(false); }, 280); }}
              exiting={tutorialExiting}
              dark={dark}
            />
          )}
        </div>
      </div>
    </div>
  );
}
