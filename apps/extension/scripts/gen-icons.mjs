// Rasterize icon.svg into the PNG sizes the Chrome Web Store requires
// (16/32/48/128). Run via `pnpm --filter @10xconnect/extension gen-icons`.
// The PNGs are committed so the unpacked dev build shows the icon too.
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = join(root, "icon.svg");
const outDir = join(root, "icons");
const sizes = [16, 32, 48, 128];

await mkdir(outDir, { recursive: true });
for (const size of sizes) {
  const out = join(outDir, `icon-${size}.png`);
  // High density so the SVG rasterizes crisply even at 16px.
  await sharp(src, { density: 384 }).resize(size, size).png().toFile(out);
  console.log("wrote", out);
}
