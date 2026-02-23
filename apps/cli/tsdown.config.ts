import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "bin/marvis": "src/bin/marvis.ts",
  },
  format: "esm",
  platform: "node",
  unbundle: true,
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  outDir: "dist",
  deps: {
    skipNodeModulesBundle: true,
  },
});
