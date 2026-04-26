import { readFile } from "node:fs/promises";
import { runCommand, runFile } from "./command-runner.js";
import { errorResult } from "./errors.js";
import { validatePath } from "./path-validator.js";

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
  if (content.startsWith("cmd:")) {
    return resolveCommand(content.slice(4));
  }
  if (content.startsWith("op:")) {
    return resolveOp(content.slice(3));
  }
  if (content.startsWith("keychain:")) {
    return resolveKeychain(content.slice(9));
  }
  return { success: true, value: content };
}

async function resolveCommand(command: string): Promise<ResolveInputResult> {
  if (!command.trim()) {
    return {
      success: false,
      error: errorResult(
        "INVALID_INPUT",
        "Command is empty",
        "Use format: cmd:<command> (e.g., cmd:aws secretsmanager get-secret-value --secret-id mykey --output text)",
      ),
    };
  }

  try {
    const { stdout } = await runCommand(command, 10_000);
    const value = stdout.trim();
    if (!value) {
      return {
        success: false,
        error: errorResult(
          "INVALID_INPUT",
          `Command produced no output: '${command}'`,
          "Ensure the command prints the secret value to stdout",
        ),
      };
    }
    return { success: true, value };
  } catch (err) {
    const error = err as NodeJS.ErrnoException & {
      killed?: boolean;
      stderr?: string;
    };

    if (error.killed) {
      return {
        success: false,
        error: errorResult(
          "COMMAND_TIMEOUT",
          `Command timed out after 10 seconds: '${command}'`,
          "Ensure the command completes quickly or use a more specific query",
        ),
      };
    }

    const stderr = (error.stderr ?? "").trim();
    const exitCode = typeof error.code === "number" ? error.code : 1;
    return {
      success: false,
      error: errorResult(
        "COMMAND_FAILED",
        `Command failed with exit code ${exitCode}: '${command}'${stderr ? ` — ${stderr}` : ""}`,
        "Check the command and ensure it exits with code 0",
      ),
    };
  }
}

async function resolveOp(itemPath: string): Promise<ResolveInputResult> {
  if (!itemPath.trim()) {
    return {
      success: false,
      error: errorResult(
        "INVALID_INPUT",
        "1Password item path is empty",
        "Use format: op:<vault>/<item> (e.g., op:Private/Stripe API Key)",
      ),
    };
  }
  const ref = `op://${itemPath}`;
  try {
    const { stdout } = await runFile("op", ["read", ref], 10_000);
    return { success: true, value: stdout.trim() };
  } catch (err: unknown) {
    if (isEnoent(err)) {
      return {
        success: false,
        error: errorResult(
          "OP_NOT_FOUND",
          "1Password CLI (op) not found.",
          "Install it from https://1password.com/downloads/cli",
        ),
      };
    }
    if (isKilled(err)) {
      return {
        success: false,
        error: errorResult(
          "COMMAND_TIMEOUT",
          "op read timed out after 10 seconds",
          "Ensure 1Password CLI is signed in and the item path is correct",
        ),
      };
    }
    const stderr = extractStderr(err);
    return {
      success: false,
      error: errorResult(
        "COMMAND_FAILED",
        `op read failed: ${stderr}`,
        "Check the item path and ensure you are signed in to 1Password CLI (op signin)",
      ),
    };
  }
}

async function resolveKeychain(serviceName: string): Promise<ResolveInputResult> {
  if (!serviceName.trim()) {
    return {
      success: false,
      error: errorResult(
        "INVALID_INPUT",
        "Keychain service name is empty",
        "Use format: keychain:<service> (e.g., keychain:MyDatabasePassword)",
      ),
    };
  }
  if (process.platform !== "darwin") {
    return {
      success: false,
      error: errorResult(
        "PLATFORM_NOT_SUPPORTED",
        "Keychain access is only supported on macOS.",
        "Use env:, file:, or op: as alternative input sources on this platform",
      ),
    };
  }
  try {
    const { stdout } = await runFile(
      "security",
      ["find-generic-password", "-s", serviceName, "-w"],
      10_000,
    );
    return { success: true, value: stdout.trim() };
  } catch (err: unknown) {
    if (isKilled(err)) {
      return {
        success: false,
        error: errorResult(
          "COMMAND_TIMEOUT",
          "security find-generic-password timed out after 10 seconds",
          "Ensure keychain access is not blocked",
        ),
      };
    }
    const exitCode = extractExitCode(err);
    if (exitCode === 44) {
      return {
        success: false,
        error: errorResult(
          "KEYCHAIN_NOT_FOUND",
          `Keychain item '${serviceName}' not found.`,
          "Check the service name in Keychain Access (Applications > Utilities > Keychain Access)",
        ),
      };
    }
    const stderr = extractStderr(err);
    return {
      success: false,
      error: errorResult(
        "COMMAND_FAILED",
        `security find-generic-password failed: ${stderr}`,
        "Ensure the service name is correct and keychain access is not denied",
      ),
    };
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isKilled(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { killed?: boolean }).killed === true;
}

function extractStderr(err: unknown): string {
  if (typeof err === "object" && err !== null && "stderr" in err) {
    return String((err as { stderr: string }).stderr).trim();
  }
  return "unknown error";
}

function extractExitCode(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
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
        "FILE_READ_ERROR",
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
        "FILE_READ_ERROR",
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
  const colonIndex = ref.lastIndexOf(":");
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
