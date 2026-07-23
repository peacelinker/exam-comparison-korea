import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const client = resolve(dist, "client");
const rootEntries = await readdir(dist, { withFileTypes: true });

await rm(client, { recursive: true, force: true });
await mkdir(client, { recursive: true });
for (const entry of rootEntries) {
  if (["client", "server", ".openai"].includes(entry.name)) continue;
  await rename(resolve(dist, entry.name), resolve(client, entry.name));
}
await mkdir(resolve(dist, "server"), { recursive: true });
await mkdir(resolve(dist, ".openai"), { recursive: true });
await copyFile(
  resolve(root, ".openai", "hosting.json"),
  resolve(dist, ".openai", "hosting.json"),
);
await copyFile(
  resolve(root, "scripts", "sites-worker.mjs"),
  resolve(dist, "server", "index.js"),
);
