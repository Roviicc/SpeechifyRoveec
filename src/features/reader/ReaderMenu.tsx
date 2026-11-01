import { MoreHorizontal, Moon, NotebookPen, Search } from 'lucide-react'
import { IconButton } from '../../ui/controls'
import type { MenuPanel } from './panels'

const ITEMS: Array<{ k: MenuPanel; icon: React.ReactNode; label: string }> = [
  { k: 'search', icon: <Search size={18} />, label: 'Search' },
  { k: 'notes', icon: <NotebookPen size={18} />, label: 'Notes & Bookmarks' },
  { k: 'sleep', icon: <Moon size={18} />, label: 'Sleep timer' },
]

/** The "•••" button of the reader top bar and its dropdown menu. */
export function ReaderMenu({ open, onToggle, onClose, onSelect }: { open: boolean; onToggle: () => void; onClose: () => void; onSelect: (k: MenuPanel) => void }) {
  return (
    <div className="relative">
      <IconButton label="More" onClick={onToggle} data-testid="more-button" aria-expanded={open}>
        <MoreHorizontal size={22} />
      </IconButton>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onClose} />
          <div role="menu" className="anim-fade absolute top-12 right-0 z-40 w-56 overflow-hidden rounded-[16px] border border-line bg-bg py-1 shadow-[var(--shadow)]">
            {ITEMS.map((m) => (
              <button key={m.k} role="menuitem" data-testid={`menu-${m.k}`} onClick={() => onSelect(m.k)} className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] hover:bg-surface">
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
