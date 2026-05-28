// generate-nigeria-flag.cjs
// Generates public/nigeria-flag.png — the Nigerian tricolour (green / white / green),
// three equal vertical bands. No external image libs: hand-rolls a valid PNG
// (truecolor RGB) using Node's built-in zlib for the IDAT stream.
// Run: node generate-nigeria-flag.cjs

const fs   = require('fs');
const zlib = require('zlib');
const path = require('path');

const W = 384, H = 216;            // 16:9 so the homepage card crops nothing
const GREEN = [0x00, 0x87, 0x51];  // official Nigeria flag green (#008751)
const WHITE = [0xFF, 0xFF, 0xFF];

// Raw image: each scanline prefixed with a filter byte (0 = none).
const raw = Buffer.alloc(H * (1 + W * 3));
let o = 0;
for (let y = 0; y < H; y++) {
  raw[o++] = 0;
  for (let x = 0; x < W; x++) {
    const band = Math.floor(x / (W / 3)); // 0 | 1 | 2
    const c = band === 1 ? WHITE : GREEN;
    raw[o++] = c[0]; raw[o++] = c[1]; raw[o++] = c[2];
  }
}

// CRC32 (PNG chunks each carry a CRC over type+data).
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const sig  = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 2;   // color type: truecolor RGB
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression / filter / interlace
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
const out = path.join(__dirname, 'public', 'nigeria-flag.png');
fs.writeFileSync(out, png);
console.log(`✓ Wrote ${png.length} bytes → ${out} (${W}x${H})`);
