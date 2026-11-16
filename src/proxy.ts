import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProxyServer, type ProxyServer } from 'httpxy';
import type { Socket } from 'node:net';
import type { Plugin } from './plugin';
import type { Handler, Req } from './types';
import { sendStatus } from './utils/http';
import { pathnameOf, trimTrailingSlash } from './utils/path';

export interface ProxyContextOptions {
  /** 上游地址，例如 http://localhost:7000 */
  target: string;
  /** 改写 Host 为上游 host（默认 true） */
  changeOrigin?: boolean;
  /** 校验上游 TLS 证书（默认 true，自签上游可关） */
  secure?: boolean;
  /** 透传 WebSocket / upgrade（默认 true） */
  ws?: boolean;
  /** 附加到上游请求的 header */
  headers?: Record<string, string>;
  /** 去掉 context 前缀：/api/users → /users */
  stripContext?: boolean;
  /** 正则改写，webpack-dev-server 风格：{ '^/api': '' } */
  pathRewrite?: Record<string, string>;
  /** 函数式改写，优先级高于 pathRewrite */
  rewrite?: (pathname: string) => string;
}

export type ProxyContexts = Record<string, ProxyContextOptions | string>;

export interface ProxyPluginOptions {
  /**
   * 三选一：
   * - shorthand URL：`http://localhost:7000/api`
   * - 配置对象：`{ '/api': { target: '...' } }`
   * - 配置文件路径（相对 root）：`.js` / `.mjs` / `.json`，兼容 webpack 的 `devServer.proxy`
   */
  config: string | ProxyContexts;
}

interface ProxyEntry {
  context: string;
  target: string;
  changeOrigin: boolean;
  server: ProxyServer;
  stripContext: boolean;
  pathRewrite: Record<string, string> | undefined;
  rewrite: ((pathname: string) => string) | undefined;
}

export function proxyPlugin(options: ProxyPluginOptions): Plugin {
  const entries: ProxyEntry[] = [];
  const warned = new Set<string>();

  return {
    name: 'livehere:proxy',

    async configureServer(context) {
      const contexts = await resolveContexts(options.config, context.root);

      for (const [rawContext, rawOptions] of Object.entries(contexts)) {
        const entry = createEntry(rawContext, rawOptions);
        entries.push(entry);
        context.use(createHandler(entry, warned), 'pre');

        context.handleUpgrade((req, socket, head) => {
          if (!matches(entry.context, pathnameOf(req))) return false;
          entry.server
            .ws(
              req,
              socket as Socket,
              { target: entry.target, changeOrigin: entry.changeOrigin, ws: true },
              head,
            )
            .catch(() => socket.destroy());
          return true;
        });
      }

      context.log(
        `proxy: ${entries.map((entry) => `${entry.context || '/'} → ${entry.target}`).join(', ')}`,
      );
    },

    async onClose() {
      for (const entry of entries) {
        entry.server.close();
      }
      entries.length = 0;
    },
  };
}

function createEntry(rawContext: string, rawOptions: ProxyContextOptions | string): ProxyEntry {
  const config = typeof rawOptions === 'string' ? { target: rawOptions } : rawOptions;
  if (typeof config.target !== 'string' || config.target === '') {
    throw new Error(`proxy 缺少 target：${rawContext}`);
  }
  assertTarget(config.target, rawContext);

  const context = normalizeContext(rawContext);
  if (config.pathRewrite !== undefined) {
    for (const pattern of Object.keys(config.pathRewrite)) {
      try {
        void new RegExp(pattern);
      } catch {
        throw new Error(`proxy 的 pathRewrite 不是合法正则：${pattern}`);
      }
    }
  }

  return {
    context,
    target: config.target,
    changeOrigin: config.changeOrigin ?? true,
    stripContext: config.stripContext ?? false,
    pathRewrite: config.pathRewrite,
    rewrite: config.rewrite,
    server: createProxyServer({
      target: config.target,
      changeOrigin: config.changeOrigin ?? true,
      secure: config.secure ?? true,
      ws: config.ws ?? true,
      headers: config.headers,
    }),
  };
}

