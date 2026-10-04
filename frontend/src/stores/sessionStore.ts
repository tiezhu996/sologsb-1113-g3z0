import { create } from 'zustand';
import { db, deleteRow, persistRow, SCHEMA_VERSION } from '../hooks/usePersistentStore';
import { uid } from '../utils/id';
import { buildPlanModel } from '../utils/availability';
import { overlapMinutes } from '../utils/astro';
import { useEquipmentStore } from './equipmentStore';
import { useMaintenanceStore } from './maintenanceStore';
import type { MaintenanceOverlap, ObsSession, SessionStatus } from '../types';

export class MaintenanceBlockedError extends Error {
  overlaps: MaintenanceOverlap[];
  constructor(overlaps: MaintenanceOverlap[]) {
    const detail = overlaps
      .map((item) => `预告 ${item.noticeNo}（${item.noticeRange}）与排程段 ${item.sessionId}（${item.sessionRange}）交叠 ${item.overlapMinutes} 分钟`)
      .join('；');
    super(`维护时段容量归零，拒绝新排程：${detail}`);
    this.name = 'MaintenanceBlockedError';
    this.overlaps = overlaps;
  }
}

export interface SessionInput {
  nightId: string;
  targetId: string;
  startTime: string;
  endTime: string;
  telescopeId: string;
  instrumentId: string;
  filterSlot: string;
  plannedFrames: number;
  status: SessionStatus;
  rescheduleReason?: string;
  backupNightId?: string;
}

/** 用当前两套来源构建容量模型（store 层直接取其它 store 快照，规避 hook 依赖） */
function currentModel() {
  return buildPlanModel({
    sessions: useSessionStore.getState().sessions,
    notices: useMaintenanceStore.getState().notices,
    telescopes: useEquipmentStore.getState().telescopes,
    instruments: useEquipmentStore.getState().instruments,
  });
}

/** 校验候选时段是否落入维护停用区间（容量归零）；忽略自身后仍被覆盖即拒绝 */
export function assertNotUnderMaintenance(input: {
  nightId: string;
  telescopeId: string;
  instrumentId: string;
  startTime: string;
  endTime: string;
  ignoreSessionId?: string;
}): void {
  const model = currentModel();
  // 候选区间与任何（作用于该终端的）维护时段交叠即容量归零
  const blocked = model.isUnderMaintenance(input.nightId, input.telescopeId, input.instrumentId, input.startTime, input.endTime);
  if (!blocked) return;
  // 给出对账明细：排除自身后，覆盖该望远镜/终端该夜的预告
  const overlaps = model.notices
    .filter((notice) => notice.nightId === input.nightId && notice.telescopeId === input.telescopeId)
    .filter((notice) => !notice.instrumentId || notice.instrumentId === input.instrumentId)
    .map((notice) => ({ notice, minutes: overlapMinutes(notice.startTime, notice.endTime, input.startTime, input.endTime) }))
    .filter((item) => item.minutes > 0)
    .map((item) => ({
      noticeId: item.notice.id,
      noticeNo: item.notice.noticeNo,
      nightId: item.notice.nightId,
      telescopeId: item.notice.telescopeId,
      instrumentId: item.notice.instrumentId,
      sessionId: input.ignoreSessionId ?? '__candidate__',
      noticeRange: `${item.notice.startTime}-${item.notice.endTime}`,
      sessionRange: `${input.startTime}-${input.endTime}`,
      overlapMinutes: item.minutes,
    }));
  throw new MaintenanceBlockedError(overlaps);
}

interface SessionState {
  sessions: ObsSession[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addSession: (input: SessionInput) => Promise<ObsSession>;
  updateSession: (id: string, patch: Partial<SessionInput>) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  /** 批量改期到备用观测夜并填写改期原因 */
  rescheduleToBackup: (ids: string[], backupNightId: string, reason: string) => Promise<number>;
  updateStatus: (id: string, status: SessionStatus) => Promise<void>;
}

/** 排程段与冲突检测所需数据 */
export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: [],
  hydrated: false,

  hydrate: async () => {
    const sessions = await db.sessions.orderBy('startTime').toArray();
    set({ sessions, hydrated: true });
  },

  addSession: async (input) => {
    // 维护时段容量归零：拒绝新排程（执行事实不写入）
    assertNotUnderMaintenance(input);
    const session: ObsSession = {
      id: uid('s'),
      nightId: input.nightId,
      targetId: input.targetId,
      startTime: input.startTime,
      endTime: input.endTime,
      telescopeId: input.telescopeId,
      instrumentId: input.instrumentId,
      filterSlot: input.filterSlot,
      plannedFrames: Number(input.plannedFrames) || 0,
      status: input.status,
      rescheduleReason: input.rescheduleReason?.trim() || undefined,
      backupNightId: input.backupNightId,
      schemaVersion: SCHEMA_VERSION,
    };
    await persistRow('sessions', session);
    set({ sessions: [...get().sessions, session] });
    return session;
  },

  updateSession: async (id, patch) => {
    const current = get().sessions.find((session) => session.id === id);
    if (!current) return;
    const merged: SessionInput = {
      nightId: current.nightId,
      targetId: current.targetId,
      startTime: current.startTime,
      endTime: current.endTime,
      telescopeId: current.telescopeId,
      instrumentId: current.instrumentId,
      filterSlot: current.filterSlot,
      plannedFrames: current.plannedFrames,
      status: current.status,
      rescheduleReason: current.rescheduleReason,
      backupNightId: current.backupNightId,
      ...patch,
    };
    // 编辑后落入维护停用区间同样拒绝（忽略自身）
    assertNotUnderMaintenance({ ...merged, ignoreSessionId: id });
    const next: ObsSession = { ...current, ...patch, schemaVersion: SCHEMA_VERSION };
    await persistRow('sessions', next);
    set({ sessions: get().sessions.map((session) => (session.id === id ? next : session)) });
  },

  removeSession: async (id) => {
    await deleteRow('sessions', id);
    set({ sessions: get().sessions.filter((session) => session.id !== id) });
  },

  rescheduleToBackup: async (ids, backupNightId, reason) => {
    const targets = get().sessions.filter((session) => ids.includes(session.id));
    const updated = targets.map((session) => ({
      ...session,
      backupNightId,
      status: '因云取消' as SessionStatus,
      rescheduleReason: reason.trim() || '改期至备用观测夜',
      schemaVersion: SCHEMA_VERSION,
    }));
    for (const session of updated) {
      await persistRow('sessions', session);
    }
    set({ sessions: get().sessions.map((session) => updated.find((item) => item.id === session.id) ?? session) });
    return updated.length;
  },

  updateStatus: async (id, status) => {
    await get().updateSession(id, { status });
  },
}));
