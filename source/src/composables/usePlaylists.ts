import { computed, ref, shallowRef } from 'vue'
import { useClientService, useSpacesStore } from '@opencloud-eu/web-pkg'
import type { Resource, SpaceResource } from '@opencloud-eu/web-client'
import { type Playlist, type Station, emptyPlaylist } from '../parsers/types'
import { serializeM3u } from '../parsers/m3u'
import { parsePlaylist } from '../parsers'
import type { RadioConfig } from '../config'
import { DEFAULT_BACKUPS, clampBackups } from './usePreferences'
import { baseName, splitName, messageOf } from '../helpers/text'
import { mergeStations, streamTaken, type Merge } from '../helpers/stations'

export interface ListFile {
  name: string
  path: string
  etag?: string
}

const PLAYLIST_EXT = /\.(m3u8?|pls|xspf)$/i
/** The formats this app writes. Everything else is read, shown and convertible. */
const WRITABLE_EXT = /\.m3u8?$/i

/** Whether this app may write the file under its own name. */
export const isWritable = (file: { name: string }): boolean => WRITABLE_EXT.test(file.name)

/** The client's errors carry `statusCode`; axios-shaped ones carry `response.status`. */
const statusOf = (e: unknown): number | undefined => {
  const err = e as { statusCode?: number; response?: { status?: number } }
  return err?.statusCode ?? err?.response?.status
}
/**
 * What a failure is allowed to leave in the console. The client's error
 * carries the whole response, and with it the request that was made,
 * Authorization header included; the same rule `redact` applies to stream
 * addresses applies here.
 */
const brief = (e: unknown) => ({ status: statusOf(e), message: e instanceof Error ? e.message : String(e) })
/**
 * One spelling of an etag. The client hands out two: a PROPFIND resource
 * carries it with the quotes stripped, a GET carries the header as sent,
 * quotes and all. Compared raw they never match — which is how the read
 * cache below spent 1.1.x never hitting. This is the form kept and compared
 * inside the store; it is NOT the form the server accepts — see `quotedEtag`.
 */
