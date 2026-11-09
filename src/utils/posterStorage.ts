import type { PosterConfig, PosterRatio } from '../types'

export interface PosterDraft {
  version: 1
  config: PosterConfig
  variants: Partial<Record<PosterRatio, PosterConfig>>
}
export interface SavedPosterTemplate {
  id: string
  name: string
  config: PosterConfig
}

export function copyPoster(config: PosterConfig): PosterConfig {
  return {
    ...config,
    title: { ...config.title },
    subtitle: { ...config.subtitle },
    logo: { ...config.logo },
  }
}

let database: Promise<IDBDatabase> | undefined
function openDatabase(): Promise<IDBDatabase> {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('flika-poster', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('documents')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        database = undefined
        reject(new Error('无法打开本地草稿存储'))
      }
      request.onblocked = () => {
        database = undefined
        reject(new Error('请关闭其他编辑窗口后重试保存'))
      }
    })
  return database
}
export async function readPosterStorage<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents', 'readonly').objectStore('documents').get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('读取本地草稿失败'))
  })
}
export async function writePosterStorage(key: string, value: unknown): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('documents', 'readwrite')
    transaction.objectStore('documents').put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(new Error('本地保存失败，可能是存储空间不足。请导出当前作品'))
    transaction.onerror = () => reject(new Error('本地保存失败，请检查可用存储空间'))
  })
}
