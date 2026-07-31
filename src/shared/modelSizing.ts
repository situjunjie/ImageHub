// 模型族判定 + 尺寸表（canvas-v2-prd §5.2 C0 拆分）。前后端尺寸表需保持同步（见 CLAUDE.md）。
// 叶子模块：不 import App.tsx / ../canvas/*。
import type { ImageProtocol, ImageResolution } from "./types";
import { DEFAULT_API_URL } from "./appConfig";

export const DEFAULT_IMAGE_RESOLUTION: ImageResolution = "1K";
export const GPT_IMAGE_2_MODEL = "gpt-image-2";
export const GPT_IMAGE_2_PRO_MODEL = "gpt-image-2-pro";
export const GPT_IMAGE_2_FAMILY_MODEL = "gpt-5.4-image-2";
export const GEMINI_3_PRO_IMAGE_MODEL = "gemini-3-pro-image-preview";

export const ASPECT_RATIOS = [
  { value: "1:1", label: "1:1 方图 · 1024x1024", hint: "GPT Image 官方方图尺寸" },
  { value: "4:5", label: "4:5 竖版社媒", hint: "小红书、信息流、电商卡片" },
  { value: "5:4", label: "5:4 横版产品", hint: "商品展示、横版构图" },
  { value: "3:4", label: "3:4 竖版照片", hint: "人像、封面、海报草图" },
  { value: "4:3", label: "4:3 经典横图", hint: "摄影、PPT、内容插图" },
  { value: "2:3", label: "2:3 竖图 · 1024x1536", hint: "GPT Image 官方竖图尺寸" },
  { value: "3:2", label: "3:2 横图 · 1536x1024", hint: "GPT Image 官方横图尺寸" },
  { value: "9:16", label: "9:16 手机竖屏", hint: "短视频封面、Story、壁纸" },
  { value: "16:9", label: "16:9 宽屏", hint: "视频封面、网页头图、桌面壁纸" },
  { value: "21:9", label: "21:9 超宽屏", hint: "横幅、电影感场景" },
  { value: "9:21", label: "9:21 长竖屏", hint: "长屏海报、移动端素材" },
  { value: "12:5", label: "12:5 4K 超宽", hint: "GPT Image 2 4K 超宽输出尺寸 3840x1600" },
  { value: "5:12", label: "5:12 4K 超高", hint: "GPT Image 2 4K 超高输出尺寸 1600x3840" },
  { value: "4:1", label: "4:1 横幅", hint: "Banner、页面横幅" },
  { value: "1:4", label: "1:4 长图", hint: "竖向长图、信息流素材" },
  { value: "8:1", label: "8:1 超横幅", hint: "超宽展示屏、高级模式" },
  { value: "1:8", label: "1:8 超长图", hint: "特殊竖向长图、高级模式" },
] as const;

export const ALL_ASPECT_RATIOS = ASPECT_RATIOS.map((ratio) => ratio.value);
export const GPT_IMAGE_SUPPORTED_ASPECT_RATIOS = ["1:1", "2:3", "3:2"] as const;
export const GPT_IMAGE_2_PRO_1K_SUPPORTED_ASPECT_RATIOS = ["1:1", "4:5", "5:4", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "21:9"] as const;
export const GEMINI_3_PRO_SUPPORTED_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;

export const IMAGEN_ASPECT_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
export const STABILITY_ASPECT_RATIOS = ["16:9", "1:1", "21:9", "2:3", "3:2", "4:5", "5:4", "9:16", "9:21"];
export const OPENAI_ASPECT_RATIOS = [...GPT_IMAGE_SUPPORTED_ASPECT_RATIOS];

export const SIZE_BY_RATIO: Record<string, string> = {
  "1:1": "1024x1024",
  "4:5": "1024x1280",
  "5:4": "1280x1024",
  "3:4": "1152x1536",
  "4:3": "1536x1152",
  "2:3": "1024x1536",
  "3:2": "1536x1024",
  "9:16": "1024x1792",
  "16:9": "1792x1024",
  "21:9": "2016x864",
  "9:21": "864x2016",
  "12:5": "2016x840",
  "5:12": "840x2016",
  "4:1": "2048x512",
  "1:4": "512x2048",
  "8:1": "2048x256",
  "1:8": "256x2048",
};