const bareEtag = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v.replace(/"/g, '') : undefined
/**
 * The form `If-Match` is sent in. An entity-tag is a quoted string (RFC 7232)
 * and the server compares the header to its own, quotes and all: the 1.1.8
 * rebuild sent the bare form and every save drew a 412 — "This list changed
 * somewhere else" on every add and import. Bare inside, quoted on the wire.
 */
const quotedEtag = (v: string | undefined): string | undefined =>
  v === undefined ? undefined : /^(W\/)?"/.test(v) ? v : `"${v}"`

/**
 * A backup that could not be written. The modification that would have
 * followed it is abandoned: a backup that is skipped when it is inconvenient
 * is not a backup, so this is raised in place of the write, never alongside it.
 */
export class BackupError extends Error {
  constructor(name: string, public cause?: unknown) {
    super(`${name} was not changed: a backup of it could not be written.`)
    this.name = 'BackupError'
  }
}

export class ConflictError extends Error {
  constructor() {
    super('This list changed somewhere else, so your edit was not saved.')
    this.name = 'ConflictError'
  }
}

/**
 * A station list larger than this is not opened. The cap on stations applies
 * only once a file has been parsed; this is what keeps a file that is not a
 * station list at all — or one built to be slow — from being parsed in the
 * first place, by the open, by every All-lists search and by every append.
 */
export const MAX_LIST_CHARS = 8_000_000

/** Something the store has to say about the open list, and in what tone: `ok`
 *  is information ("only the first N are shown"), `bad` is a failure. */
export interface ListStatus { text: string; tone: 'ok' | 'bad' }

export interface PlaylistOptions {
  /** How many backups of one list to keep; a preference, not a config key. */
  keepBackups?: () => number
  /**
   * Given, every edit to the open list schedules its own save and a failure of
   * that save is reported here. An edit and its save used to be two calls the
   * caller made, and a caller that forgot the second left the edit in memory
   * until the next list switch. Not given, saving is the caller's to ask for.
   */
  onSaveError?: (e: Error) => void
}

export const usePlaylists = (config: RadioConfig, options: PlaylistOptions = {}) => {
  const clientService = useClientService()
  const spacesStore = useSpacesStore()

  const files = ref<ListFile[]>([])
  const current = shallowRef<Playlist>(emptyPlaylist())
  const currentFile = ref<ListFile | null>(null)
  const loading = ref(false)
  /** Until 1.2.0 a plain string, drawn in the error colours whatever it said. */
  const status = ref<ListStatus | null>(null)
  const fail = (text: string) => { status.value = { text, tone: 'bad' } }
  /**
   * A .pls or .xspf list is read but never written back under its own name:
   * doing so put M3U text behind an extension that promised another format.
   * The UI offers to convert instead.
   */
  const readOnly = computed(() => !!currentFile.value && !isWritable(currentFile.value))

  const space = (): SpaceResource => {
    const personal = spacesStore.personalSpace
    if (!personal) throw new Error('Your personal space is not available.')
    return personal
  }

  const root = () => `/${config.rootFolder}`
  const settingsDir = () => `${root()}/${config.settingsFolder}`
  const backupDir = () => `${root()}/${config.backupFolder}`
  /** The timestamp `backup` stamps into a name, and the only thing `prune`
   *  will treat as one. Loose matching here would let a list called `Rock`
   *  claim the copies of a list called `Rock.old`. */
  const STAMP = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z`
  const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const backupNameOf = (file: ListFile, stamp: string) => {
    const [base, ext] = splitName(file.name)
    return `${base}.${stamp}${ext}`
  }
  const backupPattern = (file: ListFile) => {
    const [base, ext] = splitName(file.name)
    return new RegExp(`^${escapeRe(base)}\\.${STAMP}${escapeRe(ext)}$`)
  }

  let rootKnown = false
  /** Lists the folder, creating it on a miss; the listing is returned, not thrown away. */
  const listRoot = async (): Promise<Resource[]> => {
    const dav = clientService.webdav
    try {
      const { children = [] } = await dav.listFiles(space(), { path: root() })
      rootKnown = true
      return children as Resource[]
    } catch (e) {
      // Only a missing folder is ours to fix. A 401, 403 or network failure
      // used to be answered with a MKCOL, and the MKCOL's error replaced the
      // one that mattered.
      const status = statusOf(e)
      if (rootKnown || (status !== undefined && status !== 404)) throw e
      await dav.createFolder(space(), { path: root() })
      rootKnown = true
      return []
    }
  }
  /** MKCOL that does not mind the folder being there already. Only `withFolder`
   *  calls it: a folder is made when a write finds it missing, not in case. */
  const ensureFolder = async (dir: string) => {
    try { await clientService.webdav.createFolder(space(), { path: dir }) } catch { /* exists */ }
  }
  /** A file's text, and its etag in the store's own (bare) spelling. */
  const readText = async (path: string, { anySize = false } = {}): Promise<{ text: string; etag?: string }> => {
    const response = await clientService.webdav.getFileContents(space(), { path })
    const text = String(response.body ?? '')
    // `anySize` is for copying a file, which must work whatever it holds.
    if (!anySize && text.length > MAX_LIST_CHARS) {
      throw new Error(`${path.split('/').pop()} is too large to be a station list (over ${MAX_LIST_CHARS / 1_000_000} MB), so it was not opened.`)
    }
    return { text, etag: bareEtag(response.headers?.ETag) }
  }
  /**
   * The listing's idea of a file's etag, brought up to date after a write.
   * `readList` compares its cached etag to this one, so a list written this
   * session otherwise missed the cache on every search until the next listing.
   */
  const noteEtag = (path: string, etag: string | undefined) => {
    // A new array is news to every listener on the listing (search, the
    // rail): only when a listed file's etag really changed.
    if (!etag || !files.value.some((f) => f.path === path && f.etag !== etag)) return
    files.value = files.value.map((f) => (f.path === path ? { ...f, etag } : f))
  }

  /** A PUT or MKCOL whose parent collection is not there answers 409; some
   *  servers, and a folder that vanished entirely, answer 404. */
  const isMissingParent = (e: unknown) => statusOf(e) === 409 || statusOf(e) === 404

  /**
   * A request that puts something into `dir`, retried once with its folders
   * put back.
   *
   * This is the only place a folder is made. Until 1.2.0 there were three
   * ways besides — a flag per folder recording "this was here when I looked",
   * and MKCOLs sent in advance in case — and each flag, set once and never
   * revisited, had turned a folder tidied away in Files into a failure lasting
   * until the page was reloaded: `Radio/Backups/` in 1.1.6, `Radio/` in 1.1.8.
   * A request that finds its folder missing says so (409, or 404), and that
   * is when to make it. The first save of a session costs one refused request
   * if the backup folder is new; every other save costs nothing.
   */
  const withFolder = async <T>(dir: string, run: (recreated: boolean) => Promise<T>): Promise<T> => {
    try {
      return await run(false)
    } catch (e) {
      if (!isMissingParent(e)) throw e
      rootKnown = false
      await listRoot() // recreates the root when it is the one that went
      if (dir !== root()) await ensureFolder(dir)
      // `true`: whatever was in the folder went with it, so a precondition
      // about the file's previous state no longer describes anything.
      const out = await run(true)
      console.info('[radio] a folder had gone missing and was put back', { dir })
      return out
    }
  }

  /**
   * The one way a file is written. `expect` is what the server must hold for
   * the write to go ahead:
   *
   *  - `{ etag }` — exactly that version (`If-Match`, quoted on the wire). A
   *    stale one is a 412: someone else changed the file.
   *  - `'absent'` — nothing at all (`If-None-Match: *`): a new list, a backup,
   *    a profile. A 412 is a name already taken.
   *
   * After the folder had to be put back, whatever was in it went with it, so
   * an `If-Match` would describe nothing and be refused; the write then goes
   * out as `'absent'`. The etag that comes back is noted in the listing and
   * the read cache forgets the file, so neither can hand out the old version.
   *
   * Every spelling of an etag, every folder repair, every note of what was
   * written, used to be done again at each of five call sites; two of the
   * etag bugs in this file's history were a sixth site doing it differently.
   */
  const writeFile = async (path: string, content: string, expect: { etag?: string } | 'absent'): Promise<string | undefined> => {
    const dir = path.slice(0, path.lastIndexOf('/'))
    const result = await withFolder(dir, (recreated) => clientService.webdav.putFileContents(space(), {
      path,
      content,
      previousEntityTag: typeof expect === 'object' && !recreated ? quotedEtag(expect.etag) : undefined
    }))
    let etag = bareEtag(result?.etag)
    // Written, but the server's answer named no version. Kept as "none", the
    // next save of this file would go out as "only if absent", be refused,
    // and be reported as a change made elsewhere — and reload the edit away.
    // Asked once more, by reading it back.
    if (!etag) {
      const back = await readText(path, { anySize: true }).catch(() => null)
      if (back?.text === content) etag = back.etag
    }
    noteEtag(path, etag)
    cache.delete(path)
    return etag
  }

  /**
   * The backup names known to exist for each list, oldest first. Filled by
   * one PROPFIND the first time a list is backed up in this session, then kept
   * up to date locally: the app knows what it wrote and what it removed, so
   * listing the folder on every save was a request that told it nothing new.
   *
   * It can drift if the folder is edited by hand mid-session. A name that is
   * gone costs one tolerated 404 on the next prune; a copy added by hand is
   * only ever pruned if it matches the stamp exactly, and then not until the
   * next session notices it. Both are acceptable for what is housekeeping.
   */
  const knownBackups = new Map<string, string[]>()
  /**
   * Copy a station list into the backup folder before anything changes it.
   *
   * Called by every path that writes, moves or deletes a list, and always
   * BEFORE that happens, so the copy is of what is actually on the server
   * rather than of what we are about to replace it with. A failure here throws
   * and the caller does not proceed: the guarantee is that no list is ever
   * modified without a backup, and a best-effort backup would not be one.
   *
   * `known` is the file's current body when the caller has just read it, which
   * saves a second GET if the server will not copy the file itself.
   *
   * Resolves to the tidying that goes with it: pruning old copies, which the
   * caller runs once its own change has been made. Housekeeping waits for the
   * work rather than the work for it; a save no longer sits behind a round of
   * DELETEs, nor behind forty-five of them when the number kept was lowered.
   *
   * The folder is a child of the root rather than a sibling of the lists
   * themselves: `listFiles` skips folders, so backups cannot turn up in the
   * rail as station lists of their own, and a `.m3u8` backup written beside
   * the originals would.
   */
  const backup = async (file: ListFile, known?: string): Promise<() => Promise<void>> => {
    // Colons and dots are not safe everywhere a space may be mounted, and the
    // extension is kept so a .pls backup is still recognisably a .pls.
    const stamped = () => backupNameOf(file, new Date().toISOString().replace(/[:.]/g, '-'))
    /** A copy is never replaced, so a 412 is a name already taken — two
     *  changes inside one millisecond — and the next has a name of its own. */
    const underFreshName = async (write: (as: string) => Promise<unknown>): Promise<string> => {
      const first = stamped()
      try {
        await write(first)
        return first
      } catch (e) {
        if (statusOf(e) !== 412) throw e
        await new Promise((r) => setTimeout(r, 2))
        const second = stamped()
        await write(second)
        return second
      }
    }
    let name: string | undefined
    // First the cheap way: the server copies the file itself, one request with
    // no body where reading it and writing it back was the whole list twice
    // over the wire for every edit. It is only ever a shortcut. Whatever goes
    // wrong with it — a server that will not COPY, a folder that has gone, a
    // source that is not there — the slow way below is tried as before, and it
    // alone decides whether there is a backup or nothing to back up.
    try {
      name = await underFreshName((as) => withFolder(backupDir(), async () => {
        const answer = await clientService.webdav.copyFiles(
          space(), { path: file.path }, space(), { path: `${backupDir()}/${as}` })
        // Created, or nothing else: a 207 resolves too, and can carry a failure inside.
        if (answer?.status !== 201 && answer?.status !== 204) throw new Error(`COPY answered ${answer?.status}`)
      }))
    } catch (e) {
      console.debug('[radio] backup: the server did not copy the list; copying it by hand', { path: file.path, ...brief(e) })
    }

    if (name === undefined) {
      let body = known
      if (body === undefined) {
        try {
          body = (await readText(file.path, { anySize: true })).text
        } catch (e) {
          // A file that is not there has nothing to preserve, and creating it is
          // not a modification. Anything else is a backup we cannot make.
          if (statusOf(e) === 404) return async () => undefined
          console.error('[radio] backup: the list could not be read', { path: file.path, ...brief(e) })
          throw new BackupError(file.name, e)
        }
      }
      try {
        const content = body
        name = await underFreshName((as) => writeFile(`${backupDir()}/${as}`, content, 'absent'))
      } catch (e) {
        console.error('[radio] backup: the copy could not be written', { path: file.path, ...brief(e) })
        throw new BackupError(file.name, e)
      }
    }
    knownBackups.get(file.name)?.push(name)
    const made = name
    return () => prune(file, made)
  }

  /**
   * Keep the newest `keepBackups` copies of one list and remove the rest.
   *
   * Deliberately NOT part of the guarantee: the copy is already on the server
   * by the time this runs, so a failure here is untidiness, not data loss, and
   * it must never turn into a refusal to save. It is logged and swallowed.
   *
   * Only this list's copies are considered, and only names that match the
   * stamp exactly — anything else in the folder is someone's own file and is
   * not this app's to delete.
   */
  const prune = async (file: ListFile, justWritten?: string): Promise<void> => {
    const keep = clampBackups(options.keepBackups?.() ?? DEFAULT_BACKUPS)
    try {
      let mine = knownBackups.get(file.name)
      if (!mine) {
        const { children = [] } = await clientService.webdav.listFiles(space(), { path: backupDir() })
        const re = backupPattern(file)
        // The stamp is fixed-width and big-endian, so a plain sort is oldest first.
        mine = (children as Resource[])
          .filter((r) => r.type !== 'folder' && !!r.name && re.test(String(r.name)))
          .map((r) => String(r.name))
          .sort()
        // The copy made a moment ago is the newest whatever its name says. A
        // folder holding copies stamped later than now — another device, its
        // clock ahead — sorted it first, and it was removed as the oldest:
        // the list was then changed with no copy of what it had been.
        if (justWritten) mine = [...mine.filter((n) => n !== justWritten), justWritten]
        knownBackups.set(file.name, mine)
      }
      const excess = mine.splice(0, Math.max(0, mine.length - keep))
      // Independent requests, so sent together. Already gone is the outcome
      // wanted; anything else is logged, and one failure leaves no others behind.
      const outcomes = await Promise.allSettled(excess.map((old) =>
        clientService.webdav.deleteFile(space(), { path: `${backupDir()}/${old}` })))
      let removed = 0
      outcomes.forEach((o, i) => {
        if (o.status === 'fulfilled') removed++
        else if (statusOf(o.reason) !== 404) console.warn('[radio] an old backup could not be removed', { name: excess[i], ...brief(o.reason) })
      })
      if (removed) console.debug('[radio] pruned old backups', { list: file.name, removed, kept: keep })
    } catch (e) {
      console.warn('[radio] old backups could not be pruned; the new one is safe', { list: file.name, ...brief(e) })
    }
  }

  const listFiles = async (): Promise<ListFile[]> => {
    loading.value = true
    status.value = null
    try {
      const children = await listRoot()
      files.value = children
        .filter((r) => r.type !== 'folder' && !!r.name && PLAYLIST_EXT.test(r.name))
        .map((r) => ({ name: String(r.name), path: String(r.path), etag: bareEtag(r.etag) }))
        .sort((a, b) => a.name.localeCompare(b.name))
      return files.value
    } catch (e) {
      fail('Your station lists could not be read.')
      console.error('[radio] listing failed', { path: root(), ...brief(e) })
      throw e
    } finally {
      loading.value = false
    }
  }

  /** Incremented by every `open()`; an older one that answers late stands down. */
  let opening = 0
  /**
   * Resolves to whether this call is the one that took effect: false when a
   * later `open()` superseded it while its file was still being read.
   */
  const open = async (file: ListFile): Promise<boolean> => {
    const mine = ++opening
    // The previous list's pending edit, before `current` is replaced. If it
    // cannot be written the switch does not happen: the edit stays in memory
    // and on screen, where it can be retried once the cause is fixed. Until
    // 1.1.6 the new list opened anyway and the edit went with the old one,
    // under a banner that reported the failure but not the loss.
    try {
      await flush()
    } catch (e) {
      const previous = currentFile.value?.name ?? 'The current list'
      const why = messageOf(e, 'it could not be saved')
      fail(`${previous} stays open: ${why} Fix the problem and try again, or reload the page to discard the edit.`)
      // An earlier open still reading has just been superseded by this one and
      // will stand down without touching `loading`; nothing else would clear it.
      if (mine === opening) loading.value = false
      throw e
    }
    loading.value = true
    status.value = null
    try {
      const { text, etag } = await readText(file.path)
      // Two clicks in a row: the list asked for last is the one to show,
      // whichever answer arrives last.
      if (mine !== opening) return false
      const list = parsePlaylist(text, file.name)
      // An edit made to the outgoing list while this one was being read. It is
      // written before `current` is replaced; otherwise it was dropped and the
      // debounce then saved the NEW list, unchanged, under a fresh backup.
      clearTimeout(pending)
      // Only while there is a list to write it to: with none open a save is a
      // no-op that leaves `dirty` set, and this would never end.
      // `flush`, not `save`: the edit's own timer may have fired already, and
      // the write it started is this edit being saved, not a reason for another.
      while (dirty && currentFile.value) await flush()
      if (mine !== opening) return false
      if (list.stations.length > config.maxStationsPerList) {
        // The overflow is kept as raw lines after the shown entries, so a
        // later save writes the whole file back. Slicing and forgetting the
        // rest turned the next edit into a deletion of everything past the cap.
        const overflow = list.stations.slice(config.maxStationsPerList)
        list.stations = list.stations.slice(0, config.maxStationsPerList)
        const raw = serializeM3u({ stations: overflow, trailing: [] }).split('\n').slice(1, -1)
        list.trailing = [...raw, ...list.trailing]
        status.value = {
          text: `This list is very long, so only the first ${config.maxStationsPerList} stations are shown. The rest are kept in the file.`,
          tone: 'ok'
        }
      }
      current.value = list
      dirty = false // a freshly read list has nothing outstanding
      currentFile.value = { ...file, etag: etag ?? file.etag }
      return true
    } catch (e) {
      // Superseded and then failed: the list on screen is another one, and
      // this one's error is not about it.
      if (mine !== opening) return false
      fail(messageOf(e, 'This list could not be opened.'))
      console.error('[radio] open failed', { path: file.path, ...brief(e) })
      throw e
    } finally {
      if (mine === opening) loading.value = false
    }
  }

  /**
   * Set by every edit, cleared by a successful write: what `flush` looks at.
   * It must be set by the mutators themselves, not by a debounce — a caller
   * that edits and then flushes directly (adding a directory station to the
   * open list, moving a selection out of it) never goes through the debounce,
   * and until 1.1.3 those edits were dropped on the floor.
   */
  let dirty = false
  const touch = () => { dirty = true }
  /** Whether an edit is waiting to be written; what a leave-page prompt asks. */
  const isDirty = () => dirty

  /**
   * Writes run one at a time, in order. A save is several requests — the
   * backup, the PUT itself, the PROPFIND the client follows it with, the prune —
   * and the debounce is 800 ms, so on a slow link a second save could start
   * while the first PUT was still out.
   * It then carried the etag the first was about to replace, drew a 412, and
   * `App` answered the ConflictError by reloading: the newer edit was thrown
   * away under a banner blaming a change "somewhere else". Queued behind the
   * first, it reads the fresh etag instead. `settled()` is for callers that
   * must not start a write but must not overtake one either — a delete of the
   * list a save is halfway through writing.
   */
  let writing: Promise<unknown> = Promise.resolve()
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = writing.then(run, run)
    writing = next.then(() => undefined, () => undefined)
    return next
  }
  const settled = (): Promise<unknown> => writing

  /**
   * Read-modify-write with `If-Match`. These files are shareable and
   * hand-editable, so a lost update is a real scenario, not a theoretical one.
   * A stale etag is a `ConflictError`; the caller reports it and reloads.
   */
  const writeCurrent = async (): Promise<void> => {
    const file = currentFile.value
    if (!file) return
    if (readOnly.value) throw new Error(`${file.name} is read-only here. Convert it to .m3u8 to edit it.`)
    const list = current.value
    const body = serializeM3u(list)
    const tidy = await backup(file)
    const landed = async (etag: string | undefined) => {
      // The edit may have moved on while the PUT was out; only mark clean if
      // what was written is still what is in memory.
      if (current.value === list) dirty = false
      if (currentFile.value?.path === file.path) currentFile.value = { ...file, etag }
      await tidy()
    }
    try {
      await landed(await writeFile(file.path, body, { etag: file.etag }))
    } catch (e) {
      if (statusOf(e) === 412) {
        // Refused because the file is not the version this edit was made to.
        // Changed elsewhere, that is a conflict. GONE — deleted in Files or in
        // another tab, with or without its folder — the edit on screen is the
        // only copy there is, and it is written back rather than thrown away
        // with a reload of a file that no longer exists.
        const probe = await readText(file.path).then(() => 'there', (r) => (statusOf(r) === 404 ? 'gone' : 'unknown'))
        // Not knowing is not a conflict: a conflict reloads, and the edit goes.
        if (probe === 'unknown') throw new Error('This list could not be saved.')
        // Only the list still open is written back. One this app has just
        // renamed or deleted itself is not "gone elsewhere". Renames and
        // deletes run in the write queue, so a save cannot straddle them and
        // this second condition is not reached today; it is the defence for
        // a future path that changes the open list outside the queue.
        if (probe === 'there' || currentFile.value?.path !== file.path) throw new ConflictError()
        try {
          await landed(await writeFile(file.path, body, 'absent'))
          return
        } catch (again) {
          if (statusOf(again) === 412) throw new ConflictError() // and recreated meanwhile
          throw again
        }
      }
      // The client's write is two requests: the PUT and a PROPFIND for the
      // new etag. If only the second failed — the network, a 503 — the file
      // IS saved, and reporting a failure left a stale etag behind: the next
      // save then drew a 412 and was reloaded away as a change "somewhere
      // else". Ask the server what it holds before deciding.
      const now = await readText(file.path).catch(() => null)
      if (now && now.text === body) {
        // Not through `writeFile`, whose bookkeeping this is.
        noteEtag(file.path, now.etag)
        cache.delete(file.path)
        await landed(now.etag)
        return
      }
      console.error('[radio] save failed', { path: file.path, ...brief(e) })
      throw new Error('This list could not be saved.')
    }
  }
  const save = (): Promise<void> => serial(writeCurrent)
  /** In the write queue, and only if an edit is still waiting when its turn comes. */
  const saveIfDirty = (): Promise<void> => serial(async () => { if (dirty) await writeCurrent() })

  let pending: ReturnType<typeof setTimeout> | undefined
  /**
   * The save an edit schedules for itself when `onSaveError` was given. It
   * writes only if something is still waiting by the time it fires, so an
   * edit that was flushed in the meantime is not written twice.
   */
  const arm = () => {
    const report = options.onSaveError
    if (!report) return
    clearTimeout(pending)
    // A drag-reorder is a burst of edits; one write is enough.
    pending = setTimeout(() => { saveIfDirty().catch(report) }, 800)
  }
  /**
   * Write now if anything is pending. Called before anything that replaces
   * `current`: opening another list, renaming, deleting, creating. Until 1.1.1
   * the debounced timer read `current` at fire time, so an edit followed by a
   * quick list switch wrote the *new* list and lost the edit.
   */
  const flush = async () => {
    clearTimeout(pending)
    // A save already out may be writing exactly this edit; wait for it and
    // look again, or the list and a backup of it are written twice.
    await settled()
    // Looked at again inside the queue: two flushes that start together both
    // get this far, and the second must find the first has done the work.
    if (dirty) await saveIfDirty()
  }

  const safeName = (name: string) => name.replace(/[/\\:*?"<>|\r\n]/g, '').trim()

  /** A new list, by name. It carries no `#PLAYLIST:` title: see `writeNew`. */
  const createList = (name: string, stations: Station[] = []): Promise<ListFile> =>
    // The same rules as adding to a list that exists: one row per address,
    // and no more than a list may hold.
    writeNew(name, mergeStations([], stations, config.maxStationsPerList).stations)

  /**
   * Writes exactly what it is given: convert uses it to copy a list as it is.
   *
   * `title` is the `#PLAYLIST:` line, written only when given: convert passes
   * the original's so a .pls titled one thing is not renamed to its filename.
   * A new list has none and is headed by its file name — writing the name in
   * as a title left the heading on the old name after a rename.
   */
  const writeNew = async (name: string, stations: Station[], trailing: string[] = [], title?: string): Promise<ListFile> => {
    await flush()
    // Always .m3u8: the file is written as M3U whatever the user typed, and
    // the dialog says so. A typed `.m3u` is honoured; `.pls` would be a lie.
    const safe = (safeName(name) || 'Stations').replace(PLAYLIST_EXT, (ext) => (WRITABLE_EXT.test(ext) ? ext : ''))
    const filename = WRITABLE_EXT.test(safe) ? safe : `${safe}.m3u8`
    const path = `${root()}/${filename}`
    if (files.value.some((f) => f.name.toLowerCase() === filename.toLowerCase())) {
      throw new Error(`A list named "${filename}" already exists.`)
    }
    try {
      await writeFile(path, serializeM3u({ title, stations, trailing }), 'absent')
    } catch (e) {
      // Taken since the last listing — another tab, another device. The PUT
      // is `If-None-Match: *`, so the server refused; say so in words rather
      // than in the client's "Request failed with status code 412".
      if (statusOf(e) !== 412) throw e
      await listFiles()
      throw new Error(`A list named "${filename}" already exists.`)
    }
    await listFiles()
    return { name: filename, path }
  }

  const renameList = async (file: ListFile, name: string) => {
    await flush()
    // The extension is the file's own; one typed again would be doubled.
    const safe = safeName(name).replace(PLAYLIST_EXT, '').trim()
    if (!safe) throw new Error('A list needs a name.')
    const newName = `${safe}${splitName(file.name)[1] || '.m3u8'}`
    const target = `${root()}/${newName}`
    if (target === file.path) return { name: file.name, path: file.path }
    // Another file, that is: a change of case alone is this file's own name.
    if (files.value.some((f) => f.path !== file.path && f.path.toLowerCase() === target.toLowerCase())) {
      throw new Error(`A list named "${safe}" already exists.`)
    }
    // In the write queue, so no save can start before the MOVE and land after
    // it — which wrote the old name back beside the new one.
    const tidy = await serial(async () => {
      const t = await backup(file)
      try {
        // The client's MOVE is `Overwrite: F`; a name taken since the listing 412s.
        await clientService.webdav.moveFiles(space(), { path: file.path }, space(), { path: target })
      } catch (e) {
        if (statusOf(e) !== 412) throw e
        await listFiles()
        throw new Error(`A list named "${safe}" already exists.`)
      }
      // The open list goes by its new name from here, whether or not the caller
      // manages to reopen it: a save to the old path would find nothing there.
      if (currentFile.value?.path === file.path) currentFile.value = { ...currentFile.value, name: newName, path: target }
      cache.delete(file.path)
      return t
    })
    // Pruning the backups and listing the lists ask for different folders: both at once.
    await Promise.all([tidy(), listFiles()])
    return { name: newName, path: target }
  }

  const deleteList = async (file: ListFile) => {
    const own = currentFile.value?.path === file.path
    const wasDirty = dirty
    if (own) {
      clearTimeout(pending) // a pending write to a file about to go is not worth making
      dirty = false
      await settled() // but one already out must land first, or it lands after the delete and revives the file
    } else {
      await flush()
    }
    let tidy: () => Promise<void>
    try {
      // In the write queue, as a rename is: a save straddling the DELETE wrote
      // the list straight back.
      tidy = await serial(async () => {
        const t = await backup(file)
        await clientService.webdav.deleteFile(space(), { path: file.path })
        cache.delete(file.path)
        if (currentFile.value?.path === file.path) {
          currentFile.value = null
          current.value = emptyPlaylist()
          dirty = false // an edit made meanwhile was to the list now gone
        }
        return t
      })
    } catch (e) {
      // The list is still here and still open; so is the edit that was waiting,
      // and it is owed the save that was cancelled for it above.
      if (own && wasDirty && currentFile.value?.path === file.path) { dirty = true; arm() }
      throw e
    }
    // Pruning the backups and listing the lists ask for different folders: both at once.
    await Promise.all([tidy(), listFiles()])
  }

  /**
   * Write a read-only list (.pls, .xspf) out as a new .m3u8 beside it. The
   * original is left alone; the new file is what the editor opens.
   */
  const convertList = async (file: ListFile): Promise<ListFile> => {
    const base = baseName(file.name)
    const stations = current.value.stations.map((s) => ({ ...s }))
    // `trailing` carries the overflow of a list longer than the cap; a copy
    // that dropped it would be the truncation bug through another door.
    return writeNew(base, stations, [...current.value.trailing], current.value.title)
  }

  /**
   * After a conflict the in-memory list and its etag are both stale, and
   * every further save would 412 until the list was reopened. Re-read it,
   * dropping the edit the conflict message already said was lost.
   */
  const reload = async () => {
    const file = currentFile.value
    if (!file) return
    clearTimeout(pending)
    dirty = false
    const fresh = files.value.find((f) => f.path === file.path) ?? file
    await open(fresh)
  }

  /** Append stations to another list, read-modify-write with its own etag. */
  const appendTo = (file: ListFile, stations: Station[]): Promise<Omit<Merge, 'stations'>> => serial(async () => {
    if (!isWritable(file)) throw new Error(`${file.name} is read-only here. Convert it to .m3u8 first.`)
    // Read, merge, write — and if the list changed elsewhere between the read
    // and the write, once more on what it holds now: adding to a list is the
    // same whatever else is in it.
    for (let attempt = 0; ; attempt++) {
      const { text, etag } = await readText(file.path)
      const list = parsePlaylist(text, file.name)
      const { stations: merged, ...result } =
        mergeStations(list.stations, stations.map((s) => ({ ...s })), config.maxStationsPerList)
      // Nothing went in. Rewriting the file byte for byte is not a change worth
      // making, and it would leave a backup of a change that was not.
      if (!result.added) return result
      list.stations = merged
      const body = serializeM3u(list)
      const tidy = await backup(file, text)
      try {
        await writeFile(file.path, body, { etag })
      } catch (e) {
        if (statusOf(e) !== 412) {
          // The PUT may have landed and only the client's request after it
          // failed: what the server holds says which. Reported as a failure,
          // a move would then have left the stations in both lists.
          const now = await readText(file.path).catch(() => null)
          if (now?.text !== body) throw e
          noteEtag(file.path, now.etag)
          cache.delete(file.path)
          return result
        }
        if (attempt) throw new Error(`${file.name} kept changing while this was added to it; nothing was added. Try again.`)
        continue
      } finally {
        await tidy()
      }
      return result
    }
  })

  /* ---- settings profiles: plain files in Radio/Settings/ ------------------ */
  const listProfiles = async (): Promise<string[]> => {
    try {
      const { children = [] } = await clientService.webdav.listFiles(space(), { path: settingsDir() })
      return (children as Resource[])
        .filter((r) => r.type !== 'folder' && /\.ini$/i.test(r.name ?? ''))
        .map((r) => String(r.name).replace(/\.ini$/i, ''))
        .sort()
    } catch (e) {
      if (statusOf(e) === 404) return [] // folder does not exist yet; saving creates it
      throw e // a 401 or a network failure is not "no profiles"
    }
  }
  /** Returns the name actually used, which is the typed one less anything a filename cannot hold. */
  const saveProfile = async (name: string, content: string): Promise<string> => {
    const safe = safeName(name).replace(/\.ini$/i, '')
    if (!safe) throw new Error('A profile needs a name.')
    try {
      await writeFile(`${settingsDir()}/${safe}.ini`, content, 'absent')
    } catch (e) {
      // The same shape as `createList`: a name that is taken is refused, not
      // replaced. Until 1.1.6 a plain PUT silently overwrote the old profile.
      if (statusOf(e) === 412) throw new Error(`A profile named "${safe}" already exists.`)
      throw e
    }
    return safe
  }
  const readProfile = async (name: string): Promise<string> =>
    (await readText(`${settingsDir()}/${safeName(name)}.ini`)).text

  /**
   * Read a list without making it the current one. Searching across lists
   * needs every file's contents; caching by etag means a second search costs
   * nothing, and a list edited elsewhere is still picked up because its etag
   * changes.
   */
  const cache = new Map<string, { etag?: string; list: Playlist }>()
  const readList = async (file: ListFile): Promise<Playlist> => {
    const hit = cache.get(file.path)
    if (hit && hit.etag && hit.etag === file.etag) return hit.list
    const { text, etag } = await readText(file.path)
    const list = parsePlaylist(text, file.name)
    cache.set(file.path, { etag: etag ?? file.etag, list })
    return list
  }
  /**
   * Every edit to the open list goes through here: it is refused for a list
   * this app does not write, it marks the list as waiting to be saved, and —
   * when the store was given `onSaveError` — it schedules that save. The
   * read-only rule used to be checked by each caller, or by the interface
   * hiding the control; an edit that slipped past set `dirty` on a list that
   * could never be written, and the next list switch was refused for it.
   */
  const edit = (stations: Station[]): boolean => {
    // …and with no list open there is nowhere to save it to: accepted, it
    // was reported as done and gone at the next list opened.
    if (readOnly.value || !currentFile.value) return false
    current.value = { ...current.value, stations }
    touch()
    arm()
    return true
  }
  const addStation = (station: Station) => addStations([station])
  /** What was taken and what was not, and why: see `mergeStations`. */
  const addStations = (stations: Station[]): Merge => {
    const merged = mergeStations(current.value.stations, stations, config.maxStationsPerList)
    if (merged.added && edit(merged.stations)) return merged
    return merged.added
      ? { stations: current.value.stations, added: 0, duplicates: 0, left: [...stations], verdicts: stations.map(() => 'left' as const) } // refused: nothing went in
      : merged
  }
  /** False, and nothing changed, when the list cannot be edited, the station is not in it, or the new address is another row's. */
  const updateStation = (id: string, patch: Partial<Station>): boolean => {
    // Ids are new on every read of the file; one from before a reload names nothing.
    if (!current.value.stations.some((s) => s.id === id)) return false
    if (patch.url !== undefined && streamTaken(current.value.stations, patch.url, id)) return false
    return edit(current.value.stations.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }
  const removeStations = (ids: Set<string>): boolean => {
    // `Set.has(undefined)` matches every station that somehow lacks an id, so
    // one bad entry would take the whole list with it. Only real ids remove.
    const real = new Set([...ids].filter((id) => typeof id === 'string' && id !== ''))
    if (!real.size) return false
    const kept = current.value.stations.filter((s) => !real.has(s.id))
    return kept.length !== current.value.stations.length && edit(kept)
  }
  const moveStation = (id: string, delta: number): boolean => {
    const stations = [...current.value.stations]
    const from = stations.findIndex((s) => s.id === id)
    const to = from + delta
    if (from === -1 || to < 0 || to >= stations.length) return false
    const [moved] = stations.splice(from, 1)
    stations.splice(to, 0, moved)
    return edit(stations)
  }

  return {
    files, current, currentFile, loading, status, readOnly,
    listFiles, open, reload, save, flush, isDirty, createList, renameList, deleteList, convertList, appendTo,
    readList,
    listProfiles, saveProfile, readProfile,
    addStation, addStations, updateStation, removeStations, moveStation
  }
}
