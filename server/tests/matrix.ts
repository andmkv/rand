import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Permission, Principal } from "../../shared/permissions.js";
export const roles: Record<string, Principal | null> = {
  Guest: null,
  Registered: {
    id: "registered",
    active: true,
    verified: true,
    isAdmin: false,
  },
  Admin: {
    id: "admin",
    active: true,
    verified: true,
    isAdmin: true,
  },
};
export const matrix = readFileSync(
  new URL("../../docs/PRODUCT.md", import.meta.url),
  "utf8",
)
  .split("\n")
  .filter((line) => /^\| [a-zA-Z]+ \| (yes|no)/.test(line))
  .map((line) => {
    const [permission, ...cells] = line
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean);
    return { permission: permission as Permission, cells };
  });
export function expected(cell: string, _p: Principal | null) {
  assert.ok(["yes", "no"].includes(cell));
  return cell === "yes";
}
