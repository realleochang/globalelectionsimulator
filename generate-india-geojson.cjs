// generate-india-geojson.cjs
// Downloads the datamaps India GeoJSON, maps features to our 36 state/UT format,
// adds election seat data, and writes public/india-states.geojson.
//
// Run: node generate-india-geojson.cjs

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── State meta: id → { name, seats, province } ───────────────────────────────
const STATE_META = {
  AN: { name: 'Andaman & Nicobar Islands', seats: 1,  province: 'Union Territory' },
  AP: { name: 'Andhra Pradesh',            seats: 25, province: 'South India' },
  AR: { name: 'Arunachal Pradesh',         seats: 2,  province: 'Northeast India' },
  AS: { name: 'Assam',                     seats: 14, province: 'Northeast India' },
  BR: { name: 'Bihar',                     seats: 40, province: 'East India' },
  CH: { name: 'Chandigarh',               seats: 1,  province: 'Union Territory' },
  CG: { name: 'Chhattisgarh',             seats: 11, province: 'Central India' },
  DD: { name: 'Dadra & NH / Daman & Diu', seats: 2,  province: 'Union Territory' },
  DL: { name: 'Delhi',                     seats: 7,  province: 'Union Territory' },
  GA: { name: 'Goa',                       seats: 2,  province: 'West India' },
  GJ: { name: 'Gujarat',                   seats: 26, province: 'West India' },
  HR: { name: 'Haryana',                   seats: 10, province: 'North India' },
  HP: { name: 'Himachal Pradesh',          seats: 4,  province: 'North India' },
  JK: { name: 'Jammu & Kashmir',           seats: 5,  province: 'North India' },
  JH: { name: 'Jharkhand',                 seats: 14, province: 'East India' },
  KA: { name: 'Karnataka',                 seats: 28, province: 'South India' },
  KL: { name: 'Kerala',                    seats: 20, province: 'South India' },
  LA: { name: 'Ladakh',                    seats: 1,  province: 'Union Territory' },
  LD: { name: 'Lakshadweep',               seats: 1,  province: 'Union Territory' },
  MP: { name: 'Madhya Pradesh',            seats: 29, province: 'Central India' },
  MH: { name: 'Maharashtra',               seats: 48, province: 'West India' },
  MN: { name: 'Manipur',                   seats: 2,  province: 'Northeast India' },
  ML: { name: 'Meghalaya',                 seats: 2,  province: 'Northeast India' },
  MZ: { name: 'Mizoram',                   seats: 1,  province: 'Northeast India' },
  NL: { name: 'Nagaland',                  seats: 1,  province: 'Northeast India' },
  OD: { name: 'Odisha',                    seats: 21, province: 'East India' },
  PY: { name: 'Puducherry',               seats: 1,  province: 'Union Territory' },
  PB: { name: 'Punjab',                    seats: 13, province: 'North India' },
  RJ: { name: 'Rajasthan',                 seats: 25, province: 'North India' },
  SK: { name: 'Sikkim',                    seats: 1,  province: 'Northeast India' },
  TN: { name: 'Tamil Nadu',               seats: 39, province: 'South India' },
  TG: { name: 'Telangana',                seats: 17, province: 'South India' },
  TR: { name: 'Tripura',                   seats: 2,  province: 'Northeast India' },
  UP: { name: 'Uttar Pradesh',             seats: 80, province: 'North India' },
  UK: { name: 'Uttarakhand',               seats: 5,  province: 'North India' },
  WB: { name: 'West Bengal',               seats: 42, province: 'East India' },
};

// ── Name → state ID mapping (datamaps uses old/variant names) ────────────────
const NAME_TO_ID = {
  'Andaman and Nicobar': 'AN', 'Andaman And Nicobar': 'AN',
  'Andaman & Nicobar Islands': 'AN', 'Andaman and Nicobar Islands': 'AN',
  'Andhra Pradesh': 'AP',
  'Arunachal Pradesh': 'AR',
  'Assam': 'AS',
  'Bihar': 'BR',
  'Chandigarh': 'CH',
  'Chhattisgarh': 'CG',
  'Dadra and Nagar Haveli': 'DD', 'Dadra And Nagar Haveli': 'DD',
  'Daman and Diu': 'DD', 'Daman And Diu': 'DD',
  'Dadra and Nagar Haveli and Daman and Diu': 'DD',
  'Delhi': 'DL', 'NCT of Delhi': 'DL', 'National Capital Territory of Delhi': 'DL',
  'Goa': 'GA',
  'Gujarat': 'GJ',
  'Haryana': 'HR',
  'Himachal Pradesh': 'HP',
  'Jammu and Kashmir': 'JK', 'Jammu And Kashmir': 'JK', 'Jammu & Kashmir': 'JK',
  'Jharkhand': 'JH',
  'Karnataka': 'KA',
  'Kerala': 'KL',
  'Ladakh': 'LA',
  'Lakshadweep': 'LD',
  'Madhya Pradesh': 'MP',
  'Maharashtra': 'MH',
  'Manipur': 'MN',
  'Meghalaya': 'ML',
  'Mizoram': 'MZ',
  'Nagaland': 'NL',
  'Orissa': 'OD', 'Odisha': 'OD',
  'Pondicherry': 'PY', 'Puducherry': 'PY',
  'Punjab': 'PB',
  'Rajasthan': 'RJ',
  'Sikkim': 'SK',
  'Tamil Nadu': 'TN',
  'Telangana': 'TG',
  'Tripura': 'TR',
  'Uttar Pradesh': 'UP',
  'Uttarakhand': 'UK', 'Uttaranchal': 'UK',
  'West Bengal': 'WB',
};

