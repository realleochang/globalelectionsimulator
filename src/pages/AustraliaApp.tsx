import { useEffect, useRef, useState, useCallback, useMemo, forwardRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import type { GeoJsonObject, Feature } from 'geojson';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import {
  AU_PARTIES, AU_PARTY_MAP, AU_ELECTORATES, AU_TOTAL, AU_MAJORITY,
  COALITION_IDS, PREF_TO_ALP,
  type AuPartyId,
} from '../data/australia2025';
import { OFFICIAL_IRV_ROUNDS } from '../data/australia2025rounds';

// ── Types ──────────────────────────────────────────────────────────────────────
type PresetId = 'baseline' | 'polling2026' | 'blank';

type LeaderInfo = {
  lastName: string;
  wikiTitle?: string;
  localImage?: string;
  scale?: number;
  transformOrigin?: string;
  objectPosition?: string;
  initials?: string;
};

type IrvRound = {
  eliminated: AuPartyId | null; // null = first preferences
  votes: Partial<Record<AuPartyId, number>>;
};

type TooltipState = {
  x: number; y: number;
  name: string; state: string;
  validVotes: number;
  parties: { id: string; votes: number; pct: number }[];
  winner: AuPartyId | null;
  tpp: { alp: number; coal: number } | null;
  irvRounds: IrvRound[];
  officialTCP?: Partial<Record<AuPartyId, number>>;
  officialRounds?: IrvRound[];
} | null;

// ── Leaders ────────────────────────────────────────────────────────────────────
// Post-2025 / 2026 leaders (Dutton lost Dickson → Taylor; Bandt lost Melbourne → Waters; Littleproud → Canavan)
const AU_LEADERS: Record<AuPartyId, LeaderInfo> = {
  ALP: { lastName: 'Albanese',   wikiTitle: 'Anthony_Albanese' },
  LIB: { lastName: 'Taylor',     wikiTitle: 'Angus_Taylor_(politician)' },
  NAT: { lastName: 'Canavan',    localImage: 'leaders/matt-canavan.jpg', objectPosition: 'center 15%' },
  LNP: { lastName: 'Crisafulli', wikiTitle: 'David_Crisafulli' },
  CLP: { lastName: 'Finocchiaro', wikiTitle: 'Lia_Finocchiaro' },
  GRN: { lastName: 'Waters',     wikiTitle: 'Larissa_Waters' },
  KAP: { lastName: 'Katter',     wikiTitle: 'Bob_Katter' },
  CA:  { lastName: 'Sharkie',    wikiTitle: 'Rebekha_Sharkie' },
  ONP: { lastName: 'Hanson',     wikiTitle: 'Pauline_Hanson' },
  IND: { lastName: 'Ind.',       initials: 'IND' },
  OTH: { lastName: 'Other',      initials: 'OTH' },
};

// 2025 election leaders (shown when the 2025 preset is active)
const AU_LEADERS_2025: Partial<Record<AuPartyId, LeaderInfo>> = {
  LIB: { lastName: 'Dutton',      wikiTitle: 'Peter_Dutton' },
  NAT: { lastName: 'Littleproud', wikiTitle: 'David_Littleproud' },
  GRN: { lastName: 'Bandt',       wikiTitle: 'Adam_Bandt' },
};

// ── Hemicycle constants ────────────────────────────────────────────────────────
const AU_HEMI_ROWS = [22, 26, 30, 34, 38];
const AU_HEMI_RADII = AU_HEMI_ROWS.map((_, i) => 68 + i * 13);
const AU_HEMI_CX = 190, AU_HEMI_CY = 185, AU_HEMI_DOT_R = 2.8;
const AU_POLITICAL_ORDER: AuPartyId[] = ['GRN', 'ALP', 'CA', 'IND', 'OTH', 'KAP', 'NAT', 'CLP', 'LNP', 'LIB', 'ONP'];
const AU_HEMI_POSITIONS: { x: number; y: number }[] = (() => {
  const pts: { x: number; y: number; theta: number }[] = [];
  for (let row = 0; row < AU_HEMI_ROWS.length; row++) {
    const n = AU_HEMI_ROWS[row], r = AU_HEMI_RADII[row];
    for (let j = 0; j < n; j++) {
      const theta = Math.PI * (1 - j / (n - 1));
      pts.push({ x: AU_HEMI_CX + r * Math.cos(theta), y: AU_HEMI_CY - r * Math.sin(theta), theta });
    }
  }
  pts.sort((a, b) => b.theta - a.theta);
  return pts.map(({ x, y }) => ({ x, y }));
})();

// ── Simulation constants ────────────────────────────────────────────────────────
const STATE_TIMING_OFFSET: Record<string, number> = {
  NSW: 0, VIC: 0, TAS: 0, ACT: 0, QLD: 0.05, SA: 0.15, NT: 0.15, WA: 0.50,
};

// 2026 polling: ALP 29%, ONP 26%, Coalition 22%, GRN 12%, OTH 10%
// First-preference results are precomputed per-seat with realistic regional swings (see results2026 field).

const BLANK_COLOR = '#E5E7EB';

// ── Helpers ────────────────────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function fmtVotes(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return n.toString();
}

function enforceNoSmooth(layer: L.GeoJSON) {
  layer.eachLayer((l: L.Layer) => {
    const p = l as any;
    if (p.options) p.options.smoothFactor = 0;
  });
}

// ── Preference flows: when a party is eliminated in IRV, where do votes go? ────
// Values don't need to sum to 1 — runIRV normalises to remaining candidates only.
// Every party must appear in every other party's row (even if tiny) so no single
// remaining candidate ever absorbs 100% of an eliminated party's votes.
const PREF_FLOWS: Partial<Record<AuPartyId, Partial<Record<AuPartyId, number>>>> = {
  // Greens → Labor strongly, then teal IND, small right trickle
  GRN: { ALP: 0.83, IND: 0.06, CA: 0.04, OTH: 0.03, LIB: 0.02, NAT: 0.01, LNP: 0.01, KAP: 0.005, ONP: 0.005, CLP: 0.005 },
  // Labor → Greens first, then centrists; KAP preferred over ONP (rural/regional, not far-right)
  ALP: { GRN: 0.78, CA: 0.07, IND: 0.07, KAP: 0.03, OTH: 0.03, LIB: 0.02, NAT: 0.01, LNP: 0.01, ONP: 0.01, CLP: 0.005 },
  // Centre Alliance → ALP/GRN heavily, small right trickle
  CA:  { ALP: 0.62, GRN: 0.18, IND: 0.08, LIB: 0.05, NAT: 0.03, OTH: 0.02, LNP: 0.01, KAP: 0.005, ONP: 0.005, CLP: 0.005 },
  // Independents (teals) → ALP/GRN majority; some to LIB/centrist, tiny ONP
  IND: { ALP: 0.50, GRN: 0.20, CA: 0.10, LIB: 0.08, NAT: 0.04, OTH: 0.03, LNP: 0.02, KAP: 0.02, ONP: 0.01, CLP: 0.01 },
  // Liberals → lean ONP in 2026 but not exclusively; some to NAT/IND/ALP
  LIB: { ONP: 0.62, NAT: 0.13, LNP: 0.09, KAP: 0.05, ALP: 0.04, OTH: 0.03, IND: 0.02, GRN: 0.01, CA: 0.005, CLP: 0.05 },
  // Nationals → Coalition partners first, ONP second, small ALP/IND trickle
  NAT: { LIB: 0.34, LNP: 0.21, ONP: 0.22, KAP: 0.10, ALP: 0.06, OTH: 0.04, IND: 0.02, GRN: 0.005, CA: 0.005, CLP: 0.05 },
  // LNP (QLD) → similar to NAT/LIB mix
  LNP: { LIB: 0.32, NAT: 0.24, ONP: 0.22, KAP: 0.10, ALP: 0.05, OTH: 0.03, IND: 0.02, GRN: 0.005, CA: 0.005, CLP: 0.04 },
  // CLP (NT) → strongly coalition-aligned; ONP second, ALP small trickle
  CLP: { ONP: 0.48, LIB: 0.20, NAT: 0.12, LNP: 0.08, KAP: 0.05, ALP: 0.04, OTH: 0.02, IND: 0.01, GRN: 0.005, CA: 0.005 },
  // ONP → Coalition strongly; small left trickle; CLP as minor NT target
  ONP: { LIB: 0.46, NAT: 0.16, LNP: 0.15, KAP: 0.10, ALP: 0.07, OTH: 0.03, CLP: 0.06, IND: 0.015, GRN: 0.01, CA: 0.005 },
  // Katter → LNP/ONP/NAT first (far North QLD rural); ALP above LIB (social policy)
  KAP: { LNP: 0.34, ONP: 0.26, NAT: 0.18, ALP: 0.12, OTH: 0.05, LIB: 0.02, CLP: 0.02, IND: 0.015, GRN: 0.01, CA: 0.005 },
  // Other → mixed; slight left lean overall
  OTH: { ALP: 0.26, LIB: 0.18, GRN: 0.14, ONP: 0.14, NAT: 0.10, IND: 0.08, LNP: 0.05, KAP: 0.03, CLP: 0.03, CA: 0.02 },
};

// ── Full IRV simulation — returns round-by-round elimination trace ──────────────
type IrvResult = { rounds: IrvRound[]; winner: AuPartyId };

function runIRV(results: Partial<Record<AuPartyId, number>>, validVotes: number): IrvResult {
  const total = validVotes > 0 ? validVotes
    : Math.max(1, Object.values(results).reduce((s, v) => s + (v ?? 0), 0));

  let current: Partial<Record<AuPartyId, number>> = {};
  for (const [id, v] of Object.entries(results) as [AuPartyId, number][]) {
    if ((v ?? 0) > 0) current[id] = v;
  }

  const rounds: IrvRound[] = [{ eliminated: null, votes: { ...current } }];

  for (let r = 0; r < 10; r++) {
    const candidates = (Object.entries(current) as [AuPartyId, number][])
      .filter(([, v]) => (v ?? 0) > 0)
      .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0));

    if (candidates.length === 0) break;
    if ((candidates[0][1] ?? 0) > total * 0.5) return { rounds, winner: candidates[0][0] };
    if (candidates.length <= 2) return { rounds, winner: candidates[0][0] };

    // Eliminate party with fewest votes
    const [eliminated, eliminatedVotes] = candidates[candidates.length - 1];
    const remaining = candidates.slice(0, -1).map(([id]) => id);

    // Build normalised preference flows to remaining candidates only
    const rawFlows = PREF_FLOWS[eliminated] ?? {};
    let redistFlows: Partial<Record<AuPartyId, number>> = {};
    let flowSum = 0;
    for (const id of remaining) {
      const f = rawFlows[id] ?? 0;
      if (f > 0) { redistFlows[id] = f; flowSum += f; }
    }

    const newCurrent: Partial<Record<AuPartyId, number>> = {};
    let totalAdded = 0;
    for (const id of remaining) {
      const fraction = flowSum > 0 ? (redistFlows[id] ?? 0) / flowSum : 1 / remaining.length;
      const added = Math.round(eliminatedVotes * fraction);
      newCurrent[id] = (current[id] ?? 0) + added;
      totalAdded += added;
    }
    // Fix rounding error on the leading candidate
    const err = eliminatedVotes - totalAdded;
    if (err !== 0 && remaining.length > 0) newCurrent[remaining[0]] = (newCurrent[remaining[0]] ?? 0) + err;

    current = newCurrent;
    rounds.push({ eliminated, votes: { ...current } });
  }

  const winner = (Object.entries(current) as [AuPartyId, number][])
    .sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'ALP';
  return { rounds, winner };
}

function determineWinner(results: Partial<Record<AuPartyId, number>>, validVotes: number): AuPartyId {
  const total = Object.values(results).reduce((s, v) => s + (v ?? 0), 0);
  if (total === 0 || validVotes === 0) return 'ALP';
  return runIRV(results, validVotes).winner;
}

// ── TPP computation ─────────────────────────────────────────────────────────────
function computeTPP(results: Partial<Record<AuPartyId, number>>, validVotes: number): { alp: number; coal: number } {
  if (validVotes === 0) return { alp: 0.5, coal: 0.5 };
  const r = results as Record<AuPartyId, number>;
  const alp = r.ALP ?? 0, lib = r.LIB ?? 0, nat = r.NAT ?? 0, lnp = r.LNP ?? 0, clp = r.CLP ?? 0;
  const grn = r.GRN ?? 0, ind = r.IND ?? 0, ca = r.CA ?? 0, onp = r.ONP ?? 0, kap = r.KAP ?? 0, oth = r.OTH ?? 0;
  const coal = lib + nat + lnp + clp;
  const alp2cp  = alp  + grn*PREF_TO_ALP.GRN + ca*PREF_TO_ALP.CA   + onp*PREF_TO_ALP.ONP + ind*PREF_TO_ALP.IND + kap*PREF_TO_ALP.KAP + oth*PREF_TO_ALP.OTH;
  const coal2cp = coal + grn*(1-PREF_TO_ALP.GRN) + ca*(1-PREF_TO_ALP.CA) + onp*(1-PREF_TO_ALP.ONP) + ind*(1-PREF_TO_ALP.IND) + kap*(1-PREF_TO_ALP.KAP) + oth*(1-PREF_TO_ALP.OTH);
  const t = alp2cp + coal2cp;
  if (t === 0) return { alp: 0.5, coal: 0.5 };
  return { alp: alp2cp / t, coal: coal2cp / t };
}

// ── Coloring ────────────────────────────────────────────────────────────────────
function electorateFill(validVotes: number, results: Partial<Record<AuPartyId, number>>, dark = false, winnerOverride?: AuPartyId): string {
  const sorted = (Object.entries(results) as [AuPartyId, number][])
    .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return dark ? '#374151' : BLANK_COLOR;
  const winner = winnerOverride ?? determineWinner(results, validVotes);
  const winnerVotes = results[winner] ?? sorted[0][1];
  const runnerUpVotes = sorted.filter(([p]) => p !== winner)[0]?.[1] ?? 0;
  const margin = Math.max(0, ((winnerVotes - runnerUpVotes) / validVotes) * 100);
  const baseColor = AU_PARTY_MAP[winner]?.color ?? '#888888';
  const t = Math.min(Math.max(margin / 30, 0), 1);
  const lightness = dark ? 55 - t * (55 - 28) : 82 - t * (82 - 38);
  const c = hsl(baseColor);
  c.l = lightness / 100;
  return c.formatHex() as string;
}

// ── Preset builders ─────────────────────────────────────────────────────────────
function buildBaselineResults(): Record<string, Partial<Record<AuPartyId, number>>> {
  const r: Record<string, Partial<Record<AuPartyId, number>>> = {};
  for (const e of AU_ELECTORATES) r[e.id] = { ...e.results2025 };
  return r;
}

function buildPollingResults(): Record<string, Partial<Record<AuPartyId, number>>> {
  const r: Record<string, Partial<Record<AuPartyId, number>>> = {};
  for (const e of AU_ELECTORATES) r[e.id] = { ...e.results2026 };
  return r;
}

// 2026 polling national first-preference vote shares (%, derived from buildPollingResults)
// Used to initialise the sim panel so 0-swing = 2026 polling scenario
const POLLING_SHARES_2026: Record<AuPartyId, number> = (() => {
  const pollingRes = buildPollingResults();
  const totals: Partial<Record<AuPartyId, number>> = {};
  let grand = 0;
  for (const e of AU_ELECTORATES) {
    for (const [pid, v] of Object.entries(pollingRes[e.id] ?? {}) as [AuPartyId, number][]) {
      totals[pid] = (totals[pid] ?? 0) + v;
      grand += v;
    }
  }
  const r: Record<AuPartyId, number> = { ALP:0, LIB:0, NAT:0, LNP:0, CLP:0, GRN:0, KAP:0, CA:0, ONP:0, IND:0, OTH:0 };
  if (grand > 0) for (const pid of Object.keys(r) as AuPartyId[]) r[pid] = ((totals[pid] ?? 0) / grand) * 100;
  return r;
})();

