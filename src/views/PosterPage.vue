<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { PosterConfig, PosterRatio } from '../types'
import { usePosterEngine } from '../composables/usePosterEngine'
import { saveImageFile } from '../utils/filePicker'
import {
  applyPosterTemplate,
  createPosterConfig,
  POSTER_CATEGORIES,
  POSTER_DIMS,
  POSTER_FONTS,
  POSTER_TEMPLATES,
  type PosterTemplate,
} from '../utils/posterTemplates'
import {
  copyPoster,
  readPosterStorage,
  writePosterStorage,
  type PosterDraft,
  type SavedPosterTemplate,
} from '../utils/posterStorage'
import { mediaFrame, type PosterSelection } from '../utils/posterRenderer'
import coastUrl from '../assets/poster/coast.jpg'

const route = useRoute()
const router = useRouter()
const config = ref<PosterConfig>(createPosterConfig())
const canvasRef = ref<HTMLCanvasElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const logoInput = ref<HTMLInputElement | null>(null)
const titleInput = ref<HTMLTextAreaElement | null>(null)
const engine = usePosterEngine(canvasRef, config)
const ready = ref(false)
const busy = ref(false)
const exporting = ref(false)
const seeking = ref(false)
const error = ref('')
const notice = ref('')
const saveStatus = ref('正在加载草稿')
const panel = ref<'templates' | 'media' | 'text' | 'brand'>('templates')
const category = ref('all')
const selection = ref<PosterSelection>('title')
const cropMode = ref(false)
const showGuides = ref(true)
const snappedX = ref(false)
const snappedY = ref(false)
const thumbnails = ref<Record<string, string>>({})
const thumbnailPreview = ref('')
const videoFrames = ref<{ time: number; url: string }[]>([])
const presets = ref<SavedPosterTemplate[]>([])
const presetName = ref('')
const exportName = ref('')
const format = ref<'png' | 'jpeg'>('png')
const quality = ref(0.92)
const exportOpen = ref(false)
const exportDialog = ref<HTMLDialogElement | null>(null)
watch(exportOpen, async (open) => {
  await nextTick()
  if (open) exportDialog.value?.showModal()
  else exportDialog.value?.close()
})
const smallPreview = ref(false)
const stageSize = ref({ width: 800, height: 600 })
const zoom = ref(1)
const variants: Partial<Record<PosterRatio, PosterConfig>> = {}
const dimensions = computed(() => POSTER_DIMS[config.value.ratio])
const filteredTemplates = computed(() =>
  POSTER_TEMPLATES.filter((t) => category.value === 'all' || t.category === category.value),
)
const currentTemplate = computed(() =>
  POSTER_TEMPLATES.find((t) => t.id === config.value.templateId),
)
const selectedText = computed(() =>
  selection.value === 'subtitle' ? config.value.subtitle : config.value.title,
)
const textSelection = computed(() => selection.value === 'title' || selection.value === 'subtitle')
const videoDuration = computed(() =>
  engine.bgMedia.value instanceof HTMLVideoElement ? engine.bgMedia.value.duration : 0,
)
const artboardStyle = computed(() => {
  const [w, h] = dimensions.value
  const available = stageSize.value
  const scale =
    Math.min(
      Math.max(80, available.width - (available.width < 700 ? 24 : 56)) / w,
      Math.max(100, available.height - (available.width < 700 ? 20 : 70)) / h,
    ) * zoom.value
  return { width: `${w * scale}px`, height: `${h * scale}px` }
})
const selectionStyle = computed(() => {
  const bounds = engine.bounds.value[selection.value]
  if (!bounds || (selection.value === 'image' && !cropMode.value)) return undefined
  const [w, h] = dimensions.value
  return {
    left: `${(bounds.x / w) * 100}%`,
    top: `${(bounds.y / h) * 100}%`,
    width: `${(bounds.width / w) * 100}%`,
    height: `${(bounds.height / h) * 100}%`,
  }
})
const overflow = computed(
  () => engine.bounds.value.title?.overflow || engine.bounds.value.subtitle?.overflow,
)

let history: PosterConfig[] = []
const historyIndex = ref(-1)
const historyLength = ref(0)
const dirty = ref(false)
let historyTimer: ReturnType<typeof setTimeout> | undefined
let draftTimer: ReturnType<typeof setTimeout> | undefined
let previewTimer: ReturnType<typeof setTimeout> | undefined
let frameRequest = 0
let disposed = false
let applyingHistory = false
let pointerActive = false
let observer: ResizeObserver | undefined
let restoreRevision = 0
let uploadRevision = 0
let seekRequest = 0
let saveSequence = Promise.resolve()

function signature(value: PosterConfig) {
  return JSON.stringify(value, (_key, entry) =>
    entry instanceof File ? [entry.name, entry.size, entry.lastModified] : entry,
  )
}
function recordHistory() {
  clearTimeout(historyTimer)
  if (applyingHistory || !ready.value) return
  const value = copyPoster(config.value)
  if (history[historyIndex.value] && signature(history[historyIndex.value]) === signature(value)) {
    dirty.value = false
    return
  }
  history = history.slice(0, historyIndex.value + 1)
  history.push(value)
  if (history.length > 50) history.shift()
  historyIndex.value = history.length - 1
  historyLength.value = history.length
  dirty.value = false
}
function saveDraft() {
  clearTimeout(draftTimer)
  if (!ready.value) return
  variants[config.value.ratio] = copyPoster(config.value)
  const value: PosterDraft = {
    version: 1,
    config: copyPoster(config.value),
    variants: { ...variants },
  }
  // Serialize transactions so an older snapshot cannot overwrite a newer edit.
  saveSequence = saveSequence.then(async () => {
    if (!disposed) saveStatus.value = '正在保存'
    try {
      await writePosterStorage('draft', value)
      if (!disposed) saveStatus.value = '已保存到本机'
    } catch (err) {
      if (!disposed) {
        saveStatus.value = '保存失败'
        reportError(err)
      }
    }
  })
}
function reportError(err: unknown) {
  error.value = err instanceof Error ? err.message : '操作失败，请重试'
}
function flash(message: string) {
  notice.value = message
  error.value = ''
}
function scheduleRender() {
  cancelAnimationFrame(frameRequest)
  frameRequest = requestAnimationFrame(() => {
    engine.renderPoster()
    clearTimeout(previewTimer)
    previewTimer = setTimeout(renderPreviews, 180)
  })
}
watch(
  config,
  () => {
    scheduleRender()
    if (!ready.value || applyingHistory) return
    saveStatus.value = '有修改待保存'
    dirty.value = true
    if (!pointerActive) {
      clearTimeout(historyTimer)
      historyTimer = setTimeout(recordHistory, 350)
      clearTimeout(draftTimer)
      draftTimer = setTimeout(saveDraft, 700)
    }
  },
  { deep: true, flush: 'post' },
)

