import { useEffect, useRef, useState } from 'react'

interface SubgenreSelectProps {
  /** Available subgenres (NOT including "All" — the component adds it). */
  options: string[]
  /** Currently-selected subgenres; empty array means "All". */
  selected: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

/**
 * Multi-select dropdown with checkboxes. "All" = empty selection (no filter);
 * checking it clears the specific picks. Checking any subgenre unchecks "All".
 */
export function SubgenreSelect({ options, selected, onChange, disabled }: SubgenreSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click while open.
  useEffect(() => {
    if (!open) return
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  // Keyboard support while open: Escape closes (returning focus to the
  // trigger), Tab cycles within the menu instead of escaping into the page.
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
        return
      }
      if (e.key !== 'Tab' || !menuRef.current) return
      const focusables = menuRef.current.querySelectorAll<HTMLElement>('input[type="checkbox"]')
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && (active === first || !menuRef.current.contains(active))) { e.preventDefault(); last.focus() }
      else if (!menuRef.current.contains(active)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const label =
    selected.length === 0 ? 'All' : selected.length === 1 ? selected[0] : `${selected.length} subgenres`

  function toggle(opt: string) {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt])
  }

  return (
    <div className="pf-subgenre-root" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="pf-subgenre"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && !disabled && (
        <div ref={menuRef} className="pf-subgenre-menu" role="listbox" aria-multiselectable="true">
          <label className="pf-subgenre-opt">
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
            <span>All</span>
          </label>
          {options.map((opt) => (
            <label key={opt} className="pf-subgenre-opt">
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
