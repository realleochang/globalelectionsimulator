// generate-japan-geojson.cjs
// Downloads the datamaps Japan GeoJSON, maps prefectures to our 47-unit format,
// and writes public/japan-prefectures.geojson
// Run: node generate-japan-geojson.cjs

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Prefecture meta: id → { name, nameJa, region, seats } ──────────────────
// seats = total Lok Sabha seats (SMD + PR share) for 2024 election
const PREF_META = {
  '01':{ name:'Hokkaido',    nameJa:'北海道',    region:'Hokkaido',   seats:20 },
  '02':{ name:'Aomori',      nameJa:'青森県',    region:'Tohoku',     seats:4  },
  '03':{ name:'Iwate',       nameJa:'岩手県',    region:'Tohoku',     seats:4  },
  '04':{ name:'Miyagi',      nameJa:'宮城県',    region:'Tohoku',     seats:9  },
  '05':{ name:'Akita',       nameJa:'秋田県',    region:'Tohoku',     seats:3  },
  '06':{ name:'Yamagata',    nameJa:'山形県',    region:'Tohoku',     seats:4  },
  '07':{ name:'Fukushima',   nameJa:'福島県',    region:'Tohoku',     seats:7  },
  '08':{ name:'Ibaraki',     nameJa:'茨城県',    region:'Kanto',      seats:11 },
  '09':{ name:'Tochigi',     nameJa:'栃木県',    region:'Kanto',      seats:7  },
  '10':{ name:'Gunma',       nameJa:'群馬県',    region:'Kanto',      seats:6  },
  '11':{ name:'Saitama',     nameJa:'埼玉県',    region:'Kanto',      seats:25 },
  '12':{ name:'Chiba',       nameJa:'千葉県',    region:'Kanto',      seats:21 },
  '13':{ name:'Tokyo',       nameJa:'東京都',    region:'Tokyo',      seats:47 },
  '14':{ name:'Kanagawa',    nameJa:'神奈川県',  region:'Kanto',      seats:30 },
  '15':{ name:'Niigata',     nameJa:'新潟県',    region:'Chubu',      seats:9  },
  '16':{ name:'Toyama',      nameJa:'富山県',    region:'Chubu',      seats:4  },
  '17':{ name:'Ishikawa',    nameJa:'石川県',    region:'Chubu',      seats:4  },
  '18':{ name:'Fukui',       nameJa:'福井県',    region:'Chubu',      seats:3  },
  '19':{ name:'Yamanashi',   nameJa:'山梨県',    region:'Kanto',      seats:3  },
  '20':{ name:'Nagano',      nameJa:'長野県',    region:'Chubu',      seats:8  },
  '21':{ name:'Gifu',        nameJa:'岐阜県',    region:'Chubu',      seats:7  },
  '22':{ name:'Shizuoka',    nameJa:'静岡県',    region:'Chubu',      seats:13 },
  '23':{ name:'Aichi',       nameJa:'愛知県',    region:'Chubu',      seats:26 },
  '24':{ name:'Mie',         nameJa:'三重県',    region:'Kansai',     seats:6  },
  '25':{ name:'Shiga',       nameJa:'滋賀県',    region:'Kansai',     seats:6  },
  '26':{ name:'Kyoto',       nameJa:'京都府',    region:'Kansai',     seats:11 },
  '27':{ name:'Osaka',       nameJa:'大阪府',    region:'Kansai',     seats:34 },
  '28':{ name:'Hyogo',       nameJa:'兵庫県',    region:'Kansai',     seats:19 },
  '29':{ name:'Nara',        nameJa:'奈良県',    region:'Kansai',     seats:6  },
  '30':{ name:'Wakayama',    nameJa:'和歌山県',  region:'Kansai',     seats:3  },
  '31':{ name:'Tottori',     nameJa:'鳥取県',    region:'Chugoku',    seats:3  },
  '32':{ name:'Shimane',     nameJa:'島根県',    region:'Chugoku',    seats:3  },
  '33':{ name:'Okayama',     nameJa:'岡山県',    region:'Chugoku',    seats:7  },
  '34':{ name:'Hiroshima',   nameJa:'広島県',    region:'Chugoku',    seats:11 },
  '35':{ name:'Yamaguchi',   nameJa:'山口県',    region:'Chugoku',    seats:6  },
  '36':{ name:'Tokushima',   nameJa:'徳島県',    region:'Shikoku',    seats:3  },
  '37':{ name:'Kagawa',      nameJa:'香川県',    region:'Shikoku',    seats:4  },
  '38':{ name:'Ehime',       nameJa:'愛媛県',    region:'Shikoku',    seats:5  },
  '39':{ name:'Kochi',       nameJa:'高知県',    region:'Shikoku',    seats:3  },
  '40':{ name:'Fukuoka',     nameJa:'福岡県',    region:'Kyushu',     seats:21 },
  '41':{ name:'Saga',        nameJa:'佐賀県',    region:'Kyushu',     seats:3  },
  '42':{ name:'Nagasaki',    nameJa:'長崎県',    region:'Kyushu',     seats:6  },
  '43':{ name:'Kumamoto',    nameJa:'熊本県',    region:'Kyushu',     seats:8  },
  '44':{ name:'Oita',        nameJa:'大分県',    region:'Kyushu',     seats:5  },
  '45':{ name:'Miyazaki',    nameJa:'宮崎県',    region:'Kyushu',     seats:4  },
  '46':{ name:'Kagoshima',   nameJa:'鹿児島県',  region:'Kyushu',     seats:7  },
  '47':{ name:'Okinawa',     nameJa:'沖縄県',    region:'Okinawa',    seats:6  },
};

