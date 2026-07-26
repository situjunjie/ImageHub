# ImageHub 前端设计重构方案（Design Refresh PRD）

> 状态：方案定稿，待实施。
> 依据：Lovart.ai 实站样式解构（2026-07-23 实测）+ GitHub 主流 UI/UX skill 方法论 + 本项目 CSS 全量审计。
> 关联：README.md、docs/admin-config-center-prd.md

---

## 一、Lovart 设计语言解构（实站测量）

技术栈：Tailwind CSS（语义令牌类）+ Mantine 组件库 + Inter 字体。从计算样式中提取的设计事实：

| 维度 | 实测值 | 设计含义 |
|---|---|---|
| 画布 | 暗色 `#100F09` / 亮色暖纸白 `#F5F4EF` | 暖色调中性底，非冷灰 |
| 文本 | 主 `#F5F4EF`，次级 `#C9C8C5` | 两级文本灰阶，不用纯黑白 |
| 品牌色 | 荧光绿 ramp：`#F4FFF0 → #85FF75 → #57C74A → #125F23` | 一个高饱和签名色，**只用于品牌时刻**（促销条/logo/选中），功能 UI 保持中性 |
| 分层 | overlay `rgba(245,244,239,0.06)`、border `rgba(...,0.145)` | **用透明度叠加做层级，不用实色灰阶、不用阴影** |
| 圆角 | 胶囊 999（按钮/chip）> 12px（卡片）> 8/6/4（小件）> 16-22（大容器） | 圆角编码组件角色，层级清晰 |
| 阴影 | 几乎为零 | 扁平化：边框 + overlay 分层替代投影 |
| 字重 | 标题 **400**，正文 400，强调 500 | 尺寸和留白做层级，不靠加粗 |
| 字号 | 16px 基准，行高 1.55，h1 仅 26px | 克制的标题，编辑感 |
| 控件 | 按钮高 32/40px，focus-visible ring-2 + offset | 严格的尺寸档位与焦点可见 |
| 动效 | 微交互 200ms ease-out；布局级 500ms ease-in-out | 两档动效令牌，全站统一 |
| 容器 | max-width 1600px，导航高 56px | 大留白 + 内容居中 |

**Lovart 的八条设计逻辑**（从 app 主页截图 + 实测归纳）：
1. **一屏一主角**：主页的唯一主角是那个大输入框，其余（最近项目、灵感流）全部退后。
2. **暖中性画布 + 单一signature色**：功能界面几乎全中性，荧光绿只在品牌时刻出现。
3. **圆角即角色**：能点的是胶囊，内容是 12px 卡片，容器是大圆角。
4. **无影分层**：hairline 边框 + 6% overlay 做出层次，杜绝装饰性阴影。
5. **编辑式排版**：标题不加粗，靠字号/留白/位置赢得注意力。
6. **内容前置**：灵感流是图片本身说话，chrome（侧栏/工具条）縮成图标窄轨。
7. **模型即 chip**：能力/模型作为输入框下的胶囊选择器——把"技术选项"翻译成"创作选项"。
8. **动效纪律**：两档时长、只动 transform/opacity。

---

## 二、GitHub UI/UX Skills 方法论共识

精读了四份代表性方案（官方 anthropics/claude-code frontend-design、Dammyjay93/interface-design、vercel-labs/web-interface-guidelines、lotfb86/web-design-skills 七件套），提炼共识：

**A. 意图性优先（官方 skill + interface-design 共同核心）**
- 每个设计决策必须能追溯到"这个产品的世界"，不能来自通用默认。测试标准："同样的 prompt 给另一个 AI，若产出基本相同，就是失败。"
- 动手前回答三问：这个人是谁（具体场景）？必须完成什么（核心动词）？该有什么感觉（具象感官语言，禁"简洁现代"）。
- 避开"三大默认风格"（奶油+衬线、黑底荧光绿、报纸风）；在**一处**大胆，其余克制。

**B. 层级与构图（interface-design skill）**
- **每屏一个焦点**，说得出它靠什么赢（尺寸/对比/位置/留白）。
- 字号按比例尺（1.2–1.33）生成，不凭感觉挑数。
- 60/30/10 色彩分布：主中性 60、次级 30、强调色 ≤10。
- 分层靠低透明度边框（0.06–0.12）与微小明度差；眯眼测试层级仍在。
- 圆角同心法则：外圆角 = 内圆角 + padding。

