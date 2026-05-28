import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import type { GeoJsonObject, Feature } from 'geojson';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── India Alliances ───────────────────────────────────────────────────────────
const IN_PARTIES = [
  { id: 'NDA',   name: 'NDA',            color: '#FF6B1A' },
  { id: 'INDIA', name: 'INDIA Alliance', color: '#1464C8' },
  { id: 'OTH',   name: 'Others',         color: '#777777' },
] as const;

const IN_PARTY_MAP = Object.fromEntries(IN_PARTIES.map(p => [p.id, p])) as Record<string, typeof IN_PARTIES[number]>;

// ── Leaders ───────────────────────────────────────────────────────────────────
type LeaderInfo = { lastName: string; wikiTitle?: string; localImage?: string; scale?: number; transformOrigin?: string; objectPosition?: string; initials?: string };

const IN_LEADERS: Record<string, LeaderInfo> = {
  NDA:   { lastName: 'Modi',    wikiTitle: 'Narendra Modi',  objectPosition: '50% 15%' },
  INDIA: { lastName: 'Gandhi',  wikiTitle: 'Rahul Gandhi',   objectPosition: '50% 10%' },
  OTH:   { lastName: 'Others',  initials: 'OTH' },
};

const IN_LEADERS_2026: Partial<Record<string, LeaderInfo>> = {};

