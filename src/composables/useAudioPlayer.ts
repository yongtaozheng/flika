import { ref, onUnmounted } from 'vue'

/**
 * 音频播放器 composable
 * 封装 HTMLAudioElement，提供响应式的播放状态
 */
export function useAudioPlayer() {
  const audio = ref<HTMLAudioElement | null>(null)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const audioUrl = ref('')

  let animationFrameId: number | null = null

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
      currentTime.value = 0
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
  }

  /**
   * 使用 requestAnimationFrame 高精度更新当前时间
   */
  function startTimeUpdate() {
    function update() {
      if (audio.value) {
        currentTime.value = audio.value.currentTime
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
   */
  async function play() {
    if (audio.value) {
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
   * 停止并重置
   */
  function stop() {
    if (audio.value) {
      audio.value.pause()
      audio.value.currentTime = 0
      currentTime.value = 0
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
    isPlaying,
    currentTime,
    duration,
    audioUrl,
    loadAudio,
    play,
    pause,
    togglePlay,
    seek,
    stop,
    cleanup,
  }
}
