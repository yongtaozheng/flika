<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import type { UploadedImage, AnimationConfig, EffectConfig } from './types'
import { useBeatDetector } from './composables/useBeatDetector'
import { useAudioPlayer } from './composables/useAudioPlayer'
import AudioUploader from './components/AudioUploader.vue'
import ImageUploader from './components/ImageUploader.vue'
import AnimationPreview from './components/AnimationPreview.vue'
import AnimationControls from './components/AnimationControls.vue'

// --- 状态 ---
const images = ref<UploadedImage[]>([])
const audioFile = ref<File | null>(null)
const previewRef = ref<InstanceType<typeof AnimationPreview> | null>(null)

// 默认效果列表
const defaultEffects: EffectConfig[] = [
  { type: 'switch', label: '切换', description: '节拍时切换到下一张图片', enabled: true },
  { type: 'zoom', label: '缩放', description: '节拍时图片缩放脉冲', enabled: true },
  { type: 'flash', label: '闪白', description: '节拍时短暂闪白', enabled: false },
  { type: 'rotate', label: '旋转', description: '节拍时轻微旋转', enabled: false },
  { type: 'shake', label: '抖动', description: '节拍时画面抖动', enabled: false },
  { type: 'blur', label: '模糊', description: '节拍间模糊过渡', enabled: false },
  { type: 'slide', label: '滑动', description: '图片滑入滑出', enabled: false },
]

const config = reactive<AnimationConfig>({
  sensitivity: 0.5,
  effectDuration: 200,
  effects: defaultEffects,
  backgroundColor: '#000000',
  width: 1280,
  height: 720,
})

// --- Composables ---
const { beats, isAnalyzing, progress: analyzeProgress, bpm, analyzeBeats } = useBeatDetector()
const { isPlaying, currentTime, duration, loadAudio, togglePlay, stop, seek } = useAudioPlayer()

// --- 事件处理 ---
async function handleAudioUpload(file: File) {
  audioFile.value = file
  loadAudio(file)

  // 自动开始分析节拍
  try {
    await analyzeBeats(file, config.sensitivity)
  } catch (e) {
    console.error('分析失败', e)
  }
}

// 灵敏度变化时重新分析
let analyzeDebounce: ReturnType<typeof setTimeout> | null = null
watch(
  () => config.sensitivity,
  (val) => {
    if (!audioFile.value) return
    if (analyzeDebounce) clearTimeout(analyzeDebounce)
    analyzeDebounce = setTimeout(() => {
      analyzeBeats(audioFile.value!, val)
    }, 500)
  }
)

function handleImagesAdd(newImages: UploadedImage[]) {
  images.value = [...images.value, ...newImages]
}

function handleImageRemove(id: string) {
  const img = images.value.find((i) => i.id === id)
  if (img) {
    URL.revokeObjectURL(img.url)
  }
  images.value = images.value.filter((i) => i.id !== id)
}

function handleImagesReorder(reordered: UploadedImage[]) {
  images.value = reordered
}

function handleConfigUpdate(newConfig: AnimationConfig) {
  Object.assign(config, newConfig)
}

function handleSeek(time: number) {
  seek(time)
}

function handleStop() {
  stop()
  previewRef.value?.reset()
}

async function handleExport() {
  const canvas = previewRef.value?.canvasRef
  if (!canvas) {
    alert('请先加载音频和图片')
    return
  }

  if (!audioFile.value || images.value.length === 0) {
    alert('请先上传音频和图片')
    return
  }

  alert('导出功能正在准备中...\n\n提示：您可以使用屏幕录制工具录制预览画面作为替代方案。')
}

// 当前步骤提示
const hasAudio = ref(false)
const hasImages = ref(false)

watch(audioFile, (v) => { hasAudio.value = !!v })
watch(images, (v) => { hasImages.value = v.length > 0 }, { deep: true })
</script>

