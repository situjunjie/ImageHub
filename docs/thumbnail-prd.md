# 缩略图方案（Thumbnail PRD）

> 状态：方案待评审，未实施。
> 目标：生成成功后自动产出缩略图；列表只显示缩略图，点击才加载原图。
> 依据：全网方案调研（2026-07-25）+ 本项目 16 个图片渲染点的全量代码盘查。

---

## 〇、一个决定方案走向的发现

调研前的直觉是「服务端用 sharp 生成缩略图」。**盘查代码后这个方向被推翻了。**

本项目是 local-first 的：Studio 画廊、历史侧栏、Canvas 节点的图片**全部来自浏览器 IndexedDB 的 Blob**（`URL.createObjectURL`），根本不经过服务端。

| 渲染点 | 图片来源 | 服务端缩略图能否生效 |
|---|---|---|
| Studio 主画廊 | IndexedDB Blob → objectUrl | ❌ 不走服务端 |
| Studio 历史侧栏 | IndexedDB Blob → objectUrl | ❌ 不走服务端 |
| Canvas 节点 | IndexedDB Blob → objectUrl | ❌ 不走服务端 |
| 首页最近生成 | IndexedDB Blob → objectUrl | ❌ 不走服务端 |
| Square feed | `/api/square/image/:id` | ✅ 已经是缩略图 |
| Admin 日志详情 | `/api/images/local/...` | ✅ 唯一受益点 |

**结论：sharp 只能解决 16 个渲染点中的 1 个。** 引入一个原生依赖（连带部署面变更、glibc/musl 兼容、锁文件跨平台风险）只为覆盖管理后台一处，性价比不成立。

正确做法是**在客户端生成一次缩略图，同时喂给两端**——这恰好是广场功能已经跑通的模式。

---

## 一、方案调研

### 1.1 服务端库对比（若走服务端路线）

| 库 | 性能 | 依赖 | 结论 |
|---|---|---|---|
| **sharp** | 基准最快（比 squoosh-cli 快 ~25×，比 jimp 快 ~40×），libvips 原生 | 原生模块，预编译二进制 | 性能最优，但引入部署面 |
| **jimp** | 纯 JS，比 sharp 慢 10–30× | 零原生依赖 | 小图尚可，批量不行 |
| **@squoosh/lib** | 编码器质量最好（WebP/AVIF/JPEG-XL） | 无流式 API，缺通用变换 | 不适合本场景 |

sharp 是 Next.js `next/image` 的底层，周下载量 900 万+，是服务端路线的唯一合理选择。

### 1.2 前端最佳实践共识

- **格式**：AVIF 比 WebP 再省 40–50%，但浏览器支持约 75%；WebP 近乎全支持。缩略图选 **WebP**，兼容性与体积平衡最好。
- **懒加载**：首屏以下一律 `loading="lazy"`，首屏图片不要 lazy（伤 LCP）。
- **占位**：用 `aspect-ratio` 预留尺寸，避免 CLS。
- **核心原则**：*不要把 3000px 的图塞进 300px 的框*——这正是本项目当前最严重的浪费。

### 1.3 参考实现

`sharpthumb`、`express-sharp`、`image-thumb` 等自建缩略图服务的共同模式是「按需生成 + 磁盘缓存」。本方案借鉴其**懒生成兜底**思路用于历史数据回填，但不采用其在线 resize 架构（本项目图片总量小，预生成更简单）。

---

## 二、当前浪费有多大（实测）

`.data/images` 实测：**7 个文件 24.34MB，平均 3.48MB/张**，全部为 PNG。

| 渲染点 | 显示框尺寸 | 当前加载 | 浪费倍数 |
|---|---|---|---|
| Studio 历史侧栏 | **48×48** | 3.48MB 原图 | **~437×** |
| Studio 主画廊 | 220×220 | 3.48MB 原图 | ~40× |
| Canvas 节点 | 280×(比例) | 3.48MB 原图 | ~30× |
| Admin 日志详情 | ~120px | 3.48MB 原图 | ~100× |

**首屏代价**：Studio 一次加载 20 条历史（`HISTORY_PAGE_SIZE = 20`），即约 **70MB** 的 Blob 解码进内存，只为渲染 20 个 48px 的方块。

---

## 三、方案选型

### 方案 A：客户端生成（推荐）✅

生成成功后，前端在已有的 `generatedImageToBlob` 之后追加一步 `createThumbnail`，产出的缩略图：
1. 存进 IndexedDB（供 Studio/Canvas/首页所有本地列表用）
2. 随请求 POST 给服务端（供 Admin 用）

