import type { ReactNode } from 'react'
import { Sheet } from '@/ui/Sheet'
import { Segmented, Slider } from '@/ui/controls'
import { useSettings, type FontFamily, type Margin } from '@/state/settings'
import { ThemePicker } from './ThemePicker'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-2.5">
      <div className="mb-1.5 text-sm font-medium text-muted">{label}</div>
      {children}
    </div>
  )
}

export function TextSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const st = useSettings()
  return (
    <Sheet open={open} onClose={onClose} title="Text" testId="text-sheet">
      <div
        className="mb-4 rounded-[16px] bg-surface p-4"
        style={{
          fontSize: st.fontSize,
          lineHeight: st.lineHeight,
          fontFamily: st.fontFamily === 'serif' ? 'var(--font-serif)' : st.fontFamily === 'sans' ? 'var(--font-sans)' : 'var(--font-dyslexic)',
        }}
      >
        The quick brown fox jumps over the lazy dog.
      </div>
      <Row label={`Font size · ${st.fontSize}px`}>
        <div className="flex items-center gap-3">
          <span className="text-xs">A</span>
          <Slider label="Font size" min={12} max={32} step={1} value={st.fontSize} onChange={(v) => st.set({ fontSize: v })} testId="font-size" />
          <span className="text-xl">A</span>
        </div>
      </Row>
      <Row label="Font">
        <Segmented<FontFamily>
          label="Font family"
          value={st.fontFamily}
          onChange={(v) => st.set({ fontFamily: v })}
          options={[
            { value: 'serif', label: <span style={{ fontFamily: 'var(--font-serif)' }}>Serif</span> },
            { value: 'sans', label: 'Sans' },
            { value: 'dyslexic', label: <span style={{ fontFamily: 'var(--font-dyslexic)' }}>OpenDyslexic</span> },
          ]}
        />
      </Row>
      <Row label={`Line spacing · ${st.lineHeight.toFixed(1)}`}>
        <Slider label="Line spacing" min={1.2} max={2.2} step={0.1} value={st.lineHeight} onChange={(v) => st.set({ lineHeight: Math.round(v * 10) / 10 })} />
      </Row>
      <Row label="Margins">
        <Segmented<Margin>
          label="Margins"
          value={st.margin}
          onChange={(v) => st.set({ margin: v })}
          options={[
            { value: 'narrow', label: 'Narrow' },
            { value: 'normal', label: 'Normal' },
            { value: 'wide', label: 'Wide' },
          ]}
        />
      </Row>
      <Row label="Theme">
        <ThemePicker value={st.theme} onChange={(theme) => st.set({ theme })} />
      </Row>
    </Sheet>
  )
}
