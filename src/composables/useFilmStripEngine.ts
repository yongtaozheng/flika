import { type Ref } from 'vue'
import type { UploadedImage } from '../types'

// ── Constants ─────────────────────────────────────────────────────────────────
export const COL_W    = 540   // width per column
export const FILM_H   = 960   // canvas height (fixed)

const SP_W      = 28
const SP_HOLE_W = 14
const SP_HOLE_H = 16
const SP_STRIDE = 32

const FR_PAD = 12
export const FR_W   = COL_W - 2 * SP_W - 2 * FR_PAD   // 460
const FR_H   = Math.round(FR_W * 3 / 4)         // 345
export const FR_GAP = 24
export const FRAME_STRIDE = FR_H + FR_GAP        // 369
export const FR_X_LOCAL = SP_W + FR_PAD          // 40 (relative to column left edge)
export const FULL_STRIDE = FILM_H + FR_GAP       // full-height column stride

// ── Column data interface (used by both engine and view) ──────────────────────
export interface FilmColumnData {
  id: string
  type: 'images' | 'video'
  images: UploadedImage[]
  videoStartTime: number
  imgOffsets?: Map<string, { x: number; y: number }>
  fullHeight?: boolean   // columns 1 & 2: each frame fills full column height
}

// ── Engine ────────────────────────────────────────────────────────────────────
export function useFilmStripEngine(
  canvasRef:  Ref<HTMLCanvasElement | null>,
  columnsRef: Ref<FilmColumnData[]>,
  colCountRef: Ref<number>,
) {
  // per-column caches
  const imgCaches  = new Map<string, Map<string, HTMLImageElement>>()
  const videoEls   = new Map<string, HTMLVideoElement>()
  let   grainCache: HTMLCanvasElement | null = null

  // ── helpers ─────────────────────────────────────────────────────────────────
  function getCtx() { return canvasRef.value?.getContext('2d') ?? null }

  function getImgCache(colId: string) {
    if (!imgCaches.has(colId)) imgCaches.set(colId, new Map())
    return imgCaches.get(colId)!
  }

  function getGrain(): HTMLCanvasElement {
    if (grainCache) return grainCache
    grainCache = document.createElement('canvas')
    grainCache.width  = COL_W
    grainCache.height = FILM_H
    const gc = grainCache.getContext('2d')!
    const d  = gc.createImageData(COL_W, FILM_H)
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.random() < 0.5 ? 255 : 0
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v
      d.data[i + 3] = Math.floor(Math.random() * 24)
    }
    gc.putImageData(d, 0, 0)
    return grainCache
  }

  // ── Per-image frame positions (variable height based on aspect ratio) ────────
  function getFramePositions(col: FilmColumnData): { y: number; h: number }[] {
    const cache = getImgCache(col.id)
    const full  = col.fullHeight ?? false
    const fW    = full ? COL_W : FR_W
    const results: { y: number; h: number }[] = []
    let y = 0
    for (const img of col.images) {
      const el = cache.get(img.id)
      let h: number
      if (el?.complete && el.naturalWidth > 0) {
        h = Math.round(fW * (el.naturalHeight / el.naturalWidth))
      } else {
        h = full ? FILM_H : FR_H   // fallback to original fixed height
      }
      results.push({ y, h })
      y += h + FR_GAP
    }
    return results
  }

  // column total scroll height (images only; video = Infinity)
  function colTotalHeight(col: FilmColumnData) {
    if (col.type !== 'images') return Infinity
    if (col.images.length === 0) return 0
    const positions = getFramePositions(col)
    const last = positions[positions.length - 1]
    return last.y + last.h
  }

  // ── preload / video management ───────────────────────────────────────────────
  async function preloadColumnImages(colId: string, images: UploadedImage[]) {
    const cache = getImgCache(colId)
    for (const img of images) {
      if (cache.has(img.id)) continue
      await new Promise<void>(res => {
        const el = new Image()
        el.onload  = () => { cache.set(img.id, el); res() }
        el.onerror = () => res()
        el.src = img.url
      })
    }
  }

  function removeColumnImage(colId: string, imgId: string) {
    getImgCache(colId).delete(imgId)
  }

  async function loadColumnVideo(
    colId:     string,
    url:       string,
    startTime: number,
  ): Promise<HTMLVideoElement> {
    clearColumnVideo(colId)
    return new Promise<HTMLVideoElement>(res => {
      const el        = document.createElement('video')
      el.muted        = true
      el.preload      = 'auto'
      el.playsInline  = true
      el.oncanplay    = () => { el.currentTime = startTime; videoEls.set(colId, el); res(el) }
      el.onerror      = () => { videoEls.set(colId, el); res(el) }
      el.src          = url
      el.load()
    })
  }

  function clearColumnVideo(colId: string) {
    const el = videoEls.get(colId)
    if (el) { el.pause(); el.removeAttribute('src'); el.load() }
    videoEls.delete(colId)
  }

  function getVideoEl(colId: string) {
    return videoEls.get(colId) ?? null
  }

  // ── drawing ──────────────────────────────────────────────────────────────────
  function drawSprockets(c: CanvasRenderingContext2D, colX: number, scrollY: number, drawLeft: boolean, drawRight: boolean) {
    for (const side of (['left', 'right'] as const).filter(s => s === 'left' ? drawLeft : drawRight)) {
      const x  = side === 'left' ? colX : colX + COL_W - SP_W
      const lx = side === 'left' ? x + SP_W - 0.5 : x + 0.5
      c.fillStyle = '#0f0c08'
      c.fillRect(x, 0, SP_W, FILM_H)
      c.save(); c.strokeStyle = 'rgba(255,255,255,0.04)'; c.lineWidth = 1
      c.beginPath(); c.moveTo(lx, 0); c.lineTo(lx, FILM_H); c.stroke(); c.restore()
      const hx    = x + SP_W / 2 - SP_HOLE_W / 2
      const phase = scrollY % SP_STRIDE
      for (let hy = -phase - SP_STRIDE; hy < FILM_H + SP_STRIDE; hy += SP_STRIDE) {
        const top = hy + (SP_STRIDE - SP_HOLE_H) / 2
        c.beginPath(); c.roundRect(hx, top, SP_HOLE_W, SP_HOLE_H, 2)
        c.fillStyle = '#050403'; c.fill()
        c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 0.5; c.stroke()
      }
    }
  }

  function coverDraw(
    c: CanvasRenderingContext2D,
    src: HTMLImageElement | HTMLVideoElement,
    srcW: number, srcH: number,
    dx: number, dy: number, dw: number, dh: number,
    offX = 0, offY = 0,
  ) {
    const srcAR = srcW / srcH
    const dstAR = dw  / dh
    let sx = 0, sy = 0, sw = srcW, sh = srcH
    if (srcAR > dstAR) {
      sh = srcH; sw = sh * dstAR
      sx = (srcW - sw) / 2 - offX * (sw / dw)
      sx = Math.max(0, Math.min(srcW - sw, sx))
    } else {
      sw = srcW; sh = sw / dstAR
      sy = (srcH - sh) / 2 - offY * (sh / dh)
      sy = Math.max(0, Math.min(srcH - sh, sy))
    }
    c.drawImage(src as CanvasImageSource, sx, sy, sw, sh, dx, dy, dw, dh)
  }

  function applyFilmLook(
    c: CanvasRenderingContext2D,
    fx: number, fy: number, fw: number, fh: number,
  ) {
    // sepia tint
    c.save(); c.globalCompositeOperation = 'multiply'; c.globalAlpha = 0.12
    c.fillStyle = 'rgb(210,145,55)'; c.fillRect(fx, fy, fw, fh); c.restore()
    // vignette
    const vg = c.createRadialGradient(fx+fw/2, fy+fh/2, fw*0.22, fx+fw/2, fy+fh/2, fw*0.72)
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.30)')
    c.fillStyle = vg; c.fillRect(fx, fy, fw, fh)
  }

  function drawImagesColumn(c: CanvasRenderingContext2D, colX: number, col: FilmColumnData, scrollY: number) {
    c.fillStyle = '#0a0908'; c.fillRect(colX, 0, COL_W, FILM_H)
    const cache  = getImgCache(col.id)
    const full   = col.fullHeight ?? false
    const fW     = full ? COL_W : FR_W
    const fX     = full ? colX  : colX + FR_X_LOCAL
    const positions = getFramePositions(col)

    for (let i = 0; i < col.images.length; i++) {
      const { y: frameY, h: frameH } = positions[i]
      const y = frameY - scrollY

      // Skip if outside visible area
      if (y + frameH < 0) continue
      if (y > FILM_H) break

      const img = col.images[i]
      if (!full) {
        c.fillStyle = '#181410'; c.fillRect(colX + SP_W, y - 4, COL_W - 2 * SP_W, frameH + 8)
      }
      const el = cache.get(img.id)
      if (el?.complete && el.naturalWidth > 0) {
        // Width-fit: draw entire image filling frame width, height proportional
        c.drawImage(el, fX, y, fW, frameH)
        applyFilmLook(c, fX, y, fW, frameH)
      } else {
        c.fillStyle = '#0e0b07'; c.fillRect(fX, y, fW, frameH)
      }
      if (!full) {
        // frame number decoration
        c.save(); c.font = '11px monospace'; c.fillStyle = 'rgba(255,200,100,0.28)'
        c.textAlign = 'right'; c.textBaseline = 'bottom'
        c.fillText(String(i + 1).padStart(4, '0'), fX + fW - 6, y + frameH - 4)
        c.strokeStyle = 'rgba(255,200,100,0.14)'; c.lineWidth = 0.8
        c.beginPath(); c.arc(fX + 9, y + 9, 3, 0, Math.PI * 2); c.stroke()
        c.beginPath(); c.moveTo(fX + 15, y + 9); c.lineTo(fX + 36, y + 9); c.stroke()
        c.restore()
      }
    }
  }

  function drawVideoColumn(c: CanvasRenderingContext2D, colX: number, col: FilmColumnData, _scrollY: number) {
    const frX = colX + FR_X_LOCAL
    c.fillStyle = '#0a0908'; c.fillRect(colX, 0, COL_W, FILM_H)
    const el = videoEls.get(col.id)
    if (el && el.readyState >= 2 && el.videoWidth > 0) {
      coverDraw(c, el, el.videoWidth, el.videoHeight, frX, 0, FR_W, FILM_H)
      applyFilmLook(c, frX, 0, FR_W, FILM_H)
    } else {
      c.fillStyle = '#0e0b07'; c.fillRect(frX, 0, FR_W, FILM_H)
      c.save(); c.font = '13px monospace'; c.fillStyle = 'rgba(255,200,100,0.22)'
      c.textAlign = 'center'; c.textBaseline = 'middle'
      c.fillText(col.videoStartTime > 0 ? '' : '拖入视频', frX + FR_W / 2, FILM_H / 2)
      c.restore()
    }
    // subtle scan line for video identity
    c.save(); c.globalAlpha = 0.04
    for (let y = 0; y < FILM_H; y += 4) {
      c.fillStyle = '#000'; c.fillRect(frX, y, FR_W, 1)
    }
    c.restore()
  }

  function drawEffects(c: CanvasRenderingContext2D, W: number, opts: {
    grain: boolean; vintage: boolean; scratches: boolean; beatStrength: number
  }) {
    if (opts.vintage) {
      const vg = c.createRadialGradient(W/2, FILM_H/2, W*0.18, W/2, FILM_H/2, W*0.78)
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.40)')
      c.fillStyle = vg; c.fillRect(0, 0, W, FILM_H)
      c.save(); c.globalAlpha = 0.07; c.fillStyle = 'rgb(150,95,25)'
      c.fillRect(0, 0, W, FILM_H * 0.13); c.fillRect(0, FILM_H * 0.87, W, FILM_H * 0.13)
      c.restore()
    }
    if (opts.grain) {
      c.save(); c.globalAlpha = 0.055
      const gc = getGrain()
      const ox = (Math.random() * 8 | 0) - 4
      const oy = (Math.random() * 8 | 0) - 4
      for (let tx = 0; tx * COL_W < W + COL_W; tx++) c.drawImage(gc, tx * COL_W + ox, oy)
      c.restore()
    }
    if (opts.scratches && Math.random() < 0.85) {
      c.save(); c.globalAlpha = 0.025 + Math.random() * 0.04
      c.strokeStyle = '#fff'; c.lineWidth = Math.random() < 0.2 ? 1.5 : 0.7
      const sx = Math.random() * W
      const sy = Math.random() < 0.4 ? 0 : Math.random() * FILM_H * 0.3
      const ey = Math.random() < 0.4 ? FILM_H : FILM_H * (0.5 + Math.random() * 0.5)
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx, ey); c.stroke(); c.restore()
    }
    if (opts.beatStrength > 0) {
      c.save(); c.globalAlpha = opts.beatStrength * 0.24
      const fg = c.createRadialGradient(W/2, FILM_H*0.44, 0, W/2, FILM_H*0.44, W)
      fg.addColorStop(0, 'rgba(255,248,225,1)'); fg.addColorStop(1, 'rgba(255,248,225,0)')
      c.fillStyle = fg; c.fillRect(0, 0, W, FILM_H); c.restore()
    }
  }

  // ── Main render ──────────────────────────────────────────────────────────────
  function renderFrame(
    scrollOffsets: number[],
    opts: { grain: boolean; vintage: boolean; scratches: boolean; beatStrength: number },
  ) {
    const c = getCtx(); if (!c) return
    const colCount = colCountRef.value
    const W        = colCount * COL_W
    c.fillStyle = '#0a0908'; c.fillRect(0, 0, W, FILM_H)
    for (let i = 0; i < colCount; i++) {
      const col  = columnsRef.value[i]
      const colX = i * COL_W
      if (!col) continue
      if (col.type === 'images') drawImagesColumn(c, colX, col, scrollOffsets[i])
      else                       drawVideoColumn(c,  colX, col, scrollOffsets[i])
      if (i === colCount - 1) drawSprockets(c, colX, scrollOffsets[i], true, true)
    }
    drawEffects(c, W, opts)
  }

  // ── Export ───────────────────────────────────────────────────────────────────
  async function exportVideo(
    audioEl:    HTMLAudioElement | null,
    pxPerSec:   number,
    opts:       { grain: boolean; vintage: boolean; scratches: boolean },
    onProgress?: (p: number) => void,
  ): Promise<Blob> {
    const canvas = canvasRef.value; if (!canvas) throw new Error('no canvas')
    const colCount = colCountRef.value
    const cols     = columnsRef.value.slice(0, colCount)

    // determine recording duration
    const imgMaxHeight = cols
      .filter(c => c.type === 'images')
      .reduce((m, c) => Math.max(m, colTotalHeight(c)), 0)
    const durationSec = imgMaxHeight > 0
      ? imgMaxHeight / pxPerSec + 0.8
      : (audioEl ? audioEl.duration + 0.5 : 30)
    const FPS         = 30
    const totalFrames = Math.ceil(durationSec * FPS)
    const stream      = canvas.captureStream(FPS)

    if (audioEl) {
      try {
        const actx = new AudioContext()
        const src  = actx.createMediaElementSource(audioEl)
        const dest = actx.createMediaStreamDestination()
        src.connect(dest); src.connect(actx.destination)
        dest.stream.getAudioTracks().forEach(t => stream.addTrack(t))
      } catch { /* ok */ }
    }

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : 'video/webm'

    return new Promise<Blob>((resolve, reject) => {
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 })
      const chunks: Blob[] = []
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop  = () => resolve(new Blob(chunks, { type: 'video/webm' }))
      recorder.onerror = e => reject(e)
      recorder.start()

      if (audioEl) { audioEl.currentTime = 0; audioEl.play().catch(() => {}) }
      for (const col of cols) {
        if (col.type === 'video') {
          const el = videoEls.get(col.id)
          if (el) { el.currentTime = col.videoStartTime; el.play().catch(() => {}) }
        }
      }

      let f = 0
      function tick() {
        if (f >= totalFrames) {
          audioEl?.pause()
          cols.forEach(col => { if (col.type === 'video') videoEls.get(col.id)?.pause() })
          recorder.stop(); return
        }
        const t = f / FPS
        const offsets = cols.map((col) => {
          if (col.type !== 'images') return t * pxPerSec
          return Math.min(t * pxPerSec, colTotalHeight(col))
        })
        renderFrame(offsets, { ...opts, beatStrength: 0 })
        onProgress?.(f / totalFrames)
        f++
        setTimeout(tick, 1000 / FPS)
      }
      tick()
    })
  }

  return {
    colTotalHeight,
    getFramePositions,
    preloadColumnImages,
    removeColumnImage,
    loadColumnVideo,
    clearColumnVideo,
    getVideoEl,
    renderFrame,
    exportVideo,
  }
}
