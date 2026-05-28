import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { hsl } from 'd3';
import { fetchWikiPhoto } from '../lib/wikiPhotos';
import { GlobeLogo } from './HomePage';

// ── Party types ───────────────────────────────────────────────────────────────
type NzPartyId = 'NAT' | 'LAB' | 'GRN' | 'ACT' | 'NZF' | 'TPM';

type NzParty = {
  id:             NzPartyId;
  name:           string;
  fullName:       string;
  color:          string;
  seats2023:      number;       // final official seats (inc. Port Waikato by-election)
  electSeats2023: number;       // electorates won
  leader:         string;
  wikiTitle?:     string;
  leader2026?:    string;
  wikiTitle2026?: string;
};

// Ideology order left → right for parliament hemicycle
const NZ_LR_ORDER: NzPartyId[] = ['TPM','GRN','LAB','NZF','ACT','NAT'];

const NZ_PARTIES: NzParty[] = [
  { id: 'NAT', name: 'National', fullName: 'New Zealand National Party',   color: '#00529F', seats2023: 49, electSeats2023: 48,
    leader: 'Christopher Luxon', wikiTitle: 'Christopher_Luxon' },
  { id: 'LAB', name: 'Labour',   fullName: 'New Zealand Labour Party',     color: '#D82A20', seats2023: 34, electSeats2023: 15,
    leader: 'Chris Hipkins',     wikiTitle: 'Chris_Hipkins',
    leader2026: 'Chris Hipkins', wikiTitle2026: 'Chris_Hipkins' },
  { id: 'GRN', name: 'Greens',   fullName: 'Green Party of Aotearoa',      color: '#098137', seats2023: 15, electSeats2023:  1,
    leader: 'Marama Davidson',   wikiTitle: 'Marama_Davidson',
    leader2026: 'Chlöe Swarbrick', wikiTitle2026: 'Chlöe_Swarbrick' },
  { id: 'ACT', name: 'ACT',      fullName: 'ACT New Zealand',              color: '#FFCC00', seats2023: 11, electSeats2023:  2,
    leader: 'David Seymour',     wikiTitle: 'David_Seymour_(politician)' },
  { id: 'NZF', name: 'NZ First', fullName: 'New Zealand First',            color: '#000000', seats2023:  8, electSeats2023:  0,
    leader: 'Winston Peters',    wikiTitle: 'Winston_Peters' },
  { id: 'TPM', name: 'TPM',      fullName: 'Te Pāti Māori',               color: '#C0392B', seats2023:  6, electSeats2023:  6,
    leader: 'Rawiri Waititi',    wikiTitle: 'Rawiri_Waititi',
    leader2026: 'Rawiri Waititi', wikiTitle2026: 'Rawiri_Waititi' },
];

const NZ_PARTY_MAP = Object.fromEntries(NZ_PARTIES.map(p => [p.id, p])) as Record<NzPartyId, NzParty>;
// Base parliament = 120; 2023 had 3 overhang (all TPM) → 123 total
const NZ_BASE_SEATS = 120;
// majority computed as Math.floor(parliament/2)+1 dynamically; 62 is the base-120 value

// 2023 official results — source: Electoral Commission NZ, final count 3 Nov 2023
// Party vote percentages are of all valid party votes cast
const NZ_VOTE_PCT_2023: Record<NzPartyId, number> = {
  NAT: 38.06, LAB: 26.91, GRN: 11.60, ACT: 8.64, NZF: 6.08, TPM: 3.08,
};
// Raw party votes
const NZ_VOTE_RAW_2023: Record<NzPartyId, number> = {
  NAT: 1_085_016, LAB: 767_236, GRN: 330_883, ACT: 246_409, NZF: 173_425, TPM: 87_937,
};
// Total valid party votes cast (includes ~5.6% for minor parties below threshold)
const NZ_GRAND_TOTAL_VOTES = 2_851_776;

// 2026 polling — based on Curia/Talbot Mills NZ polling averages mid-2025
const NZ_VOTE_PCT_2026: Record<NzPartyId, number> = {
  NAT: 36.0, LAB: 28.5, GRN: 12.5, ACT: 7.5, NZF: 6.5, TPM: 3.5,
};

// ── Electorate types ──────────────────────────────────────────────────────────
type NzElecId =
  // Auckland general electorates (22)
  | 'ALBANY' | 'AKLD_CENTRAL' | 'BOTANY' | 'EAST_COAST_BAYS' | 'EPSOM'
  | 'HENDERSON_MASSEY' | 'HUNUA' | 'KAIPARA_KI_MAHURANGI' | 'KELSTON'
  | 'MANUKAU_EAST' | 'MANUREWA' | 'MAUNGAKIEKIE' | 'MT_ALBERT' | 'MT_ROSKILL'
  | 'NEW_LYNN' | 'NORTHCOTE' | 'NORTH_SHORE' | 'PAKURANGA' | 'PORT_WAIKATO'
  | 'TAMAKI' | 'TE_ATATU' | 'UPPER_HARBOUR'
  // Northland / Waikato / BOP / Taranaki (12)
  | 'BAY_OF_PLENTY' | 'COROMANDEL' | 'HAMILTON_EAST' | 'HAMILTON_WEST'
  | 'NORTHLAND' | 'NEW_PLYMOUTH' | 'ROTORUA' | 'TARANAKI_KING_COUNTRY'
  | 'TAURANGA' | 'WAIKATO' | 'WHANGAREI' | 'TAUPE'
  // Central North Island / East Coast (4)
  | 'EAST_COAST' | 'HERETAUNGA' | 'NAPIER' | 'RANGITIKEI'
  // Wellington / Manawatū / Wairarapa (11)
  | 'HUTT_SOUTH' | 'MANA' | 'OHARIU' | 'OTAKI' | 'PALMERSTON_NORTH'
  | 'REMUTAKA' | 'RONGOTAI' | 'WAIRARAPA' | 'WELLINGTON_CENTRAL' | 'WHANGANUI' | 'MANAWATU'
  // South Island (18)
  | 'BANKS_PENINSULA' | 'CHRISTCHURCH_CENTRAL' | 'CHRISTCHURCH_EAST'
  | 'CLUTHA_SOUTHLAND' | 'DUNEDIN' | 'ILAM' | 'INVERCARGILL' | 'KAIKOURA'
  | 'NELSON' | 'RANGITATA' | 'SELWYN' | 'TASMAN' | 'WAIMAKARIRI' | 'WAITAKI'
  | 'WEST_COAST_TASMAN' | 'WIGRAM' | 'DUNEDIN_NORTH' | 'WEST_WELLINGTON'
  // Māori electorates (7)
  | 'HAURAKI_WAIKATO' | 'IKAROA_RAWHITI' | 'TAMAKI_MAKAURAU'
  | 'TE_TAI_HAUAURU' | 'TE_TAI_TOKERAU' | 'TE_TAI_TONGA' | 'WAIARIKI';

type NzElectorate = {
  id:      NzElecId;
  name:    string;
  isMaori: boolean;
  // weight = approximate % of national party vote coming from this electorate area
  weight:  number;
  // 2023 electorate winner (candidate vote)
  winner2023: NzPartyId;
  // approximate 2023 party vote % in this electorate
  v2023:   Partial<Record<NzPartyId, number>>;
};

// GeoJSON feature property → electorate ID
const NZ_GEOID_TO_ID: Record<string, NzElecId> = {
  Albany:'ALBANY', Auckland_Central:'AKLD_CENTRAL', Botany:'BOTANY',
  East_Coast_Bays:'EAST_COAST_BAYS', Epsom:'EPSOM',
  Henderson_Massey:'HENDERSON_MASSEY', Hunua:'HUNUA',
  Kaipara_ki_Mahurangi:'KAIPARA_KI_MAHURANGI', Kelston:'KELSTON',
  Manukau_East:'MANUKAU_EAST', Manurewa:'MANUREWA',
  Maungakiekie:'MAUNGAKIEKIE', Mt_Albert:'MT_ALBERT', Mt_Roskill:'MT_ROSKILL',
  New_Lynn:'NEW_LYNN', Northcote:'NORTHCOTE', North_Shore:'NORTH_SHORE',
  Pakuranga:'PAKURANGA', Port_Waikato:'PORT_WAIKATO', Tamaki:'TAMAKI',
  Te_Atatu:'TE_ATATU', Upper_Harbour:'UPPER_HARBOUR',
  Bay_of_Plenty:'BAY_OF_PLENTY', Coromandel:'COROMANDEL',
  Hamilton_East:'HAMILTON_EAST', Hamilton_West:'HAMILTON_WEST',
  Northland:'NORTHLAND', New_Plymouth:'NEW_PLYMOUTH', Rotorua:'ROTORUA',
  Taranaki_King_Country:'TARANAKI_KING_COUNTRY', Tauranga:'TAURANGA',
  Waikato:'WAIKATO', Whangarei:'WHANGAREI', Taupe:'TAUPE',
  East_Coast:'EAST_COAST', Heretaunga:'HERETAUNGA', Napier:'NAPIER',
  Rangitikei:'RANGITIKEI', Hutt_South:'HUTT_SOUTH', Mana:'MANA',
  Ohariu:'OHARIU', Otaki:'OTAKI', Palmerston_North:'PALMERSTON_NORTH',
  Remutaka:'REMUTAKA', Rongotai:'RONGOTAI', Wairarapa:'WAIRARAPA',
  Wellington_Central:'WELLINGTON_CENTRAL', Whanganui:'WHANGANUI',
  Manawatu:'MANAWATU',
  Banks_Peninsula:'BANKS_PENINSULA', Christchurch_Central:'CHRISTCHURCH_CENTRAL',
  Christchurch_East:'CHRISTCHURCH_EAST', Clutha_Southland:'CLUTHA_SOUTHLAND',
  Dunedin:'DUNEDIN', Ilam:'ILAM', Invercargill:'INVERCARGILL', Kaikoura:'KAIKOURA',
  Nelson:'NELSON', Rangitata:'RANGITATA', Selwyn:'SELWYN', Tasman:'TASMAN',
  Waimakariri:'WAIMAKARIRI', Waitaki:'WAITAKI',
  West_Coast_Tasman:'WEST_COAST_TASMAN', Wigram:'WIGRAM',
  Dunedin_North:'DUNEDIN_NORTH', West_Wellington:'WEST_WELLINGTON',
  Hauraki_Waikato:'HAURAKI_WAIKATO', Ikaroa_Rawhiti:'IKAROA_RAWHITI',
  Tamaki_Makaurau:'TAMAKI_MAKAURAU', Te_Tai_Hauauru:'TE_TAI_HAUAURU',
  Te_Tai_Tokerau:'TE_TAI_TOKERAU', Te_Tai_Tonga:'TE_TAI_TONGA', Waiariki:'WAIARIKI',
};

// Party vote regional profiles for swing calculation
// Urban Auckland: left/green leaning; Rural NI: National; Wellington urban: Green; SI: National
// NZ_AKLD_URBAN kept for reference — use NZ_AKLD_SUBR for central electorates
const NZ_AKLD_URBAN: Partial<Record<NzPartyId,number>>  = {NAT:33,LAB:30,GRN:18,ACT:10,NZF:5,TPM:3};
void NZ_AKLD_URBAN;
const NZ_AKLD_SUBR:  Partial<Record<NzPartyId,number>>  = {NAT:42,LAB:24,GRN:12,ACT:12,NZF:6,TPM:2};
const NZ_MAORI_SEAT: Partial<Record<NzPartyId,number>>  = {NAT:8, LAB:24,GRN:6, ACT:4, NZF:3, TPM:54};
const NZ_WGTN_URBAN: Partial<Record<NzPartyId,number>>  = {NAT:28,LAB:33,GRN:24,ACT:8, NZF:4, TPM:2};
const NZ_NI_RURAL:   Partial<Record<NzPartyId,number>>  = {NAT:46,LAB:26,GRN:7, ACT:11,NZF:7, TPM:2};
const NZ_NI_PROVNL:  Partial<Record<NzPartyId,number>>  = {NAT:42,LAB:28,GRN:8, ACT:10,NZF:8, TPM:2};
const NZ_SI_URBAN:   Partial<Record<NzPartyId,number>>  = {NAT:38,LAB:30,GRN:12,ACT:10,NZF:7, TPM:1};
const NZ_SI_RURAL:   Partial<Record<NzPartyId,number>>  = {NAT:50,LAB:24,GRN:7, ACT:12,NZF:7, TPM:0};

