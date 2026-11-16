import type { Duplex } from 'node:stream';
import type { ResolvedOptions } from './options';
import type { Handler, Req } from './types';

/** pre：静态文件之前；post：静态文件未命中之后 */
export type PluginPhase = 'pre' | 'post';

/** 返回 true 表示「这个 upgrade 请求已接管」，否则由服务器断开 socket */
export type UpgradeListener = (req: Req, socket: Duplex, head: Buffer) => boolean | void;

export interface ServerContext {
  readonly root: string;
  readonly config: ResolvedOptions;
  use(handler: Handler, phase?: PluginPhase): void;
  /** 注册 WebSocket / HTTP upgrade 处理器（例如反向代理的 ws 透传） */
  handleUpgrade(listener: UpgradeListener): void;
  log(message: string): void;
}

export interface Plugin {
  name: string;
  /** 只影响插件之间的相对顺序；内置中间件的顺序固定，不可调整 */
  enforce?: PluginPhase;
  configResolved?(config: ResolvedOptions): void | Promise<void>;
  configureServer?(context: ServerContext): void | Promise<void>;
  /** 服务器关闭时释放插件自己持有的资源（watcher、长连接等） */
  onClose?(): void | Promise<void>;
}

export interface PluginHandlers {
  pre: Handler[];
  post: Handler[];
  upgrade: UpgradeListener[];
}

const PHASE_WEIGHT: Record<PluginPhase, number> = { pre: 0, post: 2 };

function weightOf(plugin: Plugin): number {
  return plugin.enforce === undefined ? 1 : PHASE_WEIGHT[plugin.enforce];
}

/**
 * 按 enforce 排序后逐个调用 configureServer，收集它们注册的中间件。
 * 同 enforce 下保持声明顺序（Array#sort 稳定）。
 */
export async function collectPluginHandlers(
  plugins: readonly Plugin[],
  config: ResolvedOptions,
  log: (message: string) => void = () => {},
): Promise<PluginHandlers> {
  const ordered = plugins.toSorted((left, right) => weightOf(left) - weightOf(right));
  const buckets: PluginHandlers = { pre: [], post: [], upgrade: [] };
  const seen = new Set<string>();

  for (const plugin of ordered) {
    if (typeof plugin.name !== 'string' || plugin.name === '') {
      throw new Error('插件必须提供非空的 name');
    }
    if (seen.has(plugin.name)) {
      throw new Error(`插件名重复：${plugin.name}`);
    }
    seen.add(plugin.name);

    await plugin.configResolved?.(config);
    await plugin.configureServer?.({
      root: config.root,
      config,
      use: (handler, phase = 'pre') => {
        buckets[phase].push(handler);
      },
      handleUpgrade: (listener) => {
        buckets.upgrade.push(listener);
      },
      log,
    });
  }

  return buckets;
}
