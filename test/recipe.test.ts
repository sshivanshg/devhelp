import { describe, it, expect } from "vitest";
import { parseRecipe, recipeIsEmpty } from "../src/recipe.js";

describe("parseRecipe", () => {
  it("parses a postInstall list and command overrides", () => {
    const r = parseRecipe(
      [
        "dev: make dev",
        "test: 'make test'",
        "postInstall:",
        "  - make seed",
        "  - ./scripts/setup.sh",
      ].join("\n"),
    );
    expect(r.dev).toBe("make dev");
    expect(r.test).toBe("make test");
    expect(r.postInstall).toEqual(["make seed", "./scripts/setup.sh"]);
  });

  it("ignores comments and blank lines", () => {
    const r = parseRecipe("# a comment\n\ndev: npm run serve # inline note\n");
    // inline comment is preserved only because the value has no quotes; we strip ` #`
    expect(r.dev).toBe("npm run serve");
  });

  it("supports inline list form", () => {
    const r = parseRecipe('postInstall: ["a", "b"]');
    expect(r.postInstall).toEqual(["a", "b"]);
  });

  it("ignores unknown keys", () => {
    const r = parseRecipe("frobnicate: yes\ndev: x");
    expect(r.dev).toBe("x");
    expect((r as Record<string, unknown>).frobnicate).toBeUndefined();
  });

  it("recipeIsEmpty is true for no actionable content", () => {
    expect(recipeIsEmpty(parseRecipe("# nothing here"))).toBe(true);
    expect(recipeIsEmpty(parseRecipe("dev: x"))).toBe(false);
  });

  it("parses a notes list independently of postInstall", () => {
    const r = parseRecipe(
      [
        "notes:",
        '  - "Postgres must be running: docker compose up -d db"',
        "  - Run migrations before first boot",
        "postInstall:",
        "  - make seed",
      ].join("\n"),
    );
    expect(r.notes).toEqual([
      "Postgres must be running: docker compose up -d db",
      "Run migrations before first boot",
    ]);
    expect(r.postInstall).toEqual(["make seed"]);
  });

  it("a notes-only recipe is not empty (notes are actionable guidance)", () => {
    expect(recipeIsEmpty(parseRecipe("notes:\n  - heads up"))).toBe(false);
  });
});