async function restoreConfig(value: PosterConfig) {
  const revision = ++restoreRevision
  busy.value = true
  try {
    if (value.bgFile !== config.value.bgFile || !engine.bgMedia.value) {
      await engine.loadBgMedia(
        value.bgFile || coastUrl,
        value.bgFile && value.bgType === 'video' ? 'video' : 'image',
      )
    }
    if (revision !== restoreRevision) return
    if (value.logo.file !== config.value.logo.file) {
      if (value.logo.file) await engine.loadLogoImage(value.logo.file)
      else engine.clearLogo()
    }
    if (revision !== restoreRevision) return
    config.value = copyPoster(value)
    if (value.bgType === 'video') await engine.seekBgVideoAsync(value.bgVideoTime)
    await nextTick()
    scheduleRender()
  } finally {
    if (revision === restoreRevision) busy.value = false
  }
}
async function moveHistory(direction: number) {
  if (busy.value || exporting.value) return
  recordHistory()
  const target = historyIndex.value + direction
  if (target < 0 || target >= history.length) return
  applyingHistory = true
  try {
    await restoreConfig(history[target])
    historyIndex.value = target
    dirty.value = false
    await nextTick()
    saveDraft()
    videoFrames.value = []
  } catch (err) {
    reportError(err)
  } finally {
    applyingHistory = false
  }
}
function applyTemplate(template: PosterTemplate) {
  recordHistory()
  config.value = applyPosterTemplate(config.value, template)
  cropMode.value = false
  flash(`已应用「${template.name}」`)
}
function upgradeComposition(value: PosterConfig): PosterConfig {
  if (value.composition) return value
  const template = POSTER_TEMPLATES.find((item) => item.id === value.templateId)
  return template ? applyPosterTemplate(value, template) : value
}
function switchRatio(ratio: PosterRatio) {
  if (ratio === config.value.ratio) return
  recordHistory()
  variants[config.value.ratio] = copyPoster(config.value)
  const storedVariant = variants[ratio]
  const saved = storedVariant ? upgradeComposition(storedVariant) : undefined
  if (saved) {
    config.value = {
      ...copyPoster(saved),
      bgFile: config.value.bgFile,
      bgUrl: '',
      bgType: config.value.bgType,
      bgVideoTime: config.value.bgVideoTime,
      title: { ...saved.title, text: config.value.title.text },
      subtitle: { ...saved.subtitle, text: config.value.subtitle.text },
      logo: { ...saved.logo, file: config.value.logo.file },
    }
  } else
    config.value = applyPosterTemplate(
      config.value,
      currentTemplate.value || POSTER_TEMPLATES[0],
      ratio,
    )
  cropMode.value = false
}
function renderPreviews() {
  if (disposed || !canvasRef.value) return
  const output: Record<string, string> = {}
  for (const template of POSTER_TEMPLATES) {
    const preview = document.createElement('canvas')
    const [w, h] = dimensions.value
    preview.width = 360
    preview.height = Math.round((360 * h) / w)
    engine.renderTo(preview, applyPosterTemplate(config.value, template))
    output[template.id] = preview.toDataURL('image/jpeg', 0.75)
  }
  thumbnails.value = output
  const thumbnail = document.createElement('canvas')
  thumbnail.width = 320
  thumbnail.height = Math.round((320 * dimensions.value[1]) / dimensions.value[0])
  engine.renderTo(thumbnail)
  thumbnailPreview.value = thumbnail.toDataURL('image/jpeg', 0.85)
}

async function uploadFile(file?: File, logo = false) {
  if (!file || busy.value) return
  const image = file.type.startsWith('image/')
  const video = file.type.startsWith('video/')
  if (!image && (!video || logo)) {
    error.value = logo ? '请选择图片文件' : '请选择图片或视频文件'
    return
  }
  recordHistory()
  const revision = ++uploadRevision
  busy.value = true
  error.value = ''
  try {
    if (logo) {
      await engine.loadLogoImage(file)
      if (revision !== uploadRevision) return
      config.value.logo.file = file
      selection.value = 'logo'
      panel.value = 'brand'
    } else {
      await engine.loadBgMedia(file, image ? 'image' : 'video')
      if (revision !== uploadRevision) return
      Object.assign(config.value, {
        bgFile: file,
        bgType: image ? 'image' : 'video',
        bgUrl: '',
        bgVideoTime: 0,
        bgPositionX: 0.5,
        bgPositionY: 0.5,
        bgZoom: 1,
      })
      videoFrames.value = []
      selection.value = 'image'
      panel.value = 'media'
    }
    flash(`已载入「${file.name}」`)
    scheduleRender()
    saveDraft()
  } catch (err) {
    reportError(err)
  } finally {
    if (revision === uploadRevision) busy.value = false
  }
}
function fileChanged(event: Event, logo = false) {
  const input = event.target as HTMLInputElement
  void uploadFile(input.files?.[0], logo)
  input.value = ''
}
function dropFile(event: DragEvent) {
  void uploadFile(event.dataTransfer?.files[0])
}
async function resetImage() {
  if (busy.value) return
  busy.value = true
  try {
    await engine.loadBgMedia(coastUrl, 'image')
    Object.assign(config.value, {
      bgFile: null,
      bgType: 'image',
      bgZoom: 1,
      bgPositionX: 0.5,
      bgPositionY: 0.5,
      bgVideoTime: 0,
    })
    videoFrames.value = []
    scheduleRender()
  } catch (err) {
    reportError(err)
  } finally {
    busy.value = false
  }
}
function openPanel(value: string) {
  panel.value = value as typeof panel.value
  cropMode.value = false
  if (value === 'text' && !textSelection.value) selection.value = 'title'
  if (value === 'media') selection.value = 'image'
  if (value === 'brand' && config.value.logo.file) selection.value = 'logo'
}
function toggleCrop() {
  selection.value = 'image'
  cropMode.value = !cropMode.value
}
function removeLogo() {
  config.value.logo.file = null
  engine.clearLogo()
  scheduleRender()
}
function dismissNotice() {
  error.value = ''
  notice.value = ''
}
function selectLayer(layer: PosterSelection) {
  selection.value = layer
  cropMode.value = false
  if (panel.value !== 'templates' || !window.matchMedia('(min-width: 1181px)').matches) {
    panel.value = layer === 'image' ? 'media' : layer === 'logo' ? 'brand' : 'text'
  }
}
function alignText(axis: 'x' | 'y') {
  if (axis === 'x') {
    selectedText.value.x = 0.5
    selectedText.value.textAlign = 'center'
  } else selectedText.value.y = 0.5
}
function resetPosition() {
  const fresh = applyPosterTemplate(config.value, currentTemplate.value || POSTER_TEMPLATES[0])
  if (textSelection.value) {
    const key = selection.value as 'title' | 'subtitle'
    const text = config.value[key].text
    config.value[key] = { ...fresh[key], text }
  } else if (selection.value === 'logo')
    Object.assign(config.value.logo, { x: 0.88, y: 0.12, size: 0.07 })
  else Object.assign(config.value, { bgPositionX: 0.5, bgPositionY: 0.5, bgZoom: 1 })
}

let drag:
  | {
      kind: 'move' | 'resize'
      layer: PosterSelection
      startX: number
      startY: number
      initial: PosterConfig
    }
  | undefined
function pointerDown(event: PointerEvent, resize = false) {
  if (busy.value || exporting.value || event.button !== 0) return
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * dimensions.value[0]
  const y = ((event.clientY - rect.top) / rect.height) * dimensions.value[1]
  if (!resize && !cropMode.value) {
    const hit = (['subtitle', 'title', 'logo'] as const).find((key) => {
      const b = engine.bounds.value[key]
      return b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height
    })
    if (hit) selectLayer(hit)
    else {
      selectLayer('image')
      return
    }
  }
  recordHistory()
  pointerActive = true
  drag = {
    kind: resize ? 'resize' : 'move',
    layer: selection.value,
    startX: event.clientX,
    startY: event.clientY,
    initial: copyPoster(config.value),
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}
function pointerMove(event: PointerEvent) {
  if (!drag || !canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const dx = (event.clientX - drag.startX) / rect.width
  const dy = (event.clientY - drag.startY) / rect.height
  const initial = drag.initial
  snappedX.value = false
  snappedY.value = false
  const snap = (value: number, axis: 'x' | 'y') => {
    const clamped = Math.max(0.02, Math.min(0.98, value))
    if (Math.abs(clamped - 0.5) < 0.012) {
      if (axis === 'x') snappedX.value = true
      else snappedY.value = true
      return 0.5
    }
    return clamped
  }
  if (drag.layer === 'image') {
    const source = engine.bgMedia.value
    if (!source) return
    const [w, h] = dimensions.value
    const frame = mediaFrame(config.value, w, h)
    const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
    const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
    const fit = config.value.bgFit === 'contain' ? Math.min : Math.max
    const scale = fit(frame.width / sw, frame.height / sh) * (config.value.bgZoom ?? 1)
    const extraW = frame.width - sw * scale
    const extraH = frame.height - sh * scale
    if (Math.abs(extraW) > 1)
      config.value.bgPositionX = Math.max(
        0,
        Math.min(1, (initial.bgPositionX ?? 0.5) + (dx * w) / extraW),
      )
    if (Math.abs(extraH) > 1)
      config.value.bgPositionY = Math.max(
        0,
        Math.min(1, (initial.bgPositionY ?? 0.5) + (dy * h) / extraH),
      )
  } else if (drag.kind === 'resize') {
    if (drag.layer === 'logo')
      config.value.logo.size = Math.max(0.03, Math.min(0.8, initial.logo.size + dx * 2))
    else {
      const layer = config.value[drag.layer]
      layer.width = Math.max(0.1, Math.min(0.95, (initial[drag.layer].width ?? 0.84) + dx))
      layer.fontSize = Math.max(12, Math.min(400, initial[drag.layer].fontSize * (1 + dy * 2)))
    }
  } else {
    config.value[drag.layer].x = snap(initial[drag.layer].x + dx, 'x')
    config.value[drag.layer].y = snap(initial[drag.layer].y + dy, 'y')
  }
}
function pointerUp() {
  if (!drag) return
  drag = undefined
  pointerActive = false
  snappedX.value = false
  snappedY.value = false
  recordHistory()
  saveDraft()
}
function editOnCanvas() {
  if (!textSelection.value) return
  panel.value = 'text'
  nextTick(() => {
    titleInput.value?.focus()
    titleInput.value?.select()
  })
}
function keydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName) || exportOpen.value)
    return
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    void moveHistory(event.shiftKey ? 1 : -1)
    return
  }
  if (busy.value || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  if (selection.value === 'image') return
  event.preventDefault()
  const layer = config.value[selection.value]
  const step = event.shiftKey ? 10 : 1
  if (event.key === 'ArrowLeft') layer.x = Math.max(0, layer.x - step / dimensions.value[0])
  if (event.key === 'ArrowRight') layer.x = Math.min(1, layer.x + step / dimensions.value[0])
  if (event.key === 'ArrowUp') layer.y = Math.max(0, layer.y - step / dimensions.value[1])
  if (event.key === 'ArrowDown') layer.y = Math.min(1, layer.y + step / dimensions.value[1])
}

