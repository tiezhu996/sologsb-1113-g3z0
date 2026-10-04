import type { Instrument, MaintenanceNotice, MaintenanceOverlap, ObsNight, ObsSession, ObsTarget, Telescope } from '../types';

export interface PlanContext {
  night?: ObsNight;
  sessions: ObsSession[];
  targets: ObsTarget[];
  telescopes: Telescope[];
  instruments: Instrument[];
  /** 维护预告（第二来源），与排程段读同一对账结果 */
  notices?: MaintenanceNotice[];
  /** 维护时段 × 未取消排程段交叠明细（两边时段、段号、交叠分钟） */
  maintenanceOverlaps?: MaintenanceOverlap[];
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** 生成当晚观测清单文本（目标、时刻、滤镜、帧数；执行事实原样保留，附维护对账） */
export function buildNightPlanText(context: PlanContext): string {
  const { night, sessions, targets, telescopes, instruments, notices = [], maintenanceOverlaps: overlaps = [] } = context;
  const lines: string[] = [];
  lines.push('天文观测夜编排表');
  lines.push(`观测夜：${night?.date ?? '-'}　站点：${night?.siteName ?? '-'}　值班人：${night?.dutyOfficer ?? '-'}`);
  lines.push(
    `月相：${night ? `${night.moonPhasePct}%（${night.moonrise} 月出 / ${night.moonset} 月落）` : '-'}　日落日出：${
      night ? `${night.sunset} / ${night.sunrise}` : '-'
    }　云量预报：${night?.cloudText ?? '-'}`,
  );
  lines.push('-'.repeat(96));
  lines.push('序 时段           目标            望远镜   终端            滤镜  帧数  状态      备注');
  const ordered = [...sessions].sort((a, b) => a.startTime.localeCompare(b.startTime));
  ordered.forEach((session, index) => {
    const target = targets.find((item) => item.id === session.targetId);
    const telescope = telescopes.find((item) => item.id === session.telescopeId);
    const instrument = instruments.find((item) => item.id === session.instrumentId);
    lines.push(
      [
        pad(index + 1),
        `${session.startTime}-${session.endTime}`.padEnd(14, ' '),
        `${target?.name ?? '未知目标'}（${target?.catalog ?? '-'}）`.padEnd(24, ' '),
        (telescope?.code ?? '-').padEnd(8, ' '),
        (instrument?.model ?? '-').padEnd(16, ' '),
        session.filterSlot.padEnd(6, ' '),
        pad(session.plannedFrames, 4),
        session.status.padEnd(8, ' '),
        session.rescheduleReason ?? '',
      ].join(' '),
    );
  });
  lines.push('-'.repeat(96));
  const totalFrames = ordered.reduce((sum, session) => sum + session.plannedFrames, 0);
  const totalExposure = ordered.reduce((sum, session) => {
    const target = targets.find((item) => item.id === session.targetId);
    return sum + (target ? (session.plannedFrames * target.exposureSec) / 60 : 0);
  }, 0);
  lines.push(`合计排程段 ${ordered.length} 段，计划帧数 ${totalFrames} 帧，预计曝光 ${totalExposure.toFixed(1)} 分钟`);

  // 维护时段（第二来源，按望远镜与终端对账）
  lines.push('');
  lines.push('维护时段（设备组回传，容量归零）');
  lines.push('-'.repeat(96));
  if (notices.length === 0) {
    lines.push('无未取消维护预告，全部设备可用');
  } else {
    notices
      .slice()
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .forEach((notice) => {
        const telescope = telescopes.find((item) => item.id === notice.telescopeId);
        const instrument = instruments.find((item) => item.id === notice.instrumentId);
        lines.push(
          `${notice.noticeNo} ${notice.startTime}-${notice.endTime} ${telescope?.code ?? notice.telescopeId} / ${
            instrument ? instrument.model : '整机（全部终端）'
          }｜${notice.status}｜${notice.reason}`,
        );
      });
  }

  // 维护与未取消排程段交叠：两边时段、段号与交叠分钟原样列出
  lines.push('');
  lines.push('维护交叠对账（排程段不改动，执行事实原样保留）');
  lines.push('-'.repeat(96));
  if (overlaps.length === 0) {
    lines.push('维护时段与未取消排程段无交叠');
  } else {
    overlaps.forEach((item) => {
      const telescope = telescopes.find((entry) => entry.id === item.telescopeId);
      lines.push(
        `预告 ${item.noticeNo}（${item.noticeRange}）× 排程段 ${item.sessionId}（${item.sessionRange}）｜${telescope?.code ?? item.telescopeId}｜交叠 ${item.overlapMinutes} 分钟`,
      );
    });
  }

  lines.push('');
  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  return lines.join('\n');
}

/** 生成 CSV（排程事实 + 维护预告 + 交叠对账，读同一结果） */
export function buildPlanCsv(context: PlanContext): string {
  const { sessions, targets, telescopes, instruments, notices = [], maintenanceOverlaps: overlaps = [] } = context;
  const header = ['观测夜', '时段', '目标名', '星表编号', '类型', '视星等', '望远镜', '终端', '滤镜', '帧数', '单帧曝光(s)', '状态', '改期原因'];
  const rows = [...sessions]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((session) => {
      const target = targets.find((item) => item.id === session.targetId);
      const telescope = telescopes.find((item) => item.id === session.telescopeId);
      const instrument = instruments.find((item) => item.id === session.instrumentId);
      return [
        session.nightId,
        `${session.startTime}-${session.endTime}`,
        target?.name ?? '',
        target?.catalog ?? '',
        target?.type ?? '',
        target ? String(target.magnitude) : '',
        telescope?.code ?? '',
        instrument?.model ?? '',
        session.filterSlot,
        String(session.plannedFrames),
        target ? String(target.exposureSec) : '',
        session.status,
        session.rescheduleReason ?? '',
      ];
    });

  const csvParts: string[][] = [header, ...rows];
  if (notices.length > 0) {
    csvParts.push([]);
    csvParts.push(['维护预告编号', '观测夜', '维护时段', '望远镜', '终端', '状态', '停用原因']);
    notices
      .slice()
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .forEach((notice) => {
        const telescope = telescopes.find((item) => item.id === notice.telescopeId);
        const instrument = instruments.find((item) => item.id === notice.instrumentId);
        csvParts.push([
          notice.noticeNo,
          notice.nightId,
          `${notice.startTime}-${notice.endTime}`,
          telescope?.code ?? notice.telescopeId,
          instrument ? instrument.model : '整机',
          notice.status,
          notice.reason,
        ]);
      });
  }
  if (overlaps.length > 0) {
    csvParts.push([]);
    csvParts.push(['维护预告编号', '维护时段', '排程段号', '排程时段', '望远镜', '交叠分钟']);
    overlaps.forEach((item) => {
      const telescope = telescopes.find((entry) => entry.id === item.telescopeId);
      csvParts.push([item.noticeNo, item.noticeRange, item.sessionId, item.sessionRange, telescope?.code ?? item.telescopeId, String(item.overlapMinutes)]);
    });
  }

  const csv = csvParts
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  return `﻿${csv}`;
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 打印当前视图（打印视图） */
export function printPage(): void {
  window.print();
}
