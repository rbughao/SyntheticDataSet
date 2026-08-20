import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'synthgen_theme'

/** 'light' | 'dark' | 'system' */
function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function apply(mode) {
  const dark = mode === 'dark' || (mode === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
}

/**
 * Theme state with three modes. 'system' follows the OS and keeps following it
 * live, so the app changes with the user's schedule without a reload.
 */
export function useTheme() {
  const [mode, setMode] = useState(readStored)

  useEffect(() => {
    apply(mode)
    try { localStorage.setItem(STORAGE_KEY, mode) } catch { /* storage disabled */ }
  }, [mode])

  // Track OS changes while in 'system' mode
  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  const isDark = mode === 'dark' || (mode === 'system' && systemPrefersDark())

  /** Cycle light → dark → system → light */
  const cycle = useCallback(() => {
    setMode((m) => (m === 'light' ? 'dark' : m === 'dark' ? 'system' : 'light'))
  }, [])

  return { mode, setMode, cycle, isDark }
}

/**
 * Apply the stored theme before React mounts, so there is no light flash on
 * load for dark-mode users. Called from main.jsx.
 */
export function initTheme() {
  apply(readStored())
}
