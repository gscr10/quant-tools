# G4a 本地源码依赖基线

状态：已完成本地源码导入与 workspace 解析；Vela 主包固定使用 registry `0.7.7`，并在构建准备阶段应用一处经过完整 SHA-256 校验的视口兼容补丁。

本文件配合 [`DEPENDENCY_BASELINE.json`](./DEPENDENCY_BASELINE.json) 使用。它记录三个基础包的版本、npm tarball 完整性、上游仓库 tag/commit、导出入口和 peer contract。`pinets` 与 `@luxalgo/vela-pinets` 已完整导入 `packages/`，根 `package.json` 通过 `file:` workspace 解析；Vela 主包仍使用精确 registry 版本，避免安装时被 `^` 或 `>=` 静默升级。

## 已核对的发布物

| 包 | npm 版本 | npm `gitHead` | 上游 tag | npm integrity | 当前解析 |
| --- | --- | --- | --- | --- | --- |
| `@luxalgo/vela` | `0.7.7` | `07c1d829c66bd5fb72b4ab7d2ca780d506d8a00b` | `v0.7.7` | `sha512-9V8cCJUP3i+nkrzxU43rrnZFxPGDfOxX/XDlcAdBFMbUrNartDrVVPsk1kTZyQyqBR4115n3n6XACLImTaM4hw==` | registry + pinned viewport patch |
| `@luxalgo/vela-pinets` | `0.2.13` | `a2a2097be8f30b4b596b13212ed4608c36c2ea26` | `v0.2.13` | `sha512-KKw/lfAByoZwxM8IcCyGiQXD6lzl3XXGslM8r7kXHMMGRNguDHiUil0vGRwtg4IaoJLRWgFdm5XSn/Bz3iAvjw==` | workspace `packages/vela-pinets` |
| `pinets` | `0.9.34` | `beacd587e83aa7ee061023f8cea66b2e887d5676` | `v0.9.34` | `sha512-5dnrrR+g40XMjrMBJEHGL2Hk7lqCz/fPkaPklFvD6G/qdh3xwRYX3W7UADaNieX6ZV/+/xah78ufOwEkNKVFyg==` | workspace `packages/pinets` |

`npm view <package>@<version> gitHead` 与 `git ls-remote --tags <repository>` 已在 2026-09-26 核对，三者的 `gitHead` 都与对应版本 tag 的 peeled commit 一致。脚本还会读取安装目录的 `package.json`，核对版本、仓库、许可证、exports 和 Vela-PineTS 的 peer range；因此误装另一版本或错误包名会在本地测试中失败。

## 当前边界

Vela 主包仍按 registry 三方校验；两个 workspace 包则额外校验 lockfile 的 `link: true`、目标目录、包 manifest、exports、license 和 peer contract。这样能防止 workspace link 指向错误目录或旧的 `node_modules` 副本。

执行检查：

```sh
npm run check:dependencies
```

检查脚本是离线的，只依赖根 lockfile、workspace/安装目录、本 JSON 和两个 workspace 内的 `fork-build-info.json`。registry tarball/integrity 与 upstream SHA 仍保留在 JSON 中，作为本地源码的来源证明。检查会同时对账机器可读 metadata、实际编译进源码的常量、Vela-PineTS 内嵌 PineTS SHA/fingerprint、报告 schema 和执行 sentinel；任一处过期都会直接失败。固定 BTCUSDT fixture 的 registry/本地逐笔对账仍是独立 Gate，没有该证据不得把本地功能补丁声称为上游等价版本。

## 已完成与下一步

1. 已按 `v0.9.34` 和 `v0.2.13` 导入完整上游源码，并保留独立 subtree 导入提交。
2. 已使用根 npm workspace + 显式 `file:` 依赖接入两个包。
3. 已建立 `build:forks`/`prebuild`/`predev`，每次应用构建前重建 PineTS 与 Vela-PineTS Worker。
4. 已加入机器可读 build fingerprint、PineTS/Vela-PineTS sentinel、Worker 内嵌 PineTS SHA/fingerprint，以及旧 PreparedScript/旧 Worker 显式失败测试。
5. 待补：registry 与零修改 workspace 包在固定 Binance BTCUSDT fixture 下的逐笔对账。

`npm run test:forks` 已作为开发命令保留，但上游 PineTS 测试集包含实时 Binance 请求；在无稳定外网时会出现超时，不能作为本地应用 CI 的必过门禁。当前可重复的依赖门禁是 `npm run check:dependencies`、`npm run build:forks`、根 TypeScript/Vite build，以及应用层回归/E2E；上游网络测试失败不改变 workspace 解析或构建结论。

Vela 继续使用精确 registry `0.7.7`，不整体 vendoring；视口一处兼容补丁已明确超出公共 API，详见 [`vela-viewport.md`](./vela-viewport.md)。它把原生最小柱间距从 `0.5` CSS px 降为数值保护下限，使窄 Cell/手机能完整定位普通切周期的 2,000 根；仍保留原生按实际数据量限制缩放、平移的逻辑。构建入口会校验安装包版本及补丁前后完整文件哈希，未知文件或版本拒绝处理。不能再把该依赖描述为完全未经修改的 registry 产物。

两个本地包的补丁边界、升级流程和验证命令分别记录在 [`pinets.md`](./pinets.md) 与 [`vela-pinets.md`](./vela-pinets.md)。