// ── Approximate simplified polygons for states not in datamaps ───────────────
// Ladakh (split from J&K in 2019): eastern high-altitude region
const LADAKH_POLY = [[
  [76.0, 32.5], [79.0, 32.5], [79.0, 33.5], [80.5, 33.5], [80.5, 34.5],
  [79.5, 35.5], [77.5, 35.5], [76.0, 34.8], [75.0, 33.8], [76.0, 32.5]
]];
// Telangana (split from AP in 2014): northern Deccan plateau
const TELANGANA_POLY = [[
  [77.2, 16.2], [80.0, 16.2], [81.8, 16.8], [81.5, 19.2], [80.5, 19.8],
  [78.5, 19.7], [77.5, 19.5], [77.0, 18.5], [76.8, 17.5], [77.2, 16.2]
]];
// Andaman & Nicobar (islands in Bay of Bengal)
const ANDAMAN_POLY = [[
  [92.2, 13.0], [93.0, 13.0], [93.0, 14.0], [92.8, 14.5], [92.4, 14.5],
  [92.2, 14.0], [92.2, 13.0]
]];
// Lakshadweep (islands in Arabian Sea)
const LAKSHADWEEP_POLY = [[
  [72.5, 10.5], [73.2, 10.5], [73.2, 11.5], [72.8, 12.0], [72.5, 11.5], [72.5, 10.5]
]];
// Chandigarh (tiny UT near Punjab/Haryana border)
const CHANDIGARH_POLY = [[
  [76.7, 30.6], [76.9, 30.6], [76.9, 30.8], [76.7, 30.8], [76.7, 30.6]
]];
// Dadra & NH + Daman & Diu (combined UT, near Gujarat coast)
const DADRA_POLY = [[
  [73.0, 19.8], [73.5, 19.8], [73.5, 20.4], [73.1, 20.4], [73.0, 19.8]
]];
// Puducherry (small UT on east coast of TN)
const PUDUCHERRY_POLY = [[
  [79.7, 11.7], [79.9, 11.7], [79.9, 12.0], [79.7, 12.0], [79.7, 11.7]
]];

const SYNTHETIC_STATES = {
  LA: LADAKH_POLY, TG: TELANGANA_POLY, AN: ANDAMAN_POLY,
  LD: LAKSHADWEEP_POLY, CH: CHANDIGARH_POLY, DD: DADRA_POLY, PY: PUDUCHERRY_POLY,
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('Downloading India states GeoJSON from datamaps...');
  const src = await fetchUrl(
    'https://raw.githubusercontent.com/markmarkoh/datamaps/master/src/js/data/ind.json'
  );

  const seenIds = new Set();
  const features = [];

  for (const f of src.features) {
    const rawName = f.properties?.name ?? '';
    const id = NAME_TO_ID[rawName];
    if (!id || seenIds.has(id)) continue;
    const meta = STATE_META[id];
    if (!meta) continue;
    seenIds.add(id);

    // Andhra Pradesh in old datasets includes Telangana — keep as-is (AP without TG)
    features.push({
      type: 'Feature',
      properties: {
        id, name_en: meta.name, province: meta.province, state: meta.name, seats: meta.seats,
      },
      geometry: f.geometry,
    });
  }

  // Add synthetic states not in datamaps
  for (const [id, coords] of Object.entries(SYNTHETIC_STATES)) {
    if (seenIds.has(id)) continue;
    const meta = STATE_META[id];
    if (!meta) continue;
    seenIds.add(id);
    features.push({
      type: 'Feature',
      properties: { id, name_en: meta.name, province: meta.province, state: meta.name, seats: meta.seats },
      geometry: { type: 'Polygon', coordinates: coords },
    });
  }

  const missing = Object.keys(STATE_META).filter(id => !seenIds.has(id));
  if (missing.length) console.warn('⚠ Missing states:', missing.join(', '));

  const geojson = { type: 'FeatureCollection', features };
  const outPath = path.join(__dirname, 'public', 'india-states.geojson');
  fs.writeFileSync(outPath, JSON.stringify(geojson));
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`✓ Wrote ${features.length} state features → ${outPath} (${kb} KB)`);
  console.log('States covered:', [...seenIds].sort().join(', '));
}

main().catch(e => { console.error(e); process.exit(1); });
