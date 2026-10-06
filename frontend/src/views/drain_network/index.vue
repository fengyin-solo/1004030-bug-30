<template>
  <section class="page" data-module="drain_network">
    <header class="page-head">
      <div>
        <h2>排水管网管理</h2>
        <p class="page-desc">
          按管辖区域维护排水管段：本辖区可在权限内处理淤积/溢流/封堵，跨区域只读，跨区域共享管段归属须由上级确认。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出排水管网清单</button>
      </div>
    </header>

    <div class="identity-banner" :class="store.role">
      <div class="identity-main">
        <strong>{{ store.roleLabel }}</strong>
        <span v-if="store.role === 'area'">管辖区域：{{ store.area || '未指定' }}</span>
        <span v-else>不绑定具体区域，可跨区查看并裁定共享管段归属</span>
      </div>
      <p class="identity-rule">
        {{
          store.role === 'superior'
            ? '可查看全部管段；仅可对跨区域共享管段「确认归属」，不直接改变运行状态。'
            : '仅归属本辖区的管段可修改；其他区域与归属待确认的共享管段只能查看。'
        }}
      </p>
    </div>

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
      <span class="legend-item warn">共享待确认归属：{{ overview.sharedPending }}</span>
      <span class="legend-item muted">当前身份可修改：{{ overview.actionable }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="submitSearch">
      <label class="filter-item">
        <span>管段编号</span>
        <input v-model="filters['管段编号']" placeholder="按管段编号检索" />
      </label>
      <label class="filter-item">
        <span>管辖区域</span>
        <input v-model="filters['管辖区域']" placeholder="按管辖区域检索" />
      </label>
      <label class="filter-item">
        <span>共享区域</span>
        <input v-model="filters['共享区域']" placeholder="按共享区域检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>归属</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ display(row, column) }}</td>
          <td>
            <span class="tag" :class="row.归属状态 === 'pending' ? 'tag-warn' : 'tag-ok'">
              {{ row.归属状态 === 'pending' ? '待上级确认' : `归属${row.归属区域}` }}
            </span>
          </td>
          <td>
            <span class="status-text" :class="`st-${row.status}`">{{ row.status }}</span>
            <span class="version-text">v{{ row.version }}</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              :disabled="!canDo(row, action).allowed"
                  :title="canDo(row, action).reason"
                  type="button"
                  @click="openDetail(row, action)"
                >
                  {{ action }}
                </button>
                <button class="link detail-link" type="button" @click="openDetail(row)">详情</button>
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td :colspan="columns.length + 3" class="empty-state">暂无符合条件的排水管段</td>
            </tr>
          </tbody>
        </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条排水管段 · 权限、状态、异常量与运营概览工作台实时一致</span>
      <span v-if="feedback.ok" class="ok-text">{{ feedback.text }}</span>
      <span v-else-if="feedback.text" class="error-text">{{ feedback.text }}</span>
    </footer>

    <!-- 管段详情：跨区域只读、共享待确认只读提示都在这里说明；动作结果与列表共用同一套策略。 -->
    <div v-if="detail" class="modal-mask" @click.self="closeDetail">
      <div class="modal">
        <header class="modal-head">
          <h3>排水管段详情 · {{ detail.row['管段编号'] }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>

        <div class="access-note" :class="detailAccess.kind">
          <strong>{{ accessTitle(detailAccess.kind) }}</strong>
          <span>{{ detailAccess.label }}</span>
        </div>

        <dl class="detail-grid">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ display(detail.row, field) }}</dd>
          </template>
          <dt>归属状态</dt>
          <dd>
            <span class="tag" :class="detail.row.归属状态 === 'pending' ? 'tag-warn' : 'tag-ok'">
              {{ detail.row.归属状态 === 'pending' ? '待上级确认' : '已确认' }}
            </span>
          </dd>
          <dt>归属区域</dt>
          <dd>{{ detail.row.归属区域 || '尚未裁定' }}</dd>
          <dt>数据版本</dt>
          <dd>v{{ detail.row.version }}</dd>
        </dl>

        <div v-if="detail.row.status === '已封堵'" class="blocked-note">
          该管段已封堵：历史预警保留（见下方操作记录），封堵期间不再产生标记淤积、预警溢流等新动作。
        </div>

        <div class="detail-actions">
          <template v-for="action in availableActions(detail.row)" :key="action">
            <button
              class="btn"
              :class="primaryAction(action)"
              :disabled="!canDo(detail.row, action).allowed"
              :title="canDo(detail.row, action).reason"
              type="button"
              @click="perform(action)"
            >
              {{ action }}
            </button>
          </template>
        </div>
        <p v-for="denied in deniedReasons(detail.row)" :key="denied.action" class="deny-line">
          「{{ denied.action }}」不可用：{{ denied.reason }}
        </p>

        <div v-if="store.isSuperior && detail.row.归属状态 === 'pending'" class="assign-box">
          <strong>上级裁定共享管段归属</strong>
          <div class="assign-row">
            <label>
              <input v-model="assignArea" type="radio" :value="detail.row.管辖区域" />
              归属 {{ detail.row.管辖区域 }}（管辖区域）
            </label>
            <label>
              <input v-model="assignArea" type="radio" :value="detail.row.共享区域" />
              归属 {{ detail.row.共享区域 }}（共享区域）
            </label>
            <button class="btn primary" type="button" @click="perform('确认归属')">确认归属</button>
          </div>
        </div>

        <section class="history-box">
          <h4>历史预警与操作记录（封堵后保留，不再新增状态动作）</h4>
          <ul>
            <li v-for="(item, i) in [...detail.row.history].reverse()" :key="i">
              <span class="history-time">{{ item.time }}</span>
              <span class="history-action">{{ item.action }}</span>
              <span class="history-operator">{{ item.operator }}</span>
              <span class="history-detail">{{ item.detail }}</span>
            </li>
          </ul>
        </section>

        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="simulateConcurrent">模拟他人同时操作（验证并发冲突）</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import {
  DRAIN_ACTIONS,
  describeAccess,
  drainOverview,
  evaluateAction,
  executeDrainAction,
  exportDrainCsv,
  listDrain,
  simulateExternalUpdate,
} from '@/data/drain'
import type { DrainAction, DrainRow, OperatorContext } from '@/data/drain'
import { useSessionStore } from '@/stores/session'
import { reloadFromStorage, storageKey } from '@/data/local-store'

