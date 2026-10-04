import type { Instrument, MaintenanceNotice, ObsNight, ObsSession, ObsTarget, Telescope } from '../types';
import { buildMaintenanceOverlaps } from './maintenance';

export interface PlanContext {
  night?: ObsNight;
  sessions: ObsSession[];
  targets: ObsTarget[];
  telescopes: Telescope[];
  instruments: Instrument[];
  /** 维护预告（与排程段分属两套来源，导出与总览、设备分配读同一结果） */
  maintenances?: MaintenanceNotice[];
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** 生成当晚观测清单文本（目标、时刻、滤镜、帧数） */
export function buildNightPlanText(context: PlanContext): string {
  const { night, sessions, targets, telescopes, instruments } = context;
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
  const maintenances = context.maintenances ?? [];
  if (maintenances.length > 0) {
    lines.push('-'.repeat(96));
    lines.push('维护预告（容量归零时段，按望远镜与终端对账，该时段拒绝新排程）');
    maintenances.forEach((notice, index) => {
      const telescope = telescopes.find((item) => item.id === notice.telescopeId);
      const instrument = instruments.find((item) => item.id === notice.instrumentId);
      lines.push(
        [
          pad(index + 1),
          `${notice.startTime}-${notice.endTime}`.padEnd(14, ' '),
          (telescope?.code ?? '-').padEnd(8, ' '),
          (instrument?.model ?? '-').padEnd(16, ' '),
          `${notice.reason}（回传 ${notice.feedbackId}）`,
        ].join(' '),
      );
    });
    const overlaps = buildMaintenanceOverlaps(maintenances, sessions);
    if (overlaps.length > 0) {
      lines.push('维护 × 未取消排程段交叠（执行事实原样保留）');
      overlaps.forEach((overlap) => {
        lines.push(`预告 ${overlap.noticeStart}-${overlap.noticeEnd} × 排程段 ${overlap.sessionId}（${overlap.sessionStart}-${overlap.sessionEnd}）交叠 ${overlap.overlapMinutes} 分钟`);
      });
    }
  }
  lines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  return lines.join('\n');
}

/** 生成 CSV */
export function buildPlanCsv(context: PlanContext): string {
  const { sessions, targets, telescopes, instruments } = context;
  const overlaps = buildMaintenanceOverlaps(context.maintenances ?? [], sessions);
  const overlapMinutesBySession = new Map<string, number>();
  overlaps.forEach((overlap) => {
    overlapMinutesBySession.set(overlap.sessionId, (overlapMinutesBySession.get(overlap.sessionId) ?? 0) + overlap.overlapMinutes);
  });
  const header = ['观测夜', '时段', '目标名', '星表编号', '类型', '视星等', '望远镜', '终端', '滤镜', '帧数', '单帧曝光(s)', '状态', '改期原因', '维护交叠分钟'];
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
        String(overlapMinutesBySession.get(session.id) ?? ''),
      ];
    });
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  return `\ufeff${csv}`;
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