async function seekVideo(time: number) {
  const request = ++seekRequest
  seeking.value = true
  try {
    await engine.seekBgVideoAsync(time)
    if (request !== seekRequest) return
    config.value.bgVideoTime = time
    scheduleRender()
  } catch (err) {
    if (request === seekRequest) reportError(err)
  } finally {
    if (request === seekRequest) seeking.value = false
  }
}
async function generateFrames() {
  const video = engine.bgMedia.value
  if (!(video instanceof HTMLVideoElement) || busy.value) return
  busy.value = true
  const originalTime = config.value.bgVideoTime
  const frames: { time: number; url: string }[] = []
  try {
    for (let i = 0; i < 8; i++) {
      const time = Math.max(0, ((video.duration - 0.01) * i) / 7)
      await engine.seekBgVideoAsync(time)
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = Math.max(1, Math.round((160 * video.videoHeight) / video.videoWidth))
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push({ time, url: canvas.toDataURL('image/jpeg', 0.7) })
    }
    videoFrames.value = frames
  } catch (err) {
    reportError(err)
  } finally {
    try {
      await engine.seekBgVideoAsync(originalTime)
    } catch (err) {
      reportError(err)
    }
    busy.value = false
    scheduleRender()
  }
}
async function savePreset() {
  if (!presetName.value.trim()) {
    error.value = '请先填写模板名称'
    return
  }
  const value: SavedPosterTemplate = {
    id: crypto.randomUUID(),
    name: presetName.value.trim().slice(0, 40),
    config: { ...copyPoster(config.value), bgFile: null, bgUrl: '' },
  }
  const next = [...presets.value, value]
  try {
    await writePosterStorage(
      'templates',
      next.map((t) => ({ ...t, config: copyPoster(t.config) })),
    )
    presets.value = next
    presetName.value = ''
    flash('已保存到我的模板')
  } catch (err) {
    reportError(err)
  }
}
async function applyPreset(preset: SavedPosterTemplate) {
  recordHistory()
  try {
    const value = copyPoster(preset.config)
    Object.assign(value, {
      bgFile: config.value.bgFile,
      bgType: config.value.bgType,
      bgUrl: '',
      bgVideoTime: config.value.bgVideoTime,
    })
    value.title.text = config.value.title.text
    value.subtitle.text = config.value.subtitle.text
    await restoreConfig(value)
    flash(`已应用「${preset.name}」`)
  } catch (err) {
    reportError(err)
  }
}
async function deletePreset(id: string) {
  const next = presets.value.filter((p) => p.id !== id)
  try {
    await writePosterStorage(
      'templates',
      next.map((t) => ({ ...t, config: copyPoster(t.config) })),
    )
    presets.value = next
    flash('已移除模板')
  } catch (err) {
    reportError(err)
  }
}
async function exportPoster() {
  if (exporting.value || busy.value || seeking.value) return
  exporting.value = true
  error.value = ''
  try {
    if (config.value.bgType === 'video') await engine.seekBgVideoAsync(config.value.bgVideoTime)
    const blob =
      format.value === 'png' ? await engine.exportPNG() : await engine.exportJPEG(quality.value)
    const saved = await saveImageFile(
      blob,
      format.value,
      exportName.value.trim() || config.value.title.text.replace(/\s+/g, ' ').slice(0, 60),
    )
    if (saved) {
      flash('图片已导出')
      exportOpen.value = false
    }
  } catch (err) {
    reportError(err)
  } finally {
    exporting.value = false
  }
}
function openExport() {
  renderPreviews()
  exportName.value = config.value.title.text.replace(/\s+/g, ' ').slice(0, 60) || '我的封面'
  exportOpen.value = true
}

onMounted(async () => {
  let previousComposition: PosterConfig | undefined
  window.addEventListener('keydown', keydown)
  window.addEventListener('pagehide', saveDraft)
  observer = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect
    if (rect) stageSize.value = { width: rect.width, height: rect.height }
  })
  if (stageRef.value) observer.observe(stageRef.value)
  try {
    const [draft, saved] = await Promise.all([
      readPosterStorage<PosterDraft>('draft'),
      readPosterStorage<SavedPosterTemplate[]>('templates'),
    ])
    if (disposed) return
    if (saved) presets.value = saved
    if (draft?.version === 1 && POSTER_DIMS[draft.config.ratio]) {
      Object.assign(variants, draft.variants)
      const upgraded = upgradeComposition(draft.config)
      if (upgraded !== draft.config) previousComposition = copyPoster(draft.config)
      await restoreConfig(upgraded)
      if (draft.config.logo.file && !engine.logoImage.value)
        await engine.loadLogoImage(draft.config.logo.file)
      flash('已恢复上次的封面草稿')
    } else await engine.loadBgMedia(coastUrl, 'image')
    saveStatus.value = '已保存到本机'
  } catch (err) {
    reportError(err)
    saveStatus.value = '草稿暂不可用'
    try {
      await engine.loadBgMedia(coastUrl, 'image')
    } catch (loadError) {
      reportError(loadError)
    }
  }
  if (disposed) return
  ready.value = true
  if (route.query.source === 'capture') {
    try {
      const incoming = await readPosterStorage<File>('incoming-media')
      if (incoming) await uploadFile(incoming)
      await router.replace({ path: '/poster' })
    } catch (err) {
      reportError(err)
    }
  }
  await nextTick()
  if (previousComposition) {
    history = [previousComposition]
    historyIndex.value = 0
    historyLength.value = 1
  }
  recordHistory()
  engine.renderPoster()
  renderPreviews()
})
onBeforeUnmount(() => {
  saveDraft()
  disposed = true
  restoreRevision++
  uploadRevision++
  observer?.disconnect()
  window.removeEventListener('keydown', keydown)
  window.removeEventListener('pagehide', saveDraft)
  cancelAnimationFrame(frameRequest)
  clearTimeout(historyTimer)
  clearTimeout(draftTimer)
  clearTimeout(previewTimer)
})
</script>

