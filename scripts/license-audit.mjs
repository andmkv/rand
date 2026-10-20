import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const modules = join(root, "node_modules");
const allowed = new Set(["MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]);
const counts = new Map();
const problems = [];
let audited = 0;

function licenseIds(value) {
  if (typeof value === "string") return value.match(/[A-Za-z0-9][A-Za-z0-9.-]*/g) ?? [];
  if (Array.isArray(value)) return value.flatMap((item) => licenseIds(typeof item === "string" ? item : item?.type));
  if (value && typeof value === "object") return licenseIds(value.type);
  return [];
}

function scanModuleDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".bin") continue;
    const packagePath = join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@")) {
      scanModuleDirectory(packagePath);
      continue;
    }
    const manifest = join(packagePath, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    const ids = [...new Set(licenseIds(pkg.license ?? pkg.licenses))];
    audited++;
    if (!ids.length || ids.some((id) => !allowed.has(id)))
      problems.push(`${pkg.name ?? entry.name}@${pkg.version ?? "unknown"}: ${ids.join(" OR ") || "no SPDX license metadata"}`);
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const nested = join(packagePath, "node_modules");
    if (existsSync(nested)) scanModuleDirectory(nested);
  }
}

if (!existsSync(modules)) throw new Error("Run npm ci before the dependency license audit.");
scanModuleDirectory(modules);
console.log(`Audited ${audited} installed packages: ${[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => `${id}=${count}`).join(", ")}.`);
if (problems.length) {
  console.error("Review dependencies with missing or unapproved license metadata:");
  for (const item of problems) console.error(`- ${item}`);
  process.exitCode = 1;
}
