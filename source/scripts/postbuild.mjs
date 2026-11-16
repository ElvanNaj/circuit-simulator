// Copy the Next.js static assets and public folder into the standalone bundle.
// Cross-platform replacement for `cp -r` so `npm run build` works on Windows too.
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, ".next");
const standalone = join(dist, "standalone");

if (!existsSync(join(standalone, "server.js"))) {
  console.error("[postbuild] .next/standalone/server.js not found - run `next build` first.");
  process.exit(1);
}

const copies = [
  [join(dist, "static"), join(standalone, ".next", "static")],
  [join(root, "public"), join(standalone, "public")],
];

for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.warn(`[postbuild] skipping missing ${from}`);
    continue;
  }
  cpSync(from, to, { recursive: true });
  console.log(`[postbuild] ${from} -> ${to}`);
}

console.log("[postbuild] standalone bundle ready at .next/standalone");
