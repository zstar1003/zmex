import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const sourceRoot = path.join(root, "node_modules/three");
const targetRoot = path.join(root, "data/vendor/three");

await mkdir(targetRoot, { recursive: true });
await copyFile(path.join(sourceRoot, "build/three.module.min.js"), path.join(targetRoot, "three.module.min.js"));
await copyFile(path.join(sourceRoot, "build/three.core.min.js"), path.join(targetRoot, "three.core.min.js"));

const controlsTarget = path.join(targetRoot, "addons/controls/OrbitControls.js");
const controlsSource = await readFile(path.join(sourceRoot, "examples/jsm/controls/OrbitControls.js"), "utf8");
await mkdir(path.dirname(controlsTarget), { recursive: true });
await writeFile(controlsTarget, controlsSource.replace("from 'three';", "from '../../three.module.min.js';"));

console.log(`Vendored Three.js browser modules to ${path.relative(root, targetRoot)}`);
