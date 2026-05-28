/**
 * One-shot: add Spain's boundary to public/world-countries-precise.geojson so the
 * 2D home-page map can highlight it. Spain (ISO numeric 724) is extracted from the
 * 50m world topojson that the globe already uses. Run: node scripts/add-spain-boundary.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as topojson from 'topojson-client';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOPO = join(ROOT, 'public/world-countries-50m.json');
const GEO  = join(ROOT, 'public/world-countries-precise.geojson');

const topo = JSON.parse(readFileSync(TOPO, 'utf8'));
const geo  = JSON.parse(readFileSync(GEO, 'utf8'));

const geom = topo.objects.countries.geometries.find(g => String(g.id) === '724');
if (!geom) throw new Error('Spain (724) not found in 50m topojson');

const spainFeat = topojson.feature(topo, geom); // single Feature
const feature = {
  type: 'Feature',
  properties: { ISO_A2_EH: 'ES', ISO_A2: 'ES', ISO_A3: 'ESP', ADMIN: 'Spain', NAME: 'Spain' },
  geometry: spainFeat.geometry,
};

const already = geo.features.some(f => (f.properties?.ISO_A2_EH ?? f.properties?.ISO_A2) === 'ES');
if (already) {
  console.log('Spain already present — nothing to do.');
} else {
  geo.features.push(feature);
  writeFileSync(GEO, JSON.stringify(geo));
  console.log(`Added Spain. Features: ${geo.features.length}. Geometry type: ${feature.geometry.type}.`);
}
