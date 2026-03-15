<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { UploadedImage } from '../types'
import { useAudioPlayer } from '../composables/useAudioPlayer'
import { useBeatDetector } from '../composables/useBeatDetector'

// --- 状态 ---
const images = ref<UploadedImage[]>([])
const audioFile = ref<File | null>(null)
const isDragging = ref(false)
const scrollSpeed = ref(3)                 // 基础滚动速度
const filmGrain = ref(true)                // 胶片颗粒效果
const filmFlicker = ref(true)              // 闪烁效果
const filmScratches = ref(true)            // 划痕效果
const vintageColor = ref(true)             // 复古色调
const autoScroll = ref(true)               // 自动滚动
const scrollOffset = ref(0)                // 当前滚动偏移
const isFlashing = ref(false)              // 节拍闪烁状态
const currentBeatStrength = ref(0)         // 当前节拍强度
// --- Composables ---
const { isPlaying, currentTime, duration, loadAudio, togglePlay, stop } = useAudioPlayer()
const { beats, analyzeBeats } = useBeatDetector()

// --- 音频处理 ---
function handleAudioDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files?.length) {
    const file = files[0]
    if (file.type.startsWith('audio/')) {
      handleAudioFile(file)
    }
  }
}

async function handleAudioFile(file: File) {
  audioFile.value = file
  loadAudio(file)
  try {
    await analyzeBeats(file, 0.5)
  } catch (e) {
    console.error('Beat analysis failed', e)
  }
}

function handleAudioSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) handleAudioFile(file)
}

// --- 图片处理 ---
function handleImageDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (!files?.length) return
  addImageFiles(Array.from(files).filter(f => f.type.startsWith('image/')))
}

function handleImageSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.length) {
    addImageFiles(Array.from(input.files))
  }
}

function addImageFiles(files: File[]) {
  for (const file of files) {
    const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const url = URL.createObjectURL(file)
    images.value.push({ id, file, url, name: file.name })
  }
}

function removeImage(id: string) {
  const img = images.value.find(i => i.id === id)
  if (img) URL.revokeObjectURL(img.url)
  images.value = images.value.filter(i => i.id !== id)
}

// --- 节拍检测 ---
function findCurrentBeat(time: number): { strength: number } | null {
  for (const beat of beats.value) {
    const diff = time - beat.time
    if (diff >= 0 && diff < 0.15) {
      return beat
    }
  }
  return null
}

// --- 动画循环 ---
let animFrameId: number | null = null
let lastTimestamp = 0

function animationLoop(timestamp: number) {
  if (!lastTimestamp) lastTimestamp = timestamp
  const delta = (timestamp - lastTimestamp) / 1000
  lastTimestamp = timestamp

  // 节拍检测 -> 闪烁效果
  if (isPlaying.value) {
    const beat = findCurrentBeat(currentTime.value)
    if (beat) {
      isFlashing.value = true
      currentBeatStrength.value = beat.strength
      setTimeout(() => {
        isFlashing.value = false
        currentBeatStrength.value = 0
      }, 120)
    }
  }

  // 自动滚动
  if (autoScroll.value && images.value.length > 0) {
    const beatBoost = currentBeatStrength.value * 8
    const speed = isPlaying.value ? scrollSpeed.value + beatBoost : scrollSpeed.value * 0.3
    scrollOffset.value += speed * delta * 60

    // 循环滚动
    const frameHeight = 280  // 每帧高度（含间隔）
    const totalHeight = images.value.length * frameHeight
    if (totalHeight > 0 && scrollOffset.value > totalHeight) {
      scrollOffset.value -= totalHeight
    }
  }

  animFrameId = requestAnimationFrame(animationLoop)
}

// --- 生命周期 ---
onMounted(() => {
  animFrameId = requestAnimationFrame(animationLoop)
})

onUnmounted(() => {
  if (animFrameId) cancelAnimationFrame(animFrameId)
  // 清理图片 URL
  images.value.forEach(img => URL.revokeObjectURL(img.url))
})

