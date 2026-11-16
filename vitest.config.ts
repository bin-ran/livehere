import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // e2e 会真的监听本地端口，串行执行更稳定
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
