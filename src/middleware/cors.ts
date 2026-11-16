import type { Handler } from '../types';
import { sendStatus } from '../utils/http';

/**
 * CORS 默认关闭。-c/--cors 才开启，可指定唯一 origin。
 * 预检请求在这里就地应答，不进入后续管线。
 */
export function createCors(origin: string | false): Handler {
  if (origin === false) return () => false;

  return (ctx) => {
    const { req, res } = ctx;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');

    if (req.method !== 'OPTIONS') return false;

    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] ?? 'Content-Type',
    );
    res.setHeader('Access-Control-Max-Age', '600');
    return sendStatus(res, 204);
  };
}
