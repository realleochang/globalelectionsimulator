import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import type { GeoJsonObject, Feature } from 'geojson';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── Japanese parties ──────────────────────────────────────────────────────────
const JP_PARTIES = [
  { id: 'LDP',    name: '自民党 LDP',    color: '#C62828' },
  { id: 'KOM',    name: 'Komeito',       color: '#F57F17' },
  { id: 'CDP',    name: '立憲 CDP',      color: '#1565C0' },
  { id: 'ISHIN',  name: '維新 Ishin',    color: '#00897B' },
  { id: 'DPP',    name: '国民 DPP',      color: '#E65100' },
  { id: 'JCP',    name: '共産 JCP',      color: '#B71C1C' },
  { id: 'REIWA',  name: 'れいわ Reiwa',  color: '#AD1457' },
  { id: 'OTH',    name: 'Others',        color: '#616161' },
] as const;

const JP_PARTY_MAP = Object.fromEntries(JP_PARTIES.map(p => [p.id, p])) as Record<string, typeof JP_PARTIES[number]>;

// ── Leaders ───────────────────────────────────────────────────────────────────
type LeaderInfo = { lastName: string; wikiTitle?: string; localImage?: string; scale?: number; transformOrigin?: string; objectPosition?: string; initials?: string };

const JP_LEADERS: Record<string, LeaderInfo> = {
  LDP:   { lastName: 'Ishiba',   wikiTitle: 'Shigeru Ishiba',       objectPosition: '50% 12%' },
  KOM:   { lastName: 'Ishii',    wikiTitle: 'Keiichi Ishii',        objectPosition: '50% 12%' },
  CDP:   { lastName: 'Noda',     wikiTitle: 'Yoshihiko Noda',       objectPosition: '50% 10%' },
  ISHIN: { lastName: 'Baba',     wikiTitle: 'Nobuyuki Baba',        objectPosition: '50% 10%' },
  DPP:   { lastName: 'Tamaki',   wikiTitle: 'Yuichiro Tamaki',      objectPosition: '50% 12%' },
  JCP:   { lastName: 'Tamura',   wikiTitle: 'Tomoko Tamura',        objectPosition: '50% 10%' },
  REIWA: { lastName: 'Yamamoto', wikiTitle: 'Taro Yamamoto (politician)', objectPosition: '50% 8%' },
  OTH:   { lastName: 'Others',   initials: 'OTH' },
};

const JP_LEADERS_2026: Partial<Record<string, LeaderInfo>> = {};

function JpLeaderPhotoCircle({ partyId, leader, size = 52 }: { partyId: string; leader?: LeaderInfo; size?: number }) {
  const color = JP_PARTY_MAP[partyId]?.color ?? '#888888';
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
          objectPosition: leader?.objectPosition ?? 'center top', borderRadius: '50%',
          transform: `scale(${leader?.scale ?? 1})`, transformOrigin: leader?.transformOrigin ?? '50% 20%',
        }} onError={() => setPhotoUrl(null)} />
      ) : (
        <span className="font-mono font-bold text-center leading-none" style={{ fontSize: size * 0.34, color }}>{initials}</span>
      )}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface JpPrefData {
  id: string; name: string; nameJa: string; province: string;
  seats: number; electorate: number; validVotes: number;
  results2024: Record<string, number>;
  winner2024: string;
}

interface SelectedPref { id: string; name_en: string; province: string; }

type TooltipState = {
  x: number; y: number; name_en: string; nameJa?: string; province: string;
  seats: number; electorate: number; validVotes: number;
  parties: { id: string; votes: number; pct: number; seats: number }[];
  reportingPct?: number;
} | null;

// ── Helpers ───────────────────────────────────────────────────────────────────
const BLANK_COLOR = '#E5E7EB';

function prefFill(results: Record<string, number>, dark = false): string {
  const sorted = Object.entries(results).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  if (!sorted.length) return dark ? '#374151' : BLANK_COLOR;
  const [winnerId, winnerVotes] = sorted[0];
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const runnerUp = sorted[1]?.[1] ?? 0;
  const margin = total > 0 ? ((winnerVotes - runnerUp) / total) * 100 : 0;
  const baseColor = JP_PARTY_MAP[winnerId]?.color ?? '#888888';
  const t = Math.min(Math.max(margin / 30, 0), 1);
  const lightness = dark ? 55 - t * (55 - 28) : 82 - t * (82 - 38);
  const c = hsl(baseColor); c.l = lightness / 100;
  return c.formatHex() as string;
}

function computeCentroid(geometry: any): [number, number] {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const visit = (c: any) => {
    if (typeof c[0] === 'number') { if(c[1]<minLat)minLat=c[1];if(c[1]>maxLat)maxLat=c[1];if(c[0]<minLng)minLng=c[0];if(c[0]>maxLng)maxLng=c[0]; }
    else { for (const ch of c) visit(ch); }
  };
  visit(geometry.coordinates);
  if (!isFinite(minLat)) return [0, 0];
  return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
}

function MapFitter({ geojson }: { geojson: GeoJsonObject }) {
  const map = useMap();
  useEffect(() => {
    try { const layer = L.geoJSON(geojson); const bounds = layer.getBounds(); if (bounds.isValid()) map.fitBounds(bounds, { padding: [10, 10] }); }
    catch { /* ignore */ }
  }, [map, geojson]);
  return null;
}

function JpMapController({ layerRef }: { layerRef: { current: L.GeoJSON | null } }) {
  const map = useMap();
  useEffect(() => {
    const onZoomEnd = () => { if (layerRef.current) layerRef.current.eachLayer((l: L.Layer) => { const p = l as any; if (p.options) p.options.smoothFactor = 0; }); };
    map.on('zoomend', onZoomEnd); return () => { map.off('zoomend', onZoomEnd); };
  }, [map, layerRef]);
  return null;
}

function fmtVotes(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return n.toString();
}

// ── Seat allocation (Largest Remainder) ───────────────────────────────────────
function allocateSeats(results: Record<string, number>, totalSeats: number): Record<string, number> {
  const total = Object.values(results).reduce((s, v) => s + v, 0);
  if (total === 0 || totalSeats === 0) return {};
  const parties = Object.entries(results).filter(([, v]) => v > 0);
  const quotas = parties.map(([id, votes]) => {
    const quota = (votes / total) * totalSeats;
    return { id, floor: Math.floor(quota), remainder: quota - Math.floor(quota) };
  });
  const remaining = totalSeats - quotas.reduce((s, q) => s + q.floor, 0);
  quotas.sort((a, b) => b.remainder - a.remainder);
  const result: Record<string, number> = {};
  for (let i = 0; i < quotas.length; i++) result[quotas[i].id] = quotas[i].floor + (i < remaining ? 1 : 0);
  return result;
}

// ── Japan 2024 election baseline (Wikipedia-verified) ────────────────────────
// Seat results: 465 total | LDP 191 · CDP 148 · Ishin 38 · DPP 28 · KOM 24 · Reiwa 9 · JCP 8 · OTH 19
// National PR vote shares: LDP 26.7% · CDP 21.2% · DPP 11.3% · KOM 10.9% · Ishin 9.4% · Reiwa 9.0% · JCP 6.2% · OTH 5.3%

// Per-prefecture vote share fractions (approximate, based on regional political patterns)
const VOTE_2024: Record<string, Record<string, number>> = {
  '01':{ LDP:0.325, KOM:0.080, CDP:0.280, ISHIN:0.060, DPP:0.095, JCP:0.055, REIWA:0.065, OTH:0.040 }, // Hokkaido - CDP strong
  '02':{ LDP:0.370, KOM:0.095, CDP:0.255, ISHIN:0.040, DPP:0.090, JCP:0.045, REIWA:0.055, OTH:0.050 }, // Aomori
  '03':{ LDP:0.320, KOM:0.075, CDP:0.330, ISHIN:0.035, DPP:0.085, JCP:0.060, REIWA:0.060, OTH:0.035 }, // Iwate - CDP (Ozawa)
  '04':{ LDP:0.340, KOM:0.085, CDP:0.280, ISHIN:0.050, DPP:0.100, JCP:0.055, REIWA:0.060, OTH:0.030 }, // Miyagi
  '05':{ LDP:0.390, KOM:0.090, CDP:0.270, ISHIN:0.035, DPP:0.085, JCP:0.045, REIWA:0.055, OTH:0.030 }, // Akita
  '06':{ LDP:0.370, KOM:0.085, CDP:0.285, ISHIN:0.040, DPP:0.090, JCP:0.050, REIWA:0.055, OTH:0.025 }, // Yamagata
  '07':{ LDP:0.340, KOM:0.085, CDP:0.295, ISHIN:0.045, DPP:0.095, JCP:0.060, REIWA:0.055, OTH:0.025 }, // Fukushima
  '08':{ LDP:0.355, KOM:0.095, CDP:0.250, ISHIN:0.055, DPP:0.110, JCP:0.050, REIWA:0.065, OTH:0.020 }, // Ibaraki
  '09':{ LDP:0.365, KOM:0.095, CDP:0.250, ISHIN:0.055, DPP:0.105, JCP:0.050, REIWA:0.060, OTH:0.020 }, // Tochigi
  '10':{ LDP:0.380, KOM:0.095, CDP:0.245, ISHIN:0.055, DPP:0.095, JCP:0.050, REIWA:0.055, OTH:0.025 }, // Gunma - LDP stronghold
  '11':{ LDP:0.330, KOM:0.110, CDP:0.265, ISHIN:0.080, DPP:0.110, JCP:0.055, REIWA:0.080, OTH:0.030 }, // Saitama
  '12':{ LDP:0.340, KOM:0.105, CDP:0.270, ISHIN:0.075, DPP:0.105, JCP:0.055, REIWA:0.080, OTH:0.030 }, // Chiba
  '13':{ LDP:0.260, KOM:0.095, CDP:0.270, ISHIN:0.125, DPP:0.115, JCP:0.065, REIWA:0.095, OTH:0.035 }, // Tokyo - highly competitive
  '14':{ LDP:0.320, KOM:0.100, CDP:0.270, ISHIN:0.095, DPP:0.110, JCP:0.060, REIWA:0.085, OTH:0.030 }, // Kanagawa
  '15':{ LDP:0.355, KOM:0.085, CDP:0.280, ISHIN:0.045, DPP:0.095, JCP:0.055, REIWA:0.060, OTH:0.025 }, // Niigata
  '16':{ LDP:0.395, KOM:0.100, CDP:0.240, ISHIN:0.050, DPP:0.095, JCP:0.045, REIWA:0.050, OTH:0.025 }, // Toyama - LDP
  '17':{ LDP:0.385, KOM:0.100, CDP:0.235, ISHIN:0.055, DPP:0.100, JCP:0.050, REIWA:0.050, OTH:0.025 }, // Ishikawa
  '18':{ LDP:0.400, KOM:0.095, CDP:0.240, ISHIN:0.050, DPP:0.090, JCP:0.045, REIWA:0.050, OTH:0.030 }, // Fukui
  '19':{ LDP:0.375, KOM:0.090, CDP:0.265, ISHIN:0.055, DPP:0.095, JCP:0.050, REIWA:0.060, OTH:0.010 }, // Yamanashi
  '20':{ LDP:0.345, KOM:0.085, CDP:0.290, ISHIN:0.060, DPP:0.095, JCP:0.055, REIWA:0.065, OTH:0.005 }, // Nagano - CDP competitive
  '21':{ LDP:0.370, KOM:0.095, CDP:0.250, ISHIN:0.065, DPP:0.100, JCP:0.055, REIWA:0.060, OTH:0.005 }, // Gifu
  '22':{ LDP:0.355, KOM:0.090, CDP:0.260, ISHIN:0.070, DPP:0.105, JCP:0.055, REIWA:0.065, OTH:0.000 }, // Shizuoka
  '23':{ LDP:0.330, KOM:0.095, CDP:0.255, ISHIN:0.090, DPP:0.115, JCP:0.055, REIWA:0.075, OTH:0.035 }, // Aichi - DPP/CDP competitive
  '24':{ LDP:0.340, KOM:0.090, CDP:0.285, ISHIN:0.065, DPP:0.100, JCP:0.060, REIWA:0.060, OTH:0.000 }, // Mie - CDP
  '25':{ LDP:0.330, KOM:0.090, CDP:0.295, ISHIN:0.075, DPP:0.095, JCP:0.060, REIWA:0.055, OTH:0.000 }, // Shiga - CDP
  '26':{ LDP:0.310, KOM:0.090, CDP:0.255, ISHIN:0.175, DPP:0.090, JCP:0.065, REIWA:0.015, OTH:0.000 }, // Kyoto - Ishin rising
  '27':{ LDP:0.205, KOM:0.115, CDP:0.140, ISHIN:0.430, DPP:0.060, JCP:0.040, REIWA:0.010, OTH:0.000 }, // Osaka - Ishin dominates
  '28':{ LDP:0.290, KOM:0.095, CDP:0.210, ISHIN:0.275, DPP:0.075, JCP:0.050, REIWA:0.005, OTH:0.000 }, // Hyogo - Ishin strong
  '29':{ LDP:0.330, KOM:0.095, CDP:0.265, ISHIN:0.135, DPP:0.095, JCP:0.060, REIWA:0.020, OTH:0.000 }, // Nara
  '30':{ LDP:0.365, KOM:0.090, CDP:0.240, ISHIN:0.120, DPP:0.095, JCP:0.055, REIWA:0.035, OTH:0.000 }, // Wakayama
  '31':{ LDP:0.415, KOM:0.100, CDP:0.235, ISHIN:0.055, DPP:0.095, JCP:0.045, REIWA:0.055, OTH:0.000 }, // Tottori - LDP rural
  '32':{ LDP:0.420, KOM:0.095, CDP:0.240, ISHIN:0.050, DPP:0.085, JCP:0.045, REIWA:0.065, OTH:0.000 }, // Shimane - LDP
  '33':{ LDP:0.370, KOM:0.095, CDP:0.250, ISHIN:0.075, DPP:0.100, JCP:0.055, REIWA:0.055, OTH:0.000 }, // Okayama
  '34':{ LDP:0.350, KOM:0.090, CDP:0.245, ISHIN:0.090, DPP:0.100, JCP:0.060, REIWA:0.065, OTH:0.000 }, // Hiroshima
  '35':{ LDP:0.410, KOM:0.090, CDP:0.235, ISHIN:0.065, DPP:0.090, JCP:0.050, REIWA:0.060, OTH:0.000 }, // Yamaguchi - LDP stronghold (Abe)
  '36':{ LDP:0.380, KOM:0.090, CDP:0.255, ISHIN:0.075, DPP:0.090, JCP:0.055, REIWA:0.055, OTH:0.000 }, // Tokushima
  '37':{ LDP:0.380, KOM:0.095, CDP:0.250, ISHIN:0.080, DPP:0.090, JCP:0.050, REIWA:0.055, OTH:0.000 }, // Kagawa
  '38':{ LDP:0.375, KOM:0.090, CDP:0.255, ISHIN:0.070, DPP:0.095, JCP:0.060, REIWA:0.055, OTH:0.000 }, // Ehime
  '39':{ LDP:0.385, KOM:0.085, CDP:0.270, ISHIN:0.060, DPP:0.090, JCP:0.055, REIWA:0.055, OTH:0.000 }, // Kochi
  '40':{ LDP:0.345, KOM:0.095, CDP:0.265, ISHIN:0.070, DPP:0.100, JCP:0.060, REIWA:0.065, OTH:0.000 }, // Fukuoka
  '41':{ LDP:0.395, KOM:0.095, CDP:0.255, ISHIN:0.055, DPP:0.090, JCP:0.050, REIWA:0.060, OTH:0.000 }, // Saga
  '42':{ LDP:0.380, KOM:0.095, CDP:0.260, ISHIN:0.055, DPP:0.095, JCP:0.055, REIWA:0.060, OTH:0.000 }, // Nagasaki
  '43':{ LDP:0.370, KOM:0.090, CDP:0.265, ISHIN:0.060, DPP:0.100, JCP:0.055, REIWA:0.060, OTH:0.000 }, // Kumamoto
  '44':{ LDP:0.370, KOM:0.090, CDP:0.265, ISHIN:0.060, DPP:0.100, JCP:0.055, REIWA:0.060, OTH:0.000 }, // Oita - CDP competitive
  '45':{ LDP:0.385, KOM:0.095, CDP:0.265, ISHIN:0.055, DPP:0.090, JCP:0.050, REIWA:0.060, OTH:0.000 }, // Miyazaki
  '46':{ LDP:0.390, KOM:0.090, CDP:0.265, ISHIN:0.055, DPP:0.090, JCP:0.050, REIWA:0.060, OTH:0.000 }, // Kagoshima
  '47':{ LDP:0.265, KOM:0.080, CDP:0.310, ISHIN:0.055, DPP:0.085, JCP:0.095, REIWA:0.110, OTH:0.000 }, // Okinawa - opposition
};

