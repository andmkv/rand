import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { operationsStatus } from "../operations.js";
test("operations summary fails closed on missing, corrupt or excessive input, and marks old snapshots stale", async () => {
  const dir = await mkdtemp(join(tmpdir(), "randusr-ops-"));
  const path = join(dir, "status.json");
  try {
    await assert.rejects(operationsStatus(path));
    for (const value of ["not-json", '"x"', "x".repeat(65537)]) {
      await writeFile(path, value);
      await assert.rejects(operationsStatus(path));
    }
    await writeFile(
      path,
      JSON.stringify({ version: 1, checkedAt: Date.now(), ok: true }),
    );
    assert.equal((await operationsStatus(path)).stale, false);
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        checkedAt: Date.now() - 11 * 60000,
        ok: true,
      }),
    );
    assert.equal((await operationsStatus(path)).stale, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
