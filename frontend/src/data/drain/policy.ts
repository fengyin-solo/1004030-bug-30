import type { DrainRow, DrainAction, DrainStatus, OperatorContext, OwnershipStatus } from './types'
import { STATE_ACTIONS } from './types'

// 权限与状态流转策略：排水管段详情、列表、工作台共用这一份，避免「列表能点、详情提示无权限」之类的不一致。

function text(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback
  return String(value)
}

// 把通用存储行（含旧版本示例数据）规整成排水管网领域行。
// 旧数据没有归属/版本字段：默认归属其本身所在的示例区域，保证升级后状态不丢、行为可预期。
export function normalizeDrainRow(raw: Record<string, unknown>, index: number): DrainRow {
  const status = text(raw.status, '正常') as DrainStatus
  const ownershipStatus: OwnershipStatus =
    raw.归属状态 === 'pending' || raw.归属状态 === 'confirmed'
      ? raw.归属状态
      : 'confirmed'
  const homeArea = text(raw.管辖区域, '城东')
  const ownerArea = text(raw.归属区域, ownershipStatus === 'confirmed' ? homeArea : '')
  const normalized: DrainRow = {
    ...(raw as DrainRow),
    id: Number(raw.id ?? index + 1),
    status,
    管辖区域: homeArea,
    共享区域: text(raw.共享区域, ''),
    归属状态: ownershipStatus,
    归属区域: ownerArea,
    version: Number(raw.version ?? 1),
    history: Array.isArray(raw.history)
      ? (raw.history as DrainRow['history'])
      : buildLegacyHistory(status, raw),
  }
  normalized.pending = isPendingStatus(normalized.status)
  normalized.abnormal = isActiveAbnormal(normalized.status)
  return normalized
}

function buildLegacyHistory(status: DrainStatus, raw: Record<string, unknown>): DrainRow['history'] {
  // 兼容升级前已产生预警的老数据：补一条历史，保证「历史预警可查」。
  const history: DrainRow['history'] = [
    { time: '2026-09-30 00:00', action: '数据迁移', operator: '系统', detail: '旧版数据补登归属与历史。' },
  ]
  if (status === '淤积预警' || status === '溢流风险' || status === '已封堵') {
    history.push({
      time: '2026-09-30 00:00',
      action: status === '已封堵' ? '确认封堵' : '标记淤积',
      operator: text(raw['管辖区域'], '历史') + '·历史值班员',
      detail: '迁移前已存在的预警记录，按历史预警保留。',
    })
  }
  return history
}

export function isBlocked(status: DrainStatus): boolean {
  return status === '已封堵'
}

// 活动异常：只有未封堵的淤积预警、溢流风险计入运营概览异常量。
// 封堵是处置完成态：异常清零，历史预警仍可在详情里查到，因此封堵后异常量不会继续增加。
export function isActiveAbnormal(status: DrainStatus): boolean {
  return status === '淤积预警' || status === '溢流风险'
}

export function isPendingStatus(status: DrainStatus): boolean {
  return status === '淤积预警' || status === '溢流风险'
}

export type AccessKind = 'owner' | 'cross-area' | 'superior' | 'shared-pending'

export type ActionPermission = {
  allowed: boolean
  // 不允许时必须给出具体原因，界面原样展示，状态保持不变。
  reason: string
}

// 先判定查看视角，再判定具体动作。
export function describeAccess(row: DrainRow, operator: OperatorContext): {
  kind: AccessKind
  label: string
  canEdit: boolean
} {
  if (operator.role === 'superior') {
    // 上级可以看全部；除「确认归属」外不直接改业务状态，属于只读+归属裁定视角。
    return { kind: 'superior', label: '上级单位视角：可查看全部管段，可裁定共享管段归属', canEdit: false }
  }
  if (row.归属状态 === 'pending') {
    return {
      kind: 'shared-pending',
      label: '跨区域共享管段，归属待上级确认：双方区域人员只能查看',
      canEdit: false,
    }
  }
  if (row.归属区域 === operator.area) {
    return { kind: 'owner', label: `本管辖区域（${operator.area}）管段，可在权限范围内操作`, canEdit: true }
  }
  return {
    kind: 'cross-area',
    label: `归属${row.归属区域}管辖，${operator.area}为跨区域人员，仅可查看`,
    canEdit: false,
  }
}

export function evaluateAction(
  row: DrainRow,
  action: DrainAction,
  operator: OperatorContext,
): ActionPermission {
  // 1. 上级单位：只能确认共享管段归属，不直接改运行状态。
  if (operator.role === 'superior') {
    if (action === '确认归属') {
      if (row.归属状态 === 'confirmed') {
        return { allowed: false, reason: '该管段归属已确认，无需重复确认' }
      }
      if (!row.共享区域) {
        return { allowed: false, reason: '该管段不是跨区域共享管段，无需上级确认归属' }
      }
      return { allowed: true, reason: '' }
    }
    return {
      allowed: false,
      reason: `上级单位不直接执行「${action}」，运行状态由归属区域（${row.归属区域 || '待确认'}）人员操作`,
    }
  }

  // 2. 区域人员执行状态类动作。
  if (STATE_ACTIONS.includes(action)) {
    // 归属未确认：任何区域都不能动。
    if (row.归属状态 === 'pending') {
      return {
        allowed: false,
        reason: `共享管段归属尚未经上级确认（涉及${row.管辖区域}/${row.共享区域}），确认前双方只能查看，不能${action}`,
      }
    }
    // 归属已确认但不是本辖区：跨区域只读。
    if (row.归属区域 !== operator.area) {
      return {
        allowed: false,
        reason: `该管段归属${row.归属区域}管辖，${operator.area}为跨区域人员，仅可查看，不能${action}`,
      }
    }
    // 封堵终态：保留历史预警，但不再产生新的状态动作；本辖区也只能走「解除封堵」。
    if (isBlocked(row.status) && action !== '解除封堵') {
      return {
        allowed: false,
        reason: '管段已封堵，历史预警保留但不再产生新动作；如需恢复，请由本辖区执行「解除封堵」',
      }
    }
    if (action === '解除封堵' && !isBlocked(row.status)) {
      return { allowed: false, reason: '管段当前未封堵，无需解除' }
    }
    return { allowed: true, reason: '' }
  }

  // 3. 区域人员不能确认归属。
  if (action === '确认归属') {
    return { allowed: false, reason: '共享管段归属由上级单位确认，区域人员无此权限' }
  }

  return { allowed: false, reason: `未识别的动作：${action}` }
}

// 状态机：即便绕过按钮直接调用，状态流转本身也再校验一遍，封堵后无法产生新预警。
export function nextStatus(row: DrainRow, action: DrainAction): DrainStatus | null {
  switch (action) {
    case '标记淤积':
      if (row.status === '淤积预警') return null
      return '淤积预警'
    case '预警溢流':
      if (row.status === '溢流风险') return null
      return '溢流风险'
    case '确认封堵':
      return '已封堵'
    case '解除封堵':
      return '正常'
    case '确认归属':
      return row.status
  }
}

export function isStateAction(action: DrainAction): boolean {
  return STATE_ACTIONS.includes(action)
}
