// 共享图片工具（canvas-v2-prd §5.2 C0 拆分）。叶子模块：不 import App.tsx / ../canvas/*。

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export const LIST_THUMB_MAX_EDGE = 512;
export const LIST_THUMB_QUALITY = 0.78;

// 列表缩略图：等比缩放不裁剪。收益在位图解码内存（2048² 原图解码后 16.8MB，512² 只要 1MB）。
// 与 createSquareThumbnail 的区别：入参出参都是 Blob，且小图也会重编码——因为目标是压像素数，
// 原图哪怕体积小，解码后的位图内存仍由像素数决定。
export function createListThumbnail(blob: Blob): Promise<{ blob: Blob; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const sourceUrl = URL.createObjectURL(blob);
    const image = new Image();
    const cleanup = () => URL.revokeObjectURL(sourceUrl);
    image.onload = () => {
      const naturalWidth = image.naturalWidth;
      const naturalHeight = image.naturalHeight;
      const longestEdge = Math.max(naturalWidth, naturalHeight);
      if (!longestEdge) {
        cleanup();
        resolve(null);
        return;
      }
      const scale = Math.min(1, LIST_THUMB_MAX_EDGE / longestEdge);
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) {
        cleanup();
        resolve(null);
        return;
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      cleanup();
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve({ blob: result, width, height });
            return;
          }
          // WebP 编码失败降级 PNG；再失败就放弃缩略图，渲染点会回退原图
          canvas.toBlob(
            (png) => resolve(png ? { blob: png, width, height } : null),
            "image/png",
          );
        },
        "image/webp",
        LIST_THUMB_QUALITY,
      );
    };
    image.onerror = () => {
      cleanup();
      resolve(null);
    };
    image.src = sourceUrl;
  });
}

export function createSquareThumbnail(dataUrl: string, maxEdge = 1024): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const naturalWidth = image.naturalWidth;
      const naturalHeight = image.naturalHeight;
      const longestEdge = Math.max(naturalWidth, naturalHeight);
      if (longestEdge > 0 && longestEdge <= maxEdge) {
        resolve({ dataUrl, width: naturalWidth, height: naturalHeight });
        return;
      }
      const scale = longestEdge > 0 ? Math.min(1, maxEdge / longestEdge) : 1;
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) {
        reject(new Error("无法创建广场压缩图"));
        return;
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      try {
        resolve({ dataUrl: canvas.toDataURL("image/webp", 0.82), width, height });
      } catch {
        resolve({ dataUrl: canvas.toDataURL("image/png"), width, height });
      }
    };
    image.onerror = () => reject(new Error("无法读取广场推荐图"));
    image.src = dataUrl;
  });
}

export async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}

// 原图不可用的原因分类：预览/下载要据此给出具体提示，绝不能静默降级成缩略图
export type FullImageFailReason = "purged" | "lost" | "network";

export class FullImageError extends Error {
  reason: FullImageFailReason;
  status?: number;
  constructor(reason: FullImageFailReason, message: string, status?: number) {
    super(message);
    this.name = "FullImageError";
    this.reason = reason;
    this.status = status;
  }
}

export async function generatedImageToBlob(image: { url?: string; dataUrl?: string }): Promise<Blob> {
  if (image.url) {
    let response: Response;
    try {
      response = await fetch(image.url);
    } catch {
      throw new FullImageError("network", "读取服务器图片失败（网络错误）");
    }
    if (!response.ok) {
      // 404 = 文件已被日志裁剪清理，与网络故障是两回事，提示文案也不同
      throw new FullImageError(
        response.status === 404 ? "purged" : "network",
        `读取服务器图片失败（HTTP ${response.status}）`,
        response.status,
      );
    }
    return response.blob();
  }
  if (image.dataUrl) {
    return dataUrlToBlob(image.dataUrl);
  }
  throw new FullImageError("lost", "响应中没有图片数据");
}

export function getImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("无法读取图片尺寸"));
    image.src = url;
  });
}
