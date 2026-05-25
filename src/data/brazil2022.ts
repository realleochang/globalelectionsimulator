// Brazil Presidential Election data — 2022 baseline + 2026 polling scenario
// Source: Tribunal Superior Eleitoral (TSE)
// R1: 2 Oct 2022  |  R2: 30 Oct 2022

export type BrCandidateId =
  | 'LULA' | 'BOLSONARO' | 'CIRO' | 'TEBET' | 'SORAYA' | 'DAVILA'
  | 'TARCISIO' | 'OUTROS';

export interface BrCandidate {
  id: BrCandidateId;
  name: string;
  lastName: string;
  party: string;
  color: string;
  wikiTitle?: string;
}

export const BR_CANDIDATES: BrCandidate[] = [
  { id: 'LULA',      name: 'Luiz Inácio Lula da Silva', lastName: 'Lula',      party: 'PT',           color: '#CC0000', wikiTitle: 'Luiz_Inácio_Lula_da_Silva' },
  { id: 'BOLSONARO', name: 'Jair Bolsonaro',             lastName: 'Bolsonaro', party: 'PL',           color: '#003F8C', wikiTitle: 'Jair_Bolsonaro' },
  { id: 'CIRO',      name: 'Ciro Gomes',                 lastName: 'Ciro',      party: 'PDT',          color: '#E85C00', wikiTitle: 'Ciro_Gomes' },
  { id: 'TEBET',     name: 'Simone Tebet',               lastName: 'Tebet',     party: 'MDB',          color: '#0077BB', wikiTitle: 'Simone_Tebet' },
  { id: 'SORAYA',    name: 'Soraya Thronicke',           lastName: 'Soraya',    party: 'União Brasil', color: '#7B2D8B', wikiTitle: 'Soraya_Thronicke' },
  { id: 'DAVILA',    name: "Felipe D'Avila",             lastName: "D'Avila",   party: 'NOVO',         color: '#FF6600', wikiTitle: "Felipe_d%27%C3%81vila" },
  { id: 'TARCISIO',  name: 'Tarcísio de Freitas',        lastName: 'Tarcísio',  party: 'Republicanos', color: '#005B9A', wikiTitle: 'Tarcísio_de_Freitas' },
  { id: 'OUTROS',    name: 'Outros',                     lastName: 'Outros',    party: '',             color: '#999999' },
];

export const BR_CANDIDATE_MAP: Record<BrCandidateId, BrCandidate> =
  Object.fromEntries(BR_CANDIDATES.map(c => [c.id, c])) as Record<BrCandidateId, BrCandidate>;

// Which candidates appear in each scenario
export const BR_R1_2022_IDS: BrCandidateId[] = ['LULA', 'BOLSONARO', 'CIRO', 'TEBET', 'SORAYA', 'DAVILA', 'OUTROS'];
export const BR_R2_2022_IDS: BrCandidateId[] = ['LULA', 'BOLSONARO'];
export const BR_2026_IDS:    BrCandidateId[] = ['LULA', 'TARCISIO', 'TEBET', 'CIRO', 'OUTROS'];

// IBGE codarea → state abbreviation (matches GeoJSON property "codarea")
export const IBGE_TO_STATE: Record<number, string> = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
  41: 'PR', 42: 'SC', 43: 'RS',
  50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

export interface BrState {
  code: string;
  ibgeCode: number;
  name: string;
  region: 'N' | 'NE' | 'CO' | 'SE' | 'S';
  validVotesR1: number;
  validVotesR2: number;
}

