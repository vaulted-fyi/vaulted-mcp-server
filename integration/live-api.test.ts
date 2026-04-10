import { describe, it, expect } from "vitest";

describe("Vaulted API reachability", () => {
  it("should reach the Vaulted API", async () => {
    const response = await fetch("https://vaulted.fyi/api/secrets/nonexistent/status");
    expect(response.status).toBe(404);
  });
});
