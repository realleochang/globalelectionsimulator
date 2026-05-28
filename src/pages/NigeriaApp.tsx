import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import type { GeoJsonObject, Feature } from 'geojson';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── Parties ───────────────────────────────────────────────────────────────────
const NG_PARTIES = [
  { id: 'APC',  name: 'APC',  fullName: 'All Progressives Congress',   color: '#0EA5E9' },
  { id: 'NDC',  name: 'NDC',  fullName: 'New Democratic Congress',     color: '#B91C1C' },
  { id: 'PDP',  name: 'PDP',  fullName: "People's Democratic Party",   color: '#166534' },
  { id: 'LP',   name: 'LP',   fullName: 'Labour Party',                color: '#991B1B' },
  { id: 'NNPP', name: 'NNPP', fullName: 'New Nigeria Peoples Party',   color: '#4ADE80' },
  { id: 'OTH',  name: 'OTH',  fullName: 'Others',                      color: '#666666' },
] as const;
const NG_PARTY_MAP = Object.fromEntries(NG_PARTIES.map(p => [p.id, p])) as Record<string, typeof NG_PARTIES[number]>;

// Parties that contest the 2027 election (Obi on NDC, no Atiku/Kwankwaso)
const NG_PARTIES_2027 = ['APC', 'NDC', 'OTH'] as const;

// ── Candidates ────────────────────────────────────────────────────────────────
type LeaderInfo = { lastName: string; fullName: string; wikiTitle?: string; localImage?: string; scale?: number; transformOrigin?: string; objectPosition?: string; initials?: string };

// 2023 baseline candidates (historical)
const NG_CANDIDATES: Record<string, LeaderInfo> = {
  APC:  { lastName: 'Tinubu',    fullName: 'Bola Tinubu',         wikiTitle: 'Bola Tinubu',          objectPosition: '50% 10%' },
  PDP:  { lastName: 'Atiku',     fullName: 'Atiku Abubakar',      wikiTitle: 'Atiku Abubakar',       objectPosition: '50% 10%' },
  LP:   { lastName: 'Peter Obi', fullName: 'Peter Obi',           wikiTitle: 'Peter Obi',            objectPosition: '50% 12%' },
  NNPP: { lastName: 'Kwankwaso', fullName: 'Rabiu Kwankwaso',     wikiTitle: 'Rabiu Kwankwaso',      objectPosition: '50% 8%'  },
  OTH:  { lastName: 'Others',    fullName: 'Others',               initials: 'OTH' },
};

// 2027 candidates: Tinubu (APC) vs Obi (NDC) + Others
const NG_CANDIDATES_2027: Partial<Record<string, LeaderInfo>> = {
  APC: { lastName: 'Tinubu',    fullName: 'Bola Tinubu',   wikiTitle: 'Bola Tinubu',  objectPosition: '50% 10%' },
  NDC: { lastName: 'Peter Obi', fullName: 'Peter Obi',     wikiTitle: 'Peter Obi',    objectPosition: '50% 12%' },
  OTH: { lastName: 'Others',    fullName: 'Others',         initials: 'OTH' },
};

