import { defineStore } from 'pinia'

// 角色：区域人员只能动本管辖区域；上级负责确认跨区域共享管段的归属。
export type OperatorRole = 'area' | 'superior'

// 演示用的四个管辖区域，排水管段按区域登记归属。
export const JURISDICTION_AREAS = ['城东', '城南', '城西', '城北'] as const
export type JurisdictionArea = (typeof JURISDICTION_AREAS)[number]

export const ROLE_LABELS: Record<OperatorRole, string> = {
  area: '区域人员',
  superior: '上级单位',
}

type SessionState = {
  operator: string
  shiftLabel: string
  scope: string
  role: OperatorRole
  // 仅区域人员有「管辖区域」概念；上级单位跨区域，不绑定具体区域。
  area: JurisdictionArea | ''
}

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下管网巡检养护管理系统',
    role: 'area',
    area: '城东',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isSuperior: (state) => state.role === 'superior',
    roleLabel: (state) => ROLE_LABELS[state.role],
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setIdentity(role: OperatorRole, area: JurisdictionArea | '') {
      this.role = role
      // 上级不绑定区域；区域人员必须落到一个具体管辖区域。
      this.area = role === 'superior' ? '' : area || JURISDICTION_AREAS[0]
    },
  },
})
