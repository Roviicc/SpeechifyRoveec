import type { ReactNode } from 'react'

/** A titled card holding one settings section. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 px-1 text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>
      <div className="rounded-[16px] bg-surface px-4 py-2">{children}</div>
    </section>
  )
}
