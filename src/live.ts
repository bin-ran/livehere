import path from 'node:path';
import type { FSWatcher } from 'chokidar';
import type { Plugin } from './plugin';
import type { Handler, Req, Res } from './types';
import { pathnameOf } from './utils/path';

export interface LiveOptions {
  /** 额外忽略的目录名或文件名 */
  ignore?: string[];
  /** 轮询监听（Docker / WSL / 网络盘收不到 fs 事件时用） */
  poll?: boolean;
  /** CSS 原地替换，默认 true */
  css?: boolean;
  /** 刷新后恢复滚动位置，默认 true */
  keepScroll?: boolean;
  /** 端点前缀，默认 '/_livd' */
  base?: string;
}

const DEFAULT_IGNORED = ['node_modules', '.git', '.hg', '.svn', '.idea', '.vscode', '.DS_Store'];

/** 只有纯 CSS 变更才原地替换，其余一律整页刷新 */
const CSS_EXTENSION = '.css';
const DEBOUNCE_MS = 60;
const MAX_INJECT_BYTES = 5 * 1024 * 1024;
const HEARTBEAT_MS = 25_000;

export function livePlugin(options: LiveOptions = {}): Plugin {
  const base = normalizeBase(options.base);
  const cssEnabled = options.css ?? true;
  const keepScroll = options.keepScroll ?? true;
  const ignored = new Set([...DEFAULT_IGNORED, ...(options.ignore ?? [])]);

  const clients = new Set<Res>();
  const pending = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  let rootDir = '';

  function isIgnored(target: string): boolean {
    const relative = path.relative(rootDir, target);
    if (relative === '') return false;
    if (relative.startsWith('..') || path.isAbsolute(relative)) return true;

    return relative
      .split(/[/\\]/)
      .some((segment) => segment.startsWith('.') || ignored.has(segment));
  }

  function toUrlPath(file: string): string {
    const relative = path.relative(rootDir, file).split(path.sep).join('/');
    return `/${relative}`;
  }

  function broadcast(event: string, data: string): void {
    const payload = `event: ${event}\ndata: ${data}\n\n`;
    for (const client of clients) {
      client.write(payload);
    }
  }

  function flush(): void {
    flushTimer = undefined;
    if (pending.size === 0) return;

    const files = [...pending].map(toUrlPath);
    pending.clear();

    const cssOnly = cssEnabled && files.every((file) => file.toLowerCase().endsWith(CSS_EXTENSION));
    broadcast(cssOnly ? 'css' : 'reload', JSON.stringify(files));
  }

  function schedule(file: string): void {
    pending.add(file);
    if (flushTimer !== undefined) return;
    flushTimer = setTimeout(flush, DEBOUNCE_MS);
    flushTimer.unref?.();
  }

  /** SSE：一条长连接，浏览器侧用 EventSource 消费 */
  const sseHandler: Handler = (ctx) => {
    if ((ctx.req.method ?? 'GET') !== 'GET') return false;
    if (pathnameOf(ctx.req) !== `${base}/live`) return false;

    const res = ctx.res;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': livd connected\n\n');
    clients.add(res);

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    res.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
    return true;
  };

  /** 客户端脚本：连 SSE、收 css 事件原地换样式、收 reload 事件刷新页面 */
  const clientHandler: Handler = (ctx) => {
    if (pathnameOf(ctx.req) !== `${base}/live.js`) return false;

    const script = buildClientScript({ base, keepScroll });
    ctx.res.statusCode = 200;
    ctx.res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    ctx.res.setHeader('Cache-Control', 'no-store');
    ctx.res.setHeader('Content-Length', Buffer.byteLength(script));
    ctx.res.end(script);
    return true;
  };

  /** 注入：把 HTML 响应缓冲下来，在 </body> 前插入脚本并重算长度/去掉校验头 */
  const injectHandler: Handler = (ctx) => {
    const req = ctx.req;
    if ((req.method ?? 'GET') !== 'GET') return false;

    const pathname = pathnameOf(req);
    if (pathname === base || pathname.startsWith(`${base}/`)) return false;
    if (!mayBeHtml(req, pathname)) return false;

    bufferForInjection(ctx.res, `<script src="${base}/live.js" defer></script>`);
    return false;
  };

  return {
    name: 'livd:live',

    async configureServer(context) {
      rootDir = context.root;

      const { watch } = await import('chokidar');
      watcher = watch(rootDir, {
        ignoreInitial: true,
        usePolling: options.poll ?? false,
        awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
        ignored: (target: string) => isIgnored(target),
      });
      watcher.on('all', (_event, changed) => {
        schedule(changed);
      });

      context.use(clientHandler, 'pre');
      context.use(sseHandler, 'pre');
      context.use(injectHandler, 'pre');
    },

    async onClose() {
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      pending.clear();
      for (const client of clients) {
        client.end();
      }
      clients.clear();
      await watcher?.close();
      watcher = undefined;
    },
  };
}

