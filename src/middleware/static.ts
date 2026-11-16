import path from 'node:path';
import { lookup } from 'mrmime';
import sirv from 'sirv';
import type { Handler } from '../types';

/**
 * 「下载而不是预览」的扩展名。
 * 这些文件内容是纯文本，浏览器默认会内联展示，但它们对用户来说是要拿走的配置/脚本。
 */
const DOWNLOAD_ONLY = new Set([
  '.conf',
  '.cfg',
  '.ini',
  '.env',
  '.log',
  '.sh',
  '.bash',
  '.zsh',
  '.bat',
  '.cmd',
  '.ps1',
  '.psm1',
  '.service',
  '.toml',
  '.sql',
]);

/**
 * 静态文件：命中即响应，未命中返回 false 交给后续阶段（目录列表 / 404）。
 * dev: true 关闭强缓存，保证编辑文件后刷新一定能看到最新内容（live reload 依赖这一点）。
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
    setHeaders: (res, pathname) => {
      // 不猜类型，避免浏览器把二进制当文本渲染
      res.setHeader('X-Content-Type-Options', 'nosniff');

      const extension = path.extname(pathname).toLowerCase();
      const known = lookup(extension);

      if (known === undefined) {
        // sirv 对未知扩展名什么都不发，浏览器会自己嗅探；明确按二进制下载
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', attachmentFor(pathname));
        return;
      }

      if (DOWNLOAD_ONLY.has(extension)) {
        // 类型本身是对的（text/plain），只是不该在浏览器里展示
        res.setHeader('Content-Disposition', attachmentFor(pathname));
      }
    },
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

/** RFC 5987 编码，保证中文/空格文件名在下载时也不乱码 */
function attachmentFor(pathname: string): string {
  const name = path.basename(pathname);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
