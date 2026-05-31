export type PartyId =
  // Original 2024 parties
  | 'LAB' | 'CON' | 'LD' | 'RFM' | 'GRN' | 'SNP' | 'PC'
  | 'DUP' | 'SF' | 'SDLP' | 'UUP' | 'ALL' | 'TUV'
  | 'IND' | 'SPK' | 'OTH'
  // Extended / minor parties
  | 'WPB' | 'ALB' | 'SDP' | 'HER' | 'RCL' | 'YRK' | 'CPA'
  | 'UKIP' | 'FOR' | 'RES';

export type Party = {
  id: PartyId;
  name: string;
  color: string;
  defaultLeader: string;
  alternativeLeaders: string[];
  isExtended?: boolean;
};

export const PARTIES: Record<PartyId, Party> = {
  // ── Original 2024 parties ──────────────────────────────────────────
  // Only Labour retains alternative leaders; all others have one leader.
  LAB:  { id: 'LAB',  name: 'Labour',                        color: '#E4003B', defaultLeader: 'Keir Starmer',     alternativeLeaders: ['Andy Burnham'] },
  CON:  { id: 'CON',  name: 'Conservative',                  color: '#0087DC', defaultLeader: 'Kemi Badenoch',    alternativeLeaders: [] },
  LD:   { id: 'LD',   name: 'Liberal Democrats',             color: '#FAA61A', defaultLeader: 'Ed Davey',         alternativeLeaders: [] },
  RFM:  { id: 'RFM',  name: 'Reform UK',                     color: '#12B6CF', defaultLeader: 'Nigel Farage',     alternativeLeaders: [] },
  GRN:  { id: 'GRN',  name: 'Green Party',                   color: '#02A95B', defaultLeader: 'Zack Polanski',    alternativeLeaders: [] },
  SNP:  { id: 'SNP',  name: 'Scottish National Party',       color: '#FDF38E', defaultLeader: 'John Swinney',     alternativeLeaders: [] },
  PC:   { id: 'PC',   name: 'Plaid Cymru',                   color: '#005B54', defaultLeader: 'Rhun ap Iorwerth', alternativeLeaders: [] },
  DUP:  { id: 'DUP',  name: 'Democratic Unionist Party',     color: '#D46A4C', defaultLeader: 'Gavin Robinson',   alternativeLeaders: [] },
  SF:   { id: 'SF',   name: 'Sinn Féin',                     color: '#326760', defaultLeader: "Michelle O'Neill", alternativeLeaders: [] },
  SDLP: { id: 'SDLP', name: 'SDLP',                          color: '#2AA82C', defaultLeader: 'Claire Hanna',     alternativeLeaders: [] },
  UUP:  { id: 'UUP',  name: 'Ulster Unionist Party',         color: '#48A5EE', defaultLeader: 'Mike Nesbitt',     alternativeLeaders: [] },
  ALL:  { id: 'ALL',  name: 'Alliance Party',                color: '#F6CB2F', defaultLeader: 'Naomi Long',       alternativeLeaders: [] },
  TUV:  { id: 'TUV',  name: 'Traditional Unionist Voice',    color: '#0095B6', defaultLeader: 'Jim Allister',     alternativeLeaders: [] },
  IND:  { id: 'IND',  name: 'Independent',                   color: '#888888', defaultLeader: '—',                alternativeLeaders: [] },
  SPK:  { id: 'SPK',  name: 'Speaker',                       color: '#444444', defaultLeader: 'Lindsay Hoyle',    alternativeLeaders: [] },
  OTH:  { id: 'OTH',  name: 'Other',                         color: '#BBBBBB', defaultLeader: '—',                alternativeLeaders: [] },

  // ── Extended / minor parties (hidden by default) ──────────────────
  WPB:  { id: 'WPB',  name: 'Workers Party of Britain',      color: '#8B0000', defaultLeader: 'George Galloway',    alternativeLeaders: [], isExtended: true },
  ALB:  { id: 'ALB',  name: 'Alba Party',                    color: '#1B3C8C', defaultLeader: 'Kenny MacAskill',    alternativeLeaders: [], isExtended: true },
  SDP:  { id: 'SDP',  name: 'Social Democratic Party',       color: '#A01010', defaultLeader: 'William Clouston',   alternativeLeaders: [], isExtended: true },
  HER:  { id: 'HER',  name: 'Heritage Party',                color: '#1A2744', defaultLeader: 'David Kurten',       alternativeLeaders: [], isExtended: true },
  RCL:  { id: 'RCL',  name: 'Reclaim Party',                 color: '#002147', defaultLeader: 'Laurence Fox',       alternativeLeaders: [], isExtended: true },
  YRK:  { id: 'YRK',  name: 'Yorkshire Party',               color: '#1E7A3A', defaultLeader: 'Bob Buxton',         alternativeLeaders: [], isExtended: true },
  CPA:  { id: 'CPA',  name: 'Christian Peoples Alliance',    color: '#3B1F5E', defaultLeader: 'Sid Cordle',         alternativeLeaders: [], isExtended: true },
  UKIP: { id: 'UKIP', name: 'UKIP',                          color: '#702FA0', defaultLeader: 'Neil Hamilton',      alternativeLeaders: [], isExtended: true },
  FOR:  { id: 'FOR',  name: 'For Britain',                   color: '#003087', defaultLeader: 'Anne Marie Waters',  alternativeLeaders: [], isExtended: true },
  RES:  { id: 'RES',  name: 'Restore Britain',               color: '#002366', defaultLeader: 'Rupert Lowe',        alternativeLeaders: [], isExtended: true },
};