**C. 工程基线（Vercel 规范）**
- focus-visible 焦点环不可省略；点击热区桌面 ≥24px、移动 ≥44px。
- 状态完备是底线：default/hover/active/focus/disabled + loading/empty/error。
- 动效 <300ms、只动 transform/opacity、尊重 prefers-reduced-motion、禁 `transition: all`。
- 动态数字用 `font-variant-numeric: tabular-nums`；长文本 truncate/line-clamp；flex 子项 `min-w-0`。
- URL 反映状态（tab/筛选可深链）；图标按钮必须有 aria-label。

---

## 三、ImageHub 现状诊断（CSS 全量审计实测）

| 维度 | 现状 | 问题 |
|---|---|---|
| 字重 | **18 种**（500–880，含 820/780/760/740/640/620/560） | 全站加粗成瘾，层级靠字重硬扛，Lovart 只用 2-3 档 |
| 圆角 | **10+ 种**（999/8/10/12/6/14/7/4/16/11） | 7px/11px 是明显随手写，圆角不编码角色 |
| 阴影 | **88 处** box-shadow，含 `0 16px 42px` 大投影 | 与扁平分层理念相反，视觉噪音大 |
| 动效 | 零令牌，7 种随手写的 transition | 无统一时长/缓动，部分动画 width（触发重排） |
| 色彩 | 令牌底子好（--bg/--surface/--border 语义化），但绿色一色三用：品牌 + success 语义 + hover | 60/30/10 失衡，品牌色被稀释 |
| 焦点 | Studio 首屏右侧配置面板与中央画廊争夺注意力；提示词输入框不是主角 | 违反"一屏一主角" |
| 状态 | focus-visible 大面积缺失；empty/loading 各写各的 | 工程基线不达标 |
| 排版 | 基准 14-15px 混用；标题靠 800+ 字重 | 无比例尺 |

结论：**令牌底子（语义变量命名）是好的，问题在于令牌太少、约束太松、执行随意。** 这决定了重构策略是"收敛令牌 + 全局替换"而非推倒重来。

---

## 四、新设计系统规范（可直接落码）

### 4.1 设计令牌（styles.css `:root` 全量替换目标）

