// 运行时配置单例（canvas-v2-prd §5.2 C0 拆分 / §5.3 坑 3）：runtime* 可变单例全库唯一，
// 只在本模块内被 applyAppConfig 重新赋值；App.tsx 通过 import 的 live binding 读取。
// 叶子模块：不 import App.tsx / ../canvas/*。
import type { IndustryAgent, StyleEnhancement } from "./types";

export const API_KEY_MIN_LENGTH = 8;

export const ALLOWED_API_ENDPOINTS: { value: string; label: string; description: string }[] = [
  {
    value: "https://www.taijiai.online/",
    label: "太极 AI",
    description: "主服务地址",
  },
  {
    value: "https://bobdong.cn/",
    label: "BobDong",
    description: "备用服务地址",
  },
];
export const DEFAULT_API_URL = ALLOWED_API_ENDPOINTS[0].value;

export const PROMPT_STARTERS = [
  {
    label: "超写实人像",
    tag: "头像写真",
    prompt: "8K 超写实近景人像肖像，女性，白皙皮肤，五官与参考照片 100% 一致，柔和侧逆光打在脸上，背景虚化，皮肤纹理与毛发细节清晰可见，电影级光影和肤色过渡，高质感摄影棚风格，4K 细节，适合头像与人像写真展示。",
  },
  {
    label: "水墨双龙",
    tag: "东方概念",
    prompt: "阴阳概念，两条中国龙龙对战，一条白龙一条黑龙，极简水墨画风格，黑色墨迹绘制在白色背景上，带有和纸纹理，大号红色印章签名，禅意风格，居中构图",
  },
  {
    label: "建筑文字剖面",
    tag: "信息图",
    prompt: "2x2 网格布局，每一格是一栋著名建筑的垂直剖面示意图，不画真实造型，而是用建筑结构与材料术语堆叠成楼层文字方块：地基、柱网、楼板、幕墙、机电系统等，从下到上依次排列。整体采用极简信息图风格，白底黑字，少量线条勾勒楼层分隔，排版干净、对比清晰，可读性强，适合作为建筑结构可视化概念插画。",
  },
  {
    label: "蓝图到现实",
    tag: "建筑渲染",
    prompt: "创建一张纵向分屏建筑可视化图，上半部分是深色主题的精细建筑平立面蓝图，包含清晰线稿、标注和结构细节，下半部分是与蓝图完全对应的写实现代住宅外观 3D 渲染，真实光影和材质，干净背景，整体呈现“蓝图到现实”的一体化对比效果。",
  },
  {
    label: "人物侧脸海报",
    tag: "IP 视觉",
    prompt: "核心结构：人物侧脸外轮廓 + 内部世界观填充，适合文学/IP/人物传记海报。\n风格方向：电影海报 + 东方现实主义，强调光影、空间纵深和宿命感。\n质感控制：侧逆光、体积光、轻雾、胶片颗粒，让画面更像正式视觉物料。\n可复用点：把主题换成任意小说、历史人物、城市故事或品牌叙事，都能做系列封面。",
  },
  {
    label: "历史学家玩具",
    tag: "3D 手办",
    prompt: "2×2 网格布局，每格展示一个基于“历史学家”职业的可爱玩具人物立牌。输入为一个著名历史学家，分析其典型特征并转化为 Q 版或 chibi 风格：大头小身、夸张表情和代表性服饰或道具（如书卷、古地图、羽毛笔）。整体为 3D 扭蛋场景风格，塑料质感的小公仔站在透明底座上，画面为分层拆解的 split-view，展示人物、底座和扭蛋背景机台，柔和打光，高细节，卡通但带一点收藏手办质感。",
  },
  {
    label: "文本封面主视觉",
    tag: "社媒封面",
    prompt: "核心任务：把一句话或大段文本转成“封面主视觉”，适合小红书、X、公众号、Telegram 封面。\n设计思路：苹果设计师思维 + 海报大师思维 + 高桥流，强调大字、留白、冲击力和信息压缩。\n关键能力：让模型“智能梳理文本”，避免把长文逐字堆到图里。\n可复用点：适合金句、信息差、课程标题、文章封面、播客标题、社群公告。",
  },
  {
    label: "社交媒体成瘾",
    tag: "社论漫画",
    prompt: "为「社交媒体上瘾」这个主题创作一幅正方形、单格的社论漫画。先推理出最有力、最讽刺的视觉隐喻（例如赌场、仓鼠轮、正在下沉的船、飙车赛道等），再据此构图。画面应一眼就能看出是在批判社交媒体成瘾：人物被界面和通知牵制，氛围略带黑色幽默，细节简洁但寓意清晰，适合社论版头图使用。",
  },
];


