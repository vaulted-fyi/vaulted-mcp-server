export type ParseResult =
  | { success: true; id: string; key: string }
  | { success: false; code: "INVALID_INPUT"; message: string; suggestion: string };

export function parseVaultedUrl(url: string): ParseResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      success: false,
      code: "INVALID_INPUT",
      message: "Invalid URL format",
      suggestion: "Provide a valid Vaulted URL like https://vaulted.fyi/s/abc123#key",
    };
  }

  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  const sIndex = pathSegments.indexOf("s");
  if (sIndex === -1 || sIndex >= pathSegments.length - 1) {
    return {
      success: false,
      code: "INVALID_INPUT",
      message: "URL does not contain a valid secret path (/s/<id>)",
      suggestion: "Provide a URL with the format https://vaulted.fyi/s/<secretId>#<key>",
    };
  }

  const id = pathSegments[sIndex + 1];
  const key = parsed.hash.slice(1);

  if (!key) {
    return {
      success: false,
      code: "INVALID_INPUT",
      message: "URL is missing the encryption key fragment",
      suggestion: "Provide the full URL including the # fragment with the encryption key",
    };
  }

  return { success: true, id, key };
}
