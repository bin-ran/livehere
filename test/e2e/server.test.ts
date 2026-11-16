import http from 'node:http';
import { mkdir, mkdtemp, rmdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ServerHandle } from '../../src/server';
import type { Handler } from '../../src/types';

/** 夹具内容：断言从它派生，改名不会再把测试改坏 */
const HELLO = 'hello from livehere';

let root = '';
let handle: ServerHandle;
let base = '';

/** 用裸 http.request 发请求，避免 WHATWG URL 在客户端就把 %2e%2e 规范化掉 */
function rawGet(pathname: string): Promise<{ status: number; body: string }> {
  const target = new URL(base);
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: target.hostname, port: target.port, path: pathname, method: 'GET' },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'livehere-e2e-'));
  await mkdir(path.join(root, 'public'));
  await mkdir(path.join(root, 'site'));
  await mkdir(path.join(root, 'app'));
  await writeFile(path.join(root, 'hello.txt'), HELLO);
  await writeFile(path.join(root, 'public', 'index.html'), '<h1>public index</h1>');
  await writeFile(path.join(root, 'site', 'index.html'), '<h1>site index</h1>');
  await writeFile(path.join(root, 'app', 'a.txt'), 'a');
  await writeFile(path.join(root, '.env'), 'SECRET=1');

  handle = await createServer({ root, port: 0 });
  base = handle.url;
});

afterAll(async () => {
  await handle.close();
  for (const relative of [
    'hello.txt',
    'public/index.html',
    'site/index.html',
    'app/a.txt',
    '.env',
  ]) {
    await rm(path.join(root, relative), { force: true });
  }
  await rmdir(path.join(root, 'public'));
  await rmdir(path.join(root, 'site'));
  await rmdir(path.join(root, 'app'));
  await rmdir(root);
});

