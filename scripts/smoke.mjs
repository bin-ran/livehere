#!/usr/bin/env node
/**
 * 发布前冒烟测试：用真实产物（dist/cli.mjs）起一个服务，验证
 * 1) 配置文件能被加载   2) CLI 参数能覆盖配置   3) 静态/列表/CORS 行为正确
 * 用法：npm run smoke（需要先 npm run build）
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdir, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CLI = path.resolve(import.meta.dirname, '..', 'dist', 'cli.mjs');

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${name}${condition ? '' : ` — ${detail}`}`);
}

/** 用裸 http.request 发请求：fetch 会在客户端就把 %2e%2e 规范化掉 */
function rawGet(base, requestPath) {
  const target = new URL(base);
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: target.hostname, port: target.port, path: requestPath, method: 'GET' },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function waitFor(pattern, stream, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`等待输出超时：${pattern}`));
    }, timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const match = pattern.exec(buffer);
      if (match) {
        cleanup();
        resolve(match);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      stream.off('data', onData);
    };
    stream.on('data', onData);
  });
}

const root = await mkdtemp(path.join(os.tmpdir(), 'livehere-smoke-'));
await mkdir(path.join(root, 'sub'));
await writeFile(path.join(root, 'a.txt'), 'hello smoke');
await writeFile(path.join(root, 'sub', 'b.txt'), 'nested');
await writeFile(path.join(root, 'custom.config.json'), '{ "port": 0, "listing": true }\n');
await writeFile(
  path.join(root, 'livehere.config.mjs'),
  'export default { port: 0, listing: false, cors: true };\n',
);

let child;
let exitCode = 1;
try {
  child = spawn(process.execPath, [CLI, root, '-s'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const match = await waitFor(/http:\/\/127\.0\.0\.1:(\d+)\//, child.stdout);
  const base = match[0];
  check('配置文件生效（port: 0 → 系统分配）', true);

  const file = await fetch(`${base}a.txt`);
  check('静态文件 200', file.status === 200 && (await file.text()) === 'hello smoke');

  const listing = await fetch(base);
  check('配置里的 listing: false 生效', listing.status === 404, `got ${listing.status}`);

  const cors = await fetch(`${base}a.txt`);
  check(
    '配置里的 cors: true 生效',
    cors.headers.get('access-control-allow-origin') === '*',
    String(cors.headers.get('access-control-allow-origin')),
  );

  const traversal = await rawGet(base, '/%2e%2e/%2e%2e/etc/passwd');
  check('目录穿越被拦截', traversal === 403, `got ${traversal}`);

  // CLI 覆盖配置：--listing 打开目录列表
  const override = spawn(process.execPath, [CLI, root, '-s', '-p', '0', '--listing'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const second = await waitFor(/http:\/\/127\.0\.0\.1:(\d+)\//, override.stdout);
  const overrideListing = await fetch(second[0]);
  check('CLI 参数覆盖配置文件', overrideListing.status === 200, `got ${overrideListing.status}`);
  override.kill('SIGTERM');

  // --config 显式指定配置文件
  const explicit = spawn(process.execPath, [CLI, root, '-s', '--config', 'custom.config.json'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const third = await waitFor(/http:\/\/127\.0\.0\.1:(\d+)\//, explicit.stdout);
  const explicitListing = await fetch(third[0]);
  check(
    '--config 显式指定配置文件',
    explicitListing.status === 200,
    `got ${explicitListing.status}`,
  );
  explicit.kill('SIGTERM');

  const version = spawn(process.execPath, [CLI, '--version'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const versionMatch = await waitFor(/(\d+\.\d+\.\d+)/, version.stdout);
  check('--version 正常', Boolean(versionMatch[1]), versionMatch?.[1]);

  exitCode = checks.every((item) => item.ok) ? 0 : 1;
} catch (error) {
  console.error(`\n冒烟测试异常：${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  child?.kill('SIGTERM');
  for (const file of [
    'a.txt',
    path.join('sub', 'b.txt'),
    'livehere.config.mjs',
    'custom.config.json',
  ]) {
    await rm(path.join(root, file), { force: true });
  }
  await rmdir(path.join(root, 'sub'));
  await rmdir(root);
}

const failed = checks.filter((item) => !item.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} 项通过`);
process.exit(exitCode);
