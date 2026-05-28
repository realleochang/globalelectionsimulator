/**
 * Verification harness for the Spain 2023 baseline (23-J Congreso).
 * Data transcribed from the official Wikipedia constituency summary supplied by the user.
 * Checks:
 *   1. Sum of district magnitudes === 350.
 *   2. Column sums of official seats === national totals.
 *   3. D'Hondt(3%) on each province's modelled vote %s reproduces the official seats.
 * Run: node scripts/verify-spain-2023.mjs
 */

// party order incl. UPN
const PARTIES = ['PP','PSOE','VOX','SUMAR','ERC','JUNTS','EH_BILDU','PNV','BNG','CC','UPN'];

const NATIONAL = { PP:137, PSOE:121, VOX:33, SUMAR:31, ERC:7, JUNTS:7, EH_BILDU:6, PNV:5, BNG:1, CC:1, UPN:1 };

// [id]: { mag, v:{party:%}, s:{party:officialSeats} }
const P = {
  CORUNA:    { mag:8,  v:{PP:43.1,PSOE:28.2,VOX:5.1, SUMAR:12.2,BNG:10.0}, s:{PP:4,PSOE:2,SUMAR:1,BNG:1} },
  ALAVA:     { mag:4,  v:{PP:17.9,PSOE:27.7,VOX:3.9, SUMAR:12.7,EH_BILDU:19.5,PNV:16.6}, s:{PP:1,PSOE:1,EH_BILDU:1,PNV:1} },
  ALBACETE:  { mag:4,  v:{PP:39.9,PSOE:34.5,VOX:16.6,SUMAR:7.2}, s:{PP:2,PSOE:2} },
  ALICANTE:  { mag:12, v:{PP:36.7,PSOE:32.0,VOX:16.3,SUMAR:12.9}, s:{PP:5,PSOE:4,VOX:2,SUMAR:1} },
  ALMERIA:   { mag:6,  v:{PP:41.0,PSOE:29.0,VOX:21.4,SUMAR:6.6}, s:{PP:3,PSOE:2,VOX:1} },
  ASTURIAS:  { mag:7,  v:{PP:35.6,PSOE:34.3,VOX:12.5,SUMAR:14.8}, s:{PP:3,PSOE:2,VOX:1,SUMAR:1} },
  AVILA:     { mag:3,  v:{PP:43.3,PSOE:27.4,VOX:15.4,SUMAR:5.1}, s:{PP:2,PSOE:1} },
  BADAJOZ:   { mag:5,  v:{PP:37.8,PSOE:39.2,VOX:13.7,SUMAR:6.8}, s:{PP:2,PSOE:2,VOX:1} },
  BALEARES:  { mag:8,  v:{PP:35.6,PSOE:30.2,VOX:15.2,SUMAR:16.6}, s:{PP:3,PSOE:3,VOX:1,SUMAR:1} },
  BARCELONA: { mag:32, v:{PP:13.8,PSOE:35.7,VOX:7.6, SUMAR:15.2,ERC:12.3,JUNTS:9.7}, s:{PP:5,PSOE:13,VOX:2,SUMAR:5,ERC:4,JUNTS:3} },
  VIZCAYA:   { mag:8,  v:{PP:11.5,PSOE:25.8,VOX:2.6, SUMAR:10.9,EH_BILDU:20.7,PNV:27.0}, s:{PP:1,PSOE:2,SUMAR:1,EH_BILDU:2,PNV:2} },
  BURGOS:    { mag:4,  v:{PP:40.6,PSOE:34.4,VOX:12.8,SUMAR:8.6}, s:{PP:2,PSOE:2} },
  CACERES:   { mag:4,  v:{PP:38.1,PSOE:38.9,VOX:13.6,SUMAR:6.9}, s:{PP:2,PSOE:2} },
  CADIZ:     { mag:9,  v:{PP:34.8,PSOE:33.2,VOX:15.2,SUMAR:12.9}, s:{PP:4,PSOE:3,VOX:1,SUMAR:1} },
  CANTABRIA: { mag:5,  v:{PP:42.1,PSOE:33.3,VOX:14.1,SUMAR:8.5}, s:{PP:2,PSOE:2,VOX:1} },
  CASTELLON: { mag:5,  v:{PP:35.2,PSOE:32.6,VOX:15.9,SUMAR:14.3}, s:{PP:2,PSOE:2,VOX:1} },
  CEUTA:     { mag:1,  v:{PP:38.8,PSOE:34.0,VOX:23.3,SUMAR:2.5}, s:{PP:1} },
  CIUDAD_REAL:{mag:5,  v:{PP:40.5,PSOE:35.4,VOX:16.3,SUMAR:6.2}, s:{PP:2,PSOE:2,VOX:1} },
  CORDOBA:   { mag:6,  v:{PP:37.9,PSOE:32.1,VOX:13.9,SUMAR:13.7}, s:{PP:2,PSOE:2,VOX:1,SUMAR:1} },
  CUENCA:    { mag:3,  v:{PP:39.8,PSOE:37.4,VOX:15.6,SUMAR:5.6}, s:{PP:2,PSOE:1} },
  GUIPUZCOA: { mag:6,  v:{PP:8.7, PSOE:23.3,VOX:2.1, SUMAR:10.6,EH_BILDU:31.2,PNV:22.6}, s:{PSOE:2,EH_BILDU:2,PNV:2} },
  GIRONA:    { mag:6,  v:{PP:9.7, PSOE:28.9,VOX:7.0, SUMAR:10.9,ERC:14.7,JUNTS:19.6}, s:{PSOE:2,SUMAR:1,ERC:1,JUNTS:2} },
  GRANADA:   { mag:7,  v:{PP:37.0,PSOE:33.0,VOX:16.1,SUMAR:11.6}, s:{PP:3,PSOE:2,VOX:1,SUMAR:1} },
  GUADALAJARA:{mag:3,  v:{PP:36.3,PSOE:33.0,VOX:19.3,SUMAR:9.2}, s:{PP:1,PSOE:1,VOX:1} },
  HUELVA:    { mag:5,  v:{PP:36.4,PSOE:36.0,VOX:14.6,SUMAR:10.4}, s:{PP:2,PSOE:2,VOX:1} },
  HUESCA:    { mag:3,  v:{PP:38.2,PSOE:33.6,VOX:12.6,SUMAR:11.5}, s:{PP:2,PSOE:1} },
  JAEN:      { mag:5,  v:{PP:37.3,PSOE:36.3,VOX:14.8,SUMAR:8.0}, s:{PP:2,PSOE:2,VOX:1} },
  RIOJA:     { mag:4,  v:{PP:45.6,PSOE:35.7,VOX:9.8, SUMAR:6.6}, s:{PP:2,PSOE:2} },
  LAS_PALMAS:{ mag:8,  v:{PP:25.9,PSOE:33.2,VOX:14.6,SUMAR:10.3,CC:6.3}, s:{PP:3,PSOE:3,VOX:1,SUMAR:1} },
  LEON:      { mag:4,  v:{PP:36.9,PSOE:33.6,VOX:12.9,SUMAR:6.7}, s:{PP:2,PSOE:2} },
  LLEIDA:    { mag:4,  v:{PP:12.8,PSOE:29.5,VOX:6.8, SUMAR:7.9, ERC:18.6,JUNTS:18.0}, s:{PSOE:2,ERC:1,JUNTS:1} },
  LUGO:      { mag:4,  v:{PP:50.2,PSOE:30.3,VOX:4.4, SUMAR:5.2, BNG:8.7}, s:{PP:3,PSOE:1} },
  MADRID:    { mag:37, v:{PP:40.5,PSOE:27.8,VOX:14.0,SUMAR:15.5}, s:{PP:16,PSOE:10,VOX:5,SUMAR:6} },
  MALAGA:    { mag:11, v:{PP:38.3,PSOE:30.3,VOX:16.5,SUMAR:12.3}, s:{PP:5,PSOE:3,VOX:2,SUMAR:1} },
  MELILLA:   { mag:1,  v:{PP:49.2,PSOE:25.4,VOX:15.9,SUMAR:3.0}, s:{PP:1} },
  MURCIA:    { mag:10, v:{PP:41.2,PSOE:25.3,VOX:21.8,SUMAR:9.6}, s:{PP:4,PSOE:3,VOX:2,SUMAR:1} },
  NAVARRA:   { mag:5,  v:{PP:16.7,PSOE:27.4,VOX:5.7, SUMAR:12.8,EH_BILDU:17.2,UPN:15.3}, s:{PP:1,PSOE:2,EH_BILDU:1,UPN:1} },
  OURENSE:   { mag:4,  v:{PP:50.0,PSOE:30.1,VOX:4.9, SUMAR:5.5, BNG:8.2}, s:{PP:3,PSOE:1} },
  PALENCIA:  { mag:3,  v:{PP:42.0,PSOE:34.7,VOX:12.9,SUMAR:6.1}, s:{PP:2,PSOE:1} },
  PONTEVEDRA:{ mag:7,  v:{PP:39.6,PSOE:31.4,VOX:4.7, SUMAR:13.2,BNG:9.4}, s:{PP:3,PSOE:3,SUMAR:1} },
  SALAMANCA: { mag:4,  v:{PP:47.0,PSOE:30.4,VOX:14.7,SUMAR:5.5}, s:{PP:3,PSOE:1} },
  TENERIFE:  { mag:7,  v:{PP:35.4,PSOE:33.5,VOX:7.7, SUMAR:10.8,CC:16.7}, s:{PP:3,PSOE:3,CC:1} },
  SEGOVIA:   { mag:3,  v:{PP:45.0,PSOE:30.6,VOX:14.1,SUMAR:8.1}, s:{PP:2,PSOE:1} },
  SEVILLA:   { mag:12, v:{PP:33.4,PSOE:36.6,VOX:13.3,SUMAR:14.0}, s:{PP:4,PSOE:5,VOX:1,SUMAR:2} },
  SORIA:     { mag:2,  v:{PP:37.2,PSOE:29.5,VOX:9.8, SUMAR:3.4}, s:{PP:1,PSOE:1} },
  TARRAGONA: { mag:6,  v:{PP:13.9,PSOE:32.9,VOX:10.3,SUMAR:11.3,ERC:15.1,JUNTS:11.1}, s:{PP:1,PSOE:2,SUMAR:1,ERC:1,JUNTS:1} },
  TERUEL:    { mag:3,  v:{PP:35.0,PSOE:29.3,VOX:13.1,SUMAR:5.4}, s:{PP:2,PSOE:1} },
  TOLEDO:    { mag:6,  v:{PP:37.8,PSOE:32.6,VOX:19.6,SUMAR:8.2}, s:{PP:3,PSOE:2,VOX:1} },
  VALENCIA:  { mag:16, v:{PP:33.6,PSOE:32.1,VOX:15.2,SUMAR:16.9}, s:{PP:6,PSOE:5,VOX:2,SUMAR:3} },
  VALLADOLID:{ mag:5,  v:{PP:40.8,PSOE:32.8,VOX:15.2,SUMAR:8.9}, s:{PP:2,PSOE:2,VOX:1} },
  ZAMORA:    { mag:3,  v:{PP:44.8,PSOE:32.5,VOX:13.2,SUMAR:5.6}, s:{PP:2,PSOE:1} },
  ZARAGOZA:  { mag:7,  v:{PP:36.0,PSOE:30.8,VOX:15.3,SUMAR:13.5}, s:{PP:3,PSOE:2,VOX:1,SUMAR:1} },
};

