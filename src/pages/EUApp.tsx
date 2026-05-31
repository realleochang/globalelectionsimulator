import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';
import {
  EU_COUNTRIES_DATA, EU_VOTE_PCT_2024, EU_VOTE_RAW_2024, EU_BASELINE_SEATS,
  EU_TOTAL_SEATS, EU_MAJORITY, EU_GRAND_TOTAL_VALID,
  type EuGroupId, type EuCountryId, type EuCountry,
} from '../data/eu2024';

// ─────────────────────────────────────────────────────────────────────────────
// 2024 European Parliament election simulator.
//   • "Constituencies" = the 27 member states, each electing a fixed number of MEPs
//     (degressive proportionality, 6 → 96). 720 seats total, majority 361.
//   • "Parties" = the 9 European political groups (+ an "Others" bucket for parties
//     that won no seats). Votes are aggregated by group; see src/data/eu2024.ts.
//   • Seat model: the 2024 baseline shows the REAL per-country group seats. Any
//     projection / simulation re-allocates seats per country by the D'Hondt method
//     over group votes (Others excluded), applying each country's legal threshold —
//     this reproduces the official 720-seat split to within ~2.5%.
// ─────────────────────────────────────────────────────────────────────────────

// ── European political groups ─────────────────────────────────────────────────
type EuGroup = {
  id:        EuGroupId;
  name:      string;     // short label
  fullName:  string;     // full group name
  color:     string;
  seats2024: number;     // EU-wide seats won (constitutive session)
  leader:    string;     // CURRENT group leader (shown for 2026 / blank / simulation)
  wikiTitle?: string;
  leader2024?: string;   // leader/Spitzenkandidat at the June-2024 election (shown for the 2024 view)
  wikiTitle2024?: string;
  noSeats?:  boolean;    // "Others" bucket — counts votes, never wins seats
};

// Ideology order left → right for the hemicycle. NI (non-attached) sits at the end.
// "Others" (OTH) is excluded from the seat order entirely.
const EU_LR_ORDER: EuGroupId[] = ['LEFT','GREENS','SD','RE','EPP','ECR','PfE','ESN','NI'];

const EU_GROUPS: EuGroup[] = [
  { id:'LEFT',  name:'The Left', fullName:'The Left (GUE/NGL)',                 color:'#8B0000', seats2024:46,
    leader:'Manon Aubry',           wikiTitle:'Manon_Aubry',
    leader2024:'Walter Baier',      wikiTitle2024:'Walter_Baier' },
  { id:'GREENS',name:'Greens/EFA', fullName:'Greens–European Free Alliance',   color:'#3FA34D', seats2024:53,
    leader:'Terry Reintke',         wikiTitle:'Terry_Reintke' },
  { id:'SD',    name:'S&D', fullName:'Progressive Alliance of Socialists & Democrats', color:'#F0001C', seats2024:136,
    leader:'Iratxe García',         wikiTitle:'Iratxe_García_Pérez',
    leader2024:'Nicolas Schmit',    wikiTitle2024:'Nicolas_Schmit' },
  { id:'RE',    name:'Renew', fullName:'Renew Europe',                          color:'#FFCC00', seats2024:77,
    leader:'Valérie Hayer',         wikiTitle:'Valérie_Hayer' },
  { id:'EPP',   name:'EPP', fullName:'European People\'s Party',                color:'#3399FF', seats2024:188,
    leader:'Ursula von der Leyen',  wikiTitle:'Ursula_von_der_Leyen' },
  { id:'ECR',   name:'ECR', fullName:'European Conservatives and Reformists',   color:'#0054A5', seats2024:78,
    leader:'Nicola Procaccini',     wikiTitle:'Nicola_Procaccini' },
  { id:'PfE',   name:'Patriots', fullName:'Patriots for Europe',                color:'#1D2D5C', seats2024:84,
    leader:'Jordan Bardella',       wikiTitle:'Jordan_Bardella' },
  { id:'ESN',   name:'ESN', fullName:'Europe of Sovereign Nations',            color:'#5D5FA3', seats2024:25,
    leader:'René Aust',             wikiTitle:'René_Aust' },
  { id:'NI',    name:'NI', fullName:'Non-Inscrits (non-attached)',             color:'#8A8D91', seats2024:33,
    leader:'Non-attached members' },
  { id:'OTH',   name:'Others', fullName:'Others — parties without seats',       color:'#BFC4CB', seats2024:0,
    leader:'Various', noSeats:true },
];
const EU_GROUP_MAP = Object.fromEntries(EU_GROUPS.map(g=>[g.id,g])) as Record<EuGroupId,EuGroup>;
// Order used in slider panels / simulation inputs / vote displays (includes Others).
const EU_SLIDER_ORDER: EuGroupId[] = [...EU_LR_ORDER, 'OTH'];

// All 9 seat-winning groups are pan-European (no landlocking); Others is non-seat.
const EU_PROSPECTIVE: EuGroupId[] = EU_SLIDER_ORDER;

// ── Countries (27 member states) ──────────────────────────────────────────────
const EU_COUNTRIES = EU_COUNTRIES_DATA;
const EU_COUNTRY_MAP = Object.fromEntries(EU_COUNTRIES.map(c=>[c.id,c])) as Record<EuCountryId,EuCountry>;
const EU_GRAND_TOTAL = EU_GRAND_TOTAL_VALID;

// geojson feature.properties.code → country id (identity, validated)
const EU_GEOID_TO_ID: Record<string, EuCountryId> = Object.fromEntries(
  EU_COUNTRIES.map(c=>[c.id, c.id])
) as Record<string, EuCountryId>;

// Legal seat-allocation threshold per country (percent of national vote). 0 = none.
// Applied (against a group's local share) only in projection/simulation D'Hondt.
const EU_COUNTRY_THRESHOLD: Record<EuCountryId, number> = {
  AT:4, BE:5, BG:0, HR:5, CY:1.8, CZ:5, DK:0, EE:0, FI:0, FR:5, DE:0, EL:3,
  HU:5, IE:0, IT:4, LV:5, LT:5, LU:0, MT:0, NL:0, PL:5, PT:0, RO:5, SK:5, SI:4, ES:0, SE:4,
};

// Small marker nudges [dLng, dLat] for tiny states whose centroid is cramped.
const EU_MARKER_OFFSET: Partial<Record<EuCountryId, [number, number]>> = {
  LU: [-0.15, 0.0],
};

// ── Per-country baseline local percentages (incl. Others) for swing maths ─────
const EU_PCT_BY_COUNTRY: Record<EuCountryId, Record<EuGroupId, number>> = (() => {
  const out = {} as Record<EuCountryId, Record<EuGroupId, number>>;
  for (const c of EU_COUNTRIES) {
    const row = {} as Record<EuGroupId, number>;
    for (const g of EU_GROUPS) row[g.id] = ((c.raw2024[g.id] ?? 0) / c.validVotes) * 100;
    out[c.id] = row;
  }
  return out;
})();

// ── 2026 polling scenario ─────────────────────────────────────────────────────
// EU-wide national voting intention — Europe Elects, April 2026 (sums to 100).
const EU_VOTE_PCT_2026: Record<EuGroupId, number> = {
  LEFT: 9.8, GREENS: 6.9, SD: 16.9, RE: 8.8, EPP: 21.7, ECR: 10.7, PfE: 11.3, ESN: 7.0, NI: 3.8, OTH: 3.1,
};

// Modelled 2026 LOCAL group distribution for member states whose national picture has
// diverged sharply from a naive uniform swing — grounded in 2025/26 elections & polling.
// (Countries not listed here use a uniform national swing from their 2024 result.)
// Each row is normalised before use; values are local vote-share %.
const EU_CLIMATE_2026: Partial<Record<EuCountryId, Partial<Record<EuGroupId, number>>>> = {
  // Germany: AfD (ESN) overtakes CDU/CSU (EPP) — AfD ~27.5%, CDU ~23-25%, Linke surges,
  // BSW (NI) collapses. (Current 2026 polling.) → flips Germany to ESN-led.
  DE: { ESN: 27.5, EPP: 25, GREENS: 14, SD: 12.5, LEFT: 10.5, RE: 4.5, NI: 3.5, OTH: 2.5 },
  // France: RN (PfE) strengthens further (~33%), Renew (Macron camp) keeps falling.
  FR: { PfE: 33, SD: 14, RE: 13, LEFT: 13, EPP: 10, GREENS: 6, ECR: 5, OTH: 6 },
  // Netherlands: D66 (Renew) surge after the Oct-2025 election; PVV (PfE) down, NSC wiped.
  NL: { RE: 30, EPP: 16, PfE: 16, GREENS: 8, SD: 8, ECR: 7, LEFT: 5, OTH: 10 },
  // Czechia: ANO (PfE, Babiš) won the Oct-2025 election decisively; SPD (ESN) in coalition talks.
  CZ: { PfE: 36, EPP: 16, ECR: 13, ESN: 8, GREENS: 8, NI: 4, SD: 3, OTH: 12 },
  // Hungary: Tisza (EPP, Magyar) landslide on 12 Apr 2026 (53.6% vs Fidesz 37.8%) — ends
  // Orbán's 16 years. → flips Hungary from PfE (Fidesz) to EPP (Tisza).
  HU: { EPP: 53, PfE: 38, ESN: 5, SD: 2, OTH: 2 },
  // Italy: Meloni (ECR/FdI) holds the lead; PD (S&D) and M5S (Left) recover slightly.
  IT: { ECR: 29, SD: 23, LEFT: 13, EPP: 10, PfE: 9, GREENS: 6, RE: 4, OTH: 6 },
  // Spain: PP (EPP) ahead of PSOE (S&D); Vox (PfE) up.
  ES: { EPP: 34, SD: 28, PfE: 13, LEFT: 10, NI: 7, GREENS: 3, RE: 2, OTH: 3 },
  // Poland: KO (EPP) edges PiS (ECR) in a tight race; Konfederacja (ESN) rising.
  PL: { EPP: 31, ECR: 29, ESN: 13, RE: 6, SD: 6, NI: 4, OTH: 11 },
  // Austria: FPÖ (PfE) leads ahead of SPÖ (S&D) and ÖVP (EPP).
  AT: { PfE: 28, SD: 22, EPP: 21, GREENS: 10, RE: 10, LEFT: 4, OTH: 5 },
  // Romania: AUR-led nationalist right (ECR) surges past PSD (S&D). → flips Romania to ECR.
  RO: { ECR: 30, SD: 22, EPP: 17, RE: 13, NI: 4, GREENS: 2, OTH: 12 },
};

// All seat-winning groups contest every country (no landlock). Kept for parity with
// the regional-party machinery in the other simulators.
function euContests(_id: EuGroupId, _countryId: EuCountryId): boolean { return true; }

// ── D'Hondt per country over groups ───────────────────────────────────────────
// Others (noSeats) never receives seats. A group must clear the country's legal
// threshold (on its local share) to qualify.
function calcDHondtCountry(
  votes:     Partial<Record<EuGroupId, number>>,
  seats:     number,
  countryId: EuCountryId,
): Partial<Record<EuGroupId, number>> {
  const total = Object.values(votes).reduce((s,v)=>s+(v??0),0);
  if (total===0 || seats===0) return {};
  const thr = EU_COUNTRY_THRESHOLD[countryId] ?? 0;
  const qualifying = (Object.entries(votes) as [EuGroupId,number][])
    .filter(([id,v]) => {
      if ((v??0)<=0) return false;
      if (EU_GROUP_MAP[id]?.noSeats) return false;           // Others: no seats
      return (v/total*100) >= thr;                            // local threshold
    });
  if (qualifying.length===0) return {};
  const quotients: {id:EuGroupId;q:number}[] = [];
  for (const [id,v] of qualifying) {
    for (let d=1; d<=seats; d++) quotients.push({id, q:(v/total*100)/d});
  }
  quotients.sort((a,b)=>b.q-a.q);
  const result: Partial<Record<EuGroupId,number>> = {};
  for (let i=0; i<Math.min(seats,quotients.length); i++) {
    result[quotients[i].id] = (result[quotients[i].id]??0)+1;
  }
  return result;
}

// Proportional swing: country_pct = base_2024 × (new_nat / old_nat), normalised.
function calcCountryVotes(
  natPcts:   Record<EuGroupId, number>,
  countryId: EuCountryId,
  override?: Partial<Record<EuGroupId, number>>,
): Record<EuGroupId, number> {
  if (override && Object.keys(override).length>0) {
    const raw: Record<EuGroupId,number> = {} as Record<EuGroupId,number>;
    let total=0;
    for (const g of EU_GROUPS) { raw[g.id]=euContests(g.id,countryId)?Math.max(0,override[g.id]??0):0; total+=raw[g.id]; }
    if (total===0) return raw;
    for (const g of EU_GROUPS) raw[g.id]=(raw[g.id]/total)*100;
    return raw;
  }
  const base = EU_PCT_BY_COUNTRY[countryId] ?? ({} as Record<EuGroupId,number>);
  const raw: Record<EuGroupId,number> = {} as Record<EuGroupId,number>;
  let total=0;
  for (const g of EU_GROUPS) {
    const newNat = natPcts[g.id]??0;
    const oldNat = EU_VOTE_PCT_2024[g.id]??0;
    const basePct = base[g.id]??0;
    raw[g.id] = !euContests(g.id,countryId) ? 0
      : basePct===0 ? (oldNat===0 ? newNat : 0)
      : oldNat===0 ? basePct
      : basePct*(newNat/oldNat);
    total+=raw[g.id];
  }
  if (total===0) return raw;
  for (const g of EU_GROUPS) raw[g.id]=(raw[g.id]/total)*100;
  return raw;
}

