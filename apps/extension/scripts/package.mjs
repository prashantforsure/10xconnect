// Build the Chrome Web Store upload bundle.
//
// Produces dist/ (runtime files only, with a PRODUCTION manifest that injects
// the content script on the real app origin — never localhost) and a versioned
// .zip ready to upload at chrome.google.com/webstore/devconsole.
//
// The production origin defaults to the brand domain; override per environment:
//   EXTENSION_APP_ORIGIN=https://app.yourdomain.com pnpm --filter @10xconnect/extension package
import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import archiver from "archiver";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");

const origin = (process.env.EXTENSION_APP_ORIGIN ?? "https://app.10xconnect.com").replace(/\/+$/, "");
if (!/^https:\/\//.test(origin)) {
  throw new Error(`EXTENSION_APP_ORIGIN must be an https:// origin, got "${origin}"`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// Runtime files only — no README, package.json, scripts/, or icon.svg source.
for (const f of ["background.js", "content.js", "popup.html", "popup.js"]) {
  await cp(join(root, f), join(dist, f));
}
await cp(join(root, "icons"), join(dist, "icons"), { recursive: true });

// Production manifest: content script runs ONLY on the real app origin.
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
manifest.content_scripts[0].matches = [`${origin}/*`];
await writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// Zip dist/ contents (manifest at the archive root, as the store requires).
const zipPath = join(root, `10xconnect-extension-v${manifest.version}.zip`);
await new Promise((resolve, reject) => {
  const output = createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });
  output.on("close", resolve);
  archive.on("error", reject);
  archive.pipe(output);
  archive.directory(dist, false);
  void archive.finalize();
});

console.log(`Packaged ${zipPath}`);
console.log(`Content script origin: ${origin}/*`);
