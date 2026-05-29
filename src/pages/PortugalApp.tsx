import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── Party types ───────────────────────────────────────────────────────────────
type PtPartyId =
  | 'AD' | 'PS' | 'CH' | 'IL' | 'L' | 'CDU' | 'BE' | 'PAN' | 'JPP';

type PtParty = {
  id: PtPartyId; name: string; fullName: string; color: string;
  seats2025: number; leader: string; wikiTitle?: string;
  leader2026?: string; wikiTitle2026?: string; name2026?: string; fullName2026?: string; regional?: boolean;
};

const PT_LR_ORDER: PtPartyId[] = ['CDU','BE','L','PS','PAN','JPP','AD','IL','CH'];

const PT_PARTIES: PtParty[] = [
  { id: 'AD', name: 'AD', fullName: 'Aliança Democrática (PSD/CDS)', color: '#F58220', seats2025: 91, leader: 'Luís Montenegro', wikiTitle: 'Luís_Montenegro' },
  { id: 'PS', name: 'PS', fullName: 'Partido Socialista', color: '#FF6699', seats2025: 58, leader: 'Pedro Nuno Santos', wikiTitle: 'Pedro_Nuno_Santos', leader2026: 'José Luís Carneiro', wikiTitle2026: 'José_Luís_Carneiro' },
  { id: 'CH', name: 'Chega', fullName: 'Chega', color: '#202056', seats2025: 60, leader: 'André Ventura', wikiTitle: 'André_Ventura' },
  { id: 'IL', name: 'IL', fullName: 'Iniciativa Liberal', color: '#00ADEF', seats2025: 9, leader: 'Rui Rocha', wikiTitle: 'Rui_Rocha', leader2026: 'Mariana Leitão', wikiTitle2026: 'Mariana_Leitão' },
  { id: 'L', name: 'Livre', fullName: 'Livre', color: '#2D9F3F', seats2025: 6, leader: 'Rui Tavares', wikiTitle: 'Rui_Tavares' },
  { id: 'CDU', name: 'CDU', fullName: 'Coligação Democrática Unitária (PCP–PEV)', color: '#C4151C', seats2025: 3, leader: 'Paulo Raimundo', wikiTitle: 'Paulo_Raimundo' },
  { id: 'BE', name: 'BE', fullName: 'Bloco de Esquerda', color: '#9C0D17', seats2025: 1, leader: 'Mariana Mortágua', wikiTitle: 'Mariana_Mortágua', leader2026: 'José Manuel Pureza', wikiTitle2026: 'José_Manuel_Pureza' },
  { id: 'PAN', name: 'PAN', fullName: 'Pessoas–Animais–Natureza', color: '#00A19A', seats2025: 1, leader: 'Inês de Sousa Real', wikiTitle: 'Inês_de_Sousa_Real' },
  { id: 'JPP', name: 'JPP', fullName: 'Juntos pelo Povo', color: '#5FB14E', seats2025: 1, leader: 'Élvio Sousa', wikiTitle: 'Élvio_Sousa', regional: true },
];

const PT_PARTY_MAP = Object.fromEntries(PT_PARTIES.map(p => [p.id, p])) as Record<PtPartyId, PtParty>;
const PT_TOTAL_SEATS = 230;
const PT_MAJORITY    = 116;

// 2025 national results — source: Comissão Nacional de Eleições (official)
const PT_VOTE_PCT_2025: Record<PtPartyId, number> = {
  AD: 33.15, PS: 23.80, CH: 23.73, IL: 5.62, L: 4.22, CDU: 3.03, BE: 2.07, PAN: 1.43, JPP: 0.35,
};
const PT_VOTE_RAW_2025: Record<PtPartyId, number> = {
  AD: 2008437, PS: 1442194, CH: 1437881, IL: 340307, L: 255630, CDU: 183741, BE: 125710, PAN: 86946, JPP: 20911,
};
const PT_GRAND_TOTAL_VOTES = 6059321;

// 2026 polling projection
const PT_VOTE_PCT_2026: Record<PtPartyId, number> = {
  PS: 28.5, AD: 24.95, CH: 22.6, IL: 7.4, L: 5.8, CDU: 3.25, BE: 2.4, PAN: 2.1, JPP: 0.3,
};

type PtConstId =
  | 'AVEIRO' | 'BEJA' | 'BRAGA' | 'BRAGANCA' | 'CASTELO_BRANCO' | 'COIMBRA' | 'EVORA' | 
  'FARO' | 'GUARDA' | 'LEIRIA' | 'LISBON' | 'PORTALEGRE' | 'PORTO' | 'SANTAREM' | 'SETUBAL' | 
  'VIANA' | 'VILA_REAL' | 'VISEU' | 'AZORES' | 'MADEIRA' | 'EUROPE' | 'OUTSIDE_EUROPE';

type PtConstituency = {
  id: PtConstId; name: string; seats: number; weight: number;
  overseas?: boolean; // Europe / Outside Europe — no map geometry
  v2025: Partial<Record<PtPartyId, number>>;
};

// GeoJSON feature name -> constituency id (20 geographic constituencies)
const PT_GEOID_TO_ID: Record<string, PtConstId> = {
  "Aveiro": 'AVEIRO',
  "Beja": 'BEJA',
  "Braga": 'BRAGA',
  "Bragança": 'BRAGANCA',
  "Castelo Branco": 'CASTELO_BRANCO',
  "Coimbra": 'COIMBRA',
  "Évora": 'EVORA',
  "Faro": 'FARO',
  "Guarda": 'GUARDA',
  "Leiria": 'LEIRIA',
  "Lisboa": 'LISBON',
  "Portalegre": 'PORTALEGRE',
  "Porto": 'PORTO',
  "Santarém": 'SANTAREM',
  "Setúbal": 'SETUBAL',
  "Viana do Castelo": 'VIANA',
  "Vila Real": 'VILA_REAL',
  "Viseu": 'VISEU',
  "Azores": 'AZORES',
  "Madeira": 'MADEIRA',
};

// 22 constituencies — district magnitude + 2025 vote % (modelled parties; remainder = others).
// D'Hondt (no legal threshold) on these reproduces the official per-constituency + national seats.
const PT_CONSTITUENCIES: PtConstituency[] = [
  { id:'AVEIRO', name:"Aveiro", seats:16, weight:6.67, v2025:{AD:40.51, PS:22.29, CH:21.23, IL:5.80, L:3.17, CDU:1.22, BE:1.74, PAN:1.27} },
  { id:'BEJA', name:"Beja", seats:3, weight:1.19, v2025:{AD:21.39, PS:27.12, CH:28.38, IL:2.00, L:2.15, CDU:13.88, BE:1.89, PAN:0.88} },
  { id:'BRAGA', name:"Braga", seats:19, weight:8.75, v2025:{AD:37.36, PS:23.67, CH:22.61, IL:6.92, L:3.13, CDU:1.73, BE:1.89, PAN:0.98, JPP:0.06} },
  { id:'BRAGANCA', name:"Bragança", seats:3, weight:1.13, v2025:{AD:44.88, PS:26.09, CH:20.95, IL:2.24, L:1.16, CDU:1.06, BE:0.87, PAN:0.69} },
  { id:'CASTELO_BRANCO', name:"Castelo Branco", seats:4, weight:1.67, v2025:{AD:33.21, PS:29.39, CH:24.02, IL:3.10, L:2.62, CDU:2.20, BE:1.69, PAN:0.93} },
  { id:'COIMBRA', name:"Coimbra", seats:9, weight:3.70, v2025:{AD:35.45, PS:28.24, CH:18.96, IL:4.58, L:4.19, CDU:2.58, BE:2.24, PAN:1.26, JPP:0.07} },
  { id:'EVORA', name:"Évora", seats:3, weight:1.37, v2025:{AD:25.41, PS:28.48, CH:25.42, IL:2.91, L:2.77, CDU:10.42, BE:1.79, PAN:0.95} },
  { id:'FARO', name:"Faro", seats:9, weight:3.72, v2025:{AD:26.35, PS:20.99, CH:34.70, IL:4.46, L:3.43, CDU:2.74, BE:2.54, PAN:1.85, JPP:0.12} },
  { id:'GUARDA', name:"Guarda", seats:3, weight:1.31, v2025:{AD:40.75, PS:27.19, CH:21.76, IL:2.52, L:1.55, CDU:1.31, BE:1.27, PAN:0.77} },
  { id:'LEIRIA', name:"Leiria", seats:10, weight:4.24, v2025:{AD:38.24, PS:19.59, CH:23.81, IL:6.22, L:3.62, CDU:2.13, BE:1.98, PAN:1.21} },
  { id:'LISBON', name:"Lisbon", seats:48, weight:20.56, v2025:{AD:29.09, PS:24.20, CH:21.32, IL:7.79, L:7.02, CDU:3.65, BE:2.40, PAN:1.88, JPP:0.07} },
  { id:'PORTALEGRE', name:"Portalegre", seats:2, weight:0.93, v2025:{AD:27.54, PS:28.73, CH:30.68, IL:1.97, L:1.76, CDU:5.30, BE:1.31, PAN:0.70} },
  { id:'PORTO', name:"Porto", seats:40, weight:17.72, v2025:{AD:34.98, PS:24.56, CH:21.12, IL:6.23, L:4.39, CDU:2.33, BE:2.07, PAN:1.53, JPP:0.07} },
  { id:'SANTAREM', name:"Santarém", seats:9, weight:3.93, v2025:{AD:31.40, PS:23.34, CH:28.86, IL:4.03, L:3.30, CDU:3.69, BE:1.84, PAN:1.16} },
  { id:'SETUBAL', name:"Setúbal", seats:19, weight:7.93, v2025:{AD:21.47, PS:25.52, CH:26.96, IL:5.97, L:5.63, CDU:7.27, BE:2.72, PAN:1.92, JPP:0.09} },
  { id:'VIANA', name:"Viana do Castelo", seats:5, weight:2.25, v2025:{AD:40.65, PS:22.31, CH:23.59, IL:3.92, L:2.67, CDU:2.03, BE:1.68, PAN:0.95} },
  { id:'VILA_REAL', name:"Vila Real", seats:5, weight:1.83, v2025:{AD:45.46, PS:25.18, CH:20.47, IL:2.23, L:1.57, CDU:1.26, BE:1.03, PAN:0.70} },
  { id:'VISEU', name:"Viseu", seats:8, weight:3.32, v2025:{AD:43.93, PS:22.47, CH:22.76, IL:3.21, L:2.18, CDU:1.24, BE:1.22} },
  { id:'AZORES', name:"Azores", seats:5, weight:1.60, v2025:{AD:38.14, PS:24.62, CH:23.84, IL:3.60, L:2.62, CDU:1.26, BE:2.18, PAN:1.36, JPP:0.28} },
  { id:'MADEIRA', name:"Madeira", seats:6, weight:2.25, v2025:{AD:42.07, PS:13.70, CH:21.27, IL:2.68, L:1.28, CDU:1.29, BE:1.37, PAN:1.06, JPP:12.53} },
  { id:'EUROPE', name:"Europe", seats:2, weight:2.85, overseas:true, v2025:{AD:21.67, PS:20.03, CH:41.70, IL:3.74, L:3.26, CDU:1.28, BE:2.75, PAN:2.36, JPP:0.32} },
  { id:'OUTSIDE_EUROPE', name:"Outside Europe", seats:2, weight:1.07, overseas:true, v2025:{AD:29.40, PS:20.24, CH:31.17, IL:3.18, L:1.54, CDU:0.90, BE:2.71, PAN:3.11, JPP:0.36} },
];

const PT_CONST_MAP = Object.fromEntries(PT_CONSTITUENCIES.map(c => [c.id, c])) as Record<PtConstId, PtConstituency>;
const PT_TOTAL_CONST_WEIGHT = PT_CONSTITUENCIES.reduce((s, c) => s + c.weight, 0);

// Regional party landlocked to its home constituency (JPP = Madeira only)
const PT_REGIONAL_HOME: Partial<Record<PtPartyId, PtConstId[]>> = { JPP: ['MADEIRA'] };
function ptContests(partyId: PtPartyId, provId: PtConstId): boolean {
  const home = PT_REGIONAL_HOME[partyId];
  return !home || home.includes(provId);
}

// Max national vote % each party can reach in the simulator. National parties:
// 55 (the slider ceiling). Regional parties: their home region's share of the
// national electorate — i.e. the most they could win even taking 100% of every
// province they contest — so e.g. ERC cannot be dialled past ~Catalonia's size.
const PT_PARTY_VOTE_CAP: Record<PtPartyId, number> = (() => {
  const caps = {} as Record<PtPartyId, number>;
  for (const p of PT_PARTIES) {
    const home = PT_REGIONAL_HOME[p.id];
    caps[p.id] = home
      ? Math.round(home.reduce((s, id) => s + (PT_CONST_MAP[id]?.weight ?? 0), 0) / PT_TOTAL_CONST_WEIGHT * 1000) / 10
      : 55;
  }
  return caps;
})();

// ── D'Hondt — applied per province with 3 % provincial threshold ──────────────
function calcDHondtProv(
  votes:  Partial<Record<PtPartyId, number>>,
  seats:  number,
  thresh: number = 0,
): Partial<Record<PtPartyId, number>> {
  const total = Object.values(votes).reduce((s, v) => s + (v ?? 0), 0);
  if (total === 0 || seats === 0) return {};
  const qualifying = (Object.entries(votes) as [PtPartyId, number][])
    .filter(([, v]) => (v ?? 0) / total * 100 >= thresh && (v ?? 0) > 0);
  if (qualifying.length === 0) return {};
  const quotients: { id: PtPartyId; q: number }[] = [];
  for (const [id, v] of qualifying) {
    for (let d = 1; d <= seats; d++) quotients.push({ id, q: v / d });
  }
  quotients.sort((a, b) => b.q - a.q);
  const result: Partial<Record<PtPartyId, number>> = {};
  for (let i = 0; i < Math.min(seats, quotients.length); i++) {
    result[quotients[i].id] = (result[quotients[i].id] ?? 0) + 1;
  }
  return result;
}

