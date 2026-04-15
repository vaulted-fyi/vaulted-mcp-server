import open from "open";
import { importKey, decrypt, unwrapKeyWithPassphrase } from "@vaulted/crypto";
import { retrieveSecret, ApiError } from "../api-client.js";
import { successResult, errorResult } from "../errors.js";
import { config } from "../config.js";
import { parseVaultedUrl } from "../url-parser.js";

export const VIEW_SECRET_DESCRIPTION =
  "Retrieve and decrypt a secret from a Vaulted secure link. The secret may have view limits and will be destroyed after the maximum views are reached. By default opens in the browser for security — use output_mode to copy to clipboard, save to file, or return directly.";

export interface ViewSecretParams {
  url?: string;
  secret_id?: string;
  encryption_key?: string;
  output_mode?: "browser" | "direct" | "clipboard" | "file";
  passphrase?: string;
  file_path?: string;
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
  if (params.output_mode === "clipboard" || params.output_mode === "file") {
    return errorResult(
      "INVALID_INPUT",
      `${params.output_mode} output mode is not yet supported`,
      "Use browser (default) or direct mode",
    );
  }

  const resolved = resolveIdAndKey(params);
  if ("content" in resolved) return resolved;

  const { id, key } = resolved;
  const mode = params.output_mode ?? "browser";

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
          "The secret is no longer available (expired or all views consumed)",
          "Ask the sender for a new link",
        );
      }
      if (err.code === "API_UNREACHABLE") {
        return errorResult(
          "API_UNREACHABLE",
          "Unable to reach the Vaulted API",
          "Check your network connection and try again",
        );
      }
    }
    return errorResult(
      "API_UNREACHABLE",
      "Unexpected error retrieving the secret",
      "Try again. If the problem persists, open the URL in a browser.",
    );
  }

  if (apiResponse.hasPassphrase && !params.passphrase) {
    return errorResult(
      "PASSPHRASE_REQUIRED",
      "This secret is passphrase-protected",
      "Provide the passphrase via the 'passphrase' parameter",
    );
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
      "Failed to decrypt the secret",
      params.passphrase
        ? "Check that the passphrase is correct and the URL is complete"
        : "Check that the URL is complete, including the fragment after '#'",
    );
  }

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
