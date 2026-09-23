// MapLibre 6 runs map rendering in a module worker that bundlers don't emit
// reliably. Serve the package's own worker files from /maplibre/ instead.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public/maplibre", { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(`node_modules/maplibre-gl/dist/${f}`, `public/maplibre/${f}`);
}
console.log("maplibre worker copied");
