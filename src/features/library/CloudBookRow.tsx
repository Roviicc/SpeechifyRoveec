import { CloudDownload } from 'lucide-react'
import { Thumb } from '../../ui/controls'
import type { SyncBook } from '../../sync/merge'

/** A book that exists in the synced library (on Google Drive) but not on this device. */
export function CloudBookRow({ book, busy, onDownload }: { book: SyncBook; busy: string | null; onDownload: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-[16px] hover:bg-surface">
      <button className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-2 text-left disabled:opacity-60" disabled={!!busy} onClick={onDownload}>
        <Thumb cover={book.cover} type={book.type} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold">{book.title}</span>
          <span className="mt-0.5 block text-sm text-muted">{busy ?? 'In Google Drive • tap to download'}</span>
        </span>
        <CloudDownload size={20} className="mr-3 text-primary" />
      </button>
    </li>
  )
}
