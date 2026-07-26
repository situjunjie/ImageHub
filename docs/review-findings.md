# 全站功能 Review 结果（2026-07-25）

> 方法：5 个模块并行 review 提出问题，每条再由独立 agent **对抗性验证**（默认判误报，除非能在代码中指出致害行）。
> 提出后证实 **32** 条，推翻 7 条。共 44 个 agent。

## 一、本轮已修复（6 条）

| # | 严重度 | 问题 | 位置 |
|---|---|---|---|
| 1 | HIGH | 首页模型 chip 用裸 setSelectedModel 绕过 selectImageModel，选中 Gemini/跨协议模型后 can | `src/App.tsx:6710` |
| 9 | HIGH | OAuth 回调把用户上游 API Key 明文写进服务器日志文件 | `vite.config.ts:4245` |
| 11 | HIGH | 首页新增的广场信息流让每个匿名访客触发 21 次整站 square-store.json 全量解析 | `vite.config.ts:4102` |
| 12 | MEDIUM | 首页输入框回车提交未防 IME 组合态，中文输入法回车选词会提前提交并跳页 | `src/App.tsx:10824` |
| 13 | MEDIUM | homeSubmitPendingRef 的 15 秒待办窗口内，用户在 studio 改写 prompt 会被自动发车抢跑，用半截提示词消 | `src/App.tsx:4062` |
| 27 | LOW | 删除首页营销区 CSS 时移除了 Square/Canvas 仍在复用的 .home-kicker 和 .home-brand span，两 | `src/App.tsx:11129` |

## 二、待处理（26 条）

### HIGH（8 条）

#### 2. 10 秒倒计时期间调整任意生成参数，会静默丢弃已输入的提示词和参考图，且不生成任何图片

**位置**：`src/App.tsx:6211`　**模块**：Studio 工作台（src/App.tsx 生成队列 / 提示词分析倒计时 / 参考图 / 历史与删除 / 首页入口联动）

**机制**：requestStartBatch 在进入预检前已经把 composer 清空（src/App.tsx:6121-6122 `setPrompt("")` / `setReferenceImages([])`），此时提示词和参考图的唯一副本存放在 analysisCountdown 快照里。代码里有两个语义不同的取消函数：abandonAnalysisCountdown（src/App.tsx:5468）会把快照回写到 prompt/referenceImages/lastAppliedAgent 再取消；cancelAnalysisCountdown（src/App.tsx:5460）只 clearInterval + setAnalysisCountdown(null)，不做任何回写。而 updateParams 的第一行就是裸的 cancelAnalysisCountdown()（src/App.tsx:6211），于是设置面板里张数/并发/比例/分辨率/质量/格式/重试次数/Seed/负面提示词的任何一次 onChange（src/App.tsx:7924、7946、7997、8007、8025、8038、8052、8057、8066）都会走这条路。同一问题还存在于 handleFiles（src/App.tsx:4379，倒计时期间拖入或选择参考图）、removeReference（src/App.tsx:6421）以及智能建议面板右上角的「关闭」X 按钮（src/App.tsx:7448）。这四处都只调 cancelAnalysisCountdown，快照直接被丢弃

**复现**：工作台保持默认的「自动预检」开启 → 在输入框写一段较长提示词并上传 2 张参考图 → 点发送 → 面板出现「10 秒后将按原始提示词自动生成」倒计时 → 在倒计时结束前把右侧设置里的「张数」从 4 改成 8（或拖一张新参考图进来）→ 倒计时立刻消失、输入框是空的、参考图列表是空的、队列里没有任何新任务，用户刚写完的提示词无法找回，必须重新输入。

> 验证修正：工作台（桌面端，窗口宽度 > 1180 使右侧「配置」面板默认展开），保持默认开启的「自动预检」→ 在输入框写一段长提示词并上传 2 张参考图 → 点发送（src/App.tsx:6102 requestStartBatch，6121-6122 清空 composer）→ 预检完成后面板出现「10 秒后将按原始提示词自动生成」倒计时（5559/5581 startAnalysisCountdown 持有唯一副本）→ 在 10 秒内把右侧「张数」从 4 改成 8（src/App.tsx:7994 onChange → 6210 updateParams → **6211 cancelAnalysisCountdown()**）。

结果：倒计时立即消失，队列不产生任何任务，输入框空、参考图列表空。参考图（唯一 base64 副本）彻底丢失，必须重新上传；原始提示词原文不可找回（面板残留的只有


#### 3. 重试退避（最长 8 秒）窗口内删除记录无效：记录会在退避结束后复活并真实消耗一次上游生成调用

**位置**：`src/App.tsx:5004`　**模块**：Studio 工作台（src/App.tsx 生成队列 / 提示词分析倒计时 / 参考图 / 历史与删除 / 首页入口联动）

**机制**：generateSingle 判定可重试后，把记录 patch 成 status:"queued"（src/App.tsx:4993-5002），然后用一个未被任何 ref 跟踪的 window.setTimeout 在 backoffMs 后重新 enqueueJobs（src/App.tsx:5004-5006）。在这段退避时间里，该 job 既不在 pendingQueueRef 里，也不在 runningCountRef 里。而 confirmBulkDelete 的队列同步只做了 `pendingQueueRef.current = pendingQueueRef.current.filter(...)`（src/App.tsx:4321），完全覆盖不到这个挂起的定时器；requestBulkDelete 的可删条件是 `record.status !== "running"`（src/App.tsx:4306），queued 状态是允许勾选删除的，JobCard 的选择框同样只在 running 时禁用（src/App.tsx:11674-11687）。退避结束后定时器照常入队 → generateSingle 真的向 /api/images/generate 发起请求（计费、计入配额）→ 成功后 saveHistoryRecord + setSidebarRecords(mergeHistoryRecords(...))（src/App.tsx:4947-4957），已被删除的记录重新写回 IndexedDB 并出现在左侧「最近记录」里。单条删除 deleteHi

**复现**：把「失败自动重试」设为 2，用一个会返回 5xx/429 的上游地址提交一批 → 某张图失败后卡片显示「重试中 2/3」（queued 状态）→ 立刻进入多选模式勾选这张卡片并确认删除，弹窗提示「运行中的任务不会被删除」→ 卡片消失 → 最多 8 秒后，左侧「最近记录」里又冒出这条记录（成功则带图，失败则是错误记录），同时后台请求日志多出一次真实生成调用。

> 验证修正：前提：设置里把「失败自动重试」设为 5（这样退避才会到 8 秒量级；默认值 2 时窗口仅 500ms/1000ms，缺陷同样成立但更难手动撞上）。\n\n1. 配置一个稳定返回 5xx 或 429 的上游地址，提交一批生成任务。\n2. 某张图第一次失败后，generateSingle 走到 src/App.tsx:4969 判定 canRetry=true，卡片被 patch 成 status:"queued"，UI 显示「重试中 N/6」（11704 行）。此刻 window.setTimeout（5004）已挂起，job 不在 pendingQueueRef、也不在 runningCountRef。\n3. 立即进入多选模式，勾选这张卡片（selectable 检查只挡 running，7017/4250 均放行），确认删除。\n4. confirmBulkDelete（4313-4


#### 4. 节点拖拽未做 setPointerCapture，在画布外松手会导致节点永久黏住鼠标

**位置**：`src/App.tsx:9676`　**模块**：Canvas 无限画布（src/App.tsx CanvasPage）