// ── Simulation helpers ──────────────────────────────────────────────────────────
function randNormal(mean: number, std: number): number {
  const u = Math.random(), v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(Math.max(u, 1e-10))) * Math.cos(2 * Math.PI * v);
}

function bellCurveTimes(n: number, totalMs: number): number[] {
  return Array.from({ length: n }, () =>
    Math.max(0.01, Math.min(0.99, randNormal(0.5, 0.18))) * totalMs
  ).sort((a, b) => a - b);
}

// State-locked parties can't gain votes in electorates where they didn't run in 2025
const STATE_LOCKED_PARTIES: Set<AuPartyId> = new Set(['LNP', 'KAP', 'CA', 'CLP']);

// baseResults: if provided, use as the swing baseline (e.g. 2026 polling);
// otherwise falls back to each electorate's 2025 actual results.
function generateSimResults(
  swings: Record<AuPartyId, number>,
  baseResults?: Record<string, Partial<Record<AuPartyId, number>>>,
): Record<string, Partial<Record<AuPartyId, number>>> {
  const results: Record<string, Partial<Record<AuPartyId, number>>> = {};
  for (const e of AU_ELECTORATES) {
    const base = baseResults?.[e.id] ?? e.results2025;
    const newRes: Partial<Record<AuPartyId, number>> = {};
    let totalPct = 0;
    for (const [pid, votes] of Object.entries(base) as [AuPartyId, number][]) {
      const basePct = (votes as number) / e.validVotes;
      const swing = swings[pid] ?? 0;
      const noise = randNormal(0, 0.014);
      // State-locked parties stay at 0 where they didn't run in the base
      const newPct = (basePct === 0 && STATE_LOCKED_PARTIES.has(pid))
        ? 0
        : Math.max(0, basePct + swing + noise);
      newRes[pid] = newPct;
      totalPct += newPct;
    }
    if (totalPct > 0) {
      for (const pid of Object.keys(newRes) as AuPartyId[]) {
        newRes[pid] = Math.round(((newRes[pid] ?? 0) / totalPct) * e.validVotes);
      }
    }
    results[e.id] = newRes;
  }
  return results;
}

// ── Globe logo ──────────────────────────────────────────────────────────────────
function GlobeLogo({ size = 34 }: { size?: number }) {
  const lats: [number, number, number, string][] = [
    [7.6, 11.2, 2.8, '#12B6CF'], [13.2, 13.7, 3.4, '#02A95B'],
    [16.0, 14.0, 3.6, '#E4003B'], [18.8, 13.7, 3.4, '#FAA61A'],
    [24.4, 11.2, 2.8, '#0087DC'],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0" aria-hidden="true">
      <defs>
        <clipPath id="au-logo-clip"><circle cx="16" cy="16" r="14" /></clipPath>
        <radialGradient id="au-logo-shine" cx="32%" cy="24%" r="52%">
          <stop offset="0%" stopColor="white" stopOpacity="0.80" />
          <stop offset="45%" stopColor="white" stopOpacity="0.12" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="au-logo-depth" cx="70%" cy="72%" r="55%">
          <stop offset="0%" stopColor="rgba(20,60,120,0.18)" />
          <stop offset="100%" stopColor="rgba(20,60,120,0)" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="rgba(180,215,255,0.09)" clipPath="url(#au-logo-clip)" />
      <g clipPath="url(#au-logo-clip)" fill="none" strokeLinecap="round">
        {lats.map(([y, rx, ry, color]) => (
          <path key={`bk-${y}`} d={`M${16 - rx} ${y} A${rx} ${ry} 0 0 0 ${16 + rx} ${y}`}
            stroke={color} strokeWidth="1.05" strokeOpacity="0.42" strokeDasharray="2 2" />
        ))}
      </g>
      <g clipPath="url(#au-logo-clip)" fill="none" stroke="rgba(80,140,210,0.22)" strokeWidth="0.6" strokeDasharray="2 2" strokeLinecap="round">
        <ellipse cx="16" cy="16" rx="8" ry="14" />
        <ellipse cx="16" cy="16" rx="4" ry="14" />
      </g>
      <g clipPath="url(#au-logo-clip)" fill="none" strokeLinecap="round">
        {lats.map(([y, rx, ry, color]) => (
          <path key={`ft-${y}`} d={`M${16 - rx} ${y} A${rx} ${ry} 0 0 1 ${16 + rx} ${y}`}
            stroke={color} strokeWidth="1.30" strokeOpacity="0.90" />
        ))}
      </g>
      <g clipPath="url(#au-logo-clip)" fill="none" stroke="rgba(80,140,210,0.32)" strokeLinecap="round">
        <line x1="16" y1="2" x2="16" y2="30" strokeWidth="0.70" />
        <ellipse cx="16" cy="16" rx="8" ry="14" strokeWidth="0.65" />
        <ellipse cx="16" cy="16" rx="4" ry="14" strokeWidth="0.55" />
      </g>
      <circle cx="16" cy="16" r="14" fill="url(#au-logo-depth)" />
      <circle cx="16" cy="16" r="14" fill="url(#au-logo-shine)" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(140,195,255,0.55)" strokeWidth="1.1" />
      <circle cx="16" cy="16" r="13.4" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.5" />
    </svg>
  );
}

// ── Map helpers ─────────────────────────────────────────────────────────────────
function MapFitter({ geojson }: { geojson: GeoJsonObject }) {
  const map = useMap();
  useEffect(() => {
    try {
      const layer = L.geoJSON(geojson as GeoJsonObject);
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [10, 10] });
    } catch { /* ignore */ }
  }, [map, geojson]);
  return null;
}

function AuGeoLayer({ geojson, style, onEachFeature, layerRef }: {
  geojson: GeoJsonObject;
  style: () => L.PathOptions;
  onEachFeature: (feature: Feature, layer: L.Layer) => void;
  layerRef: { current: L.GeoJSON | null };
}) {
  const map = useMap();
  const styleRef = useRef(style);
  const onEachRef = useRef(onEachFeature);
  useEffect(() => { styleRef.current = style; }, [style]);
  useEffect(() => { onEachRef.current = onEachFeature; }, [onEachFeature]);

  useEffect(() => {
    const layer = L.geoJSON(geojson as any, {
      ...({ smoothFactor: 0 } as any),
      renderer: L.svg({ padding: 0.5 }),
      style: () => styleRef.current(),
      onEachFeature: (f, l) => onEachRef.current(f, l),
    });
    layer.addTo(map);
    layerRef.current = layer;
    enforceNoSmooth(layer);

    const onZoomEnd = () => enforceNoSmooth(layer);
    map.on('zoomend', onZoomEnd);

    return () => {
      map.off('zoomend', onZoomEnd);
      layer.remove();
      layerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geojson]);

  return null;
}

// ── Leader photo circle ─────────────────────────────────────────────────────────
function AuLeaderPhoto({ partyId, leader }: { partyId: AuPartyId; leader?: LeaderInfo }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    setPhotoUrl(null);
    if (leader?.localImage) { setPhotoUrl(`${import.meta.env.BASE_URL}${leader.localImage}`); return; }
    if (!leader?.wikiTitle) return;
    let cancelled = false;
    fetchWikiPhoto(leader.wikiTitle).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [leader?.wikiTitle, leader?.localImage]);
  const initials = leader?.initials ?? (leader ? leader.lastName.slice(0, 2).toUpperCase() : partyId.slice(0, 2).toUpperCase());
  return (
    <div className="cand-circle-frame">
      {photoUrl ? (
        <img src={photoUrl} alt={leader?.lastName ?? partyId} style={{
          objectPosition: leader?.objectPosition ?? 'center top',
          transform: `scale(${leader?.scale ?? 1})`,
          transformOrigin: leader?.transformOrigin ?? '50% 20%',
        }} onError={() => setPhotoUrl(null)} />
      ) : (
        <span className="cand-initials">{initials}</span>
      )}
    </div>
  );
}

// ── Candidate tile (UK cand-col style) ──────────────────────────────────────────
interface CandTileProps {
  partyId: AuPartyId;
  seats: number;
  pct: number | undefined;
  votes: number | undefined;
  isLeader: boolean;
  isWinner: boolean;
  leaderOverride?: LeaderInfo;
}