function createHandler(entry: ProxyEntry, warned: Set<string>): Handler {
  return async (ctx) => {
    let pathname: string;
    try {
      pathname = pathnameOf(ctx.req);
    } catch {
      return false;
    }
    if (!matches(entry.context, pathname)) return false;

    applyRewrite(entry, ctx.req, pathname);

    try {
      await entry.server.web(ctx.req, ctx.res);
    } catch {
      if (!warned.has(entry.target)) {
        warned.add(entry.target);
        process.stderr.write(`[livehere] 上游不可达：${entry.target}\n`);
      }
      if (!ctx.res.headersSent) {
        sendStatus(ctx.res, 502, `Bad Gateway: ${entry.target} 不可达`);
      } else {
        ctx.res.end();
      }
    }
    return true;
  };
}

function applyRewrite(entry: ProxyEntry, req: Req, pathname: string): void {
  const raw = req.url ?? '/';
  const queryIndex = raw.indexOf('?');
  const search = queryIndex === -1 ? '' : raw.slice(queryIndex);

  let next = pathname;
  if (entry.rewrite !== undefined) {
    next = entry.rewrite(pathname);
  } else if (entry.pathRewrite !== undefined) {
    for (const [pattern, replacement] of Object.entries(entry.pathRewrite)) {
      next = next.replace(new RegExp(pattern), replacement);
    }
  } else if (entry.stripContext && entry.context !== '') {
    next = pathname.slice(entry.context.length);
  }

  req.url = `${next.startsWith('/') ? next : `/${next}`}${search}`;
}

function matches(context: string, pathname: string): boolean {
  if (context === '') return true;
  return pathname === context || pathname.startsWith(`${context}/`);
}

function normalizeContext(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '/') return '';
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return trimTrailingSlash(withSlash);
}

function assertTarget(target: string, context: string): void {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error(`proxy 的 target 不是合法 URL（${context}）：${target}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`proxy 的 target 只支持 http/https（${context}）：${target}`);
  }
}

/** 字符串 shorthand / 配置文件 / 对象，统一成 context → options */
async function resolveContexts(
  input: string | ProxyContexts,
  root: string,
): Promise<ProxyContexts> {
  if (typeof input !== 'string') return input;

  if (input.startsWith('http://') || input.startsWith('https://')) {
    const url = new URL(input);
    const context = url.pathname === '/' || url.pathname === '' ? '' : url.pathname;
    return { [context]: { target: url.origin } };
  }

  const filePath = await resolveConfigPath(input, root);
  const loaded = await loadConfigFile(filePath);
  return extractContexts(loaded, filePath);
}

/**
 * 配置文件相对「当前工作目录」解析（CLI 里最符合直觉：`livehere ./dist -x webpack.config.js`），
 * 找不到再回落到 ROOT，兼容把配置和服务目录放在一起的用法。
 */
async function resolveConfigPath(input: string, root: string): Promise<string> {
  const fromCwd = path.resolve(process.cwd(), input);
  if (await isFile(fromCwd)) return fromCwd;

  const fromRoot = path.resolve(root, input);
  if (await isFile(fromRoot)) return fromRoot;

  return fromCwd;
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

async function loadConfigFile(filePath: string): Promise<unknown> {
  let source: string;
  try {
    source = await fs.readFile(filePath, 'utf8');
  } catch {
    throw new Error(`找不到 proxy 配置文件：${filePath}`);
  }

  if (filePath.endsWith('.json')) {
    try {
      return JSON.parse(source) as unknown;
    } catch (error) {
      throw new Error(`proxy 配置文件不是合法 JSON：${filePath}`, { cause: error });
    }
  }

  const module = (await import(pathToFileURL(filePath).href)) as { default?: unknown };
  return module.default ?? module;
}

/** 兼容 webpack-dev-server：devServer.proxy / proxy / 直接就是 contexts */
function extractContexts(loaded: unknown, filePath: string): ProxyContexts {
  if (loaded === null || typeof loaded !== 'object') {
    throw new Error(`proxy 配置文件内容无法识别：${filePath}`);
  }
  const record = loaded as Record<string, unknown>;
  const devServer = record['devServer'];
  if (devServer !== null && typeof devServer === 'object') {
    const proxy = (devServer as Record<string, unknown>)['proxy'];
    if (proxy !== null && typeof proxy === 'object') return proxy as ProxyContexts;
  }
  const proxy = record['proxy'];
  if (proxy !== null && typeof proxy === 'object') return proxy as ProxyContexts;
  return record as ProxyContexts;
}
