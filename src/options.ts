import fs from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from './plugin';
import { resolveWithinRoot } from './utils/path';

export interface ServeOptions {
  /** 服务目录，默认 process.cwd() */
  root?: string;
  /** 端口；'auto' 表示被占用时自动顺延，0 表示由系统分配 */
  port?: number | 'auto';
  /** 监听地址，默认 0.0.0.0（局域网可访问）；只给本机用可传 127.0.0.1 */
  host?: string;
  /** history fallback 的入口文件；true 等价于 '/index.html' */
  fallback?: string | boolean;
  /** CORS：true 等价于 '*'，字符串表示唯一允许的 origin */
  cors?: boolean | string;
  /** 目录列表，默认 true */
  listing?: boolean;
  /**
   * 目录入口文件：默认 'index.html'；传 false 时目录请求一律显示列表，
   * 也可以改成别的文件名（如 'home.html'）
   */
  index?: string | boolean;
  /** 访问日志，默认 false */
  log?: boolean;
  /** 是否启用 https，默认 false（给了 cert/key 也视为启用） */
  https?: boolean;
  /** https 端口，默认 http 端口 + 1 */
  httpsPort?: number | 'auto';
  cert?: string;
  key?: string;
  plugins?: Plugin[];
}

export interface ResolvedOptions {
  readonly root: string;
  readonly port: number | 'auto';
  readonly host: string;
  readonly fallback: string | false;
  readonly cors: string | false;
  readonly listing: boolean;
  readonly index: string | false;
  readonly log: boolean;
  readonly https: boolean;
  readonly httpsPort: number | 'auto' | false;
  readonly cert: string | undefined;
  readonly key: string | undefined;
  readonly plugins: Plugin[];
}

const DEFAULT_PORT = 8000;
const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_INDEX = '/index.html';

function normalizePort(value: number | 'auto' | undefined, label: string): number | 'auto' {
  if (value === undefined) return DEFAULT_PORT;
  if (value === 'auto') return 'auto';
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`${label} 必须是 0-65535 的整数或 'auto'，收到：${String(value)}`);
  }
  return value;
}

function normalizeFallback(value: string | boolean | undefined): string | false {
  if (value === undefined || value === false) return false;
  if (value === true) return DEFAULT_INDEX;
  const trimmed = value.trim();
  if (trimmed === '') return DEFAULT_INDEX;
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.endsWith('/') ? `${withSlash}index.html` : withSlash;
}

function normalizeIndex(value: string | boolean | undefined): string | false {
  if (value === false) return false;
  if (value === undefined || value === true) return 'index.html';
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'none') return false;
  return trimmed.replace(/^[./]+/, '');
}

function normalizeCors(value: string | boolean | undefined): string | false {
  if (value === undefined || value === false) return false;
  if (value === true) return '*';
  const trimmed = value.trim();
  return trimmed === '' ? '*' : trimmed;
}

/** 校验并归一化选项：所有「安全默认值」都在这里单点收口 */
export async function resolveOptions(input: ServeOptions = {}): Promise<ResolvedOptions> {
  const root = await resolveRoot(input.root ?? process.cwd());
  const port = normalizePort(input.port, 'port');
  const host = input.host?.trim() || DEFAULT_HOST;

  const index = normalizeIndex(input.index);

  const hasCert = input.cert !== undefined;
  const hasKey = input.key !== undefined;
  if (hasCert !== hasKey) {
    throw new Error('cert 与 key 必须同时提供');
  }
  const fallback = normalizeFallback(input.fallback);
  if (index === false && fallback !== false) {
    throw new Error(
      'index: false（--browse）与 fallback 互斥：fallback 会把 /、/sub/ 这类无扩展名导航' +
        '统一改写到入口文件，目录列表就永远看不到。去掉 fallback 才能浏览目录；' +
        '只是偶尔想看一次目录，可以用 ?list',
    );
  }
  if (fallback !== false && resolveWithinRoot(root, fallback) === undefined) {
    throw new Error(`fallback 必须是 root 内的路径，收到：${fallback}`);
  }

  const https = input.https === true || (hasCert && hasKey);
  const httpsPort = https
    ? normalizePort(
        input.httpsPort ?? (port === 'auto' || port === 0 ? 'auto' : port + 1),
        'httpsPort',
      )
    : false;

  return {
    root,
    port,
    host,
    fallback,
    cors: normalizeCors(input.cors),
    listing: input.listing ?? true,
    index,
    log: input.log ?? false,
    https,
    httpsPort,
    cert: input.cert,
    key: input.key,
    plugins: [...(input.plugins ?? [])],
  };
}

async function resolveRoot(input: string): Promise<string> {
  const absolute = path.resolve(input);
  let stats;
  try {
    stats = await fs.stat(absolute);
  } catch {
    throw new Error(`目录不存在：${absolute}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`不是目录：${absolute}`);
  }
  // realpath 之后再作为 root，避免符号链接绕过越界校验
  return fs.realpath(absolute);
}
