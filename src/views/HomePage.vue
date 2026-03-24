<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import type { UploadedImage, AnimationConfig, EffectConfig } from '../types'
import { useBeatDetector } from '../composables/useBeatDetector'
import { useAudioPlayer } from '../composables/useAudioPlayer'
import { saveVideoFile } from '../utils/filePicker'
import AudioUploader from '../components/AudioUploader.vue'
import ImageUploader from '../components/ImageUploader.vue'
import AnimationPreview from '../components/AnimationPreview.vue'
import AnimationControls from '../components/AnimationControls.vue'

const images = ref<UploadedImage[]>([])
const audioFile = ref<File | null>(null)
const previewRef = ref<InstanceType<typeof AnimationPreview> | null>(null)

const defaultEffects: EffectConfig[] = [
  { type: 'switch',      label: '切换',  description: '节拍时切换到下一张图片',          enabled: true  },
  { type: 'zoom',        label: '缩放',  description: '节拍时图片缩放脉冲',              enabled: true  },
  { type: 'flash',       label: '闪白',  description: '节拍时短暂闪白',                  enabled: false },
  { type: 'rotate',      label: '旋转',  description: '节拍时轻微旋转',                  enabled: false },
  { type: 'shake',       label: '抖动',  description: '节拍时画面抖动',                  enabled: false },
  { type: 'blur',        label: '模糊',  description: '节拍间模糊过渡',                  enabled: false },
  { type: 'slide',       label: '滑动',  description: '图片滑入滑出',                    enabled: false },
  { type: 'fadeIn',      label: '淡入',  description: '节拍时图片从透明渐入',            enabled: false },
  { type: 'bounce',      label: '弹跳',  description: '节拍时弹性缩放跳动',              enabled: false },
  { type: 'glitch',      label: '故障',  description: '节拍时 RGB 通道分离故障效果',     enabled: false },
  { type: 'flipX',       label: '翻转',  description: '节拍时水平翻转图片',              enabled: false },
  { type: 'pixelate',    label: '像素',  description: '节拍时图片像素化',                enabled: false },
  { type: 'colorInvert', label: '反色',  description: '节拍时颜色反转',                  enabled: false },
  { type: 'vortex',      label: '漩涡',  description: '节拍时漩涡旋转吸入效果',          enabled: false },
  { type: 'chromatic',   label: '色散',  description: '节拍时 RGB 色差棱镜偏移',        enabled: false },
  { type: 'wave',        label: '波浪',  description: '节拍时正弦波扭曲变形',            enabled: false },
  { type: 'split',       label: '分裂',  description: '节拍时画面四象限分裂飞散',        enabled: false },
  { type: 'neonGlow',    label: '霓虹',  description: '节拍时彩色霓虹发光边框',          enabled: false },
  { type: 'heartbeat',   label: '心跳',  description: '节拍时双脉冲心跳缩放',            enabled: false },
]

const config = reactive<AnimationConfig>({
  sensitivity: 0.5,
  effectDuration: 200,
  effects: defaultEffects,
  backgroundColor: '#000000',
  width: 1280,
  height: 720,
})

const { beats, isAnalyzing, progress: analyzeProgress, bpm, analyzeBeats } = useBeatDetector()
const audioPlayer = useAudioPlayer()
const { isPlaying, currentTime, duration, loadAudio, togglePlay, stop, seek } = audioPlayer

async function handleAudioUpload(file: File) {
  audioFile.value = file
  loadAudio(file)
  try {
    await analyzeBeats(file, config.sensitivity)
  } catch (e) {
    console.error('分析失败', e)
  }
}

let analyzeDebounce: ReturnType<typeof setTimeout> | null = null
watch(
  () => config.sensitivity,
  (val) => {
    if (!audioFile.value) return
    if (analyzeDebounce) clearTimeout(analyzeDebounce)
    analyzeDebounce = setTimeout(() => analyzeBeats(audioFile.value!, val), 500)
  }
)

function handleImagesAdd(newImages: UploadedImage[]) {
  images.value = [...images.value, ...newImages]
}

function handleImageRemove(id: string) {
  const img = images.value.find((i) => i.id === id)
  if (img) URL.revokeObjectURL(img.url)
  images.value = images.value.filter((i) => i.id !== id)
}

function handleImagesReorder(reordered: UploadedImage[]) {
  images.value = reordered
}

