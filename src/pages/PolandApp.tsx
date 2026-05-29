import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── Party types ───────────────────────────────────────────────────────────────
type PlPartyId = 'PIS' | 'KO' | 'TD' | 'LEWICA' | 'RAZEM' | 'KONF' | 'KKP' | 'MN';

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
  // Recognised national-minority committee: exempt from the national threshold
  exempt?:        boolean;
  // Landlocked regional party: contests only these constituencies (empty/undefined = national)
  home?:          PlConstId[];
};

// Ideology order left → right for parliament view (MN: centrist regional minority).
// KWiN (KONF) and Braun's KKP sit to the RIGHT of PiS as the hard/far right.
const PL_LR_ORDER: PlPartyId[] = ['RAZEM','LEWICA','KO','MN','TD','PIS','KONF','KKP'];

const PL_PARTIES: PlParty[] = [
  { id:'PIS',    name:'PiS',      fullName:'Prawo i Sprawiedliwość',       color:'#003087', seats2023:194, threshold:5,
    leader:'Jarosław Kaczyński',          wikiTitle:'Jarosław_Kaczyński' },
  { id:'KO',     name:'KO',       fullName:'Koalicja Obywatelska',         color:'#F05A28', seats2023:157, threshold:8,
    leader:'Donald Tusk',                 wikiTitle:'Donald_Tusk' },
  { id:'TD',     name:'TD',       fullName:'Trzecia Droga (PSL+PL2050)', color:'#2E7D32', seats2023:65,  threshold:8,
    leader:'Władysław Kosiniak-Kamysz',   wikiTitle:'Władysław_Kosiniak-Kamysz',
    leader2026:'Szymon Hołownia',         wikiTitle2026:'Szymon_Hołownia' },
  { id:'LEWICA', name:'Lewica',   fullName:'Nowa Lewica',                  color:'#C0392B', seats2023:26,  threshold:5,
    leader:'Włodzimierz Czarzasty',       wikiTitle:'Włodzimierz_Czarzasty' },
  // Partia Razem — left the Lewica coalition in 2024 to run independently. Inside Lewica
  // in 2023, so 0 seats in baseline; appears only in 2026/blank/sim scenarios.
  { id:'RAZEM',  name:'Razem',    fullName:'Partia Razem',                 color:'#C0207A', seats2023:0,   threshold:5,
    leader:'Adrian Zandberg',             wikiTitle:'Adrian_Zandberg' },
  { id:'KONF',   name:'Konfederacja', fullName:'Konfederacja WiN',         color:'#1B1464', seats2023:18,  threshold:5,
    leader:'Sławomir Mentzen',            wikiTitle:'Sławomir_Mentzen' },
  // Konfederacja Korony Polskiej — Grzegorz Braun's far-right splinter. Did not contest
  // 2023 separately, so 0 seats in baseline; appears only in 2026/blank/sim scenarios.
  { id:'KKP',    name:'KKP',      fullName:'Konfederacja Korony Polskiej',  color:'#B8860B', seats2023:0,   threshold:5,
    leader:'Grzegorz Braun',              wikiTitle:'Grzegorz_Braun' },
  // National-minority committee — threshold-exempt, landlocked to Opole (okręg 21). 0 seats in 2023.
  { id:'MN',     name:'MN',       fullName:'Mniejszość Niemiecka',         color:'#C9A227', seats2023:0,   threshold:5,
    exempt:true, home:['C21'],
    leader:'Ryszard Galla',               wikiTitle:'Ryszard_Galla' },
];

const PL_PARTY_MAP = Object.fromEntries(PL_PARTIES.map(p=>[p.id,p])) as Record<PlPartyId,PlParty>;
const PL_TOTAL_SEATS = 460;
const PL_MAJORITY    = 231;

