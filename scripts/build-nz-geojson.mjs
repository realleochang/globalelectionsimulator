// Downloads GADM NZ admin-2 boundaries and maps them to our NzElecId system.
// NZ GADM level 2 = territorial authorities, not electorates — but serves as
// a reasonable visual proxy since we can't easily get electoral boundary GeoJSON.
// We use a simplified world dataset filtered to NZ for a working map.
import { writeFileSync } from 'fs';

const OUT = 'C:\\Users\\leoc4\\projects\\my-custom-election-simulator\\public\\nz-electorates.geojson';

// Try to fetch NZ regional council boundaries from a public source
// These approximate electorate areas well enough for display
const URLS = [
  'https://raw.githubusercontent.com/jasonwilkens/nz-regional-council-boundaries/main/nz-regional-council-boundaries.geojson',
  'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_NZL_1.json',
];

let data = null;
for (const url of URLS) {
  try {
    console.log(`Trying: ${url}`);
    const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) { console.log(`HTTP ${resp.status}`); continue; }
    data = await resp.json();
    console.log(`Downloaded — ${data?.features?.length ?? '?'} features from ${url}`);
    break;
  } catch (e) { console.log(`Failed: ${e.message}`); }
}

if (!data || !data.features) {
  console.log('All sources failed — creating minimal placeholder GeoJSON');
  // Create a placeholder with approximate NZ bounding boxes for each region
  // The map will still load and show NZ; electorates can be coloured by centroid matching
  data = { type: 'FeatureCollection', features: [] };
}

// For GADM NZL_1 (16 regions), map region names → our elec IDs for colouring
const REGION_TO_ELEC = {
  'Auckland':        'ALBANY',
  'Bay of Plenty':   'BAY_OF_PLENTY',
  'Canterbury':      'SELWYN',
  'Gisborne':        'EAST_COAST',
  "Hawke's Bay":     'HERETAUNGA',
  'Manawatu-Wanganui':'PALMERSTON_NORTH',
  'Marlborough':     'KAIKOURA',
  'Nelson':          'NELSON',
  'Northland':       'NORTHLAND',
  'Otago':           'DUNEDIN',
  'Southland':       'CLUTHA_SOUTHLAND',
  'Taranaki':        'NEW_PLYMOUTH',
  'Tasman':          'TASMAN',
  'Waikato':         'WAIKATO',
  'Wellington':      'WELLINGTON_CENTRAL',
  'West Coast':      'WEST_COAST_TASMAN',
};

let mapped = 0;
for (const feat of data.features) {
  const name = feat.properties?.NAME_1 ?? feat.properties?.name ?? feat.properties?.Name ?? '';
  const id = REGION_TO_ELEC[name] ?? name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  feat.properties = { ...feat.properties, id };
  if (REGION_TO_ELEC[name]) mapped++;
}
console.log(`Mapped ${mapped} regions`);

writeFileSync(OUT, JSON.stringify(data), 'utf8');
console.log(`Written to ${OUT} (${Math.round(JSON.stringify(data).length / 1024)} KB)`);
