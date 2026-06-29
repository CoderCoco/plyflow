import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['@plyflow/source'] },
  ssr: { resolve: { conditions: ['@plyflow/source'] } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
