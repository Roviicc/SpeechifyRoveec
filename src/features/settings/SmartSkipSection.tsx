import { useSettings } from '../../store/settings'
import { Toggle } from '../../ui/controls'
import { Group } from './Group'

export function SmartSkipSection() {
  const st = useSettings()
  const skip = (k: keyof typeof st.skip, v: boolean) => st.set({ skip: { ...st.skip, [k]: v } })
  return (
    <Group title="Smart skip">
      <Toggle label="Headers & footers" description="Lines repeated at the top/bottom of PDF pages" checked={st.skip.headersFooters} onChange={(v) => skip('headersFooters', v)} />
      <Toggle label="Page numbers" checked={st.skip.pageNumbers} onChange={(v) => skip('pageNumbers', v)} />
      <Toggle label="Citations" description="Like [12] or (Smith, 2020)" checked={st.skip.citations} onChange={(v) => skip('citations', v)} testId="toggle-skip-citations" />
      <Toggle label="Footnote markers" checked={st.skip.footnotes} onChange={(v) => skip('footnotes', v)} />
      <Toggle label="Read URLs as “link”" checked={st.skip.urls} onChange={(v) => skip('urls', v)} />
    </Group>
  )
}
