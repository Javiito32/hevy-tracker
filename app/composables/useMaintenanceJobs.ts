/**
 * The maintenance job list, shared between the two admin tabs that need it.
 *
 * It used to be local state inside `MaintenanceCard`, which worked while the
 * operations and their history sat in the same card. Split across tabs they
 * still depend on each other — the operation gating reads which kinds have
 * completed — so the list lives here, module-level via `useState`, the same
 * shape as `useToast`. No store: one shared list is not a reason for Pinia.
 */

export interface MaintenanceJob {
  id: string
  kind: string
  label: string
  user_id: string | null
  user_name: string | null
  status: string
  progress_current: number
  progress_total: number
  message: string | null
  result: Record<string, any> | null
  error: string | null
  created_at: string
}

/**
 * Module-level, not a ref: two mounted components must share one interval, not
 * start one each.
 */
let timer: ReturnType<typeof setInterval> | null = null

export function useMaintenanceJobs() {
  const jobs = useState<MaintenanceJob[]>('admin-maintenance-jobs', () => [])

  const anyRunning = computed(() =>
    jobs.value.some(j => j.status === 'running' || j.status === 'pending')
  )

  /** Kinds that have completed at least once — what gates the dependent steps. */
  const completed = computed(() => {
    const done = new Set<string>()
    for (const j of jobs.value) if (j.status === 'done') done.add(j.kind)
    return done
  })

  const loadJobs = async () => {
    try {
      const res = await $fetch<{ jobs: MaintenanceJob[]; running: boolean }>('/api/admin/jobs')
      jobs.value = res.jobs
    } catch {
      // Polling failures are transient and self-correcting; surfacing one as an
      // error banner would flash noise every time a request is slow.
    }
  }

  const stopPolling = () => {
    if (timer) { clearInterval(timer); timer = null }
  }

  /**
   * Poll only while something is running — a job list at rest doesn't change.
   * The interval stops itself when nothing is running, which is why unmounting
   * a tab doesn't have to (and must not) tear it down: the other tab may still
   * be watching the same job.
   */
  const startPolling = () => {
    if (timer) return
    timer = setInterval(async () => {
      await loadJobs()
      if (!anyRunning.value) stopPolling()
    }, 2000)
  }

  return { jobs, anyRunning, completed, loadJobs, startPolling, stopPolling }
}

/** One-line summary of a finished job's result payload. */
export const describeJobResult = (r: Record<string, any>): string =>
  Object.entries(r)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')
