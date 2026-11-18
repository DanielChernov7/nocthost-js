// Mark each output folder with its module type so Node picks the right loader.
import { writeFileSync } from "node:fs";
writeFileSync("dist/esm/package.json", JSON.stringify({ type: "module" }) + "\n");
writeFileSync("dist/cjs/package.json", JSON.stringify({ type: "commonjs" }) + "\n");
