import type { ReactNode } from 'react'
import { Bookmark, ChevronDown, FileImage, FileText, Type } from 'lucide-react'
import { navigate } from '../../app/router'
import { IconButton } from '../../ui/controls'

/** Reader top bar: back, title, Aa, bookmark, PDF Original/Text toggle and the "•••" menu (passed as `menu`). */
export function TopBar({
  title,
  bookmarked,
  onToggleBookmark,
  onTextSettings,
  pdfMode,
  onTogglePdfMode,
  menu,
}: {
  title: string
  bookmarked: boolean
  onToggleBookmark: () => void
  onTextSettings: () => void
  /** current view of a PDF; undefined for other books (no toggle shown) */
  pdfMode?: 'text' | 'original'
  onTogglePdfMode: () => void
  menu: ReactNode
}) {
  return (
    <header className="safe-top z-20 flex h-14 shrink-0 items-center gap-0.5 border-b border-line bg-bg px-1.5 sm:px-3">
      <IconButton label="Back to library" onClick={() => navigate({ name: 'library' })} data-testid="reader-back">
        <ChevronDown size={26} />
      </IconButton>
      <h1 className="min-w-0 flex-1 truncate px-1 text-center text-[15px] font-semibold" data-testid="reader-title">
        {title}
      </h1>
      <IconButton label="Text settings" onClick={onTextSettings} data-testid="aa-button">
        <Type size={21} />
      </IconButton>
      <IconButton label={bookmarked ? 'Remove bookmark' : 'Add bookmark'} onClick={onToggleBookmark} data-testid="bookmark-button" aria-pressed={bookmarked}>
        <Bookmark size={21} className={bookmarked ? 'text-primary' : ''} fill={bookmarked ? 'currentColor' : 'none'} />
      </IconButton>
      {pdfMode && (
        <IconButton
          label={pdfMode === 'original' ? 'Switch to text view' : 'Switch to original view'}
          onClick={onTogglePdfMode}
          data-testid="pdf-mode"
          data-mode={pdfMode}
        >
          {pdfMode === 'original' ? <FileText size={21} /> : <FileImage size={21} />}
        </IconButton>
      )}
      {menu}
    </header>
  )
}
