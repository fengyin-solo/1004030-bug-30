import { readRaw, writeRaw } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

import {
  describeAccess,
  evaluateAction,
  isPendingStatus,
  isActiveAbnormal,
  nextStatus,
  normalizeDrainRow,
} from './policy'
import type {
  DrainAction,
  DrainActionResult,
  DrainHistoryEntry,
  DrainRow,
  OperatorContext,
} from './types'
import { DRAIN_KEY } from './types'

// 排水管网专用数据服务：独立于通用 runAction，承担数据迁移、版本乐观锁与领域统计。
// 所有读写都先 readRaw 取最新快照，保证多个值班端、多个浏览器页签并发时只有一个结果生效。

type RawTable = Record<string, EntryRow[]>

function readDrainTable(): { table: RawTable; rows: DrainRow[] } {
  const table = readRaw()
  const rawRows = (table[DRAIN_KEY] ?? []) as Array<Record<string, unknown>>
  const rows = rawRows.map((raw, index) => normalizeDrainRow(raw, index))
  return { table, rows }
}

// 首次使用排水管网时，把旧版通用数据补齐归属/版本字段并落盘，只写一次。
function migrateIfNeeded(): DrainRow[] {
  const { table, rows } = readDrainTable()
  const rawRows = table[DRAIN_KEY] ?? []
  const needsMigration = rawRows.some(
    (raw) =>
      typeof raw.version !== 'number' ||
      typeof raw['管辖区域'] !== 'string' ||
      typeof raw['归属状态'] !== 'string' ||
      !Array.isArray(raw.history),
  )
  if (needsMigration) {
    table[DRAIN_KEY] = rows as unknown as EntryRow[]
    writeRaw(table)
  }
  return rows
}

