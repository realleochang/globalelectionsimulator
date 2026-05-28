import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── Party types ───────────────────────────────────────────────────────────────
type PlPartyId = 'PIS' | 'KO' | 'TD' | 'LEWICA' | 'KONF';

type PlParty = {
  id:             PlPartyId;
  name:           string;
  fullName:       string;
  color:          string;
  seats2023:      number;
  leader:         string;
  wikiTitle?:     string;
  leader2026?:    string;
  wikiTitle2026?: string;
  // 5 = single-party threshold; 8 = coalition threshold
  threshold:      5 | 8;
};

// Ideology order left → right for parliament hemicycle
const PL_LR_ORDER: PlPartyId[] = ['LEWICA','KO','TD','KONF','PIS'];

const PL_PARTIES: PlParty[] = [
  { id:'PIS',    name:'PiS',      fullName:'Prawo i Sprawiedliwość',       color:'#003087', seats2023:194, threshold:5,
    leader:'Jarosław Kaczyński',          wikiTitle:'Jarosław_Kaczyński' },
  { id:'KO',     name:'KO',       fullName:'Koalicja Obywatelska',         color:'#F05A28', seats2023:157, threshold:8,
    leader:'Donald Tusk',                 wikiTitle:'Donald_Tusk' },
  { id:'TD',     name:'Trzecia Droga', fullName:'Trzecia Droga (PSL+PL2050)', color:'#2E7D32', seats2023:65,  threshold:8,
    leader:'Władysław Kosiniak-Kamysz',   wikiTitle:'Władysław_Kosiniak-Kamysz',
    leader2026:'Szymon Hołownia',         wikiTitle2026:'Szymon_Hołownia' },
  { id:'LEWICA', name:'Lewica',   fullName:'Lewica',                       color:'#C0392B', seats2023:26,  threshold:8,
    leader:'Włodzimierz Czarzasty',       wikiTitle:'Włodzimierz_Czarzasty' },
  { id:'KONF',   name:'Konfederacja', fullName:'Konfederacja WiN',         color:'#1B1464', seats2023:18,  threshold:5,
    leader:'Sławomir Mentzen',            wikiTitle:'Sławomir_Mentzen' },
];

const PL_PARTY_MAP = Object.fromEntries(PL_PARTIES.map(p=>[p.id,p])) as Record<PlPartyId,PlParty>;
const PL_TOTAL_SEATS = 460;
const PL_MAJORITY    = 231;

// 2023 official results — source: PKW (Państwowa Komisja Wyborcza), 15 Oct 2023
const PL_VOTE_PCT_2023: Record<PlPartyId, number> = {
  PIS: 35.38, KO: 30.70, TD: 14.40, LEWICA: 8.61, KONF: 7.16,
};
const PL_VOTE_RAW_2023: Record<PlPartyId, number> = {
  PIS: 7_640_854, KO: 6_629_402, TD: 3_110_670, LEWICA: 1_859_018, KONF: 1_547_364,
};
// Total valid party votes (others ~3.75% to minor parties)
const PL_GRAND_TOTAL_VOTES = 21_598_000;

// 2026 polling — KO governing, PiS holding, Konfederacja rising
const PL_VOTE_PCT_2026: Record<PlPartyId, number> = {
  PIS: 35.0, KO: 29.0, TD: 10.0, LEWICA: 8.0, KONF: 12.0,
};

// ── Constituency types ────────────────────────────────────────────────────────
type PlConstId =
  | 'C01' | 'C02' | 'C03' | 'C04' | 'C05' | 'C06' | 'C07' | 'C08' | 'C09' | 'C10'
  | 'C11' | 'C12' | 'C13' | 'C14' | 'C15' | 'C16' | 'C17' | 'C18' | 'C19' | 'C20'
  | 'C21' | 'C22' | 'C23' | 'C24' | 'C25' | 'C26' | 'C27' | 'C28' | 'C29' | 'C30'
  | 'C31' | 'C32' | 'C33' | 'C34' | 'C35' | 'C36' | 'C37' | 'C38' | 'C39' | 'C40'
  | 'C41';

type PlConst = {
  id:     PlConstId;
  nr:     number;      // official okręg number
  name:   string;      // main city/region
  seats:  number;      // deputies elected from this constituency (sum = 460)
  weight: number;      // % of national electorate (proportional to seats)
  // 2023 actual vote % per party in this constituency
  v2023:  Partial<Record<PlPartyId, number>>;
};

