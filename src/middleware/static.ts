import sirv from 'sirv';
import type { Handler } from '../types';

/**
 * 静态文件：命中即响应，未命中返回 false 交给后续阶段（目录列表 / 404）。
 * dev: true 关闭强缓存，保证编辑文件后刷新一定能看到最新内容（M2 的 live reload 依赖这一点）。
 * brotli/gzip 交给 sirv 做内容协商，不会出现「无脑返回 .br」的问题。
 */
export function createStatic(root: string): Handler {
  const serve = sirv(root, {
    dev: true,
    etag: true,
    dotfiles: false,
    extensions: [],
    single: false,
    brotli: true,
    gzip: true,
  });

  return (ctx) =>
    new Promise<boolean | void>((resolve) => {
      let settled = false;
      const settle = (handled: boolean | void) => {
        if (settled) return;
        settled = true;
        resolve(handled);
      };

      ctx.res.once('close', () => settle(true));
      ctx.res.once('finish', () => settle(true));
      serve(ctx.req, ctx.res, () => settle(false));
    });
}
