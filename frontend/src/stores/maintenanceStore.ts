import { create } from 'zustand';
import { db, deleteRow, MAINTENANCE_CHECKPOINT_KEY, SCHEMA_VERSION } from '../hooks/usePersistentStore';
import { uid } from '../utils/id';
import type { MaintenanceFeedback, MaintenanceNotice } from '../types';

export interface IngestResult {
  /** 新增预告条数 */
  added: number;
  /** 重投跳过条数（不新增预告） */
  skipped: number;
  /** 处理完成后停留的检查点（回传单号） */
  checkpoint: string;
}

interface MaintenanceState {
  notices: MaintenanceNotice[];
  /** 已处理到的回传检查点 */
  checkpoint: string;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /**
   * 接收设备组临时停用回传：逐条把「预告 + 检查点」放进同一事务写入；
   * 任一写入失败都停留在上一个检查点，可从检查点重试；重投按 feedbackId 去重，不新增预告
   */
  ingestFeedbacks: (feedbacks: MaintenanceFeedback[]) => Promise<IngestResult>;
  removeNotice: (id: string) => Promise<void>;
}

/** 维护预告（设备组回传）：独立于排程段的第二套来源 */
export const useMaintenanceStore = create<MaintenanceState>()((set, get) => ({
  notices: [],
  checkpoint: '',
  hydrated: false,

  hydrate: async () => {
    const [notices, checkpointRow] = await Promise.all([db.maintenances.toArray(), db.meta.get(MAINTENANCE_CHECKPOINT_KEY)]);
    set({ notices, checkpoint: checkpointRow?.value ?? '', hydrated: true });
  },

  ingestFeedbacks: async (feedbacks) => {
    const known = new Set(get().notices.map((notice) => notice.feedbackId));
    let added = 0;
    let skipped = 0;
    let checkpoint = get().checkpoint;
    for (const feedback of feedbacks) {
      if (known.has(feedback.feedbackId)) {
        skipped += 1;
        continue;
      }
      const notice: MaintenanceNotice = {
        ...feedback,
        id: uid('mnt'),
        receivedAt: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
      };
      // 预告与检查点同一事务提交：任一步失败两者都不落库，重试从上一个检查点继续
      await db.transaction('rw', db.maintenances, db.meta, async () => {
        await db.maintenances.put(notice);
        await db.meta.put({ key: MAINTENANCE_CHECKPOINT_KEY, value: feedback.feedbackId });
      });
      known.add(feedback.feedbackId);
      checkpoint = feedback.feedbackId;
      added += 1;
      set({ notices: [...get().notices, notice], checkpoint });
    }
    return { added, skipped, checkpoint };
  },

  removeNotice: async (id) => {
    await deleteRow('maintenances', id);
    set({ notices: get().notices.filter((notice) => notice.id !== id) });
  },
}));
