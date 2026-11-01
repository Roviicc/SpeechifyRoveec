import { Sheet } from '../../../ui/Sheet'
import type { HighlightRow } from '../../../data/db'

/** "Add a note" sheet shown after highlighting with the note button. */
export function NoteEditSheet({
  open,
  onClose,
  highlight,
  text,
  onTextChange,
  onSave,
}: {
  open: boolean
  onClose: () => void
  highlight: HighlightRow | null
  text: string
  onTextChange: (text: string) => void
  onSave: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Add a note" testId="note-sheet">
      {highlight && <p className="mb-3 line-clamp-3 text-sm text-muted italic">“{highlight.text}”</p>}
      <textarea
        data-autofocus
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={4}
        aria-label="Note"
        data-testid="note-input"
        className="w-full rounded-[16px] bg-surface p-4 text-[15px] outline-none focus:ring-2 focus:ring-primary"
        placeholder="Your note"
      />
      <button className="mt-3 h-12 w-full rounded-full bg-primary font-semibold text-on-primary" data-testid="note-save" onClick={onSave}>
        Save note
      </button>
    </Sheet>
  )
}
