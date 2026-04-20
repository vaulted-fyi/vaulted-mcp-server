import { checkSecretStatus, ApiError } from "../api-client.js";
import { successResult, errorResult } from "../errors.js";

interface CheckStatusParams {
  url?: string;
  secret_id?: string;
  status_token?: string;
  previousViews?: number;
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function extractIdFromStatusPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);

  if (parts.length === 3 && parts[0] === "s" && parts[2] === "status") {
    return parts[1];
  }

  if (parts.length === 4 && parts[0] === "api" && parts[1] === "secrets" && parts[3] === "status") {
    return parts[2];
  }

  return null;
}

function resolveIdAndToken(
  params: CheckStatusParams,
): { id: string; token: string } | ReturnType<typeof errorResult> {
  if (params.url) {
    let parsed: URL;
    try {
      parsed = new URL(params.url);
    } catch {
      return errorResult(
        "INVALID_INPUT",
        "The provided URL is not valid",
        "Provide a valid status URL or use secret_id + status_token parameters",
      );
    }

    const id = extractIdFromStatusPath(parsed.pathname);
    const token = parsed.searchParams.get("token");
    if (!id) {
      return errorResult(
        "INVALID_INPUT",
        "URL does not contain a valid status path",
        "Expected /s/<secretId>/status or /api/secrets/<secretId>/status",
      );
    }
    if (!isNonEmptyString(token)) {
      return errorResult(
        "INVALID_INPUT",
        "Status token is required",
        "Provide a valid status URL or use secret_id + status_token parameters",
      );
    }
    return { id, token };
  }

  if (isNonEmptyString(params.secret_id) && isNonEmptyString(params.status_token)) {
    return { id: params.secret_id, token: params.status_token };
  }

  return errorResult(
    "INVALID_INPUT",
    "Either 'url' or both 'secret_id' and 'status_token' are required",
    "Provide the status URL from when the secret was created, or provide secret_id and status_token together",
  );
}

function buildStatusMessage(
  data: { views: number; maxViews: number; status: string; expiresAt: string | null },
  previousViews?: number,
): string {
  const parts: string[] = [];

  if (previousViews !== undefined && data.views > previousViews) {
    parts.push(`New view detected! View count increased from ${previousViews} to ${data.views}.`);
  }

  if (data.status === "destroyed" && data.views === 0) {
    parts.push(
      "Your secret expired before being viewed. Consider creating a new one with a longer expiry.",
    );
  } else if (data.status === "destroyed" || data.views >= data.maxViews) {
    parts.push("Your secret has been fully consumed — all views used.");
  } else {
    parts.push(
      `Secret has been viewed ${data.views}/${data.maxViews} times. Still active.`,
      "Check again later to see if it's been consumed.",
    );
  }

  return parts.join(" ");
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
      buildStatusMessage(data, params.previousViews),
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