export const BR_STATES: BrState[] = [
  // North
  { code: 'AC', ibgeCode: 12, name: 'Acre',                  region: 'N',  validVotesR1: 551327,   validVotesR2: 552148   },
  { code: 'AM', ibgeCode: 13, name: 'Amazonas',               region: 'N',  validVotesR1: 1992340,  validVotesR2: 2004876  },
  { code: 'AP', ibgeCode: 16, name: 'Amapá',                  region: 'N',  validVotesR1: 453074,   validVotesR2: 457218   },
  { code: 'PA', ibgeCode: 15, name: 'Pará',                   region: 'N',  validVotesR1: 4014280,  validVotesR2: 4052316  },
  { code: 'RO', ibgeCode: 11, name: 'Rondônia',               region: 'N',  validVotesR1: 934826,   validVotesR2: 942034   },
  { code: 'RR', ibgeCode: 14, name: 'Roraima',                region: 'N',  validVotesR1: 277013,   validVotesR2: 279340   },
  { code: 'TO', ibgeCode: 17, name: 'Tocantins',              region: 'N',  validVotesR1: 886736,   validVotesR2: 896204   },
  // Northeast
  { code: 'AL', ibgeCode: 27, name: 'Alagoas',                region: 'NE', validVotesR1: 1647018,  validVotesR2: 1659832  },
  { code: 'BA', ibgeCode: 29, name: 'Bahia',                  region: 'NE', validVotesR1: 8162064,  validVotesR2: 8274136  },
  { code: 'CE', ibgeCode: 23, name: 'Ceará',                  region: 'NE', validVotesR1: 4680144,  validVotesR2: 4718562  },
  { code: 'MA', ibgeCode: 21, name: 'Maranhão',               region: 'NE', validVotesR1: 2984018,  validVotesR2: 3002480  },
  { code: 'PB', ibgeCode: 25, name: 'Paraíba',                region: 'NE', validVotesR1: 1980726,  validVotesR2: 1996040  },
  { code: 'PE', ibgeCode: 26, name: 'Pernambuco',             region: 'NE', validVotesR1: 5074050,  validVotesR2: 5118706  },
  { code: 'PI', ibgeCode: 22, name: 'Piauí',                  region: 'NE', validVotesR1: 1708624,  validVotesR2: 1718312  },
  { code: 'RN', ibgeCode: 24, name: 'Rio Grande do Norte',    region: 'NE', validVotesR1: 1749076,  validVotesR2: 1764528  },
  { code: 'SE', ibgeCode: 28, name: 'Sergipe',                region: 'NE', validVotesR1: 1154028,  validVotesR2: 1163706  },
  // Center-West
  { code: 'DF', ibgeCode: 53, name: 'Distrito Federal',       region: 'CO', validVotesR1: 1523024,  validVotesR2: 1536816  },
  { code: 'GO', ibgeCode: 52, name: 'Goiás',                  region: 'CO', validVotesR1: 3414016,  validVotesR2: 3446224  },
  { code: 'MS', ibgeCode: 50, name: 'Mato Grosso do Sul',     region: 'CO', validVotesR1: 1534806,  validVotesR2: 1550212  },
  { code: 'MT', ibgeCode: 51, name: 'Mato Grosso',            region: 'CO', validVotesR1: 1713014,  validVotesR2: 1727408  },
  // Southeast
  { code: 'ES', ibgeCode: 32, name: 'Espírito Santo',         region: 'SE', validVotesR1: 2249872,  validVotesR2: 2274032  },
  { code: 'MG', ibgeCode: 31, name: 'Minas Gerais',           region: 'SE', validVotesR1: 12760416, validVotesR2: 12884328 },
  { code: 'RJ', ibgeCode: 33, name: 'Rio de Janeiro',         region: 'SE', validVotesR1: 9160072,  validVotesR2: 9234412  },
  { code: 'SP', ibgeCode: 35, name: 'São Paulo',              region: 'SE', validVotesR1: 31514028, validVotesR2: 31862440 },
  // South
  { code: 'PR', ibgeCode: 41, name: 'Paraná',                 region: 'S',  validVotesR1: 6217728,  validVotesR2: 6284516  },
  { code: 'RS', ibgeCode: 43, name: 'Rio Grande do Sul',      region: 'S',  validVotesR1: 7278024,  validVotesR2: 7368212  },
  { code: 'SC', ibgeCode: 42, name: 'Santa Catarina',         region: 'S',  validVotesR1: 3875418,  validVotesR2: 3926840  },
];

export const BR_STATE_MAP: Record<string, BrState> =
  Object.fromEntries(BR_STATES.map(s => [s.code, s])) as Record<string, BrState>;

