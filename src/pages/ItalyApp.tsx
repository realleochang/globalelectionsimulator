import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── Party types ───────────────────────────────────────────────────────────────
type ItPartyId =
  | 'FDI' | 'PD' | 'M5S' | 'LEGA' | 'FI' | 'AZ' | 'IV'
  | 'AVS' | 'PIU' | 'NM' | 'IC' | 'SVP' | 'FN';

type ItParty = {
  id:             ItPartyId;
  name:           string;
  fullName:       string;
  color:          string;
  seats2022:      number;
  leader:         string;
  wikiTitle?:     string;
  leader2026?:    string;
  wikiTitle2026?: string;
  name2026?:      string;
  fullName2026?:  string;
  regional?:      boolean;
};

// Ideological order left → right for the parliament hemicycle
const IT_LR_ORDER: ItPartyId[] = ['AVS','M5S','PD','IC','PIU','IV','AZ','SVP','FI','NM','LEGA','FDI','FN'];
// Party keys present in the geojson `pr` objects (PR list shares)
const IT_PR_KEYS: ItPartyId[] = ['FDI','PD','M5S','LEGA','FI','AZ','IV','AVS','PIU','NM','IC'];

const IT_PARTIES: ItParty[] = [
  { id: 'FDI',  name: 'FdI',     fullName: "Fratelli d'Italia",        color: '#214A7B', seats2022: 119, leader: 'Giorgia Meloni',     wikiTitle: 'Giorgia_Meloni' },
  { id: 'PD',   name: 'PD',      fullName: 'Partito Democratico',      color: '#E63946', seats2022:  69, leader: 'Enrico Letta',        wikiTitle: 'Enrico_Letta', leader2026: 'Elly Schlein', wikiTitle2026: 'Elly_Schlein' },
  { id: 'M5S',  name: 'M5S',     fullName: 'Movimento 5 Stelle',       color: '#F2C200', seats2022:  52, leader: 'Giuseppe Conte',     wikiTitle: 'Giuseppe_Conte' },
  { id: 'LEGA', name: 'Lega',    fullName: 'Lega',                     color: '#1B9E4B', seats2022:  66, leader: 'Matteo Salvini',     wikiTitle: 'Matteo_Salvini' },
  { id: 'FI',   name: 'FI',      fullName: 'Forza Italia',             color: '#0F73B9', seats2022:  45, leader: 'Silvio Berlusconi',   wikiTitle: 'Silvio_Berlusconi', leader2026: 'Antonio Tajani', wikiTitle2026: 'Antonio_Tajani' },
  { id: 'AZ',   name: 'Azione',  fullName: 'Azione',                  color: '#00A3C7', seats2022:  13, leader: 'Carlo Calenda',      wikiTitle: 'Carlo_Calenda' },
  { id: 'IV',   name: 'IV',      fullName: 'Italia Viva',             color: '#E5147D', seats2022:   8, leader: 'Matteo Renzi',        wikiTitle: 'Matteo_Renzi' },
  { id: 'FN',   name: 'FN',      fullName: 'Futuro Nazionale',        color: '#C0703C', seats2022:   0, leader: 'Roberto Vannacci',    wikiTitle: 'Roberto_Vannacci' },
  { id: 'AVS',  name: 'AVS',     fullName: 'Alleanza Verdi e Sinistra',color: '#2E8B57', seats2022:  12, leader: 'Angelo Bonelli',     wikiTitle: 'Angelo_Bonelli' },
  { id: 'PIU',  name: '+Europa', fullName: '+Europa',                  color: '#C4006B', seats2022:   2, leader: 'Emma Bonino',         wikiTitle: 'Emma_Bonino', leader2026: 'Riccardo Magi', wikiTitle2026: 'Riccardo_Magi', regional: false },
  { id: 'NM',   name: 'NM',      fullName: 'Noi Moderati',             color: '#5B6E8C', seats2022:   7, leader: 'Maurizio Lupi',      wikiTitle: 'Maurizio_Lupi' },
  { id: 'IC',   name: 'IC',      fullName: 'Impegno Civico',           color: '#1A8FB5', seats2022:   1, leader: 'Luigi Di Maio',      wikiTitle: 'Luigi_Di_Maio' },
  { id: 'SVP',  name: 'SVP',     fullName: 'Südtiroler Volkspartei',   color: '#B30000', seats2022:   3, leader: 'Philipp Achammer',   wikiTitle: 'Philipp_Achammer', regional: true },
];

const IT_PARTY_MAP = Object.fromEntries(IT_PARTIES.map(p => [p.id, p])) as Record<ItPartyId, ItParty>;
// Exact official 2022 Chamber seats per party (sum = 397; the remaining 3 went to
// micro-regional/overseas lists — Aosta Valley, South Calls North — not modelled here).
const IT_SEATS_2022 = Object.fromEntries(IT_PARTIES.map(p => [p.id, p.seats2022])) as Partial<Record<ItPartyId, number>>;
const IT_TOTAL_SEATS = 400;
const IT_MAJORITY    = 201;

// ── Map views: the same election on three geographies ─────────────────────────
type ItMapViewId = 'uni' | 'pluri' | 'reg';
const IT_MAP_VIEWS: { id: ItMapViewId; label: string; file: string }[] = [
  { id: 'uni',   label: 'Single-member', file: 'italy-uninominali.geojson' },
  { id: 'pluri', label: 'PR districts',  file: 'italy-plurinominali.geojson' },
  { id: 'reg',   label: 'Regions',       file: 'italy-regioni.geojson' },
];
// Coalition colours for the FPTP (single-member) view
const IT_COAL_COLOR: Record<string, string> = {
  CDX:'#214A7B', CSX:'#E63946', M5S:'#F2C200', AZIV:'#00A3C7', OTH:'#7E57C2', SVP:'#B30000', AUT:'#8E44AD', SCN:'#FF6F00', NONE:'#9AA0A6',
};
const IT_COAL_SLIDERS = ['CDX','CSX','M5S','AZIV','OTH'] as const;
const IT_COAL_LABEL: Record<string, string> = { CDX:'Centre-right', CSX:'Centre-left', M5S:'M5S', AZIV:'Az–IV / Third Pole', OTH:'Others / regional' };

// 2022 national list (proportional) results — EXACT official figures.
// Source: Wikipedia "Results of the 2022 Italian general election" (Camera,
// quota proporzionale). Total valid Chamber votes: 28,098,196.
const IT_VOTE_RAW_2022: Record<ItPartyId, number> = {
  FDI: 7_302_517, PD: 5_356_180, M5S: 4_333_972, LEGA: 2_464_005, FI: 2_278_217, AZ: 1_235_468, IV: 951_201, FN: 0,
  AVS: 1_018_669, PIU: 793_961, NM: 255_505, IC: 169_165, SVP: 117_010,
};
// Az–IV ran as a single joint list (2,186,669 votes, 7.79%); the AZ/IV split is a
// proportional estimate. All other figures are the exact official Chamber results.
const IT_GRAND_TOTAL_VOTES = 28_087_782;
const IT_VOTE_PCT_2022: Record<ItPartyId, number> = {
  FDI: 26.00, PD: 19.07, M5S: 15.43, LEGA: 8.77, FI: 8.11, AZ: 4.40, IV: 3.39, FN: 0,
  AVS: 3.63, PIU: 2.83, NM: 0.91, IC: 0.60, SVP: 0.42,
};

// 2026 polling — illustrative May 2026 estimate
const IT_VOTE_PCT_2026: Record<ItPartyId, number> = {
  FDI: 28.4, PD: 22.2, M5S: 12.3, LEGA: 7.0, FI: 8.2, AZ: 3.0, IV: 2.5,
  AVS: 6.5, PIU: 1.4, NM: 1.3, FN: 4.0, IC: 0.5, SVP: 0.4,
};

// ── Province types ────────────────────────────────────────────────────────────
type ItProvId =
  'C10101' | 'C10102' | 'C10201' | 'C10202' | 'C30101' | 'C30102' | 'C30201' | 'C30202' | 'C30301' | 'C30302' | 'C30401' | 'C40001' | 'C50101' | 'C50201' | 'C50202' | 'C50203' | 'C60001' | 'C70001' | 'C80001' | 'C80002' | 'C80003' | 'C90001' | 'C90002' | 'C90003' | 'C100001' | 'C110001' | 'C120101' | 'C120102' | 'C120103' | 'C120201' | 'C120202' | 'C130001' | 'C140001' | 'C150101' | 'C150102' | 'C150201' | 'C150202' | 'C160001' | 'C160002' | 'C160003' | 'C160004' | 'C170001' | 'C180001' | 'C190101' | 'C190102' | 'C190201' | 'C190202' | 'C190203' | 'C200001';

type ItProvince = {
  id:      ItProvId;
  name:    string;
  seats:   number;   // PR seats allocated in this plurinominal district (D'Hondt)
  weight:  number;   // % of national valid vote (for the reporting widget)
  v2022:   Partial<Record<ItPartyId, number>>;  // 2022 list % (estimates where noted)
};

// GeoJSON feature property → district ID (identity: the geojson carries the id)
const IT_GEOID_TO_ID: Record<string, ItProvId> = {
  'C10101':'C10101',
  'C10102':'C10102',
  'C10201':'C10201',
  'C10202':'C10202',
  'C30101':'C30101',
  'C30102':'C30102',
  'C30201':'C30201',
  'C30202':'C30202',
  'C30301':'C30301',
  'C30302':'C30302',
  'C30401':'C30401',
  'C40001':'C40001',
  'C50101':'C50101',
  'C50201':'C50201',
  'C50202':'C50202',
  'C50203':'C50203',
  'C60001':'C60001',
  'C70001':'C70001',
  'C80001':'C80001',
  'C80002':'C80002',
  'C80003':'C80003',
  'C90001':'C90001',
  'C90002':'C90002',
  'C90003':'C90003',
  'C100001':'C100001',
  'C110001':'C110001',
  'C120101':'C120101',
  'C120102':'C120102',
  'C120103':'C120103',
  'C120201':'C120201',
  'C120202':'C120202',
  'C130001':'C130001',
  'C140001':'C140001',
  'C150101':'C150101',
  'C150102':'C150102',
  'C150201':'C150201',
  'C150202':'C150202',
  'C160001':'C160001',
  'C160002':'C160002',
  'C160003':'C160003',
  'C160004':'C160004',
  'C170001':'C170001',
  'C180001':'C180001',
  'C190101':'C190101',
  'C190102':'C190102',
  'C190201':'C190201',
  'C190202':'C190202',
  'C190203':'C190203',
  'C200001':'C200001',
};

