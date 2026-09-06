import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  dts: false,
  sourcemap: true,
  clean: true,
  define: {
    CURRENT_VERSION: JSON.stringify(pkg.version),
  },
  // Keep the two upstream projects external: the shipped extension must load
  // them from node_modules at runtime, where postinstall applies the one
  // patch we maintain. Bundling would freeze them at OUR build time and
  // silently break the "follow upstream" contract.
  external: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
    "billion-context-pi",
    "headroom-ai",
  ],
  noExternal: ["typebox"],
});
