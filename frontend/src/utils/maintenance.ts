import type { MaintenanceFeedback, MaintenanceNotice, MaintenanceOverlap, ObsSession } from '../types';
import { overlapMinutes } from './astro';

/** 容量对账查询条件（同一观测夜、同一「望远镜 + 终端」、同一时段） */
export interface CapacityQuery {
  nightId: string;
  telescopeId: string;
  instrumentId: string;
  startTime: string;
  endTime: string;
}

/** 未取消的排程段才参与维护对账（因云取消的不再占用容量） */
function isActiveSession(session: ObsSession): boolean {
  return session.status !== '因云取消';
}

/**
 * 容量：同一观测夜同一「望远镜 + 终端」在查询时段内命中任一维护预告即归零（返回 0），否则为 1。
 * 容量归零的时段拒绝新排程。
 */
export function capacityInWindow(notices: MaintenanceNotice[], query: CapacityQuery): number {
  const hit = notices.some(
    (notice) =>
      notice.nightId === query.nightId &&
      notice.telescopeId === query.telescopeId &&
      notice.instrumentId === query.instrumentId &&
      overlapMinutes(notice.startTime, notice.endTime, query.startTime, query.endTime) > 0,
  );
  return hit ? 0 : 1;
}

/**
 * 维护预告 × 未取消排程段 的交叠对账：按望远镜与终端逐条比对，
 * 每条交叠记录保留两边时段、排程段段号与交叠分钟；排程段本身（执行事实）原样保留，不做任何改写。
 */
export function buildMaintenanceOverlaps(notices: MaintenanceNotice[], sessions: ObsSession[], nightId?: string): MaintenanceOverlap[] {
  const result: MaintenanceOverlap[] = [];
  const scopedNotices = nightId ? notices.filter((notice) => notice.nightId === nightId) : notices;
  for (const notice of scopedNotices) {
    for (const session of sessions) {
      if (session.nightId !== notice.nightId) continue;
      if (session.telescopeId !== notice.telescopeId || session.instrumentId !== notice.instrumentId) continue;
      if (!isActiveSession(session)) continue;
      const minutes = overlapMinutes(notice.startTime, notice.endTime, session.startTime, session.endTime);
      if (minutes <= 0) continue;
      result.push({
        noticeId: notice.id,
        feedbackId: notice.feedbackId,
        sessionId: session.id,
        nightId: notice.nightId,
        telescopeId: notice.telescopeId,
        instrumentId: notice.instrumentId,
        noticeStart: notice.startTime,
        noticeEnd: notice.endTime,
        sessionStart: session.startTime,
        sessionEnd: session.endTime,
        overlapMinutes: minutes,
        overlapText: `预告 ${notice.startTime}-${notice.endTime} × 排程段 ${session.id}（${session.startTime}-${session.endTime}）交叠 ${minutes} 分钟`,
      });
    }
  }
  return result.sort((a, b) => a.nightId.localeCompare(b.nightId) || a.noticeStart.localeCompare(b.noticeStart) || a.sessionId.localeCompare(b.sessionId));
}

/**
 * 设备组临时停用回传（模拟外部 feed）。
 * 含一条已入库重投与一条批内重复，用于验证「重投不新增预告」的幂等处理。
 */
export const DEVICE_TEAM_FEEDBACKS: MaintenanceFeedback[] = [
  { feedbackId: 'FB-20251011-T02-01', nightId: 'night-001', telescopeId: 'tel-002', instrumentId: 'ins-001', startTime: '21:00', endTime: '22:00', reason: '主镜电控临时停用检修' },
  { feedbackId: 'FB-20251012-T01-02', nightId: 'night-002', telescopeId: 'tel-001', instrumentId: 'ins-002', startTime: '01:30', endTime: '02:30', reason: '导星相机固件升级，临时停用' },
  { feedbackId: 'FB-20251012-T02-03', nightId: 'night-002', telescopeId: 'tel-002', instrumentId: 'ins-001', startTime: '20:00', endTime: '21:00', reason: '主镜电控复位自检' },
  { feedbackId: 'FB-20251012-T01-02', nightId: 'night-002', telescopeId: 'tel-001', instrumentId: 'ins-002', startTime: '01:30', endTime: '02:30', reason: '导星相机固件升级，临时停用（重投）' },
];