<template>
  <div class="app">
    <!-- 头部 -->
    <header class="app-header">
      <h1 class="app-title">
        <span class="title-icon">🎵</span>
        踩点动画生成器
      </h1>
      <p class="app-desc">上传音乐和图片，自动生成随节拍跳动的酷炫动画</p>
    </header>

    <main class="app-main">
      <!-- 左侧：预览区域 -->
      <div class="preview-section">
        <AnimationPreview
          ref="previewRef"
          :images="images"
          :beats="beats"
          :current-time="currentTime"
          :is-playing="isPlaying"
          :config="config"
        />

        <!-- 步骤引导 -->
        <div class="steps-guide" v-if="!hasAudio || !hasImages">
          <div class="step" :class="{ done: hasAudio }">
            <span class="step-num">{{ hasAudio ? '✓' : '1' }}</span>
            <span>上传音乐文件</span>
          </div>
          <div class="step-arrow">→</div>
          <div class="step" :class="{ done: hasImages }">
            <span class="step-num">{{ hasImages ? '✓' : '2' }}</span>
            <span>添加图片素材</span>
          </div>
          <div class="step-arrow">→</div>
          <div class="step">
            <span class="step-num">3</span>
            <span>播放预览 & 导出</span>
          </div>
        </div>
      </div>

      <!-- 右侧：控制面板 -->
      <aside class="control-panel">
        <!-- 音频上传 -->
        <div class="panel-section">
          <h2 class="panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            音乐
          </h2>
          <AudioUploader @upload="handleAudioUpload" />
        </div>

        <!-- 图片上传 -->
        <div class="panel-section">
          <h2 class="panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            图片素材
          </h2>
          <ImageUploader
            :images="images"
            @add="handleImagesAdd"
            @remove="handleImageRemove"
            @reorder="handleImagesReorder"
          />
        </div>

        <!-- 播放控制和效果设置 -->
        <AnimationControls
          :config="config"
          :is-playing="isPlaying"
          :current-time="currentTime"
          :duration="duration"
          :bpm="bpm"
          :beats-count="beats.length"
          :is-analyzing="isAnalyzing"
          :analyze-progress="analyzeProgress"
          @update:config="handleConfigUpdate"
          @toggle-play="togglePlay"
          @stop="handleStop"
          @seek="handleSeek"
          @export="handleExport"
        />
      </aside>
    </main>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  text-align: center;
  padding: 40px 24px 24px;
}

.app-title {
  font-size: 36px;
  font-weight: 700;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.95);
}

.title-icon {
  font-size: 40px;
}

.app-desc {
  margin: 12px 0 0;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.45);
}

.app-main {
  display: grid;
  grid-template-columns: 1fr 420px;
  gap: 24px;
  padding: 0 24px 48px;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
  flex: 1;
}

.preview-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
  position: sticky;
  top: 24px;
  align-self: flex-start;
}

.control-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  padding-right: 4px;
}

.control-panel::-webkit-scrollbar {
  width: 4px;
}
.control-panel::-webkit-scrollbar-track {
  background: transparent;
}
.control-panel::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}

.panel-section {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 16px;
  padding: 20px;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  margin: 0 0 16px 0;
}

/* 步骤引导 */
.steps-guide {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 16px;
}

.step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.4);
  transition: all 0.3s;
}

.step.done {
  color: #4caf50;
}

.step-num {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.step.done .step-num {
  background: rgba(76, 175, 80, 0.2);
}

.step-arrow {
  color: rgba(255, 255, 255, 0.15);
  font-size: 18px;
}

/* 响应式 */
@media (max-width: 1024px) {
  .app-main {
    grid-template-columns: 1fr;
    padding: 0 16px 32px;
  }

  .preview-section {
    position: static;
  }

  .control-panel {
    max-height: none;
    overflow-y: visible;
  }

  .app-title {
    font-size: 28px;
  }

  .steps-guide {
    flex-direction: column;
    gap: 8px;
  }

  .step-arrow {
    transform: rotate(90deg);
  }
}
</style>