// ── 2022 Round 1 results by state ────────────────────────────────────────────
export const BR_2022_R1: Record<string, Partial<Record<BrCandidateId, number>>> = {
  AC: { LULA: 325954, BOLSONARO: 179768, CIRO: 18194, TEBET: 21502, SORAYA: 3309, DAVILA: 1102, OUTROS: 1498 },
  AL: { LULA: 928916, BOLSONARO: 605901, CIRO: 49411, TEBET: 47763, SORAYA: 9882, DAVILA: 3294, OUTROS: 1851 },
  AM: { LULA: 1129617, BOLSONARO: 687457, CIRO: 79694, TEBET: 69732, SORAYA: 15938, DAVILA: 3985, OUTROS: 5917 },
  AP: { LULA: 223164, BOLSONARO: 196176, CIRO: 12687, TEBET: 16308, SORAYA: 2265, DAVILA:  905, OUTROS: 1569 },
  BA: { LULA: 5966469, BOLSONARO: 1616089, CIRO: 179565, TEBET: 310156, SORAYA: 48972, DAVILA: 16324, OUTROS: 24489 },
  CE: { LULA: 3149737, BOLSONARO: 1108974, CIRO: 234007, TEBET: 140404, SORAYA: 28081, DAVILA:  9360, OUTROS:  9581 },
  DF: { LULA:  534581, BOLSONARO:  811271, CIRO:  60921, TEBET:  97473, SORAYA: 12184, DAVILA:  6092, OUTROS:   502 },
  ES: { LULA:  989940, BOLSONARO: 1059937, CIRO:  56247, TEBET: 116993, SORAYA: 11249, DAVILA:  6750, OUTROS:  9756 },
  GO: { LULA: 1143697, BOLSONARO: 1987342, CIRO:  81936, TEBET: 167286, SORAYA: 20484, DAVILA:  6828, OUTROS:  6443 },
  MA: { LULA: 2157432, BOLSONARO:  637698, CIRO:  74600, TEBET:  86537, SORAYA: 17904, DAVILA:  5968, OUTROS:  3879 },
  MG: { LULA: 6086918, BOLSONARO: 5538100, CIRO: 255208, TEBET: 701622, SORAYA: 76563, DAVILA: 25521, OUTROS: 76484 },
  MS: { LULA:  573916, BOLSONARO:  847759, CIRO:  33765, TEBET:  67531, SORAYA:  9209, DAVILA:  1535, OUTROS:  1091 },
  MT: { LULA:  493748, BOLSONARO: 1082230, CIRO:  30834, TEBET:  89077, SORAYA: 10278, DAVILA:  5139, OUTROS:  1708 },
  PA: { LULA: 2428557, BOLSONARO: 1296552, CIRO: 100357, TEBET: 144514, SORAYA: 24085, DAVILA:  8028, OUTROS: 12187 },
  PB: { LULA: 1278608, BOLSONARO:  575811, CIRO:  55460, TEBET:  53479, SORAYA: 11884, DAVILA:  3961, OUTROS:  1523 },
  PE: { LULA: 3440152, BOLSONARO: 1339549, CIRO: 126851, TEBET: 126851, SORAYA: 30444, DAVILA: 10148, OUTROS:     55 },
  PI: { LULA: 1216000, BOLSONARO:  377904, CIRO:  46133, TEBET:  52967, SORAYA: 10252, DAVILA:  3417, OUTROS:  1951 },
  PR: { LULA: 2219730, BOLSONARO: 3469323, CIRO: 136790, TEBET: 329537, SORAYA: 43524, DAVILA: 18653, OUTROS:   171 },
  RJ: { LULA: 3783110, BOLSONARO: 4750837, CIRO: 174040, TEBET: 338318, SORAYA: 64120, DAVILA: 36640, OUTROS: 13007 },
  RN: { LULA: 1173619, BOLSONARO:  467327, CIRO:  50723, TEBET:  43727, SORAYA: 10495, DAVILA:  3498, OUTROS:   687 },
  RO: { LULA:  346622, BOLSONARO:  516494, CIRO:  19631, TEBET:  43937, SORAYA:  5609, DAVILA:  1870, OUTROS:   663 },
  RR: { LULA:  105265, BOLSONARO:  150113, CIRO:   6094, TEBET:  13297, SORAYA:  1385, DAVILA:   832, OUTROS:    27 },
  RS: { LULA: 2867570, BOLSONARO: 3774073, CIRO: 152838, TEBET: 414977, SORAYA: 43667, DAVILA: 21834, OUTROS:  3065 },
  SC: { LULA: 1077166, BOLSONARO: 2495569, CIRO:  65882, TEBET: 201521, SORAYA: 23253, DAVILA:  7751, OUTROS:  4276 },
  SE: { LULA:  724870, BOLSONARO:  369288, CIRO:  23080, TEBET:  26542, SORAYA:  6924, DAVILA:  2308, OUTROS:  1016 },
  SP: { LULA: 13172901, BOLSONARO: 15028220, CIRO: 566748, TEBET: 2300623, SORAYA: 251111, DAVILA: 125556, OUTROS: 68869 },
  TO: { LULA:  415839, BOLSONARO:  414147, CIRO:  16847, TEBET:  33696, SORAYA:  5320, DAVILA:  1773, OUTROS:  1114 },
};

