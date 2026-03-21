/**
 * 平台感知的文件选择/保存工具
 * - Tauri 运行时：调用原生系统对话框
 * - Web 浏览器：降级到 input[type=file] / a.click() 下载
 */

export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window
}

/**
 * 选择音频文件
 * - Tauri: 打开系统文件对话框，返回 File
 * - Web: 返回 null（由调用方降级到 input[type=file]）
 */
export async function pickAudioFile(): Promise<File | null> {
  if (!isTauri()) return null

  const { open } = await import('@tauri-apps/plugin-dialog')
  const { readFile } = await import('@tauri-apps/plugin-fs')

  const selected = await open({
    title: '选择音频文件',
    multiple: false,
    filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'] }],
  })

  if (!selected || typeof selected !== 'string') return null

  const bytes = await readFile(selected)
  const name = selected.split('/').pop() ?? selected.split('\\').pop() ?? 'audio'
  return new File([bytes], name)
}

/**
 * 选择图片文件（多选）
 * - Tauri: 打开系统文件对话框，返回 File[]
 * - Web: 返回 []（由调用方降级到 input[type=file]）
 */
export async function pickImageFiles(): Promise<File[]> {
  if (!isTauri()) return []

  const { open } = await import('@tauri-apps/plugin-dialog')
  const { readFile } = await import('@tauri-apps/plugin-fs')

  const selected = await open({
    title: '选择图片文件',
    multiple: true,
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
  })

  if (!selected) return []

  const paths = Array.isArray(selected) ? selected : [selected]
  const files: File[] = []

  for (const p of paths) {
    const bytes = await readFile(p)
    const name = p.split('/').pop() ?? p.split('\\').pop() ?? 'image'
    files.push(new File([bytes], name))
  }

  return files
}

/**
 * 保存图片文件
 * - Tauri: 打开系统保存对话框，写入文件
 * - Web: 触发浏览器下载
 */
export async function saveImageFile(blob: Blob, ext: 'png' | 'jpeg'): Promise<void> {
  const filename = `flika-poster.${ext === 'jpeg' ? 'jpg' : 'png'}`
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')

    const path = await save({
      title: '保存图片',
      defaultPath: filename,
      filters: [{ name: '图片', extensions: [ext === 'jpeg' ? 'jpg' : 'png'] }],
    })

    if (!path) return

    const buffer = await blob.arrayBuffer()
    await writeFile(path, new Uint8Array(buffer))
  } else {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
}

/**
 * 保存视频文件
 * - Tauri: 打开系统保存对话框，写入文件
 * - Web: 触发浏览器下载
 */
export async function saveVideoFile(blob: Blob): Promise<void> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')

    const path = await save({
      title: '保存视频',
      defaultPath: 'flika-export.webm',
      filters: [{ name: '视频', extensions: ['webm'] }],
    })

    if (!path) return

    const buffer = await blob.arrayBuffer()
    await writeFile(path, new Uint8Array(buffer))
  } else {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'flika-export.webm'
    a.click()
    URL.revokeObjectURL(url)
  }
}