export const STYLE_ENHANCEMENT_PRESETS: StyleEnhancement[] = [
  {
    name: "电影感",
    description: "更强的镜头、光影和空间纵深",
    promptFragment: "电影级构图，柔和侧逆光，体积光，浅景深，细腻胶片颗粒，画面具有空间纵深和叙事感。",
  },
  {
    name: "商业摄影",
    description: "适合产品、人像与高质感展示",
    promptFragment: "高质感商业摄影棚风格，干净背景，精准布光，真实材质，高细节，主体边缘清晰。",
  },
  {
    name: "社媒封面",
    description: "更适合小红书、公众号和信息流",
    promptFragment: "社交媒体封面主视觉，强标题感构图，留白明确，高对比，信息层级清晰，移动端可读性强。",
  },
  {
    name: "极简信息图",
    description: "适合结构解释、知识卡片与图解",
    promptFragment: "极简信息图风格，白底黑字，少量辅助线条，模块化排版，层级分明，可读性强。",
  },
  {
    name: "东方水墨",
    description: "更适合国风、禅意和概念插画",
    promptFragment: "东方水墨画风格，宣纸纹理，留白构图，墨色层次丰富，克制的红色印章点缀，禅意氛围。",
  },
  {
    name: "3D 手办",
    description: "适合玩具、公仔、IP 角色",
    promptFragment: "3D 收藏手办质感，Q 版比例，塑料材质，透明底座，柔和棚拍打光，高细节，干净背景。",
  },
];


export const COMMON_AGENT_NEGATIVE_PROMPT = "低清晰度，主体变形，错误文字，杂乱背景，比例失真，廉价模板感，过度锐化，AI伪影";

