import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { connectDatabase } from "../db/client.js";
const exec = promisify(execFile);
export async function disposablePostgres() {
  // Never accepts DATABASE_URL: tests cannot migrate or reset an operator's database.
  const name = `randusr-test-${randomUUID()}`;
  const password = randomUUID();
  let connection: ReturnType<typeof connectDatabase> | undefined;
  const stop = async () => {
    await connection?.pool.end();
    await exec("docker", ["rm", "-f", name]).catch(() => {});
  };
  try {
    await exec(
      "docker",
      [
        "run",
        "--rm",
        "-d",
        "--name",
        name,
        "-e",
        `POSTGRES_PASSWORD=${password}`,
        "-e",
        "POSTGRES_DB=randusr_test",
        "-p",
        "127.0.0.1::5432",
        "--tmpfs",
        "/var/lib/postgresql/data",
        process.env.POSTGRES_TEST_IMAGE ?? "postgres:17-alpine",
      ],
      { timeout: 120000 },
    );
    const { stdout } = await exec("docker", ["port", name, "5432/tcp"]);
    const port = stdout.trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1];
    if (!port)
      throw new Error("Disposable PostgreSQL did not bind to loopback");
    connection = connectDatabase(
      `postgresql://postgres:${password}@127.0.0.1:${port}/randusr_test`,
    );
    for (let attempt = 0; ; attempt++) {
      try {
        await connection.pool.query("select 1");
        break;
      } catch {
        if (attempt >= 80)
          throw new Error("Disposable PostgreSQL startup timed out");
        await delay(250);
      }
    }
    return { ...connection, containerName: name, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
