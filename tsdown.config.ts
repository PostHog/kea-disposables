import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  // Dual ESM + CJS: kea plugins get pulled into Jest/CJS test setups as often as into
  // bundlers, and an ESM-only build makes those consumers reach for a dynamic import.
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  // kea is a peer dependency — never bundle it.
  deps: { neverBundle: ['kea'] },
})
