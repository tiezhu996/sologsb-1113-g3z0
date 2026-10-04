import { useCallback } from 'react';
import { useMaintenanceStore } from '../stores/maintenanceStore';
import { useSessionStore } from '../stores/sessionStore';
import type { MaintenanceNotice, MaintenanceOverlap } from '../types';
import { buildMaintenanceOverlaps, capacityInWindow, type CapacityQuery } from '../utils/maintenance';

export interface MaintenanceCheckApi {
  /** 某一观测夜的维护预告 */
  noticesOfNight: (nightId: string) => MaintenanceNotice[];
  /** 容量：同一「望远镜 + 终端」在时段内命中维护预告即归零（0），否则为 1 */
  capacityOf: (query: CapacityQuery) => number;
  /** 维护预告 × 未取消排程段 的交叠对账（保留两边时段、段号与交叠分钟） */
  overlapsOfNight: (nightId: string) => MaintenanceOverlap[];
  /** 单个排程段命中的维护交叠 */
  overlapsOfSession: (sessionId: string) => MaintenanceOverlap[];
}

/** 维护对账派生结果的唯一入口：编排总览、设备分配视图与导出都从这里读同一份结果 */
export function useMaintenanceCheck(): MaintenanceCheckApi {
  const notices = useMaintenanceStore((s) => s.notices);
  const sessions = useSessionStore((s) => s.sessions);

  const noticesOfNight = useCallback((nightId: string) => notices.filter((notice) => notice.nightId === nightId), [notices]);

  const capacityOf = useCallback((query: CapacityQuery) => capacityInWindow(notices, query), [notices]);

  const overlapsOfNight = useCallback((nightId: string) => buildMaintenanceOverlaps(notices, sessions, nightId), [notices, sessions]);

  const overlapsOfSession = useCallback(
    (sessionId: string) => buildMaintenanceOverlaps(notices, sessions.filter((session) => session.id === sessionId)),
    [notices, sessions],
  );

  return { noticesOfNight, capacityOf, overlapsOfNight, overlapsOfSession };
}