| 维度 | 评价 |
|---|---|
| 新依赖 | **零** —— 复用已有的 `createSquareThumbnail`（`src/App.tsx:2488`） |
| 部署改动 | **零** —— package.json / build:server / deploy.sh / 部署机全不动 |
| 覆盖渲染点 | 16 个中的全部需要项 |
| 与现有架构一致性 | 高 —— 广场推荐链路（客户端产图 → 服务端只存 → 二进制路由带缓存）已跑通一年 |
| 历史数据 | 需回填（见 §六） |
| 风险 | 低，可整体回滚 |

### 方案 B：服务端 sharp 生成

| 维度 | 评价 |
|---|---|
| 新依赖 | sharp（原生模块） |
| 部署改动 | package.json dependencies + `build:server` 加 `--external:sharp` + deploy.sh 提示文案 |
| 覆盖渲染点 | **仅 Admin 一处**（其余不走服务端） |
| 部署风险 | glibc < 2.28 会退化为源码编译；Alpine/musl 需要专用变体；锁文件跨平台 optional 包必须齐全 |
| 隐藏耦合 | **后端代码全在 `vite.config.ts` 里，而 `npm run build` 必然加载它**——顶层 `import sharp` 一旦安装损坏，前端构建和 `npm run dev` 会一起挂 |
| 独有价值 | 服务端权威、可回填历史、不信任客户端 |

### 结论

**采用方案 A**，理由是覆盖面 16:1 且零部署风险。

若将来出现「必须服务端权威」的需求（如管理员要看到客户端从未上传过的历史图缩略图），再按 §七 的降级设计追加 sharp，届时必须用**函数内动态 `await import("sharp")` + try/catch**，绝不能写在 `vite.config.ts` 顶层。

---

## 四、渲染点全量清单（本需求的核心交付）

全项目 `<img>` 共 21 处，其中 5 处是静态 logo。真正渲染图片的 16 处如下——**只有标 ✅ 的用缩略图**。

### ✅ 改为缩略图（5 处）

