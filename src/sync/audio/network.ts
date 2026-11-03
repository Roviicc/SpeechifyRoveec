/** The bits of the Network Information API we read (Chrome/Android; absent in Safari and Firefox). */
export interface ConnectionLike {
  type?: string
  saveData?: boolean
  addEventListener?(type: 'change', fn: () => void): void
}

export function currentConnection(): ConnectionLike | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: ConnectionLike }).connection
}

/**
 * Whether prepared audio may be downloaded automatically: on Wi‑Fi or Ethernet. Where the browser doesn't say what
 * kind of network it is on (desktop Chrome has no `type`, Safari/Firefox have no `connection`), it is allowed unless
 * the user asked to save data. Manual downloads ignore this.
 */
export function autoDownloadAllowed(conn: ConnectionLike | undefined = currentConnection()): boolean {
  if (!conn) return true
  if (conn.saveData) return false
  if (!conn.type) return true
  return conn.type === 'wifi' || conn.type === 'ethernet'
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}
