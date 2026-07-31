import { AlertCircle, Loader2, Pin } from "lucide-react";
import { memo } from "react";
import { formatDuration } from "../shared/utils";
import type { CanvasNode } from "./types";

// 画布节点：memo 化 —— 拖拽/生成时只重渲染发生变化的节点（性能关键路径）
export type CanvasNodeHandlers = {
  onNodePointerDown: (e: React.PointerEvent, node: CanvasNode) => void;
  onNodeOptimize: (node: CanvasNode) => void;
  onNoteEdit: (nodeId: string | null) => void;
  onNoteChange: (nodeId: string, text: string) => void;
  // 派生把手（roadmap PRD D1）：从节点右缘拖出一条线，松手即建优化子节点
  onDeriveStart: (e: React.PointerEvent, node: CanvasNode) => void;
};

export const CanvasNodeView = memo(function CanvasNodeView({
  node,
  selected,
  dragging,
  lodTier,
  editingNote,
  handlersRef,
}: {
  node: CanvasNode;
  selected: boolean;
  dragging: boolean;
  lodTier: "thumb" | "full";
  editingNote: boolean;
  handlersRef: { current: CanvasNodeHandlers };
}) {
  if (node.type === "note") {
    return (
      <div
        className={`canvas-node canvas-note ${selected ? "selected" : ""} ${dragging ? "dragging" : ""}`}
        data-node-id={node.id}
        style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
        // 编辑态不接管 pointerdown，否则光标没法在 textarea 里定位
        onPointerDown={(e) => { if (!editingNote) handlersRef.current.onNodePointerDown(e, node); }}
        onDoubleClick={() => handlersRef.current.onNoteEdit(node.id)}
      >
        {editingNote ? (
          <textarea
            className="canvas-note-input"
            autoFocus
            value={node.noteText || ""}
            placeholder="写点什么…"
            onChange={(e) => handlersRef.current.onNoteChange(node.id, e.target.value)}
            onBlur={() => handlersRef.current.onNoteEdit(null)}
          />
        ) : (
          <div className="canvas-note-text">
            {node.noteText || <span className="canvas-note-placeholder">双击编辑便签</span>}
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      className={`canvas-node ${node.status} ${selected ? "selected" : ""} ${dragging ? "dragging" : ""}`}
      data-node-id={node.id}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onPointerDown={(e) => handlersRef.current.onNodePointerDown(e, node)}
      onDoubleClick={() => {
        if (node.status === "success") handlersRef.current.onNodeOptimize(node);
      }}
    >
      {node.status === "success" && node.objectUrl && (
        <img
          // 缩略图只有 512px：节点默认 280px 宽，在 Retina 上就需要 560px，
          // 所以只有缩小到缩略图够用时才降级，否则一律原图，避免画布上看到糊图
          src={lodTier === "thumb" ? (node.thumbUrl ?? node.objectUrl) : node.objectUrl}
          alt=""
          draggable={false}
          className="canvas-node-image"
        />
      )}
      {node.status === "generating" && (
        <div className="canvas-node-skeleton">
          <Loader2 size={24} className="spin" />
          {/* 用服务端已返回的 stages 区分「排队中」与「生成中」，
              异步化后排队可能持续一段时间，不区分会让用户以为卡住了 */}
          <span>
            {node.submissionState === "confirming"
              ? "状态确认中..."
              : node.stages?.dispatchedAt
                ? "生成中..."
                : node.stages
                  ? "排队中..."
                  : "提交中..."}
          </span>
        </div>
      )}
      {node.status === "error" && (
        <div className="canvas-node-error-content">
          <AlertCircle size={20} />
          <span>{node.error || "生成失败"}</span>
        </div>
      )}
      {node.status === "success" && (
        <>
          <span className="canvas-node-badge">{node.model}</span>
          {node.duration != null && (
            <span className="canvas-node-duration">{formatDuration(node.duration)}</span>
          )}
        </>
      )}
      {node.pinned && (
        <span className="canvas-node-pin" title="位置已锁定（右键可解除）">
          <Pin size={12} />
        </span>
      )}
      {selected && node.status === "success" && (
        <button
          type="button"
          className="canvas-node-derive-handle"
          title="拖出以基于此图派生新图"
          onPointerDown={(e) => handlersRef.current.onDeriveStart(e, node)}
        />
      )}
    </div>
  );
}, (prev, next) =>
  prev.node === next.node &&
  prev.selected === next.selected &&
  prev.dragging === next.dragging &&
  prev.editingNote === next.editingNote &&
  prev.lodTier === next.lodTier
);
