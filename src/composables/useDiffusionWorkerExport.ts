/**
 * WebWorker 导出视频协调器
 *
 * 负责：
 * 1. 创建 Worker 并传输预计算数据（Transferable 零拷贝）
 * 2. 接收 Worker 渲染的帧 buffer
 * 3. 将帧 putImageData 到 Canvas 上供 MediaRecorder 录制
 * 4. 管理 MediaRecorder 生命周期
 * 5. 支持取消导出
 */

import type { PrecomputedImageData, DiffusionConfigPure, BeatPure } from '../utils/diffusionRenderer'
import { WAVE_COUNT, WAVE_WIDTH, isBeatMode as _isBeatMode, resolveImageAtTime as _resolveImageAtTime } from '../utils/diffusionRenderer'
import DiffusionRenderWorker from '../workers/diffusionRender.worker?worker'

/* ── Types ───────────────────────────────────────────────────────────── */

/** Worker 返回的帧数据 */
interface FrameReadyMessage {
  type: 'frame-ready'
  frameIndex: number
  buffer: ArrayBuffer
  width: number
  height: number
  imageIndex: number
  currentRadius: number
  spreadProgress: number
  rippleActive: boolean
  animFade: number
}

interface ExportOptions {
  canvas: HTMLCanvasElement
  images: PrecomputedImageData[]
  config: DiffusionConfigPure
  beats: BeatPure[]
  totalDurationMs: number
  fps: number
  /** 导出使用的像素采样步长（默认 1 = 全质量） */
  step?: number
  onProgress?: (p: number) => void
  /** 音频元素（有音频时传入） */
  audioElement?: HTMLAudioElement | null
  /** 是否踩点模式 */
  isBeatMode?: boolean
}

export interface WorkerExportHandle {
  /** 开始导出，返回视频 Blob */
  start: () => Promise<Blob>
  /** 取消导出 */
  cancel: () => void
}

