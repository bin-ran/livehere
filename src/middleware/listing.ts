import fs from 'node:fs/promises';
import path from 'node:path';
import type { Handler } from '../types';
import { escapeHtml, formatBytes, sendHtml, sendStatus } from '../utils/http';
import { pathnameOf, resolveWithinRoot, trimTrailingSlash } from '../utils/path';

interface Entry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: Date;
}

/**
 * 目录列表：只在静态文件未命中时执行（挂在内置中间件列表末尾）。
 * 只读、默认隐藏点文件（guard 已经拦掉），并做 HTML 转义。
 */
export const listing: Handler = async (ctx) => {
  const method = ctx.req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') return false;

  const pathname = pathnameOf(ctx.req);
  const target = resolveWithinRoot(ctx.root, pathname);
  if (target === undefined) return sendStatus(ctx.res, 403, 'Forbidden: path escapes root');

  let stats;
  try {
    stats = await fs.stat(target);
  } catch {
    // 不存在 → 让后面的 404 兜底
    return false;
  }
  if (!stats.isDirectory()) return false;

  const entries = await readEntries(target);
  const html = renderListing(pathname, entries);
  return sendHtml(ctx.res, html, method !== 'HEAD');
};

async function readEntries(dir: string): Promise<Entry[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const entries: Entry[] = [];

  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) continue;
    const isDir = dirent.isDirectory();
    let size = 0;
    let mtime = new Date(0);
    if (!isDir) {
      try {
        const stats = await fs.stat(path.join(dir, dirent.name));
        size = stats.size;
        mtime = stats.mtime;
      } catch {
        continue;
      }
    }
    entries.push({ name: dirent.name, isDir, size, mtime });
  }

  return entries.toSorted((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function parentHref(pathname: string): string | undefined {
  const current = trimTrailingSlash(pathname);
  if (current === '' || current === '/') return undefined;
  const parent = current.slice(0, current.lastIndexOf('/'));
  return `${parent}/`;
}

function entryHref(pathname: string, entry: Entry): string {
  const encoded = encodeURIComponent(entry.name);
  const base = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${base}${encoded}${entry.isDir ? '/' : ''}`;
}

function renderListing(pathname: string, entries: Entry[]): string {
  const title = `Index of ${pathname}`;
  const parent = parentHref(pathname);
  const rows = entries.map((entry) => {
    const name = `${entry.name}${entry.isDir ? '/' : ''}`;
    const meta = entry.isDir
      ? '—'
      : `${formatBytes(entry.size)} · ${entry.mtime.toISOString().slice(0, 16).replace('T', ' ')}`;
    return `<li><a href="${escapeHtml(entryHref(pathname, entry))}">${escapeHtml(name)}</a><span class="meta">${escapeHtml(meta)}</span></li>`;
  });

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;padding:2rem 1.25rem;font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
h1{margin:0 0 .25rem;font-size:1.1rem;font-weight:600;word-break:break-all}
h1 small{display:block;margin-top:.35rem;font-weight:400;opacity:.6;font-size:.8rem}
ul{list-style:none;margin:1.25rem 0 0;padding:0;border-top:1px solid rgba(128,128,128,.25)}
li{display:flex;justify-content:space-between;gap:1rem;padding:.45rem .25rem;border-bottom:1px solid rgba(128,128,128,.15)}
a{color:inherit;text-decoration:none;word-break:break-all}
a:hover{text-decoration:underline}
.meta{flex:none;font-size:.8rem;opacity:.6;font-variant-numeric:tabular-nums}
</style>
</head>
<body>
<h1>${escapeHtml(title)}<small>livd · ${entries.length} 项</small></h1>
<ul>
${parent === undefined ? '' : `<li><a href="${escapeHtml(parent)}">../</a><span class="meta">上级目录</span></li>`}
${rows.join('\n')}
</ul>
</body>
</html>
`;
}
