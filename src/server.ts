import http from 'node:http';
import https from 'node:https';
import type { Duplex } from 'node:stream';
import { listing } from './middleware/listing';
import { createCors } from './middleware/cors';
import { createFallback } from './middleware/fallback';
import { createLogger } from './middleware/logger';
import { createStatic } from './middleware/static';
import { guard } from './middleware/guard';
import { createIndexFile } from './middleware/index-file';
import { collectPluginHandlers, type UpgradeListener } from './plugin';
import { resolveOptions, type ResolvedOptions, type ServeOptions } from './options';
import { loadTlsMaterial } from './tls';
import { compose } from './utils/compose';
import { sendStatus } from './utils/http';
import { formatHostForUrl, isWildcardHost, listDisplayAddresses } from './utils/net';
import type { Handler, RequestContext } from './types';

const AUTO_PORT_START = 8000;
const LOOPBACK_HOST = '127.0.0.1';
const AUTO_PORT_ATTEMPTS = 20;

export interface ServerHandle {
  /** 实际监听的地址（默认 0.0.0.0） */
  readonly host: string;
  /** 实际监听的 http 端口（port 传 0 / 'auto' 时由系统决定） */
  readonly port: number;
  readonly httpsPort: number | undefined;
  /** 第一个访问地址，便于日志和测试 */
  readonly url: string;
  readonly urls: string[];
  readonly httpsUrl: string | undefined;
  close(): Promise<void>;
}

/**
 * 装配中间件管线。顺序是硬约定：
 * 日志/CORS（只写头，不短路）→ 安全闸门 → history fallback → 插件 pre
 * → 静态文件（命中即返回）→ 插件 post → 目录列表 → 404
 */
async function buildHandler(
  config: ResolvedOptions,
): Promise<{ handler: Handler; upgrades: UpgradeListener[] }> {
  const log = config.log ? (message: string) => console.log(message) : () => {};
  const { pre, post, upgrade } = await collectPluginHandlers(config.plugins, config, log);
  const handlers: Handler[] = [
    createLogger(config.log),
    createCors(config.cors),
    guard,
    // 目录索引要在 fallback 之前：/sub/ → /sub/index.html，避免被 SPA 兜底抢走
    createIndexFile(config.index),
  ];

  if (config.fallback !== false) {
    handlers.push(createFallback(config.fallback));
  }

  handlers.push(...pre, createStatic(config.root), ...post);
  if (config.listing) {
    handlers.push(listing);
  }

  const pipeline = compose(handlers, (ctx: RequestContext) =>
    sendStatus(ctx.res, 404, 'Not Found'),
  );

  return { handler: (ctx) => pipeline(ctx), upgrades: upgrade };
}

export async function createServer(input: ServeOptions = {}): Promise<ServerHandle> {
  const config = await resolveOptions(input);
  const { handler, upgrades } = await buildHandler(config);

  const listener = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    Promise.resolve(handler({ req, res, root: config.root, config })).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[livehere] 请求处理失败：${message}\n`);
      sendStatus(res, 500);
    });
  };

  const server = http.createServer(listener);
  const disposeHttpUpgrade = attachUpgrade(server, upgrades);
  const port = await listenServer(server, config.port, config.host);
  server.on('error', (error: Error) => {
    process.stderr.write(`[livehere] http 服务器错误：${error.message}\n`);
  });

  const httpsServer =
    config.https && config.httpsPort !== false
      ? await startSecureServer(config, config.httpsPort, listener, upgrades)
      : undefined;

  const urls = buildUrls(config, port, 'http');
  return {
    host: config.host,
    port,
    httpsPort: httpsServer === undefined ? undefined : resolvePort(httpsServer.server),
    url: urls[0] ?? `http://127.0.0.1:${port}/`,
    urls,
    httpsUrl: httpsServer?.url,
    close: async () => {
      disposeHttpUpgrade();
      httpsServer?.disposeUpgrade();
      await Promise.all([closeServer(httpsServer?.server), closeServer(server)]);
      for (const plugin of config.plugins) {
        await plugin.onClose?.();
      }
    },
  };
}

interface SecureServer {
  server: https.Server;
  url: string;
  disposeUpgrade: () => void;
}

async function startSecureServer(
  config: ResolvedOptions,
  port: number | 'auto',
  listener: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  upgrades: UpgradeListener[],
): Promise<SecureServer> {
  const material = await loadTlsMaterial(config);
  const server = https.createServer(material, listener);
  const disposeUpgrade = attachUpgrade(server, upgrades);
  const boundPort = await listenServer(server, port, config.host);
  server.on('error', (error: Error) => {
    process.stderr.write(`[livehere] https 服务器错误：${error.message}\n`);
  });

  const urls = buildUrls(config, boundPort, 'https');
  return { server, url: urls[0] ?? `https://127.0.0.1:${boundPort}/`, disposeUpgrade };
}

async function listenServer(
  server: http.Server | https.Server,
  port: number | 'auto',
  host: string,
): Promise<number> {
  if (port !== 'auto') {
    try {
      await listenOnce(server, port, host);
    } catch (error) {
      if (isPortInUse(error)) {
        throw new Error(`端口 ${port} 已被占用（或无权监听），可以试试 -p auto 或换一个端口`, {
          cause: error,
        });
      }
      throw error;
    }
    return resolvePort(server);
  }

  for (let offset = 0; offset < AUTO_PORT_ATTEMPTS; offset += 1) {
    try {
      await listenOnce(server, AUTO_PORT_START + offset, host);
      return resolvePort(server);
    } catch (error) {
      if (!isPortInUse(error)) throw error;
    }
  }

  // 连续 20 个端口都被占用时，退回让系统分配
  await listenOnce(server, 0, host);
  return resolvePort(server);
}

function listenOnce(server: http.Server | https.Server, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      server.off('listening', onListening);
      server.off('error', onError);
    };
    const onListening = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(port, host);
  });
}

/**
 * upgrade 处理：
 * - 没有插件接管时主动断开，避免 socket 悬着
 * - 接管成功的 socket 记在册上，close() 时销毁（Node 的 closeAllConnections 不管已升级的 socket，
 *   不清理会让 close() 永远不回调）
 */
function attachUpgrade(
  server: http.Server | https.Server,
  upgrades: UpgradeListener[],
): () => void {
  const sockets = new Set<Duplex>();
  if (upgrades.length === 0) return () => {};

  server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const handled = upgrades.some((listener) => listener(req, socket, head) === true);
    if (!handled) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();
  };
}

function resolvePort(server: http.Server | https.Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('无法获取监听端口');
  }
  return address.port;
}

function isPortInUse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE';
}

function buildUrls(config: ResolvedOptions, port: number, scheme: 'http' | 'https'): string[] {
  const suffix = port === (scheme === 'http' ? 80 : 443) ? '' : `:${port}`;
  // 绑定 0.0.0.0 时本机地址同样可用，把它排在第一位，方便直接点开
  const hosts = isWildcardHost(config.host)
    ? [LOOPBACK_HOST, ...listDisplayAddresses().filter((host) => host !== LOOPBACK_HOST)]
    : [config.host];

  return hosts.map((host) => `${scheme}://${formatHostForUrl(host)}${suffix}/`);
}

function closeServer(server: http.Server | https.Server | undefined): Promise<void> {
  if (server === undefined || !server.listening) return Promise.resolve();

  return new Promise<void>((resolve) => {
    server.close(() => resolve());
    // keep-alive 连接会拖住 close()，测试里尤其明显
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
  });
}