<template>
  <div
    class="poster-studio"
    :class="{ 'has-inspector': panel === 'templates' }"
    @dragover.prevent
    @drop.prevent="dropFile"
  >
    <input
      ref="fileInput"
      class="visually-hidden"
      type="file"
      accept="image/*,video/*"
      aria-label="上传封面素材"
      @change="fileChanged($event)"
    />
    <input
      ref="logoInput"
      class="visually-hidden"
      type="file"
      accept="image/*"
      aria-label="上传品牌 Logo"
      @change="fileChanged($event, true)"
    />
    <header class="studio-toolbar">
      <div class="document-heading">
        <span class="studio-mark">F</span>
        <div>
          <h1>封面工作室</h1>
          <span class="save-state" role="status">{{ saveStatus }}</span>
        </div>
      </div>
      <div class="toolbar-controls">
        <button
          class="icon-button"
          aria-label="撤销"
          title="撤销 ⌘Z / Ctrl Z"
          :disabled="busy || (!dirty && historyIndex < 1)"
          @click="moveHistory(-1)"
        >
          ↶
        </button>
        <button
          class="icon-button"
          aria-label="重做"
          title="重做 ⇧⌘Z / Ctrl Shift Z"
          :disabled="busy || historyIndex >= historyLength - 1"
          @click="moveHistory(1)"
        >
          ↷
        </button>
        <span class="toolbar-rule" />
        <label class="ratio-control"
          ><span>画布</span
          ><select
            aria-label="画布比例"
            :value="config.ratio"
            :disabled="busy || exporting"
            @change="switchRatio(($event.target as HTMLSelectElement).value as PosterRatio)"
          >
            <option v-for="(_, ratio) in POSTER_DIMS" :key="ratio" :value="ratio">
              {{ ratio }}
            </option>
          </select></label
        >
        <button
          class="secondary-button thumbnail-toggle"
          :aria-pressed="smallPreview"
          @click="smallPreview = !smallPreview"
        >
          缩略预览
        </button>
        <button class="primary-button" :disabled="!ready || busy || seeking" @click="openExport">
          <span>↗</span> 导出图片
        </button>
      </div>
    </header>

    <nav class="tool-rail" aria-label="封面编辑工具">
      <button
        v-for="item in [
          { id: 'templates', name: '模板', icon: '▦' },
          { id: 'media', name: '素材', icon: '▧' },
          { id: 'text', name: '文字', icon: 'T' },
          { id: 'brand', name: '品牌', icon: '◈' },
        ]"
        :key="item.id"
        :class="{ active: panel === item.id }"
        :aria-pressed="panel === item.id"
        @click="openPanel(item.id)"
      >
        <span>{{ item.icon }}</span
        >{{ item.name }}
      </button>
    </nav>

    <aside
      class="library-panel"
      :aria-label="panel === 'templates' ? '模板库' : '编辑面板'"
      :inert="busy || exporting || !ready || undefined"
    >
      <template v-if="panel === 'templates'">
        <div class="panel-heading">
          <span class="overline">THE COVER COLLECTION</span>
          <h2>给灵感一个封面</h2>
          <p>选一种构图，让故事开始。</p>
        </div>
        <div class="category-tabs" aria-label="模板分类">
          <button
            v-for="item in POSTER_CATEGORIES"
            :key="item.id"
            :class="{ active: category === item.id }"
            @click="category = item.id"
          >
            {{ item.name }}
          </button>
        </div>
        <div class="template-list">
          <button
            v-for="template in filteredTemplates"
            :key="template.id"
            class="template-card"
            :class="{ selected: config.templateId === template.id }"
            :aria-label="`应用${template.name}模板`"
            :aria-pressed="config.templateId === template.id"
            @click="applyTemplate(template)"
          >
            <div class="template-art" :style="{ background: template.paper }">
              <img
                v-if="thumbnails[template.id]"
                :src="thumbnails[template.id]"
                :alt="`${template.name}成品预览`"
              /><span v-if="config.templateId === template.id" class="template-check">✓</span>
            </div>
            <div class="template-caption">
              <strong>{{ template.name }}</strong
              ><span>{{ template.caption }}</span>
            </div>
          </button>
        </div>
        <section v-if="presets.length" class="saved-templates">
          <h3>我的模板</h3>
          <div v-for="preset in presets" :key="preset.id" class="saved-row">
            <button @click="applyPreset(preset)">{{ preset.name }}</button
            ><button :aria-label="`删除${preset.name}模板`" @click="deletePreset(preset.id)">
              ×
            </button>
          </div>
        </section>
      </template>

      <template v-else-if="panel === 'media'">
        <div class="panel-heading">
          <span class="overline">YOUR PERSPECTIVE</span>
          <h2>从一张好图开始</h2>
          <p>图片构图，或截取视频里的瞬间。</p>
        </div>
        <button class="upload-card" @click="fileInput?.click()">
          <span>＋</span><strong>{{ config.bgFile ? '替换图片或视频' : '上传图片或视频' }}</strong
          ><small>拖放文件到工作区也可以</small>
        </button>
        <div class="asset-info">
          <span class="status-dot" />{{ config.bgFile?.name || '示例素材 · 海岸公路' }}
        </div>
        <div class="segmented">
          <button
            :class="{ active: config.bgType !== 'color' }"
            @click="config.bgType = config.bgFile?.type.startsWith('video/') ? 'video' : 'image'"
          >
            使用素材</button
          ><button :class="{ active: config.bgType === 'color' }" @click="config.bgType = 'color'">
            纯色背景
          </button>
        </div>
        <template v-if="config.bgType !== 'color'">
          <h3>图片取景</h3>
          <div class="segmented">
            <button :class="{ active: config.bgFit !== 'contain' }" @click="config.bgFit = 'cover'">
              铺满画框</button
            ><button
              :class="{ active: config.bgFit === 'contain' }"
              @click="config.bgFit = 'contain'"
            >
              完整显示
            </button>
          </div>
          <label class="field"
            ><span
              >缩放 <output>{{ (config.bgZoom ?? 1).toFixed(2) }}×</output></span
            ><input v-model.number="config.bgZoom" type="range" min="1" max="3" step="0.01"
          /></label>
          <label class="field"
            ><span>水平取景</span
            ><input v-model.number="config.bgPositionX" type="range" min="0" max="1" step="0.01"
          /></label>
          <label class="field"
            ><span>垂直取景</span
            ><input v-model.number="config.bgPositionY" type="range" min="0" max="1" step="0.01"
          /></label>
          <button
            class="secondary-button full"
            :class="{ chosen: cropMode }"
            :aria-pressed="cropMode"
            @click="toggleCrop"
          >
            {{ cropMode ? '✓ 完成取景' : '↔ 在画布上拖动取景' }}
          </button>
          <label class="field"
            ><span
              >背景暗化 <output>{{ Math.round(config.bgOverlayOpacity * 100) }}%</output></span
            ><input
              v-model.number="config.bgOverlayOpacity"
              type="range"
              min="0"
              max="0.9"
              step="0.01"
          /></label>
        </template>
        <template v-if="config.bgType === 'video'">
          <h3>视频选帧</h3>
          <label class="field"
            ><span
              >时间
              <output
                >{{ config.bgVideoTime.toFixed(2) }}s / {{ videoDuration.toFixed(1) }}s</output
              ></span
            ><input
              aria-label="视频取帧时间"
              type="range"
              :value="config.bgVideoTime"
              min="0"
              :max="Math.max(0, videoDuration - 0.01)"
              step="0.01"
              @input="seekVideo(Number(($event.target as HTMLInputElement).value))"
          /></label>
          <div class="segmented">
            <button @click="seekVideo(Math.max(0, config.bgVideoTime - 1 / 30))">← 前一帧</button
            ><button
              @click="seekVideo(Math.min(videoDuration - 0.01, config.bgVideoTime + 1 / 30))"
            >
              后一帧 →
            </button>
          </div>
          <button class="secondary-button full" @click="generateFrames">生成缩略帧条</button>
          <div v-if="videoFrames.length" class="frame-strip">
            <button
              v-for="frame in videoFrames"
              :key="frame.time"
              :aria-label="`使用 ${frame.time.toFixed(1)} 秒画面`"
              @click="seekVideo(frame.time)"
            >
              <img :src="frame.url" alt="视频帧" /><span>{{ frame.time.toFixed(1) }}s</span>
            </button>
          </div>
        </template>
        <h3>底色与配色</h3>
        <div class="color-fields">
          <label>底色<input v-model="config.bgColor" aria-label="背景底色" type="color" /></label
          ><label
            >渐变<input v-model="config.bgColorEnd" aria-label="背景渐变色" type="color" /></label
          ><label
            >强调色<input v-model="config.accentColor" aria-label="模板强调色" type="color"
          /></label>
        </div>
        <button class="text-button" @click="resetImage">恢复示例图片</button>
      </template>

      <template v-else-if="panel === 'text'">
        <div class="panel-heading">
          <span class="overline">WORDS THAT MATTER</span>
          <h2>把故事写在封面上</h2>
        </div>
        <div class="segmented">
          <button :class="{ active: selection !== 'subtitle' }" @click="selection = 'title'">
            主标题</button
          ><button :class="{ active: selection === 'subtitle' }" @click="selection = 'subtitle'">
            副标题
          </button>
        </div>
        <label class="field"
          ><span>{{ selection === 'subtitle' ? '副标题' : '主标题' }}</span
          ><textarea
            ref="titleInput"
            v-model="selectedText.text"
            :aria-label="selection === 'subtitle' ? '副标题内容' : '主标题内容'"
            rows="4"
            maxlength="500"
            placeholder="写下你的标题，Enter 换行"
          />
        </label>
        <label class="field"
          ><span>字体</span
          ><select v-model="selectedText.fontFamily" aria-label="文字字体">
            <option v-for="font in POSTER_FONTS" :key="font.value" :value="font.value">
              {{ font.name }}
            </option>
          </select></label
        >
        <div class="field-pair">
          <label class="field"
            ><span>字号</span
            ><input
              v-model.number="selectedText.fontSize"
              aria-label="文字字号"
              type="number"
              min="12"
              max="400"
              @change="
                selectedText.fontSize = Math.max(
                  12,
                  Math.min(400, Number(selectedText.fontSize) || 12),
                )
              " /></label
          ><label class="field"
            ><span>行距</span
            ><input
              v-model.number="selectedText.lineHeight"
              aria-label="文字行距"
              type="number"
              min="1"
              max="2"
              step="0.05"
              @change="
                selectedText.lineHeight = Math.max(
                  1,
                  Math.min(2, Number(selectedText.lineHeight) || 1.2),
                )
              "
          /></label>
        </div>
        <label class="check-row"
          ><input v-model="selectedText.autoFit" type="checkbox" />自动适配文本框</label
        >
        <div class="text-tools">
          <button
            :class="{ chosen: selectedText.fontWeight === 'bold' }"
            aria-label="粗体"
            :aria-pressed="selectedText.fontWeight === 'bold'"
            @click="
              selectedText.fontWeight = selectedText.fontWeight === 'bold' ? 'normal' : 'bold'
            "
          >
            <b>B</b></button
          ><button
            :class="{ chosen: selectedText.fontStyle === 'italic' }"
            aria-label="斜体"
            :aria-pressed="selectedText.fontStyle === 'italic'"
            @click="
              selectedText.fontStyle = selectedText.fontStyle === 'italic' ? 'normal' : 'italic'
            "
          >
            <i>I</i></button
          ><select v-model="selectedText.textAlign" aria-label="文字对齐">
            <option value="left">左对齐</option>
            <option value="center">居中</option>
            <option value="right">右对齐</option></select
          ><input v-model="selectedText.color" type="color" aria-label="文字颜色" />
        </div>
        <label class="field"
          ><span
            >文本框宽度 <output>{{ Math.round((selectedText.width ?? 0.84) * 100) }}%</output></span
          ><input v-model.number="selectedText.width" type="range" min="0.1" max="0.95" step="0.01"
        /></label>
        <label class="field"
          ><span
            >文本框高度
            <output>{{ Math.round((selectedText.maxHeight ?? 0.3) * 100) }}%</output></span
          ><input
            v-model.number="selectedText.maxHeight"
            type="range"
            min="0.05"
            max="0.8"
            step="0.01"
        /></label>
        <div class="segmented">
          <button @click="alignText('x')">水平居中</button
          ><button @click="alignText('y')">垂直居中</button>
        </div>
        <label class="field"
          ><span>水平位置</span
          ><input v-model.number="selectedText.x" type="range" min="0" max="1" step="0.001"
        /></label>
        <label class="field"
          ><span>垂直位置</span
          ><input v-model.number="selectedText.y" type="range" min="0" max="1" step="0.001"
        /></label>
        <h3>关键词强调</h3>
        <label class="field"
          ><span>强调文字</span
          ><input v-model="selectedText.highlight" type="text" placeholder="填写标题中的词语"
        /></label>
        <label class="inline-field"
          ><span>强调颜色</span
          ><input v-model="selectedText.highlightColor" type="color" aria-label="关键词颜色"
        /></label>
        <details>
          <summary>描边与阴影</summary>
          <label class="field"
            ><span>描边宽度</span
            ><input
              v-model.number="selectedText.strokeWidth"
              type="range"
              min="0"
              max="20"
              step="1" /></label
          ><label class="inline-field"
            ><span>描边颜色</span
            ><input v-model="selectedText.strokeColor" type="color" aria-label="描边颜色" /></label
          ><label class="field"
            ><span>阴影强度</span
            ><input
              v-model.number="selectedText.shadowBlur"
              type="range"
              min="0"
              max="60"
              step="1" /></label
          ><label class="inline-field"
            ><span>阴影颜色</span
            ><input v-model="selectedText.shadowColor" type="color" aria-label="阴影颜色"
          /></label>
        </details>
        <button class="text-button" @click="resetPosition">恢复模板排版</button>
      </template>

      <template v-else>
        <div class="panel-heading">
          <span class="overline">MAKE IT YOURS</span>
          <h2>留下你的标识</h2>
          <p>固定栏目、品牌与个人风格。</p>
        </div>
        <label class="field"
          ><span>顶部栏目</span
          ><input v-model="config.eyebrow" maxlength="80" placeholder="例如 TRAVEL JOURNAL / 01"
        /></label>
        <label class="field"
          ><span>期号 / 编号</span><input v-model="config.edition" maxlength="6" placeholder="01"
        /></label>
        <label class="field"
          ><span>页脚文字</span
          ><input v-model="config.footer" maxlength="100" placeholder="作者、日期或一句话"
        /></label>
        <h3>品牌 Logo</h3>
        <button class="upload-card compact" @click="logoInput?.click()">
          <span>◈</span><strong>{{ config.logo.file ? '替换 Logo' : '上传 Logo' }}</strong>
        </button>
        <template v-if="config.logo.file">
          <div class="asset-info">{{ config.logo.file.name }}</div>
          <label class="field"
            ><span
              >大小 <output>{{ Math.round(config.logo.size * 100) }}%</output></span
            ><input v-model.number="config.logo.size" type="range" min="0.03" max="0.8" step="0.01"
          /></label>
          <label class="field"
            ><span>透明度</span
            ><input v-model.number="config.logo.opacity" type="range" min="0" max="1" step="0.05"
          /></label>
          <label class="field"
            ><span>水平位置</span
            ><input v-model.number="config.logo.x" type="range" min="0" max="1" step="0.01"
          /></label>
          <label class="field"
            ><span>垂直位置</span
            ><input v-model.number="config.logo.y" type="range" min="0" max="1" step="0.01"
          /></label>
          <label class="check-row"
            ><input v-model="config.logo.rounded" type="checkbox" />圆形裁切</label
          >
          <button class="text-button" @click="removeLogo">移除 Logo</button>
        </template>
        <h3>保存个人模板</h3>
        <label class="field"
          ><span>模板名称</span
          ><input
            v-model="presetName"
            maxlength="40"
            placeholder="例如 我的旅行栏目"
            @keydown.enter="savePreset"
        /></label>
        <button class="secondary-button full" @click="savePreset">＋ 保存当前样式与品牌</button>
      </template>
    </aside>

    <main class="canvas-workspace">
      <div class="workspace-heading">
        <span
          >{{ currentTemplate?.name || '我的封面' }}<i />{{ dimensions[0] }} ×
          {{ dimensions[1] }}</span
        ><button class="text-button" :aria-pressed="showGuides" @click="showGuides = !showGuides">
          {{ showGuides ? '隐藏参考线' : '显示参考线' }}
        </button>
      </div>
      <div ref="stageRef" class="canvas-stage" :class="{ 'is-cropping': cropMode }">
        <div
          class="artboard"
          :style="artboardStyle"
          tabindex="0"
          role="group"
          aria-label="封面编辑画布，方向键微调选中元素"
          @pointerdown="pointerDown($event)"
          @pointermove="pointerMove"
          @pointerup="pointerUp"
          @pointercancel="pointerUp"
          @lostpointercapture="pointerUp"
          @dblclick="editOnCanvas"
        >
          <canvas
            ref="canvasRef"
            :width="dimensions[0]"
            :height="dimensions[1]"
            aria-label="封面成品预览"
          />
          <div v-if="showGuides" class="safe-area" aria-hidden="true" />
          <div
            v-if="selectionStyle && ready"
            class="selection-box"
            :class="{ crop: selection === 'image' }"
            :style="selectionStyle"
            aria-hidden="true"
          >
            <span class="selection-label">{{
              selection === 'title'
                ? '主标题'
                : selection === 'subtitle'
                  ? '副标题'
                  : selection === 'logo'
                    ? 'Logo'
                    : '拖动取景'
            }}</span
            ><button
              v-if="selection !== 'image'"
              class="resize-handle"
              tabindex="-1"
              aria-label="拖动调整大小"
              @pointerdown.stop="pointerDown($event, true)"
            />
          </div>
          <div v-if="snappedX" class="snap-line vertical" />
          <div v-if="snappedY" class="snap-line horizontal" />
        </div>
        <div v-if="busy || !ready" class="canvas-loading" role="status">
          <span class="loading-dot" />{{ !ready ? '正在准备工作区' : '正在处理素材' }}
        </div>
        <div v-if="smallPreview && thumbnailPreview" class="small-preview">
          <span>缩略预览</span><img :src="thumbnailPreview" alt="缩小后的封面效果" />
        </div>
      </div>
      <div class="canvas-bottom">
        <div class="layer-chips" aria-label="选择图层">
          <button
            v-for="layer in [
              { id: 'image', label: '主图' },
              { id: 'title', label: '主标题' },
              { id: 'subtitle', label: '副标题' },
            ]"
            :key="layer.id"
            :class="{ active: selection === layer.id }"
            @click="selectLayer(layer.id as PosterSelection)"
          >
            {{ layer.label }}</button
          ><button
            v-if="config.logo.file"
            :class="{ active: selection === 'logo' }"
            @click="selectLayer('logo')"
          >
            Logo
          </button>
        </div>
        <label class="zoom-control"
          ><span>缩放</span
          ><select v-model.number="zoom" aria-label="预览缩放">
            <option :value="0.75">75%</option>
            <option :value="1">适应</option>
            <option :value="1.25">125%</option>
            <option :value="1.5">150%</option>
          </select></label
        >
      </div>
      <div class="feedback-bar" :class="{ warning: overflow }">
        <span v-if="overflow">部分文字超出画布或文本框，请调整字号、宽度或位置</span
        ><span v-else-if="cropMode">拖动图片调整取景，完成后点击「完成取景」</span
        ><span v-else>单击选择 · 拖动排版 · 双击编辑文字 · 方向键微调</span
        ><span class="photo-credit">{{ config.bgFile ? '你的素材' : '原创示例影像' }}</span>
      </div>
    </main>

    <aside
      v-if="panel === 'templates'"
      class="quick-inspector"
      aria-label="选中元素属性"
      :inert="busy || exporting || !ready || undefined"
    >
      <div class="inspector-heading">
        <span class="overline">PROPERTIES</span>
        <h2>
          {{
            selection === 'image'
              ? '主图取景'
              : selection === 'logo'
                ? '品牌标识'
                : selection === 'title'
                  ? '主标题排版'
                  : '副标题排版'
          }}
        </h2>
      </div>
      <template v-if="textSelection">
        <label class="field"
          ><span>内容</span
          ><textarea
            v-model="selectedText.text"
            aria-label="快速编辑文字"
            maxlength="500"
            rows="4"
          />
        </label>
        <label class="field"
          ><span>字体</span
          ><select v-model="selectedText.fontFamily" aria-label="快速设置字体">
            <option v-for="font in POSTER_FONTS" :key="font.value" :value="font.value">
              {{ font.name }}
            </option>
          </select></label
        >
        <label class="field"
          ><span>字号</span
          ><input
            v-model.number="selectedText.fontSize"
            aria-label="快速设置字号"
            type="number"
            min="12"
            max="400"
        /></label>
        <div class="color-fields">
          <label
            >文字<input
              v-model="selectedText.color"
              type="color"
              aria-label="快速设置文字颜色" /></label
          ><label
            >强调<input
              v-model="selectedText.highlightColor"
              type="color"
              aria-label="快速设置强调颜色"
          /></label>
        </div>
        <label class="field"
          ><span>强调词语</span
          ><input v-model="selectedText.highlight" maxlength="100" placeholder="例如 旷野"
        /></label>
        <label class="field"
          ><span>文本框宽度</span
          ><input v-model.number="selectedText.width" type="range" min="0.1" max="0.95" step="0.01"
        /></label>
        <label class="check-row"
          ><input v-model="selectedText.autoFit" type="checkbox" />自动适配文本框</label
        >
        <div class="segmented">
          <button @click="alignText('x')">水平居中</button
          ><button @click="alignText('y')">垂直居中</button>
        </div>
        <button class="text-button" @click="panel = 'text'">更多文字设置 ↗</button>
      </template>
      <template v-else-if="selection === 'image'">
        <button class="upload-card compact" @click="fileInput?.click()">
          <span>＋</span><strong>替换主图</strong>
        </button>
        <div class="segmented">
          <button :class="{ active: config.bgFit !== 'contain' }" @click="config.bgFit = 'cover'">
            铺满</button
          ><button
            :class="{ active: config.bgFit === 'contain' }"
            @click="config.bgFit = 'contain'"
          >
            完整
          </button>
        </div>
        <label class="field"
          ><span
            >图片缩放 <output>{{ (config.bgZoom ?? 1).toFixed(2) }}×</output></span
          ><input v-model.number="config.bgZoom" type="range" min="1" max="3" step="0.01"
        /></label>
        <button class="secondary-button full" :aria-pressed="cropMode" @click="toggleCrop">
          {{ cropMode ? '✓ 完成取景' : '拖动图片取景' }}
        </button>
        <label class="field"
          ><span>背景暗化</span
          ><input
            v-model.number="config.bgOverlayOpacity"
            type="range"
            min="0"
            max="0.9"
            step="0.01"
        /></label>
        <button class="text-button" @click="panel = 'media'">全部素材设置 ↗</button>
      </template>
      <template v-else>
        <button class="secondary-button full" @click="logoInput?.click()">替换 Logo</button>
        <label class="field"
          ><span>大小</span
          ><input v-model.number="config.logo.size" type="range" min="0.03" max="0.8" step="0.01"
        /></label>
        <label class="field"
          ><span>透明度</span
          ><input v-model.number="config.logo.opacity" type="range" min="0" max="1" step="0.05"
        /></label>
        <label class="check-row"
          ><input v-model="config.logo.rounded" type="checkbox" />圆形裁切</label
        >
        <button class="text-button" @click="panel = 'brand'">全部品牌设置 ↗</button>
      </template>
      <div class="inspector-note"><span>↔</span>拖动排版，方向键精细移动。</div>
    </aside>

    <div
      v-if="error || notice"
      class="toast"
      :class="{ error: !!error }"
      :role="error ? 'alert' : 'status'"
    >
      <span>{{ error || notice }}</span
      ><button v-if="error && saveStatus === '保存失败'" @click="saveDraft">重试保存</button
      ><button aria-label="关闭提示" @click="dismissNotice">×</button>
    </div>

    <dialog
      ref="exportDialog"
      class="export-dialog"
      aria-labelledby="export-title"
      @cancel.prevent="!exporting && (exportOpen = false)"
    >
      <template v-if="exportOpen"
        ><div class="dialog-heading">
          <div>
            <span class="overline">READY TO SHARE</span>
            <h2 id="export-title">让作品被看见</h2>
          </div>
          <button
            class="icon-button"
            aria-label="关闭导出"
            :disabled="exporting"
            @click="exportOpen = false"
          >
            ×
          </button>
        </div>
        <img :src="thumbnailPreview" class="export-preview" alt="即将导出的封面" />
        <p class="export-size">{{ dimensions[0] }} × {{ dimensions[1] }} px</p>
        <label class="field"
          ><span>文件名称</span
          ><input v-model="exportName" maxlength="100" aria-label="导出文件名称"
        /></label>
        <div class="segmented">
          <button
            :class="{ active: format === 'png' }"
            :disabled="exporting"
            @click="format = 'png'"
          >
            PNG · 无损</button
          ><button
            :class="{ active: format === 'jpeg' }"
            :disabled="exporting"
            @click="format = 'jpeg'"
          >
            JPG · 小体积
          </button>
        </div>
        <label v-if="format === 'jpeg'" class="field"
          ><span
            >图片质量 <output>{{ Math.round(quality * 100) }}%</output></span
          ><input v-model.number="quality" type="range" min="0.5" max="1" step="0.01"
        /></label>
        <p v-if="overflow" class="export-warning">文字存在越界，请返回画布检查排版。</p>
        <p v-if="error" class="export-warning" role="alert">{{ error }}</p>
        <button class="primary-button full" :disabled="exporting" @click="exportPoster">
          {{ exporting ? '正在导出…' : '下载封面图片 ↗' }}
        </button>
      </template>
    </dialog>
  </div>
