# 全项目异步化：架构 Review

> 状态：**待决策**（有 1 个阻塞点需要 owner 拍板，见 §2.1）。
> 目标：`POST /api/images/generate` 立即返回 taskId → 服务端队列执行 → 前端凭 taskId 拿图片地址。全项目覆盖。
> 依据：4 路并行代码盘查（生成入口 / 服务端链路 / 状态持久化 / 影响面），2026-07-25。

---

## 1. 现状

### 1.1 好消息：入口只有 4 个

全仓库 `fetch("/api/images/generate")` **只有 4 处**，改造面比想象中收敛：

| # | 入口 | 覆盖范围 | 已预分配 requestId |
|---|---|---|---|
| ① | `generateSingle` (App.tsx:4966) | **Studio + Agent 模式 + 画册全部走它** | ❌ |
| ② | `handleCanvasGenerate` (10396) | 画布生成 | ✅ |
| ③ | `handleCanvasOptimize` (10512) | 画布优化 | ❌ |
| ④ | `retryNode` (10650) | 画布重试 | ❌ |

Studio 的 `startBatch` / `retryJob` / `enqueueAgentModeJobs` / `submitBrochureStyleBoards` 全部汇入 ①，没有旁路。

### 1.2 服务端是一个 234 行的同步单函数

`vite.config.ts:5471-5704` 从入参校验到 `sendJson` 全程内联，**没有抽出任何可复用的 executor**，也没有队列/worker/任务表抽象。

### 1.3 地基已完成的部分

- `GET /api/tasks`（4319）：按 clientId 查任务，含 ids 精确补查 + 归属校验
- 服务端已支持客户端预分配 `requestId`（5484-5489），带 UUID 格式校验与去重
- `request_logs` 已具备任务表全部字段
- 画布已有 5 秒对账轮询（App.tsx:9857）

---

## 2. 五个阻塞点

### 2.1 ⛔ API Key 与隐私红线正面冲突（**需要你决定**）

**这是唯一的架构级阻塞点。**

现状：`apiKey` 逐请求传入、用完即弃，服务端只记录长度和前缀，`requestParams` 里显式置 `apiKey: undefined`（5535-5539）。CLAUDE.md 红线原文：**「Never log API keys」**。

冲突：服务端队列要执行任务，就必须**持有 Key 从入队时刻到执行时刻**。

两个选项：

| | 方案 A · 仅内存持有 | 方案 B · 落盘加密 |
|---|---|---|
| Key 存放 | 内存队列，进程退出即弃 | SQLite 加密列 |
| **不违反红线** | ✅ 内存不算「记录」 | ❌ **需要你明确松绑隐私模型** |
| 进程重启 | 队列全丢，需把 running 判死 | 可恢复 |
| 部署影响 | 无 | 要管理加密密钥 |

**我的建议是 A。** 理由：这个项目的 local-first 定位是它唯一的结构性差异点，为了「重启能恢复队列」这个边缘场景去动隐私模型不划算。重启是可控事件（你自己 deploy），把遗留任务判死并提示用户重试是可接受的。

### 2.2 ⛔ 参考图字节要在队列里驻留

参考图同样禁止落盘，现在只存内存 Map（TTL 10 分钟），且 `cleanup` 在上游调用后**立即执行**。

排队后每个待执行任务要驮着 512KB–1MB 的 base64。**队列深 200 就是数百 MB 常驻**。必须给队列加深度上限和 TTL 淘汰。

### 2.3 ⛔ 客户端重试链路整体失效

Studio 的重试 100% 在前端：`isRetryableError` + 指数退避 `min(8000, 500×2^(n-1))` 都消费 fetch 抛出的错误体。

异步后 POST 恒返回 202，**永远没有 error 可判**，App.tsx:5193-5231 整段变成死代码。重试必须整体搬到服务端 worker，这意味着 `retryLimit` 要随任务提交、`request_logs` 需要 `attempt` 字段。

> 还有个坑：重投若复用同一个预分配 requestId，会被 5488 的去重判掉并静默改用服务端 UUID，客户端从此失去映射。

### 2.4 ⛔ Studio 完全没有找回能力

三个缺口叠加：

- `generateSingle` 不发 requestId
- `StoredHistoryRecord.status` 类型**只有 `success | error`**，没有 queued/running
- `saveHistoryRecord` **只在终态调用**（5151 成功 / 5281 失败），排队和运行中的 Job 只活在内存

所以异步化对 Studio 的第一步不是接轮询，而是**扩数据模型**（可能要 bump IndexedDB 版本，当前 v3）。

### 2.5 ⛔ 僵尸 running 行没有任何清理

