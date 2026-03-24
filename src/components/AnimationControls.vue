<script setup lang="ts">
import { computed, ref } from 'vue'
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
  isExporting: boolean
}>()

const emit = defineEmits<{
  'update:config': [config: AnimationConfig]
  'toggle-play': []
  'stop': []
  'seek': [time: number]
  'export': []
}>()

// ── Time ──
function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

const progressPct = computed(() =>
  props.duration > 0 ? (props.currentTime / props.duration) * 100 : 0
)

// ── Seekbar drag ──
const seekbarRef = ref<HTMLElement | null>(null)

function seekPercent(e: MouseEvent): number {
  if (!seekbarRef.value) return 0
  const r = seekbarRef.value.getBoundingClientRect()
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
}

function handleSeekDown(e: MouseEvent) {
  emit('seek', seekPercent(e) * props.duration)
  const onMove = (ev: MouseEvent) => emit('seek', seekPercent(ev) * props.duration)
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// ── Config helpers ──
function updateConfig(partial: Partial<AnimationConfig>) {
  emit('update:config', { ...props.config, ...partial })
}

function toggleEffect(index: number) {
  const effects = [...props.config.effects]
  effects[index] = { ...effects[index], enabled: !effects[index].enabled }
  updateConfig({ effects })
}

// ── Effect categories ──
const effectCat: Record<string, string> = {
  zoom: 'motion', bounce: 'motion', shake: 'motion', heartbeat: 'motion', rotate: 'motion',
  switch: 'transition', slide: 'transition', fadeIn: 'transition', flipX: 'transition', blur: 'transition',
  glitch: 'distort', vortex: 'distort', chromatic: 'distort', wave: 'distort', split: 'distort', pixelate: 'distort',
  flash: 'color', colorInvert: 'color', neonGlow: 'color',
}
function catOf(type: string) { return effectCat[type] ?? 'motion' }

// ── Slider fill ──
function sliderFill(value: number, min: number, max: number) {
  const pct = ((value - min) / (max - min)) * 100
  return {
    background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--surface-3) ${pct}%, var(--surface-3) 100%)`,
  }
}
</script>

<template>
  <div class="controls">

    <!-- ══ TRANSPORT ══ -->
    <div class="ctrl-block transport-block">
      <!-- Seekbar -->
      <div class="seekbar" ref="seekbarRef" @mousedown="handleSeekDown">
        <div class="seekbar-track">
          <div class="seekbar-fill" :style="{ width: `${progressPct}%` }" />
          <div class="seekbar-thumb" :style="{ left: `${progressPct}%` }" />
        </div>
      </div>

      <!-- Time + meta row -->
      <div class="time-row">
        <span class="time-text">{{ formatTime(currentTime) }}</span>

        <div v-if="isAnalyzing" class="analyze-strip">
          <div class="analyze-fill" :style="{ width: `${analyzeProgress}%` }" />
          <span>分析节拍 {{ Math.round(analyzeProgress) }}%</span>
        </div>
        <div v-else-if="bpm > 0" class="meta-chips">
          <span class="chip">{{ bpm }} BPM</span>
          <span class="chip">{{ beatsCount }} 节拍</span>
        </div>
        <div v-else class="flex-spacer" />

        <span class="time-text">{{ formatTime(duration) }}</span>
      </div>

      <!-- Buttons -->
      <div class="transport-row">
        <button class="btn-stop" @click="$emit('stop')" title="停止并重置">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="5" width="14" height="14" rx="2"/>
          </svg>
        </button>

        <button class="btn-play" @click="$emit('toggle-play')" :title="isPlaying ? '暂停' : '播放'">
          <svg v-if="!isPlaying" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 3 20 12 6 21 6 3"/>
          </svg>
          <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1.5"/>
            <rect x="14" y="4" width="4" height="16" rx="1.5"/>
          </svg>
        </button>

        <button
          class="btn-export"
          :class="{ exporting: isExporting }"
          :disabled="isExporting"
          @click="$emit('export')"
          title="导出视频"
        >
          <svg v-if="!isExporting" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" class="spin">
            <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" opacity="0.25"/>
            <path d="M12 3a9 9 0 0 1 9 9" stroke-linecap="round"/>
          </svg>
          {{ isExporting ? '导出中…' : '导出' }}
        </button>
      </div>
    </div>

    <!-- ══ EFFECTS ══ -->
    <div class="ctrl-block">
      <div class="block-label">
        动画效果
        <span class="label-badge">{{ config.effects.filter(e => e.enabled).length }} 已启用</span>
      </div>

      <div class="effects-grid">
        <button
          v-for="(effect, index) in config.effects"
          :key="effect.type"
          class="fx-btn"
          :class="[`cat-${catOf(effect.type)}`, { active: effect.enabled }]"
          @click="toggleEffect(index)"
          :title="effect.description"
        >
          {{ effect.label }}
        </button>
      </div>

      <div class="fx-legend">
        <span class="legend-item motion">节奏</span>
        <span class="legend-item transition">过渡</span>
        <span class="legend-item distort">扭曲</span>
        <span class="legend-item color">色彩</span>
      </div>
    </div>

    <!-- ══ PARAMETERS ══ -->
    <div class="ctrl-block">
      <div class="block-label">参数</div>

      <div class="param-row">
        <div class="param-header">
          <span>检测灵敏度</span>
          <span class="param-val">{{ Math.round(config.sensitivity * 100) }}%</span>
        </div>
        <input
          type="range" min="0" max="1" step="0.05"
          :value="config.sensitivity"
          :style="sliderFill(config.sensitivity, 0, 1)"
          class="slider"
          @input="updateConfig({ sensitivity: Number(($event.target as HTMLInputElement).value) })"
        />
      </div>

      <div class="param-row">
        <div class="param-header">
          <span>效果持续</span>
          <span class="param-val">{{ config.effectDuration }}ms</span>
        </div>
        <input
          type="range" min="50" max="500" step="10"
          :value="config.effectDuration"
          :style="sliderFill(config.effectDuration, 50, 500)"
          class="slider"
          @input="updateConfig({ effectDuration: Number(($event.target as HTMLInputElement).value) })"
        />
      </div>
    </div>

  </div>
</template>

<style scoped>
.controls { display: flex; flex-direction: column; }

.ctrl-block {
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.block-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.label-badge {
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  font-size: 10.5px;
  color: var(--accent);
  background: var(--accent-dim);
  padding: 1px 7px;
  border-radius: 10px;
}

/* ══ TRANSPORT ══ */
.transport-block { display: flex; flex-direction: column; gap: 10px; }

.seekbar {
  cursor: pointer;
  padding: 7px 0;
  user-select: none;
}

.seekbar-track {
  position: relative;
  height: 5px;
  background: var(--surface-3);
  border-radius: 3px;
}

.seekbar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent) 0%, var(--accent-light) 100%);
  border-radius: 3px;
  pointer-events: none;
}

.seekbar-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%) scale(0);
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--on-accent);
  box-shadow: 0 0 0 2px var(--accent);
  transition: transform 0.12s;
  pointer-events: none;
}

.seekbar:hover .seekbar-thumb { transform: translate(-50%, -50%) scale(1); }

.time-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.flex-spacer { flex: 1; }

.time-text {
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.analyze-strip {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.analyze-strip > span { font-size: 10.5px; color: var(--text-3); text-align: center; }

.analyze-fill {
  height: 3px;
  background: linear-gradient(90deg, var(--accent), var(--accent-light));
  border-radius: 2px;
  transition: width 0.3s;
}

.meta-chips { flex: 1; display: flex; justify-content: center; gap: 6px; }

.chip {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-2);
  background: var(--surface-3);
  padding: 2px 8px;
  border-radius: 10px;
  font-variant-numeric: tabular-nums;
}

.transport-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.btn-stop {
  width: 36px;
  height: 36px;
  border-radius: var(--r-md);
  background: var(--surface-3);
  color: var(--text-2);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.btn-stop:hover { background: var(--surface-4); color: var(--text); }

.btn-play {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 18px var(--accent-glow);
  transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
}
.btn-play:hover {
  background: var(--accent-hi);
  transform: scale(1.07);
  box-shadow: 0 6px 24px var(--accent-glow);
}
.btn-play:active { transform: scale(0.95); }

.btn-export {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 14px;
  border-radius: var(--r-md);
  background: var(--pink-dim);
  color: var(--pink);
  border: 1px solid rgba(232, 77, 138, 0.22);
  font-size: 12.5px;
  font-weight: 600;
  transition: all 0.15s;
}
.btn-export:hover:not(:disabled) {
  background: rgba(232, 77, 138, 0.2);
  border-color: rgba(232, 77, 138, 0.4);
}
.btn-export:disabled { opacity: 0.65; cursor: default; }

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.9s linear infinite; }

/* ══ EFFECTS ══ */
.effects-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
  margin-bottom: 10px;
}

.fx-btn {
  padding: 7px 4px;
  border-radius: var(--r-sm);
  font-size: 11.5px;
  font-weight: 500;
  text-align: center;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-3);
  transition: all 0.13s;
  cursor: pointer;
}

.fx-btn:hover { border-color: var(--border-hover); color: var(--text-2); background: var(--surface-3); }

.fx-btn.active.cat-motion     { background: var(--accent-dim);  border-color: rgba(112,96,255,0.38); color: var(--accent-light); }
.fx-btn.active.cat-transition { background: var(--teal-dim);    border-color: rgba(29,201,158,0.32); color: var(--teal); }
.fx-btn.active.cat-distort    { background: var(--purple-dim);  border-color: rgba(168,85,247,0.32); color: var(--purple); }
.fx-btn.active.cat-color      { background: var(--amber-dim);   border-color: rgba(255,139,61,0.32); color: var(--amber); }

.fx-legend { display: flex; gap: 10px; }

.legend-item {
  font-size: 10.5px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
}
.legend-item::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.legend-item.motion     { color: var(--accent-light); }
.legend-item.motion::before     { background: var(--accent-light); }
.legend-item.transition { color: var(--teal); }
.legend-item.transition::before { background: var(--teal); }
.legend-item.distort    { color: var(--purple); }
.legend-item.distort::before    { background: var(--purple); }
.legend-item.color      { color: var(--amber); }
.legend-item.color::before      { background: var(--amber); }

/* ══ PARAMETERS ══ */
.param-row { margin-bottom: 14px; }
.param-row:last-child { margin-bottom: 0; }

.param-header {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-2);
  margin-bottom: 8px;
}

.param-val {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.slider {
  width: 100%;
  height: 5px;
  -webkit-appearance: none;
  appearance: none;
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--on-accent);
  box-shadow: 0 0 0 2px var(--accent), 0 2px 6px rgba(0,0,0,0.3);
  cursor: pointer;
  transition: transform 0.12s;
}
.slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--on-accent);
  border: 2px solid var(--accent);
  cursor: pointer;
}
</style>