// 计算胶片帧列表（前后都有重复以实现无缝循环）
const filmFrames = computed(() => {
  if (images.value.length === 0) return []
  // 重复 3 遍确保足够长的滚动区域
  return [...images.value, ...images.value, ...images.value]
})

const filmStripTransform = computed(() => {
  return `translateY(-${scrollOffset.value}px)`
})
</script>

<template>
  <div class="filmstrip-page" :class="{ flicker: filmFlicker && isFlashing }">
    <!-- 复古效果覆盖层 -->
    <div class="film-overlay">
      <div v-if="filmGrain" class="film-grain"></div>
      <div v-if="filmScratches" class="film-scratches"></div>
      <div v-if="vintageColor" class="vintage-overlay"></div>
      <div v-if="isFlashing" class="beat-flash" :style="{ opacity: currentBeatStrength * 0.4 }"></div>
    </div>

    <!-- 放映机光束效果 -->
    <div class="projector-beam"></div>

    <div class="filmstrip-layout">
      <!-- 左侧控制面板 -->
      <aside class="film-controls">
        <div class="controls-inner">
          <h2 class="controls-title">
            <span class="reel-icon">🎞️</span>
            放映控制
          </h2>

          <!-- 音频上传区 -->
          <div class="control-group">
            <label class="control-label">音乐</label>
            <div
              class="upload-zone mini"
              :class="{ 'drag-over': isDragging }"
              @dragover.prevent="isDragging = true"
              @dragleave="isDragging = false"
              @drop="handleAudioDrop"
            >
              <template v-if="audioFile">
                <span class="file-name">{{ audioFile.name }}</span>
              </template>
              <template v-else>
                <span class="upload-hint">拖放音频文件</span>
              </template>
              <input
                type="file"
                accept="audio/*"
                class="file-input"
                @change="handleAudioSelect"
              />
            </div>
          </div>

          <!-- 图片上传区 -->
          <div class="control-group">
            <label class="control-label">胶片素材</label>
            <div
              class="upload-zone mini"
              @dragover.prevent="isDragging = true"
              @dragleave="isDragging = false"
              @drop="handleImageDrop"
            >
              <span class="upload-hint">
                {{ images.length > 0 ? `${images.length} 张图片` : '拖放图片文件' }}
              </span>
              <input
                type="file"
                accept="image/*"
                multiple
                class="file-input"
                @change="handleImageSelect"
              />
            </div>
            <!-- 图片缩略图 -->
            <div class="thumb-list" v-if="images.length > 0">
              <div
                v-for="img in images"
                :key="img.id"
                class="thumb-item"
              >
                <img :src="img.url" :alt="img.name" />
                <button class="thumb-remove" @click="removeImage(img.id)">×</button>
              </div>
            </div>
          </div>

          <!-- 播放控制 -->
          <div class="control-group" v-if="audioFile">
            <label class="control-label">播放</label>
            <div class="playback-controls">
              <button class="film-btn" @click="togglePlay">
                {{ isPlaying ? '⏸ 暂停' : '▶ 播放' }}
              </button>
              <button class="film-btn secondary" @click="stop">
                ⏹ 停止
              </button>
            </div>
          </div>

          <!-- 速度控制 -->
          <div class="control-group">
            <label class="control-label">
              滚动速度
              <span class="control-value">{{ scrollSpeed.toFixed(1) }}</span>
            </label>
            <input
              type="range"
              class="film-slider"
              v-model.number="scrollSpeed"
              min="0.5"
              max="10"
              step="0.5"
            />
          </div>

          <!-- 效果开关 -->
          <div class="control-group">
            <label class="control-label">胶片效果</label>
            <div class="toggle-list">
              <label class="toggle-item">
                <input type="checkbox" v-model="filmGrain" />
                <span class="toggle-label">颗粒噪点</span>
              </label>
              <label class="toggle-item">
                <input type="checkbox" v-model="filmFlicker" />
                <span class="toggle-label">闪烁抖动</span>
              </label>
              <label class="toggle-item">
                <input type="checkbox" v-model="filmScratches" />
                <span class="toggle-label">胶片划痕</span>
              </label>
              <label class="toggle-item">
                <input type="checkbox" v-model="vintageColor" />
                <span class="toggle-label">复古色调</span>
              </label>
              <label class="toggle-item">
                <input type="checkbox" v-model="autoScroll" />
                <span class="toggle-label">自动滚动</span>
              </label>
            </div>
          </div>
        </div>
      </aside>

      <!-- 中间胶卷区域 -->
      <div class="film-stage">
        <div class="film-strip-container">
          <!-- 左侧齿孔 -->
          <div class="sprocket-strip left">
            <div
              v-for="n in 40"
              :key="'l' + n"
              class="sprocket-hole"
              :style="{ transform: `translateY(-${scrollOffset % 40}px)` }"
            ></div>
          </div>

          <!-- 胶片帧 -->
          <div class="film-frames-viewport">
            <div
              v-if="filmFrames.length > 0"
              class="film-frames-track"
              :style="{ transform: filmStripTransform }"
            >
              <div
                v-for="(frame, idx) in filmFrames"
                :key="idx"
                class="film-frame"
              >
                <div class="frame-border">
                  <img :src="frame.url" :alt="frame.name" class="frame-image" />
                  <!-- 帧编号 -->
                  <div class="frame-number">{{ (idx % images.length) + 1 }}</div>
                  <!-- 帧标记 -->
                  <div class="frame-marks">
                    <div class="mark-circle"></div>
                    <div class="mark-line"></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-else class="film-empty">
              <div class="empty-reel">
                <svg width="80" height="80" viewBox="0 0 100 100" fill="none">
                  <circle cx="50" cy="50" r="45" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
                  <circle cx="50" cy="50" r="15" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
                  <circle cx="50" cy="25" r="6" fill="rgba(255,255,255,0.08)"/>
                  <circle cx="50" cy="75" r="6" fill="rgba(255,255,255,0.08)"/>
                  <circle cx="25" cy="50" r="6" fill="rgba(255,255,255,0.08)"/>
                  <circle cx="75" cy="50" r="6" fill="rgba(255,255,255,0.08)"/>
                </svg>
              </div>
              <p class="empty-text">上传图片开始放映</p>
              <p class="empty-hint">支持 JPG / PNG / WebP 格式</p>
            </div>
          </div>

          <!-- 右侧齿孔 -->
          <div class="sprocket-strip right">
            <div
              v-for="n in 40"
              :key="'r' + n"
              class="sprocket-hole"
              :style="{ transform: `translateY(-${scrollOffset % 40}px)` }"
            ></div>
          </div>
        </div>
      </div>

      <!-- 右侧播放信息 -->
      <aside class="film-info">
        <div class="info-inner">
          <!-- 放映机装饰 -->
          <div class="projector-deco">
            <div class="reel reel-top" :class="{ spinning: isPlaying || autoScroll }">
              <svg width="100" height="100" viewBox="0 0 100 100" fill="none">
                <circle cx="50" cy="50" r="45" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"/>
                <circle cx="50" cy="50" r="30" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
                <circle cx="50" cy="50" r="12" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
                <circle cx="50" cy="50" r="4" fill="rgba(255,255,255,0.3)"/>
                <!-- 辐条 -->
                <line x1="50" y1="5" x2="50" y2="20" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
                <line x1="50" y1="80" x2="50" y2="95" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
                <line x1="5" y1="50" x2="20" y2="50" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
                <line x1="80" y1="50" x2="95" y2="50" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
                <line x1="18" y1="18" x2="29" y2="29" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
                <line x1="71" y1="71" x2="82" y2="82" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
                <line x1="82" y1="18" x2="71" y2="29" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
                <line x1="29" y1="71" x2="18" y2="82" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
                <!-- 齿孔装饰 -->
                <circle cx="50" cy="20" r="5" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
                <circle cx="50" cy="80" r="5" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
                <circle cx="20" cy="50" r="5" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
                <circle cx="80" cy="50" r="5" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
              </svg>
            </div>
          </div>

          <!-- 放映信息 -->
          <div class="info-block">
            <div class="info-label">胶片帧数</div>
            <div class="info-value counter">{{ images.length }}</div>
          </div>

          <div class="info-block" v-if="audioFile">
            <div class="info-label">音轨</div>
            <div class="info-value small">{{ audioFile.name }}</div>
          </div>

          <div class="info-block" v-if="duration > 0">
            <div class="info-label">时长</div>
            <div class="info-value">
              {{ Math.floor(currentTime / 60) }}:{{ Math.floor(currentTime % 60).toString().padStart(2, '0') }}
              /
              {{ Math.floor(duration / 60) }}:{{ Math.floor(duration % 60).toString().padStart(2, '0') }}
            </div>
          </div>

          <div class="info-block" v-if="beats.length > 0">
            <div class="info-label">节拍数</div>
            <div class="info-value counter">{{ beats.length }}</div>
          </div>

          <!-- 底部装饰：另一个转盘 -->
          <div class="projector-deco bottom">
            <div class="reel reel-bottom" :class="{ spinning: isPlaying || autoScroll }">
              <svg width="80" height="80" viewBox="0 0 100 100" fill="none">
                <circle cx="50" cy="50" r="45" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>
                <circle cx="50" cy="50" r="12" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
                <circle cx="50" cy="50" r="4" fill="rgba(255,255,255,0.25)"/>
                <line x1="50" y1="5" x2="50" y2="20" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>
                <line x1="50" y1="80" x2="50" y2="95" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>
                <line x1="5" y1="50" x2="20" y2="50" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>
                <line x1="80" y1="50" x2="95" y2="50" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>
              </svg>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* ==============================
   胶片页面 — 复古放映风格
   ============================== */
