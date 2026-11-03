import { toast } from '@/ui/toast'

/** Where "Look up" sends a word. Websites can't list installed apps, so these are known dictionary apps. */
export type LookupApp = 'android-app' | 'share' | 'colordict' | 'translate' | 'merriam' | 'dictionarycom' | 'wiktionary' | 'google'

export interface LookupTarget {
  id: LookupApp
  name: string
  note: string
  /** small app icon (public/icons/dict); none for "My apps" */
  icon?: string
}

/** Android package of the Lumen app (APK). Inside it, a native helper opens dictionaries as a popup. */
export const ANDROID_PACKAGE = 'app.lumen.reader'
const IN_APP_KEY = 'lumen-in-android-app'

/** True when Lumen runs inside the Lumen Android app (Trusted Web Activity). Remembered after the first launch. */
export function inAndroidApp(): boolean {
  try {
    // the APK opens the site with ?app=android (and Chrome passes it as the referrer on launch)
    const fromApp = new URLSearchParams(location.search).get('app') === 'android' || document.referrer.startsWith(`android-app://${ANDROID_PACKAGE}`)
    if (fromApp) localStorage.setItem(IN_APP_KEY, '1')
    return localStorage.getItem(IN_APP_KEY) === '1'
  } catch {
    return false
  }
}

/** Any Android phone (the Lumen app may be installed even if this page wasn't opened from it). */
export const onAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

/** Ask the app's native helper (lumen://…) — only works inside the Lumen Android app. */
export function nativeHelperUrl(action: 'lookup' | 'choose', query = ''): string {
  const q = action === 'lookup' ? `?q=${encodeURIComponent(query)}` : ''
  // without the app, go to Lumen's own "get the app" page instead of the Play Store (Lumen isn't on it)
  const fallback = encodeURIComponent(`${location.origin}/get-app.html`)
  return `intent://${action}${q}#Intent;scheme=lumen;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`
}

/** Pick the dictionary from the apps installed on the phone (native list, Lumen Android app only). */
export function chooseInstalledDictionary() {
  openNative(nativeHelperUrl('choose'))
}

/** Start the Lumen app's helper; if nothing opens (no Lumen app on this phone), say so. */
function openNative(url: string) {
  let left = false
  const onHide = () => (left = true)
  document.addEventListener('visibilitychange', onHide, { once: true })
  location.href = url
  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide)
    if (!left && document.visibilityState === 'visible' && !inAndroidApp()) toast('This needs the Lumen Android app. Pick another dictionary in Settings → Reading.', 8000)
  }, 1800)
}

export const ANDROID_APP_TARGET: LookupTarget = {
  id: 'android-app',
  name: 'My apps',
  note: 'Any dictionary on this phone',
}

export const LOOKUP_APPS: LookupTarget[] = [
  { id: 'colordict', name: 'ColorDict', note: 'Popup', icon: '/icons/dict/colordict.webp' },
  { id: 'translate', name: 'Google Translate', note: 'App or website', icon: '/icons/dict/translate.png' },
  { id: 'merriam', name: 'Merriam-Webster', note: 'App or website', icon: '/icons/dict/merriam.png' },
  { id: 'dictionarycom', name: 'Dictionary.com', note: 'App or website', icon: '/icons/dict/dictionarycom.png' },
  { id: 'wiktionary', name: 'Wiktionary', note: 'Website', icon: '/icons/dict/wiktionary.png' },
  { id: 'google', name: 'Google “define”', note: 'Website', icon: '/icons/dict/google.png' },
]

/** Dictionaries offered here: "My apps" first on Android phones. */
export const lookupOptions = (): LookupTarget[] => (onAndroid() || inAndroidApp() ? [ANDROID_APP_TARGET, ...LOOKUP_APPS] : LOOKUP_APPS)

/** 'share' (the old "Ask every time") is gone: treat it as the phone's apps on Android, else Wiktionary. */
export const effectiveLookup = (id: LookupApp): LookupApp => (id === 'share' ? (onAndroid() ? 'android-app' : 'wiktionary') : id)

export const lookupAppName = (id: LookupApp) => {
  const e = effectiveLookup(id)
  return e === 'android-app' ? ANDROID_APP_TARGET.name : (LOOKUP_APPS.find((a) => a.id === e)?.name ?? 'Wiktionary')
}

/** Text to send: a word or short phrase, without surrounding punctuation. */
export function cleanQuery(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/^[“"'‘([]+|[”"'’).,;:!?\]]+$/g, '').slice(0, 200)
}

/** Web addresses that Android opens in the matching app when it is installed (App Links). */
export function lookupUrl(app: LookupApp, query: string): string | null {
  const q = encodeURIComponent(query)
  switch (app) {
    case 'translate':
      return `https://translate.google.com/?sl=auto&tl=en&op=translate&text=${q}`
    case 'merriam':
      return `https://www.merriam-webster.com/dictionary/${q}`
    case 'dictionarycom':
      return `https://www.dictionary.com/browse/${q}`
    case 'wiktionary':
      return `https://en.wiktionary.org/wiki/${encodeURIComponent(query.toLowerCase().replace(/ /g, '_'))}`
    case 'google':
      return `https://www.google.com/search?q=${encodeURIComponent('define ' + query)}`
    default:
      return null
  }
}

/** ColorDict's lookup request (the one Moon+ Reader uses), sent through Chrome as an intent: URL. */
export function colorDictIntent(query: string): string {
  return (
    'intent:#Intent;action=colordict.intent.action.SEARCH;package=com.socialnmobile.colordict;' +
    `S.EXTRA_QUERY=${encodeURIComponent(query)};B.EXTRA_FULLSCREEN=false;end`
  )
}

function openColorDict(query: string) {
  let left = false
  const onHide = () => (left = true)
  document.addEventListener('visibilitychange', onHide, { once: true })
  location.href = colorDictIntent(query)
  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide)
    if (!left && document.visibilityState === 'visible')
      toast('ColorDict didn’t open from the browser. Choose another dictionary in Settings → Reading → Dictionary app.', 8000)
  }, 1800)
}

/** Look a word up in the dictionary app chosen in Settings. */
export async function lookUp(text: string, chosen: LookupApp) {
  const query = cleanQuery(text)
  if (!query) return
  const app = effectiveLookup(chosen)
  if (app === 'android-app') {
    openNative(nativeHelperUrl('lookup', query))
    return
  }
  if (app === 'colordict') return inAndroidApp() ? void (location.href = nativeHelperUrl('lookup', query)) : openColorDict(query)
  const url = lookupUrl(app, query)
  if (url) {
    // a new navigation lets Android hand the link to the installed app
    window.open(url, '_blank', 'noopener')
    return
  }
  if (navigator.share) {
    try {
      await navigator.share({ text: query })
    } catch {
      /* picker closed */
    }
    return
  }
  await navigator.clipboard?.writeText(query).catch(() => {})
  toast(`Copied “${query}” — sharing isn’t available in this browser`)
}
