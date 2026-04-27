import { writeFile } from "node:fs/promises";
import open from "open";
import { importKey, decrypt, unwrapKeyWithPassphrase } from "@vaulted/crypto";
import { retrieveSecret, ApiError } from "../api-client.js";
import { successResult, errorResult } from "../errors.js";
import { config } from "../config.js";
import { parseVaultedUrl } from "../url-parser.js";
import { copyToClipboard } from "../clipboard.js";
import { scheduleFileDeletion } from "../file-ttl.js";
import { validatePath } from "../path-validator.js";

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs} second${secs === 1 ? "" : "s"}`);
  return parts.join(" ");
}

export const VIEW_SECRET_DESCRIPTION =
  "Retrieve and decrypt a secret from a Vaulted secure link. The secret may have view limits and will be destroyed after the maximum views are reached. By default opens in the browser for security — use output_mode to copy to clipboard, save to file, or return directly.";

export interface ViewSecretParams {
  url?: string;
  secret_id?: string;
  encryption_key?: string;
  output_mode?: "browser" | "direct" | "clipboard" | "file";
  passphrase?: string;
  file_path?: string;
  ttl_seconds?: number;
}

type HandlerResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function resolveIdAndKey(params: ViewSecretParams): { id: string; key: string } | HandlerResult {
  if (params.url) {
    const parsed = parseVaultedUrl(params.url);
    if (!parsed.success) {
      return errorResult(parsed.code, parsed.message, parsed.suggestion);
    }
    return { id: parsed.id, key: parsed.key };
  }

  if (params.secret_id && params.encryption_key) {
    return { id: params.secret_id, key: params.encryption_key };
  }

  return errorResult(
    "INVALID_INPUT",
    "Either 'url' or both 'secret_id' and 'encryption_key' are required",
    "Provide the full Vaulted URL, or provide secret_id and encryption_key together",
  );
}

export async function handleViewSecret(params: ViewSecretParams): Promise<HandlerResult> {
  const mode = params.output_mode ?? "browser";

  if (mode === "file" && !params.file_path) {
    return errorResult(
      "INVALID_INPUT",
      "file_path is required when output_mode is 'file'",
      "Provide file_path, or use output_mode 'browser', 'direct', or 'clipboard'",
    );
  }

  let validatedFilePath: string | undefined;
  if (mode === "file") {
    const validated = await validatePath(params.file_path as string);
    if (!validated.valid) return validated.error;
    validatedFilePath = validated.resolvedPath;
  }

  const resolved = resolveIdAndKey(params);
  if ("content" in resolved) return resolved;

  const { id, key } = resolved;

  if (mode === "browser") {
    const fullUrl = `${config.baseUrl}/s/${id}#${key}`;
    try {
      await open(fullUrl);
    } catch {
      return errorResult(
        "INVALID_INPUT",
        "Failed to open the default browser",
        "Open the URL manually or use output_mode: 'direct'",
      );
    }
    return successResult(
      { mode: "browser" },
      "Secret opened in your default browser. The view will be consumed when the page loads.",
    );
  }

  let apiResponse;
  try {
    apiResponse = await retrieveSecret(id);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) {
        return errorResult(
          "SECRET_EXPIRED",
          "This secret is no longer available (expired or all views consumed)",
          "This secret has expired or reached its view limit. Ask the sender to create a new one.",
        );
      }
      if (err.code === "API_UNREACHABLE") {
        return errorResult(
          "API_UNREACHABLE",
          "Unable to reach the Vaulted API",
          "Unable to reach vaulted.fyi. Check your internet connection and try again.",
        );
      }
    }
    return errorResult(
      "API_ERROR",
      "Unexpected error retrieving the secret",
      "Try again. If the problem persists, open the URL in a browser.",
    );
  }

  if (apiResponse.hasPassphrase && !params.passphrase) {
    return errorResult(
      "PASSPHRASE_REQUIRED",
      "This secret is passphrase-protected",
      "This secret is passphrase-protected. Provide the passphrase and try again.",
    );
  }

  if (apiResponse.hasPassphrase) {
    const dotIdx = key.indexOf(".");
    if (dotIdx <= 0 || dotIdx === key.length - 1) {
      return errorResult(
        "INVALID_INPUT",
        "Passphrase-protected secret fragment is malformed",
        "Expected fragment format 'wrappedKey.salt'. Re-copy the full URL from the sender.",
      );
    }
  }

  let plaintext: string;
  try {
    let cryptoKey;
    if (apiResponse.hasPassphrase) {
      const [wrappedKey, salt] = key.split(".");
      cryptoKey = await unwrapKeyWithPassphrase(wrappedKey, salt, params.passphrase as string);
    } else {
      cryptoKey = await importKey(key);
    }
    plaintext = await decrypt(apiResponse.ciphertext, apiResponse.iv, cryptoKey);
  } catch {
    return errorResult(
      "ENCRYPTION_FAILED",
      "Failed to decrypt the secret (this attempt may have consumed a view)",
      params.passphrase
        ? "The passphrase may be incorrect. Try again or ask the sender."
        : "Check that the URL is complete, including the fragment after '#'",
    );
  }

  if (mode === "direct") {
    return successResult(
      {
        mode: "direct",
        content: plaintext,
        sensitive: true,
        viewsRemaining: apiResponse.viewsRemaining,
      },
      "Secret retrieved and decrypted successfully. Treat the content as sensitive.",
    );
  }

  if (mode === "clipboard") {
    try {
      await copyToClipboard(plaintext);
    } catch (err) {
      return errorResult(
        "INVALID_INPUT",
        "Failed to copy the secret to the clipboard",
        `${(err as Error).message}. Try output_mode 'browser', 'direct', or 'file' instead.`,
      );
    }
    return successResult(
      { mode: "clipboard", viewsRemaining: apiResponse.viewsRemaining },
      "Secret copied to clipboard. Paste it where needed — the content is not included in this response.",
    );
  }

  if (mode === "file") {
    const filePath = validatedFilePath as string;
    try {
      // flag: "wx" → exclusive create. Refuses to write if the path exists, including
      // when the path is a symlink (POSIX O_EXCL behavior). This closes a TOCTOU window
      // between validatePath() and writeFile() where a local attacker could place a
      // symlink to redirect the decrypted plaintext outside the allowed dirs.
      await writeFile(filePath, plaintext, { encoding: "utf-8", flag: "wx" });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "ELOOP") {
        return errorResult(
          "FILE_WRITE_ERROR",
          `Refused to write the secret to ${filePath} — path already exists`,
          "Choose a path that does not yet exist. Auto-expiring file output refuses to overwrite to avoid following a symlink to an unintended target.",
        );
      }
      return errorResult(
        "FILE_WRITE_ERROR",
        `Failed to write the secret to ${filePath}`,
        `${(err as Error).message}. Check the path is writable and try again.`,
      );
    }

    if (params.ttl_seconds !== undefined) {
      scheduleFileDeletion(filePath, params.ttl_seconds);
      return successResult(
        {
          mode: "file",
          filePath,
          viewsRemaining: apiResponse.viewsRemaining,
        },
        `Secret saved to ${filePath}. File will auto-delete in ${formatDuration(params.ttl_seconds)} (best-effort, while this MCP server is running).`,
      );
    }

    return successResult(
      {
        mode: "file",
        filePath,
        viewsRemaining: apiResponse.viewsRemaining,
      },
      `Secret saved to ${filePath}. The content is not included in this response.`,
    );
  }

  return errorResult(
    "INVALID_INPUT",
    `Unsupported output_mode: ${mode}`,
    "Use one of: browser, direct, clipboard, file",
  );
}
