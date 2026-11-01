import { X } from 'lucide-react'
import { IconButton } from '@/ui/controls'

/** "Continue from <chapter>?" banner over the top of the text. */
export function ResumeBanner({ sectionTitle, onContinue, onStartOver }: { sectionTitle: string; onContinue: () => void; onStartOver: () => void }) {
  return (
    <div className="anim-fade absolute top-3 right-3 left-3 z-10 mx-auto flex max-w-md items-center gap-3 rounded-[16px] border border-line bg-bg p-3 shadow-[var(--shadow)]" data-testid="resume-banner">
      <p className="min-w-0 flex-1 text-[15px]">
        Continue from <b className="font-semibold">{sectionTitle || 'where you left off'}</b>?
      </p>
      <button className="h-10 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary" onClick={onContinue} data-testid="resume-continue">
        Continue
      </button>
      <IconButton label="Start from the beginning" className="h-10 w-10" onClick={onStartOver}>
        <X size={18} />
      </IconButton>
    </div>
  )
}
