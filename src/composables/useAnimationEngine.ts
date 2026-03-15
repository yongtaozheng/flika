import { ref, type Ref } from 'vue'
import type { Beat, AnimationEffect, UploadedImage } from '../types'

/**
 * 动画渲染引擎 composable
 * 基于 Canvas 2D，根据节拍驱动动画效果
 */
export function useAnimationEngine(
  canvasRef: Ref<HTMLCanvasElement | null>,
  images: Ref<UploadedImage[]>,
  beats: Ref<Beat[]>,
  currentTime: Ref<number>,
) {
  const currentImageIndex = ref(0)
  const isRendering = ref(false)

  // 缓存已加载的 HTMLImageElement
  const imageCache = new Map<string, HTMLImageElement>()

  // 当前生效的效果状态
  const activeEffects = ref<Map<AnimationEffect, { startTime: number; strength: number }>>(
    new Map()
  )

  /**
   * 预加载所有图片到缓存
   */
  async function preloadImages() {
    const promises = images.value.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (imageCache.has(img.id)) {
            resolve()
            return
          }
          const el = new Image()
          el.crossOrigin = 'anonymous'
          el.onload = () => {
            imageCache.set(img.id, el)
            resolve()
          }
          el.onerror = () => resolve()
          el.src = img.url
        })
    )
    await Promise.all(promises)
  }

  /**
   * 查找当前时间最近的节拍
   */
  function findCurrentBeat(time: number, effectDuration: number): Beat | null {
    for (const beat of beats.value) {
      const diff = time - beat.time
      if (diff >= 0 && diff < effectDuration / 1000) {
        return beat
      }
    }
    return null
  }

  /**
   * 查找下一个节拍要切换到的图片索引
   */
  function getNextImageIndex(): number {
    if (images.value.length === 0) return 0
    return (currentImageIndex.value + 1) % images.value.length
  }

  /**
   * 更新效果状态
   */
  function updateEffects(
    time: number,
    enabledEffects: AnimationEffect[],
    effectDuration: number
  ) {
    // 检查当前时间是否有节拍
    const beat = findCurrentBeat(time, effectDuration)

    if (beat) {
      for (const effect of enabledEffects) {
        const existing = activeEffects.value.get(effect)
        if (!existing || Math.abs(existing.startTime - beat.time) > 0.01) {
          activeEffects.value.set(effect, {
            startTime: beat.time,
            strength: beat.strength,
          })

          // 如果有切换效果，更新图片索引
          if (effect === 'switch') {
            const lastSwitch = activeEffects.value.get('switch')
            if (lastSwitch && Math.abs(lastSwitch.startTime - beat.time) < 0.01) {
              currentImageIndex.value = getNextImageIndex()
            }
          }
        }
      }
    }

    // 清理过期效果
    for (const [effect, state] of activeEffects.value.entries()) {
      if (time - state.startTime > effectDuration / 1000) {
        activeEffects.value.delete(effect)
      }
    }
  }

  /**
   * 计算效果的进度 (0-1, 1 = 刚触发, 0 = 结束)
   */
  function getEffectProgress(effect: AnimationEffect, time: number, effectDuration: number): number {
    const state = activeEffects.value.get(effect)
    if (!state) return 0
    const elapsed = time - state.startTime
    const duration = effectDuration / 1000
    if (elapsed < 0 || elapsed > duration) return 0
    // ease out
    const t = 1 - elapsed / duration
    return t * t * state.strength
  }

  /**
   * 渲染单帧到 Canvas
   */
  function renderFrame(
    enabledEffects: AnimationEffect[],
    effectDuration: number,
    backgroundColor: string
  ) {
    const canvas = canvasRef.value
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    const time = currentTime.value

    // 更新效果
    updateEffects(time, enabledEffects, effectDuration)

    // 清除画布
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, width, height)

    if (images.value.length === 0) {
      // 没有图片，绘制提示
      ctx.fillStyle = '#666'
      ctx.font = '20px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('请上传图片', width / 2, height / 2)
      return
    }

    // 获取当前图片
    const currentImg = images.value[currentImageIndex.value]
    const imgEl = imageCache.get(currentImg?.id || '')

    if (!imgEl) return

    // 保存上下文
    ctx.save()

    // 应用效果
    let scale = 1
    let rotation = 0
    let offsetX = 0
    let offsetY = 0
    let opacity = 1
    let blur = 0

    for (const effect of enabledEffects) {
      const p = getEffectProgress(effect, time, effectDuration)
      if (p <= 0) continue

      switch (effect) {
        case 'zoom':
          scale += p * 0.3
          break
        case 'rotate':
          rotation += p * (Math.PI / 8)
          break
        case 'shake':
          offsetX += (Math.random() - 0.5) * p * 30
          offsetY += (Math.random() - 0.5) * p * 30
          break
        case 'flash':
          // flash 在图片绘制后叠加白色
          break
        case 'blur':
          blur = p * 8
          break
        case 'slide': {
          const slideP = getEffectProgress('slide', time, effectDuration)
          offsetX += (1 - slideP) * width * 0.3 - width * 0.3
          break
        }
      }
    }

    // 应用变换
    ctx.translate(width / 2 + offsetX, height / 2 + offsetY)
    ctx.rotate(rotation)
    ctx.scale(scale, scale)

    // 应用模糊
    if (blur > 0) {
      ctx.filter = `blur(${blur}px)`
    }

    // 计算图片绘制区域（cover 模式）
    const imgRatio = imgEl.naturalWidth / imgEl.naturalHeight
    const canvasRatio = width / height
    let drawWidth: number, drawHeight: number

    if (imgRatio > canvasRatio) {
      drawHeight = height
      drawWidth = height * imgRatio
    } else {
      drawWidth = width
      drawHeight = width / imgRatio
    }

    // 绘制图片（居中）
    ctx.globalAlpha = opacity
    ctx.drawImage(imgEl, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)

    // Flash 效果 - 叠加白色
    const flashP = getEffectProgress('flash', time, effectDuration)
    if (flashP > 0) {
      ctx.globalAlpha = flashP * 0.6
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(-drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
    }

    ctx.restore()
  }

  /**
   * 重置状态
   */
  function reset() {
    currentImageIndex.value = 0
    activeEffects.value.clear()
    imageCache.clear()
  }

  /**
   * 导出为视频 (WebM)
   */
  async function exportVideo(
    audioElement: HTMLAudioElement,
    enabledEffects: AnimationEffect[],
    effectDuration: number,
    backgroundColor: string,
    fps: number = 30,
    onProgress?: (progress: number) => void
  ): Promise<Blob> {
    const canvas = canvasRef.value
    if (!canvas) throw new Error('Canvas 不可用')

    isRendering.value = true

    try {
      await preloadImages()

      // 使用 captureStream + MediaRecorder
      const stream = canvas.captureStream(fps)

      // 创建音频源
      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaElementSource(audioElement)
      const dest = audioCtx.createMediaStreamDestination()
      source.connect(dest)
      source.connect(audioCtx.destination) // 同时播放

      // 合并视频流和音频流
      const combinedStream = new MediaStream([
        ...stream.getTracks(),
        ...dest.stream.getTracks(),
      ])

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
          const blob = new Blob(chunks, { type: 'video/webm' })
          source.disconnect()
          audioCtx.close()
          isRendering.value = false
          resolve(blob)
        }

        recorder.onerror = (e) => {
          isRendering.value = false
          reject(e)
        }

        recorder.start()

        // 开始播放
        reset()
        audioElement.currentTime = 0
        audioElement.play()

        // 渲染循环
        const renderLoop = () => {
          if (!audioElement.paused && !audioElement.ended) {
            renderFrame(enabledEffects, effectDuration, backgroundColor)
            if (onProgress) {
              onProgress(audioElement.currentTime / audioElement.duration)
            }
            requestAnimationFrame(renderLoop)
          } else {
            recorder.stop()
          }
        }
        renderLoop()
      })
    } catch (error) {
      isRendering.value = false
      throw error
    }
  }

  return {
    currentImageIndex,
    isRendering,
    activeEffects,
    preloadImages,
    renderFrame,
    reset,
    exportVideo,
  }
}
