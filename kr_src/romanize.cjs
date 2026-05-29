// Romanize the proper Korean constituency names -> readable English (Revised Romanization).
// Writes kr_src/romanized.json = { SGG_Code: "English Name" } so gen_data.cjs can bake it in.
const fs = require('fs');
const a = require('aromanize');
const districts = require('./districts.json');

const SUF = { '갑': 'A', '을': 'B', '병': 'C', '정': 'D', '무': 'E' };
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

function rom(kor) {
  let base = kor.trim();
  let suf = '';
  const m = base.match(/\s?([갑을병정무])$/);
  if (m) { suf = SUF[m[1]]; base = base.slice(0, m.index).trim(); }
  const parts = base.split(/[·\s]+/).filter(Boolean);
  const rp = parts.map(p => {
    let q = p.replace(/[구시군]$/, ''); // drop administrative suffix (구/시/군)
    if (!q) q = p;
    return cap(a.hangulToLatin(q, 'rr'));
  });
  let out = rp.join('-');
  if (suf) out += ' ' + suf;
  return out;
}

const map = {};
for (const d of districts) map[d.code] = rom(d.name);
fs.writeFileSync(__dirname + '/romanized.json', JSON.stringify(map), 'utf8');

console.log('romanized', Object.keys(map).length, 'districts');
console.log('--- samples ---');
for (const d of districts.slice(0, 10)) console.log(' ', d.name, '->', map[d.code]);
console.log('--- combined (·) samples ---');
let n = 0;
for (const d of districts) if (d.name.includes('·') && n++ < 8) console.log(' ', d.name, '->', map[d.code]);