// 2023 official results — source: PKW (Państwowa Komisja Wyborcza), 15 Oct 2023
const PL_VOTE_PCT_2023: Record<PlPartyId, number> = {
  PIS: 35.38, KO: 30.70, TD: 14.40, LEWICA: 8.61, RAZEM: 0, KONF: 7.16, KKP: 0, MN: 0.12,
};
const PL_VOTE_RAW_2023: Record<PlPartyId, number> = {
  PIS: 7_640_854, KO: 6_629_402, TD: 3_110_670, LEWICA: 1_859_018, RAZEM: 0, KONF: 1_547_364, KKP: 0, MN: 25_778,
};
// 2026 polling — KO surging ahead of PiS; Konfederacja (KWiN) strong, Braun's KKP over
// threshold; Nowa Lewica clears 5% but Razem and Trzecia Droga fall short.
const PL_VOTE_PCT_2026: Record<PlPartyId, number> = {
  PIS: 25.3, KO: 34.3, TD: 6.0, LEWICA: 6.6, RAZEM: 4.0, KONF: 13.1, KKP: 8.0, MN: 0.12,
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
  total2023: number;   // valid votes cast in this constituency in 2023 (Wikipedia)
  // 2023 actual raw votes per party in this constituency (Wikipedia)
  raw2023: Partial<Record<PlPartyId, number>>;
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

// ── 41 constituencies — official 2023 PKW seat counts + Wikipedia raw votes ───
// Sources:
//   • Seat allocation per okręg: PKW (Państwowa Komisja Wyborcza), 2023 election
//   • Raw votes per constituency: Wikipedia "Results breakdown of the 2023 Polish
//     parliamentary election (Sejm)" — official PKW protocol totals
// Total: 460 seats. Verified PL_CONSTITUENCIES.reduce((s,c)=>s+c.seats,0) === 460
const PL_CONSTITUENCIES: PlConst[] = [
  { id:'C01', nr: 1, name:'Legnica',             seats:12, total2023:  501_870,
    raw2023:{PIS:174_643, KO:169_540, TD: 53_958, LEWICA: 47_715, KONF: 31_770} },
  { id:'C02', nr: 2, name:'Wałbrzych',           seats: 8, total2023:  323_360,
    raw2023:{PIS:107_797, KO:120_188, TD: 39_215, LEWICA: 25_806, KONF: 19_478} },
  { id:'C03', nr: 3, name:'Wrocław',             seats:14, total2023:  776_054,
    raw2023:{PIS:206_899, KO:286_713, TD:106_624, LEWICA: 88_089, KONF: 54_132} },
  { id:'C04', nr: 4, name:'Bydgoszcz',           seats:12, total2023:  533_919,
    raw2023:{PIS:162_603, KO:186_914, TD: 80_426, LEWICA: 52_959, KONF: 34_266} },
  { id:'C05', nr: 5, name:'Toruń',               seats:13, total2023:  537_597,
    raw2023:{PIS:183_131, KO:158_719, TD: 84_308, LEWICA: 60_473, KONF: 34_232} },
  { id:'C06', nr: 6, name:'Lublin',              seats:15, total2023:  648_347,
    raw2023:{PIS:294_847, KO:131_712, TD:102_894, LEWICA: 37_083, KONF: 54_325} },
  { id:'C07', nr: 7, name:'Chełm',               seats:12, total2023:  456_872,
    raw2023:{PIS:231_882, KO: 79_501, TD: 59_577, LEWICA: 25_691, KONF: 35_594} },
  { id:'C08', nr: 8, name:'Zielona Góra',        seats:12, total2023:  517_041,
    raw2023:{PIS:143_530, KO:195_091, TD: 77_933, LEWICA: 47_911, KONF: 33_672} },
  { id:'C09', nr: 9, name:'Łódź',                seats:10, total2023:  456_552,
    raw2023:{PIS:122_433, KO:187_527, TD: 54_283, LEWICA: 55_770, KONF: 25_428} },
  { id:'C10', nr:10, name:'Piotrków Tryb.',      seats: 9, total2023:  396_819,
    raw2023:{PIS:184_929, KO: 86_083, TD: 54_479, LEWICA: 25_340, KONF: 30_247} },
  { id:'C11', nr:11, name:'Sieradz',             seats:12, total2023:  533_128,
    raw2023:{PIS:221_031, KO:138_038, TD: 77_313, LEWICA: 41_188, KONF: 36_383} },
  { id:'C12', nr:12, name:'Kraków I',            seats: 8, total2023:  364_671,
    raw2023:{PIS:156_308, KO: 88_408, TD: 54_585, LEWICA: 22_036, KONF: 28_754} },
  { id:'C13', nr:13, name:'Kraków II',           seats:14, total2023:  757_522,
    raw2023:{PIS:232_430, KO:232_799, TD:127_693, LEWICA: 83_633, KONF: 58_435} },
  { id:'C14', nr:14, name:'Nowy Sącz',           seats:10, total2023:  427_292,
    raw2023:{PIS:229_587, KO: 68_804, TD: 49_487, LEWICA: 13_594, KONF: 37_301} },
  { id:'C15', nr:15, name:'Tarnów',              seats: 9, total2023:  403_591,
    raw2023:{PIS:196_433, KO: 68_690, TD: 75_229, LEWICA: 16_152, KONF: 32_241} },
  { id:'C16', nr:16, name:'Płock',               seats:10, total2023:  442_567,
    raw2023:{PIS:195_218, KO: 99_146, TD: 75_526, LEWICA: 28_848, KONF: 28_877} },
  { id:'C17', nr:17, name:'Radom',               seats: 9, total2023:  391_202,
    raw2023:{PIS:190_418, KO: 82_003, TD: 54_690, LEWICA: 20_874, KONF: 28_593} },
  { id:'C18', nr:18, name:'Siedlce',             seats:12, total2023:  539_408,
    raw2023:{PIS:262_236, KO:100_902, TD: 83_681, LEWICA: 26_149, KONF: 44_299} },
  { id:'C19', nr:19, name:'Warszawa I',          seats:20, total2023:1_714_719,
    raw2023:{PIS:345_380, KO:741_286, TD:227_127, LEWICA:230_648, KONF:124_220} },
  { id:'C20', nr:20, name:'Warszawa II',         seats:12, total2023:  730_744,
    raw2023:{PIS:231_905, KO:257_470, TD:110_086, LEWICA: 51_556, KONF: 51_573} },
  { id:'C21', nr:21, name:'Opole',               seats:12, total2023:  479_968,
    raw2023:{PIS:150_022, KO:161_241, TD: 61_155, LEWICA: 34_763, KONF: 31_150, MN: 25_778} },
  { id:'C22', nr:22, name:'Krosno',              seats:11, total2023:  441_996,
    raw2023:{PIS:241_790, KO: 70_054, TD: 60_938, LEWICA: 19_750, KONF: 38_080} },
  { id:'C23', nr:23, name:'Rzeszów',             seats:15, total2023:  673_776,
    raw2023:{PIS:347_688, KO:119_259, TD: 83_676, LEWICA: 32_828, KONF: 63_854} },
  { id:'C24', nr:24, name:'Białystok',           seats:14, total2023:  609_244,
    raw2023:{PIS:258_277, KO:126_971, TD:114_898, LEWICA: 29_478, KONF: 59_648} },
  { id:'C25', nr:25, name:'Gdańsk',              seats:12, total2023:  616_287,
    raw2023:{PIS:155_318, KO:257_009, TD: 90_599, LEWICA: 57_967, KONF: 38_406} },
  { id:'C26', nr:26, name:'Słupsk',              seats:14, total2023:  682_899,
    raw2023:{PIS:199_709, KO:258_909, TD: 92_793, LEWICA: 56_887, KONF: 49_203} },
  { id:'C27', nr:27, name:'Bielsko-Biała',       seats: 9, total2023:  445_346,
    raw2023:{PIS:163_506, KO:127_677, TD: 64_778, LEWICA: 34_601, KONF: 34_909} },
  { id:'C28', nr:28, name:'Częstochowa',         seats: 7, total2023:  323_941,
    raw2023:{PIS:117_756, KO: 94_313, TD: 47_698, LEWICA: 30_497, KONF: 21_256} },
  { id:'C29', nr:29, name:'Katowice I',          seats: 9, total2023:  387_408,
    raw2023:{PIS:116_827, KO:139_711, TD: 51_681, LEWICA: 35_673, KONF: 26_934} },
  { id:'C30', nr:30, name:'Bielsko-Biała II',    seats: 9, total2023:  381_598,
    raw2023:{PIS:145_230, KO:114_404, TD: 47_525, LEWICA: 26_117, KONF: 30_527} },
  { id:'C31', nr:31, name:'Katowice II',         seats:12, total2023:  526_167,
    raw2023:{PIS:162_458, KO:193_596, TD: 69_825, LEWICA: 44_509, KONF: 35_240} },
  { id:'C32', nr:32, name:'Katowice III',        seats: 9, total2023:  377_959,
    raw2023:{PIS:112_389, KO:114_519, TD: 37_221, LEWICA: 81_646, KONF: 21_512} },
  { id:'C33', nr:33, name:'Kielce',              seats:16, total2023:  659_132,
    raw2023:{PIS:310_266, KO:137_941, TD: 90_975, LEWICA: 45_048, KONF: 43_197} },
  { id:'C34', nr:34, name:'Elbląg',              seats: 8, total2023:  299_380,
    raw2023:{PIS:105_373, KO: 95_410, TD: 46_101, LEWICA: 24_269, KONF: 19_590} },
  { id:'C35', nr:35, name:'Olsztyn',             seats:10, total2023:  391_058,
    raw2023:{PIS:126_432, KO:129_339, TD: 63_007, LEWICA: 31_631, KONF: 27_119} },
  { id:'C36', nr:36, name:'Kalisz',              seats:12, total2023:  542_267,
    raw2023:{PIS:194_416, KO:154_990, TD: 87_628, LEWICA: 46_222, KONF: 37_838} },
  { id:'C37', nr:37, name:'Konin',               seats: 9, total2023:  419_243,
    raw2023:{PIS:162_192, KO:100_580, TD: 69_740, LEWICA: 39_761, KONF: 29_208} },
  { id:'C38', nr:38, name:'Piła',                seats: 9, total2023:  413_235,
    raw2023:{PIS:120_301, KO:144_114, TD: 72_996, LEWICA: 32_378, KONF: 28_370} },
  { id:'C39', nr:39, name:'Poznań',              seats:10, total2023:  596_038,
    raw2023:{PIS:116_666, KO:262_779, TD: 98_589, LEWICA: 73_345, KONF: 35_182} },
  { id:'C40', nr:40, name:'Koszalin',            seats: 8, total2023:  322_149,
    raw2023:{PIS:101_023, KO:124_625, TD: 39_776, LEWICA: 28_101, KONF: 19_379} },
  { id:'C41', nr:41, name:'Szczecin',            seats:12, total2023:  554_308,
    raw2023:{PIS:159_575, KO:222_427, TD: 69_957, LEWICA: 52_032, KONF: 32_942} },
];

const PL_CONST_MAP = Object.fromEntries(PL_CONSTITUENCIES.map(c=>[c.id,c])) as Record<PlConstId,PlConst>;
const PL_GRAND_TOTAL_VALID = PL_CONSTITUENCIES.reduce((s,c)=>s+c.total2023, 0); // 21,596,674

// Landlock: a regional party (home set) contests only its home constituencies.
function plContests(id: PlPartyId, constId: PlConstId): boolean {
  const home = PL_PARTY_MAP[id]?.home;
  return !home || home.length === 0 || home.includes(constId);
}

// Pre-compute v2023 percentages from raw votes for swing math
const PL_PCT_BY_CONST: Record<PlConstId, Record<PlPartyId, number>> = (() => {
  const out = {} as Record<PlConstId, Record<PlPartyId, number>>;
  for (const c of PL_CONSTITUENCIES) {
    const tot = c.total2023;
    const row = {} as Record<PlPartyId, number>;
    for (const p of PL_PARTIES) row[p.id] = ((c.raw2023[p.id] ?? 0) / tot) * 100;
    out[c.id] = row;
  }
  return out;
})();

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
      // National minorities (MN) are exempt from the national threshold.
      if (PL_PARTY_MAP[id]?.exempt) return true;
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
    // Landlock: regional parties get 0 outside their home constituencies.
    for (const p of PL_PARTIES) { raw[p.id]=plContests(p.id,constId)?Math.max(0,override[p.id]??0):0; total+=raw[p.id]; }
    if (total===0) return raw;
    for (const p of PL_PARTIES) raw[p.id]=(raw[p.id]/total)*100;
    return raw;
  }
  const base = PL_PCT_BY_CONST[constId] ?? ({} as Record<PlPartyId,number>);
  const raw: Record<PlPartyId,number> = {} as Record<PlPartyId,number>;
  let total=0;
  for (const p of PL_PARTIES) {
    const newNat = natPcts[p.id]??0;
    const oldNat = PL_VOTE_PCT_2023[p.id]??0;
    const basePct = base[p.id]??0;
    // Landlocked regional parties stay 0 outside home; otherwise proportional swing.
    // New party with no 2023 base (basePct 0 & oldNat 0): apply its national share uniformly.
    raw[p.id] = !plContests(p.id,constId) ? 0
      : basePct===0 ? (oldNat===0 ? newNat : 0)
      : oldNat===0 ? basePct
      : basePct*(newNat/oldNat);
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

// Choropleth fill: winning party's colour, shaded by margin (bigger lead = more intense).
function getConstFill(natPcts:Record<PlPartyId,number>,constId:PlConstId,dark:boolean,override?:Partial<Record<PlPartyId,number>>):string{
  const pv=calcConstVotes(natPcts,constId,override);
  const sorted=(Object.entries(pv) as [PlPartyId,number][]).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a);
  if(sorted.length===0) return dark?'#374151':'#E5E7EB';
  const[winner,winPct]=sorted[0];const margin=winPct-(sorted[1]?.[1]??0);
  const c=hsl(partyColor(winner));c.l=dark?0.55-Math.min(margin/20,1)*0.29:0.82-Math.min(margin/20,1)*0.46;
  return c.formatHex();
}

// Manual marker nudge [dLng, dLat] for constituencies whose centroid overlaps a neighbour.
// Warszawa II (C20) wraps around Warszawa I (C19), so its centroid sits over the city —
// shift its bubble / seat dots west into the suburban ring.
const PL_MARKER_OFFSET: Partial<Record<PlConstId, [number, number]>> = {
  C20: [-0.55, 0],
};

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
          {PL_PARTY_MAP[partyId].exempt?'exempt':`${PL_PARTY_MAP[partyId].threshold}% thr`}
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

