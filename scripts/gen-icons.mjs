// Regenerate every app icon / mascot asset from a single master image.
// Run after dropping a new master into public/nerdos-icono.png:
//
//   node scripts/gen-icons.mjs
//
// Outputs (each sized for its actual use, master stays the source of truth):
//   public/mascot.png       256x256  — in-app mascot, rendered at 36-112px
//   public/icon-1024.png   1024x1024 — Farcaster mini-app iconUrl
//   public/splash-200.png   200x200  — Farcaster splash image
//   src/app/apple-icon.png  180x180  — iOS home-screen / apple-touch-icon
//   src/app/favicon.ico     256x256  — browser tab favicon (PNG wrapped in
//                                      an ICO container; sharp can't emit
//                                      .ico directly, and we have no
//                                      ImageMagick, so we build the 22-byte
//                                      header by hand — modern browsers
//                                      read PNG-payload ICOs fine)
//
// Filenames are kept identical to the originals so no app code changes:
// next.config, the Farcaster manifest, and every <Image src="/mascot.png">
// keep pointing at the same paths.

import sharp from "sharp";
import { writeFile } from "node:fs/promises";

const MASTER = "public/nerdos-icono.png";

const pngTargets = [
  { out: "public/mascot.png", size: 256 },
  { out: "public/icon-1024.png", size: 1024 },
  { out: "public/splash-200.png", size: 200 },
  { out: "src/app/apple-icon.png", size: 180 },
];

for (const { out, size } of pngTargets) {
  await sharp(MASTER)
    .resize(size, size, { fit: "cover" })
    .png()
    .toFile(out);
  console.log(`✓ ${out}  (${size}x${size})`);
}

// --- favicon.ico ---------------------------------------------------------
// ICO container holding a single 256x256 PNG entry. Layout:
//   ICONDIR     (6 bytes):  reserved=0, type=1, count=1
//   ICONDIRENTRY(16 bytes): w, h, palette, reserved, planes, bpp,
//                           byteSize, offset
//   PNG payload
// Width/height of 256 are stored as 0 (the field is one byte, 0 means 256).
const icoPng = await sharp(MASTER).resize(256, 256, { fit: "cover" }).png().toBuffer();

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // image count

const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0); // width  256 -> 0
entry.writeUInt8(0, 1); // height 256 -> 0
entry.writeUInt8(0, 2); // palette colors
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(icoPng.length, 8); // payload byte size
entry.writeUInt32LE(6 + 16, 12); // payload offset

await writeFile("src/app/favicon.ico", Buffer.concat([header, entry, icoPng]));
console.log(`✓ src/app/favicon.ico  (256x256, ${6 + 16 + icoPng.length} bytes)`);

console.log("\nAll icons regenerated from", MASTER);
