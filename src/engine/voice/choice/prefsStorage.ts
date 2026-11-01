/** localStorage access that never throws (private mode, blocked storage): reads give null, writes are dropped. */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Store `value`, or remove the key when it is null. */
export function writePref(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}
