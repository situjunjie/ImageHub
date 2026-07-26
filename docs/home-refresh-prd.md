# ImageHub 首页重构方案（Home Refresh PRD）

> 状态：**H1–H4 已全部实施并验证（2026-07-25）**，详见 §十一 实施记录。
> 依据：Lovart 应用首页 `/zh/home` 截图解构 + Lovart 落地页 `/zh` 实站计算样式实测（2026-07-25）+ 本项目首页代码全量审计。
> 关联：[design-refresh-prd.md](design-refresh-prd.md)（本文件是其 §4.3「Home 首页」条目的展开与升级）、README.md、CLAUDE.md。
> 作用域：仅 `activePage === "home"`。不改 Studio / Canvas / Square / Admin 的布局。

---

## 〇、一句话结论

当前首页是一张**营销落地页**——零数据、零输入、14 个并列入口、112px 巨型标题。Lovart 首页是一个**工作台入口**——一个输入框、一行能力 chips、然后立刻是真实内容。

本次重构做的是**产品形态转换**，不是视觉翻新：把首页从「介绍这个产品」改成「在这里开始用这个产品」。

---

## 一、Lovart 首页布局解构

### 1.1 应用首页 `/zh/home` 结构（截图实测）

自上而下，共 6 层：

| 层 | 内容 | 关键规格 |
|---|---|---|
| **① 促销条** | 通栏荧光绿条，一句话 + 下划线文字链 | 全宽，高约 48px，唯一的高饱和色块 |
| **② 左侧图标窄轨** | logo / ＋新建 / 首页 / 项目 / 素材 / 账号 | 约 48px 宽，**纯图标无文字**，垂直排列 |
| **③ 右上角** | 积分（⚡0）· 升级按钮 · 头像 | 极简，不与主区争夺注意力 |
| **④ 居中主区** | logo + 标题 + 副标题 + **大输入框** + 能力 chips | 输入框宽约 730px，高约 110px，**页面唯一焦点** |
| **⑤ 最近项目** | 标题 +「查看全部 ›」+ 横向卡片行 | 首卡是虚线「＋新建项目」，其余为 2×2 拼贴封面 + 标题 + 更新时间 |
| **⑥ 灵感发现** | 标题 + 分类 chips + **瀑布流** | 5 列 masonry，图片保留原始比例；卡片底部：头像 + 用户名 + 👁 浏览 + ♥ 点赞 |

### 1.2 设计令牌（实站计算样式实测，验证了 design-refresh-prd §一）

```
画布/文本   #100F09 / #F5F4EF（暖中性，非冷灰）
字体        Inter，基准 16px / 行高 1.55（24.8px）
字重        H1 400 · H2 400 · H3 400 · body 400 —— 标题完全不加粗
字号阶梯    H2 56 → H1 48 → H3 36 → body 16
按钮        border-radius 999px 胶囊；高度档位 24 / 28 / 32 / 40 / 52
分层        overlay rgba(245,244,239,0.12)，无装饰性阴影
```

### 1.3 支撑这套布局的八条逻辑

1. **一屏一主角** —— 主角是输入框，logo 和标题都在为它做铺垫，其余内容全部推到首屏之下。
2. **零顶部导航** —— 传统横向导航被删掉，导航退化成左侧图标窄轨，把整个横向空间让给内容。
3. **内容前置** —— 首屏之下立刻是真实内容（用户自己的项目 + 社区作品），不是营销文案和产品截图。
4. **模型即 chip** —— 模型和场景混排在输入框正下方同一行，把「技术选项」翻译成「创作选项」。
5. **暖中性 + 单一签名色** —— 功能界面几乎全中性，高饱和色只出现在促销条这一个品牌时刻。
6. **圆角即角色** —— 能点的是胶囊，内容卡是中圆角，容器是大圆角。
7. **编辑式排版** —— 标题不加粗，靠字号、留白、位置赢得注意力。
8. **图片说话** —— 瀑布流保留原始比例不裁切，元信息压到卡片底部。

---

