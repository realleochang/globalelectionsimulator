// Fetch all 17 regional 22nd-Assembly result pages from ko.wikipedia (action=raw), politely.
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'regions');
fs.mkdirSync(OUT, { recursive: true });

// slug -> ko.wp page title
const REGIONS = {
  seoul:    '대한민국 제22대 국회의원 선거 서울특별시',
  busan:    '대한민국 제22대 국회의원 선거 부산광역시',
  daegu:    '대한민국 제22대 국회의원 선거 대구광역시',
  incheon:  '대한민국 제22대 국회의원 선거 인천광역시',
  gwangju:  '대한민국 제22대 국회의원 선거 광주광역시',
  daejeon:  '대한민국 제22대 국회의원 선거 대전광역시',
  ulsan:    '대한민국 제22대 국회의원 선거 울산광역시',
  sejong:   '대한민국 제22대 국회의원 선거 세종특별자치시',
  gyeonggi: '대한민국 제22대 국회의원 선거 경기도',
  gangwon:  '대한민국 제22대 국회의원 선거 강원특별자치도',
  chungbuk: '대한민국 제22대 국회의원 선거 충청북도',
  chungnam: '대한민국 제22대 국회의원 선거 충청남도',
  jeonbuk:  '대한민국 제22대 국회의원 선거 전북특별자치도',
  jeonnam:  '대한민국 제22대 국회의원 선거 전라남도',
  gyeongbuk:'대한민국 제22대 국회의원 선거 경상북도',
  gyeongnam:'대한민국 제22대 국회의원 선거 경상남도',
  jeju:     '대한민국 제22대 국회의원 선거 제주특별자치도',
};

function fetchRaw(title) {
  const url = 'https://ko.wikipedia.org/w/index.php?title=' + encodeURIComponent(title) + '&action=raw';
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'krsim/1.0 (election sim research; leoc4321@gmail.com)' } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(title + ' -> HTTP ' + res.statusCode)); res.resume(); return; }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const entries = Object.entries(REGIONS);
  for (const [slug, title] of entries) {
    try {
      const txt = await fetchRaw(title);
      fs.writeFileSync(path.join(OUT, slug + '.wikitext'), txt, 'utf8');
      console.log(slug.padEnd(10), txt.length, 'bytes');
    } catch (e) {
      console.log(slug.padEnd(10), 'ERROR', e.message);
    }
    await sleep(1300); // polite delay
  }
  console.log('done');
})();
