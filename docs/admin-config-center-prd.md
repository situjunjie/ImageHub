# 管理后台配置中心 PRD（Admin Config Center）

> 状态：✅ 已实现（2026-07-20）。全部三期（站点/模型、提示词与场景、系统设置）一次性落地。实现说明见 CLAUDE.md「Config center」章节。以下为原始设计稿，保留备查。
> 与设计稿的差异：管理后台顶层 Tab 为「概览 / 请求日志 / 接口配置」，配置能力收敛到「接口配置」下的三个子 Tab（站点与模型 / 提示词与场景 / 系统设置），而非六个顶层 Tab；行业 Agent 表单编辑覆盖名称/标签/图标/比例/场景/介绍/三套提示词结构/负面词/质检清单，其余字段在保存时原样保留。
> 关联文档：README.md（产品总纲）、docs/agent-mode-brochure-prd.md、docs/canvas-mode-prd.md
> 定稿日期：2026-07-20

## 1. 背景与目标

当前管理后台（`AdminApp`，src/App.tsx ~7816 行起）只有观测能力（统计、请求日志、广场治理、导出），没有任何配置能力。产品的核心可配置项全部硬编码在源码里，且多处前后端各维护一份：

| 配置项 | 后端位置 | 前端位置 |
|---|---|---|
| 上游站点白名单 | `ALLOWED_API_BASE_URLS`（vite.config.ts ~273） | `ALLOWED_API_ENDPOINTS`（App.tsx ~690） |
| 模型白名单 | `isGptImage2Model` 等（vite.config.ts ~1385） | `isAllowedImageModel`（App.tsx ~2829）等 |
| 示例提示词 | — | `PROMPT_STARTERS`（App.tsx ~914，8 条） |
| 风格增强预设 | — | `STYLE_ENHANCEMENT_PRESETS`（App.tsx ~965，6 条） |
| 行业 Agent 场景 | — | `INDUSTRY_AGENTS`（App.tsx ~1006，8 个，约 450 行） |
| 通用负面提示词 | — | `COMMON_AGENT_NEGATIVE_PROMPT`（App.tsx ~1004） |
| Agent 分析 system prompt | vite.config.ts ~2138 | — |
| 提示词安全分析 system prompt | vite.config.ts ~2333 | — |
| 广场配额 | vite.config.ts ~293 | — |

目标：新增「配置中心」，管理后台生产配置、用户端消费配置、生成代理按配置动态校验。把"改配置要改两处源码再部署"变成"后台改完即生效"。

## 2. 已定决策（评审记录）

1. **行业 Agent 编辑形式：表单化编辑器。** 每个字段独立控件（含 promptStructures 三套模板、fields 字段定义、质检清单的增删排序），非技术人员可直接维护。
2. **内置站点完全自由。** 内置（太极 AI / BobDong）与自定义站点同权：可改、可停用、可删除。唯一底线校验：启用状态的站点至少保留 1 个（服务端强制）。
3. **模型白名单只用精确名单。** 移除现有"包含 image-2 即放行"的模糊匹配；所有可用模型必须逐条登记。上游出新模型时需管理员手动添加一条。
4. **配置生效方式：仅进页拉取。** 用户端进入工作台/画布/广场时 `GET /api/config` 一次；不做版本轮询热更新。管理员改配置后，用户刷新或重新进入页面生效。

## 3. 数据设计：`.data/config-store.json`

完全照抄现有 `AdminStore` / `SquareStore` 的 `ensure / read / write` 三件套模式（vite.config.ts ~433–530 可作参考实现）。首次启动时用当前硬编码值 seed。

