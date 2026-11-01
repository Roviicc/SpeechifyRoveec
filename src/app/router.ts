import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'settings' }
  | { name: 'reader'; bookId: string }
  | { name: 'tts' }

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, '')
  const [head, arg] = h.split('/')
  if (head === 'settings') return { name: 'settings' }
  if (head === 'tts') return { name: 'tts' }
  if (head === 'read' && arg) return { name: 'reader', bookId: decodeURIComponent(arg) }
  return { name: 'library' }
}

export function routeHref(r: Route): string {
  switch (r.name) {
    case 'library':
      return '#/'
    case 'settings':
      return '#/settings'
    case 'tts':
      return '#/tts'
    case 'reader':
      return `#/read/${encodeURIComponent(r.bookId)}`
  }
}

export function navigate(r: Route, replace = false) {
  const href = routeHref(r)
  if (replace) history.replaceState(null, '', href)
  else history.pushState(null, '', href)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

const subscribe = (fn: () => void) => {
  window.addEventListener('hashchange', fn)
  window.addEventListener('popstate', fn)
  return () => {
    window.removeEventListener('hashchange', fn)
    window.removeEventListener('popstate', fn)
  }
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash)
  return parseRoute(hash)
}