// GeoJSON feature property → constituency ID
// GADM Poland voivodeship → constituency approximation
const PL_GEOID_TO_ID: Record<string, PlConstId> = {
  // We map by constituency number string for the processed GeoJSON
  '1':'C01','2':'C02','3':'C03','4':'C04','5':'C05','6':'C06','7':'C07','8':'C08',
  '9':'C09','10':'C10','11':'C11','12':'C12','13':'C13','14':'C14','15':'C15',
  '16':'C16','17':'C17','18':'C18','19':'C19','20':'C20','21':'C21','22':'C22',
  '23':'C23','24':'C24','25':'C25','26':'C26','27':'C27','28':'C28','29':'C29',
  '30':'C30','31':'C31','32':'C32','33':'C33','34':'C34','35':'C35','36':'C36',
  '37':'C37','38':'C38','39':'C39','40':'C40','41':'C41',
};

// ── 41 constituencies — official seat counts + 2023 PKW vote data ─────────────
// Sources: PKW official results, Państwowa Komisja Wyborcza.
// Note: seat counts adjusted to sum to 460; vote %s from PKW constituency data.
const PL_CONSTITUENCIES: PlConst[] = [
  // Nr | Name          | Seats | Weight | PiS  | KO   | TD   | Lew  | Konf
  { id:'C01', nr: 1, name:'Legnica',              seats:11, weight:2.39,
    v2023:{PIS:34.80,KO:33.78,TD:10.75,LEWICA:9.51,KONF:6.33} },
  { id:'C02', nr: 2, name:'Wałbrzych',            seats:10, weight:2.17,
    v2023:{PIS:33.34,KO:37.17,TD:12.13,LEWICA:7.98,KONF:6.02} },
  { id:'C03', nr: 3, name:'Wrocław',              seats:13, weight:2.83,
    v2023:{PIS:26.66,KO:36.94,TD:13.74,LEWICA:11.35,KONF:6.98} },
  { id:'C04', nr: 4, name:'Bydgoszcz',            seats:12, weight:2.61,
    v2023:{PIS:30.45,KO:35.01,TD:15.06,LEWICA:9.92,KONF:6.42} },
  { id:'C05', nr: 5, name:'Toruń',                seats:13, weight:2.83,
    v2023:{PIS:34.06,KO:29.52,TD:15.68,LEWICA:11.25,KONF:6.37} },
  { id:'C06', nr: 6, name:'Lublin',               seats:15, weight:3.26,
    v2023:{PIS:45.48,KO:20.32,TD:15.87,LEWICA:5.72,KONF:8.38} },
  { id:'C07', nr: 7, name:'Chełm',               seats:11, weight:2.39,
    v2023:{PIS:50.75,KO:17.40,TD:13.04,LEWICA:5.62,KONF:7.79} },
  { id:'C08', nr: 8, name:'Zielona Góra',        seats:12, weight:2.61,
    v2023:{PIS:27.76,KO:37.73,TD:15.07,LEWICA:9.27,KONF:6.51} },
  { id:'C09', nr: 9, name:'Łódź',               seats:10, weight:2.17,
    v2023:{PIS:26.82,KO:41.07,TD:11.89,LEWICA:12.22,KONF:5.57} },
  { id:'C10', nr:10, name:'Piotrków Tryb.',      seats: 9, weight:1.96,
    v2023:{PIS:46.60,KO:21.69,TD:13.73,LEWICA:6.39,KONF:7.62} },
  { id:'C11', nr:11, name:'Sieradz',             seats:12, weight:2.61,
    v2023:{PIS:41.46,KO:25.89,TD:14.50,LEWICA:7.73,KONF:6.82} },
  { id:'C12', nr:12, name:'Kraków I',            seats: 8, weight:1.74,
    v2023:{PIS:42.86,KO:24.24,TD:14.97,LEWICA:6.04,KONF:7.88} },
  { id:'C13', nr:13, name:'Kraków II',           seats:14, weight:3.04,
    v2023:{PIS:30.68,KO:30.73,TD:16.86,LEWICA:11.04,KONF:7.71} },
  { id:'C14', nr:14, name:'Nowy Sącz',           seats:10, weight:2.17,
    v2023:{PIS:53.73,KO:16.10,TD:11.58,LEWICA:3.18,KONF:8.73} },
  { id:'C15', nr:15, name:'Tarnów',              seats: 9, weight:1.96,
    v2023:{PIS:48.67,KO:17.02,TD:18.64,LEWICA:4.00,KONF:7.99} },
  { id:'C16', nr:16, name:'Płock',               seats:12, weight:2.61,
    v2023:{PIS:44.11,KO:22.40,TD:17.07,LEWICA:6.52,KONF:6.52} },
  { id:'C17', nr:17, name:'Radom',               seats: 9, weight:1.96,
    v2023:{PIS:48.68,KO:20.96,TD:13.98,LEWICA:5.34,KONF:7.31} },
  { id:'C18', nr:18, name:'Siedlce',             seats:12, weight:2.61,
    v2023:{PIS:48.62,KO:18.71,TD:15.51,LEWICA:4.85,KONF:8.21} },
  { id:'C19', nr:19, name:'Warszawa I',          seats:20, weight:4.35,
    v2023:{PIS:20.14,KO:43.23,TD:13.25,LEWICA:13.45,KONF:6.24} },
  { id:'C20', nr:20, name:'Warszawa II',         seats:11, weight:2.39,
    v2023:{PIS:31.74,KO:35.23,TD:15.06,LEWICA:7.06,KONF:7.06} },
  { id:'C21', nr:21, name:'Opole',               seats:12, weight:2.61,
    v2023:{PIS:31.26,KO:33.59,TD:12.74,LEWICA:7.24,KONF:6.49} },
  { id:'C22', nr:22, name:'Krosno',              seats:11, weight:2.39,
    v2023:{PIS:54.70,KO:15.85,TD:13.79,LEWICA:4.47,KONF:8.62} },
  { id:'C23', nr:23, name:'Rzeszów',             seats:16, weight:3.48,
    v2023:{PIS:51.60,KO:17.70,TD:12.42,LEWICA:4.87,KONF:9.48} },
  { id:'C24', nr:24, name:'Białystok',           seats:14, weight:3.04,
    v2023:{PIS:42.39,KO:20.84,TD:18.86,LEWICA:4.84,KONF:9.79} },
  { id:'C25', nr:25, name:'Gdańsk',             seats:13, weight:2.83,
    v2023:{PIS:25.20,KO:41.70,TD:14.70,LEWICA:9.41,KONF:6.23} },
  { id:'C26', nr:26, name:'Słupsk',              seats:13, weight:2.83,
    v2023:{PIS:29.24,KO:37.91,TD:13.59,LEWICA:8.33,KONF:7.21} },
  { id:'C27', nr:27, name:'Bielsko-Biała',       seats: 9, weight:1.96,
    v2023:{PIS:36.71,KO:28.67,TD:14.55,LEWICA:7.77,KONF:7.84} },
  { id:'C28', nr:28, name:'Częstochowa',         seats: 7, weight:1.52,
    v2023:{PIS:36.35,KO:29.11,TD:14.72,LEWICA:9.41,KONF:6.56} },
  { id:'C29', nr:29, name:'Katowice I',          seats: 9, weight:1.96,
    v2023:{PIS:30.16,KO:36.06,TD:13.34,LEWICA:9.21,KONF:6.95} },
  { id:'C30', nr:30, name:'Bielsko-Biała II',    seats: 9, weight:1.96,
    v2023:{PIS:38.06,KO:29.98,TD:12.45,LEWICA:6.84,KONF:8.00} },
  { id:'C31', nr:31, name:'Katowice II',         seats:11, weight:2.39,
    v2023:{PIS:30.88,KO:36.79,TD:13.27,LEWICA:8.46,KONF:6.70} },
  { id:'C32', nr:32, name:'Katowice III',        seats: 9, weight:1.96,
    v2023:{PIS:29.74,KO:30.30,TD:9.85,LEWICA:21.60,KONF:5.69} },
  { id:'C33', nr:33, name:'Kielce',              seats:15, weight:3.26,
    v2023:{PIS:47.07,KO:20.93,TD:13.80,LEWICA:6.83,KONF:6.55} },
  { id:'C34', nr:34, name:'Elbląg',              seats: 8, weight:1.74,
    v2023:{PIS:35.20,KO:31.87,TD:15.40,LEWICA:8.11,KONF:6.54} },
  { id:'C35', nr:35, name:'Olsztyn',             seats:10, weight:2.17,
    v2023:{PIS:32.33,KO:33.07,TD:16.11,LEWICA:8.09,KONF:6.93} },
  { id:'C36', nr:36, name:'Kalisz',              seats:12, weight:2.61,
    v2023:{PIS:35.85,KO:28.85,TD:16.16,LEWICA:8.52,KONF:6.98} },
  { id:'C37', nr:37, name:'Konin',               seats:10, weight:2.17,
    v2023:{PIS:38.69,KO:23.99,TD:16.63,LEWICA:9.48,KONF:6.97} },
  { id:'C38', nr:38, name:'Piła',                seats: 9, weight:1.96,
    v2023:{PIS:29.11,KO:34.87,TD:17.66,LEWICA:7.84,KONF:6.87} },
  { id:'C39', nr:39, name:'Poznań',              seats:10, weight:2.17,
    v2023:{PIS:19.57,KO:44.09,TD:16.54,LEWICA:12.31,KONF:5.90} },
  { id:'C40', nr:40, name:'Koszalin',            seats: 8, weight:1.74,
    v2023:{PIS:31.36,KO:38.69,TD:12.35,LEWICA:8.72,KONF:6.02} },
  { id:'C41', nr:41, name:'Szczecin',            seats:12, weight:2.61,
    v2023:{PIS:28.79,KO:40.13,TD:12.62,LEWICA:9.39,KONF:5.94} },
];
// Verify: PL_CONSTITUENCIES.reduce((s,c)=>s+c.seats,0) === 460

