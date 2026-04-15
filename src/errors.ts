export type ErrorCode =
  | "SECRET_EXPIRED"
  | "SECRET_CONSUMED"
  | "PASSPHRASE_REQUIRED"
  | "ENV_VAR_NOT_FOUND"
  | "FILE_NOT_FOUND"
  | "FILE_READ_ERROR"
  | "PATH_TRAVERSAL_BLOCKED"
  | "DOTENV_KEY_NOT_FOUND"
  | "API_UNREACHABLE"
  | "INVALID_INPUT"
  | "ENCRYPTION_FAILED"
  | "SECRET_NOT_FOUND"
  | "API_ERROR"
  | "FILE_WRITE_ERROR";

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

interface SuccessPayload<T> {
  success: true;
  data: T;
  message: string;
}

interface ErrorPayload {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    suggestion: string;
  };
}

export function successResult<T>(data: T, message: string): ToolResult {
  const payload: SuccessPayload<T> = { success: true, data, message };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

export function errorResult(code: ErrorCode, message: string, suggestion: string): ToolResult {
  const payload: ErrorPayload = {
    success: false,
    error: { code, message, suggestion },
  };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: true,
  };
}
