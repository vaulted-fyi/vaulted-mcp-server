import { parseArgs } from "node:util";
import { resolve } from "node:path";

export interface Config {
  baseUrl: string;
  allowedDirs: string[];
}

const DEFAULT_BASE_URL = "https://vaulted.fyi";

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function parseConfig(args: string[]): Config {
  const { values } = parseArgs({
    args,
    options: {
      "base-url": { type: "string" },
      "allowed-dirs": { type: "string" },
    },
    strict: false,
  });

  const baseUrlRaw = typeof values["base-url"] === "string" ? values["base-url"] : "";

  const baseUrl = baseUrlRaw && isValidUrl(baseUrlRaw) ? baseUrlRaw : DEFAULT_BASE_URL;

  const allowedDirsRaw =
    typeof values["allowed-dirs"] === "string" ? values["allowed-dirs"] : undefined;

  return {
    baseUrl,
    allowedDirs: allowedDirsRaw
      ? allowedDirsRaw
          .split(",")
          .map((dir: string) => dir.trim())
          .filter((dir: string) => dir.length > 0)
          .map((dir: string) => resolve(dir))
      : [],
  };
}

export const config: Config = parseConfig(process.argv.slice(2));