## 二、ImageHub 首页现状审计

代码位置：`HomePage` 组件 [src/App.tsx:10656-10874](../src/App.tsx#L10656)（219 行），样式 [src/styles.css:269-782](../src/styles.css#L269) + 三段分散的媒体查询。

### 2.1 结构问题

| # | 问题 | 证据 |
|---|---|---|
| P1 | **零数据静态页**：组件内 0 个 `useState` / 0 个 `useEffect` / 0 个 `fetch`，全部内容来自硬编码常量 `featureBands` / `metrics` / `detailItems` | [App.tsx:10661-10684](../src/App.tsx#L10661) |
| P2 | **无输入框**：全组件检索 `input`/`textarea`/`form` 命中 0 次，用户在首页一个字都打不了 | [App.tsx:10656-10874](../src/App.tsx#L10656) |
| P3 | **14 个并列入口**：nav-links 6 + nav-actions 4 + hero CTA 4，主按钮不唯一 | [App.tsx:10698-10769](../src/App.tsx#L10698) |
| P4 | **同名按钮两种行为**：「工作台」在 nav-links 里是页内滚动，在 nav-actions 里是真跳转；「广场」「画布」各重复出现 2 次 | [App.tsx:10706](../src/App.tsx#L10706) vs [10726](../src/App.tsx#L10726) |
| P5 | **首屏是营销文案 + 产品截图**，而非真实内容；用户自己的历史作品和广场作品在首页完全不可见 | 区块 2–6 全为静态 |
| P6 | **无 footer**，`</main>` 直接结束 | [App.tsx:10872](../src/App.tsx#L10872) |

### 2.2 排版与令牌问题

| # | 问题 | 证据 |
|---|---|---|
| P7 | **h1 = 112px**，Lovart 实测 h1 仅 26–48px，PRD 比例尺上限 `--fs-39` = 39px —— 超出 2.87 倍 | [styles.css:447](../src/styles.css#L447) |
| P8 | 副标题 24px 不在 12/14/16/20/25/31/39 任何一档上 | [styles.css:453](../src/styles.css#L453) |
| P9 | **37 处硬编码色值**，仅 21 处用 `var(--)`；`.home-page{background:#f5f5f2}` 与令牌 `--bg:#f7f6f2` 不一致 | [styles.css:274](../src/styles.css#L274) |
| P10 | hero 背景用 **inline style** 拼死亮色渐变，CSS 侧无法用媒体查询覆盖 → **暗色模式在首页无法生效**（§六.4 已把暗色提前到 P2） | [App.tsx:10693-10695](../src/App.tsx#L10693) |
| P11 | 动效硬编码 `transition: transform 150ms ease`，绕过 `--dur-fast` / `--ease` 令牌 | [styles.css:469-472](../src/styles.css#L469) |

### 2.3 性能与移动端

| # | 问题 | 证据 |
|---|---|---|
| P12 | **首屏被 1.4MB hero PNG 阻塞**（`home-hero.png` 1,467,750 字节），且以 inline `backgroundImage` 写在 JSX 里，无法被 CSS 预加载优化 | [App.tsx:10693](../src/App.tsx#L10693) |
| P13 | 本次要删的两个 section 还占 885KB（`home-studio-preview.png` 513KB + `home-prompt-preview.png` 372KB） | `src/assets/` |
| P14 | **移动端 6 条内容锚点完全不可达**：`.home-nav-links { display: none }` @780px，只剩 4 个按钮挤在 64px 高的条里 | [styles.css:7243-7245](../src/styles.css#L7243) |

### 2.4 路径问题（最值得修的一条）

**OAuth 登录是零配置直达生成的最短路径，却被藏在「管理后台」后面。**

- 登录成功后 `/api/auth/oauth/me` 返回的 `apiKey` 会被**自动写进** `apiConfig` 并设 `rememberKey: true`（[App.tsx:3833-3841](../src/App.tsx#L3833)），用户完全不需要手填 Key；
- 但全站唯一的「太极AI 账号登录」按钮在 `AdminApp` 未登录卡片里（[App.tsx:8672-8680](../src/App.tsx#L8672)），只有走 `#admin` 才看得见；
- `oauthLogin()` 只传给了 `AdminApp`（[App.tsx:6710](../src/App.tsx#L6710)），`HomePage` 的 props 里根本没有 `onOauthLogin`。

当前首次生成路径：**≥5 次点击 + 2 次文本输入**（点开始生成 → onboarding 三步 → 填 Key → 拉模型 → 写提示词 → 发送）。

---

## 三、能照搬什么，不能照搬什么

用户提出可以 1:1 复制。**布局骨架可以照搬**（这是通用产品模式），**但有三处必须按产品差异改**——照搬会做出一个不适配 ImageHub 的界面。品牌资产（Lovart 的 logo、名称、文案）不复制。

| Lovart 做法 | ImageHub 是否照搬 | 理由 |
|---|---|---|
| 居中大输入框做首屏唯一主角 | ✅ **照搬** | 首页没有结果画廊，不存在 §六.1 说的「把结果推下首屏」问题 |
| 输入框下方一行能力 chips | ✅ **照搬**，但内容换成本项目的模型 + 行业 Agent | `/api/config` 已提供 models + industryAgents |
| 最近项目横向行（首卡＝新建） | ⚠️ **改造后照搬** | ImageHub **没有「项目」概念**，`batchId` 存在但全仓库无聚合逻辑，需新建分组 |
| 灵感发现瀑布流 | ✅ **照搬** | `/api/square/feed` 匿名可用且自带 width/height，可零 CLS |
| 左侧图标窄轨替代顶部导航 | ❌ **不照搬** | Lovart 是单一工作流产品；ImageHub 有 4 个并列模块（Studio/Canvas/Square/Admin），窄轨图标无法自解释。改为**极简顶栏**：品牌 + 3 个模块入口 + 账号 |
| 顶部通栏促销条 | ❌ **不照搬** | 本项目无商业化促销位。该位置留给**运行状态提示**（未配置 Key / 版本更新） |
| 暗色画布 `#100F09` | ⏸ **延后** | 暗色模式是 design-refresh §六.4 的 P2 项，首页应先做到**令牌化**使暗色可生效，本次不引入暗色主题本身 |

### 与 design-refresh-prd §六.1 的关系（重要）

§六.1 写的是「Studio 输入区 hero 化 → 改为分状态」，理由是 ImageHub Studio 是批量迭代工作台、80% 时间在看画廊。

**该修订不约束首页**，三条互证：

1. §六.1 全句主语是 Studio，其理由依赖的「画廊」「记录」「底部 composer」在首页均不存在；
2. §六 开篇声明「以下四处原方案判断有误」，四条一一对应 §4.3「Studio 工作台」条目，而「Home 首页」是与之并列的独立条目，§六 未触碰；
3. 代码佐证：`HomePage` 只有 6 个回调 props，不接触 `params` / `records` / `pendingQueueRef` 任何一个，构不成迭代循环。

**但它施加了一条下游约束**（本方案必须遵守）：

> 从首页输入框提交后，必须直接落进 Studio 的「底部紧凑 composer + 画廊」形态，**不得在 Studio 侧再复现一个居中 hero**。首页的 hero 是一次性入口，不是常驻状态。

---

## 四、新首页设计方案

### 4.1 布局骨架

```
┌────────────────────────────────────────────────────────┐
│ ① 状态条（条件渲染，非常驻）                              │  ← 未配置 Key / 有新版本时才出现
├────────────────────────────────────────────────────────┤
│ ② 顶栏  [logo Image Studio]      工作台 画布 广场  [账号] │  ← 高 56px，sticky
├────────────────────────────────────────────────────────┤
│                                                        │
│                    Image Studio                        │  ← h1 39px / 字重 500
│                 一句话，一组视觉资产                      │  ← 16px muted
│                                                        │
│   ┌──────────────────────────────────────────────┐    │
│   │ 描述你想生成的图片…                             │    │  ← 主角：输入框
│   │                                              │    │     宽 min(720px, 100%)
│   │ ＋                              [比例] [ ↑ ]  │    │     高 112px，r-panel
│   └──────────────────────────────────────────────┘    │
│                                                        │
│   [GPT Image 2 ·94%] [Pro] [Gemini 3] │ [电商] [封面]   │  ← 能力 chips 一行
│                                                        │
├────────────────────────────────────────────────────────┤
│ ③ 最近生成                                    查看全部 › │  ← 有历史才渲染
│   [＋ 新建] [img] [img] [img] [img] [img]               │
├────────────────────────────────────────────────────────┤
│ ④ 灵感发现                                              │
│   [全部] [电商] [封面] [海报] [人像] …                    │  ← 分类 chips
│   ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                  │
│   │    │ │    │ └────┘ │    │ │    │                  │  ← 瀑布流，保留原比例
│   └────┘ │    │ ┌────┐ └────┘ │    │                  │
│          └────┘ │    │        └────┘                  │
├────────────────────────────────────────────────────────┤
│ ⑤ Footer  本地优先 · 隐私说明 · GitHub                    │
└────────────────────────────────────────────────────────┘
```

### 4.2 各区块规格

#### ① 状态条（新增，条件渲染）

替代 Lovart 的促销条。**只在有事可说时出现**，不常驻占位：

| 触发条件 | 内容 | 色彩 |
|---|---|---|
| 未配置 API Key 且未 OAuth 登录 | 「登录太极 AI 账号即可直接开始，无需手动填写 API Key」+ 登录按钮 | `--blue-soft` 底 |
| 检测到前端新版本 | 复用现有 `frontendUpdateNotice` | `--amber-soft` 底 |
| 二者都无 | 不渲染 | — |

高 44px，全宽，文字 14px，右侧一个胶囊按钮。

#### ② 顶栏（重写）

**从 14 个入口收敛到 5 个**：

- 左：logo + 「Image Studio」（点击回顶部）
- 中：`工作台` `画布` `广场` 三个文字链接 —— **全部是真跳转，不再有页内滚动锚点**
- 右：账号区（已登录显示用户名 + 退出；未登录显示「登录」）+ 管理后台图标按钮（`ShieldCheck`，`aria-label="管理后台"`）

规格：`position: sticky; top: 0`，高 56px，`background: color-mix(in srgb, var(--bg) 82%, transparent)` + `backdrop-filter: blur(20px)`，底部 1px `var(--border)`。

**删除**：6 个页内滚动锚点（对应的 5 个 section 一并删除）、重复的「进入广场」「画布模式」按钮。

#### ③ Hero 输入区（核心）

这是本次重构的全部价值所在。

| 元素 | 规格 |
|---|---|
| 标题 | 「Image Studio」，`font-size: var(--fs-39)`（39px），**字重 500**，`color: var(--text)` |
| 副标题 | 一行 16px `var(--muted)`，不超过 28 字 |
| 输入框容器 | `width: min(720px, 100%)`；`min-height: 112px`；`border-radius: var(--r-panel)`；`background: var(--surface)`；`border: 1px solid var(--border)`；focus 时 `border-color: var(--border-strong)` + focus ring |
| textarea | 无边框透明底，16px，`placeholder="描述你想生成的图片，例如：温暖木质感的咖啡厅菜单海报"`；`Enter` 提交，`Shift+Enter` 换行 |
| 左下角 | `＋` 图标按钮（上传参考图），`aria-label="添加参考图"` |
| 右下角 | 比例 chip（`1:1` 可切换）+ 圆形提交按钮（`--r-pill`，40×40，`ArrowUp` 图标） |
| 垂直位置 | 整个 hero 区 `min-height: 62svh` + `place-content: center` —— **不占满首屏**，让「最近生成」露出约 100px，提示下方有内容 |

> 注意 `62svh` 是刻意的：Lovart 的 hero 占满首屏是因为它下方是低频内容；ImageHub 用户回访时最想看到的是自己上次生成的东西，所以要露出一角。

#### ④ 能力 chips（一行，可横向滚动）

**左段：模型**（来自 `/api/config` 的 `models[]`）

- 显示 `displayName`；选中态 = `var(--green)` 边框 + `var(--green-soft)` 底
- **带实测数据徽标**：`/api/model-stats` 里 `samples ≥ 3` 时追加 `· 94%`（成功率），复用 Studio 模型选择器已有逻辑
- `sizing: explicit-2k4k` 的模型额外挂一个 `2K/4K` 小标

**分隔**：一条 1px `var(--border)` 竖线

**右段：行业 Agent**（来自 `/api/config` 的 `presets.industryAgents`）

- 显示 `icon + name`，点击 = 把该 Agent 的 `scenario` 预填进输入框
- 首页取前 6 个（当前代码已是 `.slice(0, 6)`，保留）

规格：chip 高 32px，`--r-pill`，`gap: 8px`，整行 `overflow-x: auto` + `scrollbar-width: none`，移动端可横滑。

#### ⑤ 最近生成（替代 Lovart 的「最近项目」）

**仅当 IndexedDB 有历史记录时渲染**，否则整块不出现（新用户首屏更干净）。

- 标题「最近生成」+ 右侧「查看全部 ›」→ `enterStudio()`
- 首卡：虚线边框 `＋ 新建生成`，点击 = 聚焦上方输入框
- 其余：横向排列的方形缩略图，`--r-card`，hover 时底部浮出 prompt 前 20 字
- 数据源：已有的 `sidebarRecords`（见 §5.1），取前 8 条
- 横向 `overflow-x: auto`，卡片宽 128px

> **关于「项目」概念**：Lovart 的最近项目是多图聚合的工作单元。ImageHub 的 `batchId` 字段虽然存在（[App.tsx:126](../src/App.tsx#L126)、[159](../src/App.tsx#L159)），但**全仓库没有任何按 batchId 聚合的代码**。本期**不新建项目模型**，先用扁平的「最近生成」落地；按 batch 聚合为项目卡（2×2 拼贴封面）列入 backlog。

#### ⑥ 灵感发现（真瀑布流）

- 标题「灵感发现」+ 分类 chips（复用 `SQUARE_FEED_TABS`：最新/热门/本周/本月）
- **真 masonry**：`columns: 5` + `break-inside: avoid`（≤1180px 降 4 列，≤780px 降 2 列）
- 图片用 `aspectRatio` 字段预留占位框 → **零 CLS**
- 卡片底部悬浮条：作者 `recommenderLabel` + ♥ `likeCount`；hover 时才浮现，默认只有图
- 点击 → `enterSquare()`
- 数据：`/api/square/feed?tab=hot&limit=20`，**首页只拉 1 页**（20 条足够铺满 2 屏），不做无限滚动——无限滚动留给广场页

> ⚠️ **不要复用 `.square-grid`**：它是等宽 CSS Grid + `aspect-ratio: 1/1` + `object-fit: contain`（[styles.css:6472-6530](../src/styles.css#L6472)），竖图横图都被塞进方框留白，直接复用会做出一面「方框留白墙」。需新写 `.home-masonry`。

#### ⑦ Footer（新增）

当前首页没有 footer。补一个极简三段：`本地优先` 一句话隐私声明 · 版本号（复用 `__FRONTEND_BUILD_VERSION__`）· GitHub 链接。高 96px，`--muted-soft` 文字。

---

## 五、数据接线

好消息：**四个区块需要的数据，App 在挂载时已经全部拉好了**，不需要新增任何后端接口。

| 区块 | 数据源 | 现状 |
|---|---|---|
| 能力 chips（模型） | `/api/config` → `runtimeModelConfig` | ✅ mount 时已拉（`fetchAppConfig`） |
| chips 数据徽标 | `/api/model-stats` → `modelStats` state | ✅ mount 时已拉（[App.tsx:3745-3773](../src/App.tsx#L3745)） |
| 能力 chips（Agent） | `/api/config` → `runtimeIndustryAgents` | ✅ 首页当前已在用 |
| 最近生成 | IndexedDB `history` → `sidebarRecords` | ✅ mount effect **无 activePage 判断**，首页停留时已填充 20 条（[App.tsx:3735-3738](../src/App.tsx#L3735)） |
| 灵感发现 | `GET /api/square/feed` | ✅ **匿名可用**——`x-imagehub-api-key` 只用于算 `likedByRequester`，无 Key 照常返回全部数据 |

### 5.1 唯一需要新增的前端逻辑

首页需要**一次** `/api/square/feed` 调用。可整块复用 `SquarePage.loadFeed` 的实现（[App.tsx:10917-10940](../src/App.tsx#L10917)），去掉 `IntersectionObserver` 无限滚动部分。

### 5.2 已知数据限制

- **feed 单次上限 20 条**：`SQUARE_MAX_FEED_LIMIT = 20`，服务端 `Math.min` 硬夹（[vite.config.ts:3385](../vite.config.ts#L3385)），传 `limit=60` 也只回 20。首页按 20 条设计，**不做续拉**。
- **无公开平台统计**：除 `/api/model-stats` 外没有公开的「累计生成数」类接口。**因此新首页不放平台数字**——当前那三个「20/页 / 并行队列 / 本地优先」本来也是文案不是数据，一并删除。

---

## 六、技术改造点

这是本方案里**唯一有架构风险**的部分。三个障碍必须按顺序解决。

### 障碍 1：HomePage 拿不到生成所需的任何状态

`activePage === "home"` 是一个**早 return 分支**（[App.tsx:6666-6673](../src/App.tsx#L6666)），只传 6 个回调 props。而输入框提交需要 `prompt` / `apiConfig` / `models` / `selectedModel` / `params` / `canGenerate` / `requestStartBatch`，全在 App 函数作用域内。

**解法（推荐）**：把 HomePage 从「独立组件 + 早 return」改为**接受状态 props 的受控组件**，新增 6 个 props：

```ts
homePrompt: string
onHomePromptChange: (v: string) => void
onHomeSubmit: () => void
homeModels: { id: string; displayName: string; stat?: ModelStat }[]
recentRecords: GenerationRecord[]
onOauthLogin: () => void          // ← 顺带修复 §2.4 的入口错位
```

不推荐把 home 内联进 App 主 return —— App 已经 12400 行，内联会让它更难维护。

### 障碍 2：首页填了 Key 也不会验证模型，`canGenerate` 恒 false

自动读取模型的 effect **第一行就是门禁**：

```ts
// src/App.tsx:4017
if (activePage !== "studio") return;
```

而 `canGenerate` 依赖 `isModelConnectionVerified`（`modelState.status === "ready"`），后者只有跑过 `loadModels` 才会 ready。**首页的提交按钮会永远是灰的。**

**解法**：把门禁放宽为 `if (activePage !== "studio" && activePage !== "home") return;`。风险低——该 effect 内部已有 1000ms 防抖和 `silent` 模式，且 OAuth 用户的 Key 是 mount 时自动灌入的，正好可以在首页完成静默验证。

### 障碍 3：提交时若尚未就绪，提示词不能丢

首页用户很可能在 Key 还没验证完时就按了提交。**绝不能弹错误然后清空输入框。**

**解法：先接住，再跳转。**

```
onHomeSubmit():
  setPrompt(homePrompt)        // 提示词无条件写进全局 state
  enterStudio()                // 立即跳 #studio
  if (canGenerate) 自动提交
  else Studio 侧照常走 onboarding，但 composer 里已经有提示词了
```

这样无论就绪与否，用户的输入都不丢失，且落进 Studio 后立刻是「底部 composer + 画廊」形态 —— 满足 §三 的下游约束。

### 附带清理

- 删除 5 个 section（`home-flow` / `home-product-showcase` / `home-analysis-showcase` / `home-agent-section` / `home-insight`）及其 CSS（[styles.css:269-782](../src/styles.css#L269) 大部分）
- 删除 `home-studio-preview.png`（513KB）+ `home-prompt-preview.png`（372KB）
- `home-hero.png`（1.4MB）：新方案 hero 不再需要背景大图，**直接删除**，省下全部 1.4MB 首屏阻塞
- 顺带补 Studio topbar 的 Canvas 入口 —— Studio 是当前唯一到不了 Canvas 的页面（[App.tsx:6814](../src/App.tsx#L6814)）

---

## 七、设计令牌规格

新首页**全部使用 design-refresh-prd 已定义的令牌**，不引入任何新的字面值。

| 用途 | 令牌 | 值 |
|---|---|---|
| 页面底 | `--bg` | `#f7f6f2`（**修正当前 `.home-page` 的 `#f5f5f2`**） |
| 输入框 / 卡片底 | `--surface` | `#ffffff` |
| 分隔线 | `--border` / `--border-strong` | `rgba(22,21,15,0.1)` / `0.18` |
| 标题色 | `--text` | `#16150f`（**修正当前硬编码 `#0c0c0d`**） |
| 副标题 / 元信息 | `--muted` / `--muted-soft` | `#6b6a62` / `#9b9a90` |
| chip / 提交按钮 | `--r-pill` | `999px` |
| 输入框容器 | `--r-panel` | `16px` |
| 缩略图卡 | `--r-card` / `--r-thumb` | `12px` / `8px` |
| 交互动效 | `--dur-fast` + `--ease` | `150ms` + `cubic-bezier(0.23,1,0.32,1)` |
| 选中态品牌色 | `--green` / `--green-soft` | `#10a37f` / `#e7f8f2` |

**硬约束**（继承 design-refresh §七）：

- 字重只用 400 / 500，**h1 不超过 `--fs-39`（39px）**
- 卡片零阴影，只用 hairline + overlay；阴影仅限浮层
- 禁止 `transition: all`，只动 `transform` / `opacity`
- 品牌绿出现面积 ≤ 屏幕 10% —— 首页只有「选中的模型 chip」和「提交按钮」两处
- 所有可交互元素 `:focus-visible` 可见焦点环（全局规则已生效）
- 图标按钮必须有 `aria-label`

---

## 八、分期实施

| 期 | 内容 | 改动量 | 风险 |
|---|---|---|---|
| **H1 骨架替换** | 删 5 个 section + 重写顶栏（14 入口→5）+ hero 输入区（静态，不接提交）+ 删 2.3MB 图片资源 | App.tsx ~220 行重写；styles.css ~500 行删除 + ~250 行新增 | 低（纯展示层） |
| **H2 输入接线** | 6 个新 props + 放宽 [App.tsx:4017](../src/App.tsx#L4017) 门禁 + 「先接住再跳转」提交逻辑 | App.tsx 中等 | **中**（触碰生成管线，需回归 Studio 首次生成路径） |
| **H3 内容化** | 能力 chips 带数据徽标 + 最近生成横向行 + 灵感瀑布流（新写 `.home-masonry`） | 中等 | 低（只读数据） |
| **H4 收尾** | Footer + 状态条 + OAuth 登录入口上首页 + 移动端 IA + Studio 补 Canvas 入口 | 小 | 低 |

每期结束跑 `npm run build`（TypeScript 检查在这里）+ 浏览器截图对比验收。

---

## 九、验收标准

1. **眯眼测试**：首屏唯一焦点是输入框；标题和 logo 明显退后。
2. **首次生成路径 ≤ 3 步**：首页打字 → 提交 → （OAuth 用户）直接出图。当前是 ≥5 次点击 + 2 次输入。
3. **提示词零丢失**：在 Key 未就绪状态下提交，跳转 Studio 后 composer 里必须已有该提示词。
4. **首屏内容化**：滚动一屏内必须出现至少一张**真实生成的图**（自己的或社区的），而非产品截图。
5. **零 CLS**：瀑布流用 `aspectRatio` 预留占位，Lighthouse CLS < 0.1。
6. **首屏资源**：删除 2.3MB 图片后，首页首屏不再有 >100KB 的阻塞资源。
7. **令牌合规**：`.home-*` 规则内硬编码色值数 = 0（当前 37 处）；grep `transition: all` = 0。
8. **移动端可达**：≤780px 时三个模块入口仍可点（当前 6 条锚点被整块 `display:none`）。
9. **暗色就绪**：首页不含 inline 写死的亮色背景，`prefers-color-scheme: dark` 下不出现白底黑字撕裂（为 §六.4 的 P2 暗色模式铺路）。

---

## 十一、实施记录（2026-07-25）

H1–H4 已全部落地，`npm run build` 通过，浏览器实测无控制台错误。

### 实际代码改动

| 改动 | 位置 |
|---|---|
| `HomePage` 重写为受控组件（+11 props，含 `homePrompt`/`onHomeSubmit`/`models`/`modelStats`/`recentRecords`/`onOauthLogin`） | [src/App.tsx](../src/App.tsx) `HomePage` |
| 首页参与静默模型验证（门禁放宽为 `!== "studio" && !== "home"`） | [src/App.tsx:4017](../src/App.tsx#L4017) |
| `submitFromHome()` + `homeSubmitPendingRef`（15 秒窗口待办） | `submitFromHome` / 其后的 effect |
| 删除 5 个营销 section + 全部旧 home CSS（514 行 → 617 行新块）+ 4 段会覆盖新样式的旧响应式规则 | [src/styles.css](../src/styles.css) |
| 删除 `home-hero.png`(1.4MB) / `home-studio-preview.png`(513KB) / `home-prompt-preview.png`(372KB) 及其 import | `src/assets/` |

### 验收结果

| 项 | 目标 | 实测 |
|---|---|---|
| h1 字号 / 字重 | ≤39px / 500 | **39px / 500**（原 112px） |
| 首页入口数 | 5 | **5**（原 14） |
| 提示词零丢失 | 必须 | **通过**：首页提交 → `#studio`，composer 内容完整，落进 `app-shell` 形态 |
| 首页硬编码色值 | 0 | **1**（绿底按钮的 `#fff`，原 37 处） |
| `src/assets/` | — | **4KB**（原 2.3MB） |
| 移动端入口可达 | 必须 | **通过**：375px 下 3 个入口全可点，无横向溢出 |
| `transition: all` | 0 | **0** |

### 与本文档的偏差

1. **能力 chips 改为换行居中**，而非 §4.2 设计的横向滚动。原因：实测 720px 容器放不下「1 模型 + 6 Agent」，右侧被硬切成半个 chip，观感像 bug。换行居中同时更接近 Lovart 实际布局（其截图中 chips 也是两行居中）。
2. **`.home-composer` 未设 `min-height: 112px`**，改由 `textarea{min-height:66px}` + padding 自然撑开，实测总高约 112px，效果一致但可随内容增长。
3. **「最近生成」在当前环境未渲染** —— 因为本地 IndexedDB 无历史记录，属设计内的条件渲染，非缺陷。

### 已知的真实数据状态（非缺陷）

- 模型 chip 当前只有 1 个：配置中心只启用了 `gpt-image-2`。多启用几个会自动出现。
- 灵感发现为空：`.data/square-store.json` 当前 0 条推荐。

---

## 十、Backlog（本期明确不做）

- **项目模型**：按 `batchId` 聚合成项目卡（2×2 拼贴封面 + 项目命名 + 更新时间），对齐 Lovart 的「最近项目」。需要新建数据模型。
- **左侧图标窄轨**：等模块数量稳定后再考虑是否替代顶栏。
- **首页暗色主题**：本期只做到令牌化「可暗」，主题本身随 design-refresh P2 一起上。
- **灵感流无限滚动**：需要服务端放宽 `squareMaxFeed`（当前硬夹 20）。
- **平台统计数字**：需要新增公开统计端点。
