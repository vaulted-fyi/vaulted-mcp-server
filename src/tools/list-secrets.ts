import { readHistory, type HistoryEntry } from "../history.js";
import { checkSecretStatus, type SecretStatusResponse } from "../api-client.js";
import { successResult } from "../errors.js";

type EnrichedEntry = HistoryEntry & {
  views: number | null;
  status: "active" | "destroyed";
  expiresAt: string | null;
};

export async function listSecretsHandler() {
  const entries = await readHistory();

  if (entries.length === 0) {
    return successResult(
      [],
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
      } catch {
        return {
          ...entry,
          views: null,
          status: "destroyed" as const,
          expiresAt: null,
        };
      }
    }),
  );

  return successResult(enriched, `Found ${enriched.length} secret(s) in history.`);
}
