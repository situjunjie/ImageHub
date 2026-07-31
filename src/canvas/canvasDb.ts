import { CANVAS_IMAGES_STORE, CANVAS_STATE_STORE, openDb } from "../shared/db";
import type { CanvasPersistedState } from "./types";

// ── Canvas IndexedDB Persistence ──

export const CANVAS_STATE_KEY = "current";

export async function saveCanvasStateToDB(state: CanvasPersistedState): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CANVAS_STATE_STORE, "readwrite");
    tx.objectStore(CANVAS_STATE_STORE).put(state, CANVAS_STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadCanvasStateFromDB(): Promise<CanvasPersistedState | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CANVAS_STATE_STORE, "readonly");
    const request = tx.objectStore(CANVAS_STATE_STORE).get(CANVAS_STATE_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

// 画布缩略图复用同一个 store，key 加 :thumb 后缀——避免升 IndexedDB 版本，且对老数据天然兼容
export function canvasThumbKey(nodeId: string) {
  return `${nodeId}:thumb`;
}

export async function saveCanvasImageToDB(nodeId: string, blob: Blob): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CANVAS_IMAGES_STORE, "readwrite");
    tx.objectStore(CANVAS_IMAGES_STORE).put(blob, nodeId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadCanvasImageFromDB(nodeId: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CANVAS_IMAGES_STORE, "readonly");
    const request = tx.objectStore(CANVAS_IMAGES_STORE).get(nodeId);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteCanvasImageFromDB(nodeId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CANVAS_IMAGES_STORE, "readwrite");
    tx.objectStore(CANVAS_IMAGES_STORE).delete(nodeId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
