import { defineConfig } from 'vitest/config';
export default defineConfig({ ssr: { resolve: { conditions: ['@plyflow/source'] } }, test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] } });
