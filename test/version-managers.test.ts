import { describe, it, expect } from "vitest";
import {
  pickNodeManager,
  pickPythonManager,
  nodeInstallCommand,
  pythonInstallCommand,
  type AvailableManagers,
} from "../src/version-managers.js";

const none: AvailableManagers = { mise: false, asdf: false, fnm: false, volta: false };

describe("pickNodeManager — priority order mise > asdf > fnm > volta", () => {
  it("returns null when none present", () => {
    expect(pickNodeManager(none)).toBeNull();
  });
  it("picks mise when present (highest priority)", () => {
    expect(pickNodeManager({ ...none, mise: true, asdf: true, fnm: true, volta: true })).toBe("mise");
  });
  it("picks asdf when mise absent", () => {
    expect(pickNodeManager({ ...none, asdf: true, fnm: true })).toBe("asdf");
  });
  it("picks fnm when mise + asdf absent", () => {
    expect(pickNodeManager({ ...none, fnm: true, volta: true })).toBe("fnm");
  });
  it("picks volta as last resort", () => {
    expect(pickNodeManager({ ...none, volta: true })).toBe("volta");
  });
});

describe("pickPythonManager — only mise + asdf qualify", () => {
  it("picks mise over asdf", () => {
    expect(pickPythonManager({ ...none, mise: true, asdf: true })).toBe("mise");
  });
  it("falls back to asdf when no mise", () => {
    expect(pickPythonManager({ ...none, asdf: true })).toBe("asdf");
  });
  it("does NOT pick fnm or volta (Node-only)", () => {
    expect(pickPythonManager({ ...none, fnm: true, volta: true })).toBeNull();
  });
});

describe("nodeInstallCommand — idempotent shell commands", () => {
  it("mise uses install + use --global", () => {
    expect(nodeInstallCommand("mise", "20.11.1")).toContain("mise install node@20.11.1");
    expect(nodeInstallCommand("mise", "20.11.1")).toContain("mise use --global");
  });
  it("asdf adds plugin defensively + sets global", () => {
    const cmd = nodeInstallCommand("asdf", "20.11.1");
    expect(cmd).toContain("asdf plugin add nodejs");
    expect(cmd).toContain("asdf install nodejs 20.11.1");
    expect(cmd).toContain("asdf global nodejs 20.11.1");
  });
  it("fnm uses install + use", () => {
    expect(nodeInstallCommand("fnm", "20")).toBe("fnm install 20 && fnm use 20");
  });
  it("volta uses volta install node@", () => {
    expect(nodeInstallCommand("volta", "20.11.1")).toBe("volta install node@20.11.1");
  });
});

describe("pythonInstallCommand", () => {
  it("mise install + use", () => {
    expect(pythonInstallCommand("mise", "3.12.4")).toContain("mise install python@3.12.4");
  });
  it("asdf plugin + install + global", () => {
    const cmd = pythonInstallCommand("asdf", "3.12.4");
    expect(cmd).toContain("asdf plugin add python");
    expect(cmd).toContain("asdf install python 3.12.4");
  });
  it("throws for unsupported managers", () => {
    expect(() => pythonInstallCommand("fnm", "3.12")).toThrow();
    expect(() => pythonInstallCommand("volta", "3.12")).toThrow();
  });
});
