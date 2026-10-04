# 天文观测计划编排台（gbobsplan）

面向业余天文台与高校天文社团的值班排期人员：把「观测目标—可见窗口—月相—望远镜与终端—备用观测夜」串成一份可执行的观测夜编排表，解决目标亮度与月相冲突、设备被重复占用、阴天临时改期难以追溯的问题。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21813>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| 构建 | Vite 6（`npm run build` 含 `tsc --noEmit` 类型检查） |
| UI | MUI（Material UI 5）+ Emotion |
| 路由 | React Router 6（5 条业务路由 + 404） |
| 状态 | Zustand（targetStore / sessionStore / equipmentStore / nightStore / maintenanceStore） |
| 存储 | IndexedDB（Dexie，库名 `gbobsplan-db`，`schemaVersion` + v2/v3 迁移） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21813
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # target / session / equipment / night / maintenance（+ index.ts 统一出口）
│       ├── stores/            # targetStore / sessionStore / equipmentStore / nightStore / maintenanceStore
│       ├── components/common/ # Timeline / StatusChip / ConflictBadge / FieldRow
│       ├── hooks/             # usePersistentStore（Dexie 读写 + Zustand 同步）/ useConflictCheck / useMaintenanceCheck
│       ├── pages/             # OverviewPage / TargetsPage / SessionsPage / EquipmentPage / ExportPage
│       ├── router/index.tsx   # 路由表
│       └── utils/             # astro.ts（高度角/可见窗口/月相）/ maintenance.ts（容量与交叠对账）/ export.ts / id.ts
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 本夜编排总览 | 30 分钟刻度时间轴 + 月相与月出月落条带；冲突与低于高度阈值的目标自动标灰；维护预告与未取消排程段的交叠单独告警 |
| `/targets` | 观测目标库 | 按类型与优先级筛选、按视星等排序、维护地平高度阈值与曝光参数，并给出本夜可见窗口 |
| `/sessions` | 排程段与冲突 | 冲突检测结果、按时段/望远镜校验；命中维护预告（容量归零）的时段拒绝新排程；勾选多条批量改期到备用观测夜并填写改期原因 |
| `/equipment` | 设备分配视图 | 行 = 望远镜、列 = 30 分钟时段；冲突格标红、维护格标灰、交叠格标红，点击可一键跳转到对应排程段；接收设备组临时停用回传并维护预告清单 |
| `/export` | 导出观测清单 | 目标、时刻、滤镜、帧数导出为文本与 CSV（含维护预告与交叠分钟），支持打印视图 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbobsplan-db`），表：`targets`、`sessions`、`telescopes`、`instruments`、`nights`、`maintenances`、`meta`。
- `db.version(1).stores({...})` 声明索引；`db.version(2).upgrade(...)` 为排程段增加 `backupNightId` 索引，并给旧数据补齐 `schemaVersion` 与因云取消排程段的替补夜。
- `db.version(3).upgrade(...)` 新增维护预告表 `maintenances`（`feedbackId` 唯一索引）：维护预告与排程段分属两套来源，按望远镜与终端对账；已有数据没有维护记录时，状态缺失的望远镜迁移为可用、排程段补齐 `schemaVersion`，并在 `meta` 初始化回传检查点 `maintenance-checkpoint`。
- 设备组临时停用回传逐条入库：预告与检查点同一事务提交，写入失败后可从检查点重试；重投按 `feedbackId` 去重，不新增预告。维护时段容量归零并拒绝新排程；与未取消排程段重叠时派生交叠记录（保留两边时段、段号与交叠分钟），执行事实（排程段）原样保留。总览、设备分配与导出从 `useMaintenanceCheck` 读同一份对账结果。
- 首次打开且表为空时写入示例数据（12 个观测目标、5 个观测夜、4 台望远镜、4 台终端、14 段排程、2 条维护预告，含 1 处设备冲突、1 条改期记录与 1 处维护交叠）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