.filmstrip-page {
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  background: #0a0a0a;
}

/* 闪烁效果 */
.filmstrip-page.flicker {
  animation: flicker 0.1s ease-in-out;
}

@keyframes flicker {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.92; }
}

/* --- 复古覆盖效果 --- */
.film-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 100;
}

/* 胶片颗粒 */
.film-grain {
  position: absolute;
  inset: 0;
  opacity: 0.06;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  background-size: 150px;
  animation: grain 0.5s steps(8) infinite;
}

@keyframes grain {
  0%, 100% { transform: translate(0, 0); }
  10% { transform: translate(-2%, -3%); }
  20% { transform: translate(3%, 1%); }
  30% { transform: translate(-1%, 2%); }
  40% { transform: translate(2%, -2%); }
  50% { transform: translate(-3%, 3%); }
  60% { transform: translate(1%, -1%); }
  70% { transform: translate(-2%, 1%); }
  80% { transform: translate(3%, -3%); }
  90% { transform: translate(-1%, 2%); }
}

/* 胶片划痕 */
.film-scratches {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    90deg,
    transparent,
    transparent 30%,
    rgba(255, 255, 255, 0.01) 30%,
    rgba(255, 255, 255, 0.01) 30.1%,
    transparent 30.1%,
    transparent 60%,
    rgba(255, 255, 255, 0.015) 60%,
    rgba(255, 255, 255, 0.015) 60.05%,
    transparent 60.05%
  );
  animation: scratch-move 4s linear infinite;
}