// ── datamaps English name → prefecture ID ──────────────────────────────────
const NAME_TO_ID = {
  'Hokkaido':'01', 'Aomori':'02', 'Iwate':'03', 'Miyagi':'04', 'Akita':'05',
  'Yamagata':'06', 'Fukushima':'07', 'Ibaraki':'08', 'Tochigi':'09', 'Gunma':'10',
  'Gumma':'10', 'Saitama':'11', 'Chiba':'12', 'Tokyo':'13', 'Tokyo Metropolitan':'13',
  'Kanagawa':'14', 'Niigata':'15', 'Toyama':'16', 'Ishikawa':'17', 'Fukui':'18',
  'Yamanashi':'19', 'Nagano':'20', 'Gifu':'21', 'Shizuoka':'22', 'Aichi':'23',
  'Mie':'24', 'Shiga':'25', 'Kyoto':'26', 'Osaka':'27', 'Hyogo':'28',
  'Hyōgo':'28', 'Nara':'29', 'Wakayama':'30', 'Tottori':'31', 'Shimane':'32', 'Okayama':'33',
  'Hiroshima':'34', 'Yamaguchi':'35', 'Tokushima':'36', 'Kagawa':'37', 'Ehime':'38',
  'Kochi':'39', 'Fukuoka':'40', 'Saga':'41', 'Nagasaki':'42', 'Kumamoto':'43',
  'Oita':'44', 'Miyazaki':'45', 'Kagoshima':'46', 'Okinawa':'47',
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
  console.log('Downloading Japan prefectures GeoJSON from datamaps...');
  const src = await fetchUrl(
    'https://raw.githubusercontent.com/markmarkoh/datamaps/master/src/js/data/jpn.json'
  );

  const seenIds = new Set();
  const features = [];

  for (const f of src.features) {
    const rawName = f.properties?.name ?? '';
    const id = NAME_TO_ID[rawName];
    if (!id || seenIds.has(id)) continue;
    const meta = PREF_META[id];
    if (!meta) continue;
    seenIds.add(id);
    features.push({
      type: 'Feature',
      properties: {
        id, name_en: meta.name, name_ja: meta.nameJa,
        province: meta.region, state: meta.name, seats: meta.seats,
      },
      geometry: f.geometry,
    });
  }

  const missing = Object.keys(PREF_META).filter(id => !seenIds.has(id));
  if (missing.length) console.warn('⚠ Missing prefectures:', missing.map(id => PREF_META[id].name).join(', '));

  const geojson = { type: 'FeatureCollection', features };
  const outPath = path.join(__dirname, 'public', 'japan-prefectures.geojson');
  fs.writeFileSync(outPath, JSON.stringify(geojson));
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`✓ Wrote ${features.length} prefecture features → ${outPath} (${kb} KB)`);

  // Verify total seats
  const totalSeats = features.reduce((s, f) => s + f.properties.seats, 0);
  console.log(`Total seats across prefectures: ${totalSeats} (target: 465)`);
  console.log('Prefectures:', [...seenIds].sort().join(', '));
}

main().catch(e => { console.error(e); process.exit(1); });
