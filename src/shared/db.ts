// IndexedDB 访问层（canvas-v2-prd §5.2 C0 拆分）。openDb 是全库唯一的 upgrade 入口（§5.3 坑 2）。
// 叶子模块：不 import App.tsx / ../canvas/*。
import type { Recipe, ReferenceLibraryItem } from "./types";

export const DB_NAME = "codex-image-batch-studio";
export const STORE_NAME = "history";

export const CANVAS_STATE_STORE = "canvas-state";
export const CANVAS_IMAGES_STORE = "canvas-images";
// 配方快照 + 参考图库（roadmap PRD B2/B3）：全部只存前端 IndexedDB，
// 不上服务端——参考图的服务端红线（仅内存 10 分钟 TTL）保持不变。
export const RECIPES_STORE = "recipes";
export const REFERENCE_LIBRARY_STORE = "reference-library";
export const RECIPES_LIMIT = 50;
export const REFERENCE_LIBRARY_LIMIT = 50;

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // v4：新增配方（recipes）与参考图库（reference-library）两个 store（roadmap PRD B2/B3）。
    // openDb 是全库唯一的 upgrade 入口（canvas-v2-prd §5.3 坑 2），加 store 只能在这里。
    const request = indexedDB.open(DB_NAME, 4);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: "id" });
      if (!store.indexNames.contains("createdAt")) {
        store.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(CANVAS_STATE_STORE)) {
        db.createObjectStore(CANVAS_STATE_STORE);
      }
      if (!db.objectStoreNames.contains(CANVAS_IMAGES_STORE)) {
        db.createObjectStore(CANVAS_IMAGES_STORE);
      }
      if (!db.objectStoreNames.contains(RECIPES_STORE)) {
        db.createObjectStore(RECIPES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(REFERENCE_LIBRARY_STORE)) {
        db.createObjectStore(REFERENCE_LIBRARY_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      if (request.error?.name === "VersionError") {
        const retry = indexedDB.open(DB_NAME);
        retry.onsuccess = () => resolve(retry.result);
        retry.onerror = () => reject(retry.error);
      } else {
        reject(request.error);
      }
    };
  });
}

// ── 配方快照 / 参考图库的通用 IDB 帮手（roadmap PRD B2/B3）──
export async function idbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve((request.result as T[]) || []);
    request.onerror = () => reject(request.error);
  });
}

export async function idbPut(storeName: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value as never);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listRecipes(): Promise<Recipe[]> {
  const all = await idbGetAll<Recipe>(RECIPES_STORE);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveRecipe(recipe: Recipe): Promise<void> {
  const all = await listRecipes();
  // 超限时淘汰最旧的：配方是轻资产，静默滚动即可
  for (const stale of all.slice(RECIPES_LIMIT - 1)) {
    await idbDelete(RECIPES_STORE, stale.id);
  }
  await idbPut(RECIPES_STORE, recipe);
}

export async function listReferenceLibrary(): Promise<ReferenceLibraryItem[]> {
  const all = await idbGetAll<ReferenceLibraryItem>(REFERENCE_LIBRARY_STORE);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveReferenceLibraryItem(item: ReferenceLibraryItem): Promise<void> {
  const all = await listReferenceLibrary();
  if (all.length >= REFERENCE_LIBRARY_LIMIT) {
    throw new Error(`参考图库最多保存 ${REFERENCE_LIBRARY_LIMIT} 张，请先删除一些`);
  }
  await idbPut(REFERENCE_LIBRARY_STORE, item);
}