// Proportional swing: prov_pct = base_2023 × (new_nat / old_nat), normalised
function calcProvVotes(
  natPcts:  Record<PtPartyId, number>,
  provId:   PtConstId,
  override?: Partial<Record<PtPartyId, number>>,
): Record<PtPartyId, number> {
  if (override && Object.keys(override).length > 0) {
    const raw: Record<PtPartyId, number> = {} as Record<PtPartyId, number>;
    let total = 0;
    // Landlock: regional parties get 0 outside their home provinces even if an override sets them.
    for (const p of PT_PARTIES) { raw[p.id] = ptContests(p.id, provId) ? Math.max(0, override[p.id] ?? 0) : 0; total += raw[p.id]; }
    if (total === 0) return raw;
    for (const p of PT_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
    return raw;
  }
  const base = PT_CONST_MAP[provId]?.v2025 ?? {};
  const raw: Record<PtPartyId, number> = {} as Record<PtPartyId, number>;
  let total = 0;
  for (const p of PT_PARTIES) {
    const newNat = natPcts[p.id] ?? 0;
    const oldNat = PT_VOTE_PCT_2025[p.id] ?? 0;
    const basePct = base[p.id] ?? 0;
    // Regional parties stay landlocked + proportional within their territory; national parties swing nationally
    raw[p.id] = !ptContests(p.id, provId) ? 0 : basePct === 0 ? 0 : oldNat === 0 ? basePct : basePct * (newNat / oldNat);
    total += raw[p.id];
  }
  if (total === 0) return raw;
  for (const p of PT_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
  return raw;
}

// Sum of per-province D'Hondt allocations — the actual Spanish method
function calcAllProvinceSeats(
  natPcts: Partial<Record<PtPartyId, number>>,
  provOverrides?: Partial<Record<PtConstId, Partial<Record<PtPartyId, number>>>>,
): Partial<Record<PtPartyId, number>> {
  const totals: Partial<Record<PtPartyId, number>> = {};
  for (const prov of PT_CONSTITUENCIES) {
    const provVotes = calcProvVotes(natPcts as Record<PtPartyId, number>, prov.id, provOverrides?.[prov.id]);
    const provSeats = calcDHondtProv(provVotes, prov.seats);
    for (const [id, s] of Object.entries(provSeats) as [PtPartyId, number][]) {
      totals[id] = (totals[id] ?? 0) + s;
    }
  }
  return totals;
}

// Partial-result seats: only from provinces that have reported (fraction > 0)
function calcPartialSeats(
  natPcts:         Record<PtPartyId, number>,
  provFractions:   Partial<Record<PtConstId, number>>,
  provOverrides?:  Partial<Record<PtConstId, Partial<Record<PtPartyId, number>>>>,
): Partial<Record<PtPartyId, number>> {
  const entries = Object.entries(provFractions) as [PtConstId, number][];
  if (entries.length === 0) return {};
  const totals: Partial<Record<PtPartyId, number>> = {};
  for (const [pId, frac] of entries) {
    if (!frac) continue;
    const prov = PT_CONST_MAP[pId];
    if (!prov) continue;
    const provVotes = calcProvVotes(natPcts, pId, provOverrides?.[pId]);
    const provSeats = calcDHondtProv(provVotes, prov.seats);
    for (const [id, s] of Object.entries(provSeats) as [PtPartyId, number][]) {
      totals[id] = (totals[id] ?? 0) + s;
    }
  }
  return totals;
}

// ── Simulation helpers ────────────────────────────────────────────────────────
function esRandNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function esBellCurveTimes(n: number, totalMs: number): number[] {
  return Array.from({ length: n }, () =>
    Math.max(0.02, Math.min(0.98, 0.5 + esRandNormal() * 0.18))
  ).sort((a, b) => a - b).map(t => Math.round(t * totalMs));
}

// Redistribute % when one slider moves; unlocked others absorb the change
function redistributePcts(
  current:   Record<PtPartyId, number>,
  changedId: PtPartyId,
  newRaw:    number,
  locks:     Set<PtPartyId>,
  caps?:     Record<PtPartyId, number>,   // per-party ceiling (e.g. region size); absent ⇒ uncapped
): Record<PtPartyId, number> {
  const capOf     = (id: PtPartyId) => caps?.[id] ?? 100;
  const ids       = Object.keys(current) as PtPartyId[];
  const lockedSum = ids.filter(id => locks.has(id) && id !== changedId).reduce((s, id) => s + (current[id] ?? 0), 0);
  const clamped   = Math.min(Math.max(newRaw, 0), capOf(changedId), 100 - lockedSum);
  const pool      = ids.filter(id => !locks.has(id) && id !== changedId);
  const seedSum   = pool.reduce((s, id) => s + (current[id] ?? 0), 0);
  const next: Record<PtPartyId, number> = { ...current, [changedId]: clamped };
  for (const id of pool) next[id] = 0;
  // Distribute the remainder proportionally to prior shares, but never above each
  // party's cap — overflow from capped parties spills to those with headroom.
  let remaining = 100 - lockedSum - clamped;
  let active = [...pool];
  for (let iter = 0; iter < 8 && active.length > 0 && remaining > 1e-6; iter++) {
    const wSum = active.reduce((s, id) => s + (seedSum > 0 ? (current[id] ?? 0) : 1), 0) || 1;
    const stillOpen: PtPartyId[] = [];
    let used = 0;
    for (const id of active) {
      const give = remaining * ((seedSum > 0 ? (current[id] ?? 0) : 1) / wSum);
      const add  = Math.min(give, Math.max(0, capOf(id) - (next[id] ?? 0)));
      next[id]   = (next[id] ?? 0) + add;
      used      += add;
      if (capOf(id) - (next[id] ?? 0) > 1e-6) stillOpen.push(id);
    }
    remaining -= used;
    active = stillOpen;
    if (used <= 1e-9) break;
  }
  return next;
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmtN(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'K';
  return String(n);
}
function hexToRgba(hex: string, alpha: number): string {
  const h    = hex.replace('#', '');
  const full = h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h;
  const r = parseInt(full.slice(0,2),16), g = parseInt(full.slice(2,4),16), b = parseInt(full.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function partyColor(id: PtPartyId): string { return PT_PARTY_MAP[id]?.color ?? '#888'; }

function getProvFill(
  natPcts:   Record<PtPartyId, number>,
  provId:    PtConstId,
  dark:      boolean,
  override?: Partial<Record<PtPartyId, number>>,
): string {
  const pv     = calcProvVotes(natPcts, provId, override);
  const sorted = (Object.entries(pv) as [PtPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return dark ? '#374151' : '#E5E7EB';
  const [winner, winPct] = sorted[0];
  const margin = winPct - (sorted[1]?.[1] ?? 0);
  const c = hsl(partyColor(winner));
  c.l = dark ? 0.55 - Math.min(margin / 20, 1) * 0.29 : 0.82 - Math.min(margin / 20, 1) * 0.46;
  return c.formatHex();
}

// ── Tooltip state ─────────────────────────────────────────────────────────────
type ProvTooltipState = {
  x: number; y: number; name: string;
  parties: { id: PtPartyId; pct: number; rawVotes?: number }[];
  leader: PtPartyId | null;
  reportingPct?: number;
} | null;

// ── Scoreboard tile ───────────────────────────────────────────────────────────
function PtScoreboardTile({
  partyId, seats, pct, rawVotes, isLeader, isWinner, is2026, dark: _dark,
}: {
  partyId: PtPartyId; seats: number; pct: number; rawVotes?: number;
  isLeader: boolean; isWinner: boolean; is2026?: boolean; dark?: boolean;
}) {
  const party      = PT_PARTY_MAP[partyId];
  const leaderName = is2026 && party.leader2026 ? party.leader2026 : party.leader;
  const leaderWiki = is2026 && party.wikiTitle2026 ? party.wikiTitle2026 : party.wikiTitle;
  const partyName  = is2026 && party.name2026 ? party.name2026 : party.name;
  const partyFull  = is2026 && party.fullName2026 ? party.fullName2026 : party.fullName;
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!leaderWiki) { setPhotoUrl(null); return; }
    let cancelled = false;
    fetchWikiPhoto(leaderWiki).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [leaderWiki]);

  const initials   = leaderName.split(' ').map((w: string) => w[0]).join('').slice(0, 2);
  const color      = partyColor(partyId);
  const colorAlpha = hexToRgba(color, 0.13);

  return (
    <div
      className={`cand-col${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`}
      style={{ '--cand-color': color, '--cand-color-alpha': colorAlpha,
        borderColor: (isLeader || isWinner) ? color : hexToRgba(color, 0.30) } as React.CSSProperties}
    >
      <div style={{ position: 'relative' }}>
        <div className="cand-circle-frame">
          {photoUrl
            ? <img src={photoUrl} alt={leaderName} onError={() => setPhotoUrl(null)} />
            : <span className="cand-initials">{initials}</span>}
        </div>
        {isWinner && (
          <span className="called-tick">
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
              <circle cx="8.5" cy="8.5" r="8.5" fill={color}/>
              <path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        )}
      </div>
      <span className="cand-leader-name" title={leaderName}>{leaderName.split(' ').slice(-1)[0]}</span>
      <span className="cand-party-abbrev">{partyName}</span>
      <span className="cand-seats">{seats}</span>
      <span className="cand-party-name" title={partyFull}>{partyFull}</span>
      <div style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:1 }}>
        <span style={{ fontSize:6.5, fontFamily:'"JetBrains Mono",monospace', fontWeight:600, color:hexToRgba(color,0.48), letterSpacing:'0.10em', textTransform:'uppercase' }}>VOTES</span>
        <span style={{ fontSize:11, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color }}>{pct.toFixed(1)}%</span>
      </div>
      {rawVotes != null && (
        <div style={{ width:'100%', display:'flex', justifyContent:'flex-end', marginBottom:2 }}>
          <span className="cand-votes-full"  style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', color:hexToRgba(color,0.65) }}>{rawVotes.toLocaleString()}</span>
          <span className="cand-votes-compact" style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', color:hexToRgba(color,0.65) }}>{fmtN(rawVotes)}</span>
        </div>
      )}
      <div className="cand-bar-track" style={{ width:'100%', height:3, borderRadius:2, background:'var(--bar-track)' }}>
        <div className="cand-bar-fill" style={{ height:'100%', borderRadius:2, background:color, width:`${Math.min(pct/40*100,100)}%`, transition:'width 0.3s ease' }} />
      </div>
    </div>
  );
}

// ── Scoreboard ────────────────────────────────────────────────────────────────

function PtScoreboard({
  natPcts, simSeats, isBaseline, is2026, dark, reportedVoteScale,
}: {
  natPcts: Record<PtPartyId,number>; simSeats?: Partial<Record<PtPartyId,number>>;
  isBaseline?: boolean; is2026?: boolean; dark?: boolean; reportedVoteScale?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const h = (e: WheelEvent) => { if (Math.abs(e.deltaX)>Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft+=e.deltaY; };
    el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h);
  }, []);

  const seats = useMemo(() => simSeats ?? calcAllProvinceSeats(natPcts), [simSeats, natPcts]);
  const pctTotal = Object.values(natPcts).reduce((s,v) => s+(v??0), 0);
  const scale    = reportedVoteScale ?? 1;

  // Portugal has no official blocs — render every party as its own tile, sorted by seats.
  const visible = PT_LR_ORDER.filter(id => (seats[id]??0)>0 || (natPcts[id]??0)>=0.1);
  const maxSeats = Math.max(0, ...visible.map(id => seats[id]??0));
  const ordered = visible.slice().sort((a,b)=>(seats[b]??0)-(seats[a]??0) || (natPcts[b]??0)-(natPcts[a]??0));

  const makeTile = (id: PtPartyId) => {
    const s   = seats[id] ?? 0;
    const pct = pctTotal > 0 ? (natPcts[id]??0)/pctTotal*100 : 0;
    const rawVotes = isBaseline
      ? Math.round((PT_VOTE_RAW_2025[id]??0)*scale)
      : Math.round((natPcts[id]??0)/100*PT_GRAND_TOTAL_VOTES*scale);
    const isWinner = s >= PT_MAJORITY;
    const isLeader = s>0 && s===maxSeats && !isWinner;
    return <PtScoreboardTile key={id} partyId={id} seats={s} pct={pct} rawVotes={rawVotes}
      isLeader={isLeader} isWinner={isWinner} is2026={is2026} dark={dark} />;
  };

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {ordered.map(id => makeTile(id))}
        </div>
      </div>
    </div>
  );
}

// ── Map controller ────────────────────────────────────────────────────────────
function MapController({ layerRef }: { layerRef: React.MutableRefObject<L.GeoJSON | null> }) {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer()); return () => ro.disconnect();
  }, [map]);
  useEffect(() => {
    const h = () => { layerRef.current?.eachLayer((l:L.Layer) => { const p=l as any; if(p.options) p.options.smoothFactor=0; }); };
    map.on('zoomend', h); return () => { map.off('zoomend', h); };
  }, [map, layerRef]);
  return null;
}

// ── Bubble overlay ────────────────────────────────────────────────────────────
type BubbleEntry = { marker: L.CircleMarker; baseRadius: number };
function zoomScale(zoom: number): number { return Math.max(0.15, Math.min(2.0, (zoom - 4) / (9 - 4))); }