export const GPT_IMAGE_2_SIZE_OPTIONS: Array<{
  size: string;
  aspectRatio: string;
  resolution: Exclude<ImageResolution, "1K">;
  label: string;
}> = [
  { size: "2560x1440", aspectRatio: "16:9", resolution: "2K", label: "2K QHD 横屏" },
  { size: "1440x2560", aspectRatio: "9:16", resolution: "2K", label: "2K QHD 竖屏" },
  { size: "2048x1152", aspectRatio: "16:9", resolution: "2K", label: "2K 16:9 横屏" },
  { size: "1152x2048", aspectRatio: "9:16", resolution: "2K", label: "2K 9:16 竖屏" },
  { size: "2048x2048", aspectRatio: "1:1", resolution: "2K", label: "2K 方图" },
  { size: "2048x1536", aspectRatio: "4:3", resolution: "2K", label: "2K 4:3 横图" },
  { size: "1536x2048", aspectRatio: "3:4", resolution: "2K", label: "2K 3:4 竖图" },
  { size: "2048x3072", aspectRatio: "2:3", resolution: "2K", label: "2K 2:3 竖图" },
  { size: "3072x2048", aspectRatio: "3:2", resolution: "2K", label: "2K 3:2 横图" },
  { size: "3840x2160", aspectRatio: "16:9", resolution: "4K", label: "4K UHD 横屏" },
  { size: "2160x3840", aspectRatio: "9:16", resolution: "4K", label: "4K UHD 竖屏" },
  { size: "3840x1600", aspectRatio: "12:5", resolution: "4K", label: "4K 超宽" },
  { size: "1600x3840", aspectRatio: "5:12", resolution: "4K", label: "4K 超高" },
];

export const GPT_IMAGE_2_2K_SUPPORTED_ASPECT_RATIOS = [...new Set(
  GPT_IMAGE_2_SIZE_OPTIONS.filter((option) => option.resolution === "2K").map((option) => option.aspectRatio),
)];
export const GPT_IMAGE_2_4K_SUPPORTED_ASPECT_RATIOS = [...new Set(
  GPT_IMAGE_2_SIZE_OPTIONS.filter((option) => option.resolution === "4K").map((option) => option.aspectRatio),
)];

export const GEMINI_3_PRO_SIZE_BY_RATIO: Record<string, string> = {
  "1:1": "1024x1024",
  "2:3": "832x1248",
  "3:2": "1248x832",
  "3:4": "896x1200",
  "4:3": "1200x896",
  "4:5": "864x1088",
  "5:4": "1088x864",
  "9:16": "768x1344",
  "16:9": "1344x768",
  "21:9": "1536x672",
};

export const IMAGE_RESOLUTIONS: Array<{ value: ImageResolution; label: string; hint: string; multiplier: number }> = [
  { value: "1K", label: "1K 标准", hint: "速度优先，适合批量预览", multiplier: 1 },
  { value: "2K", label: "2K 高清", hint: "更清晰，适合交付候选", multiplier: 2 },
  { value: "4K", label: "4K 超清", hint: "高成本，取决于模型支持", multiplier: 4 },
];

