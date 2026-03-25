import { ref, computed } from 'vue'

/** 画布方向：横屏 (16:9) 或 竖屏 (9:16) */
export type Orientation = 'landscape' | 'portrait'

/**
 * 画布方向 composable
 * 提供响应式的画布宽高和宽高比
 */
export function useOrientation() {
  const orientation = ref<Orientation>('landscape')

  /** 画布宽度 */
  const CW = computed(() => orientation.value === 'landscape' ? 1280 : 720)
  /** 画布高度 */
  const CH = computed(() => orientation.value === 'landscape' ? 720 : 1280)
  /** CSS aspect-ratio 值 */
  const canvasAspectRatio = computed(() =>
    orientation.value === 'landscape' ? '16 / 9' : '9 / 16'
  )

  return {
    orientation,
    CW,
    CH,
    canvasAspectRatio,
  }
}
