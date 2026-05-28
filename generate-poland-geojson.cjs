// generate-poland-geojson.cjs
// Downloads powiaty-min.geojson, assigns every powiat to its Sejm constituency,
// then uses TopoJSON topology to DISSOLVE shared internal borders — so each
// constituency is a single clean polygon with no interior powiat lines.
//
// Dependencies: topojson-server, topojson-client (already in devDependencies)
// Run: node generate-poland-geojson.cjs

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const topo   = require('topojson-server');
const client = require('topojson-client');

// ─── Constituency meta ────────────────────────────────────────────────────────
const CONST_META = {
   1: { name:'Legnica',             seats:12 },
   2: { name:'Wałbrzych',           seats: 8 },
   3: { name:'Wrocław',             seats:14 },
   4: { name:'Bydgoszcz',           seats:12 },
   5: { name:'Toruń',               seats:13 },
   6: { name:'Lublin',              seats:15 },
   7: { name:'Chełm',               seats:12 },
   8: { name:'Zielona Góra',        seats:12 },
   9: { name:'Łódź',                seats:10 },
  10: { name:'Piotrków Tryb.',      seats: 9 },
  11: { name:'Sieradz',             seats:12 },
  12: { name:'Kraków I',            seats: 8 },
  13: { name:'Kraków II',           seats:14 },
  14: { name:'Nowy Sącz',           seats:10 },
  15: { name:'Tarnów',              seats: 9 },
  16: { name:'Płock',               seats:10 },
  17: { name:'Radom',               seats: 9 },
  18: { name:'Siedlce',             seats:12 },
  19: { name:'Warszawa I',          seats:20 },
  20: { name:'Warszawa II',         seats:12 },
  21: { name:'Opole',               seats:12 },
  22: { name:'Krosno',              seats:11 },
  23: { name:'Rzeszów',             seats:15 },
  24: { name:'Białystok',           seats:14 },
  25: { name:'Gdańsk',              seats:12 },
  26: { name:'Słupsk',              seats:14 },
  27: { name:'Bielsko-Biała',       seats: 9 },
  28: { name:'Częstochowa',         seats: 7 },
  29: { name:'Katowice I',          seats: 9 },
  30: { name:'Rybnik',              seats: 9 },
  31: { name:'Katowice II',         seats:12 },
  32: { name:'Sosnowiec',           seats: 9 },
  33: { name:'Kielce',              seats:16 },
  34: { name:'Elbląg',              seats: 8 },
  35: { name:'Olsztyn',             seats:10 },
  36: { name:'Kalisz',              seats:12 },
  37: { name:'Konin',               seats: 9 },
  38: { name:'Piła',                seats: 9 },
  39: { name:'Poznań',              seats:10 },
  40: { name:'Koszalin',            seats: 8 },
  41: { name:'Szczecin',            seats:12 },
};

