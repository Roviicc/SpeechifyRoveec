import { useRef, useState } from 'react'
import { FolderOpen, HardDrive, Loader2 } from 'lucide-react'
import { Sheet } from '@/ui/Sheet'
import { toast } from '@/ui/toast'
import { importBook } from './importBook'
import { driveConfigured, pickDriveFiles } from '@/sync/drive/google'
import { drive, syncSoon } from '@/sync/syncService'

export function useImporter() {
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (files: Array<{ name: string; get: () => Promise<Blob>; source?: 'local' | 'drive'; driveFileId?: string }>) => {
    let last: string | null = null
    for (const f of files) {
      setBusy(`Importing “${f.name}”…`)
      try {
        const blob = await f.get()
        last = await importBook(blob, f.name, {
          source: f.source,
          driveFileId: f.driveFileId,
          onProgress: (p) => setBusy(`Reading “${f.name}”… ${Math.round(p * 100)}%`),
        })
      } catch (e) {
        toast((e as Error).message, 6000)
      }
    }
    setBusy(null)
    if (last) syncSoon()
    return last
  }
  return { busy, run }
}

export function ImportSheet({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (id: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const { busy, run } = useImporter()

  const fromFiles = async (list: FileList | null) => {
    if (!list?.length) return
    const id = await run(Array.from(list).map((f) => ({ name: f.name, get: async () => f })))
    onImported(id)
  }

  const fromDrive = async () => {
    try {
      const picked = await pickDriveFiles()
      if (!picked.length) return
      const id = await run(picked.map((d) => ({ name: d.name, source: 'drive' as const, driveFileId: d.id, get: () => drive.download(d.id) })))
      onImported(id)
    } catch (e) {
      toast((e as Error).message, 6000)
    }
  }

  const row = 'flex min-h-16 w-full items-center gap-4 rounded-[16px] px-3 text-left text-[16px] font-medium hover:bg-surface disabled:opacity-50'
  return (
    <Sheet open={open} onClose={onClose} title="Import" testId="import-sheet">
      <input
        ref={input}
        type="file"
        accept=".epub,.pdf,application/epub+zip,application/pdf"
        multiple
        hidden
        data-testid="file-input"
        onChange={(e) => {
          void fromFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <button className={row} onClick={() => input.current?.click()} disabled={!!busy} data-testid="import-files">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-primary-soft text-primary">
          <FolderOpen size={22} />
        </span>
        Files
      </button>
      <button className={row} onClick={() => void fromDrive()} disabled={!!busy || !driveConfigured} data-testid="import-drive">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-primary-soft text-primary">
          <HardDrive size={22} />
        </span>
        <span>
          Google Drive
          {!driveConfigured && <span className="block text-xs font-normal text-muted">Not configured — see README</span>}
        </span>
      </button>
      {busy && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted" aria-live="polite" data-testid="import-busy">
          <Loader2 size={16} className="animate-spin" /> {busy}
        </p>
      )}
    </Sheet>
  )
}
