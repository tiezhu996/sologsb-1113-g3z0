import { create } from 'zustand';
import {
  db,
  deleteRow,
  getMaintenanceCursor,
  ingestMaintenanceNotices,
  persistRow,
  type MaintenanceCursor,
  type MaintenanceIngestInput,
} from '../hooks/usePersistentStore';
import type { MaintenanceNotice, MaintenanceStatus } from '../types';

interface MaintenanceState {
  notices: MaintenanceNotice[];
  /** 写入失败、等待从检查点重试的回传批次 */
  pending: MaintenanceIngestInput[];
  /** 最后一次写入失败原因 */
  lastError: string;
  cursor: MaintenanceCursor | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /**
   * 接收设备组回传（幂等）：重投同编号不新增预告。
   * 写入失败时整批留在 pending，可调用 retryPending 从检查点续投。
   */
  ingest: (inputs: MaintenanceIngestInput[]) => Promise<{ inserted: number; skipped: number }>;
  /** 从检查点重试上次失败的回传（已落库编号自动跳过，不新增预告） */
  retryPending: () => Promise<{ inserted: number; skipped: number }>;
  updateNotice: (id: string, patch: Partial<Pick<MaintenanceNotice, 'status' | 'reason'>>) => Promise<void>;
  removeNotice: (id: string) => Promise<void>;
  clearError: () => void;
}

/** 维护预告（设备组回传的第二来源），只与排程段对账，不改动执行事实 */
export const useMaintenanceStore = create<MaintenanceState>()((set, get) => ({
  notices: [],
  pending: [],
  lastError: '',
  cursor: null,
  hydrated: false,

  hydrate: async () => {
    const [notices, cursor] = await Promise.all([
      db.maintenanceNotices.orderBy('receivedAt').toArray(),
      getMaintenanceCursor(),
    ]);
    set({ notices, cursor, hydrated: true });
  },

  ingest: async (inputs) => {
    try {
      const result = await ingestMaintenanceNotices(inputs);
      const fresh = await db.maintenanceNotices.orderBy('receivedAt').toArray();
      set({ notices: fresh, pending: [], lastError: '', cursor: result.cursor });
      return { inserted: result.inserted, skipped: result.processed.length - result.inserted };
    } catch (reason) {
      // 整批保留：已原子提交的条目重投时按 noticeNo 跳过，未提交的从检查点继续
      set({ pending: inputs, lastError: (reason as Error).message });
      throw reason;
    }
  },

  retryPending: async () => {
    const pending = get().pending;
    if (pending.length === 0) return { inserted: 0, skipped: 0 };
    const result = await get().ingest(pending);
    return result;
  },

  updateNotice: async (id, patch) => {
    const current = get().notices.find((notice) => notice.id === id);
    if (!current) return;
    const next: MaintenanceNotice = { ...current, ...patch };
    await persistRow('maintenanceNotices', next);
    set({ notices: get().notices.map((notice) => (notice.id === id ? next : notice)) });
  },

  removeNotice: async (id) => {
    await deleteRow('maintenanceNotices', id);
    set({ notices: get().notices.filter((notice) => notice.id !== id) });
  },

  clearError: () => set({ lastError: '', pending: [] }),
}));
