import { runCommand } from "./command-runner.js";

describe("runCommand", () => {
  it("resolves with stdout from a successful command", async () => {
    const result = await runCommand("echo hello", 5_000);
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
  });

  it("supports pipe syntax via shell: true", async () => {
    const result = await runCommand('echo "foo bar" | tr " " "-"', 5_000);
    expect(result.stdout).toBe("foo-bar\n");
  });

  it("rejects with a non-zero exit code on failure", async () => {
    await expect(runCommand("exit 1", 5_000)).rejects.toMatchObject({ code: 1 });
  });

  it("rejects with killed: true when the timeout elapses", async () => {
    await expect(runCommand("sleep 10", 50)).rejects.toMatchObject({ killed: true });
  });
});