// ── 49 plurinominal districts — magnitude (∝ population, sums to 400) + 2022 list % ─
// PR seats are filled by D'Hondt within each plurinominal district (real Italian
// method). Vote %s are the 2022 circoscrizione list results; South Tyrol's SVP
// share is an estimate. The engine normalises within the modelled set.
const IT_PROVINCES: ItProvince[] = [
  { id:'C10101', name:"Piemonte 1 - P01", seats:8, weight:2.09,
    v2022:{FDI:23.8,PD:22,M5S:12.5,LEGA:8.5,FI:6.8,AZ:5.1,IV:4,AVS:5,PIU:4.6,NM:0.7,IC:0.5} },
  { id:'C10102', name:"Piemonte 1 - P02", seats:7, weight:1.7,
    v2022:{FDI:23.8,PD:22,M5S:12.5,LEGA:8.5,FI:6.8,AZ:5.1,IV:4,AVS:5,PIU:4.6,NM:0.7,IC:0.5} },
  { id:'C10201', name:"Piemonte 2 - P01", seats:6, weight:1.49,
    v2022:{FDI:30.4,PD:17.6,M5S:8.1,LEGA:13,FI:9,AZ:4.9,IV:3.8,AVS:3.1,PIU:3.6,NM:0.7,IC:0.5} },
  { id:'C10202', name:"Piemonte 2 - P02", seats:8, weight:2.08,
    v2022:{FDI:30.4,PD:17.6,M5S:8.1,LEGA:13,FI:9,AZ:4.9,IV:3.8,AVS:3.1,PIU:3.6,NM:0.7,IC:0.5} },
  { id:'C30101', name:"Lombardia 1 - P01", seats:13, weight:3.36,
    v2022:{FDI:24.9,PD:21.7,M5S:8.9,LEGA:10,FI:7.3,AZ:6.7,IV:5.1,AVS:4.7,PIU:4.3,NM:1.1,IC:0.5} },
  { id:'C30102', name:"Lombardia 1 - P02", seats:12, weight:3.05,
    v2022:{FDI:24.9,PD:21.7,M5S:8.9,LEGA:10,FI:7.3,AZ:6.7,IV:5.1,AVS:4.7,PIU:4.3,NM:1.1,IC:0.5} },
  { id:'C30201', name:"Lombardia 2 - P01", seats:6, weight:1.47,
    v2022:{FDI:30.2,PD:15.9,M5S:6.6,LEGA:15.7,FI:8.3,AZ:5.6,IV:4.3,AVS:3.4,PIU:3.5,NM:1.1,IC:0.4} },
  { id:'C30202', name:"Lombardia 2 - P02", seats:8, weight:2.05,
    v2022:{FDI:30.2,PD:15.9,M5S:6.6,LEGA:15.7,FI:8.3,AZ:5.6,IV:4.3,AVS:3.4,PIU:3.5,NM:1.1,IC:0.4} },
  { id:'C30301', name:"Lombardia 3 - P01", seats:7, weight:1.64,
    v2022:{FDI:31.4,PD:16.6,M5S:5.8,LEGA:16.2,FI:8,AZ:5.5,IV:4.2,AVS:3.4,PIU:3.1,NM:0.7,IC:0.3} },
  { id:'C30302', name:"Lombardia 3 - P02", seats:8, weight:2.03,
    v2022:{FDI:31.4,PD:16.6,M5S:5.8,LEGA:16.2,FI:8,AZ:5.5,IV:4.2,AVS:3.4,PIU:3.1,NM:0.7,IC:0.3} },
  { id:'C30401', name:"Lombardia 4 - P01", seats:11, weight:2.76,
    v2022:{FDI:30.7,PD:19.2,M5S:7.6,LEGA:13.8,FI:8.5,AZ:4.6,IV:3.5,AVS:2.9,PIU:2.7,NM:0.8,IC:0.4} },
  { id:'C40001', name:"Trentino-Alto Adige/Südtirol - P01", seats:7, weight:1.74,
    v2022:{FDI:13.2,PD:12,M5S:3.5,LEGA:6,FI:2.4,AZ:2.4,IV:1.9,AVS:4.1,PIU:2,NM:0.3,IC:0.3,SVP:30} },
  { id:'C50101', name:"Veneto 1 - P01", seats:13, weight:3.26,
    v2022:{FDI:32,PD:16.8,M5S:6,LEGA:14.4,FI:6.3,AZ:4.6,IV:3.5,AVS:3.5,PIU:3.2,NM:2.5,IC:0.3} },
  { id:'C50201', name:"Veneto 2 - P01", seats:8, weight:1.96,
    v2022:{FDI:33.1,PD:16,M5S:5.7,LEGA:14.6,FI:7.4,AZ:4.9,IV:3.7,AVS:3.2,PIU:3,NM:1.8,IC:0.3} },
  { id:'C50202', name:"Veneto 2 - P02", seats:6, weight:1.45,
    v2022:{FDI:33.1,PD:16,M5S:5.7,LEGA:14.6,FI:7.4,AZ:4.9,IV:3.7,AVS:3.2,PIU:3,NM:1.8,IC:0.3} },
  { id:'C50203', name:"Veneto 2 - P03", seats:6, weight:1.52,
    v2022:{FDI:33.1,PD:16,M5S:5.7,LEGA:14.6,FI:7.4,AZ:4.9,IV:3.7,AVS:3.2,PIU:3,NM:1.8,IC:0.3} },
  { id:'C60001', name:"Friuli-Venezia Giulia - P01", seats:8, weight:2.06,
    v2022:{FDI:31.4,PD:18.4,M5S:7.2,LEGA:10.9,FI:6.7,AZ:4.9,IV:3.8,AVS:3.7,PIU:3.3,NM:0.8,IC:0.4} },
  { id:'C70001', name:"Liguria - P01", seats:11, weight:2.65,
    v2022:{FDI:24.1,PD:22.7,M5S:12.7,LEGA:9.3,FI:6.6,AZ:4.2,IV:3.2,AVS:4.3,PIU:3.4,NM:2.1,IC:0.5} },
  { id:'C80001', name:"Emilia-Romagna - P01", seats:8, weight:2.01,
    v2022:{FDI:25,PD:28.1,M5S:9.9,LEGA:7.5,FI:5.8,AZ:4.9,IV:3.7,AVS:4.3,PIU:3.1,NM:0.6,IC:0.3} },
  { id:'C80002', name:"Emilia-Romagna - P02", seats:12, weight:2.86,
    v2022:{FDI:25,PD:28.1,M5S:9.9,LEGA:7.5,FI:5.8,AZ:4.9,IV:3.7,AVS:4.3,PIU:3.1,NM:0.6,IC:0.3} },
  { id:'C80003', name:"Emilia-Romagna - P03", seats:10, weight:2.45,
    v2022:{FDI:25,PD:28.1,M5S:9.9,LEGA:7.5,FI:5.8,AZ:4.9,IV:3.7,AVS:4.3,PIU:3.1,NM:0.6,IC:0.3} },
  { id:'C90001', name:"Toscana - P01", seats:8, weight:2,
    v2022:{FDI:25.9,PD:26.1,M5S:11.1,LEGA:6.6,FI:5.6,AZ:5.3,IV:4.1,AVS:5.1,PIU:2.9,NM:0.5,IC:0.5} },
  { id:'C90002', name:"Toscana - P02", seats:8, weight:2.03,
    v2022:{FDI:25.9,PD:26.1,M5S:11.1,LEGA:6.6,FI:5.6,AZ:5.3,IV:4.1,AVS:5.1,PIU:2.9,NM:0.5,IC:0.5} },
  { id:'C90003', name:"Toscana - P03", seats:9, weight:2.16,
    v2022:{FDI:25.9,PD:26.1,M5S:11.1,LEGA:6.6,FI:5.6,AZ:5.3,IV:4.1,AVS:5.1,PIU:2.9,NM:0.5,IC:0.5} },
  { id:'C100001', name:"Umbria - P01", seats:6, weight:1.49,
    v2022:{FDI:30.8,PD:20.9,M5S:12.7,LEGA:7.8,FI:6.8,AZ:4.6,IV:3.6,AVS:3.6,PIU:2.1,NM:0.4,IC:0.4} },
  { id:'C110001', name:"Marche - P01", seats:10, weight:2.59,
    v2022:{FDI:29.1,PD:20.4,M5S:13.6,LEGA:7.9,FI:6.8,AZ:4.2,IV:3.2,AVS:3.3,PIU:2.5,NM:0.8,IC:0.5} },
  { id:'C120101', name:"Lazio 1 - P01", seats:8, weight:2,
    v2022:{FDI:29.7,PD:21.5,M5S:14.8,LEGA:5.2,FI:5.1,AZ:5.3,IV:4.1,AVS:4.3,PIU:3.4,NM:0.6,IC:0.6} },
  { id:'C120102', name:"Lazio 1 - P02", seats:8, weight:2.09,
    v2022:{FDI:29.7,PD:21.5,M5S:14.8,LEGA:5.2,FI:5.1,AZ:5.3,IV:4.1,AVS:4.3,PIU:3.4,NM:0.6,IC:0.6} },
  { id:'C120103', name:"Lazio 1 - P03", seats:8, weight:2.02,
    v2022:{FDI:29.7,PD:21.5,M5S:14.8,LEGA:5.2,FI:5.1,AZ:5.3,IV:4.1,AVS:4.3,PIU:3.4,NM:0.6,IC:0.6} },
  { id:'C120201', name:"Lazio 2 - P01", seats:6, weight:1.42,
    v2022:{FDI:33.7,PD:14.9,M5S:15.5,LEGA:8.9,FI:10.2,AZ:3.5,IV:2.7,AVS:2.8,PIU:2,NM:0.5,IC:0.6} },
  { id:'C120202', name:"Lazio 2 - P02", seats:7, weight:1.75,
    v2022:{FDI:33.7,PD:14.9,M5S:15.5,LEGA:8.9,FI:10.2,AZ:3.5,IV:2.7,AVS:2.8,PIU:2,NM:0.5,IC:0.6} },
  { id:'C130001', name:"Abruzzo - P01", seats:9, weight:2.2,
    v2022:{FDI:27.7,PD:16.6,M5S:18.4,LEGA:8.3,FI:11.1,AZ:3.6,IV:2.7,AVS:2.7,PIU:2,NM:0.7,IC:0.7} },
  { id:'C140001', name:"Molise - P01", seats:2, weight:0.53,
    v2022:{FDI:21.5,PD:18.1,M5S:24.2,LEGA:8.3,FI:11.4,AZ:2.7,IV:2.1,AVS:2.9,PIU:1.6,NM:1.6,IC:0.7} },
  { id:'C150101', name:"Campania 1 - P01", seats:10, weight:2.4,
    v2022:{FDI:13.8,PD:14.4,M5S:41.4,LEGA:2.9,FI:9.5,AZ:3.1,IV:2.3,AVS:3,PIU:2.1,NM:0.6,IC:2.2} },
  { id:'C150102', name:"Campania 1 - P02", seats:11, weight:2.75,
    v2022:{FDI:13.8,PD:14.4,M5S:41.4,LEGA:2.9,FI:9.5,AZ:3.1,IV:2.3,AVS:3,PIU:2.1,NM:0.6,IC:2.2} },
  { id:'C150201', name:"Campania 2 - P01", seats:8, weight:2.01,
    v2022:{FDI:21.4,PD:17.1,M5S:27.6,LEGA:6,FI:10,AZ:2.9,IV:2.2,AVS:2.4,PIU:1.9,NM:0.4,IC:1.2} },
  { id:'C150202', name:"Campania 2 - P02", seats:10, weight:2.57,
    v2022:{FDI:21.4,PD:17.1,M5S:27.6,LEGA:6,FI:10,AZ:2.9,IV:2.2,AVS:2.4,PIU:1.9,NM:0.4,IC:1.2} },
  { id:'C160001', name:"Puglia - P01", seats:7, weight:1.72,
    v2022:{FDI:23.4,PD:16.7,M5S:27.9,LEGA:5.4,FI:11.5,AZ:2.7,IV:2.1,AVS:3.1,PIU:1.9,NM:0.7,IC:0.7} },
  { id:'C160002', name:"Puglia - P02", seats:6, weight:1.56,
    v2022:{FDI:23.4,PD:16.7,M5S:27.9,LEGA:5.4,FI:11.5,AZ:2.7,IV:2.1,AVS:3.1,PIU:1.9,NM:0.7,IC:0.7} },
  { id:'C160003', name:"Puglia - P03", seats:6, weight:1.53,
    v2022:{FDI:23.4,PD:16.7,M5S:27.9,LEGA:5.4,FI:11.5,AZ:2.7,IV:2.1,AVS:3.1,PIU:1.9,NM:0.7,IC:0.7} },
  { id:'C160004', name:"Puglia - P04", seats:8, weight:2.03,
    v2022:{FDI:23.4,PD:16.7,M5S:27.9,LEGA:5.4,FI:11.5,AZ:2.7,IV:2.1,AVS:3.1,PIU:1.9,NM:0.7,IC:0.7} },
  { id:'C170001', name:"Basilicata - P01", seats:4, weight:0.97,
    v2022:{FDI:18.2,PD:15.2,M5S:25,LEGA:9,FI:9.4,AZ:5.5,IV:4.3,AVS:3.4,PIU:2.1,NM:1.8,IC:0.9} },
  { id:'C180001', name:"Calabria - P01", seats:13, weight:3.3,
    v2022:{FDI:19,PD:14.4,M5S:29.4,LEGA:5.7,FI:15.6,AZ:2.4,IV:1.8,AVS:1.7,PIU:1.1,NM:1,IC:0.9} },
  { id:'C190101', name:"Sicilia 1 - P01", seats:8, weight:2.1,
    v2022:{FDI:17.9,PD:12.3,M5S:30.8,LEGA:4.7,FI:11.5,AZ:3.2,IV:2.5,AVS:2.1,PIU:1.8,NM:0.9,IC:0.8} },
  { id:'C190102', name:"Sicilia 1 - P02", seats:8, weight:1.89,
    v2022:{FDI:17.9,PD:12.3,M5S:30.8,LEGA:4.7,FI:11.5,AZ:3.2,IV:2.5,AVS:2.1,PIU:1.8,NM:0.9,IC:0.8} },
  { id:'C190201', name:"Sicilia 2 - P01", seats:6, weight:1.39,
    v2022:{FDI:20.2,PD:11.6,M5S:26,LEGA:5.3,FI:10.9,AZ:2.6,IV:2,AVS:2.1,PIU:1.6,NM:0.7,IC:0.8} },
  { id:'C190202', name:"Sicilia 2 - P02", seats:6, weight:1.58,
    v2022:{FDI:20.2,PD:11.6,M5S:26,LEGA:5.3,FI:10.9,AZ:2.6,IV:2,AVS:2.1,PIU:1.6,NM:0.7,IC:0.8} },
  { id:'C190203', name:"Sicilia 2 - P03", seats:6, weight:1.48,
    v2022:{FDI:20.2,PD:11.6,M5S:26,LEGA:5.3,FI:10.9,AZ:2.6,IV:2,AVS:2.1,PIU:1.6,NM:0.7,IC:0.8} },
  { id:'C200001', name:"Sardegna - P01", seats:11, weight:2.76,
    v2022:{FDI:23.6,PD:18.7,M5S:21.8,LEGA:6.3,FI:8.6,AZ:2.6,IV:2,AVS:5.1,PIU:2.3,NM:2.1,IC:0.9} },
];
const IT_PROVINCE_MAP   = Object.fromEntries(IT_PROVINCES.map(p => [p.id, p])) as Record<ItProvId, ItProvince>;
const IT_TOTAL_PROV_WEIGHT = IT_PROVINCES.reduce((s, p) => s + p.weight, 0);

// ── Regional parties are landlocked to their home provinces ───────────────────
// A nationalist/regionalist party can NEVER pick up votes outside the provinces
// listed here (enforced in calcProvVotes). National parties have no entry → they
// contest everywhere.
const IT_REGIONAL_HOME: Partial<Record<ItPartyId, ItProvId[]>> = {
  SVP: ['C40001'],   // Südtiroler Volkspartei — landlocked to South Tyrol
};
function itContests(partyId: ItPartyId, provId: ItProvId): boolean {
  const home = IT_REGIONAL_HOME[partyId];
  return !home || home.includes(provId);
}
// A regional party can never exceed its home region's share of the national vote
// (even winning 100% there). This caps its simulation input; national parties are
// uncapped (no entry → free typing).
const IT_REGIONAL_CAP: Partial<Record<ItPartyId, number>> = (() => {
  const out: Partial<Record<ItPartyId, number>> = {};
  for (const id of Object.keys(IT_REGIONAL_HOME) as ItPartyId[]) {
    const home = IT_REGIONAL_HOME[id]!;
    out[id] = Math.round(home.reduce((s, p) => s + (IT_PROVINCE_MAP[p]?.weight ?? 0), 0) / IT_TOTAL_PROV_WEIGHT * 1000) / 10;
  }
  return out;
})();

