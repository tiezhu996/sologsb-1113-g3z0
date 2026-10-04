/** 维护预告状态（设备组回传） */
export type MaintenanceStatus = '已预告' | '进行中' | '已完成' | '已取消';

/**
 * 维护预告：设备组回传的临时停用通知，与排程段（ObsSession）是两套独立来源，
 * 只按观测夜 + 望远镜 + 终端对账，不改动任何执行事实。
 */
export interface MaintenanceNotice {
  id: string;
  /** 设备组回传编号（唯一，重投去重依据） */
  noticeNo: string;
  /** 观测夜 ID（与排程段按夜对账） */
  nightId: string;
  /** 开始时刻 HH:mm */
  startTime: string;
  /** 结束时刻 HH:mm（可跨零点） */
  endTime: string;
  /** 望远镜 ID */
  telescopeId: string;
  /** 终端 ID：空串表示望远镜整机停用（该望远镜所有终端容量归零） */
  instrumentId: string;
  /** 停用原因 */
  reason: string;
  /** 状态 */
  status: MaintenanceStatus;
  /** 设备组回传时间 ISO */
  receivedAt: string;
  /** 数据结构版本 */
  schemaVersion: number;
}

/** 维护预告与未取消排程段的交叠对账结果（两边时段原样保留） */
export interface MaintenanceOverlap {
  /** 维护预告 ID */
  noticeId: string;
  /** 维护回传编号 */
  noticeNo: string;
  nightId: string;
  telescopeId: string;
  instrumentId: string;
  /** 交叠的未取消排程段段号 */
  sessionId: string;
  /** 维护时段文案 */
  noticeRange: string;
  /** 排程段时段文案 */
  sessionRange: string;
  /** 交叠分钟数 */
  overlapMinutes: number;
}

/** 终端 / 望远镜对不上账的预告（按望远镜与终端对账时发现） */
export interface MaintenanceMismatch {
  noticeId: string;
  noticeNo: string;
  telescopeId: string;
  instrumentId: string;
  reason: string;
}

export const MAINTENANCE_STATUSES: MaintenanceStatus[] = ['已预告', '进行中', '已完成', '已取消'];