export const ORIGINAL_PARTY_IDS = new Set<PartyId>([
  'LAB','CON','LD','RFM','GRN','SNP','PC',
  'DUP','SF','SDLP','UUP','ALL','TUV',
  'IND','SPK','OTH',
]);

export const EXTENDED_PARTY_IDS = new Set<PartyId>([
  'WPB','ALB','SDP','HER','RCL','YRK','CPA','UKIP','FOR','RES',
]);

export const VALID_PARTY_IDS = new Set<PartyId>(Object.keys(PARTIES) as PartyId[]);

// Parties restricted to a specific nation. Absent = allowed everywhere.
export const PARTY_REGIONS: Partial<Record<PartyId, string[]>> = {
  PC:   ['Wales'],
  SNP:  ['Scotland'],
  ALB:  ['Scotland'],
  DUP:  ['NI'],
  SF:   ['NI'],
  SDLP: ['NI'],
  UUP:  ['NI'],
  ALL:  ['NI'],
  TUV:  ['NI'],
};

export function partyAllowedIn(id: PartyId, country: string): boolean {
  const regions = PARTY_REGIONS[id];
  return !regions || regions.includes(country);
}

// Leaders as they stood on election day, 4 July 2024.
// Only parties whose leader has changed since then need an entry here.
export const BASELINE_2024_LEADERS: Partial<Record<PartyId, string>> = {
  CON: 'Rishi Sunak',
  GRN: 'Carla Denyer',
};

// Maps every leader name to the Wikipedia article title used to fetch their photo.
// Names absent from this map (e.g. placeholder "Your Leader") fall back to initials.
export const LEADER_WIKI_TITLES: Record<string, string> = {
  // Labour
  'Keir Starmer':      'Keir_Starmer',
  'Andy Burnham':      'Andy_Burnham',
  'Wes Streeting':     'Wes_Streeting',
  'Lisa Nandy':        'Lisa_Nandy',
  'Yvette Cooper':     'Yvette_Cooper',
  // Conservative — current and 2024 baseline
  'Kemi Badenoch':     'Kemi_Badenoch',
  'Rishi Sunak':       'Rishi_Sunak',
  // Liberal Democrats
  'Ed Davey':          'Ed_Davey',
  // Reform UK
  'Nigel Farage':      'Nigel_Farage',
  // Green — current and 2024 baseline
  'Zack Polanski':     'Zack_Polanski',
  'Carla Denyer':      'Carla_Denyer',
  // SNP
  'John Swinney':      'John_Swinney',
  // Plaid Cymru
  'Rhun ap Iorwerth':  'Rhun_ap_Iorwerth',
  // DUP
  'Gavin Robinson':    'Gavin_Robinson',
  // Sinn Féin
  "Michelle O'Neill":  "Michelle_O'Neill",
  // SDLP
  'Claire Hanna':      'Claire_Hanna',
  // UUP
  'Mike Nesbitt':      'Mike_Nesbitt',
  // Alliance
  'Naomi Long':        'Naomi_Long',
  // TUV
  'Jim Allister':      'Jim_Allister',
  // Speaker
  'Lindsay Hoyle':     'Lindsay_Hoyle',
  // Extended / minor parties
  'George Galloway':   'George_Galloway',
  'Kenny MacAskill':   'Kenny_MacAskill',
  'William Clouston':  'William_Clouston',
  'David Kurten':      'David_Kurten',
  'Laurence Fox':      'Laurence_Fox',
  'Neil Hamilton':     'Neil_Hamilton_(politician)',
  'Anne Marie Waters': 'Anne_Marie_Waters',
  'Rupert Lowe':       'Rupert_Lowe',
};