function normalizeBase(base: string | undefined): string {
  const value = (base ?? '/_livd').trim();
  const withSlash = value.startsWith('/') ? value : `/${value}`;
  return withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

type AnyWrite = (chunk?: unknown, encoding?: unknown, callback?: unknown) => boolean;
type AnyEnd = (chunk?: unknown, encoding?: unknown, callback?: unknown) => void;
type AnyWriteHead = (...args: unknown[]) => unknown;

interface BufferedTarget {
  write: AnyWrite;
  end: AnyEnd;
  writeHead: AnyWriteHead;
}

/**
 * 把响应体攒在内存里，在 end 时注入脚本再一次性写出。
 *
 * 关键点：必须连 writeHead 一起拦（sirv 会在流式发送前就 writeHead），
 * 否则 Node 认为 header 已发送，之后既改不了 Content-Length 也删不掉 ETag。
 */
function bufferForInjection(res: Res, tag: string): void {
  const target = res as unknown as BufferedTarget;
  const originalWrite = res.write.bind(res) as unknown as AnyWrite;
  const originalEnd = res.end.bind(res) as unknown as AnyEnd;
  const originalWriteHead = res.writeHead.bind(res) as unknown as AnyWriteHead;
  const chunks: Buffer[] = [];
  let finished = false;

  const collect = (chunk: unknown, encoding: unknown): void => {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      return;
    }
    if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
      return;
    }
    if (typeof chunk === 'string') {
      const encoder = typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8';
      chunks.push(Buffer.from(chunk, encoder));
    }
  };

  target.writeHead = (status?: unknown, second?: unknown, third?: unknown) => {
    res.statusCode = typeof status === 'number' ? status : res.statusCode;
    const headers = (typeof second === 'object' && second !== null ? second : third) as
      | Record<string, string | number | string[]>
      | undefined;
    if (headers !== undefined) {
      for (const [name, value] of Object.entries(headers)) {
        res.setHeader(name, value);
      }
    }
    return res;
  };

  target.write = (chunk, encoding, callback) => {
    collect(chunk, encoding);
    const done = typeof encoding === 'function' ? encoding : callback;
    if (typeof done === 'function') {
      queueMicrotask(() => (done as () => void)());
    }
    return true;
  };

  target.end = (chunk, encoding, callback) => {
    if (finished) return;
    finished = true;

    target.write = originalWrite;
    target.end = originalEnd;
    target.writeHead = originalWriteHead;

    const done = [chunk, encoding, callback].find((item) => typeof item === 'function') as
      | (() => void)
      | undefined;
    collect(chunk, encoding);

    const body = Buffer.concat(chunks);
    const contentType = String(res.getHeader('content-type') ?? '');
    const injectable =
      res.statusCode === 200 &&
      contentType.includes('text/html') &&
      res.getHeader('content-encoding') === undefined &&
      body.byteLength <= MAX_INJECT_BYTES;

    const finish = (payload: Buffer): void => {
      if (done === undefined) originalEnd(payload);
      else originalEnd(payload, done);
    };

    if (!injectable) {
      finish(body);
      return;
    }

    const output = Buffer.from(injectBeforeBodyEnd(body.toString('utf8'), tag), 'utf8');
    res.removeHeader('etag');
    res.removeHeader('last-modified');
    res.setHeader('Content-Length', output.byteLength);
    res.setHeader('Cache-Control', 'no-store');
    finish(output);
  };
}

/**
 * 只对「可能是 HTML 的请求」安装注入，避免把 js/图片也缓冲进内存。
 * 浏览器导航一定带 Accept: text/html；fetch 场景靠扩展名兜底。
 */
function mayBeHtml(req: Req, pathname: string): boolean {
  if ((req.headers.accept ?? '').includes('text/html')) return true;
  const lowered = pathname.toLowerCase();
  return lowered.endsWith('.html') || lowered.endsWith('.htm');
}

function injectBeforeBodyEnd(html: string, tag: string): string {
  const index = html.toLowerCase().lastIndexOf('</body>');
  if (index === -1) return `${html}\n${tag}\n`;
  return `${html.slice(0, index)}${tag}\n${html.slice(index)}`;
}

function buildClientScript(config: { base: string; keepScroll: boolean }): string {
  return `(function () {
  var base = ${JSON.stringify(config.base)};
  var keepScroll = ${String(config.keepScroll)};

  if (keepScroll) {
    var flag = 'livd:reloading';
    if (sessionStorage.getItem(flag) === '1') {
      sessionStorage.removeItem(flag);
      var top = sessionStorage.getItem('livd:scroll');
      if (top !== null) window.scrollTo(0, Number(top));
    }
    window.addEventListener('beforeunload', function () {
      sessionStorage.setItem('livd:scroll', String(window.scrollY));
    });
  }

  function swapStyle(file) {
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      var href = link.getAttribute('href');
      if (!href) continue;
      var pathname = href.split('?')[0].split('#')[0];
      if (pathname.slice(-file.length) !== file) continue;

      var next = document.createElement('link');
      next.rel = 'stylesheet';
      next.href = pathname + '?livd=' + Date.now();
      next.onload = function () {
        link.remove();
      };
      link.parentNode.insertBefore(next, link.nextSibling);
    }
  }

  var source = new EventSource(base + '/live');
  source.addEventListener('css', function (event) {
    try {
      JSON.parse(event.data).forEach(swapStyle);
    } catch (error) {
      location.reload();
    }
  });
  source.addEventListener('reload', function () {
    if (keepScroll) sessionStorage.setItem('livd:reloading', '1');
    location.reload();
  });
})();
`;
}
