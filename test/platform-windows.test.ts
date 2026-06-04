import { describe, it, expect } from "vitest";
import { commandExistsProbe, pickShell } from "../src/platform.js";

describe("commandExistsProbe", () => {
  it("uses `where` on Windows", () => {
    expect(commandExistsProbe("node", "win32")).toEqual({ cmd: "where", args: ["node"], shell: false });
  });
  it("uses `command -v` in a shell on POSIX", () => {
    expect(commandExistsProbe("node", "linux")).toEqual({ cmd: "command", args: ["-v", "node"], shell: true });
  });
});

describe("pickShell", () => {
  it("honors $SHELL when set", () => {
    expect(pickShell("linux", { SHELL: "/usr/bin/zsh" } as NodeJS.ProcessEnv)).toBe("/usr/bin/zsh");
    // git-bash on Windows sets SHELL too
    expect(pickShell("win32", { SHELL: "C:/Program Files/Git/bin/bash.exe" } as NodeJS.ProcessEnv)).toMatch(/bash/);
  });
  it("defaults to /bin/bash on POSIX with no $SHELL", () => {
    expect(pickShell("linux", {} as NodeJS.ProcessEnv)).toBe("/bin/bash");
  });
  it("returns null on native Windows with no bash shell", () => {
    expect(pickShell("win32", {} as NodeJS.ProcessEnv)).toBeNull();
  });
});
