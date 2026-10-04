import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
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
import { usePersistentStore } from '../hooks/usePersistentStore';
import { useConflictCheck } from '../hooks/useConflictCheck';
import { useMaintenanceCheck } from '../hooks/useMaintenanceCheck';
import { useSessionStore } from '../stores/sessionStore';
import { useNightStore } from '../stores/nightStore';
import { useTargetStore } from '../stores/targetStore';
import { useEquipmentStore } from '../stores/equipmentStore';
import { useMaintenanceStore } from '../stores/maintenanceStore';
import { NIGHT_TOTAL_MINUTES, TARGET_COLOR } from '../types';
import { DEVICE_TEAM_FEEDBACKS } from '../utils/maintenance';
import { axisMinutes, minutesToTime } from '../utils/astro';

const SLOT_MINUTES = 30;

/** 望远镜与终端分配视图：行 = 设备、列 = 30 分钟时段，冲突格标红并可一键跳转；维护预告格标灰、交叠格标红 */
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
  const { conflictsOfNight } = useConflictCheck();
  const { noticesOfNight, overlapsOfNight } = useMaintenanceCheck();
  const notices = useMaintenanceStore((s) => s.notices);
  const checkpoint = useMaintenanceStore((s) => s.checkpoint);
  const ingestFeedbacks = useMaintenanceStore((s) => s.ingestFeedbacks);
  const removeNotice = useMaintenanceStore((s) => s.removeNotice);

  const [nightId, setNightId] = useState(currentNightId);
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState('');
  const [ingestError, setIngestError] = useState('');
  const activeNightId = nightId || currentNightId;
  const night = nights.find((item) => item.id === activeNightId);
  const nightSessions = useMemo(() => sessions.filter((session) => session.nightId === activeNightId), [sessions, activeNightId]);
  const conflicts = useMemo(() => conflictsOfNight(activeNightId), [conflictsOfNight, activeNightId]);
  const nightNotices = useMemo(() => noticesOfNight(activeNightId), [noticesOfNight, activeNightId]);
  const maintenanceOverlaps = useMemo(() => overlapsOfNight(activeNightId), [overlapsOfNight, activeNightId]);
  const slots = useMemo(() => Array.from({ length: NIGHT_TOTAL_MINUTES / SLOT_MINUTES }, (_, index) => index), []);

  const targetById = (id: string) => targets.find((target) => target.id === id);
  const telescopeById = (id: string) => telescopes.find((item) => item.id === id);
  const instrumentById = (id: string) => instruments.find((item) => item.id === id);
  const nightById = (id: string) => nights.find((item) => item.id === id);
  const pairedInstrument = (telescopeCode: string) => instruments.find((instrument) => instrument.telescopeCode === telescopeCode);

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

  /** 某望远镜（及其配对终端）在某时段内命中的维护预告 */
  const maintenanceInSlot = (telescopeId: string, instrumentId: string | undefined, slot: number) => {
    const slotStart = slot * SLOT_MINUTES;
    const slotEnd = slotStart + SLOT_MINUTES;
    return nightNotices
      .filter((notice) => notice.telescopeId === telescopeId && (!instrumentId || notice.instrumentId === instrumentId))
      .filter((notice) => {
        const start = axisMinutes(notice.startTime);
        const rawEnd = axisMinutes(notice.endTime);
        const end = rawEnd <= start ? rawEnd + 1440 : rawEnd;
        return Math.min(end, slotEnd) - Math.max(start, slotStart) > 0;
      });
  };

  /** 接收设备组临时停用回传：失败保留检查点，可从检查点重试；重投不新增预告 */
  async function receiveFeedbacks() {
    setIngesting(true);
    setIngestError('');
    try {
      const result = await ingestFeedbacks(DEVICE_TEAM_FEEDBACKS);
      setIngestMsg(`回传处理完成：新增 ${result.added} 条预告，重投跳过 ${result.skipped} 条（不新增预告）；检查点 ${result.checkpoint || '（空）'}`);
    } catch (reason) {
      setIngestError(`维护预告写入失败：${(reason as Error).message}。可从检查点 ${checkpoint || '（空）'} 重试，已写入的预告不会重复新增`);
    } finally {
      setIngesting(false);
    }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        望远镜与终端分配视图
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        以行 = 设备、列 = 30 分钟时段的占用网格呈现；同一望远镜在同一时段排入多段即标红，维护预告时段标灰（容量归零），维护与排程交叠标红，点击格子可一键跳转到对应排程段。
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
        <Chip size="small" color={nightNotices.length ? 'warning' : 'default'} variant="outlined" label={`维护预告 ${nightNotices.length} 段`} />
        <Chip size="small" color={maintenanceOverlaps.length ? 'error' : 'success'} variant="outlined" label={`维护交叠 ${maintenanceOverlaps.length} 处`} />
      </Stack>

      {conflicts.length > 0 ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          本夜存在 {conflicts.length} 处设备时段冲突，冲突格已在下方网格中标红：{' '}
          {conflicts.map((conflict) => `${conflict.sessionId}↔${conflict.otherId}（${conflict.overlapText}）`).join('；')}
        </Alert>
      ) : (
        <Alert severity="success" sx={{ mb: 2 }}>
          本夜各望远镜时段无重叠，无设备冲突
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
                    const maints = maintenanceInSlot(telescope.id, instrument?.id, slot);
                    const isConflict = items.length > 1;
                    const isMaintOverlap = maints.length > 0 && items.length > 0;
                    const target = items[0] ? targetById(items[0].targetId) : undefined;
                    const maintTip = maints.map((notice) => `维护预告 ${notice.startTime}-${notice.endTime}：${notice.reason}（容量归零）`).join(' ｜ ');
                    return (
                      <TableCell
                        key={slot}
                        align="center"
                        sx={{
                          px: 0.25,
                          py: 0.5,
                          bgcolor: isConflict || isMaintOverlap ? 'error.main' : items.length === 1 ? TARGET_COLOR[target?.type ?? '星云'] : maints.length > 0 ? 'grey.400' : 'transparent',
                          color: items.length || maints.length ? '#fff' : 'text.secondary',
                          cursor: items.length ? 'pointer' : 'default',
                          borderLeft: '1px solid',
                          borderColor: 'divider',
                        }}
                        onClick={() => {
                          if (items.length === 0) return;
                          navigate(`/sessions?highlight=${items[0].id}&night=${activeNightId}`);
                        }}
                      >
                        {items.length === 0 && maints.length === 0 ? (
                          <Typography variant="caption">·</Typography>
                        ) : isConflict ? (
                          <Tooltip title={items.map((item) => `${item.startTime}-${item.endTime} ${targetById(item.targetId)?.name ?? ''}`).join(' ｜ ')}>
                            <Typography variant="caption" sx={{ fontWeight: 700 }}>
                              冲突 {items.length}
                            </Typography>
                          </Tooltip>
                        ) : isMaintOverlap ? (
                          <Tooltip title={`${items.map((item) => `${item.startTime}-${item.endTime} ${targetById(item.targetId)?.name ?? ''}`).join(' ｜ ')} ｜ ${maintTip}`}>
                            <Typography variant="caption" sx={{ fontWeight: 700 }}>
                              交叠
                            </Typography>
                          </Tooltip>
                        ) : items.length === 1 ? (
                          <Tooltip title={`${items[0].startTime}-${items[0].endTime} ${target?.name ?? ''} · ${items[0].status}`}>
                            <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
                              {target?.name ?? '已排'}
                            </Typography>
                          </Tooltip>
                        ) : (
                          <Tooltip title={maintTip}>
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>
                              维护
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
        维护预告（设备组临时停用回传）
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        维护预告与排程段分属两套来源，按望远镜与终端对账：维护时段容量归零并拒绝新排程；与未取消排程段重叠时保留两边时段、段号与交叠分钟，执行事实原样保留。
      </Typography>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap' }}>
        <Button variant="contained" size="small" disabled={ingesting} onClick={() => void receiveFeedbacks()}>
          {ingesting ? '正在写入…' : '接收设备组回传'}
        </Button>
        {ingestError ? (
          <Button variant="outlined" size="small" color="error" onClick={() => void receiveFeedbacks()}>
            从检查点重试
          </Button>
        ) : null}
        <Chip size="small" variant="outlined" label={`检查点 ${checkpoint || '（空）'}`} />
      </Stack>

      {ingestMsg ? (
        <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setIngestMsg('')}>
          {ingestMsg}
        </Alert>
      ) : null}
      {ingestError ? (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setIngestError('')}>
          {ingestError}
        </Alert>
      ) : null}

      {maintenanceOverlaps.length > 0 ? (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          本夜维护预告与未取消排程段交叠 {maintenanceOverlaps.length} 处（执行事实原样保留，请改期排程或调整维护窗口）：
          {maintenanceOverlaps.map((overlap) => (
            <div key={`${overlap.noticeId}-${overlap.sessionId}`}>
              预告 {overlap.noticeStart}-{overlap.noticeEnd}（{telescopeById(overlap.telescopeId)?.code ?? overlap.telescopeId} /{' '}
              {instrumentById(overlap.instrumentId)?.model ?? overlap.instrumentId}）× 排程段 {overlap.sessionId}（{overlap.sessionStart}-{overlap.sessionEnd}）交叠{' '}
              {overlap.overlapMinutes} 分钟
            </div>
          ))}
        </Alert>
      ) : null}

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>观测夜</TableCell>
              <TableCell>回传单号</TableCell>
              <TableCell>维护时段</TableCell>
              <TableCell>望远镜</TableCell>
              <TableCell>终端</TableCell>
              <TableCell>停用原因</TableCell>
              <TableCell>接收时间</TableCell>
              <TableCell align="right">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {notices.map((notice) => (
              <TableRow key={notice.id} hover>
                <TableCell>{nightById(notice.nightId)?.date ?? notice.nightId}</TableCell>
                <TableCell>{notice.feedbackId}</TableCell>
                <TableCell>
                  {notice.startTime}-{notice.endTime}
                </TableCell>
                <TableCell>{telescopeById(notice.telescopeId)?.code ?? notice.telescopeId}</TableCell>
                <TableCell>{instrumentById(notice.instrumentId)?.model ?? notice.instrumentId}</TableCell>
                <TableCell>{notice.reason}</TableCell>
                <TableCell>{new Date(notice.receivedAt).toLocaleString('zh-CN')}</TableCell>
                <TableCell align="right">
                  <Button size="small" color="error" onClick={() => void removeNotice(notice.id)}>
                    删除
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {notices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography variant="body2" color="text.secondary">
                    暂无维护预告，各望远镜与终端容量均为可用
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

      <Box sx={{ mt: 2 }}>
        <Button variant="outlined" onClick={() => navigate('/sessions')}>
          前往排程段列表处理冲突
        </Button>
      </Box>
    </Box>
  );
}