// ── Scoreboard ────────────────────────────────────────────────────────────────
// Poland has no fixed blocs in this sim — parties are shown individually.

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

  // No fixed blocs in Poland — show individual parties. Highlight the plurality
  // winner (or a single-party majority, which is rare).
  const leadingId=useMemo(()=>{
    let best:PlPartyId|null=null;let bestS=-1;
    for(const id of PL_LR_ORDER){const s=seats[id]??0;if(s>bestS){bestS=s;best=id;}}
    return bestS>0?best:null;
  },[seats]);
  const leaderHasMajority=leadingId!=null&&(seats[leadingId]??0)>=PL_MAJORITY;

  // Cards sorted by seat size (desc); tie-break on vote share.
  const visible=useMemo(()=>PL_LR_ORDER.filter(id=>(seats[id]??0)>0||(natPcts[id]??0)>=0.5)
    .sort((a,b)=>((seats[b]??0)-(seats[a]??0))||((natPcts[b]??0)-(natPcts[a]??0))),[seats,natPcts]);

  const makeTile=(id:PlPartyId)=>{
    const s=seats[id]??0;
    const pct=pctTotal>0?(natPcts[id]??0)/pctTotal*100:0;
    const rawVotes=isBaseline?Math.round((PL_VOTE_RAW_2023[id]??0)*scale):Math.round((natPcts[id]??0)/100*PL_GRAND_TOTAL_VALID*scale);
    const isWinner=id===leadingId&&leaderHasMajority;
    const isLeader=id===leadingId&&!leaderHasMajority;
    return<PlScoreboardTile key={id} partyId={id} seats={s} pct={pct} rawVotes={rawVotes}
      isLeader={isLeader} isWinner={isWinner} is2026={is2026} dark={dark}/>;
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
      const c0=bounds.getCenter();
      const off=PL_MARKER_OFFSET[constId];
      const center=off?L.latLng(c0.lat+off[1],c0.lng+off[0]):c0;
      const pv=calcConstVotes(natPcts,constId,constOverrides?.[constId]);
      const sorted=(Object.entries(pv) as [PlPartyId,number][]).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a);
      if(sorted.length===0)return;
      const[winId,winPct]=sorted[0];
      const c=PL_CONST_MAP[constId];
      // Radius reflects the RAW vote margin (winner − runner-up), not total turnout.
      const rawMargin=(winPct-(sorted[1]?.[1]??0))/100*(c?.total2023??0);
      const baseRadius=Math.min(30,4+0.038*Math.sqrt(Math.max(0,rawMargin)));
      const color=partyColor(winId);

      const marker=L.circleMarker(center,{
        radius:baseRadius*scale,color,fillColor:color,fillOpacity:0.72,weight:1,opacity:0.9,
      }).addTo(map);

      marker.on('click',()=>{setTooltip(null);onSelect(constId);});
      marker.on('mousemove',(e:L.LeafletMouseEvent)=>{
        const rect=containerRef.current?.getBoundingClientRect();if(!rect)return;
        const cur=calcConstVotes(simNatPctsRef?.current??natPctsRef.current,constId,constOverridesRef.current?.[constId]);
        const fraction=simFracRef.current[constId]??1;
        const cVotes=c?.total2023 ?? 0;
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

// ── Seat-distribution dots overlay ────────────────────────────────────────────
// Renders one small coloured dot per seat in each constituency, grouped by party
// (ideology order), clustered at the constituency centroid. Re-laid-out on zoom.
function PlSeatDotsLayer({
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
  const dotsRef=useRef<L.CircleMarker[]>([]);
  const simFracRef=useRef(simConstFractions??{});
  useEffect(()=>{simFracRef.current=simConstFractions??{};},[simConstFractions]);

  useEffect(()=>{
    const layout=()=>{
      for(const m of dotsRef.current)m.remove();
      dotsRef.current=[];
      const z=map.getZoom();
      const dotR=Math.max(1.8,Math.min(5,(z-4)/(9-4)*4+1.8));
      const gap=dotR*2.3;
      L.geoJSON(geoData).eachLayer((layer:L.Layer)=>{
        const path=layer as any;
        const geoId:string=path.feature?.properties?.id??path.feature?.properties?.nr??'';
        const constId=PL_GEOID_TO_ID[String(geoId)];
        if(!constId)return;
        if(declaredConsts&&!declaredConsts.has(constId))return;
        if(!declaredConsts&&blankMode&&!(projectedConsts?.has(constId)))return;
        const bounds=(layer as any).getBounds?.();if(!bounds?.isValid())return;
        const c0=bounds.getCenter();
        const off=PL_MARKER_OFFSET[constId];
        const center=off?L.latLng(c0.lat+off[1],c0.lng+off[0]):c0;
        const c=PL_CONST_MAP[constId];
        const pv=calcConstVotes(natPcts,constId,constOverrides?.[constId]);
        const alloc=calcDHondtConst(pv,c?.seats??0,natPcts);
        // flat list of seat colours, grouped by party in ideology order
        const colors:string[]=[];
        for(const id of PL_LR_ORDER){const n=alloc[id]??0;for(let i=0;i<n;i++)colors.push(partyColor(id));}
        if(colors.length===0)return;
        const N=colors.length;
        const cols=Math.ceil(Math.sqrt(N));
        const rows=Math.ceil(N/cols);
        const cpt=map.latLngToContainerPoint(center);
        for(let i=0;i<N;i++){
          const r=Math.floor(i/cols), col=i%cols;
          const rowCount=(r===rows-1)?(N-r*cols):cols; // center last (partial) row
          const dx=(col-(rowCount-1)/2)*gap;
          const dy=(r-(rows-1)/2)*gap;
          const latlng=map.containerPointToLatLng(L.point(cpt.x+dx,cpt.y+dy));
          const m=L.circleMarker(latlng,{radius:dotR,color:'#0b0b0d',weight:0.5,opacity:0.55,
            fillColor:colors[i],fillOpacity:0.95}).addTo(map);
          m.on('click',()=>{setTooltip(null);onSelect(constId);});
          m.on('mousemove',(e:L.LeafletMouseEvent)=>{
            const rect=containerRef.current?.getBoundingClientRect();if(!rect)return;
            const cur=calcConstVotes(simNatPctsRef?.current??natPctsRef.current,constId,constOverridesRef.current?.[constId]);
            const fraction=simFracRef.current[constId]??1;
            const cVotes=c?.total2023??0;
            const simNat=simNatPctsRef?.current??natPctsRef.current;
            const projSeats=calcDHondtConst(cur,c?.seats??0,simNat);
            const parties=(Object.entries(cur) as [PlPartyId,number][])
              .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,6)
              .map(([id,pct])=>({id:id as PlPartyId,pct,rawVotes:Math.round(pct/100*cVotes*fraction),projSeats:projSeats[id as PlPartyId]??0}));
            setTooltip({x:e.originalEvent.clientX-rect.left,y:e.originalEvent.clientY-rect.top,
              name:c?.name??geoId,nr:c?.nr??0,seats:c?.seats??0,
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

// ── Constituency draft (blank-map live preview before "Update Projection") ─────
type PlConstDraft = { constId: PlConstId; pcts: Record<PlPartyId, number>; rptPct: number } | null;

// ── Map view ──────────────────────────────────────────────────────────────────
function PlMapView({
  natPcts, selectedConst, onSelect, dark, bubbleMap, seatDots,
  declaredConsts, constOverrides, blankMode, projectedConsts, simConstFractions,
  constDraft, simNatPcts,
}: {
  natPcts: Record<PlPartyId, number>; selectedConst: PlConstId | null;
  onSelect: (id: PlConstId) => void; dark: boolean; bubbleMap: boolean; seatDots: boolean;
  declaredConsts?: Set<PlConstId>;
  constOverrides?: Partial<Record<PlConstId, Partial<Record<PlPartyId, number>>>>;
  blankMode?: boolean; projectedConsts?: Set<PlConstId>;
  simConstFractions?: Partial<Record<PlConstId, number>>;
  constDraft?: PlConstDraft; simNatPcts?: Record<PlPartyId, number> | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef     = useRef<L.GeoJSON | null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltip, setTooltip] = useState<PlTooltipState>(null);

  const natPctsRef        = useRef(natPcts);
  const selectedRef       = useRef(selectedConst);
  const darkRef           = useRef(dark);
  const onSelectRef       = useRef(onSelect);
  const declaredRef       = useRef(declaredConsts);
  const constOverridesRef = useRef(constOverrides ?? {});
  const blankModeRef      = useRef(blankMode ?? false);
  const projectedRef      = useRef(projectedConsts ?? new Set<PlConstId>());
  const simFracRef2       = useRef(simConstFractions ?? {});
  const constDraftRef2    = useRef<PlConstDraft>(constDraft ?? null);
  const simNatPctsRef2    = useRef<Record<PlPartyId, number> | null>(simNatPcts ?? null);

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

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}poland-constituencies.geojson`)
      .then(r => r.json()).then(setGeoData).catch(console.error);
  }, []);

  const getStyle = useCallback((feature: any): L.PathOptions => {
    const geoId   = String(feature?.properties?.id ?? feature?.properties?.nr ?? '');
    const constId = PL_GEOID_TO_ID[geoId];
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

    // Vibrant choropleth: winner colour shaded by margin, high opacity. Clean now that the
    // geometry is valid — the white-triangle glitch was a geometry bug (since fixed).
    const effectiveNatPcts = simNatPcts ?? natPcts;
    const fill    = getConstFill(effectiveNatPcts, constId, dark, constOverrides?.[constId]);
    const opacity = isDeclared ? 0.78 : Math.max(0.35, 0.78 * (simFrac ?? 1));
    return { fillColor:fill, fillOpacity:opacity, weight:isSel?2:0.4, color:isSel?'#c8a020':border, opacity:1 };
  }, [natPcts, selectedConst, dark, bubbleMap, seatDots, declaredConsts, constOverrides, blankMode, simConstFractions, simNatPcts]);

  useEffect(() => { layerRef.current?.setStyle((f:any)=>getStyle(f)); }, [getStyle]);

  const onEachFeature = useCallback((feature: any, layer: L.Layer) => {
    const geoId   = String(feature?.properties?.id ?? feature?.properties?.nr ?? '');
    const constId = PL_GEOID_TO_ID[geoId];

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
      const c        = PL_CONST_MAP[constId];
      const cVotes   = c?.total2023 ?? 0;
      const pv       = calcConstVotes(effectiveNatPcts, constId, overrideToUse);
      const projSeats= calcDHondtConst(pv, c?.seats ?? 0, effectiveNatPcts);
      const parties  = (Object.entries(pv) as [PlPartyId,number][])
        .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,8)
        .map(([id,pct]) => ({ id:id as PlPartyId, pct,
          rawVotes:Math.round(pct/100*cVotes*(fraction??1)),
          projSeats:projSeats[id as PlPartyId]??0 }));
      setTooltip({ x:e.originalEvent.clientX-rect.left, y:e.originalEvent.clientY-rect.top,
        name:c?.name??geoId, nr:c?.nr??0, seats:c?.seats??0,
        parties, leader:parties[0]?.id??null,
        reportingPct:fraction!=null ? Math.round(fraction*100) : undefined });
    });
    layer.on('mouseout', () => setTooltip(null));
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[52.0, 19.4]} zoom={6} style={{ width:'100%', height:'100%' }} zoomControl worldCopyJump={false}>
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
          <PlBubbleLayer
            geoData={geoData} natPcts={simNatPcts ?? natPcts} containerRef={containerRef}
            setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef}
            declaredConsts={declaredConsts} constOverrides={constOverrides}
            constOverridesRef={constOverridesRef} blankMode={blankMode}
            projectedConsts={projectedConsts} simConstFractions={simConstFractions}
            simNatPctsRef={simNatPctsRef2}
          />
        )}
        {geoData && seatDots && (
          <PlSeatDotsLayer
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
        const cw = containerRef.current?.clientWidth ?? 9999; const TW = 244;
        const left = tooltip.x + 18 + TW > cw ? tooltip.x - TW - 10 : tooltip.x + 18;
        const tt = { bg:dark?'rgba(18,24,44,0.97)':'rgba(255,255,255,0.98)', border:dark?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.09)', shadow:dark?'0 6px 28px rgba(0,0,0,0.55)':'0 6px 28px rgba(0,0,0,0.13)', title:dark?'rgba(255,255,255,0.93)':'rgba(0,0,0,0.86)', sub:dark?'rgba(255,255,255,0.40)':'rgba(0,0,0,0.42)', body:dark?'rgba(255,255,255,0.86)':'rgba(0,0,0,0.79)' };
        return (
          <div className="absolute pointer-events-none z-[1000]" style={{ left, top:Math.max(6, tooltip.y - 20), width:TW }}>
            <div style={{ background:tt.bg, borderRadius:10, border:`1px solid ${tt.border}`, boxShadow:tt.shadow, backdropFilter:'blur(12px)', padding:'12px 14px' }}>
              <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:6 }}>
                <div style={{ fontSize:13, fontWeight:700, color:tt.title, lineHeight:1.2 }}>{tooltip.name}</div>
                <div style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', color:tt.sub }}>#{tooltip.nr} · {tooltip.seats} seats</div>
              </div>
              <div style={{ fontSize:9, fontFamily:'"JetBrains Mono",monospace', color:tt.sub, marginTop:2 }}>
                {tooltip.reportingPct!=null ? `${tooltip.reportingPct}% reporting` : 'Estimated constituency result'}
              </div>
              <div style={{ marginTop:9, display:'flex', flexDirection:'column', gap:5 }}>
                {tooltip.parties.map(({ id, pct, rawVotes, projSeats }, i) => {
                  const pColor = partyColor(id);
                  return (
                    <div key={id} style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ width:7, height:7, borderRadius:2, flexShrink:0, background:pColor }} />
                      <span style={{ flex:1, fontSize:11, fontWeight:i===0?600:400, color:tt.body, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{PL_PARTY_MAP[id]?.name??id}</span>
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
      <div className="absolute bottom-2 right-2 text-[10px] text-ink-3 select-none z-[1000] font-mono">Scroll to zoom · Click to open</div>
    </div>
  );
}

// ── Parliament hemicycle — 460 seats arranged in rows ─────────────────────────
function PlParliamentPanel({
  seats: seatsMap, onClose, exiting, dark,
}: {
  seats: Partial<Record<PlPartyId, number>>; onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  // Order left-to-right by ideology: Lewica | KO | TD | Konfederacja | PiS
  const order = PL_LR_ORDER;
  const totalSeats = order.reduce((s, id) => s + (seatsMap[id] ?? 0), 0);
  // Build flat list of seats from left to right (one slot per seat)
  const flat: PlPartyId[] = [];
  for (const id of order) {
    const n = seatsMap[id] ?? 0;
    for (let i = 0; i < n; i++) flat.push(id);
  }

  // 9-row hemicycle. Distribute by arc length so outer rows have more dots.
  const ROWS = 9;
  const innerR = 80, outerR = 200;
  const rowR  = Array.from({ length: ROWS }, (_, i) => innerR + (outerR - innerR) * (i / (ROWS - 1)));
  const arcLen = rowR.reduce((s, r) => s + r * Math.PI, 0);
  const perRow = rowR.map(r => Math.max(1, Math.round((r * Math.PI / arcLen) * totalSeats)));
  // Fix rounding so sum matches total
  let diff = totalSeats - perRow.reduce((s, n) => s + n, 0);
  let idx = perRow.length - 1;
  while (diff !== 0) { perRow[idx] += diff > 0 ? 1 : -1; diff += diff > 0 ? -1 : 1; idx = (idx - 1 + perRow.length) % perRow.length; }

  // Wikipedia parliament-diagram style: build every seat slot across all rows, then
  // order them by ANGLE (left→right across the whole arc, not row by row) so each party
  // occupies a contiguous angular wedge spanning inner→outer rows.
  const slots: { x: number; y: number; angle: number; r: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    const r = rowR[row];
    const count = perRow[row];
    for (let i = 0; i < count; i++) {
      const tFrac = count === 1 ? 0.5 : i / (count - 1);
      const angle = Math.PI - tFrac * Math.PI; // π (left) → 0 (right)
      slots.push({ x: 220 + Math.cos(angle) * r, y: 230 - Math.sin(angle) * r, angle, r });
    }
  }
  // Sort left→right by angle (π first), inner→outer on ties, then assign parties in order.
  slots.sort((a, b) => (b.angle - a.angle) || (a.r - b.r));
  const dots = slots.map((s, k) => ({
    x: s.x, y: s.y, r: 4.6,
    color: partyColor(flat[k] ?? order[order.length - 1]),
  }));

  return (
    <aside className={`w-[480px] shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">Sejm RP — Parliamentary Composition</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">{totalSeats} of 460 seats · Majority {PL_MAJORITY}</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 thin-scroll">
        <svg viewBox="0 0 440 250" width="100%" height="auto" style={{ display:'block' }}>
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.color} stroke={dark?'rgba(0,0,0,0.35)':'rgba(255,255,255,0.85)'} strokeWidth="0.55" />
          ))}
          {/* Majority marker line */}
          <line x1="220" y1="20" x2="220" y2="60" stroke={dark?'rgba(255,255,255,0.35)':'rgba(0,0,0,0.45)'} strokeWidth="1" strokeDasharray="3 3" />
          <text x="220" y="14" textAnchor="middle" fontSize="9" fontFamily="JetBrains Mono, monospace" fill={dark?'rgba(255,255,255,0.55)':'rgba(0,0,0,0.55)'}>231</text>
        </svg>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {order.map(id => {
            const n = seatsMap[id] ?? 0; if (n === 0) return null;
            const p = PL_PARTY_MAP[id];
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
function PlCoalitionPanel({ seats, onClose, exiting, dark: _dark }: {
  seats: Partial<Record<PlPartyId, number>>; onClose: () => void; exiting?: boolean; dark?: boolean;
}) {
  const [selected, setSelected] = useState<Set<PlPartyId>>(new Set());
  const total = useMemo(() => Array.from(selected).reduce((s, id) => s + (seats[id] ?? 0), 0), [selected, seats]);
  const presets: { name: string; ids: PlPartyId[] }[] = [
    { name: 'Koalicja 15.10 (KO+TD+Lewica)',         ids: ['KO','TD','LEWICA'] },
    { name: 'Prawica zjednoczona (PiS+Konfederacja)', ids: ['PIS','KONF'] },
    { name: 'Centroprawica (KO+TD)',                  ids: ['KO','TD'] },
    { name: 'Lewica + Centrum (KO+Lewica)',           ids: ['KO','LEWICA'] },
  ];

  return (
    <aside className={`w-[360px] shrink-0 bg-white border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">Coalition Builder</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Majority needs {PL_MAJORITY} / 460</p>
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
                <span className={`font-mono font-bold ${t >= PL_MAJORITY ? 'text-emerald-600' : 'text-ink-3'}`}>{t}</span>
              </button>
            );
          })}
        </div>
        <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.16em] text-ink-3 mb-2">Parties</div>
        <div className="flex flex-col gap-1.5">
          {PL_LR_ORDER.map(id => {
            const p = PL_PARTY_MAP[id]; const n = seats[id] ?? 0;
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
          <span className={`text-2xl font-mono font-bold ${total >= PL_MAJORITY ? 'text-emerald-600' : 'text-ink'}`}>{total}</span>
        </div>
        {total >= PL_MAJORITY && (
          <div className="mt-2 text-[10px] font-mono text-emerald-600">✓ This coalition has a majority.</div>
        )}
      </div>
    </aside>
  );
}

// ── Parties panel (hide/show + threshold info) ────────────────────────────────
function PlPartiesPanel({ hiddenParties, onToggle, onClose, dark: _dark }: {
  hiddenParties: Set<PlPartyId>; onToggle: (id: PlPartyId) => void; onClose: () => void; dark?: boolean;
}) {
  return (
    <aside className="absolute right-3 top-3 z-[60] w-72 bg-white border border-default rounded-[6px] shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-default">
        <h2 className="text-[12px] font-bold text-ink">Parties</h2>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto px-2 py-2 thin-scroll">
        {PL_LR_ORDER.map(id => {
          const p = PL_PARTY_MAP[id]; const hidden = hiddenParties.has(id);
          return (
            <button key={id} onClick={() => onToggle(id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-[4px] hover:bg-hover text-left text-[11px] ${hidden ? 'opacity-40' : ''}`}>
              <span style={{ width:10, height:10, borderRadius:2, background:p.color }} />
              <span className="font-semibold text-ink">{p.name}</span>
              <span className="text-ink-3 truncate">{p.fullName}</span>
              <span className="ml-auto text-[9px] font-mono text-ink-3 uppercase">{p.threshold}% thr</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ── Constituency editor / blank-map slider panel ──────────────────────────────
function PlConstPanel({
  constId, natPcts, constOverride, onOverride, onResetOverride, onClose,
  isBlankMode, isProjected, reportingPct, onProject, onReportingPctChange,
  onDraftChange, hiddenParties, dark,
}: {
  constId: PlConstId; natPcts: Record<PlPartyId, number>;
  constOverride?: Partial<Record<PlPartyId, number>>;
  onOverride: (pcts: Partial<Record<PlPartyId, number>>) => void;
  onResetOverride: () => void; onClose: () => void;
  isBlankMode?: boolean; isProjected?: boolean; reportingPct?: number;
  onProject?: () => void; onReportingPctChange?: (pct: number) => void;
  onDraftChange?: (pcts: Record<PlPartyId, number>, rptPct: number) => void;
  hiddenParties?: Set<PlPartyId>; dark?: boolean;
}) {
  const [locks, setLocks] = useState<Set<PlPartyId>>(new Set());
  const baseVotes = useMemo(() => calcConstVotes(natPcts, constId), [natPcts, constId]);
  const [draftPcts, setDraftPcts] = useState<Record<PlPartyId, number>>(() =>
    constOverride && Object.keys(constOverride).length > 0
      ? { ...calcConstVotes(natPcts, constId, constOverride) }
      : { ...baseVotes });
  const [localRptPct, setLocalRptPct] = useState(reportingPct ?? 100);
  const [touched, setTouched] = useState(!!constOverride && Object.keys(constOverride).length > 0);

  useEffect(() => {
    setLocks(new Set());
    const base = calcConstVotes(natPcts, constId);
    setDraftPcts(constOverride && Object.keys(constOverride).length > 0
      ? { ...calcConstVotes(natPcts, constId, constOverride) } : { ...base });
    setLocalRptPct(reportingPct ?? 100);
    setTouched(!!constOverride && Object.keys(constOverride).length > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constId]);

  useEffect(() => { if (isBlankMode) onDraftChange?.(draftPcts, localRptPct); }, [draftPcts, localRptPct, isBlankMode]); // eslint-disable-line

  const effectiveLocks = useMemo(() => new Set<PlPartyId>([...locks, ...(hiddenParties ?? [])]), [locks, hiddenParties]);
  const displayPv  = isBlankMode ? draftPcts : calcConstVotes(natPcts, constId, constOverride);
  const [sortedIds] = useState<PlPartyId[]>(() =>
    PL_PARTIES.map(p => p.id).filter(id => (baseVotes[id] ?? 0) > 0)
      .sort((a, b) => (baseVotes[b] ?? 0) - (baseVotes[a] ?? 0)));
  const c           = PL_CONST_MAP[constId];
  const winner      = PL_PARTIES.reduce((best, p) => (displayPv[p.id] ?? 0) > (displayPv[best.id] ?? 0) ? p : best, PL_PARTIES[0]);
  const hasOverride = !!constOverride && Object.keys(constOverride).length > 0;
  const constTotalVotes = c?.total2023 ?? 0;
  const sliderTrack = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';

  const handleSlider = (id: PlPartyId, val: number) => {
    if (isBlankMode) { setDraftPcts(redistributePcts(draftPcts, id, val, effectiveLocks)); setTouched(true); }
    else onOverride(redistributePcts(displayPv as Record<PlPartyId, number>, id, val, effectiveLocks));
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
              Okręg #{c?.nr ?? 0} · {c?.seats ?? 0} mandatów ·{' '}
              {isBlankMode
                ? (isProjected ? 'Projected · adjust & re-project' : 'Blank · set okręg result')
                : (hasOverride ? 'Custom override' : 'Estimated · drag sliders')}
            </p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-[4px]"
          style={{ borderLeft:`3px solid ${winner.color}`, background:dark ? 'rgba(255,255,255,0.04)' : '#f8f7f4' }}>
          <span className="text-[11px] font-medium text-ink flex-1 truncate">{winner.fullName}</span>
          <span className="text-[9px] font-mono text-ink-3">{(displayPv[winner.id] ?? 0).toFixed(1)}%</span>
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
            const p = PL_PARTY_MAP[id];
            const pct = displayPv[id] ?? 0;
            const isLocked = locks.has(id);
            const color = p.color;
            const rawVotes = Math.round((pct / 100) * constTotalVotes * (isBlankMode ? localRptPct / 100 : 1));
            const natPct = natPcts[id] ?? 0;
            const belowThresh = natPct < p.threshold;
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
                      ⚠ nat. {natPct.toFixed(1)}% &lt; {p.threshold}%
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
            <button onClick={() => { onResetOverride(); setTouched(false); setDraftPcts({ ...calcConstVotes(natPcts, constId) }); }}
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

// ── Breakdown panel — Polish coalition stats + electoral metrics ──────────────
// Voivodeship rollup for breakdown (which okręgi belong to each voivodeship)
const PL_VOIVODESHIPS: { name: string; ids: PlConstId[] }[] = [
  { name: 'Dolnośląskie',          ids: ['C01','C02','C03'] },
  { name: 'Kujawsko-Pomorskie',    ids: ['C04','C05'] },
  { name: 'Lubelskie',             ids: ['C06','C07'] },
  { name: 'Lubuskie',              ids: ['C08'] },
  { name: 'Łódzkie',               ids: ['C09','C10','C11'] },
  { name: 'Małopolskie',           ids: ['C12','C13','C14','C15'] },
  { name: 'Mazowieckie',           ids: ['C16','C17','C18','C19','C20'] },
  { name: 'Opolskie',              ids: ['C21'] },
  { name: 'Podkarpackie',          ids: ['C22','C23'] },
  { name: 'Podlaskie',             ids: ['C24'] },
  { name: 'Pomorskie',             ids: ['C25','C26'] },
  { name: 'Śląskie',               ids: ['C27','C28','C29','C30','C31','C32'] },
  { name: 'Świętokrzyskie',        ids: ['C33'] },
  { name: 'Warmińsko-Mazurskie',   ids: ['C34','C35'] },
  { name: 'Wielkopolskie',         ids: ['C36','C37','C38','C39'] },
  { name: 'Zachodniopomorskie',    ids: ['C40','C41'] },
];

function PlBreakdownPanel({
  seats, natPcts, isBaseline, onClose, exiting, dark, constOverrides,
}: {
  seats: Partial<Record<PlPartyId, number>>; natPcts: Record<PlPartyId, number>;
  isBaseline?: boolean; onClose: () => void; exiting?: boolean; dark?: boolean;
  constOverrides?: Partial<Record<PlConstId, Partial<Record<PlPartyId, number>>>>;
}) {
  const totalS = PL_LR_ORDER.reduce((s, id) => s + (seats[id] ?? 0), 0);
  const totalV = PL_PARTIES.reduce((s, p) => s + (natPcts[p.id] ?? 0), 0);

  const enp = totalS > 0 ? 1 / PL_LR_ORDER.reduce((s, id) => { const sh = (seats[id] ?? 0) / totalS; return s + sh * sh; }, 0) : 0;
  const gallagher = Math.sqrt(PL_PARTIES.reduce((s, p) => {
    const v = totalV > 0 ? (natPcts[p.id] ?? 0) / totalV * 100 : 0;
    const sv = totalS > 0 ? (seats[p.id] ?? 0) / totalS * 100 : 0;
    return s + Math.pow(v - sv, 2);
  }, 0) / 2);
  const largest = [...PL_LR_ORDER].sort((a, b) => (seats[b] ?? 0) - (seats[a] ?? 0))[0];
  const shortOf = PL_MAJORITY - (seats[largest] ?? 0);

  // Threshold check (national minorities are exempt)
  const belowThr = PL_PARTIES.filter(p => !p.exempt && (natPcts[p.id] ?? 0) > 0 && (natPcts[p.id] ?? 0) < p.threshold);

  // Voivodeship strongholds
  const voivWinners = useMemo(() => {
    return PL_VOIVODESHIPS.map(v => {
      const tally: Partial<Record<PlPartyId, number>> = {};
      for (const cId of v.ids) {
        const c = PL_CONST_MAP[cId];
        const cv = calcConstVotes(natPcts, cId, constOverrides?.[cId]);
        for (const p of PL_PARTIES) tally[p.id] = (tally[p.id] ?? 0) + (cv[p.id] ?? 0) * c.total2023 / 100;
      }
      const sorted = (Object.entries(tally) as [PlPartyId, number][]).sort(([, a], [, b]) => b - a);
      const total = sorted.reduce((s, [, v]) => s + v, 0);
      const win = sorted[0];
      return { name: v.name, winner: win?.[0] as PlPartyId, share: total > 0 ? (win?.[1] ?? 0) / total * 100 : 0, totalSeats: v.ids.reduce((s, id) => s + (PL_CONST_MAP[id]?.seats ?? 0), 0) };
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
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Sejm RP — nerd stats</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      {totalS === 0 ? (
        <div className="flex items-center justify-center flex-1 text-[11px] font-mono text-ink-3 px-4 text-center">Load results or run simulation first</div>
      ) : (
        <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3.5 space-y-5">
          <Section title="Seats by Party">
            {[...PL_LR_ORDER].filter(id => (seats[id] ?? 0) > 0).sort((a, b) => (seats[b] ?? 0) - (seats[a] ?? 0)).map(id => {
              const p = PL_PARTY_MAP[id]; const n = seats[id] ?? 0;
              return (
                <div key={id} style={{ background: cardBg, borderRadius:5, padding:'6px 8px', borderLeft:`3px solid ${p.color}` }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-bold text-ink">{p.name}</div>
                      <div className="text-[8px] font-mono" style={{ color: ink2 }}>{p.fullName}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-[18px] font-black font-mono" style={{ color: p.color }}>{n}</span>
                      <div className="text-[7.5px] font-mono" style={{ color: n >= PL_MAJORITY ? '#16a34a' : ink3 }}>
                        {n >= PL_MAJORITY ? '✓ większość' : `${(n / PL_TOTAL_SEATS * 100).toFixed(1)}% miejsc`}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full overflow-hidden"
                    style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
                    <div style={{ width:`${Math.min(n / PL_TOTAL_SEATS * 100, 100)}%`, height:'100%', borderRadius:4, background: p.color }} />
                  </div>
                </div>
              );
            })}
          </Section>

          <Section title="Electoral Statistics">
            <Stat label="Effective No. of Parties (ENP)" value={enp.toFixed(2)} sub="1/Σsᵢ² — higher = more fragmented" />
            <Stat label="Gallagher Index" value={gallagher.toFixed(2)} sub="lower = more proportional (D'Hondt)" />
            <Stat label="Largest party" value={`${PL_PARTY_MAP[largest]?.name} — ${seats[largest] ?? 0}`}
              sub={shortOf > 0 ? `${shortOf} short of majority` : '✓ Single-party majority'} />
            <Stat label="Thresholds" value="5% single · 8% coalition" sub="applied nationally before D'Hondt" />
          </Section>

          {belowThr.length > 0 && (
            <Section title="⚠ Below Threshold">
              {belowThr.map(p => (
                <div key={p.id} style={{ background: cardBg, borderRadius:5, padding:'5px 8px', display:'flex', alignItems:'center', gap:8 }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                  <span className="text-[10px] font-medium text-ink flex-1">{p.name}</span>
                  <span className="text-[9px] font-mono text-amber-600">{(natPcts[p.id] ?? 0).toFixed(1)}% &lt; {p.threshold}%</span>
                </div>
              ))}
            </Section>
          )}

          <Section title="Swing vs 2023">
            {PL_LR_ORDER.filter(id => (natPcts[id] ?? 0) > 0.3 || (isBaseline && (PL_VOTE_PCT_2023[id] ?? 0) > 0)).map(id => {
              const vSwing = (natPcts[id] ?? 0) - PL_VOTE_PCT_2023[id];
              const sSwing = (seats[id] ?? 0) - (PL_PARTY_MAP[id].seats2023 ?? 0);
              const color = partyColor(id);
              return (
                <div key={id} style={{ background: cardBg, borderRadius:5, padding:'5px 8px', display:'flex', alignItems:'center', gap:8 }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[10px] font-medium text-ink flex-1">{PL_PARTY_MAP[id].name}</span>
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
            {PL_LR_ORDER.filter(id => (natPcts[id] ?? 0) >= 0.5).map(id => {
              const vPct = totalV > 0 ? (natPcts[id] ?? 0) / totalV * 100 : 0;
              const sPct = totalS > 0 ? (seats[id] ?? 0) / totalS * 100 : 0;
              const diff = sPct - vPct;
              const color = partyColor(id);
              return (
                <div key={id} style={{ background: cardBg, borderRadius:5, padding:'5px 8px' }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9.5px] font-medium text-ink">{PL_PARTY_MAP[id].name}</span>
                    <span className="text-[8.5px] font-mono" style={{ color: Math.abs(diff) < 1 ? ink3 : diff > 0 ? '#16a34a' : '#ef4444' }}>
                      {diff > 0 ? '+' : ''}{diff.toFixed(1)}% seat bonus
                    </span>
                  </div>
                  <div className="flex gap-1 items-center">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}>
                      <div style={{ width:`${Math.min(vPct / 40 * 100, 100)}%`, height:'100%', background: hexToRgba(color, 0.45), borderRadius:4 }} />
                    </div>
                    <span className="text-[7.5px] font-mono text-ink-3 w-8 text-right tabular-nums">{vPct.toFixed(1)}%v</span>
                  </div>
                  <div className="flex gap-1 items-center mt-0.5">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)' }}>
                      <div style={{ width:`${Math.min(sPct / 40 * 100, 100)}%`, height:'100%', background: color, borderRadius:4 }} />
                    </div>
                    <span className="text-[7.5px] font-mono text-ink-3 w-8 text-right tabular-nums">{sPct.toFixed(1)}%s</span>
                  </div>
                </div>
              );
            })}
          </Section>

          <Section title="Voivodeship Strongholds (16 województw)">
            {voivWinners.sort((a, b) => b.totalSeats - a.totalSeats).map(v => {
              const color = partyColor(v.winner);
              return (
                <div key={v.name} style={{ background: cardBg, borderRadius:5, padding:'5px 8px', display:'flex', alignItems:'center', gap:8, borderLeft:`3px solid ${color}` }}>
                  <span className="text-[10px] font-medium text-ink flex-1 truncate">{v.name}</span>
                  <span className="text-[9px] font-mono text-ink-2" style={{ minWidth:30, textAlign:'right' }}>{v.totalSeats}m</span>
                  <span className="text-[9px] font-mono font-bold tabular-nums" style={{ color, minWidth:32, textAlign:'right' }}>{v.share.toFixed(0)}%</span>
                  <span className="text-[9px] font-bold" style={{ color, minWidth:36, textAlign:'right' }}>{PL_PARTY_MAP[v.winner]?.name}</span>
                </div>
              );
            })}
          </Section>

          <Section title="Coalition Presets">
            {[
              { name:'Koalicja 15.10', emoji:'🤝', ids:['KO','TD','LEWICA'] as PlPartyId[] },
              { name:'Prawica zjednoczona', emoji:'⚔️', ids:['PIS','KONF'] as PlPartyId[] },
              { name:'Centroprawica', emoji:'🏛️', ids:['KO','TD'] as PlPartyId[] },
              { name:'Lewica + Centrum', emoji:'🌹', ids:['KO','LEWICA'] as PlPartyId[] },
              { name:'Wielka Koalicja', emoji:'🇵🇱', ids:['PIS','KO'] as PlPartyId[] },
            ].map(c => {
              const cs = c.ids.reduce((s, id) => s + (seats[id] ?? 0), 0);
              const ok = cs >= PL_MAJORITY;
              return (
                <div key={c.name} style={{ background: cardBg, borderRadius:5, padding:'6px 8px', display:'flex', alignItems:'center', gap:8 }}>
                  <span>{c.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[9.5px] font-bold text-ink truncate">{c.name}</div>
                    <div className="text-[7.5px] font-mono" style={{ color: ink3 }}>{c.ids.map(id => PL_PARTY_MAP[id]?.name).join('+')}</div>
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
function PlTutorialPanel({ onClose, exiting, dark }: { onClose: () => void; exiting?: boolean; dark?: boolean }) {
  const H2 = ({ c }: { c: string }) => <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-4 mb-1.5 first:mt-0">{c}</div>;
  const P  = ({ c }: { c: string }) => <p className="text-[11px] text-ink leading-relaxed mb-2">{c}</p>;
  const Note = ({ c }: { c: string }) => <div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{c}</div>;
  return (
    <aside className={`w-80 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting ? 'panel-exit' : 'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1>
          <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Polish Sejm Election Guide</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2 c="The Polish Electoral System" />
        <P c="Poland elects its 460-seat Sejm by open-list proportional representation. The country is divided into 41 multi-member constituencies (okręgi). Each okręg returns between 7 and 20 deputies depending on its population." />
        <Note c="The D'Hondt method is used to allocate seats per constituency: each party's votes are divided by 1, 2, 3, …, and seats go to the highest remaining quotients." />
        <H2 c="The Dual National Threshold" />
        <P c="A party must clear 5% of the national vote to enter the Sejm. A coalition list (e.g. Trzecia Droga, Lewica) must clear 8% nationally. Below threshold = zero seats, no matter how strong locally." />
        <Note c="In 2023 every major list cleared their threshold — but historically lists like Lewica Razem (2015, 3.62%) or Trzecia Droga (in some polls) sit dangerously near the line." />
        <H2 c="The 2023 Election" />
        <P c="On 15 October 2023, PiS won the most votes (35.38% / 194 seats) but lost its parliamentary majority. KO (30.70%), Trzecia Droga (14.40%) and Lewica (8.61%) — the 'Koalicja 15 października' — together took 248 seats and formed a Tusk-led government on 11 December 2023." />
        <H2 c="Map Presets" />
        <P c="2023 Baseline — actual PKW per-okręg results. 2026 Polling — apply current polling as a proportional swing across all okręgi. Blank Map — project each okręg manually on election night." />
        <H2 c="Editing an Okręg" />
        <P c="Click any shaded constituency to open its slider panel. Drag a party's slider or lock it. The % reporting slider on top scales how many votes have been counted so far." />
        <H2 c="Project Result Button" />
        <P c="On the blank map, nothing updates until you click Project Result (or Update Projection). The button only enables after you touch a slider." />
        <H2 c="Simulation" />
        <P c="Pick a speed (1/2/5/10 min), then click Run. Each of the 41 okręgi reports in 5 random-sized batches on a bell-curve schedule. D'Hondt re-runs per constituency live as new vote counts arrive." />
        <H2 c="Parliament View" />
        <P c="460 seats in a semicircle, sorted left→right by ideology: Razem · Lewica · KO · Trzecia Droga · Konfederacja · KKP · PiS. Majority line marks 231." />
      </div>
    </aside>
  );
}

// ── Reporting widget ──────────────────────────────────────────────────────────
function PlReportingWidget({
  projectedConsts, constReportingPct, simConstFractions, isSim, live, dark,
}: {
  projectedConsts: Set<PlConstId>; constReportingPct: Partial<Record<PlConstId, number>>;
  simConstFractions: Partial<Record<PlConstId, number>>; isSim: boolean; live?: boolean; dark?: boolean;
}) {
  const bg     = dark ? 'rgba(7,13,28,0.90)' : 'rgba(255,255,255,0.94)';
  const border = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';
  const ink2   = dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.42)';

  let reportedVotes = 0, projCount = 0;
  if (isSim) {
    for (const [cId, frac] of Object.entries(simConstFractions) as [PlConstId, number][]) {
      reportedVotes += (PL_CONST_MAP[cId]?.total2023 ?? 0) * (frac ?? 0);
      if ((frac ?? 0) > 0) projCount++;
    }
  } else {
    for (const cId of projectedConsts) {
      const rPct = (constReportingPct[cId] ?? 100) / 100;
      reportedVotes += (PL_CONST_MAP[cId]?.total2023 ?? 0) * rPct;
      projCount++;
    }
  }
  const reportedPct = Math.min(100, (reportedVotes / PL_GRAND_TOTAL_VALID) * 100);
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
        {projCount} <span className="text-[10px] font-semibold" style={{ color: ink2 }}>/ {PL_CONSTITUENCIES.length}</span>
      </div>
      <div className="text-[9px] font-mono mt-0.5 mb-2" style={{ color: ink2 }}>
        {isSim ? 'okręgi declared' : 'okręgi projected'}
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
// Keeps a local string buffer so the player can type freely (incl. trailing decimals)
// without the value being re-parsed/reformatted mid-keystroke. Reports a clamped number.
function PlSimInput({ value, color, dark, onChange }: {
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
        if (!/^\d*\.?\d*$/.test(s)) return;       // digits + one optional decimal point only
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
export default function PolandApp() {
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => localStorage.getItem('darkMode') !== 'false');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('darkMode', String(dark));
  }, [dark]);

  // ── Preset / national pcts ──────────────────────────────────────────────────
  const [preset, setPreset]     = useState<'baseline'|'blank'|'polling2026'|'custom'>('polling2026');
  const [natPcts, setNatPcts]   = useState<Record<PlPartyId, number>>(() => ({ ...PL_VOTE_PCT_2026 }));

  function loadBaseline()    { setNatPcts({ ...PL_VOTE_PCT_2023 });  setPreset('baseline');    resetMapState(); }
  function loadPolling2026() { setNatPcts({ ...PL_VOTE_PCT_2026 });  setPreset('polling2026'); resetMapState(); }
  function loadBlank() {
    setNatPcts(Object.fromEntries(PL_PARTIES.map(p => [p.id, 100 / PL_PARTIES.length])) as Record<PlPartyId, number>);
    setPreset('blank'); resetMapState();
  }

  function resetMapState() {
    setSimSeats(undefined); setDeclaredConsts(undefined);
    setConstOverrides({}); setProjectedConsts(new Set());
    setConstReportingPct({}); setSimConstFractions({});
    setConstDraft(null); setSimNatPcts(null); stopSim();
  }

  // ── Constituency overrides (blank map) ───────────────────────────────────────
  const [constOverrides, setConstOverrides]       = useState<Partial<Record<PlConstId, Partial<Record<PlPartyId, number>>>>>({});
  const [projectedConsts, setProjectedConsts]     = useState<Set<PlConstId>>(new Set());
  const [constReportingPct, setConstReportingPct] = useState<Partial<Record<PlConstId, number>>>({});
  const [constDraft, setConstDraft]               = useState<PlConstDraft>(null);

  // National display %s — weighted average across projected okręgi in blank mode
  const blankDisplayPcts = useMemo<Record<PlPartyId, number>>(() => {
    const zero = Object.fromEntries(PL_PARTIES.map(p => [p.id, 0])) as Record<PlPartyId, number>;
    if (preset !== 'blank') return zero;
    const weighted: Partial<Record<PlPartyId, number>> = {};
    let totalW = 0;
    for (const cId of projectedConsts) {
      const cv   = calcConstVotes(natPcts, cId, constOverrides[cId]);
      const rPct = (constReportingPct[cId] ?? 100) / 100;
      const w    = (PL_CONST_MAP[cId]?.total2023 ?? 0) * rPct;
      for (const p of PL_PARTIES) weighted[p.id] = (weighted[p.id] ?? 0) + (cv[p.id] ?? 0) * w;
      totalW += w;
    }
    if (totalW === 0) return zero;
    return Object.fromEntries(PL_PARTIES.map(p => [p.id, (weighted[p.id] ?? 0) / totalW])) as Record<PlPartyId, number>;
  }, [preset, projectedConsts, constOverrides, constReportingPct, natPcts]);

  const blankVoteScale = useMemo(() => {
    if (preset !== 'blank') return 1;
    const projVotes = [...projectedConsts].reduce((s, cId) =>
      s + (PL_CONST_MAP[cId]?.total2023 ?? 0) * ((constReportingPct[cId] ?? 100) / 100), 0);
    return Math.min(1, projVotes / PL_GRAND_TOTAL_VALID);
  }, [preset, projectedConsts, constReportingPct]);

  // For 2023/2026 with per-constituency overrides — recompute national rollup
  const overrideDisplayPcts = useMemo<Record<PlPartyId, number>>(() => {
    const hasAny = Object.values(constOverrides).some(o => o && Object.keys(o).length > 0);
    if (!hasAny) return natPcts;
    const weighted: Partial<Record<PlPartyId, number>> = {};
    let totalW = 0;
    for (const c of PL_CONSTITUENCIES) {
      const cv = calcConstVotes(natPcts, c.id, constOverrides[c.id]);
      const w  = c.total2023;
      for (const p of PL_PARTIES) weighted[p.id] = (weighted[p.id] ?? 0) + (cv[p.id] ?? 0) * w;
      totalW += w;
    }
    if (totalW === 0) return natPcts;
    return Object.fromEntries(PL_PARTIES.map(p => [p.id, (weighted[p.id] ?? 0) / totalW])) as Record<PlPartyId, number>;
  }, [natPcts, constOverrides]);

  const displayPcts = preset === 'blank' ? blankDisplayPcts : overrideDisplayPcts;

  // ── UI state ────────────────────────────────────────────────────────────────
  const [selectedConst, setSelectedConst]         = useState<PlConstId | null>(null);
  const [bubbleMap, setBubbleMap]                 = useState(false);
  const [seatDots, setSeatDots]                   = useState(false);
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [hiddenParties, setHiddenParties]         = useState<Set<PlPartyId>>(new Set());

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
  const [simDraftPcts,  setSimDraftPcts]  = useState<Record<PlPartyId, number>>(() => ({ ...PL_VOTE_PCT_2026 }));
  const [, setSimDraftTouched]            = useState(false);
  const [simDuration, setSimDuration]     = useState<60000|120000|300000|600000>(120000);
  const [simNatPcts, setSimNatPcts]       = useState<Record<PlPartyId, number> | null>(null);
  const [simSeats, setSimSeats]           = useState<Partial<Record<PlPartyId, number>> | undefined>();
  const [simProgress, setSimProgress]     = useState(0);
  const [simRunning, setSimRunning]       = useState(false);
  const [declaredConsts, setDeclaredConsts] = useState<Set<PlConstId> | undefined>();
  const [simConstFractions, setSimConstFractions] = useState<Partial<Record<PlConstId, number>>>({});
  const simTimersRef  = useRef<ReturnType<typeof setTimeout>[]>([]);
  const simNatPctsRef = useRef<Record<PlPartyId, number>>(natPcts);

  useEffect(() => { if (rightPanel === 'sim') { setSimDraftPcts({ ...natPcts }); setSimDraftTouched(false); } }, [rightPanel === 'sim']); // eslint-disable-line

  // Sum of the editable party inputs. Player types freely (no auto-redistribution);
  // simulation may only run when the total is between 95% and 100%.
  const simDraftTotal = useMemo(
    () => PL_LR_ORDER.filter(id => !hiddenParties.has(id)).reduce((s, id) => s + (simDraftPcts[id] ?? 0), 0),
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
    const PARTS = 5;
    const totalC = PL_CONSTITUENCIES.length;
    const allTimes = plBellCurveTimes(PARTS * totalC, simDuration);
    const cIds = [...PL_CONSTITUENCIES.map(c => c.id)].sort(() => Math.random() - 0.5);
    const events: { cId: PlConstId; cumFrac: number; t: number }[] = [];
    for (let pi = 0; pi < totalC; pi++) {
      const cId    = cIds[pi];
      const pTimes = allTimes.slice(pi * PARTS, (pi + 1) * PARTS).sort((a, b) => a - b);
      const cuts   = [0, Math.random(), Math.random(), Math.random(), Math.random(), 1].sort((a, b) => a - b);
      const sizes  = cuts.slice(1).map((cv, i) => cv - cuts[i]);
      let cumFrac = 0;
      for (let b = 0; b < PARTS; b++) {
        cumFrac = Math.min(1, cumFrac + sizes[b]);
        events.push({ cId, cumFrac, t: pTimes[b] });
      }
    }
    events.sort((a, b) => a.t - b.t);
    setSimRunning(true); setSimProgress(0);
    setSimSeats(undefined); setDeclaredConsts(new Set()); setSimConstFractions({});
    const localFrac: Partial<Record<PlConstId, number>> = {};
    const localDecl = new Set<PlConstId>();
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const ev of events) {
      timers.push(setTimeout(() => {
        localFrac[ev.cId] = ev.cumFrac;
        if (ev.cumFrac >= 0.999) localDecl.add(ev.cId);
        const fracSnap = { ...localFrac };
        const declSnap = new Set(localDecl);
        setSimConstFractions(fracSnap);
        setDeclaredConsts(declSnap);
        setSimProgress(Object.keys(fracSnap).length);
        setSimSeats(calcPartialSeats(simNatPctsRef.current, fracSnap));
        if (Object.values(fracSnap).every(f => (f ?? 0) >= 0.999) && Object.keys(fracSnap).length >= totalC) {
          setSimSeats(calcAllConstSeats(simNatPctsRef.current));
          setSimRunning(false);
        }
      }, ev.t));
    }
    simTimersRef.current = timers;
  }

  const displaySeats = useMemo(() => simSeats ?? calcAllConstSeats(displayPcts), [simSeats, displayPcts]);

  const simPartialPcts = useMemo<Record<PlPartyId, number> | null>(() => {
    if (!simNatPcts) return null;
    const entries = Object.entries(simConstFractions) as [PlConstId, number][];
    if (entries.length === 0) return null;
    const weighted: Partial<Record<PlPartyId, number>> = {};
    let totalW = 0;
    for (const [cId, frac] of entries) {
      if (!frac) continue;
      const w  = (PL_CONST_MAP[cId]?.total2023 ?? 0) * frac;
      const cv = calcConstVotes(simNatPcts, cId);
      for (const p of PL_PARTIES) weighted[p.id] = (weighted[p.id] ?? 0) + (cv[p.id] ?? 0) * w;
      totalW += w;
    }
    if (totalW === 0) return null;
    return Object.fromEntries(PL_PARTIES.map(p => [p.id, (weighted[p.id] ?? 0) / totalW])) as Record<PlPartyId, number>;
  }, [simNatPcts, simConstFractions]);

  const simVoteScale = useMemo(() => {
    if (!simNatPcts) return undefined;
    const reportedVotes = (Object.entries(simConstFractions) as [PlConstId, number][])
      .reduce((s, [cId, frac]) => s + (PL_CONST_MAP[cId]?.total2023 ?? 0) * (frac ?? 0), 0);
    return Math.min(1, reportedVotes / PL_GRAND_TOTAL_VALID);
  }, [simNatPcts, simConstFractions]);

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
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="pl">
      {/* ── Header ── */}
      <header className={`h-[52px] ${dark ? 'bg-[rgba(7,13,28,0.94)]' : 'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4"><GlobeLogo /></button>
        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          {/* Polish flag — two horizontal stripes white over red */}
          <svg width="18" height="12" viewBox="0 0 18 12" className="shrink-0 rounded-[2px] opacity-90" style={{ border:'1px solid rgba(0,0,0,0.12)' }}>
            <rect x="0" y="0" width="18" height="6" fill="#fff" />
            <rect x="0" y="6" width="18" height="6" fill="#DC143C" />
          </svg>
          <span className="text-[11px] font-bold text-ink shrink-0 hidden sm:block">Poland</span>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={loadBaseline}    className={preset === 'baseline'    ? btnGold : btnMuted}>2023 Baseline</button>
          <button onClick={loadPolling2026} className={preset === 'polling2026' ? btnGold : btnMuted}>2026 Polling</button>
          <button onClick={loadBlank}       className={preset === 'blank'       ? btnGold : btnMuted}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5" />
          <button onClick={() => openRight('sim')}       className={rightPanel === 'sim'      ? btnActive : btnMuted}>▶ Simulation</button>
          <button onClick={() => !simRunning && openLeft('parties')} disabled={simRunning}
            className={`${leftPanel === 'parties' ? btnActive : btnMuted}${simRunning ? ' opacity-40 cursor-not-allowed' : ''}`}
            title={simRunning ? 'Parties locked while simulation runs' : 'Show/hide parties'}>Parties</button>
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
        <PlScoreboard
          natPcts={simPartialPcts ?? (simNatPcts ?? displayPcts)}
          simSeats={simSeats}
          isBaseline={preset === 'baseline' && !simNatPcts}
          is2026={preset !== 'baseline' || !!simNatPcts}
          dark={dark}
          reportedVoteScale={simNatPcts != null ? simVoteScale : (preset === 'blank' ? blankVoteScale : undefined)}
        />
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {leftPanel === 'parties' && (
          <PlPartiesPanel
            hiddenParties={hiddenParties}
            onToggle={id => setHiddenParties(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; })}
            onClose={() => openLeft('parties')} dark={dark} />
        )}
        {showParli     && <PlParliamentPanel seats={displaySeats} onClose={() => openLeft('parli')}     exiting={exitLeft  === 'parli'}     dark={dark} />}

        {/* MAP */}
        <div className="relative flex-1 min-w-0 min-h-0">
          <PlMapView
            natPcts={natPcts} selectedConst={selectedConst}
            onSelect={c => setSelectedConst(prev => prev === c ? null : c)}
            dark={dark} bubbleMap={bubbleMap} seatDots={seatDots}
            declaredConsts={declaredConsts} constOverrides={constOverrides}
            blankMode={preset === 'blank'} projectedConsts={projectedConsts}
            simConstFractions={simConstFractions}
            constDraft={preset === 'blank' ? constDraft : null}
            simNatPcts={simNatPcts}
          />
          {(preset === 'blank' || simRunning || simSeats != null) && (
            <PlReportingWidget
              projectedConsts={projectedConsts} constReportingPct={constReportingPct}
              simConstFractions={simConstFractions}
              isSim={simRunning || (simSeats != null && preset !== 'blank')}
              live={simRunning}
              dark={dark}
            />
          )}
        </div>

        {/* RIGHT panels */}
        {rightPanel === 'sim' && (
          <aside className={`w-72 shrink-0 ${dark ? 'bg-[#0d1b2e]' : 'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
              <div>
                <h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2>
                <p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Set shares · then run</p>
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
              Type each party's vote %. Values are not auto-balanced — the total must be between 95% and 100% to run.
            </div>
            <div className="flex-1 overflow-y-auto px-3.5 py-2 thin-scroll space-y-2">
              {PL_LR_ORDER.filter(id => !hiddenParties.has(id)).map(id => {
                const party    = PL_PARTY_MAP[id];
                const pct      = simDraftPcts[id] ?? 0;
                const color    = partyColor(id);
                const rawVotes = Math.round(pct / 100 * PL_GRAND_TOTAL_VALID);
                const belowThr = !party.exempt && pct < party.threshold;
                return (
                  <div key={id} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-medium text-ink truncate leading-tight">{party.fullName}</div>
                      <div className="text-[8px] font-mono leading-tight" style={{ color: party.exempt ? '#16a34a' : belowThr ? '#f59e0b' : (dark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.35)') }}>
                        {fmtN(rawVotes)} votes · {party.exempt ? 'exempt' : belowThr ? `⚠ < ${party.threshold}%` : `≥ ${party.threshold}%`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <PlSimInput value={pct} color={color} dark={dark}
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
                {simRunning ? `${simProgress}/${PL_CONSTITUENCIES.length} okręgi reporting…` : '▶ Run Simulation'}
              </button>
              {(simSeats || declaredConsts) && (
                <button onClick={() => { stopSim(); setSimSeats(undefined); setDeclaredConsts(undefined); setSimProgress(0); setSimConstFractions({}); setSimNatPcts(null); }}
                  className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">Reset</button>
              )}
            </div>
          </aside>
        )}

        {showConst && selectedConst && (
          <PlConstPanel key={selectedConst} constId={selectedConst} natPcts={natPcts}
            constOverride={constOverrides[selectedConst]}
            onOverride={pcts => setConstOverrides(prev => ({ ...prev, [selectedConst]: pcts }))}
            onResetOverride={() => {
              setConstOverrides(prev => { const n = { ...prev }; delete n[selectedConst]; return n; });
              setProjectedConsts(prev => { const n = new Set(prev); n.delete(selectedConst); return n; });
              setConstDraft(null);
            }}
            onClose={() => { setSelectedConst(null); setConstDraft(null); }}
            isBlankMode={preset === 'blank'} isProjected={projectedConsts.has(selectedConst)}
            reportingPct={constReportingPct[selectedConst] ?? 100}
            onProject={() => setProjectedConsts(prev => new Set([...prev, selectedConst]))}
            onReportingPctChange={pct => setConstReportingPct(prev => ({ ...prev, [selectedConst]: pct }))}
            onDraftChange={preset === 'blank' ? (pcts, rpt) => setConstDraft({ constId: selectedConst, pcts, rptPct: rpt }) : undefined}
            hiddenParties={hiddenParties} dark={dark} />
        )}

        {showBreakdown && <PlBreakdownPanel  seats={displaySeats} natPcts={displayPcts} isBaseline={preset === 'baseline'}
                            constOverrides={constOverrides} onClose={() => openRight('breakdown')}     exiting={exitRight === 'breakdown'} dark={dark} />}
        {showTutorial  && <PlTutorialPanel   onClose={() => openRight('tutorial')}  exiting={exitRight === 'tutorial'}  dark={dark} />}
        {showCoalition && <PlCoalitionPanel  seats={displaySeats} onClose={() => openRight('coalition')} exiting={exitRight === 'coalition'} dark={dark} />}
      </div>
    </div>
  );
}