</template>

<style scoped>
.poster-studio {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 64px 260px minmax(0, 1fr);
  grid-template-rows: 68px minmax(0, 1fr);
  background: var(--bg);
  color: var(--text);
  --studio-line: var(--border);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
.studio-toolbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  gap: 16px;
  border-bottom: 1px solid var(--studio-line);
  background: var(--surface);
}
.document-heading {
  display: flex;
  align-items: center;
  gap: 11px;
  flex-shrink: 0;
}
.studio-mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 36px;
  font-family: Georgia, serif;
  font-size: 26px;
  color: var(--text);
  border: 1px solid var(--border-hover);
  border-radius: 3px 12px 3px 3px;
}
h1 {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.save-state {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: var(--text-2);
}
.toolbar-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}
.toolbar-rule {
  width: 1px;
  height: 20px;
  background: var(--border);
  margin: 0 8px;
}
.icon-button {
  width: 32px;
  height: 34px;
  border-radius: 6px;
  font-size: 23px;
  display: grid;
  place-items: center;
}
.icon-button:hover:not(:disabled) {
  background: var(--hover-bg-2);
}
button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
button,
input,
textarea,
select {
  font: inherit;
}
button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible,
.artboard:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.primary-button,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 15px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  min-height: 36px;
}
.primary-button {
  background: var(--accent);
  color: var(--on-accent);
}
.primary-button:hover:not(:disabled) {
  background: var(--accent-hi);
}
.primary-button > span {
  font-size: 17px;
}
.secondary-button {
  background: var(--surface-2);
  border: 1px solid var(--border-hover);
  color: var(--text-2);
}
.secondary-button:hover {
  color: var(--text);
  background: var(--hover-bg-2);
}
.full {
  width: 100%;
}
.ratio-control {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 11px;
  color: var(--text-2);
}
.ratio-control select {
  min-width: 80px;
}
select,
input:not([type='range']):not([type='checkbox']):not([type='color']),
textarea {
  border: 1px solid var(--border-hover);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--surface-2);
  color: var(--text);
  min-width: 0;
}
select {
  cursor: pointer;
}
.tool-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 22px 0;
  background: var(--surface);
  border-right: 1px solid var(--studio-line);
}
.tool-rail button {
  width: 48px;
  min-height: 57px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: var(--text-2);
  border-radius: 8px;
}
.tool-rail button span {
  display: grid;
  place-items: center;
  width: 32px;
  height: 30px;
  font-size: 22px;
  font-family: Georgia, serif;
}
.tool-rail button.active {
  color: var(--accent-light);
  background: var(--accent-dim);
}
.tool-rail button:hover {
  color: var(--text);
}
.library-panel {
  overflow-y: auto;
  padding: 23px 18px 32px;
  border-right: 1px solid var(--studio-line);
  background: var(--surface);
  min-height: 0;
}
.overline {
  font-family: 'Avenir Next', sans-serif;
  font-size: 8px;
  letter-spacing: 0.19em;
  font-weight: 600;
  color: var(--text-2);
}
.panel-heading {
  margin-bottom: 21px;
}
h2 {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.04em;
  margin-top: 7px;
}
.panel-heading p {
  font-size: 11px;
  color: var(--text-2);
  margin-top: 7px;
}
h3 {
  font-size: 12px;
  margin: 25px 0 12px;
  font-weight: 600;
}
.category-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 19px;
}
.category-tabs button {
  padding: 5px 9px;
  border-radius: 5px;
  color: var(--text-2);
  font-size: 10px;
  border: 1px solid transparent;
}
.category-tabs button.active {
  background: var(--hover-bg-2);
  color: var(--text);
  border-color: var(--border-hover);
}
.template-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
}
.template-card {
  display: block;
  width: 100%;
  text-align: left;
  border-radius: 5px;
}
.template-art {
  position: relative;
  overflow: hidden;
  aspect-ratio: 16 / 10;
  border-radius: 5px;
  border: 2px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s;
}
.template-art img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.template-card.selected .template-art {
  border-color: var(--accent-light);
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.template-card:hover .template-art {
  border-color: var(--accent-light);
}
.template-check {
  position: absolute;
  bottom: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  color: white;
  display: grid;
  place-items: center;
  font-size: 10px;
}
.template-caption {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding-top: 7px;
}
.template-caption strong {
  font-size: 11px;
  font-weight: 500;
}
.template-caption > span {
  font-size: 9px;
  color: var(--text-2);
}
.canvas-workspace {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  position: relative;
}
.workspace-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 25px;
  gap: 8px;
}
.workspace-heading > span {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-2);
  font-size: 10px;
}
.workspace-heading i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-3);
}
.text-button {
  color: var(--text-2);
  font-size: 11px;
  padding: 6px 0;
}
.text-button:hover {
  color: var(--accent-light);
}
.canvas-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background-image: radial-gradient(var(--border-hover) 0.6px, transparent 0.6px);
  background-size: 14px 14px;
}
.artboard {
  position: relative;
  flex-shrink: 0;
  box-shadow:
    0 8px 32px #0003,
    0 1px 4px #0002;
  touch-action: none;
  cursor: default;
}
.artboard canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.safe-area {
  position: absolute;
  inset: 6%;
  border: 1px dashed #ffffff35;
  pointer-events: none;
}
.selection-box {
  position: absolute;
  border: 1px solid #a99bff;
  pointer-events: none;
}
.selection-label {
  position: absolute;
  bottom: 100%;
  left: -1px;
  font-size: 9px;
  background: #7060ff;
  color: white;
  padding: 2px 5px;
  white-space: nowrap;
}
.resize-handle {
  position: absolute;
  bottom: -5px;
  right: -5px;
  width: 10px;
  height: 10px;
  background: white;
  border: 1.5px solid #7060ff;
  cursor: nwse-resize;
  pointer-events: auto;
  touch-action: none;
}
.selection-box.crop {
  border-style: dashed;
}
.is-cropping .artboard {
  cursor: grab;
}
.is-cropping .artboard:active {
  cursor: grabbing;
}
.snap-line {
  position: absolute;
  background: #e7a4e0;
  pointer-events: none;
}
.snap-line.vertical {
  width: 1px;
  top: 0;
  bottom: 0;
  left: 50%;
}
.snap-line.horizontal {
  height: 1px;
  left: 0;
  right: 0;
  top: 50%;
}
.canvas-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px 14px;
  gap: 8px;
}
.layer-chips {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.layer-chips button {
  font-size: 10px;
  color: var(--text-2);
  padding: 5px 11px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
}
.layer-chips button.active {
  color: var(--accent-light);
  border-color: var(--border-focus);
}
.zoom-control {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--text-2);
}
.zoom-control select {
  padding: 4px 8px;
  font-size: 10px;
}
.feedback-bar {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 24px;
  color: var(--text-2);
  font-size: 10px;
  border-top: 1px solid var(--border);
}
.feedback-bar.warning {
  color: var(--amber);
}
.photo-credit {
  white-space: nowrap;
  opacity: 0.7;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 16px 0;
  font-size: 11px;
  color: var(--text-2);
}
.field > span {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.field input:not([type='range']),
.field select,
.field textarea {
  width: 100%;
  font-size: 12px;
}
.field textarea {
  resize: vertical;
  line-height: 1.65;
}
.field output {
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}
input[type='range'] {
  width: 100%;
  accent-color: var(--accent);
  height: 16px;
  cursor: pointer;
}
input[type='color'] {
  width: 32px;
  height: 28px;
  padding: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border-hover);
  border-radius: 5px;
  cursor: pointer;
}
input[type='checkbox'] {
  accent-color: var(--accent);
}
.field-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.field-pair .field {
  margin-top: 0;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-2);
  margin: 12px 0;
  cursor: pointer;
}
.inline-field {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 12px 0;
  color: var(--text-2);
  font-size: 11px;
}
.text-tools {
  display: flex;
  gap: 6px;
  align-items: center;
}
.text-tools > button {
  width: 30px;
  height: 30px;
  border: 1px solid var(--border-hover);
  border-radius: 5px;
}
.text-tools > select {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  padding: 6px;
}
.chosen {
  color: var(--accent-light);
  background: var(--accent-dim);
}
.segmented {
  display: flex;
  padding: 3px;
  gap: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 7px;
  margin: 12px 0;
}
.segmented > button {
  flex: 1;
  min-height: 31px;
  font-size: 11px;
  color: var(--text-2);
  padding: 4px 6px;
  border-radius: 4px;
}
.segmented > button.active {
  background: var(--surface-4);
  color: var(--text);
}
.upload-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  justify-content: center;
  align-items: center;
  width: 100%;
  border: 1px dashed var(--border-hover);
  background: var(--surface-2);
  border-radius: 8px;
  padding: 26px 12px;
}
.upload-card > span {
  font-size: 28px;
  color: var(--accent-light);
  font-weight: 300;
}
.upload-card strong {
  font-size: 12px;
  font-weight: 500;
}
.upload-card small {
  font-size: 10px;
  color: var(--text-2);
}
.upload-card:hover {
  border-color: var(--accent-light);
}
.upload-card.compact {
  padding: 12px;
}
.asset-info {
  font-size: 10px;
  color: var(--text-2);
  overflow-wrap: anywhere;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 0;
}
.status-dot {
  width: 5px;
  height: 5px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--teal);
}
.color-fields {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: 16px 0;
}
.color-fields label {
  font-size: 10px;
  color: var(--text-2);
  display: flex;
  flex-direction: column;
  gap: 7px;
}
details {
  border-top: 1px solid var(--border);
  margin: 20px 0 12px;
  padding-top: 13px;
}
summary {
  font-size: 11px;
  color: var(--text-2);
  cursor: pointer;
}
.saved-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border);
}
.saved-row button {
  padding: 10px 0;
  font-size: 11px;
}
.saved-row button:first-child {
  flex: 1;
  text-align: left;
  overflow-wrap: anywhere;
}
.saved-row button:last-child {
  padding: 10px;
}
.frame-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
  margin: 12px 0;
}
.frame-strip button {
  min-width: 0;
}
.frame-strip img {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  display: block;
  border-radius: 3px;
}
.frame-strip span {
  color: var(--text-2);
  font-size: 9px;
}
.canvas-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--overlay-bg);
  color: white;
  font-size: 12px;
  z-index: 4;
}
.loading-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-light);
  animation: breathe 1s infinite alternate;
}
@keyframes breathe {
  to {
    opacity: 0.3;
  }
}
.small-preview {
  position: absolute;
  right: 18px;
  top: 12px;
  width: 180px;
  border: 1px solid var(--border-hover);
  background: var(--surface);
  border-radius: 6px;
  padding: 8px;
  box-shadow: 0 5px 20px #0003;
  pointer-events: none;
}
.small-preview > span {
  display: block;
  font-size: 9px;
  color: var(--text-2);
  margin-bottom: 6px;
}
.small-preview img {
  display: block;
  width: 100%;
  max-height: 220px;
  object-fit: contain;
}
.toast {
  position: fixed;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 110;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 11px 16px;
  background: var(--surface-3);
  color: var(--text);
  border: 1px solid var(--border-hover);
  border-radius: 8px;
  font-size: 12px;
  box-shadow: 0 4px 24px #0003;
  max-width: min(90vw, 600px);
}
.toast.error {
  color: var(--amber);
}
.toast > span {
  overflow-wrap: anywhere;
}
.toast button {
  font-size: 15px;
  white-space: nowrap;
}
.export-dialog {
  position: fixed;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  width: min(440px, calc(100vw - 32px));
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  border: 1px solid var(--border-hover);
  border-radius: 14px;
  padding: 25px;
  background: var(--surface);
  color: var(--text);
  z-index: 101;
  box-shadow: 0 20px 90px #0005;
}
.export-dialog:not([open]) {
  display: none;
}
.dialog-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.dialog-heading h2 {
  margin-top: 4px;
}
.export-dialog::backdrop {
  background: #0009;
  backdrop-filter: blur(4px);
}
.export-preview {
  width: 100%;
  max-height: 240px;
  object-fit: contain;
  display: block;
  background: var(--surface-2);
  border-radius: 5px;
}
.export-size {
  margin-top: 8px;
  text-align: center;
  color: var(--text-2);
  font-size: 10px;
}
.export-warning {
  font-size: 11px;
  color: var(--amber);
  margin: 12px 0;
}
.quick-inspector {
  background: var(--surface);
  border-left: 1px solid var(--border);
  padding: 25px 20px;
  overflow-y: auto;
  min-width: 0;
}
.inspector-heading {
  margin-bottom: 26px;
}
.inspector-heading h2 {
  font-size: 15px;
  letter-spacing: 0;
}
.inspector-note {
  display: flex;
  gap: 8px;
  margin-top: 30px;
  padding-top: 15px;
  border-top: 1px solid var(--border);
  font-size: 10px;
  color: var(--text-2);
}
@media (max-width: 1180px) {
  .quick-inspector {
    display: none;
  }
}

