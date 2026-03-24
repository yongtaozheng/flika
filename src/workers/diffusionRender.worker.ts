/**
 * 扩散着色渲染 WebWorker
 *
 * 负责 CPU 密集的逐像素渲染计算，将结果通过 Transferable 零拷贝传回主线程。
 * 主线程只需 putImageData + MediaRecorder，保持 UI 流畅。
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope
export {} // ensure this is treated as a module

import {
  renderFramePure,
  type PrecomputedImageData,
  type DiffusionConfigPure,
  type BeatPure,
  type RenderContext,
} from '../utils/diffusionRenderer'

/* ── Message Types ───────────────────────────────────────────────────── */

/** Main → Worker 消息 */
interface InitMessage {
  type: 'init'
  images: {
    id: string
    originalData: ArrayBuffer
    grayscaleData: ArrayBuffer
    distanceField: ArrayBuffer
    cosAngle: ArrayBuffer
    sinAngle: ArrayBuffer
    maxDist: number
    width: number
    height: number
    points: { x: number; y: number }[]
    spreadDuration: number
    pauseDuration: number
  }[]
  config: DiffusionConfigPure
  beats: BeatPure[]
  width: number
  height: number
  totalFrames: number
  frameDurationMs: number
  step: number
}

interface RenderBatchMessage {
  type: 'render-batch'
  startFrame: number
  endFrame: number
}

interface AckMessage {
  type: 'ack'
}

interface CancelMessage {
  type: 'cancel'
}

type WorkerInMessage = InitMessage | RenderBatchMessage | AckMessage | CancelMessage

/* ── Worker State ────────────────────────────────────────────────────── */

let renderCtx: RenderContext | null = null
let frameDurationMs = 1000 / 30
let step = 1
let cancelled = false
let pendingFrames = 0
const MAX_PENDING = 10  // 背压：最多缓冲 10 帧 ≈ 35 MB

/* ── Message Handler ─────────────────────────────────────────────────── */

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data
  switch (msg.type) {
    case 'init':
      handleInit(msg)
      break
    case 'render-batch':
      cancelled = false
      pendingFrames = 0
      handleRenderBatch(msg.startFrame, msg.endFrame)
      break
    case 'ack':
      pendingFrames--
      break
    case 'cancel':
      cancelled = true
      break
  }
}

/* ── Init: 接收 transferred 数据，重建类型化数组 ────────────────────── */
function handleInit(msg: InitMessage) {
  const images: PrecomputedImageData[] = msg.images.map((img) => ({
    id: img.id,
    originalData: new Uint8ClampedArray(img.originalData),
    grayscaleData: new Uint8ClampedArray(img.grayscaleData),
    distanceField: new Float32Array(img.distanceField),
    cosAngle: new Float32Array(img.cosAngle),
    sinAngle: new Float32Array(img.sinAngle),
    maxDist: img.maxDist,
    width: img.width,
    height: img.height,
    points: img.points,
    spreadDuration: img.spreadDuration,
    pauseDuration: img.pauseDuration,
  }))

  renderCtx = {
    images,
    config: msg.config,
    beats: msg.beats,
    width: msg.width,
    height: msg.height,
  }
  frameDurationMs = msg.frameDurationMs
  step = msg.step

  self.postMessage({ type: 'ready' })
}

/* ── Batch render with backpressure ──────────────────────────────────── */
async function handleRenderBatch(startFrame: number, endFrame: number) {
  if (!renderCtx) {
    self.postMessage({ type: 'error', message: 'Worker not initialized' })
    return
  }

  const total = endFrame - startFrame

  for (let i = startFrame; i < endFrame; i++) {
    if (cancelled) {
      self.postMessage({ type: 'cancelled' })
      return
    }

    // 背压：如果 pending 帧太多，等主线程消费
    while (pendingFrames >= MAX_PENDING) {
      if (cancelled) {
        self.postMessage({ type: 'cancelled' })
        return
      }
      await sleep(5)
    }

    const timeMs = i * frameDurationMs
    const result = renderFramePure(renderCtx, timeMs, step)

    // Transfer buffer 零拷贝传回主线程
    const transferBuffer = result.buffer.buffer
    self.postMessage(
      {
        type: 'frame-ready',
        frameIndex: i,
        buffer: transferBuffer,
        width: renderCtx.width,
        height: renderCtx.height,
        // 高光环所需信息
        imageIndex: result.imageIndex,
        currentRadius: result.currentRadius,
        spreadProgress: result.spreadProgress,
        rippleActive: result.rippleActive,
        animFade: result.animFade,
      },
      [transferBuffer],
    )
    pendingFrames++

    // 每 10 帧发送进度
    if ((i - startFrame) % 10 === 0 || i === endFrame - 1) {
      self.postMessage({ type: 'progress', rendered: i - startFrame + 1, total })
    }
  }

  self.postMessage({ type: 'done' })
}

/* ── Helper ──────────────────────────────────────────────────────────── */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
