import { useMemo } from 'react';
import { useEquipmentStore } from '../stores/equipmentStore';
import { useMaintenanceStore } from '../stores/maintenanceStore';
import { useSessionStore } from '../stores/sessionStore';
import { buildPlanModel, type PlanAvailabilityModel } from '../utils/availability';

/**
 * 总览 / 设备分配 / 导出读同一结果：
 * 维护预告与排程段两套来源合并后的统一容量与对账模型。
 */
export function usePlanAvailability(): PlanAvailabilityModel {
  const sessions = useSessionStore((s) => s.sessions);
  const notices = useMaintenanceStore((s) => s.notices);
  const telescopes = useEquipmentStore((s) => s.telescopes);
  const instruments = useEquipmentStore((s) => s.instruments);

  return useMemo(
    () => buildPlanModel({ sessions, notices, telescopes, instruments }),
    [sessions, notices, telescopes, instruments],
  );
}
