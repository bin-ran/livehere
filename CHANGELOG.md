# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [未发布]

## [0.0.5] - 待发布

### 新增

- `--browse`：目录请求一律显示列表，不自动打开入口文件（`--index none` 等价）
- `--index <file>`：自定义目录入口文件名（默认 `index.html`）
- `?list`：一次性的「看目录」逃生口，入口文件 / SPA 兜底都让路
- 目录页重做：卡片布局（880px 居中）、面包屑导航、目录/文件 SVG 图标、
  大小与时间右对齐、行尾下载入口、空目录空状态、移动端适配
- 静态响应统一加 `X-Content-Type-Options: nosniff`

### 变更

- **默认监听 `0.0.0.0`（局域网可访问）**，终端分「本机 / 局域网」两栏打印；
  只给本机用请加 `--local`
- 目录请求有入口文件时直接返回它（`/sub/` → `/sub/index.html`），
  `/sub` 这类缺尾斜杠的目录请求 301 到 `/sub/`
- `.conf` / `.cfg` / `.ini` / `.env` / `.log` / 脚本类扩展名改为强制下载
  （`Content-Disposition: attachment`，类型保持正确）
- 未知扩展名按 `application/octet-stream` 下载，不再留给浏览器嗅探

### 修复

- `index: false`（`--browse`）与 `fallback` 互斥，同时配置会在启动时报错，
  避免 `-f` 把目录页静默挡掉

## [0.0.4]

### 新增

- 默认监听局域网，并同时打印本机地址（`--local` 收窄回 `127.0.0.1`）

### 修复

- 目录请求直出 `index.html`（此前 `/` 和 `/sub/` 只返回列表）
- `.conf` 等配置文件不再在浏览器里内联预览

### 工程

- 发布 workflow 幂等：版本已存在于 npm 时跳过，推旧 tag 不再红灯

## [0.0.3]

### 修复

- HTTPS 证书与私钥改为顺序读取，两个文件都缺时稳定报错（此前 `Promise.all` 竞速，
  本地与 CI 报的不是同一个文件）

### 工程

- 移除 `pnpm/action-setup` 的 `version`，改由 `package.json` 的 `packageManager` 决定
- `@types/node` 升级到 `^26.6.6`

## [0.0.2]

### 变更

- 包名 / 命令 / 配置文件 / 注入路径统一为 `livehere`（原 `livd` 因 npm 相似名称策略无法注册）

### 修复

- `-x webpack.config.js` 按当前工作目录解析（原先按 ROOT，找不到仓库根的配置）
- `--cert` / `--key` 读取失败时给出可读错误

### 工程

- 从 npm 迁移到 pnpm，CI 使用 `pnpm install --frozen-lockfile`
- 新增 `verify:meta` 发布元数据自检与真实产物冒烟测试
- 新增 `name-check` 包名体检脚本

## [0.0.1]

### 新增

- 静态文件服务（ETag / br / gz / Range）、自研目录列表、SPA fallback
- CORS、自签 HTTPS（现场生成 EC 证书）、端口 `auto` 顺延
- 安全默认：点文件 403、`..` 越界 403、非法编码 400
- 插件内核：`pre` / `post` / `upgrade` / `onClose` 四个钩子
- `--watch`：chokidar + SSE，纯 CSS 变更原地替换样式，其它整页刷新并保留滚动位置
- `--proxy`：httpxy + rewrite + ws 透传，兼容 webpack 的 `devServer.proxy`
- 配置文件 `livehere.config.ts/js/mjs/json`（优先级：命令行 > 配置 > 默认值）