export const PROTOCOLS: Array<{
  value: ImageProtocol;
  label: string;
  shortLabel: string;
  description: string;
  defaultBaseUrl: string;
  defaultModels: string[];
  supportedAspectRatios: string[];
  supportsReferenceImages: boolean;
  supportsNegativePrompt: boolean;
  supportsQuality: boolean;
  supportsOutputFormat: boolean;
}> = [
  {
    value: "custom-openai",
    label: "OpenAI 兼容",
    shortLabel: "兼容协议",
    description: "适合第三方中转或自建 OpenAI 风格图片接口",
    defaultBaseUrl: DEFAULT_API_URL,
    defaultModels: [GPT_IMAGE_2_MODEL, GPT_IMAGE_2_PRO_MODEL, GPT_IMAGE_2_FAMILY_MODEL],
    supportedAspectRatios: ALL_ASPECT_RATIOS,
    supportsReferenceImages: true,
    supportsNegativePrompt: true,
    supportsQuality: true,
    supportsOutputFormat: true,
  },
  {
    value: "openai-images",
    label: "OpenAI Images",
    shortLabel: "OpenAI",
    description: "OpenAI 风格 Images API，宽高比会转换为 size 参数",
    defaultBaseUrl: DEFAULT_API_URL,
    defaultModels: [GPT_IMAGE_2_MODEL, GPT_IMAGE_2_PRO_MODEL, GPT_IMAGE_2_FAMILY_MODEL],
    supportedAspectRatios: OPENAI_ASPECT_RATIOS,
    supportsReferenceImages: true,
    supportsNegativePrompt: true,
    supportsQuality: true,
    supportsOutputFormat: true,
  },
  {
    value: "openai-responses",
    label: "OpenAI Responses",
    shortLabel: "Responses",
    description: "适合对话式生成和后续多轮改图",
    defaultBaseUrl: DEFAULT_API_URL,
    defaultModels: ["gpt-4.1", "gpt-4.1-mini"],
    supportedAspectRatios: OPENAI_ASPECT_RATIOS,
    supportsReferenceImages: false,
    supportsNegativePrompt: true,
    supportsQuality: true,
    supportsOutputFormat: true,
  },
  {
    value: "gemini-native",
    label: "Gemini Native",
    shortLabel: "Gemini",
    description: "Google Gemini 原生 generateContent 生图/改图",
    defaultBaseUrl: DEFAULT_API_URL,
    defaultModels: [GEMINI_3_PRO_IMAGE_MODEL, "gemini-2.5-flash-image", "gemini-2.0-flash-preview-image-generation"],
    supportedAspectRatios: [...GEMINI_3_PRO_SUPPORTED_ASPECT_RATIOS],
    supportsReferenceImages: true,
    supportsNegativePrompt: true,
    supportsQuality: false,
    supportsOutputFormat: true,
  },
  {
    value: "gemini-openai",
    label: "Gemini OpenAI 兼容",
    shortLabel: "Gemini 兼容",
    description: "Gemini 的 OpenAI 兼容接口，适合快速迁移",
    defaultBaseUrl: DEFAULT_API_URL,
    defaultModels: ["gemini-2.5-flash-image"],
    supportedAspectRatios: OPENAI_ASPECT_RATIOS,
    supportsReferenceImages: false,
    supportsNegativePrompt: true,
    supportsQuality: false,
    supportsOutputFormat: true,
  },
  {
    value: "google-imagen",
    label: "Google Imagen",
    shortLabel: "Imagen",
    description: "Imagen 系列文生图，比例范围较明确",
    defaultBaseUrl: DEFAULT_API_URL,
    defaultModels: ["imagen-4.0-generate-001", "imagen-4.0-ultra-generate-001", "imagen-3.0-generate-002"],
    supportedAspectRatios: IMAGEN_ASPECT_RATIOS,
    supportsReferenceImages: false,
    supportsNegativePrompt: true,
    supportsQuality: false,
    supportsOutputFormat: true,
  },
  {
    value: "stability-core",
    label: "Stability Core",
    shortLabel: "Stability",
    description: "Stability AI Stable Image Core/Ultra 风格接口",
    defaultBaseUrl: DEFAULT_API_URL,
    defaultModels: ["stable-image-core"],
    supportedAspectRatios: STABILITY_ASPECT_RATIOS,
    supportsReferenceImages: false,
    supportsNegativePrompt: true,
    supportsQuality: false,
    supportsOutputFormat: true,
  },
];

export function getProtocolDefinition(protocol: ImageProtocol) {
  return PROTOCOLS.find((item) => item.value === protocol) || PROTOCOLS[0];
}

