import fs from 'node:fs/promises';
import type { ResolvedOptions } from './options';
import { isLoopbackHost } from './utils/net';

export interface TlsMaterial {
  key: string;
  cert: string;
}

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * 证书来源：
 * 1) 显式给了 cert/key → 直接读
 * 2) 否则现场生成自签证书（EC P-256，几十毫秒），不落盘、不会过期
 */
export async function loadTlsMaterial(config: ResolvedOptions): Promise<TlsMaterial> {
  if (config.cert !== undefined && config.key !== undefined) {
    const [cert, key] = await Promise.all([
      readPem(config.cert, '证书'),
      readPem(config.key, '私钥'),
    ]);
    return { cert, key };
  }

  const { generate } = await import('selfsigned');
  const commonName = isLoopbackHost(config.host) ? 'localhost' : config.host;
  const pems = await generate([{ name: 'commonName', value: commonName }], {
    keyType: 'ec',
    curve: 'P-256',
    notAfterDate: new Date(Date.now() + ONE_YEAR_MS),
  });

  return { cert: pems.cert, key: pems.private };
}

async function readPem(file: string, label: string): Promise<string> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      throw new Error(`${label}文件不存在：${file}`, { cause: error });
    }
    throw new Error(`无法读取${label}文件：${file}`, { cause: error });
  }
}