@keyframes scratch-move {
  0% { transform: translateX(0); }
  100% { transform: translateX(5px); }
}

/* 复古色调叠加 */
.vintage-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(120, 80, 30, 0.08) 0%,
    rgba(0, 0, 0, 0) 30%,
    rgba(0, 0, 0, 0) 70%,
    rgba(120, 80, 30, 0.08) 100%
  );
  mix-blend-mode: multiply;
}

/* 节拍闪烁 */
.beat-flash {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at center,
    rgba(255, 245, 220, 0.3),
    transparent 70%
  );
  transition: opacity 0.1s ease-out;
}

/* 放映机光束 */
.projector-beam {
  position: fixed;
  top: -200px;
  left: 50%;
  transform: translateX(-50%);
  width: 500px;
  height: 500px;
  background: radial-gradient(
    ellipse at center top,
    rgba(255, 250, 230, 0.03),
    transparent 70%
  );
  pointer-events: none;
  z-index: 1;
}

/* --- 布局 --- */
.filmstrip-layout {
  display: grid;
  grid-template-columns: 280px 1fr 200px;
  min-height: 100vh;
  position: relative;
  z-index: 2;
}

/* --- 左侧控制面板 --- */
.film-controls {
  background: rgba(15, 12, 8, 0.95);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  overflow-y: auto;
}