**机制**：handleNodePointerDown 只置位 isDraggingNodeRef.current = true，没有调用 (e.target).setPointerCapture(e.pointerId)（对比 9622 行平移分支是有 capture 的）。pointermove / pointerup 只挂在 .canvas-viewport 这个 div 上（10228-10232 行的 onPointerMove/onPointerUp），没有 window 级监听，也没有 onPointerLeave / onPointerCancel。一旦指针移出 viewport（右侧 360px 面板、48px 顶栏、浏览器窗口外），pointerup 事件不会冒泡到 viewport，handleCanvasPointerUp 永远不执行，isDraggingNodeRef.current 一直是 true。handleCanvasPointerMove 也不检查 e.buttons，所以之后只要鼠标再次划过画布，节点就按 ds.startX + dx 继续跟随（而且是相对最初按下点算的位移，会瞬间跳很远）。

**复现**：生成 2 张图 → 按住某个节点往右拖，把鼠标拖到右侧参数面板上方再松开左键 → 松手后不点任何东西，只把鼠标移回画布 → 该节点继续跟着光标跑，位置随机跳动，必须再点一次画布才能停下；停下时节点已经被移到错误位置并被 scheduleSave 持久化。

> 验证修正：前置：Chrome/桌面鼠标操作，进入 #canvas，画布上已有 ≥1 个节点。1) 在节点上按住鼠标左键开始拖拽（触发 src/App.tsx:9676 handleNodePointerDown，isDraggingNodeRef=true，无 pointer capture）。2) 保持按住，把光标移到右侧 .canvas-right-panel（或顶栏 header、或浏览器窗口外）上方，在那里松开左键 —— 该 pointerup 的 target 不在 .canvas-viewport 子树内（panel/header 是 viewport 的兄弟节点，viewport 又是 overflow:hidden），10233 行的 onPointerUp 不触发，isDraggingNodeRef 保持 true。3) 不点击任何位置，只把光标移回画布区域 —— 9640 的 h


#### 5. 生成中途切走页面：图片实际已生成并存入 IndexedDB，回到画布却被判定为「生成中断」，图片永久丢失

**位置**：`src/App.tsx:9457`　**模块**：Canvas 无限画布（src/App.tsx CanvasPage）

**机制**：CanvasPage 在 activePage 切换时会整体卸载（App.tsx:6732 是 return <CanvasPage/>，不是常驻）。handleCanvasGenerate 的 fetch 在卸载后仍继续：成功分支里 setCanvasNodes（10 行 9890）对已卸载组件是 no-op，但紧接着的 await saveCanvasImageToDB(nodeId, blob)（9902）照常把 blob 写进 canvas-images。而 canvas-state 里这个节点的状态停留在 'generating'（节点加入时的 debounce 保存写的就是 generating，卸载后再没有任何写入把它改成 success）。重新进入画布时，加载逻辑 9455-9458 对 status==='generating' 的节点无条件改成 error「生成中断（页面关闭）」，完全没有先尝试 loadCanvasImageFromDB(node.id) 兜底——而 blob 明明就在库里。用户只能重试（再花一次上游调用），旧 blob 则成为永远不会被回收的孤儿数据。

**复现**：画布点「生成到画布」→ 立刻点顶栏「工作台」（或「首页」/「广场」）→ 等 20 秒生成完成 → 点回「画布」→ 该节点显示红框「生成中断（页面关闭）」，图片看不到也取不回，但 IndexedDB canvas-images 里存着这张图。

> 验证修正：进入 #canvas → 输入提示词点「生成到画布」（节点以 status:'generating' 入库，500ms 防抖写入 canvas-state）→ 立刻点顶栏「工作台」/「首页」/「广场」（CanvasPage 卸载，但 fetch 与那次 setTimeout 保存都继续）→ 等约 20 秒生成完成（setCanvasNodes 成为 no-op，但 9902 的 saveCanvasImageToDB 把 blob 写进 canvas-images；canvas-state 中该节点仍是 generating，无任何后续写入）→ 点回「画布」→ 加载逻辑命中 9457，节点被无条件标记为红框「生成中断（页面关闭）」，从不尝试 loadCanvasImageFromDB，图片虽在 IndexedDB canvas-images 中却无法显示或取回，用户只能重新生成。修正点：该


#### 6. IndexedDB 读失败时静默清空画布，并在 500ms 后把空状态覆盖写回，已保存的全部节点永久丢失

**位置**：`src/App.tsx:9469`　**模块**：Canvas 无限画布（src/App.tsx CanvasPage）

**机制**：挂载加载 effect（9439-9473）把整段恢复流程包在一个 try 里，其中对每个 success 节点串行 await loadCanvasImageFromDB。任意一次 IDB 事务异常（事务 abort、存储被驱逐、隐私模式、VersionError 回退后 openDb 返回的旧库缺少 canvas-* store）都会跳到 catch，catch 体只有 setCanvasLoaded(true)（9469）——loadedNodes 被整体丢弃，没有任何报错提示。随后自动保存 effect（9497-9501）因为 canvasLoaded 由 false 变 true 而触发 scheduleSave，500ms 后用 nodesRef.current（空数组）执行 saveCanvasStateToDB，把 canvas-state 的 'current' 键覆盖成 {nodes: [], edges: []}。即原本只是一次读失败，结果变成不可逆的整画布抹除。

**复现**：画布上已有 N 个节点 → 刷新页面，恢复过程中任一 loadCanvasImageFromDB 抛错（浏览器存储被驱逐 / Safari 隐私模式 / 另一标签页正在做 IDB 升级导致事务失败）→ 页面显示空画布（连错误提示都没有）→ 0.5 秒后 canvas-state 被写成空 → 之后再刷新，节点和连线永久消失。

> 验证修正：修正原描述中错误的一条触发路径后的可复现路径：

前置：用户在 #canvas 已保存 N 个 success 节点（canvas-state 的 'current' 键有完整数据，canvas-images 有对应 blob）。

1. 刷新页面进入 #canvas，CanvasPage 挂载，9444 `loadCanvasStateFromDB()` **成功**返回含 N 个节点的 saved。
2. 9447-9461 串行循环中，任意一次 9449 `loadCanvasImageFromDB(node.id)` 因 IDB 事务/请求错误而 reject（存储压力下事务 abort、Safari 隐私模式或激进的 IDB 驱逐、底层 I/O 错误导致 request.onerror）。注意：blob 单纯"不存在"不会触发此路径（2414 返回 null，节点被降级为 err


#### 7. 推荐被拒（重复图/审核/频控/图过大）仍然扣掉当日推荐配额

**位置**：`vite.config.ts:3473`　**模块**：Square 广场 + Admin 管理后台

**机制**：handleSquareRecommend 在配额上限检查通过后，立刻执行 `quota.dailyRecommendUsed += 1`（3473 行），而全部后续校验（missing_square_thumbnail 400、invalid_square_thumbnail 400、square_thumbnail_too_large 413、missing_prompt 400、审核 422、rapid_submit_backoff 429、duplicate_active_item 409）都走 reject()。reject() 内部调用 appendSquareRecommendLog + writeSquareStore(store)，而 quota 是 getSquareQuota 返回的 store.quotas 里的对象引用，所以这次自增被持久化写盘。只有第一处「今日推荐额度已满」的分支在自增之前 return，其余七种拒绝路径全部白扣一次配额。reject() 回给前端的 remainingDailyQuota 也已经是扣减后的值。

