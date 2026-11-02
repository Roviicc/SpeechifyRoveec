import { AppearanceSection } from './AppearanceSection'
import { ReadingSection } from './ReadingSection'
import { SmartSkipSection } from './SmartSkipSection'
import { PronunciationSection } from './PronunciationSection'
import { DriveSection } from './DriveSection'
import { VoiceSection } from './VoiceSection'
import { StorageSection } from './StorageSection'

export function SettingsScreen() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16" data-testid="settings">
      <header className="safe-top flex h-16 items-center">
        <h1 className="text-[28px] font-bold tracking-tight">Settings</h1>
      </header>

      <AppearanceSection />
      <ReadingSection />
      <SmartSkipSection />
      <PronunciationSection />
      <DriveSection />
      <VoiceSection />
      <StorageSection />

      <p className="px-1 text-center text-xs text-muted">Lumen · on-device voice, no account, no server</p>
    </div>
  )
}
