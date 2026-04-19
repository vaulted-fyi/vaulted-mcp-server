import path from "node:path";
import os from "node:os";

const argv = process.argv.slice(2);

const historyFileIdx = argv.indexOf("--history-file");
const defaultHistoryFile = path.join(os.homedir(), ".vaulted", "history.json");

export const config = {
  baseUrl: process.env.VAULTED_BASE_URL ?? "https://vaulted.fyi",
  allowedDirs: [] as string[],
  historyFile:
    historyFileIdx !== -1 && argv[historyFileIdx + 1]
      ? path.resolve(argv[historyFileIdx + 1])
      : defaultHistoryFile,
};
