import { ref, computed, watch } from 'vue'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'flika-theme'

function getSystemPreference(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
  document.documentElement.style.colorScheme = t
}

// Module-level ref — shared singleton across all consumers
const theme = ref<Theme>('dark')

/** Reactive canvas background color — import directly for use in render loops */
export const canvasBg = computed(() => theme.value === 'dark' ? '#000' : '#e8e8f0')

let initialized = false

export function useTheme() {
  if (!initialized) {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
    theme.value = stored ?? getSystemPreference()
    applyTheme(theme.value)

    watch(theme, (newTheme) => {
      localStorage.setItem(STORAGE_KEY, newTheme)
      applyTheme(newTheme)
    })

    // Follow system preference changes when user hasn't explicitly chosen
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        theme.value = e.matches ? 'light' : 'dark'
      }
    })

    // Enable transitions after initial paint
    requestAnimationFrame(() => {
      document.documentElement.setAttribute('data-theme-ready', '')
    })

    initialized = true
  }

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  function setTheme(t: Theme) {
    theme.value = t
  }

  const isDark = computed(() => theme.value === 'dark')

  return {
    theme,
    isDark,
    toggleTheme,
    setTheme,
  }
}