const PL_CONST_MAP = Object.fromEntries(PL_CONSTITUENCIES.map(c=>[c.id,c])) as Record<PlConstId,PlConst>;
const PL_TOTAL_CONST_WEIGHT = PL_CONSTITUENCIES.reduce((s,c)=>s+c.weight,0);

// ── D'Hondt per constituency with dual national threshold ─────────────────────
// Qualifying: single parties ≥5% nationally, coalitions ≥8% nationally
function calcDHondtConst(
  votes:  Partial<Record<PlPartyId, number>>,
  seats:  number,
  natPcts: Record<PlPartyId, number>,
): Partial<Record<PlPartyId, number>> {
  const total = Object.values(votes).reduce((s,v)=>s+(v??0),0);
  if (total===0 || seats===0) return {};
  // Apply national threshold per party type
  const qualifying = (Object.entries(votes) as [PlPartyId,number][])
    .filter(([id,v]) => {
      if ((v??0)<=0) return false;
      const thresh = PL_PARTY_MAP[id]?.threshold ?? 5;
      return (natPcts[id]??0) >= thresh;
    });
  if (qualifying.length===0) return {};
  const quotients: {id:PlPartyId;q:number}[] = [];
  for (const [id,v] of qualifying) {
    for (let d=1; d<=seats; d++) quotients.push({id, q:(v/total*100)/d});
  }
  quotients.sort((a,b)=>b.q-a.q);
  const result: Partial<Record<PlPartyId,number>> = {};
  for (let i=0; i<Math.min(seats,quotients.length); i++) {
    result[quotients[i].id] = (result[quotients[i].id]??0)+1;
  }
  return result;
}

