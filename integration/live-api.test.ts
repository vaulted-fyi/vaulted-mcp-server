import { describe, it, expect } from "vitest";

describe("Vaulted API reachability", () => {
  it("should reach the Vaulted API and return a typed not-found error", async () => {
    const response = await fetch("https://vaulted.fyi/api/secrets/nonexistent/status", {
      redirect: "follow",
    });
    const finalUrl = new URL(response.url);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(finalUrl.hostname).toBe("www.vaulted.fyi");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.error).toBe("Secret not found or expired");
  });
});
