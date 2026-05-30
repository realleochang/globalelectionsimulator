import type { ArCandidateId } from './argentinaCandidates';

// Official 2023 Argentine general election — presidential RUNOFF / balotaje (19 November 2023) by province.
// Source: Dirección Nacional Electoral, via the en.wikipedia "Results by province, second round" table.
// Only Milei (MIL) and Massa (MAS) contested the runoff.  Column order: [MIL, MAS]
const RAW: Record<string, [number, number]> = {
  BA: [4801185, 4949734],   // Buenos Aires
  DF: [1038310,  775356],   // CABA
  CT: [ 125325,  111994],   // Catamarca
  CC: [ 357106,  359789],   // Chaco
  CH: [ 197835,  137057],   // Chubut
  CB: [1639102,  574313],   // Córdoba
  CN: [ 366228,  322694],   // Corrientes
  ER: [ 529318,  331763],   // Entre Ríos
  FM: [ 154306,  202288],   // Formosa
  JY: [ 258754,  186315],   // Jujuy
  LP: [ 126794,   94546],   // La Pampa
  LR: [ 126357,  108817],   // La Rioja
  MZ: [ 784109,  317656],   // Mendoza
  MN: [ 405460,  309355],   // Misiones
  NQ: [ 254613,  166700],   // Neuquén
  RN: [ 236796,  199969],   // Río Negro
  SA: [ 461685,  338925],   // Salta
  SJ: [ 277621,  179706],   // San Juan
  SL: [ 214938,  101232],   // San Luis
  SC: [ 104531,   75706],   // Santa Cruz
  SF: [1282012,  758396],   // Santa Fe
  SE: [ 198805,  432433],   // Santiago del Estero
  TF: [  55975,   48998],   // Tierra del Fuego
  TM: [ 557395,  514978],   // Tucumán
};

export const ARGENTINA_2023_R2: Record<string, Partial<Record<ArCandidateId, number>>> =
  Object.fromEntries(
    Object.entries(RAW).map(([code, [mil, mas]]) => [
      code,
      { MIL: mil, MAS: mas } as Partial<Record<ArCandidateId, number>>,
    ])
  );

export const PROV_2023R2_TOTALS: Record<string, number> = Object.fromEntries(
  Object.entries(RAW).map(([code, arr]) => [code, arr.reduce((s, v) => s + v, 0)])
);
