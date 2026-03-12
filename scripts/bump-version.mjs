import { execSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const versionPath = join(__dirname, "..", "version.json");

const count = Number(execSync("git rev-list --count HEAD").toString().trim());
const hash = execSync("git rev-parse --short HEAD").toString().trim();
const last_updated_utc = execSync("git log -1 --format=%cI").toString().trim();

await writeFile(
  versionPath,
  JSON.stringify({ version: count, hash, last_updated_utc }, null, 2) + "\n",
  "utf-8",
);