describe('静态文件', () => {
  it('返回文件内容与正确的 content-type', async () => {
    const response = await fetch(`${base}hello.txt`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(HELLO);
    expect(response.headers.get('content-type')).toContain('text/plain');
  });

  it('支持子目录下的 index.html', async () => {
    const response = await fetch(`${base}public/index.html`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<h1>public index</h1>');
  });

  it('HEAD 请求只返回头', async () => {
    const response = await fetch(`${base}hello.txt`, { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(HELLO)));
    expect(await response.text()).toBe('');
  });

  it('未命中返回 404', async () => {
    const response = await fetch(`${base}missing.js`);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not Found');
  });
});

describe('目录列表', () => {
  it('根目录返回 HTML 列表，且不含点文件', async () => {
    const response = await fetch(base);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('hello.txt');
    expect(body).toContain('app/');
    expect(body).not.toContain('.env');
  });
});

describe('目录索引', () => {
  it('/sub/ 直接返回 dir/index.html', async () => {
    const response = await fetch(`${base}site/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<h1>site index</h1>');
  });

  it('/sub 是目录但没有尾斜杠时 301 到 /sub/', async () => {
    const response = await fetch(`${base}site`, { redirect: 'manual' });

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/site/');
  });

  it('301 保留查询串', async () => {
    const response = await fetch(`${base}site?x=1&y=2`, { redirect: 'manual' });

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/site/?x=1&y=2');
  });

  it('根目录有 index.html 时直接返回它，而不是目录列表', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'livehere-index-'));
    await writeFile(path.join(dir, 'index.html'), '<h1>hello index</h1>');
    const server = await createServer({ root: dir, port: 0 });

    try {
      const rootResponse = await fetch(server.url);
      expect(rootResponse.status).toBe(200);
      expect(await rootResponse.text()).toBe('<h1>hello index</h1>');
    } finally {
      await server.close();
      await rm(path.join(dir, 'index.html'), { force: true });
      await rmdir(dir);
    }
  });
});

describe('安全防线', () => {
  it('拒绝点文件', async () => {
    const response = await fetch(`${base}.env`);
    expect(response.status).toBe(403);
  });

  it('拒绝 URL 编码的目录穿越', async () => {
    const response = await rawGet('/%2e%2e/%2e%2e/etc/passwd');
    expect(response.status).toBe(403);
  });

  it('拒绝原始目录穿越（服务端未规范化时会直接命中）', async () => {
    const response = await rawGet('/../package.json');
    expect([403, 404]).toContain(response.status);
  });

  it('拒绝含空字节的路径', async () => {
    const response = await rawGet('/hello%00.txt');
    expect(response.status).toBe(400);
  });

  it('默认不带 CORS 头', async () => {
    const response = await fetch(`${base}hello.txt`);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('CORS 选项', () => {
  it('开启后返回 * 并就地应答预检请求', async () => {
    const server = await createServer({ root, port: 0, cors: true });
    try {
      const get = await fetch(`${server.url}hello.txt`);
      expect(get.headers.get('access-control-allow-origin')).toBe('*');

      const preflight = await fetch(`${server.url}hello.txt`, { method: 'OPTIONS' });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-methods')).toContain('GET');
    } finally {
      await server.close();
    }
  });
});

describe('history fallback', () => {
  it('无扩展名的导航请求回落到入口文件', async () => {
    const server = await createServer({ root, port: 0, fallback: '/public/index.html' });
    try {
      const response = await fetch(`${server.url}some/route`, { headers: { accept: 'text/html' } });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('<h1>public index</h1>');
    } finally {
      await server.close();
    }
  });

  it('带扩展名的请求不回退', async () => {
    const server = await createServer({ root, port: 0, fallback: '/public/index.html' });
    try {
      const response = await fetch(`${server.url}some/route.js`, {
        headers: { accept: 'text/html' },
      });
      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('非文档请求（Accept 不含 html）不回退', async () => {
    const server = await createServer({ root, port: 0, fallback: '/public/index.html' });
    try {
      const response = await fetch(`${server.url}some/route`, {
        headers: { accept: 'application/json' },
      });
      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});

const respondTagged =
  (tag: string): Handler =>
  (ctx) => {
    const pathname = (ctx.req.url ?? '').split('?')[0];
    if (pathname !== `/${tag}`) return false;
    ctx.res.statusCode = 200;
    ctx.res.end(tag);
    return true;
  };

describe('插件管线', () => {
  it('pre 插件先于静态文件，post 插件只在静态未命中后执行', async () => {
    const server = await createServer({
      root,
      port: 0,
      plugins: [
        {
          name: 'demo-pre',
          enforce: 'pre',
          configureServer: (ctx) => ctx.use(respondTagged('mock'), 'pre'),
        },
        {
          name: 'demo-post',
          enforce: 'post',
          configureServer: (ctx) => ctx.use(respondTagged('post'), 'post'),
        },
      ],
    });

    try {
      expect(await (await fetch(`${server.url}mock`)).text()).toBe('mock');
      expect(await (await fetch(`${server.url}post`)).text()).toBe('post');
    } finally {
      await server.close();
    }
  });

  it('插件无法绕过点文件与越界拦截', async () => {
    const server = await createServer({
      root,
      port: 0,
      plugins: [
        {
          name: 'wide-open',
          enforce: 'pre',
          configureServer: (ctx) => ctx.use(() => false, 'pre'),
        },
      ],
    });

    try {
      expect((await fetch(`${server.url}.env`)).status).toBe(403);
    } finally {
      await server.close();
    }
  });
});

describe('生命周期', () => {
  it('close() 后端口释放、请求失败', async () => {
    const server = await createServer({ root, port: 0 });
    await expect(server.close()).resolves.toBeUndefined();
    await expect(fetch(server.url)).rejects.toThrow();
  });

  it('两个文件都不存在时，优先报证书', async () => {
    await expect(
      createServer({ root, port: 0, cert: 'no-cert.pem', key: 'no-key.pem' }),
    ).rejects.toThrow('证书文件不存在');
  });

  it('私钥缺失时明确指出是私钥', async () => {
    const certPath = path.join(root, 'dummy-cert.pem');
    await writeFile(certPath, 'dummy cert content');
    try {
      await expect(
        createServer({ root, port: 0, cert: certPath, key: 'no-key.pem' }),
      ).rejects.toThrow('私钥文件不存在');
    } finally {
      await rm(certPath, { force: true });
    }
  });

  it('端口已被占用时抛出可读错误', async () => {
    const first = await createServer({ root, port: 0 });
    try {
      await expect(createServer({ root, port: first.port })).rejects.toThrow('已被占用');
    } finally {
      await first.close();
    }
  });

  it('port 为 0 时由系统分配实际端口', async () => {
    const server = await createServer({ root, port: 0 });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.url).toContain(`:${server.port}`);
    } finally {
      await server.close();
    }
  });
});
