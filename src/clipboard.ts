import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";

function spawnAndPipe(cmd: string, args: string[], text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = execFile(cmd, args, (error) => {
        if (error) {
          reject(new Error(`Clipboard copy via ${cmd} failed: ${error.message}`));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(new Error(`Clipboard copy via ${cmd} failed: ${(err as Error).message}`));
      return;
    }

    child.on?.("error", (err) => {
      reject(new Error(`Clipboard copy via ${cmd} failed: ${err.message}`));
    });

    if (child.stdin) {
      child.stdin.on("error", () => {
        // child likely exited early; execFile callback will surface the real error
      });
      child.stdin.write(text);
      child.stdin.end();
    }
  });
}

export async function copyToClipboard(text: string): Promise<void> {
  const platform = process.platform;

  if (platform === "darwin") {
    return spawnAndPipe("pbcopy", [], text);
  }

  if (platform === "linux") {
    let xclipErr: Error | undefined;
    try {
      await spawnAndPipe("xclip", ["-selection", "clipboard"], text);
      return;
    } catch (err) {
      xclipErr = err as Error;
    }
    try {
      await spawnAndPipe("xsel", ["--clipboard", "--input"], text);
      return;
    } catch (xselErr) {
      throw new Error(
        `No clipboard tool available. Install xclip or xsel. ` +
          `xclip: ${xclipErr.message}; xsel: ${(xselErr as Error).message}`,
        { cause: xselErr },
      );
    }
  }

  if (platform === "win32") {
    return spawnAndPipe(
      "powershell.exe",
      ["-noprofile", "-command", "Set-Clipboard -Value $input"],
      text,
    );
  }

  throw new Error(`Unsupported platform for clipboard operations: ${platform}`);
}