.controls-inner {
  padding: 28px 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.controls-title {
  font-size: 18px;
  font-weight: 600;
  color: rgba(255, 235, 200, 0.85);
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-family: 'Georgia', serif;
}

.reel-icon {
  font-size: 24px;
}

/* 控制组 */
.control-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.control-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 235, 200, 0.5);
  text-transform: uppercase;
  letter-spacing: 1px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.control-value {
  font-family: var(--mono);
  color: rgba(255, 235, 200, 0.7);
}

/* 上传区域 */
.upload-zone {
  position: relative;
  border: 1px dashed rgba(255, 235, 200, 0.15);
  border-radius: 8px;
  padding: 14px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: rgba(255, 255, 255, 0.02);
}

.upload-zone:hover {
  border-color: rgba(255, 235, 200, 0.3);
  background: rgba(255, 255, 255, 0.04);
}

.upload-zone.drag-over {
  border-color: rgba(255, 200, 100, 0.5);
  background: rgba(255, 200, 100, 0.05);
}

.upload-hint {
  font-size: 13px;
  color: rgba(255, 235, 200, 0.35);
}

.file-name {
  font-size: 13px;
  color: rgba(255, 235, 200, 0.6);
  word-break: break-all;
}

.file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* 缩略图列表 */
.thumb-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.thumb-item {
  position: relative;
  width: 44px;
  height: 44px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.thumb-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-remove {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: none;
  background: rgba(200, 50, 50, 0.8);
  color: white;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.thumb-item:hover .thumb-remove {
  display: flex;
}

/* 播放控制按钮 */
.playback-controls {
  display: flex;
  gap: 8px;
}

.film-btn {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid rgba(255, 235, 200, 0.2);
  border-radius: 8px;
  background: rgba(255, 235, 200, 0.06);
  color: rgba(255, 235, 200, 0.8);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.film-btn:hover {
  background: rgba(255, 235, 200, 0.12);
  border-color: rgba(255, 235, 200, 0.35);
}

.film-btn.secondary {
  background: transparent;
  color: rgba(255, 235, 200, 0.5);
}

/* 滑块 */
.film-slider {
  width: 100%;
  height: 4px;
  appearance: none;
  background: rgba(255, 235, 200, 0.1);
  border-radius: 2px;
  outline: none;
}

.film-slider::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(255, 235, 200, 0.7);
  cursor: pointer;
  border: 2px solid rgba(120, 80, 30, 0.5);
}

/* 开关列表 */
.toggle-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.toggle-item {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 0;
}

.toggle-item input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: rgba(200, 160, 80, 0.8);
}

.toggle-label {
  font-size: 13px;
  color: rgba(255, 235, 200, 0.55);
}

/* --- 中间胶片舞台 --- */
.film-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  overflow: hidden;
  position: relative;
  background:
    radial-gradient(ellipse at center, rgba(30, 25, 18, 1) 0%, rgba(10, 10, 10, 1) 80%);
}

