import type { BrCandidateId } from './brazilCandidates';

// Brazil 2022 Presidential Election – Round 2 results by state.
// Source: Superior Electoral Court (TSE) – October 30, 2022.
// [LUL, BOL]
const RAW: Record<string, [number, number]> = {
  'AC': [   121_566,   287_750],
  'AL': [   976_831,   687_827],
  'AM': [ 1_004_991,   961_741],
  'AP': [   189_918,   200_547],  // AP flipped: Lula won R1, Bolsonaro won R2
  'BA': [ 6_097_815, 2_357_028],
  'CE': [ 3_807_891, 1_634_477],
  'DF': [   729_295, 1_041_331],
  'ES': [   926_767, 1_282_145],
  'GO': [ 1_542_115, 2_193_041],
  'MA': [ 2_668_425, 1_082_749],
  'MG': [ 6_190_960, 6_141_310],
  'MS': [   599_547,   880_606],
  'MT': [   652_786, 1_216_730],
  'PA': [ 2_509_084, 2_073_895],
  'PB': [ 1_601_953,   802_502],
  'PE': [ 3_640_933, 1_798_832],
  'PI': [ 1_551_383,   467_065],
  'PR': [ 2_506_605, 4_159_343],
  'RJ': [ 4_156_217, 5_403_894],
  'RN': [ 1_326_785,   711_381],
  'RO': [   262_904,   633_236],
  'RR': [    67_128,   213_518],
  'RS': [ 2_891_851, 3_733_185],
  'SC': [ 1_351_918, 3_047_630],
  'SE': [   862_951,   421_086],
  'SP': [11_519_882,14_216_587],
  'TO': [   434_593,   411_654],
};

export const BRAZIL_2022_R2: Record<string, Record<BrCandidateId, number>> =
  Object.fromEntries(
    Object.entries(RAW).map(([code, [lul, bol]]) => [
      code,
      { LUL: lul, BOL: bol } as Record<BrCandidateId, number>,
    ])
  );

export const STATE_2022R2_TOTALS: Record<string, number> = Object.fromEntries(
  Object.entries(RAW).map(([code, arr]) => [code, arr.reduce((s, v) => s + v, 0)])
);
