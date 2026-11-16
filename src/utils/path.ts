import path from 'node:path';
import type { Req } from '../types';

/** 请求行里出现了无法安全处理的内容 */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/**
 * 取出已解码的 pathname。
 * 只解一次码：`%252e%252e` 解完仍是 `%2e%2e`，随后由 resolveWithinRoot 兜住。
 */
export function pathnameOf(req: Req): string {
  const raw = req.url ?? '/';
  const queryIndex = raw.indexOf('?');
  const encoded = queryIndex === -1 ? raw : raw.slice(0, queryIndex);

  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw new BadRequestError('非法的 URL 编码');
  }
  if (decoded.includes('\0')) {
    throw new BadRequestError('路径中包含空字节');
  }
  return decoded.startsWith('/') ? decoded : `/${decoded}`;
}

/**
 * 把 pathname 映射到 root 内的绝对路径。
 * 越界（`..`、绝对路径、Windows 盘符 / 反斜杠分隔）返回 undefined。
 */
export function resolveWithinRoot(root: string, pathname: string): string | undefined {
  const absolute = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, absolute);
  if (relative === '') return root;
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return absolute;
}

/** 任一路径片段以 `.` 开头即视为点文件（`.` 与 `..` 本身不算） */
export function hasDotSegment(pathname: string): boolean {
  return pathname
    .split(/[/\\]/)
    .some((segment) => segment !== '.' && segment !== '..' && segment.startsWith('.'));
}

/** `/a/b/` → `/a/b`，根路径保持 `/` */
export function trimTrailingSlash(pathname: string): string {
  if (pathname.length <= 1) return pathname;
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}
