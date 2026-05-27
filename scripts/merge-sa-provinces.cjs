// One-time script: merges 52 SA districts → 9 province polygons
// Run: node scripts/merge-sa-provinces.cjs
const fs   = require('fs');
const path = require('path');
const { topology }  = require('topojson-server');
const { merge }     = require('topojson-client');

const DISTRICT_TO_PROV = {
  'City of Johannesburg Metropolitan': 'GP', 'City of Tshwane Metropolitan': 'GP',
  'Ekurhuleni Metropolitan': 'GP', 'West Rand District': 'GP', 'Sedibeng District': 'GP',
  'eThekwini Metropolitan': 'KZN', 'iLembe District': 'KZN', 'uMgungundlovu District': 'KZN',
  'uThungulu District': 'KZN', 'Zululand District': 'KZN', 'Umkhanyakude District': 'KZN',
  'Uthukela District': 'KZN', 'Umzinyathi District': 'KZN', 'Amajuba District': 'KZN',
  'Sisonke District': 'KZN', 'Ugu District': 'KZN',
  'City of Cape Town': 'WC', 'West Coast District': 'WC', 'Cape Winelands District': 'WC',
  'Eden District': 'WC', 'Central Karoo District': 'WC', 'Overberg District': 'WC',
  'Buffalo City Metropolitan': 'EC', 'Nelson Mandela Bay Metropolitan': 'EC',
  'Amathole District': 'EC', 'Chris Hani District': 'EC', 'Joe Gqabi District': 'EC',
  'O.R. Tambo District': 'EC', 'Alfred Nzo District': 'EC', 'Sarah Baartman District': 'EC',
  'Capricorn District': 'LP', 'Vhembe District': 'LP', 'Mopani District': 'LP',
  'Waterberg District': 'LP', 'Sekhukhune District': 'LP',
  'Ehlanzeni District': 'MP', 'Nkangala District': 'MP', 'Gert Sibande District': 'MP',
  'Frances Baard District': 'NC', 'Namakwa District': 'NC', 'Pixley ka Seme District': 'NC',
  'ZF Mgcawu District': 'NC', 'John Taolo Gaetsewe District': 'NC',
  'Bojanala Platinum District': 'NW', 'Dr Kenneth Kaunda District': 'NW',
  'Ngaka Modiri Molema District': 'NW', 'Dr Ruth Segomotsi Mompati District': 'NW',
  'Mangaung Metropolitan': 'FS', 'Lejweleputswa District': 'FS',
  'Thabo Mofutsanyana District': 'FS', 'Fezile Dabi District': 'FS', 'Xhariep District': 'FS',
};

const PROV_NAMES = {
  GP: 'Gauteng', KZN: 'KwaZulu-Natal', WC: 'Western Cape', EC: 'Eastern Cape',
  LP: 'Limpopo', MP: 'Mpumalanga', NC: 'Northern Cape', NW: 'North West', FS: 'Free State',
};

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/south-africa-provinces.geojson'), 'utf8'));

// Tag each district feature with its province ID
const tagged = raw.features.map(f => ({
  ...f,
  properties: { ...f.properties, province_id: DISTRICT_TO_PROV[f.properties.name] || 'UNKNOWN' },
}));

// Build topology from all tagged districts
const topo = topology({ districts: { type: 'FeatureCollection', features: tagged } });
const geoms = topo.objects.districts.geometries;

// Merge by province
const provIds = ['GP', 'KZN', 'WC', 'EC', 'LP', 'MP', 'NC', 'NW', 'FS'];
const features = provIds.map(provId => {
  const matching = geoms.filter(g => g.properties && g.properties.province_id === provId);
  if (!matching.length) { console.warn('No districts for', provId); return null; }
  const merged = merge(topo, matching);
  return { type: 'Feature', properties: { province_id: provId, name: PROV_NAMES[provId] }, geometry: merged };
}).filter(Boolean);

const out = JSON.stringify({ type: 'FeatureCollection', features });
const outPath = path.join(__dirname, '../public/south-africa-province-outlines.geojson');
fs.writeFileSync(outPath, out);
console.log(`Written ${features.length} province polygons to public/south-africa-province-outlines.geojson`);
