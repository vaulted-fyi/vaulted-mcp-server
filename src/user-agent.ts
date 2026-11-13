import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolves to package.json both from src/ (tests) and from the bundled dist/.
const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const { version } = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };

export const USER_AGENT = `vaulted-mcp-server/${version}`;
