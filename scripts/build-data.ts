import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

// ---- types ----
type PartyId = 'LAB' | 'CON' | 'LD' | 'RFM' | 'GRN' | 'SNP' | 'PC' |
  'DUP' | 'SF' | 'SDLP' | 'UUP' | 'ALL' | 'TUV' | 'IND' | 'SPK' | 'OTH';

type Constituency = {
  id: string;
  name: string;
  country: 'England' | 'Scotland' | 'Wales' | 'NI';
  region: string;
  electorate: number;
  validVotes: number;
  results2024: Partial<Record<PartyId, number>>;
  winner2024: PartyId;
};

const VALID_PARTY_IDS = new Set<PartyId>([
  'LAB','CON','LD','RFM','GRN','SNP','PC',
  'DUP','SF','SDLP','UUP','ALL','TUV',
  'IND','SPK','OTH'
]);

const RAW_DIR = path.join(process.cwd(), 'data', 'raw');
const SRC_DATA_DIR = path.join(process.cwd(), 'src', 'data');
const PUBLIC_DIR = path.join(process.cwd(), 'public');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function fetchUrl(url: string, redirectCount = 0): Promise<Buffer> {
  if (redirectCount > 10) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
      },
      timeout: 120000
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        const nextUrl = loc.startsWith('http') ? loc : new URL(loc, url).href;
        resolve(fetchUrl(nextUrl, redirectCount + 1));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout for ${url}`)); });
  });
}

// Map from election results portal abbreviations to our PartyId
// Source: electionresults.parliament.uk candidacies.csv "Main party abbreviation" column
const ABBR_TO_PARTY: Record<string, PartyId> = {
  'Lab': 'LAB',
  'Labour': 'LAB',
  'Con': 'CON',
  'Conservative': 'CON',
  'LD': 'LD',
  'Liberal Democrat': 'LD',
  'RUK': 'RFM',
  'Reform UK': 'RFM',
  'Green': 'GRN',
  'Green Party': 'GRN',
  'SNP': 'SNP',
  'Scottish National Party': 'SNP',
  'PC': 'PC',
  'Plaid Cymru': 'PC',
  'DUP': 'DUP',
  'SF': 'SF',
  'SDLP': 'SDLP',
  'UUP': 'UUP',
  'APNI': 'ALL',
  'Alliance': 'ALL',
  'TUV': 'TUV',
};

function detectCountry(gssCode: string): 'England' | 'Scotland' | 'Wales' | 'NI' {
  if (gssCode.startsWith('E14')) return 'England';
  if (gssCode.startsWith('S14')) return 'Scotland';
  if (gssCode.startsWith('W07')) return 'Wales';
  // NI uses N05 in the Parliament election results portal
  if (gssCode.startsWith('N05') || gssCode.startsWith('N06')) return 'NI';
  throw new Error(`Unknown GSS code prefix: ${gssCode}`);
}

// Simple CSV line parser that handles quoted fields correctly
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let inQuote = false;
  let current = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (c === ',' && !inQuote) {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

async function downloadGeoJsonPaginated(baseUrl: string): Promise<any[]> {
  let features: any[] = [];
  let offset = 0;
  const pageSize = 200;
  while (true) {
    const pageUrl = `${baseUrl}&resultOffset=${offset}&resultRecordCount=${pageSize}&f=geojson`;
    console.log(`  Fetching offset ${offset}...`);
    const pageData = await fetchUrl(pageUrl);
    const parsed = JSON.parse(pageData.toString());
    if (!parsed.features || parsed.features.length === 0) break;
    features = features.concat(parsed.features);
    console.log(`  Got ${features.length} features so far...`);
    if (parsed.features.length < pageSize) break;
    offset += pageSize;
  }
  return features;
}

async function main() {
  ensureDir(RAW_DIR);
  ensureDir(SRC_DATA_DIR);
  ensureDir(PUBLIC_DIR);

  // --- Download candidate-level CSV from electionresults.parliament.uk ---
  const csvPath = path.join(RAW_DIR, 'cbp10009-results.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('Downloading 2024 GE candidacies CSV...');
    // Primary: UK Parliament official election results portal
    const csvUrls = [
      'https://electionresults.parliament.uk/general-elections/6/candidacies.csv',
      // fallback: House of Commons Library (may 403)
      'https://researchbriefings.files.parliament.uk/documents/CBP-10009/HoC-GE2024-results-by-constituency.csv',
    ];
    let downloaded = false;
    for (const csvUrl of csvUrls) {
      try {
        console.log(`  Trying: ${csvUrl}`);
        const data = await fetchUrl(csvUrl);
        if (data.length > 10000) {
          fs.writeFileSync(csvPath, data);
          console.log(`Downloaded CSV: ${data.length} bytes`);
          downloaded = true;
          break;
        }
      } catch (e: any) {
        console.log(`  Failed: ${e.message}`);
      }
    }
    if (!downloaded) {
      throw new Error('Could not download CSV. Place file at data/raw/cbp10009-results.csv');
    }
  } else {
    console.log('CSV already cached.');
  }

  // --- Download ONS Boundary GeoJSON ---
  const geoJsonPath = path.join(RAW_DIR, 'constituencies-buc.geojson');
  if (!fs.existsSync(geoJsonPath)) {
    console.log('Downloading ONS BUC boundary GeoJSON...');

    // Try ONS ArcGIS endpoints for July 2024 Westminster constituencies
    const geoBaseUrls = [
      'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BUC/FeatureServer/0/query?where=1%3D1&outFields=PCON24CD,PCON24NM&outSR=4326&geometryPrecision=5',
      'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/PCON_July_2024_Boundaries_UK_BUC/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&geometryPrecision=5',
      'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_July_2024_UK_BUC/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&geometryPrecision=5',
      // Try the 2023 BUC as fallback - same codes as 2024 boundaries
      'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_December_2023_Boundaries_UK_BUC/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&geometryPrecision=5',
    ];

    let features: any[] = [];
    let downloaded = false;

    for (const baseUrl of geoBaseUrls) {
      try {
        console.log(`  Trying: ${baseUrl.slice(0, 80)}...`);
        features = await downloadGeoJsonPaginated(baseUrl);
        if (features.length >= 640) {
          downloaded = true;
          break;
        } else if (features.length > 0) {
          console.log(`  Only got ${features.length} features, trying next...`);
        }
      } catch (e: any) {
        console.log(`  Failed: ${e.message}`);
      }
    }

    if (!downloaded || features.length === 0) {
      throw new Error('Could not download boundary GeoJSON. Please download manually and place at data/raw/constituencies-buc.geojson');
    }

    const geojson = { type: 'FeatureCollection', features };
    fs.writeFileSync(geoJsonPath, JSON.stringify(geojson));
    console.log(`Saved GeoJSON: ${features.length} features`);
  } else {
    console.log('GeoJSON already cached.');
  }

  // --- Parse candidate-level CSV ---
  console.log('\nParsing candidate-level CSV...');
  const csvText = fs.readFileSync(csvPath, 'utf-8').replace(/^﻿/, ''); // strip BOM
  const lines = csvText.split('\n').filter(l => l.trim());

  const header = parseCSVLine(lines[0]);
  console.log(`CSV has ${lines.length - 1} rows, ${header.length} columns`);

  // Column indices (verified against electionresults.parliament.uk/general-elections/6/candidacies.csv)
  // Header: Parliament number,Parliament summoned on,...,Country name,Country geographic code,...,
  //         English region name,...,Constituency name,Constituency geographic code,Constituency designation,...,
  //         Electorate,Election polling date,Election is by-election,...,
  //         Election valid vote count,...,Candidate is standing as Commons Speaker,Candidate is standing as independent,...,
  //         Candidate vote count,...,Candidate result position
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Column not found: "${name}". Available: ${header.slice(0, 20).join(', ')}`);
    return i;
  };

  const COL_COUNTRY_NAME = idx('Country name');
  const COL_COUNTRY_CODE = idx('Country geographic code');
  const COL_REGION = idx('English region name');
  const COL_CONST_NAME = idx('Constituency name');
  const COL_CONST_CODE = idx('Constituency geographic code');
  const COL_ELECTORATE = idx('Electorate');
  const COL_IS_BYELECTION = idx('Election is by-election');
  const COL_VALID_VOTES = idx('Election valid vote count');
  const COL_PARTY_ABBR = idx('Main party abbreviation');
  const COL_IS_SPEAKER = idx('Candidate is standing as Commons Speaker');
  const COL_IS_INDEP = idx('Candidate is standing as independent');
  const COL_IS_NOTIONAL = idx('Candidate is notional political party aggregate');
  const COL_VOTE_COUNT = idx('Candidate vote count');
  const COL_RESULT_POS = idx('Candidate result position');

  console.log('Column indices detected successfully.');

  // --- Build constituency map from candidate rows ---
  const constituencies = new Map<string, Constituency>();

  let byElectionSkipped = 0;
  let notionalSkipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (row.length < 10) continue;

    // Skip by-elections
    if (row[COL_IS_BYELECTION] === 'true') { byElectionSkipped++; continue; }
    // Skip notional aggregate rows
    if (row[COL_IS_NOTIONAL] === 'true') { notionalSkipped++; continue; }

    const gssCode = row[COL_CONST_CODE];
    if (!gssCode || !gssCode.match(/^(E14|S14|W07|N05|N06)/)) continue;

    // Create constituency entry on first encounter
    if (!constituencies.has(gssCode)) {
      let country: 'England' | 'Scotland' | 'Wales' | 'NI';
      try { country = detectCountry(gssCode); }
      catch { continue; }

      // Use country name for NI/Scotland/Wales region field when English region is blank
      const region = row[COL_REGION] || row[COL_COUNTRY_NAME] || '';

      constituencies.set(gssCode, {
        id: gssCode,
        name: row[COL_CONST_NAME],
        country,
        region,
        electorate: parseInt(row[COL_ELECTORATE].replace(/,/g, '')) || 0,
        validVotes: parseInt(row[COL_VALID_VOTES].replace(/,/g, '')) || 0,
        results2024: {},
        winner2024: 'OTH',
      });
    }

    const c = constituencies.get(gssCode)!;
    const partyAbbr = row[COL_PARTY_ABBR];
    const isSpeaker = row[COL_IS_SPEAKER] === 'true';
    const isIndep = row[COL_IS_INDEP] === 'true';
    const voteCount = parseInt(row[COL_VOTE_COUNT].replace(/,/g, '')) || 0;
    const resultPos = parseInt(row[COL_RESULT_POS]) || 999;

    // Map to our PartyId
    let partyId: PartyId;
    if (isSpeaker) {
      partyId = 'SPK';
    } else if (isIndep) {
      partyId = 'IND';
    } else {
      partyId = ABBR_TO_PARTY[partyAbbr] || 'OTH';
    }

    // Accumulate votes (OTH absorbs all minor parties)
    if (voteCount > 0) {
      c.results2024[partyId] = (c.results2024[partyId] || 0) + voteCount;
    }

    // Track winner (position 1)
    if (resultPos === 1) {
      c.winner2024 = partyId;
    }
  }

  console.log(`By-election rows skipped: ${byElectionSkipped}`);
  console.log(`Notional aggregate rows skipped: ${notionalSkipped}`);
  console.log(`Constituencies parsed: ${constituencies.size}`);

  const constitList = [...constituencies.values()];

  // --- Process GeoJSON ---
  console.log('\nProcessing GeoJSON...');
  const geoJsonText = fs.readFileSync(geoJsonPath, 'utf-8');
  const geoJson = JSON.parse(geoJsonText);
  const geoFeatures: any[] = geoJson.features || [];
  console.log(`GeoJSON has ${geoFeatures.length} features`);

  if (geoFeatures.length > 0) {
    const sampleProps = Object.keys(geoFeatures[0].properties || {});
    console.log('Sample feature properties:', sampleProps);
  }

  // Find the GSS code property name
  const gssProps = ['PCON24CD', 'pcon24cd', 'PCON23CD', 'pcon23cd', 'CODE', 'code', 'GSS_CODE', 'gss_code'];
  let gssPropName = '';
  if (geoFeatures.length > 0) {
    const props = geoFeatures[0].properties || {};
    for (const p of gssProps) {
      if (p in props) { gssPropName = p; break; }
    }
  }
  console.log(`Using GSS property: "${gssPropName}"`);

  let matchCount = 0;
  for (const feat of geoFeatures) {
    const gss = feat.properties?.[gssPropName];
    if (gss && constituencies.has(gss)) matchCount++;
  }
  console.log(`Matched ${matchCount} of ${geoFeatures.length} GeoJSON features to CSV data`);

  // --- Convert to TopoJSON ---
  console.log('\nConverting to TopoJSON...');
  const topoPath = path.join(PUBLIC_DIR, 'uk-constituencies.topo.json');

  try {
    const { execSync } = await import('child_process');
    execSync(
      `npx geo2topo constituencies="${geoJsonPath.replace(/\\/g, '/')}" | npx toposimplify -P 0.02 > "${topoPath.replace(/\\/g, '/')}"`,
      { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 200 * 1024 * 1024, shell: true }
    );
    console.log('TopoJSON created via geo2topo + toposimplify');
  } catch (e: any) {
    console.log('geo2topo pipeline failed, using programmatic approach:', e.message?.slice(0, 100));
    const { topology } = await import('topojson-server');
    const { simplify, presimplify } = await import('topojson-simplify');
    let topo: any = topology({ constituencies: geoJson } as any, 1e5);
    topo = presimplify(topo);
    topo = simplify(topo, 0.02);
    fs.writeFileSync(topoPath, JSON.stringify(topo));
    console.log('TopoJSON created programmatically');
  }

  const topoSize = fs.statSync(topoPath).size;
  console.log(`TopoJSON size: ${(topoSize / 1024).toFixed(1)} KB`);

  // Verify polygon count
  try {
    const topoData = JSON.parse(fs.readFileSync(topoPath, 'utf-8'));
    const { feature: topoFeature } = await import('topojson-client');
    const topoObj = Object.values(topoData.objects)[0] as any;
    const fc = topoFeature(topoData as any, topoObj) as any;
    console.log(`TopoJSON renders ${fc.features?.length ?? 0} polygons`);
  } catch (e: any) {
    console.log('Could not verify TopoJSON polygon count:', e.message);
  }

  // --- Emit constituencies.json (to both src/data for import and public for fetch fallback) ---
  const outputPath = path.join(SRC_DATA_DIR, 'constituencies.json');
  fs.writeFileSync(outputPath, JSON.stringify(constitList, null, 2));
  // Also copy to public so it can be fetched at runtime during dev
  const publicOutputPath = path.join(PUBLIC_DIR, 'constituencies.json');
  fs.writeFileSync(publicOutputPath, JSON.stringify(constitList));
  console.log(`\nWrote ${constitList.length} constituencies to ${outputPath}`);

  // --- Verification ---
  console.log('\n=== Phase 1 Verification ===');
  let pass = true;

  // 1. Exactly 650 entries
  if (constitList.length !== 650) {
    console.error(`FAIL: Expected 650 constituencies, got ${constitList.length}`);
    pass = false;
  } else {
    console.log('PASS: 650 constituencies');
  }

  // 2. Sum of validVotes = 28,809,340
  const totalVotes = constitList.reduce((sum, c) => sum + c.validVotes, 0);
  if (totalVotes !== 28809340) {
    console.error(`FAIL: Expected total valid votes 28,809,340, got ${totalVotes.toLocaleString()}`);
    pass = false;
  } else {
    console.log(`PASS: Total valid votes = ${totalVotes.toLocaleString()}`);
  }

  // 3. Every constituency has a valid winner2024
  const invalidWinners = constitList.filter(c => !VALID_PARTY_IDS.has(c.winner2024));
  if (invalidWinners.length > 0) {
    console.error(`FAIL: ${invalidWinners.length} constituencies have invalid winner2024`);
    invalidWinners.slice(0, 5).forEach(c => console.error(`  ${c.id} ${c.name}: ${c.winner2024}`));
    pass = false;
  } else {
    console.log('PASS: All winner2024 values are valid PartyIds');
  }

  // 4. TopoJSON < 1 MB
  if (topoSize > 1024 * 1024) {
    console.error(`FAIL: TopoJSON is ${(topoSize / 1024).toFixed(1)} KB, expected < 1024 KB`);
    pass = false;
  } else {
    console.log(`PASS: TopoJSON is ${(topoSize / 1024).toFixed(1)} KB`);
  }

  // Seat distribution
  const seatsByParty: Partial<Record<PartyId, number>> = {};
  for (const c of constitList) {
    seatsByParty[c.winner2024] = (seatsByParty[c.winner2024] || 0) + 1;
  }
  console.log('\nSeat distribution:');
  for (const [party, seats] of Object.entries(seatsByParty).sort(([,a],[,b]) => (b as number) - (a as number))) {
    console.log(`  ${party}: ${seats}`);
  }

  if (!pass) {
    // Print debug info for failed checks
    console.log('\nDebug - sample constituencies:');
    constitList.slice(0, 3).forEach(c => {
      console.log(`  ${c.id} ${c.name}: validVotes=${c.validVotes}, winner=${c.winner2024}`);
    });
    process.exit(1);
  }

  console.log('\nAll Phase 1 checks passed!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
