/**
 * Fetches 2024 Camera Deputatilor results for all 42 Romanian counties
 * from the rezultatevot.ro API (election ID 93) and outputs the
 * RO_COUNTY_RESULTS_2024 block for RomaniaApp.tsx.
 *
 * Run with: node fetch_romania_counties.js
 */

const https = require('https');

// The 7 parties we track in the simulator
const TRACKED = ['PSD', 'AUR', 'PNL', 'USR', 'SOS', 'POT', 'UDMR'];

// API county IDs → our 2-letter codes used in RomaniaApp.tsx
const COUNTY_MAP = [
  [10,  'AB'], [29,  'AR'], [38,  'AG'], [47,  'BC'], [56,  'BH'],
  [65,  'BN'], [74,  'BT'], [92,  'BR'], [83,  'BV'], [403, 'B' ],
  [109, 'BZ'], [519, 'CL'], [118, 'CS'], [127, 'CJ'], [136, 'CT'],
  [145, 'CV'], [154, 'DB'], [163, 'DJ'], [172, 'GL'], [528, 'GR'],
  [181, 'GJ'], [190, 'HR'], [207, 'HD'], [216, 'IL'], [225, 'IS'],
  [234, 'IF'], [243, 'MM'], [252, 'MH'], [261, 'MS'], [270, 'NT'],
  [289, 'OT'], [298, 'PH'], [314, 'SJ'], [305, 'SM'], [323, 'SB'],
  [332, 'SV'], [341, 'TR'], [350, 'TM'], [369, 'TL'], [387, 'VL'],
  [378, 'VS'], [396, 'VN'],
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error for ${url}: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const results = {};
  const validVotes = {};

  for (const [apiId, code] of COUNTY_MAP) {
    const url = `https://rezultatevot.ro/api/v1/93/result/national/${apiId}`;
    process.stderr.write(`Fetching ${code} (id=${apiId})... `);

    let data;
    try {
      data = await fetchJson(url);
    } catch (e) {
      process.stderr.write(`ERROR: ${e.message}\n`);
      continue;
    }

    const totalValid = data.votes_valid || 0;
    validVotes[code] = totalValid;

    // Build vote map from candidates array
    const voteMap = {};
    for (const c of (data.candidates || [])) {
      if (c.votes > 0) voteMap[c.name] = c.votes;
    }

    // Calculate percentages for tracked parties
    const pcts = {};
    for (const party of TRACKED) {
      const v = voteMap[party] || 0;
      pcts[party] = totalValid > 0 ? parseFloat(((v / totalValid) * 100).toFixed(2)) : 0;
    }

    results[code] = pcts;
    process.stderr.write(`OK (${totalValid.toLocaleString()} valid votes)\n`);

    await sleep(120); // be polite to the API
  }

  // Output the TypeScript block
  console.log('// ── Real 2024 Camera Deputatilor results by county ──────────────────────────');
  console.log('// Source: rezultatevot.ro API (election ID 93), fetched May 2026');
  console.log('// Percentages = party votes / total valid votes in county × 100');
  console.log('const RO_COUNTY_RESULTS_2024: Record<string, Partial<Record<RoPartyId, number>>> = {');

  for (const [, code] of COUNTY_MAP) {
    if (!results[code]) continue;
    const p = results[code];
    const parts = TRACKED
      .filter(id => p[id] > 0)
      .map(id => `${id}:${p[id].toFixed(2)}`);
    console.log(`  ${code.padEnd(3)}: { ${parts.join(', ')} }, // ${(validVotes[code]||0).toLocaleString()} valid votes`);
  }

  console.log('};');

  // Also output the valid votes map
  console.log('');
  console.log('const RO_COUNTY_VALID_VOTES_2024: Record<string, number> = {');
  for (const [, code] of COUNTY_MAP) {
    if (!validVotes[code]) continue;
    console.log(`  ${code.padEnd(3)}: ${validVotes[code]},`);
  }
  console.log('};');
}

main().catch(e => { console.error(e); process.exit(1); });