// ─── Powiat name → constituency lookup ───────────────────────────────────────
// Keys are the text after "powiat " in the GeoJSON `nazwa` field.
// Sources: all 41 Wikipedia "Sejm Constituency no. N" articles + PKW 2023.
const NAME_MAP = {
  // C1 Legnica
  'Jelenia Góra':1,'Legnica':1,'bolesławiecki':1,'głogowski':1,'górowski':3,
  'jaworski':1,'kamiennogórski':1,'jeleniogórski':1,'karkonoski':1,
  'legnicki':1,'lubański':1,'lubiński':1,'lwówecki':1,
  'polkowicki':1,'zgorzelecki':1,'złotoryjski':1,
  // C2 Wałbrzych
  'Wałbrzych':2,'dzierżoniowski':2,'kłodzki':2,'świdnicki':2,'wałbrzyski':2,'ząbkowicki':2,
  // C3 Wrocław
  'Wrocław':3,'milicki':3,'oleśnicki':3,'oławski':3,'strzeliński':3,
  'trzebnicki':3,'wołowski':3,'wrocławski':3,
  // C4 Bydgoszcz
  'Bydgoszcz':4,'bydgoski':4,'inowrocławski':4,'mogileński':4,'nakielski':4,
  'sępoleński':4,'świecki':4,'tucholski':4,'żniński':4,
  // C5 Toruń
  'Toruń':5,'Grudziądz':5,'Włocławek':5,'aleksandrowski':5,'brodnicki':5,
  'chełmiński':5,'golubsko-dobrzyński':5,'grudziądzki':5,'lipnowski':5,
  'radziejowski':5,'rypiński':5,'toruński':5,'wąbrzeski':5,'włocławski':5,
  // C6 Lublin
  'Lublin':6,'janowski':6,'kraśnicki':6,'łęczyński':6,'lubartowski':6,
  'lubelski':6,'łukowski':6,'puławski':6,'rycki':6,
  // C7 Chełm
  'Biała Podlaska':7,'Chełm':7,'Zamość':7,'bialski':7,'biłgorajski':7,
  'chełmski':7,'hrubieszowski':7,'krasnostawski':7,'parczewski':7,
  'radzyński':7,'włodawski':7,'zamojski':7,
  // C8 Zielona Góra
  'Gorzów Wielkopolski':8,'Zielona Góra':8,'gorzowski':8,'międzyrzecki':8,
  'nowosolski':8,'słubicki':8,'strzelecko-drezdenecki':8,'sulęciński':8,
  'świebodziński':8,'wschowski':8,'żagański':8,'żarski':8,'zielonogórski':8,
  // C9 Łódź
  'Łódź':9,'brzeziński':9,'łódzki wschodni':9,
  // C10 Piotrków
  'Piotrków Trybunalski':10,'Skierniewice':10,'bełchatowski':10,'opoczyński':10,
  'piotrkowski':10,'radomszczański':10,'rawski':10,'skierniewicki':10,
  // C11 Sieradz
  'kutnowski':11,'łaski':11,'łęczycki':11,'łowicki':11,'pabianicki':11,
  'pajęczański':11,'poddębicki':11,'sieradzki':11,'wieluński':11,
  'wieruszowski':11,'zduńskowolski':11,'zgierski':11,
  // C12 Kraków I (western Małopolska, no Kraków city)
  'chrzanowski':12,'myślenicki':12,'oświęcimski':12,'suski':12,'wadowicki':12,
  // C13 Kraków II
  'Kraków':13,'krakowski':13,'miechowski':13,'olkuski':13,
  // C14 Nowy Sącz
  'Nowy Sącz':14,'gorlicki':14,'limanowski':14,'nowosądecki':14,'nowotarski':14,'tatrzański':14,
  // C15 Tarnów
  'Tarnów':15,'bocheński':15,'dąbrowski':15,'proszowicki':15,'tarnowski':15,'wielicki':15,
  // C16 Płock
  'Płock':16,'ciechanowski':16,'gostyniński':16,'mławski':16,'płocki':16,
  'płoński':16,'przasnyski':16,'sierpecki':16,'sochaczewski':16,'żuromiński':16,'żyrardowski':16,
  // C17 Radom
  'Radom':17,'białobrzeski':17,'grójecki':17,'kozienicki':17,'lipski':17,
  'przysuski':17,'radomski':17,'szydłowiecki':17,'zwoleński':17,
  // C18 Siedlce
  'Ostrołęka':18,'Siedlce':18,'garwoliński':18,'łosicki':18,'makowski':18,
  'miński':18,'ostrołęcki':18,'pułtuski':18,'siedlecki':18,
  'sokołowski':18,'węgrowski':18,'wyszkowski':18,
  // C19 Warszawa I
  'Warszawa':19,
  // C20 Warszawa II
  'legionowski':20,'nowodworski':20,'otwocki':20,'piaseczyński':20,
  'pruszkowski':20,'wołomiński':20,'warszawski zachodni':20,
  // C21 Opole (whole voivodeship)
  'Opole':21,'głubczycki':21,'kędzierzyńsko-kozielski':21,'kluczborski':21,
  'krapkowicki':21,'namysłowski':21,'nyski':21,'oleski':21,'opolski':21,
  'prudnicki':21,'strzelecki':21,
  // C22 Krosno
  'Krosno':22,'Przemyśl':22,'bieszczadzki':22,'brzozowski':22,'jarosławski':22,
  'jasielski':22,'leski':22,'lubaczowski':22,'przemyski':22,'przeworski':22,'sanocki':22,
  // C23 Rzeszów
  'Rzeszów':23,'Tarnobrzeg':23,'dębicki':23,'kolbuszowski':23,'leżajski':23,
  'łańcucki':23,'mielecki':23,'niżański':23,'ropczycko-sędziszowski':23,
  'rzeszowski':23,'stalowowolski':23,'strzyżowski':23,'tarnobrzeski':23,
  // C24 Białystok (whole Podlaskie)
  'Białystok':24,'Łomża':24,'Suwałki':24,'augustowski':24,'białostocki':24,
  'grajewski':24,'hajnowski':24,'kolneński':24,'łomżyński':24,'moniecki':24,
  'sejneński':24,'siemiatycki':24,'sokólski':24,'suwalski':24,
  'wysokomazowiecki':24,'zambrowski':24,
  // C25 Gdańsk
  'Gdańsk':25,'Sopot':25,'gdański':25,'kwidzyński':25,'malborski':25,
  'starogardzki':25,'sztumski':25,'tczewski':25,
  // C26 Słupsk
  'Gdynia':26,'Słupsk':26,'bytowski':26,'chojnicki':26,'człuchowski':26,
  'kartuski':26,'kościerski':26,'lęborski':26,'pucki':26,'słupski':26,'wejherowski':26,
  // C27 Bielsko-Biała
  'Bielsko-Biała':27,'cieszyński':27,'pszczyński':27,'żywiecki':27,
  // C28 Częstochowa
  'Częstochowa':28,'częstochowski':28,'kłobucki':28,'lubliniecki':28,'myszkowski':28,
  // C29 Katowice I
  'Bytom':29,'Gliwice':29,'Zabrze':29,'gliwicki':29,'tarnogórski':29,
  // C30 Rybnik
  'Jastrzębie-Zdrój':30,'Rybnik':30,'Żory':30,'mikołowski':30,'raciborski':30,'rybnicki':30,'wodzisławski':30,
  // C31 Katowice II
  'Chorzów':31,'Katowice':31,'Mysłowice':31,'Piekary Śląskie':31,'Ruda Śląska':31,
  'Siemianowice Śląskie':31,'Świętochłowice':31,'Tychy':31,'bieruńsko-lędziński':31,
  // C32 Sosnowiec
  'Dąbrowa Górnicza':32,'Jaworzno':32,'Sosnowiec':32,'będziński':32,'zawierciański':32,
  // C33 Kielce (whole Świętokrzyskie)
  'Kielce':33,'buski':33,'jędrzejowski':33,'kazimierski':33,'kielecki':33,
  'konecki':33,'opatowski':33,'ostrowiecki':33,'pińczowski':33,
  'sandomierski':33,'skarżyski':33,'starachowicki':33,'staszowski':33,'włoszczowski':33,
  // C34 Elbląg
  'Elbląg':34,'bartoszycki':34,'braniewski':34,'działdowski':34,'elbląski':34,
  'iławski':34,'lidzbarski':34,'nowomiejski':34,'ostródzki':34,
  // C35 Olsztyn
  'Olsztyn':35,'ełcki':35,'giżycki':35,'gołdapski':35,'kętrzyński':35,
  'mrągowski':35,'nidzicki':35,'olecki':35,'olsztyński':35,'piski':35,'szczycieński':35,'węgorzewski':35,
  // C36 Kalisz
  'Kalisz':36,'Leszno':36,'gostyński':36,'jarociński':36,'kaliski':36,'kępiński':36,
  'kościański':36,'krotoszyński':36,'leszczyński':36,'ostrzeszowski':36,'pleszewski':36,'rawicki':36,
  // C37 Konin
  'Konin':37,'gnieźnieński':37,'kolski':37,'koniński':37,'słupecki':37,
  'śremski':37,'turecki':37,'wrzesiński':37,
  // C38 Piła
  'chodziejski':38,'chodzieski':38,'czarnkowsko-trzcianecki':38,'międzychodzki':38,
  'nowotomyski':38,'obornicki':38,'pilski':38,'szamotulski':38,
  'wągrowiecki':38,'wolsztyński':38,'złotowski':38,
  // C39 Poznań
  'Poznań':39,'poznański':39,
  // C40 Koszalin
  'Koszalin':40,'białogardzki':40,'choszczeński':40,'drawski':40,'kołobrzeski':40,
  'koszaliński':40,'sławieński':40,'szczecinecki':40,'świdwiński':40,'wałecki':40,
  // C41 Szczecin
  'Świnoujście':41,'Szczecin':41,'goleniowski':41,'gryficki':41,'gryfiński':41,
  'kamieński':41,'łobeski':41,'myśliborski':41,'policki':41,'pyrzycki':41,'stargardzki':41,
};

