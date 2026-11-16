import http from 'node:http';
import net from 'node:net';
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { proxyPlugin } from '../../src/proxy';
import { createServer, type ServerHandle } from '../../src/server';

interface Echo {
  url: string;
  host: string | undefined;
}

let root = '';
let upstream: http.Server;
let upstreamOrigin = '';
const upstreamSockets = new Set<net.Socket>();

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'livd-proxy-'));
  await writeFile(path.join(root, 'hello.txt'), 'hello from static');
  await writeFile(
    path.join(root, 'webpack.config.js'),
    `module.exports = { devServer: { proxy: { '/api': { target: '__ORIGIN__', changeOrigin: true } } } };\n`,
  );

  upstream = http.createServer((req, res) => {
    const body: Echo = { url: req.url ?? '', host: req.headers.host };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  });

  // ws 透传用的最简 upgrade 回显
  upstream.on('upgrade', (req, socket) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
    );
    socket.on('data', (chunk) => socket.write(chunk));
    socket.on('error', () => {});
  });

  upstream.on('connection', (socket) => {
    upstreamSockets.add(socket);
    socket.on('close', () => upstreamSockets.delete(socket));
  });

  const port = await listen(upstream);
  upstreamOrigin = `http://127.0.0.1:${port}`;

  const configPath = path.join(root, 'webpack.config.js');
  const source = (await import('node:fs/promises')).readFile;
  const content = await source(configPath, 'utf8');
  await writeFile(configPath, content.replace('__ORIGIN__', upstreamOrigin));
});

afterAll(async () => {
  for (const socket of upstreamSockets) socket.destroy();
  upstreamSockets.clear();
  await new Promise<void>((resolve) => {
    upstream.close(() => resolve());
    upstream.closeAllConnections();
  });
  for (const relative of ['hello.txt', 'webpack.config.js']) {
    await rm(path.join(root, relative), { force: true });
  }
  await rmdir(root);
});

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('无法获取端口'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function withProxy(
  config: Parameters<typeof proxyPlugin>[0]['config'],
  run: (server: ServerHandle) => Promise<void>,
): Promise<void> {
  const server = await createServer({ root, port: 0, plugins: [proxyPlugin({ config })] });
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

describe('proxy shorthand URL', () => {
  it('保留 context 前缀，并把 Host 改成上游', async () => {
    await withProxy(`${upstreamOrigin}/api`, async (server) => {
      const response = await fetch(`${server.url}api/users?page=2`);
      const body = (await response.json()) as Echo;

      expect(response.status).toBe(200);
      expect(body.url).toBe('/api/users?page=2');
      expect(body.host).toBe(new URL(upstreamOrigin).host);
    });
  });
});

describe('proxy 配置对象', () => {
  it('stripContext 去掉前缀', async () => {
    await withProxy({ '/api': { target: upstreamOrigin, stripContext: true } }, async (server) => {
      const body = (await (await fetch(`${server.url}api/users?x=1`)).json()) as Echo;
      expect(body.url).toBe('/users?x=1');
    });
  });

  it('pathRewrite 支持 webpack 风格的「正则 → 替换」', async () => {
    await withProxy(
      { '/api': { target: upstreamOrigin, pathRewrite: { '^/api': '/v2' } } },
      async (server) => {
        const body = (await (await fetch(`${server.url}api/users`)).json()) as Echo;
        expect(body.url).toBe('/v2/users');
      },
    );
  });

  it('rewrite 函数优先级最高', async () => {
    await withProxy(
      {
        '/api': {
          target: upstreamOrigin,
          rewrite: (pathname: string) => pathname.replace('/api', '/custom'),
        },
      },
      async (server) => {
        const body = (await (await fetch(`${server.url}api/users`)).json()) as Echo;
        expect(body.url).toBe('/custom/users');
      },
    );
  });

  it('不匹配的路径继续走静态文件', async () => {
    await withProxy({ '/api': { target: upstreamOrigin } }, async (server) => {
      const response = await fetch(`${server.url}hello.txt`);
      expect(await response.text()).toBe('hello from static');
    });
  });

  it('多个 context 可以同时挂载', async () => {
    await withProxy(
      {
        '/api': { target: upstreamOrigin, stripContext: true },
        '/rest': { target: upstreamOrigin, pathRewrite: { '^/rest': '/api' } },
      },
      async (server) => {
        expect(((await (await fetch(`${server.url}api/a`)).json()) as Echo).url).toBe('/a');
        expect(((await (await fetch(`${server.url}rest/a`)).json()) as Echo).url).toBe('/api/a');
      },
    );
  });
});

describe('proxy 配置文件', () => {
  it('兼容 webpack 的 devServer.proxy', async () => {
    await withProxy('webpack.config.js', async (server) => {
      const body = (await (await fetch(`${server.url}api/users`)).json()) as Echo;
      expect(body.url).toBe('/api/users');
    });
  });

  it('配置文件相对当前工作目录解析（不在 ROOT 内也能找到）', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'livd-proxy-cwd-'));
    const configPath = path.join(configDir, 'proxy.cwd.json');
    await writeFile(
      configPath,
      JSON.stringify({ '/api': { target: upstreamOrigin, stripContext: true } }),
    );

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(configDir);
    try {
      await withProxy('proxy.cwd.json', async (server) => {
        const body = (await (await fetch(`${server.url}api/users`)).json()) as Echo;
        expect(body.url).toBe('/users');
      });
    } finally {
      cwdSpy.mockRestore();
      await rm(configPath, { force: true });
      await rmdir(configDir);
    }
  });

  it('配置文件不存在时给出明确错误', async () => {
    await expect(
      createServer({ root, port: 0, plugins: [proxyPlugin({ config: 'nope.config.js' })] }),
    ).rejects.toThrow('找不到 proxy 配置文件');
  });

  it('target 非法时启动即报错', async () => {
    await expect(
      createServer({
        root,
        port: 0,
        plugins: [proxyPlugin({ config: { '/api': { target: 'ftp://x' } } })],
      }),
    ).rejects.toThrow('只支持 http/https');
  });
});

describe('异常与 ws', () => {
  it('上游不可达时返回 502', async () => {
    const probe = http.createServer();
    const deadPort = await listen(probe);
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    await withProxy({ '/api': { target: `http://127.0.0.1:${deadPort}` } }, async (server) => {
      const response = await fetch(`${server.url}api/users`);
      expect(response.status).toBe(502);
      expect(await response.text()).toContain('不可达');
    });
  });

  it('WebSocket upgrade 透传到上游', async () => {
    await withProxy({ '/api': { target: upstreamOrigin } }, async (server) => {
      const result = await upgradeEcho(server.port, '/api/socket', 'ping');
      expect(result.head).toContain('101 Switching Protocols');
      expect(result.echo).toBe('ping');
    });
  });
});

function upgradeEcho(
  port: number,
  requestPath: string,
  payload: string,
): Promise<{ head: string; echo: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('ws 透传超时'));
    }, 5000);

    let buffer = '';
    let sent = false;

    socket.on('connect', () => {
      socket.write(
        [
          `GET ${requestPath} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n'),
      );
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (!sent && buffer.includes('\r\n\r\n')) {
        sent = true;
        socket.write(payload);
        return;
      }
      if (sent && buffer.includes(payload)) {
        clearTimeout(timer);
        socket.end();
        resolve({ head: buffer.slice(0, buffer.indexOf('\r\n\r\n')), echo: payload });
      }
    });

    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
