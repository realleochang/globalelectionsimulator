/**
 * Merges 3 England constituency GeoJSON files (high-res, ~180 MB) into a single
 * simplified uk-constituencies.geojson, enriched with GSS codes and combined with
 * Scotland/Wales/NI from the existing uk-constituencies.topo.json.
 *
 * Run once: node scripts/merge-boundaries.mjs
 * Output:   public/uk-constituencies.geojson
 */

import { readFileSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as topojsonClient from 'topojson-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dirname, '..');
const DOWNLOADS  = 'C:/Users/leoc4/Downloads';

const SOUTH    = join(DOWNLOADS, '2024_constituencies___england__south_.geojson');
const MIDLANDS = join(DOWNLOADS, '2024_constituencies___england__midlands_.geojson');
const NORTH    = join(DOWNLOADS, '2024_constituenies___england__north_.geojson');
const TMP      = join(ROOT, 'tmp_england_simplified.geojson');
const OUT      = join(ROOT, 'public/uk-constituencies.geojson');

// ── Step 1: merge + simplify the 3 England GeoJSONs via mapshaper API ──────
console.log('Step 1: simplifying England GeoJSONs with mapshaper (3% vertices)…');
const { default: mapshaper } = await import('mapshaper');

// Use file paths (quoted) + combine-files + merge-layers to get a single output
const mapshaperCmd = [
  `-i "${SOUTH}" "${MIDLANDS}" "${NORTH}" combine-files`,
  `-merge-layers`,
  `-simplify 3% weighted`,
  `-o format=geojson england.geojson`,
].join(' ');

const mapshaperOutput = await new Promise((resolve, reject) => {
  mapshaper.applyCommands(mapshaperCmd, {}, (err, out) => err ? reject(err) : resolve(out));
});

writeFileSync(TMP, mapshaperOutput['england.geojson']);
const tmpSize = statSync(TMP).size;
console.log(`  → simplified England: ${(tmpSize / 1024 / 1024).toFixed(1)} MB`);

// ── Step 2: enrich England features with GSS codes ─────────────────────────
console.log('Step 2: matching constituency names to GSS codes…');
const englandGeo = JSON.parse(readFileSync(TMP, 'utf8'));
const constituencies = JSON.parse(readFileSync(join(ROOT, 'public/constituencies.json'), 'utf8'));
const engData = constituencies.filter(c => c.id.startsWith('E'));

function expand(s) {
  return s
    .replace(/Newcastle-upon-Tyne/gi, 'Newcastle upon Tyne')
    .replace(/\bHull\b/g, 'Kingston upon Hull')
    .replace(/&/g, 'and')
    .replace(/\bNE\b/g, 'North East').replace(/\bNW\b/g, 'North West')
    .replace(/\bSE\b/g, 'South East').replace(/\bSW\b/g, 'South West')
    .replace(/\bN\b/g, 'North').replace(/\bS\b/g, 'South')
    .replace(/\bE\b/g, 'East').replace(/\bW\b/g, 'West')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function wordSet(s) {
  return new Set(expand(s).split(/[\s,]+/).filter(w => w && !['and', 'the', 'of', 'upon'].includes(w)));
}

function wordOverlap(a, b) {
  const wa = wordSet(a), wb = wordSet(b);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size);
}

const nameMap  = new Map(engData.map(c => [c.name.toLowerCase(), c.id]));
const normMap  = new Map(engData.map(c => [expand(c.name), c.id]));

let matched = 0, fuzzy = 0, missed = 0;
const englandFeatures = englandGeo.features.map(f => {
  const geoName = f.properties.Name;
  let id = nameMap.get(geoName.toLowerCase()) ?? normMap.get(expand(geoName));

  if (!id) {
    let best = null, bestScore = 0;
    for (const c of engData) {
      const score = wordOverlap(geoName, c.name);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best && bestScore >= 0.75) { id = best.id; fuzzy++; }
    else { console.warn(`  UNMATCHED: "${geoName}" → best: "${best?.name}" (${bestScore.toFixed(2)})`); missed++; }
  } else {
    matched++;
  }

  return { ...f, properties: { gssCode: id ?? '', name: geoName } };
});

console.log(`  → England: ${matched} exact, ${fuzzy} fuzzy, ${missed} unmatched of ${englandFeatures.length}`);

// ── Step 3: extract Scotland / Wales / NI from existing TopoJSON ───────────
console.log('Step 3: extracting Scotland/Wales/NI from existing TopoJSON…');
const topoRaw = JSON.parse(readFileSync(join(ROOT, 'public/uk-constituencies.topo.json'), 'utf8'));
const topoObj = Object.values(topoRaw.objects)[0];
const allGeo  = topojsonClient.feature(topoRaw, topoObj);

const nonEngland = allGeo.features
  .filter(f => !f.properties?.PCON24CD?.startsWith('E'))
  .map(f => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      gssCode: f.properties.PCON24CD ?? '',
      name:    f.properties.PCON24NM ?? '',
    },
  }));
console.log(`  → Non-England: ${nonEngland.length} features`);

// ── Step 4: combine and write ──────────────────────────────────────────────
console.log('Step 4: writing combined GeoJSON…');
const combined = {
  type: 'FeatureCollection',
  features: [...englandFeatures, ...nonEngland],
};
writeFileSync(OUT, JSON.stringify(combined));
const outSize = statSync(OUT).size;
console.log(`  → Written: ${OUT}`);
console.log(`  → File size: ${(outSize / 1024 / 1024).toFixed(1)} MB`);

// Clean up temp file
unlinkSync(TMP);
console.log('Done!');
