# acp-headroom-pi

[Pi 编码代理](https://pi.dev)的双层上下文压缩插件：**ACP 模型驱动摘要压缩**（源自 [billion-context-pi](https://github.com/ranxianglei/billion-context-pi)，MIT）+ **Headroom 工具输出机械压缩**（对接 [headroom](https://github.com/headroomlabs-ai/headroom) 本地代理，Apache-2.0），融合为单一插件。

```
工具输出 ──▶ ① Headroom 阶段（机械压缩，模型看到前已瘦身）
                JSON 数组省 70-90% · 日志 80-95% · 搜索结果 60-80%
                  │ 原文存 CCR（代理内存 + 本地磁盘备份）
                  ▼
             ② ACP 管线（ref 标记 → token 计数 → nudge → LLM 范围摘要压缩
                → 多层蒸馏 T1→T2→T3 → 紧急截断）
                  ▼
               LLM
```

两层互补：Headroom 在内容进入上下文*之前*消灭噪音（确定性、零 LLM 调用）；ACP 处理长程历史（模型自己决定何时、把什么压成摘要）。单一插件接管全部上下文管理——不会出现两个上下文插件互相改写消息的冲突。

## 安装

```bash
# 1. Headroom 压缩引擎（Python 本地代理）
uv tool install --python 3.13 "headroom-ai[proxy]"

# 2. 本插件
pi install npm:acp-headroom-pi
```

插件启动时自动探测 `http://127.0.0.1:8787` 的代理，不在则后台静默拉起（`headroom` 在 PATH 用之，否则 `uv tool run`，无终端窗口）。**退出 pi 时，插件只回收自己拉起的代理**；你手动启动的实例不受影响。代理不可用时**降级直通**：工具输出原样进入上下文，仅提示一次。

## 工作方式

1. **Headroom 阶段**：每次 LLM 调用前（pi 的 `context` 事件），超过阈值的历史 `toolResult` 通过 `POST /v1/compress`（`mode=ccr`）逐条压缩。替换文本自带 CCR 标记（12 或 24 位 hex hash），原文留在会话日志不动。
2. **本地 CCR 兜底**：压缩成功时原文同步落盘 `~/.pi/acp-headroom/ccr/<hash>.txt`，不受代理 ~30 分钟 TTL 限制。
3. **下游一致**：token 计数、nudge 阈值、ACP 摘要压缩看到的都是瘦身后视图；压缩文本经 pi 的 kernel-body 变异通道自动流达最终消息数组。
4. **找回原文**：模型对标记里的 hash 调用 `headroom_retrieve({ hash })`——先查本地磁盘，再查代理 `/v1/retrieve/{hash}`。

## 模型可用工具

| 工具 | 来源 | 作用 |
|---|---|---|
| `compress` / `decompress` / `search_context` / `acp_status` | ACP | 会话范围摘要压缩 / 解压 / 搜索 / 状态 |
| `acp_delegate` / `_wait` / `_cancel` | ACP | 干净上下文子代理委派 |
| `headroom_retrieve` | Headroom | 按 hash 取回压缩前的原始输出 |

## 配置

`~/.pi/acp.json`（全局）或 `<project>/.pi/acp.json`（项目覆盖），新增 `headroom` 键：

```json
{
  "headroom": {
    "enabled": true,
    "proxyUrl": "http://127.0.0.1:8787",
    "minChars": 4000,
    "maxPerTurn": 8,
    "timeoutMs": 3000,
    "protectedTools": ["my_custom_tool"],
    "autoStart": true
  }
}
```

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | `false`（或 `"headroom": false`）关闭该阶段 |
| `proxyUrl` | env `HEADROOM_PROXY_URL` > `http://127.0.0.1:8787` | 代理地址 |
| `minChars` | `4000` | 触发压缩的最小文本长度（约 1K token） |
| `maxPerTurn` | `8` | 每次 context 事件的代理调用上限（最大者优先，限制请求路径延迟） |
| `timeoutMs` | `3000` | 单次请求超时；超时/失败放行原文 |
| `protectedTools` | 内置 ACP 工具集 | 追加永不压缩的工具名 |
| `autoStart` | `true` | 探测不到代理时自动拉起 |

内置保护：ACP 全部自有工具 + 当前用户轮次之后的最新结果 + 已带 CCR 标记的文本（不重复压缩）。环境变量另支持 `HEADROOM_CCR_DIR`（本地备份目录，默认 `~/.pi/acp-headroom/ccr`）与 ACP 原有 `ACP_DEBUG` / `ACP_LOG_FILE` 等。

日志沿用结构化格式写入 `~/.pi/acp-headroom.log`（10MB 轮转）：`grep '\[headroom\]' ~/.pi/acp-headroom.log` 可看每次压缩与代理故障。`/acp` 面板底部新增 Headroom 行（代理地址、本会话压缩条数、累计节省 token）。

## 兼容性

保持「只装一个上下文管理插件」原则：本插件已取消 pi 内置 auto-compaction，且不要再与其他改写 context 的扩展同装。卸载 billion-context-pi 与 headroom-opencode 后安装本插件。

## 更新

两个组件独立更新，建议顺序：headroom 引擎在前，插件在后。

1. **headroom 引擎**（Python，`~/.local/bin/headroom`）：
   - 在 pi 会话内运行 `/headroom-update`：自动停止插件拉起的代理 → `uv tool upgrade headroom-ai`（尊重你的 uv 镜像/index 配置）→ 重启代理并验证 `/health`，结束时提示插件更新命令。
   - 本机存在手动启动的代理时命令会中止并提示先关闭（升级需替换可执行文件，Windows 下 shim 文件被占用会报 `os error 32`）。
   - 也可跳过插件自己执行：`uv tool upgrade headroom-ai`，然后重启代理（`headroom proxy --port 8787`）。
2. **本插件**（npm）：退出 pi 后执行 `pi update --extensions`（或 `pi update npm:acp-headroom-pi`），重新进入 pi 生效。

每次启动时会自动检查一次 headroom 是否有新版本（24 小时内仅一次，仅提示不自动升级），发现新版会弹提示并写日志；可用 `acp.json` 的 `headroom.checkUpdatesOnStart: false` 关闭。查看状态：`/headroom-status`（引擎版本 + 代理健康 + 本会话压缩统计）。

## 开发

```bash
npm install
npm test          # node --test（376 用例）
npm run typecheck # tsc --noEmit
npm run build     # tsup → dist/
```

注：3 个符号链接相关的既有测试在 Windows 无开发者模式环境下因 EPERM 失败（上游遗留，与本插件无关）。

## 致谢与许可

- [billion-context-pi](https://github.com/ranxianglei/billion-context-pi)（MIT）— ACP 管线、pi 扩展骨架、acp-kernel 集成
- [headroom](https://github.com/headroomlabs-ai/headroom)（Apache-2.0）— 压缩管线与 CCR 协议（经本地代理 HTTP 对接，未复制其代码）

MIT