function PtBubbleLayer({
  geoData, natPcts, containerRef, setTooltip, onSelect, natPctsRef,
  declaredProvs, provOverrides, provOverridesRef, blankMode, projectedProvs,
  simProvFractions, simNatPctsRef,
}: {
  geoData: any; natPcts: Record<PtPartyId,number>;
  containerRef: React.RefObject<HTMLDivElement|null>;
  setTooltip: (t:ProvTooltipState)=>void; onSelect: (id:PtConstId)=>void;
  natPctsRef: React.MutableRefObject<Record<PtPartyId,number>>;
  declaredProvs?: Set<PtConstId>;
  provOverrides?: Partial<Record<PtConstId,Partial<Record<PtPartyId,number>>>>;
  provOverridesRef: React.MutableRefObject<Partial<Record<PtConstId,Partial<Record<PtPartyId,number>>>>>;
  blankMode?: boolean; projectedProvs?: Set<PtConstId>;
  simProvFractions?: Partial<Record<PtConstId,number>>;
  simNatPctsRef?: React.MutableRefObject<Record<PtPartyId,number>|null>;
}) {
  const map        = useMap();
  const bubblesRef = useRef<BubbleEntry[]>([]);
  const simFracRef = useRef(simProvFractions ?? {});
  useEffect(() => { simFracRef.current = simProvFractions ?? {}; }, [simProvFractions]);

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
      const path   = layer as any;
      const geoId: string = path.feature?.properties?.name ?? '';
      const provId = PT_GEOID_TO_ID[geoId];
      if (!provId) return;
      if (declaredProvs && !declaredProvs.has(provId)) return;
      if (!declaredProvs && blankMode && !(projectedProvs?.has(provId))) return;
      const bounds = (layer as any).getBounds?.();
      if (!bounds?.isValid()) return;
      const center = bounds.getCenter();

      const pv     = calcProvVotes(natPcts, provId, provOverrides?.[provId]);
      const sorted = (Object.entries(pv) as [PtPartyId,number][]).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a);
      if (sorted.length === 0) return;
      const [winId, winPct] = sorted[0];
      const margin     = winPct - (sorted[1]?.[1] ?? 0);
      const prov       = PT_CONST_MAP[provId];
      // Bubble radius: margin-based + seat count bonus for large provinces
      const seatBonus  = Math.min((prov?.seats ?? 1) / 37 * 10, 10);
      const baseRadius = 8 + Math.min(margin/10,1)*18 + seatBonus;
      const color      = partyColor(winId);

      const marker = L.circleMarker(center, {
        radius:baseRadius*scale, color, fillColor:color, fillOpacity:0.72, weight:1, opacity:0.9,
      }).addTo(map);

      marker.on('click', () => { setTooltip(null); onSelect(provId); });
      marker.on('mousemove', (e: L.LeafletMouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
        const cur      = calcProvVotes(simNatPctsRef?.current ?? natPctsRef.current, provId, provOverridesRef.current?.[provId]);
        const fraction = simFracRef.current[provId] ?? 1;
        const provVotes = PT_GRAND_TOTAL_VOTES * (prov?.weight ?? 0) / PT_TOTAL_CONST_WEIGHT;
        const parties  = (Object.entries(cur) as [PtPartyId,number][])
          .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,8)
          .map(([id,pct]) => ({ id:id as PtPartyId, pct, rawVotes:Math.round(pct/100*provVotes*fraction) }));
        const pName = PT_CONST_MAP[provId]?.name ?? geoId;
        setTooltip({ x:e.originalEvent.clientX-rect.left, y:e.originalEvent.clientY-rect.top,
          name:pName, parties, leader:parties[0]?.id??null, reportingPct:Math.round(fraction*100) });
      });
      marker.on('mouseout', () => setTooltip(null));
      bubblesRef.current.push({ marker, baseRadius });
    });
    return () => { for (const {marker} of bubblesRef.current) marker.remove(); bubblesRef.current=[]; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geoData, natPcts, blankMode, projectedProvs, declaredProvs]);

  return null;
}

// ── Seat-distribution dots overlay (one dot per seat, grouped by party, at the
//    constituency centroid; re-laid-out on zoom). Ported from the Poland game. ──
function PtSeatDotsLayer({
  geoData, natPcts, containerRef, setTooltip, onSelect, natPctsRef,
  declaredProvs, provOverrides, provOverridesRef, blankMode, projectedProvs,
  simProvFractions, simNatPctsRef,
}: {
  geoData: any; natPcts: Record<PtPartyId,number>;
  containerRef: React.RefObject<HTMLDivElement|null>;
  setTooltip: (t:ProvTooltipState)=>void; onSelect: (id:PtConstId)=>void;
  natPctsRef: React.MutableRefObject<Record<PtPartyId,number>>;
  declaredProvs?: Set<PtConstId>;
  provOverrides?: Partial<Record<PtConstId,Partial<Record<PtPartyId,number>>>>;
  provOverridesRef: React.MutableRefObject<Partial<Record<PtConstId,Partial<Record<PtPartyId,number>>>>>;
  blankMode?: boolean; projectedProvs?: Set<PtConstId>;
  simProvFractions?: Partial<Record<PtConstId,number>>;
  simNatPctsRef?: React.MutableRefObject<Record<PtPartyId,number>|null>;
}) {
  const map = useMap();
  const dotsRef = useRef<L.CircleMarker[]>([]);
  const simFracRef = useRef(simProvFractions ?? {});
  useEffect(() => { simFracRef.current = simProvFractions ?? {}; }, [simProvFractions]);

  useEffect(() => {
    const layout = () => {
      for (const m of dotsRef.current) m.remove();
      dotsRef.current = [];
      const z = map.getZoom();
      const dotR = Math.max(1.8, Math.min(5.5, (z-5)/(9-5)*4 + 1.8));
      const gap  = dotR * 2.3;
      L.geoJSON(geoData).eachLayer((layer: L.Layer) => {
        const path = layer as any;
        const geoId: string = path.feature?.properties?.name ?? '';
        const provId = PT_GEOID_TO_ID[geoId];
        if (!provId) return;
        if (declaredProvs && !declaredProvs.has(provId)) return;
        if (!declaredProvs && blankMode && !(projectedProvs?.has(provId))) return;
        const bounds = (layer as any).getBounds?.(); if (!bounds?.isValid()) return;
        const center = bounds.getCenter();
        const prov = PT_CONST_MAP[provId];
        const pv = calcProvVotes(natPcts, provId, provOverrides?.[provId]);
        const alloc = calcDHondtProv(pv, prov?.seats ?? 0);
        const colors: string[] = [];
        for (const id of PT_LR_ORDER) { const n = alloc[id] ?? 0; for (let i=0;i<n;i++) colors.push(partyColor(id)); }
        if (colors.length === 0) return;
        const N = colors.length;
        const cols = Math.ceil(Math.sqrt(N));
        const rows = Math.ceil(N/cols);
        const cpt  = map.latLngToContainerPoint(center);
        for (let i=0;i<N;i++) {
          const r = Math.floor(i/cols), col = i%cols;
          const rowCount = (r===rows-1) ? (N-r*cols) : cols;
          const dx = (col-(rowCount-1)/2)*gap;
          const dy = (r-(rows-1)/2)*gap;
          const latlng = map.containerPointToLatLng(L.point(cpt.x+dx, cpt.y+dy));
          const m = L.circleMarker(latlng, { radius:dotR, color:'#0b0b0d', weight:0.5, opacity:0.55, fillColor:colors[i], fillOpacity:0.95 }).addTo(map);
          m.on('click', () => { setTooltip(null); onSelect(provId); });
          m.on('mousemove', (e:L.LeafletMouseEvent) => {
            const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
            const cur = calcProvVotes(simNatPctsRef?.current ?? natPctsRef.current, provId, provOverridesRef.current?.[provId]);
            const fraction = simFracRef.current[provId] ?? 1;
            const provVots = PT_GRAND_TOTAL_VOTES * (prov?.weight??0) / PT_TOTAL_CONST_WEIGHT;
            const parties = (Object.entries(cur) as [PtPartyId,number][])
              .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,8)
              .map(([id,pct]) => ({ id:id as PtPartyId, pct, rawVotes:Math.round(pct/100*provVots*fraction) }));
            setTooltip({ x:e.originalEvent.clientX-rect.left, y:e.originalEvent.clientY-rect.top,
              name:prov?.name??geoId, parties, leader:parties[0]?.id??null, reportingPct:Math.round(fraction*100) });
          });
          m.on('mouseout', () => setTooltip(null));
          dotsRef.current.push(m);
        }
      });
    };
    layout();
    map.on('zoomend', layout);
    return () => { map.off('zoomend', layout); for (const m of dotsRef.current) m.remove(); dotsRef.current=[]; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geoData, natPcts, blankMode, projectedProvs, declaredProvs, provOverrides]);

  return null;
}

// ── Province draft ────────────────────────────────────────────────────────────
type PtConstDraft = { provId: PtConstId; pcts: Record<PtPartyId,number>; rptPct: number };

