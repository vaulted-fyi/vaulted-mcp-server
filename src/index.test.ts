import { VERSION } from "./index.js";

describe("project setup", () => {
  it("exports a version string", () => {
    expect(VERSION).toBe("0.1.0");
  });
});
