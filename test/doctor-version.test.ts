import { describe, it, expect } from "vitest";
import { versionStatus } from "../src/setup.js";

describe("versionStatus", () => {
  it("missing when nothing is installed", () => {
    expect(versionStatus("20", null)).toBe("missing");
  });

  it("ok when the wanted major matches", () => {
    expect(versionStatus("20", "v20.20.2")).toBe("ok");
    expect(versionStatus("3.13", "Python 3.13.1")).toBe("ok");
    expect(versionStatus("1.25", "go version go1.25.0 darwin/arm64")).toBe("ok");
  });

  it("mismatch when the wanted major differs", () => {
    expect(versionStatus("20", "v18.19.0")).toBe("mismatch");
    expect(versionStatus("3.13", "Python 3.11.4")).toBe("mismatch");
  });

  it("ok (present) for non-numeric specs that can't be compared", () => {
    expect(versionStatus("lts/*", "v20.0.0")).toBe("ok");
    expect(versionStatus("stable", "rustc 1.79.0")).toBe("ok");
    expect(versionStatus(undefined, "10.8.2")).toBe("ok");
  });

  it("does not flag when installed version is coarser than wanted", () => {
    // want major.minor but have only reports a major — can't disprove
    expect(versionStatus("3.13", "Python 3")).toBe("ok");
  });

  it("treats a >= floor as satisfied by any newer runtime", () => {
    // Regression: engines ">=18" + installed v20 must not be a mismatch.
    expect(versionStatus(">=18", "v20.20.2")).toBe("ok");
    expect(versionStatus(">=18", "v18.19.0")).toBe("ok");
    expect(versionStatus(">=3.9", "Python 3.13.1")).toBe("ok");
  });

  it("flags a >= floor only when installed is strictly below it", () => {
    expect(versionStatus(">=18", "v16.20.0")).toBe("mismatch");
    expect(versionStatus(">=20.11", "v20.9.0")).toBe("mismatch");
  });
});
