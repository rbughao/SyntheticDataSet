import { useEffect, useRef } from 'react'

/** True when focus is in a field, so shortcuts don't fire mid-typing. */
function inEditableField(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * Global keyboard shortcuts.
 *
 * Handlers are read from a ref-like object on every event, so callers can pass
 * fresh closures each render without re-binding the listener.
 *
 *   ⌘/Ctrl + K      focus search
 *   ⌘/Ctrl + Enter  generate
 *   ⌘/Ctrl + E      export
 *   /               focus search (when not typing)
 *   Escape          close modal / clear search
 */
export function useKeyboardShortcuts(handlers) {
  // Keep the latest handlers in a ref so callers can pass a fresh object each
  // render without the listener being torn down and re-bound every time.
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    function onKeyDown(e) {
      const h = ref.current
      const mod = e.metaKey || e.ctrlKey
      const editing = inEditableField(e.target)

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        h.focusSearch?.()
        return
      }

      if (mod && e.key === 'Enter') {
        e.preventDefault()
        h.generate?.()
        return
      }

      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        h.export?.()
        return
      }

      // Bare "/" is a search shortcut only when not already typing
      if (e.key === '/' && !mod && !editing) {
        e.preventDefault()
        h.focusSearch?.()
        return
      }

      if (e.key === 'Escape') {
        h.escape?.()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
