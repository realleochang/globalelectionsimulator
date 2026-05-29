// Clean the raw 546-feature India PC geojson into 543 constituencies:
//  - union multi-part features that share (state, pc_no)
//  - fold the null-pc_no "Rann of Kutch" sliver into Gujarat #1 (Kachchh)
//  - drop the 2 blank J&K disputed-area polygons (not constituencies)
//  - key each feature "ST_NAME#pc_no" to join india-results-2024.json
const fs=require('fs');
const pclip=require('polygon-clipping');
const fc=JSON.parse(fs.readFileSync('public/india-constituencies.geojson','utf8'));
const results=require('./public/india-results-2024.json');

const groups={};
let dropped=0;
for(const f of fc.features){
  const p=f.properties;
  let key;
  if(p.pc_no==null || !String(p.pc_name||'').trim()){
    if(p.st_name==='GUJARAT' && /rann of kutch/i.test(p.pc_name||'')) key='GUJARAT#1';
    else { dropped++; continue; }            // blank J&K disputed polygons
  } else key=p.st_name+'#'+p.pc_no;
  const g=groups[key]||(groups[key]={key,feats:[],sample:p});
  g.feats.push(f);
  if(p.pc_no!=null && String(p.pc_name||'').trim()) g.sample=p;
}

const round4=a=>{if(typeof a[0]==='number'){a[0]=Math.round(a[0]*1e4)/1e4;a[1]=Math.round(a[1]*1e4)/1e4;}else a.forEach(round4);};
const out=[];
for(const key in groups){
  const g=groups[key];
  const polys=g.feats.map(f=>f.geometry.coordinates);
  let merged;
  try{ merged = polys.length===1 ? pclip.union(polys[0]) : pclip.union(polys[0], ...polys.slice(1)); }
  catch(e){ console.warn('union failed',key,e.message); merged = g.feats[0].geometry.type==='MultiPolygon'?g.feats[0].geometry.coordinates:[g.feats[0].geometry.coordinates]; }
  merged.forEach(round4);
  const r=results[key];
  out.push({type:'Feature',properties:{
    key, st_name:g.sample.st_name, pc_no:g.sample.pc_no,
    pc_name:(r&&r.pc_name)||g.sample.pc_name,
  }, geometry:{type:'MultiPolygon',coordinates:merged}});
}
const clean={type:'FeatureCollection',features:out};
fs.writeFileSync('public/india-constituencies.geojson', JSON.stringify(clean));
// verify
const keys=new Set(out.map(f=>f.properties.key));
const missingResult=out.filter(f=>!results[f.properties.key]).map(f=>f.properties.key);
const resultNoFeat=Object.keys(results).filter(k=>!keys.has(k));
const kb=(fs.statSync('public/india-constituencies.geojson').size/1024).toFixed(0);
console.log('features:',out.length,'| dropped blanks:',dropped,'| size:',kb,'KB');
console.log('features missing a result:',missingResult.length, missingResult.slice(0,5).join(','));
console.log('results with no feature:',resultNoFeat.length, resultNoFeat.slice(0,5).join(','));
