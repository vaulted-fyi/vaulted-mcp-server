import { generateKey, exportKey, encrypt, wrapKeyWithPassphrase } from "@vaulted/crypto";
import { createSecret, ApiError } from "../api-client.js";
import { appendHistory } from "../history.js";
import { successResult, errorResult } from "../errors.js";
import { config } from "../config.js";

export const EXPIRY_TO_TTL: Record<string, number> = {
  "1h": 3600,
  "2h": 7200,
  "6h": 21600,
  "12h": 43200,
  "24h": 86400,
  "3d": 259200,
  "7d": 604800,
  "14d": 1209600,
  "30d": 2592000,
};

export const VALID_MAX_VIEWS = [1, 3, 5, 10] as const;

const VALID_EXPIRY_VALUES = Object.keys(EXPIRY_TO_TTL);

export async function handleCreateSecret(params: {
  content: string;
  max_views?: string;
  expiry?: string;
  passphrase?: string;
  label?: string;
}): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  if (!params.content || params.content.length === 0) {
    return errorResult(
      "INVALID_INPUT",
      "Content is required",
      "Provide the secret content to share",
    );
  }
  if (params.content.length > 1000) {
    return errorResult(
      "INVALID_INPUT",
      "Content exceeds 1000 character limit",
      "Shorten the content to 1000 characters or less",
    );
  }

  if (params.passphrase !== undefined && params.passphrase.length === 0) {
    return errorResult(
      "INVALID_INPUT",
      "Passphrase cannot be empty",
      "Provide a non-empty passphrase, or omit it to create a secret without passphrase protection",
    );
  }

  const maxViews = params.max_views ? Number(params.max_views) : 1;
  if (!VALID_MAX_VIEWS.includes(maxViews as (typeof VALID_MAX_VIEWS)[number])) {
    return errorResult(
      "INVALID_INPUT",
      `Invalid max_views: ${params.max_views}. Must be one of: ${VALID_MAX_VIEWS.join(", ")}`,
      "Choose a valid max_views value: 1, 3, 5, or 10",
    );
  }

  const expiry = params.expiry ?? "24h";
  if (!VALID_EXPIRY_VALUES.includes(expiry)) {
    return errorResult(
      "INVALID_INPUT",
      `Invalid expiry: ${expiry}. Must be one of: ${VALID_EXPIRY_VALUES.join(", ")}`,
      "Choose a valid expiry value like 1h, 24h, 7d, or 30d",
    );
  }

  const ttl = EXPIRY_TO_TTL[expiry];

  let key: CryptoKey;
  let ciphertext: string;
  let iv: string;
  let fragment: string;
  let passphraseProtected = false;

  try {
    key = await generateKey();
    const encrypted = await encrypt(params.content, key);
    ciphertext = encrypted.ciphertext;
    iv = encrypted.iv;

    if (params.passphrase) {
      const wrapped = await wrapKeyWithPassphrase(key, params.passphrase);
      fragment = `${wrapped.wrappedKey}.${wrapped.salt}`;
      passphraseProtected = true;
    } else {
      fragment = await exportKey(key);
    }
  } catch {
    return errorResult(
      "ENCRYPTION_FAILED",
      "Failed to encrypt the secret",
      "Try again. If the problem persists, check that your Node.js version supports Web Crypto API.",
    );
  }

  try {
    const { id, statusToken } = await createSecret({
      ciphertext,
      iv,
      maxViews,
      ttl,
      hasPassphrase: passphraseProtected,
    });

    const url = `${config.baseUrl}/s/${id}#${fragment}`;
    const statusUrl = `${config.baseUrl}/s/${id}/status?token=${statusToken}`;

    void appendHistory({
      id,
      statusToken,
      createdAt: new Date().toISOString(),
      maxViews,
      expiry,
      label: params.label,
    });

    return successResult(
      {
        url,
        statusUrl,
        expiresIn: expiry,
        maxViews,
        passphraseProtected,
      },
      `Secret created successfully. Share the URL — the recipient can view it ${maxViews} time${maxViews > 1 ? "s" : ""} before it self-destructs. Expires in ${expiry}.`,
    );
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === "INVALID_INPUT") {
        const apiMessage =
          typeof err.body === "object" &&
          err.body !== null &&
          "error" in err.body &&
          typeof err.body.error === "string"
            ? err.body.error
            : err.message;
        return errorResult(
          "INVALID_INPUT",
          apiMessage,
          "Check content length, max_views, and expiry values, then try again",
        );
      }
      return errorResult(
        "API_UNREACHABLE",
        err.message,
        "Check your network connection and try again",
      );
    }
    return errorResult(
      "API_UNREACHABLE",
      "Failed to store the secret",
      "Check your network connection and try again",
    );
  }
}
