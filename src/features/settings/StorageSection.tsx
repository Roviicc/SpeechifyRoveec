import { useEffect, useState } from 'react'
import { audioStore } from '@/data/audioCache'
import { toast } from '@/ui/toast'
import { Group } from './Group'

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`
}

export function StorageSection() {
  const [cacheSize, setCacheSize] = useState<number | null>(null)

  useEffect(() => {
    void audioStore.totalSize().then(setCacheSize)
  }, [])

  return (
    <Group title="Storage">
      <div className="flex min-h-12 items-center gap-3 py-2">
        <span className="flex-1 text-[15px]">
          Audio cache
          <span className="block text-sm text-muted">{cacheSize === null ? '…' : mb(cacheSize)} of 500 MB</span>
        </span>
        <button
          className="h-10 rounded-full bg-bg px-4 text-sm font-semibold"
          onClick={async () => {
            await audioStore.clear()
            setCacheSize(0)
            toast('Audio cache cleared')
          }}
        >
          Clear
        </button>
      </div>
    </Group>
  )
}
