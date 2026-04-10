import { resolve } from "node:path";
import { parseConfig } from "./config.js";

describe("parseConfig", () => {
  it("defaults baseUrl to https://vaulted.fyi when no args provided", () => {
    const config = parseConfig([]);
    expect(config.baseUrl).toBe("https://vaulted.fyi");
  });

  it("overrides baseUrl with --base-url flag", () => {
    const config = parseConfig(["--base-url", "https://custom.vaulted.dev"]);
    expect(config.baseUrl).toBe("https://custom.vaulted.dev");
  });

  it("defaults allowedDirs to empty array when not provided", () => {
    const config = parseConfig([]);
    expect(config.allowedDirs).toEqual([]);
  });

  it("parses --allowed-dirs with a single path", () => {
    const config = parseConfig(["--allowed-dirs", "/tmp/secrets"]);
    expect(config.allowedDirs).toEqual([resolve("/tmp/secrets")]);
  });

  it("parses --allowed-dirs with comma-separated multiple paths", () => {
    const config = parseConfig(["--allowed-dirs", "/tmp/secrets,/home/user/keys"]);
    expect(config.allowedDirs).toEqual([resolve("/tmp/secrets"), resolve("/home/user/keys")]);
  });

  it("resolves relative paths in --allowed-dirs to absolute paths", () => {
    const config = parseConfig(["--allowed-dirs", "./relative/path"]);
    expect(config.allowedDirs).toEqual([resolve("./relative/path")]);
  });

  it("trims whitespace around comma-separated paths", () => {
    const config = parseConfig(["--allowed-dirs", "/tmp/secrets , /home/user/keys"]);
    expect(config.allowedDirs).toEqual([resolve("/tmp/secrets"), resolve("/home/user/keys")]);
  });

  it("ignores unknown flags without throwing", () => {
    const config = parseConfig([
      "--unknown-flag",
      "value",
      "--base-url",
      "https://test.example.com",
    ]);
    expect(config.baseUrl).toBe("https://test.example.com");
  });

  it("falls back to default baseUrl when --base-url is an invalid URL", () => {
    const config = parseConfig(["--base-url", "not-a-url"]);
    expect(config.baseUrl).toBe("https://vaulted.fyi");
  });

  it("falls back to default baseUrl when --base-url is empty string", () => {
    const config = parseConfig(["--base-url", ""]);
    expect(config.baseUrl).toBe("https://vaulted.fyi");
  });

  it("filters out empty segments from --allowed-dirs", () => {
    const config = parseConfig(["--allowed-dirs", "/tmp,,/home"]);
    expect(config.allowedDirs).toEqual([resolve("/tmp"), resolve("/home")]);
  });

  it("filters out empty segment from trailing comma in --allowed-dirs", () => {
    const config = parseConfig(["--allowed-dirs", "/tmp/secrets,"]);
    expect(config.allowedDirs).toEqual([resolve("/tmp/secrets")]);
  });
});

describe("config export", () => {
  it("exports a config object with the expected shape", async () => {
    const { config } = await import("./config.js");
    expect(config).toBeDefined();
    expect(typeof config.baseUrl).toBe("string");
    expect(Array.isArray(config.allowedDirs)).toBe(true);
  });
});
