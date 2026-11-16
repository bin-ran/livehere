#!/usr/bin/env node
/**
 * 发布前的元数据自检：这些字段错了，npm 上修不回来（只能再发一个版本），
 * 尤其是 repository —— provenance 会拿它和实际运行的工作流做比对。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };

const root = path.resolve(import.meta.dirname, '..');
const problems = [];

function expect(condition, message) {
  if (!condition) problems.push(message);
}

const PLACEHOLDER = /<[^>]*>/;
const REPO_PATTERN = /^git\+https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;

const repository =
  typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '');
const homepage = pkg.homepage ?? '';
const bugs = typeof pkg.bugs === 'string' ? pkg.bugs : (pkg.bugs?.url ?? '');

expect(repository !== '', 'package.json 缺少 repository');
expect(!PLACEHOLDER.test(repository), `repository 仍是占位符：${repository}`);
expect(
  REPO_PATTERN.test(repository),
  `repository 应为 git+https://github.com/<user>/<repo>：${repository}`,
);
expect(!PLACEHOLDER.test(homepage), `homepage 仍是占位符：${homepage}`);
expect(!PLACEHOLDER.test(bugs), `bugs.url 仍是占位符：${bugs}`);
expect(Boolean(pkg.license), 'package.json 缺少 license');
expect(Boolean(pkg.bin?.livd), 'package.json 缺少 bin.livd');
expect(Boolean(pkg.exports?.['.']?.types), 'exports["."] 缺少 types');
expect(
  Object.keys(pkg.dependencies ?? {}).length === 0,
  '运行时依赖应为 0：第三方包需要内联进 dist（见 tsdown.config.ts 的 deps.alwaysBundle）',
);

// trusted publishing 的关键前提，写在仓库里比写在脑子里可靠
const workflowPath = path.join(root, '.github', 'workflows', 'release.yml');
if (!existsSync(workflowPath)) {
  problems.push('缺少 .github/workflows/release.yml（npm trusted publisher 要求该文件名匹配）');
} else {
  const workflow = readFileSync(workflowPath, 'utf8');
  expect(/id-token:\s*write/.test(workflow), 'release.yml 缺少 id-token: write（OIDC 必需）');
  expect(
    /npm publish/.test(workflow),
    'release.yml 里没有 npm publish（若改用 npm stage publish，请同步 npm 后台的 Allowed actions）',
  );
}

if (problems.length > 0) {
  console.error('发布元数据检查未通过：\n');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error('\n修好后再发布，避免发出去无法修正。');
  process.exit(1);
}

console.log(`发布元数据检查通过（${pkg.name}@${pkg.version}）`);