```css
:root {
  /* 画布与表面 —— 保留暖纸白身份，向 Lovart 靠拢 */
  --bg: #f7f6f2;                     /* 页面画布（暖纸白） */
  --surface: #ffffff;                /* 卡片 */
  --overlay-1: rgba(22, 21, 15, 0.04);  /* 悬停/次级底 */
  --overlay-2: rgba(22, 21, 15, 0.07);  /* 按压/选中底 */
  --border: rgba(22, 21, 15, 0.10);     /* hairline */
  --border-strong: rgba(22, 21, 15, 0.16);

  /* 文本 —— 暖黑三级 */
  --text: #16150f;
  --text-2: #6b6a62;                 /* 次级 */
  --text-3: #9b9a90;                 /* 提示/占位 */

  /* 品牌与语义 —— 分离！品牌绿只做品牌时刻 */
  --brand: #10a37f;                  /* CTA/选中/logo，占比 ≤10% */
  --brand-soft: #e7f8f2;
  --ok: #16794c;    --ok-soft: #e9f7ef;
  --warn: #a16207;  --warn-soft: #fff7df;
  --err: #d92d20;   --err-soft: #fff0ef;

  /* 圆角 —— 五档定死，圆角即角色 */
  --r-pill: 999px;   /* 按钮/chip/标签 */
  --r-panel: 16px;   /* 大容器/输入 hero/抽屉 */
  --r-card: 12px;    /* 卡片/面板 */
  --r-input: 10px;   /* 表单控件 */
  --r-thumb: 8px;    /* 缩略图/小件 */

  /* 字体 —— 比例尺 1.25，两档半字重 */
  --fs-12: 12px; --fs-14: 14px; --fs-16: 16px;
  --fs-20: 20px; --fs-25: 25px; --fs-31: 31px; --fs-39: 39px;
  --fw-regular: 400; --fw-medium: 500; --fw-strong: 650; /* strong 仅限数字/徽标 */

  /* 动效 —— 两档 + 标准缓动 */
  --dur-fast: 150ms; --dur-base: 200ms; --dur-layout: 400ms;
  --ease: cubic-bezier(0.23, 1, 0.32, 1);

  /* 阴影 —— 仅浮层可用 */
  --shadow-popover: 0 8px 24px rgba(22, 21, 15, 0.10);
  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px rgba(16, 163, 127, 0.55);
}
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

**硬性收敛规则**（重构执行标准）：
- 字重：全站只允许 400 / 500 / 650。现有 560-880 全部映射：≤600→400 或 500，≥700→500（标题）或 650（纯数字/徽标）。标题层级改由字号比例尺 + 留白承担。
- 圆角：只允许五档令牌。7/11/14/6/4px 全部就近归档。
- 阴影：88 处删至 <10 处（仅弹窗/下拉/toast 等浮层），卡片一律 hairline 边框 + overlay。
- transition：全部改用 `var(--dur-*) var(--ease)`，只动 transform/opacity/color/background/border-color。
- 移除首页/后台的网格纸背景线——Lovart 式纯净画布，纹理感交给暖色调本身。

### 4.2 组件规范

| 组件 | 规范 |
|---|---|
| 主按钮 | 胶囊，高 40px（紧凑 32px），brand 底白字；hover 加深 8%，active scale(0.98) 150ms；每屏**最多一个** |
| 次按钮 | 胶囊，透明底 + hairline 边框，hover 上 overlay-1 |
| Chip（模型/比例/分类） | 胶囊，高 32px，默认 hairline；选中 = brand 边框 + brand-soft 底（Lovart 模型 chip 同款语法） |
| 输入框 | r-input，底色比周围**略深**（overlay-1）示意"可输入"，focus 上 focus-ring |
| 卡片 | r-card，surface 底 + hairline，无阴影；hover 边框加深至 border-strong |
| 表格 | 数字列右对齐 + tabular-nums（后台已做，推广到全站） |
| 空状态 | 统一插画位 + 一句话 + 一个动词按钮（"生成第一张图"），禁"暂无数据"孤句 |
| 焦点 | 所有可交互元素 `:focus-visible { box-shadow: var(--focus-ring) }` |

### 4.3 每页焦点重构（一屏一主角）

**Studio 工作台（改动最大）**
- 主角 = **提示词输入区**。参照 Lovart：输入区提升为居中 hero 卡（r-panel 16px、内含上传 +、参数摘要 chip、发送按钮），首屏视觉权重第一。
- 模型选择从右栏移为输入区下方的一排 **chips**（含实时数据徽标："近7日成功率 50% · P50 164s"）——把已建好的 model-stats 数据放到决策点上。
- 右侧配置栏降噪：默认只展示 API 连接状态 + 高级参数折叠；宽度 360→320，去卡片嵌套阴影。
- 结果画廊内容前置：卡片去阴影、操作按钮 hover 才浮现（含 👍/👎），让图片本身说话。
- 左侧历史栏改 Lovart 式**图标窄轨**（56px），hover 展开。

**Home 首页**：标题字重 800→500，尺寸靠 --fs-39；网格背景移除；CTA 只保留一个 brand 主按钮。

**Square 广场**：分类 tab 改胶囊 chips；卡片信息（作者/数据）压到图片底部悬浮条，纯内容瀑布流。

**Admin 后台**：已完成对齐统一，仅做令牌套用（字重/阴影/圆角收敛），零结构改动。

### 4.4 签名元素（Signature Element）

按 interface-design skill 要求："一个只可能属于这个产品的结构装置，编码真实信息而非装饰"：

> **生成链路脉冲线**：每张生成中/已完成卡片底部一条 2px 线，按真实链路阶段分四段（接收→上游生成→落盘→返回），生成中逐段以 brand 色点亮（数据来自已有的 stages 时间戳），完成后淡出为 hairline。失败时停在断掉的那段并转为 err 色——**用户一眼看出死在哪一环**。

这是本产品独有的（我们真的记录了每段时间戳），既是品牌记忆点又是功能信息，完美符合"结构装置编码真实信息"原则。

### 4.5 工程基线清单（Vercel 规范落地）

- [ ] 全站 focus-visible 焦点环
- [ ] 图标按钮补 aria-label（下载/放大/反馈等）
- [ ] 所有统计数字 tabular-nums
- [ ] 管理后台 Tab 状态进 URL hash（#admin/logs 可深链）
- [ ] 长提示词 line-clamp、flex 子项 min-w-0 审查
- [ ] 移动端断点验证（工作台三栏 → 单栏折叠）
- [ ] prefers-reduced-motion 全局豁免

---

## 五、分期实施

| 期 | 内容 | 改动量 | 风险 |
|---|---|---|---|
| **P1 令牌收敛** | :root 新令牌 + 全局字重/圆角/阴影/动效机械替换 + 移除网格背景 | styles.css 大改，App.tsx 零改 | 低（纯视觉，可整体回滚） |
| **P2 Studio 焦点重构** | 输入区 hero 化、模型 chips（带数据徽标）、右栏降噪、历史窄轨 | App.tsx 布局改动 | 中 |
| **P3 状态与签名** | focus/empty/loading 统一、生成链路脉冲线、卡片 hover 操作浮现 | 中等 | 低 |
| **P4 内容化与深链** | Square/Home 改版、admin tab 深链、移动端适配、（可选）暗色模式 | 中等 | 低 |

每期结束跑 `npm run build` + 浏览器截图对比验收。

## 六、评审修订（v1.1，AI 工具产品视角自审后的修正）

对照"决策必须来自本产品的世界"原则重审,以下四处原方案判断有误,修正如下:

1. **Studio 输入区 hero 化 → 改为"分状态"**。Lovart 是委托代理型产品(每次从零开始),ImageHub Studio 是批量迭代工作台(核心循环:提交→看结果→微调→再提交,80% 时间看画廊)。照搬居中大 hero 会把结果推下首屏、拉长迭代循环。修正:**空状态(无记录)时输入区居中 hero 引导;有记录后 composer 保持底部紧凑停靠**(现有底部 composer 方向本来就是对的,只做视觉令牌升级)。
2. **右栏参数折叠 → 按使用频率分级**。张数/比例/分辨率是每次生成都动的高频参数,必须一击可达,不折叠;协议/输出格式/种子/负面词低频,可折叠。批量工具的操作效率优先于视觉安静。
3. **历史窄轨 hover 展开 → 改为可固定的 pin 展开/收起**。hover 展开与拖拽图片、触屏操作冲突,是工具类产品反模式。
4. **暗色模式从 P4 提前到 P2**。图片评估类工具的行业默认是深色环境(Lightroom/Midjourney/ComfyUI)——白底看图有眩光与色感偏差。至少画廊与画布工作区在 P2 提供深色 surface。

**新增 P2.5:画布性能修复**(代码盘查发现的真实架构问题,详见下):
- 平移/缩放改 ref + rAF 直写容器 transform,指针抬起才 setState 同步(消除每次 pointermove 全量重渲染);
- 画布节点组件 memo 化(比较 x/y/w/h/status/selected/objectUrl),拖拽单节点只重渲染该节点;
- wheel 缩放 rAF 节流;小地图节点列表同样 memo。

**新增刷新时机修复**:管理后台 10s 轮询加 `document.hidden` 守卫;按 Tab 拉数据(概览只拉 stats,日志 Tab 才拉日志),避免"加载更多"到 1000 条后每 10s 重拉 1000 条完整 JSON。

**明确不在本次范围但记入 backlog 的交互欠账**:结果 A/B 对比模式、失败任务批量重试、prompt 历史复用面板。

## 七、验收标准

1. 字重种类 ≤3、圆角种类 ≤5、卡片阴影 = 0（浮层除外）——用 grep 统计验证。
2. Studio 首屏眯眼测试：输入区是唯一焦点。
3. 品牌绿出现面积 ≤ 屏幕 10%（60/30/10）。
4. 全部可交互元素键盘可达且有可见焦点环。
5. 动效全部走令牌，无 `transition: all`、无布局属性动画。
6. "换个 AI 同样 prompt 会做出一样的界面吗?"——签名脉冲线保证答案是否。
