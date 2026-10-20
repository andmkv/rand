import { readFileSync, statSync } from "node:fs";
/** Support protected mounted secrets without placing credentials in image/env metadata. */
export function secretValue(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name],
    file = env[`${name}_FILE`];
  if (value && file)
    throw new Error(`Configure ${name} or ${name}_FILE, not both`);
  if (!file) return value;
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > 8192) throw new Error();
    const result = readFileSync(file, "utf8").trim();
    if (!result) throw new Error();
    return result;
  } catch {
    throw new Error(`Cannot read configured ${name}_FILE`);
  }
}
