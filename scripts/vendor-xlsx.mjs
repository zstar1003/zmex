import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = path.join(root, "node_modules/xlsx");
const targetRoot = path.join(root, "data/vendor/xlsx");

await mkdir(targetRoot, { recursive: true });
// Use .js so the existing static server serves this ESM file as JavaScript.
await copyFile(path.join(sourceRoot, "xlsx.mjs"), path.join(targetRoot, "xlsx.js"));
await copyFile(path.join(sourceRoot, "LICENSE"), path.join(targetRoot, "LICENSE"));

console.log(`Vendored SheetJS browser module and license to ${path.relative(root, targetRoot)}`);