**复现**：配置 API Key，在工作台生成一张图并成功推荐到广场（配额 10 → 9）。对同一张图再点一次「推荐到广场」：服务端走 duplicate_active_item 分支返回 409「这张图已经在你的广场展示位中」，用户什么都没发布，但配额变成 8。连续点 9 次后第 10 次直接 429「今日推荐额度已满」，当天一张新图都推不了。含敏感词被 422 拦下、或 60 秒内提交超 8 次被频控时同理。

> 验证修正：1) 配置 API Key，在工作台生成一张图，点「推荐广场」成功（.data/square-store.json 中该 apiKeyHash 当日 dailyRecommendUsed=1，剩余 9）。2) 刷新页面（或直接再点一次同一张图的「推荐广场」按钮，该按钮成功后并未禁用）。3) 服务端 vite.config.ts:3473 先把 dailyRecommendUsed 自增到 2，随后在 duplicate_active_item 分支 reject(409, "这张图已经在你的广场展示位中")，reject 内部 writeSquareStore 把 2 落盘。用户没有发布任何内容，配额却少了 1。4) 重复步骤 2 共 9 次后 dailyRecommendUsed=10，下一次任何推荐（哪怕是全新图片）在 vite.config.ts:3469 直接返回 429「今日推荐


#### 8. createSquareThumbnail 对 ≤1024px 的图直接返回原始 dataUrl，未压缩的多 MB base64 被写进 square-store.json

**位置**：`src/App.tsx:2484`　**模块**：Square 广场 + Admin 管理后台