export const INDUSTRY_AGENTS: IndustryAgent[] = [
  {
    id: "ecommerce-product",
    name: "电商商品图",
    tag: "商业高频",
    icon: "商",
    scenario: "商品主图 / 场景图 / 详情页配图",
    description: "把商品卖点、材质和平台构图转成商业摄影方案。",
    recommendedRatio: "1:1",
    defaultCount: 4,
    defaultQuality: "high",
    defaultSubject: "现代消费电子产品",
    defaultGoal: "生成可直接用于商品主图、场景图和详情页首屏的高质感商业摄影图。",
    defaultScene: "纯净棚拍电商主图，干净浅灰背景，商品完整居中。",
    defaultAudience: "电商运营、品牌营销和正在浏览商品详情页的潜在买家。",
    clickHint: "打开电商商品图工作流",
    emptyStateHint: "不填写也会默认生成现代消费电子产品的电商主图方案。",
    defaultValues: {
      productName: "现代消费电子产品",
      material: "磨砂金属与细腻织物纹理",
      sellingPoint: "高质感、主体清晰、材质真实、平台可直接使用",
      scene: "纯净棚拍",
      platform: "电商主图",
      blank: "不需要",
    },
    promptBlueprint: "商品主体 + 材质细节 + 平台用途 + 商业棚拍布光 + 干净背景 + 商品占比 + 可交付电商视觉",
    negativePrompt: `${COMMON_AGENT_NEGATIVE_PROMPT}，商品变形，过度反光，低质感，道具喧宾夺主`,
    fields: [
      { id: "productName", label: "商品名称", type: "text", required: true, placeholder: "例如：黑色智能音箱" },
      { id: "material", label: "材质 / 颜色", type: "text", placeholder: "磨砂黑金属、织物网面" },
      { id: "sellingPoint", label: "核心卖点", type: "textarea", placeholder: "音质、质感、便携、礼品感等" },
      { id: "scene", label: "使用场景", type: "select", options: ["纯净棚拍", "居家桌面", "礼盒场景", "户外生活方式", "高级灰背景"], defaultValue: "纯净棚拍" },
      { id: "platform", label: "目标平台", type: "select", options: ["电商主图", "电商详情页", "品牌官网", "广告投放", "私域海报"], defaultValue: "电商主图" },
      { id: "blank", label: "留白位置", type: "select", options: ["不需要", "上方留白", "左侧留白", "右侧留白", "底部留白"], defaultValue: "不需要" },
    ],
    supplements: ["商业摄影布光", "商品占比明确", "材质细节清晰", "背景干净", "适合电商合规构图"],
    promptStructures: {
      stable: "主体为现代消费电子产品，产品完整清晰，占据画面中心，干净浅灰背景，柔和双侧棚拍布光，真实材质纹理，边缘清晰，轻微自然投影。",
      creative: "保持商品结构真实，加入高级生活方式陈列、氛围光和轻叙事背景，让商品更有记忆点但不喧宾夺主。",
      commercial: "强调广告可交付质感，卖点可视化，背景克制，构图适合电商主图、详情页首屏和品牌页面。",
    },
    qualityChecklist: ["商品完整清晰", "主体占比明确", "材质真实", "背景干净", "适合电商平台"],
  },
  {
    id: "xiaohongshu-cover",
    name: "小红书封面",
    tag: "社媒增长",
    icon: "封",
    scenario: "笔记封面 / 种草图 / 干货图",
    description: "自动补全移动端识别、标题留白和种草氛围。",
    recommendedRatio: "4:5",
    defaultCount: 4,
    defaultQuality: "high",
    defaultSubject: "精致生活方式场景与种草产品",
    defaultGoal: "生成手机端高识别、可叠加标题的小红书封面。",
    defaultScene: "干净生活方式画面，主体居中，上方保留标题区域。",
    defaultAudience: "小红书内容创作者、品牌种草运营和移动端浏览用户。",
    clickHint: "打开小红书封面工作流",
    emptyStateHint: "不填写也会默认生成精致生活方式种草封面。",
    defaultValues: {
      topic: "春日通勤包里有什么",
      audience: "年轻职场女性",
      subject: "精致桌面、通勤包和生活方式产品",
      emotion: "精致种草",
      titleSpace: "上方留白",
      style: "生活方式摄影",
    },
    promptBlueprint: "内容主题 + 移动端强识别 + 视觉中心 + 标题留白 + 情绪关键词 + 种草氛围 + 干净层级",
    negativePrompt: `${COMMON_AGENT_NEGATIVE_PROMPT}，杂乱排版，畸形人物，过度磨皮，主体不清晰，标题区域拥挤`,
    fields: [
      { id: "topic", label: "笔记主题", type: "text", required: true, placeholder: "例如：早八通勤包里有什么" },
      { id: "audience", label: "目标人群", type: "text", placeholder: "大学生、职场新人、精致妈妈" },
      { id: "subject", label: "画面主体", type: "text", placeholder: "人物、产品、桌面、场景" },
      { id: "emotion", label: "情绪关键词", type: "select", options: ["高级松弛", "强烈反差", "治愈温暖", "干货清晰", "精致种草"], defaultValue: "精致种草" },
      { id: "titleSpace", label: "标题留白", type: "select", options: ["上方留白", "左上留白", "右上留白", "中间标题区", "不需要文字区"], defaultValue: "上方留白" },
      { id: "style", label: "风格方向", type: "select", options: ["生活方式摄影", "强标题封面", "产品种草", "极简干货", "胶片氛围"], defaultValue: "生活方式摄影" },
    ],
    supplements: ["手机屏幕强识别", "视觉中心明确", "标题留白", "高点击率构图", "信息层级清晰"],
    promptStructures: {
      stable: "主体明确居中，上方保留标题留白，柔和自然光，高级干净配色，画面有种草感和真实生活氛围，移动端一眼可读。",
      creative: "增强颜色反差、情绪表达和封面记忆点，保留标题安全区，适合探索高点击率封面方向。",
      commercial: "保持高级生活方式质感和品牌可信度，构图可叠加标题，色彩统一，适合品牌种草和内容投放。",
    },
    qualityChecklist: ["手机端可读", "视觉中心明确", "标题留白清楚", "种草感强", "背景不杂乱"],
  },
  {
    id: "short-video-cover",
    name: "短视频封面",
    tag: "高点击",
    icon: "视",
    scenario: "抖音 / TikTok / Reels / Shorts 封面",
    description: "把视频主题提炼成一秒能看懂的竖屏首帧。",
    recommendedRatio: "9:16",
    defaultCount: 4,
    defaultQuality: "high",
    defaultSubject: "大主体人物或核心物品",
    defaultGoal: "生成 1 秒内可读的竖屏短视频首帧封面。",
    defaultScene: "强视觉中心、顶部标题区、竖屏安全构图。",
    defaultAudience: "抖音、TikTok、Reels、Shorts 的快速滑动用户。",
    clickHint: "打开短视频封面工作流",
    emptyStateHint: "不填写也会默认生成强对比竖屏短视频封面。",
    defaultValues: {
      videoTopic: "3 个让房间显贵的软装技巧",
      platform: "抖音",
      subject: "博主与室内空间对比",
      conflict: "普通房间到高级感空间的前后对比",
      titleArea: "上方标题区",
      emotion: "强冲击",
    },
    promptBlueprint: "视频主题 + 大主体 + 冲突点 + 强对比 + 字幕安全区 + 快速识别 + 竖屏构图",
    negativePrompt: `${COMMON_AGENT_NEGATIVE_PROMPT}，主体太小，低对比，背景干扰，表情僵硬，画面拖沓`,
    fields: [
      { id: "videoTopic", label: "视频主题", type: "text", required: true, placeholder: "例如：3 个让房间显贵的软装技巧" },
      { id: "platform", label: "平台", type: "select", options: ["抖音", "TikTok", "Reels", "Shorts", "视频号"], defaultValue: "抖音" },
      { id: "subject", label: "主体人物 / 产品", type: "text", placeholder: "博主、产品、场景或道具" },
      { id: "conflict", label: "冲突点", type: "textarea", placeholder: "前后对比、常见误区、意外结果" },
      { id: "titleArea", label: "字幕安全区", type: "select", options: ["上方标题区", "中间大标题", "下方字幕区", "左右留白"], defaultValue: "上方标题区" },
      { id: "emotion", label: "情绪强度", type: "select", options: ["强冲击", "惊讶表情", "专业可信", "轻松幽默", "克制高级"], defaultValue: "强冲击" },
    ],
    supplements: ["9:16 竖屏构图", "大主体", "强对比", "字幕安全区", "快速识别"],
    promptStructures: {
      stable: "9:16 竖屏首帧图，主体足够大，表情或核心物品醒目，强对比背景，顶部保留标题安全区，画面在 1 秒内能看懂主题。",
      creative: "加强冲突、表情张力和视觉对比，让封面更有停留感和点击欲望，同时保持字幕区域清晰。",
      commercial: "保持专业质感和品牌可信度，适合课程、知识、产品视频封面，画面醒目但不过度夸张。",
    },
    qualityChecklist: ["1 秒内看懂主题", "主体足够大", "标题安全区清楚", "情绪明确", "背景不干扰"],
  },
  {
    id: "brand-poster",
    name: "品牌海报",
    tag: "主视觉",
    icon: "品",
    scenario: "活动海报 / 发布会图 / 官网头图",
    description: "建立主视觉、调性、色彩秩序和文案区域。",
    recommendedRatio: "4:5",
    defaultCount: 4,
    defaultQuality: "high",
    defaultSubject: "现代生活方式品牌主视觉",
    defaultGoal: "生成活动、发布会或官网可用的高级商业主视觉。",
    defaultScene: "品牌发布海报，主视觉居中，文案区域干净留白。",
    defaultAudience: "品牌市场团队、活动运营和官网访客。",
    clickHint: "打开品牌海报工作流",
    emptyStateHint: "不填写也会默认生成极简高级品牌发布主视觉。",
    defaultValues: {
      brand: "现代生活方式品牌",
      campaign: "新品发布主视觉",
      tone: "极简高级",
      visual: "产品与抽象光影装置",
      color: "黑白银与淡绿色点缀",
      copyArea: "上方留白",
    },
    promptBlueprint: "品牌调性 + 活动主题 + 主视觉元素 + 留白区域 + 色彩秩序 + 商业海报质感",
    negativePrompt: `${COMMON_AGENT_NEGATIVE_PROMPT}，廉价模板感，视觉中心混乱，色彩脏，过度装饰`,
    fields: [
      { id: "brand", label: "品牌名称", type: "text", placeholder: "可选，不需要生成文字时也可只填调性" },
      { id: "campaign", label: "活动主题", type: "text", required: true, placeholder: "新品发布、节日营销、品牌升级" },
      { id: "tone", label: "品牌调性", type: "select", options: ["极简高级", "科技未来", "年轻潮流", "温暖生活", "东方美学"], defaultValue: "极简高级" },
      { id: "visual", label: "主视觉元素", type: "text", placeholder: "产品、符号、装置、自然元素" },
      { id: "color", label: "色彩方向", type: "text", placeholder: "黑白银、薄荷绿、暖金色" },
      { id: "copyArea", label: "文案区域", type: "select", options: ["上方留白", "左侧留白", "右侧留白", "底部留白", "中心主标题"], defaultValue: "上方留白" },
    ],
    supplements: ["品牌调性统一", "主视觉中心", "留白区域", "商业海报质感", "色彩秩序"],
    promptStructures: {
      stable: "高级商业主视觉，画面有明确主视觉中心，统一色彩秩序，干净留白区域可放文案，适合活动页、发布会、官网头图。",
      creative: "加入更有记忆点的视觉隐喻、装置感和空间层次，形成可作为发布会主 KV 的强视觉。",
      commercial: "强调可交付商业海报，色彩统一，视觉秩序清楚，画面高级、克制、适合官网和广告投放。",
    },
    qualityChecklist: ["主视觉明确", "留白可放文案", "品牌调性统一", "色彩干净", "商业交付感强"],
  },
  {
    id: "interior-space",
    name: "室内空间",
    tag: "设计灵感",
    icon: "室",
    scenario: "室内效果图 / 软装方案 / 空间灵感",
    description: "补全空间层次、材质、镜头焦段和真实自然光。",
    recommendedRatio: "4:3",
    defaultCount: 4,
    defaultQuality: "high",
    defaultSubject: "现代极简客厅空间",
    defaultGoal: "生成真实可信的室内设计参考图和软装方案图。",
    defaultScene: "80 平现代公寓客厅，清晨自然光，材质真实，空间层次清楚。",
    defaultAudience: "室内设计师、装修业主、家居品牌和方案汇报用户。",
    clickHint: "打开室内空间工作流",
    emptyStateHint: "不填写也会默认生成现代极简客厅设计参考图。",
    defaultValues: {
      spaceType: "客厅",
      scale: "80 平现代公寓",
      style: "现代极简",
      materials: "木饰面、亚麻、浅色石材",
      light: "清晨自然光",
      camera: "人眼平视",
    },
    promptBlueprint: "空间类型 + 面积尺度 + 设计风格 + 主材 + 自然光 + 镜头角度 + 合理透视 + 真实摄影感",
    negativePrompt: `${COMMON_AGENT_NEGATIVE_PROMPT}，空间透视错误，家具变形，材质虚假，过曝，布局杂乱`,
    fields: [
      { id: "spaceType", label: "空间类型", type: "select", options: ["客厅", "卧室", "餐厅", "书房", "办公室", "商业空间"], defaultValue: "客厅" },
      { id: "scale", label: "面积 / 尺度", type: "text", placeholder: "例如：80 平现代公寓" },
      { id: "style", label: "风格", type: "select", options: ["现代极简", "奶油风", "侘寂", "中古风", "自然原木", "科技办公"], defaultValue: "现代极简" },
      { id: "materials", label: "主材", type: "text", placeholder: "木饰面、微水泥、石材、亚麻" },
      { id: "light", label: "光线", type: "select", options: ["清晨自然光", "午后侧光", "柔和夜景灯光", "大面积落地窗", "商业摄影灯光"], defaultValue: "清晨自然光" },
      { id: "camera", label: "镜头角度", type: "select", options: ["广角空间", "人眼平视", "角落斜拍", "细节特写", "中景生活感"], defaultValue: "人眼平视" },
    ],
    supplements: ["空间层次", "真实材质", "自然光", "透视合理", "家具布局"],
    promptStructures: {
      stable: "现代客厅真实室内摄影，自然光进入空间，合理透视，家具布局舒适，木饰面、亚麻与浅色石材材质真实，空间层次清楚。",
      creative: "强化风格叙事、材质对比和生活痕迹，提供更有灵感感的空间方案。",
      commercial: "强调设计方案图可交付感，干净高级，适合提案、官网和案例展示。",
    },
    qualityChecklist: ["透视自然", "家具比例合理", "材质真实", "光线舒适", "空间有层次"],
  },
  {
    id: "portrait-photo",
    name: "人像写真",
    tag: "人物形象",
    icon: "人",
    scenario: "头像 / 半身写真 / 商务形象照",
    description: "自动补全妆造、姿态、光线、背景和镜头语言。",
    recommendedRatio: "3:4",
    defaultCount: 4,
    defaultQuality: "high",
    defaultSubject: "自然半身人像",
    defaultGoal: "生成自然专业的人像写真、头像和商务形象候选图。",
    defaultScene: "窗边浅色室内，柔和侧逆光，背景干净，浅景深。",
    defaultAudience: "个人形象用户、品牌创始人、内容创作者和摄影工作室。",
    clickHint: "打开人像写真工作流",
    emptyStateHint: "不填写也会默认生成自然半身人像写真。",
    defaultValues: {
      portraitType: "自然写真",
      temperament: "年轻、温柔、专业、松弛",
      styling: "淡妆、白色针织衫、干净发型",
      scene: "窗边浅色室内",
      light: "柔和侧逆光",
      pose: "自然微笑，看向镜头，放松坐姿",
    },
    promptBlueprint: "人像类型 + 气质 + 妆造服装 + 场景 + 光线 + 表情姿态 + 镜头语言 + 真实肤色",
    negativePrompt: `${COMMON_AGENT_NEGATIVE_PROMPT}，畸形五官，畸形手部，过度磨皮，表情僵硬，背景杂乱`,
    fields: [
      { id: "portraitType", label: "人像类型", type: "select", options: ["自然写真", "商务形象", "头像", "杂志大片", "生活方式"], defaultValue: "自然写真" },
      { id: "temperament", label: "年龄气质", type: "text", placeholder: "年轻、成熟、温柔、专业、松弛" },
      { id: "styling", label: "妆造 / 服装", type: "textarea", placeholder: "淡妆、白衬衫、针织衫、干净发型" },
      { id: "scene", label: "场景", type: "text", placeholder: "窗边、街角、棚拍灰背景、咖啡馆" },
      { id: "light", label: "光线", type: "select", options: ["柔和侧逆光", "自然窗光", "棚拍柔光", "日落暖光", "电影感暗调"], defaultValue: "柔和侧逆光" },
      { id: "pose", label: "表情姿态", type: "text", placeholder: "自然微笑、看向镜头、侧脸、放松坐姿" },
    ],
    supplements: ["肤色真实", "柔和光线", "浅景深", "自然表情", "背景干净"],
    promptStructures: {
      stable: "自然半身人像写真，柔和侧逆光，真实肤色，浅景深，表情放松，背景干净，适合头像和写真交付。",
      creative: "加入更强杂志感镜头、胶片质感和叙事氛围，适合探索视觉风格。",
      commercial: "强调专业可信的形象照质感，光线高级，构图稳重，适合商务和品牌展示。",
    },
    qualityChecklist: ["五官自然", "肤色真实", "手部不异常", "表情放松", "光线高级"],
  },
  {
    id: "food-photo",
    name: "餐饮美食",
    tag: "菜单转化",
    icon: "食",
    scenario: "菜品图 / 外卖主图 / 餐厅宣传图",
    description: "补全食物质感、摆盘、蒸汽和商业美食摄影语言。",
    recommendedRatio: "1:1",
    defaultCount: 4,
    defaultQuality: "high",
    defaultSubject: "番茄牛腩饭",
    defaultGoal: "生成菜单、外卖主图和餐厅宣传可用的商业美食图。",
    defaultScene: "干净浅色桌面，菜品清晰，热气蒸腾，食欲感强。",
    defaultAudience: "餐饮商家、外卖运营、菜单设计和餐厅推广用户。",
    clickHint: "打开餐饮美食工作流",
    emptyStateHint: "不填写也会默认生成番茄牛腩饭商业菜单图。",
    defaultValues: {
      dish: "番茄牛腩饭",
      cuisine: "中式轻食",
      ingredients: "牛肉块、番茄浓汁、新鲜香草",
      plating: "外卖主图",
      background: "干净浅色桌面",
      freshness: "热气蒸腾",
    },
    promptBlueprint: "菜品名称 + 菜系 + 食材亮点 + 摆盘 + 背景 + 新鲜感 + 商业美食摄影 + 食欲质感",
    negativePrompt: `${COMMON_AGENT_NEGATIVE_PROMPT}，食物不新鲜，颜色失真，油腻脏乱，餐具变形，塑料质感，过度假`,
    fields: [
      { id: "dish", label: "菜品名称", type: "text", required: true, placeholder: "例如：番茄牛腩饭" },
      { id: "cuisine", label: "菜系", type: "text", placeholder: "中式、日式、意式、轻食" },
      { id: "ingredients", label: "食材亮点", type: "textarea", placeholder: "牛肉块、番茄浓汁、新鲜香草" },
      { id: "plating", label: "摆盘风格", type: "select", options: ["外卖主图", "高级餐厅摆盘", "家庭餐桌", "微距特写", "节日套餐"], defaultValue: "外卖主图" },
      { id: "background", label: "背景", type: "select", options: ["干净浅色桌面", "木质餐桌", "深色高级背景", "厨房现场", "节日氛围"], defaultValue: "干净浅色桌面" },
      { id: "freshness", label: "新鲜感", type: "select", options: ["热气蒸腾", "清爽新鲜", "酱汁光泽", "酥脆质感", "克制自然"], defaultValue: "热气蒸腾" },
    ],
    supplements: ["食物质感", "微距细节", "新鲜色泽", "餐桌氛围", "商业美食摄影"],
    promptStructures: {
      stable: "商业菜单图，菜品清晰有食欲，色泽自然，柔和侧光，热气蒸腾，干净摆盘，适合菜单或外卖主图。",
      creative: "加入更强氛围光、蒸汽和食材特写，让画面更有香气和记忆点。",
      commercial: "强调餐饮品牌交付质感，摆盘高级，背景克制，适合广告和宣传图。",
    },
    qualityChecklist: ["食物有食欲", "色泽自然", "构图干净", "摆盘清楚", "适合菜单或外卖"],
  },
  {
    id: "saas-promo",
    name: "App / SaaS 宣传图",
    tag: "科技营销",
    icon: "软",
    scenario: "官网头图 / App 展示 / 功能介绍图",
    description: "把功能卖点变成设备 mockup、数据感和官网视觉。",
    recommendedRatio: "16:9",
    defaultCount: 4,
    defaultQuality: "high",
    defaultSubject: "AI 图像工作台产品展示",
    defaultGoal: "生成官网头图、产品展示图和功能介绍主视觉。",
    defaultScene: "桌面网页设备 mockup，干净白色背景，科技光影和产品界面层级。",
    defaultAudience: "SaaS 团队、设计团队、运营团队和企业采购用户。",
    clickHint: "打开 App / SaaS 宣传图工作流",
    emptyStateHint: "不填写也会默认生成 AI 图像工作台官网宣传图。",
    defaultValues: {
      productType: "AI 图像工作台",
      coreFeature: "批量生图、行业 Agent、提示词优化、本地图库",
      audience: "设计团队、运营与企业客户",
      device: "桌面网页",
      style: "Apple 官网感",
      background: "干净白色",
    },
    promptBlueprint: "产品类型 + 核心功能 + 目标用户 + 设备 mockup + UI 层级 + 科技光影 + 官网留白",
    negativePrompt: `${COMMON_AGENT_NEGATIVE_PROMPT}，伪界面混乱，文字错误，层级不清，廉价科技感，过度复杂`,
    fields: [
      { id: "productType", label: "产品类型", type: "text", required: true, placeholder: "AI 图库、CRM、数据看板、效率工具" },
      { id: "coreFeature", label: "核心功能", type: "textarea", placeholder: "批量生图、智能分析、团队管理、自动化报表" },
      { id: "audience", label: "目标用户", type: "text", placeholder: "设计团队、运营、企业客户、开发者" },
      { id: "device", label: "展示设备", type: "select", options: ["桌面网页", "手机 App", "平板设备", "多设备组合", "抽象界面层"], defaultValue: "桌面网页" },
      { id: "style", label: "UI 风格", type: "select", options: ["Apple 官网感", "ChatGPT 极简", "企业级 SaaS", "深色科技", "明亮数据感"], defaultValue: "Apple 官网感" },
      { id: "background", label: "背景风格", type: "select", options: ["干净白色", "柔和渐变光", "深色发布会", "真实办公场景", "抽象数据空间"], defaultValue: "干净白色" },
    ],
    supplements: ["产品界面展示", "设备 mockup", "清晰层级", "科技光影", "官网留白"],
    promptStructures: {
      stable: "官网头图风格，真实设备 mockup，产品界面层级清晰，数据感和科技光影适度，干净白色背景，留白充足。",
      creative: "加入抽象数据流、光影空间和发布会感，让科技产品更有视觉冲击。",
      commercial: "强调 B2B 可交付营销图，真实可信，留白充足，适合官网和销售资料。",
    },
    qualityChecklist: ["产品功能清晰", "设备 mockup 真实", "UI 层级明确", "留白充足", "适合官网营销"],
  },
];