@media (min-width: 1181px) {
  .poster-studio.has-inspector {
    grid-template-columns: 64px 260px minmax(0, 1fr) 230px;
  }
}
@media (min-width: 1600px) {
  .poster-studio.has-inspector {
    grid-template-columns: 72px 286px minmax(0, 1fr) 260px;
  }
  .poster-studio {
    grid-template-columns: 72px 286px minmax(0, 1fr);
  }
  .library-panel {
    padding: 26px 23px;
  }
}
@media (max-width: 1180px) and (min-width: 761px) {
  .poster-studio {
    grid-template-columns: 52px 245px minmax(0, 1fr);
  }
  .studio-toolbar {
    padding: 0 16px;
  }
  .thumbnail-toggle,
  .ratio-control > span {
    display: none;
  }
  .toolbar-controls {
    gap: 5px;
  }
  .toolbar-rule {
    margin: 0 3px;
  }
  .document-heading {
    gap: 7px;
  }
  .tool-rail button {
    width: 43px;
  }
  .workspace-heading {
    padding: 14px;
  }
}
@media (max-width: 760px) {
  .poster-studio {
    height: calc(100dvh - 96px);
    min-height: 500px;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 60px minmax(220px, 48%) 55px minmax(0, 1fr);
    overflow: hidden;
  }
  .studio-toolbar {
    grid-row: 1;
    padding: 0 12px;
    gap: 8px;
  }
  .studio-mark,
  .save-state,
  .toolbar-rule,
  .thumbnail-toggle,
  .ratio-control > span {
    display: none;
  }
  .document-heading h1 {
    font-size: 12px;
  }
  .toolbar-controls {
    gap: 4px;
  }
  .icon-button {
    width: 28px;
    height: 34px;
    font-size: 21px;
  }
  .ratio-control select {
    min-width: 64px;
    padding: 5px;
    font-size: 12px !important;
  }
  .primary-button {
    min-height: 36px;
    padding: 7px 10px;
    font-size: 11px;
  }
  .canvas-workspace {
    grid-row: 2;
    grid-column: 1;
    overflow: hidden;
  }
  .workspace-heading {
    padding: 6px 12px;
  }
  .workspace-heading .text-button {
    padding: 2px 0;
    font-size: 9px;
  }
  .workspace-heading > span {
    font-size: 9px;
  }
  .canvas-bottom {
    padding: 6px 12px;
  }
  .feedback-bar {
    padding: 4px 12px;
    font-size: 8px;
  }
  .photo-credit,
  .zoom-control > span {
    display: none;
  }
  .zoom-control select {
    min-height: 26px;
    font-size: 11px !important;
  }
  .layer-chips button {
    padding: 3px 8px;
    font-size: 9px;
  }
  .tool-rail {
    grid-row: 3;
    grid-column: 1;
    flex-direction: row;
    justify-content: center;
    gap: 14px;
    padding: 3px 12px;
    border-right: 0;
    border-block: 1px solid var(--border);
  }
  .tool-rail button {
    width: 65px;
    min-height: 46px;
    gap: 0;
    font-size: 9px;
  }
  .tool-rail button span {
    height: 27px;
    font-size: 20px;
  }
  .library-panel {
    grid-row: 4;
    grid-column: 1;
    padding: 17px 16px 30px;
    overflow-y: auto;
    border-right: 0;
  }
  .panel-heading {
    margin-bottom: 14px;
  }
  .panel-heading h2 {
    font-size: 17px;
  }
  .panel-heading p,
  .panel-heading .overline {
    display: none;
  }
  .template-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }
  .template-caption {
    gap: 3px;
    flex-direction: column;
  }
  .category-tabs {
    margin-bottom: 14px;
    gap: 3px;
  }
  .category-tabs button {
    font-size: 10px;
    padding: 5px 7px;
  }
  .field {
    margin: 12px 0;
  }
  .field input:not([type='range']),
  .field select,
  .field textarea {
    font-size: 16px;
  }
  .small-preview {
    width: 110px;
    right: 8px;
    top: 4px;
  }
  .toast {
    bottom: 12px;
    font-size: 11px;
    padding: 9px 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