// Proportional swing: constituency_pct = base_2023 × (new_nat / old_nat), normalised
function calcConstVotes(
  natPcts:  Record<PlPartyId, number>,
  constId:  PlConstId,
  override?: Partial<Record<PlPartyId, number>>,
): Record<PlPartyId, number> {
  if (override && Object.keys(override).length>0) {
    const raw: Record<PlPartyId,number> = {} as Record<PlPartyId,number>;
    let total=0;
    for (const p of PL_PARTIES) { raw[p.id]=Math.max(0,override[p.id]??0); total+=raw[p.id]; }
    if (total===0) return raw;
    for (const p of PL_PARTIES) raw[p.id]=(raw[p.id]/total)*100;
    return raw;
  }
  const base = PL_CONST_MAP[constId]?.v2023 ?? {};
  const raw: Record<PlPartyId,number> = {} as Record<PlPartyId,number>;
  let total=0;
  for (const p of PL_PARTIES) {
    const newNat = natPcts[p.id]??0;
    const oldNat = PL_VOTE_PCT_2023[p.id]??0;
    const basePct = base[p.id]??0;
    raw[p.id] = basePct===0 ? 0 : oldNat===0 ? basePct : basePct*(newNat/oldNat);
    total+=raw[p.id];
  }
  if (total===0) return raw;
  for (const p of PL_PARTIES) raw[p.id]=(raw[p.id]/total)*100;
  return raw;
}

// Sum D'Hondt across all 41 constituencies
function calcAllConstSeats(
  natPcts:    Partial<Record<PlPartyId, number>>,
  overrides?: Partial<Record<PlConstId, Partial<Record<PlPartyId, number>>>>,
): Partial<Record<PlPartyId, number>> {
  const totals: Partial<Record<PlPartyId,number>> = {};
  for (const c of PL_CONSTITUENCIES) {
    const cv = calcConstVotes(natPcts as Record<PlPartyId,number>, c.id, overrides?.[c.id]);
    const cs = calcDHondtConst(cv, c.seats, natPcts as Record<PlPartyId,number>);
    for (const [id,s] of Object.entries(cs) as [PlPartyId,number][]) {
      totals[id] = (totals[id]??0)+s;
    }
  }
  return totals;
}

