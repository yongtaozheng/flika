import { ref, onUnmounted } from 'vue'

/**
 * 音频播放器 composable
 * 封装 HTMLAudioElement，提供响应式的播放状态
 * 支持片段选区播放与循环
 */
export function useAudioPlayer() {
  const audio = ref<HTMLAudioElement | null>(null)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const audioUrl = ref('')

  // ── 片段选区 ──
  const segmentStart = ref(0)      // 选区起始（秒），默认 0
  const segmentEnd = ref(0)        // 选区结束（秒），0 表示全曲
  const segmentLoop = ref(false)   // 是否循环播放选区

  let animationFrameId: number | null = null

  /**
   * 设置播放片段范围
   * 传入 (0, 0) 清除选区，恢复全曲播放
   */
  function setSegment(start: number, end: number) {
    segmentStart.value = Math.max(0, start)
    segmentEnd.value = end > 0 ? Math.min(end, duration.value || Infinity) : 0
  }

  function setSegmentLoop(loop: boolean) {
    segmentLoop.value = loop
  }

  /** 获取当前片段终点（segmentEnd=0 视为全曲） */
  function getEndBound(): number {
    return segmentEnd.value > 0 ? segmentEnd.value : duration.value
  }

  /**
   * 加载音频文件
   */
  function loadAudio(file: File) {
    // 清理之前的音频
    cleanup()

    const url = URL.createObjectURL(file)
    audioUrl.value = url

    const el = new Audio(url)
    el.preload = 'auto'

    el.addEventListener('loadedmetadata', () => {
      duration.value = el.duration
    })

    el.addEventListener('ended', () => {
      isPlaying.value = false
      currentTime.value = segmentStart.value
      stopTimeUpdate()
    })

    el.addEventListener('pause', () => {
      isPlaying.value = false
      stopTimeUpdate()
    })

    el.addEventListener('play', () => {
      isPlaying.value = true
      startTimeUpdate()
    })

    audio.value = el

    // 重置片段选区
    segmentStart.value = 0
    segmentEnd.value = 0
    segmentLoop.value = false
  }

  /**
   * 使用 requestAnimationFrame 高精度更新当前时间
   * 同时检查片段边界
   */
  function startTimeUpdate() {
    function update() {
      if (audio.value) {
        currentTime.value = audio.value.currentTime

        // 检查片段边界
        const endBound = getEndBound()
        if (endBound > 0 && audio.value.currentTime >= endBound) {
          if (segmentLoop.value) {
            // 循环：跳回片段起点
            audio.value.currentTime = segmentStart.value
            currentTime.value = segmentStart.value
          } else {
            // 停止：暂停在片段终点
            audio.value.pause()
            audio.value.currentTime = endBound
            currentTime.value = endBound
            isPlaying.value = false
            stopTimeUpdate()
            return
          }
        }
      }
      animationFrameId = requestAnimationFrame(update)
    }
    update()
  }

  function stopTimeUpdate() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  /**
   * 播放
   * 若当前位置在选区外，自动跳到选区起点
   */
  async function play() {
    if (audio.value) {
      const endBound = getEndBound()
      if (
        audio.value.currentTime < segmentStart.value ||
        audio.value.currentTime >= endBound
      ) {
        audio.value.currentTime = segmentStart.value
        currentTime.value = segmentStart.value
      }
      await audio.value.play()
    }
  }

  /**
   * 暂停
   */
  function pause() {
    if (audio.value) {
      audio.value.pause()
    }
  }

  /**
   * 播放/暂停切换
   */
  async function togglePlay() {
    if (isPlaying.value) {
      pause()
    } else {
      await play()
    }
  }

  /**
   * 跳转到指定时间
   */
  function seek(time: number) {
    if (audio.value) {
      audio.value.currentTime = time
      currentTime.value = time
    }
  }

  /**
   * 停止并重置到片段起点
   */
  function stop() {
    if (audio.value) {
      audio.value.pause()
      const resetTime = segmentStart.value
      audio.value.currentTime = resetTime
      currentTime.value = resetTime
      isPlaying.value = false
    }
    stopTimeUpdate()
  }

  /**
   * 清理资源
   */
  function cleanup() {
    stop()
    if (audioUrl.value) {
      URL.revokeObjectURL(audioUrl.value)
      audioUrl.value = ''
    }
    audio.value = null
    duration.value = 0
  }

  onUnmounted(() => {
    cleanup()
  })

  return {
    audio,
    audioElement: audio,
    isPlaying,
    currentTime,
    duration,
    audioUrl,
    segmentStart,
    segmentEnd,
    segmentLoop,
    loadAudio,
    play,
    pause,
    togglePlay,
    seek,
    stop,
    cleanup,
    setSegment,
    setSegmentLoop,
  }
}
