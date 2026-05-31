import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── Party types ───────────────────────────────────────────────────────────────
// ── Greek data + types (reinforced PR; source: src/data/greece2023.ts, verified vs official) ─
import { GR_PARTIES, GR_CONSTITUENCIES, GR_META, type GrPartyId } from '../data/greece2023';

type EsPartyId = GrPartyId;

type EsParty = {
  id: EsPartyId; name: string; fullName: string; color: string; seats2023: number; ideo: number;
  leader: string; wikiTitle?: string;
  leader2026?: string; wikiTitle2026?: string; name2026?: string; fullName2026?: string; regional?: boolean;
};

const ES_PARTIES: EsParty[] = GR_PARTIES.map(p => ({
  id: p.id, name: p.name, fullName: p.full, color: p.color, seats2023: p.seats2023,
  ideo: p.ideo, leader: p.leader, wikiTitle: p.wiki,
}));

// Ideological order left → right for the parliament hemicycle
const ES_LR_ORDER: EsPartyId[] = [...ES_PARTIES].sort((a, b) => a.ideo - b.ideo).map(p => p.id);

const ES_PARTY_MAP = Object.fromEntries(ES_PARTIES.map(p => [p.id, p])) as Record<EsPartyId, EsParty>;
const ES_TOTAL_SEATS = GR_META.totalSeats;   // 300
const ES_MAJORITY    = 151;

// 2023 national results — Ministry of the Interior, June 2023
const ES_VOTE_PCT_2023 = Object.fromEntries(GR_PARTIES.map(p => [p.id, p.pct2023])) as Record<EsPartyId, number>;
const ES_VOTE_RAW_2023 = Object.fromEntries(GR_PARTIES.map(p => [p.id, p.votes2023])) as Record<EsPartyId, number>;
const ES_GRAND_TOTAL_VOTES = GR_META.valid;

// 2026 polling projection (May 2026 — ND weakened post-Tempi, opposition fragmented). Modelled scenario.
const ES_VOTE_PCT_2026: Record<EsPartyId, number> = {
  ND: 26.0, PASOK: 14.0, SYRIZA: 12.5, KKE: 9.0, EL: 11.0, NIKI: 4.5, PE: 3.5, SPAR: 1.0,
};

// ── Constituency types ─────────────────────────────────────────────────────────
type EsProvId = number;     // electoral-constituency order 1-59 (matches geojson feature id)

type EsProvince = {
  id: EsProvId; name: string; seats: number; weight: number; valid: number;
  v2023: Partial<Record<EsPartyId, number>>;
};

const GR_TOTAL_VALID = GR_CONSTITUENCIES.reduce((s, c) => s + c.valid, 0);
const ES_PROVINCES: EsProvince[] = GR_CONSTITUENCIES.map(c => ({
  id: c.id, name: c.name, seats: c.seats, valid: c.valid,
  weight: c.valid / GR_TOTAL_VALID * 100, v2023: c.v2023,
}));

// geojson feature id (its string form) → constituency id
const ES_GEOID_TO_ID: Record<string, EsProvId> = Object.fromEntries(ES_PROVINCES.map(p => [String(p.id), p.id]));
const ES_PROVINCE_MAP = Object.fromEntries(ES_PROVINCES.map(p => [p.id, p])) as Record<EsProvId, EsProvince>;
const ES_TOTAL_PROV_WEIGHT = ES_PROVINCES.reduce((s, p) => s + p.weight, 0);

// Greece has no landlocked regional parties — all 8 contest nationally.
function esContests(_partyId: EsPartyId, _provId: EsProvId): boolean { return true; }

// No regional caps — every party can be dialled up to the slider ceiling.
const ES_PARTY_VOTE_CAP: Record<EsPartyId, number> = Object.fromEntries(ES_PARTIES.map(p => [p.id, 65])) as Record<EsPartyId, number>;

// D'Hondt per constituency (used only for per-constituency seat previews; the national total uses the bonus model).
function calcDHondtProv(
  votes:  Partial<Record<EsPartyId, number>>,
  seats:  number,
  thresh: number = 3.0,
): Partial<Record<EsPartyId, number>> {
  const total = Object.values(votes).reduce((s, v) => s + (v ?? 0), 0);
  if (total === 0 || seats === 0) return {};
  const qualifying = (Object.entries(votes) as [EsPartyId, number][])
    .filter(([, v]) => (v ?? 0) / total * 100 >= thresh && (v ?? 0) > 0);
  if (qualifying.length === 0) return {};
  const quotients: { id: EsPartyId; q: number }[] = [];
  for (const [id, v] of qualifying) {
    for (let d = 1; d <= seats; d++) quotients.push({ id, q: v / d });
  }
  quotients.sort((a, b) => b.q - a.q);
  const result: Partial<Record<EsPartyId, number>> = {};
  for (let i = 0; i < Math.min(seats, quotients.length); i++) {
    result[quotients[i].id] = (result[quotients[i].id] ?? 0) + 1;
  }
  return result;
}