// ── 72 electorates — seats won in 2023 + party vote profile ──────────────────
const NZ_ELECTORATES: NzElectorate[] = [
  // ── Auckland general electorates (22) ──────────────────────────────────────
  { id:'ALBANY',              name:'Albany',                isMaori:false, weight:1.50, winner2023:'NAT', v2023:NZ_AKLD_SUBR },
  { id:'AKLD_CENTRAL',        name:'Auckland Central',      isMaori:false, weight:1.32, winner2023:'NAT', v2023:{NAT:32,LAB:33,GRN:20,ACT:10,NZF:3,TPM:1} },
  { id:'BOTANY',              name:'Botany',                isMaori:false, weight:1.42, winner2023:'NAT', v2023:{NAT:48,LAB:20,GRN:8, ACT:15,NZF:5,TPM:2} },
  { id:'EAST_COAST_BAYS',     name:'East Coast Bays',       isMaori:false, weight:1.40, winner2023:'NAT', v2023:NZ_AKLD_SUBR },
  { id:'EPSOM',               name:'Epsom',                 isMaori:false, weight:1.35, winner2023:'ACT', v2023:{NAT:35,LAB:20,GRN:14,ACT:25,NZF:4,TPM:1} },
  { id:'HENDERSON_MASSEY',    name:'Henderson-Massey',      isMaori:false, weight:1.38, winner2023:'LAB', v2023:{NAT:30,LAB:35,GRN:14,ACT:10,NZF:7,TPM:4} },
  { id:'HUNUA',               name:'Hunua',                 isMaori:false, weight:1.30, winner2023:'NAT', v2023:{NAT:50,LAB:22,GRN:7, ACT:12,NZF:6,TPM:2} },
  { id:'KAIPARA_KI_MAHURANGI',name:'Kaipara ki Mahurangi',  isMaori:false, weight:1.35, winner2023:'NAT', v2023:NZ_AKLD_SUBR },
  { id:'KELSTON',             name:'Kelston',               isMaori:false, weight:1.38, winner2023:'LAB', v2023:{NAT:28,LAB:38,GRN:14,ACT:9, NZF:6,TPM:4} },
  { id:'MANUKAU_EAST',        name:'Manukau East',          isMaori:false, weight:1.37, winner2023:'LAB', v2023:{NAT:26,LAB:42,GRN:10,ACT:8, NZF:6,TPM:7} },
  { id:'MANUREWA',            name:'Manurewa',              isMaori:false, weight:1.38, winner2023:'LAB', v2023:{NAT:22,LAB:46,GRN:9, ACT:7, NZF:7,TPM:8} },
  { id:'MAUNGAKIEKIE',        name:'Maungakiekie',          isMaori:false, weight:1.36, winner2023:'NAT', v2023:{NAT:36,LAB:34,GRN:15,ACT:9, NZF:4,TPM:2} },
  { id:'MT_ALBERT',           name:'Mt Albert',             isMaori:false, weight:1.34, winner2023:'LAB', v2023:{NAT:26,LAB:40,GRN:20,ACT:8, NZF:3,TPM:2} },
  { id:'MT_ROSKILL',          name:'Mt Roskill',            isMaori:false, weight:1.36, winner2023:'LAB', v2023:{NAT:28,LAB:38,GRN:16,ACT:8, NZF:5,TPM:4} },
  { id:'NEW_LYNN',            name:'New Lynn',              isMaori:false, weight:1.37, winner2023:'LAB', v2023:{NAT:30,LAB:37,GRN:15,ACT:9, NZF:5,TPM:3} },
  { id:'NORTHCOTE',           name:'Northcote',             isMaori:false, weight:1.38, winner2023:'NAT', v2023:NZ_AKLD_SUBR },
  { id:'NORTH_SHORE',         name:'North Shore',           isMaori:false, weight:1.42, winner2023:'NAT', v2023:{NAT:45,LAB:22,GRN:15,ACT:12,NZF:4,TPM:1} },
  { id:'PAKURANGA',           name:'Pakuranga',             isMaori:false, weight:1.38, winner2023:'NAT', v2023:NZ_AKLD_SUBR },
  { id:'PORT_WAIKATO',        name:'Port Waikato',          isMaori:false, weight:1.28, winner2023:'NAT', v2023:NZ_NI_RURAL },
  { id:'TAMAKI',              name:'Tāmaki',               isMaori:false, weight:1.35, winner2023:'ACT', v2023:{NAT:38,LAB:22,GRN:14,ACT:20,NZF:4,TPM:1} },
  { id:'TE_ATATU',            name:'Te Atatū',             isMaori:false, weight:1.37, winner2023:'LAB', v2023:{NAT:30,LAB:37,GRN:16,ACT:9, NZF:5,TPM:3} },
  { id:'UPPER_HARBOUR',       name:'Upper Harbour',         isMaori:false, weight:1.40, winner2023:'NAT', v2023:NZ_AKLD_SUBR },
  // ── Northland / Waikato / BOP / Taranaki (12) ─────────────────────────────
  { id:'NORTHLAND',           name:'Northland',             isMaori:false, weight:1.30, winner2023:'NAT', v2023:NZ_NI_PROVNL },
  { id:'WHANGAREI',           name:'Whangārei',            isMaori:false, weight:1.35, winner2023:'NAT', v2023:NZ_NI_PROVNL },
  { id:'COROMANDEL',          name:'Coromandel',            isMaori:false, weight:1.30, winner2023:'NAT', v2023:NZ_NI_PROVNL },
  { id:'BAY_OF_PLENTY',       name:'Bay of Plenty',         isMaori:false, weight:1.35, winner2023:'NAT', v2023:NZ_NI_RURAL },
  { id:'TAURANGA',            name:'Tauranga',              isMaori:false, weight:1.40, winner2023:'NAT', v2023:{NAT:44,LAB:23,GRN:10,ACT:13,NZF:7,TPM:2} },
  { id:'HAMILTON_EAST',       name:'Hamilton East',         isMaori:false, weight:1.38, winner2023:'NAT', v2023:{NAT:42,LAB:28,GRN:10,ACT:11,NZF:6,TPM:2} },
  { id:'HAMILTON_WEST',       name:'Hamilton West',         isMaori:false, weight:1.38, winner2023:'NAT', v2023:{NAT:40,LAB:30,GRN:11,ACT:10,NZF:6,TPM:2} },
  { id:'WAIKATO',             name:'Waikato',               isMaori:false, weight:1.32, winner2023:'NAT', v2023:NZ_NI_RURAL },
  { id:'ROTORUA',             name:'Rotorua',               isMaori:false, weight:1.34, winner2023:'NAT', v2023:{NAT:41,LAB:28,GRN:9, ACT:10,NZF:7,TPM:4} },
  { id:'TAUPE',               name:'Taupō',                isMaori:false, weight:1.30, winner2023:'NAT', v2023:NZ_NI_RURAL },
  { id:'NEW_PLYMOUTH',        name:'New Plymouth',          isMaori:false, weight:1.36, winner2023:'NAT', v2023:NZ_NI_PROVNL },
  { id:'TARANAKI_KING_COUNTRY',name:'Taranaki-King Country',isMaori:false, weight:1.28, winner2023:'NAT', v2023:NZ_NI_RURAL },
  // ── Central NI / East Coast / Hawke's Bay (4) ─────────────────────────────
  { id:'EAST_COAST',          name:'East Coast',            isMaori:false, weight:1.25, winner2023:'LAB', v2023:{NAT:38,LAB:32,GRN:10,ACT:9, NZF:7,TPM:4} },
  { id:'HERETAUNGA',          name:'Heretaunga',            isMaori:false, weight:1.34, winner2023:'LAB', v2023:{NAT:40,LAB:32,GRN:9, ACT:10,NZF:7,TPM:2} },
  { id:'NAPIER',              name:'Napier',                isMaori:false, weight:1.33, winner2023:'NAT', v2023:{NAT:42,LAB:30,GRN:9, ACT:11,NZF:6,TPM:2} },
  { id:'RANGITIKEI',          name:'Rangitīkei',           isMaori:false, weight:1.26, winner2023:'NAT', v2023:NZ_NI_RURAL },
  // ── Wellington / Manawatū region (11) ─────────────────────────────────────
  { id:'MANAWATU',            name:'Manawatū',             isMaori:false, weight:1.34, winner2023:'NAT', v2023:NZ_NI_PROVNL },
  { id:'PALMERSTON_NORTH',    name:'Palmerston North',      isMaori:false, weight:1.36, winner2023:'NAT', v2023:{NAT:41,LAB:30,GRN:12,ACT:9, NZF:6,TPM:2} },
  { id:'WHANGANUI',           name:'Whanganui',             isMaori:false, weight:1.30, winner2023:'NAT', v2023:NZ_NI_PROVNL },
  { id:'WAIRARAPA',           name:'Wairarapa',             isMaori:false, weight:1.28, winner2023:'NAT', v2023:NZ_NI_RURAL },
  { id:'OTAKI',               name:'Ōtaki',                isMaori:false, weight:1.34, winner2023:'NAT', v2023:{NAT:41,LAB:31,GRN:12,ACT:9, NZF:5,TPM:2} },
  { id:'HUTT_SOUTH',          name:'Hutt South',            isMaori:false, weight:1.36, winner2023:'NAT', v2023:{NAT:40,LAB:33,GRN:14,ACT:8, NZF:4,TPM:1} },
  { id:'REMUTAKA',            name:'Remutaka',              isMaori:false, weight:1.36, winner2023:'LAB', v2023:{NAT:34,LAB:38,GRN:15,ACT:8, NZF:4,TPM:1} },
  { id:'MANA',                name:'Mana',                  isMaori:false, weight:1.37, winner2023:'LAB', v2023:{NAT:30,LAB:40,GRN:16,ACT:8, NZF:4,TPM:2} },
  { id:'OHARIU',              name:'Ōhāriu',               isMaori:false, weight:1.36, winner2023:'NAT', v2023:{NAT:38,LAB:29,GRN:21,ACT:8, NZF:3,TPM:1} },
  { id:'WELLINGTON_CENTRAL',  name:'Wellington Central',    isMaori:false, weight:1.36, winner2023:'GRN', v2023:{NAT:22,LAB:29,GRN:36,ACT:9, NZF:3,TPM:1} },
  { id:'RONGOTAI',            name:'Rongotai',              isMaori:false, weight:1.36, winner2023:'LAB', v2023:NZ_WGTN_URBAN },
  // ── South Island general electorates (18) ─────────────────────────────────
  { id:'NELSON',              name:'Nelson',                isMaori:false, weight:1.34, winner2023:'NAT', v2023:{NAT:43,LAB:27,GRN:14,ACT:10,NZF:5,TPM:1} },
  { id:'TASMAN',              name:'Tasman',                isMaori:false, weight:1.30, winner2023:'NAT', v2023:NZ_SI_RURAL },
  { id:'WEST_COAST_TASMAN',   name:'West Coast-Tasman',     isMaori:false, weight:1.25, winner2023:'NAT', v2023:NZ_SI_RURAL },
  { id:'KAIKOURA',            name:'Kaikōura',             isMaori:false, weight:1.24, winner2023:'NAT', v2023:NZ_SI_RURAL },
  { id:'WAIMAKARIRI',         name:'Waimakariri',           isMaori:false, weight:1.36, winner2023:'NAT', v2023:NZ_SI_RURAL },
  { id:'ILAM',                name:'Ilam',                  isMaori:false, weight:1.36, winner2023:'NAT', v2023:{NAT:46,LAB:25,GRN:12,ACT:12,NZF:4,TPM:1} },
  { id:'CHRISTCHURCH_CENTRAL',name:'Christchurch Central',  isMaori:false, weight:1.36, winner2023:'LAB', v2023:NZ_SI_URBAN },
  { id:'CHRISTCHURCH_EAST',   name:'Christchurch East',     isMaori:false, weight:1.36, winner2023:'LAB', v2023:NZ_SI_URBAN },
  { id:'WEST_WELLINGTON',     name:'Rongotai South',        isMaori:false, weight:1.32, winner2023:'NAT', v2023:NZ_SI_RURAL },
  { id:'WIGRAM',              name:'Wigram',                isMaori:false, weight:1.34, winner2023:'NAT', v2023:{NAT:44,LAB:27,GRN:12,ACT:10,NZF:5,TPM:1} },
  { id:'RANGITATA',           name:'Rangitata',             isMaori:false, weight:1.28, winner2023:'NAT', v2023:NZ_SI_RURAL },
  { id:'SELWYN',              name:'Selwyn',                isMaori:false, weight:1.36, winner2023:'NAT', v2023:{NAT:52,LAB:21,GRN:9, ACT:13,NZF:5,TPM:0} },
  { id:'BANKS_PENINSULA',     name:'Banks Peninsula',       isMaori:false, weight:1.36, winner2023:'NAT', v2023:{NAT:42,LAB:27,GRN:16,ACT:10,NZF:4,TPM:1} },
  { id:'DUNEDIN',             name:'Dunedin',               isMaori:false, weight:1.35, winner2023:'LAB', v2023:{NAT:30,LAB:38,GRN:18,ACT:8, NZF:5,TPM:1} },
  { id:'DUNEDIN_NORTH',       name:'Dunedin North',         isMaori:false, weight:1.34, winner2023:'LAB', v2023:{NAT:28,LAB:39,GRN:20,ACT:8, NZF:4,TPM:1} },
  { id:'WAITAKI',             name:'Waitaki',               isMaori:false, weight:1.26, winner2023:'NAT', v2023:NZ_SI_RURAL },
  { id:'CLUTHA_SOUTHLAND',    name:'Clutha-Southland',      isMaori:false, weight:1.25, winner2023:'NAT', v2023:NZ_SI_RURAL },
  { id:'INVERCARGILL',        name:'Invercargill',          isMaori:false, weight:1.30, winner2023:'NAT', v2023:{NAT:46,LAB:27,GRN:8, ACT:12,NZF:7,TPM:0} },
  // ── Māori electorates (7) ─────────────────────────────────────────────────
  { id:'TE_TAI_TOKERAU',      name:'Te Tai Tokerau',        isMaori:true,  weight:1.39, winner2023:'TPM', v2023:NZ_MAORI_SEAT },
  { id:'TAMAKI_MAKAURAU',     name:'Tāmaki Makaurau',      isMaori:true,  weight:1.39, winner2023:'TPM', v2023:NZ_MAORI_SEAT },
  { id:'HAURAKI_WAIKATO',     name:'Hauraki-Waikato',       isMaori:true,  weight:1.39, winner2023:'TPM', v2023:NZ_MAORI_SEAT },
  { id:'WAIARIKI',            name:'Waiariki',              isMaori:true,  weight:1.39, winner2023:'TPM', v2023:NZ_MAORI_SEAT },
  { id:'TE_TAI_HAUAURU',      name:'Te Tai Hauāuru',       isMaori:true,  weight:1.39, winner2023:'TPM', v2023:NZ_MAORI_SEAT },
  { id:'IKAROA_RAWHITI',      name:'Ikaroa-Rāwhiti',       isMaori:true,  weight:1.39, winner2023:'TPM', v2023:NZ_MAORI_SEAT },
  { id:'TE_TAI_TONGA',        name:'Te Tai Tonga',          isMaori:true,  weight:1.39, winner2023:'LAB', v2023:{NAT:6,LAB:36,GRN:9,ACT:3,NZF:4,TPM:40} },
];

const NZ_ELEC_MAP = Object.fromEntries(NZ_ELECTORATES.map(e=>[e.id,e])) as Record<NzElecId,NzElectorate>;
const NZ_TOTAL_ELEC_WEIGHT = NZ_ELECTORATES.reduce((s,e)=>s+e.weight,0);

