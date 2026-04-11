import { resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { config } from "./config.js";
import { errorResult } from "./errors.js";

export type PathValidationResult =
  | { valid: true; resolvedPath: string }
  | { valid: false; error: ReturnType<typeof errorResult> };

function isUnderDirectory(filePath: string, dir: string): boolean {
  if (filePath === dir) return true;
  const normalizedDir = dir.endsWith(sep) ? dir : dir + sep;
  return filePath.startsWith(normalizedDir);
}

function traversalBlocked(): PathValidationResult {
  return {
    valid: false,
    error: errorResult(
      "PATH_TRAVERSAL_BLOCKED",
      "Path resolves outside the allowed directories",
      "File access is restricted to the current working directory. Use --allowed-dirs to permit additional directories",
    ),
  };
}

export async function validatePath(filePath: string): Promise<PathValidationResult> {
  const absolutePath = resolve(filePath);

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(absolutePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      canonicalPath = absolutePath;
    } else {
      return traversalBlocked();
    }
  }

  const allowed = [process.cwd(), ...config.allowedDirs];
  const isAllowed = allowed.some((dir) => isUnderDirectory(canonicalPath, dir));

  if (!isAllowed) {
    return traversalBlocked();
  }

  return { valid: true, resolvedPath: canonicalPath };
}