| # | 位置 | 组件/行号 | 数据源 | 显示尺寸 |
|---|---|---|---|---|
| ① | **Studio 主画廊** | `JobCard` [App.tsx:11708](../src/App.tsx#L11708) | `job.imageUrl` | 220×220（移动 168） |
| ③ | **Studio 历史侧栏** | [App.tsx:6846](../src/App.tsx#L6846) | `record.objectUrl` | **48×48** ← 收益最高 |
| ⑥ | **Canvas 画布节点** | `CanvasNodeView` [App.tsx:9298](../src/App.tsx#L9298) | `node.objectUrl` | 280×比例 × zoom |
| ⑪ | **首页「最近生成」** | [App.tsx](../src/App.tsx) `.home-recent-card` | `record.objectUrl` | 128×128 |
| ⑬ | **Admin 日志详情** | [App.tsx:9162](../src/App.tsx#L9162) | `/api/images/local/${id}` | ~120px |

### ❌ 必须保持原图（2 处）

| # | 位置 | 行号 | 原因 |
|---|---|---|---|
| ④ | **全屏预览 Lightbox** | [App.tsx:12426](../src/App.tsx#L12426) | 用户就是来看细节的 |
| ⑩ | **Square 详情弹窗** | `SquarePreviewModal` | 同上（受限于广场只存 1024px） |

> ⚠️ **④ 是本方案最大的坑**：`previewCurrent` 目前直接复用列表那份 URL（`const url = (item as Job).imageUrl || (item as HistoryRecord).objectUrl`，[App.tsx:6597](../src/App.tsx#L6597)）。一旦 ① 改成缩略图 objectUrl，**Lightbox 会静默变糊**。必须为 Job / HistoryRecord 增加独立的原图字段，见 §五。

### ⭕ 已经是缩略图 / 不在范围（9 处）

| # | 位置 | 说明 |
|---|---|---|
| ② | JobCard 参考图角标 | 已用 `createReferenceThumbnail(160)`，22×22 |
| ⑤ | Lightbox 提交的参考图 | 已是发给上游的压缩版（≤512KB/1536px） |
| ⑦ | Canvas 小地图 | 纯色方块，不含 `<img>` |
| ⑧ | Canvas 优化面板参考图 | 已是 `createSquareThumbnail(1024)` |
| ⑨ | Square feed 卡片 | 已是 1024px WebP，**但 248px 框仍偏大**，可选优化 |
| ⑫ | 首页灵感瀑布流 | 同 ⑨，复用广场缩略图 |
| ⑭ | 参考图上传预览 | 已用 `createReferenceThumbnail(160)` |
| ⑮ | Agent 画册页预览 | 无独立组件，随 ① 一起受益 |
| ⑯ | `HistoryDetail` | **死代码**，无渲染路径，忽略 |

---

## 五、技术设计

### 5.1 缩略图规格

| 参数 | 值 | 依据 |
|---|---|---|
| 最长边 | **512px** | 覆盖最大列表框（220px）的 2× DPR；48px 侧栏共用同一张即可，不做第二档 |
| 格式 | **WebP**，失败降级 PNG | 近乎全支持；沿用 `createSquareThumbnail` 既有降级逻辑 |
| 质量 | **0.78** | 略高于广场的 0.82 之下，512px 下肉眼无损 |
| 预估体积 | **40–60KB** | 相对 3.48MB 原图约 **1.5%** |
| 比例 | **等比缩放，不裁剪** | 用户明确要求「保持图片的比例」 |

### 5.2 数据模型变更

**IndexedDB**（`history` store，`StoredHistoryRecord`）新增两个可选字段——**不需要升版本号**，IndexedDB 无 schema 约束：

```ts
thumbBlob?: Blob;     // 512px WebP
thumbWidth?: number;  // 供 aspect-ratio 占位，消除 CLS
thumbHeight?: number;
```

`toHistoryRecord` 同时产出两个 objectUrl：

```ts
objectUrl?: string;      // 原图（保留，Lightbox 用）
thumbUrl?: string;       // 缩略图（列表用）
```

**服务端**（`SavedImageMeta`）新增可选字段——**不需要 SQLite DDL 变更**，`savedImages` 整体序列化在 `data` TEXT 列里：

```ts
type SavedImageMeta = {
  id: string; mime: string; bytes: number;
  thumbId?: string;      // <userDir>/<requestId>-thumb.webp
  thumbBytes?: number;
};
```

> ⚠️ **绝不能把缩略图作为新元素塞进 `savedImages` 数组**——该数组长度被当作「生成图片张数」用于 `image_count` 列（[vite.config.ts:1271](../vite.config.ts#L1271)）和 `bumpDailyStats` 的 `images` 累加（[vite.config.ts:1237](../vite.config.ts#L1237)），会导致统计翻倍。

### 5.3 命名与路径约束

缩略图文件名必须是 **`<userDir>/<requestId>-thumb.webp`**（与原图同级目录）。

原因：`LOCAL_IMAGE_PATH_PATTERN`（[vite.config.ts:300](../vite.config.ts#L300)）只允许**恰好一层**用户目录：

```
/^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.-]{1,120}\.(png|jpg|webp|gif)$/
```

放 `<userDir>/thumbs/<id>.webp`（两层）会被这条正则拒绝，且 `userDiskLimitMB` 的配额统计用的是**非递归** `readdirSync`，子目录内容不会被计入配额，导致配额失真。同目录 `-thumb.webp` 命名天然通过正则、天然计入配额。

### 5.4 原图不可用时的行为（**硬性要求：绝不用缩略图充数**）

**原则：全屏预览要么显示原图，要么显示明确的错误态。任何情况下都不允许把缩略图当作最终画质呈现给用户。**

这条是本方案的安全底线——生图工具的核心动作就是「点开看细节」，静默给一张糊图等于让用户基于错误信息做判断（误判成片质量、误删好图）。

#### 加载三态

| 态 | 显示 | 说明 |
|---|---|---|
| **加载中** | 缩略图作底 + 顶部进度条 + 明确文案「正在加载原图…」 | 缩略图仅作过渡占位，**必须伴随可见的加载指示**，避免被误认为最终画质 |
| **成功** | 原图，移除一切指示 | — |
| **失败** | **立即清除缩略图**，显示错误态 | 见下表 |

> 若认为过渡期的模糊仍不可接受，把加载态的缩略图底图去掉即可（改为纯 spinner），其余逻辑不变。

#### 失败原因与文案（按原因分流，不要笼统报「加载失败」）

| 原因 | 判定方式 | 文案 | 操作按钮 |
|---|---|---|---|
| 服务端图片已被清理 | `fetch` 返回 **404** | 「原图已被服务器清理（日志超过 5000 条时会自动清理最早的图片）」 | 「下载缩略图」 |
| 本地图片数据丢失 | IndexedDB 无 `imageBlob` 且无服务端 URL | 「本地图片数据已丢失，可能是浏览器清理了存储」 | 「重试」 |
| 网络/服务异常 | `fetch` 抛错或 5xx | 「原图加载失败（HTTP xxx）」 | 「重试」 |
| 记录本身是失败任务 | `status !== "success"` | 沿用现有失败详情面板 | — |

错误态按 design-refresh §4.2 的空状态规范：统一插画位 + 一句话 + 一个动词按钮，禁止「暂无数据」这类孤句。

#### 连带要求：下载走同一条判定

「下载原图」按钮必须复用同一套判定——**下载失败要报错，绝不能静默下载成缩略图**。用户拿到一张 512px 的图去做商用物料，比看到报错严重得多。

#### 实现落点

`generatedImageToBlob`（[src/App.tsx:2636](../src/App.tsx#L2636)）已经是原图读取的唯一入口，且已有 `url → dataUrl` 兜底与 `读取服务器图片失败（HTTP ${status}）` 抛错。改造在此收敛：让它抛出**带原因分类**的错误（如 `{ reason: "purged" | "lost" | "network", status }`），Lightbox 据此渲染对应文案。不需要在多处重复判定。

### 5.5 清理链路（易漏）

`deleteSavedImages`（[vite.config.ts:1054](../vite.config.ts#L1054)）必须一并 `unlink` 新增的 `thumbId`，否则 5000 条日志裁剪时缩略图会变成**永久孤儿文件**。

---

## 六、实施步骤

| 期 | 内容 | 风险 |
|---|---|---|
| **T1** | 抽出通用 `createThumbnail(blob, 512)`（复用 `createSquareThumbnail` 逻辑）；生成成功后产出 thumbBlob 存 IndexedDB；`toHistoryRecord` 产出 `thumbUrl` | 低 |
| **T2** | 改 5 个渲染点用 `thumbUrl ?? objectUrl`（**带兜底**，老记录无缩略图时自动回退原图，不会白屏） | 低 |
| **T3** | **修 Lightbox**：给 `previewCurrent` 传独立的原图字段 + 实现 §5.4 的加载三态与分原因错误提示 | **低**（原为「中」，见下） |
| **T4** | 服务端：`persistGeneratedImages` 接收客户端上传的缩略图并落盘；`deleteSavedImages` 同步清理；Admin 改用 `thumbId` | 低 |
| **T5** | 历史回填：前端启动时对无 `thumbBlob` 的记录懒生成（每次最多处理 N 条，避免卡顿） | 低 |

顺带清理：`.data/images` 根目录有 **3 个遗留扁平文件共 9.8MB**（2026-07-20 生成），因不满足两段式路径正则而**永远无法访问、也永远不会被裁剪清理**，属于死文件，可在 T4 一并删除。

---

## 七、明确的设计取舍：用存储换时间

**本方案的目标不是省存储，而是省列表打开时间。存储是主动付出的代价。**

付出的代价（可接受）：

| 项 | 变化 |
|---|---|
| 浏览器 IndexedDB | **+1.5%**（每张 3.48MB 原图旁边多一张 ~55KB 缩略图） |
| 服务端 `.data/images` | **+1.5%** |

换回来的东西——「加载时间」其实由三个不同的瓶颈组成，缩略图对三者都有效，但**最关键的是第二项**：

### 7.1 位图内存与解码（本地列表的真正瓶颈）

Studio / Canvas / 首页的图片来自 IndexedDB，**不走网络**，所以传输不是瓶颈——真正的开销是**把 PNG 解码成位图**。解码后占用与压缩体积无关，只取决于像素数：

| 图片 | 解码后 RGBA 占用 |
|---|---|
| 2048×2048 原图 | **16.8MB** |
| 3840×2160 (4K) 原图 | **33.2MB** |
| 512×512 缩略图 | **1.0MB** |

| 场景 | 当前位图内存 | 方案后 | 改善 |
|---|---|---|---|
| Studio 首屏 20 条历史 | **336MB–664MB** | ~21MB | **16–32×** |
| Canvas 30 节点画布 | **504MB–996MB** | ~31MB | **16–32×** |

这才是列表卡顿、滚动掉帧、低配机器标签页崩溃的根因。**这一项没法用「加内存」绕过，只能减像素。**

### 7.2 网络传输（Admin 与服务端图片）

| 场景 | 当前 | 方案后 | 改善 |
|---|---|---|---|
| Admin 日志详情单图 | 3.48MB + 一次服务端同步 `readFileSync` 全量读盘 | 55KB | **~64×** |

Admin 是唯一走 HTTP 的渲染点，这里省的是实打实的带宽和服务端 IO。

### 7.3 IndexedDB 读取与 Blob 构造

| 场景 | 当前 | 方案后 |
|---|---|---|
| 首屏 20 条读取量 | ~70MB | ~1.1MB |

本地读取本身很快，但 20 次 `createObjectURL` + 大 Blob 传递仍有可观开销。

### 7.4 是否要做第二档（128px）？

既然确定用存储换时间，理论上可以再给 48px 的历史侧栏单独做一档 128px 缩略图（~8KB），把侧栏 20 条从 1.1MB 压到 160KB。

**建议先不做**，理由是收益已经递减：512px 单档已经把位图内存从 336MB 降到 21MB（决定性改善），再往下压省的是 1MB 级的本地读取，用户感知不到，却要多维护一套尺寸、一套回填、一套清理。留作 backlog，等实测发现侧栏仍有卡顿再加。

### 7.5 不做的事

**不会**为了省存储而改成「IndexedDB 只存缩略图、原图只留服务端」——那违反项目的 local-first 隐私模型（CLAUDE.md：浏览器保有完整副本，且服务端图片被清理后客户端必须仍能工作），且与 §5.4「原图不可用要明确报错」直接冲突。

---

## 八、风险与回滚

> **T3 为什么从「中风险」降为「低」**：原评估的中风险来源是「失败模式静默」——改错了不报错、不白屏，只是图变糊，用户可能几周不知道。§5.4 确定「读不到原图必须弹提示、绝不用缩略图充数」后，这个失败模式被消除了：错了会明确报错，而不是无声降级。风险从「静默的质量损失」变成「可见的功能异常」，后者属于普通 bug。

| 风险 | 缓解 |
|---|---|
| ~~Lightbox 静默变糊~~ | **已消除**——§5.4 规定原图不可用必须报错，不允许静默显示缩略图 |
| 老记录无缩略图 | 全部渲染点用 `thumbUrl ?? objectUrl` 兜底，永不白屏 |
| 缩略图生成拖慢生成流程 | 在 Blob 落 IndexedDB **之后**异步执行，不阻塞出图 |
| objectUrl 泄漏翻倍 | 每条记录现在有 2 个 objectUrl，`revokeObjectURL` 必须同步覆盖（当前已有泄漏点，见 review-findings） |
| 整体回滚 | 渲染点全部走 `?? objectUrl` 兜底，回滚只需还原 5 处 `src` 表达式 |

---

## 九、验收标准

1. **Studio 首屏 20 条历史的位图内存 < 30MB**（当前 336–664MB）—— 这是本方案的核心指标，用 DevTools Memory 或 `performance.measureUserAgentSpecificMemory()` 验证。
2. Studio 首屏 20 条历史的图片读取总量 < 2MB（当前 ~70MB）。
3. 历史侧栏 48px 缩略图体积 < 80KB/张。
4. **点击任意列表图片，Lightbox 显示的是原图**——用 `naturalWidth` 断言 ≥ 记录里的 `width`。
5. **原图不可用时弹出明确提示，且不显示缩略图充数**：手动删除 `.data/images` 下某张图后点开预览，必须看到「原图已被服务器清理」而非一张糊图。
6. **下载原图失败时报错**，不会静默下载成缩略图。
7. 缩略图保持原始宽高比，无裁剪变形。
8. 老记录（无缩略图）仍能正常显示，不白屏、不报错。
9. 5000 条日志裁剪后，`.data/images` 无 `-thumb.webp` 孤儿文件。
10. `npm run build` 通过；`package.json` 依赖数量不变（方案 A 零新依赖）。

---

## 十、来源

- [Sharp vs Jimp vs Squoosh: Image Processing 2026 — PkgPulse](https://www.pkgpulse.com/guides/sharp-vs-jimp-vs-squoosh-2026)
- [sharp vs. jimp - Node libraries to make thumbnail images — Peterbe](https://www.peterbe.com/plog/sharp-vs-jimp)
- [Installation | sharp（预编译二进制与 musl 说明）](https://sharp.pixelplumbing.com/install/)
- [Sharp 0.33 does not create binaries for alpine linux / docker · lovell/sharp#3900](https://github.com/lovell/sharp/issues/3900)
- [Optimizing Images with WebP and Lazy Loading — Aleksandr Hovhannisyan](https://www.aleksandrhovhannisyan.com/blog/optimizing-images-for-the-web/)
- [Image Optimization 2025: WebP, AVIF & Best Practices — FrontendTools](https://www.frontendtools.tech/blog/modern-image-optimization-techniques-2025)
- [sharpthumb — npm（按需生成 + 磁盘缓存参考实现）](https://www.npmjs.com/package/sharpthumb)
- [pmb0/express-sharp — GitHub](https://github.com/pmb0/express-sharp)
- [chrisben/image-thumb — GitHub](https://github.com/chrisben/image-thumb)
