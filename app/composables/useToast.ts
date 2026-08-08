/**
 * App-wide toasts, replacing `alert()`.
 *
 * A native alert blocks the whole page until dismissed, can't be styled, and
 * stacks badly — for the sync button, the app's most frequent action, it froze
 * the UI on every completion.
 *
 * State is module-level rather than in a plugin so any component can push a
 * toast without wiring, and `useState` keeps it consistent across SSR.
 */

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  /** Milliseconds before auto-dismiss; errors stay until dismissed. */
  timeout: number
}

let nextId = 1

export function useToast() {
  const toasts = useState<Toast[]>('toasts', () => [])

  const dismiss = (id: number) => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  const push = (message: string, kind: ToastKind = 'info', timeout?: number) => {
    const id = nextId++
    // Errors default to sticky: an error that disappears before it is read is
    // the same as no error at all.
    const ms = timeout ?? (kind === 'error' ? 0 : 4000)
    toasts.value = [...toasts.value, { id, kind, message, timeout: ms }]
    if (ms > 0 && import.meta.client) {
      setTimeout(() => dismiss(id), ms)
    }
    return id
  }

  return {
    toasts,
    push,
    dismiss,
    success: (m: string, t?: number) => push(m, 'success', t),
    error: (m: string, t?: number) => push(m, 'error', t),
    info: (m: string, t?: number) => push(m, 'info', t)
  }
}
