<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <!-- 排水管网专区：与管段列表、详情共用同一套归属/权限/异常口径。 -->
    <section class="drain-panel">
      <header class="drain-panel-head">
        <h3>排水管网 · 权限与异常概览（{{ store.roleLabel }}<template v-if="store.role === 'area'"> · {{ store.area }}</template>）</h3>
        <RouterLink class="link" to="/drain_network">进入管段列表 →</RouterLink>
      </header>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">活动异常（未封堵）</span>
          <strong class="stat-value">{{ drain.activeAbnormal }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已封堵（不计异常）</span>
          <strong class="stat-value">{{ drain.blocked }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">共享待确认归属</span>
          <strong class="stat-value">{{ drain.sharedPending }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">当前身份可修改</span>
          <strong class="stat-value">{{ drain.actionable }}</strong>
        </article>
      </div>
      <p class="drain-note">
        封堵是处置完成态：封堵后历史预警保留但不再产生新动作，异常量随之清零且不会继续增加；
        跨区域共享管段在上级确认归属前双方只读。
      </p>
    </section>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { drainOverview } from '@/data/drain'
import type { DrainOverview, OperatorContext } from '@/data/drain'
import type { OverviewResult } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])

const operator = computed<OperatorContext>(() => ({
  role: store.role,
  area: store.area,
  name: store.operator,
}))

const drain = ref<DrainOverview>(drainOverview(operator.value))

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  drain.value = drainOverview(operator.value)
}

onMounted(refresh)
</script>

<style scoped>
.drain-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.drain-panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.drain-panel-head h3 {
  margin: 0 0 8px;
  font-size: 15px;
}
.drain-note {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
}
</style>
