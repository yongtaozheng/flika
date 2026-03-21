import { ref, type Ref } from 'vue'
import type { PosterConfig, PosterTextLayer, PosterImageLayer } from '../types'

export function usePosterEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  config: Ref<PosterConfig>,
) {
  const logoImage = ref<HTMLImageElement | null>(null)
  const bgMedia = ref<HTMLImageElement | HTMLVideoElement | null>(null)

  // ── Media loading ──────────────────────────────────────────────────────────

  async function loadLogoImage(file: File): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => { logoImage.value = img; resolve() }
      img.onerror = () => resolve()
      img.src = url
    })
  }

  function clearLogo() { logoImage.value = null }

  async function loadBgMedia(file: File, type: 'image' | 'video'): Promise<void> {
    const url = URL.createObjectURL(file)
    if (type === 'image') {
      return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => { bgMedia.value = img; resolve() }
        img.onerror = () => resolve()
        img.src = url
      })
    } else {
      return new Promise((resolve) => {
        const vid = document.createElement('video')
        vid.preload = 'auto'
        vid.muted = true
        vid.onloadeddata = () => { bgMedia.value = vid; resolve() }
        vid.onerror = () => resolve()
        vid.src = url
      })
    }
  }

  function clearBgMedia() {
    if (bgMedia.value instanceof HTMLVideoElement) bgMedia.value.pause()
    bgMedia.value = null
  }

  async function seekBgVideoAsync(t: number): Promise<void> {
    if (!(bgMedia.value instanceof HTMLVideoElement)) return
    const vid = bgMedia.value
    vid.currentTime = t
    return new Promise((resolve) => {
      const handler = () => { vid.removeEventListener('seeked', handler); resolve() }
      vid.addEventListener('seeked', handler)
    })
  }

  // ── Drawing helpers ────────────────────────────────────────────────────────

  function drawBgCover(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    source: HTMLImageElement | HTMLVideoElement,
  ) {
    const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
    const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
    if (!sw || !sh) return
    const srcRatio = sw / sh
    const dstRatio = width / height
    let drawW: number, drawH: number, dx: number, dy: number
    if (srcRatio > dstRatio) {
      drawH = height; drawW = height * srcRatio
      dx = (width - drawW) / 2; dy = 0
    } else {
      drawW = width; drawH = width / srcRatio
      dx = 0; dy = (height - drawH) / 2
    }
    ctx.drawImage(source, dx, dy, drawW, drawH)
  }

  function drawTextLayer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    layer: PosterTextLayer,
  ) {
    if (!layer.text.trim()) return
    const cx = layer.x * width
    const cy = layer.y * height
    const lines = layer.text.split('\n')
    const lineHeight = layer.fontSize * 1.3
    const totalH = lines.length * lineHeight
    const startY = cy - totalH / 2 + lineHeight / 2

    ctx.save()
    ctx.font = `${layer.fontStyle} ${layer.fontWeight} ${layer.fontSize}px sans-serif`
    ctx.textAlign = layer.textAlign as CanvasTextAlign
    ctx.textBaseline = 'middle'

    for (let i = 0; i < lines.length; i++) {
      const lineY = startY + i * lineHeight
      const text = lines[i]

      // stroke (drawn without shadow so it stays crisp)
      if (layer.strokeWidth > 0) {
        ctx.save()
        ctx.shadowBlur = 0
        ctx.strokeStyle = layer.strokeColor
        ctx.lineWidth = layer.strokeWidth * 2
        ctx.lineJoin = 'round'
        ctx.strokeText(text, cx, lineY)
        ctx.restore()
      }

      // fill with optional glow
      ctx.shadowBlur = layer.shadowBlur
      ctx.shadowColor = layer.shadowColor
      ctx.fillStyle = layer.color
      ctx.fillText(text, cx, lineY)
    }

    ctx.restore()
  }

  function drawImageLayer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    layer: PosterImageLayer,
    imgEl: HTMLImageElement,
  ) {
    if (layer.opacity <= 0) return
    const drawW = layer.size * width
    const imgRatio = imgEl.naturalWidth / imgEl.naturalHeight
    const drawH = drawW / imgRatio
    const cx = layer.x * width
    const cy = layer.y * height

    ctx.save()
    ctx.globalAlpha = layer.opacity

    if (layer.rounded) {
      const r = Math.min(drawW, drawH) / 2
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.clip()
    }

    ctx.drawImage(imgEl, cx - drawW / 2, cy - drawH / 2, drawW, drawH)
    ctx.restore()
  }

  // ── Core render ────────────────────────────────────────────────────────────

  function renderPoster() {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { width, height } = canvas
    const cfg = config.value

    // background
    if (cfg.bgType === 'color' || !bgMedia.value) {
      if (cfg.bgColor === cfg.bgColorEnd) {
        ctx.fillStyle = cfg.bgColor
        ctx.fillRect(0, 0, width, height)
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, height)
        grad.addColorStop(0, cfg.bgColor)
        grad.addColorStop(1, cfg.bgColorEnd)
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, width, height)
      }
    } else {
      ctx.save()
      ctx.globalAlpha = 1
      drawBgCover(ctx, width, height, bgMedia.value)
      if (cfg.bgOverlayOpacity > 0) {
        ctx.globalAlpha = cfg.bgOverlayOpacity
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, width, height)
      }
      ctx.restore()
    }

    // logo
    if (logoImage.value) {
      drawImageLayer(ctx, width, height, cfg.logo, logoImage.value)
    }

    // text layers
    drawTextLayer(ctx, width, height, cfg.title)
    drawTextLayer(ctx, width, height, cfg.subtitle)
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  async function exportPNG(): Promise<Blob> {
    renderPoster()
    return new Promise((resolve, reject) => {
      canvasRef.value?.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('导出失败')),
        'image/png',
      )
    })
  }

  async function exportJPEG(quality = 0.92): Promise<Blob> {
    renderPoster()
    const canvas = canvasRef.value
    if (!canvas) throw new Error('Canvas 不可用')
    // JPEG has no alpha — composite onto white background
    const tmp = document.createElement('canvas')
    tmp.width = canvas.width
    tmp.height = canvas.height
    const tCtx = tmp.getContext('2d')!
    tCtx.fillStyle = '#ffffff'
    tCtx.fillRect(0, 0, tmp.width, tmp.height)
    tCtx.drawImage(canvas, 0, 0)
    return new Promise((resolve, reject) => {
      tmp.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('导出失败')),
        'image/jpeg',
        quality,
      )
    })
  }

  return {
    bgMedia,
    logoImage,
    loadLogoImage,
    clearLogo,
    loadBgMedia,
    clearBgMedia,
    seekBgVideoAsync,
    renderPoster,
    exportPNG,
    exportJPEG,
  }
}
