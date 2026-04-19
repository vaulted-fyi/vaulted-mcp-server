import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export interface HistoryEntry {
  id: string;
  statusToken: string;
  createdAt: string;
  maxViews: number;
  expiry: string;
  label?: string;
}

export async function readHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(config.historyFile, "utf-8");
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

export async function appendHistory(entry: HistoryEntry): Promise<void> {
  const dir = path.dirname(config.historyFile);
  await mkdir(dir, { recursive: true });
  const existing = await readHistory();
  existing.push(entry);
  await writeFile(config.historyFile, JSON.stringify(existing, null, 2), "utf-8");
}
