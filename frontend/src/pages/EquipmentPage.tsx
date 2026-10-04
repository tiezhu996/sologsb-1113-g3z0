import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import ConflictBadge from '../components/common/ConflictBadge';
import FieldRow from '../components/common/FieldRow';
import { usePersistentStore } from '../hooks/usePersistentStore';
import { useConflictCheck } from '../hooks/useConflictCheck';
import { usePlanAvailability } from '../hooks/usePlanAvailability';
import { useSessionStore } from '../stores/sessionStore';
import { useNightStore } from '../stores/nightStore';
import { useTargetStore } from '../stores/targetStore';
import { useEquipmentStore } from '../stores/equipmentStore';
import { useMaintenanceStore } from '../stores/maintenanceStore';
import { MAINTENANCE_STATUSES, NIGHT_TOTAL_MINUTES, TARGET_COLOR, type MaintenanceStatus } from '../types';
import { axisMinutes, durationMinutes, minutesToTime } from '../utils/astro';

const SLOT_MINUTES = 30;

interface MaintenanceFormState {
  noticeNo: string;
  nightId: string;
  startTime: string;
  endTime: string;
  telescopeId: string;
  instrumentId: string;
  reason: string;
  status: MaintenanceStatus;
}

/** 望远镜与终端分配视图：行 = 设备、列 = 30 分钟时段；维护时段容量归零格标灰紫，冲突格标红 */
export default function EquipmentPage() {
  usePersistentStore();
  const navigate = useNavigate();
  const telescopes = useEquipmentStore((s) => s.telescopes);
  const instruments = useEquipmentStore((s) => s.instruments);
  const fieldOfView = useEquipmentStore((s) => s.fieldOfView);
  const sessions = useSessionStore((s) => s.sessions);
  const nights = useNightStore((s) => s.nights);
  const currentNightId = useNightStore((s) => s.currentNightId);
  const setCurrentNight = useNightStore((s) => s.setCurrentNight);
  const targets = useTargetStore((s) => s.targets);
  const notices = useMaintenanceStore((s) => s.notices);
  const ingest = useMaintenanceStore((s) => s.ingest);
  const retryPending = useMaintenanceStore((s) => s.retryPending);
  const updateNotice = useMaintenanceStore((s) => s.updateNotice);
  const removeNotice = useMaintenanceStore((s) => s.removeNotice);
  const pending = useMaintenanceStore((s) => s.pending);
  const lastError = useMaintenanceStore((s) => s.lastError);
  const cursor = useMaintenanceStore((s) => s.cursor);
  const clearError = useMaintenanceStore((s) => s.clearError);
  const { conflictsOfNight } = useConflictCheck();
  const availability = usePlanAvailability();

  const [nightId, setNightId] = useState(currentNightId);
  const activeNightId = nightId || currentNightId;
  const night = nights.find((item) => item.id === activeNightId);
  const nightSessions = useMemo(() => sessions.filter((session) => session.nightId === activeNightId), [sessions, activeNightId]);
  const conflicts = useMemo(() => conflictsOfNight(activeNightId), [conflictsOfNight, activeNightId]);
  const nightNotices = useMemo(() => availability.noticesOfNight(activeNightId), [availability, activeNightId]);
  const nightOverlaps = useMemo(() => availability.overlapsOfNight(activeNightId), [availability, activeNightId]);
  const slots = useMemo(() => Array.from({ length: NIGHT_TOTAL_MINUTES / SLOT_MINUTES }, (_, index) => index), []);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [formNotice, setFormNotice] = useState('');
  const [form, setForm] = useState<MaintenanceFormState>({
    noticeNo: '',
    nightId: activeNightId,
    startTime: '21:00',
    endTime: '22:00',
    telescopeId: '',
    instrumentId: '',
    reason: '',
    status: '已预告',
  });

  const targetById = (id: string) => targets.find((target) => target.id === id);
  const pairedInstrument = (telescopeCode: string) => instruments.find((instrument) => instrument.telescopeCode === telescopeCode);

  function openIngest() {
    setFormError('');
    setFormNotice('');
    setForm((prev) => ({
      ...prev,
      nightId: activeNightId,
      telescopeId: prev.telescopeId || telescopes[0]?.id || '',
      noticeNo: `MX-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(notices.length + 1).padStart(2, '0')}`,
    }));
    setDialogOpen(true);
  }

  async function submitIngest() {
    if (!form.noticeNo.trim() || !form.nightId || !form.telescopeId) {
      setFormError('回传编号、观测夜与望远镜均为必填');
      return;
    }
    if (durationMinutes(form.startTime, form.endTime) <= 0) {
      setFormError('结束时刻必须晚于开始时刻');
      return;
    }
    try {
      const result = await ingest([
        {
          noticeNo: form.noticeNo.trim(),
          nightId: form.nightId,
          startTime: form.startTime,
          endTime: form.endTime,
          telescopeId: form.telescopeId,
          instrumentId: form.instrumentId,
          reason: form.reason.trim() || '设备组临时停用',
          status: form.status,
        },
      ]);
      setFormNotice(result.skipped > 0 ? `回传编号已存在，重投未新增预告（跳过 ${result.skipped} 条）` : '维护预告已落库，容量已按预告归零');
      setDialogOpen(false);
    } catch (reason) {
      setFormError(`写入失败，已保留在检查点可重试：${(reason as Error).message}`);
    }
  }

  async function retry() {
    try {
      const result = await retryPending();
      setFormNotice(`检查点重试完成：新写入 ${result.inserted} 条，重投跳过 ${result.skipped} 条`);
    } catch (reason) {
      setFormError(`重试仍失败：${(reason as Error).message}`);
    }
  }

  /** 某望远镜在某时段内的排程段 */
  const occupancy = (telescopeId: string, slot: number) => {
    const slotStart = slot * SLOT_MINUTES;
    const slotEnd = slotStart + SLOT_MINUTES;
    return nightSessions
      .filter((session) => session.telescopeId === telescopeId)
      .filter((session) => {
        const start = axisMinutes(session.startTime);
        const rawEnd = axisMinutes(session.endTime);
        const end = rawEnd <= start ? rawEnd + 1440 : rawEnd;
        return Math.min(end, slotEnd) - Math.max(start, slotStart) > 0;
      })
      .sort((a, b) => axisMinutes(a.startTime) - axisMinutes(b.startTime));
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        望远镜与终端分配视图
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        维护预告与排程段是两套来源，按望远镜与终端对账：维护时段容量归零（灰紫斜纹格），与未取消排程段重叠时两边时段、段号与交叠分钟全部保留；排程冲突格仍标红，点击格子可一键跳转。
      </Typography>

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap' }} alignItems="center">
        <TextField
          select
          size="small"
          label="观测夜"
          value={activeNightId}
          onChange={(event) => {
            setNightId(event.target.value);
            setCurrentNight(event.target.value);
          }}
          sx={{ minWidth: 240 }}
        >
          {nights.map((item) => (
            <MenuItem key={item.id} value={item.id}>
              {`${item.date} · ${item.siteName}${item.primary ? '（主夜）' : item.backup ? '（备用夜）' : ''}`}
            </MenuItem>
          ))}
        </TextField>
        <Chip size="small" label={night ? `月相 ${night.moonPhasePct}% · 云量 ${night.cloudText}` : '未选择观测夜'} />
        <ConflictBadge conflicts={conflicts} />
        <Chip size="small" color="warning" variant="outlined" label={`维护预告 ${nightNotices.length} 段 · 交叠 ${nightOverlaps.length} 处`} />
        <Button variant="contained" color="secondary" onClick={openIngest}>
          回传维护预告
        </Button>
        {pending.length > 0 ? (
          <Button variant="contained" color="warning" onClick={() => void retry()}>
            从检查点重试（{pending.length} 条待投）
          </Button>
        ) : null}
      </Stack>

      {lastError ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={clearError} action={<Button color="inherit" size="small" onClick={() => void retry()}>重试</Button>}>
          维护预告写入失败：{lastError}；批次已保留，检查点 {cursor?.noticeNo || '无'}，重投不会新增已落库预告。
        </Alert>
      ) : null}
      {formNotice ? (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setFormNotice('')}>
          {formNotice}
        </Alert>
      ) : null}
      {availability.mismatches.length > 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {availability.mismatches.map((item) => `预告 ${item.noticeNo}：${item.reason}`).join('；')}
        </Alert>
      ) : null}

      {conflicts.length > 0 ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          本夜存在 {conflicts.length} 处排程时段冲突，冲突格已在下方网格中标红：{' '}
          {conflicts.map((conflict) => `${conflict.sessionId}↔${conflict.otherId}（${conflict.overlapText}）`).join('；')}
        </Alert>
      ) : (
        <Alert severity="success" sx={{ mb: 2 }}>
          本夜各望远镜排程时段无重叠
        </Alert>
      )}

      {nightOverlaps.length > 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            维护时段容量归零，与未取消排程段交叠 {nightOverlaps.length} 处（排程事实原样保留，未自动取消）：
          </Typography>
          {nightOverlaps.map((item) => {
            const telescope = telescopes.find((entry) => entry.id === item.telescopeId);
            return (
              <div key={`${item.noticeId}-${item.sessionId}`}>
                预告 {item.noticeNo}（{item.noticeRange}）× 排程段 {item.sessionId}（{item.sessionRange}）｜{telescope?.code ?? item.telescopeId}｜交叠 {item.overlapMinutes} 分钟
              </div>
            );
          })}
        </Alert>
      ) : (
        <Alert severity="info" sx={{ mb: 2 }}>
          维护时段与未取消排程段无交叠
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small" sx={{ minWidth: 1180 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 210 }}>望远镜 / 终端 / 视场角</TableCell>
              {slots.map((slot) => (
                <TableCell key={slot} align="center" sx={{ px: 0.25 }}>
                  {minutesToTime(slot * SLOT_MINUTES)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {telescopes.map((telescope) => {
              const instrument = pairedInstrument(telescope.code);
              const fov = instrument ? fieldOfView(telescope.id, instrument.id) : undefined;
              return (
                <TableRow key={telescope.id}>
                  <TableCell>
                    <Stack spacing={0.25}>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {telescope.code}
                        </Typography>
                        <Chip
                          size="small"
                          label={telescope.status}
                          color={telescope.status === '可用' ? 'success' : telescope.status === '维护中' ? 'warning' : 'default'}
                          variant="outlined"
                        />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {telescope.apertureMm}mm · f/{telescope.focalLengthMm}mm · {telescope.mount} · 载荷 {telescope.maxPayloadKg}kg
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {instrument ? `${instrument.model}（${instrument.terminalType}）` : '未配终端'}
                        {fov ? ` · 视场 ${fov.text}` : ''}
                      </Typography>
                    </Stack>
                  </TableCell>
                  {slots.map((slot) => {
                    const items = occupancy(telescope.id, slot);
                    const isConflict = items.length > 1;
                    const target = items[0] ? targetById(items[0].targetId) : undefined;
                    // 整机维护（无终端）或作用于该望远镜配对终端的维护，都让该格容量归零
                    const underMaintenance = availability.isSlotUnderMaintenance(
                      activeNightId,
                      telescope.id,
                      instrument?.id ?? '',
                      slot * SLOT_MINUTES,
                      SLOT_MINUTES,
                    );
                    const slotNotices = nightNotices
                      .filter((notice) => notice.telescopeId === telescope.id)
                      .filter((notice) => !notice.instrumentId || notice.instrumentId === instrument?.id)
                      .filter((notice) => {
                        const start = axisMinutes(notice.startTime);
                        let end = axisMinutes(notice.endTime);
                        if (end <= start) end += 1440;
                        return Math.min(end, slot * SLOT_MINUTES + SLOT_MINUTES) - Math.max(start, slot * SLOT_MINUTES) > 0;
                      });
                    return (
                      <TableCell
                        key={slot}
                        align="center"
                        sx={{
                          px: 0.25,
                          py: 0.5,
                          bgcolor: isConflict
                            ? 'error.main'
                            : underMaintenance
                              ? 'secondary.main'
                              : items.length === 1
                                ? TARGET_COLOR[target?.type ?? '星云']
                                : 'transparent',
                          backgroundImage: underMaintenance && !isConflict ? 'repeating-linear-gradient(45deg, rgba(255,255,255,.18) 0 5px, transparent 5px 10px)' : undefined,
                          color: items.length || underMaintenance ? '#fff' : 'text.secondary',
                          cursor: items.length ? 'pointer' : 'default',
                          borderLeft: '1px solid',
                          borderColor: 'divider',
                        }}
                        onClick={() => {
                          if (items.length === 0) return;
                          navigate(`/sessions?highlight=${items[0].id}&night=${activeNightId}`);
                        }}
                      >
                        {items.length === 0 && !underMaintenance ? (
                          <Typography variant="caption">·</Typography>
                        ) : isConflict ? (
                          <Tooltip title={items.map((item) => `${item.startTime}-${item.endTime} ${targetById(item.targetId)?.name ?? ''}`).join(' ｜ ')}>
                            <Typography variant="caption" sx={{ fontWeight: 700 }}>
                              冲突 {items.length}
                            </Typography>
                          </Tooltip>
                        ) : underMaintenance && items.length > 0 ? (
                          <Tooltip
                            title={`维护停用 ${slotNotices.map((notice) => `${notice.noticeNo} ${notice.startTime}-${notice.endTime}`).join('；')} ｜ 排程 ${items
                              .map((item) => `${item.id} ${item.startTime}-${item.endTime}`)
                              .join('；')}`}
                          >
                            <Typography variant="caption" sx={{ fontWeight: 700 }}>
                              停用×{items.length}
                            </Typography>
                          </Tooltip>
                        ) : underMaintenance ? (
                          <Tooltip title={slotNotices.map((notice) => `${notice.noticeNo} ${notice.startTime}-${notice.endTime} ${notice.reason}`).join('；')}>
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>
                              停用
                            </Typography>
                          </Tooltip>
                        ) : (
                          <Tooltip title={`${items[0].startTime}-${items[0].endTime} ${target?.name ?? ''} · ${items[0].status}`}>
                            <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
                              {target?.name ?? '已排'}
                            </Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        维护预告（设备组回传，{notices.length} 段）
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>回传编号</TableCell>
              <TableCell>观测夜</TableCell>
              <TableCell>维护时段</TableCell>
              <TableCell>望远镜 / 终端</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>交叠排程（段号 / 时段 / 分钟）</TableCell>
              <TableCell>原因</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {notices
              .slice()
              .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
              .map((notice) => {
                const telescope = telescopes.find((item) => item.id === notice.telescopeId);
                const maintainInstrument = instruments.find((item) => item.id === notice.instrumentId);
                const items = availability.overlaps.filter((item) => item.noticeId === notice.id);
                return (
                  <TableRow key={notice.id} hover selected={notice.nightId === activeNightId}>
                    <TableCell>{notice.noticeNo}</TableCell>
                    <TableCell>{nights.find((item) => item.id === notice.nightId)?.date ?? notice.nightId}</TableCell>
                    <TableCell>{`${notice.startTime}-${notice.endTime}`}</TableCell>
                    <TableCell>{telescope?.code ?? notice.telescopeId} / {maintainInstrument ? maintainInstrument.model : '整机'}</TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        variant="standard"
                        value={notice.status}
                        onChange={(event) => void updateNotice(notice.id, { status: event.target.value as MaintenanceStatus })}
                      >
                        {MAINTENANCE_STATUSES.map((status) => (
                          <MenuItem key={status} value={status}>
                            {status}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell>
                      {items.length > 0 ? (
                        <Stack spacing={0.5}>
                          {items.map((item) => (
                            <Chip
                              key={item.sessionId}
                              size="small"
                              color="warning"
                              label={`${item.sessionId}（${item.sessionRange}）× 维护（${item.noticeRange}）· ${item.overlapMinutes}min`}
                              onClick={() => navigate(`/sessions?highlight=${item.sessionId}&night=${notice.nightId}`)}
                            />
                          ))}
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          无交叠
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{notice.reason}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" color="error" onClick={() => void removeNotice(notice.id)}>
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            {notices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography variant="body2" color="text.secondary">
                    暂无维护预告，全部设备按可用处理
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        终端清单与适配望远镜
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>型号</TableCell>
              <TableCell>类型</TableCell>
              <TableCell align="right">像元(μm)</TableCell>
              <TableCell>靶面(mm)</TableCell>
              <TableCell align="right">读出噪声(e-)</TableCell>
              <TableCell>适配望远镜</TableCell>
              <TableCell>视场角</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {instruments.map((instrument) => {
              const telescope = telescopes.find((item) => item.code === instrument.telescopeCode);
              const fov = telescope ? fieldOfView(telescope.id, instrument.id) : undefined;
              return (
                <TableRow key={instrument.id} hover>
                  <TableCell>{instrument.model}</TableCell>
                  <TableCell>{instrument.terminalType}</TableCell>
                  <TableCell align="right">{instrument.pixelSizeUm}</TableCell>
                  <TableCell>
                    {instrument.sensorWidthMm} × {instrument.sensorHeightMm}
                  </TableCell>
                  <TableCell align="right">{instrument.readNoiseE}</TableCell>
                  <TableCell>{telescope ? `${telescope.code}（${telescope.status}）` : '未适配'}</TableCell>
                  <TableCell>{fov?.text ?? '-'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>回传维护预告（设备组临时停用）</DialogTitle>
        <DialogContent>
          {formError ? (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {formError}
            </Alert>
          ) : null}
          <Alert severity="info" sx={{ mb: 1.5 }}>
            维护预告与排程段分两套来源，仅按望远镜与终端对账：维护时段容量归零并拒绝新排程；与未取消排程段重叠时只记录两边时段、段号与交叠分钟，执行事实原样保留。相同回传编号重投不新增预告。
          </Alert>
          <FieldRow label="回传编号" required hint="设备组编号，重投时保持不变以幂等去重">
            <TextField size="small" fullWidth value={form.noticeNo} onChange={(event) => setForm({ ...form, noticeNo: event.target.value })} placeholder="MX-20251011-03" />
          </FieldRow>
          <FieldRow label="观测夜" required>
            <TextField select size="small" fullWidth value={form.nightId} onChange={(event) => setForm({ ...form, nightId: event.target.value })}>
              {nights.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {`${item.date} · ${item.siteName}${item.primary ? '（主夜）' : item.backup ? '（备用夜）' : ''}`}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
          <FieldRow label="开始时刻" required hint="格式 HH:mm，可跨零点">
            <TextField size="small" fullWidth value={form.startTime} onChange={(event) => setForm({ ...form, startTime: event.target.value })} />
          </FieldRow>
          <FieldRow label="结束时刻" required>
            <TextField size="small" fullWidth value={form.endTime} onChange={(event) => setForm({ ...form, endTime: event.target.value })} />
          </FieldRow>
          <FieldRow label="望远镜" required>
            <TextField
              select
              size="small"
              fullWidth
              value={form.telescopeId}
              onChange={(event) => setForm({ ...form, telescopeId: event.target.value, instrumentId: '' })}
            >
              {telescopes.map((telescope) => (
                <MenuItem key={telescope.id} value={telescope.id}>
                  {`${telescope.code} · ${telescope.status}`}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
          <FieldRow label="终端" hint="留空表示望远镜整机停用（全部终端容量归零）">
            <TextField select size="small" fullWidth value={form.instrumentId} onChange={(event) => setForm({ ...form, instrumentId: event.target.value })}>
              <MenuItem value="">整机停用（全部终端）</MenuItem>
              {instruments
                .filter((instrument) => instrument.telescopeCode === telescopes.find((item) => item.id === form.telescopeId)?.code)
                .map((instrument) => (
                  <MenuItem key={instrument.id} value={instrument.id}>
                    {`${instrument.model} · ${instrument.terminalType}`}
                  </MenuItem>
                ))}
            </TextField>
          </FieldRow>
          <FieldRow label="状态">
            <TextField select size="small" fullWidth value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as MaintenanceStatus })}>
              {MAINTENANCE_STATUSES.map((status) => (
                <MenuItem key={status} value={status}>
                  {status}
                </MenuItem>
              ))}
            </TextField>
          </FieldRow>
          <FieldRow label="停用原因">
            <TextField size="small" fullWidth multiline minRows={2} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="例如：赤道仪临时检修" />
          </FieldRow>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>取消</Button>
          <Button variant="contained" onClick={() => void submitIngest()}>
            落库
          </Button>
        </DialogActions>
      </Dialog>

      <Box sx={{ mt: 2 }}>
        <Button variant="outlined" onClick={() => navigate('/sessions')}>
          前往排程段列表处理冲突
        </Button>
      </Box>
    </Box>
  );
}