// Partial seats from declared constituencies only
function calcPartialSeats(
  natPcts:   Record<PlPartyId, number>,
  constFrac: Partial<Record<PlConstId, number>>,
  overrides?:Partial<Record<PlConstId, Partial<Record<PlPartyId, number>>>>,
): Partial<Record<PlPartyId, number>> {
  const declared = Object.keys(constFrac).filter(id=>(constFrac[id as PlConstId]??0)>0) as PlConstId[];
  if (declared.length===0) return {};
  const totals: Partial<Record<PlPartyId,number>> = {};
  for (const cId of declared) {
    const c = PL_CONST_MAP[cId]; if (!c) continue;
    const cv = calcConstVotes(natPcts, cId, overrides?.[cId]);
    const cs = calcDHondtConst(cv, c.seats, natPcts);
    for (const [id,s] of Object.entries(cs) as [PlPartyId,number][]) {
      totals[id] = (totals[id]??0)+s;
    }
  }
  return totals;
}

// ── Simulation helpers ────────────────────────────────────────────────────────
function plRandNormal():number{let u=0,v=0;while(u===0)u=Math.random();while(v===0)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function plBellCurveTimes(n:number,totalMs:number):number[]{
  return Array.from({length:n},()=>Math.max(0.02,Math.min(0.98,0.5+plRandNormal()*0.18))).sort((a,b)=>a-b).map(t=>Math.round(t*totalMs));
}
function redistributePcts(current:Record<PlPartyId,number>,changedId:PlPartyId,newRaw:number,locks:Set<PlPartyId>):Record<PlPartyId,number>{
  const ids=Object.keys(current) as PlPartyId[];
  const lockedSum=ids.filter(id=>locks.has(id)&&id!==changedId).reduce((s,id)=>s+(current[id]??0),0);
  const clamped=Math.min(Math.max(newRaw,0),100-lockedSum);
  const unlocked=ids.filter(id=>!locks.has(id)&&id!==changedId);
  const remaining=100-lockedSum-clamped;
  const next:Record<PlPartyId,number>={...current,[changedId]:clamped};
  const unlockedSum=unlocked.reduce((s,id)=>s+(current[id]??0),0);
  if(unlockedSum>0){for(const id of unlocked)next[id]=((current[id]??0)/unlockedSum)*remaining;}
  else if(unlocked.length>0){const share=remaining/unlocked.length;for(const id of unlocked)next[id]=share;}
  return next;
}

// ── Format / colour helpers ───────────────────────────────────────────────────
function fmtN(n:number):string{if(n>=1_000_000)return(n/1_000_000).toFixed(1)+'M';if(n>=1_000)return Math.round(n/1_000)+'K';return String(n);}
function hexToRgba(hex:string,alpha:number):string{
  const h=hex.replace('#','');const full=h.length===3?h[0]+h[0]+h[1]+h[1]+h[2]+h[2]:h;
  const r=parseInt(full.slice(0,2),16),g=parseInt(full.slice(2,4),16),b=parseInt(full.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function partyColor(id:PlPartyId):string{return PL_PARTY_MAP[id]?.color??'#888';}

function getConstFill(natPcts:Record<PlPartyId,number>,constId:PlConstId,dark:boolean,override?:Partial<Record<PlPartyId,number>>):string{
  const pv=calcConstVotes(natPcts,constId,override);
  const sorted=(Object.entries(pv) as [PlPartyId,number][]).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a);
  if(sorted.length===0) return dark?'#374151':'#E5E7EB';
  const[winner,winPct]=sorted[0];const margin=winPct-(sorted[1]?.[1]??0);
  const c=hsl(partyColor(winner));c.l=dark?0.55-Math.min(margin/20,1)*0.29:0.82-Math.min(margin/20,1)*0.46;
  return c.formatHex();
}

// ── Tooltip state ─────────────────────────────────────────────────────────────
type PlTooltipState={
  x:number;y:number;name:string;nr:number;seats:number;
  parties:{id:PlPartyId;pct:number;rawVotes?:number;projSeats?:number}[];
  leader:PlPartyId|null;reportingPct?:number;
}|null;

// ── Scoreboard tile ───────────────────────────────────────────────────────────
function PlScoreboardTile({
  partyId,seats,pct,rawVotes,isLeader,isWinner,is2026,dark:_dark,
}:{
  partyId:PlPartyId;seats:number;pct:number;rawVotes?:number;
  isLeader:boolean;isWinner:boolean;is2026?:boolean;dark?:boolean;
}) {
  const party      = PL_PARTY_MAP[partyId];
  const leaderName = is2026&&party.leader2026?party.leader2026:party.leader;
  const leaderWiki = is2026&&party.wikiTitle2026?party.wikiTitle2026:party.wikiTitle;
  const[photoUrl,setPhotoUrl]=useState<string|null>(null);
  useEffect(()=>{
    if(!leaderWiki){setPhotoUrl(null);return;}
    let cancelled=false;
    fetchWikiPhoto(leaderWiki).then(url=>{if(!cancelled)setPhotoUrl(url);});
    return()=>{cancelled=true;};
  },[leaderWiki]);
  const initials   = leaderName.split(' ').map((w:string)=>w[0]).join('').slice(0,2);
  const color      = partyColor(partyId);
  const colorAlpha = hexToRgba(color,0.13);
  return(
    <div className={`cand-col${isLeader?' is-leader':''}${isWinner?' is-winner':''}`}
      style={{'--cand-color':color,'--cand-color-alpha':colorAlpha,
        borderColor:(isLeader||isWinner)?color:hexToRgba(color,0.30)}as React.CSSProperties}>
      <div style={{position:'relative'}}>
        <div className="cand-circle-frame">
          {photoUrl?<img src={photoUrl} alt={leaderName} onError={()=>setPhotoUrl(null)}/>
            :<span className="cand-initials">{initials}</span>}
        </div>
        {isWinner&&(
          <span className="called-tick">
            <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
              <circle cx="8.5" cy="8.5" r="8.5" fill={color}/>
              <path d="M4.5 8.5l2.8 2.8L12.5 5.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        )}
      </div>
      <span className="cand-leader-name" title={leaderName}>{leaderName.split(' ').slice(-1)[0]}</span>
      <span className="cand-party-abbrev">{party.name}</span>
      <span className="cand-seats">{seats}</span>
      <span className="cand-party-name" title={party.fullName}>{party.fullName}</span>
      <div style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:1}}>
        <span style={{fontSize:6,fontFamily:'"JetBrains Mono",monospace',fontWeight:600,color:hexToRgba(color,0.48),letterSpacing:'0.10em',textTransform:'uppercase'}}>
          {PL_PARTY_MAP[partyId].threshold}% thr
        </span>
        <span style={{fontSize:11,fontFamily:'"JetBrains Mono",monospace',fontWeight:700,color}}>{pct.toFixed(1)}%</span>
      </div>
      {rawVotes!=null&&(
        <div style={{width:'100%',display:'flex',justifyContent:'flex-end',marginBottom:2}}>
          <span className="cand-votes-full"   style={{fontSize:8.5,fontFamily:'"JetBrains Mono",monospace',color:hexToRgba(color,0.65)}}>{rawVotes.toLocaleString()}</span>
          <span className="cand-votes-compact" style={{fontSize:8.5,fontFamily:'"JetBrains Mono",monospace',color:hexToRgba(color,0.65)}}>{fmtN(rawVotes)}</span>
        </div>
      )}
      <div className="cand-bar-track" style={{width:'100%',height:3,borderRadius:2,background:'var(--bar-track)'}}>
        <div className="cand-bar-fill" style={{height:'100%',borderRadius:2,background:color,width:`${Math.min(pct/40*100,100)}%`,transition:'width 0.3s ease'}}/>
      </div>
    </div>
  );
}

// ── Scoreboard blocs ──────────────────────────────────────────────────────────
// Coalition government: KO + TD + Lewica (Tusk majority)
// Opposition: PiS (right), Konfederacja (far-right)
const PL_GOVT_IDS:  PlPartyId[] = ['KO','TD','LEWICA'];
const PL_OPP_IDS:   PlPartyId[] = ['PIS'];
const PL_FARR_IDS:  PlPartyId[] = ['KONF'];

function PlScoreboard({
  natPcts,simSeats,isBaseline,is2026,dark,reportedVoteScale,
}:{
  natPcts:Record<PlPartyId,number>;simSeats?:Partial<Record<PlPartyId,number>>;
  isBaseline?:boolean;is2026?:boolean;dark?:boolean;reportedVoteScale?:number;
}) {
  const scrollRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=scrollRef.current;if(!el)return;
    const h=(e:WheelEvent)=>{if(Math.abs(e.deltaX)>Math.abs(e.deltaY))return;e.preventDefault();el.scrollLeft+=e.deltaY;};
    el.addEventListener('wheel',h,{passive:false});return()=>el.removeEventListener('wheel',h);
  },[]);

  const seats=useMemo(()=>simSeats??calcAllConstSeats(natPcts),[simSeats,natPcts]);
  const pctTotal=Object.values(natPcts).reduce((s,v)=>s+(v??0),0);
  const scale=reportedVoteScale??1;

  const govtSeats=PL_GOVT_IDS.reduce((s,id)=>s+(seats[id]??0),0);
  const oppSeats =PL_OPP_IDS.reduce((s,id)=>s+(seats[id]??0),0);
  const farrSeats=PL_FARR_IDS.reduce((s,id)=>s+(seats[id]??0),0);

  const govtMajority=govtSeats>=PL_MAJORITY;
  const oppMajority =oppSeats>=PL_MAJORITY;
  const maxGroup=Math.max(govtSeats,oppSeats,farrSeats);
  const govtLeading=maxGroup>0&&govtSeats===maxGroup;
  const oppLeading =maxGroup>0&&oppSeats===maxGroup;

  const visible=useMemo(()=>PL_LR_ORDER.filter(id=>(seats[id]??0)>0||(natPcts[id]??0)>=0.5),[seats,natPcts]);

  const makeTile=(id:PlPartyId)=>{
    const s=seats[id]??0;
    const pct=pctTotal>0?(natPcts[id]??0)/pctTotal*100:0;
    const rawVotes=isBaseline?Math.round((PL_VOTE_RAW_2023[id]??0)*scale):Math.round((natPcts[id]??0)/100*PL_GRAND_TOTAL_VOTES*scale);
    const inGovt=PL_GOVT_IDS.includes(id);const inOpp=PL_OPP_IDS.includes(id);
    const isWinner=inGovt?govtMajority:inOpp?oppMajority:false;
    const isLeader=inGovt?(govtLeading&&!govtMajority):inOpp?(oppLeading&&!oppMajority):false;
    return<PlScoreboardTile key={id} partyId={id} seats={s} pct={pct} rawVotes={rawVotes}
      isLeader={isLeader} isWinner={isWinner} is2026={is2026} dark={dark}/>;
  };

  const sortBloc=(ids:PlPartyId[])=>ids.filter(id=>visible.includes(id)).sort((a,b)=>(seats[b]??0)-(seats[a]??0));
  const renderBloc=(ids:PlPartyId[],label:string,isLeading:boolean,isMajority:boolean)=>{
    const shown=sortBloc(ids);if(shown.length===0)return null;
    const accent=partyColor(shown[0]);
    const groupStyle:React.CSSProperties=isMajority?{borderColor:hexToRgba(accent,0.72),background:hexToRgba(accent,0.08)}
      :isLeading?{borderColor:hexToRgba(accent,0.42),background:hexToRgba(accent,0.04)}:{};
    const labelStyle:React.CSSProperties=(isMajority||isLeading)?{color:hexToRgba(accent,0.85)}:{};
    return(
      <div className="ni-group" style={groupStyle}>
        <span className="ni-group-label" style={labelStyle}>{label}</span>
        <div className="ni-group-tiles">{shown.map(id=>makeTile(id))}</div>
      </div>
    );
  };

  return(
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {renderBloc(PL_GOVT_IDS,'Koalicja rządząca',govtLeading&&!govtMajority,govtMajority)}
          {renderBloc(PL_FARR_IDS,'Konfederacja',false,false)}
          {renderBloc(PL_OPP_IDS,'PiS (opozycja)',oppLeading&&!oppMajority,oppMajority)}
        </div>
      </div>
    </div>
  );
}

