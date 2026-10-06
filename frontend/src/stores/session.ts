import { defineStore } from 'pinia'

// 会话信息：当前值班员、管辖区域与角色。区域和角色决定排水管段等数据的读写权限。
export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下管网巡检养护管理系统',
    region: '城东片区',
    role: '区域管理员',
    regions: ['城东片区', '城西片区', '城北片区'],
    roles: ['区域管理员', '上级主管'],
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isSuperior: (state) => state.role === '上级主管',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRegion(region: string) {
      this.region = region
    },
    setRole(role: string) {
      this.role = role
    },
  },
})
