import { computed, ref, shallowRef, watch } from 'vue'
import type { Station } from '../parsers/types'
import type { ListFile } from './usePlaylists'
import { baseName } from '../helpers/text'

export type SearchScope = 'list' | 'all' | 'directory'

export interface ResultGroup {
  key: string
  label: string
  meta: string
  stations: Station[]
  /** Present for local groups; lets a header offer "Open list". The directory's has none. */
  file?: ListFile
}

/**
 * Everything of a station that a search looks at, lower-cased, once. A station
 * object is replaced, never changed in place, when it is edited, so what is
 * remembered for one stays true for as long as that object exists. The fields
 * are joined by a line break, which a search box cannot hold, so no query can
 * match across two of them.
 */
const haystacks = new WeakMap<Station, string>()
const haystack = (s: Station): string => {
  let text = haystacks.get(s)
  if (text === undefined) {
    text = [s.name, s.network, s.group, s.country, s.language, s.url, ...(s.alternates ?? [])]
      .map((v) => String(v ?? '')).join('\n').toLowerCase()
    haystacks.set(s, text)
  }
  return text
}

/**
 * Matching is on everything a user might remember about a station, including
 * the stream address — which is how "somafm" finds a station called Groove
 * Salad. A match on a hidden column is still a match; the alternative is a
 * search that mysteriously misses.
 */
export const matches = (s: Station, q: string): boolean =>
  !q || haystack(s).includes(q.toLowerCase())

export const useSearch = (opts: {
  files: () => ListFile[]
  currentFile: () => ListFile | null
  currentStations: () => Station[]
  readList: (file: ListFile) => Promise<Station[]>
  /** How long typing must pause before results are worked out; 0 for at once. */
  debounceMs?: number
}) => {
  const query = ref('')
  const scope = ref<SearchScope>('all')
  const active = computed(() => query.value.trim().length > 0)
  const loading = ref(false)
  /**
   * The query the results are for. It trails `query` by a pause in typing: the
   * first character of a search matches nearly every station of every list,
   * and drawing a row for each of them only to remove most at the second
   * character was the most expensive thing the app did. Clearing is immediate.
   */
  const settled = ref('')
  const delay = opts.debounceMs ?? 130
  let settling: ReturnType<typeof setTimeout> | undefined
  watch(query, (q) => {
    clearTimeout(settling)
    if (!delay || !q.trim()) { settled.value = q; return }
    settling = setTimeout(() => { settled.value = q }, delay)
  }, { flush: 'sync' })
  /** Typed, and the results not yet caught up: "searching", not "nothing found". */
  const pending = computed(() => query.value.trim() !== settled.value.trim())
  /**
   * Stations of every other list, each with the etag it was read at. Loaded
   * when a cross-list search first starts, and from then on kept current by
   * the listing itself: a list written by this app has its new etag noted
   * there, and one created, renamed or removed changes the listing, so a
   * change is seen without anyone having to say so — and only the list that
   * changed is read again. Until 1.2.0 every caller that wrote a list had to
   * remember to call a reload, which read every list to refresh one.
   */
  const loaded = shallowRef<Map<string, { etag?: string; stations: Station[] }>>(new Map())
  let reading = 0

  /**
   * The current list is NOT read here: it is already in memory, its stations
   * already have the ids the editor knows, and it changes as the user edits.
   * Reading it again gave the finder a stale copy with different ids, so
   * "Edit" on a result silently changed nothing.
   */
  const sync = async () => {
    const files = opts.files().filter((f) => f.path !== opts.currentFile()?.path)
    const stale = files.filter((f) => {
      const have = loaded.value.get(f.path)
      return !have || !have.etag || have.etag !== f.etag
    })
    const gone = [...loaded.value.keys()].some((p) => !files.some((f) => f.path === p))
    if (!stale.length && !gone) return
    reading++
    loading.value = true
    try {
      // Independent GETs; in series a ten-list search took ten round trips.
      const fresh = await Promise.all(stale.map(async (file) => {
        try {
          return { file, stations: await opts.readList(file), failed: false }
        } catch {
          // One unreadable list must not break the search; it is shown empty,
          // and remembered without an etag so the next sync tries it again.
          return { file, stations: [] as Station[], failed: true }
        }
      }))
      // Built on what is loaded NOW, which another sync may have changed while
      // these were being read; and only for files the listing still has.
      const next = new Map(loaded.value)
      const listed = new Map(opts.files().map((f) => [f.path, f.etag]))
      for (const { file, stations, failed } of fresh) {
        // A newer sync read a newer version meanwhile: that one stands.
        if (listed.get(file.path) !== file.etag && next.has(file.path)) continue
        next.set(file.path, { etag: failed ? undefined : file.etag, stations })
      }
      for (const path of next.keys()) if (!listed.has(path)) next.delete(path)
      loaded.value = next
    } finally {
      if (--reading === 0) loading.value = false
    }
  }
  /** Stations of one list as the finder sees them: live for the current list. */
  const stationsOf = (file: ListFile): Station[] =>
    file.path === opts.currentFile()?.path ? opts.currentStations() : loaded.value.get(file.path)?.stations ?? []

  // Loading every list is only worth doing once a cross-list search is really
  // happening, not on the first keystroke of a filter.
  let everLoaded = false
  watch([active, scope], ([on, sc]) => {
    if (on && sc === 'all' && !everLoaded) { everLoaded = true; void sync() }
  })
  // Once loaded, the listing is what keeps it current.
  watch([() => opts.files(), () => opts.currentFile()?.path], () => { if (everLoaded) void sync() })

  const groupOf = (file: ListFile | null, hits: Station[]): ResultGroup => ({
    key: file?.path ?? 'current',
    label: baseName(file?.name ?? 'This list'),
    meta: `${hits.length} match${hits.length === 1 ? '' : 'es'}`,
    stations: hits,
    file: file ?? undefined
  })
  const localGroups = computed<ResultGroup[]>(() => {
    const q = settled.value.trim()
    if (!q || scope.value === 'directory') return []

    if (scope.value === 'list') {
      const file = opts.currentFile()
      const hits = opts.currentStations().filter((s) => matches(s, q))
      if (!hits.length) return []
      return [groupOf(file, hits)]
    }

    // Rail order, so results appear where the lists appear. Predictable beats
    // clever: a "most matches first" order moves groups around as you type.
    const groups: ResultGroup[] = []
    for (const file of opts.files()) {
      const hits = stationsOf(file).filter((s) => matches(s, q))
      if (!hits.length) continue
      groups.push(groupOf(file, hits))
    }
    return groups
  })

  const clear = () => { query.value = '' }

  return { query, scope, active, loading, pending, localGroups, stationsOf, clear }
}
