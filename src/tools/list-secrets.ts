import { readHistory, type HistoryEntry } from "../history.js";
import { checkSecretStatus, type SecretStatusResponse, ApiError } from "../api-client.js";
import { successResult } from "../errors.js";

type EnrichedEntry = HistoryEntry & {
  views: number | null;
  status: "active" | "destroyed" | "unknown";
  expiresAt: string | null;
  statusError?: "API_UNREACHABLE" | "API_ERROR";
};

export async function listSecretsHandler() {
  const entries = await readHistory();

  if (entries.length === 0) {
    return successResult(
      { entries: [], suggestedAction: undefined },
      "No secrets shared yet. Use create_secret to share your first secret.",
    );
  }

  const sorted = [...entries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const enriched: EnrichedEntry[] = await Promise.all(
    sorted.map(async (entry) => {
      try {
        const statusData: SecretStatusResponse = await checkSecretStatus(
          entry.id,
          entry.statusToken,
        );
        return { ...entry, ...statusData };
      } catch (error) {
        if (error instanceof ApiError && error.code === "SECRET_EXPIRED") {
          return {
            ...entry,
            views: null,
            status: "destroyed" as const,
            expiresAt: null,
          };
        }

        return {
          ...entry,
          views: null,
          status: "unknown" as const,
          expiresAt: null,
          statusError:
            error instanceof ApiError && error.code === "API_UNREACHABLE"
              ? "API_UNREACHABLE"
              : "API_ERROR",
        };
      }
    }),
  );

  const unconsumedActive = enriched.filter(
    (e) => e.status === "active" && e.views !== null && e.views < e.maxViews,
  );

  const suggestedAction =
    unconsumedActive.length > 0
      ? "Some secrets haven't been viewed yet. Use check_status with the statusToken to monitor them."
      : undefined;

  return successResult(
    { entries: enriched, suggestedAction },
    `Found ${enriched.length} secret(s) in history.`,
  );
}
