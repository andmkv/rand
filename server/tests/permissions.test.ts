import { test } from "node:test";
import assert from "node:assert/strict";
import {
  can,
  canReadProject,
  canEditProject,
  permissionRules,
  type Permission,
  type Principal,
} from "../../shared/permissions.js";
import { readConfig, readDatabaseUrl } from "../config.js";

import { roles, matrix, expected } from "./matrix.js";
test("every permission is covered by the authoritative product matrix", () => {
  assert.deepEqual(
    matrix.map((r) => r.permission).sort(),
    Object.keys(permissionRules).sort(),
  );
  for (const row of matrix) {
    assert.equal(row.cells.length, 3);
    Object.entries(roles).forEach(([role, p], i) =>
      assert.equal(
        can(p, row.permission),
        expected(row.cells[i], p),
        `${role}: ${row.permission}`,
      ),
    );
  }
});
test("verification, suspension and admin never bypass account/verification checks", () => {
  for (const base of Object.values(roles).filter((p): p is Principal => !!p)) {
    for (const permission of Object.keys(permissionRules) as Permission[]) {
      const guest = can(null, permission);
      assert.equal(can({ ...base, active: false }, permission), guest);
      assert.equal(
        can({ ...base, verified: false }, permission),
        guest || permission === "accountSettings",
      );
    }
  }
});
test("private/shared and owner/admin boundaries deny cross-user access", () => {
  const project = {
    ownerId: "registered",
    visibility: "private" as const,
    available: true,
  };
  assert.equal(canReadProject(null, project), false);
  assert.equal(canReadProject(roles.Registered, { ...project, ownerId: "other" }), false);
  assert.equal(canReadProject(roles.Registered, project), true);
  assert.equal(canReadProject(roles.Admin, project), true);
  assert.equal(canEditProject(roles.Admin, project), false); // explicit audit-only admin path
  assert.equal(canEditProject(roles.Registered, project), true);
  for (const visibility of ["unlisted", "public"] as const) {
    assert.equal(canReadProject(null, { ...project, visibility }), true);
    assert.equal(
      canReadProject(null, { ...project, visibility, available: false }),
      false,
    );
  }
});
test("configuration rejects invalid DB/port without printing supplied secrets", () => {
  assert.throws(
    () => readConfig({ DATABASE_URL: "mysql://secret" }),
    /PostgreSQL/,
  );
  assert.throws(
    () =>
      readConfig({ DATABASE_URL: "postgres://localhost/db", API_PORT: "0" }),
    /API_PORT/,
  );
  assert.equal(
    readConfig({ DATABASE_URL: "postgres://localhost/db" }).adminEmail,
    undefined,
  );
  assert.throws(
    () => readConfig({ DATABASE_URL: "postgres://localhost/db", NODE_ENV: "production" }),
    /ADMIN_BOOTSTRAP_EMAIL/,
  );
  assert.equal(
    readDatabaseUrl({ DATABASE_URL: "postgres://localhost/db", NODE_ENV: "production" }),
    "postgres://localhost/db",
  );
});
