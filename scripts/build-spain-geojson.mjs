// Downloads GADM Spain level-2 provinces and adds our province ID to each feature.
import { writeFileSync } from 'fs';

const URL = 'https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_ESP_2.json';
const OUT  = 'C:\\Users\\leoc4\\projects\\my-custom-election-simulator\\public\\spain-provinces.geojson';

// Map GADM NAME_2 → our EsProvId (handles Galician/Basque/Catalan official names used by GADM)
const NAME_TO_ID = {
  'Almería':   'ALMERIA',   'Cádiz':    'CADIZ',       'Córdoba':  'CORDOBA',
  'Granada':   'GRANADA',   'Huelva':   'HUELVA',      'Jaén':     'JAEN',
  'Málaga':    'MALAGA',    'Sevilla':  'SEVILLA',
  'Huesca':    'HUESCA',    'Teruel':   'TERUEL',       'Zaragoza': 'ZARAGOZA',
  'Asturias':  'ASTURIAS',
  'Baleares':  'BALEARES',  'Illes Balears': 'BALEARES',
  // Basque Country — GADM uses Spanish names at level 2
  'Álava':     'ALAVA',     'Araba/Álava': 'ALAVA',     'Araba': 'ALAVA',
  'Guipúzcoa': 'GUIPUZCOA', 'Gipuzkoa':   'GUIPUZCOA',
  'Vizcaya':   'VIZCAYA',   'Bizkaia':    'VIZCAYA',
  // Canary Islands
  'Las Palmas':             'LAS_PALMAS',
  'Santa Cruz de Tenerife': 'TENERIFE',
  'Cantabria': 'CANTABRIA',
  // Castilla-La Mancha
  'Albacete':    'ALBACETE', 'Ciudad Real': 'CIUDAD_REAL', 'Cuenca': 'CUENCA',
  'Guadalajara': 'GUADALAJARA', 'Toledo': 'TOLEDO',
  // Castilla y León
  'Ávila':     'AVILA',     'Burgos':    'BURGOS',    'León':      'LEON',
  'Palencia':  'PALENCIA',  'Salamanca': 'SALAMANCA', 'Segovia':   'SEGOVIA',
  'Soria':     'SORIA',     'Valladolid':'VALLADOLID','Zamora':    'ZAMORA',
  // Catalonia
  'Barcelona': 'BARCELONA', 'Girona':    'GIRONA',    'Lleida':    'LLEIDA',
  'Tarragona': 'TARRAGONA',
  // Extremadura
  'Badajoz':   'BADAJOZ',   'Cáceres':   'CACERES',
  // Galicia — GADM uses Galician names
  'A Coruña':  'CORUNA',    'La Coruña': 'CORUNA',
  'Lugo':      'LUGO',      'Ourense':   'OURENSE',   'Orense': 'OURENSE',
  'Pontevedra':'PONTEVEDRA',
  'CiudadReal':          'CIUDAD_REAL',
  'ACoruña':             'CORUNA',
  'LasPalmas':           'LAS_PALMAS',
  'SantaCruzdeTenerife': 'TENERIFE',
  'LaRioja':             'RIOJA',
  // Others
  'La Rioja':  'RIOJA',     'Rioja': 'RIOJA',
  'Madrid':    'MADRID',
  'Murcia':    'MURCIA',
  'Navarra':   'NAVARRA',   'Navarra/Nafarroa': 'NAVARRA',
  // Valencian Community
  'Alicante':  'ALICANTE',  'Alicante/Alacant': 'ALICANTE',
  'Castellón': 'CASTELLON', 'Castellón/Castelló': 'CASTELLON', 'Castelló': 'CASTELLON',
  'Valencia':  'VALENCIA',  'Valencia/València': 'VALENCIA',
  // Autonomous cities
  'Ceuta':     'CEUTA',
  'Melilla':   'MELILLA',
};

console.log('Downloading GADM Spain provinces...');
const resp = await fetch(URL);
if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
const geojson = await resp.json();
console.log(`Downloaded — ${geojson.features.length} features`);

let mapped = 0, skipped = [];
for (const feat of geojson.features) {
  const name2 = feat.properties?.NAME_2 ?? '';
  const id = NAME_TO_ID[name2];
  if (id) {
    feat.properties.id = id;
    mapped++;
  } else {
    skipped.push(name2);
  }
}

if (skipped.length) console.warn('UNMAPPED provinces:', skipped);
console.log(`Mapped ${mapped}/52 provinces`);

writeFileSync(OUT, JSON.stringify(geojson), 'utf8');
console.log(`Written to ${OUT}`);
