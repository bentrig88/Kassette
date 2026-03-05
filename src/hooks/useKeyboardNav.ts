import { useEffect } from 'react'

export function useKeyboardNav(
  onLeft: () => void,
  onRight: () => void,
  enabled = true
) {
  useEffect(() => {
    if (!enabled) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onLeft()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onRight()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onLeft, onRight, enabled])
}
