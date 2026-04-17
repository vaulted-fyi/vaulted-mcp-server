import { config } from "./config.js";
import type { ErrorCode } from "./errors.js";

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
    public readonly code: ErrorCode,
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
    const rawBody = await response.text().catch(() => null);
    let body: unknown = rawBody;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }

    const code: ErrorCode = response.status >= 500 ? "API_UNREACHABLE" : "INVALID_INPUT";
    throw new ApiError(`Vaulted API returned ${response.status}`, response.status, code, body);
  }

  const data = (await response.json()) as CreateSecretResult;
  return { id: data.id, statusToken: data.statusToken };
}

export interface RetrieveSecretResult {
  ciphertext: string;
  iv: string;
  hasPassphrase: boolean;
  viewsRemaining: number;
}

export async function retrieveSecret(id: string): Promise<RetrieveSecretResult> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/api/secrets/${id}`, {
      method: "GET",
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
    let code: ErrorCode;
    if (response.status === 404) {
      code = "SECRET_NOT_FOUND";
    } else if (response.status >= 500) {
      code = "API_UNREACHABLE";
    } else {
      code = "API_ERROR";
    }
    throw new ApiError(`Vaulted API returned ${response.status}`, response.status, code, body);
  }

  const data = (await response.json()) as RetrieveSecretResult;
  return {
    ciphertext: data.ciphertext,
    iv: data.iv,
    hasPassphrase: data.hasPassphrase,
    viewsRemaining: data.viewsRemaining,
  };
}