// ── 2026 polling fractions (post-2024 election shifts) ────────────────────────
const DATA_JP_2026: Record<string, Record<string, number>> = {
  '01':{ LDP:0.310, KOM:0.075, CDP:0.275, ISHIN:0.070, DPP:0.110, JCP:0.050, REIWA:0.075, OTH:0.035 },
  '02':{ LDP:0.355, KOM:0.088, CDP:0.260, ISHIN:0.048, DPP:0.100, JCP:0.042, REIWA:0.067, OTH:0.040 },
  '03':{ LDP:0.305, KOM:0.070, CDP:0.330, ISHIN:0.040, DPP:0.095, JCP:0.058, REIWA:0.072, OTH:0.030 },
  '04':{ LDP:0.325, KOM:0.080, CDP:0.280, ISHIN:0.058, DPP:0.110, JCP:0.052, REIWA:0.075, OTH:0.020 },
  '05':{ LDP:0.375, KOM:0.085, CDP:0.270, ISHIN:0.042, DPP:0.095, JCP:0.042, REIWA:0.061, OTH:0.030 },
  '06':{ LDP:0.355, KOM:0.080, CDP:0.285, ISHIN:0.045, DPP:0.100, JCP:0.048, REIWA:0.067, OTH:0.020 },
  '07':{ LDP:0.325, KOM:0.080, CDP:0.295, ISHIN:0.050, DPP:0.105, JCP:0.058, REIWA:0.067, OTH:0.020 },
  '08':{ LDP:0.340, KOM:0.090, CDP:0.252, ISHIN:0.062, DPP:0.120, JCP:0.048, REIWA:0.078, OTH:0.010 },
  '09':{ LDP:0.350, KOM:0.090, CDP:0.252, ISHIN:0.062, DPP:0.115, JCP:0.048, REIWA:0.073, OTH:0.010 },
  '10':{ LDP:0.365, KOM:0.090, CDP:0.247, ISHIN:0.062, DPP:0.105, JCP:0.048, REIWA:0.067, OTH:0.016 },
  '11':{ LDP:0.315, KOM:0.105, CDP:0.262, ISHIN:0.090, DPP:0.125, JCP:0.052, REIWA:0.098, OTH:0.023 },
  '12':{ LDP:0.325, KOM:0.100, CDP:0.268, ISHIN:0.085, DPP:0.118, JCP:0.052, REIWA:0.095, OTH:0.022 },
  '13':{ LDP:0.245, KOM:0.090, CDP:0.268, ISHIN:0.135, DPP:0.128, JCP:0.062, REIWA:0.112, OTH:0.030 },
  '14':{ LDP:0.305, KOM:0.095, CDP:0.268, ISHIN:0.105, DPP:0.122, JCP:0.058, REIWA:0.102, OTH:0.025 },
  '15':{ LDP:0.340, KOM:0.080, CDP:0.278, ISHIN:0.052, DPP:0.105, JCP:0.052, REIWA:0.073, OTH:0.020 },
  '16':{ LDP:0.378, KOM:0.095, CDP:0.242, ISHIN:0.058, DPP:0.108, JCP:0.042, REIWA:0.062, OTH:0.015 },
  '17':{ LDP:0.368, KOM:0.095, CDP:0.238, ISHIN:0.062, DPP:0.112, JCP:0.048, REIWA:0.062, OTH:0.015 },
  '18':{ LDP:0.382, KOM:0.090, CDP:0.240, ISHIN:0.058, DPP:0.102, JCP:0.042, REIWA:0.062, OTH:0.024 },
  '19':{ LDP:0.360, KOM:0.085, CDP:0.262, ISHIN:0.062, DPP:0.108, JCP:0.048, REIWA:0.075, OTH:0.000 },
  '20':{ LDP:0.330, KOM:0.080, CDP:0.288, ISHIN:0.068, DPP:0.108, JCP:0.052, REIWA:0.079, OTH:0.000 },
  '21':{ LDP:0.355, KOM:0.090, CDP:0.250, ISHIN:0.072, DPP:0.112, JCP:0.052, REIWA:0.074, OTH:0.000 },
  '22':{ LDP:0.340, KOM:0.085, CDP:0.258, ISHIN:0.078, DPP:0.118, JCP:0.052, REIWA:0.079, OTH:0.000 },
  '23':{ LDP:0.315, KOM:0.090, CDP:0.252, ISHIN:0.100, DPP:0.128, JCP:0.052, REIWA:0.088, OTH:0.025 },
  '24':{ LDP:0.325, KOM:0.085, CDP:0.282, ISHIN:0.072, DPP:0.112, JCP:0.058, REIWA:0.066, OTH:0.000 },
  '25':{ LDP:0.315, KOM:0.085, CDP:0.292, ISHIN:0.082, DPP:0.108, JCP:0.058, REIWA:0.060, OTH:0.000 },
  '26':{ LDP:0.295, KOM:0.085, CDP:0.250, ISHIN:0.192, DPP:0.102, JCP:0.062, REIWA:0.014, OTH:0.000 },
  '27':{ LDP:0.195, KOM:0.110, CDP:0.135, ISHIN:0.448, DPP:0.068, JCP:0.038, REIWA:0.006, OTH:0.000 },
  '28':{ LDP:0.275, KOM:0.090, CDP:0.205, ISHIN:0.295, DPP:0.085, JCP:0.048, REIWA:0.002, OTH:0.000 },
  '29':{ LDP:0.315, KOM:0.090, CDP:0.260, ISHIN:0.148, DPP:0.108, JCP:0.058, REIWA:0.021, OTH:0.000 },
  '30':{ LDP:0.350, KOM:0.085, CDP:0.238, ISHIN:0.132, DPP:0.108, JCP:0.052, REIWA:0.035, OTH:0.000 },
  '31':{ LDP:0.398, KOM:0.095, CDP:0.232, ISHIN:0.062, DPP:0.108, JCP:0.042, REIWA:0.063, OTH:0.000 },
  '32':{ LDP:0.405, KOM:0.090, CDP:0.238, ISHIN:0.058, DPP:0.098, JCP:0.042, REIWA:0.069, OTH:0.000 },
  '33':{ LDP:0.355, KOM:0.090, CDP:0.248, ISHIN:0.082, DPP:0.112, JCP:0.052, REIWA:0.061, OTH:0.000 },
  '34':{ LDP:0.335, KOM:0.085, CDP:0.242, ISHIN:0.098, DPP:0.112, JCP:0.058, REIWA:0.070, OTH:0.000 },
  '35':{ LDP:0.395, KOM:0.085, CDP:0.232, ISHIN:0.072, DPP:0.102, JCP:0.048, REIWA:0.066, OTH:0.000 },
  '36':{ LDP:0.365, KOM:0.085, CDP:0.252, ISHIN:0.082, DPP:0.102, JCP:0.052, REIWA:0.062, OTH:0.000 },
  '37':{ LDP:0.365, KOM:0.090, CDP:0.248, ISHIN:0.088, DPP:0.102, JCP:0.048, REIWA:0.059, OTH:0.000 },
  '38':{ LDP:0.360, KOM:0.085, CDP:0.252, ISHIN:0.078, DPP:0.108, JCP:0.058, REIWA:0.059, OTH:0.000 },
  '39':{ LDP:0.370, KOM:0.080, CDP:0.268, ISHIN:0.068, DPP:0.102, JCP:0.052, REIWA:0.060, OTH:0.000 },
  '40':{ LDP:0.330, KOM:0.090, CDP:0.262, ISHIN:0.078, DPP:0.112, JCP:0.058, REIWA:0.070, OTH:0.000 },
  '41':{ LDP:0.380, KOM:0.090, CDP:0.252, ISHIN:0.062, DPP:0.102, JCP:0.048, REIWA:0.066, OTH:0.000 },
  '42':{ LDP:0.365, KOM:0.090, CDP:0.258, ISHIN:0.062, DPP:0.108, JCP:0.052, REIWA:0.065, OTH:0.000 },
  '43':{ LDP:0.355, KOM:0.085, CDP:0.262, ISHIN:0.068, DPP:0.112, JCP:0.052, REIWA:0.066, OTH:0.000 },
  '44':{ LDP:0.355, KOM:0.085, CDP:0.262, ISHIN:0.068, DPP:0.112, JCP:0.052, REIWA:0.066, OTH:0.000 },
  '45':{ LDP:0.370, KOM:0.090, CDP:0.262, ISHIN:0.062, DPP:0.102, JCP:0.048, REIWA:0.066, OTH:0.000 },
  '46':{ LDP:0.375, KOM:0.085, CDP:0.262, ISHIN:0.062, DPP:0.102, JCP:0.048, REIWA:0.066, OTH:0.000 },
  '47':{ LDP:0.250, KOM:0.075, CDP:0.308, ISHIN:0.060, DPP:0.095, JCP:0.100, REIWA:0.112, OTH:0.000 },
};

// ── Prefecture config ────────────────────────────────────────────────────────
const JP_PREF_CONFIGS: { id: string; seats: number; electorate: number; region: string }[] = [
  {id:'01',seats:20,electorate:4580000,region:'Hokkaido'},
  {id:'02',seats:4, electorate:1112000,region:'Tohoku'},
  {id:'03',seats:4, electorate:1092000,region:'Tohoku'},
  {id:'04',seats:9, electorate:1938000,region:'Tohoku'},
  {id:'05',seats:3, electorate:902000, region:'Tohoku'},
  {id:'06',seats:4, electorate:955000, region:'Tohoku'},
  {id:'07',seats:7, electorate:1712000,region:'Tohoku'},
  {id:'08',seats:11,electorate:2447000,region:'Kanto'},
  {id:'09',seats:7, electorate:1712000,region:'Kanto'},
  {id:'10',seats:6, electorate:1654000,region:'Kanto'},
  {id:'11',seats:25,electorate:6186000,region:'Kanto'},
  {id:'12',seats:21,electorate:5174000,region:'Kanto'},
  {id:'13',seats:47,electorate:11490000,region:'Tokyo'},
  {id:'14',seats:30,electorate:7602000,region:'Kanto'},
  {id:'15',seats:9, electorate:1985000,region:'Chubu'},
  {id:'16',seats:4, electorate:914000, region:'Chubu'},
  {id:'17',seats:4, electorate:969000, region:'Chubu'},
  {id:'18',seats:3, electorate:672000, region:'Chubu'},
  {id:'19',seats:3, electorate:721000, region:'Kanto'},
  {id:'20',seats:8, electorate:1823000,region:'Chubu'},
  {id:'21',seats:7, electorate:1742000,region:'Chubu'},
  {id:'22',seats:13,electorate:3161000,region:'Chubu'},
  {id:'23',seats:26,electorate:6133000,region:'Chubu'},
  {id:'24',seats:6, electorate:1530000,region:'Kansai'},
  {id:'25',seats:6, electorate:1181000,region:'Kansai'},
  {id:'26',seats:11,electorate:2091000,region:'Kansai'},
  {id:'27',seats:34,electorate:7237000,region:'Kansai'},
  {id:'28',seats:19,electorate:4429000,region:'Kansai'},
  {id:'29',seats:6, electorate:1161000,region:'Kansai'},
  {id:'30',seats:3, electorate:793000, region:'Kansai'},
  {id:'31',seats:3, electorate:484000, region:'Chugoku'},
  {id:'32',seats:3, electorate:583000, region:'Chugoku'},
  {id:'33',seats:7, electorate:1606000,region:'Chugoku'},
  {id:'34',seats:11,electorate:2304000,region:'Chugoku'},
  {id:'35',seats:6, electorate:1241000,region:'Chugoku'},
  {id:'36',seats:3, electorate:635000, region:'Shikoku'},
  {id:'37',seats:4, electorate:820000, region:'Shikoku'},
  {id:'38',seats:5, electorate:1194000,region:'Shikoku'},
  {id:'39',seats:3, electorate:624000, region:'Shikoku'},
  {id:'40',seats:21,electorate:4132000,region:'Kyushu'},
  {id:'41',seats:3, electorate:686000, region:'Kyushu'},
  {id:'42',seats:6, electorate:1178000,region:'Kyushu'},
  {id:'43',seats:8, electorate:1480000,region:'Kyushu'},
  {id:'44',seats:5, electorate:978000, region:'Kyushu'},
  {id:'45',seats:4, electorate:896000, region:'Kyushu'},
  {id:'46',seats:7, electorate:1395000,region:'Kyushu'},
  {id:'47',seats:6, electorate:1164000,region:'Okinawa'},
];

