import { describe, it, expect } from "vitest";
import { dispatch } from "../src/mcp.js";

describe("mcp dispatch", () => {
  it("initialize returns protocol version + serverInfo", async () => {
    const r = (await dispatch("initialize", { protocolVersion: "2024-11-05" })) as any;
    expect(r.protocolVersion).toBe("2024-11-05");
    expect(r.serverInfo.name).toBe("devhelp");
    expect(r.capabilities.tools).toBeDefined();
  });

  it("tools/list exposes detect and doctor", async () => {
    const r = (await dispatch("tools/list", {})) as any;
    const names = r.tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(["detect", "doctor"]));
    for (const t of r.tools) expect(t.inputSchema.type).toBe("object");
  });

  it("tools/call detect returns a text content block", async () => {
    const r = (await dispatch("tools/call", { name: "detect", arguments: { cwd: process.cwd() } })) as any;
    expect(r.content[0].type).toBe("text");
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed).toHaveProperty("detected");
    expect(parsed).toHaveProperty("summary");
  });

  it("unknown method rejects", async () => {
    await expect(dispatch("bogus/method", {})).rejects.toThrow(/method not found/);
  });

  it("unknown tool rejects", async () => {
    await expect(dispatch("tools/call", { name: "nope", arguments: {} })).rejects.toThrow(/unknown tool/);
  });
});
