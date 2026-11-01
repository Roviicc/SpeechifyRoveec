import { create } from 'zustand'

interface Toast {
  id: number
  text: string
}
export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }))
let n = 0
export function toast(text: string, ms = 3500) {
  const id = ++n
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, text }] }))
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms)
}