// Disambiguation rules for names that appear in two voivodeships.
// [fragment, threshold, if_below, if_above, axis='lon']
const DISAMBIG = [
  ['grodziski',    18.5,  38, 20],        // Wlkp.(lon≈16.4)→C38 vs Maz.(lon≈20.6)→C20
  ['średzki',      17.0,   3, 37],        // DL Środa Śl.(lon≈16.6)→C3 vs Wlkp.(lon≈17.3)→C37
  ['brzeski',      50.5,  15, 21, 'lat'], // Brzesko Małop.(lat≈49.9)→C15 vs Brzeg Opolskie→C21
  ['tomaszowski',  50.9,   7, 10, 'lat'], // Lub.(lat≈50.4)→C7 vs Łódź(lat≈51.5)→C10
  ['bielski',      51.5,  27, 24, 'lat'], // Śląskie(lat≈49.9)→C27 vs Podlaskie(lat≈52.7)→C24
  ['krośnieński',  19.0,   8, 22],        // Lubuskie(lon≈15.1)→C8 vs Podkarpackie(lon≈21.7)→C22
  ['ostrowski',    52.2,  36, 18, 'lat'], // Wlkp.(lat≈51.7)→C36 vs Maz.(lat≈52.8)→C18
  ['opolski',      20.0,  21,  6],        // Opole(lon≈17.9)→C21 vs Opole Lub.(lon≈21.9)→C6
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function centroid(geometry) {
  const pts = [];
  function collect(a) {
    if (!Array.isArray(a) || !a.length) return;
    if (typeof a[0] === 'number') { pts.push(a); return; }
    a.forEach(collect);
  }
  collect(geometry.coordinates);
  if (!pts.length) return [0, 0];
  return [
    pts.reduce((s, c) => s + c[0], 0) / pts.length,
    pts.reduce((s, c) => s + c[1], 0) / pts.length,
  ];
}

function assignConstituency(nazwa, [lon, lat]) {
  const key = nazwa.replace(/^powiat\s+/i, '').trim();
  if (NAME_MAP[key] !== undefined) return NAME_MAP[key];
  for (const [frag, thr, below, above, axis = 'lon'] of DISAMBIG) {
    if (key.toLowerCase().startsWith(frag.toLowerCase())) {
      return (axis === 'lat' ? lat : lon) < thr ? below : above;
    }
  }
  return null;
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Downloading powiaty-min.geojson…');
  const raw = await fetchUrl('https://raw.githubusercontent.com/ppatrzyk/polska-geojson/master/powiaty/powiaty-min.geojson');
  const src = JSON.parse(raw);
  console.log(`Loaded ${src.features.length} powiat features.`);

  // Tag each powiat with its constituency number
  const unmatched = [];
  for (const f of src.features) {
    const cen = centroid(f.geometry);
    const nr  = assignConstituency(f.properties.nazwa, cen);
    if (!nr) { unmatched.push(f.properties.nazwa); f.properties._const = 0; }
    else f.properties._const = nr;
  }
  if (unmatched.length) console.warn('⚠  Unmatched:', unmatched.join(', '));

  // Build topology — TopoJSON shares arc segments between adjacent powiats
  const topology = topo.topology({ powiaty: src });

  // Dissolve: for each constituency, merge all powiats sharing the same _const value.
  // topojson-client.merge() removes all internal arcs between features with the same key.
  const outFeatures = Object.entries(CONST_META).map(([nr, meta]) => {
    const id       = +nr;
    const matching = topology.objects.powiaty.geometries.filter(g => g.properties._const === id);
    if (!matching.length) { console.warn(`⚠  C${nr} has no powiats`); return null; }

    // Create a sub-collection topology object
    const subTopo  = { ...topology, objects: { sub: { type: 'GeometryCollection', geometries: matching } } };
    const merged   = client.merge(subTopo, matching);

    return {
      type:       'Feature',
      properties: { id: String(nr), nr: id, name: meta.name, seats: meta.seats },
      geometry:   merged,
    };
  }).filter(Boolean);

  const geojson = { type: 'FeatureCollection', features: outFeatures };
  const outPath = path.join(__dirname, 'public', 'poland-constituencies.geojson');
  fs.writeFileSync(outPath, JSON.stringify(geojson));
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`✓  Wrote ${outFeatures.length} dissolved constituencies → ${outPath} (${kb} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
