<template>
  <section class="page" data-module="drain_network">
    <header class="page-head">
      <div>
        <h2>排水管网管理</h2>
        <p class="page-desc">维护排水管段，围绕管段编号、上游节点、下游节点、管段长度做登记、筛选与状态流转。</p>
        <p class="perm-note">
          当前账号：{{ session.region }} · {{ session.role }}。
          仅本管辖区域且归属已确认的管段可修改；跨区域与待确认归属的共享管段只读；已封堵管段锁定，历史预警保留。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记排水管段</button>
        <button class="btn" type="button" @click="exportRows">导出排水管网清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="operableActions(row).length">
              <button
                v-for="action in operableActions(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="readonly-tag">{{ readonlyReason(row) }}</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无排水管网数据，可先登记排水管段</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条排水管网记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('drain_network')
const session = useSessionStore()
const columns = ["管段编号", "上游节点", "下游节点", "管段长度", "断面尺寸", "设计坡度", "排水能力", "运行状况", "管辖区域", "共享区域", "归属确认", "历史预警"]
const operateActions = ["标记淤积", "预警溢流", "确认封堵"]
const ownershipAction = "确认归属"
const sealedStatus = "已封堵"
const statuses = ["正常", "淤积预警", "溢流风险", "已封堵"]
const stats = [{"label": "管段总数", "value": 0}, {"label": "淤积预警管段", "value": 0}, {"label": "溢流风险管段", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function displayCell(row: EntryRow, column: string) {
  const value = row[column]
  if (value === undefined || value === null || String(value).trim() === '') {
    return '—'
  }
  return value
}

// 当前账号对这行能执行的动作：封堵锁定、归属缺失、待确认、跨区域都是只读。
function operableActions(row: EntryRow): string[] {
  if (String(row.status) === sealedStatus) {
    return []
  }
  const owner = String(row['管辖区域'] ?? '').trim()
  if (!owner) {
    return []
  }
  if (String(row['归属确认']) !== '已确认') {
    return session.isSuperior ? [ownershipAction] : []
  }
  if (owner !== session.region) {
    return []
  }
  return operateActions
}

// 只读原因直接展示在行内，越权或归属缺失都要能说明原因。
function readonlyReason(row: EntryRow): string {
  if (String(row.status) === sealedStatus) {
    return '只读：已封堵，历史预警保留'
  }
  const owner = String(row['管辖区域'] ?? '').trim()
  if (!owner) {
    return '只读：归属缺失，待上级确认'
  }
  if (String(row['归属确认']) !== '已确认') {
    return '只读：共享管段，归属待上级确认'
  }
  if (owner !== session.region) {
    return `只读：归属「${owner}」`
  }
  return '只读'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '排水管段登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, {
    region: session.region,
    role: session.role,
    expectedVersion: Number(row.version ?? 1),
  })
  if (!result.ok) {
    // 越权、归属缺失或并发冲突：提示原因并重新拉取，保持原状态。
    errorMessage.value = result.message
    reload()
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '排水管网列表读取失败'
  }
}

onMounted(reload)
</script>