// ── MMP seat calculation (D'Hondt on party vote, overhang if electorates > share) ──
// Threshold: 5% party vote OR win ≥1 electorate (TPM exception)
function calcMMP(
  partyVotePcts: Partial<Record<NzPartyId, number>>,
  electSeats:    Partial<Record<NzPartyId, number>>,  // electorates won
  threshold = 5.0,
): { total: Partial<Record<NzPartyId,number>>; list: Partial<Record<NzPartyId,number>>; parliament: number } {
  // Qualifying parties: ≥5% party vote OR won ≥1 electorate
  const qualifying = NZ_PARTIES.map(p=>p.id).filter(id=>{
    const pv = partyVotePcts[id] ?? 0;
    const ev = electSeats[id] ?? 0;
    return pv >= threshold || ev >= 1;
  });
  if (qualifying.length === 0) return { total:{}, list:{}, parliament: NZ_BASE_SEATS };

  // D'Hondt on party vote for NZ_BASE_SEATS
  const totalQualifyingVote = qualifying.reduce((s,id)=>s+(partyVotePcts[id]??0),0);
  if (totalQualifyingVote === 0) return { total:{}, list:{}, parliament: NZ_BASE_SEATS };

  function dhondt(totalSeats: number): Partial<Record<NzPartyId,number>> {
    const quotients: {id:NzPartyId;q:number}[] = [];
    for (const id of qualifying) {
      const v = partyVotePcts[id] ?? 0;
      for (let d=1; d<=totalSeats; d++) quotients.push({id, q:v/d});
    }
    quotients.sort((a,b)=>b.q-a.q);
    const seats: Partial<Record<NzPartyId,number>> = {};
    for (let i=0; i<Math.min(totalSeats,quotients.length); i++) {
      seats[quotients[i].id] = (seats[quotients[i].id]??0)+1;
    }
    return seats;
  }

  // First pass: D'Hondt for 120 base seats
  let proportional = dhondt(NZ_BASE_SEATS);

  // Check for overhang
  let overhang = 0;
  for (const id of qualifying) {
    const eSeat = electSeats[id] ?? 0;
    const pSeat = proportional[id] ?? 0;
    if (eSeat > pSeat) overhang = Math.max(overhang, eSeat - pSeat);
  }

  // Second pass: if overhang, expand parliament and recalculate
  const parliament = NZ_BASE_SEATS + overhang;
  if (overhang > 0) proportional = dhondt(parliament);

  // Final seat total: max of proportional share and electorates won
  const total: Partial<Record<NzPartyId,number>> = {};
  const list:  Partial<Record<NzPartyId,number>> = {};
  for (const id of qualifying) {
    const eSeat = electSeats[id] ?? 0;
    const pSeat = proportional[id] ?? 0;
    total[id] = Math.max(eSeat, pSeat);
    list[id]  = Math.max(0, (total[id]??0) - eSeat);
  }
  return { total, list, parliament };
}

// Proportional swing: electorate vote for a given party adjusts proportionally to national swing
function calcElecVotes(
  natPcts:   Record<NzPartyId, number>,
  elecId:    NzElecId,
  override?: Partial<Record<NzPartyId, number>>,
): Record<NzPartyId, number> {
  if (override && Object.keys(override).length > 0) {
    const raw: Record<NzPartyId,number> = {} as Record<NzPartyId,number>;
    let total = 0;
    for (const p of NZ_PARTIES) { raw[p.id] = Math.max(0, override[p.id]??0); total+=raw[p.id]; }
    if (total===0) return raw;
    for (const p of NZ_PARTIES) raw[p.id] = (raw[p.id]/total)*100;
    return raw;
  }
  const base = NZ_ELEC_MAP[elecId]?.v2023 ?? {};
  const raw: Record<NzPartyId,number> = {} as Record<NzPartyId,number>;
  let total = 0;
  for (const p of NZ_PARTIES) {
    const newNat = natPcts[p.id]??0;
    const oldNat = NZ_VOTE_PCT_2023[p.id]??0;
    const basePct = base[p.id]??0;
    raw[p.id] = basePct===0 ? 0 : oldNat===0 ? basePct : basePct*(newNat/oldNat);
    total += raw[p.id];
  }
  if (total===0) return raw;
  for (const p of NZ_PARTIES) raw[p.id] = (raw[p.id]/total)*100;
  return raw;
}

// Determine electorate winner for a given set of party vote percentages
function getElecWinner(
  natPcts:   Record<NzPartyId, number>,
  elecId:    NzElecId,
  override?: Partial<Record<NzPartyId, number>>,
): NzPartyId {
  const pv = calcElecVotes(natPcts, elecId, override);
  const sorted = (Object.entries(pv) as [NzPartyId,number][]).sort(([,a],[,b])=>b-a);
  return sorted[0]?.[0] ?? 'NAT';
}

// Sum electorate winners into a seat count
function calcElectorateSeats(
  natPcts:  Record<NzPartyId, number>,
  overrides?: Partial<Record<NzElecId, Partial<Record<NzPartyId, number>>>>,
): Partial<Record<NzPartyId, number>> {
  const seats: Partial<Record<NzPartyId,number>> = {};
  for (const e of NZ_ELECTORATES) {
    const winner = getElecWinner(natPcts, e.id, overrides?.[e.id]);
    seats[winner] = (seats[winner]??0)+1;
  }
  return seats;
}

// Partial simulation: only count declared electorates
function calcPartialMMP(
  natPcts:       Record<NzPartyId, number>,
  elecFractions: Partial<Record<NzElecId, number>>,
  overrides?:    Partial<Record<NzElecId, Partial<Record<NzPartyId, number>>>>,
): { total: Partial<Record<NzPartyId,number>>; parliament: number } {
  const declaredIds = Object.keys(elecFractions).filter(id=>( elecFractions[id as NzElecId]??0)>0) as NzElecId[];
  if (declaredIds.length===0) return { total:{}, parliament: NZ_BASE_SEATS };
  const electSeats: Partial<Record<NzPartyId,number>> = {};
  for (const eId of declaredIds) {
    const winner = getElecWinner(natPcts, eId, overrides?.[eId]);
    electSeats[winner] = (electSeats[winner]??0)+1;
  }
  // Scale party vote to declared weight fraction
  const declaredW = declaredIds.reduce((s,id)=>s+(NZ_ELEC_MAP[id]?.weight??0),0);
  const totalW = NZ_TOTAL_ELEC_WEIGHT;
  const scale = declaredW/totalW;
  // Use national poll projected party vote for proportional calculation
  const {total,parliament} = calcMMP(natPcts, electSeats);
  void scale; // scale used visually but MMP uses national vote pcts
  return { total, parliament };
}

// ── Simulation helpers ────────────────────────────────────────────────────────
function nzRandNormal(): number {
  let u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}
function nzBellCurveTimes(n: number, totalMs: number): number[] {
  return Array.from({length:n},()=>Math.max(0.02,Math.min(0.98,0.5+nzRandNormal()*0.18)))
    .sort((a,b)=>a-b).map(t=>Math.round(t*totalMs));
}

function redistributePcts(
  current:   Record<NzPartyId,number>, changedId:NzPartyId, newRaw:number, locks:Set<NzPartyId>,
): Record<NzPartyId,number> {
  const ids=Object.keys(current) as NzPartyId[];
  const lockedSum=ids.filter(id=>locks.has(id)&&id!==changedId).reduce((s,id)=>s+(current[id]??0),0);
  const clamped=Math.min(Math.max(newRaw,0),100-lockedSum);
  const unlocked=ids.filter(id=>!locks.has(id)&&id!==changedId);
  const remaining=100-lockedSum-clamped;
  const next:Record<NzPartyId,number>={...current,[changedId]:clamped};
  const unlockedSum=unlocked.reduce((s,id)=>s+(current[id]??0),0);
  if(unlockedSum>0){ for(const id of unlocked) next[id]=((current[id]??0)/unlockedSum)*remaining; }
  else if(unlocked.length>0){ const share=remaining/unlocked.length; for(const id of unlocked)next[id]=share; }
  return next;
}

// ── Format / colour helpers ───────────────────────────────────────────────────
function fmtN(n:number):string { if(n>=1_000_000)return(n/1_000_000).toFixed(1)+'M'; if(n>=1_000)return Math.round(n/1_000)+'K'; return String(n); }
function hexToRgba(hex:string,alpha:number):string {
  const h=hex.replace('#',''); const full=h.length===3?h[0]+h[0]+h[1]+h[1]+h[2]+h[2]:h;
  const r=parseInt(full.slice(0,2),16),g=parseInt(full.slice(2,4),16),b=parseInt(full.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function partyColor(id:NzPartyId):string { return NZ_PARTY_MAP[id]?.color??'#888'; }

function getElecFill(natPcts:Record<NzPartyId,number>,elecId:NzElecId,dark:boolean,override?:Partial<Record<NzPartyId,number>>):string {
  const pv=calcElecVotes(natPcts,elecId,override);
  const sorted=(Object.entries(pv) as [NzPartyId,number][]).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a);
  if(sorted.length===0) return dark?'#374151':'#E5E7EB';
  const [winner,winPct]=sorted[0]; const margin=winPct-(sorted[1]?.[1]??0);
  const c=hsl(partyColor(winner)); c.l=dark?0.55-Math.min(margin/20,1)*0.29:0.82-Math.min(margin/20,1)*0.46;
  return c.formatHex();
}

// ── Tooltip state ─────────────────────────────────────────────────────────────
type ElecTooltipState = {
  x:number; y:number; name:string; isMaori:boolean;
  parties:{id:NzPartyId;pct:number;rawVotes?:number}[];
  leader:NzPartyId|null; reportingPct?:number;
} | null;

// ── Scoreboard tile ───────────────────────────────────────────────────────────
function NzScoreboardTile({
  partyId, totalSeats, listSeats, pct, rawVotes, isLeader, isWinner, is2026, dark:_dark,
}: {
  partyId:NzPartyId; totalSeats:number; listSeats?:number; pct:number; rawVotes?:number;
  isLeader:boolean; isWinner:boolean; is2026?:boolean; dark?:boolean;
}) {
  const party      = NZ_PARTY_MAP[partyId];
  const leaderName = is2026 && party.leader2026 ? party.leader2026 : party.leader;
  const leaderWiki = is2026 && party.wikiTitle2026 ? party.wikiTitle2026 : party.wikiTitle;
  const [photoUrl, setPhotoUrl] = useState<string|null>(null);

  useEffect(()=>{
    if(!leaderWiki){setPhotoUrl(null);return;}
    let cancelled=false;
    fetchWikiPhoto(leaderWiki).then(url=>{if(!cancelled)setPhotoUrl(url);});
    return ()=>{cancelled=true;};
  },[leaderWiki]);

  const initials   = leaderName.split(' ').map((w:string)=>w[0]).join('').slice(0,2);
  const color      = partyColor(partyId);
  const colorAlpha = hexToRgba(color,0.13);
  const electSeats = totalSeats - (listSeats??0);

  return (
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
      <span className="cand-seats">{totalSeats}</span>
      <span className="cand-party-name" title={party.fullName}>{party.fullName}</span>
      {/* MMP breakdown: electorate + list */}
      <div style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:1}}>
        <span style={{fontSize:6,fontFamily:'"JetBrains Mono",monospace',fontWeight:600,color:hexToRgba(color,0.50),letterSpacing:'0.09em',textTransform:'uppercase'}}>
          {electSeats}e+{listSeats??0}l
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
// NZ blocs: Left (TPM+GRN+LAB) vs Right (NAT+ACT) with NZF as swing
const NZ_LEFT_IDS:  NzPartyId[] = ['TPM','GRN','LAB'];
const NZ_RIGHT_IDS: NzPartyId[] = ['NAT','ACT'];
const NZ_SWING_IDS: NzPartyId[] = ['NZF'];  // Winston Peters — pivotal king-maker

function NzScoreboard({
  natPcts, mmpResult, isBaseline, is2026, dark, reportedVoteScale,
}: {
  natPcts:Record<NzPartyId,number>;
  mmpResult?:{total:Partial<Record<NzPartyId,number>>;list:Partial<Record<NzPartyId,number>>;parliament:number};
  isBaseline?:boolean; is2026?:boolean; dark?:boolean; reportedVoteScale?:number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=scrollRef.current; if(!el) return;
    const h=(e:WheelEvent)=>{if(Math.abs(e.deltaX)>Math.abs(e.deltaY))return;e.preventDefault();el.scrollLeft+=e.deltaY;};
    el.addEventListener('wheel',h,{passive:false}); return ()=>el.removeEventListener('wheel',h);
  },[]);

  const electSeats  = useMemo(()=>calcElectorateSeats(natPcts),[natPcts]);
  const result      = useMemo(()=>mmpResult??calcMMP(natPcts,electSeats),[mmpResult,natPcts,electSeats]);
  const seats       = result.total;
  const listSeats   = result.list;
  const parliament  = result.parliament;
  const majority    = Math.floor(parliament/2)+1;

  const pctTotal = Object.values(natPcts).reduce((s,v)=>s+(v??0),0);
  const scale    = reportedVoteScale??1;

  const leftSeats  = NZ_LEFT_IDS.reduce((s,id)=>s+(seats[id]??0),0);
  const rightSeats = NZ_RIGHT_IDS.reduce((s,id)=>s+(seats[id]??0),0);
  const swingSeats = NZ_SWING_IDS.reduce((s,id)=>s+(seats[id]??0),0);

  const leftMajority  = leftSeats  >= majority;
  const rightMajority = rightSeats >= majority;
  const maxGroup = Math.max(leftSeats, rightSeats, swingSeats);
  const leftLeading  = maxGroup>0 && leftSeats  === maxGroup;
  const rightLeading = maxGroup>0 && rightSeats === maxGroup;

  const visible = useMemo(()=>NZ_LR_ORDER.filter(id=>(seats[id]??0)>0||(natPcts[id]??0)>=0.5),[seats,natPcts]);

  const makeTile = (id: NzPartyId) => {
    const s   = seats[id]??0;
    const ls  = listSeats[id]??0;
    const pct = pctTotal>0 ? (natPcts[id]??0)/pctTotal*100 : 0;
    const rawVotes = isBaseline
      ? Math.round((NZ_VOTE_RAW_2023[id]??0)*scale)
      : Math.round((natPcts[id]??0)/100*NZ_GRAND_TOTAL_VOTES*scale);
    const inLeft  = NZ_LEFT_IDS.includes(id);
    const inRight = NZ_RIGHT_IDS.includes(id);
    const isWinner = inLeft ? leftMajority : inRight ? rightMajority : false;
    const isLeader = inLeft  ? (leftLeading  && !leftMajority)
                   : inRight ? (rightLeading && !rightMajority) : false;
    return <NzScoreboardTile key={id} partyId={id} totalSeats={s} listSeats={ls}
      pct={pct} rawVotes={rawVotes} isLeader={isLeader} isWinner={isWinner}
      is2026={is2026} dark={dark}/>;
  };

  const sortBloc = (ids:NzPartyId[]) =>
    ids.filter(id=>visible.includes(id)).sort((a,b)=>(seats[b]??0)-(seats[a]??0));

  const renderBloc = (ids:NzPartyId[], label:string, isLeading:boolean, isMajority:boolean) => {
    const shown=sortBloc(ids); if(shown.length===0) return null;
    const accent=partyColor(shown[0]);
    const groupStyle:React.CSSProperties=isMajority
      ?{borderColor:hexToRgba(accent,0.72),background:hexToRgba(accent,0.08)}
      :isLeading?{borderColor:hexToRgba(accent,0.42),background:hexToRgba(accent,0.04)}:{};
    const labelStyle:React.CSSProperties=(isMajority||isLeading)?{color:hexToRgba(accent,0.85)}:{};
    return (
      <div className="ni-group" style={groupStyle}>
        <span className="ni-group-label" style={labelStyle}>{label}</span>
        <div className="ni-group-tiles">{shown.map(id=>makeTile(id))}</div>
      </div>
    );
  };

  return (
    <div className="shrink-0 border-b border-default bg-canvas select-none z-[45]">
      <div ref={scrollRef} className="overflow-x-auto scroll-none">
        <div className="flex gap-1.5 px-3 pt-2 pb-2 mx-auto w-fit items-stretch">
          {renderBloc(NZ_LEFT_IDS,  'Labour-Green-TPM', leftLeading  && !leftMajority, leftMajority)}
          {renderBloc(NZ_SWING_IDS, 'NZ First',         false, false)}
          {renderBloc(NZ_RIGHT_IDS, 'National-ACT',     rightLeading && !rightMajority, rightMajority)}
          {parliament > NZ_BASE_SEATS && (
            <div style={{display:'flex',alignItems:'center',padding:'0 6px',fontSize:9,fontFamily:'"JetBrains Mono",monospace',color:dark?'rgba(255,255,255,0.40)':'rgba(0,0,0,0.38)',whiteSpace:'nowrap',gap:3}}>
              <span style={{fontSize:7,textTransform:'uppercase',letterSpacing:'0.1em'}}>OVERHANG</span>
              <span style={{fontWeight:700,color:partyColor('TPM')}}>{parliament-NZ_BASE_SEATS}</span>
              <span>→ {parliament} seats</span>
            </div>
          )}
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
    ro.observe(map.getContainer()); return ()=>ro.disconnect();
  },[map]);
  useEffect(()=>{
    const h=()=>{layerRef.current?.eachLayer((l:L.Layer)=>{const p=l as any;if(p.options)p.options.smoothFactor=0;});};
    map.on('zoomend',h); return ()=>{map.off('zoomend',h);};
  },[map,layerRef]);
  return null;
}

