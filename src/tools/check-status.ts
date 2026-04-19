import { checkSecretStatus, ApiError } from "../api-client.js";
import { successResult, errorResult } from "../errors.js";

interface CheckStatusParams {
  url?: string;
  secret_id?: string;
  status_token?: string;
}

function resolveIdAndToken(
  params: CheckStatusParams,
): { id: string; token: string } | ReturnType<typeof errorResult> {
  if (params.url) {
    const parsed = new URL(params.url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const id = parts[parts.length - 2];
    const token = parsed.searchParams.get("token") ?? "";
    if (!id) {
      return errorResult(
        "INVALID_INPUT",
        "Could not extract secret ID from the provided URL",
        "Provide a valid status URL or use secret_id + status_token parameters",
      );
    }
    return { id, token };
  }

  if (params.secret_id && params.status_token !== undefined) {
    return { id: params.secret_id, token: params.status_token };
  }

  return errorResult(
    "INVALID_INPUT",
    "Either 'url' or both 'secret_id' and 'status_token' are required",
    "Provide the status URL from when the secret was created, or provide secret_id and status_token together",
  );
}

export async function checkStatusHandler(params: CheckStatusParams) {
  const resolved = resolveIdAndToken(params);
  if ("content" in resolved) return resolved;

  const { id, token } = resolved;

  try {
    const data = await checkSecretStatus(id, token);
    return successResult(
      {
        views: data.views,
        maxViews: data.maxViews,
        status: data.status,
        expiresAt: data.expiresAt,
      },
      `Secret has been viewed ${data.views}/${data.maxViews} times. Status: ${data.status}.`,
    );
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === "SECRET_EXPIRED" || err.status === 404) {
        return errorResult(
          "SECRET_EXPIRED",
          "This secret no longer exists",
          "This secret no longer exists. It may have expired or been destroyed.",
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
      "Unexpected error checking secret status",
      "Try again. If the problem persists, check the secret URL is valid.",
    );
  }
}