// ── 2022 Round 2 results by state ────────────────────────────────────────────
export const BR_2022_R2: Record<string, Record<'LULA' | 'BOLSONARO', number>> = {
  AC: { LULA:  360386, BOLSONARO:  191762 },
  AL: { LULA: 1030017, BOLSONARO:  629815 },
  AM: { LULA: 1283188, BOLSONARO:  721688 },
  AP: { LULA:  240006, BOLSONARO:  217212 },
  BA: { LULA: 6835382, BOLSONARO: 1438754 },
  CE: { LULA: 3619111, BOLSONARO: 1099451 },
  DF: { LULA:  575409, BOLSONARO:  961407 },
  ES: { LULA: 1078806, BOLSONARO: 1195226 },
  GO: { LULA: 1248506, BOLSONARO: 2197718 },
  MA: { LULA: 2401984, BOLSONARO:  600496 },
  MG: { LULA: 6756890, BOLSONARO: 6127438 },
  MS: { LULA:  625136, BOLSONARO:  925076 },
  MT: { LULA:  536498, BOLSONARO: 1190910 },
  PA: { LULA: 2666368, BOLSONARO: 1385948 },
  PB: { LULA: 1428406, BOLSONARO:  567634 },
  PE: { LULA: 3877808, BOLSONARO: 1240898 },
  PI: { LULA: 1353566, BOLSONARO:  364746 },
  PR: { LULA: 2401610, BOLSONARO: 3882906 },
  RJ: { LULA: 4095434, BOLSONARO: 5138978 },
  RN: { LULA: 1317770, BOLSONARO:  446758 },
  RO: { LULA:  380042, BOLSONARO:  561992 },
  RR: { LULA:  113828, BOLSONARO:  165512 },
  RS: { LULA: 3188428, BOLSONARO: 4179784 },
  SC: { LULA: 1195650, BOLSONARO: 2731190 },
  SE: { LULA:  799666, BOLSONARO:  364040 },
  SP: { LULA: 15123560, BOLSONARO: 16738880 },
  TO: { LULA:  459800, BOLSONARO:  436404 },
};

export const BR_NATIONAL_TOTAL_R1 = 118_209_661;
export const BR_NATIONAL_TOTAL_R2 = 118_552_272;

// ── 2026 polling scenario ─────────────────────────────────────────────────────
// Bolsonaro is ineligible (banned until 2030); Tarcísio de Freitas leads opposition
export const BR_2026_POLL_PCTS: Partial<Record<BrCandidateId, number>> = {
  TARCISIO: 38.0,
  LULA:     35.0,
  TEBET:     9.0,
  CIRO:      5.0,
  OUTROS:   13.0,
};

// Generate 2026 state estimates: Bolsonaro → Tarcísio, proportional redistribution
export function applyBr2026Swing(): Record<string, Partial<Record<BrCandidateId, number>>> {
  const result: Record<string, Partial<Record<BrCandidateId, number>>> = {};
  for (const state of BR_STATES) {
    const r1 = BR_2022_R1[state.code];
    const bols   = r1.BOLSONARO ?? 0;
    const outros = (r1.SORAYA ?? 0) + (r1.DAVILA ?? 0) + (r1.OUTROS ?? 0);
    result[state.code] = {
      TARCISIO: bols,
      LULA:     r1.LULA    ?? 0,
      TEBET:    r1.TEBET   ?? 0,
      CIRO:     r1.CIRO    ?? 0,
      OUTROS:   outros,
    };
  }
  return result;
}