// ── Bubble overlay ────────────────────────────────────────────────────────────
type BubbleEntry={marker:L.CircleMarker;baseRadius:number};
function zoomScale(zoom:number):number{return Math.max(0.15,Math.min(2.0,(zoom-4)/(9-4)));}

function NzBubbleLayer({
  geoData,natPcts,containerRef,setTooltip,onSelect,natPctsRef,
  declaredElecs,elecOverrides,elecOverridesRef,blankMode,projectedElecs,
  simElecFractions,simNatPctsRef,
}:{
  geoData:any; natPcts:Record<NzPartyId,number>;
  containerRef:React.RefObject<HTMLDivElement|null>;
  setTooltip:(t:ElecTooltipState)=>void; onSelect:(id:NzElecId)=>void;
  natPctsRef:React.MutableRefObject<Record<NzPartyId,number>>;
  declaredElecs?:Set<NzElecId>;
  elecOverrides?:Partial<Record<NzElecId,Partial<Record<NzPartyId,number>>>>;
  elecOverridesRef:React.MutableRefObject<Partial<Record<NzElecId,Partial<Record<NzPartyId,number>>>>>;
  blankMode?:boolean; projectedElecs?:Set<NzElecId>;
  simElecFractions?:Partial<Record<NzElecId,number>>;
  simNatPctsRef?:React.MutableRefObject<Record<NzPartyId,number>|null>;
}) {
  const map=useMap();
  const bubblesRef=useRef<BubbleEntry[]>([]);
  const simFracRef=useRef(simElecFractions??{});
  useEffect(()=>{simFracRef.current=simElecFractions??{};},[simElecFractions]);

  useEffect(()=>{
    const onZoom=()=>{const scale=zoomScale(map.getZoom());for(const{marker,baseRadius}of bubblesRef.current)marker.setRadius(baseRadius*scale);};
    map.on('zoomend',onZoom); return()=>{map.off('zoomend',onZoom);};
  },[map]);

  useEffect(()=>{
    for(const{marker}of bubblesRef.current)marker.remove();
    bubblesRef.current=[];
    const scale=zoomScale(map.getZoom());

    L.geoJSON(geoData).eachLayer((layer:L.Layer)=>{
      const path=layer as any;
      const geoId:string=path.feature?.properties?.id??path.feature?.properties?.name??'';
      const elecId=(NZ_GEOID_TO_ID[geoId]??(NZ_ELEC_MAP[geoId as NzElecId]?geoId as NzElecId:null));
      if(!elecId) return;
      if(declaredElecs&&!declaredElecs.has(elecId)) return;
      if(!declaredElecs&&blankMode&&!(projectedElecs?.has(elecId))) return;
      const bounds=(layer as any).getBounds?.(); if(!bounds?.isValid()) return;
      const center=bounds.getCenter();

      const pv=calcElecVotes(natPcts,elecId,elecOverrides?.[elecId]);
      const sorted=(Object.entries(pv) as [NzPartyId,number][]).filter(([,v])=>v>0).sort(([,a],[,b])=>b-a);
      if(sorted.length===0) return;
      const[winId,winPct]=sorted[0];
      const margin=winPct-(sorted[1]?.[1]??0);
      const baseRadius=10+Math.min(margin/10,1)*22;
      const color=partyColor(winId);

      const marker=L.circleMarker(center,{
        radius:baseRadius*scale,color,fillColor:color,fillOpacity:0.72,weight:1,opacity:0.9,
      }).addTo(map);

      marker.on('click',()=>{setTooltip(null);onSelect(elecId);});
      marker.on('mousemove',(e:L.LeafletMouseEvent)=>{
        const rect=containerRef.current?.getBoundingClientRect(); if(!rect) return;
        const cur=calcElecVotes(simNatPctsRef?.current??natPctsRef.current,elecId,elecOverridesRef.current?.[elecId]);
        const fraction=simFracRef.current[elecId]??1;
        const elec=NZ_ELEC_MAP[elecId];
        const elecVotes=NZ_GRAND_TOTAL_VOTES*(elec?.weight??0)/NZ_TOTAL_ELEC_WEIGHT;
        const parties=(Object.entries(cur) as [NzPartyId,number][])
          .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,6)
          .map(([id,pct])=>({id:id as NzPartyId,pct,rawVotes:Math.round(pct/100*elecVotes*fraction)}));
        setTooltip({x:e.originalEvent.clientX-rect.left,y:e.originalEvent.clientY-rect.top,
          name:elec?.name??geoId,isMaori:elec?.isMaori??false,
          parties,leader:parties[0]?.id??null,reportingPct:Math.round(fraction*100)});
      });
      marker.on('mouseout',()=>setTooltip(null));
      bubblesRef.current.push({marker,baseRadius});
    });
    return()=>{for(const{marker}of bubblesRef.current)marker.remove();bubblesRef.current=[];};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[map,geoData,natPcts,blankMode,projectedElecs,declaredElecs]);

  return null;
}

// ── Electorate draft ──────────────────────────────────────────────────────────
type NzElecDraft={elecId:NzElecId;pcts:Record<NzPartyId,number>;rptPct:number};

