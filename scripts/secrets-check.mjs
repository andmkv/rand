import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const images = {
  arm64: "ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:6b2d52241f9d176fc59e6e3b026ea52c98f390070587d9475d6ee2bc64941815",
  x64: "ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:b109bc5f8f76a38196a3e413704fc5b9e3c32360bce4e4b603bd6f45b3721dbb",
};

const architecture = process.arch;
const platform = architecture === "arm64" ? "linux/arm64" : architecture === "x64" ? "linux/amd64" : null;
const image = images[architecture];

if (!image || !platform) {
  process.stderr.write(`Secret scan supports arm64 and x64 hosts; found ${architecture}.\n`);
  process.exit(2);
}

const source = resolve(process.argv[2] ?? process.cwd());
const result = spawnSync("docker", [
  "run",
  "--rm",
  "--pull=missing",
  `--platform=${platform}`,
  "--network=none",
  "--read-only",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  "--mount", `type=bind,src=${source},dst=/repo,readonly`,
  image,
  "detect",
  "--no-git",
  "--redact",
  "--no-banner",
  "--source=/repo",
], { stdio: "inherit" });

if (result.error) {
  process.stderr.write(`Unable to start the pinned Gitleaks container: ${result.error.message}\n`);
  process.exit(2);
}
process.exit(result.status ?? 2);
