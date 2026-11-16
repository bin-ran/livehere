import { describe, expect, it } from 'vitest';
import { escapeHtml, formatBytes, sendHtml, sendStatus } from '../../src/utils/http';
import type { Res } from '../../src/types';

interface FakeResponse {
  statusCode: number;
  headers: Map<string, unknown>;
  body: Buffer | undefined;
  ended: boolean;
  setHeader(name: string, value: unknown): void;
  removeHeader(name: string): void;
  end(chunk?: unknown): void;
}

function fakeResponse(): FakeResponse {
  return {
    statusCode: 0,
    headers: new Map<string, unknown>(),
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers.set(name.toLowerCase(), value);
    },
    removeHeader(name) {
      this.headers.delete(name.toLowerCase());
    },
    end(chunk) {
      this.ended = true;
      if (chunk !== undefined) {
        this.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      }
    },
  };
}

describe('escapeHtml', () => {
  it('转义五个危险字符', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('普通文本保持不变', () => {
    expect(escapeHtml('普通文件名.txt')).toBe('普通文件名.txt');
  });
});

describe('formatBytes', () => {
  it('小于 1KB 显示 B', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('KB 保留一位小数', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('MB 以上换算正确', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('非法输入返回占位符', () => {
    expect(formatBytes(Number.NaN)).toBe('-');
  });
});

describe('sendStatus', () => {
  it('写入状态码与文本 body', () => {
    const res = fakeResponse();
    sendStatus(res as unknown as Res, 404, 'Not Found');

    expect(res.statusCode).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('content-length')).toBe(9);
    expect(res.body?.toString()).toBe('Not Found');
  });

  it('204 不写 body', () => {
    const res = fakeResponse();
    sendStatus(res as unknown as Res, 204);

    expect(res.statusCode).toBe(204);
    expect(res.body).toBeUndefined();
    expect(res.ended).toBe(true);
  });
});

describe('sendHtml', () => {
  it('带 no-store 缓存头', () => {
    const res = fakeResponse();
    sendHtml(res as unknown as Res, '<h1>hi</h1>');

    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.body?.toString()).toBe('<h1>hi</h1>');
  });

  it('HEAD 请求只写头不写 body', () => {
    const res = fakeResponse();
    sendHtml(res as unknown as Res, '<h1>hi</h1>', false);

    expect(res.headers.get('content-length')).toBe(11);
    expect(res.body).toBeUndefined();
  });
});
