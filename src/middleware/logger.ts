import { performance } from 'node:perf_hooks';
import type { Handler } from '../types';

export type LogWriter = (line: string) => void;

/** 访问日志：在响应结束时打印，不阻塞请求 */
export function createLogger(
  enabled: boolean,
  write: LogWriter = (line) => console.log(line),
): Handler {
  if (!enabled) return () => false;

  return (ctx) => {
    const startedAt = performance.now();
    ctx.res.once('finish', () => {
      const elapsed = (performance.now() - startedAt).toFixed(1);
      const method = ctx.req.method ?? 'GET';
      const url = ctx.req.url ?? '/';
      write(`${ctx.res.statusCode} ${method} ${url} ${elapsed}ms`);
    });
    return false;
  };
}
