import { defineConfig } from 'vitest/config';
// The @plyflow/source resolve condition makes workspace deps (@plyflow/core,
// @plyflow/testing) resolve to their TS source during tests — required, since
// their package.json `exports` gate source behind that condition.
export default defineConfig({
  ssr: { resolve: { conditions: ['@plyflow/source'] } },
  test: { environment: 'node' },
});