/* ── 高光环绘制（主线程 Canvas API）────────────────────────────────── */
function drawHighlightRings(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  width: number,
  height: number,
  currentRadius: number,
  animFade: number,
) {
  if (points.length === 0 || currentRadius <= 4) return
  ctx.save()
  ctx.globalAlpha = 0.25 * animFade
  for (const pt of points) {
    const cx = pt.x * width
    const cy = pt.y * height
    for (let w = 0; w < WAVE_COUNT; w++) {
      const ringRadius = currentRadius - w * WAVE_WIDTH
      if (ringRadius > 0) {
        ctx.beginPath()
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(150, 200, 255, ${0.3 - w * 0.08})`
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }
  }
  ctx.restore()
}

/* ── Bouncing ball constants (mirror from useDiffusionEngine) ─────── */
const BOUNCE_DURATION = 500
const BALL_RADIUS = 12
const BOUNCE_HEIGHT_RATIO = 0.40
const BOUNCE_HEIGHT_MIN = 0.10
const LANDING_RIPPLE_DURATION = 400
const LANDING_RIPPLE_MAX_R = 40

interface ExportBallState {
  prevImageIndex: number
  fromX: number; fromY: number
  toX: number; toY: number
  bounceStartMs: number
  bounceDuration: number
  isBouncing: boolean
  landingRippleStart: number
  landingX: number; landingY: number
  bounceTriggerImage: number
}

function getFirstPointFromImages(
  images: PrecomputedImageData[],
  index: number,
): { x: number; y: number } {
  const img = images[index]
  if (img && img.points.length > 0) return { x: img.points[0].x, y: img.points[0].y }
  return { x: 0.5, y: 0.5 }
}

/** 导出时绘制弹跳小球 */
function drawBouncingBallExport(
  ctx: CanvasRenderingContext2D,
  ball: ExportBallState,
  elapsedMs: number,
  imageIndex: number,
  imageTime: number,
  slotDuration: number,
  images: PrecomputedImageData[],
  cfgLoop: boolean,
  width: number,
  height: number,
): void {
  const isLast = imageIndex === images.length - 1
  const hasNext = cfgLoop || !isLast

  // 计算距离切换的剩余时间
  const timeUntilSwitch = slotDuration - imageTime
  const actualBounceDur = Math.max(200, Math.min(BOUNCE_DURATION, slotDuration * 0.6))

  if (timeUntilSwitch <= actualBounceDur && timeUntilSwitch > 0
      && hasNext && ball.bounceTriggerImage !== imageIndex) {
    const nextIdx = (imageIndex + 1) % images.length
    const fromPt = getFirstPointFromImages(images, imageIndex)
    const toPt = getFirstPointFromImages(images, nextIdx)
    ball.fromX = fromPt.x; ball.fromY = fromPt.y
    ball.toX = toPt.x; ball.toY = toPt.y
    ball.bounceStartMs = elapsedMs
    ball.bounceDuration = actualBounceDur
    ball.isBouncing = true
    ball.landingRippleStart = -1
    ball.bounceTriggerImage = imageIndex
  }

  // 图片切换后重置触发标记
  if (imageIndex !== ball.prevImageIndex && ball.prevImageIndex >= 0) {
    ball.bounceTriggerImage = -1
  }
  ball.prevImageIndex = imageIndex

  const restPt = getFirstPointFromImages(images, imageIndex)
  let bx: number, by: number
  let scaleX = 1, scaleY = 1

  if (ball.isBouncing) {
    const raw = (elapsedMs - ball.bounceStartMs) / ball.bounceDuration
    const t = Math.max(0, Math.min(1, raw))
    bx = ball.fromX + (ball.toX - ball.fromX) * t
    by = ball.fromY + (ball.toY - ball.fromY) * t
    const dx = ball.toX - ball.fromX
    const dy = ball.toY - ball.fromY
    const dist = Math.sqrt(dx * dx + dy * dy)
    const bounceH = Math.max(BOUNCE_HEIGHT_MIN, dist * BOUNCE_HEIGHT_RATIO)
    by += -bounceH * 4 * t * (1 - t)

    if (t < 0.15) {
      const s = t / 0.15; scaleX = 1 + 0.2 * (1 - s); scaleY = 1 - 0.2 * (1 - s)
    } else if (t > 0.85) {
      const s = (t - 0.85) / 0.15; scaleX = 1 + 0.2 * s; scaleY = 1 - 0.2 * s
    } else {
      const speed = Math.abs(2 * t - 1)
      scaleX = 1 - 0.15 * (1 - speed); scaleY = 1 + 0.15 * (1 - speed)
    }

    if (raw >= 1) {
      ball.isBouncing = false
      ball.landingRippleStart = elapsedMs
      ball.landingX = ball.toX * width; ball.landingY = ball.toY * height
    }
  } else {
    if (ball.bounceTriggerImage >= 0) {
      bx = ball.toX; by = ball.toY
    } else {
      bx = restPt.x; by = restPt.y
    }
    by += Math.sin(elapsedMs / 600) * 0.003
  }

  const px = bx * width, py = by * height

  // 落地波纹
  if (ball.landingRippleStart >= 0) {
    const rt = (elapsedMs - ball.landingRippleStart) / LANDING_RIPPLE_DURATION
    if (rt >= 0 && rt < 1) {
      const rippleR = BALL_RADIUS + (LANDING_RIPPLE_MAX_R - BALL_RADIUS) * rt
      ctx.save()
      ctx.beginPath()
      ctx.arc(ball.landingX, ball.landingY, rippleR, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(120, 180, 255, ${0.5 * (1 - rt)})`
      ctx.lineWidth = 2 * (1 - rt)
      ctx.stroke()
      ctx.restore()
    } else if (rt >= 1) { ball.landingRippleStart = -1 }
  }

  // 小球本体
  ctx.save()
  ctx.translate(px, py)
  ctx.scale(scaleX, scaleY)
  ctx.shadowColor = 'rgba(100, 160, 255, 0.6)'
  ctx.shadowBlur = 16
  const grad = ctx.createRadialGradient(0, -2, 0, 0, 0, BALL_RADIUS)
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)')
  grad.addColorStop(0.4, 'rgba(180, 210, 255, 0.85)')
  grad.addColorStop(1, 'rgba(100, 160, 255, 0.6)')
  ctx.beginPath()
  ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.beginPath()
  ctx.arc(-3, -4, 3, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.fill()
  ctx.restore()
}

/* ── 创建 Worker 导出器 ──────────────────────────────────────────────── */
export function createWorkerExport(options: ExportOptions): WorkerExportHandle {
  const {
    canvas,
    images,
    config,
    beats,
    totalDurationMs,
    fps,
    step = 1,
    onProgress,
    audioElement,
    isBeatMode: beatMode = false,
  } = options

  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  const FRAME_MS = 1000 / fps
  const totalFrames = Math.ceil(totalDurationMs / FRAME_MS)

  let worker: Worker | null = null
  let cancelled = false

  // Bouncing ball state for export
  const exportBall: ExportBallState = {
    prevImageIndex: -1,
    fromX: 0.5, fromY: 0.5,
    toX: 0.5, toY: 0.5,
    bounceStartMs: 0,
    bounceDuration: BOUNCE_DURATION,
    isBouncing: false,
    landingRippleStart: -1,
    landingX: 0, landingY: 0,
    bounceTriggerImage: -1,
  }

  function cancel() {
    cancelled = true
    if (worker) {
      worker.postMessage({ type: 'cancel' })
      worker.terminate()
      worker = null
    }
  }

  async function start(): Promise<Blob> {
    // ── 创建 Worker（Vite ?worker 导入，dev/prod 均可靠） ──
    worker = new DiffusionRenderWorker()

    // ── 准备传输数据 ──
    // Clone 所有 ArrayBuffer 以保留主线程的预计算数据用于后续预览
    const transferList: ArrayBuffer[] = []
    const imagePayloads = images.map((img) => {
      const origBuf = img.originalData.buffer.slice(0)
      const grayBuf = img.grayscaleData.buffer.slice(0)
      const distBuf = img.distanceField.buffer.slice(0)
      const cosBuf = img.cosAngle.buffer.slice(0)
      const sinBuf = img.sinAngle.buffer.slice(0)
      transferList.push(origBuf, grayBuf, distBuf, cosBuf, sinBuf)
      return {
        id: img.id,
        originalData: origBuf,
        grayscaleData: grayBuf,
        distanceField: distBuf,
        cosAngle: cosBuf,
        sinAngle: sinBuf,
        maxDist: img.maxDist,
        width: img.width,
        height: img.height,
        points: img.points,
        spreadDuration: img.spreadDuration,
        pauseDuration: img.pauseDuration,
      }
    })

    // ── 等待 Worker 初始化完成 ──
    await new Promise<void>((resolve, reject) => {
      if (!worker) { reject(new Error('Worker not created')); return }
      const w = worker
      w.onmessage = (e) => {
        if (e.data.type === 'ready') resolve()
        else if (e.data.type === 'error') reject(new Error(e.data.message))
      }
      w.onerror = (e) => reject(new Error(e.message))
      w.postMessage(
        {
          type: 'init',
          images: imagePayloads,
          config,
          beats,
          width,
          height,
          totalFrames,
          frameDurationMs: FRAME_MS,
          step,
        },
        transferList,
      )
    })

    if (cancelled) throw new Error('Export cancelled')

    // ── 选择导出策略 ──
    const hasAudio = !!(audioElement && beatMode)
    if (hasAudio) {
      return exportWithAudio(audioElement!)
    }
    return exportWithoutAudio()
  }

  /* ── 无音频导出：流水线模式 ─────────────────────────────────────────
   * Worker 自驱动渲染所有帧，主线程消费帧队列并实时回放给 MediaRecorder。
   * 使用 chunked 方式：每 chunk 录制一段。
   */
  async function exportWithoutAudio(): Promise<Blob> {
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'

    const videoStream = canvas.captureStream(fps)
    const recorder = new MediaRecorder(videoStream, {
      mimeType,
      videoBitsPerSecond: 12_000_000,
    })

    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }

    // 帧队列：Worker 产出帧 → 主线程消费
    const frameQueue: FrameReadyMessage[] = []
    let workerDone = false
    let workerError: string | null = null
    let wakeConsumer: (() => void) | null = null

    const w = worker!
    w.onmessage = (e) => {
      const msg = e.data
      switch (msg.type) {
        case 'frame-ready':
          frameQueue.push(msg as FrameReadyMessage)
          wakeConsumer?.()
          break
        case 'progress':
          onProgress?.(msg.rendered / msg.total)
          break
        case 'done':
          workerDone = true
          wakeConsumer?.()
          break
        case 'cancelled':
          workerDone = true
          wakeConsumer?.()
          break
        case 'error':
          workerError = msg.message
          workerDone = true
          wakeConsumer?.()
          break
      }
    }

    // 请求 Worker 渲染所有帧
    w.postMessage({ type: 'render-batch', startFrame: 0, endFrame: totalFrames })

    // 等待下一帧可用
    function waitForFrame(): Promise<void> {
      if (frameQueue.length > 0 || workerDone) return Promise.resolve()
      return new Promise((resolve) => { wakeConsumer = resolve })
    }

    // ── 分块回放录制 ──
    const CHUNK = fps  // 每 chunk = 1 秒
    recorder.start()
    recorder.pause()

    let frameIdx = 0
    while (frameIdx < totalFrames) {
      if (cancelled) break
      if (workerError) throw new Error(workerError)

      const chunkEnd = Math.min(frameIdx + CHUNK, totalFrames)
      const chunkFrames: FrameReadyMessage[] = []

      // Phase A: 收集一个 chunk 的帧
      while (chunkFrames.length < chunkEnd - frameIdx) {
        if (cancelled) break
        await waitForFrame()
        if (workerError) throw new Error(workerError)

        while (frameQueue.length > 0 && chunkFrames.length < chunkEnd - frameIdx) {
          const frame = frameQueue.shift()!
          chunkFrames.push(frame)
          // 发送 ack 释放背压
          w.postMessage({ type: 'ack' })
        }

        // 如果 Worker 已完成且队列空了，跳出
        if (workerDone && frameQueue.length === 0 && chunkFrames.length < chunkEnd - frameIdx) {
          break
        }
      }

      if (chunkFrames.length === 0) break

      // Phase B: 实时回放 chunk（recorder active）
      recorder.resume()
      const playStart = performance.now()
      for (let i = 0; i < chunkFrames.length; i++) {
        if (cancelled) break
        const frame = chunkFrames[i]
        const imgData = new ImageData(
          new Uint8ClampedArray(frame.buffer),
          frame.width,
          frame.height,
        )
        ctx.putImageData(imgData, 0, 0)

        // 叠加高光环
        if (frame.rippleActive && frame.currentRadius > 4) {
          const imgInfo = images[frame.imageIndex]
          if (imgInfo) {
            drawHighlightRings(ctx, imgInfo.points, width, height, frame.currentRadius, frame.animFade)
          }
        }

        // 叠加弹跳小球
        if (config.bouncingBallEnabled && images.length > 1) {
          const frameMs = frame.frameIndex * FRAME_MS
          const rctx = { images, config, beats, width, height }
          const beat = _isBeatMode(config, beats)
          const effectiveMs = config.loop ? frameMs % totalDurationMs : Math.min(frameMs, totalDurationMs - 1)
          const slot = _resolveImageAtTime(rctx, effectiveMs)
          const slotDur = beat
            ? slot.effectiveSpreadDuration
            : (images[slot.imageIndex].spreadDuration + images[slot.imageIndex].pauseDuration)
          drawBouncingBallExport(ctx, exportBall, frameMs, frame.imageIndex, slot.imageTime, slotDur, images, config.loop, width, height)
        }

        const nextTarget = playStart + (i + 1) * FRAME_MS
        const delay = Math.max(1, nextTarget - performance.now())
        await sleep(delay)
      }
      recorder.pause()

      frameIdx += chunkFrames.length
      onProgress?.(frameIdx / totalFrames)
    }

    // ── 完成录制 ──
    recorder.resume()
    await sleep(100)

    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onerror = reject
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }))
      recorder.stop()
    })

    // 清理 Worker
    if (worker) { worker.terminate(); worker = null }

    return blob
  }

  /* ── 有音频导出：音频驱动时钟 ──────────────────────────────────────
   * 音频按正常速度播放 → MediaRecorder 按真实时间录制。
   * Worker 提前渲染帧缓冲，主线程取最新帧 putImageData。
   */
  async function exportWithAudio(audioEl: HTMLAudioElement): Promise<Blob> {
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm'

    // 创建独立的 audio 元素用于导出，避免 createMediaElementSource 永久接管预览用的 audio 元素
    const exportAudio = new Audio(audioEl.src)
    exportAudio.preload = 'auto'
    await new Promise<void>((resolve) => {
      exportAudio.addEventListener('canplaythrough', () => resolve(), { once: true })
      exportAudio.addEventListener('error', () => resolve(), { once: true })
      exportAudio.load()
    })

    const videoStream = canvas.captureStream(fps)
    let combinedStream: MediaStream = videoStream
    let audioCtx: AudioContext | null = null

    try {
      audioCtx = new AudioContext()
      const source = audioCtx.createMediaElementSource(exportAudio)
      const dest = audioCtx.createMediaStreamDestination()
      source.connect(dest)
      source.connect(audioCtx.destination)
      combinedStream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ])
    } catch {
      combinedStream = videoStream
    }

    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: 12_000_000,
    })

    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }

    // 帧缓冲：存最新的帧
    let latestFrame: FrameReadyMessage | null = null

    const w = worker!
    w.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'frame-ready') {
        latestFrame = msg as FrameReadyMessage
        w.postMessage({ type: 'ack' })
      }
    }

    // Worker 渲染所有帧
    w.postMessage({ type: 'render-batch', startFrame: 0, endFrame: totalFrames })

    // 音频驱动
    exportAudio.currentTime = 0
    await exportAudio.play().catch(() => {})
    recorder.start()

    const totalSec = totalDurationMs / 1000

    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onerror = reject
      recorder.onstop = () => {
        exportAudio.pause()
        exportAudio.src = ''
        if (audioCtx) audioCtx.close().catch(() => {})
        resolve(new Blob(chunks, { type: 'video/webm' }))
      }

      function tick() {
        if (cancelled) {
          recorder.stop()
          return
        }
        const t = exportAudio.currentTime
        if (t >= totalSec) {
          recorder.stop()
          return
        }

        // 使用最新的帧
        if (latestFrame) {
          const imgData = new ImageData(
            new Uint8ClampedArray(latestFrame.buffer),
            latestFrame.width,
            latestFrame.height,
          )
          ctx.putImageData(imgData, 0, 0)

          // 叠加高光环
          if (latestFrame.rippleActive && latestFrame.currentRadius > 4) {
            const imgInfo = images[latestFrame.imageIndex]
            if (imgInfo) {
              drawHighlightRings(ctx, imgInfo.points, width, height, latestFrame.currentRadius, latestFrame.animFade)
            }
          }

          // 叠加弹跳小球
          if (config.bouncingBallEnabled && images.length > 1) {
            const frameMs = t * 1000
            const rctx = { images, config, beats, width, height }
            const beat = _isBeatMode(config, beats)
            const effectiveMs = config.loop ? frameMs % totalDurationMs : Math.min(frameMs, totalDurationMs - 1)
            const slot = _resolveImageAtTime(rctx, effectiveMs)
            const slotDur = beat
              ? slot.effectiveSpreadDuration
              : (images[slot.imageIndex].spreadDuration + images[slot.imageIndex].pauseDuration)
            drawBouncingBallExport(ctx, exportBall, frameMs, latestFrame.imageIndex, slot.imageTime, slotDur, images, config.loop, width, height)
          }
        }

        onProgress?.(t / totalSec)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })

    if (worker) { worker.terminate(); worker = null }
    return blob
  }

  return { start, cancel }
}

/* ── Helper ──────────────────────────────────────────────────────────── */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