// Sum D'Hondt across all 27 countries
function calcAllCountrySeats(
  natPcts:    Partial<Record<EuGroupId, number>>,
  overrides?: Partial<Record<EuCountryId, Partial<Record<EuGroupId, number>>>>,
): Partial<Record<EuGroupId, number>> {
  const totals: Partial<Record<EuGroupId,number>> = {};
  for (const c of EU_COUNTRIES) {
    const cv = calcCountryVotes(natPcts as Record<EuGroupId,number>, c.id, overrides?.[c.id]);
    const cs = calcDHondtCountry(cv, c.seats, c.id);
    for (const [id,s] of Object.entries(cs) as [EuGroupId,number][]) totals[id] = (totals[id]??0)+s;
  }
  return totals;
}

// ── Simulation helpers ────────────────────────────────────────────────────────
function euRandNormal():number{let u=0,v=0;while(u===0)u=Math.random();while(v===0)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
// Argentina-style per-country batch schedule: every country starts reporting almost
// immediately (first batch within ~2.5s), then the remaining batches trickle in on a
// random bell curve across the whole run — so all 27 report together in a random order.
const EU_SIM_BATCHES = 15;
function euCountryBatchTimes(totalMs:number):number[]{
  const firstT = Math.round(Math.random()*Math.min(totalMs*0.05, 2500));
  const rest = Array.from({length:EU_SIM_BATCHES-1}, () =>
    Math.round(Math.max(0.02, Math.min(0.99, 0.5+euRandNormal()*0.19))*totalMs));
  return [firstT, ...rest].sort((a,b)=>a-b);
}
// Precompute monotonic, noisy cumulative vote snapshots for one country. Each group's
// running count is strictly non-decreasing batch→batch; early batches are deliberately
// noisy (shares wobble for suspense) and the noise collapses as counting nears 100%; the
// final snapshot equals finalVotes exactly. cuts = [0, …, 1] (BATCHES+1 cumulative points).
function euComputeBatches(finalVotes: Record<EuGroupId,number>, cuts: number[], seed: number): Record<EuGroupId,number>[] {
  const ids = Object.keys(finalVotes) as EuGroupId[];
  const finalTotal = ids.reduce((s,id)=>s+(finalVotes[id]||0),0);
  const BATCHES = cuts.length-1;
  if (finalTotal<=0) return Array.from({length:BATCHES},()=>Object.fromEntries(ids.map(id=>[id,0])) as Record<EuGroupId,number>);
  const snaps: Record<EuGroupId,number>[] = [];
  const cum = Object.fromEntries(ids.map(id=>[id,0])) as Record<EuGroupId,number>;
  for (let b=0; b<BATCHES; b++) {
    if (b===BATCHES-1) { snaps.push({...finalVotes}); break; }       // last batch snaps to exact
    const batchTotal = Math.round(finalTotal*(cuts[b+1]-cuts[b]));
    const noiseAmp = 0.13*(1-cuts[b+1])*(1-cuts[b+1]);              // gentle wobble, collapses as count rises
    let shareSum = 0; const ns = {} as Record<EuGroupId,number>;
    ids.forEach((id,i)=>{
      const phase = ((seed*7919 + i*1301 + b*4567) % 997) / 997;     // deterministic pseudo-random
      const noise = noiseAmp*Math.sin(phase*Math.PI*2);
      ns[id] = Math.max(0, finalVotes[id]/finalTotal + noise); shareSum += ns[id];
    });
    const raw = ids.map(id=>Math.round((ns[id]/(shareSum||1))*batchTotal));
    raw[raw.reduce((bi,v,i)=>v>raw[bi]?i:bi,0)] += batchTotal - raw.reduce((s,v)=>s+v,0);
    ids.forEach((id,i)=>{ cum[id] = (cum[id]||0) + Math.max(0,raw[i]); });
    snaps.push({...cum});
  }
  return snaps;
}
function redistributePcts(current:Record<EuGroupId,number>,changedId:EuGroupId,newRaw:number,locks:Set<EuGroupId>):Record<EuGroupId,number>{
  const ids=Object.keys(current) as EuGroupId[];
  const lockedSum=ids.filter(id=>locks.has(id)&&id!==changedId).reduce((s,id)=>s+(current[id]??0),0);
  const clamped=Math.min(Math.max(newRaw,0),100-lockedSum);
  const unlocked=ids.filter(id=>!locks.has(id)&&id!==changedId);
  const remaining=100-lockedSum-clamped;
  const next:Record<EuGroupId,number>={...current,[changedId]:clamped};
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
function partyColor(id:EuGroupId):string{return EU_GROUP_MAP[id]?.color??'#888';}
// Brighten dark group colours (The Left, Patriots, ECR…) for legibility on the dark
// dashboard; leaves already-light colours and light-mode untouched.
function vivid(hex:string,dark:boolean):string{
  if(!dark) return hex;
  const c=hsl(hex);
  if(!Number.isNaN(c.l) && c.l<0.6) c.l=0.63;
  if(!Number.isNaN(c.s) && c.s>0 && c.s<0.45) c.s=0.5;   // keep muted blues/reds saturated
  return c.formatHex();
}

// Choropleth fill: winning group's colour, shaded by margin (bigger lead = more intense).
// During a sim, a country's live (noisy, monotonic) per-group counts; else null.
function euLiveVotes(sv:Partial<Record<EuCountryId,Record<EuGroupId,number>>>|undefined,id:EuCountryId):Record<EuGroupId,number>|null{
  const v=sv?.[id]; return (v && Object.values(v).some(x=>x>0)) ? v : null;
}
// Percentages from a raw count record.
function euPctsFromVotes(votes:Record<EuGroupId,number>):Record<EuGroupId,number>{
  const total=Object.values(votes).reduce((s,v)=>s+(v||0),0)||1;
  const out={} as Record<EuGroupId,number>;
  for(const g of EU_GROUPS) out[g.id]=(votes[g.id]??0)/total*100;
  return out;
}
function fillFromPcts(pv:Record<EuGroupId,number>,dark:boolean):string{
  const sorted=(Object.entries(pv) as [EuGroupId,number][]).filter(([id,v])=>v>0&&!EU_GROUP_MAP[id]?.noSeats).sort(([,a],[,b])=>b-a);
  if(sorted.length===0) return dark?'#374151':'#E5E7EB';
  const[winner,winPct]=sorted[0];const margin=winPct-(sorted[1]?.[1]??0);
  const c=hsl(partyColor(winner));c.l=dark?0.55-Math.min(margin/20,1)*0.29:0.82-Math.min(margin/20,1)*0.46;
  return c.formatHex();
}
function getCountryFill(natPcts:Record<EuGroupId,number>,countryId:EuCountryId,dark:boolean,override?:Partial<Record<EuGroupId,number>>):string{
  // Others is shown in votes but never "wins" a country on the map.
  return fillFromPcts(calcCountryVotes(natPcts,countryId,override),dark);
}

// ── Tooltip state ─────────────────────────────────────────────────────────────
type EuTooltipState={
  x:number;y:number;name:string;code:string;seats:number;
  parties:{id:EuGroupId;pct:number;rawVotes?:number;projSeats?:number}[];
  leader:EuGroupId|null;reportingPct?:number;
}|null;

// ── Scoreboard tile ───────────────────────────────────────────────────────────
function EuScoreboardTile({
  partyId,seats,pct,rawVotes,isLeader,isWinner,is2024,dark,
}:{
  partyId:EuGroupId;seats:number;pct:number;rawVotes?:number;
  isLeader:boolean;isWinner:boolean;is2024?:boolean;dark?:boolean;
}) {
  const party      = EU_GROUP_MAP[partyId];
  // 2024 view → the figure who led the group at that election; otherwise the current leader.
  const leaderName = is2024 && party.leader2024 ? party.leader2024 : party.leader;
  const leaderWiki = is2024 && party.wikiTitle2024 ? party.wikiTitle2024 : party.wikiTitle;
  const[photoUrl,setPhotoUrl]=useState<string|null>(null);
  useEffect(()=>{
    if(!leaderWiki){setPhotoUrl(null);return;}
    let cancelled=false;
    fetchWikiPhoto(leaderWiki).then(url=>{if(!cancelled)setPhotoUrl(url);});
    return()=>{cancelled=true;};
  },[leaderWiki]);
  const initials   = party.name.slice(0,3).toUpperCase();
  const color      = vivid(partyColor(partyId), !!dark);   // legible on the dark dashboard
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
          {party.noSeats?'no seats':`${party.seats2024} in '24`}
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
        <div className="cand-bar-fill" style={{height:'100%',borderRadius:2,background:color,width:`${Math.min(pct/30*100,100)}%`,transition:'width 0.3s ease'}}/>
      </div>
    </div>
  );
}

// ── Scoreboard ────────────────────────────────────────────────────────────────
function EuScoreboard({
  natPcts,simSeats,isBaseline,dark,reportedVoteScale,
}:{
  natPcts:Record<EuGroupId,number>;simSeats?:Partial<Record<EuGroupId,number>>;
  isBaseline?:boolean;dark?:boolean;reportedVoteScale?:number;
}) {
  const scrollRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=scrollRef.current;if(!el)return;
    const h=(e:WheelEvent)=>{if(Math.abs(e.deltaX)>Math.abs(e.deltaY))return;e.preventDefault();el.scrollLeft+=e.deltaY;};
    el.addEventListener('wheel',h,{passive:false});return()=>el.removeEventListener('wheel',h);
  },[]);

  const seats=useMemo(()=>simSeats??calcAllCountrySeats(natPcts),[simSeats,natPcts]);
  const pctTotal=Object.values(natPcts).reduce((s,v)=>s+(v??0),0);
  const scale=reportedVoteScale??1;

  const leadingId=useMemo(()=>{
    let best:EuGroupId|null=null;let bestS=-1;
    for(const id of EU_LR_ORDER){const s=seats[id]??0;if(s>bestS){bestS=s;best=id;}}
    return bestS>0?best:null;
  },[seats]);
  const leaderHasMajority=leadingId!=null&&(seats[leadingId]??0)>=EU_MAJORITY;

  // Cards sorted by seat size (desc); tie-break on vote share. Others is shown only
  // if it has a meaningful vote share (it never gets seats).
  const visible=useMemo(()=>EU_SLIDER_ORDER.filter(id=>(seats[id]??0)>0||(natPcts[id]??0)>=0.5)
    .sort((a,b)=>((seats[b]??0)-(seats[a]??0))||((natPcts[b]??0)-(natPcts[a]??0))),[seats,natPcts]);

  const makeTile=(id:EuGroupId)=>{
    const s=seats[id]??0;
    const pct=pctTotal>0?(natPcts[id]??0)/pctTotal*100:0;
    const rawVotes=isBaseline?Math.round((EU_VOTE_RAW_2024[id]??0)*scale):Math.round((natPcts[id]??0)/100*EU_GRAND_TOTAL*scale);
    const isWinner=id===leadingId&&leaderHasMajority;
    const isLeader=id===leadingId&&!leaderHasMajority;
    return<EuScoreboardTile key={id} partyId={id} seats={s} pct={pct} rawVotes={rawVotes}
      isLeader={isLeader} isWinner={isWinner} is2024={isBaseline} dark={dark}/>;
  };

  return(
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {visible.map(id=>makeTile(id))}
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
function zoomScale(zoom:number):number{return Math.max(0.30,Math.min(2.2,(zoom-3)/(8-3)+0.4));}

function EuBubbleLayer({
  geoData,natPcts,containerRef,setTooltip,onSelect,natPctsRef,
  declaredConsts,constOverrides,constOverridesRef,blankMode,projectedConsts,
  simConstFractions,simNatPctsRef,
}:{
  geoData:any;natPcts:Record<EuGroupId,number>;
  containerRef:React.RefObject<HTMLDivElement|null>;
  setTooltip:(t:EuTooltipState)=>void;onSelect:(id:EuCountryId)=>void;
  natPctsRef:React.MutableRefObject<Record<EuGroupId,number>>;
  declaredConsts?:Set<EuCountryId>;
  constOverrides?:Partial<Record<EuCountryId,Partial<Record<EuGroupId,number>>>>;
  constOverridesRef:React.MutableRefObject<Partial<Record<EuCountryId,Partial<Record<EuGroupId,number>>>>>;
  blankMode?:boolean;projectedConsts?:Set<EuCountryId>;
  simConstFractions?:Partial<Record<EuCountryId,number>>;
  simNatPctsRef?:React.MutableRefObject<Record<EuGroupId,number>|null>;
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
      const geoId:string=path.feature?.properties?.code??'';
      const constId=EU_GEOID_TO_ID[String(geoId)];
      if(!constId)return;
      if(declaredConsts&&!declaredConsts.has(constId))return;
      if(!declaredConsts&&blankMode&&!(projectedConsts?.has(constId)))return;
      const bounds=(layer as any).getBounds?.();if(!bounds?.isValid())return;
      const c0=bounds.getCenter();
      const off=EU_MARKER_OFFSET[constId];
      const center=off?L.latLng(c0.lat+off[1],c0.lng+off[0]):c0;
      const pv=calcCountryVotes(natPcts,constId,constOverrides?.[constId]);
      const sorted=(Object.entries(pv) as [EuGroupId,number][]).filter(([id,v])=>v>0&&!EU_GROUP_MAP[id]?.noSeats).sort(([,a],[,b])=>b-a);
      if(sorted.length===0)return;
      const[winId,winPct]=sorted[0];
      const c=EU_COUNTRY_MAP[constId];
      // Radius reflects the RAW vote margin (winner − runner-up), not total turnout.
      const rawMargin=(winPct-(sorted[1]?.[1]??0))/100*(c?.validVotes??0);
      const baseRadius=Math.min(34,5+0.013*Math.sqrt(Math.max(0,rawMargin)));
      const color=partyColor(winId);

      const marker=L.circleMarker(center,{
        radius:baseRadius*scale,color,fillColor:color,fillOpacity:0.72,weight:1,opacity:0.9,
      }).addTo(map);

      marker.on('click',()=>{setTooltip(null);onSelect(constId);});
      marker.on('mousemove',(e:L.LeafletMouseEvent)=>{
        const rect=containerRef.current?.getBoundingClientRect();if(!rect)return;
        const cur=calcCountryVotes(simNatPctsRef?.current??natPctsRef.current,constId,constOverridesRef.current?.[constId]);
        const fraction=simFracRef.current[constId]??1;
        const cVotes=c?.validVotes ?? 0;
        const projSeats=calcDHondtCountry(cur,c?.seats??0,constId);
        const parties=(Object.entries(cur) as [EuGroupId,number][])
          .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,6)
          .map(([id,pct])=>({id:id as EuGroupId,pct,rawVotes:Math.round(pct/100*cVotes*fraction),projSeats:projSeats[id as EuGroupId]??0}));
        setTooltip({x:e.originalEvent.clientX-rect.left,y:e.originalEvent.clientY-rect.top,
          name:c?.name??geoId,code:c?.id??geoId,seats:c?.seats??0,
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

// ── Seat-distribution dots overlay ────────────────────────────────────────────
function EuSeatDotsLayer({
  geoData,natPcts,containerRef,setTooltip,onSelect,natPctsRef,
  declaredConsts,constOverrides,constOverridesRef,blankMode,projectedConsts,
  simConstFractions,simNatPctsRef,
}:{
  geoData:any;natPcts:Record<EuGroupId,number>;
  containerRef:React.RefObject<HTMLDivElement|null>;
  setTooltip:(t:EuTooltipState)=>void;onSelect:(id:EuCountryId)=>void;
  natPctsRef:React.MutableRefObject<Record<EuGroupId,number>>;
  declaredConsts?:Set<EuCountryId>;
  constOverrides?:Partial<Record<EuCountryId,Partial<Record<EuGroupId,number>>>>;
  constOverridesRef:React.MutableRefObject<Partial<Record<EuCountryId,Partial<Record<EuGroupId,number>>>>>;
  blankMode?:boolean;projectedConsts?:Set<EuCountryId>;
  simConstFractions?:Partial<Record<EuCountryId,number>>;
  simNatPctsRef?:React.MutableRefObject<Record<EuGroupId,number>|null>;
}) {
  const map=useMap();
  const dotsRef=useRef<L.CircleMarker[]>([]);
  const simFracRef=useRef(simConstFractions??{});
  useEffect(()=>{simFracRef.current=simConstFractions??{};},[simConstFractions]);

  useEffect(()=>{
    const layout=()=>{
      for(const m of dotsRef.current)m.remove();
      dotsRef.current=[];
      const z=map.getZoom();
      const dotR=Math.max(1.4,Math.min(4,(z-3)/(8-3)*3+1.4));
      const gap=dotR*2.2;
      L.geoJSON(geoData).eachLayer((layer:L.Layer)=>{
        const path=layer as any;
        const geoId:string=path.feature?.properties?.code??'';
        const constId=EU_GEOID_TO_ID[String(geoId)];
        if(!constId)return;
        if(declaredConsts&&!declaredConsts.has(constId))return;
        if(!declaredConsts&&blankMode&&!(projectedConsts?.has(constId)))return;
        const bounds=(layer as any).getBounds?.();if(!bounds?.isValid())return;
        const c0=bounds.getCenter();
        const off=EU_MARKER_OFFSET[constId];
        const center=off?L.latLng(c0.lat+off[1],c0.lng+off[0]):c0;
        const c=EU_COUNTRY_MAP[constId];
        const pv=calcCountryVotes(natPcts,constId,constOverrides?.[constId]);
        const alloc=calcDHondtCountry(pv,c?.seats??0,constId);
        const colors:string[]=[];
        for(const id of EU_LR_ORDER){const n=alloc[id]??0;for(let i=0;i<n;i++)colors.push(partyColor(id));}
        if(colors.length===0)return;
        const N=colors.length;
        const cols=Math.ceil(Math.sqrt(N));
        const rows=Math.ceil(N/cols);
        const cpt=map.latLngToContainerPoint(center);
        for(let i=0;i<N;i++){
          const r=Math.floor(i/cols), col=i%cols;
          const rowCount=(r===rows-1)?(N-r*cols):cols;
          const dx=(col-(rowCount-1)/2)*gap;
          const dy=(r-(rows-1)/2)*gap;
          const latlng=map.containerPointToLatLng(L.point(cpt.x+dx,cpt.y+dy));
          const m=L.circleMarker(latlng,{radius:dotR,color:'#0b0b0d',weight:0.5,opacity:0.55,
            fillColor:colors[i],fillOpacity:0.95}).addTo(map);
          m.on('click',()=>{setTooltip(null);onSelect(constId);});
          m.on('mousemove',(e:L.LeafletMouseEvent)=>{
            const rect=containerRef.current?.getBoundingClientRect();if(!rect)return;
            const cur=calcCountryVotes(simNatPctsRef?.current??natPctsRef.current,constId,constOverridesRef.current?.[constId]);
            const fraction=simFracRef.current[constId]??1;
            const cVotes=c?.validVotes??0;
            const projSeats=calcDHondtCountry(cur,c?.seats??0,constId);
            const parties=(Object.entries(cur) as [EuGroupId,number][])
              .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,7)
              .map(([id,pct])=>({id:id as EuGroupId,pct,rawVotes:Math.round(pct/100*cVotes*fraction),projSeats:projSeats[id as EuGroupId]??0}));
            setTooltip({x:e.originalEvent.clientX-rect.left,y:e.originalEvent.clientY-rect.top,
              name:c?.name??geoId,code:c?.id??geoId,seats:c?.seats??0,
              parties,leader:parties[0]?.id??null,reportingPct:Math.round(fraction*100)});
          });
          m.on('mouseout',()=>setTooltip(null));
          dotsRef.current.push(m);
        }
      });
    };
    layout();
    map.on('zoomend',layout);
    return()=>{map.off('zoomend',layout);for(const m of dotsRef.current)m.remove();dotsRef.current=[];};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[map,geoData,natPcts,blankMode,projectedConsts,declaredConsts,constOverrides]);

  return null;
}

// ── Country draft (blank-map live preview before "Update Projection") ──────────
type EuCountryDraft = { constId: EuCountryId; pcts: Record<EuGroupId, number>; rptPct: number } | null;

// ── Map view ──────────────────────────────────────────────────────────────────
function EuMapView({
  natPcts, selectedConst, onSelect, dark, bubbleMap, seatDots,
  declaredConsts, constOverrides, blankMode, projectedConsts, simConstFractions,
  constDraft, simNatPcts, simConstVotes,
}: {
  natPcts: Record<EuGroupId, number>; selectedConst: EuCountryId | null;
  onSelect: (id: EuCountryId) => void; dark: boolean; bubbleMap: boolean; seatDots: boolean;
  declaredConsts?: Set<EuCountryId>;
  constOverrides?: Partial<Record<EuCountryId, Partial<Record<EuGroupId, number>>>>;
  blankMode?: boolean; projectedConsts?: Set<EuCountryId>;
  simConstFractions?: Partial<Record<EuCountryId, number>>;
  constDraft?: EuCountryDraft; simNatPcts?: Record<EuGroupId, number> | null;
  simConstVotes?: Partial<Record<EuCountryId, Record<EuGroupId, number>>>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef     = useRef<L.GeoJSON | null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltip, setTooltip] = useState<EuTooltipState>(null);

  const natPctsRef        = useRef(natPcts);
  const selectedRef       = useRef(selectedConst);
  const darkRef           = useRef(dark);
  const onSelectRef       = useRef(onSelect);
  const declaredRef       = useRef(declaredConsts);
  const constOverridesRef = useRef(constOverrides ?? {});
  const blankModeRef      = useRef(blankMode ?? false);
  const projectedRef      = useRef(projectedConsts ?? new Set<EuCountryId>());
  const simFracRef2       = useRef(simConstFractions ?? {});
  const constDraftRef2    = useRef<EuCountryDraft>(constDraft ?? null);
  const simNatPctsRef2    = useRef<Record<EuGroupId, number> | null>(simNatPcts ?? null);
  const simVotesRef2      = useRef<Partial<Record<EuCountryId, Record<EuGroupId, number>>>>(simConstVotes ?? {});

  useEffect(() => { natPctsRef.current        = natPcts;               }, [natPcts]);
  useEffect(() => { selectedRef.current       = selectedConst;          }, [selectedConst]);
  useEffect(() => { darkRef.current           = dark;                   }, [dark]);
  useEffect(() => { onSelectRef.current       = onSelect;               }, [onSelect]);
  useEffect(() => { declaredRef.current       = declaredConsts;         }, [declaredConsts]);
  useEffect(() => { constOverridesRef.current = constOverrides ?? {};   }, [constOverrides]);
  useEffect(() => { blankModeRef.current      = blankMode ?? false;     }, [blankMode]);
  useEffect(() => { projectedRef.current      = projectedConsts ?? new Set(); }, [projectedConsts]);
  useEffect(() => { simFracRef2.current       = simConstFractions ?? {}; }, [simConstFractions]);
  useEffect(() => { constDraftRef2.current    = constDraft ?? null;      }, [constDraft]);
  useEffect(() => { simNatPctsRef2.current    = simNatPcts ?? null;      }, [simNatPcts]);
  useEffect(() => { simVotesRef2.current       = simConstVotes ?? {};     }, [simConstVotes]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}eu-countries.geojson`)
      .then(r => r.json()).then(setGeoData).catch(console.error);
  }, []);

  const getStyle = useCallback((feature: any): L.PathOptions => {
    const geoId   = String(feature?.properties?.code ?? '');
    const constId = EU_GEOID_TO_ID[geoId];
    const isSel   = constId === selectedConst;
    const border  = dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.35)';

    if (bubbleMap) return { fillOpacity:0, weight:0.4, color:dark?'rgba(255,255,255,0.18)':'rgba(0,0,0,0.18)', opacity:0.6 };
    if (seatDots)  return { fillColor:dark?'#1f2937':'#EEF1F5', fillOpacity:isSel?0.5:0.35, weight:isSel?1.4:0.6, color:isSel?(dark?'#fff':'#111'):border, opacity:0.7 };
    if (!constId)  return { fillColor:dark?'#374151':'#E5E7EB', fillOpacity:0.5, weight:0.4, color:border, opacity:1 };

    const simFrac    = simConstFractions?.[constId];
    const hasSimData = simFrac !== undefined && simFrac > 0;

    if (blankMode && !hasSimData) {
      const hasOverride = !!constOverrides?.[constId] && Object.keys(constOverrides[constId]!).length > 0;
      if (!hasOverride) return { fillColor:dark?'#1f2937':'#d1d5db', fillOpacity:0.7, weight:isSel?2:0.4, color:isSel?'#c8a020':border, opacity:1 };
    }
    const isDeclared = !declaredConsts || declaredConsts.has(constId);
    if (!isDeclared && !hasSimData) return { fillColor:dark?'#1f2937':'#d1d5db', fillOpacity:0.7, weight:0.4, color:border, opacity:1 };

    const effectiveNatPcts = simNatPcts ?? natPcts;
    const live    = euLiveVotes(simConstVotes, constId);   // noisy live tally → winner can flicker early
    const fill    = live ? fillFromPcts(euPctsFromVotes(live), dark) : getCountryFill(effectiveNatPcts, constId, dark, constOverrides?.[constId]);
    const opacity = isDeclared ? 0.80 : Math.max(0.35, 0.80 * (simFrac ?? 1));
    return { fillColor:fill, fillOpacity:opacity, weight:isSel?2:0.5, color:isSel?'#c8a020':border, opacity:1 };
  }, [natPcts, selectedConst, dark, bubbleMap, seatDots, declaredConsts, constOverrides, blankMode, simConstFractions, simNatPcts, simConstVotes]);

  useEffect(() => { layerRef.current?.setStyle((f:any)=>getStyle(f)); }, [getStyle]);

  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const geoId   = String(feature?.properties?.code ?? '');
    const constId = EU_GEOID_TO_ID[geoId];

    layer.on('click', () => { if (constId) onSelectRef.current(constId); });
    layer.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (!constId) { setTooltip(null); return; }
      const draft    = constDraftRef2.current;
      const hasDraft = draft?.constId === constId;
      if (blankModeRef.current && !declaredRef.current) {
        const hasOverride = !!constOverridesRef.current[constId] && Object.keys(constOverridesRef.current[constId]!).length > 0;
        const hasSim      = (simFracRef2.current[constId] ?? 0) > 0;
        if (!hasOverride && !hasDraft && !hasSim) { setTooltip(null); return; }
      }
      const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
      const overrideToUse = hasDraft ? draft!.pcts : constOverridesRef.current?.[constId];
      const fraction      = hasDraft ? draft!.rptPct/100 : simFracRef2.current[constId] ?? (declaredRef.current?.has(constId) ? 1 : undefined);
      const effectiveNatPcts = simNatPctsRef2.current ?? natPctsRef.current;
      const c        = EU_COUNTRY_MAP[constId];
      const cVotes   = c?.validVotes ?? 0;
      const live     = euLiveVotes(simVotesRef2.current, constId);   // live noisy counts during a sim
      let parties: { id:EuGroupId; pct:number; rawVotes:number; projSeats:number }[];
      if (live) {
        const pcts = euPctsFromVotes(live);
        const projSeats = calcDHondtCountry(live, c?.seats ?? 0, constId);
        parties = (Object.entries(live) as [EuGroupId,number][])
          .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,9)
          .map(([id,votes]) => ({ id, pct:pcts[id]??0, rawVotes:votes, projSeats:projSeats[id]??0 }));
      } else {
        const pv       = calcCountryVotes(effectiveNatPcts, constId, overrideToUse);
        const projSeats= calcDHondtCountry(pv, c?.seats ?? 0, constId);
        parties = (Object.entries(pv) as [EuGroupId,number][])
          .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,9)
          .map(([id,pct]) => ({ id:id as EuGroupId, pct,
            rawVotes:Math.round(pct/100*cVotes*(fraction??1)),
            projSeats:projSeats[id as EuGroupId]??0 }));
      }
      setTooltip({ x:e.originalEvent.clientX-rect.left, y:e.originalEvent.clientY-rect.top,
        name:c?.name??geoId, code:c?.id??geoId, seats:c?.seats??0,
        parties, leader:parties[0]?.id??null,
        reportingPct:fraction!=null ? Math.round(fraction*100) : undefined });
    });
    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[50.2, 10.0]} zoom={4} minZoom={3} style={{ width:'100%', height:'100%' }} zoomControl worldCopyJump={false}>
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
          <EuBubbleLayer
            geoData={geoData} natPcts={simNatPcts ?? natPcts} containerRef={containerRef}
            setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef}
            declaredConsts={declaredConsts} constOverrides={constOverrides}
            constOverridesRef={constOverridesRef} blankMode={blankMode}
            projectedConsts={projectedConsts} simConstFractions={simConstFractions}
            simNatPctsRef={simNatPctsRef2}
          />
        )}
        {geoData && seatDots && (
          <EuSeatDotsLayer
            geoData={geoData} natPcts={simNatPcts ?? natPcts} containerRef={containerRef}
            setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef}
            declaredConsts={declaredConsts} constOverrides={constOverrides}
            constOverridesRef={constOverridesRef} blankMode={blankMode}
            projectedConsts={projectedConsts} simConstFractions={simConstFractions}
            simNatPctsRef={simNatPctsRef2}
          />
        )}
      </MapContainer>

      {/* ── Tooltip ── */}
      {tooltip && (() => {
        const cw = containerRef.current?.clientWidth ?? 9999; const TW = 248;
        const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const tt = { bg:dark?'rgba(18,24,44,0.97)':'rgba(255,255,255,0.98)', border:dark?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.09)', shadow:dark?'0 6px 28px rgba(0,0,0,0.55)':'0 6px 28px rgba(0,0,0,0.13)', title:dark?'rgba(255,255,255,0.93)':'rgba(0,0,0,0.86)', sub:dark?'rgba(255,255,255,0.40)':'rgba(0,0,0,0.42)', body:dark?'rgba(255,255,255,0.86)':'rgba(0,0,0,0.79)' };
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top:Math.max(6, tooltip.y - 20), width:TW }}>
            <div style={{ background:tt.bg, borderRadius:10, border:`1px solid ${tt.border}`, boxShadow:tt.shadow, backdropFilter:'blur(12px)', padding:'12px 14px' }}>
              <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:6 }}>
                <div style={{ fontSize:13, fontWeight:700, color:tt.title, lineHeight:1.2 }}>{tooltip.name}</div>
                <div style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', color:tt.sub }}>{tooltip.code} · {tooltip.seats} MEPs</div>
              </div>
              {(() => {
                const rp = tooltip.reportingPct;
                if (rp == null) return <div style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', color:tt.sub, marginTop:2 }}>Estimated national result</div>;
                const live = rp < 100;
                return (
                  <div className={live ? 'animate-pulse' : ''} style={{ fontSize:10, fontFamily:'"JetBrains Mono",monospace', fontWeight:800, letterSpacing:'0.04em', marginTop:2, color: live ? '#FFCC00' : '#16a34a', display:'flex', alignItems:'center', gap:5 }}>
                    {live && <span style={{ width:6, height:6, borderRadius:99, background:'#ef4444', boxShadow:'0 0 6px #ef4444', display:'inline-block' }} />}
                    {live ? `${rp}% REPORTING` : '✓ 100% REPORTING'}
                  </div>
                );
              })()}
              <div style={{ marginTop:9, display:'flex', flexDirection:'column', gap:5 }}>
                {tooltip.parties.map(({ id, pct, rawVotes, projSeats }, i) => {
                  const pColor = partyColor(id);
                  return (
                    <div key={id} style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:7, height:7, borderRadius:2, flexShrink:0, background:pColor }} />
                      <span style={{ flex:1, fontSize:11, fontWeight:i===0?600:400, color:tt.body, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{EU_GROUP_MAP[id]?.name??id}</span>
                      {rawVotes!=null && (
                        <span style={{ fontSize:9.5, fontFamily:'"JetBrains Mono",monospace', color:tt.sub }}>{rawVotes.toLocaleString()}</span>
                      )}
                      <span style={{ fontSize:11, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color:pColor, minWidth:42, textAlign:'right' }}>{pct.toFixed(1)}%</span>
                      {projSeats!=null && projSeats>0 && (
                        <span style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', fontWeight:700, color:tt.body, minWidth:14, textAlign:'right' }}>{projSeats}s</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
      <div className="absolute bottom-2 right-2 text-[10px] text-ink-3 select-none z-[1000] font-mono">Scroll to zoom · Click a country</div>
    </div>
  );
}

// ── Parliament hemicycle — 720 seats ──────────────────────────────────────────
function EuParliamentPanel({
  seats: seatsMap, onClose, exiting, dark,
}: {
  seats: Partial<Record<EuGroupId, number>>; onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const order = EU_LR_ORDER;
  const totalSeats = order.reduce((s, id) => s + (seatsMap[id] ?? 0), 0);
  const flat: EuGroupId[] = [];
  for (const id of order) {
    const n = seatsMap[id] ?? 0;
    for (let i = 0; i < n; i++) flat.push(id);
  }

  const ROWS = 14;
  const innerR = 82, outerR = 250;
  const rowR  = Array.from({ length: ROWS }, (_, i) => innerR + (outerR - innerR) * (i / (ROWS - 1)));
  const arcLen = rowR.reduce((s, r) => s + r * Math.PI, 0);
  const perRow = rowR.map(r => Math.max(1, Math.round((r * Math.PI / arcLen) * totalSeats)));
  let diff = totalSeats - perRow.reduce((s, n) => s + n, 0);
  let idx = perRow.length - 1;
  while (diff !== 0) { perRow[idx] += diff > 0 ? 1 : -1; diff += diff > 0 ? -1 : 1; idx = (idx - 1 + perRow.length) % perRow.length; }

  const slots: { x: number; y: number; angle: number; r: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    const r = rowR[row];
    const count = perRow[row];
    for (let i = 0; i < count; i++) {
      const tFrac = count === 1 ? 0.5 : i / (count - 1);
      const angle = Math.PI - tFrac * Math.PI;
      slots.push({ x: 280 + Math.cos(angle) * r, y: 286 - Math.sin(angle) * r, angle, r });
    }
  }
  slots.sort((a, b) => (b.angle - a.angle) || (a.r - b.r));
  const dots = slots.map((s, k) => ({
    x: s.x, y: s.y, r: 3.4,
    color: partyColor(flat[k] ?? order[order.length - 1]),
  }));

  return (
    <aside className={`w-[520px] shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">European Parliament — Composition</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{totalSeats} of {EU_TOTAL_SEATS} seats · Majority {EU_MAJORITY}</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 thin-scroll">
        <svg viewBox="0 0 560 300" width="100%" height="auto" style={{ display:'block' }}>
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.color} stroke={dark?'rgba(0,0,0,0.35)':'rgba(255,255,255,0.85)'} strokeWidth="0.5" />
          ))}
          <line x1="280" y1="22" x2="280" y2="66" stroke={dark?'rgba(255,255,255,0.35)':'rgba(0,0,0,0.45)'} strokeWidth="1" strokeDasharray="3 3" />
          <text x="280" y="16" textAnchor="middle" fontSize="9" fontFamily="JetBrains Mono, monospace" fill={dark?'rgba(255,255,255,0.55)':'rgba(0,0,0,0.55)'}>{EU_MAJORITY}</text>
        </svg>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {order.map(id => {
            const n = seatsMap[id] ?? 0; if (n === 0) return null;
            const p = EU_GROUP_MAP[id];
            return (
              <div key={id} className="flex items-center gap-2 px-2 py-1.5 rounded-[4px] border border-default">
                <span style={{ width:10, height:10, borderRadius:2, background:p.color }} />
                <span className="text-[11px] font-semibold text-ink">{p.name}</span>
                <span className="ml-auto text-[11px] font-mono text-ink-2">{n}</span>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

// ── Coalition builder ─────────────────────────────────────────────────────────
function EuCoalitionPanel({ seats, onClose, exiting, dark: _dark }: {
  seats: Partial<Record<EuGroupId, number>>; onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const [selected, setSelected] = useState<Set<EuGroupId>>(new Set());
  const total = useMemo(() => Array.from(selected).reduce((s, id) => s + (seats[id] ?? 0), 0), [selected, seats]);
  const presets: { name: string; ids: EuGroupId[] }[] = [
    { name: 'Von der Leyen majority (EPP+S&D+RE)', ids: ['EPP','SD','RE'] },
    { name: 'Pro-EU broad (EPP+S&D+RE+Greens)',    ids: ['EPP','SD','RE','GREENS'] },
    { name: 'Right bloc (EPP+ECR+PfE)',            ids: ['EPP','ECR','PfE'] },
    { name: 'Left bloc (S&D+RE+Greens+Left)',      ids: ['SD','RE','GREENS','LEFT'] },
  ];

  return (
    <aside className={`w-[360px] shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">Coalition Builder</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Majority needs {EU_MAJORITY} / {EU_TOTAL_SEATS}</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll">
        <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.16em] text-ink-3 mb-2">Presets</div>
        <div className="flex flex-col gap-1.5 mb-4">
          {presets.map(p => {
            const t = p.ids.reduce((s, id) => s + (seats[id] ?? 0), 0);
            return (
              <button key={p.name}
                onClick={() => setSelected(new Set(p.ids))}
                className="text-left px-2.5 py-1.5 rounded-[4px] border border-default hover:bg-hover text-[11px] text-ink flex items-center justify-between">
                <span>{p.name}</span>
                <span className={`font-mono font-bold ${t >= EU_MAJORITY ? 'text-emerald-600' : 'text-ink-3'}`}>{t}</span>
              </button>
            );
          })}
        </div>
        <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.16em] text-ink-3 mb-2">Groups</div>
        <div className="flex flex-col gap-1.5">
          {EU_LR_ORDER.map(id => {
            const p = EU_GROUP_MAP[id]; const n = seats[id] ?? 0;
            const isSel = selected.has(id);
            return (
              <button key={id}
                onClick={() => { const next = new Set(selected); isSel ? next.delete(id) : next.add(id); setSelected(next); }}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-[4px] border text-[11px] ${isSel ? 'bg-hover border-gold text-ink' : 'border-default text-ink-3 hover:text-ink'}`}>
                <span style={{ width:10, height:10, borderRadius:2, background:p.color }} />
                <span className="font-semibold">{p.name}</span>
                <span className="text-ink-3 ml-1 truncate">{p.fullName}</span>
                <span className="ml-auto font-mono font-bold">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 pt-3 border-t border-default flex items-baseline justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wide text-ink-3">Total coalition seats</span>
          <span className={`text-2xl font-mono font-bold ${total >= EU_MAJORITY ? 'text-emerald-600' : 'text-ink'}`}>{total}</span>
        </div>
        {total >= EU_MAJORITY && (
          <div className="mt-2 text-[10px] font-mono text-emerald-600">✓ This coalition commands a majority.</div>
        )}
      </div>
    </aside>
  );
}

// ── Groups panel (hide/show) ──────────────────────────────────────────────────
function EuGroupsPanel({ hiddenParties, onToggle, onClose, dark: _dark }: {
  hiddenParties: Set<EuGroupId>; onToggle: (id: EuGroupId) => void; onClose: () => void; dark?: boolean;
}) {
  return (
    <aside className="absolute right-3 top-3 z-[60] w-72 bg-white border border-default rounded-[6px] shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-default">
        <h2 className="text-[12px] font-bold text-ink">Political Groups</h2>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-2 py-2 thin-scroll">
        {EU_SLIDER_ORDER.map(id => {
          const p = EU_GROUP_MAP[id]; const hidden = hiddenParties.has(id);
          return (
            <button key={id} onClick={() => onToggle(id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-[4px] hover:bg-hover text-left text-[11px] ${hidden ? 'opacity-40' : ''}`}>
              <span style={{ width:10, height:10, borderRadius:2, background:p.color }} />
              <span className="font-semibold text-ink">{p.name}</span>
              <span className="text-ink-3 truncate">{p.fullName}</span>
              <span className="ml-auto text-[9px] font-mono text-ink-3 uppercase">{p.noSeats?'—':`${p.seats2024}s`}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ── Per-country 2024 baseline reference popup (opens left of the editor) ───────
function EuCountryBaselinePanel({ countryId, onClose, dark }: {
  countryId: EuCountryId; onClose: () => void; dark?: boolean;
}) {
  const c = EU_COUNTRY_MAP[countryId];
  const rows = EU_LR_ORDER
    .map(id => ({ id, seats: c.seats2024[id] ?? 0, votes: c.raw2024[id] ?? 0 }))
    .filter(r => r.votes > 0 || r.seats > 0)
    .sort((a, b) => b.seats - a.seats || b.votes - a.votes);
  const oth = c.raw2024.OTH ?? 0;
  const cardBg = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
  const ink3 = dark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.35)';
  return (
    <aside className={`w-64 shrink-0 ${dark ? 'bg-[#0a1626]' : 'bg-[#fbfaf7]'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-start justify-between">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-tight">{c.name} — 2024 result</h2>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Actual baseline · {c.seats} MEPs · {c.turnout}% turnout</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-3 py-3 space-y-1.5">
        {rows.map(r => {
          const p = EU_GROUP_MAP[r.id];
          const pct = c.validVotes > 0 ? r.votes / c.validVotes * 100 : 0;
          return (
            <div key={r.id} style={{ background: cardBg, borderRadius:5, padding:'5px 8px', borderLeft:`3px solid ${p.color}` }}>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-ink flex-1 truncate">{p.name}</span>
                <span className="text-[9px] font-mono" style={{ color: ink3 }}>{r.votes.toLocaleString()}</span>
                <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color:p.color, minWidth:38, textAlign:'right' }}>{pct.toFixed(1)}%</span>
                <span className="text-[11px] font-mono font-black" style={{ color:p.color, minWidth:20, textAlign:'right' }}>{r.seats}</span>
              </div>
            </div>
          );
        })}
        {oth > 0 && (
          <div style={{ background: cardBg, borderRadius:5, padding:'5px 8px', borderLeft:`3px solid ${EU_GROUP_MAP.OTH.color}` }}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-ink flex-1 truncate">Others (no seats)</span>
              <span className="text-[9px] font-mono" style={{ color: ink3 }}>{oth.toLocaleString()}</span>
              <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color:EU_GROUP_MAP.OTH.color, minWidth:38, textAlign:'right' }}>{(oth/c.validVotes*100).toFixed(1)}%</span>
              <span className="text-[11px] font-mono font-black" style={{ color:ink3, minWidth:20, textAlign:'right' }}>0</span>
            </div>
          </div>
        )}
        <div className="text-[8px] font-mono pt-1.5" style={{ color: ink3 }}>
          {c.validVotes.toLocaleString()} valid votes · reference only
        </div>
      </div>
    </aside>
  );
}

// ── Country editor / blank-map slider panel ───────────────────────────────────
function EuCountryPanel({
  constId, natPcts, constOverride, onOverride, onResetOverride, onClose,
  isBlankMode, isProjected, reportingPct, onProject, onReportingPctChange,
  onDraftChange, hiddenParties, dark, baselineOpen, onToggleBaseline,
}: {
  constId: EuCountryId; natPcts: Record<EuGroupId, number>;
  constOverride?: Partial<Record<EuGroupId, number>>;
  onOverride: (pcts: Partial<Record<EuGroupId, number>>) => void;
  onResetOverride: () => void; onClose: () => void;
  isBlankMode?: boolean; isProjected?: boolean; reportingPct?: number;
  onProject?: () => void; onReportingPctChange?: (pct: number) => void;
  onDraftChange?: (pcts: Record<EuGroupId, number>, rptPct: number) => void;
  hiddenParties?: Set<EuGroupId>; dark?: boolean;
  baselineOpen?: boolean; onToggleBaseline?: () => void;
}) {
  const [locks, setLocks] = useState<Set<EuGroupId>>(new Set());
  const baseVotes = useMemo(() => calcCountryVotes(natPcts, constId), [natPcts, constId]);
  const [draftPcts, setDraftPcts] = useState<Record<EuGroupId, number>>(() =>
    constOverride && Object.keys(constOverride).length > 0
      ? { ...calcCountryVotes(natPcts, constId, constOverride) }
      : { ...baseVotes });
  const [localRptPct, setLocalRptPct] = useState(reportingPct ?? 100);
  const [touched, setTouched] = useState(!!constOverride && Object.keys(constOverride).length > 0);

  useEffect(() => {
    setLocks(new Set());
    const base = calcCountryVotes(natPcts, constId);
    setDraftPcts(constOverride && Object.keys(constOverride).length > 0
      ? { ...calcCountryVotes(natPcts, constId, constOverride) } : { ...base });
    setLocalRptPct(reportingPct ?? 100);
    setTouched(!!constOverride && Object.keys(constOverride).length > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constId]);

  useEffect(() => { if (isBlankMode) onDraftChange?.(draftPcts, localRptPct); }, [draftPcts, localRptPct, isBlankMode]); // eslint-disable-line

  const effectiveLocks = useMemo(() => new Set<EuGroupId>([...locks, ...(hiddenParties ?? [])]), [locks, hiddenParties]);
  const displayPv  = isBlankMode ? draftPcts : calcCountryVotes(natPcts, constId, constOverride);
  const [sortedIds] = useState<EuGroupId[]>(() =>
    EU_GROUPS.map(p => p.id).filter(id => (baseVotes[id] ?? 0) > 0)
      .sort((a, b) => (baseVotes[b] ?? 0) - (baseVotes[a] ?? 0)));
  const c           = EU_COUNTRY_MAP[constId];
  const winner      = EU_GROUPS.filter(p=>!p.noSeats).reduce((best, p) => (displayPv[p.id] ?? 0) > (displayPv[best.id] ?? 0) ? p : best, EU_GROUPS[0]);
  const hasOverride = !!constOverride && Object.keys(constOverride).length > 0;
  const constTotalVotes = c?.validVotes ?? 0;
  const countryThr = EU_COUNTRY_THRESHOLD[constId] ?? 0;
  const sliderTrack = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';

  const handleSlider = (id: EuGroupId, val: number) => {
    if (isBlankMode) { setDraftPcts(redistributePcts(draftPcts, id, val, effectiveLocks)); setTouched(true); }
    else onOverride(redistributePcts(displayPv as Record<EuGroupId, number>, id, val, effectiveLocks));
  };
  const handleProject = () => {
    if (!touched) return;
    onOverride(draftPcts);
    onReportingPctChange?.(localRptPct);
    onProject?.();
  };

  return (
    <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-bold text-ink leading-tight truncate">{c?.name ?? constId}</h2>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {c?.id} · {c?.seats ?? 0} MEPs · {countryThr > 0 ? `${countryThr}% threshold` : 'no threshold'} ·{' '}
              {isBlankMode
                ? (isProjected ? 'Projected · adjust & re-project' : 'Blank · set result')
                : (hasOverride ? 'Custom override' : 'Estimated · drag sliders')}
            </p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button onClick={onToggleBaseline}
            className={`text-[10px] font-mono px-2 py-1 rounded-[4px] border transition-colors ${baselineOpen ? 'bg-gold text-white border-gold' : 'border-default text-ink-3 hover:bg-hover hover:text-ink'}`}>
            📋 2024 result
          </button>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-[4px] flex-1 min-w-0"
            style={{ borderLeft:`3px solid ${winner.color}`, background:dark ? 'rgba(255,255,255,0.04)' : '#f8f7f4' }}>
            <span className="text-[11px] font-medium text-ink flex-1 truncate">{winner.name}</span>
            <span className="text-[9px] font-mono text-ink-3">{(displayPv[winner.id] ?? 0).toFixed(1)}%</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {isBlankMode && (
          <div className="px-3.5 pt-3 pb-3 border-b border-default">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[8px] font-mono font-bold uppercase tracking-[0.14em]"
                style={{ color: dark ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.40)' }}>% Reporting</span>
              <span className="text-[13px] font-mono font-black tabular-nums"
                style={{ color: localRptPct < 50 ? '#ef4444' : localRptPct < 100 ? '#f59e0b' : '#16a34a' }}>{localRptPct}%</span>
            </div>
            <div style={{ position:'relative', height:18, display:'flex', alignItems:'center' }}>
              <div style={{ position:'absolute', left:0, right:0, height:4, borderRadius:4, background:sliderTrack }} />
              <div style={{ position:'absolute', left:0, width:`${localRptPct}%`, height:4, borderRadius:4,
                background: localRptPct < 50 ? '#ef4444' : localRptPct < 100 ? '#f59e0b' : '#16a34a',
                transition:'width 0.05s' }} />
              <input type="range" min={1} max={100} step={1} value={localRptPct}
                onChange={e => { setLocalRptPct(+e.target.value); setTouched(true); }}
                className="br-party-slider w-full"
                style={{ '--party-color': localRptPct < 50 ? '#ef4444' : localRptPct < 100 ? '#f59e0b' : '#16a34a',
                  '--pct':`${localRptPct}%`, position:'relative', zIndex:1 } as React.CSSProperties} />
            </div>
            <div className="text-[8px] font-mono mt-0.5"
              style={{ color: dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.32)' }}>
              ≈{Math.round(constTotalVotes * localRptPct / 100).toLocaleString()} votes counted
            </div>
          </div>
        )}
        <div className="px-3.5 space-y-3 py-3">
          {sortedIds.filter(id => !hiddenParties?.has(id) && (isBlankMode || (displayPv[id] ?? 0) >= 0.1 || locks.has(id))).map(id => {
            const p = EU_GROUP_MAP[id];
            const pct = displayPv[id] ?? 0;
            const isLocked = locks.has(id);
            const color = p.color;
            const rawVotes = Math.round((pct / 100) * constTotalVotes * (isBlankMode ? localRptPct / 100 : 1));
            const belowThresh = !p.noSeats && countryThr > 0 && pct < countryThr;
            return (
              <div key={id}>
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background:color }} />
                  <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{p.fullName}</span>
                  <button onClick={() => setLocks(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })}
                    className={`w-4 h-4 flex items-center justify-center shrink-0 ${isLocked ? 'text-gold' : 'text-ink-3 hover:text-ink'}`}>
                    {isLocked
                      ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
                      : <svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>}
                  </button>
                  <span className="text-[10px] font-mono font-bold tabular-nums" style={{ color }}>{pct.toFixed(1)}%</span>
                </div>
                <input type="range" min={0} max={100} step={0.1} value={pct} disabled={isLocked}
                  onChange={e => handleSlider(id, parseFloat(e.target.value))}
                  className="br-party-slider w-full"
                  style={{ '--party-color': color, '--pct':`${pct}%` } as React.CSSProperties} />
                <div className="flex justify-between mt-0.5">
                  <span className="text-[8px] font-mono" style={{ color: dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.28)' }}>
                    {rawVotes.toLocaleString()} votes
                  </span>
                  {belowThresh && (
                    <span className="text-[7.5px] font-mono" style={{ color:'#f59e0b' }}>
                      ⚠ {pct.toFixed(1)}% &lt; {countryThr}% threshold
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {isBlankMode ? (
        <div className="px-3.5 py-2.5 border-t border-default shrink-0 space-y-1.5">
          <button onClick={handleProject} disabled={!touched}
            className={`w-full h-8 rounded-[4px] text-[11px] font-mono font-semibold uppercase tracking-wide transition-colors ${
              !touched ? 'border border-default text-ink-3 opacity-50 cursor-not-allowed'
                : isProjected ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            {!touched ? 'Adjust a slider first' : isProjected ? '↻ Update Projection' : '📍 Project Result'}
          </button>
          {hasOverride && (
            <button onClick={() => { onResetOverride(); setTouched(false); setDraftPcts({ ...calcCountryVotes(natPcts, constId) }); }}
              className="w-full h-6 rounded-[4px] border border-default text-ink-3 text-[9px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
              Clear projection
            </button>
          )}
        </div>
      ) : hasOverride ? (
        <div className="px-3.5 py-2.5 border-t border-default shrink-0">
          <button onClick={onResetOverride}
            className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
            Reset to calculated
          </button>
        </div>
      ) : null}
    </aside>
  );
}

// ── Breakdown panel — EU group stats + electoral metrics ──────────────────────
const EU_REGIONS: { name: string; ids: EuCountryId[] }[] = [
  { name: 'DACH (DE, AT)',                 ids: ['DE','AT'] },
  { name: 'France & Benelux',              ids: ['FR','BE','NL','LU'] },
  { name: 'Iberia (ES, PT)',               ids: ['ES','PT'] },
  { name: 'Italy & Malta',                 ids: ['IT','MT'] },
  { name: 'Visegrád (PL, CZ, SK, HU)',     ids: ['PL','CZ','SK','HU'] },
  { name: 'Balkans (RO, BG, HR, SI, EL, CY)', ids: ['RO','BG','HR','SI','EL','CY'] },
  { name: 'Nordics (SE, DK, FI)',          ids: ['SE','DK','FI'] },
  { name: 'Baltics (EE, LV, LT)',          ids: ['EE','LV','LT'] },
  { name: 'Ireland',                       ids: ['IE'] },
];

function EuBreakdownPanel({
  seats, natPcts, isBaseline, onClose, exiting, dark, constOverrides,
}: {
  seats: Partial<Record<EuGroupId, number>>; natPcts: Record<EuGroupId, number>;
  isBaseline?: boolean; onClose: () => void; exiting?: boolean; dark?: boolean;
  constOverrides?: Partial<Record<EuCountryId, Partial<Record<EuGroupId, number>>>>;
}) {
  const totalS = EU_LR_ORDER.reduce((s, id) => s + (seats[id] ?? 0), 0);
  const totalV = EU_GROUPS.reduce((s, p) => s + (natPcts[p.id] ?? 0), 0);

  const enp = totalS > 0 ? 1 / EU_LR_ORDER.reduce((s, id) => { const sh = (seats[id] ?? 0) / totalS; return s + sh * sh; }, 0) : 0;
  const gallagher = Math.sqrt(EU_GROUPS.reduce((s, p) => {
    const v = totalV > 0 ? (natPcts[p.id] ?? 0) / totalV * 100 : 0;
    const sv = totalS > 0 ? (seats[p.id] ?? 0) / totalS * 100 : 0;
    return s + Math.pow(v - sv, 2);
  }, 0) / 2);
  const largest = [...EU_LR_ORDER].sort((a, b) => (seats[b] ?? 0) - (seats[a] ?? 0))[0];
  const shortOf = EU_MAJORITY - (seats[largest] ?? 0);

  const regionWinners = useMemo(() => {
    return EU_REGIONS.map(v => {
      const tally: Partial<Record<EuGroupId, number>> = {};
      let totSeats = 0;
      for (const cId of v.ids) {
        const c = EU_COUNTRY_MAP[cId];
        const cv = calcCountryVotes(natPcts, cId, constOverrides?.[cId]);
        for (const p of EU_GROUPS) if(!p.noSeats) tally[p.id] = (tally[p.id] ?? 0) + (cv[p.id] ?? 0) * c.validVotes / 100;
        totSeats += c.seats;
      }
      const sorted = (Object.entries(tally) as [EuGroupId, number][]).sort(([, a], [, b]) => b - a);
      const total = sorted.reduce((s, [, v]) => s + v, 0);
      const win = sorted[0];
      return { name: v.name, winner: win?.[0] as EuGroupId, share: total > 0 ? (win?.[1] ?? 0) / total * 100 : 0, totalSeats: totSeats };
    });
  }, [natPcts, constOverrides]);

  const ink2 = dark ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.42)';
  const ink3 = dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  const cardBg = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';

  function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div>
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.18em] mb-2" style={{ color: ink3 }}>{title}</div>
        <div className="space-y-1.5">{children}</div>
      </div>
    );
  }
  function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
      <div className="flex items-baseline justify-between gap-2" style={{ background: cardBg, borderRadius:5, padding:'5px 8px' }}>
        <span className="text-[9.5px] font-mono text-ink-3 flex-1">{label}</span>
        <div className="text-right"><span className="text-[11px] font-mono font-bold text-ink">{value}</span>
          {sub && <div className="text-[7.5px] font-mono" style={{ color: ink3 }}>{sub}</div>}</div>
      </div>
    );
  }

  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Breakdown</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">European Parliament — nerd stats</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      {totalS === 0 ? (
        <div className="flex items-center justify-center flex-1 text-[11px] font-mono text-ink-3 px-4 text-center">Load results or run simulation first</div>
      ) : (
        <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3.5 space-y-5">
          <Section title="Seats by Group">
            {[...EU_LR_ORDER].filter(id => (seats[id] ?? 0) > 0).sort((a, b) => (seats[b] ?? 0) - (seats[a] ?? 0)).map(id => {
              const p = EU_GROUP_MAP[id]; const n = seats[id] ?? 0;
              return (
                <div key={id} style={{ background: cardBg, borderRadius:5, padding:'6px 8px', borderLeft:`3px solid ${p.color}` }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-bold text-ink">{p.name}</div>
                      <div className="text-[8px] font-mono" style={{ color: ink2 }}>{p.fullName}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-[18px] font-black font-mono" style={{ color: p.color }}>{n}</span>
                      <div className="text-[7.5px] font-mono" style={{ color: n >= EU_MAJORITY ? '#16a34a' : ink3 }}>
                        {n >= EU_MAJORITY ? '✓ majority' : `${(n / EU_TOTAL_SEATS * 100).toFixed(1)}% of seats`}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full overflow-hidden"
                    style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                    <div style={{ width:`${Math.min(n / EU_TOTAL_SEATS * 100 * 2.5, 100)}%`, height:'100%', borderRadius:4, background: p.color }} />
                  </div>
                </div>
              );
            })}
          </Section>

          <Section title="Electoral Statistics">
            <Stat label="Effective No. of Groups (ENP)" value={enp.toFixed(2)} sub="1/Σsᵢ² — higher = more fragmented" />
            <Stat label="Gallagher Index" value={gallagher.toFixed(2)} sub="vote→seat disproportionality" />
            <Stat label="Largest group" value={`${EU_GROUP_MAP[largest]?.name} — ${seats[largest] ?? 0}`}
              sub={shortOf > 0 ? `${shortOf} short of a majority` : '✓ Absolute majority'} />
            <Stat label="Grand-coalition (EPP+S&D+RE)" value={`${(seats.EPP??0)+(seats.SD??0)+(seats.RE??0)}`} sub={`needs ${EU_MAJORITY} for majority`} />
          </Section>

          <Section title="Swing vs 2024 result">
            {EU_LR_ORDER.filter(id => (natPcts[id] ?? 0) > 0.2 || (isBaseline && (EU_VOTE_PCT_2024[id] ?? 0) > 0)).map(id => {
              const vSwing = (natPcts[id] ?? 0) - (EU_VOTE_PCT_2024[id] ?? 0);
              const sSwing = (seats[id] ?? 0) - (EU_GROUP_MAP[id].seats2024 ?? 0);
              const color = partyColor(id);
              return (
                <div key={id} style={{ background: cardBg, borderRadius:5, padding:'5px 8px', display:'flex', alignItems:'center', gap:8 }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[10px] font-medium text-ink flex-1">{EU_GROUP_MAP[id].name}</span>
                  <span className="text-[9px] font-mono tabular-nums" style={{ color: vSwing >= 0 ? '#16a34a' : '#ef4444', minWidth:42, textAlign:'right' }}>
                    {vSwing >= 0 ? '+' : ''}{vSwing.toFixed(1)}%
                  </span>
                  <span className="text-[9px] font-mono tabular-nums" style={{ color: sSwing >= 0 ? '#16a34a' : '#ef4444', minWidth:36, textAlign:'right' }}>
                    {sSwing >= 0 ? '+' : ''}{sSwing}s
                  </span>
                </div>
              );
            })}
          </Section>

          <Section title="Vote → Seat Translation">
            {EU_LR_ORDER.filter(id => (natPcts[id] ?? 0) >= 0.5).map(id => {
              const vPct = totalV > 0 ? (natPcts[id] ?? 0) / totalV * 100 : 0;
              const sPct = totalS > 0 ? (seats[id] ?? 0) / totalS * 100 : 0;
              const diff = sPct - vPct;
              const color = partyColor(id);
              return (
                <div key={id} style={{ background: cardBg, borderRadius:5, padding:'5px 8px' }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9.5px] font-medium text-ink">{EU_GROUP_MAP[id].name}</span>
                    <span className="text-[8.5px] font-mono" style={{ color: Math.abs(diff) < 1 ? ink3 : diff > 0 ? '#16a34a' : '#ef4444' }}>
                      {diff > 0 ? '+' : ''}{diff.toFixed(1)}% seat bonus
                    </span>
                  </div>
                  <div className="flex gap-1 items-center">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}>
                      <div style={{ width:`${Math.min(vPct / 28 * 100, 100)}%`, height:'100%', background: hexToRgba(color, 0.45), borderRadius:4 }} />
                    </div>
                    <span className="text-[7.5px] font-mono text-ink-3 w-8 text-right tabular-nums">{vPct.toFixed(1)}%v</span>
                  </div>
                  <div className="flex gap-1 items-center mt-0.5">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}>
                      <div style={{ width:`${Math.min(sPct / 28 * 100, 100)}%`, height:'100%', background: color, borderRadius:4 }} />
                    </div>
                    <span className="text-[7.5px] font-mono text-ink-3 w-8 text-right tabular-nums">{sPct.toFixed(1)}%s</span>
                  </div>
                </div>
              );
            })}
          </Section>

          <Section title="Regional Strongholds">
            {regionWinners.sort((a, b) => b.totalSeats - a.totalSeats).map(v => {
              const color = partyColor(v.winner);
              return (
                <div key={v.name} style={{ background: cardBg, borderRadius:5, padding:'5px 8px', display:'flex', alignItems:'center', gap:8, borderLeft:`3px solid ${color}` }}>
                  <span className="text-[10px] font-medium text-ink flex-1 truncate">{v.name}</span>
                  <span className="text-[9px] font-mono text-ink-2" style={{ minWidth:34, textAlign:'right' }}>{v.totalSeats} MEP</span>
                  <span className="text-[9px] font-mono font-bold tabular-nums" style={{ color, minWidth:32, textAlign:'right' }}>{v.share.toFixed(0)}%</span>
                  <span className="text-[9px] font-bold" style={{ color, minWidth:48, textAlign:'right' }}>{EU_GROUP_MAP[v.winner]?.name}</span>
                </div>
              );
            })}
          </Section>

          <Section title="Coalition Scenarios">
            {[
              { name:'Von der Leyen majority', emoji:'🤝', ids:['EPP','SD','RE'] as EuGroupId[] },
              { name:'Pro-EU broad front', emoji:'🇪🇺', ids:['EPP','SD','RE','GREENS'] as EuGroupId[] },
              { name:'Right bloc', emoji:'⚔️', ids:['EPP','ECR','PfE'] as EuGroupId[] },
              { name:'Left + centre', emoji:'🌹', ids:['SD','RE','GREENS','LEFT'] as EuGroupId[] },
              { name:'EPP + ECR', emoji:'🏛️', ids:['EPP','ECR'] as EuGroupId[] },
            ].map(c => {
              const cs = c.ids.reduce((s, id) => s + (seats[id] ?? 0), 0);
              const ok = cs >= EU_MAJORITY;
              return (
                <div key={c.name} style={{ background: cardBg, borderRadius:5, padding:'6px 8px', display:'flex', alignItems:'center', gap:8 }}>
                  <span>{c.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[9.5px] font-bold text-ink truncate">{c.name}</div>
                    <div className="text-[7.5px] font-mono" style={{ color: ink3 }}>{c.ids.map(id => EU_GROUP_MAP[id]?.name).join('+')}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] font-black font-mono" style={{ color: ok ? '#16a34a' : '#ef4444' }}>{cs}</div>
                    <div className="text-[7.5px] font-mono" style={{ color: ink3 }}>{ok ? '✓ maj' : '✗ no maj'}</div>
                  </div>
                </div>
              );
            })}
          </Section>
        </div>
      )}
    </aside>
  );
}

// ── Tutorial panel ────────────────────────────────────────────────────────────
function EuTutorialPanel({ onClose, exiting, dark }: { onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const H2 = ({ c }: { c: string }) => <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-4 mb-1.5 first:mt-0">{c}</div>;
  const P  = ({ c }: { c: string }) => <p className="text-[11px] text-ink leading-relaxed mb-2">{c}</p>;
  const Note = ({ c }: { c: string }) => <div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{c}</div>;
  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">European Parliament Election Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2 c="The European Parliament" />
        <P c="The 720 MEPs are elected by the 27 member states, each a single constituency electing between 6 (Malta, Luxembourg, Cyprus) and 96 (Germany) members by proportional representation — 'degressive proportionality' gives smaller countries more seats per capita." />
        <Note c="Voters cast ballots for NATIONAL parties. After the election, those parties sit together in pan-European political groups. This simulator aggregates everything by group." />
        <H2 c="The Political Groups" />
        <P c="Left → right: The Left · Greens/EFA · S&D · Renew · EPP · ECR · Patriots for Europe (PfE) · Europe of Sovereign Nations (ESN) · Non-Inscrits (NI). 'Others' = parties that won no seats." />
        <H2 c="The 2024 Result" />
        <P c="EPP won 188 seats, S&D 136, PfE 84, ECR 78, Renew 77, Greens/EFA 53, The Left 46, ESN 25, NI 33. Ursula von der Leyen (EPP) was re-elected Commission President with a centrist EPP+S&D+Renew majority." />
        <H2 c="Map Presets" />
        <P c="2024 Result — the actual official outcome (real seats and votes). 2026 Polling — a scenario built from the latest EU-wide poll (Europe Elects, Apr 2026) with per-country adjustments for recent elections & news (e.g. Tisza's landslide in Hungary, AfD overtaking the CDU in Germany, the ANO win in Czechia, D66's surge in the Netherlands). Blank Map — project each country yourself on election night." />
        <H2 c="Editing a Country" />
        <P c="Click any country to open its slider panel. Drag a group's slider or lock it. Hit '📋 2024 result' to open that country's actual baseline as a reference. The % reporting slider scales how many votes are counted." />
        <H2 c="Project Result Button" />
        <P c="On the blank map, nothing updates until you click Project Result (or Update Projection). The button only enables after you touch a slider." />
        <H2 c="Seat Allocation" />
        <P c="Projections allocate each country's MEPs by the D'Hondt method over group votes, applying that country's legal threshold. The displayed 2024 baseline uses the real, official per-country seats." />
        <H2 c="Simulation" />
        <P c="Pick a speed (1/2/5/10 min), then Run. Each of the 27 countries reports in 5 random-sized batches on a bell-curve schedule, populating the live map as counts arrive." />
      </div>
    </aside>
  );
}

// ── Reporting widget ──────────────────────────────────────────────────────────
function EuReportingWidget({
  projectedConsts, constReportingPct, simConstFractions, isSim, live, dark,
}: {
  projectedConsts: Set<EuCountryId>; constReportingPct: Partial<Record<EuCountryId, number>>;
  simConstFractions: Partial<Record<EuCountryId, number>>; isSim: boolean; live?: boolean; dark?: boolean;
}) {
  const bg     = dark ? 'rgba(7,13,28,0.90)' : 'rgba(255,255,255,0.94)';
  const border = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';
  const ink2   = dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.42)';

  let reportedVotes = 0, projCount = 0;
  if (isSim) {
    for (const [cId, frac] of Object.entries(simConstFractions) as [EuCountryId, number][]) {
      reportedVotes += (EU_COUNTRY_MAP[cId]?.validVotes ?? 0) * (frac ?? 0);
      if ((frac ?? 0) > 0) projCount++;
    }
  } else {
    for (const cId of projectedConsts) {
      const rPct = (constReportingPct[cId] ?? 100) / 100;
      reportedVotes += (EU_COUNTRY_MAP[cId]?.validVotes ?? 0) * rPct;
      projCount++;
    }
  }
  const reportedPct = Math.min(100, (reportedVotes / EU_GRAND_TOTAL) * 100);
  return (
    <div className="absolute bottom-8 left-3 z-[1001] pointer-events-none"
      style={{ background: bg, border:`1px solid ${border}`, borderRadius:10, backdropFilter:'blur(10px)',
        padding:'10px 13px', minWidth:180, boxShadow:'0 4px 20px rgba(0,0,0,0.18)' }}>
      <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.15em] mb-1.5" style={{ color: live ? '#ef4444' : ink2 }}>
        {live ? (
          <>
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background:'#ef4444' }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background:'#ef4444' }} />
            </span>
            <span>Live Count</span>
          </>
        ) : (
          <span>{isSim ? '⚡ Live Count' : '📊 Results'}</span>
        )}
      </div>
      <div className="text-[13px] font-black font-mono text-ink leading-none">
        {projCount} <span className="text-[10px] font-semibold" style={{ color: ink2 }}>/ {EU_COUNTRIES.length}</span>
      </div>
      <div className="text-[9px] font-mono mt-0.5 mb-2" style={{ color: ink2 }}>
        {isSim ? 'countries declared' : 'countries projected'}
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width:`${reportedPct}%`, background: isSim ? '#3b82f6' : '#16a34a' }} />
      </div>
      <div className="text-[9px] font-mono font-bold mt-1 text-right" style={{ color: isSim ? '#3b82f6' : '#16a34a' }}>
        {reportedPct.toFixed(1)}% of votes
      </div>
    </div>
  );
}

// ── Simulation % input box ────────────────────────────────────────────────────
function EuSimInput({ value, color, dark, onChange }: {
  value: number; color: string; dark: boolean; onChange: (n: number) => void;
}) {
  const [str, setStr] = useState(() => String(+value.toFixed(2)));
  useEffect(() => { if (parseFloat(str) !== value) setStr(String(+value.toFixed(2))); }, [value]); // eslint-disable-line
  return (
    <input
      type="text" inputMode="decimal"
      value={str}
      onChange={e => {
        const s = e.target.value;
        if (!/^\d*\.?\d*$/.test(s)) return;
        setStr(s);
        const n = parseFloat(s);
        onChange(Number.isFinite(n) ? Math.max(0, n) : 0);
      }}
      onBlur={() => { const n = parseFloat(str); setStr(String(Number.isFinite(n) ? +Math.max(0, n).toFixed(2) : 0)); }}
      className={`w-16 h-7 px-1.5 text-right text-[12px] font-mono font-bold tabular-nums rounded-[4px] border outline-none focus:border-blue-500 ${dark ? 'bg-[#0a1626] border-white/15' : 'bg-white border-black/15'}`}
      style={{ color }}
    />
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────
export default function EUApp() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  // ── Preset / national pcts ──────────────────────────────────────────────────
  // Default view on open = the 2026 polling scenario.
  const [preset, setPreset]     = useState<'baseline'|'blank'|'polling2026'|'custom'>('polling2026');
  const [natPcts, setNatPcts]   = useState<Record<EuGroupId, number>>(() => ({ ...EU_VOTE_PCT_2026 }));

  function loadBaseline()  { setNatPcts({ ...EU_VOTE_PCT_2024 }); setPreset('baseline'); resetMapState(); }
  function loadPolling2026() {
    setNatPcts({ ...EU_VOTE_PCT_2026 }); setPreset('polling2026'); resetMapState();
    // Pre-load the modelled 2026 per-country distributions (recent elections / news) as
    // overrides; the ~17 unlisted countries fall back to a uniform national swing.
    setConstOverrides(Object.fromEntries(
      Object.entries(EU_CLIMATE_2026).map(([k, v]) => [k, { ...v }]),
    ) as Partial<Record<EuCountryId, Partial<Record<EuGroupId, number>>>>);
  }
  function loadBlank() {
    const share = 100 / EU_PROSPECTIVE.length;
    setNatPcts(Object.fromEntries(EU_GROUPS.map(p => [p.id, EU_PROSPECTIVE.includes(p.id) ? share : 0])) as Record<EuGroupId, number>);
    setPreset('blank'); resetMapState();
  }

  function resetMapState() {
    setSimSeats(undefined); setDeclaredConsts(undefined);
    setConstOverrides({}); setProjectedConsts(new Set());
    setConstReportingPct({}); setSimConstFractions({}); setSimConstVotes({});
    setConstDraft(null); setSimNatPcts(null); stopSim();
  }

  // ── Country overrides (blank map) ────────────────────────────────────────────
  const [constOverrides, setConstOverrides]       = useState<Partial<Record<EuCountryId, Partial<Record<EuGroupId, number>>>>>(
    () => Object.fromEntries(Object.entries(EU_CLIMATE_2026).map(([k, v]) => [k, { ...v }])) as Partial<Record<EuCountryId, Partial<Record<EuGroupId, number>>>>);
  const [projectedConsts, setProjectedConsts]     = useState<Set<EuCountryId>>(new Set());
  const [constReportingPct, setConstReportingPct] = useState<Partial<Record<EuCountryId, number>>>({});
  const [constDraft, setConstDraft]               = useState<EuCountryDraft>(null);
  const [baselineRefOpen, setBaselineRefOpen]     = useState(false);

  const blankDisplayPcts = useMemo<Record<EuGroupId, number>>(() => {
    const zero = Object.fromEntries(EU_GROUPS.map(p => [p.id, 0])) as Record<EuGroupId, number>;
    if (preset !== 'blank') return zero;
    const weighted: Partial<Record<EuGroupId, number>> = {};
    let totalW = 0;
    for (const cId of projectedConsts) {
      const cv   = calcCountryVotes(natPcts, cId, constOverrides[cId]);
      const rPct = (constReportingPct[cId] ?? 100) / 100;
      const w    = (EU_COUNTRY_MAP[cId]?.validVotes ?? 0) * rPct;
      for (const p of EU_GROUPS) weighted[p.id] = (weighted[p.id] ?? 0) + (cv[p.id] ?? 0) * w;
      totalW += w;
    }
    if (totalW === 0) return zero;
    return Object.fromEntries(EU_GROUPS.map(p => [p.id, (weighted[p.id] ?? 0) / totalW])) as Record<EuGroupId, number>;
  }, [preset, projectedConsts, constOverrides, constReportingPct, natPcts]);

  const blankVoteScale = useMemo(() => {
    if (preset !== 'blank') return 1;
    const projVotes = [...projectedConsts].reduce((s, cId) =>
      s + (EU_COUNTRY_MAP[cId]?.validVotes ?? 0) * ((constReportingPct[cId] ?? 100) / 100), 0);
    return Math.min(1, projVotes / EU_GRAND_TOTAL);
  }, [preset, projectedConsts, constReportingPct]);

  const overrideDisplayPcts = useMemo<Record<EuGroupId, number>>(() => {
    const hasAny = Object.values(constOverrides).some(o => o && Object.keys(o).length > 0);
    if (!hasAny) return natPcts;
    const weighted: Partial<Record<EuGroupId, number>> = {};
    let totalW = 0;
    for (const c of EU_COUNTRIES) {
      const cv = calcCountryVotes(natPcts, c.id, constOverrides[c.id]);
      const w  = c.validVotes;
      for (const p of EU_GROUPS) weighted[p.id] = (weighted[p.id] ?? 0) + (cv[p.id] ?? 0) * w;
      totalW += w;
    }
    if (totalW === 0) return natPcts;
    return Object.fromEntries(EU_GROUPS.map(p => [p.id, (weighted[p.id] ?? 0) / totalW])) as Record<EuGroupId, number>;
  }, [natPcts, constOverrides]);

  // 2026 headline = the national poll exactly (per-country divergence lives in the overrides).
  const displayPcts = preset === 'blank' ? blankDisplayPcts
    : preset === 'polling2026' ? natPcts
    : overrideDisplayPcts;

  // ── UI state ────────────────────────────────────────────────────────────────
  const [selectedConst, setSelectedConst]         = useState<EuCountryId | null>(null);
  const [bubbleMap, setBubbleMap]                 = useState(false);
  const [seatDots, setSeatDots]                   = useState(false);
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [hiddenParties, setHiddenParties]         = useState<Set<EuGroupId>>(new Set());

  const [leftPanel, setLeftPanel]   = useState<'parties'|'parli'|null>(null);
  const [rightPanel, setRightPanel] = useState<'sim'|'tutorial'|'coalition'|'breakdown'|null>(null);
  const [exitLeft, setExitLeft]     = useState<string | null>(null);
  const [exitRight, setExitRight]   = useState<string | null>(null);
  const exitTimerL = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerR = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openLeft = useCallback((panel: 'parties'|'parli') => {
    if (leftPanel === panel) {
      setExitLeft(panel); setLeftPanel(null);
      exitTimerL.current = setTimeout(() => setExitLeft(null), 280);
    } else {
      if (leftPanel) { setExitLeft(leftPanel); exitTimerL.current = setTimeout(() => setExitLeft(null), 280); }
      setLeftPanel(panel);
    }
  }, [leftPanel]);
  const openRight = useCallback((panel: 'sim'|'tutorial'|'coalition'|'breakdown') => {
    if (rightPanel === panel) {
      setExitRight(panel); setRightPanel(null);
      exitTimerR.current = setTimeout(() => setExitRight(null), 280);
    } else {
      if (rightPanel) { setExitRight(rightPanel); exitTimerR.current = setTimeout(() => setExitRight(null), 280); }
      if (panel === 'sim') setSelectedConst(null);
      setRightPanel(panel);
    }
  }, [rightPanel]);

  const headerScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = headerScrollRef.current; if (!el) return;
    const h = (e: WheelEvent) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; e.preventDefault(); el.scrollLeft += e.deltaY; };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  // ── Simulation ──────────────────────────────────────────────────────────────
  const [simDraftPcts,  setSimDraftPcts]  = useState<Record<EuGroupId, number>>(() => ({ ...EU_VOTE_PCT_2026 }));
  const [, setSimDraftTouched]            = useState(false);
  const [simDuration, setSimDuration]     = useState<60000|120000|300000|600000>(120000);
  const [simNatPcts, setSimNatPcts]       = useState<Record<EuGroupId, number> | null>(null);
  const [simSeats, setSimSeats]           = useState<Partial<Record<EuGroupId, number>> | undefined>();
  const [simProgress, setSimProgress]     = useState(0);
  const [simRunning, setSimRunning]       = useState(false);
  // Clicking ▶ Simulation drops the map to a blank slate (election-night mode), then opens
  // the sim panel. Toggling it closed (or while a sim is running) leaves the map untouched.
  const handleSimClick = useCallback(() => {
    if (rightPanel !== 'sim' && !simRunning) loadBlank();
    openRight('sim');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightPanel, simRunning, openRight]);
  const [declaredConsts, setDeclaredConsts] = useState<Set<EuCountryId> | undefined>();
  const [simConstFractions, setSimConstFractions] = useState<Partial<Record<EuCountryId, number>>>({});
  // Live (noisy, monotonic) per-country vote counts per group during a simulation.
  const [simConstVotes, setSimConstVotes] = useState<Partial<Record<EuCountryId, Record<EuGroupId, number>>>>({});
  const simTimersRef  = useRef<ReturnType<typeof setTimeout>[]>([]);
  const simNatPctsRef = useRef<Record<EuGroupId, number>>(natPcts);

  useEffect(() => { if (rightPanel === 'sim') { setSimDraftPcts({ ...EU_VOTE_PCT_2026 }); setSimDraftTouched(false); } }, [rightPanel === 'sim']); // eslint-disable-line

  const simDraftTotal = useMemo(
    () => EU_PROSPECTIVE.filter(id => !hiddenParties.has(id)).reduce((s, id) => s + (simDraftPcts[id] ?? 0), 0),
    [simDraftPcts, hiddenParties],
  );
  const simTotalValid = simDraftTotal >= 95 && simDraftTotal <= 100;

  function stopSim() {
    simTimersRef.current.forEach(clearTimeout);
    simTimersRef.current = [];
    setSimRunning(false);
  }

  function runSim() {
    stopSim(); setSimDraftTouched(false);
    simNatPctsRef.current = { ...simDraftPcts };
    setSimNatPcts({ ...simDraftPcts });
    const PARTS = EU_SIM_BATCHES;              // 15 randomized batches per country
    const totalC = EU_COUNTRIES.length;
    type Ev = { cId: EuCountryId; votes: Record<EuGroupId, number>; frac: number; last: boolean; t: number };
    const events: Ev[] = [];
    EU_COUNTRIES.forEach((c, idx) => {
      const cId = c.id;
      // True final votes for this country under the simulated national shares (incl. Others).
      const finalPv = calcCountryVotes(simDraftPcts, cId);
      const finalVotes = {} as Record<EuGroupId, number>;
      for (const g of EU_GROUPS) finalVotes[g.id] = Math.round((finalPv[g.id] ?? 0) / 100 * c.validVotes);
      const cuts = [0, ...Array.from({ length: PARTS - 1 }, () => Math.random()).sort((a, b) => a - b), 1];
      const snaps = euComputeBatches(finalVotes, cuts, idx + 1);     // noisy monotonic snapshots
      const pTimes = euCountryBatchTimes(simDuration);
      for (let b = 0; b < PARTS; b++) events.push({ cId, votes: snaps[b], frac: cuts[b + 1], last: b === PARTS - 1, t: pTimes[b] });
    });
    events.sort((a, b) => a.t - b.t);
    setSimRunning(true); setSimProgress(0);
    setSimSeats(undefined); setDeclaredConsts(new Set()); setSimConstFractions({}); setSimConstVotes({});
    const localVotes: Partial<Record<EuCountryId, Record<EuGroupId, number>>> = {};
    const localFrac: Partial<Record<EuCountryId, number>> = {};
    const localDecl = new Set<EuCountryId>();
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const ev of events) {
      timers.push(setTimeout(() => {
        localVotes[ev.cId] = ev.votes;
        localFrac[ev.cId] = ev.frac;
        if (ev.last) localDecl.add(ev.cId);
        const votesSnap = { ...localVotes };
        const fracSnap = { ...localFrac };
        setSimConstVotes(votesSnap);
        setSimConstFractions(fracSnap);
        setDeclaredConsts(new Set(localDecl));
        setSimProgress(Object.keys(fracSnap).length);
        // Estimated total seats from EVERY country that has votes so far — each country's
        // MEPs are D'Hondt-allocated on its CURRENT (noisy) tally, so the projection
        // wobbles early and firms up as the real counts come in.
        const liveSeats: Partial<Record<EuGroupId, number>> = {};
        for (const [cId, v] of Object.entries(votesSnap) as [EuCountryId, Record<EuGroupId, number>][]) {
          const cs = calcDHondtCountry(v, EU_COUNTRY_MAP[cId]?.seats ?? 0, cId);
          for (const [g, s] of Object.entries(cs) as [EuGroupId, number][]) liveSeats[g] = (liveSeats[g] ?? 0) + s;
        }
        setSimSeats(liveSeats);
        if (Object.keys(fracSnap).length >= totalC && Object.values(fracSnap).every(f => (f ?? 0) >= 0.999)) {
          setSimRunning(false);
        }
      }, ev.t));
    }
    simTimersRef.current = timers;
  }

  // Baseline display shows the REAL official seats; any edit/projection/sim uses D'Hondt.
  const hasOverrides = Object.values(constOverrides).some(o => o && Object.keys(o).length > 0);
  const isPureBaseline = preset === 'baseline' && !hasOverrides && simSeats == null && simNatPcts == null;
  const displaySeats = useMemo(
    () => simSeats ?? (isPureBaseline ? (EU_BASELINE_SEATS as Partial<Record<EuGroupId, number>>)
      : calcAllCountrySeats(displayPcts, hasOverrides ? constOverrides : undefined)),
    [simSeats, isPureBaseline, displayPcts, hasOverrides, constOverrides],
  );

  // Live national tally = the actual sum of the noisy per-country counts. Percentages
  // wobble batch-to-batch (suspense) while the underlying raw totals only ever grow.
  const simReportedTotal = useMemo(() => {
    let total = 0;
    for (const v of Object.values(simConstVotes)) for (const g of EU_GROUPS) total += v?.[g.id] ?? 0;
    return total;
  }, [simConstVotes]);

  const simPartialPcts = useMemo<Record<EuGroupId, number> | null>(() => {
    if (!simNatPcts || simReportedTotal <= 0) return null;
    const sums: Partial<Record<EuGroupId, number>> = {};
    for (const v of Object.values(simConstVotes)) for (const g of EU_GROUPS) sums[g.id] = (sums[g.id] ?? 0) + (v?.[g.id] ?? 0);
    return Object.fromEntries(EU_GROUPS.map(p => [p.id, (sums[p.id] ?? 0) / simReportedTotal * 100])) as Record<EuGroupId, number>;
  }, [simNatPcts, simConstVotes, simReportedTotal]);

  // Scale chosen so the scoreboard's (pct × grand × scale) renders the exact monotonic count.
  const simVoteScale = useMemo(() =>
    simNatPcts ? Math.min(1, simReportedTotal / EU_GRAND_TOTAL) : undefined,
  [simNatPcts, simReportedTotal]);

  // ── Derived display state ──────────────────────────────────────────────────
  const showConst     = !!selectedConst && rightPanel !== 'sim' && !simRunning;
  const showParli     = leftPanel  === 'parli'     || exitLeft  === 'parli';
  const showBreakdown = rightPanel === 'breakdown' || exitRight === 'breakdown';
  const showTutorial  = rightPanel === 'tutorial'  || exitRight === 'tutorial';
  const showCoalition = rightPanel === 'coalition' || exitRight === 'coalition';

  const btnBase   = 'h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold   = `${btnBase} bg-gold text-white hover:bg-gold-deep`;
  const btnMuted  = `${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive = `${btnBase} bg-ink/8 border border-default text-ink`;

  return (
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="eu">
      {/* ── Header ── */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4"><GlobeLogo /></button>
        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          {/* EU flag — circle of stars on blue */}
          <svg width="18" height="12" viewBox="0 0 18 12" className="shrink-0 rounded-[2px] opacity-90" style={{ border:'1px solid rgba(0,0,0,0.12)' }}>
            <rect x="0" y="0" width="18" height="12" fill="#003399" />
            {Array.from({length:12}).map((_,i)=>{const a=i/12*2*Math.PI-Math.PI/2;return <circle key={i} cx={9+Math.cos(a)*3.6} cy={6+Math.sin(a)*3.6} r="0.7" fill="#FFCC00"/>;})}
          </svg>
          <span className="text-[11px] font-bold text-ink shrink-0 hidden sm:block">European Union</span>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={() => !simRunning && loadBaseline()} disabled={simRunning}
            className={`${preset === 'baseline' ? btnGold : btnMuted}${simRunning ? ' opacity-40 cursor-not-allowed' : ''}`}
            title={simRunning ? 'Locked while the simulation runs' : ''}>2024 Result</button>
          <button onClick={() => !simRunning && loadPolling2026()} disabled={simRunning}
            className={`${preset === 'polling2026' ? btnGold : btnMuted}${simRunning ? ' opacity-40 cursor-not-allowed' : ''}`}
            title={simRunning ? 'Locked while the simulation runs' : ''}>2026 Polling</button>
          <button onClick={loadBlank}       className={preset === 'blank'       ? btnGold : btnMuted}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={handleSimClick}  className={rightPanel === 'sim'      ? btnActive : btnMuted}>▶ Simulation</button>
          <button onClick={() => !simRunning && openLeft('parties')} disabled={simRunning}
            className={`${leftPanel === 'parties' ? btnActive : btnMuted}${simRunning ? ' opacity-40 cursor-not-allowed' : ''}`}
            title={simRunning ? 'Groups locked while simulation runs' : 'Show/hide groups'}>Groups</button>
          <button onClick={() => setScoreboardVisible(v => !v)} className={scoreboardVisible ? btnActive : btnMuted}>Scoreboard</button>
          <button onClick={() => openRight('breakdown')} className={rightPanel === 'breakdown' ? btnActive : btnMuted}>Breakdown</button>
          <button onClick={() => openRight('coalition')} className={rightPanel === 'coalition' ? btnActive : btnMuted}>Coalition</button>
          <button onClick={() => openLeft('parli')}      className={leftPanel  === 'parli'     ? btnActive : btnMuted}>Parliament</button>
          <button onClick={() => { setBubbleMap(v => !v); setSeatDots(false); }}
            className={bubbleMap ? `${btnBase} bg-emerald-600 text-white hover:bg-emerald-700` : btnMuted}>Bubble Map</button>
          <button onClick={() => { setSeatDots(v => !v); setBubbleMap(false); }}
            className={seatDots ? `${btnBase} bg-violet-600 text-white hover:bg-violet-700` : btnMuted}>Seat Dots</button>
          <button onClick={() => openRight('tutorial')}  className={rightPanel === 'tutorial' ? btnActive : btnMuted}>Tutorial</button>
        </div>
        <div className="shrink-0 flex items-center gap-2 pr-4">
          <button onClick={() => setDark(v => !v)}
            className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:text-ink transition-colors"
            title="Toggle dark mode">{dark ? '☀' : '☾'}</button>
        </div>
      </header>

      {/* ── Scoreboard ── */}
      {scoreboardVisible && (
        <EuScoreboard
          natPcts={simPartialPcts ?? (simNatPcts ?? displayPcts)}
          simSeats={displaySeats}
          isBaseline={preset === 'baseline' && !simNatPcts}
          dark={dark}
          reportedVoteScale={simNatPcts != null ? simVoteScale : (preset === 'blank' ? blankVoteScale : undefined)}
        />
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {leftPanel === 'parties' && (
          <EuGroupsPanel
            hiddenParties={hiddenParties}
            onToggle={id => setHiddenParties(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })}
            onClose={() => openLeft('parties')} dark={dark} />
        )}
        {showParli     && <EuParliamentPanel seats={displaySeats} onClose={() => openLeft('parli')}     exiting={exitLeft  === 'parli'}     dark={dark} />}

        {/* MAP */}
        <div className="relative flex-1 min-w-0 min-h-0">
          <EuMapView
            natPcts={natPcts} selectedConst={selectedConst}
            onSelect={c => setSelectedConst(prev => prev === c ? null : c)}
            dark={dark} bubbleMap={bubbleMap} seatDots={seatDots}
            declaredConsts={declaredConsts} constOverrides={constOverrides}
            blankMode={preset === 'blank'} projectedConsts={projectedConsts}
            simConstFractions={simConstFractions}
            constDraft={preset === 'blank' ? constDraft : null}
            simNatPcts={simNatPcts}
            simConstVotes={simConstVotes}
          />
          {(preset === 'blank' || simRunning || simSeats != null) && (
            <EuReportingWidget
              projectedConsts={projectedConsts} constReportingPct={constReportingPct}
              simConstFractions={simConstFractions}
              isSim={simRunning || (simSeats != null && preset !== 'blank')}
              live={simRunning}
              dark={dark}
            />
          )}
          {/* ── Live banner (top-centre) — shows the instant the simulation starts ── */}
          {simRunning && (() => {
            const reportedFrac = Math.min(1, (Object.entries(simConstFractions) as [EuCountryId, number][])
              .reduce((s, [cId, f]) => s + (EU_COUNTRY_MAP[cId]?.validVotes || 0) * (f || 0), 0) / EU_GRAND_TOTAL);
            return (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1002] pointer-events-none"
                style={{ background:'rgba(220,38,38,0.97)', borderRadius:999, padding:'6px 16px',
                  boxShadow:'0 6px 24px rgba(220,38,38,0.45)', display:'flex', alignItems:'center', gap:10 }}>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                </span>
                <span className="text-white text-[12px] font-mono font-black uppercase tracking-[0.18em]">Live</span>
                <span className="text-white/90 text-[11px] font-mono font-bold tabular-nums">{(reportedFrac * 100).toFixed(1)}% counted</span>
                <span className="text-white/70 text-[11px] font-mono font-semibold tabular-nums">· {simProgress}/{EU_COUNTRIES.length} reporting</span>
              </div>
            );
          })()}
        </div>

        {/* RIGHT panels */}
        {rightPanel === 'sim' && (
          <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2>
                <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Set group shares · then run</p>
              </div>
              <button onClick={() => openRight('sim')} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
            </div>
            <div className="px-3.5 pt-2.5 pb-2 border-b border-default shrink-0">
              <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-1.5">Simulation speed</div>
              <div className="flex gap-1.5">
                {([['1 min','60s',60000],['2 min','2m',120000],['5 min','5m',300000],['10 min','10m',600000]] as const).map(([label, sub, ms]) => (
                  <button key={ms} onClick={() => setSimDuration(ms)}
                    className={`flex-1 py-1 rounded-[4px] border text-[9px] font-mono font-bold transition-colors ${simDuration === ms ? 'bg-blue-600 text-white border-blue-600' : 'border-default text-ink-3 hover:bg-hover'}`}>
                    {label}<div className="text-[7px] opacity-70">{sub}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="px-3.5 pt-2 pb-1 text-[8.5px] font-mono text-ink-3 shrink-0">
              Type each group's EU-wide vote %. Values are not auto-balanced — the total (incl. Others) must be 95–100% to run.
            </div>
            <div className="flex-1 overflow-y-auto px-3.5 py-2 thin-scroll space-y-2">
              {EU_PROSPECTIVE.filter(id => !hiddenParties.has(id)).map(id => {
                const party    = EU_GROUP_MAP[id];
                const pct      = simDraftPcts[id] ?? 0;
                const color    = partyColor(id);
                const rawVotes = Math.round(pct / 100 * EU_GRAND_TOTAL);
                return (
                  <div key={id} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-medium text-ink truncate leading-tight">{party.fullName}</div>
                      <div className="text-[8px] font-mono leading-tight" style={{ color: dark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.35)' }}>
                        {fmtN(rawVotes)} votes · {party.noSeats ? 'no seats' : `${party.seats2024} in '24`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <EuSimInput value={pct} color={color} dark={dark}
                        onChange={n => { setSimDraftPcts(prev => ({ ...prev, [id]: n })); setSimDraftTouched(true); }} />
                      <span className="text-[10px] font-mono text-ink-3">%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-3.5 pb-3.5 pt-2 border-t border-default shrink-0 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-mono uppercase tracking-wide text-ink-3">Total</span>
                <span className="text-[12px] font-mono font-bold tabular-nums"
                  style={{ color: simTotalValid ? '#16a34a' : '#ef4444' }}>{simDraftTotal.toFixed(1)}%</span>
              </div>
              {!simRunning && !simTotalValid && (
                <div className="text-[8.5px] font-mono leading-snug" style={{ color: '#ef4444' }}>
                  {simDraftTotal < 95
                    ? `Add ${(95 - simDraftTotal).toFixed(1)}% more — total must reach at least 95%.`
                    : `Remove ${(simDraftTotal - 100).toFixed(1)}% — total cannot exceed 100%.`}
                </div>
              )}
              <button disabled={simRunning || !simTotalValid} onClick={runSim}
                className="w-full h-8 rounded-[4px] bg-blue-600 text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {simRunning ? `${simProgress}/${EU_COUNTRIES.length} countries reporting…` : '▶ Run Simulation'}
              </button>
              {(simSeats || declaredConsts) && (
                <button onClick={() => { stopSim(); setSimSeats(undefined); setDeclaredConsts(undefined); setSimProgress(0); setSimConstFractions({}); setSimConstVotes({}); setSimNatPcts(null); }}
                  className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">Reset</button>
              )}
            </div>
          </aside>
        )}

        {showConst && selectedConst && baselineRefOpen && (
          <EuCountryBaselinePanel countryId={selectedConst} onClose={() => setBaselineRefOpen(false)} dark={dark} />
        )}
        {showConst && selectedConst && (
          <EuCountryPanel key={selectedConst} constId={selectedConst} natPcts={natPcts}
            constOverride={constOverrides[selectedConst]}
            onOverride={pcts => setConstOverrides(prev => ({ ...prev, [selectedConst]: pcts }))}
            onResetOverride={() => {
              setConstOverrides(prev => { const n = { ...prev }; delete n[selectedConst]; return n; });
              setProjectedConsts(prev => { const n = new Set(prev); n.delete(selectedConst); return n; });
              setConstDraft(null);
            }}
            onClose={() => { setSelectedConst(null); setConstDraft(null); setBaselineRefOpen(false); }}
            isBlankMode={preset === 'blank'} isProjected={projectedConsts.has(selectedConst)}
            reportingPct={constReportingPct[selectedConst] ?? 100}
            onProject={() => setProjectedConsts(prev => new Set([...prev, selectedConst]))}
            onReportingPctChange={pct => setConstReportingPct(prev => ({ ...prev, [selectedConst]: pct }))}
            onDraftChange={preset === 'blank' ? (pcts, rpt) => setConstDraft({ constId: selectedConst, pcts, rptPct: rpt }) : undefined}
            hiddenParties={hiddenParties} dark={dark}
            baselineOpen={baselineRefOpen} onToggleBaseline={() => setBaselineRefOpen(v => !v)} />
        )}

        {showBreakdown && <EuBreakdownPanel  seats={displaySeats} natPcts={displayPcts} isBaseline={preset === 'baseline'}
                            constOverrides={constOverrides} onClose={() => openRight('breakdown')}     exiting={exitRight === 'breakdown'} dark={dark} />}
        {showTutorial  && <EuTutorialPanel   onClose={() => openRight('tutorial')}  exiting={exitRight === 'tutorial'}  dark={dark} />}
        {showCoalition && <EuCoalitionPanel  seats={displaySeats} onClose={() => openRight('coalition')} exiting={exitRight === 'coalition'} dark={dark} />}
      </div>
    </div>
  );
}
