import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: "esm",
  platform: "node",
  unbundle: true,
  fixedExtension: false,
  dts: true,
  sourcemap: true,
  outDir: "dist",
  deps: {
    skipNodeModulesBundle: true,
  },
});
