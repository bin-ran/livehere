import http from 'node:http';
import { mkdir, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { livePlugin } from '../../src/live';
import { createServer, type ServerHandle } from '../../src/server';

interface SseEvent {
  event: string;
  data: string;
}

interface SseSession {
  events: SseEvent[];
  close(): void;
}

let root = '';
let handle: ServerHandle;
let base = '';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 裸 http.get 读 SSE，避免引入额外客户端依赖 */
function openSse(url: string): SseSession {
  const events: SseEvent[] = [];
  const target = new URL(url);
  let buffer = '';

  const request = http.get(
    { host: target.hostname, port: target.port, path: target.pathname },
    (response) => {
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf('\n\n');
        while (index !== -1) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          index = buffer.indexOf('\n\n');

          const eventName = /^event: (.+)$/m.exec(raw)?.[1];
          const data = /^data: (.+)$/m.exec(raw)?.[1];
          if (eventName !== undefined && data !== undefined) {
            events.push({ event: eventName, data });
          }
        }
      });
    },
  );

  return { events, close: () => request.destroy() };
}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('等待条件超时');
    await delay(50);
  }
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'livd-live-'));
  await mkdir(path.join(root, 'assets'));
  await writeFile(
    path.join(root, 'index.html'),
    '<!doctype html><html><body><h1>hi</h1></body></html>',
  );
  await writeFile(path.join(root, 'assets', 'style.css'), 'body{color:red}');
  await writeFile(path.join(root, 'notes.txt'), 'plain text');

  handle = await createServer({ root, port: 0, plugins: [livePlugin()] });
  base = handle.url;
  // 给 chokidar 一点时间完成初始扫描
  await delay(400);
});

afterAll(async () => {
  await handle.close();
  for (const relative of ['index.html', 'assets/style.css', 'notes.txt']) {
    await rm(path.join(root, relative), { force: true });
  }
  await rmdir(path.join(root, 'assets'));
  await rmdir(root);
});

describe('live reload 端点', () => {
  it('提供客户端脚本', async () => {
    const response = await fetch(`${base}_livd/live.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    const script = await response.text();
    expect(script).toContain('EventSource');
    expect(script).toContain('"/_livd"');
    expect(script).toContain("'/live'");
  });

  it('SSE 连接保持打开并先发一条注释', async () => {
    const session = openSse(`${base}_livd/live`);
    try {
      await delay(200);
      expect(session.events).toHaveLength(0);
    } finally {
      session.close();
    }
  });
});

describe('HTML 注入', () => {
  it('在 </body> 前插入脚本，并重算 content-length、去掉 ETag', async () => {
    const response = await fetch(`${base}index.html`, { headers: { accept: 'text/html' } });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<script src="/_livd/live.js" defer></script>');
    expect(html.indexOf('_livd/live.js')).toBeLessThan(html.toLowerCase().lastIndexOf('</body>'));
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(html)));
    expect(response.headers.get('etag')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('非 HTML 响应不注入', async () => {
    const response = await fetch(`${base}notes.txt`, { headers: { accept: 'text/html' } });
    const body = await response.text();

    expect(body).toBe('plain text');
    expect(body).not.toContain('_livd/live.js');
  });

  it('HEAD 请求不注入 body', async () => {
    const response = await fetch(`${base}index.html`, {
      method: 'HEAD',
      headers: { accept: 'text/html' },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });
});

describe('文件变化 → 事件', () => {
  it('只有 CSS 变更时发 css 事件', async () => {
    const session = openSse(`${base}_livd/live`);
    try {
      await delay(200);
      await writeFile(path.join(root, 'assets', 'style.css'), 'body{color:blue}');

      await waitFor(() => session.events.some((item) => item.event === 'css'));
      const event = session.events.find((item) => item.event === 'css');
      expect(event?.data).toContain('/assets/style.css');
    } finally {
      session.close();
    }
  });

  it('HTML 变更发 reload 事件', async () => {
    const session = openSse(`${base}_livd/live`);
    try {
      await delay(200);
      await writeFile(
        path.join(root, 'index.html'),
        '<!doctype html><html><body><h1>changed</h1></body></html>',
      );

      await waitFor(() => session.events.some((item) => item.event === 'reload'));
      const event = session.events.find((item) => item.event === 'reload');
      expect(event?.data).toContain('/index.html');
    } finally {
      session.close();
    }
  });

  it('忽略 node_modules 与点目录', async () => {
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'node_modules', 'noise.js'), 'noise');

    const session = openSse(`${base}_livd/live`);
    try {
      await delay(200);
      await writeFile(path.join(root, 'node_modules', 'noise.js'), 'noise2');
      await delay(600);
      expect(session.events).toHaveLength(0);
    } finally {
      session.close();
      await rm(path.join(root, 'node_modules', 'noise.js'), { force: true });
      await rmdir(path.join(root, 'node_modules'));
    }
  });
});
