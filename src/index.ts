export { createServer } from './server';
export type { ServerHandle } from './server';
export { resolveOptions, DEFAULT_INDEX } from './options';
import type { ServeOptions } from './options';

export type { ServeOptions, ResolvedOptions } from './options';
export { collectPluginHandlers } from './plugin';
export type { Plugin, PluginPhase, ServerContext } from './plugin';
export { compose } from './utils/compose';
export type { Handler, RequestContext, Req, Res } from './types';

/** 仅为配置文件提供类型推导：`export default defineConfig({ ... })` */
export function defineConfig(config: ServeOptions): ServeOptions {
  return config;
}