export function listDrain(filters: Record<string, string> = {}): DrainRow[] {
  const rows = migrateIfNeeded()
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) return rows
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function getDrain(id: number): DrainRow | undefined {
  return migrateIfNeeded().find((row) => Number(row.id) === id)
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function operatorLabel(operator: OperatorContext): string {
  return operator.role === 'superior'
    ? `上级单位·${operator.name}`
    : `${operator.area}·${operator.name}`
}

function successDetail(action: DrainAction, row: DrainRow, assignArea?: string): string {
  switch (action) {
    case '标记淤积':
      return '检测发现淤积，标记为淤积预警。'
    case '预警溢流':
      return '液位持续偏高，升级为溢流风险。'
    case '确认封堵':
      return '执行封堵作业，进入已封堵终态；历史预警保留，封堵期间不再产生新动作。'
    case '解除封堵':
      return '封堵解除，恢复正常运行；历史预警仍保留在操作记录中。'
    case '确认归属':
      return `上级裁定共享管段归属「${assignArea}」，此后仅${assignArea}区域人员可修改，其他区域只读。`
  }
}

export type ExecuteOptions = {
  // 界面拿到管段时的版本号；与存储中最新版本不一致说明已被他人抢先操作。
  expectedVersion: number
  // 仅「确认归属」使用：上级裁定的归属区域，必须是管辖区域或共享区域之一。
  assignArea?: string
}

// 执行排水管段动作。越权 / 归属缺失 / 状态终态 / 版本冲突都会返回 ok:false 且不改任何数据。
export function executeDrainAction(
  id: number,
  action: DrainAction,
  operator: OperatorContext,
  options: ExecuteOptions,
): DrainActionResult {
  const { table, rows } = readDrainTable()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的排水管段` }
  }
  const current = rows[index]

  // 乐观锁：版本对不上，说明已有人先操作，本结果作废并回传最新管段。
  if (current.version !== options.expectedVersion) {
    return {
      ok: false,
      latest: current,
      message: `该管段刚被其他值班人员更新（最新版本 v${current.version}，你持有的是 v${options.expectedVersion}）。为避免多人操作互相覆盖，本次未生效，已刷新为最新状态。`,
    }
  }

  const permission = evaluateAction(current, action, operator)
  if (!permission.allowed) {
    // 越权或归属缺失：说明原因，保持原状态，不写版本、不写历史。
    return { ok: false, message: permission.reason }
  }

  let updated: DrainRow
  const baseHistory: DrainHistoryEntry = {
    time: nowText(),
    action,
    operator: operatorLabel(operator),
    detail: successDetail(action, current, options.assignArea),
  }

  if (action === '确认归属') {
    const assignArea = options.assignArea ?? ''
    if (assignArea !== current.管辖区域 && assignArea !== current.共享区域) {
      return { ok: false, message: '归属区域必须是该共享管段涉及的两个区域之一' }
    }
    updated = {
      ...current,
      归属状态: 'confirmed',
      归属区域: assignArea,
      version: current.version + 1,
      history: [...current.history, baseHistory],
    }
  } else {
    const target = nextStatus(current, action)
    if (target === null) {
      return { ok: false, message: `管段已经是「${current.status}」，不用重复操作` }
    }
    updated = {
      ...current,
      status: target,
      pending: isPendingStatus(target),
      abnormal: isActiveAbnormal(target),
      version: current.version + 1,
      history: [...current.history, baseHistory],
    }
  }

  rows[index] = updated
  table[DRAIN_KEY] = rows as unknown as EntryRow[]
  writeRaw(table)

  const stateNote =
    action === '解除封堵'
      ? `，已恢复「${updated.status}」，历史预警 ${updated.history.filter((h) => h.action === '标记淤积' || h.action === '预警溢流').length} 条保留`
      : `，当前状态「${updated.status}」，数据版本 v${updated.version}`
  return { ok: true, message: `排水管段 ${String(updated['管段编号'])} 已${action}${stateNote}`, latest: updated }
}

// 并发演示：模拟另一个值班端抢先保存（不经过当前弹窗的版本号），当前操作随即会撞上版本冲突。
export function simulateExternalUpdate(id: number): DrainRow | undefined {
  const { table, rows } = readDrainTable()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) return undefined
  const current = rows[index]
  const updated: DrainRow = {
    ...current,
    version: current.version + 1,
    history: [
      ...current.history,
      {
        time: nowText(),
        action: '并发更新',
        operator: '另一值班端',
        detail: '另一个值班端已抢先保存本管段（多人同时操作演示）。',
      },
    ],
  }
  rows[index] = updated
  table[DRAIN_KEY] = rows as unknown as EntryRow[]
  writeRaw(table)
  return updated
}

export type DrainOverview = {
  total: number
  activeAbnormal: number
  blocked: number
  sharedPending: number
  // 当前登录身份可直接修改的管段数：列表、详情、工作台口径一致。
  actionable: number
  statusCounts: { status: string; count: number }[]
}

export function drainOverview(operator: OperatorContext): DrainOverview {
  const rows = migrateIfNeeded()
  return {
    total: rows.length,
    activeAbnormal: rows.filter((row) => row.abnormal).length,
    blocked: rows.filter((row) => row.status === '已封堵').length,
    sharedPending: rows.filter((row) => row.归属状态 === 'pending').length,
    actionable: rows.filter((row) => describeAccess(row, operator).canEdit).length,
    statusCounts: ['正常', '淤积预警', '溢流风险', '已封堵'].map((status) => ({
      status,
      count: rows.filter((row) => row.status === status).length,
    })),
  }
}

// 运营概览工作台读取排水管网异常量时使用同一口径：封堵不计异常，封堵后异常量不再增加。
export function drainAbnormalCount(): number {
  return migrateIfNeeded().filter((row) => row.abnormal).length
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportDrainCsv(): { filename: string; content: string } {
  const rows = migrateIfNeeded()
  const header = [
    '编号',
    '管段编号',
    '上游节点',
    '下游节点',
    '管段长度',
    '当前状态',
    '管辖区域',
    '共享区域',
    '归属区域',
    '归属状态',
    '数据版本',
  ]
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row['管段编号'],
        row['上游节点'],
        row['下游节点'],
        row['管段长度'],
        row.status,
        row.管辖区域,
        row.共享区域 || '—',
        row.归属区域 || '—',
        row.归属状态 === 'confirmed' ? '已确认' : '待上级确认',
        `v${row.version}`,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return { filename: '排水管网-清单.csv', content: `﻿${lines.join('\n')}` }
}
