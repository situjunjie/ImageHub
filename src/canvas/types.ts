// Canvas Mode 类型与常量（canvas-v2-prd §5.2 C0 拆分）。
import type { ImageParams, ImageProtocol, JobStages } from "../shared/types";

// ── Canvas Mode Types ──

export type CanvasNodeStatus = "generating" | "success" | "error";

export type CanvasNode = {
  id: string;
  // note = 便签节点（画布上的纯文本标注），没有图片、不参与生成 / 优化 / 导出为图之外的任何流程
  type: "image" | "note";
  x: number;
  y: number;
  width: number;
  height: number;
  prompt: string;
  model: string;
  protocol: ImageProtocol;
  params: ImageParams;
  status: CanvasNodeStatus;
  error?: string;
  parentId?: string;
  referenceNodeId?: string;
  createdAt: number;
  duration?: number;
  imageWidth?: number;
  imageHeight?: number;
  // 服务端任务 ID：页面关闭后靠它去 /api/tasks 把结果找回来
  requestId?: string;
  // 服务端链路时间戳，用于在节点上区分「排队中 / 生成中」
  stages?: JobStages;
  // POST 响应丢失且短时对账仍无结果时，保持 generating 并明确显示“状态确认中”
  submissionState?: "confirming";
  // objectUrl 是原图（下载/优化取参考图用）；thumbUrl 是画布上渲染用的缩略图
  objectUrl?: string;
  thumbUrl?: string;
  // 便签节点专用
  noteText?: string;
  // Pin（roadmap PRD D5）：锁定位置，拖拽与批量移动都跳过。老数据无此字段=未锁定
  pinned?: boolean;
  // 画布生成模块引用的参考图节点 id（有序，= 提交时 referenceImages 顺序）；重试时按它重建参考
  refNodeIds?: string[];
};

// 分组：把一批节点收成一块，可命名、可折叠。成员坐标仍是各自的绝对坐标，
// 分组只是「一层带标题的框」+ 批量移动的入口，不引入父子坐标系。
export type CanvasGroup = {
  id: string;
  name: string;
  nodeIds: string[];
  collapsed: boolean;
};

export type CanvasEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
};

export type CanvasViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type CanvasPanelMode = "generate" | "optimize";

export const CANVAS_SAVE_DEBOUNCE_MS = 500;
export const CANVAS_DEFAULT_NODE_WIDTH = 280;

export type CanvasPersistedState = {
  nodes: Array<Omit<CanvasNode, "objectUrl">>;
  edges: CanvasEdge[];
  // 老数据没有 groups 字段，读回来时按空数组兜底
  groups?: CanvasGroup[];
  viewport: CanvasViewport;
  lastSavedAt: number;
};
