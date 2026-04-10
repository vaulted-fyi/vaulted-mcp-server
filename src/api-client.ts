import { config } from "./config.js";

export interface CreateSecretParams {
  ciphertext: string;
  iv: string;
  maxViews: number;
  ttl: number;
  hasPassphrase: boolean;
}

export interface CreateSecretResult {
  id: string;
  statusToken: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function createSecret(params: CreateSecretParams): Promise<CreateSecretResult> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/api/secrets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    throw new ApiError("Unable to reach the Vaulted API", 0, "API_UNREACHABLE");
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text().catch(() => null);
    }
    throw new ApiError(
      `Vaulted API returned ${response.status}`,
      response.status,
      "API_ERROR",
      body,
    );
  }

  const data = (await response.json()) as CreateSecretResult;
  return { id: data.id, statusToken: data.statusToken };
}