function InLeaderPhotoCircle({ partyId, leader, size = 52 }: { partyId: string; leader?: LeaderInfo; size?: number }) {
  const color = IN_PARTY_MAP[partyId]?.color ?? '#888888';
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
    <div className="rounded-full overflow-hidden shrink-0 flex items-center justify-center"
      style={{ width: size, height: size, background: `${color}22`, border: `1.5px solid ${color}55` }}>
      {photoUrl ? (
        <img src={photoUrl} alt={leader?.lastName ?? partyId} style={{
          width: '100%', height: '100%', objectFit: 'cover',
          objectPosition: leader?.objectPosition ?? 'center top',
          borderRadius: '50%',
          transform: `scale(${leader?.scale ?? 1})`,
          transformOrigin: leader?.transformOrigin ?? '50% 20%',
        }} onError={() => setPhotoUrl(null)} />
      ) : (
        <span className="font-mono font-bold text-center leading-none" style={{ fontSize: size * 0.34, color }}>{initials}</span>
      )}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface InStateData {
  id: string;
  name: string;
  province: string;
  seats: number;
  electorate: number;
  validVotes: number;
  results2024: Record<string, number>;
  winner2024: string;
}

interface SelectedState { id: string; name_en: string; province: string; }

type TooltipState = {
  x: number; y: number; name_en: string; province: string;
  seats: number; electorate: number; validVotes: number;
  parties: { id: string; votes: number; pct: number; seats: number }[];
  reportingPct?: number;
} | null;

// ── Helpers ───────────────────────────────────────────────────────────────────
const BLANK_COLOR = '#E5E7EB';

function stateFill(results: Record<string, number>, dark = false): string {
  const sorted = Object.entries(results).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  if (sorted.length === 0) return dark ? '#374151' : BLANK_COLOR;
  const [winnerId, winnerVotes] = sorted[0];
  const totalVotes = sorted.reduce((s, [, v]) => s + v, 0);
  const runnerUpVotes = sorted[1]?.[1] ?? 0;
  const margin = totalVotes > 0 ? ((winnerVotes - runnerUpVotes) / totalVotes) * 100 : 0;
  const baseColor = IN_PARTY_MAP[winnerId]?.color ?? '#888888';
  const t = Math.min(Math.max(margin / 30, 0), 1);
  const lightness = dark ? 55 - t * (55 - 28) : 82 - t * (82 - 38);
  const c = hsl(baseColor);
  c.l = lightness / 100;
  return c.formatHex() as string;
}

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

function InMapController({ layerRef }: { layerRef: { current: L.GeoJSON | null } }) {
  const map = useMap();
  useEffect(() => {
    const onZoomEnd = () => { if (layerRef.current) layerRef.current.eachLayer((layer: L.Layer) => { const p = layer as any; if (p.options) p.options.smoothFactor = 0; }); };
    map.on('zoomend', onZoomEnd);
    return () => { map.off('zoomend', onZoomEnd); };
  }, [map, layerRef]);
  return null;
}

function fmtVotes(n: number): string {
  if (n >= 10_000_000) return (n / 10_000_000).toFixed(1) + 'Cr';
  if (n >= 100_000)   return (n / 100_000).toFixed(1) + 'L';
  if (n >= 1_000)     return Math.round(n / 1_000) + 'K';
  return n.toString();
}

// ── Seat allocation (Largest Remainder / Hamilton method) ──────────────────
function allocateSeats(results: Record<string, number>, totalSeats: number): Record<string, number> {
  const total = Object.values(results).reduce((s, v) => s + v, 0);
  if (total === 0 || totalSeats === 0) return {};
  const parties = Object.entries(results).filter(([, v]) => v > 0);
  const quotas = parties.map(([id, votes]) => {
    const quota = (votes / total) * totalSeats;
    return { id, floor: Math.floor(quota), remainder: quota - Math.floor(quota) };
  });
  const totalFloor = quotas.reduce((s, q) => s + q.floor, 0);
  const remaining = totalSeats - totalFloor;
  quotas.sort((a, b) => b.remainder - a.remainder);
  const result: Record<string, number> = {};
  for (let i = 0; i < quotas.length; i++) result[quotas[i].id] = quotas[i].floor + (i < remaining ? 1 : 0);
  return result;
}

// ── India 2024 baseline seat data (Wikipedia-verified) ─────────────────────
const SEATS_2024: Record<string, Record<string, number>> = {
  AN:{NDA:1,INDIA:0,OTH:0}, AP:{NDA:21,INDIA:0,OTH:4},  AR:{NDA:2,INDIA:0,OTH:0},
  AS:{NDA:11,INDIA:3,OTH:0}, BR:{NDA:30,INDIA:9,OTH:1}, CH:{NDA:0,INDIA:1,OTH:0},
  CG:{NDA:10,INDIA:1,OTH:0}, DD:{NDA:1,INDIA:0,OTH:1},  DL:{NDA:7,INDIA:0,OTH:0},
  GA:{NDA:1,INDIA:1,OTH:0},  GJ:{NDA:25,INDIA:1,OTH:0}, HR:{NDA:5,INDIA:5,OTH:0},
  HP:{NDA:4,INDIA:0,OTH:0},  JK:{NDA:2,INDIA:2,OTH:1},  JH:{NDA:9,INDIA:5,OTH:0},
  KA:{NDA:19,INDIA:9,OTH:0}, KL:{NDA:1,INDIA:19,OTH:0}, LA:{NDA:0,INDIA:0,OTH:1},
  LD:{NDA:0,INDIA:1,OTH:0},  MP:{NDA:29,INDIA:0,OTH:0}, MH:{NDA:17,INDIA:30,OTH:1},
  MN:{NDA:0,INDIA:2,OTH:0},  ML:{NDA:0,INDIA:1,OTH:1},  MZ:{NDA:0,INDIA:0,OTH:1},
  NL:{NDA:0,INDIA:1,OTH:0},  OD:{NDA:20,INDIA:1,OTH:0}, PY:{NDA:0,INDIA:1,OTH:0},
  PB:{NDA:0,INDIA:10,OTH:3}, RJ:{NDA:14,INDIA:11,OTH:0},SK:{NDA:1,INDIA:0,OTH:0},
  TN:{NDA:0,INDIA:39,OTH:0}, TG:{NDA:8,INDIA:8,OTH:1},  TR:{NDA:2,INDIA:0,OTH:0},
  UP:{NDA:36,INDIA:43,OTH:1},UK:{NDA:5,INDIA:0,OTH:0},  WB:{NDA:12,INDIA:30,OTH:0},
};

// ── Build state data: vote counts back-calculated from seat results ─────────
const AVG_VOTES_PER_SEAT = 1_140_000;
const INDIA_STATE_CONFIGS: { id: string; seats: number; electorate: number; province: string }[] = [
  { id:'AN', seats:1,  electorate:330000,     province:'Union Territory' },
  { id:'AP', seats:25, electorate:39500000,   province:'South India' },
  { id:'AR', seats:2,  electorate:955000,     province:'Northeast India' },
  { id:'AS', seats:14, electorate:22200000,   province:'Northeast India' },
  { id:'BR', seats:40, electorate:74000000,   province:'East India' },
  { id:'CH', seats:1,  electorate:830000,     province:'Union Territory' },
  { id:'CG', seats:11, electorate:19800000,   province:'Central India' },
  { id:'DD', seats:2,  electorate:570000,     province:'Union Territory' },
  { id:'DL', seats:7,  electorate:15200000,   province:'Union Territory' },
  { id:'GA', seats:2,  electorate:1200000,    province:'West India' },
  { id:'GJ', seats:26, electorate:47600000,   province:'West India' },
  { id:'HR', seats:10, electorate:20300000,   province:'North India' },
  { id:'HP', seats:4,  electorate:5600000,    province:'North India' },
  { id:'JK', seats:5,  electorate:8800000,    province:'North India' },
  { id:'JH', seats:14, electorate:25700000,   province:'East India' },
  { id:'KA', seats:28, electorate:53100000,   province:'South India' },
  { id:'KL', seats:20, electorate:27400000,   province:'South India' },
  { id:'LA', seats:1,  electorate:220000,     province:'Union Territory' },
  { id:'LD', seats:1,  electorate:64000,      province:'Union Territory' },
  { id:'MP', seats:29, electorate:56800000,   province:'Central India' },
  { id:'MH', seats:48, electorate:91700000,   province:'West India' },
  { id:'MN', seats:2,  electorate:2100000,    province:'Northeast India' },
  { id:'ML', seats:2,  electorate:2100000,    province:'Northeast India' },
  { id:'MZ', seats:1,  electorate:870000,     province:'Northeast India' },
  { id:'NL', seats:1,  electorate:1310000,    province:'Northeast India' },
  { id:'OD', seats:21, electorate:36500000,   province:'East India' },
  { id:'PY', seats:1,  electorate:1060000,    province:'Union Territory' },
  { id:'PB', seats:13, electorate:21600000,   province:'North India' },
  { id:'RJ', seats:25, electorate:52800000,   province:'North India' },
  { id:'SK', seats:1,  electorate:470000,     province:'Northeast India' },
  { id:'TN', seats:39, electorate:62700000,   province:'South India' },
  { id:'TG', seats:17, electorate:31900000,   province:'South India' },
  { id:'TR', seats:2,  electorate:2870000,    province:'Northeast India' },
  { id:'UP', seats:80, electorate:150700000,  province:'North India' },
  { id:'UK', seats:5,  electorate:8740000,    province:'North India' },
  { id:'WB', seats:42, electorate:73200000,   province:'East India' },
];

const STATE_NAMES: Record<string, string> = {
  AN:'Andaman & Nicobar Islands', AP:'Andhra Pradesh', AR:'Arunachal Pradesh',
  AS:'Assam', BR:'Bihar', CH:'Chandigarh', CG:'Chhattisgarh',
  DD:'Dadra & NH / Daman & Diu', DL:'Delhi', GA:'Goa', GJ:'Gujarat',
  HR:'Haryana', HP:'Himachal Pradesh', JK:'Jammu & Kashmir', JH:'Jharkhand',
  KA:'Karnataka', KL:'Kerala', LA:'Ladakh', LD:'Lakshadweep',
  MP:'Madhya Pradesh', MH:'Maharashtra', MN:'Manipur', ML:'Meghalaya',
  MZ:'Mizoram', NL:'Nagaland', OD:'Odisha', PY:'Puducherry', PB:'Punjab',
  RJ:'Rajasthan', SK:'Sikkim', TN:'Tamil Nadu', TG:'Telangana', TR:'Tripura',
  UP:'Uttar Pradesh', UK:'Uttarakhand', WB:'West Bengal',
};

function buildStateData(): InStateData[] {
  return INDIA_STATE_CONFIGS.map(cfg => {
    const seats2024 = SEATS_2024[cfg.id] ?? { NDA: 0, INDIA: 0, OTH: 0 };
    const validVotes = Math.round(cfg.seats * AVG_VOTES_PER_SEAT * 0.64);
    // Back-calculate vote counts from seat fractions so proportional allocation reproduces 2024 actuals
    const results2024: Record<string, number> = {};
    const totalSeats = cfg.seats;
    for (const [pid, s] of Object.entries(seats2024)) {
      if (s > 0) results2024[pid] = Math.round((s / totalSeats) * validVotes);
    }
    // Ensure sum = validVotes
    const diff = validVotes - Object.values(results2024).reduce((a, b) => a + b, 0);
    const topP = Object.entries(results2024).sort(([,a],[,b]) => b - a)[0]?.[0];
    if (topP && diff !== 0) results2024[topP] = (results2024[topP] ?? 0) + diff;

    const winner2024 = Object.entries(seats2024).sort(([,a],[,b]) => b-a)[0]?.[0] ?? 'OTH';
    return {
      id: cfg.id,
      name: STATE_NAMES[cfg.id] ?? cfg.id,
      province: cfg.province,
      seats: cfg.seats,
      electorate: cfg.electorate,
      validVotes,
      results2024,
      winner2024,
    };
  });
}

const IN_STATE_DATA = buildStateData();

// ── 2026 polling vote fractions (per-state, informed by post-2024 state elections) ──
const DATA_IN_2026: Record<string, Record<string, number>> = {
  AN:{NDA:0.580,INDIA:0.280,OTH:0.140},
  AP:{NDA:0.540,INDIA:0.060,OTH:0.400},
  AR:{NDA:0.640,INDIA:0.200,OTH:0.160},
  AS:{NDA:0.510,INDIA:0.390,OTH:0.100},
  BR:{NDA:0.510,INDIA:0.440,OTH:0.050},
  CH:{NDA:0.400,INDIA:0.480,OTH:0.120},
  CG:{NDA:0.560,INDIA:0.400,OTH:0.040},
  DD:{NDA:0.480,INDIA:0.380,OTH:0.140},
  DL:{NDA:0.550,INDIA:0.400,OTH:0.050},  // BJP won Delhi state elections Feb 2025
  GA:{NDA:0.470,INDIA:0.440,OTH:0.090},
  GJ:{NDA:0.640,INDIA:0.290,OTH:0.070},
  HR:{NDA:0.480,INDIA:0.440,OTH:0.080},  // BJP won Haryana state Oct 2024
  HP:{NDA:0.560,INDIA:0.380,OTH:0.060},
  JK:{NDA:0.340,INDIA:0.460,OTH:0.200},  // NC (INDIA) won J&K state Oct 2024
  JH:{NDA:0.400,INDIA:0.480,OTH:0.120},  // JMM (INDIA) won Jharkhand state Nov 2024
  KA:{NDA:0.450,INDIA:0.470,OTH:0.080},  // INC governs Karnataka
  KL:{NDA:0.185,INDIA:0.645,OTH:0.170},
  LA:{NDA:0.340,INDIA:0.420,OTH:0.240},
  LD:{NDA:0.250,INDIA:0.500,OTH:0.250},
  MP:{NDA:0.585,INDIA:0.375,OTH:0.040},
  MH:{NDA:0.420,INDIA:0.460,OTH:0.120},  // Maha Vikas Aghadi won MH state Nov 2024
  MN:{NDA:0.400,INDIA:0.460,OTH:0.140},
  ML:{NDA:0.280,INDIA:0.360,OTH:0.360},
  MZ:{NDA:0.100,INDIA:0.200,OTH:0.700},
  NL:{NDA:0.430,INDIA:0.270,OTH:0.300},
  OD:{NDA:0.520,INDIA:0.280,OTH:0.200},
  PY:{NDA:0.340,INDIA:0.480,OTH:0.180},
  PB:{NDA:0.170,INDIA:0.490,OTH:0.340},
  RJ:{NDA:0.530,INDIA:0.390,OTH:0.080},
  SK:{NDA:0.300,INDIA:0.200,OTH:0.500},
  TN:{NDA:0.110,INDIA:0.620,OTH:0.270},
  TG:{NDA:0.360,INDIA:0.460,OTH:0.180},  // INC won Telangana state Dec 2023
  TR:{NDA:0.610,INDIA:0.280,OTH:0.110},
  UP:{NDA:0.430,INDIA:0.430,OTH:0.140},
  UK:{NDA:0.560,INDIA:0.400,OTH:0.040},
  WB:{NDA:0.370,INDIA:0.490,OTH:0.140},
};

// ── State detail panel ────────────────────────────────────────────────────────
interface StatePanelProps {
  id: string; name_en: string; province: string; seats: number;
  results?: Record<string, number>;
  results2024?: Record<string, number>;
  validVotes?: number;
  activePreset: string | null;
  onClose: () => void;
  onResultsChange?: (id: string, newResults: Record<string, number>) => void;
  onReportingCommit?: (id: string, pct: number) => void;
}

function InStatePanel({ id, name_en, province, seats, results, results2024, validVotes, activePreset, onClose, onResultsChange, onReportingCommit }: StatePanelProps) {
  const total = validVotes ?? 0;
  const [sliderPcts, setSliderPcts] = useState<Record<string, number>>({});
  const [locked, setLocked]         = useState<Set<string>>(new Set());
  const [projected, setProjected]   = useState(false);
  const [editingParty, setEditingParty] = useState<string | null>(null);
  const [editValue, setEditValue]   = useState('');
  const [reporting, setReporting]   = useState('');
  const reportingNum = parseFloat(reporting) || 0;
  const showReporting = activePreset === 'sim';

  useEffect(() => {
    if (total === 0) { setSliderPcts({}); return; }
    if (!results) {
      if (activePreset === 'blank') {
        const share = 100 / IN_PARTIES.length;
        const pcts: Record<string, number> = {};
        for (const p of IN_PARTIES) pcts[p.id] = share;
        setSliderPcts(pcts); setProjected(false);
      } else { setSliderPcts({}); }
      return;
    }
    const pcts: Record<string, number> = {};
    for (const [pid, votes] of Object.entries(results)) if (votes > 0) pcts[pid] = (votes / total) * 100;
    setSliderPcts(pcts);
    if (activePreset === 'blank') setProjected(true);
  }, [id, results, total, activePreset]);

  useEffect(() => { setLocked(new Set()); setReporting(''); }, [id]);

  const toggleLock = useCallback((pid: string) => {
    setLocked(prev => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });
  }, []);

  const handleSlide = useCallback((pid: string, newPct: number) => {
    if (total === 0) return;
    const lockedSum = Object.entries(sliderPcts).filter(([p]) => p !== pid && locked.has(p)).reduce((s,[,v]) => s+v, 0);
    const available = Math.max(0, 100 - lockedSum);
    const capped = Math.min(Math.max(0, newPct), available);
    const remaining = available - capped;
    const unlockedOthers = Object.keys(sliderPcts).filter(p => p !== pid && !locked.has(p));
    const unlockedSum = unlockedOthers.reduce((s, p) => s + (sliderPcts[p] ?? 0), 0);
    const newPcts: Record<string, number> = { ...sliderPcts, [pid]: capped };
    if (remaining < 1e-9) { for (const p of unlockedOthers) newPcts[p] = 0; }
    else if (unlockedSum > 1e-9) { for (const p of unlockedOthers) newPcts[p] = ((sliderPcts[p] ?? 0) / unlockedSum) * remaining; }
    else if (unlockedOthers.length > 0) { const share = remaining / unlockedOthers.length; for (const p of unlockedOthers) newPcts[p] = share; }
    const normSum = Object.values(newPcts).reduce((s, v) => s + v, 0);
    if (normSum > 1e-9) for (const p of Object.keys(newPcts)) newPcts[p] = (newPcts[p] / normSum) * 100;
    setSliderPcts(newPcts);
    if (activePreset !== 'blank' && onResultsChange) {
      const newResults: Record<string, number> = {};
      for (const [p, pct] of Object.entries(newPcts)) if (pct > 1e-9) newResults[p] = Math.round((pct / 100) * total);
      onResultsChange(id, newResults);
    }
  }, [sliderPcts, locked, id, total, onResultsChange, activePreset]);

  const handleMakeProjection = useCallback(() => {
    if (!onResultsChange || total === 0) return;
    const newResults: Record<string, number> = {};
    for (const [p, pct] of Object.entries(sliderPcts)) if (pct > 1e-9) newResults[p] = Math.round((pct / 100) * total);
    onResultsChange(id, newResults);
    onReportingCommit?.(id, parseFloat(reporting) || 0);
    setProjected(true);
  }, [sliderPcts, id, total, onResultsChange, onReportingCommit, reporting]);

  const commitEdit = useCallback((pid: string, raw: string) => {
    const num = parseFloat(raw);
    if (!isNaN(num)) handleSlide(pid, Math.max(0, Math.min(100, num)));
    setEditingParty(null); setEditValue('');
  }, [handleSlide]);

  const showSliders = (activePreset === '2024' || activePreset === '2026' || activePreset === 'sim' || activePreset === 'blank') && total > 0;
  const pct2024 = useMemo(() => {
    if (!results2024 || total === 0) return {} as Record<string, number>;
    const p: Record<string, number> = {};
    for (const [pid, v] of Object.entries(results2024)) if (v > 0) p[pid] = (v / total) * 100;
    return p;
  }, [results2024, total]);
  const showComparison = activePreset !== '2024' && activePreset !== 'blank' && Object.keys(pct2024).length > 0;
  const sliderParties = useMemo(() => IN_PARTIES.filter(p => p.id in sliderPcts), [sliderPcts]);
  const compParties   = useMemo(() => IN_PARTIES.filter(p => (pct2024[p.id] ?? 0) > 0 || (sliderPcts[p.id] ?? 0) > 0), [pct2024, sliderPcts]);

  // Compute allocated seats for display
  const allocatedSeats = useMemo(() => {
    if (!showSliders || total === 0 || Object.keys(sliderPcts).length === 0) return {} as Record<string, number>;
    const votes: Record<string, number> = {};
    for (const [pid, pct] of Object.entries(sliderPcts)) if (pct > 1e-9) votes[pid] = Math.round((pct / 100) * total);
    return allocateSeats(votes, seats);
  }, [sliderPcts, total, seats, showSliders, showReporting, reportingNum]);

  return (
    <div className="w-[280px] shrink-0 border-l border-default bg-surface flex flex-col overflow-y-auto z-10">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-default">
        <span className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">State / UT</span>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded text-ink-3 hover:text-ink hover:bg-hover transition-colors">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        </button>
      </div>
      <div className="px-3.5 py-3 border-b border-default">
        <div className="font-display text-[14px] font-black uppercase tracking-tight text-ink leading-tight">{name_en}</div>
        <div className="mt-1 text-[9px] font-mono text-ink-3 uppercase tracking-wide">{province}</div>
        <div className="mt-1 text-[9px] font-mono text-ink-3">{seats} Lok Sabha {seats === 1 ? 'seat' : 'seats'}</div>
      </div>

      {showSliders ? (
        <div className="px-3.5 py-3 border-b border-default">
          {activePreset === 'blank' && (
            <button onClick={projected ? undefined : handleMakeProjection}
              className="relative overflow-hidden w-full h-9 rounded-[5px] mb-3 text-white text-[11px] font-mono font-bold uppercase tracking-wide transition-colors"
              style={{ background: projected ? '#16a34a' : '#c8a020', cursor: projected ? 'default' : 'pointer' }}>
              {!projected && <span className="absolute inset-0 pointer-events-none" style={{ width:'45%', background:'linear-gradient(105deg,transparent 0%,rgba(255,255,255,0.35) 50%,transparent 100%)', animation:'shimmerSweep 2.2s ease-in-out infinite' }}/>}
              <span className="relative z-10 flex items-center justify-center gap-1.5">
                {projected ? (<><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="rgba(255,255,255,0.25)"/><path d="M3 6l2.2 2.2L9 4" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>Projected</>) : 'Make a Projection'}
              </span>
            </button>
          )}
          {showReporting && (
            <div className="mb-3 pb-3 border-b border-default">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">% Reporting</div>
                <span className="text-[12px] font-mono font-semibold tabular-nums text-ink">{Math.round(reportingNum)}%</span>
              </div>
              <input type="range" min={0} max={100} step={1} value={reportingNum}
                onChange={e => { setReporting(e.target.value); setProjected(false); }}
                className="ca-party-slider w-full"
                style={{ '--party-color': '#c8a020', '--pct': `${reportingNum}%` } as React.CSSProperties} />
            </div>
          )}
          <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-3">
            {activePreset === '2024' ? '2024 Result' : activePreset === '2026' ? '2026 Projection' : activePreset === 'sim' ? 'Live Count' : 'Manual Entry'}
          </div>
          <div className="space-y-3.5">
            {sliderParties.map(p => {
              const pct = sliderPcts[p.id] ?? 0;
              const rf  = showReporting ? reportingNum / 100 : 1;
              const votes = Math.round((pct / 100) * total * rf);
              const seatsWon = allocatedSeats[p.id] ?? 0;
              const isLocked = locked.has(p.id);
              const isProjectedLock = activePreset === 'blank' && projected;
              return (
                <div key={p.id}>
                  <div className="flex items-center gap-1 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className="text-[9.5px] font-medium text-ink flex-1 leading-none truncate">{IN_PARTY_MAP[p.id]?.name ?? p.id}</span>
                    <span className="text-[8px] font-mono font-bold px-1 py-0.5 rounded" style={{ background: `${p.color}22`, color: p.color }}>
                      {seatsWon} {seatsWon === 1 ? 'seat' : 'seats'}
                    </span>
                    <button onClick={() => { if (!isProjectedLock) toggleLock(p.id); }}
                      title={isProjectedLock ? 'Projected' : isLocked ? 'Unlock' : 'Lock'}
                      className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isProjectedLock ? 'text-ink-3/30 cursor-default' : isLocked ? 'text-[#c8a020]' : 'text-ink-3 hover:text-ink'}`}>
                      {isLocked ? (
                        <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                      ) : (
                        <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                      )}
                    </button>
                    {editingParty === p.id ? (
                      <input type="number" min={0} max={100} step={0.1} value={editValue} autoFocus
                        className="w-12 h-5 text-[9.5px] font-mono font-semibold tabular-nums text-right px-1 rounded border border-default focus:outline-none focus:border-ink-3 bg-white"
                        style={{ color: p.color }}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(p.id, editValue)}
                        onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); commitEdit(p.id, editValue); } if (e.key==='Escape') { setEditingParty(null); setEditValue(''); } }} />
                    ) : (
                      <span onClick={() => { if (!isLocked && !isProjectedLock) { setEditingParty(p.id); setEditValue(pct.toFixed(1)); } }}
                        className="text-[9.5px] font-mono font-semibold tabular-nums"
                        style={{ color: p.color, minWidth:36, textAlign:'right', cursor:(isLocked||isProjectedLock)?'default':'text' }}
                        title={(isLocked||isProjectedLock)?undefined:'Click to edit'}>
                        {pct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <input type="range" min={0} max={100} step={0.1} value={pct}
                    disabled={isLocked || isProjectedLock}
                    onChange={e => handleSlide(p.id, parseFloat(e.target.value))}
                    className="ca-party-slider w-full"
                    style={{ '--party-color': p.color, '--pct': `${pct}%` } as React.CSSProperties} />
                  <div className="text-right text-[8px] font-mono text-ink-3 opacity-60 -mt-0.5">
                    {votes.toLocaleString()} votes
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[7.5px] font-mono text-ink-3/50 mt-2.5 pt-2 border-t border-default">
            {total.toLocaleString()} valid votes · {seats} seats
          </div>
        </div>
      ) : !showComparison ? (
        <div className="px-3.5 py-3">
          <div className="text-[9px] font-mono text-ink-3 italic">No data — click a preset</div>
        </div>
      ) : null}

      {showComparison && (
        <div className="px-3.5 py-3">
          <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-3">
            {activePreset === 'blank' ? '2024 Reference' : '△ vs 2024'}
          </div>
          <div className="space-y-2.5">
            {compParties.map(p => {
              const b = pct2024[p.id] ?? 0;
              const c = sliderPcts[p.id] ?? 0;
              const delta = c - b;
              return (
                <div key={p.id}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                      <span className="text-[9px] font-mono font-bold" style={{ color: p.color }}>{p.id}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[9px] font-mono tabular-nums">
                      {activePreset !== 'blank' ? (
                        <><span className="text-ink-3/70">{b.toFixed(1)}%</span><span className="text-ink-3/40">→</span><span style={{color:p.color}}>{c.toFixed(1)}%</span>
                        <span className={`text-[8px] font-bold ml-0.5 ${delta>0.05?'text-emerald-600':delta<-0.05?'text-red-500':'text-ink-3'}`}>
                          {delta>0.05?'+':''}{Math.abs(delta)<0.05?'—':delta.toFixed(1)}</span></>
                      ) : <span style={{color:p.color}}>{b.toFixed(1)}%</span>}
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden relative" style={{ background:'rgba(0,0,0,0.07)' }}>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width:`${b}%`, background:p.color, opacity:0.28 }}/>
                    {activePreset !== 'blank' && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width:`${c}%`, background:p.color, opacity:0.85 }}/>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[7.5px] font-mono text-ink-3/50 mt-2.5 pt-2 border-t border-default">{total.toLocaleString()} valid votes</div>
        </div>
      )}
    </div>
  );
}

// ── Hover tooltip ─────────────────────────────────────────────────────────────
function InMapTooltip({ tooltip, containerW, containerH, dark = true }: {
  tooltip: NonNullable<TooltipState>; containerW: number; containerH: number; dark?: boolean;
}) {
  const TW = 280;
  const isSim = tooltip.reportingPct !== undefined;
  const TH_EST = (isSim ? 80 : 120) + tooltip.parties.length * 52;
  const left = tooltip.x + 18 + TW > containerW ? tooltip.x - TW - 10 : tooltip.x + 18;
  const top  = Math.max(6, Math.min(tooltip.y - 20, containerH - TH_EST - 8));
  const tt = {
    bg:     dark ? 'rgba(18,24,44,0.96)' : 'rgba(255,255,255,0.97)',
    border: dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)',
    shadow: dark ? '0 6px 28px rgba(0,0,0,0.5)' : '0 6px 28px rgba(0,0,0,0.12)',
    title:  dark ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)',
    sub:    dark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.42)',
    sub2:   dark ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.38)',
    body:   dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.78)',
    muted:  dark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.40)',
    dim:    dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)',
    divider:dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)',
    gold:   '#c8a020',
  };
  const reportingLabel = isSim ? (tooltip.reportingPct! >= 99.5 ? '100% reporting' : `${tooltip.reportingPct!.toFixed(0)}% reporting`) : null;
  const totalReported = tooltip.parties.reduce((s, p) => s + p.votes, 0);
  const stateSeats = tooltip.seats;

  return (
    <div className="absolute pointer-events-none z-[1000]" style={{ left, top, width: TW }}>
      <div style={{ background:tt.bg, borderRadius:10, border:`1px solid ${tt.border}`, boxShadow:tt.shadow, backdropFilter:'blur(10px)', overflow:'hidden' }}>
        <div style={{ padding:'12px 16px 10px' }}>
          <div style={{ fontSize:15, fontWeight:700, color:tt.title, lineHeight:1.2 }}>{tooltip.name_en}</div>
          <div style={{ fontSize:10.5, fontFamily:'"JetBrains Mono",monospace', color:tt.sub, marginTop:3 }}>
            {isSim ? <>{tooltip.province} · <span style={{color:tt.gold,fontWeight:700}}>{reportingLabel}</span></> : tooltip.province}
          </div>
          <div style={{ fontSize:10, fontFamily:'"JetBrains Mono",monospace', color:tt.sub2, marginTop:2 }}>
            {stateSeats} Lok Sabha {stateSeats===1?'seat':'seats'}
          </div>
        </div>
        <div style={{ padding:'0 14px 10px' }}>
          {tooltip.parties.length > 0 ? tooltip.parties.map(({ id, votes, pct, seats: pSeats }, i) => {
            const color = IN_PARTY_MAP[id]?.color ?? '#888888';
            const name  = IN_PARTY_MAP[id]?.name ?? id;
            const isWinner = i === 0;
            return (
              <div key={id} style={{ display:'flex', alignItems:'center', gap:8, marginBottom: i < tooltip.parties.length-1 ? 8 : 0 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:color, flexShrink:0 }}/>
                <span style={{ flex:1, minWidth:0, fontSize:11.5, fontWeight:isWinner?600:400, color:tt.body, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
                <span style={{ fontSize:10, fontFamily:'"JetBrains Mono",monospace', color:tt.muted, marginRight:4 }}>{votes.toLocaleString()}</span>
                <span style={{ fontSize:12, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color, minWidth:44, textAlign:'right' }}>{pct.toFixed(1)}%</span>
                {!isSim && <span style={{ fontSize:10, fontFamily:'"JetBrains Mono",monospace', color:color, minWidth:36, textAlign:'right', marginLeft:2 }}>{pSeats}s</span>}
              </div>
            );
          }) : <p style={{ fontSize:11, color:tt.dim, fontStyle:'italic', margin:'4px 0' }}>{isSim ? 'Not yet reporting' : 'No results — click a preset'}</p>}
        </div>
        {!isSim && (
          <div style={{ borderTop:`1px solid ${tt.divider}`, padding:'7px 16px', display:'flex', justifyContent:'space-between' }}>
            <span style={{ fontSize:10, fontFamily:'"JetBrains Mono",monospace', color:tt.dim }}>{totalReported.toLocaleString()} votes</span>
            <span style={{ fontSize:10, fontFamily:'"JetBrains Mono",monospace', color:tt.dim }}>{tooltip.electorate > 0 ? `${fmtVotes(tooltip.electorate)} electors` : ''}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Parliament geometry (543 seats, 9 hemicycle rows) ─────────────────────────
const IN_TOTAL  = 543;
const IN_MAJORITY = 272;
const IN_POLITICAL_ORDER = ['INDIA', 'OTH', 'NDA'];
const IN_HEMI_ROWS   = [39, 47, 55, 63, 71, 79, 87, 70, 32] as const; // sum=543
const IN_HEMI_RADII  = IN_HEMI_ROWS.map((_, i) => 68 + i * 12);
const IN_HEMI_CX = 260; const IN_HEMI_CY = 255; const IN_HEMI_DOT_R = 2.2;
const IN_EMPTY_COLOR = '#ddd8d0';

const IN_HEMI_POSITIONS: { x: number; y: number }[] = (() => {
  const pts: { x: number; y: number; theta: number }[] = [];
  for (let row = 0; row < IN_HEMI_ROWS.length; row++) {
    const n = IN_HEMI_ROWS[row]; const r = IN_HEMI_RADII[row];
    for (let j = 0; j < n; j++) {
      const theta = Math.PI * (1 - j / (n - 1));
      pts.push({ x: IN_HEMI_CX + r * Math.cos(theta), y: IN_HEMI_CY - r * Math.sin(theta), theta });
    }
  }
  pts.sort((a, b) => b.theta - a.theta);
  return pts.map(({ x, y }) => ({ x, y }));
})();

function buildInSeatArray(tally: Record<string, number>): (string | null)[] {
  const seats: (string | null)[] = [];
  for (const p of IN_POLITICAL_ORDER) { const n = tally[p] ?? 0; if (n > 0) for (let i = 0; i < n; i++) seats.push(p); }
  while (seats.length < IN_TOTAL) seats.push(null);
  return seats.slice(0, IN_TOTAL);
}

function InParliamentPanel({ tally, exiting = false, onClose }: { tally: Record<string, number>; exiting?: boolean; onClose: () => void }) {
  const seats = useMemo(() => buildInSeatArray(tally), [tally]);
  const totalDeclared = seats.filter(s => s !== null).length;
  const topEntry = Object.entries(tally).filter(([,n]) => n>0).sort(([,a],[,b]) => b-a)[0];
  const innerR = IN_HEMI_RADII[0]; const outerR = IN_HEMI_RADII[IN_HEMI_RADII.length - 1];
  const MAJ = Math.PI / 2;
  const mx1 = IN_HEMI_CX + (innerR-6)*Math.cos(MAJ), my1 = IN_HEMI_CY - (innerR-6)*Math.sin(MAJ);
  const mx2 = IN_HEMI_CX + (outerR+8)*Math.cos(MAJ), my2 = IN_HEMI_CY - (outerR+8)*Math.sin(MAJ);
  const lx  = IN_HEMI_CX + (outerR+18)*Math.cos(MAJ), ly = IN_HEMI_CY - (outerR+18)*Math.sin(MAJ);

  return (
    <aside className={`w-[340px] shrink-0 bg-card border-r border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="px-3 pt-3 pb-2 border-b border-default flex items-start justify-between gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-mono text-ink-3 uppercase tracking-wide mb-0.5">Lok Sabha</p>
          <h2 className="text-[13px] font-bold text-ink leading-tight">Seat distribution</h2>
          <p className="text-[9px] font-mono text-ink-3 mt-0.5">
            {totalDeclared} / {IN_TOTAL} seats · majority {IN_MAJORITY}
            {topEntry ? ` · ${IN_PARTY_MAP[topEntry[0]]?.name ?? topEntry[0]} ${topEntry[1]}` : ''}
          </p>
        </div>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0 mt-0.5">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pt-2 pb-3 thin-scroll">
        <svg viewBox="0 0 520 265" className="w-full">
          <line x1={IN_HEMI_CX-outerR-10} y1={IN_HEMI_CY} x2={IN_HEMI_CX+outerR+10} y2={IN_HEMI_CY} stroke="#e5e2db" strokeWidth="1"/>
          <line x1={mx1} y1={my1} x2={mx2} y2={my2} stroke="#888" strokeWidth="1.2" strokeDasharray="3 2"/>
          <text x={lx} y={ly+3} textAnchor="middle" fontSize="8" fill="#888" fontFamily="monospace">{IN_MAJORITY}</text>
          {IN_HEMI_POSITIONS.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={IN_HEMI_DOT_R} fill={seats[i] ? (IN_PARTY_MAP[seats[i]!]?.color ?? '#888') : IN_EMPTY_COLOR}/>
          ))}
        </svg>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-default">
          {Object.entries(tally).filter(([,n]) => n>0).sort(([,a],[,b]) => b-a).map(([p,n]) => (
            <div key={p} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: IN_PARTY_MAP[p]?.color ?? '#888' }}/>
              <span className="text-[9px] font-mono text-ink-2">{IN_PARTY_MAP[p]?.name ?? p}</span>
              <span className="text-[9px] font-mono font-bold text-ink">{n}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ── Breakdown ─────────────────────────────────────────────────────────────────
type InStateResult = { id: string; name: string; province: string; seats: number; winner: string; runnerUp: string|null; winnerSeats: number; marginSeats: number };

function computeInStateResults(stateData: InStateData[], currentResults: Record<string,Record<string,number>>, activePreset: string|null): InStateResult[] {
  if (!activePreset || activePreset === 'blank') return [];
  return stateData.map(s => {
    const results = currentResults[s.id] ?? s.results2024;
    const allocated = allocateSeats(results, s.seats);
    const sorted = Object.entries(allocated).filter(([,v]) => v>0).sort(([,a],[,b]) => b-a);
    const [winner='OTH', winnerSeats=0] = sorted[0] ?? [];
    const [runnerUp=null, ruSeats=0]    = sorted[1] ?? [];
    return { id:s.id, name:s.name, province:s.province, seats:s.seats, winner, runnerUp, winnerSeats, marginSeats: winnerSeats - ruSeats };
  });
}

function computeInDistortion(stateData: InStateData[], currentResults: Record<string,Record<string,number>>, activePreset: string|null) {
  if (!activePreset || activePreset==='blank') return [];
  const seats: Record<string,number> = {}; const votes: Record<string,number> = {}; let totalVotes = 0;
  for (const s of stateData) {
    const results = currentResults[s.id] ?? s.results2024;
    const allocated = allocateSeats(results, s.seats);
    for (const [p,n] of Object.entries(allocated)) seats[p] = (seats[p]??0) + n;
    for (const [p,v] of Object.entries(results)) { votes[p]=(votes[p]??0)+v; totalVotes+=v; }
  }
  return Array.from(new Set([...Object.keys(seats),...Object.keys(votes)]))
    .map(p => ({ party:p, seats:seats[p]??0, seatShare:((seats[p]??0)/IN_TOTAL)*100, voteShare:totalVotes>0?((votes[p]??0)/totalVotes)*100:0 }))
    .filter(r => r.seats>0 || r.voteShare>0.5).sort((a,b) => b.seats-a.seats);
}

function InBreakdownDrawer({ stateData, currentResults, activePreset, exiting, onClose }: {
  stateData: InStateData[]; currentResults: Record<string,Record<string,number>>; activePreset: string|null; exiting: boolean; onClose: () => void;
}) {
  const [tab, setTab] = useState<'region'|'closest'|'distortion'|'margin'>('region');
  const hasData = !!activePreset && activePreset !== 'blank';
  const stateResults = useMemo(() => computeInStateResults(stateData, currentResults, activePreset), [stateData, currentResults, activePreset]);
  const regionData   = useMemo(() => {
    // Recompute properly per region
    const map = new Map<string, Record<string,number>>();
    for (const r of stateResults) {
      const allocated = allocateSeats(currentResults[r.id] ?? stateData.find(s=>s.id===r.id)!.results2024, r.seats);
      const p = map.get(r.province) ?? {};
      for (const [party,n] of Object.entries(allocated)) p[party]=(p[party]??0)+n;
      map.set(r.province, p);
    }
    return Array.from(map.entries()).map(([province,seats]) => ({ province, seats, total:Object.values(seats).reduce((a,b)=>a+b,0) })).sort((a,b)=>b.total-a.total);
  }, [stateResults, currentResults, stateData]);
  const closestStates = useMemo(() => [...stateResults].sort((a,b) => a.marginSeats-b.marginSeats).slice(0,20), [stateResults]);
  const distortion    = useMemo(() => computeInDistortion(stateData, currentResults, activePreset), [stateData, currentResults, activePreset]);

  // Mega-seats: states with most seats going to one alliance
  const megaSeats = useMemo(() => [...stateResults].sort((a,b) => b.winnerSeats-a.winnerSeats).slice(0,15), [stateResults]);

  const tabs = [
    { id:'region' as const, label:'By region' },
    { id:'closest' as const, label:'Closest' },
    { id:'distortion' as const, label:'Vote vs seats' },
    { id:'margin' as const, label:'Landslides' },
  ];

  return (
    <aside className={`w-80 shrink-0 bg-surface border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-default shrink-0">
        <h2 className="text-[15px] font-semibold text-ink">Race breakdown</h2>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-hover text-ink-3 hover:text-ink text-lg">×</button>
      </div>
      <div className="flex border-b border-default shrink-0 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 text-[9px] py-2.5 font-medium transition-colors whitespace-nowrap px-1 ${tab===t.id?'text-[#c8a020] border-b-2 border-[#c8a020]':'text-ink-3 hover:text-ink'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {!hasData ? (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <p className="text-[12px] text-ink-3 italic">Load a preset to see breakdown</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto thin-scroll">
          {tab === 'region' && (
            <div className="p-4 space-y-4">
              {regionData.map(r => (
                <div key={r.province}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[12px] font-semibold text-ink">{r.province}</span>
                    <span className="text-[10px] text-ink-3 font-mono">{r.total} seats</span>
                  </div>
                  <div className="flex h-2.5 rounded overflow-hidden mb-1.5">
                    {Object.entries(r.seats).sort(([,a],[,b])=>(b as number)-(a as number)).map(([p,n]) => (
                      <div key={p} className="h-full" title={`${IN_PARTY_MAP[p]?.name??p}: ${n}`} style={{ width:`${((n as number)/r.total)*100}%`, background:IN_PARTY_MAP[p]?.color??'#888' }}/>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                    {Object.entries(r.seats).sort(([,a],[,b])=>(b as number)-(a as number)).map(([p,n]) => (
                      <span key={p} className="flex items-center gap-1 text-[9px] text-ink-3">
                        <span className="inline-block w-2 h-2 rounded-sm" style={{background:IN_PARTY_MAP[p]?.color??'#888'}}/>
                        <span className="font-mono">{n as number}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'closest' && (
            <div className="divide-y divide-default">
              {closestStates.map((c,i) => (
                <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="text-[10px] text-ink-3 w-4 shrink-0 font-mono">{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:IN_PARTY_MAP[c.winner]?.color??'#888'}}/>
                      {c.runnerUp && <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:IN_PARTY_MAP[c.runnerUp]?.color??'#888'}}/>}
                      <span className="text-[11px] text-ink truncate">{c.name}</span>
                    </div>
                    <span className="text-[9px] text-ink-3">{c.province}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-mono text-ink">{c.winnerSeats}/{c.seats} seats</div>
                    <div className="text-[9px] font-mono text-[#c8a020]">+{c.marginSeats} margin</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'distortion' && (
            <div className="p-4 space-y-4">
              <p className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-3">Vote share vs seat share</p>
              {distortion.map(r => {
                const maxShare = Math.max(...distortion.flatMap(d => [d.voteShare, d.seatShare]), 1);
                return (
                  <div key={r.party}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:IN_PARTY_MAP[r.party]?.color??'#888'}}/>
                      <span className="text-[11px] text-ink flex-1">{IN_PARTY_MAP[r.party]?.name ?? r.party}</span>
                      <span className="text-[10px] text-ink-3 font-mono">{r.seats} seats</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] text-ink-3 w-9 text-right shrink-0">Votes</span>
                      <div className="flex-1 h-2 rounded overflow-hidden" style={{background:'var(--bar-track)'}}>
                        <div className="h-full rounded opacity-60" style={{ width:`${(r.voteShare/maxShare)*100}%`, background:IN_PARTY_MAP[r.party]?.color??'#888' }}/>
                      </div>
                      <span className="text-[9px] font-mono text-ink-3 w-9">{r.voteShare.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-ink-3 w-9 text-right shrink-0">Seats</span>
                      <div className="flex-1 h-2 rounded overflow-hidden" style={{background:'var(--bar-track)'}}>
                        <div className="h-full rounded" style={{ width:`${(r.seatShare/maxShare)*100}%`, background:IN_PARTY_MAP[r.party]?.color??'#888' }}/>
                      </div>
                      <span className="text-[9px] font-mono text-ink-3 w-9">{r.seatShare.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {tab === 'margin' && (
            <div className="divide-y divide-default">
              {megaSeats.map((c,i) => (
                <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="text-[10px] text-ink-3 w-4 shrink-0 font-mono">{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:IN_PARTY_MAP[c.winner]?.color??'#888'}}/>
                      <span className="text-[11px] text-ink truncate">{c.name}</span>
                    </div>
                    <span className="text-[9px] text-ink-3">{c.seats} seats total</span>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-mono" style={{color:IN_PARTY_MAP[c.winner]?.color??'#888'}}>{c.winnerSeats} seats</div>
                    <div className="text-[9px] font-mono text-ink-3">{((c.winnerSeats/c.seats)*100).toFixed(0)}%</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

// ── Multi-select panel ────────────────────────────────────────────────────────
function InMultiSelectPanel({ selectedIds, byIdMap, currentResults, onResultsChange, onClose }: {
  selectedIds: Set<string>; byIdMap: Map<string,InStateData>; currentResults: Record<string,Record<string,number>>;
  onResultsChange: (id: string, results: Record<string,number>) => void; onClose: () => void;
}) {
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [editingParty, setEditingParty] = useState<string|null>(null);
  const [editValue, setEditValue] = useState('');
  useEffect(() => { setLocked(new Set()); }, [selectedIds]);

  const selected = useMemo(() => [...selectedIds].map(id => byIdMap.get(id)).filter(Boolean) as InStateData[], [selectedIds, byIdMap]);
  const totalValidVotes = useMemo(() => selected.reduce((s,c) => s+c.validVotes, 0), [selected]);
  const aggregateVotes  = useMemo(() => {
    const agg: Record<string,number> = {};
    for (const c of selected) { const results = currentResults[c.id] ?? c.results2024; for (const [pid,votes] of Object.entries(results)) if (votes>0) agg[pid]=(agg[pid]??0)+votes; }
    return agg;
  }, [selected, currentResults]);
  const partyIds = useMemo(() => Object.keys(aggregateVotes).filter(p => aggregateVotes[p]>0).sort((a,b) => aggregateVotes[b]-aggregateVotes[a]), [aggregateVotes]);

  const toggleLock = useCallback((pid: string) => { setLocked(prev => { const n=new Set(prev); n.has(pid)?n.delete(pid):n.add(pid); return n; }); }, []);

  const handleSlider = useCallback((pid: string, newPct: number) => {
    const currentPct = totalValidVotes > 0 ? ((aggregateVotes[pid]??0)/totalValidVotes)*100 : 0;
    const deltaPct = newPct - currentPct;
    for (const c of selected) {
      const results = { ...(currentResults[c.id] ?? c.results2024) };
      const ridingParties = Object.keys(results).filter(p => (results[p]??0)>0);
      const lockedSum = ridingParties.filter(p => p!==pid && locked.has(p)).reduce((s,p) => s+(results[p]??0), 0);
      const available  = Math.max(0, c.validVotes - lockedSum);
      const newVotes   = Math.max(0, Math.min((results[pid]??0)+(deltaPct/100)*c.validVotes, available));
      const remaining  = available - newVotes;
      const unlockedOthers = ridingParties.filter(p => p!==pid && !locked.has(p));
      const unlockedSum    = unlockedOthers.reduce((s,p) => s+(results[p]??0), 0);
      const raw: Record<string,number> = { ...results, [pid]: newVotes };
      if (remaining<1e-9) { for (const p of unlockedOthers) raw[p]=0; }
      else if (unlockedSum>1e-9) { for (const p of unlockedOthers) raw[p]=((results[p]??0)/unlockedSum)*remaining; }
      else if (unlockedOthers.length>0) { for (const p of unlockedOthers) raw[p]=remaining/unlockedOthers.length; }
      const voteSum = Object.values(raw).reduce((s,v) => s+v, 0);
      const newResults: Record<string,number> = {};
      if (voteSum>1e-9) for (const [p,v] of Object.entries(raw)) if (v>1e-9) newResults[p]=Math.round((v/voteSum)*c.validVotes);
      onResultsChange(c.id, newResults);
    }
  }, [selected, currentResults, aggregateVotes, totalValidVotes, locked, onResultsChange]);

  const commitEdit = useCallback((pid: string, raw: string) => {
    const num = parseFloat(raw); if (!isNaN(num)) handleSlider(pid, Math.max(0, Math.min(100, num)));
    setEditingParty(null); setEditValue('');
  }, [handleSlider]);

  const winner = partyIds[0]; const runnerUp = partyIds[1];
  return (
    <aside className="w-72 shrink-0 bg-card border-l border-default flex flex-col overflow-hidden panel-slide">
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-bold text-ink leading-tight">{selectedIds.size} State{selectedIds.size!==1?'s':''}</h1>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{totalValidVotes.toLocaleString()} combined votes</p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        {winner && (
          <div className="mt-2.5 flex items-center gap-2 px-2.5 py-2 rounded-[4px] bg-[#f8f7f4] border border-default">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{background:IN_PARTY_MAP[winner]?.color??'#888'}}/>
            <span className="text-[12px] font-semibold text-ink flex-1 truncate">{IN_PARTY_MAP[winner]?.name??winner}</span>
            <span className="font-mono text-[11px] font-semibold text-ink-2">{totalValidVotes>0?((aggregateVotes[winner]/totalValidVotes)*100).toFixed(1):'0.0'}%</span>
            {runnerUp && <span className="text-[10px] font-mono text-ink-3">+{totalValidVotes>0?(((aggregateVotes[winner]-aggregateVotes[runnerUp])/totalValidVotes)*100).toFixed(1):'0.0'}</span>}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-2.5 thin-scroll space-y-2">
        {partyIds.map(pid => {
          const party = IN_PARTY_MAP[pid]; const votes = aggregateVotes[pid]??0;
          const pct = totalValidVotes>0?(votes/totalValidVotes)*100:0; const isLocked = locked.has(pid);
          return (
            <div key={pid}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:party?.color??'#888'}}/>
                <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{party?.name??pid}</span>
                <button onClick={() => toggleLock(pid)} title={isLocked?'Unlock':'Lock'}
                  className={`w-4 h-4 flex items-center justify-center transition-colors shrink-0 ${isLocked?'text-[#c8a020]':'text-ink-3 hover:text-ink'}`}>
                  {isLocked?<svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                   :<svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>}
                </button>
                {editingParty===pid?(
                  <input type="number" min={0} max={100} step={0.1} value={editValue} autoFocus
                    className="w-12 h-5 text-[10px] font-mono font-semibold tabular-nums text-right px-1 rounded border border-default focus:outline-none bg-white text-ink-2"
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(pid, editValue)}
                    onKeyDown={e => { if(e.key==='Enter'){e.preventDefault();commitEdit(pid,editValue);} if(e.key==='Escape'){setEditingParty(null);setEditValue('');} }}/>
                ):(
                  <span onClick={() => { if (!isLocked) { setEditingParty(pid); setEditValue(pct.toFixed(1)); } }}
                    className="text-[10px] font-mono font-semibold text-ink-2 tabular-nums min-w-[38px] text-right leading-none"
                    style={{cursor:isLocked?'default':'text'}}>
                    {pct.toFixed(1)}%
                  </span>
                )}
              </div>
              <input type="range" min={0} max={100} step={0.1} value={pct} disabled={isLocked}
                onChange={e => handleSlider(pid, parseFloat(e.target.value))}
                className="ca-party-slider w-full"
                style={{'--party-color':party?.color??'#7a7870','--pct':`${pct}%`} as React.CSSProperties}/>
              <div className="text-right text-[9px] font-mono text-ink-3 -mt-0.5">{votes.toLocaleString()}</div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ── Swing panel ───────────────────────────────────────────────────────────────
function InSwingPanel({ exiting=false, stateData, currentResults, onResultsChange, activePreset, onReset, onClose }: {
  exiting?: boolean; stateData: InStateData[]; currentResults: Record<string,Record<string,number>>;
  onResultsChange: (id: string, results: Record<string,number>) => void;
  activePreset: string|null; onReset: () => void; onClose: () => void;
}) {
  const [inputs, setInputs] = useState<Record<string,string>>({});
  const disabled = !activePreset || activePreset==='blank';
  const swingParties = IN_PARTIES.filter(p => p.id !== 'OTH');

  const applySwing = (pid: string) => {
    const val = parseFloat(inputs[pid]??'');
    if (isNaN(val) || val===0) return;
    for (const s of stateData) {
      const results = { ...(currentResults[s.id] ?? s.results2024) };
      const currentVotes = results[pid]??0;
      const deltaVotes   = Math.round((val/100)*s.validVotes);
      const newVotes     = Math.max(0, Math.min(currentVotes+deltaVotes, s.validVotes));
      const actualDelta  = newVotes - currentVotes;
      if (actualDelta===0) continue;
      const others = Object.keys(results).filter(p => p!==pid && (results[p]??0)>0);
      const othersSum = others.reduce((s,p) => s+(results[p]??0), 0);
      const newResults: Record<string,number> = { ...results, [pid]: newVotes };
      if (othersSum>0) for (const p of others) newResults[p]=Math.max(0, Math.round((results[p]??0)-actualDelta*((results[p]??0)/othersSum)));
      onResultsChange(s.id, newResults);
    }
    setInputs(prev => ({ ...prev, [pid]:'' }));
  };

  const compressToTossup = () => {
    for (const s of stateData) {
      const results = { ...(currentResults[s.id] ?? s.results2024) };
      const parties = Object.keys(results).filter(p => (results[p]??0)>0);
      if (!parties.length) continue;
      const total = parties.reduce((s,p) => s+(results[p]??0), 0);
      const equal = total/parties.length;
      const newResults: Record<string,number> = {};
      for (const p of parties) newResults[p]=Math.round(((results[p]??0)+equal)/2);
      onResultsChange(s.id, newResults);
    }
  };

  return (
    <aside className={`w-72 shrink-0 bg-card border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default">
        <h2 className="text-[13px] font-bold text-ink">National swing</h2>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3.5 thin-scroll space-y-4">
        <section>
          <p className="eyebrow mb-2">Quick alliance swing</p>
          <div className="space-y-1.5">
            {swingParties.map(({ id: pid, color }) => {
              const raw=inputs[pid]??''; const valid=!isNaN(parseFloat(raw))&&parseFloat(raw)!==0;
              return (
                <div key={pid} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{background:color}}/>
                  <span className="text-[10px] font-mono text-ink-2 w-14 shrink-0 truncate">{pid}</span>
                  <input type="number" value={raw} placeholder="±pp" disabled={disabled}
                    onChange={e => setInputs(prev => ({...prev,[pid]:e.target.value}))}
                    onKeyDown={e => e.key==='Enter' && applySwing(pid)}
                    className="flex-1 h-6 text-[11px] font-mono rounded-[4px] border border-default bg-white text-ink px-2 text-center focus:outline-none focus:border-strong disabled:opacity-40"/>
                  <button onClick={() => applySwing(pid)} disabled={disabled||!valid}
                    className="h-6 px-2 text-[10px] font-mono font-semibold rounded-[4px] border border-default text-ink-2 hover:bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors">Apply</button>
                </div>
              );
            })}
          </div>
        </section>
        <section>
          <p className="eyebrow mb-2">Scenarios</p>
          <button onClick={compressToTossup} disabled={disabled}
            className="w-full px-3 py-2 text-left rounded-[4px] border border-default hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <p className="text-[11px] font-semibold text-ink">Compress to tossup</p>
            <p className="text-[9px] font-mono text-ink-3 mt-0.5">Moves each state halfway toward equal vote share</p>
          </button>
        </section>
        <section className="pt-2 border-t border-default">
          <button onClick={onReset} disabled={disabled}
            className="w-full h-7 text-[11px] font-mono font-medium rounded-[4px] border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors uppercase tracking-wide">
            Reset to {activePreset==='2026'?'2026 polling':'2024 baseline'}
          </button>
        </section>
      </div>
    </aside>
  );
}

// ── Scoreboard ────────────────────────────────────────────────────────────────
function InScoreboard({ tally, votePcts, rawVotes, activePreset }: {
  tally: Record<string, number>;
  votePcts: Record<string, number>;
  rawVotes: Record<string, number>;
  activePreset: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft += e.deltaY; };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  const sortedParties = useMemo(() => {
    const nonOth = [...IN_PARTIES].filter(p => p.id !== 'OTH');
    nonOth.sort((a, b) => (tally[b.id] ?? 0) - (tally[a.id] ?? 0));
    return [...nonOth, IN_PARTIES.find(p => p.id === 'OTH')!];
  }, [tally]);

  const topSeatPartyId = sortedParties.find(p => (tally[p.id] ?? 0) > 0)?.id ?? null;
  const topSeats       = topSeatPartyId ? (tally[topSeatPartyId] ?? 0) : 0;
  const hasMajority    = topSeats >= IN_MAJORITY;

  return (
    <div className="shrink-0 border-b border-default bg-canvas">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 items-stretch pt-2 pb-2 mx-auto w-fit">
          {sortedParties.map(p => {
            const leader  = (activePreset !== '2024' && IN_LEADERS_2026[p.id]) ? IN_LEADERS_2026[p.id]! : IN_LEADERS[p.id];
            const seats   = tally[p.id] ?? 0;
            const pct     = votePcts[p.id];
            const votes   = rawVotes[p.id];
            const isLeader = p.id === topSeatPartyId;
            const isWinner = isLeader && hasMajority;
            return (
              <div key={p.id} className="relative flex flex-col items-center rounded-[6px] px-2 pt-2.5 pb-2 min-w-[90px] border bg-white"
                style={{ borderColor: isLeader ? p.color : `${p.color}22`,
                  boxShadow: isWinner ? `0 0 0 1.5px ${p.color}, 0 3px 12px rgba(0,0,0,0.09)` : isLeader ? `0 0 0 1px ${p.color}` : undefined,
                  overflow: isWinner ? 'hidden' : undefined, transition: 'border-color 0.15s, box-shadow 0.15s' }}>
                {isWinner && (
                  <div className="absolute inset-0 pointer-events-none z-[2]"
                    style={{ background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.26) 50%, transparent 70%)', animation: 'shimmerSweep 2.2s ease-in-out infinite' }} />
                )}
                <div className="relative">
                  <InLeaderPhotoCircle partyId={p.id} leader={leader} size={52} />
                  {isWinner && (
                    <span className="absolute -bottom-0.5 -right-0.5">
                      <svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="8.5" fill={p.color}/><path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                  )}
                </div>
                <span className="text-[9px] font-sans text-ink-3 mt-1.5 leading-none truncate max-w-full">{leader?.lastName ?? ''}</span>
                <span className="text-[8.5px] font-sans font-bold uppercase tracking-[0.12em] leading-none mt-1 text-ink-3">{p.id}</span>
                <span className="text-[28px] font-display font-black leading-none tabular-nums mt-1" style={{ color: p.color }}>{seats}</span>
                <span className="text-[9.5px] font-sans text-ink-3 leading-none mt-0.5">{pct !== undefined ? `${pct.toFixed(1)}%` : '—'}</span>
                <span className="text-[8px] font-sans text-ink-3 leading-none mt-0.5 opacity-60">
                  <span className="cand-votes-full">{votes !== undefined ? votes.toLocaleString() : '—'}</span>
                  <span className="cand-votes-compact">{votes !== undefined ? fmtVotes(votes) : '—'}</span>
                </span>
                <div className="w-full mt-1.5 h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--bar-track)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(seats, IN_MAJORITY) / IN_MAJORITY * 100}%`, background: p.color }} />
                </div>
              </div>
            );
          })}
          {/* Majority indicator */}
          <div className="flex flex-col items-center justify-center min-w-[60px] px-2">
            <div className="text-[9px] font-mono text-ink-3 uppercase tracking-wide text-center leading-tight">
              Majority<br/><span className="text-[13px] font-bold text-ink">{IN_MAJORITY}</span>
            </div>
            <div className="mt-1 text-[8px] font-mono text-ink-3/60 text-center">{IN_TOTAL} seats</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Simulation panel ──────────────────────────────────────────────────────────
const IN_SIM_ZONES: Record<string, number> = {
  AN:0, LA:0, LD:0, CH:0, SK:0, MZ:0, NL:0, MN:0, TR:0, AR:0, ML:0,
  GA:1, HP:1, UK:1, HR:1, DD:1, PY:1,
  AS:2, JK:2, RJ:2, MP:2, CG:2, OD:2, JH:2, GJ:2, BR:2,
  DL:3, KA:3, TG:3, KL:3, UP:3, MH:3,
  PB:4, WB:4, TN:4, AP:4,
};
const IN_ZONE_WINDOWS: [number,number][] = [
  [0.00, 0.20], [0.12, 0.40], [0.30, 0.75], [0.45, 0.95], [0.65, 1.00],
];

function randNormalIn(): number {
  let u=0,v=0;
  while(u===0) u=Math.random(); while(v===0) v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}

function generateInResult(state: InStateData, targetPcts: Record<string,number>, national2026: Record<string,number>): Record<string,number> {
  const csvData = DATA_IN_2026[state.id];
  const base: Record<string,number> = csvData ? { ...csvData } : { NDA:0.33, INDIA:0.33, OTH:0.34 };
  for (const [pid, targetPct] of Object.entries(targetPcts)) {
    const swing = targetPct/100 - (national2026[pid]??0);
    base[pid] = Math.max(0, (base[pid]??0) + swing);
  }
  const total = Object.values(base).reduce((s,v) => s+v, 0);
  if (total<=0) return { ...state.results2024 };
  const entries = Object.entries(base).sort(([,a],[,b]) => b-a);
  const newResult: Record<string,number> = {};
  let distributed=0;
  for (let i=0;i<entries.length-1;i++) { const [p,v]=entries[i]; newResult[p]=Math.round((v/total)*state.validVotes); distributed+=newResult[p]; }
  const [lastP]=entries[entries.length-1]; newResult[lastP]=Math.max(0,state.validVotes-distributed);
  return newResult;
}

function InSimulationPanel({ exiting=false, stateData, onApplyResults, onUpdateState, onClose, simRunning, simProgress, timersRef, setSimRunning, setSimProgress, stopSim }: {
  exiting?: boolean; stateData: InStateData[];
  onApplyResults: (results: Record<string,Record<string,number>>) => void;
  onUpdateState:  (id: string, results: Record<string,number>) => void;
  onClose: () => void; simRunning: boolean; simProgress: number;
  timersRef: React.MutableRefObject<ReturnType<typeof setTimeout>[]>;
  setSimRunning: (v: boolean) => void; setSimProgress: (v: number) => void;
  stopSim: () => void;
}) {
  const [duration, setDuration] = useState<60000|120000|300000|600000>(120000);
  const [nationalPcts, setNationalPcts] = useState<Record<string,string>>({ NDA:'43', INDIA:'39', OTH:'18' });

  const national2026Avg = useMemo(() => {
    let tNDA=0,tINDIA=0,tOTH=0,tV=0;
    for (const s of stateData) { const d=DATA_IN_2026[s.id]??{NDA:0.43,INDIA:0.39,OTH:0.18}; tNDA+=(d.NDA??0)*s.validVotes; tINDIA+=(d.INDIA??0)*s.validVotes; tOTH+=(d.OTH??0)*s.validVotes; tV+=s.validVotes; }
    return tV===0?{NDA:0.43,INDIA:0.39,OTH:0.18}:{NDA:tNDA/tV,INDIA:tINDIA/tV,OTH:tOTH/tV};
  }, [stateData]);

  const runSim = useCallback(() => {
    if (simRunning) { stopSim(); return; }
    const targetPcts: Record<string,number> = {};
    for (const p of IN_PARTIES) targetPcts[p.id]=parseFloat(nationalPcts[p.id]??'0')||0;
    const totalPct=Object.values(targetPcts).reduce((s,v)=>s+v,0);
    if (totalPct>0) for (const k of Object.keys(targetPcts)) targetPcts[k]=(targetPcts[k]/totalPct)*100;

    const allResults: Record<string,Record<string,number>> = {};
    for (const s of stateData) allResults[s.id]=generateInResult(s,targetPcts,national2026Avg);

    setSimRunning(true); setSimProgress(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stateGroups: InStateData[][] = [[],[],[],[],[]];
    for (const s of stateData) stateGroups[IN_SIM_ZONES[s.id]??2].push(s);

    let countDone=0; const totalBatches=stateData.length*5;
    for (let z=0;z<5;z++) {
      const [startFrac,endFrac]=IN_ZONE_WINDOWS[z]; const group=stateGroups[z];
      for (const state of group) {
        const batchFracs:number[]=[];
        for (let b=0;b<5;b++) {
          const u=randNormalIn()*0.12+startFrac+(b/4)*(endFrac-startFrac);
          batchFracs.push(Math.min(1,Math.max(startFrac,u)));
        }
        batchFracs.sort((a,b)=>a-b);
        const full=allResults[state.id];
        for (let b=0;b<5;b++) {
          const fraction=(b+1)/5; const ms=Math.round(batchFracs[b]*duration);
          const partial:Record<string,number>={};
          for (const [pid,votes] of Object.entries(full)) partial[pid]=Math.round(votes*fraction);
          const t=setTimeout(()=>{ onUpdateState(state.id,partial); countDone++; setSimProgress(Math.min(99,(countDone/totalBatches)*100)); },ms);
          timers.push(t);
        }
      }
    }
    const finalT=setTimeout(()=>{ onApplyResults(allResults); setSimRunning(false); setSimProgress(100); },duration+300);
    timers.push(finalT); timersRef.current=timers;
  }, [simRunning,stopSim,stateData,nationalPcts,duration,national2026Avg,onApplyResults,onUpdateState,setSimRunning,setSimProgress,timersRef]);

  const durationLabels: {v:60000|120000|300000|600000; label:string}[] = [
    {v:60000,label:'1 min'},{v:120000,label:'2 min'},{v:300000,label:'5 min'},{v:600000,label:'10 min'},
  ];

  return (
    <aside className={`w-80 shrink-0 bg-card border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <h2 className="text-[13px] font-bold text-ink">Live Simulation</h2>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3.5 thin-scroll space-y-4">
        <section>
          <p className="eyebrow mb-2">National vote share targets</p>
          {IN_PARTIES.filter(p=>p.id!=='OTH').map(p=>(
            <div key={p.id} className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{background:p.color}}/>
              <span className="text-[10px] font-mono text-ink-2 w-16 shrink-0">{p.name}</span>
              <input type="number" min={0} max={100} step={0.5} value={nationalPcts[p.id]??''}
                onChange={e=>setNationalPcts(prev=>({...prev,[p.id]:e.target.value}))}
                disabled={simRunning}
                className="flex-1 h-6 text-[11px] font-mono rounded-[4px] border border-default bg-white text-ink px-2 text-center focus:outline-none disabled:opacity-50"/>
              <span className="text-[10px] font-mono text-ink-3">%</span>
            </div>
          ))}
          <div className="text-[9px] font-mono text-ink-3/60 mt-1">OTH gets the remainder automatically</div>
        </section>
        <section>
          <p className="eyebrow mb-2">Simulation length</p>
          <div className="grid grid-cols-4 gap-1">
            {durationLabels.map(({v,label})=>(
              <button key={v} disabled={simRunning} onClick={()=>setDuration(v)}
                className={`h-7 text-[10px] font-mono rounded-[4px] border transition-colors disabled:opacity-40 ${duration===v?'border-[#c8a020] bg-[#c8a020] text-white':'border-default text-ink-3 hover:bg-hover hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </div>
        </section>
        {simRunning&&(
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-mono text-ink-3 uppercase tracking-wide">Counting votes…</span>
              <span className="text-[9px] font-mono text-[#c8a020]">{Math.round(simProgress)}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{background:'var(--bar-track)'}}>
              <div className="h-full rounded-full bg-[#c8a020] transition-all" style={{width:`${simProgress}%`}}/>
            </div>
          </section>
        )}
        <button onClick={runSim}
          className={`w-full h-9 rounded-[5px] text-white text-[11px] font-mono font-bold uppercase tracking-wide transition-colors ${simRunning?'bg-red-600 hover:bg-red-700':'bg-[#c8a020] hover:bg-[#b8920e]'}`}>
          {simRunning?'Stop Simulation':'Run Simulation'}
        </button>
        <p className="text-[9px] font-mono text-ink-3/60 leading-relaxed">
          States report in 5 batches each with bell-curve timing. Northeast + small UTs call first; UP, Maharashtra, WB and TN are last. Lock the parties button during simulation.
        </p>
      </div>
    </aside>
  );
}

// ── Tutorial panel ────────────────────────────────────────────────────────────
function InTutorialPanel({ onClose, exiting }: { onClose: () => void; exiting: boolean }) {
  const H2 = ({ children }: { children: React.ReactNode }) => <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-5 mb-1.5 first:mt-0">{children}</div>;
  const P  = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] text-ink leading-relaxed mb-2">{children}</p>;
  const Tag = ({ children, color='bg-ink/8 text-ink' }: { children: React.ReactNode; color?: string }) => <span className={`inline-block px-1.5 py-0.5 rounded-[3px] text-[9px] font-mono font-semibold ${color} mr-1`}>{children}</span>;
  const Note = ({ children }: { children: React.ReactNode }) => <div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{children}</div>;
  return (
    <aside className={`w-80 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">India Lok Sabha Election Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2>India's Lok Sabha</H2>
        <P>India elects <strong>543 Members of Parliament</strong> to the Lok Sabha using <strong>First Past the Post</strong> in single-member constituencies. The alliance that reaches <strong>272+ seats</strong> forms the government.</P>
        <div className="flex gap-2 mb-2">
          <div className="flex-1 bg-muted-bg border border-default rounded-[4px] px-2.5 py-2">
            <div className="text-[9px] font-mono font-bold text-ink uppercase tracking-wide mb-1">543 seats</div>
            <div className="text-[10px] text-ink-2 leading-relaxed">Across 36 states &amp; UTs</div>
          </div>
          <div className="flex-1 bg-muted-bg border border-default rounded-[4px] px-2.5 py-2">
            <div className="text-[9px] font-mono font-bold text-ink uppercase tracking-wide mb-1">272 majority</div>
            <div className="text-[10px] text-ink-2 leading-relaxed">Needed to form government</div>
          </div>
        </div>
        <Note>This simulator models <strong>NDA</strong> (BJP-led) vs <strong>INDIA</strong> (Congress-led) vs <strong>Others</strong>. Seats are allocated proportionally within each state.</Note>
        <H2>The Alliances</H2>
        <P><strong style={{color:'#FF6B1A'}}>NDA</strong> — led by PM Narendra Modi (BJP). Dominates the Hindi belt, Gujarat, northeast.</P>
        <P><strong style={{color:'#1464C8'}}>INDIA</strong> — led by Rahul Gandhi (Congress). Strong in TN (DMK), WB (TMC), KL, MH, UP.</P>
        <H2>Map Presets</H2>
        <div className="space-y-1.5 mb-2">
          <div><Tag>2024 Baseline</Tag><span className="text-[10px] text-ink-2">June 2024 official results — NDA 293, INDIA 234, OTH 16.</span></div>
          <div><Tag>2026 Polling</Tag><span className="text-[10px] text-ink-2">2026 scenario based on post-state-election polling shifts.</span></div>
          <div><Tag>Blank Map</Tag><span className="text-[10px] text-ink-2">All states empty — project results manually.</span></div>
          <div><Tag>Simulation</Tag><span className="text-[10px] text-ink-2">Animated count-night results, state by state.</span></div>
        </div>
        <H2>Editing a State</H2>
        <P>Click any state to open sliders. Adjust alliance vote shares — projected seats update in real-time. Lock an alliance to keep it fixed while adjusting others.</P>
        <Note>On <strong>Blank Map</strong>, click <strong>Make a Projection</strong> to commit a result to the national tally. The projection button must be clicked for results to register.</Note>
        <H2>Other Tools</H2>
        <div className="space-y-1.5 mb-2 text-[10px] text-ink-2 leading-relaxed">
          <div><Tag>Swing</Tag> Apply national vote shift to all states at once.</div>
          <div><Tag>Breakdown</Tag> Region breakdown, closest states, vote vs seat distortion.</div>
          <div><Tag>Parliament</Tag> 543-seat hemicycle, ordered by ideology (left → right).</div>
          <div><Tag>Bubble Map</Tag> Circles sized by raw vote margin (winner − runner-up).</div>
          <div><Tag>Multi-select</Tag> Adjust multiple states simultaneously.</div>
        </div>
        <div className="h-4"/>
      </div>
    </aside>
  );
}

// ── Main India App ─────────────────────────────────────────────────────────────
export default function IndiaApp() {
  const navigate = useNavigate();
  const [dark, setDark]         = useState(() => localStorage.getItem('darkMode') !== 'false');
  const [contributorsOpen, setContributorsOpen] = useState(false);
  const [geojson, setGeojson]   = useState<GeoJsonObject | null>(null);
  const [stateData]             = useState<InStateData[]>(IN_STATE_DATA);
  const [activePreset, setActivePreset] = useState<'2024'|'2026'|'blank'|'sim'|null>(null);
  const [currentResults, setCurrentResults] = useState<Record<string,Record<string,number>>>({});
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [selectedState, setSelectedState]   = useState<SelectedState|null>(null);
  const [bubbleMapMode, setBubbleMapMode]   = useState(false);
  const [tooltip, setTooltip]               = useState<TooltipState>(null);
  const [breakdownOpen, setBreakdownOpen]   = useState(false);
  const [breakdownExiting, setBreakdownExiting] = useState(false);
  const [multiSelectMode, setMultiSelectMode]   = useState(false);
  const [selectedStateIds, setSelectedStateIds] = useState<Set<string>>(new Set());
  const [swingOpen, setSwingOpen]           = useState(false);
  const [swingExiting, setSwingExiting]     = useState(false);
  const [parliamentOpen, setParliamentOpen] = useState(false);
  const [parliamentExiting, setParliamentExiting] = useState(false);
  const [simOpen, setSimOpen]               = useState(false);
  const [simExiting, setSimExiting]         = useState(false);
  const [simRunning, setSimRunning]         = useState(false);
  const [tutorialOpen, setTutorialOpen]     = useState(false);
  const [tutorialExiting, setTutorialExiting] = useState(false);
  const [simProgress, setSimProgress]       = useState(0);
  const simTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stopSim = useCallback(() => {
    for (const t of simTimersRef.current) clearTimeout(t);
    simTimersRef.current = []; setSimRunning(false);
  }, []);

  const headerScrollRef = useRef<HTMLDivElement>(null);
  const layerRef        = useRef<L.GeoJSON | null>(null);
  const containerRef    = useRef<HTMLDivElement>(null);
  const initialLoadRef  = useRef(false);

  const activePresetRef    = useRef(activePreset);
  const currentResultsRef  = useRef(currentResults);
  const byIdMapRef         = useRef<Map<string,InStateData>>(new Map());
  const geoPropsMapRef     = useRef<Map<string,{name_en:string;province:string;seats:number}>>(new Map());
  const selectedStateIdRef = useRef<string|null>(null);
  const bubbleModeRef      = useRef(bubbleMapMode);
  const multiSelectModeRef = useRef(multiSelectMode);

  const byIdMap = useMemo(() => { const m = new Map<string,InStateData>(); for (const s of stateData) m.set(s.id,s); return m; }, [stateData]);
  const geoPropsMap = useMemo(() => {
    if (!geojson) return new Map<string,{name_en:string;province:string;seats:number}>();
    const m = new Map<string,{name_en:string;province:string;seats:number}>();
    for (const f of (geojson as any).features ?? []) {
      const p = f.properties;
      m.set(p.id, { name_en: p.name_en??'', province: p.province??'', seats: p.seats??0 });
    }
    return m;
  }, [geojson]);

  useEffect(() => { activePresetRef.current   = activePreset; },   [activePreset]);
  useEffect(() => { currentResultsRef.current = currentResults; }, [currentResults]);
  useEffect(() => { byIdMapRef.current        = byIdMap; },        [byIdMap]);
  useEffect(() => { geoPropsMapRef.current    = geoPropsMap; },    [geoPropsMap]);
  useEffect(() => { selectedStateIdRef.current = selectedState?.id ?? null; }, [selectedState]);
  useEffect(() => { bubbleModeRef.current     = bubbleMapMode; },  [bubbleMapMode]);
  useEffect(() => { multiSelectModeRef.current = multiSelectMode; }, [multiSelectMode]);

  const selectedStateId = selectedState?.id ?? null;

  // Seat tally — proportional allocation per state
  const tally = useMemo(() => {
    const t: Record<string,number> = {};
    if (!activePreset) return t;
    for (const s of stateData) {
      const results = currentResults[s.id] ?? (activePreset !== 'blank' ? s.results2024 : {});
      if (!Object.keys(results).length) continue;
      const allocated = allocateSeats(results, s.seats);
      for (const [pid,seats] of Object.entries(allocated)) t[pid]=(t[pid]??0)+seats;
    }
    return t;
  }, [activePreset, currentResults, stateData]);

  const votePcts = useMemo(() => {
    const pcts: Record<string,number> = {};
    if (!activePreset) return pcts;
    const totals: Record<string,number> = {}; let grand = 0;
    for (const results of Object.values(currentResults)) { for (const [pid,votes] of Object.entries(results)) { totals[pid]=(totals[pid]??0)+votes; grand+=votes; } }
    if (grand===0) return pcts;
    for (const [pid,votes] of Object.entries(totals)) pcts[pid]=(votes/grand)*100;
    return pcts;
  }, [activePreset, currentResults]);

  const rawVotes = useMemo(() => {
    const totals: Record<string,number> = {};
    if (!activePreset) return totals;
    for (const results of Object.values(currentResults)) for (const [pid,votes] of Object.entries(results)) totals[pid]=(totals[pid]??0)+votes;
    return totals;
  }, [activePreset, currentResults]);

  const bubbleData = useMemo(() => {
    if (!bubbleMapMode || !geojson) return [];
    let maxMargin = 1;
    const items: {id:string;center:[number,number];margin:number;color:string}[] = [];
    for (const feature of (geojson as any).features ?? []) {
      const id: string = feature.properties?.id ?? '';
      const data = byIdMap.get(id); if (!data) continue;
      const results = currentResults[id] ?? (activePreset && activePreset!=='sim' ? data.results2024 : {});
      const sorted = Object.values(results).filter((v):v is number => v>0).sort((a,b) => b-a);
      if (!sorted.length) continue;
      const margin = sorted.length>=2 ? sorted[0]-sorted[1] : sorted[0];
      if (margin>maxMargin) maxMargin=margin;
      const fill = (activePreset&&(activePreset!=='blank'||!!currentResults[id])) ? stateFill(results,dark) : (dark?'#374151':BLANK_COLOR);
      items.push({id, center:computeCentroid(feature.geometry), margin, color:fill});
    }
    return items.map(it => ({ ...it, radius: 1.5+Math.sqrt(it.margin/maxMargin)*12 }));
  }, [bubbleMapMode, geojson, currentResults, activePreset, byIdMap, dark]);

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); localStorage.setItem('darkMode', String(dark)); }, [dark]);

  useEffect(() => {
    const el = headerScrollRef.current; if (!el) return;
    const h = (e: WheelEvent) => { if (Math.abs(e.deltaX)>Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft+=e.deltaY; };
    el.addEventListener('wheel', h, {passive:false}); return () => el.removeEventListener('wheel', h);
  }, []);

  useEffect(() => { fetch(`${import.meta.env.BASE_URL}india-states.geojson`).then(r=>r.json()).then(setGeojson).catch(console.error); }, []);

  // Re-style map on state change
  useEffect(() => {
    if (!layerRef.current) return;
    if (bubbleMapMode) { layerRef.current.setStyle(() => ({fillOpacity:0, weight:0.4, color:dark?'#666':'#bbb', opacity:0.6})); return; }
    const baseColor = dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.35)';
    layerRef.current.eachLayer((layer: L.Layer) => {
      const path = layer as L.Path & {feature?:Feature};
      const id = (path.feature?.properties as Record<string,string>|undefined)?.id ?? '';
      const isSelected = id===selectedStateId || selectedStateIds.has(id);
      let fillColor = dark?'#374151':BLANK_COLOR;
      if (activePreset==='blank') { const r=currentResults[id]; const d=byIdMap.get(id); if(r&&d&&Object.values(r).some(v=>v>0)) fillColor=stateFill(r,dark); }
      else if (activePreset) { const r=currentResults[id]??byIdMap.get(id)?.results2024; if(r) fillColor=stateFill(r,dark); }
      path.setStyle({ fillColor, fillOpacity:0.72, color:isSelected?'#c8a020':baseColor, weight:isSelected?2:0.5, opacity:1 });
    });
  }, [activePreset, currentResults, selectedStateId, selectedStateIds, byIdMap, bubbleMapMode, dark, geojson]);

  // Preset loaders
  const load2024 = useCallback(() => {
    const results: Record<string,Record<string,number>> = {};
    for (const s of byIdMapRef.current.values()) results[s.id]={...s.results2024};
    setCurrentResults(results); setActivePreset('2024');
  }, []);

  const load2026 = useCallback(() => {
    const data = [...byIdMapRef.current.values()];
    const results: Record<string,Record<string,number>> = {};
    for (const s of data) {
      const pcts = DATA_IN_2026[s.id];
      if (!pcts) { results[s.id]={...s.results2024}; continue; }
      const newR: Record<string,number> = {}; let assigned=0;
      for (const [pid,frac] of Object.entries(pcts)) { const v=Math.round(frac*s.validVotes); newR[pid]=v; assigned+=v; }
      const diff = s.validVotes-assigned;
      const top = Object.entries(newR).sort(([,a],[,b])=>b-a)[0]?.[0];
      if (top&&diff!==0) newR[top]=(newR[top]??0)+diff;
      results[s.id]=newR;
    }
    setCurrentResults(results); setActivePreset('2026');
  }, []);

  const loadBlank = useCallback(() => { setCurrentResults({}); setActivePreset('blank'); setSelectedState(null); }, []);

  useEffect(() => {
    if (stateData.length>0 && geojson && !initialLoadRef.current) { initialLoadRef.current=true; loadBlank(); }
  }, [stateData, geojson, loadBlank]);

  const handleStateResultsChange = useCallback((stateId: string, newResults: Record<string,number>) => {
    setCurrentResults(prev => ({...prev,[stateId]:newResults}));
  }, []);

  const toggleBreakdown  = useCallback(() => { if(breakdownOpen){setBreakdownExiting(true);setTimeout(()=>{setBreakdownOpen(false);setBreakdownExiting(false);},260);}else{setBreakdownOpen(true);setBreakdownExiting(false);} },[breakdownOpen]);
  const toggleSwing      = useCallback(() => { if(swingOpen){setSwingExiting(true);setTimeout(()=>{setSwingOpen(false);setSwingExiting(false);},260);}else{setSwingOpen(true);setSwingExiting(false);} },[swingOpen]);
  const toggleParliament = useCallback(() => { if(parliamentOpen){setParliamentExiting(true);setTimeout(()=>{setParliamentOpen(false);setParliamentExiting(false);},260);}else{setParliamentOpen(true);setParliamentExiting(false);} },[parliamentOpen]);
  const toggleSim        = useCallback(() => { if(simOpen){setSimExiting(true);setTimeout(()=>{setSimOpen(false);setSimExiting(false);},260);}else{setSimOpen(true);setSimExiting(false);} },[simOpen]);

  const handleSimApplyResults = useCallback((results: Record<string,Record<string,number>>) => { setCurrentResults(results); setActivePreset('sim'); }, []);

  // Map event handlers
  const handleEachFeature = useCallback((_feature: Feature, layer: L.Layer) => {
    const props = (_feature as Feature & {properties:Record<string,string|number>}).properties;
    const id = String(props.id ?? '');
    layer.on('click', () => {
      if (multiSelectModeRef.current) { setSelectedStateIds(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;}); return; }
      setSelectedState({ id, name_en: String(props.name_en??''), province: String(props.province??'') });
    });
    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (bubbleModeRef.current||multiSelectModeRef.current) { setTooltip(null); return; }
      const data = byIdMapRef.current.get(id); const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const preset = activePresetRef.current;
      const rawResults = (preset==='2024'||preset==='2026'||preset==='sim'||preset==='blank') ? (currentResultsRef.current[id]??{}) : {};
      const totalRep = Object.values(rawResults).reduce((s,v)=>s+v,0);
      const allocated = Object.keys(rawResults).length ? allocateSeats(rawResults, data?.seats??1) : {};
      const parties = Object.entries(rawResults).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a)
        .map(([pid,votes])=>({ id:pid, votes, pct:totalRep>0?Math.round((votes/totalRep)*1000)/10:0, seats:allocated[pid]??0 }));
      const reportingPct = preset==='sim'&&data&&data.validVotes>0 ? (totalRep/data.validVotes)*100 : undefined;
      setTooltip({
        x: e.originalEvent.clientX-rect.left, y: e.originalEvent.clientY-rect.top,
        name_en: String(props.name_en??''), province: String(props.province??''),
        seats: data?.seats??0, electorate: data?.electorate??0, validVotes: data?.validVotes??0,
        parties, reportingPct,
      });
    });
    layer.on('mouseout', () => setTooltip(null));
  }, []);

  const geoStyle = useCallback((): L.PathOptions => ({
    fillColor: dark?'#374151':BLANK_COLOR, fillOpacity:0.72,
    color: dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.35)', weight:0.5, opacity:1,
  }), [dark]);

  const dataReady = !!geojson;
  const btnBase     = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnMuted    = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed`;
  const btnInactive = btnMuted;
  const btn2024Class  = activePreset==='2024'  ? `${btnBase} border-[#FF6B1A] bg-[#FF6B1A] text-white` : btnMuted;
  const btn2026Class  = activePreset==='2026'  ? `${btnBase} border-[#4F46E5] bg-[#4F46E5] text-white` : btnMuted;
  const btnBlankClass = activePreset==='blank' ? `${btnBase} border-[#c8a020] bg-[#c8a020] text-white` : btnMuted;
  const btnBubbleClass = bubbleMapMode ? `${btnBase} border-[#c8a020] bg-[#c8a020] text-white` : btnInactive;

  const selResults     = selectedStateId ? currentResults[selectedStateId] : undefined;
  const selValidVotes  = selectedStateId ? byIdMap.get(selectedStateId)?.validVotes : undefined;
  const selSeats       = selectedStateId ? byIdMap.get(selectedStateId)?.seats : undefined;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="in">
      {/* Topbar */}
      <header className={`h-[52px] ${dark?'bg-[rgba(7,13,28,0.94)]':'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
        </button>
        <div ref={headerScrollRef} className="flex-1 min-w-0 header-scroll-strip flex items-center gap-2 px-2">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <span className="text-[11px] font-mono font-bold text-ink-3 uppercase tracking-wide shrink-0">🇮🇳 India</span>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={load2024}  disabled={!dataReady} className={btn2024Class}>2024 Baseline</button>
          <button onClick={load2026}  disabled={!dataReady} className={btn2026Class}>2026 Polling</button>
          <button onClick={loadBlank}                       className={btnBlankClass}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={toggleSim}
            className={`${btnBase} flex items-center gap-1.5 ${simOpen?'border-[#c8a020] bg-[#c8a020] text-white':btnInactive}`}>
            <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor"><path d="M1 1.2L6 4L1 6.8V1.2Z" strokeLinejoin="round"/></svg>
            Simulation
          </button>
          <button onClick={() => { if(multiSelectMode){setMultiSelectMode(false);setSelectedStateIds(new Set());}else{setMultiSelectMode(true);setSelectedState(null);} }}
            className={multiSelectMode?`${btnBase} border-[#c8a020] bg-[#c8a020] text-white`:btnMuted}>
            {multiSelectMode?`⊕ ${selectedStateIds.size} sel.`:'Multi-select'}
          </button>
          {activePreset!=='blank'&&activePreset!==null&&(
            <button onClick={toggleSwing} className={swingOpen?`${btnBase} border-[#c8a020] bg-[#c8a020] text-white`:btnMuted}>Swing</button>
          )}
          <button onClick={toggleBreakdown}  className={breakdownOpen?`${btnBase} border-[#c8a020] bg-[#c8a020] text-white`:btnMuted}>Breakdown</button>
          <button onClick={toggleParliament} disabled={!dataReady} className={parliamentOpen?`${btnBase} border-[#c8a020] bg-[#c8a020] text-white`:btnMuted}>Parliament</button>
          <button onClick={()=>setBubbleMapMode(v=>!v)} className={btnBubbleClass}>Bubble Map</button>
          <button onClick={()=>setTutorialOpen(v=>!v)} className={tutorialOpen?`${btnBase} border-[#c8a020] bg-[#c8a020] text-white`:btnMuted}>Tutorial</button>
        </div>
        <div className="shrink-0 flex items-center gap-2.5 pr-4">
          <div className="relative">
            <button onClick={()=>setContributorsOpen(o=>!o)}
              className={`w-7 h-7 flex items-center justify-center rounded-[4px] border transition-colors ${contributorsOpen?'border-ink-3 text-ink bg-hover':'border-default text-ink-3 hover:border-ink-3 hover:text-ink'}`} title="Contributors">
              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm10-9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm1.5 7.5c.5-.25.5-.75.5-1s-.5-3-3-3.5a2.5 2.5 0 0 1 2.5 4.5z" fillRule="evenodd" clipRule="evenodd"/></svg>
            </button>
            {contributorsOpen&&(<>
              <div className="fixed inset-0 z-[99]" onClick={()=>setContributorsOpen(false)}/>
              <div className="absolute right-0 top-[calc(100%+6px)] z-[100] w-52 rounded-[10px] bg-white border border-default overflow-hidden" style={{boxShadow:'0 8px 32px rgba(0,0,0,0.13)'}}>
                <div className="px-3.5 pt-3 pb-2 border-b border-default"><div className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-ink">Contributors</div></div>
                <div className="px-3.5 py-2.5">
                  <a href="https://x.com/realleochang" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-ink-3"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.66zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    <span className="text-[11px] font-mono font-semibold text-ink">@realleochang</span>
                  </a>
                </div>
              </div>
            </>)}
          </div>
          <button onClick={()=>setDark(d=>!d)}
            className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors"
            title={dark?'Light mode':'Dark mode'}>
            {dark?(
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2.7" stroke="currentColor" strokeWidth="1.4" fill="none"/><line x1="7" y1="0.5" x2="7" y2="2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="7" y1="11.8" x2="7" y2="13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="0.5" y1="7" x2="2.2" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="11.8" y1="7" x2="13.5" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="2.5" y1="2.5" x2="3.6" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="10.4" y1="10.4" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="11.5" y1="2.5" x2="10.4" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="3.6" y1="10.4" x2="2.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            ):(
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M11 7.8A5.5 5.5 0 0 1 5.2 2a5.5 5.5 0 1 0 5.8 5.8z" stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinejoin="round"/></svg>
            )}
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex flex-col flex-1 min-h-0 relative">
        <div className="relative shrink-0">
          <div style={{ display:'grid', gridTemplateRows:scoreboardVisible?'1fr':'0fr', transition:'grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1)' }}>
            <div className="overflow-hidden">
              <InScoreboard tally={tally} votePcts={votePcts} rawVotes={rawVotes} activePreset={activePreset}/>
            </div>
          </div>
          <button onClick={()=>setScoreboardVisible(v=>!v)}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-[1001] h-4 px-3 rounded-full bg-white border border-default shadow-sm hover:bg-hover text-ink-3 hover:text-ink transition-colors flex items-center gap-1">
            <svg width="8" height="5" viewBox="0 0 8 5" fill="none">
              {scoreboardVisible?<path d="M7 4L4 1L1 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>:<path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>}
            </svg>
            <span className="text-[7.5px] font-mono uppercase tracking-wider leading-none">{scoreboardVisible?'Hide':'Results'}</span>
          </button>
        </div>

        <div className="flex flex-1 min-h-0 relative">
          {(parliamentOpen||parliamentExiting)&&(
            <InParliamentPanel tally={tally} exiting={parliamentExiting} onClose={toggleParliament}/>
          )}
          <div className="flex-1 min-w-0 relative">
            {geojson ? (
              <div ref={containerRef} className="relative w-full h-full">
                <MapContainer style={{width:'100%',height:'100%'}} center={[20.5937,78.9629]} zoom={4} zoomControl={true} attributionControl={false}>
                  <TileLayer key={dark?'dark':'light'}
                    url={dark?'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png':'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
                    attribution='&copy; OpenStreetMap &copy; CARTO' subdomains="abcd" maxZoom={20} updateWhenZooming={false} updateWhenIdle={true}/>
                  <InMapController layerRef={layerRef}/>
                  <GeoJSON key="india" data={geojson} style={geoStyle} onEachFeature={handleEachFeature} ref={layerRef as any} {...({smoothFactor:0} as any)}/>
                  {bubbleMapMode && bubbleData.map(b => (
                    <CircleMarker key={`${b.id}-${simRunning}`} center={b.center} radius={b.radius}
                      pathOptions={{fillColor:b.color,fillOpacity:0.85,color:'rgba(255,255,255,0.7)',weight:0.6,opacity:0.9}}
                      eventHandlers={{
                        click: () => { if(multiSelectModeRef.current){setSelectedStateIds(prev=>{const n=new Set(prev);n.has(b.id)?n.delete(b.id):n.add(b.id);return n;});return;} const geo=geoPropsMapRef.current.get(b.id); if(geo) setSelectedState({id:b.id,...geo}); },
                        mousemove: (e) => {
                          if(multiSelectModeRef.current){setTooltip(null);return;}
                          const data=byIdMapRef.current.get(b.id); const geo=geoPropsMapRef.current.get(b.id); const rect=containerRef.current?.getBoundingClientRect();
                          if(!data||!geo||!rect) return;
                          const preset=activePresetRef.current;
                          const rawResults=(preset==='2024'||preset==='2026'||preset==='sim'||preset==='blank')?(currentResultsRef.current[b.id]??{}):{};
                          const totalRep=Object.values(rawResults).reduce((s,v)=>s+v,0);
                          const allocated=Object.keys(rawResults).length?allocateSeats(rawResults,data.seats):{};
                          const parties=Object.entries(rawResults).filter(([,v])=>v>0).sort(([,a],[,bv])=>bv-a).map(([pid,votes])=>({id:pid,votes,pct:totalRep>0?Math.round((votes/totalRep)*1000)/10:0,seats:allocated[pid]??0}));
                          const reportingPct=preset==='sim'&&data.validVotes>0?(totalRep/data.validVotes)*100:undefined;
                          const lme=e as L.LeafletMouseEvent;
                          setTooltip({x:lme.originalEvent.clientX-rect.left,y:lme.originalEvent.clientY-rect.top,name_en:geo.name_en,province:geo.province,seats:data.seats,electorate:data.electorate,validVotes:data.validVotes,parties,reportingPct});
                        },
                        mouseout: () => setTooltip(null),
                      }}/>
                  ))}
                  <MapFitter geojson={geojson}/>
                </MapContainer>
                {tooltip && containerRef.current && (
                  <InMapTooltip tooltip={tooltip} containerW={containerRef.current.clientWidth} containerH={containerRef.current.clientHeight} dark={dark}/>
                )}
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-[11px] font-mono text-ink-3 uppercase tracking-wider animate-pulse">Loading India map…</span>
              </div>
            )}
          </div>

          {!multiSelectMode && selectedState && (
            <InStatePanel {...selectedState} seats={selSeats??1} results={selResults} results2024={byIdMap.get(selectedState.id)?.results2024} validVotes={selValidVotes}
              activePreset={activePreset} onClose={()=>setSelectedState(null)}
              onResultsChange={handleStateResultsChange}/>
          )}
          {multiSelectMode && selectedStateIds.size>0 && (
            <InMultiSelectPanel selectedIds={selectedStateIds} byIdMap={byIdMap} currentResults={currentResults}
              onResultsChange={handleStateResultsChange} onClose={()=>{setMultiSelectMode(false);setSelectedStateIds(new Set());}}/>
          )}
          {(swingOpen||swingExiting)&&(
            <InSwingPanel exiting={swingExiting} stateData={stateData} currentResults={currentResults}
              onResultsChange={handleStateResultsChange} activePreset={activePreset}
              onReset={activePreset==='2026'?load2026:load2024} onClose={toggleSwing}/>
          )}
          {(breakdownOpen||breakdownExiting)&&(
            <InBreakdownDrawer stateData={stateData} currentResults={currentResults} activePreset={activePreset} exiting={breakdownExiting} onClose={toggleBreakdown}/>
          )}
          {(simOpen||simExiting)&&(
            <InSimulationPanel exiting={simExiting} stateData={stateData}
              onApplyResults={handleSimApplyResults} onUpdateState={handleStateResultsChange}
              onClose={toggleSim} simRunning={simRunning} simProgress={simProgress}
              timersRef={simTimersRef} setSimRunning={setSimRunning} setSimProgress={setSimProgress} stopSim={stopSim}/>
          )}
          {(tutorialOpen||tutorialExiting)&&(
            <InTutorialPanel onClose={()=>{setTutorialExiting(true);setTimeout(()=>{setTutorialExiting(false);setTutorialOpen(false);},280);}} exiting={tutorialExiting}/>
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-30 flex items-center justify-between px-3 py-1 bg-ink/60">
          <span className="text-[10px] text-white/70 font-mono tracking-wide uppercase">Global Election Simulator — India Lok Sabha Edition</span>
          <span className="text-[10px] text-white/40 font-mono">{typeof window!=='undefined'?window.location.hostname:''}</span>
        </div>
      </div>
    </div>
  );
}