const JP_PREF_NAMES: Record<string, { name: string; nameJa: string }> = {
  '01':{name:'Hokkaido',nameJa:'北海道'},   '02':{name:'Aomori',nameJa:'青森'},
  '03':{name:'Iwate',nameJa:'岩手'},         '04':{name:'Miyagi',nameJa:'宮城'},
  '05':{name:'Akita',nameJa:'秋田'},         '06':{name:'Yamagata',nameJa:'山形'},
  '07':{name:'Fukushima',nameJa:'福島'},     '08':{name:'Ibaraki',nameJa:'茨城'},
  '09':{name:'Tochigi',nameJa:'栃木'},       '10':{name:'Gunma',nameJa:'群馬'},
  '11':{name:'Saitama',nameJa:'埼玉'},       '12':{name:'Chiba',nameJa:'千葉'},
  '13':{name:'Tokyo',nameJa:'東京'},         '14':{name:'Kanagawa',nameJa:'神奈川'},
  '15':{name:'Niigata',nameJa:'新潟'},       '16':{name:'Toyama',nameJa:'富山'},
  '17':{name:'Ishikawa',nameJa:'石川'},      '18':{name:'Fukui',nameJa:'福井'},
  '19':{name:'Yamanashi',nameJa:'山梨'},     '20':{name:'Nagano',nameJa:'長野'},
  '21':{name:'Gifu',nameJa:'岐阜'},          '22':{name:'Shizuoka',nameJa:'静岡'},
  '23':{name:'Aichi',nameJa:'愛知'},         '24':{name:'Mie',nameJa:'三重'},
  '25':{name:'Shiga',nameJa:'滋賀'},         '26':{name:'Kyoto',nameJa:'京都'},
  '27':{name:'Osaka',nameJa:'大阪'},         '28':{name:'Hyogo',nameJa:'兵庫'},
  '29':{name:'Nara',nameJa:'奈良'},          '30':{name:'Wakayama',nameJa:'和歌山'},
  '31':{name:'Tottori',nameJa:'鳥取'},       '32':{name:'Shimane',nameJa:'島根'},
  '33':{name:'Okayama',nameJa:'岡山'},       '34':{name:'Hiroshima',nameJa:'広島'},
  '35':{name:'Yamaguchi',nameJa:'山口'},     '36':{name:'Tokushima',nameJa:'徳島'},
  '37':{name:'Kagawa',nameJa:'香川'},        '38':{name:'Ehime',nameJa:'愛媛'},
  '39':{name:'Kochi',nameJa:'高知'},         '40':{name:'Fukuoka',nameJa:'福岡'},
  '41':{name:'Saga',nameJa:'佐賀'},          '42':{name:'Nagasaki',nameJa:'長崎'},
  '43':{name:'Kumamoto',nameJa:'熊本'},      '44':{name:'Oita',nameJa:'大分'},
  '45':{name:'Miyazaki',nameJa:'宮崎'},      '46':{name:'Kagoshima',nameJa:'鹿児島'},
  '47':{name:'Okinawa',nameJa:'沖縄'},
};

const AVG_VOTES_PER_SEAT_JP = 480000; // Japan avg valid votes per seat

function buildPrefData(): JpPrefData[] {
  return JP_PREF_CONFIGS.map(cfg => {
    const pctMap = VOTE_2024[cfg.id] ?? { LDP:0.35,KOM:0.10,CDP:0.25,ISHIN:0.08,DPP:0.10,JCP:0.06,REIWA:0.06,OTH:0.00 };
    const validVotes = Math.round(cfg.seats * AVG_VOTES_PER_SEAT_JP * 0.65);
    const results2024: Record<string, number> = {};
    const pcts = { ...pctMap };
    const pTotal = Object.values(pcts).reduce((s, v) => s + v, 0);
    for (const [pid, p] of Object.entries(pcts)) {
      if (p > 0) results2024[pid] = Math.round((p / pTotal) * validVotes);
    }
    const diff = validVotes - Object.values(results2024).reduce((a, b) => a + b, 0);
    const topP = Object.entries(results2024).sort(([,a],[,b]) => b-a)[0]?.[0];
    if (topP && diff !== 0) results2024[topP] = (results2024[topP] ?? 0) + diff;
    const allocated = allocateSeats(results2024, cfg.seats);
    const winner2024 = Object.entries(allocated).sort(([,a],[,b]) => b-a)[0]?.[0] ?? 'LDP';
    const names = JP_PREF_NAMES[cfg.id] ?? { name: cfg.id, nameJa: cfg.id };
    return {
      id: cfg.id, name: names.name, nameJa: names.nameJa, province: cfg.region,
      seats: cfg.seats, electorate: cfg.electorate, validVotes, results2024, winner2024,
    };
  });
}

const JP_PREF_DATA = buildPrefData();

// ── Parliament: 465 seats, 10 rows ───────────────────────────────────────────
const JP_TOTAL    = 465;
const JP_MAJORITY = 233;
const JP_POLITICAL_ORDER = ['JCP', 'REIWA', 'CDP', 'DPP', 'KOM', 'ISHIN', 'LDP', 'OTH'];
const JP_HEMI_ROWS  = [32, 40, 48, 56, 64, 72, 80, 50, 23] as const; // sum=465
const JP_HEMI_RADII = JP_HEMI_ROWS.map((_, i) => 66 + i * 12);
const JP_HEMI_CX = 260; const JP_HEMI_CY = 255; const JP_HEMI_DOT_R = 2.1;
const JP_EMPTY_COLOR = '#ddd8d0';

const JP_HEMI_POSITIONS: { x: number; y: number }[] = (() => {
  const pts: { x: number; y: number; theta: number }[] = [];
  for (let row = 0; row < JP_HEMI_ROWS.length; row++) {
    const n = JP_HEMI_ROWS[row]; const r = JP_HEMI_RADII[row];
    for (let j = 0; j < n; j++) {
      const theta = Math.PI * (1 - j / (n - 1));
      pts.push({ x: JP_HEMI_CX + r * Math.cos(theta), y: JP_HEMI_CY - r * Math.sin(theta), theta });
    }
  }
  pts.sort((a, b) => b.theta - a.theta);
  return pts.map(({ x, y }) => ({ x, y }));
})();

function buildJpSeatArray(tally: Record<string, number>): (string | null)[] {
  const seats: (string | null)[] = [];
  for (const p of JP_POLITICAL_ORDER) { const n = tally[p] ?? 0; if (n > 0) for (let i = 0; i < n; i++) seats.push(p); }
  while (seats.length < JP_TOTAL) seats.push(null);
  return seats.slice(0, JP_TOTAL);
}

