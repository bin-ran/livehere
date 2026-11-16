#!/usr/bin/env node
import path from 'node:path';
import pc from 'picocolors';
import { defineCommand, runMain } from 'citty';
import pkg from '../package.json' with { type: 'json' };
import { loadConfig } from './config';
import { createServer, type ServerHandle } from './server';
import type { Plugin } from './plugin';
import { openBrowser } from './open';

const command = defineCommand({
  meta: {
    name: 'livehere',
    version: pkg.version,
    description: '轻量、默认安全的静态文件服务器',
  },
  args: {
    root: {
      type: 'positional',
      description: '要服务的目录（默认当前目录）',
      required: false,
    },
    dir: {
      type: 'string',
      alias: 'd',
      description: '同 [root]，方便脚本使用',
    },
    port: {
      type: 'string',
      alias: 'p',
      description: '端口；填 auto 时被占用会自动顺延（默认 8000，可写在配置文件里）',
    },
    host: {
      type: 'string',
      description: '监听地址（默认 127.0.0.1，仅本机可访问）',
    },
    config: {
      type: 'string',
      description: '配置文件路径（默认在 ROOT 下查找 livehere.config.*）',
    },
    fallback: {
      type: 'string',
      alias: 'f',
      description: 'history fallback 入口，例如 -f /index.html',
    },
    cors: {
      type: 'string',
      description: "开启 CORS，可指定 origin；留空表示 '*'",
    },
    log: {
      type: 'boolean',
      alias: 'l',
      description: '打印访问日志',
    },
    listing: {
      type: 'boolean',
      description: '目录列表（默认开启，关闭用 --no-listing）',
      negativeDescription: '关闭目录列表',
    },
    silent: {
      type: 'boolean',
      alias: 's',
      default: false,
      description: '不自动打开浏览器',
    },
    watch: {
      type: 'boolean',
      alias: 'w',
      description: '监听文件变化并自动刷新浏览器',
    },
    poll: {
      type: 'boolean',
      description: '用轮询方式监听（Docker / WSL / 网络盘）',
    },
    proxy: {
      type: 'string',
      alias: 'x',
      description: '反向代理：http://host:7000/api、配置文件或 webpack.config.js',
    },
    https: {
      type: 'boolean',
      description: '额外开启 https（自签证书，可用 --cert/--key 覆盖）',
    },
    'https-port': {
      type: 'string',
      description: 'https 端口（默认 http 端口 + 1）',
    },
    cert: {
      type: 'string',
      description: 'https 证书路径（与 --key 同时提供）',
    },
    key: {
      type: 'string',
      description: 'https 私钥路径（与 --cert 同时提供）',
    },
  },
  async run({ args }) {
    try {
      const cliRoot = args.root ?? args.dir;
      const { config, file } = await loadConfig({
        root: path.resolve(cliRoot ?? process.cwd()),
        explicit: asString(args.config),
      });

      const plugins: Plugin[] = [...(config.plugins ?? [])];
      const proxy = asString(args.proxy);
      if (proxy !== undefined) {
        const { proxyPlugin } = await import('./proxy');
        plugins.push(proxyPlugin({ config: proxy }));
      }
      const watch = asBoolean(args.watch) === true;
      if (watch) {
        const { livePlugin } = await import('./live');
        plugins.push(livePlugin({ poll: asBoolean(args.poll) === true }));
      }

      const handle = await createServer({
        ...config,
        ...omitUndefined({
          root: cliRoot,
          port: parsePortOption(args.port),
          host: asString(args.host),
          fallback: asString(args.fallback),
          cors: readCors(args.cors),
          listing: asBoolean(args.listing),
          log: asBoolean(args.log),
          https: asBoolean(args.https),
          httpsPort: parsePortOption(args['https-port']),
          cert: asString(args.cert),
          key: asString(args.key),
        }),
        plugins,
      });

      printBanner(handle, asString(args.host) ?? config.host, {
        watching: watch,
        configFile: file,
      });
      if (asBoolean(args.silent) !== true) openBrowser(handle.url);
      waitForSignal(handle);
    } catch (error) {
      // citty 默认会把原始错误对象整段打印出来，这里换成一行可读信息
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${pc.red('错误')} ${message}
`);
      process.exit(1);
    }
  },
});

/** 只把「用户真的传了值」的字段交给 createServer，避免 CLI 默认值盖掉配置文件 */
function omitUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) result[key as keyof T] = value as T[keyof T];
  }
  return result;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** `--cors` 不带值时 citty 给 true，带值时给字符串 */
function readCors(value: unknown): boolean | string | undefined {
  if (typeof value === 'boolean') return value;
  return asString(value);
}

function parsePortOption(value: unknown): number | 'auto' | undefined {
  const raw = asString(value);
  return raw === undefined ? undefined : parsePort(raw);
}

function parsePort(raw: string): number | 'auto' {
  if (raw === '') return 8000;
  const trimmed = raw.trim();
  if (trimmed === 'auto') return 'auto';
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`端口不合法：${trimmed}（应为 0-65535 或 auto）`);
  }
  return port;
}

function printBanner(
  handle: ServerHandle,
  host: string | undefined,
  extras: { watching?: boolean; configFile?: string } = {},
): void {
  const lines = [`${pc.green('livehere')} ${pc.dim(`v${pkg.version}`)}`];
  lines.push(`  ${pc.bold('HTTP')}  ${pc.cyan(handle.url)}`);
  for (const url of handle.urls.slice(1)) {
    lines.push(`        ${pc.cyan(url)}`);
  }
  if (handle.httpsUrl !== undefined) {
    lines.push(
      `  ${pc.bold('HTTPS')} ${pc.cyan(handle.httpsUrl)} ${pc.dim('(自签证书，浏览器需手动信任)')}`,
    );
  }
  if (extras.watching === true) {
    lines.push(pc.dim('  已开启 live reload：保存文件后浏览器自动刷新'));
  }
  if (extras.configFile !== undefined) {
    lines.push(pc.dim(`  config: ${extras.configFile}`));
  }
  if (host === undefined || host === '127.0.0.1' || host === 'localhost') {
    lines.push(pc.dim('  仅本机可访问；需要局域网访问请加 --host 0.0.0.0'));
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

function waitForSignal(handle: ServerHandle): void {
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void handle.close().then(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

await runMain(command).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${pc.red('错误')} ${message}\n`);
  process.exit(1);
});