```jsonc
{
  "version": 1,                    // 每次写入 +1
  "updatedAt": "2026-07-20T12:00:00Z",

  "upstreams": [
    {
      "id": "taiji",               // 稳定 id，前端选择项的 key
      "name": "太极 AI",
      "baseUrl": "https://www.taijiai.online/",
      "enabled": true,
      "note": "主服务地址",
      "sort": 1
    },
    {
      "id": "bobdong",
      "name": "BobDong",
      "baseUrl": "https://bobdong.cn/",
      "enabled": true,
      "note": "备用服务地址",
      "sort": 2
    }
  ],

  "models": [                      // 精确名单，无模糊匹配
    {
      "id": "gpt-image-2",         // 与上游模型 id 精确比对（先经 normalizedModelId 规范化）
      "displayName": "GPT Image 2",
      "sizing": "explicit-2k4k",   // explicit-2k4k | official-1k，决定尺寸逻辑分支
      "enabled": true,
      "sort": 1,
      "tags": ["2K", "4K"]
    },
    { "id": "gpt-image-2-pro", "displayName": "GPT Image 2 Pro", "sizing": "explicit-2k4k", "enabled": true, "sort": 2, "tags": ["2K", "4K"] },
    { "id": "gpt-5.4-image-2", "displayName": "GPT 5.4 Image 2", "sizing": "official-1k", "enabled": true, "sort": 3, "tags": [] },
    { "id": "gemini-3-pro-image-preview", "displayName": "Gemini 3 Pro Image", "sizing": "official-1k", "enabled": true, "sort": 4, "tags": [] }
  ],

  "presets": {                     // Phase 2
    "promptStarters": [ /* seed 自 PROMPT_STARTERS，结构 { id, label, tag, prompt, enabled, sort } */ ],
    "stylePresets":   [ /* seed 自 STYLE_ENHANCEMENT_PRESETS，{ id, name, description, promptFragment, enabled, sort } */ ],
    "industryAgents": [ /* seed 自 INDUSTRY_AGENTS，原结构 + enabled + sort */ ],
    "negativePrompt": "…"          // seed 自 COMMON_AGENT_NEGATIVE_PROMPT
  },

  "systemPrompts": {               // Phase 3；仅管理端接口可见，永不进 /api/config
    "agentAnalyze": "…",           // seed 自 vite.config.ts ~2138
    "promptAnalyze": "…"           // seed 自 vite.config.ts ~2333
  },

  "quotas": {                      // Phase 3
    "squareDailyRecommend": 10,
    "squareDailyLike": 10
  }
}
```

设计要点：

- `sizing` 字段取代 `supportsGptImage2ExplicitSizes()` 的硬编码判断。尺寸表 `GPT_IMAGE_2_SIZE_OPTIONS` 本身**留在代码里**（属行为逻辑，配错即坏），配置只决定"哪个模型走哪套尺寸"。
- 模型比对沿用 `normalizedModelId`（去 `models/` 前缀 + 小写）后做全等比较。
- 所有列表项都有 `enabled` 与 `sort`；`/api/config` 只吐 enabled 项且按 sort 排序。
- 单文件 JSON 天然支持"导出配置备份"（直接复用现有导出模式）。

## 4. API 契约

| 端点 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/api/config` | GET | 无 | 聚合快照：仅 enabled 项；含 upstreams、models、presets（Phase 2 起）与 `version`。**不含** systemPrompts、quotas |
| `/api/admin/config` | GET | admin session | 完整配置（含停用项与 systemPrompts） |
| `/api/admin/config/upstreams` | PUT | admin | 整组覆盖保存，服务端校验后落盘 |
| `/api/admin/config/models` | PUT | admin | 同上 |
| `/api/admin/config/presets` | PUT | admin | Phase 2 |
| `/api/admin/config/system-prompts` | PUT | admin | Phase 3 |
| `/api/admin/config/quotas` | PUT | admin | Phase 3 |
| `/api/admin/config/reset` | POST | admin | 按分组恢复默认：`{ "section": "upstreams" \| "models" \| "presets" \| … }`，默认值来自代码内 seed 常量 |

约定：

- 覆盖式保存（PUT 整组）而非逐条 CRUD——数据量小，实现简单且天然原子。
- 每次写入：`version += 1`、更新 `updatedAt`、调用现有 `appendAuditLog()` 记录 `{ action: "config_update", detail: 分组名 + 条数变化摘要 }`。
- 鉴权复用现有 admin session 分支（vite.config.ts ~3729 的 `/api/admin` 分发器内新增 `path.startsWith("/config")` 分支），同样受 `mustChangePassword` 403 门槛约束。

## 5. 服务端安全校验（不因后台可配而放松）

对 `upstreams` 的每条写入：

- `baseUrl` 必须以 `https://` 开头，且能被 `new URL()` 解析；持久化前经现有规范化逻辑（补尾部 `/`）。
- 禁止 IP 直连与内网主机名：`localhost`、`127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`、`*.local`、`0.0.0.0`。
- 启用状态的站点必须 ≥ 1，否则 400 拒绝保存。
- `name` 非空、去首尾空白、长度 ≤ 50；`id` 由服务端生成（如 nanoid），客户端不可伪造覆盖他项。

对 `models`：启用项 ≥ 1；`id` 非空且去重。

运行时校验改造：`normalizeAllowedApiBaseUrl`（vite.config.ts ~800）改为从 config-store 内存缓存读启用站点列表；`isGptImage2Model` 一族与前端 `isAllowedImageModel` 一族改为查精确名单。OAuth 动态白名单追加逻辑（~290）保持不变，视为运行期附加项。

性能：config 常驻内存缓存，写入接口成功后使缓存失效；请求路径上零磁盘 IO 增量。

## 6. 前端改造

### 6.1 用户端（消费者）