// ── Map view ──────────────────────────────────────────────────────────────────
function PtMapView({
  natPcts, selectedProv, onSelect, dark, bubbleMap, seatDots,
  declaredProvs, provOverrides, blankMode, projectedProvs, simProvFractions,
  provDraft, simNatPcts,
}: {
  natPcts: Record<PtPartyId,number>; selectedProv: PtConstId|null;
  onSelect: (id:PtConstId)=>void; dark: boolean; bubbleMap: boolean; seatDots: boolean;
  declaredProvs?: Set<PtConstId>;
  provOverrides?: Partial<Record<PtConstId,Partial<Record<PtPartyId,number>>>>;
  blankMode?: boolean; projectedProvs?: Set<PtConstId>;
  simProvFractions?: Partial<Record<PtConstId,number>>;
  provDraft?: PtConstDraft|null; simNatPcts?: Record<PtPartyId,number>|null;
}) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const layerRef        = useRef<L.GeoJSON|null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltip, setTooltip] = useState<ProvTooltipState>(null);

  const natPctsRef      = useRef(natPcts);
  const selectedRef     = useRef(selectedProv);
  const darkRef         = useRef(dark);
  const onSelectRef     = useRef(onSelect);
  const declaredRef     = useRef(declaredProvs);
  const provOverridesRef= useRef(provOverrides ?? {});
  const blankModeRef    = useRef(blankMode ?? false);
  const projectedRef    = useRef(projectedProvs ?? new Set<PtConstId>());
  const simFracRef2     = useRef(simProvFractions ?? {});
  const provDraftRef2   = useRef<PtConstDraft|null>(provDraft ?? null);
  const simNatPctsRef2  = useRef<Record<PtPartyId,number>|null>(simNatPcts ?? null);

  useEffect(() => { natPctsRef.current        = natPcts;               }, [natPcts]);
  useEffect(() => { selectedRef.current       = selectedProv;          }, [selectedProv]);
  useEffect(() => { darkRef.current           = dark;                  }, [dark]);
  useEffect(() => { onSelectRef.current       = onSelect;              }, [onSelect]);
  useEffect(() => { declaredRef.current       = declaredProvs;         }, [declaredProvs]);
  useEffect(() => { provOverridesRef.current  = provOverrides ?? {};   }, [provOverrides]);
  useEffect(() => { blankModeRef.current      = blankMode ?? false;    }, [blankMode]);
  useEffect(() => { projectedRef.current      = projectedProvs ?? new Set(); }, [projectedProvs]);
  useEffect(() => { simFracRef2.current       = simProvFractions ?? {}; }, [simProvFractions]);
  useEffect(() => { provDraftRef2.current     = provDraft ?? null;      }, [provDraft]);
  useEffect(() => { simNatPctsRef2.current    = simNatPcts ?? null;     }, [simNatPcts]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}portugal-districts.geojson`)
      .then(r => r.json()).then(setGeoData).catch(console.error);
  }, []);

  const getStyle = useCallback((feature: any): L.PathOptions => {
    const geoId  = feature?.properties?.name ?? '';
    const provId = PT_GEOID_TO_ID[geoId];
    const isSel  = provId === selectedProv;
    const border = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)';

    if (bubbleMap) return { fillOpacity:0, weight:0.4, color:dark?'rgba(255,255,255,0.18)':'rgba(0,0,0,0.18)', opacity:0.6 };
    if (seatDots) return { fillColor:dark?'#1f2937':'#EEF1F5', fillOpacity:isSel?0.5:0.32, weight:isSel?1.4:0.5, color:isSel?'#c8a020':border, opacity:0.7 };
    if (!provId)   return { fillColor:dark?'#374151':'#E5E7EB', fillOpacity:0.5, weight:0.4, color:border, opacity:1 };

    const simFrac    = simProvFractions?.[provId];
    const hasSimData = simFrac !== undefined && simFrac > 0;

    if (blankMode && !hasSimData) {
      const hasOverride = !!provOverrides?.[provId] && Object.keys(provOverrides[provId]!).length > 0;
      if (!hasOverride) return { fillColor:dark?'#1f2937':'#d1d5db', fillOpacity:0.7, weight:isSel?2:0.4, color:isSel?'#c8a020':border, opacity:1 };
    }
    const isDeclared = !declaredProvs || declaredProvs.has(provId);
    if (!isDeclared && !hasSimData) return { fillColor:dark?'#1f2937':'#d1d5db', fillOpacity:0.7, weight:0.4, color:border, opacity:1 };

    const effectiveNatPcts = simNatPcts ?? natPcts;
    const fill    = getProvFill(effectiveNatPcts, provId, dark, provOverrides?.[provId]);
    const opacity = isDeclared ? 0.78 : Math.max(0.35, 0.78*(simFrac??1));
    return { fillColor:fill, fillOpacity:opacity, weight:isSel?2:0.4, color:isSel?'#c8a020':border, opacity:1 };
  }, [natPcts, selectedProv, dark, bubbleMap, seatDots, declaredProvs, provOverrides, blankMode, simProvFractions, simNatPcts]);

  useEffect(() => { layerRef.current?.setStyle((f:any)=>getStyle(f)); }, [getStyle]);

  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const geoId  = feature?.properties?.name ?? '';
    const provId = PT_GEOID_TO_ID[geoId];

    layer.on('click', () => { if (provId) onSelectRef.current(provId); });
    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (!provId) { setTooltip(null); return; }
      const draft    = provDraftRef2.current;
      const hasDraft = draft?.provId === provId;
      if (blankModeRef.current && !declaredRef.current) {
        const hasOverride = !!provOverridesRef.current[provId] && Object.keys(provOverridesRef.current[provId]!).length > 0;
        if (!hasOverride && !hasDraft) { setTooltip(null); return; }
      }
      const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
      const overrideToUse = hasDraft ? draft!.pcts : provOverridesRef.current?.[provId];
      const fraction      = hasDraft ? draft!.rptPct/100 : simFracRef2.current[provId] ?? (declaredRef.current?.has(provId) ? 1 : undefined);
      const effectiveNatPcts = simNatPctsRef2.current ?? natPctsRef.current;
      const prov     = PT_CONST_MAP[provId];
      const provVots = PT_GRAND_TOTAL_VOTES * (prov?.weight??0) / PT_TOTAL_CONST_WEIGHT;
      const pv       = calcProvVotes(effectiveNatPcts, provId, overrideToUse);
      const parties  = (Object.entries(pv) as [PtPartyId,number][])
        .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,8)
        .map(([id,pct]) => ({ id:id as PtPartyId, pct, rawVotes:Math.round(pct/100*provVots*(fraction??1)) }));
      setTooltip({ x:e.originalEvent.clientX-rect.left, y:e.originalEvent.clientY-rect.top,
        name:prov?.name??geoId, parties, leader:parties[0]?.id??null,
        reportingPct:fraction!=null ? Math.round(fraction*100) : undefined });
    });
    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[39.5, -8.0]} zoom={6} style={{ width:'100%', height:'100%' }} zoomControl worldCopyJump={false}>
        <TileLayer
          key={dark?'dark':'light'}
          url={dark
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
          attribution='&copy; OpenStreetMap &copy; CARTO'
          subdomains="abcd" updateWhenZooming={false} updateWhenIdle={true} maxZoom={20}
        />
        <MapController layerRef={layerRef} />
        {geoData && (
          <GeoJSON ref={layerRef as any} data={geoData}
            style={(f:any)=>getStyle(f)} onEachFeature={onEachFeature}
            {...({ smoothFactor:0 } as any)} />
        )}
        {geoData && bubbleMap && (
          <PtBubbleLayer
            geoData={geoData} natPcts={simNatPcts??natPcts} containerRef={containerRef}
            setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef}
            declaredProvs={declaredProvs} provOverrides={provOverrides}
            provOverridesRef={provOverridesRef} blankMode={blankMode}
            projectedProvs={projectedProvs} simProvFractions={simProvFractions}
            simNatPctsRef={simNatPctsRef2}
          />
        )}
        {geoData && seatDots && (
          <PtSeatDotsLayer
            geoData={geoData} natPcts={simNatPcts??natPcts} containerRef={containerRef}
            setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef}
            declaredProvs={declaredProvs} provOverrides={provOverrides}
            provOverridesRef={provOverridesRef} blankMode={blankMode}
            projectedProvs={projectedProvs} simProvFractions={simProvFractions}
            simNatPctsRef={simNatPctsRef2}
          />
        )}
      </MapContainer>

      {/* ── Tooltip ── */}
      {tooltip && (() => {
        const cw=containerRef.current?.clientWidth??9999; const TW=228;
        const left=tooltip.x+18+TW>cw ? tooltip.x-TW-10 : tooltip.x+18;
        const tt={ bg:dark?'rgba(18,24,44,0.97)':'rgba(255,255,255,0.98)', border:dark?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.09)', shadow:dark?'0 6px 28px rgba(0,0,0,0.55)':'0 6px 28px rgba(0,0,0,0.13)', title:dark?'rgba(255,255,255,0.93)':'rgba(0,0,0,0.86)', sub:dark?'rgba(255,255,255,0.40)':'rgba(0,0,0,0.42)', body:dark?'rgba(255,255,255,0.86)':'rgba(0,0,0,0.79)' };
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top:Math.max(6,tooltip.y-20), width:TW }}>
            <div style={{ background:tt.bg, borderRadius:10, border:`1px solid ${tt.border}`, boxShadow:tt.shadow, backdropFilter:'blur(12px)', padding:'12px 14px' }}>
              <div style={{ fontSize:13, fontWeight:700, color:tt.title, lineHeight:1.2 }}>{tooltip.name}</div>
              <div style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', color:tt.sub, marginTop:2 }}>
                {tooltip.reportingPct!=null ? `${tooltip.reportingPct}% reporting` : 'Estimated district result'}
              </div>
              <div style={{ marginTop:9, display:'flex', flexDirection:'column', gap:5 }}>
                {tooltip.parties.map(({ id, pct, rawVotes },i) => {
                  const pColor=partyColor(id);
                  return (
                    <div key={id} style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:7, height:7, borderRadius:2, flexShrink:0, background:pColor }} />
                      <span style={{ flex:1, fontSize:11, fontWeight:i===0?600:400, color:tt.body, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{PT_PARTY_MAP[id]?.name??id}</span>
                      <span style={{ fontSize:11, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color:pColor }}>{pct.toFixed(1)}%</span>
                      {rawVotes!=null && <span style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', color:tt.sub, marginLeft:2 }}>{rawVotes.toLocaleString()}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
      <div className="absolute bottom-2 right-2 text-[10px] text-ink-3 select-none z-[1000] font-mono">Scroll to zoom · Click to open</div>
      {/* Overseas constituencies (no map geometry) — click to view / project */}
      <div className="absolute top-2 right-2 z-[1000] flex flex-col gap-1 items-end">
        <div className="text-[7.5px] font-mono uppercase tracking-wider text-ink-3 pr-1">Overseas</div>
        {PT_CONSTITUENCIES.filter(c => c.overseas).map(c => {
          const sel        = selectedProv === c.id;
          const declared   = !declaredProvs || declaredProvs.has(c.id);
          const projected  = projectedProvs?.has(c.id);
          const hasOverride= !!provOverrides?.[c.id] && Object.keys(provOverrides[c.id]!).length > 0;
          const hasSim     = (simProvFractions?.[c.id] ?? 0) > 0;
          const showResult = (!blankMode && declared) || projected || hasOverride || hasSim;
          let col = dark ? '#475569' : '#9aa0a6';
          if (showResult) {
            const pv  = calcProvVotes(simNatPcts ?? natPcts, c.id, provOverrides?.[c.id]);
            const win = (Object.entries(pv) as [PtPartyId,number][]).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a)[0]?.[0];
            if (win) col = partyColor(win);
          }
          return (
            <button key={c.id} onClick={() => onSelect(c.id)} title={`${c.name} — ${c.seats} seats (overseas)`}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-[5px] border text-[9px] font-mono transition-colors ${dark?'bg-[rgba(13,27,46,0.92)] border-white/10 text-white hover:bg-white/10':'bg-white/95 border-default text-ink hover:bg-black/5'} ${sel?'ring-1 ring-[#c8a020]':''}`}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col }} />
              <span>{c.name}</span><span className="opacity-50">·{c.seats}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Parliament hemicycle — 7 rows ─────────────────────────────────────────────
