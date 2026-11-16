import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BadRequestError,
  hasDotSegment,
  pathnameOf,
  resolveWithinRoot,
  trimTrailingSlash,
} from '../../src/utils/path';
import type { Req } from '../../src/types';

function reqWith(url: string): Req {
  return { url } as unknown as Req;
}

describe('pathnameOf', () => {
  it('去掉查询串', () => {
    expect(pathnameOf(reqWith('/a/b.txt?x=1'))).toBe('/a/b.txt');
  });

  it('解码百分号编码', () => {
    expect(pathnameOf(reqWith('/a%20b/c.txt'))).toBe('/a b/c.txt');
  });

  it('补前导斜杠', () => {
    expect(pathnameOf(reqWith('a.txt'))).toBe('/a.txt');
  });

  it('url 缺失时回落到 /', () => {
    expect(pathnameOf(reqWith(undefined as unknown as string))).toBe('/');
  });

  it('非法编码抛 BadRequestError', () => {
    expect(() => pathnameOf(reqWith('/%E0%A4%A'))).toThrow(BadRequestError);
  });

  it('包含空字节抛 BadRequestError', () => {
    expect(() => pathnameOf(reqWith('/a%00b'))).toThrow(BadRequestError);
  });
});

describe('resolveWithinRoot', () => {
  const root = path.resolve('/srv/public');

  it('普通路径落在 root 内', () => {
    expect(resolveWithinRoot(root, '/a/b.txt')).toBe(path.join(root, 'a', 'b.txt'));
  });

  it('/ 指向 root 本身', () => {
    expect(resolveWithinRoot(root, '/')).toBe(root);
  });

  it('.. 越界返回 undefined', () => {
    expect(resolveWithinRoot(root, '/../secret')).toBeUndefined();
  });

  it('多级 .. 越界返回 undefined', () => {
    expect(resolveWithinRoot(root, '/a/../../secret')).toBeUndefined();
  });

  it('Windows 反斜杠越界返回 undefined', () => {
    expect(resolveWithinRoot(root, '/..\\..\\secret')).toBeUndefined();
  });

  it('形似但不在 root 内的兄弟目录返回 undefined', () => {
    expect(resolveWithinRoot(root, '/../public-backup')).toBeUndefined();
  });
});

describe('hasDotSegment', () => {
  it('识别点文件', () => {
    expect(hasDotSegment('/.env')).toBe(true);
    expect(hasDotSegment('/a/.git/config')).toBe(true);
  });

  it('普通文件不算点文件', () => {
    expect(hasDotSegment('/a/env.txt')).toBe(false);
    expect(hasDotSegment('/a/.hidden.txt'.replace('/.hidden.txt', '/hidden.txt'))).toBe(false);
  });

  it('不会把 / 或 .. 误判为点文件', () => {
    expect(hasDotSegment('/')).toBe(false);
    expect(hasDotSegment('/..')).toBe(false);
  });
});

describe('trimTrailingSlash', () => {
  it('去掉尾部斜杠', () => {
    expect(trimTrailingSlash('/a/b/')).toBe('/a/b');
  });

  it('根路径保持不变', () => {
    expect(trimTrailingSlash('/')).toBe('/');
  });
});
