import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Run test files sequentially so they don't share DB state
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-jwt-secret',
      DATABASE_URL:
        'postgresql://howinlens:howinlens@localhost:5432/howinlens_test',
    },
  },
});
