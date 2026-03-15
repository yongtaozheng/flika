<script setup lang="ts">
import { computed } from 'vue'
import type { AnimationConfig } from '../types'

const props = defineProps<{
  config: AnimationConfig
  isPlaying: boolean
  currentTime: number
  duration: number
  bpm: number
  beatsCount: number
  isAnalyzing: boolean
  analyzeProgress: number
}>()

const emit = defineEmits<{
  'update:config': [config: AnimationConfig]
  'toggle-play': []
  'stop': []
  'seek': [time: number]
  'export': []
}>()

// 格式化时间
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// 进度条
const progressPercent = computed(() => {
  if (props.duration === 0) return 0
  return (props.currentTime / props.duration) * 100
})

function handleSeek(e: MouseEvent) {
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const x = e.clientX - rect.left
  const percent = x / rect.width
  emit('seek', percent * props.duration)
}

// 更新配置辅助函数
function updateConfig(partial: Partial<AnimationConfig>) {
  emit('update:config', { ...props.config, ...partial })
}

function toggleEffect(index: number) {
  const effects = [...props.config.effects]
  effects[index] = { ...effects[index], enabled: !effects[index].enabled }
  updateConfig({ effects })
}

// 效果图标
function getEffectIcon(type: string): string {
  const icons: Record<string, string> = {
    switch: '🔄',
    zoom: '🔍',
    rotate: '🔃',
    shake: '📳',
    flash: '⚡',
    blur: '🌫️',
    slide: '➡️',
  }
  return icons[type] || '✨'
}
</script>

<template>
  <div class="animation-controls">
    <!-- 播放控制 -->
    <div class="control-section">
      <h3 class="section-title">播放控制</h3>

      <!-- 进度条 -->
      <div class="progress-bar" @click="handleSeek">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${progressPercent}%` }" />
        </div>
        <div class="time-display">
          <span>{{ formatTime(currentTime) }}</span>
          <span>{{ formatTime(duration) }}</span>
        </div>
      </div>

      <!-- 播放按钮 -->
      <div class="playback-buttons">
        <button class="btn btn-icon" @click="$emit('stop')" title="停止">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
        <button class="btn btn-primary btn-icon" @click="$emit('toggle-play')" :title="isPlaying ? '暂停' : '播放'">
          <svg v-if="!isPlaying" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        </button>
        <button class="btn btn-accent" @click="$emit('export')" title="导出视频">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          导出
        </button>
      </div>

      <!-- BPM & 节拍信息 -->
      <div class="info-row" v-if="bpm > 0">
        <div class="info-chip">
          <span class="info-label">BPM</span>
          <span class="info-value">{{ bpm }}</span>
        </div>
        <div class="info-chip">
          <span class="info-label">节拍数</span>
          <span class="info-value">{{ beatsCount }}</span>
        </div>
      </div>

      <!-- 分析进度 -->
      <div v-if="isAnalyzing" class="analyze-progress">
        <div class="analyze-bar">
          <div class="analyze-fill" :style="{ width: `${analyzeProgress}%` }" />
        </div>
        <span class="analyze-text">正在分析音频节拍... {{ Math.round(analyzeProgress) }}%</span>
      </div>
    </div>

    <!-- 效果选择 -->
    <div class="control-section">
      <h3 class="section-title">动画效果</h3>
      <div class="effects-grid">
        <button
          v-for="(effect, index) in config.effects"
          :key="effect.type"
          class="effect-btn"
          :class="{ active: effect.enabled }"
          @click="toggleEffect(index)"
          :title="effect.description"
        >
          <span class="effect-icon">{{ getEffectIcon(effect.type) }}</span>
          <span class="effect-label">{{ effect.label }}</span>
        </button>
      </div>
    </div>

    <!-- 参数调节 -->
    <div class="control-section">
      <h3 class="section-title">参数调节</h3>

      <div class="slider-group">
        <div class="slider-header">
          <label>灵敏度</label>
          <span class="slider-value">{{ Math.round(config.sensitivity * 100) }}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="config.sensitivity"
          @input="updateConfig({ sensitivity: Number(($event.target as HTMLInputElement).value) })"
          class="slider"
        />
      </div>

      <div class="slider-group">
        <div class="slider-header">
          <label>效果时长</label>
          <span class="slider-value">{{ config.effectDuration }}ms</span>
        </div>
        <input
          type="range"
          min="50"
          max="500"
          step="10"
          :value="config.effectDuration"
          @input="updateConfig({ effectDuration: Number(($event.target as HTMLInputElement).value) })"
          class="slider"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.animation-controls {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.control-section {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 16px;
  padding: 20px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.5);
  margin: 0 0 16px 0;
}

/* 进度条 */
.progress-bar {
  cursor: pointer;
  margin-bottom: 16px;
}

.progress-track {
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #646cff, #aa3bff);
  border-radius: 3px;
  transition: width 0.1s linear;
}

.time-display {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 6px;
  font-variant-numeric: tabular-nums;
}

/* 播放按钮 */
.playback-buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.btn-icon {
  padding: 10px;
}

.btn-primary {
  background: #646cff;
  border-color: #646cff;
  color: white;
}

.btn-primary:hover {
  background: #535bf2;
  border-color: #535bf2;
}

.btn-accent {
  background: rgba(170, 59, 255, 0.15);
  border-color: rgba(170, 59, 255, 0.4);
  color: #c77dff;
}

.btn-accent:hover {
  background: rgba(170, 59, 255, 0.25);
  border-color: rgba(170, 59, 255, 0.6);
}

/* 信息 */
.info-row {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  justify-content: center;
}

.info-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 20px;
  font-size: 13px;
}

.info-label {
  color: rgba(255, 255, 255, 0.4);
}

.info-value {
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* 分析进度 */
.analyze-progress {
  margin-top: 16px;
}

.analyze-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.analyze-fill {
  height: 100%;
  background: linear-gradient(90deg, #646cff, #aa3bff);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.analyze-text {
  display: block;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 6px;
  text-align: center;
}

/* 效果选择 */
.effects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 8px;
}

.effect-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 12px;
}

.effect-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

.effect-btn.active {
  background: rgba(100, 108, 255, 0.15);
  border-color: rgba(100, 108, 255, 0.5);
  color: #b0b5ff;
}

.effect-icon {
  font-size: 24px;
}

.effect-label {
  font-weight: 500;
}

/* 滑块 */
.slider-group {
  margin-bottom: 16px;
}

.slider-group:last-child {
  margin-bottom: 0;
}

.slider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.slider-header label {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
}

.slider-value {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  font-variant-numeric: tabular-nums;
}

.slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  outline: none;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #646cff;
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.2);
  transition: transform 0.15s;
}

.slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #646cff;
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.2);
}
</style>
