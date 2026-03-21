import { ref, type Ref } from 'vue'
import type { IntroConfig, IntroAnimation, IntroTextLayer, IntroImageLayer } from '../types'

/**
 * 开场动画渲染引擎 composable
 */
export function useIntroEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  config: Ref<IntroConfig>,
) {
  const isRendering = ref(false)
  const logoImage = ref<HTMLImageElement | null>(null)
  const bgMedia = ref<HTMLImageElement | HTMLVideoElement | null>(null)

  // offscreen canvas reused for textReveal compositing
  let offscreenCache: HTMLCanvasElement | null = null

  function getOffscreen(w: number, h: number): CanvasRenderingContext2D {
    if (!offscreenCache || offscreenCache.width !== w || offscreenCache.height !== h) {
      offscreenCache = document.createElement('canvas')
      offscreenCache.width = w
      offscreenCache.height = h
    }
    const ctx = offscreenCache.getContext('2d')!
    // Must reset composite op BEFORE clearRect — destination-in persists across frames
    // and would cause subsequent fill/drawImage calls to draw nothing (canvas is empty).
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, w, h)
    return ctx
  }

  // --- easing ---
  function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3)
  }

  // smooth ease-in-out for cinematic reveals
  function easeInOutSine(t: number): number {
    return -(Math.cos(Math.PI * t) - 1) / 2
  }

  /**
   * 计算图层的动画进度 (0-1)，已应用 easing
   */
  function getLayerProgress(delay: number, animDuration: number, time: number): number {
    if (animDuration <= 0) return 1
    const elapsed = time - delay
    if (elapsed <= 0) return 0
    if (elapsed >= animDuration) return 1
    return easeOutCubic(elapsed / animDuration)
  }

  /**
   * 加载 Logo 图片到内存
   */
  async function loadLogoImage(file: File): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        logoImage.value = img
        resolve()
      }
      img.onerror = () => resolve()
      img.src = url
    })
  }

  /**
   * 清除 logo
   */
  function clearLogo() {
    logoImage.value = null
  }

  /**
   * 加载背景图片或视频
   */
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
        vid.loop = false
        vid.muted = true
        vid.onloadeddata = () => { bgMedia.value = vid; resolve() }
        vid.onerror = () => resolve()
        vid.src = url
      })
    }
  }

  /**
   * 清除背景媒体
   */
  function clearBgMedia() {
    if (bgMedia.value instanceof HTMLVideoElement) {
      bgMedia.value.pause()
    }
    bgMedia.value = null
  }

  /**
   * 预览时将背景视频跳转到指定时间
   */
  function seekBgVideo(t: number) {
    if (bgMedia.value instanceof HTMLVideoElement) {
      bgMedia.value.currentTime = t
    }
  }

  /**
   * 绘制背景媒体（cover 模式填满画布）
   */
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
      drawH = height
      drawW = height * srcRatio
      dx = (width - drawW) / 2
      dy = 0
    } else {
      drawW = width
      drawH = width / srcRatio
      dx = 0
      dy = (height - drawH) / 2
    }
    ctx.drawImage(source, dx, dy, drawW, drawH)
  }

  /**
   * 绘制文字图层（带动画）
   * revealSource: textReveal 动画的填充来源（视频或图片）
   */
  function drawTextLayer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    layer: IntroTextLayer,
    time: number,
    overrideDelay?: number,
    revealSource?: HTMLImageElement | HTMLVideoElement | null,
  ) {
    const delay = overrideDelay !== undefined ? overrideDelay : layer.delay
    const p = getLayerProgress(delay, layer.animDuration, time)
    if (p <= 0 && layer.animation !== 'none') return

    const cx = layer.x * width
    const cy = layer.y * height

    ctx.save()
    ctx.font = `${layer.fontWeight} ${layer.fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = layer.color

    const anim: IntroAnimation = layer.animation

    switch (anim) {
      case 'none':
        ctx.globalAlpha = 1
        ctx.fillText(layer.text, cx, cy)
        break

      case 'fadeIn':
        ctx.globalAlpha = p
        ctx.fillText(layer.text, cx, cy)
        break

      case 'slideUp': {
        const offset = (1 - p) * 60
        ctx.globalAlpha = p
        ctx.fillText(layer.text, cx, cy + offset)
        break
      }

      case 'slideDown': {
        const offset = (1 - p) * -60
        ctx.globalAlpha = p
        ctx.fillText(layer.text, cx, cy + offset)
        break
      }

      case 'slideLeft': {
        const offset = (1 - p) * 100
        ctx.globalAlpha = p
        ctx.fillText(layer.text, cx + offset, cy)
        break
      }

      case 'zoomIn': {
        const scale = 0.4 + 0.6 * p
        ctx.globalAlpha = p
        ctx.translate(cx, cy)
        ctx.scale(scale, scale)
        ctx.fillText(layer.text, 0, 0)
        break
      }

      case 'typewriter': {
        const visibleChars = Math.floor(p * layer.text.length)
        const visibleText = layer.text.slice(0, visibleChars)
        ctx.globalAlpha = 1
        ctx.fillText(visibleText, cx, cy)
        // blinking cursor
        if (p < 1) {
          const textWidth = ctx.measureText(visibleText).width
          const cursorVisible = Math.floor(time * 2) % 2 === 0
          if (cursorVisible) {
            ctx.fillRect(cx + textWidth / 2, cy - layer.fontSize * 0.5, 2, layer.fontSize)
          }
        }
        break
      }

      case 'glitch': {
        // RGB draw calls + alpha flicker
        const flicker = p > 0.5 ? 1 : (Math.random() > 0.3 ? 1 : 0.5)
        ctx.globalAlpha = p * flicker
        const glitchOffset = (1 - p) * 8
        // red channel (right)
        ctx.fillStyle = 'rgba(255,50,50,0.7)'
        ctx.fillText(layer.text, cx + glitchOffset, cy - 2)
        // blue channel (left)
        ctx.fillStyle = 'rgba(50,100,255,0.7)'
        ctx.fillText(layer.text, cx - glitchOffset, cy + 2)
        // main
        ctx.fillStyle = layer.color
        ctx.globalAlpha = p
        ctx.fillText(layer.text, cx, cy)
        break
      }

      case 'textReveal': {
        const rawElapsed = time - delay
        const rawT = Math.max(0, Math.min(1, rawElapsed / layer.animDuration))

        // Phase 1 (rawT 0→0.75): text grows from tiny (0.3×) to large (6×), video through cutout
        // Phase 2 (rawT 0.75→1.0): text locked at max scale, full video fades in covering everything
        const SCALE_END = 0.75
        const textT = Math.min(1, rawT / SCALE_END)
        const scale = 0.3 + 5.7 * easeInOutSine(textT)  // 0.3 → 6.0

        const blendT = Math.max(0, (rawT - SCALE_END) / (1 - SCALE_END))  // 0→1 in phase 2
        const blendAlpha = easeInOutSine(blendT)

        // --- Phase 1: draw text-cutout on offscreen ---
        const offCtx = getOffscreen(width, height)

        if (revealSource) {
          drawBgCover(offCtx, width, height, revealSource)
        } else {
          // fallback gradient (still looks good without media)
          const grad = offCtx.createLinearGradient(0, 0, width, height)
          grad.addColorStop(0, '#a898ff')
          grad.addColorStop(0.5, '#c0b0ff')
          grad.addColorStop(1, '#ff5fa0')
          offCtx.fillStyle = grad
          offCtx.fillRect(0, 0, width, height)
        }

        // clip to text shape
        offCtx.globalCompositeOperation = 'destination-in'
        offCtx.font = `${layer.fontWeight} ${layer.fontSize * scale}px sans-serif`
        offCtx.textAlign = 'center'
        offCtx.textBaseline = 'middle'
        offCtx.fillStyle = 'white'

        const lines = layer.text.split('\n')
        const lineH = layer.fontSize * scale * 1.25
        const totalH = lines.length * lineH
        const startY = cy - totalH / 2 + lineH / 2
        for (let i = 0; i < lines.length; i++) {
          offCtx.fillText(lines[i], cx, startY + i * lineH)
        }

        ctx.globalAlpha = 1
        ctx.drawImage(offscreenCache!, 0, 0)

        // --- Phase 2: full video/image fades in on top, burying the text ---
        if (blendAlpha > 0 && revealSource) {
          ctx.save()
          ctx.globalAlpha = blendAlpha
          drawBgCover(ctx, width, height, revealSource)
          ctx.restore()
        }

        break
      }

      default:
        ctx.globalAlpha = 1
        ctx.fillText(layer.text, cx, cy)
    }

    ctx.restore()
  }

  /**
   * 绘制图片图层（带动画）
   */
  function drawImageLayer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    layer: IntroImageLayer,
    imgEl: HTMLImageElement,
    time: number,
  ) {
    const p = getLayerProgress(layer.delay, layer.animDuration, time)
    if (p <= 0 && layer.animation !== 'none') return

    const drawW = layer.size * width
    const imgRatio = imgEl.naturalWidth / imgEl.naturalHeight
    const drawH = drawW / imgRatio
    const cx = layer.x * width
    const cy = layer.y * height

    ctx.save()

    const anim: IntroAnimation = layer.animation

    switch (anim) {
      case 'none':
        ctx.globalAlpha = 1
        ctx.drawImage(imgEl, cx - drawW / 2, cy - drawH / 2, drawW, drawH)
        break

      case 'fadeIn':
        ctx.globalAlpha = p
        ctx.drawImage(imgEl, cx - drawW / 2, cy - drawH / 2, drawW, drawH)
        break

      case 'slideUp': {
        const offset = (1 - p) * 60
        ctx.globalAlpha = p
        ctx.drawImage(imgEl, cx - drawW / 2, cy - drawH / 2 + offset, drawW, drawH)
        break
      }

      case 'slideDown': {
        const offset = (1 - p) * -60
        ctx.globalAlpha = p
        ctx.drawImage(imgEl, cx - drawW / 2, cy - drawH / 2 + offset, drawW, drawH)
        break
      }

      case 'slideLeft': {
        const offset = (1 - p) * 100
        ctx.globalAlpha = p
        ctx.drawImage(imgEl, cx - drawW / 2 + offset, cy - drawH / 2, drawW, drawH)
        break
      }

      case 'zoomIn': {
        const scale = 0.4 + 0.6 * p
        ctx.globalAlpha = p
        ctx.translate(cx, cy)
        ctx.scale(scale, scale)
        ctx.drawImage(imgEl, -drawW / 2, -drawH / 2, drawW, drawH)
        break
      }

      case 'typewriter':
      case 'glitch':
      default:
        ctx.globalAlpha = p
        ctx.drawImage(imgEl, cx - drawW / 2, cy - drawH / 2, drawW, drawH)
    }

    ctx.restore()
  }

  /**
   * 渲染单帧
   * @param time 当前时间 (秒)
   * @param beatSyncDelay 若节拍同步，标题的实际 delay 覆盖值
   */
  function renderFrame(time: number, beatSyncDelay?: number) {
    const canvas = canvasRef.value
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvas
    const cfg = config.value

    // When textReveal is active, bgMedia becomes the fill source for the text cutout.
    // The actual canvas background must stay solid/gradient so the dark surround shows.
    const hasReveal =
      cfg.title.animation === 'textReveal' || cfg.subtitle.animation === 'textReveal'
    const revealSource = hasReveal ? bgMedia.value : null

    // --- background ---
    if (cfg.bgType === 'color' || !bgMedia.value || hasReveal) {
      // solid / gradient
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
      // image / video background (only when textReveal is NOT active)
      ctx.save()
      ctx.globalAlpha = 1
      drawBgCover(ctx, width, height, bgMedia.value)
      if (cfg.bgOverlayOpacity > 0) {
        ctx.globalAlpha = cfg.bgOverlayOpacity
        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, width, height)
      }
      ctx.restore()
    }

    // --- logo ---
    if (logoImage.value) {
      drawImageLayer(ctx, width, height, cfg.logo, logoImage.value, time)
    }

    // --- title ---
    if (cfg.title.text) {
      drawTextLayer(ctx, width, height, cfg.title, time, beatSyncDelay, revealSource)
    }

    // --- subtitle ---
    if (cfg.subtitle.text) {
      drawTextLayer(ctx, width, height, cfg.subtitle, time, undefined, revealSource)
    }
  }

  /**
   * 导出为 WebM Blob，包含前 duration 秒音频
   */
  async function exportIntro(
    audioElement: HTMLAudioElement | null,
    onProgress?: (p: number) => void,
    beatSyncDelay?: number,
  ): Promise<Blob> {
    const canvas = canvasRef.value
    if (!canvas) throw new Error('Canvas 不可用')

    const cfg = config.value
    isRendering.value = true

    try {
      const fps = 30
      const stream = canvas.captureStream(fps)

      let combinedStream: MediaStream

      if (audioElement && audioElement.src) {
        const audioCtx = new AudioContext()
        const source = audioCtx.createMediaElementSource(audioElement)
        const dest = audioCtx.createMediaStreamDestination()
        source.connect(dest)
        source.connect(audioCtx.destination)

        combinedStream = new MediaStream([
          ...stream.getTracks(),
          ...dest.stream.getTracks(),
        ])

        // cleanup after export
        const origStop = audioElement.pause.bind(audioElement)
        combinedStream.addEventListener('inactive', () => {
          source.disconnect()
          audioCtx.close()
          origStop()
        })
      } else {
        combinedStream = stream
      }

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 5000000,
      })

      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      return new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          isRendering.value = false
          resolve(new Blob(chunks, { type: 'video/webm' }))
        }
        recorder.onerror = (e) => {
          isRendering.value = false
          reject(e)
        }

        recorder.start()

        if (audioElement) {
          audioElement.currentTime = 0
          audioElement.play().catch(() => {/* ok */})
        }

        // start bg video from beginning
        if (bgMedia.value instanceof HTMLVideoElement) {
          bgMedia.value.currentTime = 0
          bgMedia.value.play().catch(() => {/* ok */})
        }

        const startReal = performance.now()
        const totalMs = cfg.duration * 1000

        function renderLoop() {
          const elapsed = performance.now() - startReal
          const t = Math.min(elapsed / 1000, cfg.duration)

          renderFrame(t, beatSyncDelay)
          onProgress?.(t / cfg.duration)

          if (elapsed < totalMs) {
            requestAnimationFrame(renderLoop)
          } else {
            audioElement?.pause()
            if (bgMedia.value instanceof HTMLVideoElement) bgMedia.value.pause()
            recorder.stop()
          }
        }

        renderLoop()
      })
    } catch (err) {
      isRendering.value = false
      throw err
    }
  }

  return {
    isRendering,
    logoImage,
    bgMedia,
    loadLogoImage,
    clearLogo,
    loadBgMedia,
    clearBgMedia,
    seekBgVideo,
    renderFrame,
    exportIntro,
  }
}
