import { readFile } from "node:fs/promises";
import { validatePath } from "./path-validator.js";
import { errorResult } from "./errors.js";

export type ResolveInputResult =
  | { success: true; value: string }
  | { success: false; error: ReturnType<typeof errorResult> };

export async function resolveInput(content: string): Promise<ResolveInputResult> {
  if (content.startsWith("env:")) {
    return resolveEnv(content.slice(4));
  }
  if (content.startsWith("file:")) {
    return resolveFile(content.slice(5));
  }
  if (content.startsWith("dotenv:")) {
    return resolveDotenv(content.slice(7));
  }
  return { success: true, value: content };
}

function resolveEnv(varName: string): ResolveInputResult {
  if (!varName) {
    return {
      success: false,
      error: errorResult(
        "INVALID_INPUT",
        "Environment variable name is empty",
        "Use format: env:<VAR_NAME> (e.g., env:STRIPE_KEY)",
      ),
    };
  }
  const value = process.env[varName];
  if (value === undefined) {
    return {
      success: false,
      error: errorResult(
        "ENV_VAR_NOT_FOUND",
        `Environment variable '${varName}' not found`,
        "Set the environment variable or use a different input source",
      ),
    };
  }
  return { success: true, value };
}

async function resolveFile(filePath: string): Promise<ResolveInputResult> {
  if (!filePath) {
    return {
      success: false,
      error: errorResult(
        "INVALID_INPUT",
        "File path is empty",
        "Use format: file:<path> (e.g., file:./secret.txt)",
      ),
    };
  }

  const validated = await validatePath(filePath);
  if (!validated.valid) {
    return { success: false, error: validated.error };
  }

  try {
    const contents = await readFile(validated.resolvedPath, "utf8");
    return { success: true, value: contents };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        success: false,
        error: errorResult(
          "FILE_NOT_FOUND",
          `File not found: '${filePath}'`,
          "Check the file path and ensure the file exists",
        ),
      };
    }
    return {
      success: false,
      error: errorResult(
        "FILE_NOT_FOUND",
        `Unable to read file: '${filePath}'`,
        "Check the file path and permissions",
      ),
    };
  }
}

async function resolveDotenv(ref: string): Promise<ResolveInputResult> {
  const parsed = parseDotenvReference(ref);
  if (!parsed) {
    return {
      success: false,
      error: errorResult(
        "INVALID_INPUT",
        "Malformed dotenv reference",
        "Use format: dotenv:<filepath>:<key> (e.g., dotenv:.env.local:DATABASE_URL)",
      ),
    };
  }

  const validated = await validatePath(parsed.filePath);
  if (!validated.valid) {
    return { success: false, error: validated.error };
  }

  let contents: string;
  try {
    contents = await readFile(validated.resolvedPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        success: false,
        error: errorResult(
          "FILE_NOT_FOUND",
          `Dotenv file not found: '${parsed.filePath}'`,
          "Check the file path and ensure the file exists",
        ),
      };
    }
    return {
      success: false,
      error: errorResult(
        "FILE_NOT_FOUND",
        `Unable to read dotenv file: '${parsed.filePath}'`,
        "Check the file path and permissions",
      ),
    };
  }

  const env = parseDotenv(contents);
  const value = env[parsed.key];
  if (value === undefined) {
    return {
      success: false,
      error: errorResult(
        "DOTENV_KEY_NOT_FOUND",
        `Key '${parsed.key}' not found in dotenv file '${parsed.filePath}'`,
        "Check the key name and ensure it exists in the .env file",
      ),
    };
  }
  return { success: true, value };
}

function parseDotenvReference(ref: string): { filePath: string; key: string } | null {
  const colonIndex = ref.indexOf(":");
  if (colonIndex === -1) return null;
  const filePath = ref.slice(0, colonIndex);
  const key = ref.slice(colonIndex + 1);
  if (!filePath || !key) return null;
  return { filePath, key };
}

export function parseDotenv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}