function NgCandidatePhoto({ partyId, candidate, size = 52 }: { partyId: string; candidate?: LeaderInfo; size?: number }) {
  const color = NG_PARTY_MAP[partyId]?.color ?? '#888';
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    setPhotoUrl(null);
    if (candidate?.localImage) { setPhotoUrl(`${import.meta.env.BASE_URL}${candidate.localImage}`); return; }
    if (!candidate?.wikiTitle) return;
    let cancelled = false;
    fetchWikiPhoto(candidate.wikiTitle).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [candidate?.wikiTitle, candidate?.localImage]);

  const initials = candidate?.initials ?? (candidate ? candidate.lastName.slice(0, 2).toUpperCase() : partyId.slice(0, 2));
  return (
    <div className="rounded-full overflow-hidden shrink-0 flex items-center justify-center"
      style={{ width: size, height: size, background: `${color}22`, border: `1.5px solid ${color}55` }}>
      {photoUrl ? (
        <img src={photoUrl} alt={candidate?.lastName ?? partyId} style={{
          width: '100%', height: '100%', objectFit: 'cover',
          objectPosition: candidate?.objectPosition ?? 'center top', borderRadius: '50%',
          transform: `scale(${candidate?.scale ?? 1})`,
          transformOrigin: candidate?.transformOrigin ?? '50% 20%',
        }} onError={() => setPhotoUrl(null)} />
      ) : (
        <span className="font-mono font-bold text-center leading-none" style={{ fontSize: size * 0.34, color }}>{initials}</span>
      )}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface NgStateData {
  id: string; name: string; zone: string; electorate: number;
  validVotes: number;
  results2023: Record<string, number>;
  winner2023: string;
}
interface SelectedState { id: string; name_en: string; zone: string; }
type TooltipState = {
  x: number; y: number; name_en: string; zone: string;
  electorate: number; validVotes: number;
  parties: { id: string; votes: number; pct: number }[];
  above25: Record<string, boolean>;
  reportingPct?: number;
} | null;

// ── Win-condition helpers ─────────────────────────────────────────────────────
const NG_TOTAL_UNITS     = 37;
const NG_THRESHOLD_STATES = 24;   // 25% in at least 24 of 37 states
const NG_PCT_THRESHOLD   = 0.25;

type WinStatus = { winner: string | null; runoff: boolean; above25: Record<string, number> };

function computeWinStatus(
  stateData: NgStateData2[],
  currentResults: Record<string, Record<string, number>>,
  activePreset: string | null,
): WinStatus {
  if (!activePreset) return { winner: null, runoff: false, above25: {} };

  const nationalVotes: Record<string, number> = {};
  let grandTotal = 0;
  const above25: Record<string, number> = {};

  for (const s of stateData) {
    const results = currentResults[s.id] ?? (activePreset !== 'blank' ? s.results2024 : {});
    if (!Object.keys(results).length) continue;
    const stateTotal = Object.values(results).reduce((a, b) => a + b, 0);
    if (stateTotal === 0) continue;

    for (const [pid, votes] of Object.entries(results)) {
      nationalVotes[pid] = (nationalVotes[pid] ?? 0) + votes;
      grandTotal += votes;
    }
    // Check 25% threshold per state
    for (const [pid, votes] of Object.entries(results)) {
      if (votes / stateTotal >= NG_PCT_THRESHOLD) {
        above25[pid] = (above25[pid] ?? 0) + 1;
      }
    }
  }

  if (grandTotal === 0) return { winner: null, runoff: false, above25 };

  const sorted = Object.entries(nationalVotes).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  if (!sorted.length) return { winner: null, runoff: false, above25 };

  const [leaderId] = sorted[0];
  const meetsThreshold = (above25[leaderId] ?? 0) >= NG_THRESHOLD_STATES;

  return {
    winner: meetsThreshold ? leaderId : null,
    runoff: !meetsThreshold,
    above25,
  };
}

// ── Color helpers ─────────────────────────────────────────────────────────────
const BLANK_COLOR = '#E5E7EB';

function stateFill(results: Record<string, number>, dark = false): string {
  const sorted = Object.entries(results).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  if (!sorted.length) return dark ? '#374151' : BLANK_COLOR;
  const [winnerId, winnerVotes] = sorted[0];
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const runnerUp = sorted[1]?.[1] ?? 0;
  const margin = total > 0 ? ((winnerVotes - runnerUp) / total) * 100 : 0;
  const baseColor = NG_PARTY_MAP[winnerId]?.color ?? '#888';
  const t = Math.min(Math.max(margin / 30, 0), 1);
  const lightness = dark ? 55 - t * (55 - 28) : 82 - t * (82 - 38);
  const c = hsl(baseColor); c.l = lightness / 100;
  return c.formatHex() as string;
}

function computeCentroid(geometry: any): [number, number] {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const visit = (c: any) => {
    if (typeof c[0] === 'number') { if(c[1]<minLat)minLat=c[1];if(c[1]>maxLat)maxLat=c[1];if(c[0]<minLng)minLng=c[0];if(c[0]>maxLng)maxLng=c[0]; }
    else for (const ch of c) visit(ch);
  };
  visit(geometry.coordinates);
  return isFinite(minLat) ? [(minLat+maxLat)/2, (minLng+maxLng)/2] : [0, 0];
}

function MapFitter({ geojson }: { geojson: GeoJsonObject }) {
  const map = useMap();
  useEffect(() => {
    try { const l = L.geoJSON(geojson); const b = l.getBounds(); if (b.isValid()) map.fitBounds(b, {padding:[10,10]}); } catch { /* ignore */ }
  }, [map, geojson]);
  return null;
}

function NgMapController({ layerRef }: { layerRef: { current: L.GeoJSON | null } }) {
  const map = useMap();
  useEffect(() => {
    const fn = () => { if (layerRef.current) layerRef.current.eachLayer((l: L.Layer) => { const p = l as any; if (p.options) p.options.smoothFactor = 0; }); };
    map.on('zoomend', fn); return () => { map.off('zoomend', fn); };
  }, [map, layerRef]);
  return null;
}

function fmtVotes(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return n.toString();
}

// ── 2023 INEC-official state-by-state results ─────────────────────────────────
// Source: INEC official declaration, March 1 2023. Wikipedia verified totals.
// National: APC 8,794,726 (36.61%) · PDP 6,984,520 (29.07%) · LP 6,101,533 (25.40%) · NNPP 1,496,687 (6.23%)
// Winners: APC 12 states · PDP 12 states · LP 11 states + FCT · NNPP 1 (Kano)
const RESULTS_2023: Record<string, Record<string, number>> = {
  // ── South-East (LP dominant) ─────────────────────────────────────────────
  AB: { APC:   8914, PDP:  22676, LP: 327095, NNPP:   1239, OTH: 10113 }, // Abia      - LP
  AN: { APC:   5111, PDP:   9036, LP: 584621, NNPP:   1967, OTH: 13126 }, // Anambra   - LP (Obi's home)
  EB: { APC:  42402, PDP:  13503, LP: 259738, NNPP:   1661, OTH:  8047 }, // Ebonyi    - LP
  EN: { APC:   4772, PDP:  15749, LP: 428640, NNPP:   1808, OTH:  5455 }, // Enugu     - LP
  IM: { APC:  66171, PDP:  30004, LP: 352904, NNPP:   1536, OTH:  8646 }, // Imo       - LP

  // ── South-South ───────────────────────────────────────────────────────────
  AK: { APC: 160620, PDP: 214012, LP: 132683, NNPP:   7796, OTH: 39978 }, // Akwa Ibom - PDP
  BY: { APC:  42572, PDP:  68818, LP:  49975, NNPP:    540, OTH:  3420 }, // Bayelsa   - PDP
  CR: { APC: 130520, PDP:  95425, LP: 179917, NNPP:   1644, OTH:  9462 }, // Cross R.  - LP
  DE: { APC:  90183, PDP: 161600, LP: 341866, NNPP:   3122, OTH: 18570 }, // Delta     - LP
  ED: { APC: 144471, PDP:  89585, LP: 331163, NNPP:   2743, OTH: 13304 }, // Edo       - LP
  RI: { APC: 231591, PDP:  88468, LP: 175071, NNPP:   1322, OTH: 27199 }, // Rivers    - APC (INEC declared)

  // ── South-West ────────────────────────────────────────────────────────────
  EK: { APC: 201494, PDP:  89554, LP:  11397, NNPP:    264, OTH:  5462 }, // Ekiti     - APC
  LA: { APC: 572606, PDP:  75750, LP: 582454, NNPP:   8442, OTH: 32199 }, // Lagos     - LP (45.81% > APC 45.04%)
  OG: { APC: 341554, PDP: 123831, LP:  85829, NNPP:   2200, OTH: 26710 }, // Ogun      - APC
  ON: { APC: 369924, PDP: 115463, LP:  44405, NNPP:    930, OTH: 20286 }, // Ondo      - APC
  OS: { APC: 343945, PDP: 354366, LP:  23283, NNPP:    713, OTH: 10896 }, // Osun      - PDP
  OY: { APC: 449884, PDP: 182977, LP:  99110, NNPP:   4095, OTH: 73419 }, // Oyo       - APC

  // ── North-Central ─────────────────────────────────────────────────────────
  BE: { APC: 310468, PDP: 130081, LP: 308372, NNPP:   4740, OTH: 16414 }, // Benue     - APC (narrow over LP)
  FC: { APC:  90902, PDP:  74194, LP: 281717, NNPP:   4517, OTH:  8741 }, // FCT       - LP
  KO: { APC: 240751, PDP: 145104, LP:  56217, NNPP:   4238, OTH: 10480 }, // Kogi      - APC
  KW: { APC: 263572, PDP: 136909, LP:  31186, NNPP:   3141, OTH: 35203 }, // Kwara     - APC
  NA: { APC: 172922, PDP: 147093, LP: 191361, NNPP:  12715, OTH: 16475 }, // Nasarawa  - LP
  NI: { APC: 375183, PDP: 284898, LP:  80452, NNPP:  21836, OTH: 16299 }, // Niger     - APC
  PL: { APC: 307195, PDP: 243808, LP: 466272, NNPP:   8869, OTH: 62026 }, // Plateau   - LP

  // ── North-East ────────────────────────────────────────────────────────────
  AD: { APC: 182881, PDP: 417611, LP: 105648, NNPP:   8006, OTH: 16994 }, // Adamawa   - PDP (Atiku's home)
  BA: { APC: 316694, PDP: 426607, LP:  27373, NNPP:  72103, OTH: 10739 }, // Bauchi    - PDP
  BO: { APC: 252282, PDP: 190921, LP:   7205, NNPP:   4626, OTH: 10253 }, // Borno     - APC
  GO: { APC: 146977, PDP: 317123, LP:  26160, NNPP:  10520, OTH:  9263 }, // Gombe     - PDP
  TA: { APC: 135165, PDP: 189017, LP: 146315, NNPP:  12818, OTH: 16043 }, // Taraba    - PDP
  YO: { APC: 151459, PDP: 196567, LP:   2406, NNPP:  18270, OTH:  7695 }, // Yobe      - PDP

  // ── North-West ────────────────────────────────────────────────────────────
  JI: { APC: 421390, PDP: 386587, LP:   1889, NNPP:  98234, OTH: 12431 }, // Jigawa    - APC
  KD: { APC: 399293, PDP: 554360, LP: 294494, NNPP:  92969, OTH: 19037 }, // Kaduna    - PDP
  KN: { APC: 517341, PDP: 131716, LP:  28513, NNPP: 997279, OTH: 27156 }, // Kano      - NNPP (Kwankwaso)
  KT: { APC: 482283, PDP: 489045, LP:   6376, NNPP:  69386, OTH: 11583 }, // Katsina   - PDP (narrow)
  KE: { APC: 248088, PDP: 285175, LP:  10682, NNPP:   5038, OTH: 10539 }, // Kebbi     - PDP
  SO: { APC: 285444, PDP: 288679, LP:   6568, NNPP:   1300, OTH:  4824 }, // Sokoto    - PDP (narrow)
  ZA: { APC: 298396, PDP: 193978, LP:   1660, NNPP:   4044, OTH:  4845 }, // Zamfara   - APC
};

// ── State metadata ────────────────────────────────────────────────────────────
const NG_STATE_CONFIGS: { id: string; name: string; zone: string; electorate: number }[] = [
  {id:'AB',name:'Abia',          zone:'South-East',    electorate:2318000},
  {id:'AD',name:'Adamawa',       zone:'North-East',    electorate:2201000},
  {id:'AK',name:'Akwa Ibom',     zone:'South-South',   electorate:2513000},
  {id:'AN',name:'Anambra',       zone:'South-East',    electorate:2500000},
  {id:'BA',name:'Bauchi',        zone:'North-East',    electorate:2375000},
  {id:'BY',name:'Bayelsa',       zone:'South-South',   electorate:1004000},
  {id:'BE',name:'Benue',         zone:'North-Central', electorate:2346000},
  {id:'BO',name:'Borno',         zone:'North-East',    electorate:2237000},
  {id:'CR',name:'Cross River',   zone:'South-South',   electorate:1793000},
  {id:'DE',name:'Delta',         zone:'South-South',   electorate:2934000},
  {id:'EB',name:'Ebonyi',        zone:'South-East',    electorate:1633000},
  {id:'ED',name:'Edo',           zone:'South-South',   electorate:2567000},
  {id:'EK',name:'Ekiti',         zone:'South-West',    electorate:1027000},
  {id:'EN',name:'Enugu',         zone:'South-East',    electorate:2004000},
  {id:'FC',name:'FCT Abuja',     zone:'North-Central', electorate:2005000},
  {id:'GO',name:'Gombe',         zone:'North-East',    electorate:1419000},
  {id:'IM',name:'Imo',           zone:'South-East',    electorate:2268000},
  {id:'JI',name:'Jigawa',        zone:'North-West',    electorate:2275000},
  {id:'KD',name:'Kaduna',        zone:'North-West',    electorate:3861000},
  {id:'KN',name:'Kano',          zone:'North-West',    electorate:5534000},
  {id:'KT',name:'Katsina',       zone:'North-West',    electorate:3254000},
  {id:'KE',name:'Kebbi',         zone:'North-West',    electorate:1963000},
  {id:'KO',name:'Kogi',          zone:'North-Central', electorate:2215000},
  {id:'KW',name:'Kwara',         zone:'North-Central', electorate:1480000},
  {id:'LA',name:'Lagos',         zone:'South-West',    electorate:7060000},
  {id:'NA',name:'Nasarawa',      zone:'North-Central', electorate:1491000},
  {id:'NI',name:'Niger',         zone:'North-Central', electorate:2362000},
  {id:'OG',name:'Ogun',          zone:'South-West',    electorate:2395000},
  {id:'ON',name:'Ondo',          zone:'South-West',    electorate:1764000},
  {id:'OS',name:'Osun',          zone:'South-West',    electorate:1826000},
  {id:'OY',name:'Oyo',           zone:'South-West',    electorate:3237000},
  {id:'PL',name:'Plateau',       zone:'North-Central', electorate:2199000},
  {id:'RI',name:'Rivers',        zone:'South-South',   electorate:3364000},
  {id:'SO',name:'Sokoto',        zone:'North-West',    electorate:2198000},
  {id:'TA',name:'Taraba',        zone:'North-East',    electorate:1768000},
  {id:'YO',name:'Yobe',          zone:'North-East',    electorate:1647000},
  {id:'ZA',name:'Zamfara',       zone:'North-West',    electorate:2076000},
];

// Patch: results2024 alias used in generic code paths
type NgStateData2 = NgStateData & { results2024: Record<string, number> };

function buildStateData(): NgStateData2[] {
  return NG_STATE_CONFIGS.map(cfg => {
    const r = RESULTS_2023[cfg.id] ?? { APC:10000, PDP:8000, LP:6000, NNPP:1000, OTH:500 };
    const validVotes = Object.values(r).reduce((a, b) => a + b, 0);
    const sorted = Object.entries(r).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
    const winner2023 = sorted[0]?.[0] ?? 'APC';
    return { id: cfg.id, name: cfg.name, zone: cfg.zone, electorate: cfg.electorate, validVotes, results2023: r, results2024: r, winner2024: winner2023, winner2023 } as NgStateData2 & { winner2024: string };
  });
}

const NG_STATE_DATA = buildStateData();

// ── Verify national totals ────────────────────────────────────────────────────
// Expected: APC ~8.79M · PDP ~6.98M · LP ~6.10M · NNPP ~1.50M
// These approximate figures are calibrated to INEC official national totals.

// ── 2027 polling scenario ─────────────────────────────────────────────────────
// Two candidates: Tinubu (APC, Yoruba/Muslim incumbent) vs Peter Obi (NDC, Igbo/Catholic).
// No Atiku (PDP) — his North-East/North-West base feeds into OTH (residual PDP + minor parties).
// No Kwankwaso (NNPP) — Kano's massive NNPP vote collapses into OTH.
// NDC = Obi keeps the LP 2023 base (South-East, South-South Christians, urban youth) and
// gains former southern PDP voters. APC holds the Muslim North + South-West.
// OTH absorbs PDP-without-Atiku and NNPP-without-Kwankwaso.
const DATA_2027: Record<string, Record<string, number>> = {
  // ── South-East — NDC dominant (Igbo/Catholic heartland, Obi's home region) ──
  AB: {APC:0.07, NDC:0.83, OTH:0.10},
  AN: {APC:0.04, NDC:0.92, OTH:0.04},  // Anambra — Obi's home state
  EB: {APC:0.12, NDC:0.78, OTH:0.10},
  EN: {APC:0.07, NDC:0.86, OTH:0.07},
  IM: {APC:0.14, NDC:0.75, OTH:0.11},
  // ── South-South — NDC strong (Christian majority, gains former PDP southern vote) ─
  AK: {APC:0.28, NDC:0.58, OTH:0.14},
  BY: {APC:0.35, NDC:0.42, OTH:0.23},  // Former PDP stronghold splits
  CR: {APC:0.30, NDC:0.50, OTH:0.20},
  DE: {APC:0.18, NDC:0.68, OTH:0.14},
  ED: {APC:0.26, NDC:0.58, OTH:0.16},
  RI: {APC:0.38, NDC:0.44, OTH:0.18},  // Complex — APC machine strong
  // ── South-West — APC (Tinubu/Yoruba base, Muslim-friendly) ──────────────────
  EK: {APC:0.55, NDC:0.28, OTH:0.17},
  LA: {APC:0.54, NDC:0.36, OTH:0.10},  // Lagos — Tinubu home but Obi strong with youth
  OG: {APC:0.50, NDC:0.30, OTH:0.20},
  ON: {APC:0.48, NDC:0.32, OTH:0.20},
  OS: {APC:0.42, NDC:0.34, OTH:0.24},
  OY: {APC:0.44, NDC:0.33, OTH:0.23},
  // ── North-Central — mixed; Christian states (Benue/Plateau/FCT) lean NDC ───
  BE: {APC:0.36, NDC:0.44, OTH:0.20},  // Predominantly Christian
  FC: {APC:0.32, NDC:0.46, OTH:0.22},  // Obi won FCT outright in 2023
  KO: {APC:0.58, NDC:0.22, OTH:0.20},
  KW: {APC:0.54, NDC:0.24, OTH:0.22},
  NA: {APC:0.50, NDC:0.28, OTH:0.22},
  NI: {APC:0.56, NDC:0.18, OTH:0.26},
  PL: {APC:0.34, NDC:0.42, OTH:0.24},  // Christian — leans NDC
  // ── North-East — APC dominant; Adamawa/Taraba PDP legacy → big OTH ─────────
  AD: {APC:0.38, NDC:0.18, OTH:0.44},  // Atiku's home — massive PDP residual → OTH
  BA: {APC:0.46, NDC:0.12, OTH:0.42},
  BO: {APC:0.66, NDC:0.10, OTH:0.24},
  GO: {APC:0.55, NDC:0.12, OTH:0.33},
  TA: {APC:0.36, NDC:0.26, OTH:0.38},  // More Christian — NDC some traction
  YO: {APC:0.64, NDC:0.10, OTH:0.26},
  // ── North-West — APC dominant; Kano's NNPP base collapses → huge OTH ───────
  JI: {APC:0.52, NDC:0.08, OTH:0.40},
  KD: {APC:0.48, NDC:0.20, OTH:0.32},  // More diverse, some Christian LP-switchers
  KN: {APC:0.38, NDC:0.08, OTH:0.54},  // Kwankwaso's NNPP legacy → OTH dominates
  KT: {APC:0.60, NDC:0.09, OTH:0.31},
  KE: {APC:0.56, NDC:0.08, OTH:0.36},
  SO: {APC:0.52, NDC:0.08, OTH:0.40},
  ZA: {APC:0.50, NDC:0.08, OTH:0.42},
};

// ── Scoreboard ────────────────────────────────────────────────────────────────
function NgScoreboard({ nationalVotes, nationalPcts, stateCounts, winStatus, above25, activePreset }: {
  nationalVotes: Record<string, number>; nationalPcts: Record<string, number>;
  stateCounts: Record<string, number>; winStatus: WinStatus;
  above25: Record<string, number>; activePreset: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const h = (e: WheelEvent) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft += e.deltaY; };
    el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h);
  }, []);

  const sortedParties = useMemo(() => {
    // Only show parties that actually have votes in the current view (keeps scoreboard clean
    // when switching between 2023 — APC/PDP/LP/NNPP — and 2027 — APC/NDC).
    const nonOth = [...NG_PARTIES].filter(p => p.id !== 'OTH' && (nationalVotes[p.id] ?? 0) > 0);
    nonOth.sort((a, b) => (nationalVotes[b.id] ?? 0) - (nationalVotes[a.id] ?? 0));
    return [...nonOth, NG_PARTIES.find(p => p.id === 'OTH')!];
  }, [nationalVotes]);

  const leaderId = sortedParties.find(p => (nationalVotes[p.id] ?? 0) > 0)?.id ?? null;

  return (
    <div className="shrink-0 border-b border-default bg-canvas">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 items-stretch pt-2 pb-2 mx-auto w-fit">
          {sortedParties.map(p => {
            const cand = (activePreset !== '2023' && NG_CANDIDATES_2027[p.id]) ? NG_CANDIDATES_2027[p.id]! : NG_CANDIDATES[p.id];
            const votes = nationalVotes[p.id] ?? 0;
            const pct   = nationalPcts[p.id];
            const stateW = stateCounts[p.id] ?? 0;
            const thresh = above25[p.id] ?? 0;
            const isLeader = p.id === leaderId;
            const isWinner = winStatus.winner === p.id;
            return (
              <div key={p.id} className="relative flex flex-col items-center rounded-[6px] px-2 pt-2.5 pb-2 min-w-[96px] border bg-white"
                style={{
                  borderColor: isLeader ? p.color : `${p.color}22`,
                  boxShadow: isWinner ? `0 0 0 1.5px ${p.color}, 0 3px 12px rgba(0,0,0,0.09)` : isLeader ? `0 0 0 1px ${p.color}` : undefined,
                  overflow: isWinner ? 'hidden' : undefined,
                }}>
                {isWinner && (
                  <div className="absolute inset-0 pointer-events-none z-[2]"
                    style={{ background:'linear-gradient(105deg,transparent 30%,rgba(255,255,255,0.26) 50%,transparent 70%)', animation:'shimmerSweep 2.2s ease-in-out infinite' }}/>
                )}
                <div className="relative">
                  <NgCandidatePhoto partyId={p.id} candidate={cand} size={52} />
                  {isWinner && (
                    <span className="absolute -bottom-0.5 -right-0.5">
                      <svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="8.5" fill={p.color}/><path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                  )}
                </div>
                <span className="text-[8.5px] font-sans text-ink-3 mt-1.5 leading-none truncate max-w-full">{cand?.lastName ?? ''}</span>
                <span className="text-[8px] font-mono font-bold uppercase tracking-[0.10em] leading-none mt-0.5 text-ink-3">{p.id}</span>
                {/* Vote total */}
                <span className="text-[13px] font-display font-black leading-none tabular-nums mt-1" style={{ color: p.color }}>
                  {votes > 0 ? (votes >= 1_000_000 ? `${(votes/1_000_000).toFixed(2)}M` : fmtVotes(votes)) : '—'}
                </span>
                <span className="text-[9.5px] font-sans text-ink-3 leading-none mt-0.5">{pct !== undefined ? `${pct.toFixed(1)}%` : '—'}</span>
                {/* State wins + threshold */}
                {activePreset && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[8px] font-mono text-ink-3">{stateW} {stateW===1?'state':'states'}</span>
                    <span className="text-[7.5px] font-mono px-1 py-0.5 rounded" style={{
                      background: thresh >= NG_THRESHOLD_STATES ? `${p.color}22` : 'rgba(0,0,0,0.06)',
                      color: thresh >= NG_THRESHOLD_STATES ? p.color : 'rgba(0,0,0,0.4)',
                    }}>
                      {thresh}/{NG_THRESHOLD_STATES}
                    </span>
                  </div>
                )}
                <div className="w-full mt-1.5 h-[3px] rounded-full overflow-hidden" style={{ background:'var(--bar-track)' }}>
                  <div className="h-full rounded-full" style={{ width:`${Math.min(pct??0,60)/60*100}%`, background:p.color }}/>
                </div>
              </div>
            );
          })}
          {/* Win status chip — shown only when there's a result to declare */}
          {(winStatus.winner || winStatus.runoff) && (
            <div className="flex flex-col items-center justify-center min-w-[72px] px-2 gap-0.5">
              {winStatus.winner && <div className="text-[8px] font-mono font-bold text-emerald-600">Winner ✓</div>}
              {winStatus.runoff && <div className="text-[8px] font-mono font-bold text-amber-600">Runoff ⚡</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── State detail panel ────────────────────────────────────────────────────────
interface NgStatePanelProps {
  id: string; name_en: string; zone: string;
  results?: Record<string, number>; results2024?: Record<string, number>;
  validVotes?: number; activePreset: string | null;
  onClose: () => void;
  onResultsChange?: (id: string, r: Record<string, number>) => void;
  onReportingCommit?: (id: string, pct: number) => void;
  storedReporting?: number;
  refOpen?: boolean;
  onToggleRef?: () => void;
}
function NgStatePanel({ id, name_en, zone, results, results2024, validVotes, activePreset, onClose, onResultsChange, onReportingCommit, storedReporting, refOpen, onToggleRef }: NgStatePanelProps) {
  const total = validVotes ?? 0;
  const [sliderPcts, setSliderPcts]     = useState<Record<string, number>>({});
  const [locked, setLocked]             = useState<Set<string>>(new Set());
  const [projected, setProjected]       = useState(false);
  const [editingParty, setEditingParty] = useState<string | null>(null);
  const [editValue, setEditValue]       = useState('');
  const [reporting, setReporting]       = useState('100');
  const reportingNum  = parseFloat(reporting) || 0;
  const showReporting = activePreset === 'blank';

  useEffect(() => {
    if (total === 0) { setSliderPcts({}); return; }
    if (!results) {
      if (activePreset === 'blank') {
        const pcts: Record<string, number> = {};
        for (const pid of NG_PARTIES_2027) pcts[pid] = 0;   // 2027 parties only; start at 0 — player must touch a slider
        setSliderPcts(pcts); setProjected(false);
      } else setSliderPcts({});
      return;
    }
    // Results exist. For a projected blank state, un-scale by its stored % reporting to recover slider positions.
    const denom = total * (activePreset === 'blank' ? Math.max(1e-6, (storedReporting ?? 100) / 100) : 1);
    const pcts: Record<string, number> = {};
    for (const [pid, votes] of Object.entries(results)) if (votes > 0) pcts[pid] = denom > 0 ? (votes / denom) * 100 : 0;
    setSliderPcts(pcts);
    if (activePreset === 'blank') setProjected(true);
  }, [id, results, total, activePreset, storedReporting]);

  useEffect(() => { setLocked(new Set()); setReporting(String(storedReporting ?? 100)); }, [id, storedReporting]);

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
    if (activePreset === 'blank') setProjected(false);   // editing after a projection re-arms the button
    if (activePreset !== 'blank' && onResultsChange) {
      const nr: Record<string, number> = {};
      for (const [p, pct] of Object.entries(newPcts)) if (pct > 1e-9) nr[p] = Math.round((pct / 100) * total);
      onResultsChange(id, nr);
    }
  }, [sliderPcts, locked, id, total, onResultsChange, activePreset]);

  const handleMakeProjection = useCallback(() => {
    if (!onResultsChange || total === 0) return;
    const sum = Object.values(sliderPcts).reduce((s, v) => s + v, 0);
    if (sum < 0.5) return;                                  // require the player to have set the sliders
    const rpt = Math.max(0, Math.min(100, parseFloat(reporting) || 0));
    const rf  = rpt / 100;                                  // % reporting scales the raw votes that get committed
    const nr: Record<string, number> = {};
    for (const [p, pct] of Object.entries(sliderPcts)) {
      const norm = (pct / sum) * 100;                       // normalise the split to 100% before scaling
      if (norm > 1e-9) nr[p] = Math.round((norm / 100) * total * rf);
    }
    onResultsChange(id, nr); onReportingCommit?.(id, rpt); setProjected(true);
  }, [sliderPcts, id, total, onResultsChange, onReportingCommit, reporting]);

  const commitEdit = useCallback((pid: string, raw: string) => {
    const num = parseFloat(raw); if (!isNaN(num)) handleSlide(pid, Math.max(0, Math.min(100, num)));
    setEditingParty(null); setEditValue('');
  }, [handleSlide]);

  const showSliders  = (activePreset === '2023' || activePreset === '2027' || activePreset === 'sim' || activePreset === 'blank') && total > 0;
  const pct2023      = useMemo(() => {
    if (!results2024 || total === 0) return {} as Record<string, number>;
    const p: Record<string, number> = {};
    for (const [pid, v] of Object.entries(results2024)) if (v > 0) p[pid] = (v / total) * 100;
    return p;
  }, [results2024, total]);
  const showComp     = activePreset !== '2023' && activePreset !== 'blank' && Object.keys(pct2023).length > 0;
  const sliderParties = useMemo(() => NG_PARTIES.filter(p => p.id in sliderPcts), [sliderPcts]);

  // Per-state threshold display
  const stateTotal    = Object.values(sliderPcts).reduce((s, v) => s + v, 0);
  const canProject    = stateTotal > 0.5;   // "Make a Projection" stays locked until a slider is touched
  const above25Counts: Record<string, boolean> = {};
  for (const [pid, pct] of Object.entries(sliderPcts)) above25Counts[pid] = stateTotal > 0 && pct >= 25;

  return (
    <div className="w-[284px] shrink-0 border-l border-default bg-surface flex flex-col overflow-y-auto z-10">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-default">
        <span className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">State</span>
        <div className="flex items-center gap-1.5">
          {onToggleRef && (
            <button onClick={onToggleRef}
              title="Show 2023 official results as reference"
              className={`h-5 px-2 flex items-center gap-1 rounded text-[7.5px] font-mono font-bold uppercase tracking-wide border transition-colors ${refOpen ? 'bg-[#c8a020] border-[#c8a020] text-white' : 'border-default text-ink-3 hover:text-ink hover:bg-hover'}`}>
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2"/><path d="M5 3v2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="5" cy="7" r="0.6" fill="currentColor"/></svg>
              2023 Ref
            </button>
          )}
          <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded text-ink-3 hover:text-ink hover:bg-hover transition-colors">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>
      <div className="px-3.5 py-3 border-b border-default">
        <div className="font-display text-[14px] font-black uppercase tracking-tight text-ink leading-tight">{name_en}</div>
        <div className="mt-0.5 text-[9px] font-mono text-ink-3 uppercase tracking-wide">{zone}</div>
      </div>

      {showSliders ? (
        <div className="px-3.5 py-3 border-b border-default">
          {showReporting && (
            <div className="mb-3 pb-3 border-b border-default">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">% Reporting</div>
                <span className="text-[12px] font-mono font-semibold tabular-nums" style={{ color: reportingNum >= 99.5 ? '#16a34a' : '#c8a020' }}>{Math.round(reportingNum)}%</span>
              </div>
              <input type="range" min={0} max={100} step={1} value={reportingNum}
                onChange={e => { setReporting(e.target.value); setProjected(false); }}
                className="ca-party-slider w-full"
                style={{ '--party-color': reportingNum >= 99.5 ? '#16a34a' : '#c8a020', '--pct': `${reportingNum}%` } as React.CSSProperties} />
              <div className="flex justify-between mt-0.5">
                <span className="text-[7.5px] font-mono text-ink-3/60">0%</span>
                <span className="text-[7.5px] font-mono text-ink-3/60 tabular-nums">{Math.round((reportingNum / 100) * total).toLocaleString()} votes counted</span>
              </div>
            </div>
          )}
          {activePreset === 'blank' && (
            <button onClick={(!canProject || projected) ? undefined : handleMakeProjection}
              disabled={!canProject || projected}
              className="relative overflow-hidden w-full h-9 rounded-[5px] mb-3 text-white text-[11px] font-mono font-bold uppercase tracking-wide disabled:cursor-not-allowed"
              style={{ background: projected ? '#16a34a' : canProject ? '#c8a020' : '#9ca3af', cursor: (projected || !canProject) ? 'default' : 'pointer' }}>
              {(!projected && canProject) && <span className="absolute inset-0 pointer-events-none" style={{ width:'45%', background:'linear-gradient(105deg,transparent 0%,rgba(255,255,255,0.35) 50%,transparent 100%)', animation:'shimmerSweep 2.2s ease-in-out infinite' }}/>}
              <span className="relative z-10 flex items-center justify-center gap-1.5">
                {projected ? (<><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="rgba(255,255,255,0.25)"/><path d="M3 6l2.2 2.2L9 4" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>Projected</>) : canProject ? 'Make a Projection' : 'Move a slider to project'}
              </span>
            </button>
          )}
          <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-3">
            {activePreset==='2023'?'2023 INEC Result':activePreset==='2027'?'2027 Projection':activePreset==='sim'?'Live Count':'Manual Entry'}
          </div>
          <div className="space-y-3">
            {sliderParties.map(p => {
              const pct = sliderPcts[p.id] ?? 0;
              const rf  = showReporting ? reportingNum / 100 : 1;
              const votes = Math.round((pct / 100) * total * rf);
              const isLocked = locked.has(p.id);
              const isProjLock = activePreset === 'blank' && projected;
              const meetsThresh = pct >= 25;
              return (
                <div key={p.id}>
                  <div className="flex items-center gap-1 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }}/>
                    <span className="text-[9.5px] font-medium text-ink flex-1 leading-none truncate">{NG_PARTY_MAP[p.id]?.name ?? p.id}</span>
                    {meetsThresh && (
                      <span className="text-[7px] font-mono font-bold px-1 py-0.5 rounded shrink-0" style={{ background:`${p.color}22`, color:p.color }}>≥25%</span>
                    )}
                    <button onClick={() => { if (!isProjLock) toggleLock(p.id); }}
                      className={`w-4 h-4 flex items-center justify-center shrink-0 transition-colors ${isProjLock?'text-ink-3/30 cursor-default':isLocked?'text-[#c8a020]':'text-ink-3 hover:text-ink'}`}>
                      {isLocked ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
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
                        className="text-[9.5px] font-mono font-semibold tabular-nums"
                        style={{ color:p.color, minWidth:36, textAlign:'right', cursor:(isLocked||isProjLock)?'default':'text' }}>
                        {pct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <input type="range" min={0} max={100} step={0.1} value={pct}
                    disabled={isLocked || isProjLock}
                    onChange={e => handleSlide(p.id, parseFloat(e.target.value))}
                    className="ca-party-slider w-full"
                    style={{ '--party-color': p.color, '--pct': `${pct}%` } as React.CSSProperties}/>
                  <div className="text-right text-[8px] font-mono text-ink-3 opacity-60 -mt-0.5">{votes.toLocaleString()} votes</div>
                </div>
              );
            })}
          </div>
          <div className="text-[7.5px] font-mono text-ink-3/50 mt-2.5 pt-2 border-t border-default">
            {total.toLocaleString()} valid votes · 25% threshold = {Math.round(total * 0.25).toLocaleString()}
          </div>
        </div>
      ) : !showComp ? (
        <div className="px-3.5 py-3"><div className="text-[9px] font-mono text-ink-3 italic">No data — click a preset</div></div>
      ) : null}

      {showComp && (
        <div className="px-3.5 py-3">
          <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-2">△ vs 2023</div>
          <div className="space-y-2">
            {NG_PARTIES.filter(p => (pct2023[p.id]??0)>0 || (sliderPcts[p.id]??0)>0).map(p => {
              const b = pct2023[p.id] ?? 0; const c = sliderPcts[p.id] ?? 0; const delta = c - b;
              return (
                <div key={p.id}>
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }}/>
                      <span className="text-[8.5px] font-mono font-bold" style={{ color: p.color }}>{p.id}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[8.5px] font-mono tabular-nums">
                      <span className="text-ink-3/60">{b.toFixed(1)}%</span><span className="text-ink-3/30">→</span>
                      <span style={{color:p.color}}>{c.toFixed(1)}%</span>
                      <span className={`text-[7.5px] font-bold ml-0.5 ${delta>0.05?'text-emerald-600':delta<-0.05?'text-red-500':'text-ink-3'}`}>
                        {delta>0.05?'+':''}{Math.abs(delta)<0.05?'—':delta.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden relative" style={{ background:'rgba(0,0,0,0.07)' }}>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width:`${b}%`, background:p.color, opacity:0.28 }}/>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width:`${c}%`, background:p.color, opacity:0.85 }}/>
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

// ── Tooltip ───────────────────────────────────────────────────────────────────
function NgMapTooltip({ tooltip, containerW, containerH, dark = true }: {
  tooltip: NonNullable<TooltipState>; containerW: number; containerH: number; dark?: boolean;
}) {
  const TW = 280; const isSim = tooltip.reportingPct !== undefined;
  const TH_EST = 110 + tooltip.parties.length * 46;
  const left = tooltip.x + 18 + TW > containerW ? tooltip.x - TW - 10 : tooltip.x + 18;
  const top  = Math.max(6, Math.min(tooltip.y - 20, containerH - TH_EST - 8));
  const tt = {
    bg: dark?'rgba(18,24,44,0.96)':'rgba(255,255,255,0.97)', border: dark?'rgba(255,255,255,0.09)':'rgba(0,0,0,0.08)',
    shadow: dark?'0 6px 28px rgba(0,0,0,0.5)':'0 6px 28px rgba(0,0,0,0.12)',
    title: dark?'rgba(255,255,255,0.92)':'rgba(0,0,0,0.85)', sub: dark?'rgba(255,255,255,0.42)':'rgba(0,0,0,0.42)',
    body: dark?'rgba(255,255,255,0.85)':'rgba(0,0,0,0.78)', muted: dark?'rgba(255,255,255,0.38)':'rgba(0,0,0,0.40)',
    dim: dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.35)', divider: dark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.07)', gold:'#c8a020',
  };
  const totalVotes = tooltip.parties.reduce((s, p) => s + p.votes, 0);
  const reportingLabel = isSim ? (tooltip.reportingPct! >= 99.5 ? '100% reporting' : `${tooltip.reportingPct!.toFixed(0)}% reporting`) : null;

  return (
    <div className="absolute pointer-events-none z-[1000]" style={{ left, top, width: TW }}>
      <div style={{ background:tt.bg, borderRadius:10, border:`1px solid ${tt.border}`, boxShadow:tt.shadow, backdropFilter:'blur(10px)', overflow:'hidden' }}>
        <div style={{ padding:'11px 15px 9px' }}>
          <div style={{ fontSize:14, fontWeight:700, color:tt.title, lineHeight:1.2 }}>{tooltip.name_en}</div>
          <div style={{ fontSize:10, fontFamily:'"JetBrains Mono",monospace', color:tt.sub, marginTop:2 }}>
            {isSim ? <>{tooltip.zone} · <span style={{color:tt.gold,fontWeight:700}}>{reportingLabel}</span></> : tooltip.zone}
          </div>
        </div>
        <div style={{ padding:'0 13px 10px' }}>
          {tooltip.parties.length > 0 ? tooltip.parties.map(({ id, votes, pct }, i) => {
            const color = NG_PARTY_MAP[id]?.color ?? '#888';
            const name  = NG_PARTY_MAP[id]?.fullName ?? id;
            const isWinner = i === 0;
            const meetsThresh = pct >= 25;
            return (
              <div key={id} style={{ display:'flex', alignItems:'center', gap:7, marginBottom:i<tooltip.parties.length-1?7:0 }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:color, flexShrink:0 }}/>
                <span style={{ flex:1, minWidth:0, fontSize:10.5, fontWeight:isWinner?600:400, color:tt.body, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
                {meetsThresh && <span style={{ fontSize:7.5, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color, opacity:0.8 }}>≥25%</span>}
                <span style={{ fontSize:9.5, fontFamily:'"JetBrains Mono",monospace', color:tt.muted, marginRight:3 }}>{votes.toLocaleString()}</span>
                <span style={{ fontSize:12, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color, minWidth:44, textAlign:'right' }}>{pct.toFixed(1)}%</span>
              </div>
            );
          }) : <p style={{ fontSize:11, color:tt.dim, fontStyle:'italic', margin:'4px 0' }}>{isSim?'Not yet reporting':'No data — click a preset'}</p>}
        </div>
        {!isSim && (
          <div style={{ borderTop:`1px solid ${tt.divider}`, padding:'6px 15px', display:'flex', justifyContent:'space-between' }}>
            <span style={{ fontSize:9.5, fontFamily:'"JetBrains Mono",monospace', color:tt.dim }}>{totalVotes.toLocaleString()} votes</span>
            <span style={{ fontSize:9.5, fontFamily:'"JetBrains Mono",monospace', color:tt.dim }}>{tooltip.electorate>0?`${fmtVotes(tooltip.electorate)} electors`:''}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 2023 Reference panel ──────────────────────────────────────────────────────
function NgRefPanel({ stateData, selectedId, exiting, onClose }: {
  stateData: NgStateData2[]; selectedId: string | null; exiting: boolean; onClose: () => void;
}) {
  const state = useMemo(() => stateData.find(s => s.id === selectedId), [stateData, selectedId]);
  if (!state) return null;

  const results = state.results2024;
  const total   = Object.values(results).reduce((a, b) => a + b, 0);
  const sorted  = Object.entries(results).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  const winner        = sorted[0]?.[0] ?? null;
  const winnerVotes   = sorted[0]?.[1] ?? 0;
  const runnerUpVotes = sorted[1]?.[1] ?? 0;
  const margin = total > 0 ? ((winnerVotes - runnerUpVotes) / total) * 100 : 0;
  const winnerColor = winner ? (NG_PARTY_MAP[winner]?.color ?? '#888') : '#888';
  const turnout = state.electorate > 0 ? (total / state.electorate) * 100 : 0;

  return (
    <aside className={`w-[248px] shrink-0 border-l border-default bg-surface flex flex-col overflow-hidden z-10 ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-default shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#c8a020' }}/>
          <span className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3">2023 Baseline</span>
        </div>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded text-ink-3 hover:text-ink hover:bg-hover transition-colors">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        </button>
      </div>

      {/* State identity + winner chip */}
      <div className="px-3.5 py-3 border-b border-default shrink-0">
        <div className="font-display text-[13px] font-black uppercase tracking-tight text-ink leading-tight">{state.name}</div>
        <div className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{state.zone}</div>
        {winner && (
          <div className="flex items-center gap-1.5 mt-2 px-2 py-1.5 rounded-[4px]"
            style={{ background: `${winnerColor}14`, border: `1px solid ${winnerColor}30` }}>
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: winnerColor }}/>
            <span className="text-[9px] font-mono font-bold" style={{ color: winnerColor }}>
              {NG_CANDIDATES[winner]?.fullName ?? winner}
            </span>
            <span className="text-[8px] font-mono text-ink-3 ml-auto tabular-nums">+{margin.toFixed(1)}pp</span>
          </div>
        )}
      </div>

      {/* Per-party results */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll">
        <div className="text-[8px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-3">Official INEC Results</div>
        <div className="space-y-3">
          {sorted.map(([pid, votes]) => {
            const pct      = total > 0 ? (votes / total) * 100 : 0;
            const color    = NG_PARTY_MAP[pid]?.color ?? '#888';
            const isWinner = pid === winner;
            return (
              <div key={pid}>
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }}/>
                  <span className="text-[9px] font-mono font-semibold flex-1 leading-none" style={{ color: isWinner ? color : undefined }}>
                    {NG_PARTY_MAP[pid]?.name ?? pid}
                  </span>
                  <span className="text-[8.5px] font-mono tabular-nums text-ink-3">{votes.toLocaleString()}</span>
                  <span className="text-[10px] font-mono font-bold tabular-nums w-10 text-right" style={{ color }}>{pct.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bar-track)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: color, opacity: isWinner ? 1 : 0.55 }}/>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer stats */}
        <div className="mt-4 pt-3 border-t border-default space-y-1">
          {[
            ['Valid votes',    total.toLocaleString()],
            ['Registered',     state.electorate.toLocaleString()],
            ['Turnout',        `${turnout.toFixed(1)}%`],
            ['25% threshold',  Math.round(total * 0.25).toLocaleString() + ' votes'],
          ].map(([label, val]) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[8px] font-mono text-ink-3/60">{label}</span>
              <span className="text-[8px] font-mono tabular-nums text-ink-3">{val}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ── Mandate panel (replaces parliament — shows threshold map) ──────────────────
function NgMandatePanel({ stateData, currentResults, winStatus, above25, nationalVotes, nationalPcts, activePreset, exiting, onClose }: {
  stateData: NgStateData2[]; currentResults: Record<string, Record<string, number>>;
  winStatus: WinStatus; above25: Record<string, number>; nationalVotes: Record<string, number>;
  nationalPcts: Record<string, number>; activePreset: string | null; exiting: boolean; onClose: () => void;
}) {
  const hasData = !!activePreset && activePreset !== 'blank';

  // Build per-zone breakdown
  const zones = ['South-East','South-South','South-West','North-Central','North-East','North-West'];
  const zoneData = useMemo(() => zones.map(zone => {
    const states = stateData.filter(s => s.zone === zone);
    const votes: Record<string, number> = {};
    let total = 0;
    for (const s of states) {
      const r = currentResults[s.id] ?? (activePreset !== 'blank' ? s.results2024 : {});
      for (const [pid, v] of Object.entries(r)) { votes[pid] = (votes[pid] ?? 0) + v; total += v; }
    }
    const sorted = Object.entries(votes).filter(([,v]) => v > 0).sort(([,a],[,b]) => b-a);
    const winner = sorted[0]?.[0] ?? null;
    return { zone, states: states.length, votes, total, winner };
  }), [stateData, currentResults, activePreset]);

  return (
    <aside className={`w-[340px] shrink-0 bg-card border-r border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="px-3 pt-3 pb-2 border-b border-default flex items-start justify-between gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-mono text-ink-3 uppercase tracking-wide mb-0.5">Presidential Election</p>
          <h2 className="text-[13px] font-bold text-ink leading-tight">Mandate Analysis</h2>
          <p className="text-[9px] font-mono text-ink-3 mt-0.5">
            Win: plurality + 25% in {NG_THRESHOLD_STATES}/{NG_TOTAL_UNITS} states
            {winStatus.winner && <span className="text-emerald-600 font-bold ml-1">· {NG_PARTY_MAP[winStatus.winner]?.name} wins</span>}
            {winStatus.runoff && <span className="text-amber-600 font-bold ml-1">· Runoff required</span>}
          </p>
        </div>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0 mt-0.5">×</button>
      </div>

      {!hasData ? (
        <div className="flex-1 flex items-center justify-center"><p className="text-[12px] text-ink-3 italic px-4 text-center">Load a preset to see mandate analysis</p></div>
      ) : (
        <div className="flex-1 overflow-y-auto thin-scroll">
          {/* National popular vote */}
          <div className="px-4 py-3 border-b border-default">
            <p className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-2">National Popular Vote</p>
            {NG_PARTIES.filter(p => (nationalVotes[p.id]??0) > 0).sort((a,b) => (nationalVotes[b.id]??0)-(nationalVotes[a.id]??0)).map(p => {
              const votes = nationalVotes[p.id] ?? 0;
              const pct   = nationalPcts[p.id] ?? 0;
              const thresh = above25[p.id] ?? 0;
              const meetsAll = thresh >= NG_THRESHOLD_STATES;
              return (
                <div key={p.id} className="mb-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }}/>
                    <span className="text-[10px] font-semibold text-ink flex-1">{NG_CANDIDATES[p.id]?.fullName ?? p.name}</span>
                    <span className="text-[9px] font-mono text-ink-3">{votes.toLocaleString()}</span>
                    <span className="text-[11px] font-mono font-bold tabular-nums" style={{ color: p.color }}>{pct.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded overflow-hidden" style={{ background:'var(--bar-track)' }}>
                      <div className="h-full rounded" style={{ width:`${Math.min(pct,60)/60*100}%`, background:p.color }}/>
                    </div>
                    <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded ${meetsAll?'text-emerald-700 bg-emerald-100':'text-amber-700 bg-amber-50'}`}>
                      25% in {thresh}/{NG_TOTAL_UNITS}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Zone breakdown */}
          <div className="px-4 py-3">
            <p className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-3">Geopolitical Zone Breakdown</p>
            <div className="space-y-3.5">
              {zoneData.map(z => (
                <div key={z.zone}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-ink">{z.zone}</span>
                    <span className="text-[9px] text-ink-3 font-mono">{z.states} states</span>
                  </div>
                  <div className="flex h-2.5 rounded overflow-hidden mb-1">
                    {Object.entries(z.votes).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).map(([pid,votes]) => (
                      <div key={pid} className="h-full" title={`${pid}: ${((votes/z.total)*100).toFixed(1)}%`}
                        style={{ width:`${(votes/z.total)*100}%`, background:NG_PARTY_MAP[pid]?.color??'#888' }}/>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                    {Object.entries(z.votes).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,4).map(([pid,votes]) => (
                      <span key={pid} className="flex items-center gap-1 text-[8.5px] text-ink-3">
                        <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{background:NG_PARTY_MAP[pid]?.color??'#888'}}/>
                        <span className="font-mono">{pid} {z.total>0?((votes/z.total)*100).toFixed(0):'0'}%</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

// ── Breakdown drawer ──────────────────────────────────────────────────────────
function NgBreakdownDrawer({ stateData, currentResults, activePreset, exiting, onClose }: {
  stateData: NgStateData2[]; currentResults: Record<string, Record<string, number>>; activePreset: string | null; exiting: boolean; onClose: () => void;
}) {
  const [tab, setTab] = useState<'zone'|'closest'|'threshold'|'flips'>('zone');
  const hasData = !!activePreset && activePreset !== 'blank';

  const stateResults = useMemo(() => {
    if (!hasData) return [];
    return stateData.map(s => {
      const r = currentResults[s.id] ?? s.results2024;
      const total = Object.values(r).reduce((a, b) => a + b, 0);
      const sorted = Object.entries(r).filter(([,v]) => v > 0).sort(([,a],[,b]) => b-a);
      const [winner='APC', winnerV=0] = sorted[0] ?? [];
      const [runnerUp=null, ruV=0]    = sorted[1] ?? [];
      const winnerPct = total > 0 ? (winnerV/total)*100 : 0;
      const marginPct = winnerPct - (total > 0 ? (ruV as number/total)*100 : 0);
      return { id:s.id, name:s.name, zone:s.zone, validVotes:total, winner, runnerUp, winnerPct, marginPct, results:r };
    });
  }, [stateData, currentResults, hasData]);

  const zoneData = useMemo(() => {
    const map = new Map<string, Record<string,number>>();
    for (const r of stateResults) {
      const z = map.get(r.zone) ?? {};
      z[r.winner] = (z[r.winner] ?? 0) + 1;
      map.set(r.zone, z);
    }
    return Array.from(map.entries()).map(([zone, wins]) => ({
      zone, wins, total: Object.values(wins).reduce((a,b) => a+b, 0)
    })).sort((a,b) => b.total-a.total);
  }, [stateResults]);

  const closestStates = useMemo(() => [...stateResults].sort((a,b) => a.marginPct-b.marginPct).slice(0,20), [stateResults]);

  // Threshold states per party
  const thresholdData = useMemo(() => {
    const counts: Record<string, {above: string[]; below: string[]}> = {};
    for (const p of NG_PARTIES) counts[p.id] = { above: [], below: [] };
    for (const r of stateResults) {
      const total = r.validVotes;
      if (total === 0) continue;
      for (const [pid, votes] of Object.entries(r.results)) {
        const pct = (votes / total) * 100;
        if (pct >= 25) counts[pid].above.push(r.name);
        else counts[pid].below.push(r.name);
      }
    }
    return counts;
  }, [stateResults]);

  const flippedStates = useMemo(() => {
    if (!hasData) return [];
    return stateResults.filter(r => r.winner !== (stateData.find(s => s.id === r.id)?.winner2023 ?? r.winner));
  }, [stateResults, stateData, hasData]);

  const tabs = [
    {id:'zone' as const, label:'By zone'},
    {id:'closest' as const, label:'Closest'},
    {id:'threshold' as const, label:'25% Rule'},
    {id:'flips' as const, label:`Flips${flippedStates.length>0?` (${flippedStates.length})`:''}`},
  ];

  return (
    <aside className={`w-80 shrink-0 bg-surface border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-default shrink-0">
        <h2 className="text-[15px] font-semibold text-ink">Race breakdown</h2>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-hover text-ink-3 hover:text-ink text-lg">×</button>
      </div>
      <div className="flex border-b border-default shrink-0">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 text-[8.5px] py-2.5 font-medium transition-colors whitespace-nowrap px-1 ${tab===t.id?'text-[#c8a020] border-b-2 border-[#c8a020]':'text-ink-3 hover:text-ink'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {!hasData ? (
        <div className="flex-1 flex items-center justify-center"><p className="text-[12px] text-ink-3 italic">Load a preset to see breakdown</p></div>
      ) : (
        <div className="flex-1 overflow-y-auto thin-scroll">
          {tab === 'zone' && (
            <div className="p-4 space-y-4">
              {zoneData.map(z => (
                <div key={z.zone}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[12px] font-semibold text-ink">{z.zone}</span>
                    <span className="text-[10px] text-ink-3 font-mono">{z.total} states</span>
                  </div>
                  <div className="flex h-2.5 rounded overflow-hidden mb-1.5">
                    {Object.entries(z.wins).sort(([,a],[,b]) => (b as number)-(a as number)).map(([pid,n]) => (
                      <div key={pid} className="h-full" style={{ width:`${((n as number)/z.total)*100}%`, background:NG_PARTY_MAP[pid]?.color??'#888' }}/>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                    {Object.entries(z.wins).sort(([,a],[,b]) => (b as number)-(a as number)).map(([pid,n]) => (
                      <span key={pid} className="flex items-center gap-1 text-[8.5px] text-ink-3">
                        <span className="inline-block w-2 h-2 rounded-sm" style={{background:NG_PARTY_MAP[pid]?.color??'#888'}}/>
                        <span className="font-mono">{pid} {n as number}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'closest' && (
            <div className="divide-y divide-default">
              {closestStates.map((c, i) => (
                <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="text-[10px] text-ink-3 w-4 shrink-0 font-mono">{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{background:NG_PARTY_MAP[c.winner]?.color??'#888'}}/>
                      {c.runnerUp && <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{background:NG_PARTY_MAP[c.runnerUp]?.color??'#888'}}/>}
                      <span className="text-[11px] text-ink truncate">{c.name}</span>
                    </div>
                    <span className="text-[9px] text-ink-3">{c.zone}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-mono text-ink">{c.winnerPct.toFixed(1)}%</div>
                    <div className="text-[9px] font-mono text-[#c8a020]">+{c.marginPct.toFixed(1)}pp</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'threshold' && (
            <div className="p-4 space-y-4">
              <p className="text-[8.5px] font-mono text-ink-3 leading-relaxed mb-1">
                Candidates need ≥25% in at least {NG_THRESHOLD_STATES} of {NG_TOTAL_UNITS} states to win outright. Otherwise a runoff is held.
              </p>
              {NG_PARTIES.filter(p => p.id !== 'OTH' && thresholdData[p.id]).map(p => {
                const td = thresholdData[p.id] ?? { above: [], below: [] };
                if (td.above.length === 0 && td.below.length === 0) return null;
                const meetsAll = td.above.length >= NG_THRESHOLD_STATES;
                const cand = NG_CANDIDATES_2027[p.id] ?? NG_CANDIDATES[p.id];
                return (
                  <div key={p.id}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:p.color}}/>
                      <span className="text-[10px] font-semibold text-ink flex-1">{cand?.fullName ?? p.name}</span>
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${meetsAll?'text-emerald-700 bg-emerald-100':'text-amber-700 bg-amber-50'}`}>
                        {td.above.length}/{NG_TOTAL_UNITS} {meetsAll?'✓ qualifies':'⚠ short'}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{background:'var(--bar-track)'}}>
                      <div className="h-full rounded-full transition-all" style={{ width:`${(td.above.length/NG_TOTAL_UNITS)*100}%`, background:p.color }}/>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[7.5px] font-mono text-ink-3/60">{td.above.length} states above 25%</span>
                      <span className="text-[7.5px] font-mono text-ink-3/40">{NG_THRESHOLD_STATES} needed</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {tab === 'flips' && (
            <div className="divide-y divide-default">
              {flippedStates.length === 0 ? (
                <div className="px-4 py-8 text-center"><p className="text-[11px] text-ink-3 italic">No states flipped from 2023 baseline</p></div>
              ) : flippedStates.map(c => {
                const prev = stateData.find(s => s.id === c.id)?.winner2023 ?? 'APC';
                return (
                  <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:NG_PARTY_MAP[prev]?.color??'#888'}}/>
                      <span className="text-[9px] text-ink-3">→</span>
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{background:NG_PARTY_MAP[c.winner]?.color??'#888'}}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-ink truncate">{c.name}</div>
                      <div className="text-[9px] text-ink-3">{c.zone}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[9.5px] font-mono text-ink">{prev}→<span style={{color:NG_PARTY_MAP[c.winner]?.color}}>{c.winner}</span></div>
                      <div className="text-[8.5px] font-mono text-[#c8a020]">+{c.marginPct.toFixed(1)}pp</div>
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

// ── Swing panel ───────────────────────────────────────────────────────────────
function NgSwingPanel({ exiting=false, stateData, currentResults, onResultsChange, activePreset, onReset, onClose }: {
  exiting?: boolean; stateData: NgStateData2[]; currentResults: Record<string, Record<string, number>>;
  onResultsChange: (id: string, r: Record<string,number>) => void;
  activePreset: string | null; onReset: () => void; onClose: () => void;
}) {
  const [inputs, setInputs] = useState<Record<string,string>>({});
  const disabled = !activePreset || activePreset === 'blank';

  const applySwing = (pid: string) => {
    const val = parseFloat(inputs[pid] ?? ''); if (isNaN(val) || val === 0) return;
    for (const s of stateData) {
      const results = { ...(currentResults[s.id] ?? s.results2024) };
      const cur = results[pid] ?? 0; const delta = Math.round((val / 100) * s.validVotes);
      const newV = Math.max(0, Math.min(cur + delta, s.validVotes));
      const actualD = newV - cur; if (actualD === 0) continue;
      const others = Object.keys(results).filter(p => p !== pid && (results[p] ?? 0) > 0);
      const othSum = others.reduce((s, p) => s + (results[p] ?? 0), 0);
      const nr: Record<string, number> = { ...results, [pid]: newV };
      if (othSum > 0) for (const p of others) nr[p] = Math.max(0, Math.round((results[p] ?? 0) - actualD * ((results[p] ?? 0) / othSum)));
      onResultsChange(s.id, nr);
    }
    setInputs(prev => ({ ...prev, [pid]: '' }));
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
            {NG_PARTIES.filter(p => p.id !== 'OTH').map(({ id: pid, color }) => {
              const raw = inputs[pid] ?? ''; const valid = !isNaN(parseFloat(raw)) && parseFloat(raw) !== 0;
              return (
                <div key={pid} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }}/>
                  <span className="text-[9.5px] font-mono text-ink-2 w-14 shrink-0">{pid}</span>
                  <input type="number" value={raw} placeholder="±pp" disabled={disabled}
                    onChange={e => setInputs(prev => ({ ...prev, [pid]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && applySwing(pid)}
                    className="flex-1 h-6 text-[11px] font-mono rounded-[4px] border border-default bg-white text-ink px-2 text-center focus:outline-none disabled:opacity-40"/>
                  <button onClick={() => applySwing(pid)} disabled={disabled || !valid}
                    className="h-6 px-2 text-[10px] font-mono font-semibold rounded-[4px] border border-default text-ink-2 hover:bg-hover disabled:opacity-30 transition-colors">Apply</button>
                </div>
              );
            })}
          </div>
        </section>
        <section className="pt-2 border-t border-default">
          <button onClick={onReset} disabled={disabled}
            className="w-full h-7 text-[11px] font-mono font-medium rounded-[4px] border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors uppercase tracking-wide">
            Reset to {activePreset === '2027' ? '2027 polling' : '2023 INEC baseline'}
          </button>
        </section>
      </div>
    </aside>
  );
}

// ── Simulation panel ──────────────────────────────────────────────────────────
const NG_SIM_ZONES: Record<string, number> = {
  AB:0, AN:0, EB:0, EN:0, IM:0,
  AK:1, BY:1, CR:1, DE:1, ED:1, RI:1,
  EK:2, LA:2, OG:2, ON:2, OS:2, OY:2,
  BE:3, FC:3, KO:3, KW:3, NA:3, NI:3, PL:3,
  AD:4, BA:4, BO:4, GO:4, TA:4, YO:4,
  JI:5, KD:5, KN:5, KT:5, KE:5, SO:5, ZA:5,
};
const NG_ZONE_WINDOWS: [number,number][] = [
  [0.00,0.25],[0.15,0.45],[0.30,0.65],[0.45,0.80],[0.60,0.92],[0.72,1.00],
];

function randNormalNg(): number {
  let u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}

function generateNgResult(state: NgStateData2, targetPcts: Record<string,number>, national2027: Record<string,number>): Record<string,number> {
  const base: Record<string,number> = DATA_2027[state.id]?{...DATA_2027[state.id]}:{APC:0.42,NDC:0.34,OTH:0.24};
  for(const[pid,tp]of Object.entries(targetPcts)){ const swing=tp/100-(national2027[pid]??0); base[pid]=Math.max(0,(base[pid]??0)+swing); }
  const total=Object.values(base).reduce((s,v)=>s+v,0);
  if(total<=0)return{...state.results2024};
  const entries=Object.entries(base).sort(([,a],[,b])=>b-a);
  const nr:Record<string,number>={};let distributed=0;
  for(let i=0;i<entries.length-1;i++){const[p,v]=entries[i];nr[p]=Math.round((v/total)*state.validVotes);distributed+=nr[p];}
  const[lastP]=entries[entries.length-1];nr[lastP]=Math.max(0,state.validVotes-distributed);
  return nr;
}

function NgSimulationPanel({ exiting=false, stateData, onApplyResults, onUpdateState, onClose, simRunning, simProgress, timersRef, setSimRunning, setSimProgress, stopSim }: {
  exiting?: boolean; stateData: NgStateData2[];
  onApplyResults: (r:Record<string,Record<string,number>>)=>void;
  onUpdateState: (id:string,r:Record<string,number>)=>void;
  onClose:()=>void; simRunning:boolean; simProgress:number;
  timersRef:React.MutableRefObject<ReturnType<typeof setTimeout>[]>;
  setSimRunning:(v:boolean)=>void; setSimProgress:(v:number)=>void; stopSim:()=>void;
}) {
  const [duration, setDuration] = useState<60000|120000|300000|600000>(120000);
  const [natPcts, setNatPcts]   = useState<Record<string,string>>({APC:'42',NDC:'34',OTH:'24'});

  const national2027Avg = useMemo(()=>{
    let tV=0;const sums:Record<string,number>={};
    for(const s of stateData){const d=DATA_2027[s.id]??{APC:0.37,PDP:0.29,LP:0.25,NNPP:0.06,OTH:0.03};for(const[p,f]of Object.entries(d))sums[p]=(sums[p]??0)+f*s.validVotes;tV+=s.validVotes;}
    if(tV===0)return{APC:0.42,NDC:0.34,OTH:0.24};
    const avg:Record<string,number>={};for(const[p,v]of Object.entries(sums))avg[p]=v/tV;return avg;
  },[stateData]);

  const runSim = useCallback(()=>{
    if(simRunning){stopSim();return;}
    const tp:Record<string,number>={};
    for(const p of NG_PARTIES)tp[p.id]=parseFloat(natPcts[p.id]??'0')||0;
    const tSum=Object.values(tp).reduce((s,v)=>s+v,0);
    if(tSum>0)for(const k of Object.keys(tp))tp[k]=(tp[k]/tSum)*100;
    const all:Record<string,Record<string,number>>={};
    for(const s of stateData)all[s.id]=generateNgResult(s,tp,national2027Avg);
    setSimRunning(true);setSimProgress(0);
    const timers:ReturnType<typeof setTimeout>[]=[];
    const groups:NgStateData2[][]=[[],[],[],[],[],[]];
    for(const s of stateData)groups[NG_SIM_ZONES[s.id]??3].push(s);
    let done=0;const totalBatches=stateData.length*5;
    for(let z=0;z<6;z++){
      const[sf,ef]=NG_ZONE_WINDOWS[z];const grp=groups[z];
      for(const state of grp){
        const bf:number[]=[];
        for(let b=0;b<5;b++){const u=randNormalNg()*0.10+sf+(b/4)*(ef-sf);bf.push(Math.min(1,Math.max(sf,u)));}
        bf.sort((a,b)=>a-b);
        const full=all[state.id];
        for(let b=0;b<5;b++){
          const frac=(b+1)/5;const ms=Math.round(bf[b]*duration);
          const partial:Record<string,number>={};
          for(const[pid,votes]of Object.entries(full))partial[pid]=Math.round(votes*frac);
          const t=setTimeout(()=>{onUpdateState(state.id,partial);done++;setSimProgress(Math.min(99,(done/totalBatches)*100));},ms);
          timers.push(t);
        }
      }
    }
    const ft=setTimeout(()=>{onApplyResults(all);setSimRunning(false);setSimProgress(100);},duration+300);
    timers.push(ft);timersRef.current=timers;
  },[simRunning,stopSim,stateData,natPcts,duration,national2027Avg,onApplyResults,onUpdateState,setSimRunning,setSimProgress,timersRef]);

  const durLabels:[60000|120000|300000|600000,string][] = [[60000,'1 min'],[120000,'2 min'],[300000,'5 min'],[600000,'10 min']];

  return (
    <aside className={`w-80 shrink-0 bg-card border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <h2 className="text-[13px] font-bold text-ink">Live Simulation</h2>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3.5 thin-scroll space-y-4">
        <section>
          <p className="eyebrow mb-2">National vote share targets</p>
          <div className="space-y-1.5">
            {NG_PARTIES.filter(p=>NG_PARTIES_2027.includes(p.id as typeof NG_PARTIES_2027[number])&&p.id!=='OTH').map(p=>(
              <div key={p.id} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:p.color}}/>
                <span className="text-[9.5px] font-mono text-ink-2 w-14 shrink-0">{p.id}</span>
                <input type="number" min={0} max={100} step={0.5} value={natPcts[p.id]??''} onChange={e=>setNatPcts(prev=>({...prev,[p.id]:e.target.value}))} disabled={simRunning}
                  className="flex-1 h-6 text-[11px] font-mono rounded-[4px] border border-default bg-white text-ink px-2 text-center focus:outline-none disabled:opacity-50"/>
                <span className="text-[10px] font-mono text-ink-3">%</span>
              </div>
            ))}
            <div className="text-[8.5px] font-mono text-ink-3/60">OTH = remainder</div>
          </div>
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
              <span className="text-[9px] font-mono text-ink-3 uppercase tracking-wide">Collating results…</span>
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
          South-East (LP strongholds) calls first. South-South and South-West follow. North-Central and North-East then call in. The large North-West states (Kano, Katsina, Kaduna) report last. 5 batches per state, bell-curve timing.
        </p>
      </div>
    </aside>
  );
}

// ── Tutorial panel ────────────────────────────────────────────────────────────
function NgTutorialPanel({ onClose, exiting }: { onClose:()=>void; exiting:boolean }) {
  const H2=({children}:{children:React.ReactNode})=><div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-5 mb-1.5 first:mt-0">{children}</div>;
  const P=({children}:{children:React.ReactNode})=><p className="text-[11px] text-ink leading-relaxed mb-2">{children}</p>;
  const Tag=({children}:{children:React.ReactNode})=><span className="inline-block px-1.5 py-0.5 rounded-[3px] text-[9px] font-mono font-semibold bg-ink/8 text-ink mr-1">{children}</span>;
  const Note=({children}:{children:React.ReactNode})=><div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{children}</div>;
  return (
    <aside className={`w-80 shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Nigeria Presidential Election Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2>Nigeria's Presidential System</H2>
        <P>Nigeria holds a <strong>direct popular vote</strong> across all 36 states and FCT. Winning requires two conditions:</P>
        <div className="flex gap-2 mb-2">
          <div className="flex-1 bg-muted-bg border border-default rounded-[4px] px-2.5 py-2">
            <div className="text-[9px] font-mono font-bold text-ink uppercase tracking-wide mb-1">Plurality</div>
            <div className="text-[9.5px] text-ink-2 leading-relaxed">Most votes nationally</div>
          </div>
          <div className="flex-1 bg-muted-bg border border-default rounded-[4px] px-2.5 py-2">
            <div className="text-[9px] font-mono font-bold text-ink uppercase tracking-wide mb-1">25% Rule</div>
            <div className="text-[9.5px] text-ink-2 leading-relaxed">≥25% in 24 of 37 states</div>
          </div>
        </div>
        <Note>If no candidate satisfies both conditions, a <strong>runoff</strong> is held between the top two. The slider panel shows a <strong>≥25%</strong> badge when a party clears the threshold in a state.</Note>
        <H2>2023 Election</H2>
        <P><strong>Bola Tinubu (APC)</strong> won — 8.79M votes (36.6%), clearing 25% in 30+ states. Peter Obi (LP) swept the South-East. NNPP's Kwankwaso won Kano state outright.</P>
        <H2>2027 Candidates</H2>
        <P><strong style={{color:'#0EA5E9'}}>APC — Bola Tinubu</strong> — Incumbent president. Yoruba Muslim from Lagos. Dominant in the Muslim North and South-West.</P>
        <P><strong style={{color:'#B91C1C'}}>NDC — Peter Obi</strong> — Igbo Catholic from Anambra. Moved from Labour Party to New Democratic Congress. Sweeps the South-East, competitive across the Christian South and urban youth vote.</P>
        <P><strong style={{color:'#666666'}}>OTH — Others</strong> — Absorbs residual PDP voters (no Atiku candidacy), NNPP voters in Kano (no Kwankwaso), and minor parties.</P>
        <H2>Other Tools</H2>
        <div className="space-y-1 text-[10px] text-ink-2 leading-relaxed">
          <div><Tag>Mandate</Tag> Zone breakdown + 25% threshold compliance per candidate.</div>
          <div><Tag>Breakdown</Tag> Zone wins, closest states, threshold tracker, flip monitor.</div>
          <div><Tag>Swing</Tag> Apply national ±pp to all 37 states.</div>
          <div><Tag>Bubble Map</Tag> Circles sized by winner margin over runner-up.</div>
        </div>
        <div className="h-4"/>
      </div>
    </aside>
  );
}

// ── Main Nigeria App ──────────────────────────────────────────────────────────
export default function NigeriaApp() {
  const navigate = useNavigate();
  const [dark, setDark]     = useState(() => localStorage.getItem('darkMode') !== 'false');
  const [contributorsOpen, setContributorsOpen] = useState(false);
  const [geojson, setGeojson] = useState<GeoJsonObject | null>(null);
  const stateData             = useMemo(() => NG_STATE_DATA as NgStateData2[], []);
  const [activePreset, setActivePreset] = useState<'2023'|'2027'|'blank'|'sim'|null>(null);
  const [currentResults, setCurrentResults] = useState<Record<string,Record<string,number>>>({});
  const [stateReporting, setStateReporting] = useState<Record<string,number>>({});
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [selectedState, setSelectedState]   = useState<SelectedState|null>(null);
  const [bubbleMapMode, setBubbleMapMode]   = useState(false);
  const [tooltip, setTooltip]               = useState<TooltipState>(null);
  const [mandateOpen, setMandateOpen]       = useState(false);
  const [mandateExiting, setMandateExiting] = useState(false);
  const [breakdownOpen, setBreakdownOpen]   = useState(false);
  const [breakdownExiting, setBreakdownExiting] = useState(false);
  const [swingOpen, setSwingOpen]           = useState(false);
  const [swingExiting, setSwingExiting]     = useState(false);
  const [simOpen, setSimOpen]               = useState(false);
  const [simExiting, setSimExiting]         = useState(false);
  const [refOpen, setRefOpen]               = useState(false);
  const [refExiting, setRefExiting]         = useState(false);
  const [simRunning, setSimRunning]         = useState(false);
  const [tutorialOpen, setTutorialOpen]     = useState(false);
  const [tutorialExiting, setTutorialExiting] = useState(false);
  const [simProgress, setSimProgress]       = useState(0);
  const simTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stopSim = useCallback(()=>{ for(const t of simTimersRef.current)clearTimeout(t);simTimersRef.current=[];setSimRunning(false); },[]);

  const headerScrollRef = useRef<HTMLDivElement>(null);
  const layerRef        = useRef<L.GeoJSON|null>(null);
  const containerRef    = useRef<HTMLDivElement>(null);
  const initialLoadRef  = useRef(false);
  const activePresetRef    = useRef(activePreset);
  const currentResultsRef  = useRef(currentResults);
  const stateReportingRef  = useRef(stateReporting);
  const simRunningRef      = useRef(simRunning);
  const byIdMapRef         = useRef<Map<string,NgStateData2>>(new Map());
  const geoPropsMapRef     = useRef<Map<string,{name_en:string;zone:string}>>(new Map());
  const selectedStateIdRef = useRef<string|null>(null);
  const bubbleModeRef      = useRef(bubbleMapMode);

  const byIdMap = useMemo(()=>{ const m=new Map<string,NgStateData2>();for(const s of stateData)m.set(s.id,s);return m; },[stateData]);
  const geoPropsMap = useMemo(()=>{
    if(!geojson)return new Map<string,{name_en:string;zone:string}>();
    const m=new Map<string,{name_en:string;zone:string}>();
    for(const f of (geojson as any).features??[]){const p=f.properties;m.set(p.id,{name_en:p.name_en??'',zone:p.province??''});}
    return m;
  },[geojson]);

  useEffect(()=>{ activePresetRef.current=activePreset; },[activePreset]);
  useEffect(()=>{ currentResultsRef.current=currentResults; },[currentResults]);
  useEffect(()=>{ stateReportingRef.current=stateReporting; },[stateReporting]);
  useEffect(()=>{ simRunningRef.current=simRunning; },[simRunning]);
  useEffect(()=>{ byIdMapRef.current=byIdMap; },[byIdMap]);
  useEffect(()=>{ geoPropsMapRef.current=geoPropsMap; },[geoPropsMap]);
  useEffect(()=>{ selectedStateIdRef.current=selectedState?.id??null; },[selectedState]);
  useEffect(()=>{ bubbleModeRef.current=bubbleMapMode; },[bubbleMapMode]);
  const selectedStateId = selectedState?.id??null;

  const nationalVotes = useMemo(()=>{
    const t:Record<string,number>={};if(!activePreset)return t;
    for(const r of Object.values(currentResults))for(const[pid,v]of Object.entries(r))t[pid]=(t[pid]??0)+v;
    return t;
  },[activePreset,currentResults]);

  const nationalPcts = useMemo(()=>{
    const p:Record<string,number>={};const grand=Object.values(nationalVotes).reduce((s,v)=>s+v,0);
    if(grand===0)return p;for(const[pid,v]of Object.entries(nationalVotes))p[pid]=(v/grand)*100;return p;
  },[nationalVotes]);

  // National reporting progress (for the bottom-left widget on the blank map + live sim)
  const ngTotalValid = useMemo(()=>stateData.reduce((s,st)=>s+st.validVotes,0),[stateData]);
  const nationalReporting = useMemo(()=>{
    const counted=Object.values(nationalVotes).reduce((s,v)=>s+v,0);
    let states=0;
    for(const s of stateData){ const r=currentResults[s.id]; if(r&&Object.values(r).some(v=>v>0)) states++; }
    return { counted, pct: ngTotalValid>0?(counted/ngTotalValid)*100:0, states };
  },[nationalVotes,currentResults,stateData,ngTotalValid]);

  const stateCounts = useMemo(()=>{
    const t:Record<string,number>={};if(!activePreset)return t;
    for(const s of stateData){
      const r=currentResults[s.id]??(activePreset!=='blank'?s.results2024:{});
      if(!Object.keys(r).length)continue;
      const winner=Object.entries(r).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a)[0]?.[0];
      if(winner)t[winner]=(t[winner]??0)+1;
    }
    return t;
  },[activePreset,currentResults,stateData]);

  const winStatus = useMemo(()=>computeWinStatus(stateData,currentResults,activePreset),[stateData,currentResults,activePreset]);
  const above25   = winStatus.above25;

  const bubbleData = useMemo(()=>{
    if(!bubbleMapMode||!geojson)return [];
    let maxMargin=1;
    const items:{id:string;center:[number,number];margin:number;color:string}[]=[];
    for(const feature of (geojson as any).features??[]){
      const id:string=feature.properties?.id??'';const data=byIdMap.get(id);if(!data)continue;
      const results=currentResults[id]??((activePreset==='2023'||activePreset==='2027')?data.results2024:{});
      const sorted=Object.values(results).filter((v):v is number=>v>0).sort((a,b)=>b-a);if(!sorted.length)continue;
      const margin=sorted.length>=2?sorted[0]-sorted[1]:sorted[0];if(margin>maxMargin)maxMargin=margin;
      const fill=(activePreset&&(activePreset!=='blank'||!!currentResults[id]))?stateFill(results,dark):(dark?'#374151':BLANK_COLOR);
      items.push({id,center:computeCentroid(feature.geometry),margin,color:fill});
    }
    return items.map(it=>({...it,radius:1.5+Math.sqrt(it.margin/maxMargin)*13}));
  },[bubbleMapMode,geojson,currentResults,activePreset,byIdMap,dark]);

  useEffect(()=>{ document.documentElement.classList.toggle('dark',dark);localStorage.setItem('darkMode',String(dark)); },[dark]);
  useEffect(()=>{
    const el=headerScrollRef.current;if(!el)return;
    const h=(e:WheelEvent)=>{ if(Math.abs(e.deltaX)>Math.abs(e.deltaY))return;e.preventDefault();el.scrollLeft+=e.deltaY; };
    el.addEventListener('wheel',h,{passive:false});return()=>el.removeEventListener('wheel',h);
  },[]);
  useEffect(()=>{ fetch(`${import.meta.env.BASE_URL}nigeria-states.geojson`).then(r=>r.json()).then(setGeojson).catch(console.error); },[]);

  useEffect(()=>{
    if(!layerRef.current)return;
    if(bubbleMapMode){layerRef.current.setStyle(()=>({fillOpacity:0,weight:0.4,color:dark?'#666':'#bbb',opacity:0.6}));return;}
    const baseColor=dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.35)';
    layerRef.current.eachLayer((layer:L.Layer)=>{
      const path=layer as L.Path&{feature?:Feature};
      const id=(path.feature?.properties as Record<string,string>|undefined)?.id??'';
      const isSel=id===selectedStateId;
      let fillColor=dark?'#374151':BLANK_COLOR;
      if(activePreset==='blank'){const r=currentResults[id];const d=byIdMap.get(id);if(r&&d&&Object.values(r).some(v=>v>0))fillColor=stateFill(r,dark);}
      else if(activePreset){const r=currentResults[id]??byIdMap.get(id)?.results2024;if(r)fillColor=stateFill(r,dark);}
      path.setStyle({fillColor,fillOpacity:0.72,color:isSel?'#c8a020':baseColor,weight:isSel?2:0.5,opacity:1});
    });
  },[activePreset,currentResults,selectedStateId,byIdMap,bubbleMapMode,dark,geojson]);

  const load2023 = useCallback(()=>{ const r:Record<string,Record<string,number>>={};for(const s of byIdMapRef.current.values())r[s.id]={...s.results2024};setCurrentResults(r);setStateReporting({});setActivePreset('2023'); },[]);
  const load2027 = useCallback(()=>{
    const r:Record<string,Record<string,number>>={};
    for(const s of byIdMapRef.current.values()){
      const p=DATA_2027[s.id];if(!p){r[s.id]={...s.results2024};continue;}
      const nr:Record<string,number>={};let assigned=0;
      for(const[pid,frac]of Object.entries(p)){const v=Math.round(frac*s.validVotes);nr[pid]=v;assigned+=v;}
      const diff=s.validVotes-assigned;const top=Object.entries(nr).sort(([,a],[,b])=>b-a)[0]?.[0];
      if(top&&diff!==0)nr[top]=(nr[top]??0)+diff;r[s.id]=nr;
    }
    setCurrentResults(r);setStateReporting({});setActivePreset('2027');
  },[]);
  const loadBlank = useCallback(()=>{ setCurrentResults({});setStateReporting({});setActivePreset('blank');setSelectedState(null); },[]);
  useEffect(()=>{ if(stateData.length>0&&geojson&&!initialLoadRef.current){initialLoadRef.current=true;load2027();} },[stateData,geojson,load2027]);

  const handleStateResultsChange = useCallback((id:string,nr:Record<string,number>)=>{ setCurrentResults(prev=>({...prev,[id]:nr})); },[]);
  const handleReportingCommit    = useCallback((id:string,pct:number)=>{ setStateReporting(prev=>({...prev,[id]:pct})); },[]);
  const closeRef        = useCallback(()=>{ setRefExiting(true);setTimeout(()=>{setRefOpen(false);setRefExiting(false);},260); },[]);
  const toggleRef       = useCallback(()=>{ if(refOpen){closeRef();}else{setRefOpen(true);setRefExiting(false);} },[refOpen,closeRef]);
  const toggleMandate   = useCallback(()=>{ if(mandateOpen){setMandateExiting(true);setTimeout(()=>{setMandateOpen(false);setMandateExiting(false);},260);}else{setMandateOpen(true);setMandateExiting(false);} },[mandateOpen]);
  const toggleBreakdown = useCallback(()=>{ if(breakdownOpen){setBreakdownExiting(true);setTimeout(()=>{setBreakdownOpen(false);setBreakdownExiting(false);},260);}else{setBreakdownOpen(true);setBreakdownExiting(false);} },[breakdownOpen]);
  const toggleSwing     = useCallback(()=>{ if(swingOpen){setSwingExiting(true);setTimeout(()=>{setSwingOpen(false);setSwingExiting(false);},260);}else{setSwingOpen(true);setSwingExiting(false);} },[swingOpen]);
  const toggleSim       = useCallback(()=>{ if(simOpen){setSimExiting(true);setTimeout(()=>{setSimOpen(false);setSimExiting(false);},260);}else{setSimOpen(true);setSimExiting(false);} },[simOpen]);
  const handleSimApply  = useCallback((r:Record<string,Record<string,number>>)=>{ setCurrentResults(r);setStateReporting({});setActivePreset('sim'); },[]);

  const handleEachFeature = useCallback((_feature:Feature,layer:L.Layer)=>{
    const props=(_feature as Feature&{properties:Record<string,string>}).properties;
    const id=props.id??'';
    layer.on('click',()=>setSelectedState({id,name_en:props.name_en??'',zone:props.province??''}));
    layer.on('mousemove',(e:L.LeafletMouseEvent)=>{
      if(bubbleModeRef.current){setTooltip(null);return;}
      const data=byIdMapRef.current.get(id);const rect=containerRef.current?.getBoundingClientRect();if(!rect)return;
      const preset=activePresetRef.current;
      const rawR=(preset==='2023'||preset==='2027'||preset==='sim'||preset==='blank')?(currentResultsRef.current[id]??{}):{};
      const totalR=Object.values(rawR).reduce((s,v)=>s+v,0);
      const parties=Object.entries(rawR).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).map(([pid,votes])=>({id:pid,votes,pct:totalR>0?Math.round((votes/totalR)*1000)/10:0}));
      const above25:Record<string,boolean>={};for(const{id:pid,pct}of parties)above25[pid]=pct>=25;
      const reportingPct=(preset==='sim'||simRunningRef.current)?(data&&data.validVotes>0?(totalR/data.validVotes)*100:undefined):(preset==='blank'&&currentResultsRef.current[id]?(stateReportingRef.current[id]??100):undefined);
      setTooltip({x:e.originalEvent.clientX-rect.left,y:e.originalEvent.clientY-rect.top,name_en:props.name_en??'',zone:props.province??'',electorate:data?.electorate??0,validVotes:data?.validVotes??0,parties,above25,reportingPct});
    });
    layer.on('mouseout',()=>setTooltip(null));
  },[]);

  const geoStyle=useCallback(():L.PathOptions=>({fillColor:dark?'#374151':BLANK_COLOR,fillOpacity:0.72,color:dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.35)',weight:0.5,opacity:1}),[dark]);

  const dataReady=!!geojson;
  const btnBase='h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnMuted=`${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed`;
  const btn2023Class  = activePreset==='2023'  ?`${btnBase} border-[#00802B] bg-[#00802B] text-white`:btnMuted;
  const btn2027Class  = activePreset==='2027'  ?`${btnBase} border-[#4F46E5] bg-[#4F46E5] text-white`:btnMuted;
  const btnBlankClass = activePreset==='blank' ?`${btnBase} border-[#c8a020] bg-[#c8a020] text-white`:btnMuted;
  const btnBubbleClass= bubbleMapMode          ?`${btnBase} border-[#c8a020] bg-[#c8a020] text-white`:btnMuted;
  const selResults    = selectedStateId?currentResults[selectedStateId]:undefined;
  const selValidVotes = selectedStateId?byIdMap.get(selectedStateId)?.validVotes:undefined;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="ng">
      <header className={`h-[52px] ${dark?'bg-[rgba(7,13,28,0.94)]':'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={()=>navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4"><GlobeLogo/></button>
        <div ref={headerScrollRef} className="flex-1 min-w-0 header-scroll-strip flex items-center gap-2 px-2">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          {/* Nigerian flag — three vertical bands: green | white | green */}
          <svg width="18" height="12" viewBox="0 0 18 12" className="shrink-0 rounded-[2px] opacity-90" style={{ border:'1px solid rgba(0,0,0,0.12)' }}>
            <rect x="0"  y="0" width="6"  height="12" fill="#008751"/>
            <rect x="6"  y="0" width="6"  height="12" fill="#ffffff"/>
            <rect x="12" y="0" width="6"  height="12" fill="#008751"/>
          </svg>
          <span className="text-[11px] font-bold text-ink shrink-0">Nigeria</span>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={load2023} disabled={!dataReady} className={btn2023Class}>2023 Baseline</button>
          <button onClick={load2027} disabled={!dataReady} className={btn2027Class}>2027 Polling</button>
          <button onClick={loadBlank} className={btnBlankClass}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={toggleSim} className={`${btnBase} flex items-center gap-1.5 ${simOpen?'border-[#c8a020] bg-[#c8a020] text-white':btnMuted}`}>
            <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor"><path d="M1 1.2L6 4L1 6.8V1.2Z"/></svg>
            Simulation
          </button>
          {activePreset!=='blank'&&activePreset!==null&&(
            <button onClick={toggleSwing} className={swingOpen?`${btnBase} border-[#c8a020] bg-[#c8a020] text-white`:btnMuted}>Swing</button>
          )}
          <button onClick={toggleMandate}   className={mandateOpen?`${btnBase} border-[#c8a020] bg-[#c8a020] text-white`:btnMuted}>Mandate</button>
          <button onClick={toggleBreakdown} className={breakdownOpen?`${btnBase} border-[#c8a020] bg-[#c8a020] text-white`:btnMuted}>Breakdown</button>
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
                <div className="px-3.5 py-2.5"><a href="https://x.com/realleochang" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:opacity-70"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-ink-3"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.66zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg><span className="text-[11px] font-mono font-semibold text-ink">@realleochang</span></a></div>
              </div></>)}
          </div>
          <button onClick={()=>setDark(d=>!d)} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:bg-hover hover:text-ink transition-colors">
            {dark?<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2.7" stroke="currentColor" strokeWidth="1.4" fill="none"/><line x1="7" y1="0.5" x2="7" y2="2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="7" y1="11.8" x2="7" y2="13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="0.5" y1="7" x2="2.2" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="11.8" y1="7" x2="13.5" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="2.5" y1="2.5" x2="3.6" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="10.4" y1="10.4" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="11.5" y1="2.5" x2="10.4" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="3.6" y1="10.4" x2="2.5" y2="11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              :<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M11 7.8A5.5 5.5 0 0 1 5.2 2a5.5 5.5 0 1 0 5.8 5.8z" stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinejoin="round"/></svg>}
          </button>
        </div>
      </header>

      <div className="flex flex-col flex-1 min-h-0 relative">
        <div className="relative shrink-0">
          <div style={{display:'grid',gridTemplateRows:scoreboardVisible?'1fr':'0fr',transition:'grid-template-rows 280ms cubic-bezier(0.4,0,0.2,1)'}}>
            <div className="overflow-hidden">
              <NgScoreboard nationalVotes={nationalVotes} nationalPcts={nationalPcts} stateCounts={stateCounts} winStatus={winStatus} above25={above25} activePreset={activePreset}/>
            </div>
          </div>
          <button onClick={()=>setScoreboardVisible(v=>!v)}
            className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 z-[1001] h-4 px-3 rounded-full bg-white border border-default shadow-sm hover:bg-hover text-ink-3 hover:text-ink transition-colors flex items-center gap-1">
            <svg width="8" height="5" viewBox="0 0 8 5" fill="none">{scoreboardVisible?<path d="M7 4L4 1L1 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>:<path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>}</svg>
            <span className="text-[7.5px] font-mono uppercase tracking-wider leading-none">{scoreboardVisible?'Hide':'Results'}</span>
          </button>
        </div>

        <div className="flex flex-1 min-h-0 relative">
          {(mandateOpen||mandateExiting)&&<NgMandatePanel stateData={stateData} currentResults={currentResults} winStatus={winStatus} above25={above25} nationalVotes={nationalVotes} nationalPcts={nationalPcts} activePreset={activePreset} exiting={mandateExiting} onClose={toggleMandate}/>}
          <div className="flex-1 min-w-0 relative">
            {geojson?(
              <div ref={containerRef} className="relative w-full h-full">
                <MapContainer style={{width:'100%',height:'100%'}} center={[9.0820,8.6753]} zoom={6} zoomControl={true} attributionControl={false}>
                  <TileLayer key={dark?'dark':'light'} url={dark?'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png':'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'} attribution='&copy; OpenStreetMap &copy; CARTO' subdomains="abcd" maxZoom={20} updateWhenZooming={false} updateWhenIdle={true}/>
                  <NgMapController layerRef={layerRef}/>
                  <GeoJSON key="nigeria" data={geojson} style={geoStyle} onEachFeature={handleEachFeature} ref={layerRef as any} {...({smoothFactor:0} as any)}/>
                  {bubbleMapMode&&bubbleData.map(b=>(
                    <CircleMarker key={`${b.id}-${simRunning}`} center={b.center} radius={b.radius}
                      pathOptions={{fillColor:b.color,fillOpacity:0.85,color:'rgba(255,255,255,0.7)',weight:0.6,opacity:0.9}}
                      eventHandlers={{
                        click:()=>{ const geo=geoPropsMapRef.current.get(b.id);if(geo)setSelectedState({id:b.id,...geo}); },
                        mousemove:(e)=>{
                          const data=byIdMapRef.current.get(b.id);const geo=geoPropsMapRef.current.get(b.id);const rect=containerRef.current?.getBoundingClientRect();
                          if(!data||!geo||!rect)return;
                          const preset=activePresetRef.current;
                          const rawR=(preset==='2023'||preset==='2027'||preset==='sim'||preset==='blank')?(currentResultsRef.current[b.id]??{}):{};
                          const totalR=Object.values(rawR).reduce((s,v)=>s+v,0);
                          const parties=Object.entries(rawR).filter(([,v])=>v>0).sort(([,a],[,bv])=>bv-a).map(([pid,votes])=>({id:pid,votes,pct:totalR>0?Math.round((votes/totalR)*1000)/10:0}));
                          const above25:Record<string,boolean>={};for(const{id:pid,pct}of parties)above25[pid]=pct>=25;
                          const rPct=(preset==='sim'||simRunningRef.current)?(data.validVotes>0?(totalR/data.validVotes)*100:undefined):(preset==='blank'&&currentResultsRef.current[b.id]?(stateReportingRef.current[b.id]??100):undefined);
                          const lme=e as L.LeafletMouseEvent;
                          setTooltip({x:lme.originalEvent.clientX-rect.left,y:lme.originalEvent.clientY-rect.top,name_en:geo.name_en,zone:geo.zone,electorate:data.electorate,validVotes:data.validVotes,parties,above25,reportingPct:rPct});
                        },
                        mouseout:()=>setTooltip(null),
                      }}/>
                  ))}
                  <MapFitter geojson={geojson}/>
                </MapContainer>
                {tooltip&&containerRef.current&&<NgMapTooltip tooltip={tooltip} containerW={containerRef.current.clientWidth} containerH={containerRef.current.clientHeight} dark={dark}/>}
                {(activePreset==='blank'||activePreset==='sim'||simRunning)&&(
                  <div className="absolute bottom-8 left-3 z-[1000] pointer-events-none select-none">
                    <div className="rounded-[8px] px-3 py-2 border backdrop-blur-md" style={{ background: dark?'rgba(18,24,44,0.92)':'rgba(255,255,255,0.95)', borderColor: dark?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.08)', boxShadow:'0 4px 18px rgba(0,0,0,0.28)', minWidth:162 }}>
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <span className="text-[8.5px] font-mono font-bold uppercase tracking-[0.14em]" style={{ color: dark?'rgba(255,255,255,0.5)':'rgba(0,0,0,0.5)' }}>{simRunning?'Counting…':'National Reporting'}</span>
                        <span className="text-[13px] font-mono font-black tabular-nums" style={{ color: nationalReporting.pct>=99.5?'#16a34a':'#c8a020' }}>{nationalReporting.pct>=99.5?'100':nationalReporting.pct.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: dark?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.08)' }}>
                        <div className="h-full rounded-full transition-all duration-300" style={{ width:`${Math.min(100,nationalReporting.pct)}%`, background: nationalReporting.pct>=99.5?'#16a34a':'#c8a020' }}/>
                      </div>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[8px] font-mono tabular-nums" style={{ color: dark?'rgba(255,255,255,0.42)':'rgba(0,0,0,0.45)' }}>{nationalReporting.counted.toLocaleString()} votes</span>
                        <span className="text-[8px] font-mono tabular-nums" style={{ color: dark?'rgba(255,255,255,0.42)':'rgba(0,0,0,0.45)' }}>{nationalReporting.states}/{NG_TOTAL_UNITS} states</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ):(
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-[11px] font-mono text-ink-3 uppercase tracking-wider animate-pulse">Loading Nigeria map…</span>
              </div>
            )}
          </div>

          {selectedState&&(refOpen||refExiting)&&<NgRefPanel stateData={stateData} selectedId={selectedState.id} exiting={refExiting} onClose={closeRef}/>}
          {selectedState&&(
            <NgStatePanel {...selectedState} results={selResults} results2024={byIdMap.get(selectedState.id)?.results2024} validVotes={selValidVotes} activePreset={activePreset} onClose={()=>{setSelectedState(null);if(refOpen)closeRef();}} onResultsChange={handleStateResultsChange} onReportingCommit={handleReportingCommit} storedReporting={selectedStateId?stateReporting[selectedStateId]:undefined} refOpen={refOpen} onToggleRef={toggleRef}/>
          )}
          {(swingOpen||swingExiting)&&<NgSwingPanel exiting={swingExiting} stateData={stateData} currentResults={currentResults} onResultsChange={handleStateResultsChange} activePreset={activePreset} onReset={activePreset==='2027'?load2027:load2023} onClose={toggleSwing}/>}
          {(breakdownOpen||breakdownExiting)&&<NgBreakdownDrawer stateData={stateData} currentResults={currentResults} activePreset={activePreset} exiting={breakdownExiting} onClose={toggleBreakdown}/>}
          {(simOpen||simExiting)&&<NgSimulationPanel exiting={simExiting} stateData={stateData} onApplyResults={handleSimApply} onUpdateState={handleStateResultsChange} onClose={toggleSim} simRunning={simRunning} simProgress={simProgress} timersRef={simTimersRef} setSimRunning={setSimRunning} setSimProgress={setSimProgress} stopSim={stopSim}/>}
          {(tutorialOpen||tutorialExiting)&&<NgTutorialPanel onClose={()=>{ setTutorialExiting(true);setTimeout(()=>{ setTutorialExiting(false);setTutorialOpen(false); },280); }} exiting={tutorialExiting}/>}
        </div>

        <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-30 flex items-center justify-between px-3 py-1 bg-ink/60">
          <span className="text-[10px] text-white/70 font-mono tracking-wide uppercase">Global Election Simulator — Nigeria Presidential Edition</span>
          <span className="text-[10px] text-white/40 font-mono">{typeof window!=='undefined'?window.location.hostname:''}</span>
        </div>
      </div>
    </div>
  );
}