全仓找不到启动时扫描 `status='running'` 的逻辑。后果是三重的：

- `daily_stats` 的累加守卫是 `running → 终态` 跳变，永远 running 就**永远不进日聚合**
- `/api/admin/stats` 的 running 计数永久虚高，且 `successRate` 分母含 running
- 前端对账 effect 对 running 任务**无超时、无退避地每 5 秒查一次，直到永远**

必须新增启动时 sweeper + 任务超时判死。

---

## 3. 其余需要一并处理的（high）

| 问题 | 说明 |
|---|---|
| **durationMs 语义被污染** | 现在 `durationMs = 终态 - 路由入口`。加队列后 = 排队 + 生成。P50/P95 和 daily_stats 全线失真。需新增 `dispatchedAt`，把 `queueWaitMs` 单列 |
| **running 稀释 successRate** | 需引入独立的 `queued` 状态并从分母剔除 |
| **配额计数时机** | 必须定在**入队**而非出队，否则用户可瞬间入队上千条，每条都先建了 running 行 |
| **画布 2 个入口没预分配 ID** | `handleCanvasOptimize` / `retryNode` 异步后仍会丢结果 |
| **canvas-state 与 blob 两次独立写** | 不一致窗口从毫秒放大到分钟级，会落盘出「success 但 blob 缺失」的节点 |
| **服务端图片存活期成为正确性依赖** | `createRequestLog` 每次新任务都会裁剪删图（5000 条上限）。高频用户可能在回来取图之前就把自己的图挤掉 |
| **前端并发闸门失效** | `pumpQueue`(1-6) 与画布(6) 是 per-tab 的，开两个标签页就是 12 路。并发控制必须搬到服务端 |
| **Agent 画册上下文不落盘** | `brochureProject` 只活在 React state，入队即清空。恢复回来的 4 张风格板会失去「属于同一本画册、需要选一张」的语义 |

## 4. 影响面里容易漏的（medium/low）

- **JobStages 脉冲线**只有 4 段，排队时长会被算进「接收→请求上游」段，看起来像本机卡顿
- **`/api/tasks` 返回体太薄**：缺 stages / batchId / params / agentName，广场推荐和脉冲线恢复后会功能残缺
- **缩略图回传**挂在客户端成功回调上，**恰好与异步目的冲突**——提交完就关页面的任务永远没人算缩略图。应挪进服务端 worker
- **`generatedImageToBlob` 的 dataUrl 兜底失效**：异步后 POST 不返回图，取图单点依赖服务端文件
- **`/api/tasks` 无鉴权**且 clientId 走 query string，作为主数据通道后暴露面上升，建议对齐 `x-imagehub-api-key` 头
- **好评差评刷新后丢失**：`feedbackMap` 是纯内存，没有 GET 回读接口。异步化让「关页面→回来看」成为主流程后，这个缺口会被放大

---

## 5. 工作量与建议

### 分期

| 期 | 内容 | 依赖 |
|---|---|---|
| **A0** | 决策隐私方案（§2.1）+ 服务端队列骨架（内存队列 + worker pool + 并发上限 + 深度上限） | **你的决定** |
| **A1** | 抽出 executor：把 5471-5704 从「请求处理器」拆成「可被队列调用的纯函数」 | A0 |
| **A2** | 状态模型：新增 `queued` 状态 + `dispatchedAt`/`queueWaitMs` + 启动 sweeper + 超时判死 | A1 |
| **A3** | Studio 侧：扩 IndexedDB 类型（含 bump version）+ 预分配 requestId + 对账轮询 | A2 |
| **A4** | 画布补齐 2 个入口 + 重试搬服务端 + 缩略图挪进 worker | A2 |
| **A5** | 统计口径修正、`/api/tasks` 扩字段、并发闸门下线、脉冲线加排队段 | A3/A4 |

### 老实说

这不是一次「优化」，是**生成链路的重写**。前端从「同步等待」改成「提交 + 订阅」，涉及 4 个入口、2 套并发机制、3 层持久化（内存 state / IndexedDB / SQLite）、以及统计口径。

而且它有个反直觉的性质：**改完之后，用户感知到的「快」不会变**（生成仍然要那么久），变的是「关页面不丢」和「服务端可控并发」。

如果你的核心痛点只是「关页面不丢」，§2 里的 A3 单独做（Studio 补齐找回能力，复用画布已验证的那套）能覆盖 80% 的价值，成本是完整改造的 15% 左右。真正需要完整队列的场景是：**服务端要限流**、**要支持重启恢复**、**要在无客户端在线时执行任务**。
