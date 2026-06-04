import { describe, it, expect } from "vitest";
import { systemInstallCommand } from "../src/platform.js";

describe("systemInstallCommand", () => {
  it("maps openssl-dev to the right package per manager", () => {
    expect(systemInstallCommand("apt", ["openssl-dev"])).toContain("libssl-dev");
    expect(systemInstallCommand("dnf", ["openssl-dev"])).toContain("openssl-devel");
    expect(systemInstallCommand("pacman", ["openssl-dev"])).toContain("openssl");
    expect(systemInstallCommand("apk", ["openssl-dev"])).toContain("openssl-dev");
  });

  it("uses sudo + non-interactive flags on Linux managers", () => {
    expect(systemInstallCommand("apt", ["pkg-config"])).toMatch(/^sudo apt-get update && sudo apt-get install -y /);
    expect(systemInstallCommand("dnf", ["pkg-config"])).toMatch(/^sudo dnf install -y /);
    expect(systemInstallCommand("pacman", ["pkg-config"])).toMatch(/--noconfirm/);
  });

  it("does not prefix brew with sudo", () => {
    const cmd = systemInstallCommand("brew", ["openssl-dev", "pkg-config"]);
    expect(cmd).toMatch(/^brew install /);
    expect(cmd).not.toContain("sudo");
  });

  it("dedupes packages when multiple deps share words", () => {
    const cmd = systemInstallCommand("dnf", ["build-tools"])!;
    // "gcc gcc-c++ make" should not duplicate
    const gccCount = cmd.split(" ").filter((w) => w === "gcc").length;
    expect(gccCount).toBe(1);
  });

  it("returns null when no dep is packaged for the manager", () => {
    // brew has "" for build-tools (Xcode CLT handled elsewhere)
    expect(systemInstallCommand("brew", ["build-tools"])).toBeNull();
  });

  it("combines multiple deps into one install line", () => {
    const cmd = systemInstallCommand("apt", ["openssl-dev", "pkg-config"])!;
    expect(cmd).toContain("libssl-dev");
    expect(cmd).toContain("pkg-config");
  });
});
