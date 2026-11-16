import type { Handler } from '../types';
import { BadRequestError, hasListQuery, pathnameOf } from '../utils/path';

/**
 * SPA history 模式：仅对「浏览器导航请求」（Accept 含 text/html）且最后一段没有扩展名时，
 * 把 URL 改写到入口文件。改写后交给后续中间件处理（这里永远返回 false）。
 */
export function createFallback(index: string): Handler {
  return (ctx) => {
    const method = ctx.req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') return false;
    if (!(ctx.req.headers.accept ?? '').includes('text/html')) return false;

    const rawUrl = ctx.req.url ?? '/';
    const queryIndex = rawUrl.indexOf('?');
    if (hasListQuery(queryIndex === -1 ? '' : rawUrl.slice(queryIndex))) return false;

    let pathname: string;
    try {
      pathname = pathnameOf(ctx.req);
    } catch (error) {
      if (error instanceof BadRequestError) return false;
      throw error;
    }

    const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
    if (lastSegment.includes('.')) return false;

    ctx.req.url = index;
    return false;
  };
}
