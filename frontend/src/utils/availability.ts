import type {
  Instrument,
  MaintenanceMismatch,
  MaintenanceNotice,
  MaintenanceOverlap,
  ObsSession,
  Telescope,
} from '../types';
import { axisMinutes, overlapMinutes } from './astro';

/** 参与对账的维护预告：未取消的两套来源之一（已完成也保留为执行事实） */
export function isNoticeActive(notice: MaintenanceNotice): boolean {
  return notice.status !== '已取消';
}

/** 预告是否作用于指定终端：整机预告（instrumentId 为空）作用于该望远镜全部终端 */
export function noticeAppliesToInstrument(notice: MaintenanceNotice, instrumentId: string): boolean {
  return !notice.instrumentId || notice.instrumentId === instrumentId;
}

/** 全部来源对账后的统一读模型，总览 / 设备分配 / 导出共用同一结果 */
export interface PlanAvailabilityModel {
  /** 参与对账的维护预告（未取消） */
  notices: MaintenanceNotice[];
  /** 维护预告 × 未取消排程段的交叠记录 */
  overlaps: MaintenanceOverlap[];
  /** 与望远镜 / 终端台账对不上的预告 */
  mismatches: MaintenanceMismatch[];
  /** 被维护时段（容量归零）覆盖的未取消排程段 id */
  blockedSessionIds: Set<string>;
  /** 某观测夜某望远镜某终端在给定时刻是否容量归零（维护时段内） */
  isUnderMaintenance: (nightId: string, telescopeId: string, instrumentId: string, start: string, end: string) => boolean;
  /** 某观测夜某望远镜某终端在某个 30 分钟刻度格内是否处于维护（按格交叠即算） */
  isSlotUnderMaintenance: (nightId: string, telescopeId: string, instrumentId: string, slotStartMinute: number, slotMinutes: number) => boolean;
  /** 与某个排程段交叠的维护预告（按望远镜与终端对账） */
  overlapsOfSession: (sessionId: string) => MaintenanceOverlap[];
  /** 某观测夜的全部交叠记录 */
  overlapsOfNight: (nightId: string) => MaintenanceOverlap[];
  /** 某观测夜的全部参与对账预告 */
  noticesOfNight: (nightId: string) => MaintenanceNotice[];
}

/** 区间（axis 分钟，支持跨零点）交叠分钟 */
function axisOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** 把 HH:mm 区间转成时间轴分钟区间（18:00 起算，跨零点 +1440） */
function toAxisRange(start: string, end: string): [number, number] {
  const s = axisMinutes(start);
  let e = axisMinutes(end);
  if (e <= s) e += 1440;
  return [s, e];
}

/**
 * 合并维护预告与排程段两套来源，按望远镜与终端对账，
 * 产出全应用唯一的容量 / 交叠判定结果。
 */
export function buildPlanModel(input: {
  sessions: ObsSession[];
  notices: MaintenanceNotice[];
  telescopes: Telescope[];
  instruments: Instrument[];
}): PlanAvailabilityModel {
  const { sessions, telescopes, instruments } = input;
  const notices = input.notices.filter(isNoticeActive);

  const telescopeIds = new Set(telescopes.map((item) => item.id));
  const instrumentIds = new Set(instruments.map((item) => item.id));

  // 按望远镜与终端对账：预告引用的望远镜 / 终端必须存在
  const mismatches: MaintenanceMismatch[] = [];
  notices.forEach((notice) => {
    if (!telescopeIds.has(notice.telescopeId)) {
      mismatches.push({
        noticeId: notice.id,
        noticeNo: notice.noticeNo,
        telescopeId: notice.telescopeId,
        instrumentId: notice.instrumentId,
        reason: '维护预告引用的望远镜不存在',
      });
      return;
    }
    if (notice.instrumentId && !instrumentIds.has(notice.instrumentId)) {
      mismatches.push({
        noticeId: notice.id,
        noticeNo: notice.noticeNo,
        telescopeId: notice.telescopeId,
        instrumentId: notice.instrumentId,
        reason: '维护预告引用的终端不存在',
      });
    }
  });

  const validNoticeIds = new Set(notices.filter((notice) => telescopeIds.has(notice.telescopeId)).map((notice) => notice.id));

  // 维护时段与未取消排程段交叠：两边时段、段号与交叠分钟原样保留
  const overlaps: MaintenanceOverlap[] = [];
  const blockedSessionIds = new Set<string>();
  notices.forEach((notice) => {
    if (!validNoticeIds.has(notice.id)) return;
    sessions
      .filter((session) => session.status !== '因云取消')
      .filter((session) => session.nightId === notice.nightId)
      .filter((session) => session.telescopeId === notice.telescopeId)
      .filter((session) => noticeAppliesToInstrument(notice, session.instrumentId))
      .forEach((session) => {
        const minutes = overlapMinutes(notice.startTime, notice.endTime, session.startTime, session.endTime);
        if (minutes > 0) {
          overlaps.push({
            noticeId: notice.id,
            noticeNo: notice.noticeNo,
            nightId: notice.nightId,
            telescopeId: notice.telescopeId,
            instrumentId: notice.instrumentId,
            sessionId: session.id,
            noticeRange: `${notice.startTime}-${notice.endTime}`,
            sessionRange: `${session.startTime}-${session.endTime}`,
            overlapMinutes: minutes,
          });
          blockedSessionIds.add(session.id);
        }
      });
  });

  const relevantNotices = (nightId: string, telescopeId: string, instrumentId: string) =>
    notices.filter(
      (notice) =>
        validNoticeIds.has(notice.id) &&
        notice.nightId === nightId &&
        notice.telescopeId === telescopeId &&
        noticeAppliesToInstrument(notice, instrumentId),
    );

  const isUnderMaintenance = (nightId: string, telescopeId: string, instrumentId: string, start: string, end: string): boolean => {
    const [cStart, cEnd] = toAxisRange(start, end);
    return relevantNotices(nightId, telescopeId, instrumentId).some((notice) => {
      const [nStart, nEnd] = toAxisRange(notice.startTime, notice.endTime);
      return axisOverlap(cStart, cEnd, nStart, nEnd) > 0;
    });
  };

  const isSlotUnderMaintenance = (nightId: string, telescopeId: string, instrumentId: string, slotStartMinute: number, slotMinutes: number): boolean =>
    relevantNotices(nightId, telescopeId, instrumentId).some((notice) => {
      const [nStart, nEnd] = toAxisRange(notice.startTime, notice.endTime);
      return axisOverlap(slotStartMinute, slotStartMinute + slotMinutes, nStart, nEnd) > 0;
    });

  return {
    notices,
    overlaps,
    mismatches,
    blockedSessionIds,
    isUnderMaintenance,
    isSlotUnderMaintenance,
    overlapsOfSession: (sessionId) => overlaps.filter((item) => item.sessionId === sessionId),
    overlapsOfNight: (nightId) => overlaps.filter((item) => item.nightId === nightId),
    noticesOfNight: (nightId) => notices.filter((notice) => notice.nightId === nightId),
  };
}
