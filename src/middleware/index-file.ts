import fs from 'node:fs/promises';
import type { Req, Handler } from '../types';
import { hasListQuery, pathnameOf, resolveWithinRoot } from '../utils/path';

/**
 * 目录索引与尾斜杠规范化。
 *
 * 静态中间件刻意关掉了「猜扩展名」（`/about` → `about.html`），副作用是目录索引也失效了，
 * 所以这里补回来，只做两件标准行为：
 * - `/sub/` 目录下有入口文件（默认 index.html）→ 内部改写交给静态中间件；
 *   传 `index: false` 或请求带 `?list` 时跳过，直接走目录列表
 * - `/sub` 是目录但缺尾斜杠 → 301 到 `/sub/`，否则页面里的相对路径会指错
 */
export function createIndexFile(index: string | false): Handler {
  return async (ctx) => {
    const method = ctx.req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') return false;

    let pathname: string;
    try {
      pathname = pathnameOf(ctx.req);
    } catch {
      // 非法编码交给 guard / 后续中间件给出 400
      return false;
    }

    const search = searchOf(ctx.req);

    if (pathname.endsWith('/')) {
      if (index === false || hasListQuery(search)) return false;

      const candidate = resolveWithinRoot(ctx.root, `${pathname}${index}`);
      if (candidate !== undefined && (await isFile(candidate))) {
        ctx.req.url = `${pathname}${index}${search}`;
      }
      return false;
    }

    const target = resolveWithinRoot(ctx.root, pathname);
    if (target === undefined || !(await isDirectory(target))) return false;

    ctx.res.writeHead(301, {
      Location: `${encodeURI(pathname)}/${hasListQuery(search) ? '?list' : search}`,
    });
    ctx.res.end();
    return true;
  };
}

function searchOf(req: Req): string {
  const raw = req.url ?? '/';
  const index = raw.indexOf('?');
  return index === -1 ? '' : raw.slice(index);
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}
