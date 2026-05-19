/**
 * One-time script: merge high-res Wales & NI boundaries into uk-constituencies.geojson
 * Run: node scripts/merge-boundaries.js
 */
const fs = require('fs');
const path = require('path');

// ── Douglas-Peucker simplification ────────────────────────────────────
function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / mag;
}

function dp(pts, tol) {
  if (pts.length <= 2) return pts;
  let maxD = 0, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD > tol) {
    return [...dp(pts.slice(0, maxI + 1), tol).slice(0, -1), ...dp(pts.slice(maxI), tol)];
  }
  return [pts[0], pts[pts.length - 1]];
}

function simplifyRing(ring, tol) {
  const s = dp(ring, tol);
  // Ensure ring is closed
  if (s.length < 4) return ring; // too small after simplification, keep original
  if (s[0][0] !== s[s.length-1][0] || s[0][1] !== s[s.length-1][1]) s.push(s[0]);
  return s;
}

function simplifyGeometry(geom, tol) {
  if (!geom) return geom;
  if (geom.type === 'Polygon') {
    return { ...geom, coordinates: geom.coordinates.map(ring => simplifyRing(ring, tol)) };
  }
  if (geom.type === 'MultiPolygon') {
    return { ...geom, coordinates: geom.coordinates.map(poly => poly.map(ring => simplifyRing(ring, tol))) };
  }
  return geom;
}

// ── Name → gssCode lookup from existing file ─────────────────────────
const existingPath = path.join(__dirname, '../public/uk-constituencies.geojson');
const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));

const nameToGss = {};
for (const f of existing.features) {
  nameToGss[f.properties.name.toLowerCase()] = f.properties.gssCode;
}
const gssToIdx = {};
for (let i = 0; i < existing.features.length; i++) {
  gssToIdx[existing.features[i].properties.gssCode] = i;
}

// ── Manual name overrides: new-file Name → existing name ─────────────
const OVERRIDES = {
  // Wales
  "Alyn & Deeside":            "Alyn and Deeside",
  "Blaenau Gwent & Rhymney":   "Blaenau Gwent and Rhymney",
  "Brecon, Radnor & Cwm Tawe": "Brecon, Radnor and Cwm Tawe",
  "Cardiff E":                  "Cardiff East",
  "Cardiff N":                  "Cardiff North",
  "Cardiff S & Penarth":        "Cardiff South and Penarth",
  "Cardiff W":                  "Cardiff West",
  "Clwyd E":                    "Clwyd East",
  "Clwyd N":                    "Clwyd North",
  "Merthyr Tydfil & Aberdare":  "Merthyr Tydfil and Aberdare",
  "Montgomeryshire & Glyndwr":  "Montgomeryshire and Glyndwr",
  "Neath & Swansea E":          "Neath and Swansea East",
  "Newport E":                  "Newport East",
  "Newport W & Islwyn":         "Newport West and Islwyn",
  "Pembrokeshire Mid & S":      "Mid and South Pembrokeshire",
  "Rhondda & Ogmore":           "Rhondda and Ogmore",
  "Swansea W":                  "Swansea West",
  // Northern Ireland
  "Antrim E":                   "East Antrim",
  "Antrim N":                   "North Antrim",
  "Antrim S":                   "South Antrim",
  "Belfast E":                  "Belfast East",
  "Belfast N":                  "Belfast North",
  "Belfast S & Mid Down":       "Belfast South and Mid Down",
  "Belfast W":                  "Belfast West",
  "Down N":                     "North Down",
  "Down S":                     "South Down",
  "Fermanagh & S Tyrone":       "Fermanagh and South Tyrone",
  "Londonderry E":              "East Londonderry",
  "Newry & Armagh":             "Newry and Armagh",
  "Tyrone W":                   "West Tyrone",
  "Ulster Mid":                 "Mid Ulster",
};

function resolveGss(newName) {
  const resolved = OVERRIDES[newName] ?? newName;
  return nameToGss[resolved.toLowerCase()] ?? null;
}

// ── Process one source file ───────────────────────────────────────────
function processFile(srcPath, tolerance, label) {
  console.log(`\nProcessing ${label} (tolerance=${tolerance})...`);
  const raw = fs.readFileSync(srcPath, 'utf8').replace(/^﻿/, ''); // strip BOM
  const src = JSON.parse(raw);
  let matched = 0, missed = 0;

  for (const feat of src.features) {
    // ONS API uses PCON24NM; hand-drawn files use Name or name
    const newName = feat.properties?.PCON24NM ?? feat.properties?.Name ?? feat.properties?.name ?? '';
    const gss = resolveGss(newName);
    if (!gss) {
      console.warn(`  MISS: "${newName}"`);
      missed++;
      continue;
    }
    const idx = gssToIdx[gss];
    if (idx === undefined) {
      console.warn(`  NO IDX for gss=${gss} (${newName})`);
      missed++;
      continue;
    }
    existing.features[idx] = {
      ...existing.features[idx],
      geometry: simplifyGeometry(feat.geometry, tolerance),
    };
    matched++;
  }
  console.log(`  Matched ${matched}, missed ${missed}`);
}

// ── Run ───────────────────────────────────────────────────────────────
const WALES_PATH    = 'C:/Users/leoc4/Downloads/2024_constituencies___wales.geojson';
const NI_PATH       = 'C:/Users/leoc4/Downloads/2024_constituencies___northern_ireland.geojson';
const SCOTLAND_PATH = 'C:/Users/leoc4/Downloads/scotland_buc.geojson';

// Tolerance in degrees: ~0.0004° ≈ 40m at UK latitude — good map detail, small file
const TOLERANCE = 0.0004;

processFile(WALES_PATH,    TOLERANCE, 'Wales');
processFile(NI_PATH,       TOLERANCE, 'Northern Ireland');
processFile(SCOTLAND_PATH, TOLERANCE, 'Scotland');

// ── Write output ──────────────────────────────────────────────────────
const out = JSON.stringify(existing);
fs.writeFileSync(existingPath, out);

const sizeMB = (Buffer.byteLength(out) / 1024 / 1024).toFixed(2);
console.log(`\nDone! Written to ${existingPath} (${sizeMB} MB)`);
