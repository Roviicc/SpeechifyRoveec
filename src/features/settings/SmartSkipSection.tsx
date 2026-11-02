import { useSettings } from '@/state/settings'
import { DEFAULT_SKIP } from '@/engine/text/types'
import { Toggle } from '@/ui/controls'
import { Group } from './Group'

export function SmartSkipSection() {
  const st = useSettings()
  // settings saved before a toggle existed lack its key: show the default
  const cur = { ...DEFAULT_SKIP, ...st.skip }
  const skip = (k: keyof typeof cur, v: boolean) => st.set({ skip: { ...cur, [k]: v } })
  return (
    <Group title="Smart skip">
      <Toggle label="Headers & footers" description="Lines repeated at the top/bottom of PDF pages" checked={cur.headersFooters} onChange={(v) => skip('headersFooters', v)} />
      <Toggle label="Page numbers" checked={cur.pageNumbers} onChange={(v) => skip('pageNumbers', v)} />
      <Toggle label="Citations" description="Like [12] or (Smith, 2020)" checked={cur.citations} onChange={(v) => skip('citations', v)} testId="toggle-skip-citations" />
      <Toggle label="Footnote markers" checked={cur.footnotes} onChange={(v) => skip('footnotes', v)} />
      <Toggle label="Footnotes" description="Small print at the bottom of PDF pages" checked={cur.footnoteText} onChange={(v) => skip('footnoteText', v)} testId="toggle-skip-footnote-text" />
      <Toggle label="Figure & table captions" description="Short lines like “Figure 3.” in PDFs" checked={cur.captions} onChange={(v) => skip('captions', v)} testId="toggle-skip-captions" />
      <Toggle label="Tables" description="Rows of numbers and short cells in PDFs" checked={cur.tables} onChange={(v) => skip('tables', v)} testId="toggle-skip-tables" />
      <Toggle label="Read URLs as “link”" checked={cur.urls} onChange={(v) => skip('urls', v)} />
    </Group>
  )
}
