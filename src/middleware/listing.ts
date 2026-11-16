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

function entryHref(pathname: string, entry: Entry): string {
  const encoded = encodeURIComponent(entry.name);
  const base = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${base}${encoded}${entry.isDir ? '/' : ''}`;
}

/** 面包屑：/ → data → images，每段可点 */
function renderBreadcrumb(pathname: string): string {
  const segments = trimTrailingSlash(pathname)
    .split('/')
    .filter((segment) => segment !== '');

  const parts = [`<a href="/">根目录</a>`];
  let accumulated = '';
  for (const segment of segments) {
    accumulated += `/${segment}`;
    parts.push(
      `<span class="sep">/</span><a href="${escapeHtml(`${encodeURI(accumulated)}/`)}">${escapeHtml(segment)}</a>`,
    );
  }
  return parts.join('');
}

const FOLDER_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5h4l1.2 1.5h7.8a.8.8 0 0 1 .8.8v6.4a.8.8 0 0 1-.8.8H1.5a.8.8 0 0 1-.8-.8V4.3a.8.8 0 0 1 .8-.8Z"/></svg>';
const FILE_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5l3.5 3.5v9a.8.8 0 0 1-.8.8H4a.8.8 0 0 1-.8-.8V2.3a.8.8 0 0 1 .8-.8Z"/></svg>';
const DOWNLOAD_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7M5 6.8 8 9.8l3-3M3 12.5h10"/></svg>';

function renderListing(pathname: string, entries: Entry[]): string {
  const browseable = trimTrailingSlash(pathname) || '/';

  const rows = entries.map((entry) => {
    const name = `${entry.name}${entry.isDir ? '/' : ''}`;
    const href = escapeHtml(entryHref(pathname, entry));
    const icon = entry.isDir ? FOLDER_ICON : FILE_ICON;
    const download = entry.isDir
      ? ''
      : `<a class="dl" href="${href}" download title="下载 ${escapeHtml(entry.name)}" aria-label="下载">${DOWNLOAD_ICON}</a>`;
    const meta = entry.isDir
      ? '<span class="dim">目录</span>'
      : `<span>${escapeHtml(formatBytes(entry.size))}</span><time datetime="${entry.mtime.toISOString()}">${entry.mtime.toISOString().slice(0, 16).replace('T', ' ')}</time>`;

    return `<li class="row${entry.isDir ? ' dir' : ''}">
<a class="name" href="${href}"><span class="ico">${icon}</span><span>${escapeHtml(name)}</span></a>
${download}
<span class="meta">${meta}</span>
</li>`;
  });

  const empty =
    entries.length === 0
      ? '<p class="empty">这个目录是空的</p>'
      : `<ul class="list">${rows.join('\n')}</ul>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(browseable)} · livehere</title>
<style>
:root{
  color-scheme:light dark;
  --fg:#1f2328; --bg:#f6f7f9; --surface:#fff; --line:#e6e8eb;
  --dim:#6b7280; --accent:#0d6efd; --hover:#f0f3f7;
}
@media (prefers-color-scheme:dark){
  :root{--fg:#e6e8eb; --bg:#16181c; --surface:#1e2126; --line:#2c3037; --dim:#9aa3ad; --accent:#6ba8ff; --hover:#252a31;}
}
*{box-sizing:border-box}
body{
  margin:0; padding:2.5rem 1rem 4rem; background:var(--bg); color:var(--fg);
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  -webkit-font-smoothing:antialiased;
}
.page{max-width:880px;margin:0 auto}
header{margin-bottom:1rem}
.crumb{font-size:1.15rem;font-weight:600;word-break:break-all}
.crumb a{color:inherit;text-decoration:none}
.crumb a:hover{color:var(--accent)}
.crumb .sep{margin:0 .35rem;color:var(--dim);font-weight:400}
.sub{margin-top:.4rem;font-size:.8rem;color:var(--dim)}
.list{list-style:none;margin:0;padding:.35rem;background:var(--surface);border:1px solid var(--line);border-radius:12px}
.row{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:.4rem;padding:.55rem .7rem;border-radius:8px}
.row + .row{margin-top:2px}
.row:hover{background:var(--hover)}
.name{display:flex;align-items:center;gap:.6rem;min-width:0;color:inherit;text-decoration:none}
.name span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dir .name{font-weight:550}
.ico{display:inline-flex;flex:none;width:18px;height:18px;color:var(--dim)}
.dir .ico{color:#e0a400}
.ico svg{width:100%;height:100%;fill:currentColor}
.dl{flex:none;display:inline-flex;width:26px;height:26px;align-items:center;justify-content:center;border-radius:6px;color:var(--dim);opacity:.35;transition:opacity .12s,background .12s}
.dl svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.row:hover .dl,.dl:focus-visible{opacity:1}
.dl:hover{background:var(--line);color:var(--fg)}
.meta{display:flex;justify-content:flex-end;gap:.45rem;font-size:.8rem;color:var(--dim);font-variant-numeric:tabular-nums;white-space:nowrap}
.meta time{opacity:.85}
.dim{color:var(--dim);opacity:.7}
.row.dir + .row:not(.dir){margin-top:.5rem;padding-top:.75rem;border-top:1px solid var(--line)}
.empty{margin:1.5rem 0;color:var(--dim);text-align:center;padding:2.5rem;background:var(--surface);border:1px dashed var(--line);border-radius:12px}
@media (max-width:620px){
  body{padding:1.25rem .75rem 3rem}
  .row{grid-template-columns:1fr auto;row-gap:.15rem}
  .meta{grid-column:1/-1;padding-left:calc(18px + .6rem)}
  .meta{justify-content:flex-start}
  .dl{opacity:1}
  .dir .meta{display:none}
}
</style>
</head>
<body>
<div class="page">
<header>
  <nav class="crumb">${renderBreadcrumb(pathname)}</nav>
  <div class="sub">livehere · ${entries.length} 项</div>
</header>
${empty}
</div>
</body>
</html>
`;
}
