// Parse 17 regional wikitext files into structured per-district results,
// and join each district to its NEC SGG_Code from 22_Elec_SGG.csv.
const fs = require('fs');
const path = require('path');

const REG = path.join(__dirname, 'regions');
const slugToSido = {
  seoul:'서울', busan:'부산', daegu:'대구', incheon:'인천', gwangju:'광주',
  daejeon:'대전', ulsan:'울산', sejong:'세종', gyeonggi:'경기', gangwon:'강원',
  chungbuk:'충북', chungnam:'충남', jeonbuk:'전북', jeonnam:'전남',
  gyeongbuk:'경북', gyeongnam:'경남', jeju:'제주',
};

// ---- load SGG code table ----
const csv = fs.readFileSync(path.join(__dirname, 'sgg.csv'), 'utf8').trim().split(/\r?\n/);
const header = csv.shift();
const sggRows = csv.map(line => {
  const [code, sidoSgg, sido, sgg] = line.split(',');
  return { code: code.trim(), sidoSgg: sidoSgg.trim(), sido: sido.trim(), sgg: sgg.trim() };
});
const sidoSet = [...new Set(sggRows.map(r => r.sido))];
console.log('CSV districts:', sggRows.length, '| SIDO values:', sidoSet.join(' '));

// ---- helpers ----
const cleanName = (s) => s.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').trim(); // [[a|b]]->b, [[a]]->a
const num = (s) => parseInt(String(s).replace(/[^0-9]/g, ''), 10);
const norm = (s) => s.replace(/[·\s（）()]/g, '');
const normNoGu = (s) => norm(s).replace(/[구시군]/g, '');

function field(block, key) {
  const m = block.match(new RegExp('\\|\\s*' + key + '\\s*=\\s*([^|}\\n]+)'));
  return m ? m[1].trim() : null;
}

// ---- parse one region ----
function parseRegion(slug) {
  const txt = fs.readFileSync(path.join(REG, slug + '.wikitext'), 'utf8');
  const districts = [];
  // split into blocks: 시작 ... 끝
  const re = /\{\{선거결과 시작([\s\S]*?)\{\{선거결과 끝\}\}/g;
  let m;
  while ((m = re.exec(txt)) !== null) {
    const block = m[1];
    const startLine = block.split('\n')[0];
    const guRaw = field(startLine, '선거구') || '';
    // strip leading [[region]] from 선거구
    const dName = cleanName(guRaw).replace(/^\S+(특별시|광역시|특별자치시|특별자치도|도)\s*/, '').trim();
    const electorate = num(field(startLine, '유권자') || '0');

    const cands = [];
    const candRe = /\{\{(당선 )?선거결과\/정당명\/막대([^}]*)\}\}/g;
    let cm;
    while ((cm = candRe.exec(block)) !== null) {
      const won = !!cm[1];
      const seg = cm[2];
      // 후보 value can contain a piped wikilink [[X (disambig)|Y]]; capture up to |정당
      const nameRaw = (seg.match(/\|\s*후보\s*=\s*([\s\S]*?)\s*\|\s*정당/) || [])[1] || field(seg, '후보') || '';
      const name = cleanName(nameRaw);
      const party = (field(seg, '정당') || '').trim();
      const votes = num(field(seg, '득표수') || '0');
      const pct = parseFloat(field(seg, '득표율') || '0');
      if (!name || !party) continue;
      cands.push({ name, party, votes, pct, won });
    }
    // totals
    const sumM = block.match(/\{\{선거결과 합계([^}]*)\}\}/);
    const totalValid = sumM ? num(field(sumM[1], '합계') || '0') : cands.reduce((a, c) => a + c.votes, 0);
    const invalid = sumM ? num(field(sumM[1], '무효표') || '0') : 0;

    districts.push({ name: dName, electorate, totalValid, invalid, candidates: cands });
  }
  return districts;
}

// ---- parse all + join ----
const all = [];
const unmatched = [];
let totalDistricts = 0;

for (const [slug, sido] of Object.entries(slugToSido)) {
  const sidoRows = sggRows.filter(r => r.sido === sido);
  const ds = parseRegion(slug);
  totalDistricts += ds.length;
  for (const d of ds) {
    // Sejong's ko.wp names are bare 갑/을; geojson uses 세종갑/세종을
    if (slug === 'sejong' && /^[갑을병정무]$/.test(d.name)) d.name = '세종' + d.name;
    // match within region
    let row = sidoRows.find(r => norm(r.sgg) === norm(d.name));
    if (!row) row = sidoRows.find(r => normNoGu(r.sgg) === normNoGu(d.name));
    if (!row) { unmatched.push({ slug, name: d.name, normd: normNoGu(d.name) }); continue; }
    all.push({ code: row.code, sido, sgg: row.sgg, sidoSgg: row.sidoSgg, ...d });
  }
}

console.log('Parsed districts:', totalDistricts, '| Matched:', all.length, '| Unmatched:', unmatched.length);
if (unmatched.length) {
  console.log('--- UNMATCHED ---');
  for (const u of unmatched) {
    const cands = sggRows.filter(r => r.sido === slugToSido[u.slug]).map(r => r.sgg);
    console.log(u.slug, '|', u.name, '| normNoGu=', u.normd);
  }
}

// distinct parties
const parties = {};
for (const d of all) for (const c of d.candidates) parties[c.party] = (parties[c.party] || 0) + 1;
console.log('--- PARTIES (count of candidacies) ---');
console.log(Object.entries(parties).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}:${n}`).join('  '));

fs.writeFileSync(path.join(__dirname, 'districts.json'), JSON.stringify(all, null, 0), 'utf8');
console.log('Wrote districts.json with', all.length, 'districts');
