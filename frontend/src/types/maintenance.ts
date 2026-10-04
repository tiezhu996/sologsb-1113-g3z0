/** 设备组临时停用回传（原始消息，feedbackId 为幂等键：重投不新增预告） */
export interface MaintenanceFeedback {
  /** 回传单号（设备组侧唯一，重投去重依据） */
  feedbackId: string;
  /** 观测夜 ID */
  nightId: string;
  /** 望远镜 ID */
  telescopeId: string;
  /** 终端 ID（与望远镜一起对账） */
  instrumentId: string;
  /** 停用开始时刻 HH:mm */
  startTime: string;
  /** 停用结束时刻 HH:mm（可跨零点） */
  endTime: string;
  /** 停用原因 */
  reason: string;
}

/** 维护预告（回传入库后的正式记录，与排程段分属两套来源） */
export interface MaintenanceNotice extends MaintenanceFeedback {
  id: string;
  /** 接收时间 ISO */
  receivedAt: string;
  /** 数据结构版本 */
  schemaVersion: number;
}

/**
 * 维护预告 × 未取消排程段 的交叠对账记录
 * （保留两边时段、段号与交叠分钟；执行事实原样保留，仅派生展示，不回写排程段）
 */
export interface MaintenanceOverlap {
  /** 维护预告 ID */
  noticeId: string;
  /** 回传单号 */
  feedbackId: string;
  /** 排程段段号 */
  sessionId: string;
  nightId: string;
  telescopeId: string;
  instrumentId: string;
  /** 维护时段 */
  noticeStart: string;
  noticeEnd: string;
  /** 排程段时段 */
  sessionStart: string;
  sessionEnd: string;
  /** 交叠分钟数 */
  overlapMinutes: number;
  /** 交叠文案 */
  overlapText: string;
}
