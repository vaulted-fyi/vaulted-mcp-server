import { unlink } from "node:fs/promises";

export function scheduleFileDeletion(filePath: string, ttlSeconds: number): void {
  setTimeout(() => {
    unlink(filePath).catch(() => {
      // Best-effort: file may already be deleted or path may be invalid
    });
  }, ttlSeconds * 1000);
}
