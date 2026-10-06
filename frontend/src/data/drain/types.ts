import type { EntryRow } from '@/data/types'

// 排水管网领域模型：在通用 EntryRow 之上增加「管辖区域 / 共享区域 / 归属 / 版本 / 历史」。
// 列表页与运营概览工作台都从这里取数据和权限结论，保证两处显示与判定完全一致。

export const DRAIN_KEY = 'drain_network'

export type DrainStatus = '正常' | '淤积预警' | '溢流风险' | '已封堵'
export const DRAIN_STATUSES: DrainStatus[] = ['正常', '淤积预警', '溢流风险', '已封堵']

export type OwnershipStatus = 'pending' | 'confirmed'
export const OWNERSHIP_LABELS: Record<OwnershipStatus, string> = {
  pending: '待上级确认',
  confirmed: '已确认',
}

// 排水管段上可执行的动作。状态类动作只允许归属区域人员执行；「确认归属」只允许上级执行。
export type DrainAction = '标记淤积' | '预警溢流' | '确认封堵' | '解除封堵' | '确认归属'
export const DRAIN_ACTIONS: DrainAction[] = ['标记淤积', '预警溢流', '确认封堵', '解除封堵', '确认归属']

// 状态类动作：会改变管段运行状态，受封堵终态与归属限制。
export const STATE_ACTIONS: DrainAction[] = ['标记淤积', '预警溢流', '确认封堵', '解除封堵']

export type DrainHistoryEntry = {
  time: string
  action: string
  operator: string
  detail: string
}

export type DrainRow = EntryRow & {
  id: number
  status: DrainStatus
  pending: boolean
  abnormal: boolean
  管辖区域: string
  共享区域: string
  归属状态: OwnershipStatus
  归属区域: string
  version: number
  history: DrainHistoryEntry[]
}

// 操作人上下文：区域人员带 area，上级单位 area 为空。
export type OperatorContext = {
  role: 'area' | 'superior'
  area: string
  name: string
}

export type DrainActionResult = {
  ok: boolean
  message: string
  // 冲突时为最新管段，界面应放弃本地旧数据、刷新成该结果。
  latest?: DrainRow
}