const store = useSessionStore()

const columns = [
  '管段编号',
  '上游节点',
  '下游节点',
  '管段长度',
  '断面尺寸',
  '排水能力',
  '运行状况',
  '管辖区域',
  '共享区域',
] as const

const detailFields = [
  '管段编号',
  '上游节点',
  '下游节点',
  '管段长度',
  '断面尺寸',
  '设计坡度',
  '排水能力',
  '运行状况',
  '管辖区域',
  '共享区域',
] as const

// 列表与详情展示的动作集合一致，差异只由同一份 evaluateAction 判定，杜绝两处口径不一致。
function availableActions(row: DrainRow): DrainAction[] {
  // 上级只做归属裁定；区域人员看状态类动作。
  if (store.role === 'superior') {
    return ['确认归属']
  }
  return row.status === '已封堵'
    ? ['标记淤积', '预警溢流', '解除封堵']
    : DRAIN_ACTIONS.filter((action) => action !== '确认归属')
}

const rows = ref<DrainRow[]>([])
const filters = ref<Record<string, string>>({})
const feedback = reactive({ ok: false, text: '' })

const operator = computed<OperatorContext>(() => ({
  role: store.role,
  area: store.area,
  name: store.operator,
}))

const overview = ref(drainOverview(operator.value))

const statusSummary = computed(() =>
  overview.value.statusCounts.map((item) => ({ status: item.status, count: item.count })),
)

const stats = computed(() => [
  { label: '管段总数', value: overview.value.total },
  { label: '活动异常（未封堵）', value: overview.value.activeAbnormal },
  { label: '已封堵（不计异常）', value: overview.value.blocked },
  { label: '我可修改管段', value: overview.value.actionable },
])

function display(row: DrainRow, field: string): string {
  const value = row[field]
  if (field === '共享区域') return value ? String(value) : '—'
  return value === null || value === undefined ? '—' : String(value)
}

function canDo(row: DrainRow, action: DrainAction) {
  return evaluateAction(row, action, operator.value)
}

const detail = ref<{ row: DrainRow } | null>(null)
const assignArea = ref('')

const detailAccess = computed(() =>
  detail.value ? describeAccess(detail.value.row, operator.value) : describeAccess(rows.value[0] ?? emptyRow(), operator.value),
)

function emptyRow(): DrainRow {
  return {
    id: 0,
    status: '正常',
    pending: false,
    abnormal: false,
    管辖区域: '',
    共享区域: '',
    归属状态: 'confirmed',
    归属区域: '',
    version: 0,
    history: [],
  }
}

function accessTitle(kind: string): string {
  switch (kind) {
    case 'owner':
      return '本管辖区域 · 可操作'
    case 'cross-area':
      return '跨区域 · 只读'
    case 'shared-pending':
      return '共享管段归属待确认 · 只读'
    case 'superior':
      return '上级单位视角'
    default:
      return ''
  }
}

function deniedReasons(row: DrainRow) {
  return availableActions(row)
    .map((action) => ({ action, ...evaluateAction(row, action, operator.value) }))
    .filter((item) => !item.allowed)
}

function primaryAction(action: DrainAction): string {
  return action === '解除封堵' || action === '确认封堵' ? 'primary' : ''
}

function openDetail(row: DrainRow, preselect?: DrainAction) {
  assignArea.value = row.管辖区域
  detail.value = { row }
  feedback.text = ''
  if (preselect && !evaluateAction(row, preselect, operator.value).allowed) {
    feedback.ok = false
    feedback.text = evaluateAction(row, preselect, operator.value).reason
  }
}

function closeDetail() {
  detail.value = null
}

