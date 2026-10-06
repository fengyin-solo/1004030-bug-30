import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionContext,
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 排水管网的治理常量：封堵是终态，预警态计入异常，共享管段归属要上级确认。
const DRAIN_KEY = 'drain_network'
const DRAIN_SEALED_STATUS = '已封堵'
const DRAIN_WARNING_STATUSES = ['淤积预警', '溢流风险']
const DRAIN_OWNERSHIP_ACTION = '确认归属'
const SUPERIOR_ROLE = '上级主管'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 旧数据没有治理字段，读取时补齐默认值：缺管辖区域按「归属缺失」处理，有共享区域按「待上级确认」处理。
function normalizeDrainRow(row: EntryRow): EntryRow {
  const shared = String(row['共享区域'] ?? '')
  return {
    ...row,
    version: Number(row.version ?? 1),
    管辖区域: String(row['管辖区域'] ?? ''),
    共享区域: shared,
    归属确认: String(row['归属确认'] ?? (shared.trim() !== '' ? '待上级确认' : '已确认')),
    历史预警: String(row['历史预警'] ?? ''),
  }
}

// 排水管段的异常口径：预警态算异常；已封堵保留封堵前的历史异常标记，不再新增。
function drainAbnormal(row: EntryRow): boolean {
  const status = String(row.status)
  if (DRAIN_WARNING_STATUSES.includes(status)) {
    return true
  }
  if (status === DRAIN_SEALED_STATUS) {
    return Boolean(row.abnormal)
  }
  return false
}

function rowAbnormal(key: string, row: EntryRow): boolean {
  if (key === DRAIN_KEY) {
    return drainAbnormal(row)
  }
  return Boolean(row.abnormal)
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const source = key === DRAIN_KEY ? listRows(key).map(normalizeDrainRow) : listRows(key)
  const matched = filterRows(source, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  context: ActionContext = {},
): ActionResult {
  if (key === DRAIN_KEY) {
    return runDrainAction(id, action, context)
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 排水管段专用流转：在通用流转之外叠加区域权限、封堵锁定、归属确认与并发控制。
// 任何校验不通过都只返回原因，不写数据，保持原状态。
function runDrainAction(id: number, action: string, context: ActionContext): ActionResult {
  const meta = moduleMeta(DRAIN_KEY)
  const rows = listRows(DRAIN_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = normalizeDrainRow(rows[index])

  // 并发守卫：页面带过来的版本号与存储不一致，说明别人已改过，本次操作作废。
  if (context.expectedVersion !== undefined && Number(current.version) !== context.expectedVersion) {
    return { ok: false, message: '该管段刚被其他值班员更新，已保持原状态，请刷新列表后重试' }
  }

  // 「确认归属」不是状态流转，单独处理。
  if (action === DRAIN_OWNERSHIP_ACTION) {
    return confirmDrainOwnership(rows, index, current, context)
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }

  // 封堵锁定：历史预警保留，但不能再产生新动作。
  if (String(current.status) === DRAIN_SEALED_STATUS) {
    return { ok: false, message: `${meta.entity}已封堵，历史预警保留，不能再产生新动作，已保持原状态` }
  }

  // 归属缺失：说明原因并保持原状态。
  const owner = String(current['管辖区域']).trim()
  if (!owner) {
    return { ok: false, message: '该管段缺少管辖区域归属，需上级先确认归属，已保持原状态' }
  }

  // 共享管段归属未确认前，所有区域都只读。
  if (String(current['归属确认']) !== '已确认') {
    return { ok: false, message: '该管段跨区域共享，归属待上级确认，确认前各区域均只读，已保持原状态' }
  }

  // 区域权限：只有本管辖区域能修改，跨区域只能查看。
  const region = context.region ?? ''
  if (owner !== region) {
    return {
      ok: false,
      message: `该管段归属「${owner}」，当前账号属「${region || '未分配区域'}」，跨区域仅可查看，已保持原状态`,
    }
  }

  if (String(current.status) === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  const updated: EntryRow = {
    ...current,
    status: target,
    pending: target !== DRAIN_SEALED_STATUS,
    abnormal: drainAbnormal({ ...current, status: target }),
    历史预警: appendDrainHistory(current, target),
    version: Number(current.version) + 1,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(DRAIN_KEY, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 共享管段的归属确认：只有上级主管能执行，确认后归属区域才能操作，其他区域只读。
function confirmDrainOwnership(
  rows: EntryRow[],
  index: number,
  current: EntryRow,
  context: ActionContext,
): ActionResult {
  if (context.role !== SUPERIOR_ROLE) {
    return { ok: false, message: '跨区域共享管段的归属需由上级主管确认，当前账号无权确认，已保持原状态' }
  }
  const owner = String(current['管辖区域']).trim()
  if (!owner) {
    return { ok: false, message: '该管段缺少管辖区域，无法确认归属，已保持原状态' }
  }
  if (String(current['归属确认']) === '已确认') {
    return { ok: false, message: '该管段归属已确认，无需重复操作' }
  }
  const updated: EntryRow = {
    ...current,
    归属确认: '已确认',
    version: Number(current.version) + 1,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(DRAIN_KEY, next)
  return { ok: true, message: `上级已确认管段归属「${owner}」，其他共享区域转为只读` }
}

// 封堵时把在案的预警状态记入历史预警，封堵后历史仍可查。
function appendDrainHistory(row: EntryRow, target: string): string {
  const history = String(row['历史预警'] ?? '').trim()
  const status = String(row.status)
  if (target !== DRAIN_SEALED_STATUS || !DRAIN_WARNING_STATUSES.includes(status)) {
    return history
  }
  return history ? `${history}→${status}` : status
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => rowAbnormal(meta.key, row)).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
