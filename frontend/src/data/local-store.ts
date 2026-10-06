import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
export const STORAGE_KEY = 'underground-pipeline-inspection:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

// 直接从存储介质重读整份数据：乐观锁、跨页签并发都需要以最新版本为准，不能只用内存缓存。
export function readRaw(): Record<string, EntryRow[]> {
  cache = readStorage()
  return cache
}

// 把整份数据写回存储介质。调用方负责先 readRaw、在最新快照上做比较再写入。
export function writeRaw(data: Record<string, EntryRow[]>): void {
  cache = data
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...readRaw(), [key]: rows }
  writeRaw(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 另一个浏览器页签写入后，本页签丢弃缓存，下一次读取拿到的就是最新数据。
export function reloadFromStorage(): void {
  cache = null
}

export function storageKey(): string {
  return STORAGE_KEY
}