const CandTile = forwardRef<HTMLDivElement, CandTileProps>(function CandTile(
  { partyId, seats, pct, votes, isLeader, isWinner, leaderOverride }, ref
) {
  const party  = AU_PARTY_MAP[partyId];
  const color  = party?.color ?? '#888888';
  const leader = leaderOverride ?? AU_LEADERS[partyId];
  const colorAlpha = hexToRgba(color, 0.13);

  return (
    <div
      ref={ref}
      className={`cand-col${isLeader ? ' is-leader' : ''}${isWinner ? ' is-winner' : ''}`}
      style={{
        '--cand-color': color, '--cand-color-alpha': colorAlpha,
        borderColor: isLeader || isWinner ? color : hexToRgba(color, 0.30),
      } as React.CSSProperties}
    >
      <div style={{ position: 'relative' }}>
        <AuLeaderPhoto partyId={partyId} leader={leader} />
        {isWinner && (
          <span className="called-tick">
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="8.5" fill={color} />
              <path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </div>
      <span className="cand-leader-name">{leader?.lastName ?? ''}</span>
      <span className="cand-party-abbrev">{partyId}</span>
      <span className="cand-seats">{seats}</span>
      <span className="cand-party-name">{party?.shortName ?? partyId}</span>
      <div className="cand-pct">
        <span className="pct-number" style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color }}>
          {pct !== undefined ? `${pct.toFixed(1)}%` : '—'}
        </span>
      </div>
      <div style={{ fontSize: 9, fontFamily: '"JetBrains Mono",monospace', color: '#7a7870', lineHeight: 1, marginBottom: 3 }}>
        <span className="cand-votes-full">{votes !== undefined ? votes.toLocaleString() : '—'}</span>
        <span className="cand-votes-compact">{votes !== undefined ? fmtVotes(votes) : '—'}</span>
      </div>
      <div className="cand-bar-track" style={{ width: '100%', height: 3, borderRadius: 2, background: 'var(--bar-track)' }}>
        <div className="cand-bar-fill" style={{
          height: '100%', borderRadius: 2, background: color,
          width: `${Math.min((pct ?? 0) / 55 * 100, 100)}%`,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
});

// ── Scoreboard ──────────────────────────────────────────────────────────────────
function AuScoreboard({
  tally, votePcts, rawVotes, activePreset, simRunning,
}: {
  tally: Record<string, number>;
  votePcts: Record<string, number>;
  rawVotes: Record<string, number>;
  activePreset: PresetId | null;
  simRunning: boolean;
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

  const coalitionSeats = (tally['LIB'] ?? 0) + (tally['NAT'] ?? 0) + (tally['LNP'] ?? 0) + (tally['CLP'] ?? 0);
  const isCoalitionMajority = coalitionSeats >= AU_MAJORITY;
  const hasData = !!activePreset;
  const coalColor = AU_PARTY_MAP['LIB']?.color ?? '#1C4F9C';

  // Leading entity: compare coalition (as one) vs every individual non-coalition party
  const maxEntitySeats = hasData ? Math.max(
    coalitionSeats,
    ...AU_PARTIES.filter(p => !COALITION_IDS.includes(p.id as AuPartyId)).map(p => tally[p.id] ?? 0),
  ) : 0;
  const isCoalitionLeading = hasData && coalitionSeats > 0 && coalitionSeats >= maxEntitySeats;

  // Separate coalition from the rest; sort each group by seats.
  // Parties with 0 seats (except IND) are collapsed into the OTH tile.
  const { nonCoalParties, coalParties, othCombinedVotes, othCombinedPct } = useMemo(() => {
    const coal = AU_PARTIES.filter(p => COALITION_IDS.includes(p.id as AuPartyId));
    coal.sort((a, b) => (tally[b.id] ?? 0) - (tally[a.id] ?? 0));

    const nonCoalAll = AU_PARTIES.filter(p => p.id !== 'OTH' && !COALITION_IDS.includes(p.id as AuPartyId));
    const isBlank = activePreset === 'blank';
    // Blank map: show every party so the scoreboard is populated before data is entered.
    // Other presets: show parties with ≥1 seat, IND always.
    const visible = nonCoalAll.filter(p => isBlank || p.id === 'IND' || (tally[p.id] ?? 0) > 0);
    visible.sort((a, b) => (tally[b.id] ?? 0) - (tally[a.id] ?? 0));

    // Blank map: each party shows its own votes/pcts — don't fold zero-seat parties into OTH.
    const zeroIds = isBlank ? [] : nonCoalAll.filter(p => p.id !== 'IND' && (tally[p.id] ?? 0) === 0).map(p => p.id);
    const othCombinedVotes = ['OTH', ...zeroIds].reduce((s, id) => s + (rawVotes[id] ?? 0), 0);
    const othCombinedPct   = ['OTH', ...zeroIds].reduce((s, id) => s + (votePcts[id] ?? 0), 0);

    const oth = AU_PARTIES.find(p => p.id === 'OTH')!;
    return { nonCoalParties: [...visible, oth], coalParties: coal, othCombinedVotes, othCombinedPct };
  }, [tally, rawVotes, votePcts, activePreset]);

  // Find where to insert the coalition group (by total coalition seats)
  const coalInsertAt = (() => {
    const idx = nonCoalParties.findIndex(p => p.id !== 'OTH' && (tally[p.id] ?? 0) < coalitionSeats);
    return idx === -1 ? nonCoalParties.length - 1 : idx; // keep OTH last
  })();

  const coalGroupStyle: React.CSSProperties = {
    position: 'relative',
    overflow: isCoalitionMajority ? 'hidden' : undefined,
    borderColor: isCoalitionLeading ? coalColor : undefined,
    boxShadow: isCoalitionMajority
      ? `0 0 0 1.5px ${coalColor}, 0 3px 12px rgba(0,0,0,0.09)`
      : isCoalitionLeading
      ? `0 0 0 1px ${coalColor}`
      : undefined,
  };

  const renderCoalitionGroup = () => (
    <div key="coalition-group" className="ni-group" style={coalGroupStyle}>
      {isCoalitionMajority && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
          background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.26) 50%, transparent 70%)',
          animation: 'shimmerSweep 2.2s ease-in-out infinite',
        }} />
      )}
      <span className="ni-group-label" style={{ position: 'relative' }}>
        Coalition
        {isCoalitionMajority && (
          <span style={{ position: 'absolute', top: -6, right: -10 }}>
            <svg width="13" height="13" viewBox="0 0 17 17" fill="none" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="8.5" fill={coalColor} />
              <path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        )}
      </span>
      <div className="ni-group-tiles">
        {coalParties.map(p => (
          <CandTile key={p.id} partyId={p.id as AuPartyId}
            seats={tally[p.id] ?? 0} pct={votePcts[p.id]} votes={rawVotes[p.id]}
            isLeader={false} isWinner={false}
            leaderOverride={activePreset === 'baseline' ? AU_LEADERS_2025[p.id as AuPartyId] : undefined}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="shrink-0 border-b border-default bg-canvas">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {nonCoalParties.map((p, i) => {
            const isOth = p.id === 'OTH';
            const partySeats = tally[p.id] ?? 0;
            const isLeader = hasData && !isCoalitionLeading && partySeats > 0 && partySeats >= maxEntitySeats;
            const isWinner = hasData && partySeats >= AU_MAJORITY;
            return (
              <>
                {i === coalInsertAt && renderCoalitionGroup()}
                <CandTile
                  key={p.id}
                  partyId={p.id as AuPartyId}
                  seats={partySeats}
                  pct={isOth ? othCombinedPct : votePcts[p.id]}
                  votes={isOth ? othCombinedVotes : rawVotes[p.id]}
                  isLeader={isLeader}
                  isWinner={isWinner}
                  leaderOverride={activePreset === 'baseline' ? AU_LEADERS_2025[p.id as AuPartyId] : undefined}
                />
              </>
            );
          })}
          {coalInsertAt >= nonCoalParties.length && renderCoalitionGroup()}

        </div>
      </div>

      {simRunning && (
        <div className="px-3 pb-1.5">
          <div className="text-[8px] font-mono text-ink-3 text-center animate-pulse">
            ● Simulation running — results updating live
          </div>
        </div>
      )}
    </div>
  );
}

// ── Electorate detail panel (UK style) ─────────────────────────────────────────
interface ElectoratePanelProps {
  id: string;
  name: string;
  state: string;
  results?: Partial<Record<AuPartyId, number>>;
  results2025?: Partial<Record<AuPartyId, number>>;
  validVotes?: number;
  activePreset: PresetId | null;
  onClose: () => void;
  onResultsChange?: (id: string, newResults: Partial<Record<AuPartyId, number>>) => void;
}

function ElectoratePanel({
  id, name, state, results, results2025, validVotes, activePreset, onClose, onResultsChange,
}: ElectoratePanelProps) {
  const total = validVotes ?? 0;
  const [sliderPcts, setSliderPcts] = useState<Record<string, number>>({});
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [projected, setProjected] = useState(false);
  const [editingParty, setEditingParty] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [reportingPct, setReportingPct] = useState(100);

  useEffect(() => {
    if (total === 0) { setSliderPcts({}); return; }
    if (!results) {
      if (activePreset === 'blank') {
        const share = 100 / AU_PARTIES.length;
        const pcts: Record<string, number> = {};
        for (const p of AU_PARTIES) pcts[p.id] = share;
        setSliderPcts(pcts);
        setProjected(false);
      } else setSliderPcts({});
      return;
    }
    const pcts: Record<string, number> = {};
    for (const [pid, votes] of Object.entries(results)) {
      if ((votes ?? 0) > 0) pcts[pid] = ((votes as number) / total) * 100;
    }
    setSliderPcts(pcts);
    if (activePreset === 'blank') setProjected(true);
  }, [id, results, total, activePreset]);

  useEffect(() => { setLocked(new Set()); setReportingPct(100); }, [id]);

  const toggleLock = useCallback((pid: string) => {
    setLocked(prev => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  }, []);

  const handleSlide = useCallback((pid: string, newPct: number) => {
    if (total === 0) return;
    const lockedSum = Object.entries(sliderPcts).filter(([p]) => p !== pid && locked.has(p)).reduce((s, [, v]) => s + v, 0);
    const available = Math.max(0, 100 - lockedSum);
    const capped = Math.min(Math.max(0, newPct), available);
    const remaining = available - capped;
    const unlockedOthers = Object.keys(sliderPcts).filter(p => p !== pid && !locked.has(p));
    const unlockedSum = unlockedOthers.reduce((s, p) => s + (sliderPcts[p] ?? 0), 0);
    const newPcts: Record<string, number> = { ...sliderPcts, [pid]: capped };
    if (remaining < 1e-9) {
      for (const p of unlockedOthers) newPcts[p] = 0;
    } else if (unlockedSum > 1e-9) {
      for (const p of unlockedOthers) newPcts[p] = ((sliderPcts[p] ?? 0) / unlockedSum) * remaining;
    } else if (unlockedOthers.length > 0) {
      const share = remaining / unlockedOthers.length;
      for (const p of unlockedOthers) newPcts[p] = share;
    }
    const normSum = Object.values(newPcts).reduce((s, v) => s + v, 0);
    if (normSum > 1e-9) for (const p of Object.keys(newPcts)) newPcts[p] = (newPcts[p] / normSum) * 100;
    setSliderPcts(newPcts);
    if (activePreset !== 'blank' && onResultsChange) {
      const nr: Partial<Record<AuPartyId, number>> = {};
      for (const [p, pct] of Object.entries(newPcts)) {
        if (pct > 1e-9) nr[p as AuPartyId] = Math.round((pct / 100) * total);
      }
      onResultsChange(id, nr);
    }
  }, [sliderPcts, locked, id, total, onResultsChange, activePreset]);

  const handleMakeProjection = useCallback(() => {
    if (!onResultsChange || total === 0) return;
    const factor = activePreset === 'blank' ? reportingPct / 100 : 1;
    const nr: Partial<Record<AuPartyId, number>> = {};
    for (const [p, pct] of Object.entries(sliderPcts)) {
      if (pct > 1e-9) nr[p as AuPartyId] = Math.round((pct / 100) * total * factor);
    }
    onResultsChange(id, nr);
    setProjected(true);
  }, [sliderPcts, id, total, onResultsChange, activePreset, reportingPct]);

  const commitEdit = useCallback((pid: string, raw: string) => {
    const num = parseFloat(raw);
    if (!isNaN(num)) handleSlide(pid, Math.max(0, Math.min(100, num)));
    setEditingParty(null); setEditValue('');
  }, [handleSlide]);

  const pct2025 = useMemo(() => {
    if (!results2025 || total === 0) return {} as Record<string, number>;
    const p: Record<string, number> = {};
    for (const [pid, votes] of Object.entries(results2025)) {
      if ((votes ?? 0) > 0) p[pid] = ((votes as number) / total) * 100;
    }
    return p;
  }, [results2025, total]);

  const irvResult = useMemo(() => {
    if (Object.keys(sliderPcts).length === 0) return null;
    const partial: Partial<Record<AuPartyId, number>> = {};
    for (const [p, pct] of Object.entries(sliderPcts)) {
      if (pct > 1e-9) partial[p as AuPartyId] = Math.round((pct / 100) * total);
    }
    return runIRV(partial, total);
  }, [sliderPcts, total]);

  const projectedWinner = irvResult?.winner ?? null;
  const [prefFlowOpen, setPrefFlowOpen] = useState(false);

  const sliderParties = AU_PARTIES.filter(p => {
    const hasCurrent = (sliderPcts[p.id] ?? 0) > 0.01;
    const has2025 = (pct2025[p.id] ?? 0) > 0.01;
    return hasCurrent || has2025 || p.id === 'ALP' || p.id === 'LIB' || p.id === 'LNP';
  });

  const showSliders = total > 0 && (activePreset === 'baseline' || activePreset === 'polling2026' || activePreset === 'blank');

  return (
    <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide relative">

      {/* ── Preference flow overlay ────────────────────────────────────── */}
      {prefFlowOpen && irvResult && (
        <div className="absolute inset-0 z-20 bg-white flex flex-col overflow-hidden">
          <div className="px-3.5 pt-3 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-bold text-ink leading-tight">Preference Count</h2>
              <p className="text-[9px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{name} · preferential (IRV)</p>
            </div>
            <button onClick={() => setPrefFlowOpen(false)} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
          </div>
          <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-4">
            {irvResult.rounds.map((round, ri) => {
              const isFirst = ri === 0;
              const isLast  = ri === irvResult.rounds.length - 1;
              const elimInNext = !isLast ? irvResult.rounds[ri + 1].eliminated : null;
              const prevRound  = ri > 0 ? irvResult.rounds[ri - 1] : null;
              const elim       = round.eliminated;
              const roundTotal = Object.values(round.votes).reduce((s, v) => s + (v ?? 0), 0);

              const parties = (Object.entries(round.votes) as [AuPartyId, number][])
                .sort(([, a], [, b]) => b - a);
              const maxVotes = parties[0]?.[1] ?? 1;

              return (
                <div key={ri}>
                  {/* Round label */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[8px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3">
                      {isFirst ? 'Round 1 — First Preferences' : `Round ${ri + 1}${elim ? ` — after ${AU_PARTY_MAP[elim]?.shortName ?? elim} eliminated` : ''}`}
                    </span>
                    {isLast && (
                      <span className="ml-auto text-[8px] font-mono font-bold uppercase tracking-[0.10em] px-1.5 py-0.5 rounded"
                        style={{ background: `${AU_PARTY_MAP[irvResult.winner]?.color ?? '#888'}22`, color: AU_PARTY_MAP[irvResult.winner]?.color ?? '#888' }}>
                        Final
                      </span>
                    )}
                  </div>

                  {/* Transfer note */}
                  {!isFirst && elim && prevRound && (() => {
                    const elimVotes = prevRound.votes[elim] ?? 0;
                    return (
                      <div className="mb-2 px-2 py-1.5 rounded-[4px] text-[9.5px] text-ink-2 leading-relaxed"
                        style={{ background: `${AU_PARTY_MAP[elim]?.color ?? '#888'}11`, border: `1px solid ${AU_PARTY_MAP[elim]?.color ?? '#888'}33` }}>
                        <span className="font-bold" style={{ color: AU_PARTY_MAP[elim]?.color ?? '#888' }}>
                          {AU_PARTY_MAP[elim]?.shortName ?? elim}
                        </span>
                        {' '}eliminated — {elimVotes.toLocaleString()} votes redistributed
                      </div>
                    );
                  })()}

                  {/* Bar chart for this round */}
                  <div className="space-y-1.5">
                    {parties.map(([pid, votes]) => {
                      const color  = AU_PARTY_MAP[pid]?.color ?? '#888888';
                      const pct    = roundTotal > 0 ? votes / roundTotal * 100 : 0;
                      const barW   = maxVotes > 0 ? votes / maxVotes * 100 : 0;
                      const isWinner = isLast && pct > 50;
                      const isNextElim = pid === elimInNext;
                      const gained = prevRound ? (votes - (prevRound.votes[pid] ?? 0)) : 0;
                      return (
                        <div key={pid}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                            <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none" style={{ opacity: isNextElim ? 0.45 : 1 }}>
                              {AU_PARTY_MAP[pid]?.shortName ?? pid}
                            </span>
                            {!isFirst && gained > 0 && (
                              <span className="text-[8.5px] font-mono font-semibold" style={{ color }}>+{gained.toLocaleString()}</span>
                            )}
                            {isNextElim && (
                              <span className="text-[7.5px] font-mono font-bold uppercase tracking-wide text-ink-3">elim →</span>
                            )}
                            {isWinner && (
                              <span className="text-[8px] font-mono font-bold px-1 py-0.5 rounded" style={{ background: `${color}22`, color }}>✓ wins</span>
                            )}
                            <span className="text-[10px] font-mono font-bold tabular-nums shrink-0" style={{ color, opacity: isNextElim ? 0.45 : 1 }}>{pct.toFixed(1)}%</span>
                          </div>
                          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: `${color}18` }}>
                            <div style={{ width: `${barW}%`, height: '100%', background: color, borderRadius: 9999, opacity: isNextElim ? 0.35 : 1, transition: 'width 0.3s ease' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div className="h-3" />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-bold text-ink leading-tight truncate">{name}</h1>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {state} · {total.toLocaleString()} votes
            </p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>

        {/* Winner preview — click to see full preference count */}
        {projectedWinner && (
          <button
            onClick={() => setPrefFlowOpen(v => !v)}
            className="mt-2 w-full flex items-center gap-2 px-2 py-1.5 rounded-[4px] text-left transition-colors hover:brightness-95"
            style={{
              background: 'rgba(200,160,32,0.07)',
              border: '1.5px solid #c8a020',
              boxShadow: '0 0 0 1px rgba(200,160,32,0.15)',
            }}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: AU_PARTY_MAP[projectedWinner]?.color ?? '#888' }} />
            <span className="text-[11px] font-medium text-ink flex-1 truncate">{AU_PARTY_MAP[projectedWinner]?.name ?? projectedWinner}</span>
            <span className="text-[9px] font-mono font-semibold" style={{ color: '#c8a020' }}>View preferences ›</span>
          </button>
        )}
      </div>

      {/* Sliders */}
      {showSliders ? (
        <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">


          {sliderParties.map(p => {
            const b = pct2025[p.id] ?? 0;
            const c = sliderPcts[p.id] ?? 0;
            const delta = c - b;
            const isLocked = locked.has(p.id);
            return (
              <div key={p.id}>
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                  <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{p.shortName}</span>
                  <button onClick={() => toggleLock(p.id)} title={isLocked ? 'Unlock' : 'Lock'}
                    className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isLocked ? 'text-gold' : 'text-ink-3 hover:text-ink'}`}>
                    {isLocked ? (
                      <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                    ) : (
                      <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                    )}
                  </button>
                  {editingParty === p.id ? (
                    <input type="number" min={0} max={100} step={0.1} value={editValue} autoFocus
                      className="w-12 h-5 text-[10px] font-mono font-semibold tabular-nums text-right px-1 rounded border border-default focus:outline-none focus:border-ink-3 bg-white text-ink-2"
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(p.id, editValue)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); commitEdit(p.id, editValue); }
                        if (e.key === 'Escape') { setEditingParty(null); setEditValue(''); }
                      }} />
                  ) : (
                    <span onClick={() => { if (!isLocked) { setEditingParty(p.id); setEditValue(c.toFixed(1)); } }}
                      className="text-[10px] font-mono font-semibold text-ink-2 tabular-nums min-w-[38px] text-right leading-none"
                      style={{ cursor: isLocked ? 'default' : 'text' }}>
                      {c.toFixed(1)}%
                    </span>
                  )}
                </div>
                <input type="range" min={0} max={100} step={0.1} value={c} disabled={isLocked}
                  onChange={e => handleSlide(p.id, parseFloat(e.target.value))}
                  className="party-slider w-full"
                  style={{ '--party-color': p.color, '--pct': `${c}%` } as React.CSSProperties} />
                {activePreset !== 'blank' && Math.abs(delta) > 0.05 && (
                  <div className="flex justify-end mt-0.5">
                    <span className={`text-[8px] font-mono tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {delta > 0 ? '+' : ''}{delta.toFixed(1)}pp
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {activePreset === 'blank' && (
            <button onClick={handleMakeProjection} disabled={projected}
              className={`w-full py-2 text-[11px] font-mono font-semibold rounded-[4px] border mt-1 transition-colors ${projected ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gold bg-gold text-white hover:bg-gold-deep'}`}>
              {projected ? '✓ Projected' : 'Make a Projection'}
            </button>
          )}

          {activePreset !== 'blank' && (
            <button onClick={() => {
              if (!results2025 || !onResultsChange) return;
              onResultsChange(id, { ...results2025 });
            }}
              className="w-full py-1.5 mt-1 text-[10px] font-mono rounded-[4px] border border-default text-ink-3 hover:bg-hover transition-colors">
              Reset to 2025
            </button>
          )}

          <div className="text-[7.5px] font-mono text-ink-3/50 pt-2 border-t border-default">
            {total.toLocaleString()} valid votes · preferential (IRV)
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <p className="text-[12px] text-ink-3 italic">Load a preset to see vote details</p>
        </div>
      )}
    </aside>
  );
}

// ── Simulation panel ────────────────────────────────────────────────────────────
const SIM_DURATIONS = [
  { label: '1 min', ms: 60_000 },
  { label: '2 min', ms: 120_000 },
  { label: '5 min', ms: 300_000 },
  { label: '10 min', ms: 600_000 },
];

// Editable sim parties with optional region note (OTH auto-computed as remainder)
const SIM_EDITABLE_PARTIES: { id: AuPartyId; note?: string }[] = [
  { id: 'ALP' },
  { id: 'LIB' },
  { id: 'NAT', note: 'ex-QLD' },
  { id: 'LNP', note: 'QLD only' },
  { id: 'GRN' },
  { id: 'KAP', note: 'QLD' },
  { id: 'CA',  note: 'SA' },
  { id: 'ONP' },
  { id: 'IND' },
];

interface AuSimPanelProps {
  onClose: () => void;
  onStart: (swings: Record<AuPartyId, number>, durationMs: number) => void;
  onStop: () => void;
  running: boolean;
  progress: number;
  declared: number;
}

function AuSimPanel({ onClose, onStart, onStop, running, progress, declared }: AuSimPanelProps) {
  const btnBase = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const [duration, setDuration] = useState(60_000);

  // Vote-share % inputs — initialised from 2026 polling so zero-swing = 2026 scenario
  const [shares, setShares] = useState<Record<AuPartyId, string>>(() => {
    const init: Record<AuPartyId, string> = { ALP:'',LIB:'',NAT:'',LNP:'',CLP:'',GRN:'',KAP:'',CA:'',ONP:'',IND:'',OTH:'' };
    for (const { id } of SIM_EDITABLE_PARTIES) init[id] = POLLING_SHARES_2026[id].toFixed(1);
    return init;
  });

  const editableSum = SIM_EDITABLE_PARTIES.reduce((s, { id }) => s + (parseFloat(shares[id]) || 0), 0);
  const othRemainder = Math.max(0, 100 - editableSum);
  const totalPct = editableSum + othRemainder;
  const sumOk = Math.abs(totalPct - 100) < 0.15;

  const handleStart = () => {
    const swings: Record<AuPartyId, number> = { ALP:0,LIB:0,NAT:0,LNP:0,CLP:0,GRN:0,KAP:0,CA:0,ONP:0,IND:0,OTH:0 };
    for (const { id } of SIM_EDITABLE_PARTIES) {
      const target = parseFloat(shares[id]) || 0;
      // Swings are relative to 2026 polling baseline (not 2025)
      swings[id] = (target - POLLING_SHARES_2026[id]) / 100;
    }
    swings['OTH'] = (othRemainder - POLLING_SHARES_2026['OTH']) / 100;
    onStart(swings, duration);
  };

  return (
    <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-default shrink-0">
        <h2 className="text-[15px] font-semibold text-ink">Simulation</h2>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-hover text-ink-3 hover:text-ink text-lg">×</button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll px-4 py-3 space-y-4">
        {/* Duration */}
        <section>
          <p className="eyebrow mb-2">Duration</p>
          <div className="flex gap-1.5 flex-wrap">
            {SIM_DURATIONS.map(d => (
              <button key={d.ms} onClick={() => setDuration(d.ms)} disabled={running}
                className={`${btnBase} ${duration === d.ms
                  ? 'bg-gold text-white hover:bg-gold-deep'
                  : 'border border-default text-ink-3 hover:bg-hover hover:text-ink'} disabled:opacity-40 disabled:cursor-not-allowed`}>
                {d.label}
              </button>
            ))}
          </div>
        </section>

        {/* Vote shares */}
        <section>
          <p className="eyebrow mb-2">National vote share (%)</p>
          <div className="space-y-1.5">
            {SIM_EDITABLE_PARTIES.map(({ id, note }) => {
              const color = AU_PARTY_MAP[id]?.color ?? '#888';
              return (
                <div key={id} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[10px] font-mono text-ink-2 w-8 shrink-0">{id}</span>
                  <input type="number" step={0.1} min={0} max={100}
                    value={shares[id]} disabled={running}
                    onChange={e => setShares(prev => ({ ...prev, [id]: e.target.value }))}
                    className="flex-1 h-6 text-[11px] font-mono rounded-[4px] border border-default bg-white text-ink px-2 text-center focus:outline-none focus:border-strong disabled:opacity-40" />
                  <span className="text-[8px] font-mono text-ink-3 w-12 shrink-0 text-right">{note ?? ''}</span>
                </div>
              );
            })}
            {/* OTH — auto remainder */}
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: AU_PARTY_MAP['OTH']?.color ?? '#888' }} />
              <span className="text-[10px] font-mono text-ink-2 w-8 shrink-0">OTH</span>
              <div className="flex-1 h-6 flex items-center justify-center text-[11px] font-mono rounded-[4px] border border-default bg-hover text-ink-3 px-2">
                {othRemainder.toFixed(1)}
              </div>
              <span className="text-[8px] font-mono text-ink-3 w-12 shrink-0 text-right">auto</span>
            </div>
          </div>
          <div className={`mt-2 text-center text-[9px] font-mono font-semibold ${sumOk ? 'text-emerald-500' : 'text-amber-500'}`}>
            Total: {totalPct.toFixed(1)}% {sumOk ? '✓' : '— adjust to reach 100%'}
          </div>
        </section>

        {/* Progress */}
        {running && (
          <section>
            <p className="eyebrow mb-2">Progress — {declared}/150 declared</p>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--bar-track)' }}>
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="flex justify-between mt-1 text-[9px] font-mono text-ink-3">
              <span>{Math.round(progress * 100)}% declared</span>
              <span>{150 - declared} remaining</span>
            </div>
          </section>
        )}

        {/* Notes */}
        <section>
          <p className="eyebrow mb-2">How it works</p>
          <div className="text-[9px] font-mono text-ink-3 leading-relaxed space-y-1">
            <p>Shares applied relative to 2025 baseline + electorate noise (~1.4% σ).</p>
            <p>LNP/KAP/CA capped to electorates where they ran in 2025.</p>
            <p>Eastern states (NSW/VIC/TAS/ACT) declare first. WA last (+50%).</p>
            <p>Preferential (IRV) voting determines winners. Coalition = LIB+NAT+LNP.</p>
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-default flex gap-2 shrink-0">
        {!running ? (
          <button onClick={handleStart}
            className="flex-1 h-8 text-[11px] font-mono font-semibold rounded-[4px] bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
            <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor" aria-hidden="true">
              <path d="M1 1.2L6 4L1 6.8V1.2Z" strokeLinejoin="round"/>
            </svg>
            Run Simulation
          </button>
        ) : (
          <button onClick={onStop}
            className="flex-1 h-8 text-[11px] font-mono font-semibold rounded-[4px] bg-[#B91C1C] text-white hover:bg-red-800 transition-colors">
            Stop
          </button>
        )}
      </div>
    </aside>
  );
}

// ── National swing panel ────────────────────────────────────────────────────────
function AuSwingPanel({
  exiting, currentResults, onResultsChange, activePreset, onReset, onClose,
}: {
  exiting: boolean;
  currentResults: Record<string, Partial<Record<AuPartyId, number>>>;
  onResultsChange: (id: string, r: Partial<Record<AuPartyId, number>>) => void;
  activePreset: PresetId | null;
  onReset: () => void;
  onClose: () => void;
}) {
  const [inputs, setInputs] = useState<Record<AuPartyId, string>>({
    ALP: '', LIB: '', NAT: '', LNP: '', CLP: '', GRN: '', KAP: '', CA: '', ONP: '', IND: '', OTH: '',
  });

  const disabled = !activePreset || activePreset === 'blank';

  const applySwing = useCallback((pid: AuPartyId) => {
    const raw = inputs[pid] ?? '';
    const swingPp = parseFloat(raw);
    if (isNaN(swingPp)) return;
    const swing = swingPp / 100;
    for (const e of AU_ELECTORATES) {
      const res = currentResults[e.id] ?? e.results2025;
      if (!res) continue;
      const total = e.validVotes;
      const curVotes = res[pid] ?? 0;
      const curPct = total > 0 ? curVotes / total : 0;
      const newPct = Math.max(0, curPct + swing);
      const delta = newPct - curPct;
      const otherPids = Object.keys(res).filter(p => p !== pid && (res[p as AuPartyId] ?? 0) > 0) as AuPartyId[];
      const otherTotal = otherPids.reduce((s, p) => s + (res[p] ?? 0), 0);
      const newRes: Partial<Record<AuPartyId, number>> = { ...res };
      newRes[pid] = Math.round(newPct * total);
      if (otherTotal > 0 && Math.abs(delta) > 1e-9) {
        const adjustment = -delta * total;
        for (const p of otherPids) {
          const share = (res[p] ?? 0) / otherTotal;
          newRes[p] = Math.max(0, Math.round((res[p] ?? 0) + adjustment * share));
        }
      }
      onResultsChange(e.id, newRes);
    }
    setInputs(prev => ({ ...prev, [pid]: '' }));
  }, [inputs, currentResults, onResultsChange]);

  const swingParties: AuPartyId[] = ['ALP', 'LIB', 'NAT', 'LNP', 'GRN', 'ONP', 'IND', 'OTH'];

  return (
    <aside className={`w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-default shrink-0">
        <h2 className="text-[15px] font-semibold text-ink">National Swing</h2>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-hover text-ink-3 hover:text-ink text-lg">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-4 py-3 space-y-4">
        <section>
          <p className="eyebrow mb-3">Apply swing (±pp) to all 150 electorates</p>
          <div className="space-y-2">
            {swingParties.map(pid => {
              const color = AU_PARTY_MAP[pid]?.color ?? '#888';
              const raw = inputs[pid] ?? '';
              const valid = !isNaN(parseFloat(raw)) && parseFloat(raw) !== 0;
              return (
                <div key={pid} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[10px] font-mono text-ink-2 w-8 shrink-0">{pid}</span>
                  <input type="number" value={raw} placeholder="±pp" disabled={disabled}
                    onChange={e => setInputs(prev => ({ ...prev, [pid]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && applySwing(pid)}
                    className="flex-1 h-6 text-[11px] font-mono rounded-[4px] border border-default bg-white text-ink px-2 text-center focus:outline-none focus:border-strong disabled:opacity-40" />
                  <button onClick={() => applySwing(pid)} disabled={disabled || !valid}
                    className="h-6 px-2 text-[10px] font-mono font-semibold rounded-[4px] border border-default text-ink-2 hover:bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                    Apply
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        <section>
          <p className="eyebrow mb-2">Notes</p>
          <div className="text-[9px] font-mono text-ink-3 leading-relaxed space-y-1">
            <p>Applies uniformly across all 150 electorates.</p>
            <p>IRV winners re-computed after each swing. Coalition = LIB + NAT + LNP.</p>
          </div>
        </section>
        <section className="pt-2 border-t border-default">
          <button onClick={onReset} disabled={disabled}
            className="w-full h-7 text-[11px] font-mono font-medium rounded-[4px] border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors uppercase tracking-wide">
            Reset to 2025 baseline
          </button>
        </section>
      </div>
    </aside>
  );
}

// ── Breakdown drawer ────────────────────────────────────────────────────────────
type ElecResult = {
  id: string; name: string; state: string; validVotes: number;
  winner: AuPartyId; runnerUp: AuPartyId | null; winnerPct: number; marginPct: number;
};

function computeElecResults(
  currentResults: Record<string, Partial<Record<AuPartyId, number>>>,
  activePreset: PresetId | null,
): ElecResult[] {
  if (!activePreset) return [];
  const electorates = activePreset === 'blank'
    ? AU_ELECTORATES.filter(e => !!currentResults[e.id] && Object.values(currentResults[e.id]).some(v => (v ?? 0) > 0))
    : AU_ELECTORATES;
  return electorates.map(e => {
    const results = currentResults[e.id] ?? (activePreset !== 'blank' ? e.results2025 : {});
    const sorted = (Object.entries(results) as [AuPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
    const winner = determineWinner(results, e.validVotes);
    const winnerVotes = results[winner] ?? sorted[0]?.[1] ?? 0;
    const runnerUpEntry = sorted.find(([p]) => p !== winner);
    const runnerUp = runnerUpEntry?.[0] ?? null;
    const runnerUpVotes = runnerUpEntry?.[1] ?? 0;
    const winnerPct = e.validVotes > 0 ? (winnerVotes / e.validVotes) * 100 : 0;
    const marginPct = winnerPct - (e.validVotes > 0 ? (runnerUpVotes / e.validVotes) * 100 : 0);
    return { id: e.id, name: e.name, state: e.state, validVotes: e.validVotes, winner, runnerUp, winnerPct, marginPct };
  });
}

function computeStateBreakdown(results: ElecResult[]) {
  const map = new Map<string, Record<string, number>>();
  for (const r of results) {
    const s = map.get(r.state) ?? {};
    s[r.winner] = (s[r.winner] ?? 0) + 1;
    map.set(r.state, s);
  }
  return Array.from(map.entries())
    .map(([state, seats]) => ({ state, seats, total: Object.values(seats).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total);
}

function computeDistortion(
  currentResults: Record<string, Partial<Record<AuPartyId, number>>>,
  activePreset: PresetId | null,
) {
  if (!activePreset) return [];
  const electorates = activePreset === 'blank'
    ? AU_ELECTORATES.filter(e => !!currentResults[e.id] && Object.values(currentResults[e.id]).some(v => (v ?? 0) > 0))
    : AU_ELECTORATES;
  const seats: Record<string, number> = {};
  const votes: Record<string, number> = {};
  let totalVotes = 0;
  for (const e of electorates) {
    const results = currentResults[e.id] ?? (activePreset !== 'blank' ? e.results2025 : {});
    const winner = determineWinner(results, e.validVotes);
    seats[winner] = (seats[winner] ?? 0) + 1;
    for (const [p, v] of Object.entries(results)) {
      votes[p] = (votes[p] ?? 0) + (v ?? 0);
      totalVotes += v ?? 0;
    }
  }
  return Array.from(new Set([...Object.keys(seats), ...Object.keys(votes)]))
    .map(p => ({
      party: p,
      seats: seats[p] ?? 0,
      seatShare: ((seats[p] ?? 0) / AU_TOTAL) * 100,
      voteShare: totalVotes > 0 ? ((votes[p] ?? 0) / totalVotes) * 100 : 0,
    }))
    .filter(r => r.seats > 0 || r.voteShare > 0.5)
    .sort((a, b) => b.seats - a.seats);
}

function AuPartyDot({ partyId }: { partyId: string }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
    style={{ background: AU_PARTY_MAP[partyId as AuPartyId]?.color ?? '#888' }} />;
}

const STATE_NAMES: Record<string, string> = {
  ACT: 'A.C.T.', NSW: 'New South Wales', NT: 'North. Territory',
  QLD: 'Queensland', SA: 'South Australia', TAS: 'Tasmania',
  VIC: 'Victoria', WA: 'Western Australia',
};

function AuStateTab({ data }: { data: ReturnType<typeof computeStateBreakdown> }) {
  return (
    <div className="p-4 space-y-4">
      {data.map(r => (
        <div key={r.state}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[12px] font-semibold text-ink">{STATE_NAMES[r.state] ?? r.state}</span>
            <span className="text-[10px] text-ink-3 font-mono">{r.total} seats</span>
          </div>
          <div className="flex h-2.5 rounded overflow-hidden mb-1.5">
            {Object.entries(r.seats).sort(([, a], [, b]) => (b as number) - (a as number)).map(([p, n]) => (
              <div key={p} className="h-full" title={`${p}: ${n}`}
                style={{ width: `${((n as number) / r.total) * 100}%`, background: AU_PARTY_MAP[p as AuPartyId]?.color ?? '#888' }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
            {Object.entries(r.seats).sort(([, a], [, b]) => (b as number) - (a as number)).map(([p, n]) => (
              <span key={p} className="flex items-center gap-1 text-[9px] text-ink-3">
                <AuPartyDot partyId={p} /><span className="font-mono">{n as number}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AuClosestTab({ data }: { data: ElecResult[] }) {
  return (
    <div className="divide-y divide-default">
      {data.map((c, i) => (
        <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
          <span className="text-[10px] text-ink-3 w-4 shrink-0 font-mono">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <AuPartyDot partyId={c.winner} />
              {c.runnerUp && <AuPartyDot partyId={c.runnerUp} />}
              <span className="text-[11px] text-ink truncate">{c.name}</span>
            </div>
            <span className="text-[9px] text-ink-3">{c.state}</span>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] font-mono text-ink">{c.winnerPct.toFixed(1)}%</div>
            <div className="text-[9px] font-mono text-gold">+{c.marginPct.toFixed(1)}pp</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AuDistortionTab({ data }: { data: ReturnType<typeof computeDistortion> }) {
  const maxShare = Math.max(...data.flatMap(r => [r.voteShare, r.seatShare]), 1);
  return (
    <div className="p-4 space-y-4">
      <p className="eyebrow mb-3">Vote share vs seat share</p>
      {data.map(r => (
        <div key={r.party}>
          <div className="flex items-center gap-2 mb-1.5">
            <AuPartyDot partyId={r.party} />
            <span className="text-[11px] text-ink flex-1">{AU_PARTY_MAP[r.party as AuPartyId]?.name ?? r.party}</span>
            <span className="text-[10px] text-ink-3 font-mono">{r.seats} seats</span>
          </div>
          {[{ label: 'Votes', share: r.voteShare, opacity: 0.6 }, { label: 'Seats', share: r.seatShare, opacity: 1 }].map(row => (
            <div key={row.label} className="flex items-center gap-2 mb-1">
              <span className="text-[9px] text-ink-3 w-9 text-right shrink-0">{row.label}</span>
              <div className="flex-1 h-2 rounded overflow-hidden" style={{ background: 'var(--bar-track)' }}>
                <div className="h-full rounded"
                  style={{ width: `${(row.share / maxShare) * 100}%`, background: AU_PARTY_MAP[r.party as AuPartyId]?.color ?? '#888', opacity: row.opacity }} />
              </div>
              <span className="text-[9px] font-mono text-ink-3 w-9">{row.share.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function computeNationalStats(
  currentResults: Record<string, Partial<Record<AuPartyId, number>>>,
  activePreset: PresetId | null,
) {
  if (!activePreset) return null;
  const isBlank = activePreset === 'blank';
  const seats: Record<string, number> = {};
  const votes: Record<string, number> = {};
  let totalVotes = 0;
  let alpTPPW = 0, coalTPPW = 0, tppTotal = 0;
  // Alt 2CP: ALP vs ONP (seats where ONP leads the whole coalition)
  let alpVsOnpW = 0, onpVsAlpW = 0, onpDomSeats = 0;
  for (const e of AU_ELECTORATES) {
    // Blank mode: only count declared seats; other presets fall back to 2025
    const results = isBlank ? currentResults[e.id] : (currentResults[e.id] ?? e.results2025);
    if (!results) continue;
    const r = results as Record<AuPartyId, number>;
    const winner = determineWinner(results, e.validVotes);
    seats[winner] = (seats[winner] ?? 0) + 1;
    for (const [p, v] of Object.entries(results)) {
      votes[p] = (votes[p] ?? 0) + (v ?? 0);
      totalVotes += v ?? 0;
    }
    const { alp, coal } = computeTPP(results, e.validVotes);
    alpTPPW += alp * e.validVotes;
    coalTPPW += coal * e.validVotes;
    tppTotal += e.validVotes;
    // ALP vs ONP 2CP: count seats where ONP > total coalition
    const onp = r.ONP ?? 0, coalVotes = (r.LIB ?? 0) + (r.NAT ?? 0) + (r.LNP ?? 0);
    if (onp > coalVotes && onp > 0) {
      onpDomSeats++;
      const alpV = r.ALP ?? 0, grn = r.GRN ?? 0, kap = r.KAP ?? 0, oth = r.OTH ?? 0, ind = r.IND ?? 0, ca = r.CA ?? 0;
      // Spectrum-aligned: GRN/CA/IND give 90-95% to ALP, not ONP
      alpVsOnpW += alpV + grn*0.95 + coalVotes*0.22 + kap*0.35 + oth*0.55 + ind*0.80 + ca*0.90;
      onpVsAlpW += onp  + coalVotes*0.78 + grn*0.05 + kap*0.65 + oth*0.45 + ind*0.20 + ca*0.10;
    }
  }
  if (tppTotal === 0) return null; // no data declared yet (blank mode with no results)
  // For blank mode, skip swing vs 2025 (partial night data)
  const baseVotes: Record<string, number> = {};
  let baseTotalVotes = 0;
  if (!isBlank) {
    for (const e of AU_ELECTORATES) {
      for (const [p, v] of Object.entries(e.results2025)) {
        baseVotes[p] = (baseVotes[p] ?? 0) + (v ?? 0);
        baseTotalVotes += v ?? 0;
      }
    }
  }
  const parties = Array.from(new Set([...Object.keys(seats), ...Object.keys(votes)]))
    .filter(p => (seats[p] ?? 0) > 0 || (totalVotes > 0 && (votes[p] ?? 0) / totalVotes > 0.005))
    .map(p => ({
      party: p,
      seats: seats[p] ?? 0,
      votes: votes[p] ?? 0,
      voteShare: totalVotes > 0 ? (votes[p] ?? 0) / totalVotes : 0,
      swing: !isBlank && totalVotes > 0 && baseTotalVotes > 0
        ? ((votes[p] ?? 0) / totalVotes) - ((baseVotes[p] ?? 0) / baseTotalVotes)
        : 0,
    }))
    .sort((a, b) => b.votes - a.votes);
  const onpCpTotal = alpVsOnpW + onpVsAlpW;
  const declaredSeats = Object.values(seats).reduce((a, b) => a + b, 0);
  return {
    parties,
    tpp: { alp: alpTPPW / tppTotal, coal: coalTPPW / tppTotal },
    onpCp: onpDomSeats > 0 && onpCpTotal > 0
      ? { alp: alpVsOnpW / onpCpTotal, onp: onpVsAlpW / onpCpTotal, seats: onpDomSeats }
      : null,
    totalVotes,
    alpSeats: seats['ALP'] ?? 0,
    coalSeats: (seats['LIB'] ?? 0) + (seats['NAT'] ?? 0) + (seats['LNP'] ?? 0),
    onpSeats: seats['ONP'] ?? 0,
    declaredSeats,
    isPartial: isBlank,
  };
}

function AuNationalTab({ data }: { data: NonNullable<ReturnType<typeof computeNationalStats>> }) {
  const alpColor = AU_PARTY_MAP['ALP'].color;
  const coalColor = AU_PARTY_MAP['LIB'].color;
  const maxVoteShare = Math.max(...data.parties.map(p => p.voteShare), 0.01);

  const onpColor = AU_PARTY_MAP['ONP'].color;

  return (
    <div className="p-4 space-y-5">
      {/* Traditional 2PP: ALP vs Coalition */}
      <div>
        <p className="eyebrow mb-1.5">Traditional 2PP — ALP vs Coalition</p>
        <div className="flex h-4 rounded overflow-hidden mb-1.5">
          <div style={{ width: `${data.tpp.alp * 100}%`, background: alpColor, transition: 'width 0.4s ease' }} />
          <div style={{ flex: 1, background: coalColor, transition: 'width 0.4s ease' }} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AuPartyDot partyId="ALP" />
            <span className="text-[11px] font-mono font-bold" style={{ color: alpColor }}>{(data.tpp.alp * 100).toFixed(1)}%</span>
            <span className="text-[8.5px] text-ink-3">ALP</span>
          </div>
          <span className="text-[8px] font-mono text-ink-3">govt formation</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[8.5px] text-ink-3">Coal</span>
            <span className="text-[11px] font-mono font-bold" style={{ color: coalColor }}>{(data.tpp.coal * 100).toFixed(1)}%</span>
            <AuPartyDot partyId="LIB" />
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[8.5px] font-mono text-ink-3">
          <span>ALP {data.alpSeats} seats</span>
          <span>{AU_MAJORITY} for majority</span>
          <span>Coal {data.coalSeats} seats</span>
        </div>
      </div>

      {/* Alternative 2CP: ALP vs ONP (shown when ONP is surging) */}
      {data.onpCp && (
        <div>
          <p className="eyebrow mb-1.5">Alt. 2CP — ALP vs One Nation</p>
          <div className="flex h-4 rounded overflow-hidden mb-1.5">
            <div style={{ width: `${data.onpCp.alp * 100}%`, background: alpColor, transition: 'width 0.4s ease' }} />
            <div style={{ flex: 1, background: onpColor, transition: 'width 0.4s ease' }} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <AuPartyDot partyId="ALP" />
              <span className="text-[11px] font-mono font-bold" style={{ color: alpColor }}>{(data.onpCp.alp * 100).toFixed(1)}%</span>
              <span className="text-[8.5px] text-ink-3">ALP</span>
            </div>
            <span className="text-[8px] font-mono text-ink-3">{data.onpCp.seats} seats</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[8.5px] text-ink-3">ONP</span>
              <span className="text-[11px] font-mono font-bold" style={{ color: onpColor }}>{(data.onpCp.onp * 100).toFixed(1)}%</span>
              <AuPartyDot partyId="ONP" />
            </div>
          </div>
          <p className="text-[8px] font-mono text-ink-3 mt-1 text-center">
            seats where One Nation leads the coalition in first prefs
          </p>
        </div>
      )}

      {/* First preference vote shares */}
      <div>
        <p className="eyebrow mb-2">First Preference Vote Share</p>
        <div className="space-y-2.5">
          {data.parties.map(p => {
            const color = AU_PARTY_MAP[p.party as AuPartyId]?.color ?? '#888';
            const name = AU_PARTY_MAP[p.party as AuPartyId]?.name ?? p.party;
            const swingDir = p.swing >= 0.0005 ? '+' : p.swing <= -0.0005 ? '−' : '±';
            const swingAbs = Math.abs(p.swing * 100).toFixed(1);
            const swingColor = p.swing > 0.0005 ? '#2da44e' : p.swing < -0.0005 ? '#cf222e' : 'var(--ink-3)';
            return (
              <div key={p.party}>
                <div className="flex items-center gap-1.5 mb-1">
                  <AuPartyDot partyId={p.party} />
                  <span className="text-[10px] text-ink flex-1">{name}</span>
                  <span className="text-[9px] font-mono" style={{ color: swingColor }}>
                    {swingDir}{swingAbs}pp
                  </span>
                  <span className="text-[10px] font-mono font-semibold text-ink w-10 text-right">
                    {(p.voteShare * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded overflow-hidden" style={{ background: 'var(--bar-track)' }}>
                    <div className="h-full rounded transition-all duration-300"
                      style={{ width: `${(p.voteShare / maxVoteShare) * 100}%`, background: color }} />
                  </div>
                  <span className="text-[9px] font-mono text-ink-3 w-16 text-right shrink-0">
                    {p.votes.toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-[8.5px] font-mono text-ink-3 text-center pt-1 border-t border-default">
        {data.totalVotes.toLocaleString()} total valid votes · swing vs 2025
      </div>
    </div>
  );
}

function AuBreakdownDrawer({
  currentResults, activePreset, exiting, onClose,
}: {
  currentResults: Record<string, Partial<Record<AuPartyId, number>>>;
  activePreset: PresetId | null;
  exiting: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'national' | 'state' | 'closest' | 'distortion'>('national');
  const hasData = !!activePreset && (activePreset !== 'blank' || Object.keys(currentResults).length > 0);
  const elecResults   = useMemo(() => computeElecResults(currentResults, activePreset), [currentResults, activePreset]);
  const stateData     = useMemo(() => computeStateBreakdown(elecResults), [elecResults]);
  const closestSeats  = useMemo(() => [...elecResults].sort((a, b) => a.marginPct - b.marginPct).slice(0, 20), [elecResults]);
  const distortion    = useMemo(() => computeDistortion(currentResults, activePreset), [currentResults, activePreset]);
  const nationalStats = useMemo(() => computeNationalStats(currentResults, activePreset), [currentResults, activePreset]);

  return (
    <aside className={`w-80 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-default shrink-0">
        <h2 className="text-[15px] font-semibold text-ink">Race Breakdown</h2>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-hover text-ink-3 hover:text-ink text-lg">×</button>
      </div>
      <div className="flex border-b border-default shrink-0">
        {([['national', 'National'], ['state', 'By State'], ['closest', 'Closest'], ['distortion', 'Distortion']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 text-[9px] py-2.5 font-medium transition-colors whitespace-nowrap ${tab === id ? 'text-gold border-b-2 border-gold' : 'text-ink-3 hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>
      {!hasData ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <p className="text-[12px] text-ink-3 italic">Load a preset to see breakdown</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto thin-scroll">
          {tab === 'national'   && nationalStats && <AuNationalTab data={nationalStats} />}
          {tab === 'state'      && <AuStateTab      data={stateData}    />}
          {tab === 'closest'    && <AuClosestTab    data={closestSeats} />}
          {tab === 'distortion' && <AuDistortionTab data={distortion}   />}
        </div>
      )}
    </aside>
  );
}

// ── Parliament panel (hemicycle) ────────────────────────────────────────────────
function AuParliamentPanel({
  tally, exiting, onClose,
}: {
  tally: Record<string, number>;
  exiting: boolean;
  onClose: () => void;
}) {
  const dots = useMemo(() => {
    const seats: AuPartyId[] = [];
    for (const pid of AU_POLITICAL_ORDER) {
      const n = tally[pid] ?? 0;
      for (let i = 0; i < n; i++) seats.push(pid);
    }
    const unaccounted = AU_TOTAL - seats.length;
    for (let i = 0; i < Math.max(0, unaccounted); i++) seats.push('OTH');
    return seats.slice(0, AU_TOTAL);
  }, [tally]);

  const coalitionSeats = (tally['LIB'] ?? 0) + (tally['NAT'] ?? 0) + (tally['LNP'] ?? 0) + (tally['CLP'] ?? 0);
  const alpSeats = tally['ALP'] ?? 0;

  return (
    <aside className={`w-[380px] shrink-0 bg-white border-r border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit-left' : 'panel-slide-left'}`}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-default shrink-0">
        <h2 className="text-[15px] font-semibold text-ink">House of Representatives</h2>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-hover text-ink-3 hover:text-ink text-lg">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-2 py-2">
        <svg width="380" height="200" viewBox={`0 0 ${AU_HEMI_CX * 2 + 10} 210`} aria-label="Hemicycle">
          {dots.map((pid, i) => {
            const pos = AU_HEMI_POSITIONS[i];
            if (!pos) return null;
            const color = AU_PARTY_MAP[pid]?.color ?? '#888';
            return <circle key={i} cx={pos.x} cy={pos.y} r={AU_HEMI_DOT_R} fill={color} opacity={0.92} />;
          })}
          <line x1={AU_HEMI_CX} y1={AU_HEMI_CY - AU_HEMI_RADII[0] + 5} x2={AU_HEMI_CX} y2={AU_HEMI_CY}
            stroke="rgba(0,0,0,0.10)" strokeWidth="1" strokeDasharray="2 2" />
          <text x={AU_HEMI_CX} y={AU_HEMI_CY + 14} textAnchor="middle"
            style={{ fontSize: 9, fontFamily: '"JetBrains Mono",monospace', fill: '#7a7870' }}>
            {AU_MAJORITY} for majority
          </text>
        </svg>

        <div className="px-4 space-y-1.5 pb-4">
          <div className="flex items-center justify-between py-1 border-b border-default">
            <span className="text-[11px] font-semibold text-ink">ALP</span>
            <span className="text-[13px] font-mono font-bold" style={{ color: AU_PARTY_MAP['ALP'].color }}>{alpSeats}</span>
          </div>
          <div className="flex items-center justify-between py-1 border-b border-default">
            <span className="text-[11px] font-semibold text-ink">Coalition (LIB+NAT+LNP)</span>
            <span className="text-[13px] font-mono font-bold" style={{ color: AU_PARTY_MAP['LIB'].color }}>{coalitionSeats}</span>
          </div>
          {AU_POLITICAL_ORDER.filter(pid => !COALITION_IDS.includes(pid) && pid !== 'ALP' && (tally[pid] ?? 0) > 0).map(pid => (
            <div key={pid} className="flex items-center justify-between py-1">
              <span className="text-[11px] text-ink-2">{AU_PARTY_MAP[pid]?.name ?? pid}</span>
              <span className="text-[11px] font-mono font-semibold" style={{ color: AU_PARTY_MAP[pid]?.color }}>
                {tally[pid] ?? 0}
              </span>
            </div>
          ))}
          <div className="mt-2 pt-2 border-t border-default text-[9px] font-mono text-ink-3 text-center">
            {AU_MAJORITY} seats needed for majority · {AU_TOTAL} total
          </div>
        </div>
      </div>
    </aside>
  );
}

// ── Party manager panel ─────────────────────────────────────────────────────────
function AuPartyManagerPanel({
  exiting, onClose,
}: {
  exiting: boolean;
  onClose: () => void;
}) {
  return (
    <aside className={`w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-default shrink-0">
        <h2 className="text-[15px] font-semibold text-ink">Parties</h2>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-hover text-ink-3 hover:text-ink text-lg">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-4 py-3">
        <p className="eyebrow mb-3">Australian parties</p>
        <div className="space-y-2">
          {AU_PARTIES.map(p => (
            <div key={p.id} className="flex items-center gap-3 py-1.5 border-b border-default last:border-0">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: p.color }} />
              <span className="text-[10px] font-mono font-bold text-ink-2 w-8 shrink-0">{p.id}</span>
              <span className="text-[11px] text-ink flex-1 truncate">{p.name}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 p-3 rounded-[6px] bg-[#f8f7f4] border border-default">
          <p className="text-[9px] font-mono text-ink-3 leading-relaxed">
            Australia uses preferential (IRV) voting. Winners are determined by first-preference votes plus preference flows.<br /><br />
            Coalition = LIB + NAT + LNP combined. 76 seats needed for majority.
          </p>
        </div>
      </div>
    </aside>
  );
}

// ── Multi-select float ──────────────────────────────────────────────────────────
function AuMultiSelectFloat({ count, onClear }: { count: number; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[900] flex items-center gap-2 px-3 py-1.5 rounded-full bg-ink/90 text-white text-[11px] font-mono shadow-lg pointer-events-auto">
      <span className="font-semibold">{count} selected</span>
      <button onClick={onClear} className="text-white/60 hover:text-white ml-1 text-base leading-none">×</button>
    </div>
  );
}

// ── Multi-select panel ──────────────────────────────────────────────────────────
function AuMultiSelectPanel({
  selectedIds, currentResults, onResultsChange, onClose,
}: {
  selectedIds: Set<string>;
  currentResults: Record<string, Partial<Record<AuPartyId, number>>>;
  onResultsChange: (id: string, r: Partial<Record<AuPartyId, number>>) => void;
  onClose: () => void;
}) {
  const [inputs, setInputs] = useState<Partial<Record<AuPartyId, string>>>({});
  const btnBase = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';

  const applySwing = (pid: AuPartyId) => {
    const raw = inputs[pid] ?? '';
    const swingPp = parseFloat(raw);
    if (isNaN(swingPp)) return;
    const swing = swingPp / 100;
    for (const elecId of selectedIds) {
      const e = AU_ELECTORATES.find(x => x.id === elecId);
      if (!e) continue;
      const res = currentResults[elecId] ?? e.results2025;
      const total = e.validVotes;
      const curPct = (res[pid] ?? 0) / total;
      const newPct = Math.max(0, curPct + swing);
      const delta = newPct - curPct;
      const otherPids = Object.keys(res).filter(p => p !== pid && (res[p as AuPartyId] ?? 0) > 0) as AuPartyId[];
      const otherTotal = otherPids.reduce((s, p) => s + (res[p] ?? 0), 0);
      const newRes: Partial<Record<AuPartyId, number>> = { ...res, [pid]: Math.round(newPct * total) };
      if (otherTotal > 0 && Math.abs(delta) > 1e-9) {
        const adj = -delta * total;
        for (const p of otherPids) newRes[p] = Math.max(0, Math.round((res[p] ?? 0) + adj * ((res[p] ?? 0) / otherTotal)));
      }
      onResultsChange(elecId, newRes);
    }
    setInputs(prev => ({ ...prev, [pid]: '' }));
  };

  return (
    <aside className="w-72 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden panel-slide">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-default shrink-0">
        <h2 className="text-[15px] font-semibold text-ink">{selectedIds.size} Selected</h2>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-hover text-ink-3 hover:text-ink text-lg">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-4 py-3 space-y-3">
        <p className="eyebrow mb-2">Apply swing to selection (±pp)</p>
        {(['ALP', 'LIB', 'NAT', 'LNP', 'GRN', 'ONP', 'IND'] as AuPartyId[]).map(pid => {
          const color = AU_PARTY_MAP[pid]?.color ?? '#888';
          const raw = inputs[pid] ?? '';
          const valid = !isNaN(parseFloat(raw)) && parseFloat(raw) !== 0;
          return (
            <div key={pid} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
              <span className="text-[10px] font-mono text-ink-2 w-8 shrink-0">{pid}</span>
              <input type="number" value={raw} placeholder="±pp"
                onChange={e => setInputs(prev => ({ ...prev, [pid]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && applySwing(pid)}
                className="flex-1 h-6 text-[11px] font-mono rounded-[4px] border border-default bg-white text-ink px-2 text-center focus:outline-none focus:border-strong" />
              <button onClick={() => applySwing(pid)} disabled={!valid}
                className={`${btnBase} border border-default text-ink-2 hover:bg-hover disabled:opacity-30 disabled:cursor-not-allowed`} style={{ height: 24, padding: '0 8px', fontSize: 10 }}>
                Apply
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ── Map tooltip ─────────────────────────────────────────────────────────────────
function MapTooltip({ tooltip, containerW, containerH, dark = false }: {
  tooltip: NonNullable<TooltipState>;
  containerW: number;
  containerH: number;
  dark?: boolean;
}) {
  const TW = 268;
  const hasFinalSection = !!(tooltip.officialRounds?.length || tooltip.irvRounds.length > 0 || tooltip.officialTCP);
  const TH_EST = 110 + tooltip.parties.length * 22 + (hasFinalSection ? 60 : 0);
  const left = tooltip.x + 18 + TW > containerW ? tooltip.x - TW - 10 : tooltip.x + 18;
  const top  = Math.max(6, Math.min(tooltip.y - 20, containerH - TH_EST - 8));
  const tt = {
    bg:      dark ? 'rgba(18,24,44,0.96)' : 'rgba(255,255,255,0.97)',
    border:  dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)',
    shadow:  dark ? '0 6px 28px rgba(0,0,0,0.5)' : '0 6px 28px rgba(0,0,0,0.12)',
    title:   dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)',
    sub:     dark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.42)',
    body:    dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.78)',
    muted:   dark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.40)',
    dim:     dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)',
    divider: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)',
  };

  return (
    <div className="absolute pointer-events-none z-[1000]" style={{ left, top, width: TW }}>
      <div style={{ background: tt.bg, borderRadius: 10, border: `1px solid ${tt.border}`, boxShadow: tt.shadow, backdropFilter: 'blur(10px)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px 8px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: tt.title, lineHeight: 1.2 }}>{tooltip.name}</div>
          <div style={{ fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: tt.sub, marginTop: 3 }}>
            {tooltip.state}
            {tooltip.winner && (
              <span style={{ color: AU_PARTY_MAP[tooltip.winner]?.color ?? '#888', marginLeft: 8, fontWeight: 700 }}>
                {AU_PARTY_MAP[tooltip.winner]?.shortName ?? tooltip.winner}
              </span>
            )}
          </div>
        </div>
        <div style={{ padding: '0 12px 8px' }}>
          {tooltip.parties.length > 0 ? (
            <>
              <div style={{ fontSize: 8, fontFamily: '"JetBrains Mono",monospace', color: tt.dim, textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 5 }}>
                First Preference
              </div>
              {tooltip.parties.map(({ id, votes, pct }, i) => {
                const color = AU_PARTY_MAP[id as AuPartyId]?.color ?? '#888888';
                const name  = AU_PARTY_MAP[id as AuPartyId]?.shortName ?? id;
                return (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: i < tooltip.parties.length - 1 ? 5 : 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: i === 0 ? 600 : 400, color: tt.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                    <span style={{ fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: tt.muted, marginRight: 5 }}>{votes.toLocaleString()}</span>
                    <span style={{ fontSize: 12, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color, minWidth: 40, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </>
          ) : (
            <p style={{ fontSize: 11, color: tt.dim, fontStyle: 'italic', margin: '4px 0' }}>No results — click a preset</p>
          )}
        </div>
        {/* Final preference — officialTCP is authoritative; fall back to last officialRound, then irvRounds */}
        {(tooltip.officialTCP || tooltip.officialRounds || tooltip.irvRounds.length > 0) ? (() => {
          let finalPairs: [AuPartyId, number][];
          let finalTotal: number;
          let isEstimate = false;
          if (tooltip.officialTCP) {
            finalPairs = (Object.entries(tooltip.officialTCP) as [AuPartyId, number][])
              .filter(([, v]) => (v ?? 0) > 0).sort(([, a], [, b]) => b - a).slice(0, 2);
            finalTotal = finalPairs.reduce((s, [, v]) => s + v, 0);
          } else if (tooltip.officialRounds) {
            const finalRound = tooltip.officialRounds[tooltip.officialRounds.length - 1];
            finalPairs = (Object.entries(finalRound.votes) as [AuPartyId, number][])
              .filter(([, v]) => (v ?? 0) > 0).sort(([, a], [, b]) => b - a).slice(0, 2);
            finalTotal = finalPairs.reduce((s, [, v]) => s + v, 0);
          } else {
            isEstimate = true;
            const finalRound = tooltip.irvRounds[tooltip.irvRounds.length - 1];
            finalTotal = Object.values(finalRound.votes).reduce((s, v) => s + (v ?? 0), 0);
            finalPairs = (Object.entries(finalRound.votes) as [AuPartyId, number][])
              .filter(([, v]) => (v ?? 0) > 0).sort(([, a], [, b]) => b - a).slice(0, 2);
          }
          if (finalPairs.length < 2 || finalTotal === 0) return null;
          return (
            <div style={{ borderTop: `1px solid ${tt.divider}`, padding: '7px 12px 9px' }}>
              <div style={{ fontSize: 8, fontFamily: '"JetBrains Mono",monospace', color: tt.dim, textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 5 }}>
                {isEstimate ? 'Final Preference (est.)' : 'Final Preference'}
              </div>
              {finalPairs.map(([pid, votes], i) => {
                const color = AU_PARTY_MAP[pid as AuPartyId]?.color ?? '#888';
                const name  = AU_PARTY_MAP[pid as AuPartyId]?.shortName ?? pid;
                const pct   = votes / finalTotal * 100;
                return (
                  <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: i < finalPairs.length - 1 ? 4 : 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: i === 0 ? 600 : 400, color: tt.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                    <span style={{ fontSize: 10, fontFamily: '"JetBrains Mono",monospace', color: tt.muted, marginRight: 5 }}>{votes.toLocaleString()}</span>
                    <span style={{ fontSize: 12, fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color, minWidth: 40, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          );
        })() : null}

        <div style={{ borderTop: `1px solid ${tt.divider}`, padding: '6px 14px' }}>
          <span style={{ fontSize: 9.5, fontFamily: '"JetBrains Mono",monospace', color: tt.dim }}>
            {tooltip.validVotes.toLocaleString()} votes cast
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Bubble overlay ──────────────────────────────────────────────────────────────
function BubbleLayer({
  geojson, currentResults, activePreset, byIdMap,
  containerRef, setTooltip, currentResultsRef, activePresetRef, modifiedIdsRef, onSelect,
}: {
  geojson: GeoJsonObject;
  currentResults: Record<string, Partial<Record<AuPartyId, number>>>;
  activePreset: PresetId | null;
  byIdMap: Map<string, typeof AU_ELECTORATES[number]>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setTooltip: (t: TooltipState) => void;
  currentResultsRef: React.MutableRefObject<Record<string, Partial<Record<AuPartyId, number>>>>;
  activePresetRef: React.MutableRefObject<PresetId | null>;
  modifiedIdsRef: React.MutableRefObject<Set<string>>;
  onSelect?: (id: string) => void;
}) {
  const map = useMap();
  const markersRef = useRef<L.CircleMarker[]>([]);

  useEffect(() => {
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    if (!activePreset) return;

    const gj = L.geoJSON(geojson as GeoJsonObject);
    gj.eachLayer((layer: L.Layer) => {
      const path = layer as L.Path & { feature?: Feature };
      const electDiv = (path.feature?.properties as Record<string, string> | undefined)?.elect_div ?? '';
      const data = byIdMap.get(electDiv);
      if (!data) return;
      const bounds = (layer as L.GeoJSON).getBounds?.();
      if (!bounds || !bounds.isValid()) return;
      const center = bounds.getCenter();
      // In blank mode only show dots where results have been entered
      const isBlank = activePreset === 'blank';
      const results = isBlank
        ? currentResults[electDiv]
        : (currentResults[electDiv] ?? data.results2025);
      if (!results) return;
      const sorted = (Object.entries(results) as [AuPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
      if (sorted.length < 1) return;
      const winner = determineWinner(results, data.validVotes);
      const winnerVotes = results[winner] ?? sorted[0][1];
      const runnerUpVotes = sorted.find(([p]) => p !== winner)?.[1] ?? 0;
      const margin = Math.max(0, ((winnerVotes - runnerUpVotes) / data.validVotes) * 100);
      const radius = 3 + Math.min(margin / 30, 1) * 10;
      const color = AU_PARTY_MAP[winner]?.color ?? '#888';
      const marker = L.circleMarker(center, {
        radius, color, fillColor: color, fillOpacity: 0.72, weight: 1, opacity: 0.9,
      }).addTo(map);

      marker.on('click', () => {
        setTooltip(null);
        onSelect?.(electDiv);
      });

      marker.on('mousemove', (e: L.LeafletMouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const preset = activePresetRef.current;
        const rawResults = preset === 'blank'
          ? (currentResultsRef.current[electDiv] ?? {})
          : (preset ? (currentResultsRef.current[electDiv] ?? data.results2025) : {});
        const totalReported = Object.values(rawResults).reduce((s, v) => s + (v ?? 0), 0);
        const parties = (Object.entries(rawResults) as [AuPartyId, number][])
          .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a)
          .map(([pid, votes]) => ({ id: pid, votes, pct: totalReported > 0 ? Math.round((votes / totalReported) * 1000) / 10 : 0 }));
        const isBaselineUnedited = preset === 'baseline' && !modifiedIdsRef.current.has(electDiv);
        const officialRounds = isBaselineUnedited ? (OFFICIAL_IRV_ROUNDS[data.name] as IrvRound[] | undefined) : undefined;
        const irvResult = !officialRounds && parties.length > 0 ? runIRV(rawResults as Partial<Record<AuPartyId, number>>, data.validVotes) : null;
        const tpp = totalReported > 0 ? computeTPP(rawResults as Partial<Record<AuPartyId, number>>, data.validVotes) : null;
        const officialTCP = isBaselineUnedited ? data.tcp2025 : undefined;
        setTooltip({
          x: e.originalEvent.clientX - rect.left,
          y: e.originalEvent.clientY - rect.top,
          name: data.name,
          state: data.state,
          validVotes: data.validVotes,
          parties,
          winner: officialRounds ? (officialRounds[officialRounds.length - 1].votes as Record<AuPartyId, number> | undefined) ? Object.entries(officialRounds[officialRounds.length - 1].votes).sort(([,a],[,b])=>b-a)[0]?.[0] as AuPartyId ?? null : null : irvResult?.winner ?? null,
          tpp,
          irvRounds: irvResult?.rounds ?? [],
          officialTCP,
          officialRounds,
        });
      });

      marker.on('mouseout', () => setTooltip(null));

      markersRef.current.push(marker);
    });
    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
    };
  }, [map, geojson, currentResults, activePreset, byIdMap]);

  return null;
}

// ── Tutorial panel ─────────────────────────────────────────────────────────────
function AuTutorialPanel({ onClose, exiting }: { onClose: () => void; exiting?: boolean }) {
  const H2 = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-5 mb-1.5 first:mt-0">{children}</div>
  );
  const P = ({ children }: { children: React.ReactNode }) => (
    <p className="text-[11px] text-ink leading-relaxed mb-2">{children}</p>
  );
  const Note = ({ children }: { children: React.ReactNode }) => (
    <div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{children}</div>
  );
  const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
    <div className="flex gap-2 mb-1.5">
      <span className="shrink-0 w-4 h-4 rounded-full bg-gold text-white text-[8px] font-bold flex items-center justify-center mt-0.5">{n}</span>
      <span className="text-[11px] text-ink leading-relaxed">{children}</span>
    </div>
  );
  const Tag = ({ children, color = 'bg-ink/8 text-ink' }: { children: React.ReactNode; color?: string }) => (
    <span className={`inline-block px-1.5 py-0.5 rounded-[3px] text-[9px] font-mono font-semibold ${color} mr-1`}>{children}</span>
  );

  return (
    <aside className={`w-80 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Australian Federal Election Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">

        {/* ── The system ── */}
        <H2>The Australian Electoral System</H2>
        <P>Australia's House of Representatives uses <strong>preferential voting</strong> (Instant Runoff Voting). Voters rank all candidates; if nobody wins an outright majority of first-preference votes, the lowest candidate is eliminated and their ballots flow to the next preference — repeating until one candidate holds a majority.</P>
        <P>There are <strong>151 seats</strong> in the House. A party or coalition needs <strong>76 seats</strong> for a majority government.</P>
        <Note>The <strong>Coalition</strong> (Liberal + National + LNP + CLP) always governs as a bloc. Their combined seat count is what matters for reaching 76.</Note>

        {/* ── Presets ── */}
        <H2>Map Presets</H2>
        <div className="space-y-2 mb-2">
          <div><Tag>2025 Baseline</Tag><span className="text-[10px] text-ink-2">The actual May 2025 federal election results — first-preference votes and official two-candidate preferred counts for all 151 electorates.</span></div>
          <div><Tag>2026 Polling</Tag><span className="text-[10px] text-ink-2">Current opinion polling applied as a uniform national swing across all electorates. A starting point for "what if" scenarios.</span></div>
          <div><Tag>Blank Map</Tag><span className="text-[10px] text-ink-2">All electorates empty — you fill in every result yourself, simulating an election night.</span></div>
        </div>

        {/* ── Clicking electorates ── */}
        <H2>Editing an Electorate</H2>
        <P>Click any shaded area on the map to open its panel on the right.</P>
        <Step n={1}>Drag a party's slider <em>or</em> click its percentage to type a value directly.</Step>
        <Step n={2}>Adjusting one party's share automatically redistributes the remainder among unlocked parties.</Step>
        <Step n={3}>Click the <strong>lock icon</strong> next to any party to pin its share — it won't move when others are adjusted.</Step>
        <Step n={4}>Hit <Tag>Reset to 2025</Tag> to restore the electorate's real 2025 result.</Step>
        <P>Changes take effect immediately on the map and scoreboard.</P>

        {/* ── Tooltip ── */}
        <H2>Reading the Hover Tooltip</H2>
        <P>Hovering an electorate shows two sections:</P>
        <div className="space-y-1.5 mb-2 text-[10px] text-ink-2 leading-relaxed">
          <div className="flex items-start gap-2"><span className="shrink-0 font-mono font-bold text-ink w-24">First Pref.</span><span>Each party's raw first-preference vote share. This is what voters put "1" against.</span></div>
          <div className="flex items-start gap-2"><span className="shrink-0 font-mono font-bold text-ink w-24">Final Pref.</span><span>The two-candidate preferred (2CP) result after all preference distributions — who actually won the seat.</span></div>
        </div>
        <Note>On the <Tag>2025 Baseline</Tag>, Final Preference comes from the Australian Electoral Commission's official distribution of preferences. On polling or edited maps it is estimated by the simulator's IRV engine.</Note>

        {/* ── Scoreboard ── */}
        <H2>Reading the Scoreboard</H2>
        <P>Party cards are ordered left-to-right by current seat count. Each card shows the party leader, seat total, and first-preference vote share and count.</P>
        <div className="space-y-1.5 mb-2 text-[10px] text-ink-2 leading-relaxed">
          <div className="flex items-start gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-gold mt-1" /><span><strong>Gold border</strong> — this party (or the Coalition bloc) is leading in seats.</span></div>
          <div className="flex items-start gap-2"><span className="shrink-0 w-2 h-2 rounded-full bg-emerald-500 mt-1" /><span><strong>Green shimmer</strong> — this entity has reached 76 seats (majority).</span></div>
        </div>
        <P>Click the <em>Results / Hide</em> chevron at the bottom of the scoreboard to collapse it for more map space.</P>

        {/* ── Blank map ── */}
        <H2>Blank Map Mode</H2>
        <Note>In Blank Map mode, nothing updates the map or scoreboard until you explicitly declare it — just like an election night where results come in seat by seat.</Note>
        <Step n={1}>Click an electorate on the map and enter results using the sliders.</Step>
        <Step n={2}>Click <Tag color="bg-emerald-600 text-white">Declare Seat</Tag> to lock in that result. The map colours and the scoreboard update only after declaring.</Step>
        <Step n={3}>Use <strong>Multi-select</strong> or <strong>Simulation</strong> to declare many seats at once.</Step>

        {/* ── Multi-select ── */}
        <H2>Multi-Select</H2>
        <P>Click <Tag>Multi-select</Tag> in the toolbar, then click multiple electorates on the map to select them. The swing editor applies a uniform shift (e.g. <em>ALP +3pp</em>) across all selected electorates simultaneously.</P>

        {/* ── Simulation ── */}
        <H2>Election Night Simulation</H2>
        <P>Click <Tag>▶ Simulation</Tag> to open the sim panel. Set a target swing for each party and pick a duration. The simulator then calls electorates one by one in a random order — watch the scoreboard fill up in real time.</P>
        <Note>During the simulation, clicking electorates on the map is disabled. The sim will pause or stop if you click <Tag>Stop</Tag>.</Note>

        {/* ── Swing panel ── */}
        <H2>National Swing Panel</H2>
        <P>Click <Tag>Swing</Tag> to apply a uniform percentage-point shift to every electorate at once. Great for quickly testing "ALP +5pp nationally" scenarios without editing each seat individually.</P>

        {/* ── Breakdown ── */}
        <H2>State Breakdown</H2>
        <P>Click <Tag>Breakdown</Tag> to open a per-state seat tally. It shows how many seats each party holds in NSW, VIC, QLD, WA, SA, TAS, ACT, and NT — useful for spotting geographic patterns.</P>

        {/* ── Parliament ── */}
        <H2>Parliament View</H2>
        <P>Click <Tag>Parliament</Tag> to open a hemicycle visualisation of the 151-seat House of Representatives. Seats are arranged left → right by ideology and coloured by party. The Coalition parties are grouped on the right.</P>

        {/* ── Bubble map ── */}
        <H2>Bubble Map</H2>
        <P>Toggle <Tag color="bg-emerald-600 text-white">Bubble Map</Tag> to overlay circles on the choropleth. Each circle is centred on its electorate and sized by the <strong>raw vote margin</strong> — a large bubble means a big win by many votes, not just a high percentage.</P>
        <P>Urban electorates with high enrolment show larger bubbles than sparse rural seats at the same percentage margin, revealing where votes are actually concentrated.</P>

        <div className="h-4" />
      </div>
    </aside>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────
export default function AustraliaApp() {
  const navigate = useNavigate();

  // ── Core state ───────────────────────────────────────────────────────────────
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') === 'true');
  const [geojson, setGeojson] = useState<GeoJsonObject | null>(null);
  const [activePreset, setActivePreset] = useState<PresetId | null>('blank');
  const [currentResults, setCurrentResults] = useState<Record<string, Partial<Record<AuPartyId, number>>>>({});
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [contributorsOpen, setContributorsOpen] = useState(false);

  // ── Right panel management ───────────────────────────────────────────────────
  type RPanelKey = 'sim' | 'swing' | 'breakdown' | 'parties';
  const [rightPanel, setRightPanel] = useState<RPanelKey | null>(null);
  const [exitPanel, setExitPanel] = useState<RPanelKey | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Left panel (parliament) ──────────────────────────────────────────────────
  const [parliamentOpen, setParliamentOpen] = useState(false);
  const [parliamentExiting, setParliamentExiting] = useState(false);
  const [tutorialOpen, setTutorialOpen]         = useState(false);
  const [tutorialExiting, setTutorialExiting]   = useState(false);
  const parliTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Multi-select ─────────────────────────────────────────────────────────────
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Bubble map ───────────────────────────────────────────────────────────────
  const [bubbleMap, setBubbleMap] = useState(false);

  // ── Simulation ───────────────────────────────────────────────────────────────
  const [simRunning, setSimRunning] = useState(false);
  const [simProgress, setSimProgress] = useState(0);
  const [simDeclared, setSimDeclared] = useState(0);
  const simTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── Stable refs for Leaflet callbacks ────────────────────────────────────────
  const layerRef           = useRef<L.GeoJSON | null>(null);
  const containerRef       = useRef<HTMLDivElement>(null);
  const headerScrollRef    = useRef<HTMLDivElement>(null);
  const activePresetRef    = useRef(activePreset);
  const currentResultsRef  = useRef(currentResults);
  const selectedIdRef      = useRef(selectedId);
  const darkRef            = useRef(dark);
  const multiSelectModeRef = useRef(multiSelectMode);
  const selectedIdsRef     = useRef(selectedIds);
  const bubbleMapRef       = useRef(bubbleMap);

  useEffect(() => { activePresetRef.current    = activePreset;    }, [activePreset]);
  useEffect(() => { currentResultsRef.current  = currentResults;  }, [currentResults]);
  useEffect(() => { selectedIdRef.current      = selectedId;      }, [selectedId]);
  useEffect(() => { darkRef.current            = dark;            }, [dark]);
  useEffect(() => { multiSelectModeRef.current = multiSelectMode; }, [multiSelectMode]);
  useEffect(() => { selectedIdsRef.current     = selectedIds;     }, [selectedIds]);
  useEffect(() => { bubbleMapRef.current       = bubbleMap;       }, [bubbleMap]);

  // ── Electorate lookup map ────────────────────────────────────────────────────
  const byIdMap = useMemo(() => {
    const m = new Map<string, typeof AU_ELECTORATES[number]>();
    for (const e of AU_ELECTORATES) m.set(e.id, e);
    return m;
  }, []);

  // ── Derived tallies ──────────────────────────────────────────────────────────
  const tally = useMemo(() => {
    const t: Record<string, number> = {};
    if (!activePreset) return t;
    for (const e of AU_ELECTORATES) {
      // On the baseline preset, use the official AEC winner — not simulated IRV
      if (activePreset === 'baseline') {
        t[e.winner2025] = (t[e.winner2025] ?? 0) + 1;
        continue;
      }
      const results = currentResults[e.id] ?? (activePreset !== 'blank' ? e.results2025 : undefined);
      if (!results) continue;
      const winner = determineWinner(results, e.validVotes);
      t[winner] = (t[winner] ?? 0) + 1;
    }
    return t;
  }, [activePreset, currentResults]);

  const { votePcts, rawVotes } = useMemo(() => {
    const pcts: Record<string, number> = {}, totals: Record<string, number> = {};
    let grand = 0;
    if (activePreset) {
      for (const e of AU_ELECTORATES) {
        const results = currentResults[e.id] ?? (activePreset !== 'blank' ? e.results2025 : {});
        for (const [pid, votes] of Object.entries(results ?? {})) {
          totals[pid] = (totals[pid] ?? 0) + (votes ?? 0);
          grand += votes ?? 0;
        }
      }
    }
    if (grand > 0) for (const [pid, v] of Object.entries(totals)) pcts[pid] = (v / grand) * 100;
    return { votePcts: pcts, rawVotes: totals };
  }, [activePreset, currentResults]);

  // ── Dark mode ────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  // ── Header wheel → horizontal scroll ────────────────────────────────────────
  useEffect(() => {
    const el = headerScrollRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  // ── Load GeoJSON ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}australia-electorates.geojson`)
      .then(r => r.json()).then(setGeojson).catch(console.error);
  }, []);

  // ── Imperative map re-style ──────────────────────────────────────────────────
  useEffect(() => {
    if (!layerRef.current) return;
    const borderColor = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)';
    if (bubbleMap) {
      layerRef.current.setStyle(() => ({
        fillOpacity: 0, weight: 0.5,
        color: dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)', opacity: 1,
      }));
      return;
    }
    layerRef.current.eachLayer((layer: L.Layer) => {
      const path = layer as L.Path & { feature?: Feature };
      const electDiv = (path.feature?.properties as Record<string, string> | undefined)?.elect_div ?? '';
      const isSelected = electDiv === selectedIdRef.current || selectedIdsRef.current.has(electDiv);
      const data = byIdMap.get(electDiv);
      let fillColor = dark ? '#374151' : BLANK_COLOR;
      const preset = activePresetRef.current;
      if (preset === 'blank') {
        const res = currentResultsRef.current[electDiv];
        if (res && data && Object.values(res).some(v => (v ?? 0) > 0))
          fillColor = electorateFill(data.validVotes, res, dark);
      } else if (preset) {
        const res = currentResultsRef.current[electDiv] ?? data?.results2025;
        const isUnedited = preset === 'baseline' && !modifiedIdsRef.current.has(electDiv);
        const winnerOverride = isUnedited ? data?.winner2025 : undefined;
        if (res && data) fillColor = electorateFill(data.validVotes, res, dark, winnerOverride);
      }
      path.setStyle({
        fillColor, fillOpacity: 0.82,
        color: isSelected ? '#c8a020' : borderColor,
        weight: isSelected ? 2 : 0.5,
        opacity: 1,
      });
    });
  }, [activePreset, currentResults, selectedId, selectedIds, dark, geojson, byIdMap, bubbleMap]);

  // ── Panel helpers ────────────────────────────────────────────────────────────
  const openPanel = useCallback((panel: RPanelKey) => {
    if (rightPanel === panel) {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      setExitPanel(panel);
      setRightPanel(null);
      exitTimerRef.current = setTimeout(() => setExitPanel(null), 280);
      return;
    }
    if (rightPanel) {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      setExitPanel(rightPanel);
      exitTimerRef.current = setTimeout(() => setExitPanel(null), 280);
    }
    setRightPanel(panel);
    setSelectedId(null);
  }, [rightPanel]);

  const closePanel = useCallback(() => {
    if (!rightPanel) return;
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    setExitPanel(rightPanel);
    setRightPanel(null);
    exitTimerRef.current = setTimeout(() => setExitPanel(null), 280);
  }, [rightPanel]);

  const toggleParliament = useCallback(() => {
    if (parliamentOpen) {
      setParliamentExiting(true);
      if (parliTimerRef.current) clearTimeout(parliTimerRef.current);
      parliTimerRef.current = setTimeout(() => { setParliamentOpen(false); setParliamentExiting(false); }, 260);
    } else {
      setParliamentOpen(true);
      setParliamentExiting(false);
    }
  }, [parliamentOpen]);

  // ── Preset handlers ──────────────────────────────────────────────────────────
  const loadBaseline = useCallback(() => {
    modifiedIdsRef.current = new Set();
    setCurrentResults(buildBaselineResults());
    setActivePreset('baseline');
    setSimRunning(false);
    for (const t of simTimersRef.current) clearTimeout(t);
    simTimersRef.current = [];
  }, []);

  const loadPolling = useCallback(() => {
    modifiedIdsRef.current = new Set();
    setCurrentResults(buildPollingResults());
    setActivePreset('polling2026');
    setSimRunning(false);
    for (const t of simTimersRef.current) clearTimeout(t);
    simTimersRef.current = [];
  }, []);

  const loadBlank = useCallback(() => {
    setCurrentResults({});
    setActivePreset('blank');
    setSelectedId(null);
    setSelectedIds(new Set());
    setSimRunning(false);
    for (const t of simTimersRef.current) clearTimeout(t);
    simTimersRef.current = [];
  }, []);

  const modifiedIdsRef = useRef<Set<string>>(new Set());
  const handleResultsChange = useCallback((elecId: string, newResults: Partial<Record<AuPartyId, number>>) => {
    modifiedIdsRef.current.add(elecId);
    setCurrentResults(prev => ({ ...prev, [elecId]: newResults }));
  }, []);

  // ── Simulation ───────────────────────────────────────────────────────────────
  const handleSimStart = useCallback((swings: Record<AuPartyId, number>, durationMs: number) => {
    loadBlank();
    // Base sim on 2026 polling so zero-swing produces the expected 2026 scenario
    const simResults = generateSimResults(swings, buildPollingResults());
    setSimRunning(true);
    setSimProgress(0);
    setSimDeclared(0);
    setScoreboardVisible(true);

    // Sort electorates by state timing using bell-curve distribution
    const electoratesWithTime = AU_ELECTORATES.map(e => {
      const offset = STATE_TIMING_OFFSET[e.state] ?? 0;
      const adjustedDuration = durationMs * (1 - offset);
      const baseTimes = bellCurveTimes(1, adjustedDuration);
      const t = offset * durationMs + baseTimes[0];
      return { e, t };
    }).sort((a, b) => a.t - b.t);

    const timers: ReturnType<typeof setTimeout>[] = [];
    electoratesWithTime.forEach(({ e, t }, i) => {
      const timer = setTimeout(() => {
        setCurrentResults(prev => ({ ...prev, [e.id]: simResults[e.id] ?? {} }));
        setSimDeclared(i + 1);
        setSimProgress((i + 1) / AU_ELECTORATES.length);
        if (i + 1 === AU_ELECTORATES.length) {
          setSimRunning(false);
        }
      }, Math.round(t));
      timers.push(timer);
    });
    simTimersRef.current = timers;
  }, [loadBlank]);

  const handleSimStop = useCallback(() => {
    for (const t of simTimersRef.current) clearTimeout(t);
    simTimersRef.current = [];
    setSimRunning(false);
  }, []);

  // ── Multi-select ─────────────────────────────────────────────────────────────
  const toggleMultiSelect = useCallback(() => {
    setMultiSelectMode(v => !v);
    setSelectedIds(new Set());
  }, []);

  // ── Map event handlers ───────────────────────────────────────────────────────
  const handleEachFeature = useCallback((_feature: Feature, layer: L.Layer) => {
    const props = (_feature as Feature & { properties: Record<string, string> }).properties;
    const electDiv = props.elect_div ?? '';

    layer.on('click', () => {
      const data = byIdMap.get(electDiv);
      if (!data) return;
      if (multiSelectModeRef.current) {
        setSelectedIds(prev => {
          const n = new Set(prev);
          n.has(electDiv) ? n.delete(electDiv) : n.add(electDiv);
          return n;
        });
        return;
      }
      setSelectedId(electDiv);
      setRightPanel(null);
    });

    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleMapRef.current) return;
      const data = byIdMap.get(electDiv);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const preset = activePresetRef.current;
      const rawResults = preset === 'blank'
        ? (currentResultsRef.current[electDiv] ?? {})
        : (preset ? (currentResultsRef.current[electDiv] ?? data?.results2025 ?? {}) : {});
      const totalReported = Object.values(rawResults).reduce((s, v) => s + (v ?? 0), 0);
      const parties = (Object.entries(rawResults) as [AuPartyId, number][])
        .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a)
        .map(([pid, votes]) => ({ id: pid, votes, pct: totalReported > 0 ? Math.round((votes / totalReported) * 1000) / 10 : 0 }));
      const isBaselineUnedited = preset === 'baseline' && !modifiedIdsRef.current.has(electDiv);
      const officialRounds = isBaselineUnedited ? (OFFICIAL_IRV_ROUNDS[data?.name ?? ''] as IrvRound[] | undefined) : undefined;
      const irvResult = !officialRounds && parties.length > 0 && data ? runIRV(rawResults as Partial<Record<AuPartyId, number>>, data.validVotes) : null;
      const tpp = data && totalReported > 0 ? computeTPP(rawResults as Partial<Record<AuPartyId, number>>, data.validVotes) : null;
      const officialTCP = isBaselineUnedited ? data?.tcp2025 : undefined;
      setTooltip({
        x: e.originalEvent.clientX - rect.left,
        y: e.originalEvent.clientY - rect.top,
        name: data?.name ?? electDiv,
        state: data?.state ?? '',
        validVotes: data?.validVotes ?? 0,
        parties,
        winner: officialRounds ? Object.entries(officialRounds[officialRounds.length - 1].votes).sort(([,a],[,b])=>b-a)[0]?.[0] as AuPartyId ?? null : irvResult?.winner ?? null,
        tpp,
        irvRounds: irvResult?.rounds ?? [],
        officialTCP,
        officialRounds,
      });
    });

    layer.on('mouseout', () => { if (!bubbleMapRef.current) setTooltip(null); });
  }, [byIdMap]);

  const geoStyle = useCallback((): L.PathOptions => ({
    fillColor: dark ? '#374151' : BLANK_COLOR, fillOpacity: 0.82,
    color: dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)', weight: 0.5, opacity: 1,
  }), [dark]);

  // ── Derived panel flags ──────────────────────────────────────────────────────
  const selectedElecData = selectedId ? byIdMap.get(selectedId) : null;
  const showElecPanel   = !!selectedId && !!selectedElecData && !rightPanel && !multiSelectMode;
  const showMultiPanel  = multiSelectMode && selectedIds.size > 0 && !rightPanel;

  const btnBase     = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold     = `${btnBase} bg-gold text-white hover:bg-gold-deep disabled:opacity-40 disabled:cursor-not-allowed`;
  const btnMuted    = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed`;
  const btnActive   = `${btnBase} bg-ink/8 border border-default text-ink`;
  const btnInactive = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;

  return (
    <div className={`flex flex-col h-screen bg-canvas overflow-hidden ${dark ? 'dark' : ''}`}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>

        <button onClick={() => navigate('/')}
          className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
          <div className="hidden sm:flex flex-col justify-center mr-2 leading-none">
            <span className="font-display font-black uppercase tracking-[0.04em] text-[14px] text-ink leading-none">Global Election Simulator</span>
            <span className="text-[7.5px] font-mono uppercase tracking-[0.13em] text-ink-3 leading-none mt-[3px]">Canberra Edition</span>
          </div>
        </button>

        <div ref={headerScrollRef} className="flex-1 min-w-0 header-scroll-strip flex items-center gap-2 px-2">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          {/* Presets */}
          <button onClick={loadBaseline} className={activePreset === 'baseline' ? btnGold : btnMuted}>2025 Baseline</button>
          <button onClick={loadPolling}  className={activePreset === 'polling2026' ? btnGold : btnMuted}>2026 Polling</button>
          <button onClick={loadBlank}    className={activePreset === 'blank' ? btnGold : btnMuted}>Blank Map</button>

          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />

          {/* Tools */}
          <button onClick={() => openPanel('sim')}
            className={`${btnBase} flex items-center gap-1.5 ${rightPanel === 'sim' ? btnActive : btnInactive}`}>
            <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor" aria-hidden="true">
              <path d="M1 1.2L6 4L1 6.8V1.2Z" strokeLinejoin="round"/>
            </svg>
            Simulation
          </button>
          <button onClick={toggleMultiSelect} className={multiSelectMode ? btnActive : btnInactive}>
            {multiSelectMode ? `⊕ ${selectedIds.size} sel.` : 'Multi-select'}
          </button>
          <button onClick={() => openPanel('parties')}   className={rightPanel === 'parties'   ? btnActive : btnInactive}>Parties</button>
          <button onClick={() => openPanel('swing')}     className={rightPanel === 'swing'     ? btnActive : btnInactive}>Swing</button>
          <button onClick={() => openPanel('breakdown')} className={rightPanel === 'breakdown' ? btnActive : btnInactive}>Breakdown</button>
          <button onClick={toggleParliament}             className={parliamentOpen ? btnActive : btnInactive} disabled={!activePreset}>Parliament</button>
          <button onClick={() => setBubbleMap(v => !v)}
            className={bubbleMap ? `${btnBase} bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700` : btnInactive}
            title="Toggle bubble margin map">
            Bubble Map
          </button>
          <button
            onClick={() => {
              if (tutorialOpen) {
                setTutorialExiting(true);
                setTimeout(() => { setTutorialExiting(false); setTutorialOpen(false); }, 280);
              } else {
                setTutorialOpen(true);
              }
            }}
            className={tutorialOpen ? btnActive : btnMuted}
          >Tutorial</button>
        </div>

        {/* Right controls */}
        <div className="shrink-0 flex items-center gap-2.5 pr-4">
          {/* Contributors */}
          <div className="relative">
            <button onClick={() => setContributorsOpen(o => !o)}
              className={`w-7 h-7 flex items-center justify-center rounded-[4px] border transition-colors ${contributorsOpen ? 'border-ink-3 text-ink bg-hover' : 'border-default text-ink-3 hover:border-ink-3 hover:text-ink'}`}
              title="Contributors">
              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm10-9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm1.5 7.5c.5-.25.5-.75.5-1s-.5-3-3-3.5a2.5 2.5 0 0 1 2.5 4.5z" fillRule="evenodd" clipRule="evenodd"/>
              </svg>
            </button>
            {contributorsOpen && (
              <>
                <div className="fixed inset-0 z-[99]" onClick={() => setContributorsOpen(false)} />
                <div className="absolute right-0 top-[calc(100%+6px)] z-[100] w-52 rounded-[10px] bg-white border border-default overflow-hidden"
                  style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.13), 0 0 0 1px rgba(0,0,0,0.06)' }}>
                  <div className="px-3.5 pt-3 pb-2 border-b border-default">
                    <div className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-ink leading-none">Contributors</div>
                  </div>
                  <div className="px-3.5 py-2.5 space-y-2">
                    <a href="https://x.com/realleochang" target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 hover:opacity-70 transition-opacity">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-ink-3" aria-hidden="true">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.66zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                      <span className="text-[11px] font-mono font-semibold text-ink">@realleochang</span>
                    </a>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Dark mode */}
          <button onClick={() => setDark(d => !d)}
            className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
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

      {/* ── Capture area ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 relative">

        {/* Collapsible scoreboard */}
        <div className="relative shrink-0">
          <div style={{
            display: 'grid',
            gridTemplateRows: scoreboardVisible ? '1fr' : '0fr',
            transition: 'grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1)',
          }}>
            <div className="overflow-hidden">
              <AuScoreboard
                tally={tally}
                votePcts={votePcts}
                rawVotes={rawVotes}
                activePreset={activePreset}
                simRunning={simRunning}
              />
            </div>
          </div>
          {/* Chevron handle */}
          <button
            onClick={() => !simRunning && setScoreboardVisible(v => !v)}
            title={simRunning ? 'Locked during simulation' : scoreboardVisible ? 'Hide scoreboard' : 'Show scoreboard'}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-[1001] h-4 px-3 rounded-full bg-white border border-default shadow-sm hover:bg-hover text-ink-3 hover:text-ink transition-colors flex items-center gap-1">
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

          {/* Parliament panel (LEFT) */}
          {(parliamentOpen || parliamentExiting) && (
            <AuParliamentPanel tally={tally} exiting={parliamentExiting} onClose={toggleParliament} />
          )}

          {/* Map */}
          <div ref={containerRef} className="flex-1 relative overflow-hidden">
            {geojson && (
              <MapContainer
                key="au-map"
                center={[-27, 133]}
                zoom={4}
                className="w-full h-full"
                zoomControl={true}
                attributionControl={false}
              >
                <TileLayer
                  url={dark
                    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
                  maxZoom={19}
                />
                <AuGeoLayer
                  geojson={geojson}
                  style={geoStyle}
                  onEachFeature={handleEachFeature}
                  layerRef={layerRef}
                />
                {bubbleMap && !!activePreset && (
                  <BubbleLayer
                    geojson={geojson} currentResults={currentResults} activePreset={activePreset} byIdMap={byIdMap}
                    containerRef={containerRef} setTooltip={setTooltip}
                    currentResultsRef={currentResultsRef} activePresetRef={activePresetRef}
                    modifiedIdsRef={modifiedIdsRef}
                    onSelect={id => { setSelectedId(id); setRightPanel(null); }}
                  />
                )}
                <MapFitter geojson={geojson} />
              </MapContainer>
            )}

            {!geojson && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-[13px] font-mono text-ink-3 animate-pulse">Loading map…</p>
              </div>
            )}

            {/* Tooltip */}
            {tooltip && containerRef.current && (
              <MapTooltip tooltip={tooltip} containerW={containerRef.current.offsetWidth} containerH={containerRef.current.offsetHeight} dark={dark} />
            )}

            {/* Multi-select float */}
            {multiSelectMode && (
              <AuMultiSelectFloat count={selectedIds.size} onClear={() => { setSelectedIds(new Set()); setMultiSelectMode(false); }} />
            )}

            {/* Start prompt */}
            {!activePreset && (
              <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-[11px] font-mono text-ink-3 border border-default ${dark ? 'bg-[rgba(18,24,44,0.88)]' : 'bg-[rgba(255,255,255,0.88)]'} backdrop-blur-sm`}>
                Select <strong>2025 Baseline</strong>, <strong>2026 Polling</strong>, or <strong>Blank Map</strong> to begin
              </div>
            )}

          </div>

          {/* Electorate panel */}
          {showElecPanel && (
            <ElectoratePanel
              id={selectedId!}
              name={selectedElecData!.name}
              state={selectedElecData!.state}
              results={currentResults[selectedId!]}
              results2025={selectedElecData!.results2025}
              validVotes={selectedElecData!.validVotes}
              activePreset={activePreset}
              onClose={() => setSelectedId(null)}
              onResultsChange={handleResultsChange}
            />
          )}

          {/* Multi-select panel */}
          {showMultiPanel && (
            <AuMultiSelectPanel
              selectedIds={selectedIds}
              currentResults={currentResults}
              onResultsChange={handleResultsChange}
              onClose={() => { setSelectedIds(new Set()); setMultiSelectMode(false); }}
            />
          )}

          {/* Simulation panel */}
          {(rightPanel === 'sim' || exitPanel === 'sim') && (
            <AuSimPanel
              onClose={closePanel}
              onStart={handleSimStart}
              onStop={handleSimStop}
              running={simRunning}
              progress={simProgress}
              declared={simDeclared}
            />
          )}

          {/* Swing panel */}
          {(rightPanel === 'swing' || exitPanel === 'swing') && (
            <AuSwingPanel
              exiting={exitPanel === 'swing'}
              currentResults={currentResults}
              onResultsChange={handleResultsChange}
              activePreset={activePreset}
              onReset={loadBaseline}
              onClose={closePanel}
            />
          )}

          {/* Breakdown drawer */}
          {(rightPanel === 'breakdown' || exitPanel === 'breakdown') && (
            <AuBreakdownDrawer
              currentResults={currentResults}
              activePreset={activePreset}
              exiting={exitPanel === 'breakdown'}
              onClose={closePanel}
            />
          )}

          {/* Party manager */}
          {(rightPanel === 'parties' || exitPanel === 'parties') && (
            <AuPartyManagerPanel
              exiting={exitPanel === 'parties'}
              onClose={closePanel}
            />
          )}

          {/* Tutorial panel */}
          {(tutorialOpen || tutorialExiting) && (
            <AuTutorialPanel
              onClose={() => {
                setTutorialExiting(true);
                setTimeout(() => { setTutorialExiting(false); setTutorialOpen(false); }, 280);
              }}
              exiting={tutorialExiting}
            />
          )}
        </div>

        {/* Branding stamp */}
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-30 flex items-center justify-between px-3 py-1 bg-ink/60">
          <span className="text-[10px] text-white/70 font-mono tracking-wide uppercase">Global Election Simulator — Canberra Edition</span>
          <span className="text-[10px] text-white/40 font-mono">{typeof window !== 'undefined' ? window.location.hostname : ''}</span>
        </div>
      </div>
    </div>
  );
}
