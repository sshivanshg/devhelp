import { describe, it, expect } from "vitest";
import { composeUpCommand } from "../src/setup.js";

describe("composeUpCommand", () => {
  it("adds --wait for Compose v2", () => {
    expect(composeUpCommand("docker compose", "docker-compose.yml", true)).toBe(
      "docker compose -f docker-compose.yml up -d --wait",
    );
  });

  it("omits --wait for legacy v1 docker-compose", () => {
    expect(composeUpCommand("docker-compose", "docker-compose.yml", false)).toBe(
      "docker-compose -f docker-compose.yml up -d",
    );
  });
});
