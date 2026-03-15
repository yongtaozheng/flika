<script setup lang="ts">
import { ref, computed } from 'vue'

const emit = defineEmits<{
  upload: [file: File]
}>()

const isDragging = ref(false)
const fileName = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

const acceptTypes = '.mp3,.wav,.ogg,.flac,.aac,.m4a'

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

function handleDragLeave() {
  isDragging.value = false
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    processFile(files[0])
  }
}

function handleFileInput(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    processFile(target.files[0])
  }
}

function processFile(file: File) {
  if (!file.type.startsWith('audio/')) {
    alert('请选择音频文件')
    return
  }
  fileName.value = file.name
  emit('upload', file)
}

function triggerFileInput() {
  fileInputRef.value?.click()
}

const displayName = computed(() => {
  if (!fileName.value) return ''
  if (fileName.value.length > 30) {
    return fileName.value.slice(0, 27) + '...'
  }
  return fileName.value
})
</script>

<template>
  <div class="audio-uploader">
    <div
      class="drop-zone"
      :class="{ dragging: isDragging, 'has-file': !!fileName }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @click="triggerFileInput"
    >
      <input
        ref="fileInputRef"
        type="file"
        :accept="acceptTypes"
        class="hidden-input"
        @change="handleFileInput"
      />
      <div class="drop-content" v-if="!fileName">
        <div class="icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
        <p class="label">拖放音频文件到此处</p>
        <p class="hint">或点击选择文件</p>
        <p class="formats">支持 MP3, WAV, OGG, FLAC, AAC</p>
      </div>
      <div class="file-info" v-else>
        <div class="icon success">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <p class="file-name">{{ displayName }}</p>
        <p class="hint">点击重新选择</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.audio-uploader {
  width: 100%;
}

.drop-zone {
  border: 2px dashed rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  padding: 32px 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  background: rgba(255, 255, 255, 0.03);
}

.drop-zone:hover {
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.06);
}

.drop-zone.dragging {
  border-color: #646cff;
  background: rgba(100, 108, 255, 0.1);
  transform: scale(1.02);
}

.drop-zone.has-file {
  border-color: rgba(76, 175, 80, 0.5);
  background: rgba(76, 175, 80, 0.08);
}

.hidden-input {
  display: none;
}

.drop-content,
.file-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.icon {
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 8px;
}

.icon.success {
  color: #4caf50;
}

.label {
  font-size: 16px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
  margin: 0;
}

.file-name {
  font-size: 16px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  margin: 0;
}

.hint {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  margin: 0;
}

.formats {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.25);
  margin: 4px 0 0 0;
}
</style>
