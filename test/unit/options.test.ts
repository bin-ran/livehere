import { mkdtemp, mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveOptions } from '../../src/options';
import type { Plugin } from '../../src/plugin';

let workspace = '';

beforeAll(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), 'livd-options-'));
  await mkdir(path.join(workspace, 'site'));
  await writeFile(path.join(workspace, 'file.txt'), 'x');
});

afterAll(async () => {
  await rm(path.join(workspace, 'file.txt'), { force: true });
  await rmdir(path.join(workspace, 'site'));
  await rmdir(workspace);
});

describe('resolveOptions 默认值', () => {
  it('默认只监听本机、开启目录列表、关闭 CORS 与日志', async () => {
    const config = await resolveOptions({ root: path.join(workspace, 'site') });

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8000);
    expect(config.listing).toBe(true);
    expect(config.cors).toBe(false);
    expect(config.log).toBe(false);
    expect(config.fallback).toBe(false);
    expect(config.https).toBe(false);
    expect(config.httpsPort).toBe(false);
  });

  it('root 归一化为绝对路径', async () => {
    const config = await resolveOptions({ root: path.join(workspace, 'site') });
    expect(path.isAbsolute(config.root)).toBe(true);
  });
});

describe('resolveOptions 校验', () => {
  it('目录不存在时报错', async () => {
    await expect(resolveOptions({ root: path.join(workspace, 'nope') })).rejects.toThrow(
      '目录不存在',
    );
  });

  it('目标是文件时报错', async () => {
    await expect(resolveOptions({ root: path.join(workspace, 'file.txt') })).rejects.toThrow(
      '不是目录',
    );
  });

  it('端口非法时报错', async () => {
    await expect(resolveOptions({ root: workspace, port: 70000 })).rejects.toThrow('port');
    await expect(resolveOptions({ root: workspace, port: 80.5 })).rejects.toThrow('port');
  });

  it('cert 与 key 必须成对出现', async () => {
    await expect(resolveOptions({ root: workspace, cert: 'a.pem' })).rejects.toThrow(
      '必须同时提供',
    );
  });
});

describe('resolveOptions 归一化', () => {
  it('fallback 补前导斜杠，斜杠结尾时补 index.html', async () => {
    expect((await resolveOptions({ root: workspace, fallback: 'index.html' })).fallback).toBe(
      '/index.html',
    );
    expect((await resolveOptions({ root: workspace, fallback: '/spa/' })).fallback).toBe(
      '/spa/index.html',
    );
    expect((await resolveOptions({ root: workspace, fallback: true })).fallback).toBe(
      '/index.html',
    );
  });

  it('fallback 越界时报错，而不是等到运行时才 403', async () => {
    await expect(resolveOptions({ root: workspace, fallback: '/../outside.html' })).rejects.toThrow(
      'fallback 必须是 root 内的路径',
    );
  });

  it('cors 的 true / 空串都归一化为 *', async () => {
    expect((await resolveOptions({ root: workspace, cors: true })).cors).toBe('*');
    expect((await resolveOptions({ root: workspace, cors: ' ' })).cors).toBe('*');
    expect((await resolveOptions({ root: workspace, cors: 'https://a.dev' })).cors).toBe(
      'https://a.dev',
    );
  });

  it('开启 https 时端口默认是 http 端口 + 1', async () => {
    const config = await resolveOptions({ root: workspace, port: 3000, https: true });
    expect(config.https).toBe(true);
    expect(config.httpsPort).toBe(3001);
  });

  it('给了 cert/key 即视为开启 https', async () => {
    const config = await resolveOptions({ root: workspace, cert: 'a.pem', key: 'b.pem' });
    expect(config.https).toBe(true);
    expect(config.cert).toBe('a.pem');
  });

  it('plugins 做浅拷贝，避免外部改动影响实例', async () => {
    const plugin: Plugin = { name: 'demo' };
    const plugins = [plugin];
    const config = await resolveOptions({ root: workspace, plugins });

    plugins.push({ name: 'other' });
    expect(config.plugins).toHaveLength(1);
  });
});