**机制**：createSquareThumbnail 里 `if (longestEdge > 0 && longestEdge <= maxEdge) { resolve({ dataUrl, ... }); return; }` —— 长边不超过 maxEdge(1024) 时直接把入参原样返回，完全跳过 canvas 重编码。而 official-1k 模型族的默认 1:1 输出正是 1024x1024（src/App.tsx:798），常见 PNG 原图 1.5–3MB，转 base64 后 2–4MB。这段 dataUrl 原封不动 POST 到 /api/square/recommend，服务端只做 8MB 上限检查（vite.config.ts:3500）就把它写进 item.thumbnailDataUrl，最终落到 .data/square-store.json。该 JSON 保留 2500 条 items（vite.config.ts:566），且被替换下架的 item（active:false）仍完整保留 thumbnailDataUrl，永不清理。前端 reasonPlan 里还声称 compressedTo: "1K"，与实际不符。更致命的是 readSquareStore/writeSquareStore 是同步全量读写：每一个 /api/square/* 请求都要 readFileSync + JSON.parse + JSON.stringify + writeFileSync 整个文件。

**复现**：用 1:1（1024x1024）比例生成图片并推荐到广场，重复几十次（多个用户各 4 个展示位、加上被替换下架仍保留的历史条目）。.data/square-store.json 涨到几百 MB 后，任何人打开 /#square 触发 GET /api/square/feed，Node 主线程要同步 parse 整个文件，单请求阻塞数秒；同一时刻所有 /api/images/generate 请求一起卡死。再增长下去 JSON.parse 会直接触碰 V8 字符串上限抛错，readSquareStore 的 catch 兜底返回 emptySquareStore()，广场数据表现为「全部消失」。

> 验证修正：1. 保持出厂默认参数（aspectRatio "1:1"、outputFormat "png"，src/App.tsx:2962-2967），选一个 official-1k 族模型生成图片，输出为 1024x1024 PNG（src/App.tsx:798 SIZE_BY_RATIO）。注意：必须用 1:1，其他 official-1k 比例长边 >1024 会被正常压缩。
2. 点击「推荐到广场」。src/App.tsx:2484 的早返回使 2-4MB 的原始 PNG base64 未经压缩直传；vite.config.ts:3499-3500 仅有 8MB 上限，放行；vite.config.ts:3571 原样落入 item.thumbnailDataUrl，:3625 写入 .data/square-store.json。
3. 重复推荐（每用户每日配额 10 次；超出展示位的


#### 10. /api/square/quota 是 GET 却整体重写 square-store.json，且可被任意请求刷掉全部配额记录

**位置**：`vite.config.ts:3415`　**模块**：后端 API 与数据层（vite.config.ts registerApiRoutes + server/index.ts）

**机制**：该 GET 端点只校验 `x-imagehub-api-key` 请求头非空，从不验证其有效性；`getSquareQuota()`（840 行）对没见过的 hash 会 `store.quotas.unshift(新记录)`，随后无条件 `writeSquareStore(store)` 把整个 store 同步写回磁盘。而 writeSquareStore（vite.config.ts:572）做 `store.quotas = store.quotas.slice(0, 5000)` —— 新记录 unshift 在头部，slice 保留最新 5000 条，于是**最老的真实用户配额记录被挤掉**。两个后果：(1) 一个只读接口在每次调用时做一次多 MB 的同步 writeFileSync，阻塞事件循环；(2) 配额状态可被无成本冲刷。

**复现**：用 curl 循环发 5000 次 `GET /api/square/quota -H 'x-imagehub-api-key: <每次随机字符串>'`（无需任何合法凭据）→ 所有真实用户的 quotas 记录被 slice(0,5000) 挤出文件 → 这些用户再调 /api/square/quota 时 getSquareQuota 重新建记录，dailyRecommendUsed/dailyLikeUsed 归零，当日 10 次推荐/10 次点赞限额被完全绕过；同时每次请求都触发一次全量 JSON 写盘。

> 验证修正：1) 准备：让 .data/square-store.json 中已存在若干真实用户当日 quotas 记录（例如某用户已推荐 10 次，dailyRecommendUsed=10）。2) 不带任何合法凭据执行约 5000+ 次：curl -s http://localhost:8877/api/square/quota -H "x-imagehub-api-key: $(openssl rand -hex 16)"（每次随机）。每次请求都会走 vite.config.ts:856 unshift 新记录 + 3415 全量 writeFileSync。3) 结果 A：writeSquareStore(572) 的 slice(0,5000) 把最老的真实用户记录挤出文件；该用户再调 /api/square/quota 或 POST /api/square/recommend 时 getS


### MEDIUM（13 条）

#### 14. 首页模型 chip 直接调 setSelectedModel 绕过 selectImageModel，选中 Gemini 3 Pro Image 后工作台永远无法生成且无任何提示

**位置**：`src/App.tsx:6710`　**模块**：Studio 工作台（src/App.tsx 生成队列 / 提示词分析倒计时 / 参考图 / 历史与删除 / 首页入口联动）

**机制**：HomePage 的模型 chip 回调透传的是裸 setter：`onSelectModel={setSelectedModel}`（src/App.tsx:6710），chip 点击处 src/App.tsx:10858 直接 onSelectModel(model)。工作台内部选模型走的是 selectImageModel（src/App.tsx:6265），它会 protocolForImageModel → 切 apiConfig.protocol、把模型并入 models、重置 verifiedModelKey 触发重新验证。首页这条路一样都不做。而 canGenerate 同时要求 `models.includes(selectedModel)` 与 `protocolMatchesImageModel(apiConfig.protocol, selectedModel)`（src/App.tsx:3725-3732）。默认协议是 custom-openai（src/App.tsx:759），配置中心默认白名单第 4 个模型就是 gemini-3-pro-image-preview（vite.config.ts:645），而它要求 protocol === "gemini-native"（src/App.tsx:1892）；loadModels 又用 imageModelsForProtocol 按协议过滤（src/App.tsx:3032-3036、4595），所以 models 里根本不会有它。首页 chips 取的是 `models.slice(0, 4)`

**复现**：用默认配置打开首页（已登录/已有可用 Key，模型验证通过）→ 点第 4 个模型 chip「Gemini 3 Pro Image」→ 输入提示词按回车 → 跳进工作台，提示词在输入框里，但发送按钮一直是禁用的，模型状态栏显示「API Key 有效 · N 个图片模型」没有任何报错；15 秒后首页待办超时（src/App.tsx:4066），用户完全不知道为什么发不出去。只有手动到模型选择器里重新点一次同一个模型（走 selectImageModel 切协议）才能恢复。

> 验证修正：前提补正：必须在模型验证**已完成**之后点 chip。步骤：浏览器已记住 API Key → 打开首页 → 等约 1 秒，src/App.tsx:4017 的 effect 静默完成 loadModels，modelState 变为 ready（此 effect 现在在 home 也生效）→ 点第 4 个模型 chip「Gemini 3 Pro Image」（src/App.tsx:10857，此时 selectedModel 被裸 setter 改为 gemini-3-pro-image-preview，apiConfig.protocol 仍是 custom-openai）→ 输入提示词点发送（submitFromHome，src/App.tsx:6618）→ 跳进 studio，提示词已在输入框，但发送按钮始终禁用，模型状态栏无任何报错；15 秒后 homeSubmitPendin


#### 15. 预检倒计时结束时执行的是快照渲染的 startBatch 闭包，倒计时中途换模型后仍按旧模型生成

**位置**：`src/App.tsx:5522`　**模块**：Studio 工作台（src/App.tsx 生成队列 / 提示词分析倒计时 / 参考图 / 历史与删除 / 首页入口联动）

**机制**：startAnalysisCountdown 的 setInterval 回调（src/App.tsx:5512-5531）捕获的是「点击发送那一次渲染」里的 startBatch。startBatch 只对 prompt / params / referenceImages 做了显式快照（promptOverride / paramsOverride / referenceImagesOverride），selectedModel 和 apiConfig 则是直接从闭包读的（src/App.tsx:5637-5646、5673-5688）。倒计时期间通过模型选择器换模型走的是 selectImageModel（src/App.tsx:6265），它用 setParams 而不是 updateParams，因此不会取消倒计时；10 秒后触发的 startBatch 仍读到旧的 selectedModel，创建的 Job 也带旧 model，实际发给上游的是旧模型。UI 上模型选择器显示的却是新模型，用户无从察觉。

**复现**：输入提示词 → 点发送 → 出现 10 秒倒计时 → 在倒计时期间把模型从 gpt-image-2 切到 gpt-image-2-pro（同协议，倒计时不会被取消）→ 等倒计时跑完 → 生成出来的任务卡片和后台请求日志里的 model 仍是 gpt-image-2，用户按新模型的价格/预期在等结果。

> 验证修正：前置：设置里「发送前自动优化」保持默认开启（isAutoPromptAnalysisEnabled 默认 true）；模型选 gpt-image-2 且 modelState 已 ready。
1. 在 studio 输入任意提示词，点发送 → 走 analyzeBeforeGenerate（src/App.tsx:6135），预检完成后出现 10 秒倒计时（src/App.tsx:5560/5580）。
2. 倒计时期间在左侧「可用生图模型」列表点 gpt-image-2-pro（src/App.tsx:7902 → selectImageModel）。注意必须在这两个同为 explicit-2k4k、同协议的模型之间切换：此时 aspectRatio/resolution 不变，src/App.tsx:3978 提前 return，不触发 updateParams，倒计时不会被取消。（


#### 16. 倒计时期间点击「风格增强」标签不会生效，反而把碎片文本残留在已清空的输入框里

**位置**：`src/App.tsx:5424`　**模块**：Studio 工作台（src/App.tsx 生成队列 / 提示词分析倒计时 / 参考图 / 历史与删除 / 首页入口联动）

**机制**：风格增强 chip 渲染在 analysisResult 面板里，且不区分 analysisState.mode（src/App.tsx:7536-7548），所以 send 模式的 10 秒倒计时期间它是可点的。appendStyleEnhancement（src/App.tsx:5424-5427）只做 setPrompt 追加，既不取消倒计时也不更新 analysisCountdown.prompt 快照。而此时 prompt 已被 requestStartBatch 清成空串（src/App.tsx:6121），所以点击结果是 prompt 变成孤立的一段风格片段；倒计时结束后 startBatch 用的仍是快照里的原始提示词（src/App.tsx:5522-5528），风格增强完全没进这次生成。生成结束后输入框里还留着那段碎片，用户下一次提交会莫名其妙带上它。

**复现**：输入「一只在窗边的猫」→ 点发送 → 预检面板出现，倒计时 10 秒 → 点面板里的某个「风格增强」标签（比如「电影感」）→ 输入框里出现孤零零的 “cinematic lighting, ...” 片段 → 倒计时结束，生成的图完全没有该风格；此时输入框里还残留着这段片段，直接再点发送就会把它当成新提示词提交。

> 验证修正：前置：设置里"发送前智能预检"保持默认开启（localStorage 键 imageStudioAutoPromptAnalysisEnabled 默认 true），Agent 模式关闭。

1. 在 Studio 输入框输入「一只在窗边的猫」，点发送。
2. `requestStartBatch`(src/App.tsx:6102) 先 `setPrompt("")`(6121) 清空输入框，再走 `analyzeBeforeGenerate`(6136)。
3. 预检返回后 `analysisState` 变为 `{status:"ready", mode:"send"}`，同时 `startAnalysisCountdown`(5482) 启动 10 秒倒计时并把原始提示词存进 `analysisCountdown.prompt` 快照。
4. 倒计时期间面板里的「风格增强」chip


#### 17. saveCanvasImageToDB 写失败会把已经成功的节点回滚成 error，扔掉刚生成出来的图

**位置**：`src/App.tsx:9902`　**模块**：Canvas 无限画布（src/App.tsx CanvasPage）

**机制**：handleCanvasGenerate / handleCanvasOptimize / retryNode 都是先 setCanvasNodes 标记 success，然后在同一个 try 块里 await saveCanvasImageToDB（9902、10032、10118）。IndexedDB 写入抛异常（QuotaExceededError 最典型——画布累积 2K/4K PNG 很容易撑爆配额）时，异常被同一个 catch 捕获，节点被改成 status:'error' + error = IDB 的报错文案，图片虽然还在内存 objectUrl 里却不再渲染，也无法下载/优化，只能重试再花一次上游调用。docs/canvas-mode-prd.md §12.4 明确要求存储写失败时是「顶部显示警告横幅」，而不是把生成结果判为失败。

**复现**：在配额紧张的环境（隐私窗口，或画布里已存了几十张 4K 图）继续生成 → 图片先正常显示 1 帧 → IDB 写入抛 QuotaExceededError → 节点立刻变红框错误态，图片消失。

> 验证修正：在配额紧张环境（隐私窗口，或画布已累积数十张 2K/4K PNG）于 #canvas 继续生成 -> 上游返回成功，节点先被置为 success 并提交一次渲染（saveCanvasImageToDB 内部先 await openDb()，中间隔着微任务，图片确实会正常显示一帧）-> IndexedDB put 触发 QuotaExceededError，事务 abort，tx.onerror 使 Promise reject -> 异常被 src/App.tsx:9903 的 catch 捕获，节点被覆写为 status:"error"，图片消失变红框，浮动工具栏只剩「重试」「删除」。即使没有那一帧闪现，最终持久状态为错误态这一点不变；且点「重试」会再次撞上同一配额限制，用户无法自救，只能删除节点并白白损失一次上游调用费用。


#### 18. Cmd/Ctrl+Shift+F「适应全部节点」因闭包过期而失效（刚进画布时完全不响应）

**位置**：`src/App.tsx:9750`　**模块**：Canvas 无限画布（src/App.tsx CanvasPage）

**机制**：键盘 effect 的依赖数组是 [selectedNodeId, panelMode]（9750），但处理函数里调用的 fitAllNodes（9525）闭包捕获的是 effect 注册那一刻的 canvasNodes（9526 行 `if (canvasNodes.length === 0) return;` 读的是快照，不是 nodesRef）。首帧 canvasNodes 为空数组，IndexedDB 恢复完成后 canvasNodes 变了但 selectedNodeId / panelMode 没变，监听器不会重挂，快捷键读到的永远是空数组直接 return。同理，之后每次生成新节点也不会刷新这个闭包。PRD §8 标注该快捷键作用域是「任何时候」。

**复现**：打开 #canvas（画布里已有若干节点，从 IndexedDB 恢复）→ 不点任何节点，直接按 Cmd+Shift+F → 毫无反应；改点一下某个节点（selectedNodeId 变化重挂监听）后再按才生效；此后再生成 3 张新图、不改变选中，按 Cmd+Shift+F 只会框住旧的那批节点。

> 验证修正：主复现路径成立：打开 #canvas（IndexedDB 中已有若干节点）→ 不点任何节点、不进优化模式，直接按 Cmd/Ctrl+Shift+F → 毫无反应；点一下任意节点使 selectedNodeId 变化、监听器重挂后再按才生效。

对原报告后半段的一处修正：两条生成路径行为不同。handleCanvasGenerate（9812-9910，右侧面板普通生成）全程不调用 setSelectedNodeId，所以「再生成 N 张新图后快捷键只框住旧节点」在这条路径上确实成立；但 handleCanvasOptimize（9914-10044）成功时会在 10034 行调用 setSelectedNodeId(nodeId)，触发 effect 重挂并自动刷新闭包，因此优化模式生成不会持续处于失效状态。原报告未区分这两条路径。


#### 19. 优化完成后「链式迭代」失效：新节点被选中，但再次点「生成优化」仍用上一张父图当参考

**位置**：`src/App.tsx:10034`　**模块**：Canvas 无限画布（src/App.tsx CanvasPage）

**机制**：handleCanvasOptimize 成功后执行 setSelectedNodeId(nodeId)（10034，注释写的是 'Auto-select new node for chaining'），但既没有把 optimizeSourceNode 切到新节点，也没有重新压缩新节点的图更新 compressedRef。面板仍停在 optimize 模式，handleCanvasOptimize（9914-9917）读的还是旧的 optimizeSourceNode / compressedRef。于是第二次点「生成优化」生成的是原父节点的又一个兄弟分支（parentId = 老父节点、edge 也从老父节点出发），用的参考图和拼接进 prompt 的「原始描述」都是上一代的。docs/canvas-mode-prd.md §4.2 第 8 条要求「用户可以继续基于新图再次优化（链式迭代）」。

**复现**：选中图 A → 优化「改成夜景」→ 生成出 B 并自动选中 → 不做任何操作，直接在补充提示词里输入「再加雪」→ 点「生成优化」→ 生成出的 C 是 A 的子节点（连线 A→C），参考图是 A 而不是 B，夜景效果丢失。

> 验证修正：选中图 A → 点「优化」进入优化面板 → 输入「改成夜景」→ 点「生成优化」→ 生成 B，B 被自动选中（10034），但面板仍停在优化模式且参考图预览/原始提示词仍是 A。注意：optimizePrompt 也未被清空，输入框里仍是「改成夜景」。此时把补充提示词改成「再加雪」→ 再点「生成优化」→ 产出的 C 的 parentId 是 A、连线 A→C、参考图是 A 的压缩图、prompt 里拼接的「原始描述」是 A 的 prompt，B 的夜景结果完全没有参与，链式迭代失效。（原描述中「不做任何操作直接输入」略有出入：输入框内容不会自动清空，但不影响缺陷成立。）


#### 20. enterOptimizeMode 无请求令牌，快速切换节点会把 A 的参考图配到 B 的提示词上

**位置**：`src/App.tsx:9791`　**模块**：Canvas 无限画布（src/App.tsx CanvasPage）

**机制**：enterOptimizeMode 同步 setOptimizeSourceNode(node) 之后再 await loadCanvasImageFromDB → blobToDataUrl → createSquareThumbnail（1024px 重编码，几百毫秒级），最后无条件 setCompressedRef（9805）。整个过程没有任何 requestId / cancelled 守卫。若用户先后对两个节点进入优化模式，而先发起的那次压缩后完成，它的 setCompressedRef 会覆盖后发起的结果，此时 optimizeSourceNode 是 B、compressedRef 是 A 的图，两者不匹配，且面板的参考图预览显示的就是 A 的图，用户点「生成优化」直接产出错误参考的结果。

**复现**：画布上有两张分辨率差异较大的图 → 双击大图 A 进入优化（压缩慢）→ 立刻双击小图 B → B 的压缩先完成，A 的后完成并覆盖 → 面板标题/原始提示词是 B、参考图预览却是 A → 点生成优化，得到基于 A 的结果。

> 验证修正：画布上先生成一张 4K/大尺寸图 A 和一张 1K 及以下的小图 B（B 最长边 ≤1024 时 createSquareThumbnail 走早返回，几乎零耗时）→ 双击 A 进入优化模式（面板显示"压缩参考图中..."）→ 不按 Esc、不点画布空白，直接双击 B（onDoubleClick 不校验 panelMode，会再次进入）→ B 的压缩先完成写入 compressedRef，A 的压缩随后完成并在 9805 无条件覆盖 → 面板此时"原始提示词"是 B、参考图预览是 A → 点"生成优化"，请求体里 prompt 用 B、referenceImages 用 A，新节点连线也连到 B。


#### 21. 删除生成中的节点会在 canvas-images 留下永不回收的孤儿 blob，并泄漏 objectUrl

**位置**：`src/App.tsx:9758`　**模块**：Canvas 无限画布（src/App.tsx CanvasPage）

**机制**：confirmDeleteNode（9758-9773）在删除时调用 deleteCanvasImageFromDB(id)，但对 status='generating' 的节点，此时 blob 还没写进去；之后 in-flight 的 handleCanvasGenerate 成功分支照常执行 URL.createObjectURL(blob) 和 await saveCanvasImageToDB(nodeId, blob)（9902），把 blob 写进 canvas-images。由于节点已从 canvasNodes 移除，这条 blob 再也没有任何入口能删除它（只有 confirmDeleteNode 会调 deleteCanvasImageFromDB，且没有任何按 canvas-state 做孤儿清理的逻辑），对应的 objectUrl 也不会被 revoke（卸载清理只遍历 nodesRef.current）。反复操作会持续吃 IndexedDB 配额，进而触发上面第 4 条的写失败问题。

**复现**：点「生成到画布」→ 在骨架屏还在转时点中该节点按 Delete → 确认删除 → 等生成请求返回 → canvas-images 里多出一条永远不会被清理的完整图片 blob（可在 DevTools > Application > IndexedDB > canvas-images 看到条目数比画布节点数多）。

> 验证修正：进入 #canvas → 右侧面板输入提示词点「生成」→ 骨架屏（"生成中..."）还在转时用鼠标点中该节点（注意：此时悬浮工具栏不会出现删除按钮，因为工具栏只在 status 为 success/error 时渲染，必须走键盘路径）→ 按 Delete 或 Backspace 键 → 在确认弹窗点「删除」→ 等待该次生成请求返回 → 打开 DevTools > Application > IndexedDB > canvas-images，会看到一条以已删除 nodeId 为 key 的完整图片 blob，画布上无对应节点，刷新页面后该条目依然存在且再无任何代码路径能删除它。同一缺口也可用「优化中删除节点」（10032）或「重试中删除节点」（10118）复现。


#### 22. OAuth 管理员进入后台后概览页全空：广场接口不认 OAuth 会话，Promise.all 又把三个请求耦合成一体

**位置**：`vite.config.ts:877`　**模块**：Square 广场 + Admin 管理后台

**机制**：getSquareAdminAuth 只调用 getAdminSession(req)（密码会话），完全不认 getOAuthSession；而 /api/admin/* 主路由在 4302-4306 行明确支持 `isOauthAdmin = oauthSession != null && oauthSession.role >= 10`，/api/admin/me 也会给 OAuth 管理员返回 200。于是 OAuth 管理员能进后台，但 /api/square/admin/overview 恒定 401。前端 refreshDashboard 把 stats、requests、square/overview 放进同一个 `await Promise.all([...])`（src/App.tsx:8640-8644），任何一个 reject 都会让整个 await 抛出，后面的 `if (statsPayload) setStats(...)` 永远执行不到。所以不是「广场那块显示不了」，而是整个概览页（生图请求数、成功率、P50/P95、模型分布、常见失败、链路环节、每日趋势）全部保持初始 0/空。

**复现**：部署时在 .env 配好 OAUTH_CLIENT_ID/OAUTH_CLIENT_SECRET，用 role>=10 的太极账号登录，然后访问 /#admin。refreshMe 成功进入后台界面 → refreshDashboard 里 squareAdminFetch("/overview") 返回 401 {ok:false,error:"未登录"} → Promise.all reject → setStats 从未被调用。概览页所有卡片恒为 0，顶部持续显示「未登录」错误，且每 10 秒轮询复现一次。切到「请求日志」tab 才有数据（wantOverview=false 时不请求 overview）。

> 验证修正：前提：.env 配置 OAUTH_CLIENT_ID/OAUTH_CLIENT_SECRET 使 OAUTH_ENABLED=true（vite.config.ts:308），用 role>=10 的太极账号完成 OAuth 登录（仅写入 imagehub_oauth_session cookie，vite.config.ts:4251-4258）。步骤：访问 /#admin → AdminApp 挂载调用 refreshMe → GET /api/admin/me 走 isOauthAdmin 分支返回 200（vite.config.ts:4304/4337/4350）→ user 被 setUser，进入后台界面，adminTab 默认 "overview"（App.tsx:8456）→ 触发 refreshDashboard（App.tsx:8488）→ Promise.all 中


#### 23. GET /api/square/quota 无条件全量重写 square-store.json

**位置**：`vite.config.ts:3415`　**模块**：Square 广场 + Admin 管理后台

**机制**：handleSquareQuota 是纯查询接口（req.method 必须为 GET），但它调用 getSquareQuota(store, apiKeyHash) —— 该函数在找不到当日配额记录时会 store.quotas.unshift(新记录) —— 随后无条件执行 writeSquareStore(store)（3415 行），即使本次调用没有产生任何新记录也照样把整个 store（含全部 items 的 base64 thumbnailDataUrl）序列化回磁盘。这个写没有任何条件判断，也没有和「确实新建了配额行」挂钩。配合上一条 finding 的 store 体积问题，一个只读接口成了最重的写路径。

**复现**：配置好 API Key 后打开 /#square：SquarePage 的 useEffect（src/App.tsx:11035-11041，deps [tab, apiKey]）调用 fetchQuota() → GET /api/square/quota → 服务端全量重写 .data/square-store.json。之后每切换一次 feed tab（latest/hot/top_day/…）触发一次，每点一次赞后 toggleLike 末尾的 void fetchQuota() 再触发一次。用 fs.watch 或 stat 观察该文件 mtime，可见纯浏览行为持续引发全量写盘。

> 验证修正：前提：.data/square-store.json 中已有若干推荐条目（每条含 base64 thumbnailDataUrl）。1) 在应用中配置 API Key（长度 >= API_KEY_MIN_LENGTH，使 src/App.tsx:10990 的 apiKeyReady 为 true）；2) 打开 /#square —— src/App.tsx:11035-11041 的 useEffect 调用 fetchQuota() → GET /api/square/quota（带 x-imagehub-api-key 头）；3) 服务端 vite.config.ts:3402 handleSquareQuota 读取整个 store，getSquareQuota 命中当日已存在的配额行（未做任何修改），随后 vite.config.ts:3415 无条件 writeSquareSt


#### 24. Admin tab 深链只在挂载时读一次 hash，浏览器前进/后退导致 URL 与界面不同步

**位置**：`src/App.tsx:8456`　**模块**：Square 广场 + Admin 管理后台

**机制**：adminTab 用 useState 惰性初始化从 window.location.hash 读一次（8456-8460 行），selectAdminTab 会写 window.location.hash（8463 行），但 AdminApp 内部没有注册任何 hashchange 监听。App 顶层的 hashchange 监听（3796-3801 行）只做 setActivePage(pageFromHash())，而 pageFromHash 对 #admin、#admin/logs、#admin/config 一律返回 "admin"（1608 行 startsWith 判断），activePage 值不变、AdminApp 不重挂载，adminTab 因此永远停在用户最后一次点击的值。写 hash 的行为还会往 history 里塞条目，让后退键看起来「应该」切回上一个 tab。

**复现**：进入 /#admin（概览）→ 点「请求日志」（URL 变 #admin/logs）→ 点「接口配置」（URL 变 #admin/config）→ 按浏览器后退键。URL 回到 #admin/logs，但界面仍停留在接口配置页；再按一次后退到 #admin，界面还是接口配置页。此时把 URL 复制给同事或按 F5 刷新，又会跳到请求日志 tab —— 分享出去的链接和自己屏幕上看到的内容对不上。

> 验证修正：登录 /#admin（概览）→ 点「请求日志」（URL 变 #admin/logs，push 一条 history）→ 点「接口配置」（URL 变 #admin/config，再 push 一条）→ 按浏览器后退键。hashchange 触发但 pageFromHash() 仍返回 "admin"（src/App.tsx:1608 的 startsWith），setActivePage 传入相同值被 React bailout，AdminApp 不重挂载，adminTab 仍为 "config"（8833 行继续渲染 AdminConfigCenter）。结果：URL 显示 #admin/logs，界面停在接口配置；再按一次后退到 #admin，界面依旧是接口配置。此时按 F5 或把 URL 发给同事，会落到「请求日志」tab，与刚才屏幕上看到的内容不一致。（唯一需要澄清的细节：tab 为


#### 25. 参数校验/配额 429 被计入模型失败率，直接污染 studio 模型选择器展示给用户的成功率

**位置**：`vite.config.ts:3968`　**模块**：后端 API 与数据层（vite.config.ts registerApiRoutes + server/index.ts）

**机制**：generate 路由的 `failFast`（5146 行）在 createRequestLog 之后触发，会把"模型和提示词不能为空""所选模型不在允许列表中""API Key 不能为空""今日生成次数已达上限""图片存储空间已达上限"统统写成 `status:"error"` 且带着用户填的 `model` 字段。`/api/model-stats` 的 SQL 只按 `request_type='image_generation' AND created_at >= since` 取数，不区分 errorType，于是这些从未打到上游的请求被算作该模型的失败样本；同一份数据也经 `bumpDailyStats`（1212 行，updateRequestLog 的 running→终态守卫会放行 failFast）进入 daily_stats，进而污染 /api/admin/stats 的 daily.successRate 和头部 successRate。代码在 requestLogRow（1243 行）计算 `upstream_responded` 时特意排除了 `errorType !== "validation_error"`，说明作者意识到了这一点，但成功率口径没同步。

**复现**：管理员在"系统设置"里把 generationDailyLimit 设为 10 → 某用户当天点 30 次生成，前 10 次成功、后 20 次被 429 拦下 → /api/model-stats 对该模型统计出 samples=30、successRate=33.3% → 所有用户在 studio 模型下拉里看到该模型"成功率 33.3%"，管理后台概览当日成功率同样显示 33.3%，而模型本身 100% 成功。

> 验证修正：1) 管理员在后台“系统设置”把 每用户每日生成上限 设为 10（src/App.tsx:8423 → PUT /api/admin/config/quotas，vite.config.ts:4683）。\n2) 同一 clientId 当天对模型 M 点击生成 30 次：前 10 次真实成功；第 11 次起 vite.config.ts:5183 的 usedToday >= 10 成立（该 COUNT 统计当日全部 image_generation 记录，含被拦下的），走 failFast(429)，共写入 20 条 status='error'、errorType='validation_error'、model=M、request_type='image_generation' 的记录。\n3) GET /api/model-stats（vite.config.ts:3966）对 


#### 26. 上游返回的图片 URL 被服务器无校验直接 fetch，绕过 validateUpstreamBaseUrl 的内网封锁

**位置**：`vite.config.ts:1870`　**模块**：后端 API 与数据层（vite.config.ts registerApiRoutes + server/index.ts）

**机制**：`readOpenAiImageResponse`（2919 行）在 `data[].b64_json` 缺失、只有 `data[].url` 时调用 `urlToDataUrl(record.url)`，该函数是裸 `fetch(url)`：不校验协议/主机（INTERNAL_HOST_PATTERN 完全没参与）、不设超时（其余所有上游调用都走 fetchWithTimeout）、不限响应体大小（`Buffer.from(await response.arrayBuffer())` 全量入内存）。取回的字节被 base64 成 dataUrl，随后经 persistGeneratedImages 落盘到 `.data/images/<userDir>/`，并把本地 URL 返回给浏览器。CLAUDE.md 明确写着 validateUpstreamBaseUrl 里的内网/回环/169.254 云元数据封锁是"仅存的刻意 SSRF 约束"，这条路径把它整个绕开了。

**复现**：白名单中任意一个中转站（或被入侵/伪造响应的中转站）对 /v1/images/generations 返回 `{"data":[{"url":"http://169.254.169.254/latest/meta-data/iam/security-credentials/"}]}` → 服务器发起对云元数据端点的请求，把返回内容当作图片 base64 化，写入 .data/images/ 并作为 /api/images/local/... 回给浏览器；换成一个永不响应的 URL 则该次生成请求长时间挂住且日志停留在 running。

> 验证修正：前提：管理端白名单中的某个中转站返回恶意/异常响应（中转站被攻陷、由攻击者运营，或其返回的图片 URL 发生 302 重定向到内网）。用户端无法直接触发，因为 baseUrl 走 normalizeAllowedApiBaseUrl(vite.config.ts:1058) 精确白名单。

A. 内网读取（可回显）：
1) 前端在 Studio 正常发起一次生成，POST /api/images/generate（vite.config.ts:5064），protocol 为默认 OpenAI 兼容分支 → generateOpenAiCompatible(3067) → fetchWithTimeout(3142) → readOpenAiImageResponse(2919)。
2) 上游对 /v1/images/generations 返回 200 + {"data":[{"url"


### LOW（5 条）

#### 28. JobPulseLine 把上游返回的生成失败错误标记在「图片落盘」段，失败定位指向错误环节

**位置**：`src/App.tsx:11594`　**模块**：Studio 工作台（src/App.tsx 生成队列 / 提示词分析倒计时 / 参考图 / 历史与删除 / 首页入口联动）

**机制**：后端在上游失败分支返回的 stages 是 `{receivedAt, upstreamRequestedAt, upstreamRespondedAt}`（vite.config.ts:5262、5266），imageSavedAt / returnedAt 缺失。JobPulseLine 用 `segments.findIndex((seg) => seg.ms === null)` 定位失败段（src/App.tsx:11594），此时 recv 段和 gen 段都算得出耗时，第一个 null 是索引 2 的 save（「图片落盘」），于是红色断点画在落盘段上。而这类失败实际发生在上游生成环节，落盘根本没被执行过。这个脉冲线的设计目的正是「失败时停在断掉的那一段」（src/App.tsx:11570 注释），当前实现在最常见的失败类型上给出的是错误结论。

**复现**：用一个会对生成请求返回 4xx/5xx（且带 JSON 错误体）的上游提交一次生成 → 失败卡片底部的脉冲线红色段落在第三段「图片落盘」，hover 的 title 只列出「接收→请求上游 / 上游生成」两段耗时，运维照着这条线会去排查落盘/磁盘问题，而真实故障点在上游。

> 验证修正：1) 在管理后台配置一个会对 /v1/images/generations 返回 4xx/5xx 且带 JSON 错误体的上游站点（最简单的复现：填一个格式合法但无效的 API Key，让上游返回 401 {"error":{...}}）。2) 在 Studio 提交一次生成。3) 请求走 vite.config.ts:3150 readOpenAiImageResponse → 返回 {ok:false}（不抛异常）→ 5246 错误分支 → 5265 行响应 stages 只含 receivedAt/upstreamRequestedAt/upstreamRespondedAt。4) 失败卡片底部脉冲线渲染为：第 1、2 段绿色（接收→请求上游、上游生成），第 3 段「图片落盘」红色，第 4 段「返回」不渲染。5) hover 该脉冲线，title 只列出前两段耗时，红色那段无耗时。实


#### 29. isGenerating 是全局单标志，任一并发生成/重试结束就把面板按钮解禁，且违背 PRD 的不阻塞要求

**位置**：`src/App.tsx:9812`　**模块**：Canvas 无限画布（src/App.tsx CanvasPage）

**机制**：handleCanvasGenerate / handleCanvasOptimize / retryNode 共用同一个 isGenerating，且都在 finally 里无条件 setIsGenerating(false)。一方面「生成到画布」按钮 disabled 包含 isGenerating（10514），与 docs/canvas-mode-prd.md §12.3「右侧面板在生成中不阻塞——用户可以继续输入新的提示词发起新的生成」相反；另一方面 textarea 的 Enter 提交路径（10441-10445 → handleCanvasGenerate，函数内只校验 prompt/model/modelState，不校验 isGenerating）能绕过禁用发起并发请求，此时先完成的那一个会把标志清零，按钮从「生成中...」变回「生成到画布」，剩下的请求仍在跑但界面显示空闲。retryNode 也会禁用整个面板的生成按钮，哪怕重试的是一个不相干的节点。

**复现**：输入提示词按 Enter → 立刻再输入第二段提示词按 Enter（Enter 路径不检查 isGenerating）→ 两个节点同时生成 → 第一个返回后按钮立即恢复可点、文案变回「生成到画布」，而第二个仍在生成中；或：点某个失败节点的「重试」，此时右侧面板的生成按钮被整体禁用，无法发起新生成。

> 验证修正：位置更正：isGenerating 声明在 src/App.tsx:9341（非 9812）；Enter 提交路径在 src/App.tsx:10426-10431（非 10441-10445，那里是宽高比 select）。\n\n复现 A（并发导致状态错乱）：进入 #canvas，配置好 API 与模型使 modelState.status === \"ready\" → 在右侧面板提示词 textarea 输入 A 按 Enter（10427 命中 → 10429 调用 handleCanvasGenerate；9814 的守卫不含 isGenerating 所以放行；9851 清空输入框）→ 立刻输入 B 再按 Enter → 第二次调用同样通过 9814 放行，两个节点并发生成 → 先返回的那个在 9909 执行 setIsGenerating(false) → 按钮（10511/


#### 30. 空格键抬起丢失后画布永久卡在平移模式，节点无法选中

**位置**：`src/App.tsx:9740`　**模块**：Canvas 无限画布（src/App.tsx CanvasPage）

**机制**：isSpaceHeld 只由 window 的 keydown/keyup 维护（9718、9740-9741），没有 window blur / visibilitychange 兜底重置。按住空格期间切换窗口（Cmd+Tab、点击别的应用、浏览器弹出下载框等）后 keyup 落在别的窗口，isSpaceHeld 永远停在 true。此时 handleNodePointerDown 首行 `if (isSpaceHeld || e.button !== 0) return;`（9677）导致所有节点点不中、拖不动，左键点画布任意位置都变成平移（handleCanvasPointerDown 的 `e.button === 0 && isSpaceHeld` 分支），光标一直是 grab。

**复现**：在画布上按住空格开始拖动 → 保持空格按住的同时 Cmd+Tab 切到别的应用 → 松开空格 → 切回浏览器 → 点击任何节点都无法选中，左键拖动只会平移画布，必须再单独按一次空格并松开才恢复。

> 验证修正：1. 进入 #canvas 页面，画布上至少有一个节点，焦点不在任何 input/textarea/select 上。2. 按住空格键（此时 src/App.tsx:9699 置 isSpaceHeld=true，光标变 grab），可拖动平移。3. 保持空格按住的同时 Cmd+Tab 切换到另一个应用（或任何导致窗口失焦的操作：点击别的窗口、浏览器弹出下载/权限框）。4. 在别的应用中松开空格 —— keyup 不会到达本页面，src/App.tsx:9741 永远不执行。5. 切回浏览器：光标仍是 grab；左键点击任意节点无法选中（9677 提前 return 且未 stopPropagation，事件冒泡后走 9626 的平移分支）；左键拖动只平移画布；右侧面板无法进入优化模式。6. 只有再单独按一次空格并在本窗口内松开，才会恢复正常。


#### 31. 触屏设备完全无法平移和缩放画布（touch-action: none + 平移仅绑定中键/右键/空格）

**位置**：`src/App.tsx:9615`　**模块**：Canvas 无限画布（src/App.tsx CanvasPage）

**机制**：handleCanvasPointerDown 只在 `e.button === 1 || e.button === 2 || (e.button === 0 && isSpaceHeld)`（9620）时进入平移分支；触摸的 pointerdown 恒为 button 0 且无键盘空格，所以永不触发平移。缩放只走 wheel（9577，需要 ctrlKey/metaKey 才是缩放），触屏没有 wheel 事件也没有任何 pinch/双指手势处理。同时 styles.css:7887 给 .canvas-viewport 设了 touch-action: none，把浏览器原生的滚动/缩放也一并禁掉了。而 styles.css:8530-8548 存在 max-width:768px 的移动端布局（面板改成抽屉），说明移动端在预期范围内。结果是手机/平板上画布视口被死锁在初始位置，只能拖动单个节点。

**复现**：手机或平板打开 #canvas（或桌面 DevTools 切到触摸模拟）→ 单指、双指在画布上任意拖动/捏合 → 视口完全不动，也无法缩放，超出首屏的节点永远看不到（缩放条按钮可用但没有平移手段）。

> 验证修正：触屏设备（手机/平板，或桌面 DevTools 开启触摸模拟并禁用鼠标）打开 #canvas → 生成 2 个以上节点或用 +/滑块放大到 150% 以上 → 用单指或双指在画布空白处拖动 → 视口纹丝不动（src/App.tsx:9620 的按键守卫拦死平移，styles.css:7887 的 touch-action:none 又关掉了浏览器原生滚动，App.tsx 全文无任何 touch/pinch 处理代码）。唯一能改变视野的手段是右下缩放条的 -/+、滑块和"适应全部节点"按钮（App.tsx:10333-10347），即只能整体缩放和一键 fit，无法把视口平移到任意指定位置；小地图因为默认关闭且只能用键盘 m 键切换（App.tsx:9348 / 9719），触屏用户也打不开。注意：节点本身仍可单指拖动（App.tsx:9678），所以页面表面上"有反应"，容易误判为正常。


#### 32. prompt/analyze 首字节回调把已记录的上游请求体抹掉（与注释意图相反）

**位置**：`vite.config.ts:4832`　**模块**：后端 API 与数据层（vite.config.ts registerApiRoutes + server/index.ts）

**机制**：`updateRequestLog(requestId, { upstreamRequest: undefined as never })` 注释写的是"留空，避免覆盖之前 sanitizeForLog 写入的内容"，但 updateRequestLog（1295 行）的实现是 `const merged = { ...current, ...patch }`——展开 `{upstreamRequest: undefined}` 会把 merged.upstreamRequest 覆盖成 undefined，随后 requestLogRow 的 `JSON.stringify(log)` 直接把该键丢弃。结果恰好是它想避免的：analyzePromptWithGpt 早先写入的上游 payload 被清空。

**复现**：在 studio 触发一次"AI 优化提示词"（走 /api/prompt/analyze，上游正常流式返回，onFirstByte 一定会触发）→ 进管理后台 → 请求日志 → 打开这条 prompt_analysis 记录 → "上游请求"面板为空；而同样走 analyze 但上游第一字节前就失败的记录反而能看到完整 upstreamRequest，排查时无法对照。

> 验证修正：在 studio 触发一次"AI 优化提示词"（POST /api/prompt/analyze，上游 /v1/chat/completions 正常流式返回）→ 进 http://localhost:8877/#admin → 请求日志 → 打开该条 prompt_analysis 记录 → "上游请求"面板不是空的，而是退化成兜底摘要，只剩 `{ endpoint: "/v1/chat/completions", payloadKeys: ["model","messages","temperature","response_format","stream"], ... }`；真正的 payload 正文（messages 里的 systemPrompts.promptAnalyze 原文与序列化 context、temperature、response_format）已被抹除。对照组