export type EndpointOption = { value: string; label: string; description: string };
export type RuntimeModelConfig = { id: string; displayName: string; sizing: "explicit-2k4k" | "official-1k"; tags: string[] };

export let runtimeEndpoints: EndpointOption[] = [...ALLOWED_API_ENDPOINTS];
export let runtimeModelConfig: RuntimeModelConfig[] = [];
export let runtimePromptStarters = PROMPT_STARTERS;
export let runtimeStylePresets = STYLE_ENHANCEMENT_PRESETS;
export let runtimeIndustryAgents = INDUSTRY_AGENTS;
export let runtimeCommonNegativePrompt = COMMON_AGENT_NEGATIVE_PROMPT;

export function normalizeEndpointValue(url: string) {
  const trimmed = String(url || "").trim();
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export function runtimeModelIds(): Set<string> {
  return new Set(runtimeModelConfig.map((m) => m.id.replace(/^models\//, "").trim().toLowerCase()));
}

export function runtimeModelDisplayName(model: string): string {
  const norm = model.replace(/^models\//, "").trim().toLowerCase();
  return runtimeModelConfig.find((m) => m.id.replace(/^models\//, "").trim().toLowerCase() === norm)?.displayName || model;
}

export type TokenGuide = {
  enabled?: boolean;
  siteName?: string;
  tokenUrl?: string;
  groupName?: string;
  note?: string;
};

export type AppConfigPayload = {
  upstreams?: Array<{ id: string; name: string; baseUrl: string; note?: string }>;
  models?: RuntimeModelConfig[];
  tokenGuide?: TokenGuide;
  presets?: {
    promptStarters?: unknown[] | null;
    stylePresets?: unknown[] | null;
    industryAgents?: unknown[] | null;
    negativePrompt?: string | null;
  };
};

export let runtimeTokenGuide: TokenGuide | null = null;

export function applyAppConfig(config: AppConfigPayload | null | undefined) {
  if (!config) return;
  runtimeTokenGuide = config.tokenGuide && config.tokenGuide.tokenUrl ? config.tokenGuide : null;
  if (Array.isArray(config.upstreams) && config.upstreams.length > 0) {
    const mapped = config.upstreams.map((u) => ({
      value: normalizeEndpointValue(u.baseUrl),
      label: u.name,
      description: u.note || "",
    }));
    const oauthExtras = runtimeEndpoints.filter(
      (ep) => ep.label.includes("OAuth") && !mapped.some((m) => m.value === ep.value),
    );
    runtimeEndpoints = [...mapped, ...oauthExtras];
  }
  runtimeModelConfig = Array.isArray(config.models) ? config.models : [];
  const presets = config.presets || {};
  runtimePromptStarters = Array.isArray(presets.promptStarters) && presets.promptStarters.length > 0
    ? presets.promptStarters as typeof PROMPT_STARTERS
    : PROMPT_STARTERS;
  runtimeStylePresets = Array.isArray(presets.stylePresets) && presets.stylePresets.length > 0
    ? presets.stylePresets as StyleEnhancement[]
    : STYLE_ENHANCEMENT_PRESETS;
  runtimeIndustryAgents = Array.isArray(presets.industryAgents) && presets.industryAgents.length > 0
    ? presets.industryAgents as IndustryAgent[]
    : INDUSTRY_AGENTS;
  runtimeCommonNegativePrompt = typeof presets.negativePrompt === "string" && presets.negativePrompt.trim()
    ? presets.negativePrompt
    : COMMON_AGENT_NEGATIVE_PROMPT;
}

export let appConfigPromise: Promise<void> | null = null;
export function fetchAppConfig(force = false): Promise<void> {
  if (appConfigPromise && !force) return appConfigPromise;
  appConfigPromise = fetch("/api/config")
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      if (payload && payload.ok) applyAppConfig(payload);
    })
    .catch(() => {
      // 拉取失败时保留内置默认值
    });
  return appConfigPromise;
}

export function normalizeApiBaseUrl(value: string | null | undefined) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  const matched = runtimeEndpoints.find((endpoint) => endpoint.value.replace(/\/+$/, "") === normalized);
  return matched?.value || runtimeEndpoints[0]?.value || DEFAULT_API_URL;
}
