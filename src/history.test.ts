import { tmpdir } from "node:os";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";

const testDir = path.join(tmpdir(), `vaulted-test-${Date.now()}`);
const testFile = path.join(testDir, "history.json");

vi.mock("./config.js", () => ({
  config: {
    baseUrl: "https://vaulted.fyi",
    allowedDirs: [],
    historyFile: testFile,
  },
}));

const { appendHistory, readHistory } = await import("./history.js");

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("readHistory", () => {
  it("returns [] when history file does not exist", async () => {
    const result = await readHistory();
    expect(result).toEqual([]);
  });

  it("returns parsed entries from existing file", async () => {
    await mkdir(testDir, { recursive: true });
    const entries = [
      {
        id: "abc",
        statusToken: "tok",
        createdAt: "2026-04-18T10:00:00Z",
        maxViews: 1,
        expiry: "24h",
      },
    ];
    const { writeFile } = await import("node:fs/promises");
    await writeFile(testFile, JSON.stringify(entries), "utf-8");

    const result = await readHistory();
    expect(result).toEqual(entries);
  });
});

describe("appendHistory", () => {
  it("creates the directory and writes a new history file", async () => {
    const entry = {
      id: "id1",
      statusToken: "tok1",
      createdAt: "2026-04-18T10:00:00Z",
      maxViews: 3,
      expiry: "7d",
    };

    await appendHistory(entry);

    const result = await readHistory();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(entry);
  });

  it("appends to an existing history file without overwriting", async () => {
    const first = {
      id: "first",
      statusToken: "tok1",
      createdAt: "2026-04-17T10:00:00Z",
      maxViews: 1,
      expiry: "24h",
    };
    const second = {
      id: "second",
      statusToken: "tok2",
      createdAt: "2026-04-18T10:00:00Z",
      maxViews: 5,
      expiry: "7d",
      label: "stripe",
    };

    await appendHistory(first);
    await appendHistory(second);

    const result = await readHistory();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(first);
    expect(result[1]).toEqual(second);
  });

  it("stores only metadata — no encryption keys or ciphertext fields", async () => {
    const entry = {
      id: "safe-id",
      statusToken: "safe-tok",
      createdAt: "2026-04-18T10:00:00Z",
      maxViews: 1,
      expiry: "24h",
    };

    await appendHistory(entry);
    const result = await readHistory();

    expect(result[0]).not.toHaveProperty("content");
    expect(result[0]).not.toHaveProperty("encryptionKey");
    expect(result[0]).not.toHaveProperty("ciphertext");
    expect(result[0]).not.toHaveProperty("url");
  });
});
