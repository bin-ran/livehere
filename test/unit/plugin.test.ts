import { describe, expect, it } from 'vitest';
import { collectPluginHandlers, type Plugin } from '../../src/plugin';
import { DEFAULT_INDEX, type ResolvedOptions } from '../../src/options';

const config: ResolvedOptions = {
  root: '/tmp',
  port: 8000,
  host: '127.0.0.1',
  fallback: DEFAULT_INDEX,
  cors: false,
  listing: true,
  log: false,
  https: false,
  httpsPort: false,
  cert: undefined,
  key: undefined,
  plugins: [],
};

function tagHandler(tag: string) {
  return () => {
    void tag;
    return false;
  };
}

describe('collectPluginHandlers', () => {
  it('按声明顺序调用 configureServer', async () => {
    const calls: string[] = [];
    const plugins: Plugin[] = [
      { name: 'a', configureServer: () => void calls.push('a') },
      { name: 'b', configureServer: () => void calls.push('b') },
    ];

    await collectPluginHandlers(plugins, config);
    expect(calls).toEqual(['a', 'b']);
  });

  it('enforce 决定分组：pre 进 pre 桶，post 进 post 桶，默认进 pre', async () => {
    const plugins: Plugin[] = [
      {
        name: 'post',
        enforce: 'post',
        configureServer: (ctx) => ctx.use(tagHandler('post'), 'post'),
      },
      {
        name: 'default',
        configureServer: (ctx) => ctx.use(tagHandler('default')),
      },
      {
        name: 'pre',
        enforce: 'pre',
        configureServer: (ctx) => ctx.use(tagHandler('pre'), 'pre'),
      },
    ];

    const { pre, post } = await collectPluginHandlers(plugins, config);

    expect(pre).toHaveLength(2);
    expect(post).toHaveLength(1);
  });

  it('先调用 configResolved 再调用 configureServer', async () => {
    const calls: string[] = [];
    const plugin: Plugin = {
      name: 'lifecycle',
      configResolved: (resolved) => {
        calls.push(`resolved:${resolved.host}`);
      },
      configureServer: () => {
        calls.push('configure');
      },
    };

    await collectPluginHandlers([plugin], config);
    expect(calls).toEqual(['resolved:127.0.0.1', 'configure']);
  });

  it('插件名重复时报错', async () => {
    await expect(collectPluginHandlers([{ name: 'dup' }, { name: 'dup' }], config)).rejects.toThrow(
      '插件名重复',
    );
  });

  it('缺少 name 时报错', async () => {
    await expect(collectPluginHandlers([{ name: '' }], config)).rejects.toThrow('非空的 name');
  });
});
