import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { detect, type Detected } from "../src/detect.js";

// Regression guard for the ecosystem coverage matrix advertised in the README.
// Each fixture under test-fixtures/ should produce a stable detection. We assert
// the salient field(s) that define the ecosystem — if a detector regresses, the
// matching entry breaks here instead of silently in a real run.
//
// `framework` is checked by name; everything else is compared directly.
type Expectation = Partial<Record<keyof Detected, unknown>> & { framework?: string };

const FIXTURES_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../test-fixtures");

const CASES: Record<string, Expectation> = {
  "android-app": { javaVersion: "17", isAndroid: true, framework: "Android" },
  "ansible": { infraType: "ansible", informOnly: true },
  "asdf-project": { nodeVersion: "20.11.0", rubyVersion: "3.3.0", framework: "Rails" },
  "bazel-project": { bazelVersion: "7.0.0", framework: "Bazel monorepo" },
  "broken-python": { pythonVersion: "3.13" },
  "bun-runtime": { bunIsRuntime: true },
  "clojure-deps": { clojureVersion: "1.11.1", framework: "Compojure" },
  "clojure-lein": { clojureVersion: "1.11.1", framework: "Compojure" },
  "dart-package": { dartSdkVersion: "3.2.0", framework: "Dart" },
  "deno-app": { denoVersion: "latest", framework: "Deno" },
  "dotnet-webapi": { dotnetVersion: "8", framework: "ASP.NET Core" },
  "elixir-phoenix": { elixirVersion: "1.16.0", framework: "Phoenix" },
  "expo-app": { nodeVersion: "lts/*", isReactNative: true, isExpo: true, framework: "Expo" },
  "flutter-app": { dartSdkVersion: "3.16.0", dartIsFlutter: true, framework: "Flutter" },
  "haskell-cabal": { ghcVersion: "9.6", framework: "Haskell" },
  "haskell-stack": { ghcVersion: "9.6", framework: "Haskell" },
  "helm-chart": { infraType: "helm", informOnly: true },
  "java-spring": { javaVersion: "21", framework: "Spring Boot" },
  "julia-pkg": { juliaVersion: "1.9", framework: "Julia" },
  "kotlin-gradle": { javaVersion: "21", javaIsKotlin: true },
  "ocaml-dune": { ocamlVersion: "5.1.0", framework: "OCaml" },
  "php-laravel": { phpVersion: "8.2", framework: "Laravel" },
  "python-ci-prerelease": { pythonVersion: "3.13" },
  "php-wordpress": { phpVersion: "7.4", framework: "WordPress" },
  "r-package": { rVersion: "4.3", framework: "R" },
  "r-renv": { rVersion: "4.3", framework: "R (Shiny)" },
  "react-native": { nodeVersion: "lts/*", isReactNative: true, framework: "React Native" },
  "ruby-jekyll": { rubyVersion: "3.3.0", framework: "Jekyll" },
  "ruby-rails": { rubyVersion: "3.3.0", framework: "Rails" },
  "scala-mill": { javaVersion: "17", scalaVersion: "3.3", framework: "Scala" },
  "scala-sbt": { javaVersion: "17", scalaVersion: "3.3", framework: "Scala" },
  "swift-cocoapods": { swiftVersion: "5.9", framework: "iOS (CocoaPods)" },
  "swift-spm": { swiftVersion: "5.9", framework: "Swift Package" },
  "terraform": { infraType: "terraform", informOnly: true },
  "unsupported": { informOnly: true },
  "zig-project": { zigVersion: "0.12.0", framework: "Zig" },
};

describe("detect — fixture coverage matrix", () => {
  for (const [fixture, expected] of Object.entries(CASES)) {
    it(`detects ${fixture}`, async () => {
      const d = await detect(path.join(FIXTURES_DIR, fixture));
      for (const [key, value] of Object.entries(expected)) {
        if (key === "framework") {
          expect(d.framework?.name).toBe(value);
        } else {
          expect(d[key as keyof Detected]).toBe(value);
        }
      }
    });
  }
});
