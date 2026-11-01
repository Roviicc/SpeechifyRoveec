import { Segmented } from '../../../ui/controls'
import type { Theme } from '../../../store/settings'

export function ThemePicker({ value, onChange }: { value: Theme; onChange: (t: Theme) => void }) {
  return (
    <Segmented<Theme>
      label="Theme"
      value={value}
      onChange={onChange}
      options={[
        { value: 'light', label: 'Light' },
        { value: 'sepia', label: 'Sepia' },
        { value: 'dark', label: 'Dark' },
        { value: 'system', label: 'System' },
      ]}
    />
  )
}