function dhondt(votesPct, mag, thr=3.0) {
  const total = Object.values(votesPct).reduce((s,v)=>s+v,0);
  const qual = Object.entries(votesPct).filter(([,v])=>v/total*100>=thr && v>0);
  const q = [];
  for (const [id,v] of qual) for (let d=1; d<=mag; d++) q.push({id,q:v/d});
  q.sort((a,b)=>b.q-a.q);
  const r = {};
  for (let i=0;i<Math.min(mag,q.length);i++) r[q[i].id]=(r[q[i].id]||0)+1;
  return r;
}

let magSum=0, fail=0;
const colSum = Object.fromEntries(PARTIES.map(p=>[p,0]));
for (const [id,prov] of Object.entries(P)) {
  magSum += prov.mag;
  const offSum = Object.values(prov.s).reduce((s,v)=>s+v,0);
  if (offSum !== prov.mag) { console.log(`✗ ${id}: official seats ${offSum} ≠ magnitude ${prov.mag}`); fail++; }
  for (const [pty,s] of Object.entries(prov.s)) colSum[pty]+=s;
  // normalize modelled %s to 100, run D'Hondt
  const tot=Object.values(prov.v).reduce((s,v)=>s+v,0);
  const norm=Object.fromEntries(Object.entries(prov.v).map(([k,v])=>[k,v/tot*100]));
  const got=dhondt(norm,prov.mag);
  const exp=prov.s;
  const keys=new Set([...Object.keys(got),...Object.keys(exp)]);
  let mismatch=false;
  for (const k of keys) if ((got[k]||0)!==(exp[k]||0)) mismatch=true;
  if (mismatch) { console.log(`✗ ${id} D'Hondt: got ${JSON.stringify(got)} exp ${JSON.stringify(exp)}`); fail++; }
}

console.log(`\nProvinces: ${Object.keys(P).length}  |  magnitude sum: ${magSum} (expect 350)`);
console.log('Column sums vs national:');
for (const p of PARTIES) {
  const ok = colSum[p]===NATIONAL[p];
  console.log(`  ${ok?'✓':'✗'} ${p}: ${colSum[p]} (official ${NATIONAL[p]})`);
  if(!ok) fail++;
}
console.log(`\n${fail===0?'✅ ALL CHECKS PASSED':`❌ ${fail} failure(s)`}`);
