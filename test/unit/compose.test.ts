import { describe, expect, it } from 'vitest';
import { compose } from '../../src/utils/compose';
import type { Handler, RequestContext } from '../../src/types';

function fakeContext(id: string): RequestContext {
  return { root: '/tmp', req: { url: id }, res: {}, config: {} } as unknown as RequestContext;
}

function traceHandler(trace: string[], name: string, handled = false): Handler {
  return () => {
    trace.push(name);
    return handled;
  };
}

describe('compose', () => {
  it('按顺序执行所有 handler', async () => {
    const trace: string[] = [];
    const pipeline = compose(
      [traceHandler(trace, 'a'), traceHandler(trace, 'b')],
      traceHandler(trace, 'miss', true),
    );

    await pipeline(fakeContext('/'));

    expect(trace).toEqual(['a', 'b', 'miss']);
  });

  it('返回 true 时短路，后续 handler 不再执行', async () => {
    const trace: string[] = [];
    const pipeline = compose(
      [traceHandler(trace, 'a', true), traceHandler(trace, 'b')],
      traceHandler(trace, 'miss', true),
    );

    await pipeline(fakeContext('/'));

    expect(trace).toEqual(['a']);
  });

  it('支持异步 handler', async () => {
    const trace: string[] = [];
    const asyncHandler: Handler = async () => {
      await Promise.resolve();
      trace.push('async');
      return false;
    };

    const pipeline = compose([asyncHandler], traceHandler(trace, 'miss', true));
    await pipeline(fakeContext('/'));

    expect(trace).toEqual(['async', 'miss']);
  });

  it('handler 抛错时向上冒泡，由调用方兜底', async () => {
    const pipeline = compose(
      [
        () => {
          throw new Error('boom');
        },
      ],
      traceHandler([], 'miss', true),
    );

    await expect(pipeline(fakeContext('/'))).rejects.toThrow('boom');
  });
});
