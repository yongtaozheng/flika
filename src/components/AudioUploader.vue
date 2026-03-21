<script setup lang="ts">
import { ref, computed } from 'vue'
import { isTauri, pickAudioFile } from '../utils/filePicker'

const emit = defineEmits<{ upload: [file: File] }>()

const isDragging = ref(false)
const fileName = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const acceptTypes = '.mp3,.wav,.ogg,.flac,.aac,.m4a'

function handleDragOver(e: DragEvent) { e.preventDefault(); isDragging.value = true }
function handleDragLeave() { isDragging.value = false }

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files?.length) processFile(files[0])
}

function handleFileInput(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files?.length) processFile(target.files[0])
}

function processFile(file: File) {
  if (!file.type.startsWith('audio/')) { alert('请选择音频文件'); return }
  fileName.value = file.name
  emit('upload', file)
}

async function triggerFileInput() {
  if (isTauri()) {
    const file = await pickAudioFile()
    if (file) processFile(file)
  } else {
    fileInputRef.value?.click()
  }
}

const displayName = computed(() => {
  if (!fileName.value) return ''
  return fileName.value.length > 32 ? fileName.value.slice(0, 29) + '…' : fileName.value
})

const ext = computed(() => fileName.value.split('.').pop()?.toUpperCase() ?? '')
</script>

<template>
  <div class="audio-uploader">
    <input
      ref="fileInputRef"
      type="file"
      :accept="acceptTypes"
      class="hidden"
      @change="handleFileInput"
    />

    <!-- Loaded state: compact row -->
    <div v-if="fileName" class="loaded-row" @click="triggerFileInput" title="点击重新选择">
      <div class="audio-icon-wrap loaded">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
      </div>
      <div class="loaded-info">
        <span class="loaded-name">{{ displayName }}</span>
        <span class="loaded-ext">{{ ext }}</span>
      </div>
      <div class="loaded-action">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        更换
      </div>
    </div>

    <!-- Empty state: drop zone -->
    <div
      v-else
      class="drop-zone"
      :class="{ dragging: isDragging }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @click="triggerFileInput"
    >
      <div class="drop-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
      </div>
      <p class="drop-label">拖放音频到此处</p>
      <p class="drop-hint">或点击选择 · MP3 / WAV / OGG / FLAC</p>
    </div>
  </div>
</template>

<style scoped>
.hidden { display: none; }

/* ── Loaded row ── */
.loaded-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--teal-dim);
  border: 1px solid rgba(29, 201, 158, 0.2);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.loaded-row:hover {
  background: rgba(29, 201, 158, 0.18);
  border-color: rgba(29, 201, 158, 0.35);
}

.audio-icon-wrap.loaded {
  width: 32px;
  height: 32px;
  border-radius: var(--r-sm);
  background: rgba(29, 201, 158, 0.15);
  color: var(--teal);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.loaded-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.loaded-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.loaded-ext {
  font-size: 11px;
  color: var(--teal);
  font-weight: 600;
  letter-spacing: 0.05em;
}

.loaded-action {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--text-3);
  flex-shrink: 0;
  transition: color 0.15s;
}

.loaded-row:hover .loaded-action { color: var(--text-2); }

/* ── Drop zone ── */
.drop-zone {
  border: 1.5px dashed var(--border-hover);
  border-radius: var(--r-md);
  padding: 24px 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.drop-zone:hover {
  border-color: rgba(112, 96, 255, 0.4);
  background: var(--accent-dim);
}

.drop-zone.dragging {
  border-color: var(--accent);
  background: var(--accent-dim);
  transform: scale(1.01);
}

.drop-icon {
  color: var(--text-3);
  margin-bottom: 2px;
  transition: color 0.2s;
}

.drop-zone:hover .drop-icon,
.drop-zone.dragging .drop-icon { color: #a898ff; }

.drop-label {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-2);
}

.drop-hint {
  font-size: 11.5px;
  color: var(--text-3);
}
</style>