// Proportional swing: prov_pct = base_2023 × (new_nat / old_nat), normalised
function calcProvVotes(
  natPcts:  Record<EsPartyId, number>,
  provId:   EsProvId,
  override?: Partial<Record<EsPartyId, number>>,
): Record<EsPartyId, number> {
  if (override && Object.keys(override).length > 0) {
    const raw: Record<EsPartyId, number> = {} as Record<EsPartyId, number>;
    let total = 0;
    // Landlock: regional parties get 0 outside their home provinces even if an override sets them.
    for (const p of ES_PARTIES) { raw[p.id] = esContests(p.id, provId) ? Math.max(0, override[p.id] ?? 0) : 0; total += raw[p.id]; }
    if (total === 0) return raw;
    for (const p of ES_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
    return raw;
  }
  const base = ES_PROVINCE_MAP[provId]?.v2023 ?? {};
  const raw: Record<EsPartyId, number> = {} as Record<EsPartyId, number>;
  let total = 0;
  for (const p of ES_PARTIES) {
    const newNat = natPcts[p.id] ?? 0;
    const oldNat = ES_VOTE_PCT_2023[p.id] ?? 0;
    const basePct = base[p.id] ?? 0;
    // Regional parties stay landlocked + proportional within their territory; national parties swing nationally
    raw[p.id] = !esContests(p.id, provId) ? 0 : basePct === 0 ? 0 : oldNat === 0 ? basePct : basePct * (newNat / oldNat);
    total += raw[p.id];
  }
  if (total === 0) return raw;
  for (const p of ES_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
  return raw;
}

// ── Greek reinforced PR: winner's bonus + largest-remainder over the remaining seats ──
function grBonus(pct: number): number {
  if (pct < 25) return 0;
  if (pct >= 40) return 50;
  return 20 + Math.floor((pct - 25) / 0.5);
}
// National seat allocation from national vote %s — parties ≥ 3% qualify; reproduces the official result.
function grAllocate(pcts: Partial<Record<EsPartyId, number>>): Partial<Record<EsPartyId, number>> {
  const q = ES_PARTIES.filter(p => (pcts[p.id] ?? 0) >= GR_META.threshold);
  if (q.length === 0) return {};
  const lead = q.reduce((a, b) => (pcts[b.id] ?? 0) > (pcts[a.id] ?? 0) ? b : a, q[0]);
  const B = grBonus(pcts[lead.id] ?? 0);
  const pool = ES_TOTAL_SEATS - B;
  const tot = q.reduce((s, p) => s + (pcts[p.id] ?? 0), 0);
  if (tot <= 0) return {};
  const out: Partial<Record<EsPartyId, number>> = {}; let filled = 0;
  const rem: { id: EsPartyId; r: number }[] = [];
  for (const p of q) { const x = (pcts[p.id] ?? 0) / tot * pool; out[p.id] = Math.floor(x); filled += out[p.id]!; rem.push({ id: p.id, r: x - Math.floor(x) }); }
  rem.sort((a, b) => b.r - a.r);
  let k = 0; while (filled < pool && rem.length) { const id = rem[k % rem.length].id; out[id] = (out[id] ?? 0) + 1; filled++; k++; }
  out[lead.id] = (out[lead.id] ?? 0) + B;
  return out;
}
// Aggregate per-constituency (swung / overridden / partly-reported) votes → accurate national %s.
function grNationalPcts(
  natPcts: Record<EsPartyId, number>,
  provOverrides?: Partial<Record<EsProvId, Partial<Record<EsPartyId, number>>>>,
  provFractions?: Partial<Record<EsProvId, number>>,
): Record<EsPartyId, number> {
  const agg = {} as Record<EsPartyId, number>; for (const p of ES_PARTIES) agg[p.id] = 0;
  let totValid = 0;
  for (const prov of ES_PROVINCES) {
    const frac = provFractions ? (provFractions[prov.id] ?? 0) : 1;
    if (frac <= 0) continue;
    const ov = provOverrides?.[prov.id];
    const pv = calcProvVotes(natPcts, prov.id, ov);                       // % among the 8 (sum 100)
    const modelled = ov ? 1 : ES_PARTIES.reduce((s, p) => s + (prov.v2023[p.id] ?? 0), 0) / 100; // 8-party share of valid
    const eightVotes = prov.valid * frac * modelled;
    for (const p of ES_PARTIES) agg[p.id] += (pv[p.id] ?? 0) / 100 * eightVotes;
    totValid += prov.valid * frac;
  }
  const out = {} as Record<EsPartyId, number>;
  for (const p of ES_PARTIES) out[p.id] = totValid > 0 ? agg[p.id] / totValid * 100 : 0;
  return out;
}
// Full national seats. With per-constituency overrides the national %s are aggregated; otherwise straight from natPcts.
function calcAllProvinceSeats(
  natPcts: Partial<Record<EsPartyId, number>>,
  provOverrides?: Partial<Record<EsProvId, Partial<Record<EsPartyId, number>>>>,
): Partial<Record<EsPartyId, number>> {
  const pcts = (provOverrides && Object.keys(provOverrides).length > 0)
    ? grNationalPcts(natPcts as Record<EsPartyId, number>, provOverrides)
    : natPcts;
  return grAllocate(pcts);
}
// Live/partial seats — projected from the constituencies that have reported (fraction > 0) only.
function calcPartialSeats(
  natPcts: Record<EsPartyId, number>,
  provFractions: Partial<Record<EsProvId, number>>,
  provOverrides?: Partial<Record<EsProvId, Partial<Record<EsPartyId, number>>>>,
): Partial<Record<EsPartyId, number>> {
  if (Object.keys(provFractions).length === 0) return {};
  return grAllocate(grNationalPcts(natPcts, provOverrides, provFractions));
}

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
  current:   Record<EsPartyId, number>,
  changedId: EsPartyId,
  newRaw:    number,
  locks:     Set<EsPartyId>,
  caps?:     Record<EsPartyId, number>,   // per-party ceiling (e.g. region size); absent ⇒ uncapped
): Record<EsPartyId, number> {
  const capOf     = (id: EsPartyId) => caps?.[id] ?? 100;
  const ids       = Object.keys(current) as EsPartyId[];
  const lockedSum = ids.filter(id => locks.has(id) && id !== changedId).reduce((s, id) => s + (current[id] ?? 0), 0);
  const clamped   = Math.min(Math.max(newRaw, 0), capOf(changedId), 100 - lockedSum);
  const pool      = ids.filter(id => !locks.has(id) && id !== changedId);
  const seedSum   = pool.reduce((s, id) => s + (current[id] ?? 0), 0);
  const next: Record<EsPartyId, number> = { ...current, [changedId]: clamped };
  for (const id of pool) next[id] = 0;
  // Distribute the remainder proportionally to prior shares, but never above each
  // party's cap — overflow from capped parties spills to those with headroom.
  let remaining = 100 - lockedSum - clamped;
  let active = [...pool];
  for (let iter = 0; iter < 8 && active.length > 0 && remaining > 1e-6; iter++) {
    const wSum = active.reduce((s, id) => s + (seedSum > 0 ? (current[id] ?? 0) : 1), 0) || 1;
    const stillOpen: EsPartyId[] = [];
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
function partyColor(id: EsPartyId): string { return ES_PARTY_MAP[id]?.color ?? '#888'; }

function getProvFill(
  natPcts:   Record<EsPartyId, number>,
  provId:    EsProvId,
  dark:      boolean,
  override?: Partial<Record<EsPartyId, number>>,
): string {
  const pv     = calcProvVotes(natPcts, provId, override);
  const sorted = (Object.entries(pv) as [EsPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
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
  parties: { id: EsPartyId; pct: number; rawVotes?: number }[];
  leader: EsPartyId | null;
  reportingPct?: number;
} | null;

// ── Scoreboard tile ───────────────────────────────────────────────────────────
function EsScoreboardTile({
  partyId, seats, pct, rawVotes, isLeader, isWinner, is2026, dark: _dark,
}: {
  partyId: EsPartyId; seats: number; pct: number; rawVotes?: number;
  isLeader: boolean; isWinner: boolean; is2026?: boolean; dark?: boolean;
}) {
  const party      = ES_PARTY_MAP[partyId];
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
// Greek blocs: progressive/left (KKE + SYRIZA + Course of Freedom + PASOK) vs the
// centre-right & right (ND + Greek Solution + Niki + Spartans). No regional bloc.
const ES_LEFT_IDS:     EsPartyId[] = ['KKE','SYRIZA','PE','PASOK'];
const ES_RIGHT_IDS:    EsPartyId[] = ['ND','EL','NIKI','SPAR'];
const ES_REGIONAL_IDS: EsPartyId[] = [];

function EsScoreboard({
  natPcts, simSeats, isBaseline, is2026, dark, reportedVoteScale,
}: {
  natPcts: Record<EsPartyId,number>; simSeats?: Partial<Record<EsPartyId,number>>;
  isBaseline?: boolean; is2026?: boolean; dark?: boolean; reportedVoteScale?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const h = (e: WheelEvent) => { if (Math.abs(e.deltaX)>Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft+=e.deltaY; };
    el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h);
  }, []);

  const seats = useMemo(() => simSeats ?? calcAllProvinceSeats(natPcts), [simSeats, natPcts]);
  const scale    = reportedVoteScale ?? 1;

  const leftSeats     = ES_LEFT_IDS.reduce((s,id)=>s+(seats[id]??0), 0);
  const rightSeats    = ES_RIGHT_IDS.reduce((s,id)=>s+(seats[id]??0), 0);
  const regionalSeats = ES_REGIONAL_IDS.reduce((s,id)=>s+(seats[id]??0), 0);

  const leftMajority  = leftSeats  >= ES_MAJORITY;
  const rightMajority = rightSeats >= ES_MAJORITY;
  const maxGroup = Math.max(leftSeats, rightSeats, regionalSeats);
  const leftLeading   = maxGroup > 0 && leftSeats  === maxGroup;
  const rightLeading  = maxGroup > 0 && rightSeats === maxGroup;

  const visible = useMemo(
    () => ES_LR_ORDER.filter(id => (seats[id]??0)>0 || (natPcts[id]??0)>=0.1),
    [seats, natPcts],
  );

  const makeTile = (id: EsPartyId) => {
    const s   = seats[id] ?? 0;
    const pct = natPcts[id] ?? 0;   // actual % of valid votes (others implicit)
    const rawVotes = isBaseline
      ? Math.round((ES_VOTE_RAW_2023[id]??0)*scale)
      : Math.round((natPcts[id]??0)/100*ES_GRAND_TOTAL_VOTES*scale);
    const inLeft   = ES_LEFT_IDS.includes(id);
    const inRight  = ES_RIGHT_IDS.includes(id);
    const isWinner = inLeft ? leftMajority : inRight ? rightMajority : false;
    const isLeader = inLeft  ? (leftLeading  && !leftMajority)
                   : inRight ? (rightLeading && !rightMajority) : false;
    return <EsScoreboardTile key={id} partyId={id} seats={s} pct={pct} rawVotes={rawVotes}
      isLeader={isLeader} isWinner={isWinner} is2026={is2026} dark={dark} />;
  };

  const sortedBloc = (ids: EsPartyId[]) =>
    ids.filter(id=>visible.includes(id)).sort((a,b)=>(seats[b]??0)-(seats[a]??0));

  const renderBloc = (ids: EsPartyId[], label: string, isLeading: boolean, isMajority: boolean) => {
    const shown = sortedBloc(ids); if (shown.length===0) return null;
    const accent = partyColor(shown[0]);
    const groupStyle: React.CSSProperties = isMajority
      ? { borderColor:hexToRgba(accent,0.72), background:hexToRgba(accent,0.08) }
      : isLeading ? { borderColor:hexToRgba(accent,0.42), background:hexToRgba(accent,0.04) } : {};
    const labelStyle: React.CSSProperties = (isMajority||isLeading) ? { color:hexToRgba(accent,0.85) } : {};
    return (
      <div key={label} className="ni-group" style={groupStyle}>
        <span className="ni-group-label" style={labelStyle}>{label}</span>
        <div className="ni-group-tiles">{shown.map(id=>makeTile(id))}</div>
      </div>
    );
  };

  // Blocs listed by combined seat size (largest first). Empty blocs are dropped.
  const blocDefs = [
    { ids: ES_LEFT_IDS,     label: 'Progressive Bloc',  total: leftSeats,     isLeading: leftLeading  && !leftMajority,  isMajority: leftMajority },
    { ids: ES_REGIONAL_IDS, label: 'Other',             total: regionalSeats, isLeading: false,                          isMajority: false },
    { ids: ES_RIGHT_IDS,    label: 'Conservative & Right', total: rightSeats, isLeading: rightLeading && !rightMajority, isMajority: rightMajority },
  ].filter(b => b.ids.length > 0).sort((a,b)=>b.total-a.total);

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {blocDefs.map(b=>renderBloc(b.ids, b.label, b.isLeading, b.isMajority))}
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

function EsBubbleLayer({
  geoData, natPcts, containerRef, setTooltip, onSelect, natPctsRef,
  declaredProvs, provOverrides, provOverridesRef, blankMode, projectedProvs,
  simProvFractions, simNatPctsRef,
}: {
  geoData: any; natPcts: Record<EsPartyId,number>;
  containerRef: React.RefObject<HTMLDivElement|null>;
  setTooltip: (t:ProvTooltipState)=>void; onSelect: (id:EsProvId)=>void;
  natPctsRef: React.MutableRefObject<Record<EsPartyId,number>>;
  declaredProvs?: Set<EsProvId>;
  provOverrides?: Partial<Record<EsProvId,Partial<Record<EsPartyId,number>>>>;
  provOverridesRef: React.MutableRefObject<Partial<Record<EsProvId,Partial<Record<EsPartyId,number>>>>>;
  blankMode?: boolean; projectedProvs?: Set<EsProvId>;
  simProvFractions?: Partial<Record<EsProvId,number>>;
  simNatPctsRef?: React.MutableRefObject<Record<EsPartyId,number>|null>;
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
      const geoId: string = path.feature?.properties?.id ?? '';
      const provId = ES_GEOID_TO_ID[geoId];
      if (!provId) return;
      if (declaredProvs && !declaredProvs.has(provId)) return;
      if (!declaredProvs && blankMode && !(projectedProvs?.has(provId))) return;
      const bounds = (layer as any).getBounds?.();
      if (!bounds?.isValid()) return;
      const center = bounds.getCenter();

      const pv     = calcProvVotes(natPcts, provId, provOverrides?.[provId]);
      const sorted = (Object.entries(pv) as [EsPartyId,number][]).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a);
      if (sorted.length === 0) return;
      const [winId, winPct] = sorted[0];
      const margin     = winPct - (sorted[1]?.[1] ?? 0);
      const prov       = ES_PROVINCE_MAP[provId];
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
        const provVotes = ES_GRAND_TOTAL_VOTES * (prov?.weight ?? 0) / ES_TOTAL_PROV_WEIGHT;
        const parties  = (Object.entries(cur) as [EsPartyId,number][])
          .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,8)
          .map(([id,pct]) => ({ id:id as EsPartyId, pct, rawVotes:Math.round(pct/100*provVotes*fraction) }));
        const pName = ES_PROVINCE_MAP[provId]?.name ?? geoId;
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
//    constituency centroid; re-laid-out on zoom). Ported from the Poland game (Spain edition). ──
function EsSeatDotsLayer({
  geoData, natPcts, containerRef, setTooltip, onSelect, natPctsRef,
  declaredProvs, provOverrides, provOverridesRef, blankMode, projectedProvs,
  simProvFractions, simNatPctsRef,
}: {
  geoData: any; natPcts: Record<EsPartyId,number>;
  containerRef: React.RefObject<HTMLDivElement|null>;
  setTooltip: (t:ProvTooltipState)=>void; onSelect: (id:EsProvId)=>void;
  natPctsRef: React.MutableRefObject<Record<EsPartyId,number>>;
  declaredProvs?: Set<EsProvId>;
  provOverrides?: Partial<Record<EsProvId,Partial<Record<EsPartyId,number>>>>;
  provOverridesRef: React.MutableRefObject<Partial<Record<EsProvId,Partial<Record<EsPartyId,number>>>>>;
  blankMode?: boolean; projectedProvs?: Set<EsProvId>;
  simProvFractions?: Partial<Record<EsProvId,number>>;
  simNatPctsRef?: React.MutableRefObject<Record<EsPartyId,number>|null>;
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
        const geoId: string = path.feature?.properties?.id ?? '';
        const provId = ES_GEOID_TO_ID[geoId];
        if (!provId) return;
        if (declaredProvs && !declaredProvs.has(provId)) return;
        if (!declaredProvs && blankMode && !(projectedProvs?.has(provId))) return;
        const bounds = (layer as any).getBounds?.(); if (!bounds?.isValid()) return;
        const center = bounds.getCenter();
        const prov = ES_PROVINCE_MAP[provId];
        const pv = calcProvVotes(natPcts, provId, provOverrides?.[provId]);
        const alloc = calcDHondtProv(pv, prov?.seats ?? 0);
        const colors: string[] = [];
        for (const id of ES_LR_ORDER) { const n = alloc[id] ?? 0; for (let i=0;i<n;i++) colors.push(partyColor(id)); }
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
            const provVots = ES_GRAND_TOTAL_VOTES * (prov?.weight??0) / ES_TOTAL_PROV_WEIGHT;
            const parties = (Object.entries(cur) as [EsPartyId,number][])
              .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,8)
              .map(([id,pct]) => ({ id:id as EsPartyId, pct, rawVotes:Math.round(pct/100*provVots*fraction) }));
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
type EsProvDraft = { provId: EsProvId; pcts: Record<EsPartyId,number>; rptPct: number };

// ── Map view ──────────────────────────────────────────────────────────────────
function EsMapView({
  natPcts, selectedProv, onSelect, dark, bubbleMap, seatDots,
  declaredProvs, provOverrides, blankMode, projectedProvs, simProvFractions,
  provDraft, simNatPcts,
}: {
  natPcts: Record<EsPartyId,number>; selectedProv: EsProvId|null;
  onSelect: (id:EsProvId)=>void; dark: boolean; bubbleMap: boolean; seatDots: boolean;
  declaredProvs?: Set<EsProvId>;
  provOverrides?: Partial<Record<EsProvId,Partial<Record<EsPartyId,number>>>>;
  blankMode?: boolean; projectedProvs?: Set<EsProvId>;
  simProvFractions?: Partial<Record<EsProvId,number>>;
  provDraft?: EsProvDraft|null; simNatPcts?: Record<EsPartyId,number>|null;
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
  const projectedRef    = useRef(projectedProvs ?? new Set<EsProvId>());
  const simFracRef2     = useRef(simProvFractions ?? {});
  const provDraftRef2   = useRef<EsProvDraft|null>(provDraft ?? null);
  const simNatPctsRef2  = useRef<Record<EsPartyId,number>|null>(simNatPcts ?? null);

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
    fetch(`${import.meta.env.BASE_URL}greece-constituencies.geojson`)
      .then(r => r.json()).then(setGeoData).catch(console.error);
  }, []);

  const getStyle = useCallback((feature: any): L.PathOptions => {
    const geoId  = feature?.properties?.id ?? '';
    const provId = ES_GEOID_TO_ID[geoId];
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
    const geoId  = feature?.properties?.id ?? '';
    const provId = ES_GEOID_TO_ID[geoId];

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
      const prov     = ES_PROVINCE_MAP[provId];
      const provVots = ES_GRAND_TOTAL_VOTES * (prov?.weight??0) / ES_TOTAL_PROV_WEIGHT;
      const pv       = calcProvVotes(effectiveNatPcts, provId, overrideToUse);
      const parties  = (Object.entries(pv) as [EsPartyId,number][])
        .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,8)
        .map(([id,pct]) => ({ id:id as EsPartyId, pct, rawVotes:Math.round(pct/100*provVots*(fraction??1)) }));
      setTooltip({ x:e.originalEvent.clientX-rect.left, y:e.originalEvent.clientY-rect.top,
        name:prov?.name??geoId, parties, leader:parties[0]?.id??null,
        reportingPct:fraction!=null ? Math.round(fraction*100) : undefined });
    });
    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[38.7, 24.0]} zoom={6} style={{ width:'100%', height:'100%' }} zoomControl worldCopyJump={false}>
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
          <EsBubbleLayer
            geoData={geoData} natPcts={simNatPcts??natPcts} containerRef={containerRef}
            setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef}
            declaredProvs={declaredProvs} provOverrides={provOverrides}
            provOverridesRef={provOverridesRef} blankMode={blankMode}
            projectedProvs={projectedProvs} simProvFractions={simProvFractions}
            simNatPctsRef={simNatPctsRef2}
          />
        )}
        {geoData && seatDots && (
          <EsSeatDotsLayer
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
                {tooltip.reportingPct!=null ? `${tooltip.reportingPct}% reporting` : 'Estimated constituency result'}
              </div>
              <div style={{ marginTop:9, display:'flex', flexDirection:'column', gap:5 }}>
                {tooltip.parties.map(({ id, pct, rawVotes },i) => {
                  const pColor=partyColor(id);
                  return (
                    <div key={id} style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:7, height:7, borderRadius:2, flexShrink:0, background:pColor }} />
                      <span style={{ flex:1, fontSize:11, fontWeight:i===0?600:400, color:tt.body, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ES_PARTY_MAP[id]?.name??id}</span>
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
    </div>
  );
}

// ── Parliament hemicycle — 7 rows ─────────────────────────────────────────────
function EsParliamentPanel({ seats: seatsMap, onClose, exiting, dark }: {
  seats: Partial<Record<EsPartyId,number>>; onClose:()=>void; exiting?:boolean; dark?:boolean;
}) {
  const seatColors: string[] = [];
  const legend: { id:EsPartyId; count:number; color:string }[] = [];
  for (const id of ES_LR_ORDER) {
    const n = seatsMap[id] ?? 0; if (n===0) continue;
    const color = partyColor(id); legend.push({ id, count:n, color });
    for (let i=0; i<n; i++) seatColors.push(color);
  }
  const totalSeats = seatColors.length;
  const W=380, H=215, cx=W/2, cy=H-6, innerR=68, rowSpacing=18, numRows=7;
  const radii   = Array.from({length:numRows},(_,i)=>innerR+i*rowSpacing);
  const arcLens = radii.map(r=>Math.PI*r);
  const totalArc= arcLens.reduce((s,v)=>s+v,0);
  const rawPerRow  = arcLens.map(a=>(a/totalArc)*ES_TOTAL_SEATS);
  const floored    = rawPerRow.map(Math.floor);
  const remainder  = ES_TOTAL_SEATS - floored.reduce((s,v)=>s+v,0);
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
          <h2 className="text-[13px] font-bold text-ink leading-none">Hellenic Parliament — Composition</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">{totalSeats} seats · majority {ES_MAJORITY} · sorted by ideology</div>
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
              {(() => {
                const dot=dark?'rgba(255,255,255,0.25)':'rgba(0,0,0,0.25)';
                const blocs=[
                  {label:'Prog',    seats:ES_LEFT_IDS.reduce((s,id)=>s+(seatsMap[id]??0),0),     color:'#E4003B'},
                  {label:'Regional',seats:ES_REGIONAL_IDS.reduce((s,id)=>s+(seatsMap[id]??0),0), color:'#007442'},
                  {label:'Cons',    seats:ES_RIGHT_IDS.reduce((s,id)=>s+(seatsMap[id]??0),0),    color:'#0066CC'},
                ].sort((a,b)=>b.seats-a.seats);
                return (
                  <div className="flex items-center gap-1.5 mb-3 text-[9px] font-mono">
                    {blocs.map((b,i)=>(
                      <React.Fragment key={b.label}>
                        {i>0&&<span style={{color:dot}}>·</span>}
                        <span style={{color:b.color,fontWeight:700}}>{b.label} {b.seats}</span>
                      </React.Fragment>
                    ))}
                    <span style={{color:dot,marginLeft:'auto'}}>need {ES_MAJORITY}</span>
                  </div>
                );
              })()}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {legend.map(({id,count,color})=>(
                  <div key={id} className="flex items-center gap-1.5">
                    <div style={{width:9,height:9,borderRadius:2,background:color,flexShrink:0}}/>
                    <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">{ES_PARTY_MAP[id].name}</span>
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
const ES_PRESET_COALITIONS: {name:string;emoji:string;parties:EsPartyId[]}[] = [
  {name:'ND Government',     emoji:'🔵', parties:['ND']},
  {name:'Progressive Front', emoji:'🌹', parties:['SYRIZA','PASOK','PE','KKE']},
  {name:'Right Bloc',        emoji:'🦅', parties:['ND','EL','NIKI']},
  {name:'Grand Coalition',   emoji:'🤝', parties:['ND','PASOK']},
];

function EsCoalitionPanel({ seats, onClose, exiting, dark }: {
  seats:Partial<Record<EsPartyId,number>>; onClose:()=>void; exiting?:boolean; dark?:boolean;
}) {
  const [selected,setSelected] = useState<Set<EsPartyId>>(new Set<EsPartyId>(['ND']));
  const toggle = (id:EsPartyId) => setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const totalCoalSeats=[...selected].reduce((s,id)=>s+(seats[id]??0),0);
  const hasMajority=totalCoalSeats>=ES_MAJORITY;
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Coalition Builder</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Majority: {ES_MAJORITY} seats · {ES_TOTAL_SEATS} total</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="px-3.5 pt-3 pb-2 border-b border-default shrink-0">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {ES_PRESET_COALITIONS.map(coal=>(
            <button key={coal.name} onClick={()=>setSelected(new Set(coal.parties))}
              className="text-left px-2 py-1.5 rounded-[4px] border border-default hover:bg-hover transition-colors">
              <div className="text-[8px] font-bold text-ink truncate">{coal.emoji} {coal.name}</div>
              <div className="text-[7px] font-mono text-ink-3">{coal.parties.map(id=>ES_PARTY_MAP[id]?.name).join(' + ')}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Toggle Parties</div>
        <div className="space-y-1.5">
          {ES_LR_ORDER.map(id=>{
            const party=ES_PARTY_MAP[id]; const s=seats[id]??0; const isIn=selected.has(id); const color=partyColor(id);
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
            style={{width:`${Math.min(totalCoalSeats/ES_TOTAL_SEATS*100,100)}%`,background:hasMajority?'#16a34a':'#ef4444'}}/>
        </div>
        <div className={`mt-1.5 text-[9px] font-mono text-center font-bold ${hasMajority?'text-emerald-600':'text-red-500'}`}>
          {hasMajority?`✓ MAJORITY (need ${ES_MAJORITY})`:`✗ ${ES_MAJORITY-totalCoalSeats} seats short of majority`}
        </div>
      </div>
    </aside>
  );
}

// ── Parties panel ─────────────────────────────────────────────────────────────
function EsPartiesPanel({ hiddenParties,onToggle,onClose,dark }: {
  hiddenParties:Set<EsPartyId>; onToggle:(id:EsPartyId)=>void; onClose:()=>void; dark?:boolean;
}) {
  const allHidden=ES_LR_ORDER.every(id=>hiddenParties.has(id));
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
        {ES_LR_ORDER.map(id=>{
          const party=ES_PARTY_MAP[id]; const hidden=hiddenParties.has(id);
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
        <button onClick={()=>{for(const id of ES_LR_ORDER){if(allHidden?hiddenParties.has(id):!hiddenParties.has(id))onToggle(id);}}}
          className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
          {allHidden?'Show All':'Hide All'}
        </button>
      </div>
    </aside>
  );
}

// ── Province breakdown (blank map sliders) ────────────────────────────────────
function EsProvPanel({
  provId,natPcts,provOverride,onOverride,onResetOverride,onClose,
  isBlankMode,isProjected,reportingPct,onProject,onReportingPctChange,
  onDraftChange,hiddenParties,dark,
}: {
  provId:EsProvId; natPcts:Record<EsPartyId,number>;
  provOverride?:Partial<Record<EsPartyId,number>>;
  onOverride:(pcts:Partial<Record<EsPartyId,number>>)=>void;
  onResetOverride:()=>void; onClose:()=>void;
  isBlankMode?:boolean; isProjected?:boolean; reportingPct?:number;
  onProject?:()=>void; onReportingPctChange?:(pct:number)=>void;
  onDraftChange?:(pcts:Record<EsPartyId,number>,rptPct:number)=>void;
  hiddenParties?:Set<EsPartyId>; dark?:boolean;
}) {
  const [locks,setLocks]             = useState<Set<EsPartyId>>(new Set());
  const baseVotes = useMemo(()=>calcProvVotes(natPcts,provId),[natPcts,provId]);
  const [draftPcts,setDraftPcts]     = useState<Record<EsPartyId,number>>(()=>
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

  const effectiveLocks=useMemo(()=>new Set<EsPartyId>([...locks,...(hiddenParties??[])]),[locks,hiddenParties]);
  const displayPv   =isBlankMode?draftPcts:calcProvVotes(natPcts,provId,provOverride);
  const [sortedIds] =useState<EsPartyId[]>(()=>ES_PARTIES.map(p=>p.id).filter(id=>(baseVotes[id]??0)>0).sort((a,b)=>(baseVotes[b]??0)-(baseVotes[a]??0)));
  const prov        =ES_PROVINCE_MAP[provId];
  const winner      =ES_PARTIES.reduce((best,p)=>(displayPv[p.id]??0)>(displayPv[best.id]??0)?p:best,ES_PARTIES[0]);
  const hasOverride =!!provOverride&&Object.keys(provOverride).length>0;
  const provTotalVotes=Math.round(ES_GRAND_TOTAL_VOTES*(prov?.weight??0)/ES_TOTAL_PROV_WEIGHT);
  const sliderTrack=dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';

  const handleSlider=(id:EsPartyId,val:number)=>{
    if(isBlankMode){setDraftPcts(redistributePcts(draftPcts,id,val,effectiveLocks));setTouched(true);}
    else onOverride(redistributePcts(displayPv as Record<EsPartyId,number>,id,val,effectiveLocks));
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
              {isBlankMode?(isProjected?'Projected · adjust & re-project':'Blank map · set constituency result'):(hasOverride?'Custom override':'Estimated · drag sliders')}
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
            const p=ES_PARTY_MAP[id]; const pct=displayPv[id]??0; const isLocked=locks.has(id); const color=p.color;
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
function EsBreakdownPanel({ seats, natPcts, isBaseline, onClose, exiting, dark }: {
  seats:Partial<Record<EsPartyId,number>>; natPcts:Record<EsPartyId,number>;
  isBaseline?:boolean; onClose:()=>void; exiting?:boolean; dark?:boolean;
}) {
  const totalS=ES_LR_ORDER.reduce((s,id)=>s+(seats[id]??0),0);
  const totalV=ES_PARTIES.reduce((s,p)=>s+(natPcts[p.id]??0),0);
  const leftS   =ES_LEFT_IDS.reduce((s,id)=>s+(seats[id]??0),0);
  const rightS  =ES_RIGHT_IDS.reduce((s,id)=>s+(seats[id]??0),0);

  const enp = totalS>0 ? 1/ES_LR_ORDER.reduce((s,id)=>{const sh=(seats[id]??0)/totalS;return s+sh*sh;},0) : 0;
  const gallagher = Math.sqrt(ES_PARTIES.reduce((s,p)=>{
    const v=totalV>0?(natPcts[p.id]??0)/totalV*100:0;
    const sv=totalS>0?(seats[p.id]??0)/totalS*100:0;
    return s+Math.pow(v-sv,2);
  },0)/2);
  const largest=[...ES_LR_ORDER].sort((a,b)=>(seats[b]??0)-(seats[a]??0))[0];
  const shortOf=ES_MAJORITY-(seats[largest]??0);

  const ink2=dark?'rgba(255,255,255,0.42)':'rgba(0,0,0,0.42)';
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
          <Section title="Left vs Right">
            {[
              {label:'Progressive Bloc',    desc:'KKE + SYRIZA + Course of Freedom + PASOK', seats:leftS, color:'#E14B8A'},
              {label:'Conservative & Right', desc:'ND + Greek Solution + Niki + Spartans',    seats:rightS,color:'#1C7FE0'},
            ].sort((a,b)=>b.seats-a.seats).map(b=>(
              <div key={b.label} style={{background:cardBg,borderRadius:5,padding:'6px 8px',borderLeft:`3px solid ${b.color}`}}>
                <div className="flex items-center justify-between">
                  <div><div className="text-[10px] font-bold text-ink">{b.label}</div><div className="text-[8px] font-mono" style={{color:ink2}}>{b.desc}</div></div>
                  <div className="text-right">
                    <span className="text-[18px] font-black font-mono" style={{color:b.color}}>{b.seats}</span>
                    <div className="text-[7.5px] font-mono" style={{color:b.seats>=ES_MAJORITY?'#16a34a':ink3}}>
                      {b.seats>=ES_MAJORITY?'✓ majority':`need ${ES_MAJORITY-b.seats} more`}
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.06)'}}>
                  <div style={{width:`${Math.min(b.seats/ES_TOTAL_SEATS*100,100)}%`,height:'100%',borderRadius:4,background:b.color}}/>
                </div>
              </div>
            ))}
          </Section>
          <Section title="Electoral Statistics">
            <Stat label="Effective No. of Parties (ENP)" value={enp.toFixed(2)} sub="1/Σsᵢ² · higher = more fragmented"/>
            <Stat label="Gallagher Index" value={gallagher.toFixed(2)} sub="lower = more proportional"/>
            <Stat label="Largest party" value={`${ES_PARTY_MAP[largest]?.name} — ${seats[largest]??0} seats`} sub={shortOf>0?`${shortOf} short of majority`:'✓ Majority achieved'}/>
            <Stat label="Electoral threshold" value="3% national" sub="+ winner's bonus up to 50 seats"/>
          </Section>
          <Section title="Swing vs 2023">
            {ES_LR_ORDER.filter(id=>(natPcts[id]??0)>0.3||(isBaseline&&(ES_VOTE_PCT_2023[id]??0)>0)).map(id=>{
              const vSwing=(natPcts[id]??0)-ES_VOTE_PCT_2023[id]; const sSwing=(seats[id]??0)-(ES_PARTY_MAP[id].seats2023??0); const color=partyColor(id);
              return (
                <div key={id} style={{background:cardBg,borderRadius:5,padding:'5px 8px',display:'flex',alignItems:'center',gap:8}}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{background:color}}/>
                  <span className="text-[10px] font-medium text-ink flex-1">{ES_PARTY_MAP[id].name}</span>
                  <span className="text-[9px] font-mono tabular-nums" style={{color:vSwing>=0?'#16a34a':'#ef4444',minWidth:40,textAlign:'right'}}>{vSwing>=0?'+':''}{vSwing.toFixed(1)}%</span>
                  <span className="text-[9px] font-mono tabular-nums" style={{color:sSwing>=0?'#16a34a':'#ef4444',minWidth:36,textAlign:'right'}}>{sSwing>=0?'+':''}{sSwing}s</span>
                </div>
              );
            })}
          </Section>
          <Section title="Vote → Seat Translation">
            {ES_LR_ORDER.filter(id=>(natPcts[id]??0)>=0.5).map(id=>{
              const vPct=totalV>0?(natPcts[id]??0)/totalV*100:0; const sPct=totalS>0?(seats[id]??0)/totalS*100:0; const diff=sPct-vPct; const color=partyColor(id);
              return (
                <div key={id} style={{background:cardBg,borderRadius:5,padding:'5px 8px'}}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9.5px] font-medium text-ink">{ES_PARTY_MAP[id].name}</span>
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
            {ES_PRESET_COALITIONS.map(coal=>{
              const cs=coal.parties.reduce((s,id)=>s+(seats[id as EsPartyId]??0),0); const ok=cs>=ES_MAJORITY;
              return (
                <div key={coal.name} style={{background:cardBg,borderRadius:5,padding:'6px 8px',display:'flex',alignItems:'center',gap:8}}>
                  <span>{coal.emoji}</span>
                  <div className="flex-1 min-w-0"><div className="text-[9.5px] font-bold text-ink truncate">{coal.name}</div><div className="text-[7.5px] font-mono" style={{color:ink3}}>{coal.parties.map(id=>ES_PARTY_MAP[id as EsPartyId]?.name).join('+')}</div></div>
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
function EsDistributionsPanel({ natPcts, provOverrides, is2026, onClose, exiting, dark }: {
  natPcts: Record<EsPartyId,number>;
  provOverrides: Partial<Record<EsProvId, Partial<Record<EsPartyId, number>>>>;
  is2026?: boolean;
  onClose:()=>void; exiting?:boolean; dark?:boolean;
}) {
  const ink2 = dark?'rgba(255,255,255,0.55)':'rgba(0,0,0,0.5)';
  const ink3 = dark?'rgba(255,255,255,0.38)':'rgba(0,0,0,0.4)';
  const cardBg = dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.025)';
  const trackBg = dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';

  // party display name honouring the 2026/2027 rebrand (Sumar → Un Paso al Frente)
  const dispName = (id:EsPartyId) => {
    const p = ES_PARTY_MAP[id];
    return is2026 && p.name2026 ? p.name2026 : p.name;
  };

  // Per-province seat allocations + national totals, computed from the current scenario.
  const { rows, natTotals, totalSeats } = useMemo(() => {
    const rows = ES_PROVINCES.map(prov => {
      const votes = calcProvVotes(natPcts, prov.id, provOverrides[prov.id]);
      const seats = calcDHondtProv(votes, prov.seats);
      const alloc = (Object.entries(seats) as [EsPartyId,number][])
        .filter(([,s]) => (s??0) > 0)
        .sort((a,b) => b[1]-a[1]);
      return { prov, alloc };
    });
    const natTotals: Partial<Record<EsPartyId,number>> = {};
    let totalSeats = 0;
    for (const { alloc } of rows)
      for (const [id,s] of alloc) { natTotals[id] = (natTotals[id]??0)+s; totalSeats += s; }
    return { rows, natTotals, totalSeats };
  }, [natPcts, provOverrides]);

  const natSorted = (Object.entries(natTotals) as [EsPartyId,number][])
    .filter(([,s]) => s>0).sort((a,b) => b[1]-a[1]);

  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Seat Distribution</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Per-constituency seats · {ES_PROVINCES.length} constituencies</div>
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
function EsTutorialPanel({ onClose, exiting, dark }: { onClose:()=>void; exiting?:boolean; dark?:boolean }) {
  const H2=({c}:{c:string})=><div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-4 mb-1.5 first:mt-0">{c}</div>;
  const P=({c}:{c:string})=><p className="text-[11px] text-ink leading-relaxed mb-2">{c}</p>;
  const Note=({c}:{c:string})=><div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{c}</div>;
  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div><h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Hellenic Parliament Election Guide</p></div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2 c="The Greek Electoral System"/>
        <P c="Greece uses 'reinforced' proportional representation (Law 4777/2021). The 300-seat Hellenic Parliament (Voulí) is filled mostly proportionally, but the first party receives a bonus of extra seats — making single-party majorities much easier."/>
        <Note c="285 seats are tied to 59 geographic constituencies and 15 are 'State Deputies' elected on the national list — but the party totals are set nationally."/>
        <H2 c="The Winner's Bonus"/>
        <P c="The leading party earns 20 bonus seats at 25% of the vote, plus one more for every extra 0.5%, up to a maximum of 50 bonus seats at 40%+. The remaining seats are shared out by largest remainder among all parties over the threshold."/>
        <Note c="In June 2023 New Democracy won 40.6% → the full 50-seat bonus → a 158-seat majority."/>
        <H2 c="The 3% National Threshold"/>
        <P c="A party must clear 3% of the national vote to win any seats at all. In June 2023 eight parties cleared it; MeRA25 (2.5%) and others fell just short and won nothing."/>
        <H2 c="59 Constituencies"/>
        <P c="From Athens B3 (19 seats) to single-seat islands like Lefkada and Kastoria. Athens and Thessaloniki are split into lettered sub-constituencies; the map colours each by its winning party."/>
        <H2 c="Government (2023–)"/>
        <P c="Kyriakos Mitsotakis (New Democracy) was re-elected with an outright majority of 158 seats and formed a single-party government."/>
        <H2 c="Blank Map Mode"/>
        <P c="Click a constituency, adjust its sliders, set % reporting, then hit Project Result. The national scoreboard only updates after you click the button."/>
        <H2 c="Simulation"/>
        <P c="Set national vote shares, pick a speed, then click Run. The 59 constituencies report in random batches on a bell-curve schedule, and the seat projection — bonus included — updates live as votes come in."/>
        <H2 c="Parliament View"/>
        <P c="300 seats in a semicircle, sorted left→right by ideology: KKE · SYRIZA · Course of Freedom · PASOK · New Democracy · Greek Solution · Niki · Spartans."/>
      </div>
    </aside>
  );
}

// ── Reporting widget ──────────────────────────────────────────────────────────
function EsReportingWidget({ projectedProvs,provReportingPct,simProvFractions,isSim,dark }:{
  projectedProvs:Set<EsProvId>; provReportingPct:Partial<Record<EsProvId,number>>;
  simProvFractions:Partial<Record<EsProvId,number>>; isSim:boolean; dark?:boolean;
}) {
  const bg=dark?'rgba(7,13,28,0.90)':'rgba(255,255,255,0.94)';
  const border=dark?'rgba(255,255,255,0.09)':'rgba(0,0,0,0.09)';
  const ink2=dark?'rgba(255,255,255,0.45)':'rgba(0,0,0,0.42)';

  let reportedW=0, projCount=0;
  if(isSim){
    for(const [cId,frac] of Object.entries(simProvFractions) as unknown as [EsProvId,number][]) {
      reportedW+=(ES_PROVINCE_MAP[cId]?.weight??0)*(frac??0); if((frac??0)>0) projCount++;
    }
  } else {
    for(const cId of projectedProvs) {
      const rPct=(provReportingPct[cId]??100)/100;
      reportedW+=(ES_PROVINCE_MAP[cId]?.weight??0)*rPct; projCount++;
    }
  }
  const reportedPct=Math.min(100,(reportedW/ES_TOTAL_PROV_WEIGHT)*100);
  return (
    <div className="absolute bottom-8 left-3 z-[1001] pointer-events-none"
      style={{background:bg,border:`1px solid ${border}`,borderRadius:10,backdropFilter:'blur(10px)',padding:'10px 13px',minWidth:170,boxShadow:'0 4px 20px rgba(0,0,0,0.18)'}}>
      <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.15em] mb-1.5" style={{color:ink2}}>{isSim?'⚡ Live Count':'📊 Results'}</div>
      <div className="text-[13px] font-black font-mono text-ink leading-none">{projCount} <span className="text-[10px] font-semibold" style={{color:ink2}}>/ {ES_PROVINCES.length}</span></div>
      <div className="text-[9px] font-mono mt-0.5 mb-2" style={{color:ink2}}>{isSim?'provinces declared':'provinces projected'}</div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.08)'}}>
        <div className="h-full rounded-full transition-all duration-500" style={{width:`${reportedPct}%`,background:isSim?'#3b82f6':'#16a34a'}}/>
      </div>
      <div className="text-[9px] font-mono font-bold mt-1 text-right" style={{color:isSim?'#3b82f6':'#16a34a'}}>{reportedPct.toFixed(1)}% of votes</div>
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────
export default function GreeceApp() {
  const navigate = useNavigate();
  const [dark,setDark] = useState(()=>localStorage.getItem('darkMode')!=='false');
  useEffect(()=>{ document.documentElement.classList.toggle('dark',dark); localStorage.setItem('darkMode',String(dark)); },[dark]);

  // ── Preset / national pcts ────────────────────────────────────────────────
  const [preset,setPreset]   = useState<'baseline'|'blank'|'polling2026'|'custom'>('baseline');
  const [natPcts,setNatPcts] = useState<Record<EsPartyId,number>>(()=>({...ES_VOTE_PCT_2023}));

  function loadBaseline()    { setNatPcts({...ES_VOTE_PCT_2023}); setPreset('baseline'); resetMapState(); }
  function loadPolling2026() { setNatPcts({...ES_VOTE_PCT_2026}); setPreset('polling2026'); resetMapState(); }
  function loadBlank()       { setNatPcts(Object.fromEntries(ES_PARTIES.map(p=>[p.id,100/ES_PARTIES.length])) as Record<EsPartyId,number>); setPreset('blank'); resetMapState(); }

  function resetMapState() {
    setSimSeats(undefined); setDeclaredProvs(undefined);
    setProvOverrides({}); setProjectedProvs(new Set());
    setProvReportingPct({}); setSimProvFractions({});
    setProvDraft(null); setSimNatPcts(null); stopSim();
  }

  // ── Province overrides (blank map) ────────────────────────────────────────
  const [provOverrides,setProvOverrides]       = useState<Partial<Record<EsProvId,Partial<Record<EsPartyId,number>>>>>({});
  const [projectedProvs,setProjectedProvs]     = useState<Set<EsProvId>>(new Set());
  const [provReportingPct,setProvReportingPct] = useState<Partial<Record<EsProvId,number>>>({});
  const [provDraft,setProvDraft]               = useState<EsProvDraft|null>(null);

  const blankDisplayPcts = useMemo<Record<EsPartyId,number>>(()=>{
    const zero=Object.fromEntries(ES_PARTIES.map(p=>[p.id,0])) as Record<EsPartyId,number>;
    if(preset!=='blank') return zero;
    const weighted: Partial<Record<EsPartyId,number>>={};
    let totalW=0;
    for(const cId of projectedProvs) {
      const cv=calcProvVotes(natPcts,cId,provOverrides[cId]);
      const rPct=(provReportingPct[cId]??100)/100;
      const w=(ES_PROVINCE_MAP[cId]?.weight??0)*rPct;
      for(const p of ES_PARTIES) weighted[p.id]=(weighted[p.id]??0)+(cv[p.id]??0)*w;
      totalW+=w;
    }
    if(totalW===0) return zero;
    return Object.fromEntries(ES_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW])) as Record<EsPartyId,number>;
  },[preset,projectedProvs,provOverrides,provReportingPct,natPcts]);

  const blankVoteScale=useMemo(()=>{
    if(preset!=='blank') return 1;
    const projW=[...projectedProvs].reduce((s,cId)=>s+(ES_PROVINCE_MAP[cId]?.weight??0)*((provReportingPct[cId]??100)/100),0);
    return Math.min(1,projW/ES_TOTAL_PROV_WEIGHT);
  },[preset,projectedProvs,provReportingPct]);

  // Blank map: which provinces have been projected (reported), with their % reporting.
  const blankProvFractions=useMemo<Partial<Record<EsProvId,number>>>(()=>{
    if(preset!=='blank') return {};
    const f:Partial<Record<EsProvId,number>>={};
    for(const cId of projectedProvs) f[cId]=(provReportingPct[cId]??100)/100;
    return f;
  },[preset,projectedProvs,provReportingPct]);

  // Seats accrue province-by-province from 0 as each is projected — ONLY reported
  // provinces contribute (real Spanish per-constituency D'Hondt), never a national
  // extrapolation across all 52 provinces.
  const blankSeats=useMemo<Partial<Record<EsPartyId,number>>|undefined>(()=>
    preset==='blank'?calcPartialSeats(natPcts,blankProvFractions,provOverrides):undefined,
  [preset,natPcts,blankProvFractions,provOverrides]);

  const overrideDisplayPcts=useMemo<Record<EsPartyId,number>>(()=>{
    const hasAny=Object.values(provOverrides).some(o=>o&&Object.keys(o).length>0);
    if(!hasAny) return natPcts;
    const weighted:Partial<Record<EsPartyId,number>>={};
    let totalW=0;
    for(const prov of ES_PROVINCES) {
      const cv=calcProvVotes(natPcts,prov.id,provOverrides[prov.id]);
      const w=prov.weight;
      for(const p of ES_PARTIES) weighted[p.id]=(weighted[p.id]??0)+(cv[p.id]??0)*w;
      totalW+=w;
    }
    if(totalW===0) return natPcts;
    return Object.fromEntries(ES_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW])) as Record<EsPartyId,number>;
  },[natPcts,provOverrides]);

  const displayPcts=preset==='blank'?blankDisplayPcts:overrideDisplayPcts;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selectedProv,setSelectedProv]         = useState<EsProvId|null>(null);
  const [bubbleMap,setBubbleMap]               = useState(false);
  const [seatDots,setSeatDots]                 = useState(false);
  const [scoreboardVisible,setScoreboardVisible] = useState(true);
  const [hiddenParties,setHiddenParties]       = useState<Set<EsPartyId>>(new Set());

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
  const [simDraftPcts,   setSimDraftPcts]   = useState<Record<EsPartyId,number>>(()=>({...ES_VOTE_PCT_2023}));
  const [simDraftLocks,  setSimDraftLocks]  = useState<Set<EsPartyId>>(new Set());
  const [,setSimDraftTouched]               = useState(false);
  const [simDuration,    setSimDuration]    = useState<60000|120000|300000|600000>(120000);
  const [simNatPcts,     setSimNatPcts]     = useState<Record<EsPartyId,number>|null>(null);
  const [simSeats,       setSimSeats]       = useState<Partial<Record<EsPartyId,number>>|undefined>();
  const [simProgress,    setSimProgress]    = useState(0);
  const [simRunning,     setSimRunning]     = useState(false);
  const [declaredProvs,  setDeclaredProvs]  = useState<Set<EsProvId>|undefined>();
  const [simProvFractions,setSimProvFractions] = useState<Partial<Record<EsProvId,number>>>({});
  const simTimersRef  = useRef<ReturnType<typeof setTimeout>[]>([]);
  const simNatPctsRef = useRef<Record<EsPartyId,number>>(natPcts);

  useEffect(()=>{ if(rightPanel==='sim'){setSimDraftPcts({...natPcts});setSimDraftTouched(false);} },[rightPanel==='sim']); // eslint-disable-line

  const simEffLocks=useMemo(()=>new Set<EsPartyId>([...simDraftLocks,...hiddenParties]),[simDraftLocks,hiddenParties]);
  const [simSortOrder]=useState<EsPartyId[]>(()=>ES_LR_ORDER.slice());

  function stopSim(){ simTimersRef.current.forEach(clearTimeout); simTimersRef.current=[]; setSimRunning(false); }

  function runSim() {
    stopSim(); setSimDraftTouched(false);
    simNatPctsRef.current={...simDraftPcts}; setSimNatPcts({...simDraftPcts});
    const PARTS=5; const totalProvs=ES_PROVINCES.length;
    const allTimes=esBellCurveTimes(PARTS*totalProvs,simDuration);
    const provIds=[...ES_PROVINCES.map(p=>p.id)].sort(()=>Math.random()-0.5);
    const events:{pId:EsProvId;cumFrac:number;t:number}[]=[];
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
    const localFrac:Partial<Record<EsProvId,number>>={};
    const localDecl=new Set<EsProvId>();
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

  const simPartialPcts=useMemo<Record<EsPartyId,number>|null>(()=>{
    if(!simNatPcts) return null;
    const entries=Object.entries(simProvFractions) as unknown as [EsProvId,number][];
    if(entries.length===0) return null;
    const weighted:Partial<Record<EsPartyId,number>>={};
    let totalW=0;
    for(const [pId,frac] of entries){
      if(!frac) continue;
      const w=(ES_PROVINCE_MAP[pId]?.weight??0)*frac;
      const cv=calcProvVotes(simNatPcts,pId);
      for(const p of ES_PARTIES) weighted[p.id]=(weighted[p.id]??0)+(cv[p.id]??0)*w;
      totalW+=w;
    }
    if(totalW===0) return null;
    return Object.fromEntries(ES_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW])) as Record<EsPartyId,number>;
  },[simNatPcts,simProvFractions]);

  const simVoteScale=useMemo(()=>{
    if(!simNatPcts) return undefined;
    const reportedW=(Object.entries(simProvFractions) as unknown as [EsProvId,number][])
      .reduce((s,[pId,frac])=>s+(ES_PROVINCE_MAP[pId]?.weight??0)*(frac??0),0);
    return Math.min(1,reportedW/ES_TOTAL_PROV_WEIGHT);
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
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="es">
      {/* ── Header ── */}
      <header className={`h-[52px] ${dark?'bg-[rgba(7,13,28,0.94)]':'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={()=>navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4"><GlobeLogo/></button>
        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <img src={`${import.meta.env.BASE_URL}greece-flag.png`} alt="Greece" className="h-4 rounded-[2px] shrink-0 opacity-90"/>
          <span className="text-[11px] font-bold text-ink shrink-0 hidden sm:block">Greece</span>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={loadBaseline}    className={preset==='baseline'   ?btnGold:btnMuted}>2023 Baseline</button>
          <button onClick={loadPolling2026} className={preset==='polling2026'?btnGold:btnMuted}>2026 Polling</button>
          <button onClick={loadBlank}       className={preset==='blank'      ?btnGold:btnMuted}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={()=>openRight('sim')}       className={rightPanel==='sim'      ?btnActive:btnMuted}>▶ Simulation</button>
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
        <EsScoreboard
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
        {leftPanel==='parties'&&<EsPartiesPanel hiddenParties={hiddenParties} onToggle={id=>setHiddenParties(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;})} onClose={()=>openLeft('parties')} dark={dark}/>}
        {showParli    &&<EsParliamentPanel seats={displaySeats} onClose={()=>openLeft('parli')}    exiting={exitLeft==='parli'}    dark={dark}/>}
        {showBreakdown&&<EsBreakdownPanel  seats={displaySeats} natPcts={displayPcts} isBaseline={preset==='baseline'} onClose={()=>openLeft('breakdown')} exiting={exitLeft==='breakdown'} dark={dark}/>}

        {/* MAP */}
        <div className="relative flex-1 min-w-0 min-h-0">
          <EsMapView
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
            <EsReportingWidget
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
              <button onClick={()=>openRight('sim')} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
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
                const party=ES_PARTY_MAP[id]; const pct=simDraftPcts[id]??0; const isLocked=simDraftLocks.has(id); const color=partyColor(id);
                const rawVotes=Math.round(pct/100*ES_GRAND_TOTAL_VOTES); const cap=ES_PARTY_VOTE_CAP[id]; const capped=cap<55;
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
                      onChange={e=>{setSimDraftPcts(redistributePcts(simDraftPcts,id,parseFloat(e.target.value),simEffLocks,ES_PARTY_VOTE_CAP));setSimDraftTouched(true);}}
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
                {simRunning?`${simProgress}/${ES_PROVINCES.length} reporting…`:'▶ Run Simulation'}
              </button>
              {(simSeats||declaredProvs)&&(
                <button onClick={()=>{stopSim();setSimSeats(undefined);setDeclaredProvs(undefined);setSimProgress(0);setSimProvFractions({});setSimNatPcts(null);}}
                  className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">Reset</button>
              )}
            </div>
          </aside>
        )}

        {showProv&&selectedProv&&(
          <EsProvPanel key={selectedProv} provId={selectedProv} natPcts={natPcts}
            provOverride={provOverrides[selectedProv]}
            onOverride={pcts=>setProvOverrides(prev=>({...prev,[selectedProv]:pcts}))}
            onResetOverride={()=>{setProvOverrides(prev=>{const n={...prev};delete n[selectedProv];return n;});setProjectedProvs(prev=>{const n=new Set(prev);n.delete(selectedProv);return n;});setProvDraft(null);}}
            onClose={()=>{setSelectedProv(null);setProvDraft(null);}}
            isBlankMode={preset==='blank'} isProjected={projectedProvs.has(selectedProv)}
            reportingPct={provReportingPct[selectedProv]??100}
            onProject={()=>setProjectedProvs(prev=>new Set([...prev,selectedProv]))}
            onReportingPctChange={pct=>setProvReportingPct(prev=>({...prev,[selectedProv]:pct}))}
            onDraftChange={preset==='blank'?(pcts,rpt)=>setProvDraft({provId:selectedProv,pcts,rptPct:rpt}):undefined}
            hiddenParties={hiddenParties} dark={dark}/>
        )}

        {showDistrib  &&<EsDistributionsPanel natPcts={displayPcts} provOverrides={provOverrides} is2026={preset!=='baseline'} onClose={()=>openRight('distributions')} exiting={exitRight==='distributions'} dark={dark}/>}
        {showTutorial &&<EsTutorialPanel  onClose={()=>openRight('tutorial')}  exiting={exitRight==='tutorial'}  dark={dark}/>}
        {showCoalition&&<EsCoalitionPanel seats={displaySeats} onClose={()=>openRight('coalition')} exiting={exitRight==='coalition'} dark={dark}/>}
      </div>
    </div>
  );
}
