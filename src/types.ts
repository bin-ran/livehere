import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ResolvedOptions } from './options';

export type Req = IncomingMessage;
export type Res = ServerResponse;

/** 每个中间件收到的上下文 */
export interface RequestContext {
  readonly req: Req;
  readonly res: Res;
  readonly root: string;
  readonly config: ResolvedOptions;
}

/**
 * 返回 `true` 表示「请求已处理完」，管线立刻短路；
 * 返回 `false` / `undefined` 表示交给下一个中间件。
 */
export type Handler = (ctx: RequestContext) => boolean | void | Promise<boolean | void>;
