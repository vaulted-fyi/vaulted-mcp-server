import { unlink } from "node:fs/promises";

export function scheduleFileDeletion(filePath: string, ttlSeconds: number): void {
  const timer = setTimeout(() => {
    unlink(filePath).catch(() => {
      // Best-effort: file may already be deleted or path may be invalid
    });
  }, ttlSeconds * 1000);
  // unref so a pending deletion doesn't hold the MCP server process open after stdin closes
  timer.unref();
}
