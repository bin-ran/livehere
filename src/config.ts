import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ServeOptions } from './options';

/** 自动查找的文件名，按优先级排列 */
const CONFIG_FILES = [
  'livehere.config.ts',
  'livehere.config.mts',
  'livehere.config.js',
  'livehere.config.mjs',
  'livehere.config.json',
] as const;

export interface LoadConfigOptions {
  /** 查找配置的目录（通常是服务根目录） */
  root: string;
  /** 显式指定的配置文件（相对 root 或绝对路径） */
  explicit?: string;
}

export interface LoadConfigResult {
  config: ServeOptions;
  /** 实际加载到的文件；没有配置时是 undefined */
  file: string | undefined;
}

/**
 * 加载 livehere.config.*：
 * - 没传 explicit 时在 root 下按 CONFIG_FILES 顺序找第一个存在的
 * - `.json` 走 JSON.parse，其余走动态 import（Node ≥22.18 可直接 import .ts）
 */
export async function loadConfig(options: LoadConfigOptions): Promise<LoadConfigResult> {
  const file =
    options.explicit === undefined
      ? await findConfigFile(options.root)
      : path.resolve(options.root, options.explicit);

  if (file === undefined) return { config: {}, file: undefined };

  if (options.explicit !== undefined) {
    const exists = await isFile(file);
    if (!exists) throw new Error(`配置文件不存在：${file}`);
  }

  const loaded = await importConfig(file);
  if (!isPlainObject(loaded)) {
    throw new Error(`配置文件必须导出对象：${file}`);
  }

  return { config: loaded as ServeOptions, file };
}

async function findConfigFile(root: string): Promise<string | undefined> {
  for (const name of CONFIG_FILES) {
    const candidate = path.join(root, name);
    if (await isFile(candidate)) return candidate;
  }
  return undefined;
}

async function isFile(target: string): Promise<boolean> {
  try {
    const stats = await fs.stat(target);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function importConfig(file: string): Promise<unknown> {
  if (file.endsWith('.json')) {
    let source: string;
    try {
      source = await fs.readFile(file, 'utf8');
    } catch {
      throw new Error(`配置文件不存在：${file}`);
    }
    try {
      return JSON.parse(source) as unknown;
    } catch (error) {
      throw new Error(`配置文件不是合法 JSON：${file}`, { cause: error });
    }
  }

  let module: { default?: unknown; config?: unknown };
  try {
    module = (await import(pathToFileURL(file).href)) as { default?: unknown; config?: unknown };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (
      code === 'ERR_UNKNOWN_FILE_EXTENSION' ||
      code === 'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING'
    ) {
      throw new Error(
        `当前 Node（${process.version}）无法直接加载 ${path.basename(file)}，` +
          '请改用 livehere.config.js / .mjs / .json，或升级到 Node ≥ 22.18',
        { cause: error },
      );
    }
    throw error;
  }

  return module.default ?? module.config ?? module;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