/* 胶片容器 */
.film-strip-container {
  display: flex;
  height: 100vh;
  position: relative;
}

/* 齿孔条 */
.sprocket-strip {
  width: 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  background: rgba(20, 18, 14, 0.95);
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.sprocket-strip.left {
  border-radius: 4px 0 0 4px;
  border-right: none;
}

.sprocket-strip.right {
  border-radius: 0 4px 4px 0;
  border-left: none;
}

.sprocket-hole {
  width: 18px;
  height: 12px;
  border-radius: 2px;
  background: rgba(5, 5, 5, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.05);
  flex-shrink: 0;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6);
}

/* 胶片帧视口 */
.film-frames-viewport {
  width: 380px;
  height: 100vh;
  overflow: hidden;
  background: rgba(18, 16, 12, 0.98);
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  position: relative;
}

/* 帧轨道 */
.film-frames-track {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 12px;
  will-change: transform;
}

/* 胶片帧 */
.film-frame {
  flex-shrink: 0;
}

.frame-border {
  position: relative;
  background: #000;
  border: 2px solid rgba(60, 50, 35, 0.6);
  border-radius: 2px;
  overflow: hidden;
  aspect-ratio: 4/3;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.8),
    inset 0 0 20px rgba(0, 0, 0, 0.4);
}

.frame-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  filter: sepia(0.15) contrast(1.1) brightness(0.95);
}

/* 帧编号 */
.frame-number {
  position: absolute;
  bottom: 6px;
  right: 8px;
  font-size: 11px;
  font-family: var(--mono);
  color: rgba(255, 200, 100, 0.35);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

/* 帧标记 */
.frame-marks {
  position: absolute;
  top: 6px;
  left: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.mark-circle {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid rgba(255, 200, 100, 0.2);
}

.mark-line {
  width: 20px;
  height: 1px;
  background: rgba(255, 200, 100, 0.15);
}

/* 空状态 */
.film-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
}

.empty-reel {
  opacity: 0.5;
  animation: reel-spin 8s linear infinite;
}

@keyframes reel-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.empty-text {
  font-size: 16px;
  color: rgba(255, 235, 200, 0.35);
  margin: 0;
  font-family: 'Georgia', serif;
}

.empty-hint {
  font-size: 12px;
  color: rgba(255, 235, 200, 0.2);
  margin: 0;
}

/* --- 右侧信息面板 --- */
.film-info {
  background: rgba(15, 12, 8, 0.95);
  border-left: 1px solid rgba(255, 255, 255, 0.06);
}

.info-inner {
  padding: 28px 16px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* 放映机转盘装饰 */
.projector-deco {
  display: flex;
  justify-content: center;
}

.projector-deco.bottom {
  margin-top: auto;
}

.reel {
  transition: none;
}

.reel.spinning {
  animation: reel-spin 3s linear infinite;
}

.reel-bottom.spinning {
  animation: reel-spin 4s linear infinite reverse;
}

/* 信息块 */
.info-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-label {
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 235, 200, 0.35);
  text-transform: uppercase;
  letter-spacing: 1.5px;
}

.info-value {
  font-size: 14px;
  color: rgba(255, 235, 200, 0.6);
  font-family: var(--mono);
}

.info-value.counter {
  font-size: 28px;
  font-weight: 300;
  color: rgba(255, 235, 200, 0.5);
}

.info-value.small {
  font-size: 12px;
  word-break: break-all;
  font-family: var(--sans);
}

/* --- 响应式 --- */
@media (max-width: 900px) {
  .filmstrip-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto;
  }

  .film-controls {
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .film-info {
    border-left: none;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .film-strip-container {
    height: 60vh;
  }

  .film-frames-viewport {
    height: 60vh;
    width: 320px;
  }

  .projector-deco {
    display: none;
  }
}

@media (max-width: 600px) {
  .film-frames-viewport {
    width: 260px;
  }
}
</style>