// ── Map view ──────────────────────────────────────────────────────────────────
function NzMapView({
  natPcts,selectedElec,onSelect,dark,bubbleMap,
  declaredElecs,elecOverrides,blankMode,projectedElecs,simElecFractions,
  elecDraft,simNatPcts,
}:{
  natPcts:Record<NzPartyId,number>; selectedElec:NzElecId|null;
  onSelect:(id:NzElecId)=>void; dark:boolean; bubbleMap:boolean;
  declaredElecs?:Set<NzElecId>;
  elecOverrides?:Partial<Record<NzElecId,Partial<Record<NzPartyId,number>>>>;
  blankMode?:boolean; projectedElecs?:Set<NzElecId>;
  simElecFractions?:Partial<Record<NzElecId,number>>;
  elecDraft?:NzElecDraft|null; simNatPcts?:Record<NzPartyId,number>|null;
}) {
  const containerRef   =useRef<HTMLDivElement>(null);
  const layerRef       =useRef<L.GeoJSON|null>(null);
  const[geoData,setGeoData]=useState<any>(null);
  const[tooltip,setTooltip]=useState<ElecTooltipState>(null);

  const natPctsRef    =useRef(natPcts);
  const onSelectRef   =useRef(onSelect);
  const darkRef       =useRef(dark);
  const declaredRef   =useRef(declaredElecs);
  const overridesRef  =useRef(elecOverrides??{});
  const blankModeRef  =useRef(blankMode??false);
  const projectedRef  =useRef(projectedElecs??new Set<NzElecId>());
  const simFracRef2   =useRef(simElecFractions??{});
  const draftRef2     =useRef<NzElecDraft|null>(elecDraft??null);
  const simNatRef2    =useRef<Record<NzPartyId,number>|null>(simNatPcts??null);

  useEffect(()=>{natPctsRef.current=natPcts;},[natPcts]);
  useEffect(()=>{onSelectRef.current=onSelect;},[onSelect]);
  useEffect(()=>{darkRef.current=dark;},[dark]);
  useEffect(()=>{declaredRef.current=declaredElecs;},[declaredElecs]);
  useEffect(()=>{overridesRef.current=elecOverrides??{};},[elecOverrides]);
  useEffect(()=>{blankModeRef.current=blankMode??false;},[blankMode]);
  useEffect(()=>{projectedRef.current=projectedElecs??new Set();},[projectedElecs]);
  useEffect(()=>{simFracRef2.current=simElecFractions??{};},[simElecFractions]);
  useEffect(()=>{draftRef2.current=elecDraft??null;},[elecDraft]);
  useEffect(()=>{simNatRef2.current=simNatPcts??null;},[simNatPcts]);

  useEffect(()=>{
    fetch(`${import.meta.env.BASE_URL}nz-electorates.geojson`)
      .then(r=>r.json()).then(setGeoData).catch(console.error);
  },[]);

  const getStyle=useCallback((feature:any):L.PathOptions=>{
    const geoId=feature?.properties?.id??feature?.properties?.name??'';
    const elecId=(NZ_GEOID_TO_ID[geoId]??(NZ_ELEC_MAP[geoId as NzElecId]?geoId as NzElecId:null));
    const isSel=elecId===selectedElec;
    const border=dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.35)';
    if(bubbleMap) return{fillOpacity:0,weight:0.4,color:dark?'rgba(255,255,255,0.18)':'rgba(0,0,0,0.18)',opacity:0.6};
    if(!elecId)   return{fillColor:dark?'#374151':'#E5E7EB',fillOpacity:0.5,weight:0.4,color:border,opacity:1};
    const simFrac=simElecFractions?.[elecId]; const hasSimData=simFrac!==undefined&&simFrac>0;
    if(blankMode&&!hasSimData){
      const hasOv=!!elecOverrides?.[elecId]&&Object.keys(elecOverrides[elecId]!).length>0;
      if(!hasOv) return{fillColor:dark?'#1f2937':'#d1d5db',fillOpacity:0.7,weight:isSel?2:0.4,color:isSel?'#c8a020':border,opacity:1};
    }
    const isDeclared=!declaredElecs||declaredElecs.has(elecId);
    if(!isDeclared&&!hasSimData) return{fillColor:dark?'#1f2937':'#d1d5db',fillOpacity:0.7,weight:0.4,color:border,opacity:1};
    const effectiveNat=simNatPcts??natPcts;
    const fill=getElecFill(effectiveNat,elecId,dark,elecOverrides?.[elecId]);
    const opacity=isDeclared?0.78:Math.max(0.35,0.78*(simFrac??1));
    return{fillColor:fill,fillOpacity:opacity,weight:isSel?2:0.4,color:isSel?'#c8a020':border,opacity:1};
  },[natPcts,selectedElec,dark,bubbleMap,declaredElecs,elecOverrides,blankMode,simElecFractions,simNatPcts]);

  useEffect(()=>{layerRef.current?.setStyle((f:any)=>getStyle(f));},[getStyle]);

  const onEachFeature=useCallback((feature:any,layer:L.Layer)=>{
    const geoId=feature?.properties?.id??feature?.properties?.name??'';
    const elecId=(NZ_GEOID_TO_ID[geoId]??(NZ_ELEC_MAP[geoId as NzElecId]?geoId as NzElecId:null));
    layer.on('click',()=>{if(elecId)onSelectRef.current(elecId);});
    layer.on('mousemove',(e:L.LeafletMouseEvent)=>{
      if(!elecId){setTooltip(null);return;}
      const draft=draftRef2.current; const hasDraft=draft?.elecId===elecId;
      if(blankModeRef.current&&!declaredRef.current){
        const hasOv=!!overridesRef.current[elecId]&&Object.keys(overridesRef.current[elecId]!).length>0;
        if(!hasOv&&!hasDraft){setTooltip(null);return;}
      }
      const rect=containerRef.current?.getBoundingClientRect(); if(!rect) return;
      const ov=hasDraft?draft!.pcts:overridesRef.current?.[elecId];
      const fraction=hasDraft?draft!.rptPct/100:simFracRef2.current[elecId]??(declaredRef.current?.has(elecId)?1:undefined);
      const effectiveNat=simNatRef2.current??natPctsRef.current;
      const elec=NZ_ELEC_MAP[elecId];
      const elecVotes=NZ_GRAND_TOTAL_VOTES*(elec?.weight??0)/NZ_TOTAL_ELEC_WEIGHT;
      const pv=calcElecVotes(effectiveNat,elecId,ov);
      const parties=(Object.entries(pv) as [NzPartyId,number][])
        .filter(([,v])=>v>0).sort(([,a],[,b])=>b-a).slice(0,6)
        .map(([id,pct])=>({id:id as NzPartyId,pct,rawVotes:Math.round(pct/100*elecVotes*(fraction??1))}));
      setTooltip({x:e.originalEvent.clientX-rect.left,y:e.originalEvent.clientY-rect.top,
        name:elec?.name??geoId,isMaori:elec?.isMaori??false,
        parties,leader:parties[0]?.id??null,reportingPct:fraction!=null?Math.round(fraction*100):undefined});
    });
    layer.on('mouseout',()=>setTooltip(null));
  },[]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <MapContainer center={[-41.0,173.0]} zoom={5} style={{width:'100%',height:'100%'}} zoomControl worldCopyJump={false}>
        <TileLayer key={dark?'dark':'light'}
          url={dark?'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png':'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'}
          attribution='&copy; OpenStreetMap &copy; CARTO' subdomains="abcd" updateWhenZooming={false} updateWhenIdle={true} maxZoom={20}/>
        <MapController layerRef={layerRef}/>
        {geoData&&(
          <GeoJSON ref={layerRef as any} data={geoData} style={(f:any)=>getStyle(f)} onEachFeature={onEachFeature} {...({smoothFactor:0}as any)}/>
        )}
        {geoData&&bubbleMap&&(
          <NzBubbleLayer geoData={geoData} natPcts={simNatPcts??natPcts} containerRef={containerRef}
            setTooltip={setTooltip} onSelect={onSelect} natPctsRef={natPctsRef}
            declaredElecs={declaredElecs} elecOverrides={elecOverrides}
            elecOverridesRef={overridesRef} blankMode={blankMode}
            projectedElecs={projectedElecs} simElecFractions={simElecFractions}
            simNatPctsRef={simNatRef2}/>
        )}
      </MapContainer>

      {/* ── Tooltip ── */}
      {tooltip&&(()=>{
        const cw=containerRef.current?.clientWidth??9999;const TW=240;
        const left=tooltip.x+18+TW>cw?tooltip.x-TW-10:tooltip.x+18;
        const tt={bg:dark?'rgba(18,24,44,0.97)':'rgba(255,255,255,0.98)',border:dark?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.09)',shadow:dark?'0 6px 28px rgba(0,0,0,0.55)':'0 6px 28px rgba(0,0,0,0.13)',title:dark?'rgba(255,255,255,0.93)':'rgba(0,0,0,0.86)',sub:dark?'rgba(255,255,255,0.40)':'rgba(0,0,0,0.42)',body:dark?'rgba(255,255,255,0.86)':'rgba(0,0,0,0.79)'};
        return(
          <div className="absolute pointer-events-none z-[1000]" style={{left,top:Math.max(6,tooltip.y-20),width:TW}}>
            <div style={{background:tt.bg,borderRadius:10,border:`1px solid ${tt.border}`,boxShadow:tt.shadow,backdropFilter:'blur(12px)',padding:'12px 14px'}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                <div style={{fontSize:13,fontWeight:700,color:tt.title,lineHeight:1.2}}>{tooltip.name}</div>
                {tooltip.isMaori&&<span style={{fontSize:8,fontFamily:'"JetBrains Mono",monospace',background:hexToRgba(partyColor('TPM'),0.18),color:partyColor('TPM'),padding:'1px 5px',borderRadius:3,fontWeight:700}}>Māori</span>}
              </div>
              <div style={{fontSize:9,fontFamily:'"JetBrains Mono",monospace',color:tt.sub,marginTop:1}}>
                {tooltip.reportingPct!=null?`${tooltip.reportingPct}% reporting`:'Party vote estimate'}
              </div>
              <div style={{marginTop:9,display:'flex',flexDirection:'column',gap:5}}>
                {tooltip.parties.map(({id,pct,rawVotes},i)=>{
                  const pColor=partyColor(id);
                  return(
                    <div key={id} style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{width:7,height:7,borderRadius:2,flexShrink:0,background:pColor}}/>
                      <span style={{flex:1,fontSize:11,fontWeight:i===0?600:400,color:tt.body,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{NZ_PARTY_MAP[id]?.name??id}</span>
                      <span style={{fontSize:11,fontFamily:'"JetBrains Mono",monospace',fontWeight:700,color:pColor}}>{pct.toFixed(1)}%</span>
                      {rawVotes!=null&&<span style={{fontSize:8.5,fontFamily:'"JetBrains Mono",monospace',color:tt.sub,marginLeft:2}}>{rawVotes.toLocaleString()}</span>}
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

// ── Coalition builder ─────────────────────────────────────────────────────────
const NZ_PRESET_COALITIONS: {name:string;emoji:string;parties:NzPartyId[]}[] = [
  {name:'National-ACT-NZF (current)',emoji:'🇳🇿',parties:['NAT','ACT','NZF']},
  {name:'National-ACT',             emoji:'🔵',parties:['NAT','ACT']},
  {name:'Labour-Greens-TPM',        emoji:'🌹',parties:['LAB','GRN','TPM']},
  {name:'Labour-Greens-NZF',        emoji:'🌿',parties:['LAB','GRN','NZF']},
];

function NzCoalitionPanel({seats,parliament,onClose,exiting,dark}:{
  seats:Partial<Record<NzPartyId,number>>;parliament:number;
  onClose:()=>void;exiting?:boolean;dark?:boolean;
}) {
  const[selected,setSelected]=useState<Set<NzPartyId>>(new Set(['NAT','ACT','NZF']));
  const toggle=(id:NzPartyId)=>setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const totalCoal=[...selected].reduce((s,id)=>s+(seats[id]??0),0);
  const majority=Math.floor(parliament/2)+1;
  const hasMajority=totalCoal>=majority;
  return(
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Coalition Builder</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">Majority: {majority} of {parliament} seats</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="px-3.5 pt-3 pb-2 border-b border-default shrink-0">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Presets</div>
        <div className="grid grid-cols-2 gap-1.5">
          {NZ_PRESET_COALITIONS.map(coal=>(
            <button key={coal.name} onClick={()=>setSelected(new Set(coal.parties))}
              className="text-left px-2 py-1.5 rounded-[4px] border border-default hover:bg-hover transition-colors">
              <div className="text-[8px] font-bold text-ink truncate">{coal.emoji} {coal.name}</div>
              <div className="text-[7px] font-mono text-ink-3">{coal.parties.map(id=>NZ_PARTY_MAP[id]?.name).join(' + ')}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll">
        <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.15em] text-ink-3 mb-2">Toggle Parties</div>
        <div className="space-y-1.5">
          {NZ_LR_ORDER.map(id=>{
            const party=NZ_PARTY_MAP[id];const s=seats[id]??0;const isIn=selected.has(id);const color=partyColor(id);
            return(
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
          <span className="text-[20px] font-black font-mono" style={{color:hasMajority?'#16a34a':'#ef4444'}}>{totalCoal}</span>
        </div>
        <div className="mt-1 h-2 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.08)'}}>
          <div className="h-full rounded-full transition-all duration-300" style={{width:`${Math.min(totalCoal/parliament*100,100)}%`,background:hasMajority?'#16a34a':'#ef4444'}}/>
        </div>
        <div className={`mt-1.5 text-[9px] font-mono text-center font-bold ${hasMajority?'text-emerald-600':'text-red-500'}`}>
          {hasMajority?`✓ MAJORITY (need ${majority})`:`✗ ${majority-totalCoal} seats short`}
        </div>
      </div>
    </aside>
  );
}

// ── Parties panel ─────────────────────────────────────────────────────────────
function NzPartiesPanel({hiddenParties,onToggle,onClose,dark}:{
  hiddenParties:Set<NzPartyId>;onToggle:(id:NzPartyId)=>void;onClose:()=>void;dark?:boolean;
}) {
  const allHidden=NZ_LR_ORDER.every(id=>hiddenParties.has(id));
  return(
    <aside className={`w-56 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
        <div><h2 className="text-[14px] font-bold text-ink leading-none">Parties</h2><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Show in sliders</p></div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 thin-scroll">
        {NZ_LR_ORDER.map(id=>{
          const party=NZ_PARTY_MAP[id];const hidden=hiddenParties.has(id);
          return(
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
        <button onClick={()=>{for(const id of NZ_LR_ORDER){if(allHidden?hiddenParties.has(id):!hiddenParties.has(id))onToggle(id);}}}
          className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
          {allHidden?'Show All':'Hide All'}
        </button>
      </div>
    </aside>
  );
}

// ── Electorate panel (blank map sliders) ──────────────────────────────────────
function NzElecPanel({
  elecId,natPcts,elecOverride,onOverride,onResetOverride,onClose,
  isBlankMode,isProjected,reportingPct,onProject,onReportingPctChange,
  onDraftChange,hiddenParties,dark,
}:{
  elecId:NzElecId; natPcts:Record<NzPartyId,number>;
  elecOverride?:Partial<Record<NzPartyId,number>>;
  onOverride:(pcts:Partial<Record<NzPartyId,number>>)=>void;
  onResetOverride:()=>void; onClose:()=>void;
  isBlankMode?:boolean; isProjected?:boolean; reportingPct?:number;
  onProject?:()=>void; onReportingPctChange?:(pct:number)=>void;
  onDraftChange?:(pcts:Record<NzPartyId,number>,rptPct:number)=>void;
  hiddenParties?:Set<NzPartyId>; dark?:boolean;
}) {
  const[locks,setLocks]=useState<Set<NzPartyId>>(new Set());
  const baseVotes=useMemo(()=>calcElecVotes(natPcts,elecId),[natPcts,elecId]);
  const[draftPcts,setDraftPcts]=useState<Record<NzPartyId,number>>(()=>
    elecOverride&&Object.keys(elecOverride).length>0?{...calcElecVotes(natPcts,elecId,elecOverride)}:{...baseVotes});
  const[localRptPct,setLocalRptPct]=useState(reportingPct??100);
  const[touched,setTouched]=useState(!!elecOverride&&Object.keys(elecOverride).length>0);

  useEffect(()=>{
    setLocks(new Set());
    const base=calcElecVotes(natPcts,elecId);
    setDraftPcts(elecOverride&&Object.keys(elecOverride).length>0?{...calcElecVotes(natPcts,elecId,elecOverride)}:{...base});
    setLocalRptPct(reportingPct??100);setTouched(!!elecOverride&&Object.keys(elecOverride).length>0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[elecId]);

  useEffect(()=>{if(isBlankMode)onDraftChange?.(draftPcts,localRptPct);},[draftPcts,localRptPct,isBlankMode]); // eslint-disable-line

  const effectiveLocks=useMemo(()=>new Set<NzPartyId>([...locks,...(hiddenParties??[])]),[locks,hiddenParties]);
  const displayPv=isBlankMode?draftPcts:calcElecVotes(natPcts,elecId,elecOverride);
  const[sortedIds]=useState<NzPartyId[]>(()=>NZ_PARTIES.map(p=>p.id).filter(id=>(baseVotes[id]??0)>0.5).sort((a,b)=>(baseVotes[b]??0)-(baseVotes[a]??0)));
  const elec=NZ_ELEC_MAP[elecId];
  const winner=NZ_PARTIES.reduce((best,p)=>(displayPv[p.id]??0)>(displayPv[best.id]??0)?p:best,NZ_PARTIES[0]);
  const hasOverride=!!elecOverride&&Object.keys(elecOverride).length>0;
  const elecTotalVotes=Math.round(NZ_GRAND_TOTAL_VOTES*(elec?.weight??0)/NZ_TOTAL_ELEC_WEIGHT);
  const sliderTrack=dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)';

  const handleSlider=(id:NzPartyId,val:number)=>{
    if(isBlankMode){setDraftPcts(redistributePcts(draftPcts,id,val,effectiveLocks));setTouched(true);}
    else onOverride(redistributePcts(displayPv as Record<NzPartyId,number>,id,val,effectiveLocks));
  };
  const handleProject=()=>{if(!touched)return;onOverride(draftPcts);onReportingPctChange?.(localRptPct);onProject?.();};

  return(
    <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
      <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-[16px] font-bold text-ink leading-tight truncate">{elec?.name??elecId}</h2>
              {elec?.isMaori&&<span style={{fontSize:7,fontFamily:'"JetBrains Mono",monospace',background:hexToRgba(partyColor('TPM'),0.18),color:partyColor('TPM'),padding:'1px 5px',borderRadius:3,fontWeight:700,whiteSpace:'nowrap'}}>Māori</span>}
            </div>
            <p className="text-[10px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">
              {isBlankMode?(isProjected?'Projected · adjust & re-project':'Blank map · set electorate result'):(hasOverride?'Custom override':'Party vote estimate')}
            </p>
          </div>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base shrink-0">×</button>
        </div>
        <div className="mt-2 flex items-center gap-2 px-2 py-1.5 rounded-[4px]" style={{borderLeft:`3px solid ${winner.color}`,background:dark?'rgba(255,255,255,0.04)':'#f8f7f4'}}>
          <span className="text-[11px] font-medium text-ink flex-1 truncate">{winner.fullName}</span>
          <span className="text-[8px] font-mono text-ink-3">party vote</span>
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
              ≈{Math.round(elecTotalVotes*localRptPct/100).toLocaleString()} votes counted
            </div>
          </div>
        )}
        <div className="px-3.5 space-y-3 py-3">
          {sortedIds.filter(id=>!hiddenParties?.has(id)&&(isBlankMode||(displayPv[id]??0)>=0.5||locks.has(id))).map(id=>{
            const p=NZ_PARTY_MAP[id];const pct=displayPv[id]??0;const isLocked=locks.has(id);const color=p.color;
            const rawVotes=Math.round((pct/100)*elecTotalVotes*(isBlankMode?localRptPct/100:1));
            return(
              <div key={id}>
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:color}}/>
                  <span className="text-[10px] font-medium text-ink flex-1 truncate leading-none">{p.fullName}</span>
                  <button onClick={()=>setLocks(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;})}
                    className={`w-4 h-4 flex items-center justify-center shrink-0 ${isLocked?'text-gold':'text-ink-3 hover:text-ink'}`}>
                    {isLocked?<svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="currentColor"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>:<svg width="9" height="11" viewBox="0 0 9 11" fill="none"><rect x="1" y="4.5" width="7" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.1"/><path d="M2.5 4.5V3a2 2 0 0 1 4 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>}
                  </button>
                  <span className="text-[10px] font-mono font-bold tabular-nums" style={{color}}>{pct.toFixed(1)}%</span>
                </div>
                <input type="range" min={0} max={70} step={0.1} value={pct} disabled={isLocked}
                  onChange={e=>handleSlider(id,parseFloat(e.target.value))}
                  className="br-party-slider w-full"
                  style={{'--party-color':color,'--pct':`${(pct/70)*100}%`}as React.CSSProperties}/>
                <div className="flex justify-between mt-0.5">
                  <span className="text-[8px] font-mono" style={{color:dark?'rgba(255,255,255,0.22)':'rgba(0,0,0,0.28)'}}>{rawVotes.toLocaleString()}</span>
                  {pct<5&&!elec?.isMaori&&<span className="text-[7.5px] font-mono" style={{color:'#f59e0b'}}>⚠ below 5%</span>}
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
            <button onClick={()=>{onResetOverride();setTouched(false);setDraftPcts({...calcElecVotes(natPcts,elecId)});}}
              className="w-full h-6 rounded-[4px] border border-default text-ink-3 text-[9px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">
              Clear projection
            </button>
          )}
        </div>
      ):hasOverride?(
        <div className="px-3.5 py-2.5 border-t border-default shrink-0">
          <button onClick={onResetOverride} className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">Reset to calculated</button>
        </div>
      ):null}
    </aside>
  );
}

// ── Breakdown panel ───────────────────────────────────────────────────────────
function NzBreakdownPanel({seats,listSeats,parliament,natPcts,isBaseline,onClose,exiting,dark}:{
  seats:Partial<Record<NzPartyId,number>>; listSeats:Partial<Record<NzPartyId,number>>;
  parliament:number; natPcts:Record<NzPartyId,number>;
  isBaseline?:boolean; onClose:()=>void; exiting?:boolean; dark?:boolean;
}) {
  const totalS=NZ_LR_ORDER.reduce((s,id)=>s+(seats[id]??0),0);
  const totalV=NZ_PARTIES.reduce((s,p)=>s+(natPcts[p.id]??0),0);
  const majority=Math.floor(parliament/2)+1;
  const leftS=NZ_LEFT_IDS.reduce((s,id)=>s+(seats[id]??0),0);
  const rightS=NZ_RIGHT_IDS.reduce((s,id)=>s+(seats[id]??0),0);
  const nzfS=seats['NZF']??0;
  const enp=totalS>0?1/NZ_LR_ORDER.reduce((s,id)=>{const sh=(seats[id]??0)/totalS;return s+sh*sh;},0):0;
  const gallagher=Math.sqrt(NZ_PARTIES.reduce((s,p)=>{
    const v=totalV>0?(natPcts[p.id]??0)/totalV*100:0;
    const sv=totalS>0?(seats[p.id]??0)/totalS*100:0;
    return s+Math.pow(v-sv,2);
  },0)/2);
  const totalElect=NZ_PARTIES.reduce((s,p)=>s+(seats[p.id]??0)-(listSeats[p.id]??0),0);
  const totalList=NZ_PARTIES.reduce((s,p)=>s+(listSeats[p.id]??0),0);
  const largest=[...NZ_LR_ORDER].sort((a,b)=>(seats[b]??0)-(seats[a]??0))[0];
  const ink3=dark?'rgba(255,255,255,0.25)':'rgba(0,0,0,0.25)';
  const cardBg=dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.03)';
  function Section({title,children}:{title:string;children:React.ReactNode}){
    return<div><div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.18em] mb-2" style={{color:ink3}}>{title}</div><div className="space-y-1.5">{children}</div></div>;
  }
  function Stat({label,value,sub:s}:{label:string;value:string;sub?:string}){
    return<div className="flex items-baseline justify-between gap-2" style={{background:cardBg,borderRadius:5,padding:'5px 8px'}}>
      <span className="text-[9.5px] font-mono text-ink-3 flex-1">{label}</span>
      <div className="text-right"><span className="text-[11px] font-mono font-bold text-ink">{value}</span>{s&&<div className="text-[7.5px] font-mono" style={{color:ink3}}>{s}</div>}</div>
    </div>;
  }
  return(
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-r border-default flex flex-col overflow-hidden ${exiting?'panel-exit-left':'panel-slide-left'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div><h2 className="text-[13px] font-bold text-ink leading-none">Breakdown</h2><div className="text-[9px] font-mono text-ink-3 mt-0.5">Advanced MMP statistics</div></div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      {totalS===0?<div className="flex items-center justify-center flex-1 text-[11px] font-mono text-ink-3 px-4 text-center">Load results or run simulation first</div>:(
        <div className="flex-1 overflow-y-auto thin-scroll px-3.5 py-3.5 space-y-5">
          <Section title="Two Blocs + King-Maker">
            {[
              {label:'Labour-Green-TPM',desc:'Left bloc',seats:leftS,color:'#D82A20'},
              {label:'NZ First',desc:'Winston Peters — pivotal',seats:nzfS,color:'#000'},
              {label:'National-ACT',desc:'Right bloc',seats:rightS,color:'#00529F'},
            ].map(b=>(
              <div key={b.label} style={{background:cardBg,borderRadius:5,padding:'6px 8px',borderLeft:`3px solid ${b.color}`}}>
                <div className="flex items-center justify-between">
                  <div><div className="text-[10px] font-bold text-ink">{b.label}</div><div className="text-[8px] font-mono" style={{color:dark?'rgba(255,255,255,0.42)':'rgba(0,0,0,0.42)'}}>{b.desc}</div></div>
                  <div className="text-right">
                    <span className="text-[18px] font-black font-mono" style={{color:b.color}}>{b.seats}</span>
                    <div className="text-[7.5px] font-mono" style={{color:b.seats>=majority?'#16a34a':ink3}}>{b.seats>=majority?'✓ majority':`need ${majority-b.seats} more`}</div>
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.06)'}}>
                  <div style={{width:`${Math.min(b.seats/parliament*100,100)}%`,height:'100%',borderRadius:4,background:b.color}}/>
                </div>
              </div>
            ))}
          </Section>
          <Section title="MMP Statistics">
            <Stat label="Parliament size" value={`${parliament} seats`} sub={parliament>NZ_BASE_SEATS?`${parliament-NZ_BASE_SEATS} overhang (TPM electorates)`:'no overhang'}/>
            <Stat label="Electorate seats" value={`${totalElect}`} sub="won in constituency contests"/>
            <Stat label="List seats" value={`${totalList}`} sub="allocated proportionally from party vote"/>
            <Stat label="Effective No. of Parties (ENP)" value={enp.toFixed(2)} sub="1/Σsᵢ²"/>
            <Stat label="Gallagher Index" value={gallagher.toFixed(2)} sub="lower = more proportional"/>
            <Stat label="Largest party" value={`${NZ_PARTY_MAP[largest]?.name} — ${seats[largest]??0} seats`} sub={`${majority-(seats[largest]??0)>0?`${majority-(seats[largest]??0)} short of majority`:'✓ majority'}`}/>
          </Section>
          <Section title="Swing vs 2023">
            {NZ_LR_ORDER.filter(id=>(natPcts[id]??0)>0.3||(isBaseline&&(NZ_VOTE_PCT_2023[id]??0)>0)).map(id=>{
              const vSwing=(natPcts[id]??0)-NZ_VOTE_PCT_2023[id];const sSwing=(seats[id]??0)-(NZ_PARTY_MAP[id].seats2023??0);const color=partyColor(id);
              return(<div key={id} style={{background:cardBg,borderRadius:5,padding:'5px 8px',display:'flex',alignItems:'center',gap:8}}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{background:color}}/>
                <span className="text-[10px] font-medium text-ink flex-1">{NZ_PARTY_MAP[id].name}</span>
                <span className="text-[9px] font-mono tabular-nums" style={{color:vSwing>=0?'#16a34a':'#ef4444',minWidth:40,textAlign:'right'}}>{vSwing>=0?'+':''}{vSwing.toFixed(1)}%</span>
                <span className="text-[9px] font-mono tabular-nums" style={{color:sSwing>=0?'#16a34a':'#ef4444',minWidth:36,textAlign:'right'}}>{sSwing>=0?'+':''}{sSwing}s</span>
              </div>);
            })}
          </Section>
          <Section title="Coalition Options">
            {NZ_PRESET_COALITIONS.map(coal=>{
              const cs=coal.parties.reduce((s,id)=>s+(seats[id as NzPartyId]??0),0);const ok=cs>=majority;
              return(<div key={coal.name} style={{background:cardBg,borderRadius:5,padding:'6px 8px',display:'flex',alignItems:'center',gap:8}}>
                <span>{coal.emoji}</span>
                <div className="flex-1 min-w-0"><div className="text-[9.5px] font-bold text-ink truncate">{coal.name}</div><div className="text-[7.5px] font-mono" style={{color:ink3}}>{coal.parties.map(id=>NZ_PARTY_MAP[id as NzPartyId]?.name).join('+')}</div></div>
                <div className="text-right"><div className="text-[13px] font-black font-mono" style={{color:ok?'#16a34a':'#ef4444'}}>{cs}</div><div className="text-[7.5px] font-mono" style={{color:ink3}}>{ok?'✓ maj':'✗ no maj'}</div></div>
              </div>);
            })}
          </Section>
        </div>
      )}
    </aside>
  );
}

// ── Tutorial panel ────────────────────────────────────────────────────────────
function NzTutorialPanel({onClose,exiting,dark}:{onClose:()=>void;exiting?:boolean;dark?:boolean}) {
  const H2=({c}:{c:string})=><div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.18em] text-gold mt-4 mb-1.5 first:mt-0">{c}</div>;
  const P=({c}:{c:string})=><p className="text-[11px] text-ink leading-relaxed mb-2">{c}</p>;
  const Note=({c}:{c:string})=><div className="tutorial-note rounded-[4px] px-2.5 py-2 text-[10px] leading-relaxed mb-2">{c}</div>;
  return(
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden ${exiting?'panel-exit':'panel-slide'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div><h1 className="text-[14px] font-bold text-ink leading-none">How to Play</h1><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">New Zealand MMP Election Guide</p></div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-3.5 thin-scroll">
        <H2 c="New Zealand's MMP System"/>
        <P c="New Zealand uses Mixed Member Proportional (MMP). Voters cast two votes: an electorate vote for a local MP, and a party vote that determines each party's proportional share of parliament."/>
        <Note c="The party vote is what counts for seats. A party's total MPs = its party vote share × parliament size. List MPs fill the gap between electorates won and total entitlement."/>
        <H2 c="The 5% Threshold"/>
        <P c="A party must win 5% of the party vote OR win at least 1 electorate seat to enter parliament. If they do, they receive seats proportional to their party vote."/>
        <Note c="Te Pāti Māori won 3.08% in 2023 — below 5% — but won 6 Māori electorates, so they qualify for list seats too. This created 3 overhang seats and a 123-seat parliament."/>
        <H2 c="Overhang Seats"/>
        <P c="If a party wins more electorates than its proportional party vote entitles it to, parliament expands. In 2023, TPM's 6 electorate wins vs ~3 proportional seats = 3 overhang → 123-seat parliament."/>
        <H2 c="Māori Electorates"/>
        <P c="7 Māori electorates exist for voters on the Māori electoral roll. Māori voters choose between the general roll and Māori roll. The Māori electorates span the whole country geographically."/>
        <H2 c="Current Government (2023–)"/>
        <P c="Christopher Luxon (National) leads a coalition with ACT (David Seymour) and NZ First (Winston Peters). This is the first time NZF has been in government since 2020."/>
        <H2 c="Blank Map Mode"/>
        <P c="Click an electorate, set party vote sliders, set % reporting, then hit Project Result. The MMP seat count updates from declared electorates only."/>
        <H2 c="Simulation"/>
        <P c="Set national party vote shares, pick a speed, then Run. All 72 electorates report in 5 batches on a bell-curve. MMP seats recalculate after each batch."/>
      </div>
    </aside>
  );
}

// ── Reporting widget ──────────────────────────────────────────────────────────
function NzReportingWidget({projectedElecs,elecReportingPct,simElecFractions,isSim,dark}:{
  projectedElecs:Set<NzElecId>;elecReportingPct:Partial<Record<NzElecId,number>>;
  simElecFractions:Partial<Record<NzElecId,number>>;isSim:boolean;dark?:boolean;
}) {
  const bg=dark?'rgba(7,13,28,0.90)':'rgba(255,255,255,0.94)';
  const border=dark?'rgba(255,255,255,0.09)':'rgba(0,0,0,0.09)';
  const ink2=dark?'rgba(255,255,255,0.45)':'rgba(0,0,0,0.42)';
  let reportedW=0,projCount=0;
  if(isSim){
    for(const[eId,frac]of Object.entries(simElecFractions)as[NzElecId,number][]){
      reportedW+=(NZ_ELEC_MAP[eId]?.weight??0)*(frac??0);if((frac??0)>0)projCount++;
    }
  } else {
    for(const eId of projectedElecs){
      const rPct=(elecReportingPct[eId]??100)/100;
      reportedW+=(NZ_ELEC_MAP[eId]?.weight??0)*rPct;projCount++;
    }
  }
  const reportedPct=Math.min(100,(reportedW/NZ_TOTAL_ELEC_WEIGHT)*100);
  return(
    <div className="absolute bottom-8 left-3 z-[1001] pointer-events-none"
      style={{background:bg,border:`1px solid ${border}`,borderRadius:10,backdropFilter:'blur(10px)',padding:'10px 13px',minWidth:170,boxShadow:'0 4px 20px rgba(0,0,0,0.18)'}}>
      <div className="text-[8.5px] font-mono font-bold uppercase tracking-[0.15em] mb-1.5" style={{color:ink2}}>{isSim?'⚡ Live Count':'📊 Results'}</div>
      <div className="text-[13px] font-black font-mono text-ink leading-none">{projCount}<span className="text-[10px] font-semibold" style={{color:ink2}}> / {NZ_ELECTORATES.length}</span></div>
      <div className="text-[9px] font-mono mt-0.5 mb-2" style={{color:ink2}}>{isSim?'electorates declared':'electorates projected'}</div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{background:dark?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.08)'}}>
        <div className="h-full rounded-full transition-all duration-500" style={{width:`${reportedPct}%`,background:isSim?'#3b82f6':'#16a34a'}}/>
      </div>
      <div className="text-[9px] font-mono font-bold mt-1 text-right" style={{color:isSim?'#3b82f6':'#16a34a'}}>{reportedPct.toFixed(1)}% of votes</div>
    </div>
  );
}

// ── Parliament hemicycle ───────────────────────────────────────────────────────
function NzParliamentPanel({seats:seatsMap,listSeats,parliament,onClose,exiting,dark}:{
  seats:Partial<Record<NzPartyId,number>>; listSeats:Partial<Record<NzPartyId,number>>;
  parliament:number; onClose:()=>void; exiting?:boolean; dark?:boolean;
}) {
  const seatColors:string[]=[];
  const legend:{id:NzPartyId;total:number;elect:number;list:number;color:string}[]=[];
  for(const id of NZ_LR_ORDER){
    const n=seatsMap[id]??0; if(n===0) continue;
    const color=partyColor(id); const ls=listSeats[id]??0;
    legend.push({id,total:n,elect:n-ls,list:ls,color});
    for(let i=0;i<n;i++) seatColors.push(color);
  }
  const totalSeats=seatColors.length;
  const majority=Math.floor(parliament/2)+1;
  const W=380,H=215,cx=W/2,cy=H-6,innerR=68,rowSpacing=18,numRows=7;
  const radii=Array.from({length:numRows},(_,i)=>innerR+i*rowSpacing);
  const arcLens=radii.map(r=>Math.PI*r);
  const totalArc=arcLens.reduce((s,v)=>s+v,0);
  const rawPerRow=arcLens.map(a=>(a/totalArc)*parliament);
  const floored=rawPerRow.map(Math.floor);
  const remainder=parliament-floored.reduce((s,v)=>s+v,0);
  rawPerRow.map((v,i)=>({i,rem:v-floored[i]})).sort((a,b)=>b.rem-a.rem).slice(0,remainder).forEach(({i})=>floored[i]++);
  const positions:{x:number;y:number;θ:number;r:number}[]=[];
  for(let row=0;row<numRows;row++){
    const r=radii[row],n=floored[row];
    for(let j=0;j<n;j++){const θ=Math.PI-Math.PI*(j+0.5)/n;positions.push({x:cx+r*Math.cos(θ),y:cy-r*Math.sin(θ),θ,r});}
  }
  positions.sort((a,b)=>b.θ-a.θ||a.r-b.r);
  const dotR=2.5;

  return(
    <aside className={`w-80 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-r border-default flex flex-col overflow-hidden ${exiting?'panel-exit-left':'panel-slide-left'}`}>
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-default shrink-0">
        <div>
          <h2 className="text-[13px] font-bold text-ink leading-none">Parliament Hemicycle</h2>
          <div className="text-[9px] font-mono text-ink-3 mt-0.5">{totalSeats} seats · majority {majority} · MMP{parliament>NZ_BASE_SEATS?` · ${parliament-NZ_BASE_SEATS} overhang`:''}</div>
        </div>
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll">
        {totalSeats===0?(
          <div className="flex items-center justify-center h-40 text-ink-3 text-[11px] font-mono px-4 text-center">Load results or run simulation first</div>
        ):(
          <>
            <div className="px-1 pt-4 pb-1">
              <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{display:'block'}}>
                <text x={cx-2} y={cy-innerR-14} textAnchor="middle" style={{fontSize:8,fill:dark?'rgba(255,255,255,0.28)':'rgba(0,0,0,0.30)',fontFamily:'"JetBrains Mono",monospace'}}>← left · right →</text>
                {positions.map(({x,y},i)=>(
                  <circle key={i} cx={x} cy={y} r={dotR} fill={i<seatColors.length?seatColors[i]:(dark?'#2d3748':'#e5e7eb')} opacity={i<seatColors.length?1:0.4}/>
                ))}
                <line x1={cx} y1={cy-innerR-2} x2={cx} y2={cy-(innerR+(numRows-1)*rowSpacing)-4} stroke="#f59e0b" strokeWidth="0.8" strokeDasharray="2,3" opacity="0.6"/>
              </svg>
            </div>
            <div className="px-3.5 pb-4">
              {(()=>{
                const left=NZ_LEFT_IDS.reduce((s,id)=>s+(seatsMap[id]??0),0);
                const right=NZ_RIGHT_IDS.reduce((s,id)=>s+(seatsMap[id]??0),0);
                const nzf=seatsMap['NZF']??0;
                return(
                  <div className="flex items-center gap-1.5 mb-3 text-[9px] font-mono">
                    <span style={{color:'#D82A20',fontWeight:700}}>Left {left}</span>
                    <span style={{color:dark?'rgba(255,255,255,0.25)':'rgba(0,0,0,0.25)'}}>·</span>
                    <span style={{color:'#000',fontWeight:700}}>NZF {nzf}</span>
                    <span style={{color:dark?'rgba(255,255,255,0.25)':'rgba(0,0,0,0.25)'}}>·</span>
                    <span style={{color:'#00529F',fontWeight:700}}>Right {right}</span>
                    <span style={{color:dark?'rgba(255,255,255,0.25)':'rgba(0,0,0,0.25)',marginLeft:'auto'}}>need {majority}</span>
                  </div>
                );
              })()}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {legend.map(({id,total,elect,list,color})=>(
                  <div key={id} className="flex items-center gap-1.5">
                    <div style={{width:9,height:9,borderRadius:2,background:color,flexShrink:0}}/>
                    <span className="text-[9px] font-mono text-ink-3 flex-1 truncate">{NZ_PARTY_MAP[id].name}</span>
                    <span className="text-[9px] font-mono text-ink">{total}</span>
                    <span className="text-[7px] font-mono text-ink-3">({elect}e+{list}l)</span>
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

// ── Main app ──────────────────────────────────────────────────────────────────
export default function NewZealandApp() {
  const navigate=useNavigate();
  const[dark,setDark]=useState(()=>localStorage.getItem('darkMode')!=='false');
  useEffect(()=>{document.documentElement.classList.toggle('dark',dark);localStorage.setItem('darkMode',String(dark));},[dark]);

  // ── Preset / national pcts ────────────────────────────────────────────────
  const[preset,setPreset]  =useState<'baseline'|'blank'|'polling2026'|'custom'>('polling2026');
  const[natPcts,setNatPcts]=useState<Record<NzPartyId,number>>(()=>({...NZ_VOTE_PCT_2026}));

  function loadBaseline()    {setNatPcts({...NZ_VOTE_PCT_2023});setPreset('baseline');resetMapState();}
  function loadPolling2026() {setNatPcts({...NZ_VOTE_PCT_2026});setPreset('polling2026');resetMapState();}
  function loadBlank()       {setNatPcts(Object.fromEntries(NZ_PARTIES.map(p=>[p.id,100/NZ_PARTIES.length]))as Record<NzPartyId,number>);setPreset('blank');resetMapState();}

  function resetMapState(){
    setSimResult(undefined);setDeclaredElecs(undefined);
    setElecOverrides({});setProjectedElecs(new Set());
    setElecReportingPct({});setSimElecFractions({});
    setElecDraft(null);setSimNatPcts(null);stopSim();
  }

  // ── Electorate overrides (blank map) ─────────────────────────────────────
  const[elecOverrides,setElecOverrides]     =useState<Partial<Record<NzElecId,Partial<Record<NzPartyId,number>>>>>({});
  const[projectedElecs,setProjectedElecs]   =useState<Set<NzElecId>>(new Set());
  const[elecReportingPct,setElecReportingPct]=useState<Partial<Record<NzElecId,number>>>({});
  const[elecDraft,setElecDraft]             =useState<NzElecDraft|null>(null);

  const blankDisplayPcts=useMemo<Record<NzPartyId,number>>(()=>{
    const zero=Object.fromEntries(NZ_PARTIES.map(p=>[p.id,0]))as Record<NzPartyId,number>;
    if(preset!=='blank') return zero;
    const weighted:Partial<Record<NzPartyId,number>>={};let totalW=0;
    for(const eId of projectedElecs){
      const cv=calcElecVotes(natPcts,eId,elecOverrides[eId]);
      const rPct=(elecReportingPct[eId]??100)/100;
      const w=(NZ_ELEC_MAP[eId]?.weight??0)*rPct;
      for(const p of NZ_PARTIES) weighted[p.id]=(weighted[p.id]??0)+(cv[p.id]??0)*w;
      totalW+=w;
    }
    if(totalW===0) return zero;
    return Object.fromEntries(NZ_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW]))as Record<NzPartyId,number>;
  },[preset,projectedElecs,elecOverrides,elecReportingPct,natPcts]);

  const blankVoteScale=useMemo(()=>{
    if(preset!=='blank') return 1;
    const projW=[...projectedElecs].reduce((s,eId)=>s+(NZ_ELEC_MAP[eId]?.weight??0)*((elecReportingPct[eId]??100)/100),0);
    return Math.min(1,projW/NZ_TOTAL_ELEC_WEIGHT);
  },[preset,projectedElecs,elecReportingPct]);

  const overrideDisplayPcts=useMemo<Record<NzPartyId,number>>(()=>{
    const hasAny=Object.values(elecOverrides).some(o=>o&&Object.keys(o).length>0);
    if(!hasAny) return natPcts;
    const weighted:Partial<Record<NzPartyId,number>>={};let totalW=0;
    for(const e of NZ_ELECTORATES){
      const cv=calcElecVotes(natPcts,e.id,elecOverrides[e.id]);const w=e.weight;
      for(const p of NZ_PARTIES) weighted[p.id]=(weighted[p.id]??0)+(cv[p.id]??0)*w;
      totalW+=w;
    }
    if(totalW===0) return natPcts;
    return Object.fromEntries(NZ_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW]))as Record<NzPartyId,number>;
  },[natPcts,elecOverrides]);

  const displayPcts=preset==='blank'?blankDisplayPcts:overrideDisplayPcts;

  // MMP result from display pcts
  const displayElectSeats=useMemo(()=>calcElectorateSeats(displayPcts,elecOverrides),[displayPcts,elecOverrides]);
  const displayMMP=useMemo(()=>calcMMP(displayPcts,displayElectSeats),[displayPcts,displayElectSeats]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const[selectedElec,setSelectedElec]         =useState<NzElecId|null>(null);
  const[bubbleMap,setBubbleMap]               =useState(false);
  const[scoreboardVisible,setScoreboardVisible]=useState(true);
  const[hiddenParties,setHiddenParties]       =useState<Set<NzPartyId>>(new Set());
  const[leftPanel, setLeftPanel]  =useState<'parties'|'parli'|'breakdown'|null>(null);
  const[rightPanel,setRightPanel] =useState<'sim'|'tutorial'|'coalition'|null>(null);
  const[exitLeft,  setExitLeft]   =useState<string|null>(null);
  const[exitRight, setExitRight]  =useState<string|null>(null);
  const exitTimerL=useRef<ReturnType<typeof setTimeout>|null>(null);
  const exitTimerR=useRef<ReturnType<typeof setTimeout>|null>(null);

  const openLeft=useCallback((panel:'parties'|'parli'|'breakdown')=>{
    if(leftPanel===panel){setExitLeft(panel);setLeftPanel(null);exitTimerL.current=setTimeout(()=>setExitLeft(null),280);}
    else{if(leftPanel){setExitLeft(leftPanel);exitTimerL.current=setTimeout(()=>setExitLeft(null),280);}setLeftPanel(panel);}
  },[leftPanel]);
  const openRight=useCallback((panel:'sim'|'tutorial'|'coalition')=>{
    if(rightPanel===panel){setExitRight(panel);setRightPanel(null);exitTimerR.current=setTimeout(()=>setExitRight(null),280);}
    else{if(rightPanel){setExitRight(rightPanel);exitTimerR.current=setTimeout(()=>setExitRight(null),280);}if(panel==='sim')setSelectedElec(null);setRightPanel(panel);}
  },[rightPanel]);

  const headerScrollRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=headerScrollRef.current;if(!el)return;
    const h=(e:WheelEvent)=>{if(Math.abs(e.deltaX)>Math.abs(e.deltaY))return;e.preventDefault();el.scrollLeft+=e.deltaY;};
    el.addEventListener('wheel',h,{passive:false});return()=>el.removeEventListener('wheel',h);
  },[]);

  // ── Simulation ────────────────────────────────────────────────────────────
  const[simDraftPcts,  setSimDraftPcts]  =useState<Record<NzPartyId,number>>(()=>({...NZ_VOTE_PCT_2026}));
  const[simDraftLocks, setSimDraftLocks] =useState<Set<NzPartyId>>(new Set());
  const[,setSimDraftTouched]             =useState(false);
  const[simDuration,   setSimDuration]   =useState<60000|120000|300000|600000>(120000);
  const[simNatPcts,    setSimNatPcts]    =useState<Record<NzPartyId,number>|null>(null);
  const[simResult,     setSimResult]     =useState<{total:Partial<Record<NzPartyId,number>>;list:Partial<Record<NzPartyId,number>>;parliament:number}|undefined>();
  const[simProgress,   setSimProgress]   =useState(0);
  const[simRunning,    setSimRunning]    =useState(false);
  const[declaredElecs, setDeclaredElecs] =useState<Set<NzElecId>|undefined>();
  const[simElecFractions,setSimElecFractions]=useState<Partial<Record<NzElecId,number>>>({});
  const simTimersRef =useRef<ReturnType<typeof setTimeout>[]>([]);
  const simNatPctsRef=useRef<Record<NzPartyId,number>>(natPcts);

  useEffect(()=>{if(rightPanel==='sim'){setSimDraftPcts({...natPcts});setSimDraftTouched(false);}},[rightPanel==='sim']); // eslint-disable-line

  const simEffLocks=useMemo(()=>new Set<NzPartyId>([...simDraftLocks,...hiddenParties]),[simDraftLocks,hiddenParties]);
  const[simSortOrder]=useState<NzPartyId[]>(()=>NZ_LR_ORDER.slice());

  function stopSim(){simTimersRef.current.forEach(clearTimeout);simTimersRef.current=[];setSimRunning(false);}

  function runSim(){
    stopSim();setSimDraftTouched(false);
    simNatPctsRef.current={...simDraftPcts};setSimNatPcts({...simDraftPcts});
    const PARTS=5;const totalElecs=NZ_ELECTORATES.length;
    const allTimes=nzBellCurveTimes(PARTS*totalElecs,simDuration);
    const elecIds=[...NZ_ELECTORATES.map(e=>e.id)].sort(()=>Math.random()-0.5);
    const events:{eId:NzElecId;cumFrac:number;t:number}[]=[];
    for(let ei=0;ei<totalElecs;ei++){
      const eId=elecIds[ei];
      const eTimes=allTimes.slice(ei*PARTS,(ei+1)*PARTS).sort((a,b)=>a-b);
      const cuts=[0,Math.random(),Math.random(),Math.random(),Math.random(),1].sort((a,b)=>a-b);
      const sizes=cuts.slice(1).map((c,i)=>c-cuts[i]);
      let cumFrac=0;
      for(let b=0;b<PARTS;b++){cumFrac=Math.min(1,cumFrac+sizes[b]);events.push({eId,cumFrac,t:eTimes[b]});}
    }
    events.sort((a,b)=>a.t-b.t);
    setSimRunning(true);setSimProgress(0);
    setSimResult(undefined);setDeclaredElecs(new Set());setSimElecFractions({});
    const localFrac:Partial<Record<NzElecId,number>>={};
    const localDecl=new Set<NzElecId>();
    const timers:ReturnType<typeof setTimeout>[]=[];
    for(const ev of events){
      timers.push(setTimeout(()=>{
        localFrac[ev.eId]=ev.cumFrac;
        if(ev.cumFrac>=0.999) localDecl.add(ev.eId);
        const fracSnap={...localFrac};const declSnap=new Set(localDecl);
        setSimElecFractions(fracSnap);setDeclaredElecs(declSnap);
        setSimProgress(Object.keys(fracSnap).length);
        const partialResult=calcPartialMMP(simNatPctsRef.current,fracSnap);
        setSimResult({total:partialResult.total,list:{},parliament:partialResult.parliament});
        if(Object.values(fracSnap).every(f=>(f??0)>=0.999)&&Object.keys(fracSnap).length>=totalElecs){
          const electSeats=calcElectorateSeats(simNatPctsRef.current);
          const finalResult=calcMMP(simNatPctsRef.current,electSeats);
          setSimResult(finalResult);setSimRunning(false);
        }
      },ev.t));
    }
    simTimersRef.current=timers;
  }

  const displayResult=simResult??displayMMP;

  const simPartialPcts=useMemo<Record<NzPartyId,number>|null>(()=>{
    if(!simNatPcts) return null;
    const entries=Object.entries(simElecFractions)as[NzElecId,number][];
    if(entries.length===0) return null;
    const weighted:Partial<Record<NzPartyId,number>>={};let totalW=0;
    for(const[eId,frac]of entries){
      if(!frac) continue;
      const w=(NZ_ELEC_MAP[eId]?.weight??0)*frac;
      const cv=calcElecVotes(simNatPcts,eId);
      for(const p of NZ_PARTIES) weighted[p.id]=(weighted[p.id]??0)+(cv[p.id]??0)*w;
      totalW+=w;
    }
    if(totalW===0) return null;
    return Object.fromEntries(NZ_PARTIES.map(p=>[p.id,(weighted[p.id]??0)/totalW]))as Record<NzPartyId,number>;
  },[simNatPcts,simElecFractions]);

  const simVoteScale=useMemo(()=>{
    if(!simNatPcts) return undefined;
    const rW=(Object.entries(simElecFractions)as[NzElecId,number][]).reduce((s,[eId,frac])=>s+(NZ_ELEC_MAP[eId]?.weight??0)*(frac??0),0);
    return Math.min(1,rW/NZ_TOTAL_ELEC_WEIGHT);
  },[simNatPcts,simElecFractions]);

  // ── Derived display ───────────────────────────────────────────────────────
  const showElec      =!!selectedElec&&rightPanel!=='sim'&&!simRunning;
  const showParli     =leftPanel==='parli'    ||exitLeft==='parli';
  const showBreakdown =leftPanel==='breakdown' ||exitLeft==='breakdown';
  const showTutorial  =rightPanel==='tutorial'||exitRight==='tutorial';
  const showCoalition =rightPanel==='coalition'||exitRight==='coalition';

  const btnBase ='h-7 px-3 text-[11px] font-mono font-medium rounded-[4px] transition-colors duration-75 shrink-0 tracking-wide uppercase';
  const btnGold =`${btnBase} bg-gold text-white hover:bg-gold-deep`;
  const btnMuted=`${btnBase} border border-default text-ink-3 hover:bg-hover hover:text-ink`;
  const btnActive=`${btnBase} bg-ink/8 border border-default text-ink`;

  return(
    <div className="flex flex-col h-screen bg-canvas overflow-hidden" data-country="nz">
      {/* ── Header ── */}
      <header className={`h-[52px] ${dark?'bg-[rgba(7,13,28,0.94)]':'bg-[rgba(245,244,240,0.92)]'} backdrop-blur-xl border-b border-default shadow-header shrink-0 flex items-center z-50`}>
        <button onClick={()=>navigate('/')} className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer shrink-0 pl-4"><GlobeLogo/></button>
        <div ref={headerScrollRef} className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scroll-none">
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <img src={`${import.meta.env.BASE_URL}new-zealand-flag.png`} alt="NZ" className="h-4 rounded-[2px] shrink-0 opacity-90"/>
          <span className="text-[11px] font-bold text-ink shrink-0 hidden sm:block">New Zealand</span>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={loadBaseline}    className={preset==='baseline'   ?btnGold:btnMuted}>2023 Baseline</button>
          <button onClick={loadPolling2026} className={preset==='polling2026'?btnGold:btnMuted}>2026 Polling</button>
          <button onClick={loadBlank}       className={preset==='blank'      ?btnGold:btnMuted}>Blank Map</button>
          <div className="w-px h-4 bg-black/8 shrink-0 mx-0.5"/>
          <button onClick={()=>openRight('sim')}      className={rightPanel==='sim'      ?btnActive:btnMuted}>▶ Simulation</button>
          <button onClick={()=>!simRunning&&openLeft('parties')} disabled={simRunning} className={`${leftPanel==='parties'?btnActive:btnMuted}${simRunning?' opacity-40 cursor-not-allowed':''}`}>Parties</button>
          <button onClick={()=>setScoreboardVisible(v=>!v)} className={scoreboardVisible?btnActive:btnMuted}>Scoreboard</button>
          <button onClick={()=>openLeft('breakdown')} className={leftPanel==='breakdown'?btnActive:btnMuted}>Breakdown</button>
          <button onClick={()=>openRight('coalition')}className={rightPanel==='coalition'?btnActive:btnMuted}>Coalition</button>
          <button onClick={()=>openLeft('parli')}     className={leftPanel==='parli'    ?btnActive:btnMuted}>Parliament</button>
          <button onClick={()=>setBubbleMap(v=>!v)}   className={bubbleMap?`${btnBase} bg-emerald-600 text-white hover:bg-emerald-700`:btnMuted}>Bubble Map</button>
          <button onClick={()=>openRight('tutorial')} className={rightPanel==='tutorial'?btnActive:btnMuted}>Tutorial</button>
        </div>
        <div className="shrink-0 flex items-center gap-2 pr-4">
          <button onClick={()=>setDark(v=>!v)} className="w-7 h-7 flex items-center justify-center rounded-[4px] border border-default text-ink-3 hover:text-ink transition-colors">{dark?'☀':'☾'}</button>
        </div>
      </header>

      {/* ── Scoreboard ── */}
      {scoreboardVisible&&(
        <NzScoreboard
          natPcts={simPartialPcts??(simNatPcts??displayPcts)}
          mmpResult={simResult}
          isBaseline={preset==='baseline'&&!simNatPcts}
          is2026={preset!=='baseline'||!!simNatPcts}
          dark={dark}
          reportedVoteScale={simNatPcts!=null?simVoteScale:(preset==='blank'?blankVoteScale:undefined)}
        />
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {leftPanel==='parties'&&<NzPartiesPanel hiddenParties={hiddenParties} onToggle={id=>setHiddenParties(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;})} onClose={()=>openLeft('parties')} dark={dark}/>}
        {showParli    &&<NzParliamentPanel seats={displayResult.total} listSeats={displayResult.list} parliament={displayResult.parliament} onClose={()=>openLeft('parli')} exiting={exitLeft==='parli'} dark={dark}/>}
        {showBreakdown&&<NzBreakdownPanel  seats={displayResult.total} listSeats={displayResult.list} parliament={displayResult.parliament} natPcts={displayPcts} isBaseline={preset==='baseline'} onClose={()=>openLeft('breakdown')} exiting={exitLeft==='breakdown'} dark={dark}/>}

        {/* MAP */}
        <div className="relative flex-1 min-w-0 min-h-0">
          <NzMapView
            natPcts={natPcts} selectedElec={selectedElec}
            onSelect={e=>setSelectedElec(prev=>prev===e?null:e)}
            dark={dark} bubbleMap={bubbleMap}
            declaredElecs={declaredElecs} elecOverrides={elecOverrides}
            blankMode={preset==='blank'} projectedElecs={projectedElecs}
            simElecFractions={simElecFractions}
            elecDraft={preset==='blank'?elecDraft:null}
            simNatPcts={simNatPcts}
          />
          {(preset==='blank'||simRunning||simResult!=null)&&(
            <NzReportingWidget
              projectedElecs={projectedElecs} elecReportingPct={elecReportingPct}
              simElecFractions={simElecFractions}
              isSim={simRunning||(simResult!=null&&preset!=='blank')}
              dark={dark}
            />
          )}
        </div>

        {/* RIGHT panels */}
        {rightPanel==='sim'&&(
          <aside className={`w-72 shrink-0 ${dark?'bg-[#0d1b2e]':'bg-white'} border-l border-default flex flex-col overflow-hidden panel-slide`}>
            <div className="px-3.5 pt-3.5 pb-2.5 border-b border-default shrink-0 flex items-center justify-between">
              <div><h2 className="text-[14px] font-bold text-ink leading-none">Simulation</h2><p className="text-[8.5px] font-mono text-ink-3 mt-0.5 uppercase tracking-wide">Party vote · then run</p></div>
              <button onClick={()=>openRight('sim')} className="w-6 h-6 flex items-center justify-center rounded-[4px] hover:bg-hover text-ink-3 hover:text-ink text-base">×</button>
            </div>
            <div className="px-3.5 pt-2.5 pb-2 border-b border-default shrink-0">
              <div className="text-[7.5px] font-mono font-bold uppercase tracking-[0.14em] text-ink-3 mb-1.5">Simulation speed</div>
              <div className="flex gap-1.5">
                {([['1 min','60s',60000],['2 min','2m',120000],['5 min','5m',300000],['10 min','10m',600000]]as const).map(([label,sub,ms])=>(
                  <button key={ms} onClick={()=>setSimDuration(ms)}
                    className={`flex-1 py-1 rounded-[4px] border text-[9px] font-mono font-bold transition-colors ${simDuration===ms?'bg-blue-600 text-white border-blue-600':'border-default text-ink-3 hover:bg-hover'}`}>
                    {label}<div className="text-[7px] opacity-70">{sub}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3.5 py-3 thin-scroll space-y-3">
              {simSortOrder.filter(id=>!hiddenParties.has(id)).map(id=>{
                const party=NZ_PARTY_MAP[id];const pct=simDraftPcts[id]??0;const isLocked=simDraftLocks.has(id);const color=partyColor(id);
                const rawVotes=Math.round(pct/100*NZ_GRAND_TOTAL_VOTES);
                return(
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
                    <input type="range" min={0} max={55} step={0.1} value={pct} disabled={isLocked}
                      onChange={e=>{setSimDraftPcts(redistributePcts(simDraftPcts,id,parseFloat(e.target.value),simEffLocks));setSimDraftTouched(true);}}
                      className="br-party-slider w-full"
                      style={{'--party-color':color,'--pct':`${(pct/55)*100}%`}as React.CSSProperties}/>
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[8px] font-mono" style={{color:dark?'rgba(255,255,255,0.22)':'rgba(0,0,0,0.28)'}}>{fmtN(rawVotes)}</span>
                      <span className="text-[7.5px] font-mono" style={{color:pct>=5?'#16a34a':'#f59e0b'}}>{pct>=5?'✓ above 5%':'⚠ below threshold'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-3.5 pb-3.5 pt-2 border-t border-default shrink-0 space-y-2">
              <button disabled={simRunning} onClick={runSim}
                className="w-full h-8 rounded-[4px] bg-blue-600 text-white text-[11px] font-mono font-semibold uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {simRunning?`${simProgress}/${NZ_ELECTORATES.length} reporting…`:'▶ Run Simulation'}
              </button>
              {(simResult||declaredElecs)&&(
                <button onClick={()=>{stopSim();setSimResult(undefined);setDeclaredElecs(undefined);setSimProgress(0);setSimElecFractions({});setSimNatPcts(null);}}
                  className="w-full h-7 rounded-[4px] border border-default text-ink-3 text-[10px] font-mono uppercase tracking-wide hover:bg-hover transition-colors">Reset</button>
              )}
            </div>
          </aside>
        )}

        {showElec&&selectedElec&&(
          <NzElecPanel key={selectedElec} elecId={selectedElec} natPcts={natPcts}
            elecOverride={elecOverrides[selectedElec]}
            onOverride={pcts=>setElecOverrides(prev=>({...prev,[selectedElec]:pcts}))}
            onResetOverride={()=>{setElecOverrides(prev=>{const n={...prev};delete n[selectedElec];return n;});setProjectedElecs(prev=>{const n=new Set(prev);n.delete(selectedElec);return n;});setElecDraft(null);}}
            onClose={()=>{setSelectedElec(null);setElecDraft(null);}}
            isBlankMode={preset==='blank'} isProjected={projectedElecs.has(selectedElec)}
            reportingPct={elecReportingPct[selectedElec]??100}
            onProject={()=>setProjectedElecs(prev=>new Set([...prev,selectedElec]))}
            onReportingPctChange={pct=>setElecReportingPct(prev=>({...prev,[selectedElec]:pct}))}
            onDraftChange={preset==='blank'?(pcts,rpt)=>setElecDraft({elecId:selectedElec,pcts,rptPct:rpt}):undefined}
            hiddenParties={hiddenParties} dark={dark}/>
        )}

        {showTutorial &&<NzTutorialPanel  onClose={()=>openRight('tutorial')}  exiting={exitRight==='tutorial'}  dark={dark}/>}
        {showCoalition&&<NzCoalitionPanel seats={displayResult.total} parliament={displayResult.parliament} onClose={()=>openRight('coalition')} exiting={exitRight==='coalition'} dark={dark}/>}
      </div>
    </div>
  );
}