// ── Scoreboard ────────────────────────────────────────────────────────────────
function JpScoreboard({ tally, votePcts, rawVotes, activePreset }: {
  tally: Record<string, number>; votePcts: Record<string, number>;
  rawVotes: Record<string, number>; activePreset: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const h = (e: WheelEvent) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft += e.deltaY; };
    el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h);
  }, []);

  const sortedParties = useMemo(() => {
    const nonOth = [...JP_PARTIES].filter(p => p.id !== 'OTH');
    nonOth.sort((a, b) => (tally[b.id] ?? 0) - (tally[a.id] ?? 0));
    return [...nonOth, JP_PARTIES.find(p => p.id === 'OTH')!];
  }, [tally]);

  const topPartyId  = sortedParties.find(p => (tally[p.id] ?? 0) > 0)?.id ?? null;
  const topSeats    = topPartyId ? (tally[topPartyId] ?? 0) : 0;
  const hasMajority = topSeats >= JP_MAJORITY;
  // Coalition check: LDP + Komeito
  const ldpKomSeats = (tally['LDP'] ?? 0) + (tally['KOM'] ?? 0);
  const coalitionMajority = ldpKomSeats >= JP_MAJORITY;

  return (
    <div className="shrink-0 border-b border-default bg-canvas">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 items-stretch pt-2 pb-2 mx-auto w-fit">
          {sortedParties.map(p => {
            const leader   = (activePreset !== '2024' && JP_LEADERS_2026[p.id]) ? JP_LEADERS_2026[p.id]! : JP_LEADERS[p.id];
            const seats    = tally[p.id] ?? 0;
            const pct      = votePcts[p.id];
            const votes    = rawVotes[p.id];
            const isLeader = p.id === topPartyId;
            const isWinner = isLeader && hasMajority;
            return (
              <div key={p.id} className="relative flex flex-col items-center rounded-[6px] px-2 pt-2.5 pb-2 min-w-[84px] border bg-white"
                style={{
                  borderColor: isLeader ? p.color : `${p.color}22`,
                  boxShadow: isWinner ? `0 0 0 1.5px ${p.color}, 0 3px 12px rgba(0,0,0,0.09)` : isLeader ? `0 0 0 1px ${p.color}` : undefined,
                  overflow: isWinner ? 'hidden' : undefined, transition: 'border-color 0.15s, box-shadow 0.15s',
                }}>
                {isWinner && (
                  <div className="absolute inset-0 pointer-events-none z-[2]"
                    style={{ background: 'linear-gradient(105deg,transparent 30%,rgba(255,255,255,0.26) 50%,transparent 70%)', animation: 'shimmerSweep 2.2s ease-in-out infinite' }} />
                )}
                <div className="relative">
                  <JpLeaderPhotoCircle partyId={p.id} leader={leader} size={48} />
                  {isWinner && (
                    <span className="absolute -bottom-0.5 -right-0.5">
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="7.5" fill={p.color}/><path d="M3.5 7.5l2.5 2.5 5-5" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                  )}
                </div>
                <span className="text-[8.5px] font-sans text-ink-3 mt-1.5 leading-none truncate max-w-full">{leader?.lastName ?? ''}</span>
                <span className="text-[8px] font-mono font-bold uppercase tracking-[0.1em] leading-none mt-0.5 text-ink-3">{p.id}</span>
                <span className="text-[26px] font-display font-black leading-none tabular-nums mt-0.5" style={{ color: p.color }}>{seats}</span>
                <span className="text-[9px] font-sans text-ink-3 leading-none mt-0.5">{pct !== undefined ? `${pct.toFixed(1)}%` : '—'}</span>
                <span className="text-[7.5px] font-sans text-ink-3 leading-none mt-0.5 opacity-60">
                  <span className="cand-votes-full">{votes !== undefined ? votes.toLocaleString() : '—'}</span>
                  <span className="cand-votes-compact">{votes !== undefined ? fmtVotes(votes) : '—'}</span>
                </span>
                <div className="w-full mt-1.5 h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--bar-track)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(seats, JP_MAJORITY) / JP_MAJORITY * 100}%`, background: p.color }} />
                </div>
              </div>
            );
          })}
          {/* Status chip */}
          <div className="flex flex-col items-center justify-center min-w-[76px] px-2 gap-1.5">
            <div className="text-[9px] font-mono text-ink-3 uppercase tracking-wide text-center leading-tight">
              Majority<br/><span className="text-[15px] font-bold text-ink">{JP_MAJORITY}</span>
            </div>
            <div className="text-[7.5px] font-mono text-ink-3/50 text-center leading-tight">
              {JP_TOTAL} seats
            </div>
            {activePreset && (
              <div className="text-center mt-0.5">
                <div className="text-[7px] font-mono text-ink-3/60 uppercase tracking-wide leading-tight">LDP+KOM</div>
                <div className="text-[11px] font-mono font-bold leading-none" style={{ color: coalitionMajority ? '#C62828' : '#1565C0' }}>
                  {ldpKomSeats}
                </div>
                <div className="text-[7px] font-mono text-ink-3/50 leading-tight">{coalitionMajority ? 'majority' : 'minority'}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Prefecture detail panel ───────────────────────────────────────────────────
interface JpPrefPanelProps {
  id: string; name_en: string; nameJa?: string; province: string; seats: number;
  results?: Record<string, number>; results2024?: Record<string, number>;
  validVotes?: number; activePreset: string | null;
  onClose: () => void;
  onResultsChange?: (id: string, r: Record<string, number>) => void;
  onReportingCommit?: (id: string, pct: number) => void;
}
function JpPrefPanel({ id, name_en, nameJa, province, seats, results, results2024, validVotes, activePreset, onClose, onResultsChange, onReportingCommit }: JpPrefPanelProps) {
  const total = validVotes ?? 0;
  const [sliderPcts, setSliderPcts]     = useState<Record<string, number>>({});
  const [locked, setLocked]             = useState<Set<string>>(new Set());
  const [projected, setProjected]       = useState(false);
  const [editingParty, setEditingParty] = useState<string | null>(null);
  const [editValue, setEditValue]       = useState('');
  const [reporting, setReporting]       = useState('');
  const reportingNum   = parseFloat(reporting) || 0;
  const showReporting  = activePreset === 'sim';

  useEffect(() => {
    if (total === 0) { setSliderPcts({}); return; }
    if (!results) {
      if (activePreset === 'blank') {
        const share = 100 / JP_PARTIES.length;
        const pcts: Record<string, number> = {};
        for (const p of JP_PARTIES) pcts[p.id] = share;
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
    const lockedSum = Object.entries(sliderPcts).filter(([p]) => p !== pid && locked.has(p)).reduce((s, [, v]) => s + v, 0);
    const available = Math.max(0, 100 - lockedSum);
    const capped = Math.min(Math.max(0, newPct), available);
    const remaining = available - capped;
    const unlockedOthers = Object.keys(sliderPcts).filter(p => p !== pid && !locked.has(p));
    const unlockedSum = unlockedOthers.reduce((s, p) => s + (sliderPcts[p] ?? 0), 0);
    const newPcts: Record<string, number> = { ...sliderPcts, [pid]: capped };
    if (remaining < 1e-9) { for (const p of unlockedOthers) newPcts[p] = 0; }
    else if (unlockedSum > 1e-9) { for (const p of unlockedOthers) newPcts[p] = ((sliderPcts[p] ?? 0) / unlockedSum) * remaining; }
    else if (unlockedOthers.length > 0) { const sh = remaining / unlockedOthers.length; for (const p of unlockedOthers) newPcts[p] = sh; }
    const normSum = Object.values(newPcts).reduce((s, v) => s + v, 0);
    if (normSum > 1e-9) for (const p of Object.keys(newPcts)) newPcts[p] = (newPcts[p] / normSum) * 100;
    setSliderPcts(newPcts);
    if (activePreset !== 'blank' && onResultsChange) {
      const nr: Record<string, number> = {};
      for (const [p, pct] of Object.entries(newPcts)) if (pct > 1e-9) nr[p] = Math.round((pct / 100) * total);
      onResultsChange(id, nr);
    }
  }, [sliderPcts, locked, id, total, onResultsChange, activePreset]);

  const handleMakeProjection = useCallback(() => {
    if (!onResultsChange || total === 0) return;
    const nr: Record<string, number> = {};
    for (const [p, pct] of Object.entries(sliderPcts)) if (pct > 1e-9) nr[p] = Math.round((pct / 100) * total);
    onResultsChange(id, nr);
    onReportingCommit?.(id, parseFloat(reporting) || 0);
    setProjected(true);
  }, [sliderPcts, id, total, onResultsChange, onReportingCommit, reporting]);

  const commitEdit = useCallback((pid: string, raw: string) => {
    const num = parseFloat(raw); if (!isNaN(num)) handleSlide(pid, Math.max(0, Math.min(100, num)));
    setEditingParty(null); setEditValue('');
  }, [handleSlide]);

  const showSliders  = (activePreset === '2024' || activePreset === '2026' || activePreset === 'sim' || activePreset === 'blank') && total > 0;
  const pct2024      = useMemo(() => {
    if (!results2024 || total === 0) return {} as Record<string, number>;
    const p: Record<string, number> = {};
    for (const [pid, v] of Object.entries(results2024)) if (v > 0) p[pid] = (v / total) * 100;
    return p;
  }, [results2024, total]);
  const showComparison = activePreset !== '2024' && activePreset !== 'blank' && Object.keys(pct2024).length > 0;
  const sliderParties  = useMemo(() => JP_PARTIES.filter(p => p.id in sliderPcts), [sliderPcts]);
  const compParties    = useMemo(() => JP_PARTIES.filter(p => (pct2024[p.id] ?? 0) > 0 || (sliderPcts[p.id] ?? 0) > 0), [pct2024, sliderPcts]);

  const allocatedSeats = useMemo(() => {
    if (!showSliders || total === 0 || !Object.keys(sliderPcts).length) return {} as Record<string, number>;
    const votes: Record<string, number> = {};
    for (const [pid, pct] of Object.entries(sliderPcts)) if (pct > 1e-9) votes[pid] = Math.round((pct / 100) * total);
    return allocateSeats(votes, seats);
  }, [sliderPcts, total, seats, showSliders]);

  return (
    <div className="w-[292px] shrink-0 border-l border-default bg-surface flex flex-col overflow-y-auto z-10">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-default">
        <span className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">Prefecture</span>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded text-ink-3 hover:text-ink hover:bg-hover transition-colors">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        </button>
      </div>
      <div className="px-3.5 py-3 border-b border-default">
        <div className="font-display text-[14px] font-black uppercase tracking-tight text-ink leading-tight">{name_en}</div>
        {nameJa && <div className="text-[11px] font-mono text-ink-3 mt-0.5">{nameJa}</div>}
        <div className="mt-1 text-[9px] font-mono text-ink-3 uppercase tracking-wide">{province}</div>
        <div className="mt-0.5 text-[9px] font-mono text-ink-3">{seats} Diet {seats === 1 ? 'seat' : 'seats'}</div>
      </div>

      {showSliders && (
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
            {activePreset==='2024'?'2024 Result':activePreset==='2026'?'2026 Projection':activePreset==='sim'?'Live Count':'Manual Entry'}
          </div>
          <div className="space-y-3">
            {sliderParties.map(p => {
              const pct = sliderPcts[p.id] ?? 0;
              const rf  = showReporting ? reportingNum / 100 : 1;
              const votes = Math.round((pct / 100) * total * rf);
              const seatsWon = allocatedSeats[p.id] ?? 0;
              const isLocked = locked.has(p.id);
              const isProjLock = activePreset === 'blank' && projected;
              return (
                <div key={p.id}>
                  <div className="flex items-center gap-1 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className="text-[9px] font-medium text-ink flex-1 leading-none truncate">{JP_PARTY_MAP[p.id]?.name ?? p.id}</span>
                    {seatsWon > 0 && (
                      <span className="text-[7.5px] font-mono font-bold px-1 py-0.5 rounded shrink-0" style={{ background:`${p.color}22`, color:p.color }}>
                        {seatsWon}s
                      </span>
                    )}
                    <button onClick={() => { if (!isProjLock) toggleLock(p.id); }}
                      className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isProjLock?'text-ink-3/30 cursor-default':isLocked?'text-[#c8a020]':'text-ink-3 hover:text-ink'}`}>
                      {isLocked
                        ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                        : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>}
                    </button>
                    {editingParty === p.id ? (
                      <input type="number" min={0} max={100} step={0.1} value={editValue} autoFocus
                        className="w-11 h-5 text-[9px] font-mono font-semibold tabular-nums text-right px-1 rounded border border-default focus:outline-none bg-white"
                        style={{ color: p.color }}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(p.id, editValue)}
                        onKeyDown={e => { if(e.key==='Enter'){e.preventDefault();commitEdit(p.id,editValue);} if(e.key==='Escape'){setEditingParty(null);setEditValue('');} }}/>
                    ) : (
                      <span onClick={() => { if(!isLocked&&!isProjLock){setEditingParty(p.id);setEditValue(pct.toFixed(1));} }}
                        className="text-[9px] font-mono font-semibold tabular-nums"
                        style={{ color:p.color, minWidth:34, textAlign:'right', cursor:(isLocked||isProjLock)?'default':'text' }}>
                        {pct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <input type="range" min={0} max={100} step={0.1} value={pct}
                    disabled={isLocked || isProjLock}
                    onChange={e => handleSlide(p.id, parseFloat(e.target.value))}
                    className="ca-party-slider w-full"
                    style={{ '--party-color': p.color, '--pct': `${pct}%` } as React.CSSProperties} />
                  <div className="text-right text-[7.5px] font-mono text-ink-3 opacity-60 -mt-0.5">{votes.toLocaleString()} votes</div>
                </div>
              );
            })}
          </div>
          <div className="text-[7.5px] font-mono text-ink-3/50 mt-2.5 pt-2 border-t border-default">
            {total.toLocaleString()} valid votes · {seats} seats
          </div>
        </div>
      )}

      {!showSliders && !showComparison && (
        <div className="px-3.5 py-3"><div className="text-[9px] font-mono text-ink-3 italic">No data — click a preset</div></div>
      )}

      {showComparison && (
        <div className="px-3.5 py-3">
          <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-3">
            {activePreset==='blank'?'2024 Reference':'△ vs 2024'}
          </div>
          <div className="space-y-2">
            {compParties.map(p => {
              const b = pct2024[p.id] ?? 0; const c = sliderPcts[p.id] ?? 0; const delta = c - b;
              return (
                <div key={p.id}>
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                      <span className="text-[8.5px] font-mono font-bold" style={{ color: p.color }}>{p.id}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[8.5px] font-mono tabular-nums">
                      {activePreset !== 'blank' ? (
                        <><span className="text-ink-3/60">{b.toFixed(1)}%</span><span className="text-ink-3/30">→</span><span style={{color:p.color}}>{c.toFixed(1)}%</span>
                        <span className={`text-[7.5px] font-bold ml-0.5 ${delta>0.05?'text-emerald-600':delta<-0.05?'text-red-500':'text-ink-3'}`}>
                          {delta>0.05?'+':''}{Math.abs(delta)<0.05?'—':delta.toFixed(1)}</span></>
                      ) : <span style={{color:p.color}}>{b.toFixed(1)}%</span>}
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden relative" style={{ background:'rgba(0,0,0,0.07)' }}>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width:`${b}%`, background:p.color, opacity:0.28 }}/>
                    {activePreset!=='blank' && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width:`${c}%`, background:p.color, opacity:0.85 }}/>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[7.5px] font-mono text-ink-3/50 mt-2 pt-2 border-t border-default">{total.toLocaleString()} valid votes</div>
        </div>
      )}
    </div>
  );
}

// ── Hover tooltip ─────────────────────────────────────────────────────────────
function JpMapTooltip({ tooltip, containerW, containerH, dark = true }: {
  tooltip: NonNullable<TooltipState>; containerW: number; containerH: number; dark?: boolean;
}) {
  const TW = 285;
  const isSim = tooltip.reportingPct !== undefined;
  const TH_EST = (isSim ? 80 : 100) + tooltip.parties.length * 44;
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
  const totalReported  = tooltip.parties.reduce((s, p) => s + p.votes, 0);

  return (
    <div className="absolute pointer-events-none z-[1000]" style={{ left, top, width: TW }}>
      <div style={{ background:tt.bg, borderRadius:10, border:`1px solid ${tt.border}`, boxShadow:tt.shadow, backdropFilter:'blur(10px)', overflow:'hidden' }}>
        <div style={{ padding:'11px 15px 9px' }}>
          <div style={{ fontSize:14, fontWeight:700, color:tt.title, lineHeight:1.2 }}>{tooltip.name_en}</div>
          {tooltip.nameJa && <div style={{ fontSize:11, fontFamily:'"JetBrains Mono",monospace', color:tt.sub2, marginTop:1 }}>{tooltip.nameJa}</div>}
          <div style={{ fontSize:10, fontFamily:'"JetBrains Mono",monospace', color:tt.sub, marginTop:2 }}>
            {isSim ? <>{tooltip.province} · <span style={{color:tt.gold,fontWeight:700}}>{reportingLabel}</span></> : tooltip.province}
          </div>
          <div style={{ fontSize:9.5, fontFamily:'"JetBrains Mono",monospace', color:tt.sub2, marginTop:1 }}>
            {tooltip.seats} Diet {tooltip.seats===1?'seat':'seats'}
          </div>
        </div>
        <div style={{ padding:'0 13px 10px' }}>
          {tooltip.parties.length > 0 ? tooltip.parties.map(({ id, votes, pct, seats: pSeats }, i) => {
            const color = JP_PARTY_MAP[id]?.color ?? '#888';
            const name  = JP_PARTY_MAP[id]?.name ?? id;
            const isWinner = i === 0;
            return (
              <div key={id} style={{ display:'flex', alignItems:'center', gap:7, marginBottom:i<tooltip.parties.length-1?7:0 }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:color, flexShrink:0 }}/>
                <span style={{ flex:1, minWidth:0, fontSize:11, fontWeight:isWinner?600:400, color:tt.body, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
                <span style={{ fontSize:9.5, fontFamily:'"JetBrains Mono",monospace', color:tt.muted, marginRight:3 }}>{votes.toLocaleString()}</span>
                <span style={{ fontSize:11.5, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color, minWidth:42, textAlign:'right' }}>{pct.toFixed(1)}%</span>
                {!isSim && pSeats > 0 && <span style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', color, minWidth:20, textAlign:'right' }}>{pSeats}s</span>}
              </div>
            );
          }) : <p style={{ fontSize:11, color:tt.dim, fontStyle:'italic', margin:'4px 0' }}>{isSim?'Not yet reporting':'No results — click a preset'}</p>}
        </div>
        {!isSim && (
          <div style={{ borderTop:`1px solid ${tt.divider}`, padding:'6px 15px', display:'flex', justifyContent:'space-between' }}>
            <span style={{ fontSize:9.5, fontFamily:'"JetBrains Mono",monospace', color:tt.dim }}>{totalReported.toLocaleString()} votes</span>
            <span style={{ fontSize:9.5, fontFamily:'"JetBrains Mono",monospace', color:tt.dim }}>{tooltip.electorate>0?`${fmtVotes(tooltip.electorate)} electors`:''}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Parliament panel ──────────────────────────────────────────────────────────
function JpParliamentPanel({ tally, exiting = false, onClose }: { tally: Record<string, number>; exiting?: boolean; onClose: () => void }) {
  const seats = useMemo(() => buildJpSeatArray(tally), [tally]);
  const totalDeclared = seats.filter(s => s !== null).length;
  const topEntry = Object.entries(tally).filter(([,n]) => n>0).sort(([,a],[,b]) => b-a)[0];
  const innerR = JP_HEMI_RADII[0]; const outerR = JP_HEMI_RADII[JP_HEMI_RADII.length - 1];
  const MAJ = Math.PI / 2;
  const mx1 = JP_HEMI_CX+(innerR-6)*Math.cos(MAJ), my1 = JP_HEMI_CY-(innerR-6)*Math.sin(MAJ);
  const mx2 = JP_HEMI_CX+(outerR+8)*Math.cos(MAJ), my2 = JP_HEMI_CY-(outerR+8)*Math.sin(MAJ);
  const lx  = JP_HEMI_CX+(outerR+18)*Math.cos(MAJ), ly  = JP_HEMI_CY-(outerR+18)*Math.sin(MAJ);

  return (
    <aside className={`w-[340px] shrink-0 bg-card border-r border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="px-3 pt-3 pb-2 border-b border-default flex items-start justify-between gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-mono text-ink-3 uppercase tracking-wide mb-0.5">衆議院 House of Representatives</p>
          <h2 className="text-[13px] font-bold text-ink leading-tight">Seat distribution</h2>
          <p className="text-[9px] font-mono text-ink-3 mt-0.5">
            {totalDeclared}/{JP_TOTAL} seats · majority {JP_MAJORITY}
            {topEntry?` · ${JP_PARTY_MAP[topEntry[0]]?.name??topEntry[0]} ${topEntry[1]}`:''}
          </p>
        </div>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0 mt-0.5">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pt-2 pb-3 thin-scroll">
        <svg viewBox="0 0 520 265" className="w-full">
          <line x1={JP_HEMI_CX-outerR-10} y1={JP_HEMI_CY} x2={JP_HEMI_CX+outerR+10} y2={JP_HEMI_CY} stroke="#e5e2db" strokeWidth="1"/>
          <line x1={mx1} y1={my1} x2={mx2} y2={my2} stroke="#888" strokeWidth="1.2" strokeDasharray="3 2"/>
          <text x={lx} y={ly+3} textAnchor="middle" fontSize="8" fill="#888" fontFamily="monospace">{JP_MAJORITY}</text>
          {JP_HEMI_POSITIONS.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={JP_HEMI_DOT_R} fill={seats[i]?(JP_PARTY_MAP[seats[i]!]?.color??'#888'):JP_EMPTY_COLOR}/>
          ))}
        </svg>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-default">
          {Object.entries(tally).filter(([,n])=>n>0).sort(([,a],[,b])=>b-a).map(([p,n])=>(
            <div key={p} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{background:JP_PARTY_MAP[p]?.color??'#888'}}/>
              <span className="text-[8.5px] font-mono text-ink-2">{p}</span>
              <span className="text-[8.5px] font-mono font-bold text-ink">{n}</span>
            </div>
          ))}
        </div>
        {/* Coalition tracker */}
        <div className="mt-3 pt-3 border-t border-default">
          <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-2">Coalition watch</div>
          <div className="space-y-1.5">
            {[
              { label:'LDP + Komeito', ids:['LDP','KOM'], note:'Ruling coalition' },
              { label:'Opposition bloc', ids:['CDP','DPP','ISHIN','JCP','REIWA'], note:'Anti-LDP' },
            ].map(({ label, ids, note }) => {
              const total = ids.reduce((s, id) => s+(tally[id]??0), 0);
              const hasMaj = total >= JP_MAJORITY;
              return (
                <div key={label} className="flex items-center gap-2">
                  <div className="flex -space-x-0.5">
                    {ids.filter(id => (tally[id]??0)>0).map(id => (
                      <span key={id} className="w-2 h-2 rounded-full border border-white" style={{background:JP_PARTY_MAP[id]?.color??'#888'}}/>
                    ))}
                  </div>
                  <span className="text-[9px] text-ink flex-1">{label}</span>
                  <span className="text-[9px] font-mono text-ink-3">{note}</span>
                  <span className="text-[10px] font-mono font-bold" style={{color:hasMaj?'#C62828':'#1565C0'}}>{total}</span>
                  {hasMaj && <span className="text-[7.5px] font-mono text-emerald-600 font-bold">✓ maj</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}

// ── Breakdown helpers ─────────────────────────────────────────────────────────
type JpPrefResult = { id: string; name: string; nameJa: string; province: string; seats: number; winner: string; runnerUp: string|null; winnerSeats: number; marginSeats: number };

function computeJpPrefResults(prefData: JpPrefData[], currentResults: Record<string,Record<string,number>>, activePreset: string|null): JpPrefResult[] {
  if (!activePreset || activePreset === 'blank') return [];
  return prefData.map(s => {
    const results = currentResults[s.id] ?? s.results2024;
    const alloc   = allocateSeats(results, s.seats);
    const sorted  = Object.entries(alloc).filter(([,v]) => v>0).sort(([,a],[,b]) => b-a);
    const [winner='LDP', winnerSeats=0] = sorted[0] ?? [];
    const [runnerUp=null, ruSeats=0]    = sorted[1] ?? [];
    return { id:s.id, name:s.name, nameJa:s.nameJa, province:s.province, seats:s.seats, winner, runnerUp, winnerSeats, marginSeats: winnerSeats-(ruSeats as number) };
  });
}

function computeJpRegion(prefData: JpPrefData[], currentResults: Record<string,Record<string,number>>, prefResults: JpPrefResult[]) {
  const map = new Map<string, Record<string,number>>();
  for (const r of prefResults) {
    const results = currentResults[r.id] ?? prefData.find(s=>s.id===r.id)!.results2024;
    const alloc   = allocateSeats(results, r.seats);
    const p = map.get(r.province) ?? {};
    for (const [pid,n] of Object.entries(alloc)) p[pid]=(p[pid]??0)+n;
    map.set(r.province, p);
  }
  return Array.from(map.entries()).map(([province,seats]) => ({ province, seats, total:Object.values(seats).reduce((a,b)=>a+b,0) })).sort((a,b)=>b.total-a.total);
}

function computeJpDistortion(prefData: JpPrefData[], currentResults: Record<string,Record<string,number>>, activePreset: string|null) {
  if (!activePreset || activePreset==='blank') return [];
  const seats: Record<string,number>={}, votes: Record<string,number>={};
  let totalVotes=0;
  for (const s of prefData) {
    const results = currentResults[s.id]??s.results2024;
    const alloc   = allocateSeats(results, s.seats);
    for (const [p,n] of Object.entries(alloc)) seats[p]=(seats[p]??0)+n;
    for (const [p,v] of Object.entries(results)) { votes[p]=(votes[p]??0)+v; totalVotes+=v; }
  }
  return Array.from(new Set([...Object.keys(seats),...Object.keys(votes)]))
    .map(p=>({ party:p, seats:seats[p]??0, seatShare:((seats[p]??0)/JP_TOTAL)*100, voteShare:totalVotes>0?((votes[p]??0)/totalVotes)*100:0 }))
    .filter(r=>r.seats>0||r.voteShare>0.5).sort((a,b)=>b.seats-a.seats);
}

function JpBreakdownDrawer({ prefData, currentResults, activePreset, exiting, onClose }: {
  prefData: JpPrefData[]; currentResults: Record<string,Record<string,number>>; activePreset: string|null; exiting: boolean; onClose: ()=>void;
}) {
  const [tab, setTab] = useState<'region'|'closest'|'distortion'|'swing'>('region');
  const hasData = !!activePreset && activePreset!=='blank';
  const prefResults  = useMemo(()=>computeJpPrefResults(prefData,currentResults,activePreset),[prefData,currentResults,activePreset]);
  const regionData   = useMemo(()=>computeJpRegion(prefData,currentResults,prefResults),[prefData,currentResults,prefResults]);
  const closestPrefs = useMemo(()=>[...prefResults].sort((a,b)=>a.marginSeats-b.marginSeats).slice(0,20),[prefResults]);
  const distortion   = useMemo(()=>computeJpDistortion(prefData,currentResults,activePreset),[prefData,currentResults,activePreset]);

  // "Swing watch": prefs where winner changed from 2024 baseline
  const swingPrefs = useMemo(()=>{
    if (!hasData) return [];
    return prefResults.filter(r => {
      const base2024 = prefData.find(s=>s.id===r.id)?.winner2024 ?? 'LDP';
      return r.winner !== base2024;
    });
  }, [prefResults, prefData, hasData]);

  const tabs = [
    {id:'region' as const, label:'By region'},
    {id:'closest' as const, label:'Closest'},
    {id:'distortion' as const, label:'Vote vs seats'},
    {id:'swing' as const, label:`Flips${swingPrefs.length>0?` (${swingPrefs.length})`:''}`},
  ];

  return (
    <aside className={`w-80 shrink-0 bg-surface border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-default shrink-0">
        <h2 className="text-[15px] font-semibold text-ink">Race breakdown</h2>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-hover text-ink-3 hover:text-ink text-lg">×</button>
      </div>
      <div className="flex border-b border-default shrink-0">
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`flex-1 text-[8.5px] py-2.5 font-medium transition-colors whitespace-nowrap px-1 ${tab===t.id?'text-[#c8a020] border-b-2 border-[#c8a020]':'text-ink-3 hover:text-ink'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {!hasData ? (
        <div className="flex-1 flex items-center justify-center"><p className="text-[12px] text-ink-3 italic">Load a preset to see breakdown</p></div>
      ) : (
        <div className="flex-1 overflow-y-auto thin-scroll">
          {tab==='region' && (
            <div className="p-4 space-y-4">
              {regionData.map(r=>(
                <div key={r.province}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[12px] font-semibold text-ink">{r.province}</span>
                    <span className="text-[10px] text-ink-3 font-mono">{r.total} seats</span>
                  </div>
                  <div className="flex h-2.5 rounded overflow-hidden mb-1.5">
                    {Object.entries(r.seats).sort(([,a],[,b])=>(b as number)-(a as number)).map(([p,n])=>(
                      <div key={p} className="h-full" title={`${p}: ${n}`} style={{width:`${((n as number)/r.total)*100}%`,background:JP_PARTY_MAP[p]?.color??'#888'}}/>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {Object.entries(r.seats).sort(([,a],[,b])=>(b as number)-(a as number)).map(([p,n])=>(
                      <span key={p} className="flex items-center gap-1 text-[8.5px] text-ink-3">
                        <span className="inline-block w-2 h-2 rounded-sm" style={{background:JP_PARTY_MAP[p]?.color??'#888'}}/>
                        <span className="font-mono">{p} {n as number}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab==='closest' && (
            <div className="divide-y divide-default">
              {closestPrefs.map((c,i)=>(
                <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="text-[10px] text-ink-3 w-4 shrink-0 font-mono">{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:JP_PARTY_MAP[c.winner]?.color??'#888'}}/>
                      {c.runnerUp&&<span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:JP_PARTY_MAP[c.runnerUp]?.color??'#888'}}/>}
                      <span className="text-[11px] text-ink truncate">{c.name}</span>
                      <span className="text-[9px] text-ink-3 ml-0.5">{c.nameJa}</span>
                    </div>
                    <span className="text-[9px] text-ink-3">{c.province}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-mono text-ink">{c.winnerSeats}/{c.seats}</div>
                    <div className="text-[9px] font-mono text-[#c8a020]">+{c.marginSeats}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab==='distortion' && (
            <div className="p-4 space-y-4">
              <p className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-2">Vote share vs seat share</p>
              {distortion.map(r=>{
                const maxShare=Math.max(...distortion.flatMap(d=>[d.voteShare,d.seatShare]),1);
                return (
                  <div key={r.party}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{background:JP_PARTY_MAP[r.party]?.color??'#888'}}/>
                      <span className="text-[10px] text-ink flex-1">{JP_PARTY_MAP[r.party]?.name??r.party}</span>
                      <span className="text-[9px] text-ink-3 font-mono">{r.seats}s</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[8.5px] text-ink-3 w-8 text-right shrink-0">Votes</span>
                      <div className="flex-1 h-2 rounded overflow-hidden" style={{background:'var(--bar-track)'}}>
                        <div className="h-full rounded opacity-60" style={{width:`${(r.voteShare/maxShare)*100}%`,background:JP_PARTY_MAP[r.party]?.color??'#888'}}/>
                      </div>
                      <span className="text-[8.5px] font-mono text-ink-3 w-9">{r.voteShare.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[8.5px] text-ink-3 w-8 text-right shrink-0">Seats</span>
                      <div className="flex-1 h-2 rounded overflow-hidden" style={{background:'var(--bar-track)'}}>
                        <div className="h-full rounded" style={{width:`${(r.seatShare/maxShare)*100}%`,background:JP_PARTY_MAP[r.party]?.color??'#888'}}/>
                      </div>
                      <span className="text-[8.5px] font-mono text-ink-3 w-9">{r.seatShare.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {tab==='swing' && (
            <div className="divide-y divide-default">
              {swingPrefs.length===0 ? (
                <div className="px-4 py-8 text-center"><p className="text-[11px] text-ink-3 italic">No prefectures changed from 2024 baseline</p></div>
              ) : swingPrefs.map(c=>{
                const base = prefData.find(s=>s.id===c.id)?.winner2024??'LDP';
                return (
                  <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:JP_PARTY_MAP[base]?.color??'#888'}}/>
                      <span className="text-[9px] text-ink-3">→</span>
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:JP_PARTY_MAP[c.winner]?.color??'#888'}}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-ink truncate">{c.name} <span className="text-ink-3 text-[9px]">{c.nameJa}</span></div>
                      <div className="text-[9px] text-ink-3">{c.province}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[9.5px] font-mono text-ink">{base}→<span style={{color:JP_PARTY_MAP[c.winner]?.color}}>{c.winner}</span></div>
                      <div className="text-[8.5px] font-mono text-ink-3">{c.seats} seats</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

// ── MultiSelect panel ─────────────────────────────────────────────────────────
function JpMultiSelectPanel({ selectedIds, byIdMap, currentResults, onResultsChange, onClose }: {
  selectedIds: Set<string>; byIdMap: Map<string,JpPrefData>; currentResults: Record<string,Record<string,number>>;
  onResultsChange: (id: string, results: Record<string,number>)=>void; onClose: ()=>void;
}) {
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [editingParty, setEditingParty] = useState<string|null>(null);
  const [editValue, setEditValue] = useState('');
  useEffect(()=>{setLocked(new Set());},[selectedIds]);

  const selected = useMemo(()=>[...selectedIds].map(id=>byIdMap.get(id)).filter(Boolean) as JpPrefData[],[selectedIds,byIdMap]);
  const totalVV  = useMemo(()=>selected.reduce((s,c)=>s+c.validVotes,0),[selected]);
  const aggVotes = useMemo(()=>{
    const agg: Record<string,number>={};
    for (const c of selected){const r=currentResults[c.id]??c.results2024;for(const[pid,v]of Object.entries(r))if(v>0)agg[pid]=(agg[pid]??0)+v;}
    return agg;
  },[selected,currentResults]);
  const partyIds = useMemo(()=>Object.keys(aggVotes).filter(p=>aggVotes[p]>0).sort((a,b)=>aggVotes[b]-aggVotes[a]),[aggVotes]);
  const toggleLock = useCallback((pid:string)=>{setLocked(prev=>{const n=new Set(prev);n.has(pid)?n.delete(pid):n.add(pid);return n;});},[]);

  const handleSlider = useCallback((pid:string,newPct:number)=>{
    const curPct=totalVV>0?((aggVotes[pid]??0)/totalVV)*100:0;
    const delta=newPct-curPct;
    for(const c of selected){
      const results={...(currentResults[c.id]??c.results2024)};
      const parts=Object.keys(results).filter(p=>(results[p]??0)>0);
      const lockedSum=parts.filter(p=>p!==pid&&locked.has(p)).reduce((s,p)=>s+(results[p]??0),0);
      const avail=Math.max(0,c.validVotes-lockedSum);
      const newV=Math.max(0,Math.min((results[pid]??0)+(delta/100)*c.validVotes,avail));
      const rem=avail-newV;
      const unl=parts.filter(p=>p!==pid&&!locked.has(p));
      const unlSum=unl.reduce((s,p)=>s+(results[p]??0),0);
      const raw:Record<string,number>={...results,[pid]:newV};
      if(rem<1e-9){for(const p of unl)raw[p]=0;}
      else if(unlSum>1e-9){for(const p of unl)raw[p]=((results[p]??0)/unlSum)*rem;}
      else if(unl.length>0){for(const p of unl)raw[p]=rem/unl.length;}
      const vSum=Object.values(raw).reduce((s,v)=>s+v,0);
      const nr:Record<string,number>={};
      if(vSum>1e-9)for(const[p,v]of Object.entries(raw))if(v>1e-9)nr[p]=Math.round((v/vSum)*c.validVotes);
      onResultsChange(c.id,nr);
    }
  },[selected,currentResults,aggVotes,totalVV,locked,onResultsChange]);

  const commitEdit=useCallback((pid:string,raw:string)=>{const num=parseFloat(raw);if(!isNaN(num))handleSlider(pid,Math.max(0,Math.min(100,num)));setEditingParty(null);setEditValue('');},[handleSlider]);
  const winner=partyIds[0];const runnerUp=partyIds[1];

  return (
    <aside className="w-72 shrink-0 bg-card border-l border-default flex flex-col overflow-hidden panel-slide">
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-bold text-ink leading-tight">{selectedIds.size} Pref{selectedIds.size!==1?'s':''}</h1>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{totalVV.toLocaleString()} combined votes</p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        {winner&&(
          <div className="mt-2.5 flex items-center gap-2 px-2.5 py-2 rounded-[4px] bg-[#f8f7f4] border border-default">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{background:JP_PARTY_MAP[winner]?.color??'#888'}}/>
            <span className="text-[12px] font-semibold text-ink flex-1 truncate">{JP_PARTY_MAP[winner]?.name??winner}</span>
            <span className="font-mono text-[11px] font-semibold text-ink-2">{totalVV>0?((aggVotes[winner]/totalVV)*100).toFixed(1):'0.0'}%</span>
            {runnerUp&&<span className="text-[10px] font-mono text-ink-3">+{totalVV>0?(((aggVotes[winner]-aggVotes[runnerUp])/totalVV)*100).toFixed(1):'0.0'}</span>}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-2.5 thin-scroll space-y-2">
        {partyIds.map(pid=>{
          const party=JP_PARTY_MAP[pid];const votes=aggVotes[pid]??0;
          const pct=totalVV>0?(votes/totalVV)*100:0;const isLocked=locked.has(pid);
          return (
            <div key={pid}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:party?.color??'#888'}}/>
                <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{party?.name??pid}</span>
                <button onClick={()=>toggleLock(pid)} className={`w-4 h-4 flex items-center justify-center transition-colors shrink-0 ${isLocked?'text-[#c8a020]':'text-ink-3 hover:text-ink'}`}>
                  {isLocked?<svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>:<svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>}
                </button>
                {editingParty===pid?(<input type="number" min={0} max={100} step={0.1} value={editValue} autoFocus className="w-12 h-5 text-[10px] font-mono font-semibold tabular-nums text-right px-1 rounded border border-default focus:outline-none bg-white text-ink-2" onChange={e=>setEditValue(e.target.value)} onBlur={()=>commitEdit(pid,editValue)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commitEdit(pid,editValue);}if(e.key==='Escape'){setEditingParty(null);setEditValue('');}}}/>) : (<span onClick={()=>{if(!isLocked){setEditingParty(pid);setEditValue(pct.toFixed(1));}}} className="text-[10px] font-mono font-semibold text-ink-2 tabular-nums min-w-[38px] text-right leading-none" style={{cursor:isLocked?'default':'text'}}>{pct.toFixed(1)}%</span>)}
              </div>
              <input type="range" min={0} max={100} step={0.1} value={pct} disabled={isLocked} onChange={e=>handleSlider(pid,parseFloat(e.target.value))} className="ca-party-slider w-full" style={{'--party-color':party?.color??'#7a7870','--pct':`${pct}%`} as React.CSSProperties}/>
              <div className="text-right text-[9px] font-mono text-ink-3 -mt-0.5">{votes.toLocaleString()}</div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ── Swing panel ───────────────────────────────────────────────────────────────
function JpSwingPanel({ exiting=false, prefData, currentResults, onResultsChange, activePreset, onReset, onClose }: {
  exiting?: boolean; prefData: JpPrefData[]; currentResults: Record<string,Record<string,number>>;
  onResultsChange: (id:string,r:Record<string,number>)=>void; activePreset: string|null; onReset: ()=>void; onClose: ()=>void;
}) {
  const [inputs, setInputs] = useState<Record<string,string>>({});
  const disabled = !activePreset || activePreset==='blank';
  const swingParties = JP_PARTIES.filter(p=>p.id!=='OTH');

  const applySwing = (pid: string) => {
    const val=parseFloat(inputs[pid]??''); if(isNaN(val)||val===0) return;
    for(const s of prefData){
      const results={...(currentResults[s.id]??s.results2024)};
      const curV=results[pid]??0;const deltaV=Math.round((val/100)*s.validVotes);
      const newV=Math.max(0,Math.min(curV+deltaV,s.validVotes));const actualD=newV-curV;
      if(actualD===0) continue;
      const others=Object.keys(results).filter(p=>p!==pid&&(results[p]??0)>0);
      const othSum=others.reduce((s,p)=>s+(results[p]??0),0);
      const nr:Record<string,number>={...results,[pid]:newV};
      if(othSum>0)for(const p of others)nr[p]=Math.max(0,Math.round((results[p]??0)-actualD*((results[p]??0)/othSum)));
      onResultsChange(s.id,nr);
    }
    setInputs(prev=>({...prev,[pid]:''}));
  };

  return (
    <aside className={`w-72 shrink-0 bg-card border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default">
        <h2 className="text-[13px] font-bold text-ink">National swing</h2>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3.5 thin-scroll space-y-4">
        <section>
          <p className="eyebrow mb-2">Party swing (±pp nationwide)</p>
          <div className="space-y-1.5">
            {swingParties.map(({id:pid,color})=>{
              const raw=inputs[pid]??'';const valid=!isNaN(parseFloat(raw))&&parseFloat(raw)!==0;
              return (
                <div key={pid} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{background:color}}/>
                  <span className="text-[9.5px] font-mono text-ink-2 w-14 shrink-0 truncate">{pid}</span>
                  <input type="number" value={raw} placeholder="±pp" disabled={disabled}
                    onChange={e=>setInputs(prev=>({...prev,[pid]:e.target.value}))}
                    onKeyDown={e=>e.key==='Enter'&&applySwing(pid)}
                    className="flex-1 h-6 text-[11px] font-mono rounded-[4px] border border-default bg-white text-ink px-2 text-center focus:outline-none disabled:opacity-40"/>
                  <button onClick={()=>applySwing(pid)} disabled={disabled||!valid}
                    className="h-6 px-2 text-[10px] font-mono font-semibold rounded-[4px] border border-default text-ink-2 hover:bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors">Apply</button>
                </div>
              );
            })}
          </div>
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

// ── Simulation panel ──────────────────────────────────────────────────────────
const JP_SIM_ZONES: Record<string,number> = {
  // Zone 0 — Tohoku + Hokkaido (polls close first, eastern time)
  '01':0,'02':0,'03':0,'04':0,'05':0,'06':0,'07':0,
  // Zone 1 — Kanto (metropolitan, very fast counting)
  '08':1,'09':1,'10':1,'11':1,'12':1,'13':1,'14':1,'19':1,
  // Zone 2 — Chubu + Kyushu
  '15':2,'16':2,'17':2,'18':2,'20':2,'21':2,'22':2,'40':2,'41':2,'42':2,'43':2,'44':2,'45':2,'46':2,
  // Zone 3 — Kansai + Chugoku + Shikoku
  '23':3,'24':3,'25':3,'26':3,'27':3,'28':3,'29':3,'30':3,'31':3,'32':3,'33':3,'34':3,'35':3,'36':3,'37':3,'38':3,'39':3,
  // Zone 4 — Okinawa (last to report, westernmost)
  '47':4,
};
const JP_ZONE_WINDOWS: [number,number][] = [
  [0.00,0.22],[0.12,0.50],[0.35,0.80],[0.50,0.95],[0.75,1.00],
];

function randNormalJp(): number {
  let u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}

function generateJpResult(pref: JpPrefData, targetPcts: Record<string,number>, national2026: Record<string,number>): Record<string,number> {
  const csvData=DATA_JP_2026[pref.id];
  const base: Record<string,number>=csvData?{...csvData}:{LDP:0.32,KOM:0.09,CDP:0.25,ISHIN:0.09,DPP:0.10,JCP:0.06,REIWA:0.07,OTH:0.02};
  for(const[pid,tp]of Object.entries(targetPcts)){
    const swing=tp/100-(national2026[pid]??0);
    base[pid]=Math.max(0,(base[pid]??0)+swing);
  }
  const total=Object.values(base).reduce((s,v)=>s+v,0);
  if(total<=0) return{...pref.results2024};
  const entries=Object.entries(base).sort(([,a],[,b])=>b-a);
  const nr:Record<string,number>={};let distributed=0;
  for(let i=0;i<entries.length-1;i++){const[p,v]=entries[i];nr[p]=Math.round((v/total)*pref.validVotes);distributed+=nr[p];}
  const[lastP]=entries[entries.length-1];nr[lastP]=Math.max(0,pref.validVotes-distributed);
  return nr;
}

function JpSimulationPanel({ exiting=false, prefData, onApplyResults, onUpdatePref, onClose, simRunning, simProgress, timersRef, setSimRunning, setSimProgress, stopSim }: {
  exiting?: boolean; prefData: JpPrefData[];
  onApplyResults: (r:Record<string,Record<string,number>>)=>void;
  onUpdatePref:   (id:string,r:Record<string,number>)=>void;
  onClose: ()=>void; simRunning: boolean; simProgress: number;
  timersRef: React.MutableRefObject<ReturnType<typeof setTimeout>[]>;
  setSimRunning: (v:boolean)=>void; setSimProgress: (v:number)=>void; stopSim: ()=>void;
}) {
  const [duration, setDuration] = useState<60000|120000|300000|600000>(120000);
  const [natPcts, setNatPcts]   = useState<Record<string,string>>({LDP:'28',KOM:'10',CDP:'24',ISHIN:'10',DPP:'11',JCP:'6',REIWA:'8',OTH:'3'});

  const national2026Avg = useMemo(()=>{
    let tV=0;const sums:Record<string,number>={};
    for(const s of prefData){const d=DATA_JP_2026[s.id]??{LDP:0.28,KOM:0.10,CDP:0.24,ISHIN:0.10,DPP:0.11,JCP:0.06,REIWA:0.08,OTH:0.03};for(const[pid,f]of Object.entries(d))sums[pid]=(sums[pid]??0)+f*s.validVotes;tV+=s.validVotes;}
    if(tV===0)return{LDP:0.28,KOM:0.10,CDP:0.24,ISHIN:0.10,DPP:0.11,JCP:0.06,REIWA:0.08,OTH:0.03};
    const avg:Record<string,number>={};for(const[p,v]of Object.entries(sums))avg[p]=v/tV;return avg;
  },[prefData]);

  const runSim = useCallback(()=>{
    if(simRunning){stopSim();return;}
    const tp:Record<string,number>={};
    for(const p of JP_PARTIES)tp[p.id]=parseFloat(natPcts[p.id]??'0')||0;
    const tSum=Object.values(tp).reduce((s,v)=>s+v,0);
    if(tSum>0)for(const k of Object.keys(tp))tp[k]=(tp[k]/tSum)*100;
    const allResults:Record<string,Record<string,number>>={};
    for(const s of prefData)allResults[s.id]=generateJpResult(s,tp,national2026Avg);
    setSimRunning(true);setSimProgress(0);
    const timers:ReturnType<typeof setTimeout>[]=[];
    const groups:JpPrefData[][]= [[],[],[],[],[]];
    for(const s of prefData)groups[JP_SIM_ZONES[s.id]??2].push(s);
    let done=0;const totalBatches=prefData.length*5;
    for(let z=0;z<5;z++){
      const[sf,ef]=JP_ZONE_WINDOWS[z];const grp=groups[z];
      for(const pref of grp){
        const bf:number[]=[];
        for(let b=0;b<5;b++){const u=randNormalJp()*0.1+sf+(b/4)*(ef-sf);bf.push(Math.min(1,Math.max(sf,u)));}
        bf.sort((a,b)=>a-b);
        const full=allResults[pref.id];
        for(let b=0;b<5;b++){
          const frac=(b+1)/5;const ms=Math.round(bf[b]*duration);
          const partial:Record<string,number>={};
          for(const[pid,votes]of Object.entries(full))partial[pid]=Math.round(votes*frac);
          const t=setTimeout(()=>{onUpdatePref(pref.id,partial);done++;setSimProgress(Math.min(99,(done/totalBatches)*100));},ms);
          timers.push(t);
        }
      }
    }
    const ft=setTimeout(()=>{onApplyResults(allResults);setSimRunning(false);setSimProgress(100);},duration+300);
    timers.push(ft);timersRef.current=timers;
  },[simRunning,stopSim,prefData,natPcts,duration,national2026Avg,onApplyResults,onUpdatePref,setSimRunning,setSimProgress,timersRef]);

  const durLabels:[60000|120000|300000|600000,string][] = [[60000,'1 min'],[120000,'2 min'],[300000,'5 min'],[600000,'10 min']];

  return (
    <aside className={`w-80 shrink-0 bg-card border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <h2 className="text-[13px] font-bold text-ink">開票速報 Live Simulation</h2>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3.5 thin-scroll space-y-4">
        <section>
          <p className="eyebrow mb-2">National vote share targets</p>
          <div className="grid grid-cols-2 gap-1.5">
            {JP_PARTIES.filter(p=>p.id!=='OTH').map(p=>(
              <div key={p.id} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:p.color}}/>
                <span className="text-[9px] font-mono text-ink-2 w-12 shrink-0 truncate">{p.id}</span>
                <input type="number" min={0} max={100} step={0.5} value={natPcts[p.id]??''}
                  onChange={e=>setNatPcts(prev=>({...prev,[p.id]:e.target.value}))} disabled={simRunning}
                  className="flex-1 h-6 text-[10px] font-mono rounded-[4px] border border-default bg-white text-ink px-1 text-center focus:outline-none disabled:opacity-50"/>
                <span className="text-[9px] font-mono text-ink-3">%</span>
              </div>
            ))}
          </div>
          <div className="text-[8.5px] font-mono text-ink-3/60 mt-1">OTH = remainder</div>
        </section>
        <section>
          <p className="eyebrow mb-1.5">Simulation length</p>
          <div className="grid grid-cols-4 gap-1">
            {durLabels.map(([v,label])=>(
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
              <span className="text-[9px] font-mono text-ink-3 uppercase tracking-wide">開票中…</span>
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
        <p className="text-[8.5px] font-mono text-ink-3/60 leading-relaxed">
          Polls close 8pm JST. Tohoku + Hokkaido call first; Kanto metropolitan next; Kansai and Kyushu follow; Okinawa reports last. Each prefecture reports in 5 batches.
        </p>
      </div>
    </aside>
  );
}

// ── Tutorial panel ────────────────────────────────────────────────────────────
function JpTutorialPanel({ onClose, exiting }: { onClose: ()=>void; exiting: boolean }) {
  const H2=({children}:{children:React.ReactNode})=><div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-5 mb-1.5 first:mt-0">{children}</div>;
  const P=({children}:{children:React.ReactNode})=><p className="text-[11px] text-ink leading-relaxed mb-2">{children}</p>;
  const Tag=({children,color='bg-ink/8 text-ink'}:{children:React.ReactNode;color?:string})=><span className={`inline-block px-1.5 py-0.5 rounded-[3px] text-[9px] font-mono font-semibold ${color} mr-1`}>{children}</span>;
  const Note=({children}:{children:React.ReactNode})=><div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{children}</div>;
  return (
    <aside className={`w-80 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Japan House of Representatives Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2>衆議院 — Shūgiin</H2>
        <P>Japan elects <strong>465 Members of Parliament</strong> to the Shūgiin (House of Representatives). The party or coalition reaching <strong>233+ seats</strong> controls the government.</P>
        <div className="flex gap-2 mb-2">
          <div className="flex-1 bg-muted-bg border border-default rounded-[4px] px-2.5 py-2">
            <div className="text-[9px] font-mono font-bold text-ink uppercase tracking-wide mb-1">465 seats</div>
            <div className="text-[9.5px] text-ink-2 leading-relaxed">289 SMD + 176 PR (11 blocs)</div>
          </div>
          <div className="flex-1 bg-muted-bg border border-default rounded-[4px] px-2.5 py-2">
            <div className="text-[9px] font-mono font-bold text-ink uppercase tracking-wide mb-1">233 majority</div>
            <div className="text-[9.5px] text-ink-2 leading-relaxed">For a governing majority</div>
          </div>
        </div>
        <Note>This simulator uses a <strong>parallel mixed-member</strong> model: 289 FPTP single-member districts + 176 PR seats in 11 regional blocs. Seats are allocated <em>proportionally</em> within each prefecture for simplicity.</Note>
        <H2>The Major Parties</H2>
        <P><strong style={{color:'#C62828'}}>LDP</strong> 自民党 — ruling Liberal Democrats. Led by PM Shigeru Ishiba. Long-dominant centre-right party, strong in rural Japan.</P>
        <P><strong style={{color:'#F57F17'}}>Komeito</strong> — LDP's coalition partner. Buddhist-affiliated centrists. Together LDP+Komeito form the ruling bloc.</P>
        <P><strong style={{color:'#1565C0'}}>CDP</strong> 立憲民主党 — main opposition led by Yoshihiko Noda. Won 148 seats in 2024, strongest result in its history.</P>
        <P><strong style={{color:'#00897B'}}>Ishin</strong> 維新 — Japan Innovation Party. Libertarian reformists. Osaka-dominant (50%+ in Osaka prefecture).</P>
        <P><strong style={{color:'#E65100'}}>DPP</strong> 国民民主党 — Democratic Party for the People. Centrist, gained strongly in 2024.</P>
        <H2>2024 Election outcome</H2>
        <P>The LDP-Komeito coalition lost their majority for the first time since 2009, winning only 215 combined seats. LDP won 191, CDP 148, Ishin 38, DPP 28, Komeito 24.</P>
        <H2>Map Presets</H2>
        <div className="space-y-1.5 mb-2">
          <div><Tag>2024 Baseline</Tag><span className="text-[10px] text-ink-2">Official Oct 2024 results — LDP 191 · CDP 148.</span></div>
          <div><Tag>2026 Polling</Tag><span className="text-[10px] text-ink-2">2026 scenario reflecting current polling averages.</span></div>
          <div><Tag>Blank Map</Tag><span className="text-[10px] text-ink-2">Project all 47 prefectures manually.</span></div>
          <div><Tag>Simulation</Tag><span className="text-[10px] text-ink-2">Live count — Tohoku calls first, Okinawa last.</span></div>
        </div>
        <H2>Other Tools</H2>
        <div className="space-y-1 text-[10px] text-ink-2 leading-relaxed">
          <div><Tag>Swing</Tag> National ±pp swing to all prefectures.</div>
          <div><Tag>Breakdown</Tag> Region view, closest races, vote vs seat distortion, and prefecture flip tracker.</div>
          <div><Tag>Parliament</Tag> 465-seat hemicycle sorted by ideology (left → right).</div>
          <div><Tag>Bubble Map</Tag> Circles sized by raw vote margin (winner − runner-up).</div>
        </div>
        <div className="h-4"/>
      </div>
    </aside>
  );
}

// ── Main Japan App ─────────────────────────────────────────────────────────────
export default function JapanApp() {
  const navigate = useNavigate();
  const [dark, setDark]         = useState(()=>localStorage.getItem('darkMode')!=='false');
  const [contributorsOpen, setContributorsOpen] = useState(false);
  const [geojson, setGeojson]   = useState<GeoJsonObject|null>(null);
  const prefData                = useMemo(()=>JP_PREF_DATA,[]);
  const [activePreset, setActivePreset] = useState<'2024'|'2026'|'blank'|'sim'|null>(null);
  const [currentResults, setCurrentResults] = useState<Record<string,Record<string,number>>>({});
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [selectedPref, setSelectedPref]   = useState<SelectedPref|null>(null);
  const [bubbleMapMode, setBubbleMapMode] = useState(false);
  const [tooltip, setTooltip]             = useState<TooltipState>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownExiting, setBreakdownExiting] = useState(false);
  const [multiSelectMode, setMultiSelectMode]   = useState(false);
  const [selectedPrefIds, setSelectedPrefIds]   = useState<Set<string>>(new Set());
  const [swingOpen, setSwingOpen]         = useState(false);
  const [swingExiting, setSwingExiting]   = useState(false);
  const [parliamentOpen, setParliamentOpen]     = useState(false);
  const [parliamentExiting, setParliamentExiting] = useState(false);
  const [simOpen, setSimOpen]             = useState(false);
  const [simExiting, setSimExiting]       = useState(false);
  const [simRunning, setSimRunning]       = useState(false);
  const [tutorialOpen, setTutorialOpen]   = useState(false);
  const [tutorialExiting, setTutorialExiting] = useState(false);
  const [simProgress, setSimProgress]     = useState(0);
  const simTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stopSim = useCallback(()=>{ for(const t of simTimersRef.current)clearTimeout(t); simTimersRef.current=[]; setSimRunning(false); },[]);

  const headerScrollRef = useRef<HTMLDivElement>(null);
  const layerRef        = useRef<L.GeoJSON|null>(null);
  const containerRef    = useRef<HTMLDivElement>(null);
  const initialLoadRef  = useRef(false);

  const activePresetRef    = useRef(activePreset);
  const currentResultsRef  = useRef(currentResults);
  const byIdMapRef         = useRef<Map<string,JpPrefData>>(new Map());
  const geoPropsMapRef     = useRef<Map<string,{name_en:string;nameJa:string;province:string;seats:number}>>(new Map());
  const selectedPrefIdRef  = useRef<string|null>(null);
  const bubbleModeRef      = useRef(bubbleMapMode);
  const multiSelectModeRef = useRef(multiSelectMode);

  const byIdMap = useMemo(()=>{ const m=new Map<string,JpPrefData>(); for(const s of prefData) m.set(s.id,s); return m; },[prefData]);
  const geoPropsMap = useMemo(()=>{
    if(!geojson) return new Map<string,{name_en:string;nameJa:string;province:string;seats:number}>();
    const m=new Map<string,{name_en:string;nameJa:string;province:string;seats:number}>();
    for(const f of (geojson as any).features??[]){
      const p=f.properties;
      m.set(p.id,{name_en:p.name_en??'',nameJa:p.name_ja??'',province:p.province??'',seats:p.seats??0});
    }
    return m;
  },[geojson]);

  useEffect(()=>{ activePresetRef.current=activePreset; },[activePreset]);
  useEffect(()=>{ currentResultsRef.current=currentResults; },[currentResults]);
  useEffect(()=>{ byIdMapRef.current=byIdMap; },[byIdMap]);
  useEffect(()=>{ geoPropsMapRef.current=geoPropsMap; },[geoPropsMap]);
  useEffect(()=>{ selectedPrefIdRef.current=selectedPref?.id??null; },[selectedPref]);
  useEffect(()=>{ bubbleModeRef.current=bubbleMapMode; },[bubbleMapMode]);
  useEffect(()=>{ multiSelectModeRef.current=multiSelectMode; },[multiSelectMode]);

  const selectedPrefId = selectedPref?.id??null;

  // Seat tally (proportional per prefecture)
  const tally = useMemo(()=>{
    const t:Record<string,number>={};
    if(!activePreset) return t;
    for(const s of prefData){
      const results=currentResults[s.id]??(activePreset!=='blank'?s.results2024:{});
      if(!Object.keys(results).length) continue;
      const alloc=allocateSeats(results,s.seats);
      for(const[pid,seats]of Object.entries(alloc))t[pid]=(t[pid]??0)+seats;
    }
    return t;
  },[activePreset,currentResults,prefData]);

  const votePcts = useMemo(()=>{
    const pcts:Record<string,number>={};
    if(!activePreset) return pcts;
    const totals:Record<string,number>={};let grand=0;
    for(const r of Object.values(currentResults)){for(const[pid,v]of Object.entries(r)){totals[pid]=(totals[pid]??0)+v;grand+=v;}}
    if(grand===0) return pcts;
    for(const[pid,v]of Object.entries(totals))pcts[pid]=(v/grand)*100;
    return pcts;
  },[activePreset,currentResults]);

  const rawVotes = useMemo(()=>{
    const t:Record<string,number>={};
    if(!activePreset) return t;
    for(const r of Object.values(currentResults))for(const[pid,v]of Object.entries(r))t[pid]=(t[pid]??0)+v;
    return t;
  },[activePreset,currentResults]);

  const bubbleData = useMemo(()=>{
    if(!bubbleMapMode||!geojson) return [];
    let maxMargin=1;
    const items:{id:string;center:[number,number];margin:number;color:string}[]=[];
    for(const feature of (geojson as any).features??[]){
      const id:string=feature.properties?.id??'';
      const data=byIdMap.get(id);if(!data) continue;
      const results=currentResults[id]??(activePreset&&activePreset!=='sim'?data.results2024:{});
      const sorted=Object.values(results).filter((v):v is number=>v>0).sort((a,b)=>b-a);
      if(!sorted.length) continue;
      const margin=sorted.length>=2?sorted[0]-sorted[1]:sorted[0];
      if(margin>maxMargin)maxMargin=margin;
      const fill=(activePreset&&(activePreset!=='blank'||!!currentResults[id]))?prefFill(results,dark):(dark?'#374151':BLANK_COLOR);
      items.push({id,center:computeCentroid(feature.geometry),margin,color:fill});
    }
    return items.map(it=>({...it,radius:1.5+Math.sqrt(it.margin/maxMargin)*11}));
  },[bubbleMapMode,geojson,currentResults,activePreset,byIdMap,dark]);

  useEffect(()=>{ document.documentElement.classList.toggle('dark',dark); localStorage.setItem('darkMode',String(dark)); },[dark]);

  useEffect(()=>{
    const el=headerScrollRef.current;if(!el) return;
    const h=(e:WheelEvent)=>{ if(Math.abs(e.deltaX)>Math.abs(e.deltaY))return; e.preventDefault(); el.scrollLeft+=e.deltaY; };
    el.addEventListener('wheel',h,{passive:false}); return()=>el.removeEventListener('wheel',h);
  },[]);

  useEffect(()=>{ fetch(`${import.meta.env.BASE_URL}japan-prefectures.geojson`).then(r=>r.json()).then(setGeojson).catch(console.error); },[]);

  // Re-style map
  useEffect(()=>{
    if(!layerRef.current) return;
    if(bubbleMapMode){layerRef.current.setStyle(()=>({fillOpacity:0,weight:0.4,color:dark?'#666':'#bbb',opacity:0.6}));return;}
    const baseColor=dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.35)';
    layerRef.current.eachLayer((layer:L.Layer)=>{
      const path=layer as L.Path&{feature?:Feature};
      const id=(path.feature?.properties as Record<string,string>|undefined)?.id??'';
      const isSel=id===selectedPrefId||selectedPrefIds.has(id);
      let fillColor=dark?'#374151':BLANK_COLOR;
      if(activePreset==='blank'){const r=currentResults[id];const d=byIdMap.get(id);if(r&&d&&Object.values(r).some(v=>v>0))fillColor=prefFill(r,dark);}
      else if(activePreset){const r=currentResults[id]??byIdMap.get(id)?.results2024;if(r)fillColor=prefFill(r,dark);}
      path.setStyle({fillColor,fillOpacity:0.72,color:isSel?'#c8a020':baseColor,weight:isSel?2:0.5,opacity:1});
    });
  },[activePreset,currentResults,selectedPrefId,selectedPrefIds,byIdMap,bubbleMapMode,dark,geojson]);

  const load2024 = useCallback(()=>{ const r:Record<string,Record<string,number>>={};for(const s of byIdMapRef.current.values())r[s.id]={...s.results2024};setCurrentResults(r);setActivePreset('2024'); },[]);
  const load2026 = useCallback(()=>{
    const data=[...byIdMapRef.current.values()];const r:Record<string,Record<string,number>>={};
    for(const s of data){
      const pcts=DATA_JP_2026[s.id];if(!pcts){r[s.id]={...s.results2024};continue;}
      const nr:Record<string,number>={};let assigned=0;
      for(const[pid,frac]of Object.entries(pcts)){const v=Math.round(frac*s.validVotes);nr[pid]=v;assigned+=v;}
      const diff=s.validVotes-assigned;const top=Object.entries(nr).sort(([,a],[,b])=>b-a)[0]?.[0];
      if(top&&diff!==0)nr[top]=(nr[top]??0)+diff;r[s.id]=nr;
    }
    setCurrentResults(r);setActivePreset('2026');
  },[]);
  const loadBlank = useCallback(()=>{ setCurrentResults({}); setActivePreset('blank'); setSelectedPref(null); },[]);

  useEffect(()=>{ if(prefData.length>0&&geojson&&!initialLoadRef.current){initialLoadRef.current=true;loadBlank();} },[prefData,geojson,loadBlank]);

  const handlePrefResultsChange = useCallback((prefId:string,nr:Record<string,number>)=>{ setCurrentResults(prev=>({...prev,[prefId]:nr})); },[]);
  const toggleBreakdown  = useCallback(()=>{ if(breakdownOpen){setBreakdownExiting(true);setTimeout(()=>{setBreakdownOpen(false);setBreakdownExiting(false);},260);}else{setBreakdownOpen(true);setBreakdownExiting(false);} },[breakdownOpen]);
  const toggleSwing      = useCallback(()=>{ if(swingOpen){setSwingExiting(true);setTimeout(()=>{setSwingOpen(false);setSwingExiting(false);},260);}else{setSwingOpen(true);setSwingExiting(false);} },[swingOpen]);
  const toggleParliament = useCallback(()=>{ if(parliamentOpen){setParliamentExiting(true);setTimeout(()=>{setParliamentOpen(false);setParliamentExiting(false);},260);}else{setParliamentOpen(true);setParliamentExiting(false);} },[parliamentOpen]);
  const toggleSim        = useCallback(()=>{ if(simOpen){setSimExiting(true);setTimeout(()=>{setSimOpen(false);setSimExiting(false);},260);}else{setSimOpen(true);setSimExiting(false);} },[simOpen]);

  const handleSimApplyResults = useCallback((r:Record<string,Record<string,number>>)=>{ setCurrentResults(r);setActivePreset('sim'); },[]);

  const handleEachFeature = useCallback((_feature:Feature,layer:L.Layer)=>{
    const props=(_feature as Feature&{properties:Record<string,string|number>}).properties;
    const id=String(props.id??'');
    layer.on('click',()=>{
      if(multiSelectModeRef.current){setSelectedPrefIds(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});return;}
      setSelectedPref({id,name_en:String(props.name_en??''),province:String(props.province??'')});
    });
    layer.on('mousemove',(e:L.LeafletMouseEvent)=>{
      if(bubbleModeRef.current||multiSelectModeRef.current){setTooltip(null);return;}
      const data=byIdMapRef.current.get(id);const rect=containerRef.current?.getBoundingClientRect();if(!rect) return;
      const preset=activePresetRef.current;
      const rawResults=(preset==='2024'||preset==='2026'||preset==='sim'||preset==='blank')?(currentResultsRef.current[id]??{}):{};
      const totalRep=Object.values(rawResults).reduce((s,v)=>s+v,0);
      const alloc=Object.keys(rawResults).length?allocateSeats(rawResults,data?.seats??1):{};
      const parties=Object.entries(rawResults).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).map(([pid,votes])=>({id:pid,votes,pct:totalRep>0?Math.round((votes/totalRep)*1000)/10:0,seats:alloc[pid]??0}));
      const reportingPct=preset==='sim'&&data&&data.validVotes>0?(totalRep/data.validVotes)*100:undefined;
      setTooltip({x:e.originalEvent.clientX-rect.left,y:e.originalEvent.clientY-rect.top,name_en:String(props.name_en??''),nameJa:String(props.name_ja??''),province:String(props.province??''),seats:data?.seats??0,electorate:data?.electorate??0,validVotes:data?.validVotes??0,parties,reportingPct});
    });
    layer.on('mouseout',()=>setTooltip(null));
  },[]);

  const geoStyle = useCallback(():L.PathOptions=>({fillColor:dark?'#374151':BLANK_COLOR,fillOpacity:0.72,color:dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.35)',weight:0.5,opacity:1}),[dark]);

  const dataReady=!!geojson;
  const btnBase='h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnMuted=`${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed`;
  const btn2024Class  = activePreset==='2024'  ?`${btnBase} border-[#C62828] bg-[#C62828] text-white`:btnMuted;
  const btn2026Class  = activePreset==='2026'  ?`${btnBase} border-[#4F46E5] bg-[#4F46E5] text-white`:btnMuted;
  const btnBlankClass = activePreset==='blank' ?`${btnBase} border-[#c8a020] bg-[#c8a020] text-white`:btnMuted;
  const btnBubbleClass= bubbleMapMode          ?`${btnBase} border-[#c8a020] bg-[#c8a020] text-white`:btnMuted;
  const selResults    = selectedPrefId?currentResults[selectedPrefId]:undefined;
  const selValidVotes = selectedPrefId?byIdMap.get(selectedPrefId)?.validVotes:undefined;
  const selSeats      = selectedPrefId?byIdMap.get(selectedPrefId)?.seats:undefined;
  const selNameJa     = selectedPrefId?byIdMap.get(selectedPrefId)?.nameJa:undefined;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="jp">
      <header className={`h-[52px] ${dark?'bg-[rgba(7,13,28,0.94)]':'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={()=>navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4" title="Home">
          <GlobeLogo />
        </button>
        <div ref={headerScrollRef} className="flex-1 min-w-0 header-scroll-strip flex items-center gap-2 px-2">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <span className="text-[11px] font-mono font-bold text-ink-3 uppercase tracking-wide shrink-0">🇯🇵 Japan</span>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={load2024} disabled={!dataReady} className={btn2024Class}>2024 Baseline</button>
          <button onClick={load2026} disabled={!dataReady} className={btn2026Class}>2026 Polling</button>
          <button onClick={loadBlank} className={btnBlankClass}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={toggleSim} className={`${btnBase} flex items-center gap-1.5 ${simOpen?'border-[#c8a020] bg-[#c8a020] text-white':btnMuted}`}>
            <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor"><path d="M1 1.2L6 4L1 6.8V1.2Z"/></svg>
            Simulation
          </button>
          <button onClick={()=>{if(multiSelectMode){setMultiSelectMode(false);setSelectedPrefIds(new Set());}else{setMultiSelectMode(true);setSelectedPref(null);}}}
            className={multiSelectMode?`${btnBase} border-[#c8a020] bg-[#c8a020] text-white`:btnMuted}>
            {multiSelectMode?`⊕ ${selectedPrefIds.size} sel.`:'Multi-select'}
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
              className={`w-7 h-7 flex items-center justify-center rounded-[4px] border transition-colors ${contributorsOpen?'border-ink-3 text-ink bg-hover':'border-default text-ink-3 hover:border-ink-3 hover:text-ink'}`}>
              <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 6s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm10-9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm1.5 7.5c.5-.25.5-.75.5-1s-.5-3-3-3.5a2.5 2.5 0 0 1 2.5 4.5z" fillRule="evenodd" clipRule="evenodd"/></svg>
            </button>
            {contributorsOpen&&(<><div className="fixed inset-0 z-[99]" onClick={()=>setContributorsOpen(false)}/>
              <div className="absolute right-0 top-[calc(100%+6px)] z-[100] w-52 rounded-[10px] bg-white border border-default overflow-hidden" style={{boxShadow:'0 8px 32px rgba(0,0,0,0.13)'}}>
                <div className="px-3.5 pt-3 pb-2 border-b border-default"><div className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-ink">Contributors</div></div>
                <div className="px-3.5 py-2.5"><a href="https://x.com/realleochang" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:opacity-70 transition-opacity"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-ink-3"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.66zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg><span className="text-[11px] font-mono font-semibold text-ink">@realleochang</span></a></div>
              </div></>)}
          </div>
          <button onClick={()=>setDark(d=>!d)} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors">
            {dark?(<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2.7" stroke="currentColor" strokeWidth="1.4" fill="none"/><line x1="7" y1="0.5" x2="7" y2="2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="7" y1="11.8" x2="7" y2="13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="0.5" y1="7" x2="2.2" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="11.8" y1="7" x2="13.5" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="2.5" y1="2.5" x2="3.6" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="10.4" y1="10.4" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="11.5" y1="2.5" x2="10.4" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="3.6" y1="10.4" x2="2.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            ):(<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M11 7.8A5.5 5.5 0 0 1 5.2 2a5.5 5.5 0 1 0 5.8 5.8z" stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinejoin="round"/></svg>)}
          </button>
        </div>
      </header>

      <div className="flex flex-col flex-1 min-h-0 relative">
        <div className="relative shrink-0">
          <div style={{display:'grid',gridTemplateRows:scoreboardVisible?'1fr':'0fr',transition:'grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1)'}}>
            <div className="overflow-hidden">
              <JpScoreboard tally={tally} votePcts={votePcts} rawVotes={rawVotes} activePreset={activePreset}/>
            </div>
          </div>
          <button onClick={()=>setScoreboardVisible(v=>!v)}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-[1001] h-4 px-3 rounded-full bg-white border border-default shadow-sm hover:bg-hover text-ink-3 hover:text-ink transition-colors flex items-center gap-1">
            <svg width="8" height="5" viewBox="0 0 8 5" fill="none">{scoreboardVisible?<path d="M7 4L4 1L1 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>:<path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>}</svg>
            <span className="text-[7.5px] font-mono uppercase tracking-wider leading-none">{scoreboardVisible?'Hide':'Results'}</span>
          </button>
        </div>

        <div className="flex flex-1 min-h-0 relative">
          {(parliamentOpen||parliamentExiting)&&<JpParliamentPanel tally={tally} exiting={parliamentExiting} onClose={toggleParliament}/>}
          <div className="flex-1 min-w-0 relative">
            {geojson?(
              <div ref={containerRef} className="relative w-full h-full">
                <MapContainer style={{width:'100%',height:'100%'}} center={[36.5,136]} zoom={5} zoomControl={true} attributionControl={false}>
                  <TileLayer key={dark?'dark':'light'} url={dark?'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png':'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'} attribution='&copy; OpenStreetMap &copy; CARTO' subdomains="abcd" maxZoom={20} updateWhenZooming={false} updateWhenIdle={true}/>
                  <JpMapController layerRef={layerRef}/>
                  <GeoJSON key="japan" data={geojson} style={geoStyle} onEachFeature={handleEachFeature} ref={layerRef as any} {...({smoothFactor:0} as any)}/>
                  {bubbleMapMode&&bubbleData.map(b=>(
                    <CircleMarker key={`${b.id}-${simRunning}`} center={b.center} radius={b.radius}
                      pathOptions={{fillColor:b.color,fillOpacity:0.85,color:'rgba(255,255,255,0.7)',weight:0.6,opacity:0.9}}
                      eventHandlers={{
                        click:()=>{ if(multiSelectModeRef.current){setSelectedPrefIds(prev=>{const n=new Set(prev);n.has(b.id)?n.delete(b.id):n.add(b.id);return n;});return;} const geo=geoPropsMapRef.current.get(b.id);if(geo)setSelectedPref({id:b.id,...geo}); },
                        mousemove:(e)=>{ if(multiSelectModeRef.current){setTooltip(null);return;} const data=byIdMapRef.current.get(b.id);const geo=geoPropsMapRef.current.get(b.id);const rect=containerRef.current?.getBoundingClientRect();if(!data||!geo||!rect)return; const preset=activePresetRef.current;const rawR=(preset==='2024'||preset==='2026'||preset==='sim'||preset==='blank')?(currentResultsRef.current[b.id]??{}):{};const totalRep=Object.values(rawR).reduce((s,v)=>s+v,0);const alloc=Object.keys(rawR).length?allocateSeats(rawR,data.seats):{};const parties=Object.entries(rawR).filter(([,v])=>v>0).sort(([,a],[,bv])=>bv-a).map(([pid,votes])=>({id:pid,votes,pct:totalRep>0?Math.round((votes/totalRep)*1000)/10:0,seats:alloc[pid]??0}));const rPct=preset==='sim'&&data.validVotes>0?(totalRep/data.validVotes)*100:undefined;const lme=e as L.LeafletMouseEvent;setTooltip({x:lme.originalEvent.clientX-rect.left,y:lme.originalEvent.clientY-rect.top,name_en:geo.name_en,nameJa:geo.nameJa,province:geo.province,seats:data.seats,electorate:data.electorate,validVotes:data.validVotes,parties,reportingPct:rPct}); },
                        mouseout:()=>setTooltip(null),
                      }}/>
                  ))}
                  <MapFitter geojson={geojson}/>
                </MapContainer>
                {tooltip&&containerRef.current&&<JpMapTooltip tooltip={tooltip} containerW={containerRef.current.clientWidth} containerH={containerRef.current.clientHeight} dark={dark}/>}
              </div>
            ):(
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-[11px] font-mono text-ink-3 uppercase tracking-wider animate-pulse">Loading Japan map…</span>
              </div>
            )}
          </div>

          {!multiSelectMode&&selectedPref&&(
            <JpPrefPanel {...selectedPref} nameJa={selNameJa} seats={selSeats??1} results={selResults} results2024={byIdMap.get(selectedPref.id)?.results2024} validVotes={selValidVotes} activePreset={activePreset} onClose={()=>setSelectedPref(null)} onResultsChange={handlePrefResultsChange}/>
          )}
          {multiSelectMode&&selectedPrefIds.size>0&&(
            <JpMultiSelectPanel selectedIds={selectedPrefIds} byIdMap={byIdMap} currentResults={currentResults} onResultsChange={handlePrefResultsChange} onClose={()=>{setMultiSelectMode(false);setSelectedPrefIds(new Set());}}/>
          )}
          {(swingOpen||swingExiting)&&(
            <JpSwingPanel exiting={swingExiting} prefData={prefData} currentResults={currentResults} onResultsChange={handlePrefResultsChange} activePreset={activePreset} onReset={activePreset==='2026'?load2026:load2024} onClose={toggleSwing}/>
          )}
          {(breakdownOpen||breakdownExiting)&&(
            <JpBreakdownDrawer prefData={prefData} currentResults={currentResults} activePreset={activePreset} exiting={breakdownExiting} onClose={toggleBreakdown}/>
          )}
          {(simOpen||simExiting)&&(
            <JpSimulationPanel exiting={simExiting} prefData={prefData} onApplyResults={handleSimApplyResults} onUpdatePref={handlePrefResultsChange} onClose={toggleSim} simRunning={simRunning} simProgress={simProgress} timersRef={simTimersRef} setSimRunning={setSimRunning} setSimProgress={setSimProgress} stopSim={stopSim}/>
          )}
          {(tutorialOpen||tutorialExiting)&&(
            <JpTutorialPanel onClose={()=>{setTutorialExiting(true);setTimeout(()=>{setTutorialExiting(false);setTutorialOpen(false);},280);}} exiting={tutorialExiting}/>
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-30 flex items-center justify-between px-3 py-1 bg-ink/60">
          <span className="text-[10px] text-white/70 font-mono tracking-wide uppercase">Global Election Simulator — Japan 衆議院 Edition</span>
          <span className="text-[10px] text-white/40 font-mono">{typeof window!=='undefined'?window.location.hostname:''}</span>
        </div>
      </div>
    </div>
  );
}
