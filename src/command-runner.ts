import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runCommand(
  command: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, { shell: true, timeout: timeoutMs });
}
