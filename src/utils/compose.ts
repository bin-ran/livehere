import type { Handler, RequestContext } from '../types';

/**
 * 极简中间件组合器：顺序执行，某个 handler 返回 true 即短路。
 * 相比 connect 的 next() 写法，这里没有回调嵌套，每个中间件都能被单独 await。
 */
export function compose(handlers: readonly Handler[], onMiss: Handler) {
  return async function handle(ctx: RequestContext): Promise<void> {
    for (const handler of handlers) {
      const handled = await handler(ctx);
      if (handled === true) return;
    }
    await onMiss(ctx);
  };
}
