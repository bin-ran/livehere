#!/usr/bin/env node
/**
 * 选名体检：判断一个 npm 包名能不能发出去。
 *
 *   node scripts/name-check.mjs iive portserve
 *   pnpm name-check livehere
 *
 * 检查三件事：
 * 1) 注册表状态：空 / 已被占用 / 被 unpublish 保留（名字锁死）
 * 2) 编辑距离 1 的邻居里有多少已存在的包（npm 的相似名称策略会看这个）
 * 3) 同形混淆：i↔l、0↔o 之类的替换是否会命中已有包（反 typosquat 重点打击的形态）
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const HOMOGLYPHS = [
  ['i', 'l'],
  ['l', 'i'],
  ['o', '0'],
  ['0', 'o'],
  ['1', 'l'],
  ['1', 'i'],
  ['rn', 'm'],
  ['vv', 'w'],
];
const CONCURRENCY = 24;
const TIMEOUT_MS = 15_000;

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error('用法：node scripts/name-check.mjs <name> [name...]');
  process.exit(1);
}

/** 生成编辑距离 1 的全部候选（替换 / 删除 / 交换 / 插入） */
function neighbors(name) {
  const set = new Set();

  for (let index = 0; index < name.length; index += 1) {
    for (const char of ALPHABET) {
      set.add(name.slice(0, index) + char + name.slice(index + 1));
    }
    set.add(name.slice(0, index) + name.slice(index + 1));
    if (index < name.length - 1) {
      set.add(name.slice(0, index) + name[index + 1] + name[index] + name.slice(index + 2));
    }
  }
  for (let index = 0; index <= name.length; index += 1) {
    for (const char of LETTERS) {
      set.add(name.slice(0, index) + char + name.slice(index));
    }
  }

  set.delete(name);
  return [...set];
}

function homoglyphVariants(name) {
  const variants = new Set();
  for (const [from, to] of HOMOGLYPHS) {
    if (!name.includes(from)) continue;
    variants.add(name.split(from).join(to));
  }
  return [...variants].filter((variant) => variant !== name);
}

async function request(pathname) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pathname)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return response;
}

async function registryState(name) {
  const response = await request(name);
  if (response.status === 404) return { state: 'free' };

  const body = await response.json();
  const time = body.time ?? {};
  if (time.unpublished)
    return { state: 'reserved', detail: `unpublished ${time.unpublished.time?.slice(0, 10)}` };

  const versions = Object.keys(body.versions ?? {}).length;
  return { state: 'taken', detail: `${versions} 个版本` };
}

/** 批量查询是否存在（只关心 200/404），带并发控制 */
async function existingOf(list) {
  const existing = [];
  for (let index = 0; index < list.length; index += CONCURRENCY) {
    const batch = list.slice(index, index + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (candidate) => {
        try {
          const response = await request(candidate);
          return response.status === 200 ? candidate : null;
        } catch {
          return null;
        }
      }),
    );
    for (const hit of results) {
      if (hit !== null) existing.push(hit);
    }
  }
  return existing;
}

function verdict({ state, neighborCount, homoglyphHits, length }) {
  if (state === 'taken') return '不可用（已被占用）';
  if (state === 'reserved') return '不可用（unpublish 后名字被锁）';
  if (homoglyphHits.length > 0) return '高风险（同形拼写会撞已有包）';
  if (length <= 5) return '高风险（短名邻居密度必然高）';
  if (neighborCount === 0) return '低风险（可发）';
  if (neighborCount <= 2) return '中低风险（大概率可发）';
  if (neighborCount <= 6) return '中风险（参考 livd：6 个邻居被拒）';
  return '高风险（邻居过多，大概率被拒）';
}

const rows = [];
for (const name of names) {
  const state = await registryState(name);
  const neighborHits = state.state === 'free' ? await existingOf(neighbors(name)) : [];
  const homoglyphHits = state.state === 'free' ? await existingOf(homoglyphVariants(name)) : [];

  rows.push({
    name,
    state,
    neighborCount: neighborHits.length,
    neighborSample: neighborHits.slice(0, 6),
    homoglyphHits,
    length: name.length,
    verdict: verdict({
      state: state.state,
      neighborCount: neighborHits.length,
      homoglyphHits,
      length: name.length,
    }),
  });
}

for (const row of rows) {
  const stateLabel =
    row.state.state === 'free'
      ? '空位'
      : `${row.state.state === 'taken' ? '已占用' : '被锁'}（${row.state.detail ?? ''}）`;
  console.log(`\n${row.name}  [${stateLabel}]`);
  console.log(
    `  长度 ${row.length} | 邻居已存在 ${row.neighborCount}${row.neighborSample.length > 0 ? `（${row.neighborSample.join(', ')}…）` : ''}`,
  );
  if (row.homoglyphHits.length > 0) {
    console.log(`  同形命中：${row.homoglyphHits.join(', ')}`);
  }
  console.log(`  → ${row.verdict}`);
}

const usable = rows.filter((row) => row.verdict.includes('可发'));
console.log(
  usable.length > 0
    ? `\n建议：${usable.map((row) => row.name).join(' / ')}`
    : '\n这批名字都不建议直接发。',
);
