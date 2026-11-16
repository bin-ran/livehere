import { defineConfig } from 'tsdown';

export default defineConfig({
  // cli: 打包成单文件（除 selfsigned 外全部内联）
  // index: 编程 API，供他人 import
  entry: { cli: 'src/cli.ts', index: 'src/index.ts', live: 'src/live.ts', proxy: 'src/proxy.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
  // 运行时依赖全部打进产物，安装时只需 selfsigned（--https 才会加载）
  deps: {
    alwaysBundle: () => true,
    onlyBundle: false,
  },
  publint: true,
  attw: { profile: 'esm-only' },
});