function handleConfigUpdate(newConfig: AnimationConfig) {
  Object.assign(config, newConfig)
}

function handleSeek(time: number) { seek(time) }

function handleStop() {
  stop()
  previewRef.value?.reset()
}

const isExporting = ref(false)

async function handleExport() {
  if (!audioFile.value || images.value.length === 0) {
    alert('请先上传音频和图片')
    return
  }
  const audioEl = audioPlayer.audioElement.value
  if (!audioEl) { alert('音频未加载，请重新上传'); return }

  isExporting.value = true
  try {
    const blob = await previewRef.value!.exportVideo(
      audioEl,
      config.effects.filter((e) => e.enabled).map((e) => e.type),
      config.effectDuration,
      config.backgroundColor,
      audioFile.value!,
    )
    await saveVideoFile(blob)
  } catch (e) {
    console.error('导出失败', e)
    alert('导出失败，请重试')
  } finally {
    isExporting.value = false
  }
}

const hasAudio = ref(false)
const hasImages = ref(false)
watch(audioFile, (v) => { hasAudio.value = !!v })
watch(images, (v) => { hasImages.value = v.length > 0 }, { deep: true })
</script>

<template>
  <div class="home-page">
    <!-- ── 左列：预览 ── -->
    <div class="preview-col">
      <div class="preview-wrap">
        <AnimationPreview
          ref="previewRef"
          :images="images"
          :beats="beats"
          :current-time="currentTime"
          :is-playing="isPlaying"
          :config="config"
        />
      </div>

      <!-- 步骤引导 -->
      <Transition name="fade">
        <div class="steps-bar" v-if="!hasAudio || !hasImages">
          <div class="step" :class="{ done: hasAudio }">
            <span class="step-num">{{ hasAudio ? '✓' : '1' }}</span>
            <span>上传音乐</span>
          </div>
          <span class="step-sep">→</span>
          <div class="step" :class="{ done: hasImages }">
            <span class="step-num">{{ hasImages ? '✓' : '2' }}</span>
            <span>添加图片</span>
          </div>
          <span class="step-sep">→</span>
          <div class="step">
            <span class="step-num">3</span>
            <span>预览 &amp; 导出</span>
          </div>
        </div>
      </Transition>
    </div>

    <!-- ── 右列：控制侧栏 ── -->
    <aside class="sidebar">
      <!-- 音乐 -->
      <div class="sidebar-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          <span>音乐</span>
        </div>
        <AudioUploader @upload="handleAudioUpload" />
      </div>

      <!-- 图片素材 -->
      <div class="sidebar-block">
        <div class="block-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
          </svg>
          <span>图片素材</span>
          <span v-if="images.length" class="block-badge">{{ images.length }}</span>
        </div>
        <ImageUploader
          :images="images"
          @add="handleImagesAdd"
          @remove="handleImageRemove"
          @reorder="handleImagesReorder"
        />
      </div>

      <!-- 播放 + 效果 + 参数 -->
      <AnimationControls
        :config="config"
        :is-playing="isPlaying"
        :current-time="currentTime"
        :duration="duration"
        :bpm="bpm"
        :beats-count="beats.length"
        :is-analyzing="isAnalyzing"
        :analyze-progress="analyzeProgress"
        :is-exporting="isExporting"
        @update:config="handleConfigUpdate"
        @toggle-play="togglePlay"
        @stop="handleStop"
        @seek="handleSeek"
        @export="handleExport"
      />
    </aside>
  </div>
</template>

<style scoped>
.home-page {
  height: 100%;
  display: grid;
  grid-template-columns: 1fr 360px;
  overflow: hidden;
}

/* ── Preview col ── */
.preview-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  overflow: hidden;
  border-right: 1px solid var(--border);
}

.preview-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
}

/* ── Steps ── */
.steps-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
}

.step {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--text-3);
  transition: color 0.3s;
}

.step.done { color: var(--teal); }

.step-num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--surface-3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.step.done .step-num {
  background: var(--teal-dim);
  color: var(--teal);
}

.step-sep {
  color: var(--text-4);
  font-size: 14px;
}

/* ── Sidebar ── */
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow-y: auto;
  background: var(--surface);
}

.sidebar-block {
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.block-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  color: var(--text-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.block-header span { color: var(--text-3); }

.block-badge {
  margin-left: auto;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  letter-spacing: 0;
  text-transform: none;
}

/* ── Transitions ── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s, transform 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(4px); }
</style>