export function normalizedImageModelId(model = "") {
  return model.replace(/^models\//, "").trim().toLowerCase();
}

export function isGptImage2Model(model = "") {
  const normalized = normalizedImageModelId(model);
  return normalized === GPT_IMAGE_2_MODEL || normalized === GPT_IMAGE_2_FAMILY_MODEL || normalized.includes("image-2");
}

export function isGptImage2ProModel(model = "") {
  return normalizedImageModelId(model) === GPT_IMAGE_2_PRO_MODEL;
}

export function supportsGptImage2ExplicitSizes(model = "") {
  const normalized = normalizedImageModelId(model);
  return normalized === GPT_IMAGE_2_MODEL || normalized === GPT_IMAGE_2_PRO_MODEL;
}

export function isGemini3ProImageModel(model = "") {
  return normalizedImageModelId(model) === GEMINI_3_PRO_IMAGE_MODEL;
}

export function imageModelLaneLabel(model: string) {
  if (isGemini3ProImageModel(model)) return "Gemini 原生接口";
  if (isGptImage2ProModel(model)) return "GPT Image 2 Pro 接口";
  if (isGptImage2Model(model)) return "GPT Image 2 接口";
  return "图片模型";
}

export function usesOfficialGptImageSizing(protocol: ImageProtocol, model = "") {
  return isGptImage2Model(model) && !supportsGptImage2ExplicitSizes(model) && (
    protocol === "custom-openai"
    || protocol === "openai-images"
    || protocol === "openai-responses"
  );
}

export function gptImage2SizeOptionsForResolution(resolution: ImageResolution) {
  return GPT_IMAGE_2_SIZE_OPTIONS.filter((option) => option.resolution === resolution);
}

export function gptImage2SizeOptionForSize(size = "") {
  return GPT_IMAGE_2_SIZE_OPTIONS.find((option) => option.size === size);
}

export function gptImage2DefaultSizeOption(aspectRatio: string, resolution: ImageResolution) {
  const options = gptImage2SizeOptionsForResolution(resolution);
  return options.find((option) => option.aspectRatio === aspectRatio) || options[0];
}

export function explicitSizeOptionsForModel(model: string, resolution: ImageResolution) {
  return supportsGptImage2ExplicitSizes(model) ? gptImage2SizeOptionsForResolution(resolution) : [];
}

export function getSupportedAspectRatios(
  protocol: ImageProtocol,
  model = "",
  resolution: ImageResolution = DEFAULT_IMAGE_RESOLUTION,
) {
  if (isGemini3ProImageModel(model) && protocol === "gemini-native") {
    return [...GEMINI_3_PRO_SUPPORTED_ASPECT_RATIOS];
  }
  if (supportsGptImage2ExplicitSizes(model)) {
    const res = safeImageResolution(resolution);
    if (res === "4K") return [...GPT_IMAGE_2_4K_SUPPORTED_ASPECT_RATIOS];
    if (res === "2K") return [...GPT_IMAGE_2_2K_SUPPORTED_ASPECT_RATIOS];
    return [...GPT_IMAGE_2_PRO_1K_SUPPORTED_ASPECT_RATIOS];
  }
  if (usesOfficialGptImageSizing(protocol, model)) {
    return [...GPT_IMAGE_SUPPORTED_ASPECT_RATIOS];
  }
  return getProtocolDefinition(protocol).supportedAspectRatios;
}

export function isImageResolution(value: unknown): value is ImageResolution {
  return value === "1K" || value === "2K" || value === "4K";
}

export function safeImageResolution(value: unknown): ImageResolution {
  return isImageResolution(value) ? value : DEFAULT_IMAGE_RESOLUTION;
}

export function scaleSize(size: string, resolution: ImageResolution) {
  const [width, height] = size.split("x").map((item) => Number(item));
  const multiplier = IMAGE_RESOLUTIONS.find((item) => item.value === resolution)?.multiplier || 1;
  if (!Number.isFinite(width) || !Number.isFinite(height) || multiplier === 1) return size;
  const MAX_EDGE = 3840;
  let w = Math.round(width * multiplier);
  let h = Math.round(height * multiplier);
  const longest = Math.max(w, h);
  if (longest > MAX_EDGE) {
    const factor = MAX_EDGE / longest;
    w = Math.round(width * multiplier * factor);
    h = Math.round(height * multiplier * factor);
  }
  return `${w}x${h}`;
}

export function baseSizeForModel(aspectRatio: string, protocol: ImageProtocol, model = "") {
  if (isGemini3ProImageModel(model) && protocol === "gemini-native") {
    return GEMINI_3_PRO_SIZE_BY_RATIO[aspectRatio] || GEMINI_3_PRO_SIZE_BY_RATIO["1:1"];
  }
  return SIZE_BY_RATIO[aspectRatio] || SIZE_BY_RATIO["1:1"];
}

export function resolveRequestSize(
  aspectRatio: string,
  resolution: ImageResolution = DEFAULT_IMAGE_RESOLUTION,
  protocol: ImageProtocol,
  model = "",
  preferredSize = "",
) {
  const baseSize = baseSizeForModel(aspectRatio, protocol, model);
  if (usesOfficialGptImageSizing(protocol, model)) return baseSize;
  if (supportsGptImage2ExplicitSizes(model)) {
    const res = safeImageResolution(resolution);
    const preferredOption = gptImage2SizeOptionForSize(preferredSize);
    if (preferredOption && preferredOption.resolution === res && preferredOption.aspectRatio === aspectRatio) {
      return preferredOption.size;
    }
    const defaultOption = gptImage2DefaultSizeOption(aspectRatio, res);
    if (defaultOption) return defaultOption.size;
    return baseSize;
  }
  return scaleSize(baseSize, safeImageResolution(resolution));
}

export function aspectRatioNumber(aspectRatio?: string) {
  if (!aspectRatio) return 1;
  const [width, height] = aspectRatio.split(":").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
  return width / height;
}
