import { onBeforeUnmount, ref, shallowRef, type Ref } from 'vue'
import type { PosterConfig } from '../types'
import {
  renderPosterCanvas,
  type PosterMedia,
  type PosterRenderResult,
} from '../utils/posterRenderer'

export function usePosterEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  config: Ref<PosterConfig>,
) {
  const logoImage = shallowRef<HTMLImageElement | null>(null)
  const bgMedia = shallowRef<PosterMedia | null>(null)
  const bounds = ref<PosterRenderResult>({})
  let bgRevision = 0
  let logoRevision = 0
  let bgObjectUrl = ''
  let logoObjectUrl = ''
  let seekRevision = 0

  function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('图片加载失败，请选择有效的图片文件'))
      image.src = url
    })
  }
  async function loadLogoImage(file: File) {
    const revision = ++logoRevision
    const url = URL.createObjectURL(file)
    try {
      const image = await loadImage(url)
      if (revision !== logoRevision) return
      if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl)
      logoObjectUrl = url
      logoImage.value = image
    } finally {
      if (logoObjectUrl !== url) URL.revokeObjectURL(url)
    }
  }
  function clearLogo() {
    logoRevision++
    logoImage.value = null
    if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl)
    logoObjectUrl = ''
  }
  async function loadBgMedia(source: File | string, type: 'image' | 'video') {
    const revision = ++bgRevision
    const url = typeof source === 'string' ? source : URL.createObjectURL(source)
    let media: PosterMedia
    try {
      media =
        type === 'image'
          ? await loadImage(url)
          : await new Promise<HTMLVideoElement>((resolve, reject) => {
              const video = document.createElement('video')
              video.preload = 'auto'
              video.muted = true
              video.playsInline = true
              video.onloadeddata = () => resolve(video)
              video.onerror = () => reject(new Error('视频无法解码，请尝试 MP4 或 WebM 文件'))
              video.src = url
            })
      if (revision !== bgRevision) return
      if (bgMedia.value instanceof HTMLVideoElement) bgMedia.value.pause()
      if (bgObjectUrl) URL.revokeObjectURL(bgObjectUrl)
      bgObjectUrl = typeof source === 'string' ? '' : url
      bgMedia.value = media
    } finally {
      if (typeof source !== 'string' && bgObjectUrl !== url) URL.revokeObjectURL(url)
    }
  }
  function clearBgMedia() {
    bgRevision++
    seekRevision++
    if (bgMedia.value instanceof HTMLVideoElement) {
      bgMedia.value.pause()
      bgMedia.value.removeAttribute('src')
      bgMedia.value.load()
    }
    bgMedia.value = null
    if (bgObjectUrl) URL.revokeObjectURL(bgObjectUrl)
    bgObjectUrl = ''
  }
  async function seekBgVideoAsync(time: number): Promise<void> {
    const video = bgMedia.value
    if (!(video instanceof HTMLVideoElement)) return
    const revision = ++seekRevision
    const target = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.001)))
    if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) return
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener('seeked', done)
        video.removeEventListener('error', failed)
        clearTimeout(timeout)
      }
      const done = () => {
        cleanup()
        resolve()
      }
      const failed = () => {
        cleanup()
        reject(new Error('视频选帧失败，请重试'))
      }
      const timeout = setTimeout(() => {
        cleanup()
        if (revision !== seekRevision) resolve()
        else reject(new Error('视频选帧超时，请重试'))
      }, 8000)
      video.addEventListener('seeked', done)
      video.addEventListener('error', failed)
      video.currentTime = target
    })
  }
  function renderPoster() {
    if (canvasRef.value)
      bounds.value = renderPosterCanvas(
        canvasRef.value,
        config.value,
        bgMedia.value,
        logoImage.value,
      )
  }
  function renderTo(canvas: HTMLCanvasElement, value = config.value) {
    return renderPosterCanvas(canvas, value, bgMedia.value, logoImage.value)
  }
  async function exportImage(format: 'png' | 'jpeg', quality = 0.92): Promise<Blob> {
    if (!canvasRef.value) throw new Error('画布尚未就绪')
    renderPoster()
    return new Promise((resolve, reject) =>
      canvasRef.value!.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('图片编码失败，请重试'))),
        `image/${format}`,
        quality,
      ),
    )
  }
  onBeforeUnmount(() => {
    clearBgMedia()
    clearLogo()
  })
  return {
    bgMedia,
    logoImage,
    bounds,
    loadLogoImage,
    clearLogo,
    loadBgMedia,
    clearBgMedia,
    seekBgVideoAsync,
    renderPoster,
    renderTo,
    exportPNG: () => exportImage('png'),
    exportJPEG: (quality = 0.92) => exportImage('jpeg', quality),
  }
}
