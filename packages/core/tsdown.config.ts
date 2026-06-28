import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'module-loader': 'src/core/module-loader.ts',
    remote: 'src/core/remote/index.ts',
    'remote/trust': 'src/core/remote/trust.ts',
  },
  format: ['esm'],
  target: 'node24',
  dts: true,
  sourcemap: true,
  clean: true,
  fixedExtension: false,
});