// Proportional swing: prov_pct = base_2023 × (new_nat / old_nat), normalised
function calcProvVotes(
  natPcts:  Record<ItPartyId, number>,
  provId:   ItProvId,
  override?: Partial<Record<ItPartyId, number>>,
): Record<ItPartyId, number> {
  if (override && Object.keys(override).length > 0) {
    const raw: Record<ItPartyId, number> = {} as Record<ItPartyId, number>;
    let total = 0;
    // Landlock: regional parties get 0 outside their home provinces even if an override sets them.
    for (const p of IT_PARTIES) { raw[p.id] = itContests(p.id, provId) ? Math.max(0, override[p.id] ?? 0) : 0; total += raw[p.id]; }
    if (total === 0) return raw;
    for (const p of IT_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
    return raw;
  }
  const base = IT_PROVINCE_MAP[provId]?.v2022 ?? {};
  const raw: Record<ItPartyId, number> = {} as Record<ItPartyId, number>;
  let total = 0;
  for (const p of IT_PARTIES) {
    const newNat = natPcts[p.id] ?? 0;
    const oldNat = IT_VOTE_PCT_2022[p.id] ?? 0;
    const basePct = base[p.id] ?? 0;
    // Regional parties stay landlocked + proportional within their territory; national
    // parties swing nationally. A brand-new party (no 2022 base or national share, e.g.
    // FN) is assumed uniform at its national % so it earns district representation.
    raw[p.id] = !itContests(p.id, provId) ? 0
      : basePct === 0 ? (oldNat === 0 ? newNat : 0)
      : oldNat === 0 ? basePct : basePct * (newNat / oldNat);
    total += raw[p.id];
  }
  if (total === 0) return raw;
  for (const p of IT_PARTIES) raw[p.id] = (raw[p.id] / total) * 100;
  return raw;
}

// ── Hare-quota largest-remainder helper ──────────────────────────────────────
function hareLR(weights: Record<string, number>, total: number): Record<string, number> {
  const ks = Object.keys(weights); const out: Record<string, number> = {};
  ks.forEach(k => out[k] = 0);
  const sum = ks.reduce((a, k) => a + Math.max(0, weights[k] || 0), 0);
  if (sum <= 0 || total <= 0) return out;
  const ex = ks.map(k => ({ k, e: Math.max(0, weights[k] || 0) / sum * total }));
  let used = 0; ex.forEach(x => { out[x.k] = Math.floor(x.e); used += out[x.k]; });
  ex.sort((a, b) => (b.e - Math.floor(b.e)) - (a.e - Math.floor(a.e)));
  let i = 0; while (used < total && ex.length) { out[ex[i % ex.length].k]++; used++; i++; }
  return out;
}

// ── Rosatellum seat allocation — Camera dei Deputati (400) ────────────────────
// 147 FPTP single-member seats + 245 proportional (Hare quota, 3% party / 10%
// coalition threshold, SVP minority-exempt) + 8 overseas. FPTP is modelled from
// coalition strength (vote^k majoritarian bonus), split within a coalition by
// √share; PR + overseas via national Hare-quota largest remainder.
const IT_COAL_DEF: Record<string, ItPartyId[]> = {
  CDX: ['FDI','LEGA','FI','NM'], CSX: ['PD','AVS','PIU','IC'], M5S: ['M5S'], AZ: ['AZ'], IV: ['IV'], FN: ['FN'],
};
// 2026 alignment: M5S has joined the centre-left; FN stands alone (not in the CDX).
const IT_COAL_DEF_2026: Record<string, ItPartyId[]> = {
  CDX: ['FDI','LEGA','FI','NM'], CSX: ['PD','AVS','PIU','IC','M5S'], AZ: ['AZ'], IV: ['IV'], FN: ['FN'],
};
const coalDefFor = (is2026?: boolean) => (is2026 ? IT_COAL_DEF_2026 : IT_COAL_DEF);
// ── Per-district PR magnitudes ────────────────────────────────────────────────
// The 245 proportional seats are split across the 49 plurinominal districts in
// proportion to each district's share of the electorate (largest remainder), so
// the per-district allocations reconcile EXACTLY to the 245 national total.
const IT_PR_MAG: Record<ItProvId, number> = (() => {
  const w: Record<string, number> = {};
  for (const p of IT_PROVINCES) w[p.id] = p.weight;
  return hareLR(w, 245) as Record<ItProvId, number>;
})();

// Parties qualifying for PR nationally: ≥3% (party) and, if in a multi-party
// coalition, that coalition ≥10%. SVP is exempt (minority) and handled per-district.
function prQualSet(natPcts: Partial<Record<ItPartyId, number>>, is2026?: boolean): Set<ItPartyId> {
  const COAL = coalDefFor(is2026);
  const coalPct: Record<string, number> = {};
  for (const [c, ps] of Object.entries(COAL)) coalPct[c] = ps.reduce((a, id) => a + (natPcts[id] ?? 0), 0);
  const out = new Set<ItPartyId>();
  for (const pty of IT_PARTIES) {
    if (pty.id === 'SVP') continue;
    if ((natPcts[pty.id] ?? 0) < 3) continue;
    const coal = Object.entries(COAL).find(([, ps]) => ps.includes(pty.id));
    if (coal && coal[1].length > 1 && coalPct[coal[0]] < 10) continue;
    out.add(pty.id);
  }
  return out;
}

// TIER 1 — national PR totals (245 seats): proportional largest-remainder among the
// qualifying parties at the NATIONAL level, so a party over the 3% threshold keeps
// its fair national share (no small-district squeeze-out). SVP's South Tyrol
// minority seats are set aside first.
function prNationalTotals(natPcts: Partial<Record<ItPartyId, number>>, is2026?: boolean): Record<string, number> {
  const qual = prQualSet(natPcts, is2026);
  const w: Record<string, number> = {};
  for (const id of qual) w[id] = natPcts[id] ?? 0;
  const svpPR = (natPcts.SVP ?? 0) > 0 ? 2 : 0;          // South Tyrol minority PR seats
  const tot = hareLR(w, 245 - svpPR);
  if (svpPR) tot.SVP = svpPR;
  return tot;
}
// TIER 2 — spread each party's national PR total across the 49 districts (largest
// remainder on the party's district votes). National row totals stay EXACT, so the
// per-district figures reconcile to the national result while showing where each
// party actually wins its seats. SVP's seats land in its home district only.
function distributePRtoDistricts(
  natPcts: Record<ItPartyId, number>, prNat: Record<string, number>,
  provOverrides?: Partial<Record<ItProvId, Partial<Record<ItPartyId, number>>>>,
): Record<ItProvId, Record<string, number>> {
  const dv: Record<string, Record<ItPartyId, number>> = {};
  for (const prov of IT_PROVINCES) dv[prov.id] = calcProvVotes(natPcts, prov.id, provOverrides?.[prov.id]);
  const out = {} as Record<ItProvId, Record<string, number>>;
  for (const prov of IT_PROVINCES) out[prov.id] = {};
  for (const party of Object.keys(prNat)) {
    const T = prNat[party]; if (T <= 0) continue;
    const w: Record<string, number> = {};
    for (const prov of IT_PROVINCES) w[prov.id] = (dv[prov.id][party as ItPartyId] ?? 0) * prov.weight;
    const dist = hareLR(w, T);
    for (const pid in dist) if (dist[pid] > 0) out[pid as ItProvId][party] = dist[pid];
  }
  return out;
}
// National PR total used by the scoreboard engine (proportional, 245 seats).
function nationalPRSeats(natPcts: Partial<Record<ItPartyId, number>>, is2026?: boolean, _provOverrides?: unknown): Record<string, number> {
  return prNationalTotals(natPcts, is2026);
}

// ── Overseas constituency (Circoscrizione Estero) — 8 Chamber seats, 4 zones ──
// Europe 4 · South America 2 · North & Central America 1 · Africa-Asia-Oceania 1.
// Per-zone vote split is an estimate (overseas Italians lean centre-left + M5S,
// with a centre-right minority). Each zone has its own seat count and a bubble
// placed on its continent.
type ItOverseas = { id: string; name: string; short: string; seats: number; lat: number; lng: number; v: Partial<Record<ItPartyId, number>> };
const IT_OVERSEAS: ItOverseas[] = [
  { id:'EU',  name:'Europe',                              short:'Europe',     seats:4, lat:50,  lng:14,  v:{ PD:26, M5S:15, FDI:16, FI:9,  LEGA:8, AZ:6, IV:5, AVS:6, PIU:4 } },
  { id:'SA',  name:'South America',                       short:'S. America', seats:2, lat:-23, lng:-61, v:{ PD:28, M5S:16, FDI:15, FI:12, LEGA:6, AZ:5, IV:5, AVS:4, PIU:3 } },
  { id:'NCA', name:'North & Central America',             short:'N. America', seats:1, lat:40,  lng:-97, v:{ PD:27, FDI:18, M5S:13, FI:11, LEGA:7, AZ:7, IV:6, AVS:5, PIU:4 } },
  { id:'AAO', name:'Africa, Asia, Oceania & Antarctica',  short:'Afr-Asia',   seats:1, lat:6,   lng:36,  v:{ PD:25, M5S:17, FDI:16, FI:10, LEGA:7, AZ:7, IV:5, AVS:5, PIU:4 } },
];
// Seats won in one overseas zone (largest remainder, no threshold) + sorted vote.
function overseasZoneSeats(z: ItOverseas): { seats: Record<string, number>; sorted: { id: ItPartyId; pct: number }[] } {
  const w: Record<string, number> = {};
  for (const id of Object.keys(z.v) as ItPartyId[]) if ((z.v[id] ?? 0) > 0) w[id] = z.v[id]!;
  const sorted = (Object.entries(z.v) as [ItPartyId, number][]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([id, pct]) => ({ id, pct }));
  return { seats: hareLR(w, z.seats), sorted };
}
function overseasSeats(): Record<string, number> {
  const tot: Record<string, number> = {};
  for (const z of IT_OVERSEAS) { const { seats } = overseasZoneSeats(z); for (const id in seats) tot[id] = (tot[id] ?? 0) + seats[id]; }
  return tot;
}

// ── Rosatellum total — Camera dei Deputati (400) ──────────────────────────────
// 245 PR (sum of the 49 per-district allocations) + 147 FPTP (each collegio's
// coalition win assigned to its representative party) + 8 overseas (4 zones).
// fptpCounts is keyed PER PARTY (the winning representative of each collegio). When
// omitted, FPTP is modelled nationally from coalition strength (√-split fallback).
function calcRosatellum(
  natPcts: Partial<Record<ItPartyId, number>>,
  fptpCounts?: Record<string, number>,
  is2026?: boolean,
  provOverrides?: Partial<Record<ItProvId, Partial<Record<ItPartyId, number>>>>,
): Partial<Record<ItPartyId, number>> {
  const pr = nationalPRSeats(natPcts, is2026, provOverrides);
  const fptp: Record<string, number> = {};
  if (fptpCounts) {
    for (const id in fptpCounts) fptp[id] = (fptp[id] ?? 0) + (fptpCounts[id] ?? 0);
  } else {
    const COAL = coalDefFor(is2026);
    const coalPct: Record<string, number> = {};
    for (const [c, ps] of Object.entries(COAL)) coalPct[c] = ps.reduce((a, id) => a + (natPcts[id] ?? 0), 0);
    const coalW: Record<string, number> = {};
    for (const c in coalPct) coalW[c] = Math.pow(Math.max(coalPct[c], 0.01), 3.2);
    const coalFptp = hareLR(coalW, 147);
    for (const [c, ps] of Object.entries(COAL)) {
      const within: Record<string, number> = {}; ps.forEach(id => within[id] = Math.sqrt(Math.max(0.04, natPcts[id] ?? 0)));
      const a = hareLR(within, coalFptp[c] || 0);
      for (const [id, n] of Object.entries(a)) fptp[id] = (fptp[id] || 0) + n;
    }
  }
  const ov = overseasSeats();
  const out: Partial<Record<ItPartyId, number>> = {};
  for (const pty of IT_PARTIES) {
    const t = (pr[pty.id] || 0) + (fptp[pty.id] || 0) + (ov[pty.id] || 0);
    if (t > 0) out[pty.id] = t;
  }
  return out;
}

// National Rosatellum seats from the (province-aggregated) national vote
function calcAllProvinceSeats(
  natPcts: Partial<Record<ItPartyId, number>>,
  fptpCounts?: Record<string, number>,
  is2026?: boolean,
  provOverrides?: Partial<Record<ItProvId, Partial<Record<ItPartyId, number>>>>,
): Partial<Record<ItPartyId, number>> {
  return calcRosatellum(natPcts, fptpCounts, is2026, provOverrides);
}

// Coalition of a uninominale's shares (max), with optional national swing applied
const IT_UNI_COAL_DEF: Record<string, ItPartyId[]> = { CDX:['FDI','LEGA','FI','NM'], CSX:['PD','AVS','PIU','IC'], M5S:['M5S'], AZIV:['AZ','IV'] };
// Per-collegio swung coalition strengths. In 2026 M5S runs inside the centre-left,
// so its bucket is merged into CSX before a winner is picked.
function uniSwungVals(shares: Record<string, number>, natPcts: Record<ItPartyId, number>, is2026?: boolean): Record<string, number> {
  const val: Record<string, number> = {};
  for (const c of ['CDX','CSX','M5S','AZIV','OTH']) {
    const base = shares[c] ?? 0; if (base <= 0) { val[c] = -1; continue; }
    const members = IT_UNI_COAL_DEF[c];
    let factor = 1;
    if (members) { const now = members.reduce((s,id)=>s+(natPcts[id]??0),0); const then = members.reduce((s,id)=>s+(IT_VOTE_PCT_2022[id]??0),0); factor = then>0?now/then:1; }
    val[c] = base * factor;
  }
  if (is2026 && (val.M5S ?? -1) >= 0) { val.CSX = Math.max(0, val.CSX ?? 0) + val.M5S; val.M5S = -1; }
  return val;
}
function uniWinner(shares: Record<string, number>, natPcts: Record<ItPartyId, number>, is2026?: boolean): string {
  const val = uniSwungVals(shares, natPcts, is2026);
  let best = 'NONE', bestV = -1;
  for (const c of ['CDX','CSX','M5S','AZIV','OTH']) if ((val[c] ?? -1) > bestV) { bestV = val[c]; best = c; }
  return best;
}
// Single-member coalition vote buckets for a collegio (sorted, % shares). In 2026
// the M5S bucket is folded into the centre-left (CSX) — they run as one alliance.
function uniCoalShares(sh: Record<string, number>, is2026?: boolean): { c: string; v: number }[] {
  const m: Record<string, number> = {};
  for (const c of ['CDX','CSX','M5S','AZIV','OTH']) m[c] = sh[c] ?? 0;
  if (is2026) { m.CSX += m.M5S; m.M5S = 0; }
  const keys = is2026 ? ['CDX','CSX','AZIV','OTH'] : ['CDX','CSX','M5S','AZIV','OTH'];
  return keys.map(c => ({ c, v: m[c] })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
}
// Coalition shares SWUNG to the current national vote (then renormalised to 100%), so
// the displayed figures move 2022→2026 for EVERY coalition — not just the centre-left.
// Used for baked baseline tooltips/bubbles (an edited collegio shows its raw override).
function uniSwungShares(sh: Record<string, number>, natPcts: Record<ItPartyId, number>, is2026?: boolean): { c: string; v: number }[] {
  const val = uniSwungVals(sh, natPcts, is2026);
  const keys = is2026 ? ['CDX','CSX','AZIV','OTH'] : ['CDX','CSX','M5S','AZIV','OTH'];
  const present = keys.filter(c => (val[c] ?? -1) >= 0);
  const sum = present.reduce((s, c) => s + Math.max(0, val[c]), 0);
  if (sum <= 0) return [];
  return present.map(c => ({ c, v: Math.max(0, val[c]) / sum * 100 })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
}

// ── FPTP representative party ─────────────────────────────────────────────────
// A collegio is won by a coalition, but the seat goes to one party — the
// candidate's. We model that as the coalition's strongest member in that
// circoscrizione (2022 regional strength, swung to the current vote). So a
// centre-right win in Lombardy goes to Lega, one in the south to FdI, etc.
const itCirco = (den: string) => den.replace(/\s*-\s*[UP]\d+.*$/i, '').trim();
const itCircoKey = (s: string) => s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');
// Weighted reporting fraction of the PR districts under a circoscrizione (uni) or
// region prefix — lets FPTP collegi / regions fill in during the sim in step with
// the PR map (a collegio reports once its circoscrizione's PR districts report).
function simReportFrac(prefix: string, frac: Partial<Record<ItProvId, number>>): number {
  const pre = itCircoKey(prefix); if (!pre) return 0;
  let w = 0, rep = 0;
  for (const p of IT_PROVINCES) {
    if (!itCircoKey(itCirco(p.name)).startsWith(pre)) continue;
    w += p.weight; rep += p.weight * (frac[p.id] ?? 0);
  }
  return w > 0 ? rep / w : 0;
}
const IT_CIRCO_STRENGTH: Record<string, Partial<Record<ItPartyId, number>>> = (() => {
  const acc: Record<string, { w: number; v: Record<string, number> }> = {};
  for (const prov of IT_PROVINCES) {
    const k = itCirco(prov.name); (acc[k] ??= { w: 0, v: {} });
    acc[k].w += prov.weight;
    for (const [id, pct] of Object.entries(prov.v2022)) acc[k].v[id] = (acc[k].v[id] ?? 0) + (pct as number) * prov.weight;
  }
  const out: Record<string, Partial<Record<ItPartyId, number>>> = {};
  for (const [k, { w, v }] of Object.entries(acc)) { out[k] = {}; for (const id in v) (out[k] as Record<string, number>)[id] = v[id] / (w || 1); }
  return out;
})();
function coalMembers(coal: string, is2026?: boolean): ItPartyId[] {
  return coal === 'CDX'  ? ['FDI','LEGA','FI','NM']
    : coal === 'CSX'  ? (is2026 ? ['PD','M5S','AVS','PIU','IC'] : ['PD','AVS','PIU','IC'])
    : coal === 'M5S'  ? ['M5S']
    : coal === 'AZIV' ? ['AZ','IV']
    :                   ['SVP'];   // OTH / regional collegi → modelled minority party
}
// A party's regional over-performance in a circoscrizione (2022 local % ÷ its 2022
// national %): >1 where it punches above its weight — Lega in the north, FI/M5S in
// the south, PD in the red belt.
const IT_CIRCO_RATIO = (circoKey: string, id: ItPartyId): number =>
  (IT_CIRCO_STRENGTH[circoKey]?.[id] ?? 0) / Math.max(0.5, IT_VOTE_PCT_2022[id] ?? 0.5);
// The party that takes a collegio for its winning coalition — the regional champion
// among the coalition's major members (Lega in the north, FI in the south, FdI the
// rest). Shown on the FPTP panel; the seat totals use the same regional logic.
function collegioRep(circo: string, coal: string, natPcts: Record<ItPartyId, number>, is2026?: boolean): ItPartyId {
  const all = coalMembers(coal, is2026);
  let pool = all.filter(id => (natPcts[id] ?? 0) > 0.3 && ((IT_CIRCO_STRENGTH[circo]?.[id] ?? 0) >= 6 || (natPcts[id] ?? 0) >= 8));
  if (!pool.length) pool = all.filter(id => (natPcts[id] ?? 0) > 0.3);
  if (!pool.length) pool = all;
  return pool.reduce((b, id) => IT_CIRCO_RATIO(circo, id) > IT_CIRCO_RATIO(circo, b) ? id : b, pool[0]);
}

// Partial seats: Rosatellum on the reported-so-far national vote, scaled to the
// reported share of the electorate (seats grow 0 → 400 as districts report).
function calcPartialSeats(
  natPcts:        Record<ItPartyId, number>,
  provFractions:  Partial<Record<ItProvId, number>>,
  provOverrides?: Partial<Record<ItProvId, Partial<Record<ItPartyId, number>>>>,
  is2026?:        boolean,
): Partial<Record<ItPartyId, number>> {
  const entries = Object.entries(provFractions) as [ItProvId, number][];
  if (entries.length === 0) return {};
  const weighted: Partial<Record<ItPartyId, number>> = {}; let reportedW = 0;
  for (const [pId, frac] of entries) {
    if (!frac) continue; const prov = IT_PROVINCE_MAP[pId]; if (!prov) continue;
    const cv = calcProvVotes(natPcts, pId, provOverrides?.[pId]);
    const w = prov.weight * frac;
    for (const pty of IT_PARTIES) weighted[pty.id] = (weighted[pty.id] ?? 0) + (cv[pty.id] ?? 0) * w;
    reportedW += w;
  }
  if (reportedW <= 0) return {};
  const nat = {} as Record<ItPartyId, number>;
  for (const pty of IT_PARTIES) nat[pty.id] = (weighted[pty.id] ?? 0) / reportedW;
  const full = calcRosatellum(nat, undefined, is2026) as Record<string, number>;
  const frac = Math.min(1, reportedW / IT_TOTAL_PROV_WEIGHT);
  return hareLR(full, Math.round(400 * frac));
}

// ── Simulation helpers ────────────────────────────────────────────────────────
function itRandNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function itBellCurveTimes(n: number, totalMs: number): number[] {
  return Array.from({ length: n }, () =>
    Math.max(0.02, Math.min(0.98, 0.5 + itRandNormal() * 0.18))
  ).sort((a, b) => a - b).map(t => Math.round(t * totalMs));
}

// Redistribute % when one slider moves; unlocked others absorb the change
function redistributePcts(
  current:   Record<ItPartyId, number>,
  changedId: ItPartyId,
  newRaw:    number,
  locks:     Set<ItPartyId>,
  caps?:     Record<ItPartyId, number>,   // per-party ceiling (e.g. region size); absent ⇒ uncapped
): Record<ItPartyId, number> {
  const capOf     = (id: ItPartyId) => caps?.[id] ?? 100;
  const ids       = Object.keys(current) as ItPartyId[];
  const lockedSum = ids.filter(id => locks.has(id) && id !== changedId).reduce((s, id) => s + (current[id] ?? 0), 0);
  const clamped   = Math.min(Math.max(newRaw, 0), capOf(changedId), 100 - lockedSum);
  const pool      = ids.filter(id => !locks.has(id) && id !== changedId);
  const seedSum   = pool.reduce((s, id) => s + (current[id] ?? 0), 0);
  const next: Record<ItPartyId, number> = { ...current, [changedId]: clamped };
  for (const id of pool) next[id] = 0;
  // Distribute the remainder proportionally to prior shares, but never above each
  // party's cap — overflow from capped parties spills to those with headroom.
  let remaining = 100 - lockedSum - clamped;
  let active = [...pool];
  for (let iter = 0; iter < 8 && active.length > 0 && remaining > 1e-6; iter++) {
    const wSum = active.reduce((s, id) => s + (seedSum > 0 ? (current[id] ?? 0) : 1), 0) || 1;
    const stillOpen: ItPartyId[] = [];
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
function partyColor(id: ItPartyId): string { return IT_PARTY_MAP[id]?.color ?? '#888'; }

function getProvFill(
  natPcts:   Record<ItPartyId, number>,
  provId:    ItProvId,
  dark:      boolean,
  override?: Partial<Record<ItPartyId, number>>,
): string {
  const pv     = calcProvVotes(natPcts, provId, override);
  const sorted = (Object.entries(pv) as [ItPartyId, number][]).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
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
  parties: { id: ItPartyId; pct: number; rawVotes?: number; label?: string; color?: string }[];
  leader: ItPartyId | null;
  reportingPct?: number;
  noResults?: boolean;
} | null;

// ── Scoreboard tile ───────────────────────────────────────────────────────────
function ItScoreboardTile({
  partyId, seats, pct, rawVotes, isLeader, isWinner, is2026, dark: _dark, display,
}: {
  partyId: ItPartyId; seats: number; pct: number; rawVotes?: number;
  isLeader: boolean; isWinner: boolean; is2026?: boolean; dark?: boolean;
  display?: { name: string; fullName: string; color: string; leader: string; wiki: string };
}) {
  const party      = IT_PARTY_MAP[partyId];
  const leaderName = display?.leader   ?? (is2026 && party.leader2026 ? party.leader2026 : party.leader);
  const leaderWiki = display?.wiki     ?? (is2026 && party.wikiTitle2026 ? party.wikiTitle2026 : party.wikiTitle);
  const partyName  = display?.name     ?? (is2026 && party.name2026 ? party.name2026 : party.name);
  const partyFull  = display?.fullName ?? (is2026 && party.fullName2026 ? party.fullName2026 : party.fullName);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!leaderWiki) { setPhotoUrl(null); return; }
    let cancelled = false;
    fetchWikiPhoto(leaderWiki).then(url => { if (!cancelled) setPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [leaderWiki]);

  const initials   = leaderName.split(' ').map((w: string) => w[0]).join('').slice(0, 2);
  const color      = display?.color ?? partyColor(partyId);
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
// Italy blocs: national left (PSOE + Sumar) vs national right (PP + Vox). ALL
// nationalist/regionalist parties — ERC, Junts, EH Bildu, PNV, BNG, CC, UPN — are
// grouped together in the Regional bloc (ordered by 2022 seat size as a fallback).
const IT_LEFT_IDS:     ItPartyId[] = ['AVS','PD','IC','PIU'];
const IT_RIGHT_IDS:    ItPartyId[] = ['FI','NM','LEGA','FDI'];

function ItScoreboard({
  natPcts, simSeats, isBaseline, is2026, dark, reportedVoteScale,
}: {
  natPcts: Record<ItPartyId,number>; simSeats?: Partial<Record<ItPartyId,number>>;
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

  // 2026 alignment: M5S sits inside the centre-left; FN and Az/IV stand alone.
  const leftIds  = is2026 ? ([...IT_LEFT_IDS, 'M5S'] as ItPartyId[]) : IT_LEFT_IDS;
  const indepIds = is2026 ? (['AZ','IV','FN','SVP'] as ItPartyId[]) : (['M5S','AZ','IV','FN','SVP'] as ItPartyId[]);
  const leftSeats  = leftIds.reduce((s,id)=>s+(seats[id]??0), 0);
  const rightSeats = IT_RIGHT_IDS.reduce((s,id)=>s+(seats[id]??0), 0);

  const leftMajority  = leftSeats  >= IT_MAJORITY;
  const rightMajority = rightSeats >= IT_MAJORITY;
  const maxIndep = indepIds.reduce((m,id)=>Math.max(m, seats[id]??0), 0);
  const maxGroup = Math.max(leftSeats, rightSeats, maxIndep);
  const leftLeading   = maxGroup > 0 && leftSeats  === maxGroup;
  const rightLeading  = maxGroup > 0 && rightSeats === maxGroup;

  const visible = useMemo(
    () => IT_LR_ORDER.filter(id => (seats[id]??0)>0 || (natPcts[id]??0)>=0.1),
    [seats, natPcts],
  );

  const makeTile = (id: ItPartyId) => {
    const s   = seats[id] ?? 0;
    const pct = natPcts[id] ?? 0;   // true vote share (minor lists omitted, so parties don't sum to 100)
    const rawVotes = isBaseline
      ? Math.round((IT_VOTE_RAW_2022[id]??0)*scale)
      : Math.round((natPcts[id]??0)/100*IT_GRAND_TOTAL_VOTES*scale);
    const inLeft   = leftIds.includes(id);
    const inRight  = IT_RIGHT_IDS.includes(id);
    const isWinner = inLeft ? leftMajority : inRight ? rightMajority : false;
    const isLeader = inLeft  ? (leftLeading  && !leftMajority)
                   : inRight ? (rightLeading && !rightMajority) : false;
    return <ItScoreboardTile key={id} partyId={id} seats={s} pct={pct} rawVotes={rawVotes}
      isLeader={isLeader} isWinner={isWinner} is2026={is2026} dark={dark} />;
  };

  // 2022 only: Azione + Italia Viva ran as the joint Azione–Italia Viva list → one card.
  const AZIV_DISPLAY = { name:'Az–IV', fullName:'Azione–Italia Viva', color: IT_COAL_COLOR.AZIV, leader:'Carlo Calenda', wiki:'Carlo_Calenda' };
  const makeComboTile = (ids: ItPartyId[], display: typeof AZIV_DISPLAY) => {
    const s   = ids.reduce((a,id)=>a+(seats[id]??0),0);
    const pct = ids.reduce((a,id)=>a+(natPcts[id]??0),0);
    const rawVotes = isBaseline
      ? Math.round(ids.reduce((a,id)=>a+(IT_VOTE_RAW_2022[id]??0),0)*scale)
      : Math.round(pct/100*IT_GRAND_TOTAL_VOTES*scale);
    return <ItScoreboardTile key={display.name} partyId={ids[0]} seats={s} pct={pct} rawVotes={rawVotes}
      isLeader={false} isWinner={false} is2026={is2026} dark={dark} display={display} />;
  };

  const sortedBloc = (ids: ItPartyId[]) =>
    ids.filter(id=>visible.includes(id)).sort((a,b)=>(seats[b]??0)-(seats[a]??0));

  const renderBloc = (ids: ItPartyId[], label: string, isLeading: boolean, isMajority: boolean) => {
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

  // The two coalitions stay grouped; every other party is its own independent
  // card (no combined "Independents" bloc). All sorted together by seat size.
  type ScoreItem = { key: string; total: number; el: React.ReactNode };
  const items: ScoreItem[] = [];
  if (sortedBloc(leftIds).length)      items.push({ key:'left',  total:leftSeats,  el: renderBloc(leftIds, 'Centre-left', leftLeading && !leftMajority, leftMajority) });
  if (sortedBloc(IT_RIGHT_IDS).length) items.push({ key:'right', total:rightSeats, el: renderBloc(IT_RIGHT_IDS, 'Centre-right', rightLeading && !rightMajority, rightMajority) });
  const indepShown = sortedBloc(indepIds);
  if (!is2026 && (indepShown.includes('AZ') || indepShown.includes('IV'))) {
    items.push({ key:'AZIV', total:(seats.AZ??0)+(seats.IV??0), el: makeComboTile(['AZ','IV'], AZIV_DISPLAY) });
    for (const id of indepShown) if (id!=='AZ' && id!=='IV') items.push({ key:id, total: seats[id]??0, el: makeTile(id) });
  } else {
    for (const id of indepShown) items.push({ key:id, total: seats[id]??0, el: makeTile(id) });
  }
  items.sort((a,b)=>b.total-a.total);

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {items.map(it => <React.Fragment key={it.key}>{it.el}</React.Fragment>)}
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

function ItBubbleLayer({
  geoData, natPcts, containerRef, setTooltip, onSelect, natPctsRef,
  declaredProvs, provOverrides, provOverridesRef, blankMode, projectedProvs,
  simProvFractions, simNatPctsRef, mapView, onSelectUni, is2026,
}: {
  mapView: ItMapViewId; onSelectUni?: (geoId:string)=>void; is2026?: boolean;
  geoData: any; natPcts: Record<ItPartyId,number>;
  containerRef: React.RefObject<HTMLDivElement|null>;
  setTooltip: (t:ProvTooltipState)=>void; onSelect: (id:ItProvId)=>void;
  natPctsRef: React.MutableRefObject<Record<ItPartyId,number>>;
  declaredProvs?: Set<ItProvId>;
  provOverrides?: Partial<Record<ItProvId,Partial<Record<ItPartyId,number>>>>;
  provOverridesRef: React.MutableRefObject<Partial<Record<ItProvId,Partial<Record<ItPartyId,number>>>>>;
  blankMode?: boolean; projectedProvs?: Set<ItProvId>;
  simProvFractions?: Partial<Record<ItProvId,number>>;
  simNatPctsRef?: React.MutableRefObject<Record<ItPartyId,number>|null>;
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

    const REG: Record<string,[string,string]> = { AUT:['Aosta Valley list',IT_COAL_COLOR.AUT], SVP:['SVP',IT_COAL_COLOR.SVP], SCN:['Sud chiama Nord',IT_COAL_COLOR.SCN] };
    L.geoJSON(geoData).eachLayer((layer: L.Layer) => {
      const path   = layer as any;
      const props  = path.feature?.properties ?? {};
      const geoId: string = props.id ?? '';
      const bounds = (layer as any).getBounds?.(); if (!bounds?.isValid()) return;
      const center = bounds.getCenter();
      const votes  = (props.votes as number) ?? 0;
      let color = '#9AA0A6', rawMargin = 0, pName = '';
      let parties: { id: ItPartyId; pct: number; rawVotes?: number; label?: string; color?: string }[] = [];

      if (mapView === 'uni') {
        const sh = (props.shares as Record<string,number>) ?? {}; const coal = props.coal as string;
        const sorted = uniSwungShares(sh, natPcts, is2026);   // swung to the current vote (all coalitions move)
        if (!sorted.length) return;
        rawMargin = (sorted[0].v-(sorted[1]?.v||0))/100*votes;
        color = (coal==='SVP'||coal==='AUT'||coal==='SCN') ? (IT_COAL_COLOR[coal]||'#999') : (IT_COAL_COLOR[sorted[0].c]||'#999');
        pName = String(props.den||geoId);
        parties = sorted.map(x=>({ id:x.c as unknown as ItPartyId, pct:x.v, rawVotes:Math.round(x.v/100*votes),
          label:(x.c==='OTH'&&REG[coal])?REG[coal][0]:IT_COAL_LABEL[x.c], color:(x.c==='OTH'&&REG[coal])?REG[coal][1]:IT_COAL_COLOR[x.c] }));
      } else if (mapView === 'reg') {
        const pr = (props.pr as Record<string,number>) ?? {}; const sorted = IT_PR_KEYS.map(k=>({k,v:pr[k]||0})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
        if (!sorted.length) return;
        rawMargin = (sorted[0].v-(sorted[1]?.v||0))/100*votes;
        color = partyColor(sorted[0].k); pName = String(props.reg_name||geoId);
        parties = sorted.slice(0,6).map(x=>({ id:x.k, pct:x.v, rawVotes:Math.round(x.v/100*votes) }));
      } else {
        const provId = IT_GEOID_TO_ID[geoId]; if (!provId) return;
        if (declaredProvs && !declaredProvs.has(provId)) return;
        if (!declaredProvs && blankMode && !(projectedProvs?.has(provId))) return;
        const prov = IT_PROVINCE_MAP[provId];
        const provVotes = IT_GRAND_TOTAL_VOTES * (prov?.weight ?? 0) / IT_TOTAL_PROV_WEIGHT;
        const pv = calcProvVotes(natPcts, provId, provOverrides?.[provId]);
        const sorted = (Object.entries(pv) as [ItPartyId,number][]).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a);
        if (!sorted.length) return;
        rawMargin = (sorted[0][1]-(sorted[1]?.[1]||0))/100*provVotes;
        color = partyColor(sorted[0][0]); pName = prov?.name ?? geoId;
        const cur = calcProvVotes(simNatPctsRef?.current ?? natPctsRef.current, provId, provOverridesRef.current?.[provId]);
        const frac = simFracRef.current[provId] ?? 1;
        parties = (Object.entries(cur) as [ItPartyId,number][]).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,8)
          .map(([id,pct])=>({ id, pct, rawVotes:Math.round(pct/100*provVotes*frac) }));
      }
      // radius DIRECTLY proportional to the raw vote margin (area ∝ margin)
      const baseRadius = Math.max(3, Math.min(42, Math.sqrt(Math.max(0,rawMargin)) * 0.07));
      const marker = L.circleMarker(center, { radius:baseRadius*scale, color, fillColor:color, fillOpacity:0.72, weight:1, opacity:0.9 }).addTo(map);
      marker.on('click', () => { setTooltip(null); if (mapView==='pluri'){ const pid=IT_GEOID_TO_ID[geoId]; if(pid)onSelect(pid); } else if (mapView==='uni'){ onSelectUni?.(geoId); } });
      marker.on('mousemove', (e: L.LeafletMouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
        setTooltip({ x:e.originalEvent.clientX-rect.left, y:e.originalEvent.clientY-rect.top, name:pName, parties, leader:parties[0]?.id??null, reportingPct:undefined });
      });
      marker.on('mouseout', () => setTooltip(null));
      bubblesRef.current.push({ marker, baseRadius });
    });

    return () => { for (const {marker} of bubblesRef.current) marker.remove(); bubblesRef.current=[]; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geoData, natPcts, blankMode, projectedProvs, declaredProvs, mapView, is2026]);

  return null;
}

// ── Overseas constituency layer — ALWAYS shown (choropleth, bubble & dot views) ──
// The 8 international seats (4 zones) plotted on their continents, sized by seat
// count and coloured by the zone winner. The per-zone allocation is constant.
function ItOverseasLayer({ containerRef, setTooltip }: {
  containerRef: React.RefObject<HTMLDivElement|null>;
  setTooltip: (t:ProvTooltipState)=>void;
}) {
  const map = useMap();
  const ref = useRef<L.CircleMarker[]>([]);
  useEffect(() => {
    const build = () => {
      for (const m of ref.current) m.remove(); ref.current = [];
      const scale = zoomScale(map.getZoom());
      for (const z of IT_OVERSEAS) {
        const { seats, sorted } = overseasZoneSeats(z);
        if (!sorted.length) continue;
        const winner = sorted[0].id;
        const m = L.circleMarker([z.lat, z.lng], { radius:(7 + z.seats*4.5)*scale, color:partyColor(winner), fillColor:partyColor(winner), fillOpacity:0.62, weight:1.6, opacity:0.92, dashArray:'4,2' }).addTo(map);
        const tipParties = (Object.entries(seats) as [ItPartyId, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
          .map(([id, n]) => ({ id, pct: z.v[id] ?? 0, rawVotes: undefined as number | undefined, label: `${IT_PARTY_MAP[id]?.name ?? id} · ${n} seat${n > 1 ? 's' : ''}`, color: partyColor(id) }));
        m.on('mousemove', (e: L.LeafletMouseEvent) => {
          const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
          setTooltip({ x: e.originalEvent.clientX - rect.left, y: e.originalEvent.clientY - rect.top, name: `Overseas — ${z.name} (${z.seats} seats)`, parties: tipParties, leader: tipParties[0]?.id ?? null, reportingPct: undefined });
        });
        m.on('mouseout', () => setTooltip(null));
        ref.current.push(m);
      }
    };
    build();
    map.on('zoomend', build);
    return () => { map.off('zoomend', build); for (const m of ref.current) m.remove(); ref.current = []; };
  }, [map]);
  return null;
}

// ── Seat-distribution dots overlay (one dot per seat, grouped by party, at the
//    constituency centroid; re-laid-out on zoom). Ported from the Poland game (Italy edition). ──
function ItSeatDotsLayer({
  geoData, natPcts, containerRef, setTooltip, onSelect, natPctsRef,
  declaredProvs, provOverrides, provOverridesRef, blankMode, projectedProvs,
  simProvFractions, simNatPctsRef, is2026,
}: {
  is2026?: boolean;
  geoData: any; natPcts: Record<ItPartyId,number>;
  containerRef: React.RefObject<HTMLDivElement|null>;
  setTooltip: (t:ProvTooltipState)=>void; onSelect: (id:ItProvId)=>void;
  natPctsRef: React.MutableRefObject<Record<ItPartyId,number>>;
  declaredProvs?: Set<ItProvId>;
  provOverrides?: Partial<Record<ItProvId,Partial<Record<ItPartyId,number>>>>;
  provOverridesRef: React.MutableRefObject<Partial<Record<ItProvId,Partial<Record<ItPartyId,number>>>>>;
  blankMode?: boolean; projectedProvs?: Set<ItProvId>;
  simProvFractions?: Partial<Record<ItProvId,number>>;
  simNatPctsRef?: React.MutableRefObject<Record<ItPartyId,number>|null>;
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
      const perDist = distributePRtoDistricts(natPcts, prNationalTotals(natPcts, is2026), provOverrides);
      L.geoJSON(geoData).eachLayer((layer: L.Layer) => {
        const path = layer as any;
        const geoId: string = path.feature?.properties?.id ?? '';
        const provId = IT_GEOID_TO_ID[geoId];
        if (!provId) return;
        if (declaredProvs && !declaredProvs.has(provId)) return;
        if (!declaredProvs && blankMode && !(projectedProvs?.has(provId))) return;
        const bounds = (layer as any).getBounds?.(); if (!bounds?.isValid()) return;
        const center = bounds.getCenter();
        const prov = IT_PROVINCE_MAP[provId];
        const alloc = perDist[provId] ?? {};
        const colors: string[] = [];
        for (const id of IT_LR_ORDER) { const n = alloc[id] ?? 0; for (let i=0;i<n;i++) colors.push(partyColor(id)); }
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
            const provVots = IT_GRAND_TOTAL_VOTES * (prov?.weight??0) / IT_TOTAL_PROV_WEIGHT;
            const parties = (Object.entries(cur) as [ItPartyId,number][])
              .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,8)
              .map(([id,pct]) => ({ id:id as ItPartyId, pct, rawVotes:Math.round(pct/100*provVots*fraction) }));
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
  }, [map, geoData, natPcts, blankMode, projectedProvs, declaredProvs, provOverrides, is2026]);

  return null;
}

// ── Province draft ────────────────────────────────────────────────────────────
type ItProvDraft = { provId: ItProvId; pcts: Record<ItPartyId,number>; rptPct: number };

// ── Map view ──────────────────────────────────────────────────────────────────
// Leading party (regions view) / winning coalition (single-member view) after a
// uniform national swing applied to the geojson's baked 2022 shares.
// Lighten a base colour toward neutral for narrow margins, deepen it for blow-outs
// (mirrors getProvFill's margin→lightness ramp so all three map views share a gradient).
function shadeByMargin(hex: string, margin: number, dark: boolean): string {
  const c = hsl(hex);
  const t = Math.min(Math.max(margin, 0) / 20, 1);
  c.l = dark ? 0.60 - t * 0.32 : 0.84 - t * 0.48;
  return c.formatHex();
}
function swungRegLeadColor(pr: Record<string, number>, natPcts: Record<ItPartyId, number>, dark: boolean): string {
  const sw: { id: ItPartyId; v: number }[] = [];
  for (const id of IT_PR_KEYS) {
    const base = pr[id] ?? 0; if (base <= 0) continue;
    const v = (IT_VOTE_PCT_2022[id] ?? 0) > 0 ? base * ((natPcts[id] ?? 0) / (IT_VOTE_PCT_2022[id] ?? 1)) : base;
    sw.push({ id: id as ItPartyId, v });
  }
  sw.sort((a, b) => b.v - a.v);
  if (sw.length === 0) return partyColor('FDI');
  const margin = sw[0].v - (sw[1]?.v ?? 0);
  return shadeByMargin(partyColor(sw[0].id), margin, dark);
}
function swungUniCoal(shares: Record<string, number>, natPcts: Record<ItPartyId, number>, dark: boolean, is2026?: boolean): string {
  const val = uniSwungVals(shares, natPcts, is2026);
  const order = ['CDX','CSX','M5S','AZIV','OTH'].filter(c => (val[c] ?? -1) >= 0).sort((a, b) => val[b] - val[a]);
  if (order.length === 0) return '#9AA0A6';
  const margin = val[order[0]] - (order[1] ? val[order[1]] : 0);
  return shadeByMargin(IT_COAL_COLOR[order[0]] ?? '#9AA0A6', margin, dark);
}

function ItMapView({
  natPcts, selectedProv, onSelect, dark, bubbleMap, seatDots, mapView,
  declaredProvs, provOverrides, blankMode, projectedProvs, simProvFractions,
  provDraft, simNatPcts, onSelectUni, selectedUni, fptpOverrides, is2026,
}: {
  natPcts: Record<ItPartyId,number>; selectedProv: ItProvId|null; mapView: ItMapViewId;
  onSelect: (id:ItProvId)=>void; dark: boolean; bubbleMap: boolean; seatDots: boolean;
  onSelectUni?: (geoId:string)=>void; selectedUni?: string|null; fptpOverrides?: Record<string,Record<string,number>>;
  declaredProvs?: Set<ItProvId>;
  provOverrides?: Partial<Record<ItProvId,Partial<Record<ItPartyId,number>>>>;
  blankMode?: boolean; projectedProvs?: Set<ItProvId>;
  simProvFractions?: Partial<Record<ItProvId,number>>;
  provDraft?: ItProvDraft|null; simNatPcts?: Record<ItPartyId,number>|null; is2026?: boolean;
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
  const projectedRef    = useRef(projectedProvs ?? new Set<ItProvId>());
  const simFracRef2     = useRef(simProvFractions ?? {});
  const provDraftRef2   = useRef<ItProvDraft|null>(provDraft ?? null);
  const simNatPctsRef2  = useRef<Record<ItPartyId,number>|null>(simNatPcts ?? null);

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

  const mapViewRef = useRef(mapView);
  useEffect(() => { mapViewRef.current = mapView; }, [mapView]);
  const is2026Ref = useRef(is2026);
  useEffect(() => { is2026Ref.current = is2026; }, [is2026]);
  const onSelectUniRef = useRef(onSelectUni); useEffect(()=>{ onSelectUniRef.current=onSelectUni; },[onSelectUni]);
  const fptpOvRef = useRef(fptpOverrides); useEffect(()=>{ fptpOvRef.current=fptpOverrides; },[fptpOverrides]);
  useEffect(() => {
    const file = IT_MAP_VIEWS.find(v => v.id === mapView)?.file ?? 'italy-plurinominali.geojson';
    setGeoData(null);
    fetch(`${import.meta.env.BASE_URL}${file}`).then(r => r.json()).then(setGeoData).catch(console.error);
  }, [mapView]);

  const getStyle = useCallback((feature: any): L.PathOptions => {
    const geoId  = feature?.properties?.id ?? '';
    const border = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)';

    // Single-member (FPTP, editable) and Regions views
    if (mapView !== 'pluri') {
      // Bubble Map: show ONLY the bubbles — hide the choropleth underneath.
      if (bubbleMap) return { fillOpacity:0, weight:0.4, color:dark?'rgba(255,255,255,0.18)':'rgba(0,0,0,0.18)', opacity:0.6 };
      const eff = simNatPcts ?? natPcts;
      const props = feature?.properties ?? {};
      const ov = mapView==='uni' ? fptpOverrides?.[geoId] : undefined;
      const ovSel = mapView==='uni' && geoId===selectedUni;
      const grey = { fillColor: dark?'#1f2937':'#d1d5db', fillOpacity:0.7, weight: ovSel?2:0.5, color: ovSel?'#c8a020':border, opacity:1 };
      // Simulation: FPTP collegi (and regions) trickle in IN STEP with the PR districts —
      // a collegio fills once its circoscrizione's PR districts start reporting.
      const simming = !!simProvFractions && Object.keys(simProvFractions).length > 0;
      let op = 0.85;
      if (!ov) {
        if (simming) {
          const key = mapView==='uni' ? itCirco(String(props.den ?? '')) : String(props.reg_name ?? '');
          const f = simReportFrac(key, simProvFractions);
          if (f <= 0) return grey;                 // this region hasn't started reporting yet
          op = Math.max(0.4, 0.85 * f);            // fade in as it reports
        } else if (blankMode) {
          return grey;                             // Blank Map (no sim): grey until edited
        }
      }
      let fill: string;
      if (mapView === 'uni') {
        const coal = props.coal as string;
        if (ov) {
          const sorted = uniCoalShares(ov as Record<string,number>, is2026);
          const top = sorted[0]?.c ?? 'CDX';
          const margin = (sorted[0]?.v ?? 0) - (sorted[1]?.v ?? 0);
          fill = shadeByMargin(IT_COAL_COLOR[top] ?? '#7E57C2', margin, dark);
        }
        else if (coal==='SVP'||coal==='AUT'||coal==='SCN') fill = IT_COAL_COLOR[coal];  // regional winners — their own colour
        else fill = swungUniCoal((props.shares as Record<string,number>) ?? {}, eff, dark, is2026);
      } else fill = swungRegLeadColor((props.pr as Record<string,number>) ?? {}, eff, dark);
      return { fillColor: fill, fillOpacity: op, weight: ovSel?2.2:0.5, color: ovSel?'#c8a020':border, opacity: 1 };
    }

    const provId = IT_GEOID_TO_ID[geoId];
    const isSel  = provId === selectedProv;

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
  }, [natPcts, selectedProv, dark, bubbleMap, seatDots, mapView, declaredProvs, provOverrides, blankMode, simProvFractions, simNatPcts, selectedUni, fptpOverrides, is2026]);

  useEffect(() => { layerRef.current?.setStyle((f:any)=>getStyle(f)); }, [getStyle]);

  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const geoId  = feature?.properties?.id ?? '';
    const provId = IT_GEOID_TO_ID[geoId];

    layer.on('click', () => {
      if (mapViewRef.current === 'uni') { if (geoId) onSelectUniRef.current?.(geoId); return; }
      if (mapViewRef.current !== 'pluri') return;
      if (provId) onSelectRef.current(provId);
    });
    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      // uni / regions views: tooltip from the baked result (read-only)
      if (mapViewRef.current !== 'pluri') {
        const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
        const props = feature?.properties ?? {};
        const nm = String(props.den ?? props.reg_name ?? '');
        const votes = (props.votes as number) ?? 0;
        const tx = e.originalEvent.clientX-rect.left, ty = e.originalEvent.clientY-rect.top;
        if (mapViewRef.current === 'uni') {
          // Blank Map: a collegio with no projection has no result yet.
          const ov = fptpOvRef.current?.[geoId];
          if (blankModeRef.current && !ov) { setTooltip({ x:tx, y:ty, name:nm, parties:[], leader:null, noResults:true }); return; }
          const coal = ov ? '' : (props.coal as string);
          const REG: Record<string, [string,string]> = { AUT:["Aosta Valley list",IT_COAL_COLOR.AUT], SVP:["SVP",IT_COAL_COLOR.SVP], SCN:["Sud chiama Nord",IT_COAL_COLOR.SCN] };
          const eff = simNatPctsRef2.current ?? natPctsRef.current;
          // baked baseline → swung to the current vote (every coalition moves); an edited collegio shows its raw override
          const sorted = ov ? uniCoalShares(ov, is2026Ref.current) : uniSwungShares((props.shares as Record<string,number>) ?? {}, eff, is2026Ref.current);
          const parties = sorted.map(({ c, v }) => {
            const isWinReg = c==='OTH' && REG[coal];
            return { id: c as unknown as ItPartyId, pct: v, rawVotes: Math.round(v/100*votes),
              label: isWinReg ? REG[coal][0] : (c==='CSX' && is2026Ref.current ? 'Centre-left + M5S' : IT_COAL_LABEL[c]),
              color: isWinReg ? REG[coal][1] : IT_COAL_COLOR[c] };
          });
          setTooltip({ x:tx, y:ty, name:nm, parties, leader:parties[0]?.id??null, reportingPct:undefined });
          return;
        }
        // regions view: read-only; nothing is projected in Blank Map
        if (blankModeRef.current) { setTooltip({ x:tx, y:ty, name:nm, parties:[], leader:null, noResults:true }); return; }
        const pr = (props.pr as Record<string,number>) ?? {};
        const parties = IT_PR_KEYS.map(id => ({ id, pct: pr[id] ?? 0, rawVotes: Math.round((pr[id] ?? 0)/100*votes) })).filter(p => p.pct >= 1).sort((a,b)=>b.pct-a.pct).slice(0,6);
        setTooltip({ x:tx, y:ty, name:nm, parties, leader:parties[0]?.id??null, reportingPct:undefined });
        return;
      }
      if (!provId) { setTooltip(null); return; }
      const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
      const prov     = IT_PROVINCE_MAP[provId];
      const tx = e.originalEvent.clientX-rect.left, ty = e.originalEvent.clientY-rect.top;
      const draft    = provDraftRef2.current;
      const hasDraft = draft?.provId === provId;
      if (blankModeRef.current && !declaredRef.current) {
        const hasOverride = !!provOverridesRef.current[provId] && Object.keys(provOverridesRef.current[provId]!).length > 0;
        if (!hasOverride && !hasDraft) { setTooltip({ x:tx, y:ty, name:prov?.name??geoId, parties:[], leader:null, noResults:true }); return; }
      }
      const overrideToUse = hasDraft ? draft!.pcts : provOverridesRef.current?.[provId];
      const fraction      = hasDraft ? draft!.rptPct/100 : simFracRef2.current[provId] ?? (declaredRef.current?.has(provId) ? 1 : undefined);
      const effectiveNatPcts = simNatPctsRef2.current ?? natPctsRef.current;
      const provVots = IT_GRAND_TOTAL_VOTES * (prov?.weight??0) / IT_TOTAL_PROV_WEIGHT;
      const pv       = calcProvVotes(effectiveNatPcts, provId, overrideToUse);
      const parties  = (Object.entries(pv) as [ItPartyId,number][])
        .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,8)
        .map(([id,pct]) => ({ id:id as ItPartyId, pct, rawVotes:Math.round(pct/100*provVots*(fraction??1)) }));
      setTooltip({ x:tx, y:ty, name:prov?.name??geoId, parties, leader:parties[0]?.id??null,
        reportingPct:fraction!=null ? Math.round(fraction*100) : undefined });
    });
    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[42.2, 12.4]} zoom={5} style={{ width:'100%', height:'100%' }} zoomControl worldCopyJump={false}>
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
        {geoData && <ItOverseasLayer containerRef={containerRef} setTooltip={setTooltip} />}
        {geoData && bubbleMap && (
          <ItBubbleLayer
            mapView={mapView} onSelectUni={onSelectUni} is2026={is2026}
            geoData={geoData} natPcts={simNatPcts??natPcts} containerRef={containerRef}
            setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef}
            declaredProvs={mapView==='pluri'?declaredProvs:undefined} provOverrides={provOverrides}
            provOverridesRef={provOverridesRef} blankMode={mapView==='pluri'&&blankMode}
            projectedProvs={projectedProvs} simProvFractions={simProvFractions}
            simNatPctsRef={simNatPctsRef2}
          />
        )}
        {geoData && seatDots && mapView==='pluri' && (
          <ItSeatDotsLayer
            is2026={is2026}
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
                {tooltip.noResults ? 'Not yet reported' : tooltip.reportingPct!=null ? `${tooltip.reportingPct}% reporting` : 'Estimated district result'}
              </div>
              {tooltip.noResults ? (
                <div style={{ marginTop:9, fontSize:11, fontStyle:'italic', color:tt.sub }}>No results yet</div>
              ) : (
              <div style={{ marginTop:9, display:'flex', flexDirection:'column', gap:5 }}>
                {tooltip.parties.map(({ id, pct, rawVotes, label, color },i) => {
                  const pColor=color??partyColor(id);
                  return (
                    <div key={id+'-'+i} style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:7, height:7, borderRadius:2, flexShrink:0, background:pColor }} />
                      <span style={{ flex:1, fontSize:11, fontWeight:i===0?600:400, color:tt.body, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label??IT_PARTY_MAP[id]?.name??id}</span>
                      <span style={{ fontSize:11, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color:pColor }}>{pct.toFixed(1)}%</span>
                      {rawVotes!=null && <span style={{ fontSize:8.5, fontFamily:'"JetBrains Mono",monospace', color:tt.sub, marginLeft:2 }}>{rawVotes.toLocaleString()}</span>}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          </div>
        );
      })()}
      <div className="absolute bottom-2 right-2 text-[10px] text-ink-3 select-none z-[1000] font-mono">Scroll to zoom · Click to open</div>
    </div>
  );
}

// ── Parliament hemicycle — 7 rows ─────────────────────────────────────────────
function ItParliamentPanel({ seats: seatsMap, onClose, exiting, dark, is2026 }: {
  seats: Partial<Record<ItPartyId,number>>; onClose:()=>void; exiting?:boolean; dark?:boolean; is2026?:boolean;
}) {
  const [parliMode,setParliMode]=useState<'parties'|'coalitions'>('parties');
  const pLeftIds=is2026?([...IT_LEFT_IDS,'M5S'] as ItPartyId[]):IT_LEFT_IDS;
  const coalColorOf=(id:ItPartyId)=>pLeftIds.includes(id)?'#E4003B':IT_RIGHT_IDS.includes(id)?'#0066CC':partyColor(id);
  const seatColors: string[] = [];
  const legend: { id:ItPartyId; count:number; color:string }[] = [];
  for (const id of IT_LR_ORDER) {
    const n = seatsMap[id] ?? 0; if (n===0) continue;
    legend.push({ id, count:n, color:partyColor(id) });
    const arcColor = parliMode==='coalitions' ? coalColorOf(id) : partyColor(id);
    for (let i=0; i<n; i++) seatColors.push(arcColor);
  }
  const totalSeats = seatColors.length;
  const W=380, H=215, cx=W/2, cy=H-6, innerR=68, rowSpacing=18, numRows=7;
  const radii   = Array.from({length:numRows},(_,i)=>innerR+i*rowSpacing);
  const arcLens = radii.map(r=>Math.PI*r);
  const totalArc= arcLens.reduce((s,v)=>s+v,0);
  const rawPerRow  = arcLens.map(a=>(a/totalArc)*IT_TOTAL_SEATS);
  const floored    = rawPerRow.map(Math.floor);
  const remainder  = IT_TOTAL_SEATS - floored.reduce((s,v)=>s+v,0);
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
          <h2 className="text-[13px] font-bold text-ink leading-none">Camera dei Deputati — Parliamentary Composition</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">{totalSeats} seats · majority {IT_MAJORITY} · {parliMode==='coalitions'?'by coalition':'by party'}</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex gap-1 px-3.5 py-2 border-b border-default shrink-0">
        {(['parties','coalitions'] as const).map(m=>(
          <button key={m} onClick={()=>setParliMode(m)}
            className={`flex-1 py-1 rounded-[4px] text-[9px] font-mono font-bold uppercase tracking-wide transition-colors ${parliMode===m?'bg-gold text-black':'border border-default text-ink-3 hover:bg-hover'}`}>
            {m==='parties'?'By party':'By coalition'}
          </button>
        ))}
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
                const lIds=is2026?([...IT_LEFT_IDS,'M5S'] as ItPartyId[]):IT_LEFT_IDS;
                const iIds=is2026?(['AZ','IV','FN','SVP'] as ItPartyId[]):(['M5S','AZ','IV','FN','SVP'] as ItPartyId[]);
                const blocs=[
                  {label:'C-left',  seats:lIds.reduce((s,id)=>s+(seatsMap[id]??0),0),         color:'#E4003B'},
                  {label:'Indep',   seats:iIds.reduce((s,id)=>s+(seatsMap[id]??0),0),         color:'#007442'},
                  {label:'C-right', seats:IT_RIGHT_IDS.reduce((s,id)=>s+(seatsMap[id]??0),0), color:'#0066CC'},
                ].sort((a,b)=>b.seats-a.seats);
                return (
                  <div className="flex items-center gap-1.5 mb-3 text-[9px] font-mono">
                    {blocs.map((b,i)=>(
                      <React.Fragment key={b.label}>
                        {i>0&&<span style={{color:dot}}>·</span>}
                        <span style={{color:b.color,fontWeight:700}}>{b.label} {b.seats}</span>
                      </React.Fragment>
                    ))}
                    <span style={{color:dot,marginLeft:'auto'}}>need {IT_MAJORITY}</span>
                  </div>
                );
              })()}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {legend.map(({id,count,color})=>(
                  <div key={id} className="flex items-center gap-1.5">
                    <div style={{width:9,height:9,borderRadius:2,background:color,flexShrink:0}}/>
                    <span className="text-[9.5px] font-mono text-ink-3 flex-1 truncate">{IT_PARTY_MAP[id].name}</span>
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
const IT_PRESET_COALITIONS: {name:string;emoji:string;parties:ItPartyId[]}[] = [
  {name:'Centre-right',   emoji:'🔵', parties:['FDI','LEGA','FI','NM']},
  {name:'Centre-left',    emoji:'🌹', parties:['PD','AVS','PIU','IC']},
  {name:'Broad Field',    emoji:'🤝', parties:['PD','M5S','AVS','PIU','IC','AZ','IV']},
  {name:'Grand Coalition',emoji:'🇮🇹', parties:['FDI','PD','FI']},
];

function ItCoalitionPanel({ seats, onClose, exiting, dark }: {
  seats:Partial<Record<ItPartyId,number>>; onClose:()=>void; exiting?:boolean; dark?:boolean;
}) {
  const [selected,setSelected] = useState<Set<ItPartyId>>(new Set(['FDI','LEGA','FI','NM']));
  const toggle = (id:ItPartyId) => setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const totalCoalSeats=[...selected].reduce((s,id)=>s+(seats[id]??0),0);
  const hasMajority=totalCoalSeats>=IT_MAJORITY;
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Coalition Builder</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Majority: {IT_MAJORITY} seats · {IT_TOTAL_SEATS} total</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="px-3.5 pt-3 pb-2 border-b border-default shrink-0">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {IT_PRESET_COALITIONS.map(coal=>(
            <button key={coal.name} onClick={()=>setSelected(new Set(coal.parties))}
              className="text-left px-2 py-1.5 rounded-[4px] border border-default hover:bg-hover transition-colors">
              <div className="text-[8px] font-bold text-ink truncate">{coal.emoji} {coal.name}</div>
              <div className="text-[7px] font-mono text-ink-3">{coal.parties.map(id=>IT_PARTY_MAP[id]?.name).join(' + ')}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Toggle Parties</div>
        <div className="space-y-1.5">
          {IT_LR_ORDER.map(id=>{
            const party=IT_PARTY_MAP[id]; const s=seats[id]??0; const isIn=selected.has(id); const color=partyColor(id);
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
            style={{width:`${Math.min(totalCoalSeats/IT_TOTAL_SEATS*100,100)}%`,background:hasMajority?'#16a34a':'#ef4444'}}/>
        </div>
        <div className={`mt-1.5 text-[9px] font-mono text-center font-bold ${hasMajority?'text-emerald-600':'text-red-500'}`}>
          {hasMajority?`✓ MAJORITY (need ${IT_MAJORITY})`:`✗ ${IT_MAJORITY-totalCoalSeats} seats short of majority`}
        </div>
      </div>
    </aside>
  );
}

// ── Parties panel ─────────────────────────────────────────────────────────────
function ItPartiesPanel({ hiddenParties,onToggle,onClose,dark }: {
  hiddenParties:Set<ItPartyId>; onToggle:(id:ItPartyId)=>void; onClose:()=>void; dark?:boolean;
}) {
  const allHidden=IT_LR_ORDER.every(id=>hiddenParties.has(id));
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
        {IT_LR_ORDER.map(id=>{
          const party=IT_PARTY_MAP[id]; const hidden=hiddenParties.has(id);
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
        <button onClick={()=>{for(const id of IT_LR_ORDER){if(allHidden?hiddenParties.has(id):!hiddenParties.has(id))onToggle(id);}}}
          className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
          {allHidden?'Show All':'Hide All'}
        </button>
      </div>
    </aside>
  );
}

// ── Province breakdown (blank map sliders) ────────────────────────────────────
function ItProvPanel({
  provId,natPcts,provOverride,onOverride,onResetOverride,onClose,
  isBlankMode,isProjected,reportingPct,onProject,onReportingPctChange,
  onDraftChange,hiddenParties,dark,
}: {
  provId:ItProvId; natPcts:Record<ItPartyId,number>;
  provOverride?:Partial<Record<ItPartyId,number>>;
  onOverride:(pcts:Partial<Record<ItPartyId,number>>)=>void;
  onResetOverride:()=>void; onClose:()=>void;
  isBlankMode?:boolean; isProjected?:boolean; reportingPct?:number;
  onProject?:()=>void; onReportingPctChange?:(pct:number)=>void;
  onDraftChange?:(pcts:Record<ItPartyId,number>,rptPct:number)=>void;
  hiddenParties?:Set<ItPartyId>; dark?:boolean;
}) {
  const [locks,setLocks]             = useState<Set<ItPartyId>>(new Set());
  const baseVotes = useMemo(()=>calcProvVotes(natPcts,provId),[natPcts,provId]);
  const [draftPcts,setDraftPcts]     = useState<Record<ItPartyId,number>>(()=>
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

  const effectiveLocks=useMemo(()=>new Set<ItPartyId>([...locks,...(hiddenParties??[])]),[locks,hiddenParties]);
  const displayPv   =isBlankMode?draftPcts:calcProvVotes(natPcts,provId,provOverride);
  const [sortedIds] =useState<ItPartyId[]>(()=>IT_PARTIES.map(p=>p.id).filter(id=>(baseVotes[id]??0)>0).sort((a,b)=>(baseVotes[b]??0)-(baseVotes[a]??0)));
  const prov        =IT_PROVINCE_MAP[provId];
  const winner      =IT_PARTIES.reduce((best,p)=>(displayPv[p.id]??0)>(displayPv[best.id]??0)?p:best,IT_PARTIES[0]);
  const hasOverride =!!provOverride&&Object.keys(provOverride).length>0;
  const provTotalVotes=Math.round(IT_GRAND_TOTAL_VOTES*(prov?.weight??0)/IT_TOTAL_PROV_WEIGHT);
  const sliderTrack=dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';

  const handleSlider=(id:ItPartyId,val:number)=>{
    if(isBlankMode){setDraftPcts(redistributePcts(draftPcts,id,val,effectiveLocks));setTouched(true);}
    else onOverride(redistributePcts(displayPv as Record<ItPartyId,number>,id,val,effectiveLocks));
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
          <span className="text-[8px] font-mono text-ink-3">{IT_PR_MAG[provId]??0} PR seats</span>
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
          {sortedIds.filter(id=>!hiddenParties?.has(id)&&itContests(id,provId)&&(isBlankMode||(displayPv[id]??0)>=0.1||locks.has(id))).map(id=>{
            const p=IT_PARTY_MAP[id]; const pct=displayPv[id]??0; const isLocked=locks.has(id); const color=p.color;
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
function ItBreakdownPanel({ seats, natPcts, isBaseline, onClose, exiting, dark }: {
  seats:Partial<Record<ItPartyId,number>>; natPcts:Record<ItPartyId,number>;
  isBaseline?:boolean; onClose:()=>void; exiting?:boolean; dark?:boolean;
}) {
  const totalS=IT_LR_ORDER.reduce((s,id)=>s+(seats[id]??0),0);
  const totalV=IT_PARTIES.reduce((s,p)=>s+(natPcts[p.id]??0),0);
  const bLeftIds  = isBaseline ? IT_LEFT_IDS : ([...IT_LEFT_IDS,'M5S'] as ItPartyId[]);
  const bIndepIds = isBaseline ? (['M5S','AZ','IV','FN','SVP'] as ItPartyId[]) : (['AZ','IV','FN','SVP'] as ItPartyId[]);
  const leftS   =bLeftIds.reduce((s,id)=>s+(seats[id]??0),0);
  const rightS  =IT_RIGHT_IDS.reduce((s,id)=>s+(seats[id]??0),0);
  const regS    =bIndepIds.reduce((s,id)=>s+(seats[id]??0),0);

  const enp = totalS>0 ? 1/IT_LR_ORDER.reduce((s,id)=>{const sh=(seats[id]??0)/totalS;return s+sh*sh;},0) : 0;
  const gallagher = Math.sqrt(IT_PARTIES.reduce((s,p)=>{
    const v=totalV>0?(natPcts[p.id]??0)/totalV*100:0;
    const sv=totalS>0?(seats[p.id]??0)/totalS*100:0;
    return s+Math.pow(v-sv,2);
  },0)/2);
  const largest=[...IT_LR_ORDER].sort((a,b)=>(seats[b]??0)-(seats[a]??0))[0];
  const shortOf=IT_MAJORITY-(seats[largest]??0);

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
          <Section title="Three Blocs">
            {[
              {label:'Centre-left', desc:isBaseline?'PD+AVS+€+IC':'PD+M5S+AVS+€+IC', seats:leftS, color:'#E4003B'},
              {label:'Independents',desc:isBaseline?'M5S+Az+IV+SVP':'Az+IV+FN+SVP',  seats:regS,  color:'#007442'},
              {label:'Centre-right',desc:'FdI+Lega+FI+NM',                           seats:rightS,color:'#0066CC'},
            ].sort((a,b)=>b.seats-a.seats).map(b=>(
              <div key={b.label} style={{background:cardBg,borderRadius:5,padding:'6px 8px',borderLeft:`3px solid ${b.color}`}}>
                <div className="flex items-center justify-between">
                  <div><div className="text-[10px] font-bold text-ink">{b.label}</div><div className="text-[8px] font-mono" style={{color:ink2}}>{b.desc}</div></div>
                  <div className="text-right">
                    <span className="text-[18px] font-black font-mono" style={{color:b.color}}>{b.seats}</span>
                    <div className="text-[7.5px] font-mono" style={{color:b.seats>=IT_MAJORITY?'#16a34a':ink3}}>
                      {b.seats>=IT_MAJORITY?'✓ majority':`need ${IT_MAJORITY-b.seats} more`}
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.06)'}}>
                  <div style={{width:`${Math.min(b.seats/IT_TOTAL_SEATS*100,100)}%`,height:'100%',borderRadius:4,background:b.color}}/>
                </div>
              </div>
            ))}
          </Section>
          <Section title="Electoral Statistics">
            <Stat label="Effective No. of Parties (ENP)" value={enp.toFixed(2)} sub="1/Σsᵢ² · higher = more fragmented"/>
            <Stat label="Gallagher Index" value={gallagher.toFixed(2)} sub="lower = more proportional (D'Hondt)"/>
            <Stat label="Largest party" value={`${IT_PARTY_MAP[largest]?.name} — ${seats[largest]??0} seats`} sub={shortOf>0?`${shortOf} short of majority`:'✓ Majority achieved'}/>
            <Stat label="D'Hondt threshold" value="3% per district" sub="no national threshold — district-by-district"/>
          </Section>
          <Section title="Swing vs 2022">
            {IT_LR_ORDER.filter(id=>(natPcts[id]??0)>0.3||(isBaseline&&(IT_VOTE_PCT_2022[id]??0)>0)).map(id=>{
              const vSwing=(natPcts[id]??0)-IT_VOTE_PCT_2022[id]; const sSwing=(seats[id]??0)-(IT_PARTY_MAP[id].seats2022??0); const color=partyColor(id);
              return (
                <div key={id} style={{background:cardBg,borderRadius:5,padding:'5px 8px',display:'flex',alignItems:'center',gap:8}}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{background:color}}/>
                  <span className="text-[10px] font-medium text-ink flex-1">{IT_PARTY_MAP[id].name}</span>
                  <span className="text-[9px] font-mono tabular-nums" style={{color:vSwing>=0?'#16a34a':'#ef4444',minWidth:40,textAlign:'right'}}>{vSwing>=0?'+':''}{vSwing.toFixed(1)}%</span>
                  <span className="text-[9px] font-mono tabular-nums" style={{color:sSwing>=0?'#16a34a':'#ef4444',minWidth:36,textAlign:'right'}}>{sSwing>=0?'+':''}{sSwing}s</span>
                </div>
              );
            })}
          </Section>
          <Section title="Vote → Seat Translation">
            {IT_LR_ORDER.filter(id=>(natPcts[id]??0)>=0.5).map(id=>{
              const vPct=totalV>0?(natPcts[id]??0)/totalV*100:0; const sPct=totalS>0?(seats[id]??0)/totalS*100:0; const diff=sPct-vPct; const color=partyColor(id);
              return (
                <div key={id} style={{background:cardBg,borderRadius:5,padding:'5px 8px'}}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9.5px] font-medium text-ink">{IT_PARTY_MAP[id].name}</span>
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
            {IT_PRESET_COALITIONS.map(coal=>{
              const cs=coal.parties.reduce((s,id)=>s+(seats[id as ItPartyId]??0),0); const ok=cs>=IT_MAJORITY;
              return (
                <div key={coal.name} style={{background:cardBg,borderRadius:5,padding:'6px 8px',display:'flex',alignItems:'center',gap:8}}>
                  <span>{coal.emoji}</span>
                  <div className="flex-1 min-w-0"><div className="text-[9.5px] font-bold text-ink truncate">{coal.name}</div><div className="text-[7.5px] font-mono" style={{color:ink3}}>{coal.parties.map(id=>IT_PARTY_MAP[id as ItPartyId]?.name).join('+')}</div></div>
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
function ItDistributionsPanel({ natPcts, provOverrides, seats, is2026, onClose, exiting, dark }: {
  natPcts: Record<ItPartyId,number>;
  provOverrides: Partial<Record<ItProvId, Partial<Record<ItPartyId, number>>>>;
  seats: Partial<Record<ItPartyId,number>>;
  is2026?: boolean;
  onClose:()=>void; exiting?:boolean; dark?:boolean;
}) {
  const ink2 = dark?'rgba(255,255,255,0.55)':'rgba(0,0,0,0.5)';
  const ink3 = dark?'rgba(255,255,255,0.38)':'rgba(0,0,0,0.4)';
  const cardBg = dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.025)';
  const trackBg = dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';

  // party display name honouring the 2026/2027 rebrand (Sumar → Un Paso al Frente)
  const dispName = (id:ItPartyId) => {
    const p = IT_PARTY_MAP[id];
    return is2026 && p.name2026 ? p.name2026 : p.name;
  };

  // National totals = the actual Rosatellum scoreboard seats (consistent with the
  // main board). Per-district rows show the local PR D'Hondt detail.
  const natTotals = seats;
  const totalSeats = (Object.values(seats) as number[]).reduce((a,b)=>a+(b??0),0);
  const rows = useMemo(() => {
    const perDist = distributePRtoDistricts(natPcts, prNationalTotals(natPcts, is2026), provOverrides);
    return IT_PROVINCES.map(prov => {
      const ps = perDist[prov.id] ?? {};
      const alloc = (Object.entries(ps) as [ItPartyId,number][]).filter(([,s]) => (s??0) > 0).sort((a,b) => b[1]-a[1]);
      const mag = alloc.reduce((s,[,n]) => s + n, 0);   // seats actually allocated here (reconciles to 245)
      return { prov, alloc, mag };
    });
  }, [natPcts, provOverrides, is2026]);

  const natSorted = (Object.entries(natTotals) as [ItPartyId,number][])
    .filter(([,s]) => s>0).sort((a,b) => b[1]-a[1]);

  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Seat Distribution</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Rosatellum · {totalSeats} seats · {IT_PROVINCES.length} PR districts</div>
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

      {/* By coalition / bloc */}
      {(() => {
        const GROUPS = ([
          {label:'Centre-right', color:IT_COAL_COLOR.CDX, ids:['FDI','LEGA','FI','NM']},
          {label:'Centre-left',  color:IT_COAL_COLOR.CSX, ids:is2026?['PD','AVS','PIU','IC','M5S']:['PD','AVS','PIU','IC']},
          ...(is2026?[]:[{label:'M5S', color:IT_COAL_COLOR.M5S, ids:['M5S']}]),
          ...(is2026
            ? [{label:'Azione', color:'#00A3C7', ids:['AZ']}, {label:'Italia Viva', color:'#E5147D', ids:['IV']}]
            : [{label:'Az–IV', color:'#00A3C7', ids:['AZ','IV']}]),
          {label:'Futuro Nazionale', color:'#C0703C',     ids:['FN']},
          {label:'Others',       color:IT_COAL_COLOR.OTH, ids:['SVP']},
        ] as {label:string;color:string;ids:ItPartyId[]}[]).map(g => ({ ...g, n: g.ids.reduce((s,id)=>s+(natTotals[id]??0),0) })).filter(g => g.n > 0).sort((a,b)=>b.n-a.n);
        const maj = Math.floor(totalSeats/2)+1;
        const lead = GROUPS[0];
        return (
          <div className="px-3.5 py-2.5 border-b border-default shrink-0">
            <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.14em] mb-1.5" style={{color:ink3}}>By coalition / bloc</div>
            <div className="flex w-full h-2.5 rounded-full overflow-hidden" style={{background:trackBg}}>
              {GROUPS.map(g => <div key={g.label} title={`${g.label} ${g.n}`} style={{width:`${g.n/Math.max(1,totalSeats)*100}%`,background:g.color}}/>)}
            </div>
            <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-1.5">
              {GROUPS.map(g => (
                <span key={g.label} className="inline-flex items-center gap-1 text-[9px] font-mono" style={{color:ink2}}>
                  <span className="w-1.5 h-1.5 rounded-sm" style={{background:g.color}}/>{g.label}<b className="text-ink">{g.n}</b>
                </span>
              ))}
            </div>
            {lead && <div className="text-[8.5px] font-mono mt-1" style={{color: lead.n>=maj?'#16a34a':ink3}}>{lead.label} leads · {lead.n>=maj?'majority':`${maj-lead.n} short of ${maj}`}</div>}
          </div>
        );
      })()}

      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-2">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.14em] mb-1" style={{color:ink3}}>Proportional seats by district · 245 total</div>
        {rows.map(({ prov, alloc, mag }) => (
          <div key={prov.id} style={{background:cardBg,borderRadius:5,padding:'6px 8px'}}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10.5px] font-semibold text-ink truncate">{prov.name}</span>
              <span className="text-[8.5px] font-mono shrink-0 ml-2" style={{color:ink3}}>{mag} {mag===1?'PR seat':'PR seats'}</span>
            </div>
            <div className="flex w-full h-2 rounded-full overflow-hidden" style={{background:trackBg}}>
              {alloc.map(([id,s]) => (
                <div key={id} title={`${dispName(id)} ${s}`} style={{width:`${s/(mag||1)*100}%`,background:partyColor(id)}}/>
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
function ItTutorialPanel({ onClose, exiting, dark }: { onClose:()=>void; exiting?:boolean; dark?:boolean }) {
  const H2=({c}:{c:string})=><div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-4 mb-1.5 first:mt-0">{c}</div>;
  const P=({c}:{c:string})=><p className="text-[11px] text-ink leading-relaxed mb-2">{c}</p>;
  const Note=({c}:{c:string})=><div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{c}</div>;
  return (
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div><h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Italian Rosatellum Election Guide</p></div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <P c="A crash course in the Italian election simulator — what the seats mean and how every control works. Read top to bottom and you will understand the whole thing."/>

        <H2 c="1 · The Rosatellum system"/>
        <P c="Italy's Chamber of Deputies has 400 seats, elected three ways at once: 147 single-member seats won by plurality (first-past-the-post), 245 proportional seats shared out among party lists, and 8 seats for Italians living abroad. This simulator models all three and they always add up to 400."/>

        <H2 c="2 · Single-member seats (147)"/>
        <P c="Each of 147 collegi is won outright by whichever COALITION gets the most votes there — winner takes the seat, no proportionality. The seat then goes to one PARTY: the coalition's strongest member in that region. So a centre-right win in the north goes to Lega, one in the south to Forza Italia, most others to Fratelli d'Italia. Open a collegio to see 'seat → party'."/>

        <H2 c="3 · Proportional seats (245) & the 3% threshold"/>
        <P c="The 245 list seats are shared nationally by largest-remainder (Hare quota), then spread across the 49 PR districts where each party is strongest. A party must clear 3% of the national vote to win any list seats; a junior partner only counts if its coalition clears 10%. Below 3% you get nothing."/>
        <Note c="The South Tyrolean SVP is a protected minority list: it is exempt from the 3% rule and takes its 2-3 seats in South Tyrol regardless."/>

        <H2 c="4 · Overseas seats (8)"/>
        <P c="The Circoscrizione Estero elects 8 deputies in four world zones — Europe (4), South America (2), North & Central America (1), Africa-Asia-Oceania (1). They are drawn as bubbles ON their continents and are always visible; zoom the map out to see them. Hover one for its zone result."/>

        <H2 c="5 · Coalitions"/>
        <P c="Centre-right (FdI · Lega · FI · Noi Moderati) and Centre-left (PD · AVS · +Europa · Impegno Civico). In the 2026 scenarios the Five Star Movement has joined the centre-left, so on those pages M5S votes count toward the CSX alliance. Azione, Italia Viva and the far-right Futuro Nazionale (Vannacci) run alone. In 2022 only, Azione+Italia Viva ran as one joint Az–IV list."/>

        <H2 c="6 · The three data pages (top-left)"/>
        <P c="2022 Baseline = the exact official 2022 result. 2026 Polling = current polling, with M5S in the centre-left. Blank Map = an empty canvas you fill in yourself. The ↻ Refresh button reloads whichever page you are on, throwing away every edit."/>

        <H2 c="7 · Three map geographies (View toggle)"/>
        <P c="See the same election as Single-member collegi (147), PR districts (49), or Regions (20). Switch with the View buttons in the header."/>

        <H2 c="8 · Three ways to draw the map"/>
        <P c="Choropleth shades each area by its winner, darker = bigger margin. Bubble Map draws a circle sized by the raw vote margin (in single-member view the choropleth hides so you see only bubbles). Seat Dots plots one dot per seat. Hover anything for a tooltip with % and raw votes; click to open it."/>

        <H2 c="9 · Editing a result"/>
        <P c="Click any district to open its sliders. On the 2022/2026 pages, change a single-member winner and the dashboard moves just that one seat — it never jumps. Open the 'last result' reference inside a district panel to compare to the baseline."/>

        <H2 c="10 · Blank Map mode"/>
        <P c="Start from nothing: click a district, set party shares and a % reporting, then Project Result. Until a district is projected it reads 'No results yet' on hover, and the national scoreboard only counts districts you have projected — results accumulate district by district."/>

        <H2 c="11 · Simulation"/>
        <P c="Clicking Simulation drops you onto the Blank Map. Type each party's national % freely — nothing auto-adjusts — but the inputs must add up to 100% before Run unlocks (the total is shown live). Regional parties are capped at their home area's share. Pick a length (1-10 min) and Run: the 49 districts report in 5 random batches each on a bell-curve, filling the map live — hover to watch the count climb."/>

        <H2 c="12 · Parliament view"/>
        <P c="A 400-seat hemicycle sorted left→right by ideology. Toggle By party (one colour per party) or By coalition (centre-left red, centre-right blue, everyone else their own colour) with the buttons at the top of the panel. The dashed line marks the 201-seat majority."/>

        <H2 c="13 · The other panels"/>
        <P c="Breakdown = nerdy stats (effective number of parties, Gallagher disproportionality, swing vs 2022). Distributions = national totals plus the per-district proportional allocation and a by-coalition bar. Coalition = build your own alliance and test its majority. Parties = hide/show any party."/>

        <H2 c="14 · Regional parties"/>
        <P c="A regional list (SVP) is landlocked: it only appears on the sliders of its home district, can never score elsewhere, and its national input is capped at its region's share of the country."/>
      </div>
    </aside>
  );
}

// ── Reporting widget ──────────────────────────────────────────────────────────
function ItReportingWidget({ projectedProvs,provReportingPct,simProvFractions,isSim,dark }:{
  projectedProvs:Set<ItProvId>; provReportingPct:Partial<Record<ItProvId,number>>;
  simProvFractions:Partial<Record<ItProvId,number>>; isSim:boolean; dark?:boolean;
}) {
  const bg=dark?'rgba(7,13,28,0.90)':'rgba(255,255,255,0.94)';
  const border=dark?'rgba(255,255,255,0.09)':'rgba(0,0,0,0.09)';
  const ink2=dark?'rgba(255,255,255,0.45)':'rgba(0,0,0,0.42)';

  let reportedW=0, projCount=0;
  if(isSim){
    for(const [cId,frac] of Object.entries(simProvFractions) as [ItProvId,number][]) {
      reportedW+=(IT_PROVINCE_MAP[cId]?.weight??0)*(frac??0); if((frac??0)>0) projCount++;
    }
  } else {
    for(const cId of projectedProvs) {
      const rPct=(provReportingPct[cId]??100)/100;
      reportedW+=(IT_PROVINCE_MAP[cId]?.weight??0)*rPct; projCount++;
    }
  }
  const reportedPct=Math.min(100,(reportedW/IT_TOTAL_PROV_WEIGHT)*100);
  return (
    <div className="absolute bottom-8 left-3 z-[1001] pointer-events-none"
      style={{background:bg,border:`1px solid ${border}`,borderRadius:10,backdropFilter:'blur(10px)',padding:'10px 13px',minWidth:170,boxShadow:'0 4px 20px rgba(0,0,0,0.18)'}}>
      <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.15em] mb-1.5" style={{color:ink2}}>{isSim?'⚡ Live Count':'📊 Results'}</div>
      <div className="text-[13px] font-black font-mono text-ink leading-none">{projCount} <span className="text-[10px] font-semibold" style={{color:ink2}}>/ {IT_PROVINCES.length}</span></div>
      <div className="text-[9px] font-mono mt-0.5 mb-2" style={{color:ink2}}>{isSim?'districts declared':'districts projected'}</div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.08)'}}>
        <div className="h-full rounded-full transition-all duration-500" style={{width:`${reportedPct}%`,background:isSim?'#3b82f6':'#16a34a'}}/>
      </div>
      <div className="text-[9px] font-mono font-bold mt-1 text-right" style={{color:isSim?'#3b82f6':'#16a34a'}}>{reportedPct.toFixed(1)}% of votes</div>
    </div>
  );
}

// ── FPTP (single-member collegio) editor — coalition sliders ──────────────────
type ItColl = { id: string; name: string; shares: Record<string, number>; votes: number; coal: string };
const IT_REG_LABEL: Record<string, string> = { AUT:'Aosta Valley list', SVP:'SVP (South Tyrol)', SCN:'Sud chiama Nord' };
function ItFptpPanel({ coll, natPcts, override, onApply, onReset, onClose, dark, is2026 }: {
  coll: ItColl; natPcts: Record<ItPartyId,number>; override?: Record<string,number>;
  onApply: (shares: Record<string,number>) => void; onReset: () => void; onClose: () => void; dark: boolean; is2026?: boolean;
}) {
  // In 2026 the centre-left absorbs M5S, so the single-member view drops the M5S bucket.
  const SLIDERS: readonly string[] = is2026 ? ['CDX','CSX','AZIV','OTH'] : IT_COAL_SLIDERS;
  // baseline shares swung by the current national coalition vote (M5S folded into CSX in 2026)
  const swung = useMemo(() => {
    const keys = is2026 ? ['CDX','CSX','AZIV','OTH'] : ['CDX','CSX','M5S','AZIV','OTH'];
    const out: Record<string,number> = {};
    for (const c of IT_COAL_SLIDERS) {
      const base = coll.shares[c] ?? 0;
      const m = IT_UNI_COAL_DEF[c];
      let f = 1; if (m) { const now=m.reduce((s,id)=>s+(natPcts[id]??0),0); const then=m.reduce((s,id)=>s+(IT_VOTE_PCT_2022[id]??0),0); f=then>0?now/then:1; }
      out[c] = Math.max(0, base*f);
    }
    if (is2026) { out.CSX = (out.CSX??0) + (out.M5S??0); out.M5S = 0; }
    const tot = keys.reduce((s,c)=>s+(out[c]??0),0);
    const res: Record<string,number> = {};
    for (const c of keys) res[c] = tot>0 ? out[c]/tot*100 : 0;
    return res;
  }, [coll, natPcts, is2026]);
  const [draft, setDraft] = useState<Record<string,number>>(() => override ? { ...override } : { ...swung });
  const [touched, setTouched] = useState(false);
  useEffect(() => { setDraft(override ? { ...override } : { ...swung }); setTouched(false); }, [coll.id, override, swung]);
  const winner = SLIDERS.reduce((b,c)=>(draft[c]??0)>(draft[b]??0)?c:b, 'CDX');
  const setSlider = (c: string, v: number) => {
    const others = SLIDERS.filter(x=>x!==c); const oldOther = others.reduce((s,x)=>s+(draft[x]??0),0);
    const room = 100 - v; const next: Record<string,number> = { [c]: Math.max(0,Math.min(100,v)) };
    others.forEach(x => next[x] = oldOther>0 ? (draft[x]??0)/oldOther*room : room/others.length);
    setDraft(next); setTouched(true);
  };
  return (
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-bold text-ink leading-tight truncate">{coll.name}</h2>
          <div className="text-[8.5px] font-mono text-ink-3 uppercase tracking-wide mt-0.5">Single-member collegio · FPTP</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
      </div>
      {(() => {
        const reg = !override && IT_REG_LABEL[coll.coal];   // regional-list winner (Aosta / SVP / SCN)
        const wColor = reg ? (IT_COAL_COLOR[coll.coal]||'#999') : (IT_COAL_COLOR[winner]||'#999');
        const wLabel = reg ? IT_REG_LABEL[coll.coal] : (IT_COAL_LABEL[winner]||winner);
        const rep = !reg && (winner==='CDX'||winner==='CSX'||winner==='AZIV') ? collegioRep(itCirco(coll.name), winner, natPcts, is2026) : null;
        return (
          <div className="px-3.5 py-2 border-b border-default text-center" style={{ background: hexToRgba(wColor, 0.12) }}>
            <div className="text-[8px] font-mono uppercase tracking-[0.15em] text-ink-3">Seat won by</div>
            <div className="text-[13px] font-black" style={{ color: wColor }}>{wLabel}</div>
            {rep && <div className="text-[9px] font-mono mt-0.5" style={{ color: partyColor(rep) }}>seat → {IT_PARTY_MAP[rep]?.name ?? rep}</div>}
          </div>
        );
      })()}
      <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3 space-y-3">
        {SLIDERS.map(c => {
          const v = draft[c] ?? 0; const col = IT_COAL_COLOR[c] || '#999';
          const label = c==='CSX' && is2026 ? 'Centre-left + M5S' : IT_COAL_LABEL[c];
          return (
            <div key={c}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} />
                <span className="text-[10px] text-ink flex-1 truncate">{label}</span>
                <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color: col }}>{v.toFixed(1)}%</span>
              </div>
              <input type="range" min={0} max={100} step={0.1} value={v}
                onChange={e => setSlider(c, parseFloat(e.target.value))}
                className="br-party-slider w-full" style={{ '--party-color': col, '--pct': `${v}%` } as React.CSSProperties} />
              <div className="text-right text-[8px] font-mono text-ink-3 mt-0.5">{Math.round((v/100)*coll.votes).toLocaleString()} votes</div>
            </div>
          );
        })}
      </div>
      <div className="px-3.5 py-3 border-t border-default shrink-0 space-y-1.5">
        <button onClick={()=>onApply(draft)} disabled={!touched && !override}
          className={`w-full h-8 rounded-[4px] text-[11px] font-mono font-semibold uppercase tracking-wide transition-colors ${(!touched&&!override)?'border border-default text-ink-3 opacity-50 cursor-not-allowed':'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
          {override ? '↻ Update seat' : '📍 Set seat winner'}
        </button>
        {override && <button onClick={onReset} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover">Reset to actual</button>}
      </div>
    </aside>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────
export default function ItalyApp() {
  const navigate = useNavigate();
  const [dark,setDark] = useState(()=>localStorage.getItem('darkMode')!=='false');
  useEffect(()=>{ document.documentElement.classList.toggle('dark',dark); localStorage.setItem('darkMode',String(dark)); },[dark]);

  // ── Preset / national pcts ────────────────────────────────────────────────
  const [preset,setPreset]   = useState<'baseline'|'blank'|'polling2026'|'custom'>('polling2026');
  const is2026 = preset !== 'baseline';   // 2026 alignment: M5S sits in the centre-left, FN stands alone
  const [natPcts,setNatPcts] = useState<Record<ItPartyId,number>>(()=>({...IT_VOTE_PCT_2026}));

  function loadBaseline()    { setNatPcts({...IT_VOTE_PCT_2022}); setPreset('baseline'); resetMapState(); }
  function loadPolling2026() { setNatPcts({...IT_VOTE_PCT_2026}); setPreset('polling2026'); resetMapState(); }
  function loadBlank()       { setNatPcts(Object.fromEntries(IT_PARTIES.map(p=>[p.id,100/IT_PARTIES.length])) as Record<ItPartyId,number>); setPreset('blank'); resetMapState(); }
  // Reload whichever preset is active — resets every edit back to that page's originals.
  function refreshPreset()   { if(preset==='polling2026') loadPolling2026(); else if(preset==='blank') loadBlank(); else loadBaseline(); }

  function resetMapState() {
    setSimSeats(undefined); setDeclaredProvs(undefined);
    setProvOverrides({}); setProjectedProvs(new Set());
    setProvReportingPct({}); setSimProvFractions({});
    setProvDraft(null); setSimNatPcts(null); stopSim();
    setFptpOverrides({}); setSelectedUni(null); setSelectedProv(null);
  }

  // ── Province overrides (blank map) ────────────────────────────────────────
  const [provOverrides,setProvOverrides]       = useState<Partial<Record<ItProvId,Partial<Record<ItPartyId,number>>>>>({});
  const [projectedProvs,setProjectedProvs]     = useState<Set<ItProvId>>(new Set());
  const [provReportingPct,setProvReportingPct] = useState<Partial<Record<ItProvId,number>>>({});
  const [provDraft,setProvDraft]               = useState<ItProvDraft|null>(null);

  const blankDisplayPcts = useMemo<Record<ItPartyId,number>>(()=>{
    const zero=Object.fromEntries(IT_PARTIES.map(p=>[p.id,0])) as Record<ItPartyId,number>;
    if(preset!=='blank') return zero;
    const weighted: Partial<Record<ItPartyId,number>>={};
    let totalW=0;
    for(const cId of projectedProvs) {
      const cv=calcProvVotes(natPcts,cId,provOverrides[cId]);
      const rPct=(provReportingPct[cId]??100)/100;
      const w=(IT_PROVINCE_MAP[cId]?.weight??0)*rPct;
      for(const p of IT_PARTIES) weighted[p.id]=(weighted[p.id]??0)+(cv[p.id]??0)*w;
      totalW+=w;
    }
    if(totalW===0) return zero;
    return Object.fromEntries(IT_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW])) as Record<ItPartyId,number>;
  },[preset,projectedProvs,provOverrides,provReportingPct,natPcts]);

  const blankVoteScale=useMemo(()=>{
    if(preset!=='blank') return 1;
    const projW=[...projectedProvs].reduce((s,cId)=>s+(IT_PROVINCE_MAP[cId]?.weight??0)*((provReportingPct[cId]??100)/100),0);
    return Math.min(1,projW/IT_TOTAL_PROV_WEIGHT);
  },[preset,projectedProvs,provReportingPct]);

  // Blank map: which provinces have been projected (reported), with their % reporting.
  const blankProvFractions=useMemo<Partial<Record<ItProvId,number>>>(()=>{
    if(preset!=='blank') return {};
    const f:Partial<Record<ItProvId,number>>={};
    for(const cId of projectedProvs) f[cId]=(provReportingPct[cId]??100)/100;
    return f;
  },[preset,projectedProvs,provReportingPct]);

  // Seats accrue province-by-province from 0 as each is projected — ONLY reported
  // provinces contribute (real Spanish per-constituency D'Hondt), never a national
  // extrapolation across all 52 provinces.
  const blankSeats=useMemo<Partial<Record<ItPartyId,number>>|undefined>(()=>
    preset==='blank'?calcPartialSeats(natPcts,blankProvFractions,provOverrides,is2026):undefined,
  [preset,natPcts,blankProvFractions,provOverrides,is2026]);

  const overrideDisplayPcts=useMemo<Record<ItPartyId,number>>(()=>{
    const hasAny=Object.values(provOverrides).some(o=>o&&Object.keys(o).length>0);
    if(!hasAny) return natPcts;
    const weighted:Partial<Record<ItPartyId,number>>={};
    let totalW=0;
    for(const prov of IT_PROVINCES) {
      const cv=calcProvVotes(natPcts,prov.id,provOverrides[prov.id]);
      const w=prov.weight;
      for(const p of IT_PARTIES) weighted[p.id]=(weighted[p.id]??0)+(cv[p.id]??0)*w;
      totalW+=w;
    }
    if(totalW===0) return natPcts;
    return Object.fromEntries(IT_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW])) as Record<ItPartyId,number>;
  },[natPcts,provOverrides]);

  const displayPcts=preset==='blank'?blankDisplayPcts:overrideDisplayPcts;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selectedProv,setSelectedProv]         = useState<ItProvId|null>(null);
  const [bubbleMap,setBubbleMap]               = useState(false);
  const [seatDots,setSeatDots]                 = useState(false);
  const [mapView,setMapView]                   = useState<ItMapViewId>('uni');
  // ── FPTP single-member editing (uninominali view) ──
  const [uniColl,setUniColl]                   = useState<Record<string,ItColl>>({});
  const [fptpOverrides,setFptpOverrides]       = useState<Record<string,Record<string,number>>>({});
  const [selectedUni,setSelectedUni]           = useState<string|null>(null);
  useEffect(()=>{ fetch(`${import.meta.env.BASE_URL}italy-uninominali.geojson`).then(r=>r.json()).then((fc:GeoJSON.FeatureCollection)=>{
    const m:Record<string,ItColl>={}; for(const f of fc.features){ const pr=f.properties as Record<string,unknown>; if(pr.id) m[pr.id as string]={id:pr.id as string,name:String(pr.den||pr.id),shares:(pr.shares as Record<string,number>)||{CDX:0,CSX:0,M5S:0,AZ:0,IV:0,OTH:0},votes:(pr.votes as number)||0,coal:(pr.coal as string)||'NONE'}; }
    setUniColl(m);
  }).catch(console.error); },[]);
  const [scoreboardVisible,setScoreboardVisible] = useState(true);
  const [hiddenParties,setHiddenParties]       = useState<Set<ItPartyId>>(new Set());

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
  const [simDraftPcts,   setSimDraftPcts]   = useState<Record<ItPartyId,number>>(()=>({...IT_VOTE_PCT_2026}));
  const [simDraftLocks,  setSimDraftLocks]  = useState<Set<ItPartyId>>(new Set());
  const [simDraftStr,    setSimDraftStr]    = useState<Record<string,string>>({});   // raw text per box (free typing, no rounding)
  const [,setSimDraftTouched]               = useState(false);
  const [simDuration,    setSimDuration]    = useState<60000|120000|300000|600000>(120000);
  const [simNatPcts,     setSimNatPcts]     = useState<Record<ItPartyId,number>|null>(null);
  const [simSeats,       setSimSeats]       = useState<Partial<Record<ItPartyId,number>>|undefined>();
  const [simProgress,    setSimProgress]    = useState(0);
  const [simRunning,     setSimRunning]     = useState(false);
  const [declaredProvs,  setDeclaredProvs]  = useState<Set<ItProvId>|undefined>();
  const [simProvFractions,setSimProvFractions] = useState<Partial<Record<ItProvId,number>>>({});
  const simTimersRef  = useRef<ReturnType<typeof setTimeout>[]>([]);
  const simNatPctsRef = useRef<Record<ItPartyId,number>>(natPcts);

  useEffect(()=>{ if(rightPanel==='sim'){
    // seed = the 2026 poll normalised to a clean set of 0.1 values summing to EXACTLY 100
    const t=IT_PARTIES.reduce((s,p)=>s+(IT_VOTE_PCT_2026[p.id]??0),0);
    const num={} as Record<ItPartyId,number>; let sum=0,maxId:ItPartyId=IT_PARTIES[0].id,maxV=-1;
    for(const p of IT_PARTIES){ const v=t>0?Math.round((IT_VOTE_PCT_2026[p.id]??0)/t*1000)/10:0; num[p.id]=v; sum+=v; if(v>maxV){maxV=v;maxId=p.id;} }
    num[maxId]=+(num[maxId]+(100-sum)).toFixed(1);   // largest party absorbs the rounding residual
    const str={} as Record<string,string>; for(const p of IT_PARTIES) str[p.id]=String(num[p.id]);
    setSimDraftPcts(num); setSimDraftStr(str); setSimDraftTouched(false);
  } },[rightPanel==='sim']); // eslint-disable-line

  const simTotal=useMemo(()=>IT_PARTIES.reduce((s,p)=>s+(simDraftPcts[p.id]??0),0),[simDraftPcts]);
  const [simSortOrder]=useState<ItPartyId[]>(()=>IT_LR_ORDER.slice());

  function stopSim(){ simTimersRef.current.forEach(clearTimeout); simTimersRef.current=[]; setSimRunning(false); }

  function runSim() {
    stopSim(); setSimDraftTouched(false);
    simNatPctsRef.current={...simDraftPcts}; setSimNatPcts({...simDraftPcts});
    const PARTS=5; const totalProvs=IT_PROVINCES.length;
    const allTimes=itBellCurveTimes(PARTS*totalProvs,simDuration);
    const provIds=[...IT_PROVINCES.map(p=>p.id)].sort(()=>Math.random()-0.5);
    const events:{pId:ItProvId;cumFrac:number;t:number}[]=[];
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
    const localFrac:Partial<Record<ItProvId,number>>={};
    const localDecl=new Set<ItProvId>();
    const timers:ReturnType<typeof setTimeout>[]=[];
    for(const ev of events){
      timers.push(setTimeout(()=>{
        localFrac[ev.pId]=ev.cumFrac;
        if(ev.cumFrac>=0.999) localDecl.add(ev.pId);
        const fracSnap={...localFrac}; const declSnap=new Set(localDecl);
        setSimProvFractions(fracSnap); setDeclaredProvs(declSnap);
        setSimProgress(Object.keys(fracSnap).length);
        setSimSeats(calcPartialSeats(simNatPctsRef.current,fracSnap,undefined,is2026));
        if(Object.values(fracSnap).every(f=>(f??0)>=0.999)&&Object.keys(fracSnap).length>=totalProvs){
          setSimSeats(calcAllProvinceSeats(simNatPctsRef.current,undefined,is2026)); setSimRunning(false);
        }
      },ev.t));
    }
    simTimersRef.current=timers;
  }

  // FPTP coalition seat counts from the 147 collegi (baseline swung by the vote, edited per-collegio)
  const fptpCounts=useMemo<Record<string,number>|undefined>(()=>{
    const colls=Object.values(uniColl); if(colls.length<140) return undefined; // not loaded yet → national-model fallback
    // 1. winning coalition per collegio (grouped, with each collegio's circoscrizione)
    const byCoal:Record<string,{circo:string}[]>={};
    for(const c of colls){
      // PRISTINE winners only — single-member edits are applied as deltas in
      // displaySeats, so one edit moves ~1 seat instead of re-rounding the whole split.
      const coal=uniWinner(c.shares,displayPcts,is2026);
      (byCoal[coal]??=[]).push({circo:itCirco(c.name)});
    }
    // 2. split each coalition's seats among its members — totals proportional to the
    //    members' vote, each member's seats placed in its strongest regions (so Lega
    //    takes the northern CDX wins, FI the southern, FdI the rest).
    const counts:Record<string,number>={};
    for(const [coal,list] of Object.entries(byCoal)){
      const all=coalMembers(coal,is2026);
      const members=all.filter(id=>(displayPcts[id]??0)>0.3);
      if(!members.length){ counts[all[0]]=(counts[all[0]]||0)+list.length; continue; }
      const w:Record<string,number>={}; members.forEach(id=>w[id]=displayPcts[id]??0);
      const target=hareLR(w,list.length);                       // collegi per member (∝ vote)
      const pool=list.map(x=>({circo:x.circo,taken:false}));
      // regional specialists (smaller parties) claim their strongholds first; the
      // dominant member mops up the remainder
      const order=members.slice().sort((a,b)=>(displayPcts[a]??0)-(displayPcts[b]??0));
      for(const id of order){
        const need=target[id]??0; if(need<=0) continue;
        const ranked=pool.filter(p=>!p.taken).sort((a,b)=>IT_CIRCO_RATIO(b.circo,id)-IT_CIRCO_RATIO(a.circo,id));
        for(let k=0;k<need&&k<ranked.length;k++){ ranked[k].taken=true; counts[id]=(counts[id]||0)+1; }
      }
      const left=pool.filter(p=>!p.taken).length;
      if(left>0){ const dom=members.reduce((b,id)=>(displayPcts[id]??0)>(displayPcts[b]??0)?id:b,members[0]); counts[dom]=(counts[dom]||0)+left; }
    }
    return counts;
  },[uniColl,displayPcts,is2026]);
  const displaySeats=useMemo(()=>{
    if(simSeats) return simSeats;
    if(blankSeats) return blankSeats;
    // Anchor = this page's PRISTINE seats (2022 = exact official; 2026/custom = the
    // engine with un-edited collegi). Editing a single-member district then just moves
    // ~1 seat from its old representative to its new one, so the dashboard stays
    // CONTINUOUS instead of the totals jumping when the first district is changed.
    const out:Partial<Record<ItPartyId,number>> = preset==='baseline'
      ? {...IT_SEATS_2022}
      : {...calcAllProvinceSeats(displayPcts,fptpCounts,is2026,provOverrides)};
    for(const c of Object.values(uniColl)){
      const ov=fptpOverrides[c.id]; if(!ov) continue;
      const baseCoal=uniWinner(c.shares,displayPcts,is2026);
      const editCoal=uniCoalShares(ov,is2026)[0]?.c??baseCoal;
      if(baseCoal===editCoal) continue;
      const circo=itCirco(c.name);
      const dec=collegioRep(circo,baseCoal,displayPcts,is2026);
      const inc=collegioRep(circo,editCoal,displayPcts,is2026);
      out[dec]=(out[dec]??0)-1;
      out[inc]=(out[inc]??0)+1;
    }
    return out;
  },[preset,simSeats,blankSeats,displayPcts,fptpCounts,is2026,fptpOverrides,provOverrides,uniColl]);

  const simPartialPcts=useMemo<Record<ItPartyId,number>|null>(()=>{
    if(!simNatPcts) return null;
    const entries=Object.entries(simProvFractions) as [ItProvId,number][];
    if(entries.length===0) return null;
    const weighted:Partial<Record<ItPartyId,number>>={};
    let totalW=0;
    for(const [pId,frac] of entries){
      if(!frac) continue;
      const w=(IT_PROVINCE_MAP[pId]?.weight??0)*frac;
      const cv=calcProvVotes(simNatPcts,pId);
      for(const p of IT_PARTIES) weighted[p.id]=(weighted[p.id]??0)+(cv[p.id]??0)*w;
      totalW+=w;
    }
    if(totalW===0) return null;
    return Object.fromEntries(IT_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW])) as Record<ItPartyId,number>;
  },[simNatPcts,simProvFractions]);

  const simVoteScale=useMemo(()=>{
    if(!simNatPcts) return undefined;
    const reportedW=(Object.entries(simProvFractions) as [ItProvId,number][])
      .reduce((s,[pId,frac])=>s+(IT_PROVINCE_MAP[pId]?.weight??0)*(frac??0),0);
    return Math.min(1,reportedW/IT_TOTAL_PROV_WEIGHT);
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
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="it">
      {/* ── Header ── */}
      <header className={`h-[52px] ${dark?'bg-[rgba(7,13,28,0.94)]':'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={()=>navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4"><GlobeLogo/></button>
        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <img src={`${import.meta.env.BASE_URL}italy-flag.png`} alt="Italy" className="h-4 rounded-[2px] shrink-0 opacity-90"/>
          <span className="text-[11px] font-bold text-ink shrink-0 hidden sm:block">Italy</span>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={loadBaseline}    className={preset==='baseline'   ?btnGold:btnMuted}>2022 Baseline</button>
          <button onClick={loadPolling2026} className={preset==='polling2026'?btnGold:btnMuted}>2026 Polling</button>
          <button onClick={loadBlank}       className={preset==='blank'      ?btnGold:btnMuted}>Blank Map</button>
          <button onClick={refreshPreset} title="Reset this page to its original values" className={btnMuted}>↻ Refresh</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={()=>{if(preset!=='blank')loadBlank();openRight('sim');}}       className={rightPanel==='sim'      ?btnActive:btnMuted}>▶ Simulation</button>
          <button onClick={()=>!simRunning&&openLeft('parties')} disabled={simRunning} className={`${leftPanel==='parties'?btnActive:btnMuted}${simRunning?' opacity-40 cursor-not-allowed':''}`}>Parties</button>
          <button onClick={()=>setScoreboardVisible(v=>!v)} className={scoreboardVisible?btnActive:btnMuted}>Scoreboard</button>
          <button onClick={()=>openLeft('breakdown')}  className={leftPanel==='breakdown' ?btnActive:btnMuted}>Breakdown</button>
          <button onClick={()=>openRight('distributions')} className={rightPanel==='distributions'?btnActive:btnMuted}>Distributions</button>
          <button onClick={()=>openRight('coalition')} className={rightPanel==='coalition'?btnActive:btnMuted}>Coalition</button>
          <button onClick={()=>openLeft('parli')}      className={leftPanel==='parli'     ?btnActive:btnMuted}>Parliament</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <span className="text-[8px] font-mono uppercase tracking-wider text-ink-3 shrink-0 hidden md:block">View</span>
          {IT_MAP_VIEWS.map(v=>(
            <button key={v.id} onClick={()=>{ setMapView(v.id); if(v.id!=='pluri'){setSelectedProv(null);setSeatDots(false);} if(v.id!=='uni')setSelectedUni(null); }}
              className={mapView===v.id?`${btnBase} bg-[#7C3AED] text-white`:btnMuted}>{v.label}</button>
          ))}
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={()=>{setBubbleMap(v=>!v);setSeatDots(false);}}    className={bubbleMap?`${btnBase} bg-emerald-600 text-white hover:bg-emerald-700`:btnMuted}>Bubble Map</button>
          <button onClick={()=>{if(mapView!=='pluri')setMapView('pluri');setSeatDots(v=>!v);setBubbleMap(false);}}    className={seatDots?`${btnBase} bg-emerald-600 text-white hover:bg-emerald-700`:btnMuted}>Seat Dots</button>
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
        <ItScoreboard
          natPcts={simPartialPcts??(simNatPcts??displayPcts)}
          simSeats={displaySeats}
          isBaseline={preset==='baseline'&&!simNatPcts}
          is2026={preset!=='baseline'||!!simNatPcts}
          dark={dark}
          reportedVoteScale={simNatPcts!=null?simVoteScale:(preset==='blank'?blankVoteScale:undefined)}
        />
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {leftPanel==='parties'&&<ItPartiesPanel hiddenParties={hiddenParties} onToggle={id=>setHiddenParties(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;})} onClose={()=>openLeft('parties')} dark={dark}/>}
        {showParli    &&<ItParliamentPanel seats={displaySeats} onClose={()=>openLeft('parli')}    exiting={exitLeft==='parli'}    dark={dark} is2026={is2026}/>}
        {showBreakdown&&<ItBreakdownPanel  seats={displaySeats} natPcts={displayPcts} isBaseline={preset==='baseline'} onClose={()=>openLeft('breakdown')} exiting={exitLeft==='breakdown'} dark={dark}/>}

        {/* MAP */}
        <div className="relative flex-1 min-w-0 min-h-0">
          <ItMapView
            natPcts={natPcts} selectedProv={selectedProv} mapView={mapView}
            onSelect={p=>setSelectedProv(prev=>prev===p?null:p)}
            onSelectUni={geoId=>setSelectedUni(prev=>prev===geoId?null:geoId)}
            selectedUni={selectedUni} fptpOverrides={fptpOverrides}
            dark={dark} bubbleMap={bubbleMap} seatDots={seatDots}
            declaredProvs={declaredProvs} provOverrides={provOverrides}
            blankMode={preset==='blank'} projectedProvs={projectedProvs}
            simProvFractions={simProvFractions}
            provDraft={preset==='blank'?provDraft:null}
            simNatPcts={simNatPcts} is2026={is2026}
          />
          {(preset==='blank'||simRunning||simSeats!=null)&&(
            <ItReportingWidget
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
              <div><h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Type each party national % · then run</p></div>
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
                const party=IT_PARTY_MAP[id]; const pct=simDraftPcts[id]??0; const isLocked=simDraftLocks.has(id); const color=partyColor(id);
                const rawVotes=Math.round(pct/100*IT_GRAND_TOTAL_VOTES);
                return (
                  <div key={id} className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:color}}/>
                    <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{party.fullName}</span>
                    <span className="text-[8px] font-mono shrink-0" style={{color:pct>=3?'#16a34a':'#f59e0b'}}>{pct>=3?'✓':'⚠'}</span>
                    <span className="text-[8px] font-mono shrink-0 hidden sm:inline" style={{color:dark?'rgba(255,255,255,0.30)':'rgba(0,0,0,0.32)'}}>{fmtN(rawVotes)}</span>
                    <button onClick={()=>setSimDraftLocks(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;})}
                      className={`w-4 h-4 flex items-center justify-center shrink-0 ${isLocked?'text-gold':'text-ink-3 hover:text-ink'}`} title={isLocked?'Unlock':'Lock'}>
                      {isLocked?<svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>:<svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>}
                    </button>
                    <input type="number" min={0} max={IT_REGIONAL_CAP[id]} step="any" value={simDraftStr[id]??''} disabled={isLocked}
                      onChange={e=>{const cap=IT_REGIONAL_CAP[id]; let raw=e.target.value; let v=parseFloat(raw); if(cap!=null&&!isNaN(v)&&v>cap){v=cap;raw=String(cap);} setSimDraftStr(s=>({...s,[id]:raw})); setSimDraftPcts(prev=>({...prev,[id]:isNaN(v)?0:Math.max(0,v)})); setSimDraftTouched(true);}}
                      className="w-14 h-6 shrink-0 text-right text-[11px] font-mono font-bold tabular-nums rounded-[4px] border border-default bg-transparent px-1 disabled:opacity-40 focus:outline-none focus:border-blue-500"
                      style={{color}}/>
                    <span className="text-[9px] font-mono text-ink-3 shrink-0">%</span>
                  </div>
                );
              })}
            </div>
            <div className="px-3.5 pb-3.5 pt-2 border-t border-default shrink-0 space-y-2">
              {!simRunning&&(
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-ink-3">Total</span>
                  <span style={{color:Math.round(simTotal*10)===1000?'#16a34a':'#ef4444',fontWeight:700}}>{simTotal.toFixed(1)}%{Math.round(simTotal*10)===1000?' ✓':' · must equal exactly 100%'}</span>
                </div>
              )}
              <button disabled={simRunning||Math.round(simTotal*10)!==1000} onClick={runSim} title={Math.round(simTotal*10)!==1000?'Values must add up to exactly 100%':''}
                className="w-full h-8 rounded-[4px] bg-blue-600 text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {simRunning?`${simProgress}/${IT_PROVINCES.length} reporting…`:'▶ Run Simulation'}
              </button>
              {(simSeats||declaredProvs)&&(
                <button onClick={()=>{stopSim();setSimSeats(undefined);setDeclaredProvs(undefined);setSimProgress(0);setSimProvFractions({});setSimNatPcts(null);}}
                  className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">Reset</button>
              )}
            </div>
          </aside>
        )}

        {showProv&&selectedProv&&(
          <ItProvPanel key={selectedProv} provId={selectedProv} natPcts={natPcts}
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

        {mapView==='uni'&&selectedUni&&uniColl[selectedUni]&&(
          <ItFptpPanel key={selectedUni} coll={uniColl[selectedUni]} natPcts={simNatPcts??displayPcts}
            override={fptpOverrides[selectedUni]}
            onApply={shares=>setFptpOverrides(prev=>({...prev,[selectedUni]:shares}))}
            onReset={()=>{setFptpOverrides(prev=>{const n={...prev};delete n[selectedUni];return n;});}}
            onClose={()=>setSelectedUni(null)} dark={dark} is2026={is2026}/>
        )}

        {showDistrib  &&<ItDistributionsPanel natPcts={displayPcts} provOverrides={provOverrides} seats={displaySeats} is2026={preset!=='baseline'} onClose={()=>openRight('distributions')} exiting={exitRight==='distributions'} dark={dark}/>}
        {showTutorial &&<ItTutorialPanel  onClose={()=>openRight('tutorial')}  exiting={exitRight==='tutorial'}  dark={dark}/>}
        {showCoalition&&<ItCoalitionPanel seats={displaySeats} onClose={()=>openRight('coalition')} exiting={exitRight==='coalition'} dark={dark}/>}
      </div>
    </div>
  );
}
