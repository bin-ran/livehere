import type { Handler } from '../types';
import { sendStatus } from '../utils/http';
import { BadRequestError, hasDotSegment, pathnameOf, resolveWithinRoot } from '../utils/path';

/**
 * 所有请求的安全闸门，职责只有一个：保证后面拿到的 pathname 一定落在 root 内。
 * 1) 拒绝非法编码 / 空字节
 * 2) 拒绝点文件（.env、.git 等）
 * 3) 拒绝 `..` 越界（含 URL 编码与 Windows 反斜杠绕过）
 */
export const guard: Handler = (ctx) => {
  let pathname: string;
  try {
    pathname = pathnameOf(ctx.req);
  } catch (error) {
    if (error instanceof BadRequestError) {
      return sendStatus(ctx.res, 400, error.message);
    }
    throw error;
  }

  if (hasDotSegment(pathname)) {
    return sendStatus(ctx.res, 403, 'Forbidden: dotfiles are not served');
  }

  if (resolveWithinRoot(ctx.root, pathname) === undefined) {
    return sendStatus(ctx.res, 403, 'Forbidden: path escapes root');
  }

  return false;
};
