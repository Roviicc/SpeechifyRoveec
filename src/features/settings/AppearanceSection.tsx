import { useSettings } from '@/state/settings'
import { ThemePicker } from '@/features/reader/sheets'
import { Group } from './Group'

export function AppearanceSection() {
  const theme = useSettings((s) => s.theme)
  const set = useSettings((s) => s.set)
  return (
    <Group title="Appearance">
      <div className="py-2">
        <ThemePicker value={theme} onChange={(theme) => set({ theme })} />
      </div>
    </Group>
  )
}
