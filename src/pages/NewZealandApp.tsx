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
const NZ_MAJORITY   = 62;  // majority of base 120; in practice ≥62 controls confidence+supply

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
const NZ_AKLD_URBAN: Partial<Record<NzPartyId,number>>  = {NAT:33,LAB:30,GRN:18,ACT:10,NZF:5,TPM:3};
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