function perform(action: DrainAction) {
  if (!detail.value) return
  const current = detail.value.row
  const result = executeDrainAction(current.id, action, operator.value, {
    expectedVersion: current.version,
    assignArea: assignArea.value,
  })
  feedback.ok = result.ok
  feedback.text = result.message

  if (result.ok && result.latest) {
    detail.value = { row: result.latest }
    reload(false)
    return
  }
  if (result.latest) {
    // 版本冲突：他人结果有效，本操作作废，弹窗与列表都切到最新管段。
    detail.value = { row: result.latest }
    reload(false)
  }
}

function simulateConcurrent() {
  if (!detail.value) return
  const updated = simulateExternalUpdate(detail.value.row.id)
  if (updated) {
    feedback.ok = false
    feedback.text = '已模拟另一值班端抢先保存（版本升到 v' + updated.version + '）。现在再执行任意动作，将只有对方的结果有效、本端被拒绝。'
    // 故意保留弹窗里的旧 row（旧版本号），下一次 perform 才会触发乐观锁冲突。
  }
}

function exportRows() {
  const { filename, content } = exportDrainCsv()
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

function resetFilters() {
  filters.value = {}
  reload()
}

function submitSearch() {
  reload()
}

function reload(showTip = true) {
  if (!showTip) feedback.text = ''
  rows.value = listDrain(filters.value)
  overview.value = drainOverview(operator.value)
  if (detail.value) {
    const latest = rows.value.find((row) => row.id === detail.value?.row.id)
    if (latest) detail.value = { row: latest }
  }
}

// 其他浏览器页签保存后，本页签自动丢弃缓存并刷新，避免用旧版本覆盖别人的结果。
function onStorage(event: StorageEvent) {
  if (event.key === storageKey()) {
    reloadFromStorage()
    reload(false)
  }
}

onMounted(() => {
  reload()
  window.addEventListener('storage', onStorage)
})
onBeforeUnmount(() => window.removeEventListener('storage', onStorage))
</script>

<style scoped>
.identity-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  border: 1px solid var(--border);
  border-left: 4px solid var(--brand);
  background: #fff;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
}
.identity-banner.superior {
  border-left-color: #b54708;
}
.identity-main {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 13px;
}
.identity-rule {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}
.version-text {
  margin-left: 6px;
  color: var(--muted);
  font-size: 11px;
}
.tag {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 9px;
  font-size: 12px;
}
.tag-ok {
  background: #e7f6ec;
  color: #17643a;
}
.tag-warn {
  background: #fdeedd;
  color: #9a5207;
}
.status-text {
  font-weight: 600;
}
.st-正常 {
  color: #17643a;
}
.st-淤积预警 {
  color: #b54708;
}
.st-溢流风险 {
  color: #b42318;
}
.st-已封堵 {
  color: #475467;
}
.link:disabled {
  color: #9aa5b1;
  cursor: not-allowed;
}
.detail-link {
  color: #475467;
}
.legend-item.warn {
  background: #fdeedd;
  color: #9a5207;
}
.legend-item.muted {
  background: #eef2f7;
}
.ok-text {
  color: #17643a;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  background: #fff;
  border-radius: 10px;
  width: 760px;
  max-width: 94vw;
  max-height: 88vh;
  overflow: auto;
  padding: 16px 18px;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.modal-head h3 {
  margin: 0;
  font-size: 16px;
}
.access-note {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 8px;
  padding: 8px 12px;
  margin: 12px 0;
  font-size: 12px;
  background: #eef2f7;
  border: 1px solid var(--border);
}
.access-note.owner {
  background: #e7f6ec;
  border-color: #abd6bc;
}
.access-note.cross-area,
.access-note.shared-pending {
  background: #f2f4f7;
  border-color: #cfd6e0;
  color: #475467;
}
.access-note.superior {
  background: #fdf3e7;
  border-color: #f3d3ad;
}
.detail-grid {
  display: grid;
  grid-template-columns: 110px 1fr 110px 1fr;
  gap: 6px 12px;
  margin: 0 0 12px;
  font-size: 13px;
}
.detail-grid dt {
  color: var(--muted);
}
.detail-grid dd {
  margin: 0;
}
.blocked-note {
  background: #f2f4f7;
  border: 1px dashed #98a2b3;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: #475467;
  margin-bottom: 12px;
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.deny-line {
  margin: 6px 0 0;
  font-size: 12px;
  color: #b42318;
}
.assign-box {
  margin-top: 12px;
  border: 1px solid #f3d3ad;
  background: #fdf8f2;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}
.assign-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  margin-top: 8px;
}
.history-box {
  margin-top: 14px;
}
.history-box h4 {
  margin: 0 0 6px;
  font-size: 13px;
}
.history-box ul {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);
}
.history-box li {
  display: grid;
  grid-template-columns: 130px 84px 130px 1fr;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px dashed #e4e9f0;
  font-size: 12px;
}
.history-time {
  color: var(--muted);
}
.history-action {
  font-weight: 600;
}
.modal-foot {
  margin-top: 12px;
  text-align: right;
}
</style>
