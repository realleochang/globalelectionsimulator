import type { ArCandidateId } from './argentinaCandidates';

// Official 2023 Argentine general election — presidential FIRST ROUND (22 October 2023) by province.
// Source: Dirección Nacional Electoral, via the en.wikipedia "Results by province, first round" table.
// Province codes = ISO-style HASC suffixes matching public/argentina-provinces.geojson.
// Column order: MAS (Massa), MIL (Milei), BUL (Bullrich), SCH (Schiaretti), BRE (Bregman)
const IDS: ArCandidateId[] = ['MAS', 'MIL', 'BUL', 'SCH', 'BRE'];

const RAW: Record<string, number[]> = {
  BA: [4327441, 2593075, 2423384, 373087, 359538],   // Buenos Aires
  DF: [ 616182,  382488,  789454,  58788,  67666],   // CABA
  CT: [ 104322,   78017,   41719,  15677,   3841],   // Catamarca
  CC: [ 313941,  200006,  173253,  26059,   5637],   // Chaco
  CH: [ 111752,  121842,   71343,  26722,  15187],   // Chubut
  CB: [ 309044,  773428,  521310, 667447,  31922],   // Córdoba
  CN: [ 262170,  189282,  226371,  19215,   7464],   // Corrientes
  ER: [ 283136,  252719,  255236,  45540,  13248],   // Entre Ríos
  FM: [ 189593,  105330,   55738,   8843,   2954],   // Formosa
  JY: [ 148103,  170966,   91373,  31063,  16193],   // Jujuy
  LP: [  80611,   77493,   50640,  17195,   5292],   // La Pampa
  LR: [  98739,   90328,   28314,  20416,   2219],   // La Rioja
  MZ: [ 269326,  475272,  289533,  48472,  38932],   // Mendoza
  MN: [ 277836,  309077,  105384,  30036,  10228],   // Misiones
  NQ: [ 135881,  157187,   87952,  25438,  21356],   // Neuquén
  RN: [ 168235,  150079,   80591,  27782,  17847],   // Río Negro
  SA: [ 304880,  323105,  110702,  49587,  14014],   // Salta
  SJ: [ 155794,  164117,  108547,  28879,  10455],   // San Juan
  SL: [  88235,  139894,   67517,  20159,   7055],   // San Luis
  SC: [  67336,   64687,   29234,  11757,   5161],   // Santa Cruz
  SF: [ 607088,  664607,  549363, 184337,  38550],   // Santa Fe
  SE: [ 416597,  144659,   50749,  13489,   7912],   // Santiago del Estero
  TF: [  40889,   36202,   16043,   9767,   4137],   // Tierra del Fuego
  TM: [ 476361,  371130,  155273,  42313,  15253],   // Tucumán
};

// No separate overseas row — the 24 jurisdictions above sum to the national totals.
export const OVERSEAS_TERRITORIES: { code: string; nom: string }[] = [];

export const ARGENTINA_2023_R1: Record<string, Record<ArCandidateId, number>> =
  Object.fromEntries(
    Object.entries(RAW).map(([code, arr]) => [
      code,
      Object.fromEntries(IDS.map((id, k) => [id, arr[k]])) as Record<ArCandidateId, number>,
    ])
  );

export const PROV_2023R1_TOTALS: Record<string, number> = Object.fromEntries(
  Object.entries(RAW).map(([code, arr]) => [code, arr.reduce((s, v) => s + v, 0)])
);
