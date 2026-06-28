import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node24',
  dts: false,
  sourcemap: true,
  clean: true,
  fixedExtension: false,
});
