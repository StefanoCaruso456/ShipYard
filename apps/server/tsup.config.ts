import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  sourcemap: true,
  clean: true,
  noExternal: ["@shipyard/shared", "@shipyard/agent-core"]
});

