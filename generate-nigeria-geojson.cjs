// generate-nigeria-geojson.cjs
// Downloads datamaps Nigeria GeoJSON, maps all 36 states + FCT to our format.
// Run: node generate-nigeria-geojson.cjs

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── State meta ────────────────────────────────────────────────────────────────
const STATE_META = {
  AB: { name:'Abia',          zone:'South-East',    electorate:2318000 },
  AD: { name:'Adamawa',       zone:'North-East',    electorate:2201000 },
  AK: { name:'Akwa Ibom',     zone:'South-South',   electorate:2513000 },
  AN: { name:'Anambra',       zone:'South-East',    electorate:2500000 },
  BA: { name:'Bauchi',        zone:'North-East',    electorate:2375000 },
  BY: { name:'Bayelsa',       zone:'South-South',   electorate:1004000 },
  BE: { name:'Benue',         zone:'North-Central', electorate:2346000 },
  BO: { name:'Borno',         zone:'North-East',    electorate:2237000 },
  CR: { name:'Cross River',   zone:'South-South',   electorate:1793000 },
  DE: { name:'Delta',         zone:'South-South',   electorate:2934000 },
  EB: { name:'Ebonyi',        zone:'South-East',    electorate:1633000 },
  ED: { name:'Edo',           zone:'South-South',   electorate:2567000 },
  EK: { name:'Ekiti',         zone:'South-West',    electorate:1027000 },
  EN: { name:'Enugu',         zone:'South-East',    electorate:2004000 },
  FC: { name:'FCT Abuja',     zone:'North-Central', electorate:2005000 },
  GO: { name:'Gombe',         zone:'North-East',    electorate:1419000 },
  IM: { name:'Imo',           zone:'South-East',    electorate:2268000 },
  JI: { name:'Jigawa',        zone:'North-West',    electorate:2275000 },
  KD: { name:'Kaduna',        zone:'North-West',    electorate:3861000 },
  KN: { name:'Kano',          zone:'North-West',    electorate:5534000 },
  KT: { name:'Katsina',       zone:'North-West',    electorate:3254000 },
  KE: { name:'Kebbi',         zone:'North-West',    electorate:1963000 },
  KO: { name:'Kogi',          zone:'North-Central', electorate:2215000 },
  KW: { name:'Kwara',         zone:'North-Central', electorate:1480000 },
  LA: { name:'Lagos',         zone:'South-West',    electorate:7060000 },
  NA: { name:'Nasarawa',      zone:'North-Central', electorate:1491000 },
  NI: { name:'Niger',         zone:'North-Central', electorate:2362000 },
  OG: { name:'Ogun',          zone:'South-West',    electorate:2395000 },
  ON: { name:'Ondo',          zone:'South-West',    electorate:1764000 },
  OS: { name:'Osun',          zone:'South-West',    electorate:1826000 },
  OY: { name:'Oyo',           zone:'South-West',    electorate:3237000 },
  PL: { name:'Plateau',       zone:'North-Central', electorate:2199000 },
  RI: { name:'Rivers',        zone:'South-South',   electorate:3364000 },
  SO: { name:'Sokoto',        zone:'North-West',    electorate:2198000 },
  TA: { name:'Taraba',        zone:'North-East',    electorate:1768000 },
  YO: { name:'Yobe',          zone:'North-East',    electorate:1647000 },
  ZA: { name:'Zamfara',       zone:'North-West',    electorate:2076000 },
};

// ── datamaps name → our ID ─────────────────────────────────────────────────
const NAME_TO_ID = {
  'Abia':'AB','Adamawa':'AD','Akwa Ibom':'AK','Anambra':'AN',
  'Bauchi':'BA','Bayelsa':'BY','Benue':'BE','Borno':'BO',
  'Cross River':'CR','Delta':'DE','Ebonyi':'EB','Edo':'ED',
  'Ekiti':'EK','Enugu':'EN','Federal Capital Territory':'FC','FCT':'FC','Abuja':'FC',
  'Gombe':'GO','Imo':'IM','Jigawa':'JI','Kaduna':'KD','Kano':'KN',
  'Katsina':'KT','Kebbi':'KE','Kogi':'KO','Kwara':'KW','Lagos':'LA',
  'Nasarawa':'NA','Nassarawa':'NA','Niger':'NI','Ogun':'OG','Ondo':'ON','Osun':'OS',
  'Oyo':'OY','Plateau':'PL','Rivers':'RI','Sokoto':'SO','Taraba':'TA',
  'Yobe':'YO','Zamfara':'ZA',
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
  console.log('Downloading Nigeria states GeoJSON from datamaps...');
  const src = await fetchUrl(
    'https://raw.githubusercontent.com/markmarkoh/datamaps/master/src/js/data/nga.json'
  );

  const seenIds = new Set();
  const features = [];

  for (const f of src.features) {
    const rawName = f.properties?.name ?? '';
    const id = NAME_TO_ID[rawName];
    if (!id || seenIds.has(id)) continue;
    const meta = STATE_META[id];
    if (!meta) { console.warn('No meta for', id, rawName); continue; }
    seenIds.add(id);
    features.push({
      type: 'Feature',
      properties: { id, name_en: meta.name, province: meta.zone, state: meta.name, electorate: meta.electorate },
      geometry: f.geometry,
    });
  }

  const missing = Object.keys(STATE_META).filter(id => !seenIds.has(id));
  if (missing.length) {
    console.warn('⚠ Missing states:', missing.map(id => STATE_META[id].name).join(', '));
    // Add FCT with approximate center polygon if missing
    if (missing.includes('FC')) {
      console.log('Adding FCT synthetic polygon...');
      features.push({
        type: 'Feature',
        properties: { id:'FC', name_en:'FCT Abuja', province:'North-Central', state:'FCT Abuja', electorate:2005000 },
        geometry: { type:'Polygon', coordinates:[[[7.1,8.7],[7.7,8.7],[7.7,9.2],[7.1,9.2],[7.1,8.7]]] },
      });
      seenIds.add('FC');
    }
    if (missing.includes('NA')) {
      console.log('Adding Nasarawa synthetic polygon...');
      features.push({
        type: 'Feature',
        properties: { id:'NA', name_en:'Nasarawa', province:'North-Central', state:'Nasarawa', electorate:1491000 },
        geometry: { type:'Polygon', coordinates:[[[7.8,7.8],[9.0,7.8],[9.0,9.0],[7.8,9.0],[7.8,7.8]]] },
      });
      seenIds.add('NA');
    }
  }

  const geojson = { type: 'FeatureCollection', features };
  const outPath = path.join(__dirname, 'public', 'nigeria-states.geojson');
  fs.writeFileSync(outPath, JSON.stringify(geojson));
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`✓ Wrote ${features.length} state features → ${outPath} (${kb} KB)`);
  console.log('States covered:', [...seenIds].sort().join(', '));
}

main().catch(e => { console.error(e); process.exit(1); });