// ── Map controller ────────────────────────────────────────────────────────────
function MapController({layerRef}:{layerRef:React.MutableRefObject<L.GeoJSON|null>}) {
  const map=useMap();
  useEffect(()=>{
    const ro=new ResizeObserver(()=>map.invalidateSize());
    ro.observe(map.getContainer());return()=>ro.disconnect();
  },[map]);
  useEffect(()=>{
    const h=()=>{layerRef.current?.eachLayer((l:L.Layer)=>{const p=l as any;if(p.options)p.options.smoothFactor=0;});};
    map.on('zoomend',h);return()=>{map.off('zoomend',h);};
  },[map,layerRef]);
  return null;
}

// ── Bubble overlay ────────────────────────────────────────────────────────────
type BubbleEntry={marker:L.CircleMarker;baseRadius:number};
function zoomScale(zoom:number):number{return Math.max(0.15,Math.min(2.0,(zoom-4)/(9-4)));}

function PlBubbleLayer({
  geoData,natPcts,containerRef,setTooltip,onSelect,natPctsRef,
  declaredConsts,constOverrides,constOverridesRef,blankMode,projectedConsts,
  simConstFractions,simNatPctsRef,
}:{
  geoData:any;natPcts:Record<PlPartyId,number>;
  containerRef:React.RefObject<HTMLDivElement|null>;
  setTooltip:(t:PlTooltipState)=>void;onSelect:(id:PlConstId)=>void;
  natPctsRef:React.MutableRefObject<Record<PlPartyId,number>>;
  declaredConsts?:Set<PlConstId>;
  constOverrides?:Partial<Record<PlConstId,Partial<Record<PlPartyId,number>>>>;
  constOverridesRef:React.MutableRefObject<Partial<Record<PlConstId,Partial<Record<PlPartyId,number>>>>>;
  blankMode?:boolean;projectedConsts?:Set<PlConstId>;
  simConstFractions?:Partial<Record<PlConstId,number>>;
  simNatPctsRef?:React.MutableRefObject<Record<PlPartyId,number>|null>;
}) {
  const map=useMap();
  const bubblesRef=useRef<BubbleEntry[]>([]);
  const simFracRef=useRef(simConstFractions??{});
  useEffect(()=>{simFracRef.current=simConstFractions??{};},[simConstFractions]);

  useEffect(()=>{
    const onZoom=()=>{const scale=zoomScale(map.getZoom());for(const{marker,baseRadius}of bubblesRef.current)marker.setRadius(baseRadius*scale);};
    map.on('zoomend',onZoom);return()=>{map.off('zoomend',onZoom);};
  },[map]);

  useEffect(()=>{
    for(const{marker}of bubblesRef.current)marker.remove();
    bubblesRef.current=[];
    const scale=zoomScale(map.getZoom());

    L.geoJSON(geoData).eachLayer((layer:L.Layer)=>{
      const path=layer as any;
      const geoId:string=path.feature?.properties?.id??path.feature?.properties?.nr??'';
      const constId=PL_GEOID_TO_ID[String(geoId)];
      if(!constId)return;
      if(declaredConsts&&!declaredConsts.has(constId))return;
      if(!declaredConsts&&blankMode&&!(projectedConsts?.has(constId)))return;
      const bounds=(layer as any).getBounds?.();if(!bounds?.isValid())return;
      const center=bounds.getCenter();
      const pv=calcConstVotes(natPcts,constId,constOverrides?.[constId]);
      const sorted=(Object.entries(pv) as [PlPartyId,number][]).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a);
      if(sorted.length===0)return;
      const[winId,winPct]=sorted[0];
      const margin=winPct-(sorted[1]?.[1]??0);
      const c=PL_CONST_MAP[constId];
      const seatBonus=Math.min((c?.seats??1)/20*8,8);
      const baseRadius=10+Math.min(margin/10,1)*20+seatBonus;
      const color=partyColor(winId);

      const marker=L.circleMarker(center,{
        radius:baseRadius*scale,color,fillColor:color,fillOpacity:0.72,weight:1,opacity:0.9,
      }).addTo(map);

      marker.on('click',()=>{setTooltip(null);onSelect(constId);});
      marker.on('mousemove',(e:L.LeafletMouseEvent)=>{
        const rect=containerRef.current?.getBoundingClientRect();if(!rect)return;
        const cur=calcConstVotes(simNatPctsRef?.current??natPctsRef.current,constId,constOverridesRef.current?.[constId]);
        const fraction=simFracRef.current[constId]??1;
        const cVotes=PL_GRAND_TOTAL_VOTES*(c?.weight??0)/PL_TOTAL_CONST_WEIGHT;
        const simNat=simNatPctsRef?.current??natPctsRef.current;
        const projSeats=calcDHondtConst(cur,c?.seats??0,simNat);
        const parties=(Object.entries(cur) as [PlPartyId,number][])
          .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,5)
          .map(([id,pct])=>({id:id as PlPartyId,pct,rawVotes:Math.round(pct/100*cVotes*fraction),projSeats:projSeats[id as PlPartyId]??0}));
        setTooltip({x:e.originalEvent.clientX-rect.left,y:e.originalEvent.clientY-rect.top,
          name:c?.name??geoId,nr:c?.nr??0,seats:c?.seats??0,
          parties,leader:parties[0]?.id??null,reportingPct:Math.round(fraction*100)});
      });
      marker.on('mouseout',()=>setTooltip(null));
      bubblesRef.current.push({marker,baseRadius});
    });
    return()=>{for(const{marker}of bubblesRef.current)marker.remove();bubblesRef.current=[];};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[map,geoData,natPcts,blankMode,projectedConsts,declaredConsts]);

  return null;
}
