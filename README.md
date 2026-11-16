# livd

> 命令行叫 `livd`，npm 包名是 `@binran/livd`（`livd` 这个无作用域名被 npm 的相似名称策略拦下，
> 它与 `livan` / `lit` / `lib0` / `levn` / `uid` / `ulid` 编辑距离太近）。

[![CI](https://github.com/bin-ran/livd/actions/workflows/ci.yml/badge.svg)](https://github.com/bin-ran/livd/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@binran/livd.svg)](https://www.npmjs.com/package/@binran/livd)
[![npm downloads](https://img.shields.io/npm/dm/@binran/livd.svg)](https://www.npmjs.com/package/@binran/livd)
[![license](https://img.shields.io/npm/l/@binran/livd.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@binran/livd.svg)](https://nodejs.org)

Serve a folder over HTTP in one command. **Safe by default**: binds to loopback, refuses dotfiles and
path traversal, and never crashes on a busy port.

```sh
npx @binran/livd                                # 当前目录，http://127.0.0.1:8000
npx @binran/livd ./dist                         # 指定目录
npx @binran/livd ./dist -p 3000 -f index.html   # 端口 + SPA fallback
npx @binran/livd ./dist -p auto --host 0.0.0.0  # 端口自动顺延 + 暴露到局域网
npx @binran/livd ./dist -w                      # 保存文件后浏览器自动刷新
npx @binran/livd ./dist -x http://localhost:7000/api   # 把 /api 反代到后端
```

装成全局后命令是 `livd`，下面的示例都按这个写法：

```sh
npm i -g @binran/livd
livd ./dist -p 3000 -w
```

> livd 是一个轻量静态文件服务器。与 `serve` / `http-server` 相比，它的重点是**默认安全**与**可扩展的中间件内核**；
> 与 `anywhere` 相比，它不再默认暴露到局域网、没有内置过期证书、端口占用不会崩。

## 安装

```sh
npm i -g @binran/livd        # 全局命令（或 pnpm add -g @binran/livd）
npx @binran/livd             # 不安装直接用（或 pnpm dlx @binran/livd）
```

装好后命令行是 `livd`（`bin` 名与包名的作用域部分无关）。

要求 Node.js >= **22.18**。运行时零依赖，装完 `node_modules` 里只有 `livd` 一个包。

## 命令行

```
livd [ROOT] [OPTIONS]

  -d, --dir=<dir>         同 ROOT
  -p, --port=<port>       端口，默认 8000；填 auto 时自动顺延
      --host=<host>       监听地址，默认 127.0.0.1
  -f, --fallback=<file>   history fallback 入口（SPA）
  -l, --log               打印访问日志
      --listing           目录列表（默认开启，关闭用 --no-listing）
  -s, --silent            不自动打开浏览器
  -w, --watch             监听文件变化并自动刷新（live reload）
      --poll              轮询监听（Docker / WSL / 网络盘）
  -x, --proxy=<url|file>  反向代理：shorthand URL、配置文件或 webpack.config.js
      --config=<file>     配置文件路径（默认在 ROOT 下自动查找 livd.config.*）
      --cors[=<origin>]   开启 CORS，留空即 *
      --https             额外开启 HTTPS（自签证书，默认端口 = HTTP + 1）
      --https-port=<port> HTTPS 端口
      --cert / --key      自定义证书
  -h, --help              帮助
  -v, --version           版本号
```

例子：

```sh
livd                                  # 当前目录，http://127.0.0.1:8000/
livd ./dist -p 3000                   # 指定目录与端口
livd -p auto                          # 8000 被占用就顺延到 8001
livd --host 0.0.0.0                   # 显式暴露到局域网
livd --cors=https://app.dev           # 只允许指定 origin
livd -f index.html                    # SPA history 模式
livd --https --cert ./c.pem --key ./k.pem
livd -w --poll                        # 容器里监听宿主机挂载目录
livd -x http://localhost:7000/api     # /api/* → http://localhost:7000/api/*
livd -x webpack.config.js             # 直接复用 devServer.proxy
livd -x proxy.config.js               # 自己的配置文件
```

## 配置文件

服务目录下放 `livd.config.ts`（或 `.js` / `.mjs` / `.json`）即可自动生效：

```ts
// livd.config.ts
import { defineConfig } from 'livd';

export default defineConfig({
  port: 3000,
  fallback: true,
  cors: true,
  listing: false,
});
```

- 查找顺序：`livd.config.ts` → `.mts` → `.js` → `.mjs` → `.json`
- 显式指定：`livd --config ./config/livd.mjs`
- **优先级：命令行 > 配置文件 > 默认值**（例如配置里 `listing: false`，命令行加 `--listing` 依然生效）
- `.ts` 用 Node ≥ 22.18 的原生类型擦除加载；更早的版本会给出可读提示，改用 `.js` / `.mjs` / `.json` 即可
- 配置里也可以写 `plugins`（例如 `livePlugin()` / `proxyPlugin()`），CLI 传入的插件排在其后

## 设计要点

管线是固定的，插件无法（也不需要）插入到任意位置：

```
日志 → CORS → 安全闸门(点文件/穿越/编码) → history fallback
     → 插件 pre → 静态文件(命中即返回) → 插件 post → 目录列表 → 404
```

- **静态文件用 `sirv`**：带 ETag、`dev` 模式关强缓存、`.br`/`.gz` 走标准 `Accept-Encoding` 协商
- **目录列表自研**：零依赖、HTML 转义正确、目录优先排序
- **HTTPS 证书现场生成**：EC P-256，不落盘、不会过期（内置证书过期是很多老工具的经典事故）
- **端口占用**：非 `auto` 时给出明确错误；`auto` 时从 8000 顺延最多 20 次，再退回系统分配
- **越界防护**：`realpath` 后的 root + 每次请求重新解析路径，覆盖 `%2e%2e`、反斜杠、空字节
- **live reload 零额外依赖**：`chokidar` 走动态 `import()`（打包成独立 chunk，不带 `-w` 就不会加载），
  浏览器侧用 **SSE** 而不是 WebSocket；只有纯 `.css` 变更时原地替换样式，其它变更整页刷新并恢复滚动位置
- **HTML 注入不影响缓存语义**：拦截 `writeHead` + 缓冲 body，注入后重算 `Content-Length`、去掉 `ETag`/`Last-Modified`，
  避免「刷新后拿到 304、页面永不更新」这个经典坑

## 体积与依赖

| 指标           | 数值            |
| -------------- | --------------- |
| npm tarball    | ~185 kB（gzip） |
| 安装后磁盘占用 | ~1 MB（单个包） |
| **运行时依赖** | **0 个**        |

`citty`、`sirv`、`picocolors`、`chokidar`、`httpxy`、`selfsigned` 全部内联进产物，并按功能拆成按需加载的 chunk：

| chunk（未压缩）                                     | 什么时候加载                |
| --------------------------------------------------- | --------------------------- |
| `cli.mjs` + `server-*.mjs` + 几个 < 2 kB 共享 chunk | 启动即加载（约 75 kB）      |
| `live.mjs` + `chokidar-*.mjs`（120 kB）             | 只在 `-w/--watch` 时        |
| `proxy.mjs`（33 kB）                                | 只在 `-x/--proxy` 时        |
| `selfsigned-*.mjs`（691 kB）                        | 只在 `--https` 且没给证书时 |

## 反向代理的三种写法

| 写法          | 例子                                         | 路径语义                                                          |
| ------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| shorthand URL | `-x http://localhost:7000/api`               | 保留前缀：`/api/users` → `/api/users`                             |
| 配置文件      | `-x webpack.config.js`                       | 自动从 `devServer.proxy` 或 `proxy` 读取，兼容 webpack-dev-server |
| 配置对象      | `{ '/api': { target, stripContext: true } }` | 见下表                                                            |

配置文件路径相对**当前工作目录**解析（`livd ./dist -x webpack.config.js` 能直接找到仓库根的配置），
在当前目录找不到时才回落到 ROOT。

每个 context 支持：

```ts
{
  target: 'http://localhost:7000',  // 必填
  changeOrigin: true,               // 默认 true：把 Host 改写为上游 host
  secure: true,                     // 上游自签证书时可设 false
  ws: true,                         // 默认 true：透传 WebSocket upgrade
  headers: { 'X-From': 'livd' },
  stripContext: true,               // /api/users → /users
  pathRewrite: { '^/api': '/v2' },  // webpack 风格正则改写
  rewrite: (p) => p.replace('/api', ''),  // 函数式，优先级最高
}
```

上游连不上时返回 **502** 并只打印一次警告（不会让请求挂住）；所有 upgrade 请求都会被接管，
`close()` 时会主动销毁已升级的 socket（Node 的 `closeAllConnections` 管不到它们，不清理会让进程退不出去）。

## live reload 是怎么做的

```
chokidar(忽略 node_modules/.git/点文件) → 60ms 去抖 → SSE 广播
                                              ├─ 纯 .css 变更 → 浏览器原地换 <link>，不刷新
                                              └─ 其它变更     → 整页刷新（保留滚动位置）
```

只对「可能是 HTML」的请求注入（`Accept: text/html` 或 `.html` 扩展名），
且 `HEAD`、`206`、压缩响应、超过 5MB 的响应一律跳过，不会污染上游或大文件。

## 编程 API

```ts
import { createServer } from 'livd';

const server = await createServer({
  root: './dist',
  port: 3000,
  cors: true,
  plugins: [myPlugin],
});

console.log(server.url);
await server.close();
```

### live reload（编程方式）

```ts
import { createServer } from 'livd';
import { livePlugin } from 'livd/live';

const server = await createServer({
  root: './dist',
  plugins: [livePlugin({ poll: false, css: true, keepScroll: true })],
});
```

### 反向代理（编程方式）

```ts
import { createServer } from 'livd';
import { proxyPlugin } from 'livd/proxy';

const server = await createServer({
  root: './dist',
  plugins: [
    proxyPlugin({
      config: { '/api': { target: 'http://localhost:7000', stripContext: true } },
    }),
  ],
});
```

### 插件

```ts
import type { Plugin } from 'livd';

export const jsonHeader: Plugin = {
  name: 'json-header',
  enforce: 'post', // 'pre' 在静态文件之前，'post' 只在未命中后
  configureServer(ctx) {
    ctx.use(({ req, res }) => {
      if (!(req.url ?? '').endsWith('.json')) return false;
      res.setHeader('X-Livd', '1');
      return false;
    }, 'post');
  },
};
```

`Handler` 返回 `true` 表示「已处理，短路」；返回 `false` 则交给下一个。

## 本地开发

```sh
pnpm install                     # 依赖安装（仓库使用 pnpm，锁文件为 pnpm-lock.yaml）
pnpm test                        # vitest
pnpm check                       # typecheck + lint + test
pnpm build                       # tsdown 打包
pnpm smoke                       # 用 dist 真实产物起服务做冒烟测试
pnpm verify:meta                 # 发布元数据自检（仓库字段 / 零依赖 / workflow 权限）
pnpm pack:check                  # 看一眼 npm 包里到底有什么
pnpm release                     # 本地 bump 版本 + commit + tag（不 push）
```

CI 用 `pnpm install --frozen-lockfile`，锁文件与 `package.json` 不一致时会直接失败；
发布仍由 npm CLI 执行（`npm publish --provenance`），以获得 OIDC provenance。

## 发布流程

```sh
# 1) 选版本号 → 更新 package.json + 本地 commit + tag（不 push）
pnpm release

# 2) 你自己把 tag 推上去（会触发 .github/workflows/release.yml）
git push --follow-tags
```

tag 推上去后，CI 用 **npm Trusted Publishing（OIDC）** 发布，不需要 `NPM_TOKEN`，并自动带 provenance。

也可以手动触发 workflow 先验证链路：`Actions → Release → Run workflow`，`mode` 选
`dry-run`（只构建打包）、`stage`（staged publish，会真正走 OIDC）或 `publish`（正式发布）。

### 首次发布 checklist

1. **补全 `package.json` 的仓库信息**（`repository` / `homepage` / `bugs`）——
   provenance 会校验 `repository` 与实际运行的工作流仓库是否一致，写错就只能再发一个版本修。
   `pnpm verify:meta` 会在发布前拦住占位符。
2. **手动发布一次**，让包在 npm 上存在：
   ```sh
   npm login
   npm publish
   ```
   `package.json` 里已有 `publishConfig.access: "public"`，scoped 包不用每次带 `--access`。
   `pnpm verify:meta` 会检查这条是否存在（漏了会发成私有包）。
3. npm 后台 **Settings → Trusted publishing → Add trusted publisher**，选 GitHub Actions：

   | 字段                 | 值                                                                                             |
   | -------------------- | ---------------------------------------------------------------------------------------------- |
   | Organization or user | `bin-ran`                                                                                      |
   | Repository           | `livd`                                                                                         |
   | Workflow filename    | `release.yml`（只写文件名，带 `.yml`，且必须真实存在于 `.github/workflows/`）                  |
   | Environment name     | 留空（除非用了 GitHub Environments）                                                           |
   | Allowed actions      | **勾上允许 `npm publish`**（默认只允许 `npm stage publish`，我们的工作流用的是 `npm publish`） |

   配置后 **2 天内**要完成一次成功发布，否则该配置过期。

4. 把 **Publishing access** 收紧为「必须 2FA 或 trusted publisher」，并 revoke 掉旧的 Automation token。
5. 验证：`Actions` 里跑一次 `mode=stage`，再 `pnpm release` + `git push --follow-tags` 发正式版。

> trusted publisher 的字段一旦创建不能修改，要改只能删除重建（每个包最多 10 条）。
> 仓库必须是公开的，否则拿不到 provenance。

发布前可以本地先看一眼产物：

```sh
pnpm smoke             # 用 dist 真实产物起服务，验证配置/静态/CORS/越界拦截
pnpm pack:check        # npm pack --dry-run
npm publish --dry-run  # 完整走一遍发布流程，但不真的上传
```

`prepublishOnly` 会自动串起 `verify:meta → check → build → smoke`，
其中 `verify:meta` 会拦住占位符仓库字段、零依赖被打破、workflow 缺 `id-token: write` 这类「发出去就修不回来」的问题。

## Roadmap

- [x] M1 静态服务 / 目录列表 / fallback / CORS / HTTPS / 端口顺延
- [x] M2 `--watch`（chokidar + SSE + CSS 原地替换）
- [x] M2 `--proxy`（httpxy + rewrite + ws 透传 + webpack 配置兼容）
- [x] `livd.config.ts` 配置文件（CLI > 配置 > 默认值）
- [ ] M3 后续：单二进制发行（Node SEA）

## License

MIT