- 新增 `fetchAppConfig()`：进入 studio / canvas / square 页时调 `GET /api/config`，存入 state（可带 sessionStorage 兜底缓存，失败时回退到内置默认值，保证离线可用）。
- `ALLOWED_API_ENDPOINTS` 常量改为从 config 渲染（保留原常量作为 fetch 失败的兜底默认值）。
- 模型过滤：`isAllowedImageModel` / `filterAllowedImageModels` / `imageModelPriority` 改为基于 config.models 的精确名单 + sort 排序。
- 尺寸逻辑：`usesOfficialGptImageSizing()` 等分支改为查所选模型的 `sizing` 字段。
- Phase 2 起：`PROMPT_STARTERS` / `STYLE_ENHANCEMENT_PRESETS` / `INDUSTRY_AGENTS` / 负面词从 config.presets 渲染，原常量降级为 seed 默认值（仅存在于 vite.config.ts 的 seed 逻辑中，前端删除硬编码副本）。

### 6.2 管理后台（生产者）— Tab 化改版

`AdminApp` 从单页纵向堆叠改为 Tab 结构：

```
概览 | 请求日志 | 广场治理 | 站点与模型 | 提示词与场景 | 系统设置
```

- **概览 / 请求日志 / 广场治理**：现有模块原样迁入对应 Tab，不改逻辑。
- **站点与模型**（Phase 1）：
  - 上游站点列表：名称 / 地址（mono 字体）/ 启用开关 / 编辑 / 删除；顶部「添加站点」「恢复默认」。所有站点（含内置）同权可改可删；删除最后一个启用站点时保存被服务端拒绝，前端同步做禁用提示。
  - 模型白名单列表：模型 ID / 展示名 / 尺寸能力（2K/4K 或官方 1K 徽标）/ 启用开关 / 排序；「添加模型」表单含 id、displayName、sizing 三个必填项。
- **提示词与场景**（Phase 2）：三个分区（示例提示词 / 风格预设 / 行业 Agent），均为**表单化编辑器**：
  - 示例提示词与风格预设：行内编辑（label/tag/prompt 等直接输入框），支持增删、拖拽或按钮排序、启用开关。
  - 行业 Agent：列表 + 抽屉式详情编辑。抽屉内分组表单：基本信息（name/tag/icon/scenario/recommendedRatio）、字段定义 fields（可增删的子表单行）、三套提示词结构（stable/creative/commercial 各一个多行文本域，支持 `{字段}` 占位符提示）、负面提示词、质检清单（可增删的文本行）。含「恢复此 Agent 默认」。
  - 保存粒度：整组 PUT `/api/admin/config/presets`，前端做修改脏标记与离开确认。
- **系统设置**（Phase 3）：两段 system prompt 的多行编辑器（带"恢复默认"与字符数提示）、广场配额数字输入、配置导出按钮。

## 7. 分期计划

| 阶段 | 范围 | 涉及 |
|---|---|---|
| **Phase 1** | config-store 三件套 + seed；`/api/config` + `/api/admin/config(/upstreams|/models|/reset)`；运行时白名单改读配置；AdminApp Tab 化骨架 + 「站点与模型」页；用户端接入动态站点/模型 | vite.config.ts + App.tsx |
| **Phase 2** | presets 进配置（含前端删除硬编码副本）；「提示词与场景」页含行业 Agent 表单化编辑器 | 主要 App.tsx，编辑器 UI 工作量最大 |
| **Phase 3** | systemPrompts、quotas 可配；「系统设置」页 | 两端小改 |
| **Phase 4**（可选） | 物理拆分：admin 独立 entry/chunk；后端 middleware 拆成模块文件 | 纯重构，无功能变化 |

## 8. 验收标准（Phase 1）

1. 后台新增一个 https 自定义站点并启用后，用户端刷新即可在站点下拉中选到并成功发起生成。
2. 后台停用某模型后，用户端刷新后模型列表不再出现该模型；已选中该模型的用户提交生成时收到明确报错。
3. 尝试保存 `http://`、`127.0.0.1`、内网地址的站点被服务端 400 拒绝并给出中文错误信息。
4. 删除到只剩 0 个启用站点的保存请求被拒绝。
5. 每次配置变更在审计日志中可见（管理后台可查），`version` 递增。
6. 删除 `.data/config-store.json` 后重启，自动以内置默认值重建（行为与当前线上一致）。
7. `npm run build`（含 tsc）通过。

## 9. 风险与约束

- **安全边界降级提示**：站点白名单从"改代码才能改"变为"管理员权限即可改"。缓解：https-only + 内网地址黑名单 + 审计日志 + 首登强制改密（已有）。
- **模型精确名单的运营成本**：上游发布新模型变体后，用户端不会自动放行，需管理员登记。这是评审时的主动选择（可控性优先）。
- **本地优先不变量不受影响**：config-store 只存配置文本，不含 API key、图片数据或 URL，符合 README 隐私策略。
- 前后端尺寸表仍是两份代码（deliberate），`sizing` 只做分支选择，不搬表。