function PtParliamentPanel({ seats: seatsMap, onClose, exiting, dark }: {
  seats: Partial<Record<PtPartyId,number>>; onClose:()=>void; exiting?:boolean; dark?:boolean;
}) {
  const seatColors: string[] = [];
  const legend: { id:PtPartyId; count:number; color:string }[] = [];
  for (const id of PT_LR_ORDER) {
    const n = seatsMap[id] ?? 0; if (n===0) continue;
    const color = partyColor(id); legend.push({ id, count:n, color });
    for (let i=0; i<n; i++) seatColors.push(color);
  }
  const totalSeats = seatColors.length;
  const W=380, H=215, cx=W/2, cy=H-6, innerR=68, rowSpacing=18, numRows=7;
  const radii   = Array.from({length:numRows},(_,i)=>innerR+i*rowSpacing);
  const arcLens = radii.map(r=>Math.PI*r);
  const totalArc= arcLens.reduce((s,v)=>s+v,0);
  const rawPerRow  = arcLens.map(a=>(a/totalArc)*PT_TOTAL_SEATS);
  const floored    = rawPerRow.map(Math.floor);
  const remainder  = PT_TOTAL_SEATS - floored.reduce((s,v)=>s+v,0);
  rawPerRow.map((v,i)=>({i,rem:v-floored[i]})).sort((a,b)=>b.rem-a.rem).slice(0,remainder).forEach(({i})=>floored[i]++);
  const positions: {x:number;y:number;θ:number;r:number}[] = [];
  for (let row=0;row<numRows;row++) {
    const r=radii[row], n=floored[row];
    for (let j=0;j<n;j++) {
      const θ=Math.PI-Math.PI*(j+0.5)/n;
      positions.push({x:cx+r*Math.cos(θ),y:cy-r*Math.sin(θ),θ,r});
    }
  }
  positions.sort((a,b)=>b.θ-a.θ||a.r-b.r);
  const dotR=2.6;
  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-r border-default flex flex-col overflow-hidden ${exiting?'panel-exit-left':'panel-slide-left'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Assembly of the Republic — 230 seats</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">{totalSeats} seats · majority {PT_MAJORITY} · sorted by ideology</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll">
        {totalSeats===0 ? (
          <div className="flex items-center justify-center h-40 text-ink-3 text-[11px] font-mono px-4 text-center">Load results or run simulation first</div>
        ) : (
          <>
            <div className="px-1 pt-4 pb-1">
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{display:'block'}}>
                <line x1={cx} y1={cy-innerR+2} x2={cx} y2={cy-(innerR+(numRows-1)*rowSpacing)-10} stroke={dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)'} strokeWidth="1" strokeDasharray="3,4"/>
                <text x={cx-2} y={cy-innerR-14} textAnchor="middle" style={{fontSize:8,fill:dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.30)',fontFamily:'"JetBrains Mono",monospace'}}>← izq · der →</text>
                {positions.map(({x,y},i)=>(
                  <circle key={i} cx={x} cy={y} r={dotR} fill={i<seatColors.length?seatColors[i]:(dark?'#2d3748':'#e5e7eb')} opacity={i<seatColors.length?1:0.4}/>
                ))}
                <line x1={cx} y1={cy-innerR-2} x2={cx} y2={cy-(innerR+(numRows-1)*rowSpacing)-4} stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="2,3" opacity="0.6"/>
              </svg>
            </div>
            <div className="px-3.5 pb-4">
              <div className="flex items-center gap-1.5 mb-3 text-[9px] font-mono">
                <span className="text-ink-3">{PT_TOTAL_SEATS} seats elected</span>
                <span style={{color:dark?'rgba(255,255,255,0.25)':'rgba(0,0,0,0.25)',marginLeft:'auto'}}>majority {PT_MAJORITY}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {legend.map(({id,count,color})=>(
                  <div key={id} className="flex items-center gap-1.5">
                    <div style={{width:9,height:9,borderRadius:2,background:color,flexShrink:0}}/>
                    <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">{PT_PARTY_MAP[id].name}</span>
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

// ── Coalition builder ─────────────────────────────────────────────────────────
const PT_PRESET_COALITIONS: {name:string;emoji:string;parties:PtPartyId[]}[] = [
  {name:'Left (Geringonça)',  emoji:'🌹', parties:['PS','L','BE','CDU','PAN']},
  {name:'AD + Chega',         emoji:'➕', parties:['AD','CH']},
  {name:'AD + IL',            emoji:'🔵', parties:['AD','IL']},
  {name:'Right bloc',         emoji:'➡️', parties:['AD','IL','CH']},
  {name:'Central bloc',       emoji:'🤝', parties:['AD','PS']},
];

function PtCoalitionPanel({ seats, onClose, exiting, dark }: {
  seats:Partial<Record<PtPartyId,number>>; onClose:()=>void; exiting?:boolean; dark?:boolean;
}) {
  const [selected,setSelected] = useState<Set<PtPartyId>>(new Set(['AD','CH']));
  const toggle = (id:PtPartyId) => setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const totalCoalSeats=[...selected].reduce((s,id)=>s+(seats[id]??0),0);
  const hasMajority=totalCoalSeats>=PT_MAJORITY;
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Coalition Builder</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Majority: {PT_MAJORITY} seats · {PT_TOTAL_SEATS} total</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="px-3.5 pt-3 pb-2 border-b border-default shrink-0">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {PT_PRESET_COALITIONS.map(coal=>(
            <button key={coal.name} onClick={()=>setSelected(new Set(coal.parties))}
              className="text-left px-2 py-1.5 rounded-[4px] border border-default hover:bg-hover transition-colors">
              <div className="text-[8px] font-bold text-ink truncate">{coal.emoji} {coal.name}</div>
              <div className="text-[7px] font-mono text-ink-3">{coal.parties.map(id=>PT_PARTY_MAP[id]?.name).join(' + ')}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Toggle Parties</div>
        <div className="space-y-1.5">
          {PT_LR_ORDER.map(id=>{
            const party=PT_PARTY_MAP[id]; const s=seats[id]??0; const isIn=selected.has(id); const color=partyColor(id);
            return (
              <button key={id} onClick={()=>toggle(id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-[4px] border transition-colors ${isIn?'border-transparent':'border-default hover:bg-hover'}`}
                style={isIn?{background:hexToRgba(color,0.12),borderColor:hexToRgba(color,0.40)}:{}}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:color}}/>
                <span className="flex-1 text-[10px] font-medium text-ink truncate text-left">{party.fullName}</span>
                <span className="text-[9px] font-mono font-bold" style={{color}}>{s}s</span>
                {isIn&&<svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M2 4.5l1.8 1.8L7 2.5" stroke={color} strokeWidth="1.4" strokeLinecap="round"/></svg>}
              </button>
            );
          })}
        </div>
      </div>
      <div className={`px-3.5 py-3 border-t border-default shrink-0 ${hasMajority?'bg-emerald-500/10':''}`}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono font-bold text-ink">Coalition total</span>
          <span className="text-[20px] font-black font-mono" style={{color:hasMajority?'#16a34a':'#ef4444'}}>{totalCoalSeats}</span>
        </div>
        <div className="mt-1 h-2 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)'}}>
          <div className="h-full rounded-full transition-all duration-300"
            style={{width:`${Math.min(totalCoalSeats/PT_TOTAL_SEATS*100,100)}%`,background:hasMajority?'#16a34a':'#ef4444'}}/>
        </div>
        <div className={`mt-1.5 text-[9px] font-mono text-center font-bold ${hasMajority?'text-emerald-600':'text-red-500'}`}>
          {hasMajority?`✓ MAJORITY (need ${PT_MAJORITY})`:`✗ ${PT_MAJORITY-totalCoalSeats} seats short of majority`}
        </div>
      </div>
    </aside>
  );
}

// ── Parties panel ─────────────────────────────────────────────────────────────
function PtPartiesPanel({ hiddenParties,onToggle,onClose,dark }: {
  hiddenParties:Set<PtPartyId>; onToggle:(id:PtPartyId)=>void; onClose:()=>void; dark?:boolean;
}) {
  const allHidden=PT_LR_ORDER.every(id=>hiddenParties.has(id));
  return (
    <aside className={`w-56 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-bold text-ink leading-none">Parties</h2>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Show in sliders</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 thin-scroll">
        {PT_LR_ORDER.map(id=>{
          const party=PT_PARTY_MAP[id]; const hidden=hiddenParties.has(id);
          return (
            <button key={id} onClick={()=>onToggle(id)}
              className={`w-full flex items-center gap-2 px-3.5 py-1.5 text-left transition-colors hover:bg-hover ${hidden?'opacity-40':''}`}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{background:party.color}}/>
              <span className="text-[10.5px] font-medium text-ink flex-1 truncate">{party.name} · {party.fullName}</span>
              <span className={`w-3.5 h-3.5 rounded-sm flex items-center justify-center shrink-0 ${hidden?'border border-default':''}`}
                style={hidden?{}:{background:party.color}}>
                {!hidden&&<svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="px-3.5 pb-3 pt-2 border-t border-default shrink-0">
        <button onClick={()=>{for(const id of PT_LR_ORDER){if(allHidden?hiddenParties.has(id):!hiddenParties.has(id))onToggle(id);}}}
          className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
          {allHidden?'Show All':'Hide All'}
        </button>
      </div>
    </aside>
  );
}

// ── Province breakdown (blank map sliders) ────────────────────────────────────
// ── 2025 result reference (left popup for the selected blank-map constituency) ─
function PtConstRefPanel({ provId, dark, onClose }:{ provId:PtConstId; dark?:boolean; onClose:()=>void }) {
  const c = PT_CONST_MAP[provId];
  const votes:Partial<Record<PtPartyId,number>> = {};
  for (const id of PT_LR_ORDER) { const v = c?.v2025?.[id] ?? 0; if (v>0) votes[id]=v; }
  const seats = calcDHondtProv(votes, c?.seats ?? 0);
  const rows  = PT_LR_ORDER.filter(id=>(votes[id]??0)>0).sort((a,b)=>(votes[b]??0)-(votes[a]??0));
  const maxPct = Math.max(1, ...rows.map(id=>votes[id]??0));
  const ink3 = dark?'rgba(255,255,255,0.4)':'rgba(0,0,0,0.4)';
  return (
    <aside className={`w-64 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-r border-default flex flex-col overflow-hidden panel-slide-left`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">{c?.name} · 2025</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Official result · {c?.seats} seats{c?.overseas?' · overseas':''}</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-2">
        {rows.map(id=>{
          const p=PT_PARTY_MAP[id]; const pct=votes[id]??0; const s=seats[id]??0; const col=partyColor(id);
          return (
            <div key={id}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{background:col}}/>
                <span className="text-[10px] font-medium text-ink flex-1 truncate">{p.name}</span>
                <span className="text-[9px] font-mono tabular-nums text-ink-3">{pct.toFixed(1)}%</span>
                <span className="text-[10px] font-mono font-bold tabular-nums text-ink" style={{minWidth:22,textAlign:'right'}}>{s}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.06)'}}>
                <div style={{width:`${pct/maxPct*100}%`,height:'100%',borderRadius:4,background:col,opacity:0.85}}/>
              </div>
            </div>
          );
        })}
        <div className="text-[8px] font-mono pt-1" style={{color:ink3}}>Seats by D'Hondt · no legal threshold</div>
      </div>
    </aside>
  );
}

function PtConstPanel({
  provId,natPcts,provOverride,onOverride,onResetOverride,onClose,
  isBlankMode,isProjected,reportingPct,onProject,onReportingPctChange,
  onDraftChange,hiddenParties,dark,onShowReference,referenceOpen,
}: {
  provId:PtConstId; natPcts:Record<PtPartyId,number>;
  provOverride?:Partial<Record<PtPartyId,number>>;
  onOverride:(pcts:Partial<Record<PtPartyId,number>>)=>void;
  onResetOverride:()=>void; onClose:()=>void;
  isBlankMode?:boolean; isProjected?:boolean; reportingPct?:number;
  onProject?:()=>void; onReportingPctChange?:(pct:number)=>void;
  onDraftChange?:(pcts:Record<PtPartyId,number>,rptPct:number)=>void;
  hiddenParties?:Set<PtPartyId>; dark?:boolean; onShowReference?:()=>void; referenceOpen?:boolean;
}) {
  const [locks,setLocks]             = useState<Set<PtPartyId>>(new Set());
  const baseVotes = useMemo(()=>calcProvVotes(natPcts,provId),[natPcts,provId]);
  const [draftPcts,setDraftPcts]     = useState<Record<PtPartyId,number>>(()=>
    provOverride&&Object.keys(provOverride).length>0?{...calcProvVotes(natPcts,provId,provOverride)}:{...baseVotes});
  const [localRptPct,setLocalRptPct] = useState(reportingPct??100);
  const [touched,setTouched]         = useState(!!provOverride&&Object.keys(provOverride).length>0);

  useEffect(()=>{
    setLocks(new Set());
    const base=calcProvVotes(natPcts,provId);
    setDraftPcts(provOverride&&Object.keys(provOverride).length>0?{...calcProvVotes(natPcts,provId,provOverride)}:{...base});
    setLocalRptPct(reportingPct??100); setTouched(!!provOverride&&Object.keys(provOverride).length>0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[provId]);

  useEffect(()=>{ if(isBlankMode) onDraftChange?.(draftPcts,localRptPct); },[draftPcts,localRptPct,isBlankMode]); // eslint-disable-line

  const effectiveLocks=useMemo(()=>new Set<PtPartyId>([...locks,...(hiddenParties??[])]),[locks,hiddenParties]);
  const displayPv   =isBlankMode?draftPcts:calcProvVotes(natPcts,provId,provOverride);
  const [sortedIds] =useState<PtPartyId[]>(()=>PT_PARTIES.map(p=>p.id).filter(id=>(baseVotes[id]??0)>0).sort((a,b)=>(baseVotes[b]??0)-(baseVotes[a]??0)));
  const prov        =PT_CONST_MAP[provId];
  const winner      =PT_PARTIES.reduce((best,p)=>(displayPv[p.id]??0)>(displayPv[best.id]??0)?p:best,PT_PARTIES[0]);
  const hasOverride =!!provOverride&&Object.keys(provOverride).length>0;
  const provTotalVotes=Math.round(PT_GRAND_TOTAL_VOTES*(prov?.weight??0)/PT_TOTAL_CONST_WEIGHT);
  const sliderTrack=dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';

  const handleSlider=(id:PtPartyId,val:number)=>{
    if(isBlankMode){setDraftPcts(redistributePcts(draftPcts,id,val,effectiveLocks));setTouched(true);}
    else onOverride(redistributePcts(displayPv as Record<PtPartyId,number>,id,val,effectiveLocks));
  };
  const handleProject=()=>{
    if(!touched)return; onOverride(draftPcts); onReportingPctChange?.(localRptPct); onProject?.();
  };

  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold text-ink leading-tight truncate">{prov?.name??provId}</h2>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {isBlankMode?(isProjected?'Projected · adjust & re-project':'Blank map · set district result'):(hasOverride?'Custom override':'Estimated · drag sliders')}
            </p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-[4px]" style={{borderLeft:`3px solid ${winner.color}`,background:dark?'rgba(255,255,255,0.04)':'#f8f7f4'}}>
          <span className="text-[11px] font-medium text-ink flex-1 truncate">{winner.fullName}</span>
          <span className="text-[9px] font-mono text-ink-3">{(displayPv[winner.id]??0).toFixed(1)}%</span>
          <span className="text-[8px] font-mono text-ink-3">{prov?.seats??0} seats</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {isBlankMode&&(
          <div className="px-3.5 pt-3 pb-3 border-b border-default">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[8px] font-mono font-bold uppercase tracking-[0.14em]" style={{color:dark?'rgba(255,255,255,0.38)':'rgba(0,0,0,0.40)'}}>% Reporting</span>
              <span className="text-[13px] font-mono font-black tabular-nums" style={{color:localRptPct<50?'#ef4444':localRptPct<100?'#f59e0b':'#16a34a'}}>{localRptPct}%</span>
            </div>
            <div style={{position:'relative',height:18,display:'flex',alignItems:'center'}}>
              <div style={{position:'absolute',left:0,right:0,height:4,borderRadius:4,background:sliderTrack}}/>
              <div style={{position:'absolute',left:0,width:`${localRptPct}%`,height:4,borderRadius:4,background:localRptPct<50?'#ef4444':localRptPct<100?'#f59e0b':'#16a34a',transition:'width 0.05s'}}/>
              <input type="range" min={1} max={100} step={1} value={localRptPct}
                onChange={e=>{setLocalRptPct(+e.target.value);setTouched(true);}}
                className="br-party-slider w-full"
                style={{'--party-color':localRptPct<50?'#ef4444':localRptPct<100?'#f59e0b':'#16a34a','--pct':`${localRptPct}%`,position:'relative',zIndex:1}as React.CSSProperties}/>
            </div>
            <div className="text-[8px] font-mono mt-0.5" style={{color:dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.32)'}}>
              ≈{Math.round(provTotalVotes*localRptPct/100).toLocaleString()} votes counted
            </div>
          </div>
        )}
        <div className="px-3.5 space-y-3 py-3">
          {sortedIds.filter(id=>!hiddenParties?.has(id)&&(isBlankMode||(displayPv[id]??0)>=0.1||locks.has(id))).map(id=>{
            const p=PT_PARTY_MAP[id]; const pct=displayPv[id]??0; const isLocked=locks.has(id); const color=p.color;
            const rawVotes=Math.round((pct/100)*provTotalVotes*(isBlankMode?localRptPct/100:1));
            return (
              <div key={id}>
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:color}}/>
                  <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{p.fullName}</span>
                  <button onClick={()=>setLocks(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;})}
                    className={`w-4 h-4 flex items-center justify-center shrink-0 ${isLocked?'text-gold':'text-ink-3 hover:text-ink'}`}>
                    {isLocked
                      ?<svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                      :<svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>}
                  </button>
                  <span className="text-[10px] font-mono font-bold tabular-nums" style={{color}}>{pct.toFixed(1)}%</span>
                </div>
                <input type="range" min={0} max={70} step={0.1} value={pct} disabled={isLocked}
                  onChange={e=>handleSlider(id,parseFloat(e.target.value))}
                  className="br-party-slider w-full"
                  style={{'--party-color':color,'--pct':`${(pct/70)*100}%`}as React.CSSProperties}/>
                <div className="flex justify-between mt-0.5">
                  <span className="text-[8px] font-mono" style={{color:dark?'rgba(255,255,255,0.22)':'rgba(0,0,0,0.28)'}}>{rawVotes.toLocaleString()}</span>
                  {pct<3&&<span className="text-[7.5px] font-mono" style={{color:'#f59e0b'}}>⚠ below 3%</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {isBlankMode?(
        <div className="px-3.5 py-2.5 border-t border-default shrink-0 space-y-1.5">
          <button onClick={handleProject} disabled={!touched}
            className={`w-full h-8 rounded-[4px] text-[11px] font-mono font-semibold uppercase tracking-wide transition-colors ${!touched?'border border-default text-ink-3 opacity-50 cursor-not-allowed':isProjected?'bg-emerald-600 text-white hover:bg-emerald-700':'bg-blue-600 text-white hover:bg-blue-700'}`}>
            {!touched?'Adjust a slider first':isProjected?'↻ Update Result':'📍 Project Result'}
          </button>
          <button onClick={onShowReference}
            className={`w-full h-6 rounded-[4px] border text-[9px] font-mono uppercase tracking-wide transition-colors ${referenceOpen?'border-gold/60 bg-amber-50 text-amber-700':'border-default text-ink-3 hover:bg-hover'}`}>
            📋 {referenceOpen?'Hide':'Show'} 2025 result
          </button>
          {hasOverride&&(
            <button onClick={()=>{onResetOverride();setTouched(false);setDraftPcts({...calcProvVotes(natPcts,provId)});}}
              className="w-full h-6 rounded-[4px] border border-default text-ink-3 text-[9px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
              Clear projection
            </button>
          )}
        </div>
      ):hasOverride?(
        <div className="px-3.5 py-2.5 border-t border-default shrink-0">
          <button onClick={onResetOverride} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
            Reset to calculated
          </button>
        </div>
      ):null}
    </aside>
  );
}

// ── Breakdown panel ───────────────────────────────────────────────────────────
function PtBreakdownPanel({ seats, natPcts, isBaseline, onClose, exiting, dark }: {
  seats:Partial<Record<PtPartyId,number>>; natPcts:Record<PtPartyId,number>;
  isBaseline?:boolean; onClose:()=>void; exiting?:boolean; dark?:boolean;
}) {
  const totalS=PT_LR_ORDER.reduce((s,id)=>s+(seats[id]??0),0);
  const totalV=PT_PARTIES.reduce((s,p)=>s+(natPcts[p.id]??0),0);

  const enp = totalS>0 ? 1/PT_LR_ORDER.reduce((s,id)=>{const sh=(seats[id]??0)/totalS;return s+sh*sh;},0) : 0;
  const gallagher = Math.sqrt(PT_PARTIES.reduce((s,p)=>{
    const v=totalV>0?(natPcts[p.id]??0)/totalV*100:0;
    const sv=totalS>0?(seats[p.id]??0)/totalS*100:0;
    return s+Math.pow(v-sv,2);
  },0)/2);
  const largest=[...PT_LR_ORDER].sort((a,b)=>(seats[b]??0)-(seats[a]??0))[0];
  const shortOf=PT_MAJORITY-(seats[largest]??0);

  const ink3=dark?'rgba(255,255,255,0.25)':'rgba(0,0,0,0.25)';
  const cardBg=dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.03)';

  function Section({title,children}:{title:string;children:React.ReactNode}){
    return <div><div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.18em] mb-2" style={{color:ink3}}>{title}</div><div className="space-y-1.5">{children}</div></div>;
  }
  function Stat({label,value,sub:s}:{label:string;value:string;sub?:string}){
    return <div className="flex items-baseline justify-between gap-2" style={{background:cardBg,borderRadius:5,padding:'5px 8px'}}>
      <span className="text-[9.5px] font-mono text-ink-3 flex-1">{label}</span>
      <div className="text-right"><span className="text-[11px] font-mono font-bold text-ink">{value}</span>{s&&<div className="text-[7.5px] font-mono" style={{color:ink3}}>{s}</div>}</div>
    </div>;
  }

  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-r border-default flex flex-col overflow-hidden ${exiting?'panel-exit-left':'panel-slide-left'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div><h2 className="text-[13px] font-bold text-ink leading-none">Breakdown</h2><div className="text-[9px] font-mono text-ink-3 mt-0.5">Advanced election statistics</div></div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      {totalS===0?(
        <div className="flex items-center justify-center flex-1 text-[11px] font-mono text-ink-3 px-4 text-center">Load results or run simulation first</div>
      ):(
        <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3.5 space-y-5">
          <Section title="Electoral Statistics">
            <Stat label="Effective No. of Parties (ENP)" value={enp.toFixed(2)} sub="1/Σsᵢ² · higher = more fragmented"/>
            <Stat label="Gallagher Index" value={gallagher.toFixed(2)} sub="lower = more proportional (D'Hondt)"/>
            <Stat label="Largest party" value={`${PT_PARTY_MAP[largest]?.name} — ${seats[largest]??0} seats`} sub={shortOf>0?`${shortOf} short of majority`:'✓ Majority achieved'}/>
            <Stat label="D'Hondt threshold" value="None" sub="no legal threshold — pure D'Hondt"/>
          </Section>
          <Section title="Swing vs 2023">
            {PT_LR_ORDER.filter(id=>(natPcts[id]??0)>0.3||(isBaseline&&(PT_VOTE_PCT_2025[id]??0)>0)).map(id=>{
              const vSwing=(natPcts[id]??0)-PT_VOTE_PCT_2025[id]; const sSwing=(seats[id]??0)-(PT_PARTY_MAP[id].seats2025??0); const color=partyColor(id);
              return (
                <div key={id} style={{background:cardBg,borderRadius:5,padding:'5px 8px',display:'flex',alignItems:'center',gap:8}}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{background:color}}/>
                  <span className="text-[10px] font-medium text-ink flex-1">{PT_PARTY_MAP[id].name}</span>
                  <span className="text-[9px] font-mono tabular-nums" style={{color:vSwing>=0?'#16a34a':'#ef4444',minWidth:40,textAlign:'right'}}>{vSwing>=0?'+':''}{vSwing.toFixed(1)}%</span>
                  <span className="text-[9px] font-mono tabular-nums" style={{color:sSwing>=0?'#16a34a':'#ef4444',minWidth:36,textAlign:'right'}}>{sSwing>=0?'+':''}{sSwing}s</span>
                </div>
              );
            })}
          </Section>
          <Section title="Vote → Seat Translation">
            {PT_LR_ORDER.filter(id=>(natPcts[id]??0)>=0.5).map(id=>{
              const vPct=totalV>0?(natPcts[id]??0)/totalV*100:0; const sPct=totalS>0?(seats[id]??0)/totalS*100:0; const diff=sPct-vPct; const color=partyColor(id);
              return (
                <div key={id} style={{background:cardBg,borderRadius:5,padding:'5px 8px'}}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9.5px] font-medium text-ink">{PT_PARTY_MAP[id].name}</span>
                    <span className="text-[8.5px] font-mono" style={{color:Math.abs(diff)<1?ink3:diff>0?'#16a34a':'#ef4444'}}>{diff>0?'+':''}{diff.toFixed(1)}% seat bonus</span>
                  </div>
                  <div className="flex gap-1 items-center">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)'}}>
                      <div style={{width:`${Math.min(vPct/40*100,100)}%`,height:'100%',background:hexToRgba(color,0.45),borderRadius:4}}/>
                    </div>
                    <span className="text-[7.5px] font-mono text-ink-3 w-8 text-right tabular-nums">{vPct.toFixed(1)}%v</span>
                  </div>
                  <div className="flex gap-1 items-center mt-0.5">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)'}}>
                      <div style={{width:`${Math.min(sPct/40*100,100)}%`,height:'100%',background:color,borderRadius:4}}/>
                    </div>
                    <span className="text-[7.5px] font-mono text-ink-3 w-8 text-right tabular-nums">{sPct.toFixed(1)}%s</span>
                  </div>
                </div>
              );
            })}
          </Section>
          <Section title="Coalition Presets">
            {PT_PRESET_COALITIONS.map(coal=>{
              const cs=coal.parties.reduce((s,id)=>s+(seats[id as PtPartyId]??0),0); const ok=cs>=PT_MAJORITY;
              return (
                <div key={coal.name} style={{background:cardBg,borderRadius:5,padding:'6px 8px',display:'flex',alignItems:'center',gap:8}}>
                  <span>{coal.emoji}</span>
                  <div className="flex-1 min-w-0"><div className="text-[9.5px] font-bold text-ink truncate">{coal.name}</div><div className="text-[7.5px] font-mono" style={{color:ink3}}>{coal.parties.map(id=>PT_PARTY_MAP[id as PtPartyId]?.name).join('+')}</div></div>
                  <div className="text-right"><div className="text-[13px] font-black font-mono" style={{color:ok?'#16a34a':'#ef4444'}}>{cs}</div><div className="text-[7.5px] font-mono" style={{color:ink3}}>{ok?'✓ maj':'✗ no maj'}</div></div>
                </div>
              );
            })}
          </Section>
        </div>
      )}
    </aside>
  );
}

// ── Distributions panel ───────────────────────────────────────────────────────
// Left popup: per-province D'Hondt seat allocation for every party.
function PtDistributionsPanel({ natPcts, provOverrides, is2026, onClose, exiting, dark }: {
  natPcts: Record<PtPartyId,number>;
  provOverrides: Partial<Record<PtConstId, Partial<Record<PtPartyId, number>>>>;
  is2026?: boolean;
  onClose:()=>void; exiting?:boolean; dark?:boolean;
}) {
  const ink2 = dark?'rgba(255,255,255,0.55)':'rgba(0,0,0,0.5)';
  const ink3 = dark?'rgba(255,255,255,0.38)':'rgba(0,0,0,0.4)';
  const cardBg = dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.025)';
  const trackBg = dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';

  // party display name honouring the 2026/2027 rebrand (Sumar → Un Paso al Frente)
  const dispName = (id:PtPartyId) => {
    const p = PT_PARTY_MAP[id];
    return is2026 && p.name2026 ? p.name2026 : p.name;
  };

  // Per-province seat allocations + national totals, computed from the current scenario.
  const { rows, natTotals, totalSeats } = useMemo(() => {
    const rows = PT_CONSTITUENCIES.map(prov => {
      const votes = calcProvVotes(natPcts, prov.id, provOverrides[prov.id]);
      const seats = calcDHondtProv(votes, prov.seats);
      const alloc = (Object.entries(seats) as [PtPartyId,number][])
        .filter(([,s]) => (s??0) > 0)
        .sort((a,b) => b[1]-a[1]);
      return { prov, alloc };
    });
    const natTotals: Partial<Record<PtPartyId,number>> = {};
    let totalSeats = 0;
    for (const { alloc } of rows)
      for (const [id,s] of alloc) { natTotals[id] = (natTotals[id]??0)+s; totalSeats += s; }
    return { rows, natTotals, totalSeats };
  }, [natPcts, provOverrides]);

  const natSorted = (Object.entries(natTotals) as [PtPartyId,number][])
    .filter(([,s]) => s>0).sort((a,b) => b[1]-a[1]);

  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Seat Distribution</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">D'Hondt allocation · {PT_CONSTITUENCIES.length} constituencies · {totalSeats} seats</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      {/* National total stacked bar */}
      <div className="px-3.5 py-2.5 border-b border-default shrink-0">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.14em] mb-1.5" style={{color:ink3}}>National total</div>
        <div className="flex w-full h-2.5 rounded-full overflow-hidden" style={{background:trackBg}}>
          {natSorted.map(([id,s]) => (
            <div key={id} title={`${dispName(id)} ${s}`} style={{width:`${s/Math.max(1,totalSeats)*100}%`,background:partyColor(id)}}/>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-1.5">
          {natSorted.map(([id,s]) => (
            <span key={id} className="inline-flex items-center gap-1 text-[9px] font-mono" style={{color:ink2}}>
              <span className="w-1.5 h-1.5 rounded-full" style={{background:partyColor(id)}}/>
              {dispName(id)}<b className="text-ink">{s}</b>
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-2">
        {rows.map(({ prov, alloc }) => (
          <div key={prov.id} style={{background:cardBg,borderRadius:5,padding:'6px 8px'}}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10.5px] font-semibold text-ink truncate">{prov.name}</span>
              <span className="text-[8.5px] font-mono shrink-0 ml-2" style={{color:ink3}}>{prov.seats} {prov.seats===1?'seat':'seats'}</span>
            </div>
            <div className="flex w-full h-2 rounded-full overflow-hidden" style={{background:trackBg}}>
              {alloc.map(([id,s]) => (
                <div key={id} title={`${dispName(id)} ${s}`} style={{width:`${s/prov.seats*100}%`,background:partyColor(id)}}/>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
              {alloc.map(([id,s]) => (
                <span key={id} className="inline-flex items-center gap-0.5 text-[8.5px] font-mono" style={{color:ink2}}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{background:partyColor(id)}}/>
                  {dispName(id)}<b className="text-ink">{s}</b>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ── Tutorial panel ────────────────────────────────────────────────────────────
function PtTutorialPanel({ onClose, exiting, dark }: { onClose:()=>void; exiting?:boolean; dark?:boolean }) {
  const H2=({c}:{c:string})=><div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-4 mb-1.5 first:mt-0">{c}</div>;
  const P=({c}:{c:string})=><p className="text-[11px] text-ink leading-relaxed mb-2">{c}</p>;
  const Note=({c}:{c:string})=><div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{c}</div>;
  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div><h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Assembly of the Republic Guide</p></div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2 c="The Portuguese Electoral System"/>
        <P c="Portugal uses D'Hondt proportional representation with closed party lists. The 230-seat Assembly of the Republic is filled by running D'Hondt independently in each of the 22 constituencies — the 18 mainland districts, Azores, Madeira, plus 2 overseas seats each for voters in Europe and Outside Europe."/>
        <Note c="D'Hondt divides each party's votes by 1, 2, 3, … Seats go to the highest resulting quotients. It slightly favours larger parties compared to Sainte-Laguë."/>
        <H2 c="No Legal Threshold"/>
        <P c="Portugal has NO electoral threshold. Seats are won purely by D'Hondt in each constituency, so a small party can still win a seat in a large district like Lisbon (48 seats) on a low vote share."/>
        <Note c="JPP (Juntos pelo Povo) is a Madeira-only regionalist party — it only contests, and can only win seats in, the Madeira constituency."/>
        <H2 c="52 Constituencies"/>
        <P c="Each constituency elects a fixed number of MPs by its registered electorate. Lisbon elects 48 and Porto 40; the smallest (Portalegre and the overseas seats) elect just 2 each."/>
        <H2 c="The 2025 Result"/>
        <P c="The AD (PSD/CDS) won 91 seats — a plurality, short of the 116 needed for a majority. Chega surged to 60 seats, edging past the PS (58) to become the main opposition; Luís Montenegro continued as Prime Minister of a minority government."/>
        <H2 c="Blank Map Mode"/>
        <P c="Click a district, adjust its sliders, set % reporting, then hit Project Result. The national scoreboard only updates after you click the button."/>
        <H2 c="Simulation"/>
        <P c="Set national vote shares, pick a speed, then click Run. Each of the 22 constituencies reports in 5 random-sized batches on a bell-curve schedule. D'Hondt runs live per constituency as results come in."/>
        <H2 c="Parliament View"/>
        <P c="350 seats in a semicircle, sorted left→right by ideology: EH Bildu · BNG · Sumar · ERC · PSOE · Junts · CC · PNV · PP · Vox."/>
      </div>
    </aside>
  );
}

// ── Reporting widget ──────────────────────────────────────────────────────────
function PtReportingWidget({ projectedProvs,provReportingPct,simProvFractions,isSim,dark }:{
  projectedProvs:Set<PtConstId>; provReportingPct:Partial<Record<PtConstId,number>>;
  simProvFractions:Partial<Record<PtConstId,number>>; isSim:boolean; dark?:boolean;
}) {
  const bg=dark?'rgba(7,13,28,0.90)':'rgba(255,255,255,0.94)';
  const border=dark?'rgba(255,255,255,0.09)':'rgba(0,0,0,0.09)';
  const ink2=dark?'rgba(255,255,255,0.45)':'rgba(0,0,0,0.42)';

  let reportedW=0, projCount=0;
  if(isSim){
    for(const [cId,frac] of Object.entries(simProvFractions) as [PtConstId,number][]) {
      reportedW+=(PT_CONST_MAP[cId]?.weight??0)*(frac??0); if((frac??0)>0) projCount++;
    }
  } else {
    for(const cId of projectedProvs) {
      const rPct=(provReportingPct[cId]??100)/100;
      reportedW+=(PT_CONST_MAP[cId]?.weight??0)*rPct; projCount++;
    }
  }
  const reportedPct=Math.min(100,(reportedW/PT_TOTAL_CONST_WEIGHT)*100);
  return (
    <div className="absolute bottom-8 left-3 z-[1001] pointer-events-none"
      style={{background:bg,border:`1px solid ${border}`,borderRadius:10,backdropFilter:'blur(10px)',padding:'10px 13px',minWidth:170,boxShadow:'0 4px 20px rgba(0,0,0,0.18)'}}>
      <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.15em] mb-1.5" style={{color:ink2}}>{isSim?'⚡ Live Count':'📊 Results'}</div>
      <div className="text-[13px] font-black font-mono text-ink leading-none">{projCount} <span className="text-[10px] font-semibold" style={{color:ink2}}>/ {PT_CONSTITUENCIES.length}</span></div>
      <div className="text-[9px] font-mono mt-0.5 mb-2" style={{color:ink2}}>{isSim?'districts declared':'districts projected'}</div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.08)'}}>
        <div className="h-full rounded-full transition-all duration-500" style={{width:`${reportedPct}%`,background:isSim?'#3b82f6':'#16a34a'}}/>
      </div>
      <div className="text-[9px] font-mono font-bold mt-1 text-right" style={{color:isSim?'#3b82f6':'#16a34a'}}>{reportedPct.toFixed(1)}% of votes</div>
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────
export default function PortugalApp() {
  const navigate = useNavigate();
  const [dark,setDark] = useState(()=>localStorage.getItem('darkMode')!=='false');
  useEffect(()=>{ document.documentElement.classList.toggle('dark',dark); localStorage.setItem('darkMode',String(dark)); },[dark]);

  // ── Preset / national pcts ────────────────────────────────────────────────
  const [preset,setPreset]   = useState<'baseline'|'blank'|'polling2026'|'custom'>('polling2026');
  const [natPcts,setNatPcts] = useState<Record<PtPartyId,number>>(()=>({...PT_VOTE_PCT_2026}));

  function loadBaseline()    { setNatPcts({...PT_VOTE_PCT_2025}); setPreset('baseline'); resetMapState(); }
  function loadPolling2026() { setNatPcts({...PT_VOTE_PCT_2026}); setPreset('polling2026'); resetMapState(); }
  function loadBlank()       { setNatPcts(Object.fromEntries(PT_PARTIES.map(p=>[p.id,100/PT_PARTIES.length])) as Record<PtPartyId,number>); setPreset('blank'); resetMapState(); }

  function resetMapState() {
    setSimSeats(undefined); setDeclaredProvs(undefined);
    setProvOverrides({}); setProjectedProvs(new Set());
    setProvReportingPct({}); setSimProvFractions({});
    setProvDraft(null); setSimNatPcts(null); stopSim();
  }

  // ── Province overrides (blank map) ────────────────────────────────────────
  const [provOverrides,setProvOverrides]       = useState<Partial<Record<PtConstId,Partial<Record<PtPartyId,number>>>>>({});
  const [projectedProvs,setProjectedProvs]     = useState<Set<PtConstId>>(new Set());
  const [provReportingPct,setProvReportingPct] = useState<Partial<Record<PtConstId,number>>>({});
  const [provDraft,setProvDraft]               = useState<PtConstDraft|null>(null);

  const blankDisplayPcts = useMemo<Record<PtPartyId,number>>(()=>{
    const zero=Object.fromEntries(PT_PARTIES.map(p=>[p.id,0])) as Record<PtPartyId,number>;
    if(preset!=='blank') return zero;
    const weighted: Partial<Record<PtPartyId,number>>={};
    let totalW=0;
    for(const cId of projectedProvs) {
      const cv=calcProvVotes(natPcts,cId,provOverrides[cId]);
      const rPct=(provReportingPct[cId]??100)/100;
      const w=(PT_CONST_MAP[cId]?.weight??0)*rPct;
      for(const p of PT_PARTIES) weighted[p.id]=(weighted[p.id]??0)+(cv[p.id]??0)*w;
      totalW+=w;
    }
    if(totalW===0) return zero;
    return Object.fromEntries(PT_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW])) as Record<PtPartyId,number>;
  },[preset,projectedProvs,provOverrides,provReportingPct,natPcts]);

  const blankVoteScale=useMemo(()=>{
    if(preset!=='blank') return 1;
    const projW=[...projectedProvs].reduce((s,cId)=>s+(PT_CONST_MAP[cId]?.weight??0)*((provReportingPct[cId]??100)/100),0);
    return Math.min(1,projW/PT_TOTAL_CONST_WEIGHT);
  },[preset,projectedProvs,provReportingPct]);

  // Blank map: which provinces have been projected (reported), with their % reporting.
  const blankProvFractions=useMemo<Partial<Record<PtConstId,number>>>(()=>{
    if(preset!=='blank') return {};
    const f:Partial<Record<PtConstId,number>>={};
    for(const cId of projectedProvs) f[cId]=(provReportingPct[cId]??100)/100;
    return f;
  },[preset,projectedProvs,provReportingPct]);

  // Seats accrue province-by-province from 0 as each is projected — ONLY reported
  // provinces contribute (real Spanish per-constituency D'Hondt), never a national
  // extrapolation across all 52 provinces.
  const blankSeats=useMemo<Partial<Record<PtPartyId,number>>|undefined>(()=>
    preset==='blank'?calcPartialSeats(natPcts,blankProvFractions,provOverrides):undefined,
  [preset,natPcts,blankProvFractions,provOverrides]);

  const overrideDisplayPcts=useMemo<Record<PtPartyId,number>>(()=>{
    const hasAny=Object.values(provOverrides).some(o=>o&&Object.keys(o).length>0);
    if(!hasAny) return natPcts;
    const weighted:Partial<Record<PtPartyId,number>>={};
    let totalW=0;
    for(const prov of PT_CONSTITUENCIES) {
      const cv=calcProvVotes(natPcts,prov.id,provOverrides[prov.id]);
      const w=prov.weight;
      for(const p of PT_PARTIES) weighted[p.id]=(weighted[p.id]??0)+(cv[p.id]??0)*w;
      totalW+=w;
    }
    if(totalW===0) return natPcts;
    return Object.fromEntries(PT_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW])) as Record<PtPartyId,number>;
  },[natPcts,provOverrides]);

  const displayPcts=preset==='blank'?blankDisplayPcts:overrideDisplayPcts;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selectedProv,setSelectedProv]         = useState<PtConstId|null>(null);
  const [bubbleMap,setBubbleMap]               = useState(false);
  const [seatDots,setSeatDots]                 = useState(false);
  const [constRefOpen,setConstRefOpen]         = useState(false);
  useEffect(()=>{ setConstRefOpen(false); }, [selectedProv]);
  const [scoreboardVisible,setScoreboardVisible] = useState(true);
  const [hiddenParties,setHiddenParties]       = useState<Set<PtPartyId>>(new Set());

  const [leftPanel, setLeftPanel]   = useState<'parties'|'parli'|'breakdown'|null>(null);
  const [rightPanel,setRightPanel]  = useState<'sim'|'tutorial'|'coalition'|'distributions'|null>(null);
  const [exitLeft,  setExitLeft]    = useState<string|null>(null);
  const [exitRight, setExitRight]   = useState<string|null>(null);
  const exitTimerL = useRef<ReturnType<typeof setTimeout>|null>(null);
  const exitTimerR = useRef<ReturnType<typeof setTimeout>|null>(null);

  const openLeft=useCallback((panel:'parties'|'parli'|'breakdown')=>{
    if(leftPanel===panel){ setExitLeft(panel); setLeftPanel(null); exitTimerL.current=setTimeout(()=>setExitLeft(null),280); }
    else { if(leftPanel){setExitLeft(leftPanel);exitTimerL.current=setTimeout(()=>setExitLeft(null),280);} setLeftPanel(panel); }
  },[leftPanel]);
  const openRight=useCallback((panel:'sim'|'tutorial'|'coalition'|'distributions')=>{
    if(rightPanel===panel){ setExitRight(panel); setRightPanel(null); exitTimerR.current=setTimeout(()=>setExitRight(null),280); }
    else { if(rightPanel){setExitRight(rightPanel);exitTimerR.current=setTimeout(()=>setExitRight(null),280);} if(panel==='sim') setSelectedProv(null); setRightPanel(panel); }
  },[rightPanel]);

  const headerScrollRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=headerScrollRef.current; if(!el) return;
    const h=(e:WheelEvent)=>{ if(Math.abs(e.deltaX)>Math.abs(e.deltaY))return; e.preventDefault(); el.scrollLeft+=e.deltaY; };
    el.addEventListener('wheel',h,{passive:false}); return ()=>el.removeEventListener('wheel',h);
  },[]);

  // ── Simulation ────────────────────────────────────────────────────────────
  const [simDraftPcts,   setSimDraftPcts]   = useState<Record<PtPartyId,number>>(()=>({...PT_VOTE_PCT_2026}));
  const [simDraftLocks,  setSimDraftLocks]  = useState<Set<PtPartyId>>(new Set());
  const [,setSimDraftTouched]               = useState(false);
  const [simDuration,    setSimDuration]    = useState<60000|120000|300000|600000>(120000);
  const [simNatPcts,     setSimNatPcts]     = useState<Record<PtPartyId,number>|null>(null);
  const [simSeats,       setSimSeats]       = useState<Partial<Record<PtPartyId,number>>|undefined>();
  const [simProgress,    setSimProgress]    = useState(0);
  const [simRunning,     setSimRunning]     = useState(false);
  const [declaredProvs,  setDeclaredProvs]  = useState<Set<PtConstId>|undefined>();
  const [simProvFractions,setSimProvFractions] = useState<Partial<Record<PtConstId,number>>>({});
  const simTimersRef  = useRef<ReturnType<typeof setTimeout>[]>([]);
  const simNatPctsRef = useRef<Record<PtPartyId,number>>(natPcts);

  useEffect(()=>{ if(rightPanel==='sim'){setSimDraftPcts({...natPcts});setSimDraftTouched(false);} },[rightPanel==='sim']); // eslint-disable-line

  const simEffLocks=useMemo(()=>new Set<PtPartyId>([...simDraftLocks,...hiddenParties]),[simDraftLocks,hiddenParties]);
  const [simSortOrder]=useState<PtPartyId[]>(()=>PT_LR_ORDER.slice());

  function stopSim(){ simTimersRef.current.forEach(clearTimeout); simTimersRef.current=[]; setSimRunning(false); }

  function runSim() {
    stopSim(); setSimDraftTouched(false);
    simNatPctsRef.current={...simDraftPcts}; setSimNatPcts({...simDraftPcts});
    const PARTS=5; const totalProvs=PT_CONSTITUENCIES.length;
    const allTimes=esBellCurveTimes(PARTS*totalProvs,simDuration);
    const provIds=[...PT_CONSTITUENCIES.map(p=>p.id)].sort(()=>Math.random()-0.5);
    const events:{pId:PtConstId;cumFrac:number;t:number}[]=[];
    for(let pi=0;pi<totalProvs;pi++){
      const pId=provIds[pi];
      const pTimes=allTimes.slice(pi*PARTS,(pi+1)*PARTS).sort((a,b)=>a-b);
      const cuts=[0,Math.random(),Math.random(),Math.random(),Math.random(),1].sort((a,b)=>a-b);
      const sizes=cuts.slice(1).map((c,i)=>c-cuts[i]);
      let cumFrac=0;
      for(let b=0;b<PARTS;b++){ cumFrac=Math.min(1,cumFrac+sizes[b]); events.push({pId,cumFrac,t:pTimes[b]}); }
    }
    events.sort((a,b)=>a.t-b.t);
    setSimRunning(true); setSimProgress(0);
    setSimSeats(undefined); setDeclaredProvs(new Set()); setSimProvFractions({});
    const localFrac:Partial<Record<PtConstId,number>>={};
    const localDecl=new Set<PtConstId>();
    const timers:ReturnType<typeof setTimeout>[]=[];
    for(const ev of events){
      timers.push(setTimeout(()=>{
        localFrac[ev.pId]=ev.cumFrac;
        if(ev.cumFrac>=0.999) localDecl.add(ev.pId);
        const fracSnap={...localFrac}; const declSnap=new Set(localDecl);
        setSimProvFractions(fracSnap); setDeclaredProvs(declSnap);
        setSimProgress(Object.keys(fracSnap).length);
        setSimSeats(calcPartialSeats(simNatPctsRef.current,fracSnap));
        if(Object.values(fracSnap).every(f=>(f??0)>=0.999)&&Object.keys(fracSnap).length>=totalProvs){
          setSimSeats(calcAllProvinceSeats(simNatPctsRef.current)); setSimRunning(false);
        }
      },ev.t));
    }
    simTimersRef.current=timers;
  }

  const displaySeats=useMemo(()=>simSeats??blankSeats??calcAllProvinceSeats(displayPcts),[simSeats,blankSeats,displayPcts]);

  const simPartialPcts=useMemo<Record<PtPartyId,number>|null>(()=>{
    if(!simNatPcts) return null;
    const entries=Object.entries(simProvFractions) as [PtConstId,number][];
    if(entries.length===0) return null;
    const weighted:Partial<Record<PtPartyId,number>>={};
    let totalW=0;
    for(const [pId,frac] of entries){
      if(!frac) continue;
      const w=(PT_CONST_MAP[pId]?.weight??0)*frac;
      const cv=calcProvVotes(simNatPcts,pId);
      for(const p of PT_PARTIES) weighted[p.id]=(weighted[p.id]??0)+(cv[p.id]??0)*w;
      totalW+=w;
    }
    if(totalW===0) return null;
    return Object.fromEntries(PT_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW])) as Record<PtPartyId,number>;
  },[simNatPcts,simProvFractions]);

  const simVoteScale=useMemo(()=>{
    if(!simNatPcts) return undefined;
    const reportedW=(Object.entries(simProvFractions) as [PtConstId,number][])
      .reduce((s,[pId,frac])=>s+(PT_CONST_MAP[pId]?.weight??0)*(frac??0),0);
    return Math.min(1,reportedW/PT_TOTAL_CONST_WEIGHT);
  },[simNatPcts,simProvFractions]);

  // ── Derived display state ─────────────────────────────────────────────────
  const showProv      = !!selectedProv && rightPanel!=='sim' && !simRunning;
  const showParli     = leftPanel==='parli'     || exitLeft==='parli';
  const showBreakdown = leftPanel==='breakdown'  || exitLeft==='breakdown';
  const showDistrib   = rightPanel==='distributions' || exitRight==='distributions';
  const showTutorial  = rightPanel==='tutorial' || exitRight==='tutorial';
  const showCoalition = rightPanel==='coalition'|| exitRight==='coalition';

  const btnBase  ='h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold  =`${btnBase} bg-gold text-white hover:bg-gold-deep`;
  const btnMuted =`${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive=`${btnBase} bg-ink/8 border border-default text-ink`;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="pt">
      {/* ── Header ── */}
      <header className={`h-[52px] ${dark?'bg-[rgba(7,13,28,0.94)]':'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={()=>navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4"><GlobeLogo/></button>
        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <img src={`${import.meta.env.BASE_URL}portugal-flag.png`} alt="Portugal" className="h-4 rounded-[2px] shrink-0 opacity-90"/>
          <span className="text-[11px] font-bold text-ink shrink-0 hidden sm:block">Portugal</span>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={loadBaseline}    className={preset==='baseline'   ?btnGold:btnMuted}>2025 Baseline</button>
          <button onClick={loadPolling2026} className={preset==='polling2026'?btnGold:btnMuted}>2026 Polling</button>
          <button onClick={loadBlank}       className={preset==='blank'      ?btnGold:btnMuted}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={()=>{loadBlank();openRight('sim');}}       className={rightPanel==='sim'      ?btnActive:btnMuted}>▶ Simulation</button>
          <button onClick={()=>!simRunning&&openLeft('parties')} disabled={simRunning} className={`${leftPanel==='parties'?btnActive:btnMuted}${simRunning?' opacity-40 cursor-not-allowed':''}`}>Parties</button>
          <button onClick={()=>setScoreboardVisible(v=>!v)} className={scoreboardVisible?btnActive:btnMuted}>Scoreboard</button>
          <button onClick={()=>openLeft('breakdown')}  className={leftPanel==='breakdown' ?btnActive:btnMuted}>Breakdown</button>
          <button onClick={()=>openRight('distributions')} className={rightPanel==='distributions'?btnActive:btnMuted}>Distributions</button>
          <button onClick={()=>openRight('coalition')} className={rightPanel==='coalition'?btnActive:btnMuted}>Coalition</button>
          <button onClick={()=>openLeft('parli')}      className={leftPanel==='parli'     ?btnActive:btnMuted}>Parliament</button>
          <button onClick={()=>{setBubbleMap(v=>!v);setSeatDots(false);}}    className={bubbleMap?`${btnBase} bg-emerald-600 text-white hover:bg-emerald-700`:btnMuted}>Bubble Map</button>
          <button onClick={()=>{setSeatDots(v=>!v);setBubbleMap(false);}}    className={seatDots?`${btnBase} bg-emerald-600 text-white hover:bg-emerald-700`:btnMuted}>Seat Dots</button>
          <button onClick={()=>openRight('tutorial')}  className={rightPanel==='tutorial' ?btnActive:btnMuted}>Tutorial</button>
        </div>
        <div className="shrink-0 flex items-center gap-2 pr-4">
          <button onClick={()=>setDark(v=>!v)} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:text-ink transition-colors" title="Toggle dark mode">
            {dark?'☀':'☾'}
          </button>
        </div>
      </header>

      {/* ── Scoreboard ── */}
      {scoreboardVisible&&(
        <PtScoreboard
          natPcts={simPartialPcts??(simNatPcts??displayPcts)}
          simSeats={simSeats??blankSeats}
          isBaseline={preset==='baseline'&&!simNatPcts}
          is2026={preset!=='baseline'||!!simNatPcts}
          dark={dark}
          reportedVoteScale={simNatPcts!=null?simVoteScale:(preset==='blank'?blankVoteScale:undefined)}
        />
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {leftPanel==='parties'&&<PtPartiesPanel hiddenParties={hiddenParties} onToggle={id=>setHiddenParties(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;})} onClose={()=>openLeft('parties')} dark={dark}/>}
        {showParli    &&<PtParliamentPanel seats={displaySeats} onClose={()=>openLeft('parli')}    exiting={exitLeft==='parli'}    dark={dark}/>}
        {showBreakdown&&<PtBreakdownPanel  seats={displaySeats} natPcts={displayPcts} isBaseline={preset==='baseline'} onClose={()=>openLeft('breakdown')} exiting={exitLeft==='breakdown'} dark={dark}/>}
        {showProv && constRefOpen && selectedProv && <PtConstRefPanel provId={selectedProv} dark={dark} onClose={()=>setConstRefOpen(false)} />}

        {/* MAP */}
        <div className="relative flex-1 min-w-0 min-h-0">
          <PtMapView
            natPcts={natPcts} selectedProv={selectedProv}
            onSelect={p=>setSelectedProv(prev=>prev===p?null:p)}
            dark={dark} bubbleMap={bubbleMap} seatDots={seatDots}
            declaredProvs={declaredProvs} provOverrides={provOverrides}
            blankMode={preset==='blank'} projectedProvs={projectedProvs}
            simProvFractions={simProvFractions}
            provDraft={preset==='blank'?provDraft:null}
            simNatPcts={simNatPcts}
          />
          {(preset==='blank'||simRunning||simSeats!=null)&&(
            <PtReportingWidget
              projectedProvs={projectedProvs} provReportingPct={provReportingPct}
              simProvFractions={simProvFractions}
              isSim={simRunning||(simSeats!=null&&preset!=='blank')}
              dark={dark}
            />
          )}
        </div>

        {/* RIGHT panels */}
        {rightPanel==='sim'&&(
          <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
              <div><h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Adjust shares · then run</p></div>
              <button onClick={()=>{loadBlank();openRight('sim');}} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
            </div>
            <div className="px-3.5 pt-2.5 pb-2 border-b border-default shrink-0">
              <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-1.5">Simulation speed</div>
              <div className="flex gap-1.5">
                {([['1 min','60s',60000],['2 min','2m',120000],['5 min','5m',300000],['10 min','10m',600000]] as const).map(([label,sub,ms])=>(
                  <button key={ms} onClick={()=>setSimDuration(ms)}
                    className={`flex-1 py-1 rounded-[4px] border text-[9px] font-mono font-bold transition-colors ${simDuration===ms?'bg-blue-600 text-white border-blue-600':'border-default text-ink-3 hover:bg-hover'}`}>
                    {label}<div className="text-[7px] opacity-70">{sub}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">
              {simSortOrder.filter(id=>!hiddenParties.has(id)).map(id=>{
                const party=PT_PARTY_MAP[id]; const pct=simDraftPcts[id]??0; const isLocked=simDraftLocks.has(id); const color=partyColor(id);
                const rawVotes=Math.round(pct/100*PT_GRAND_TOTAL_VOTES); const cap=PT_PARTY_VOTE_CAP[id]; const capped=cap<55;
                return (
                  <div key={id}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:color}}/>
                      <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{party.fullName}</span>
                      <button onClick={()=>setSimDraftLocks(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;})}
                        className={`w-4 h-4 flex items-center justify-center shrink-0 ${isLocked?'text-gold':'text-ink-3 hover:text-ink'}`}>
                        {isLocked?<svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>:<svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>}
                      </button>
                      <span className="text-[10px] font-mono font-bold tabular-nums" style={{color}}>{pct.toFixed(1)}%</span>
                    </div>
                    <input type="range" min={0} max={cap} step={0.1} value={Math.min(pct,cap)} disabled={isLocked}
                      onChange={e=>{setSimDraftPcts(redistributePcts(simDraftPcts,id,parseFloat(e.target.value),simEffLocks,PT_PARTY_VOTE_CAP));setSimDraftTouched(true);}}
                      className="br-party-slider w-full"
                      style={{'--party-color':color,'--pct':`${(pct/cap)*100}%`}as React.CSSProperties}/>
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[8px] font-mono" style={{color:dark?'rgba(255,255,255,0.22)':'rgba(0,0,0,0.28)'}}>{fmtN(rawVotes)}{capped?` · region max ${cap}%`:''}</span>
                      <span className="text-[7.5px] font-mono" style={{color:pct>=3?'#16a34a':'#f59e0b'}}>{pct>=3?'✓ above 3%':'⚠ below 3%'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-3.5 pb-3.5 pt-2 border-t border-default shrink-0 space-y-2">
              <button disabled={simRunning} onClick={runSim}
                className="w-full h-8 rounded-[4px] bg-blue-600 text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {simRunning?`${simProgress}/${PT_CONSTITUENCIES.length} reporting…`:'▶ Run Simulation'}
              </button>
              {(simSeats||declaredProvs)&&(
                <button onClick={()=>{stopSim();setSimSeats(undefined);setDeclaredProvs(undefined);setSimProgress(0);setSimProvFractions({});setSimNatPcts(null);}}
                  className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">Reset</button>
              )}
            </div>
          </aside>
        )}

        {showProv&&selectedProv&&(
          <PtConstPanel key={selectedProv} provId={selectedProv} natPcts={natPcts}
            provOverride={provOverrides[selectedProv]}
            onOverride={pcts=>setProvOverrides(prev=>({...prev,[selectedProv]:pcts}))}
            onResetOverride={()=>{setProvOverrides(prev=>{const n={...prev};delete n[selectedProv];return n;});setProjectedProvs(prev=>{const n=new Set(prev);n.delete(selectedProv);return n;});setProvDraft(null);}}
            onClose={()=>{setSelectedProv(null);setProvDraft(null);}}
            isBlankMode={preset==='blank'} isProjected={projectedProvs.has(selectedProv)}
            reportingPct={provReportingPct[selectedProv]??100}
            onProject={()=>setProjectedProvs(prev=>new Set([...prev,selectedProv]))}
            onReportingPctChange={pct=>setProvReportingPct(prev=>({...prev,[selectedProv]:pct}))}
            onDraftChange={preset==='blank'?(pcts,rpt)=>setProvDraft({provId:selectedProv,pcts,rptPct:rpt}):undefined}
            hiddenParties={hiddenParties} dark={dark}
            onShowReference={()=>setConstRefOpen(v=>!v)} referenceOpen={constRefOpen}/>
        )}

        {showDistrib  &&<PtDistributionsPanel natPcts={displayPcts} provOverrides={provOverrides} is2026={preset!=='baseline'} onClose={()=>openRight('distributions')} exiting={exitRight==='distributions'} dark={dark}/>}
        {showTutorial &&<PtTutorialPanel  onClose={()=>openRight('tutorial')}  exiting={exitRight==='tutorial'}  dark={dark}/>}
        {showCoalition&&<PtCoalitionPanel seats={displaySeats} onClose={()=>openRight('coalition')} exiting={exitRight==='coalition'} dark={dark}/>}
      </div>
    </div>
  );
}
