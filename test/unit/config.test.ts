import { mkdtemp, rmdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

const created: { dir: string; files: string[]; dirs: string[] }[] = [];

async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'livehere-config-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content);
  }
  created.push({ dir, files: Object.keys(files), dirs: [] });
  return dir;
}

afterEach(async () => {
  for (const entry of created.splice(0)) {
    for (const file of entry.files) {
      await rm(path.join(entry.dir, file), { force: true });
    }
    for (const sub of entry.dirs) {
      await rmdir(path.join(entry.dir, sub));
    }
    await rmdir(entry.dir);
  }
});

describe('loadConfig', () => {
  it('没有配置文件时返回空配置', async () => {
    const dir = await workspace({});
    const result = await loadConfig({ root: dir });

    expect(result.config).toEqual({});
    expect(result.file).toBeUndefined();
  });

  it('自动查找 livehere.config.js（CommonJS 导出）', async () => {
    const dir = await workspace({
      'livehere.config.js': 'module.exports = { port: 8200, listing: false };',
    });

    const result = await loadConfig({ root: dir });

    expect(result.config.port).toBe(8200);
    expect(result.config.listing).toBe(false);
    expect(result.file).toBe(path.join(dir, 'livehere.config.js'));
  });

  it('自动查找 livehere.config.mjs（ESM 导出）', async () => {
    const dir = await workspace({
      'livehere.config.mjs': 'export default { cors: true, fallback: "/index.html" };',
    });

    const result = await loadConfig({ root: dir });

    expect(result.config.cors).toBe(true);
    expect(result.config.fallback).toBe('/index.html');
  });

  it('支持 livehere.config.ts（Node ≥22.18 原生类型擦除）', async () => {
    const dir = await workspace({
      'livehere.config.ts': 'export default { port: 8300 satisfies number, log: true };',
    });

    const result = await loadConfig({ root: dir });

    expect(result.config.port).toBe(8300);
    expect(result.config.log).toBe(true);
  });

  it('支持 livehere.config.json', async () => {
    const dir = await workspace({ 'livehere.config.json': '{ "listing": false }' });

    const result = await loadConfig({ root: dir });

    expect(result.config.listing).toBe(false);
  });

  it('优先级：.ts 排在 .js 之前', async () => {
    const dir = await workspace({
      'livehere.config.ts': 'export default { port: 1 };',
      'livehere.config.js': 'module.exports = { port: 2 };',
    });

    const result = await loadConfig({ root: dir });

    expect(result.config.port).toBe(1);
    expect(result.file).toBe(path.join(dir, 'livehere.config.ts'));
  });

  it('显式指定的文件名不受自动查找影响', async () => {
    const dir = await workspace({
      'my.config.mjs': 'export default { port: 8400 };',
      'livehere.config.js': 'module.exports = { port: 1 };',
    });

    const result = await loadConfig({ root: dir, explicit: 'my.config.mjs' });

    expect(result.config.port).toBe(8400);
  });

  it('显式指定但文件不存在时报错', async () => {
    const dir = await workspace({});

    await expect(loadConfig({ root: dir, explicit: 'nope.config.js' })).rejects.toThrow(
      '配置文件不存在',
    );
  });

  it('导出不是对象时报错', async () => {
    const dir = await workspace({ 'livehere.config.mjs': 'export default 42;' });

    await expect(loadConfig({ root: dir })).rejects.toThrow('必须导出对象');
  });

  it('JSON 非法时报错', async () => {
    const dir = await workspace({ 'livehere.config.json': '{ oops' });

    await expect(loadConfig({ root: dir })).rejects.toThrow('不是合法 JSON');
  });
});
