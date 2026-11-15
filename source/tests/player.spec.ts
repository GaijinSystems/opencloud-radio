import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePlayer, STEADY_MS, GOOD_MS, PAUSE_GRACE_MS } from '../src/composables/usePlayer'
import { readConfig } from '../src/config'
import { created, installFakeAudio, loads } from './support/audio'
import { Refused } from '../src/helpers/fetch'

const tick = () => new Promise((r) => setTimeout(r, 0))
/** A pause from outside, as the browser delivers one; the player decides on the next turn. */
const outsidePause = async (el: { paused: boolean; dispatchEvent: (e: Event) => boolean }) => {
  el.paused = true
  el.dispatchEvent(new Event('pause'))
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
  else await tick()
}
const A = { id: 'a', name: 'Station A', url: 'https://a.example/s' }
const B = { id: 'b', name: 'Station B', url: 'https://b.example/s' }
const S = { id: 's', name: 'Three servers', url: 'https://s1.example/x', alternates: ['https://s2.example/x', 'https://s3.example/x'] }

const mk = (opts: Partial<Parameters<typeof usePlayer>[1]> = {}) =>
  usePlayer(readConfig({}), { wantAnalyser: () => true, attempts: () => 5, ...opts })

beforeEach(() => {
  installFakeAudio()
  localStorage.setItem('radio.everPlayed', '1') // so a failure is never blamed on the policy
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
// Every test here is also a test of the transition table: whatever it drives
// the player through, no move outside `TRANSITIONS` may have been made.
afterEach(() => {
  vi.useRealTimers() // whatever a test left on, even one that failed half way
  const illegal = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((c) => String(c[0])).filter((m) => m.includes('no move from'))
  vi.restoreAllMocks()
  expect(illegal).toEqual([])
})

describe('rounds: a superseded play() promise is ignored', () => {
  it('switching station while the first is connecting keeps the second', async () => {
    const p = mk()
    p.play(A)
    p.play(B) // same CORS mode → same element; the new src rejects A's promise
    await tick()
    expect(p.station.value?.name).toBe('Station B')
    expect(p.state.value).toBe('connecting')
    expect(p.currentServer.value).toBe(B.url)
    expect(created).toHaveLength(1)
    // and B's CORS verdict has not been decided by A's rejection
    created[0].succeed()
    await tick()
    expect(p.state.value).toBe('playing')
  })

  it('one failed server costs one server, not two', async () => {
    const p = mk()
    p.play(S)
    created.at(-1)!.fail(2) // first failure in CORS mode: retried plain on the SAME server, by design
    await tick()
    expect(p.currentServer.value).toBe('https://s1.example/x')
    expect(created).toHaveLength(2)
    created.at(-1)!.fail(2) // MEDIA_ERR_NETWORK on s1, plain: now it is the server
    await tick()
    expect(p.currentServer.value).toBe('https://s2.example/x')
    expect(p.state.value).toBe('reconnecting')
    expect((console.info as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes('next server'))).toHaveLength(1)
  })

  it('stop while connecting leaves the player idle', async () => {
    const p = mk()
    p.play(A)
    p.stop()
    await tick()
    expect(p.state.value).toBe('idle')
    expect(p.currentServer.value).toBe('')
  })

  it('a CORS-mode failure falls back to a plain element without counting an attempt', async () => {
    const p = mk()
    p.play(A)
    created.at(-1)!.fail(4)
    await tick()
    expect(created).toHaveLength(2)
    expect(created[1].crossOrigin).toBeNull()
    expect(p.state.value).toBe('connecting')
    created[1].succeed()
    await tick()
    expect(p.state.value).toBe('playing')
  })
})

describe('resume', () => {
  it('is not an active state: the tap plays rather than stops', async () => {
    const p = mk()
    p.play(A)
    // NotAllowedError: the autoplay policy wants a gesture
    const el = created.at(-1)!
    el.rejectAll('NotAllowedError')
    await tick()
    expect(p.state.value).toBe('resume')
    expect(p.isActive()).toBe(false)
    p.toggle()
    expect(p.state.value).toBe('connecting')
  })
})

describe('connect timeout', () => {
  it('a server that never answers is retried rather than waited on forever', async () => {
    vi.useFakeTimers()
    const p = mk()
    p.play(S)
    expect(p.state.value).toBe('connecting')
    vi.advanceTimersByTime(26000)
    expect(p.currentServer.value).toBe('https://s2.example/x')
    vi.useRealTimers()
  })
})

describe('the analyser switched on mid-play', () => {
  it('current() names the element playing and how it was loaded', async () => {
    const player = mk({ wantAnalyser: () => false })
    expect(player.current().el).toBeNull()
    player.play(A); await tick()
    created[0].succeed()
    const { el, cors } = player.current()
    expect(el).toBe(created[0])
    expect(cors).toBe(false) // loaded plain: an analyser attached now is indicative, not silent
  })
})

describe('volume and the analyser', () => {
  // The rule: exactly one stage attenuates. With a graph the element stays at
  // full level and the gain node after the analyser does the work; without one
  // the element attenuates.
  it('leaves the element at full level when a graph is present', async () => {
    const seen: Array<[number, boolean]> = []
    const p = mk({ applyGain: (v, m) => { seen.push([v, m]); return true } })
    p.play(A)
    p.setVolume(0.2)
    expect(seen.at(-1)).toEqual([0.2, false])
    expect(created[0].volume).toBe(1)
    p.setMuted(true)
    expect(seen.at(-1)).toEqual([0.2, true])
    expect(created[0].muted).toBe(false)
  })
  it('falls back to the element when there is no graph', () => {
    const p = mk({ applyGain: () => false })
    p.play(A)
    p.setVolume(0.3)
    p.setMuted(true)
    expect(created[0].volume).toBe(0.3)
    expect(created[0].muted).toBe(true)
  })
})

describe('the CORS fallback keeps its place in the server list', () => {
  it('a second server that refuses CORS is retried plain, not the dead first one', async () => {
    const p = mk()
    p.play(S)
    created.at(-1)!.fail(2) // s1, CORS probe → same server plain
    await tick()
    created.at(-1)!.fail(2) // s1 plain: dead → s2, CORS probe
    await tick()
    expect(p.currentServer.value).toBe('https://s2.example/x')
    created.at(-1)!.fail(4) // s2 refuses CORS → must come back to s2 plain
    await tick()
    expect(p.currentServer.value).toBe('https://s2.example/x')
    expect(created.at(-1)!.crossOrigin).toBeNull()
  })
})

describe('one failure is one failure', () => {
  // A failed load fires `error` and then rejects play(). When the first ended
  // in a back-off no new round had begun, so the second was let through too:
  // attempts were spent two at a time, and with two servers all at once.
  afterEach(() => vi.useRealTimers())

  it('a dead single-server station gets every reconnect attempt it was promised', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false, attempts: () => 3 })
    p.play(A)
    for (let i = 0; i < 10 && p.state.value !== 'failed'; i++) {
      created.at(-1)!.fail(2)
      await vi.advanceTimersByTimeAsync(0)       // the rejected play() promise
      await vi.advanceTimersByTimeAsync(20000)   // past any back-off
    }
    expect(p.state.value).toBe('failed')
    expect(loads).toHaveLength(4) // the first connection and three reconnects
  })

  it('two dead servers are retried with a delay between rounds, not all at once', async () => {
    vi.useFakeTimers()
    const two = { id: 't', name: 'Two', url: 'https://t1.example/x', alternates: ['https://t2.example/x'] }
    const p = mk({ wantAnalyser: () => false, attempts: () => 5 })
    p.play(two)
    created.at(-1)!.fail(2); await vi.advanceTimersByTimeAsync(0) // server 1 → server 2, at once
    created.at(-1)!.fail(2); await vi.advanceTimersByTimeAsync(0) // server 2 → back off
    expect(loads).toEqual(['https://t1.example/x', 'https://t2.example/x'])
    expect(p.state.value).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1000)
    expect(loads).toHaveLength(3) // the next round starts only after the delay
  })
})

describe('a server this browser cannot open is never the next one tried', () => {
  it('a playable primary with an http backup reconnects when the stream drops', async () => {
    const mixed = { id: 'm', name: 'Mixed', url: 'https://ok.example/s', alternates: ['http://plain.example/s'] }
    const p = mk({ wantAnalyser: () => false })
    p.play(mixed)
    created[0].succeed()
    expect(p.state.value).toBe('playing')
    created[0].dispatchEvent(new Event('ended'))
    await tick()
    // Until this was fixed: `failed`, under "None of the 2 servers … can be opened".
    expect(p.state.value).toBe('reconnecting')
    expect(loads.every((u) => u.startsWith('https://ok.example/'))).toBe(true)
  })
})

describe('a stall that mends itself', () => {
  afterEach(() => vi.useRealTimers())

  it('does not leave the player deaf to the next failure', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    const el = created[0]
    el.succeed()
    el.dispatchEvent(new Event('waiting'))
    await vi.advanceTimersByTimeAsync(18000) // the stall watch gives up and backs off for a second
    expect(p.state.value).toBe('reconnecting')
    el.succeed()                             // the buffer refilled first: no new round was opened
    await vi.advanceTimersByTimeAsync(2000)
    expect(p.state.value).toBe('playing')
    el.dispatchEvent(new Event('ended'))     // and now the stream really does drop
    await vi.advanceTimersByTimeAsync(0)
    expect(p.state.value).toBe('reconnecting')
  })
})

describe('older loose ends', () => {
  afterEach(() => vi.useRealTimers())

  it('choosing a station that cannot play stops the one that was playing', () => {
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    created[0].succeed()
    p.play({ id: 'h', name: 'Plain', url: 'http://plain.example/s' })
    expect(p.state.value).toBe('failed')
    expect(created[0].paused).toBe(true) // not left playing behind a bar with no Stop button
    expect(created[0].src).toBe('')
  })

  it('a server list that arrives after the stream has recovered does not restart it', async () => {
    vi.useFakeTimers()
    let answer: (v: string[]) => void = () => {}
    const withSource = { ...A, source: 'https://a.example/list.pls' }
    const p = mk({ wantAnalyser: () => false, refreshServers: () => new Promise((r) => { answer = r }) })
    p.play(withSource)
    const el = created[0]
    el.succeed()
    el.dispatchEvent(new Event('waiting'))
    await vi.advanceTimersByTimeAsync(18000) // stalled: every server tried, the playlist is asked
    expect(p.state.value).toBe('reconnecting')
    el.succeed()                             // the stream came back first
    const before = loads.length
    answer(['https://elsewhere.example/s'])
    await vi.advanceTimersByTimeAsync(5000)
    expect(p.state.value).toBe('playing')
    expect(loads).toHaveLength(before)
  })
})

describe('a server list read again', () => {
  it('plays on as the same station, so its row still shows it and still stops it', async () => {
    vi.useFakeTimers()
    const withSource = { ...A, source: 'https://a.example/list.pls' }
    const p = mk({ wantAnalyser: () => false, refreshServers: async () => ['https://elsewhere.example/s', 'https://other.example/s'] })
    p.play(withSource)
    created.at(-1)!.fail(2) // the only server is gone: the playlist is read again
    await vi.advanceTimersByTimeAsync(0)
    expect(created.at(-1)!.src).toBe('https://elsewhere.example/s')
    expect(p.station.value).toEqual(withSource) // not a copy with another address
    expect(p.servers.value).toEqual(['https://elsewhere.example/s', 'https://other.example/s'])
    expect(p.serverCount.value).toBe(2)
    p.toggle(withSource)
    expect(p.state.value).toBe('idle') // stopped, not started again on the dead address
    p.play(withSource)
    expect(p.servers.value).toEqual([withSource.url]) // a new play starts from the station's own
    vi.useRealTimers()
  })

  it('and where the list took the new servers, goes on as the saved row, which its row then shows and stops', async () => {
    vi.useFakeTimers()
    const withSource = { ...A, source: 'https://a.example/list.pls' }
    const saved = { ...withSource, url: 'https://elsewhere.example/s', alternates: ['https://other.example/s'] }
    const p = mk({ wantAnalyser: () => false, refreshServers: async () => [saved.url, ...saved.alternates] })
    p.play(withSource)
    created.at(-1)!.fail(2)
    await vi.advanceTimersByTimeAsync(0)
    const loadsBefore = loads.length
    p.follow([saved], { sameList: true }) // the list took them
    expect(p.station.value?.url).toBe(saved.url)
    expect(loads).toHaveLength(loadsBefore) // nothing restarted
    p.toggle(saved)
    expect(p.state.value).toBe('idle')
  })
})

describe('the player keeps to its row when the list changes', () => {
  it('a save of re-read servers refused and the list read again: the row is found by its old address', async () => {
    vi.useFakeTimers()
    const row = { ...A, source: 'https://a.example/list.pls' }
    const saved = { ...row, url: 'https://elsewhere.example/s', alternates: ['https://other.example/s'] }
    const p = mk({ wantAnalyser: () => false, refreshServers: async () => [saved.url, ...saved.alternates] })
    p.play(row)
    created.at(-1)!.fail(2)
    await vi.advanceTimersByTimeAsync(0)
    created.at(-1)!.succeed()
    p.follow([saved], { sameList: true }) // saved…
    const loadsBefore = loads.length
    const reread = { ...row, id: 'a2' } // …then refused, and the list read again
    p.follow([{ id: 'x', name: 'Other', url: 'https://x.example/s' }, reread], { sameList: true })
    expect(p.station.value?.url).toBe(row.url)
    expect(p.servers.value).toEqual([saved.url, ...saved.alternates]) // still what it plays from
    expect(loads).toHaveLength(loadsBefore)                            // nothing restarted
    p.toggle(reread)
    expect(p.state.value).toBe('idle')
  })

  it('Find backup servers or the station form putting another server first: the row is still the one playing', () => {
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    created.at(-1)!.succeed()
    const loadsBefore = loads.length
    const edited = { ...A, url: 'https://first.example/s', alternates: [A.url] }
    p.follow([B, edited], { sameList: true })
    expect(p.station.value?.url).toBe(edited.url)
    expect(p.currentServer.value).toBe(A.url) // still on the server it was playing
    expect(loads).toHaveLength(loadsBefore)
    p.toggle(edited)
    expect(p.state.value).toBe('idle')
  })

  it('in the order the app does it: the list takes the new servers before the player moves onto them', async () => {
    vi.useFakeTimers()
    const { shallowRef, watch, nextTick } = await import('vue')
    const row = { ...A, source: 'https://a.example/list.pls' }
    const rows = shallowRef<Array<typeof row & { alternates?: string[] }>>([row])
    const fresh = ['https://new1.example/s', 'https://new2.example/s']
    const p = mk({
      wantAnalyser: () => false,
      refreshServers: async () => {
        await Promise.resolve()
        rows.value = [{ ...row, url: fresh[0], alternates: fresh.slice(1) }] // saved first, as App does
        return fresh
      }
    })
    watch([() => rows.value, () => p.currentServer.value], ([l]) => p.follow(l, { sameList: true })) // as App wires it, for a play from this list
    p.play(row)
    created.at(-1)!.fail(2)
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    expect(p.currentServer.value).toBe(fresh[0])
    expect(p.station.value?.url).toBe(fresh[0]) // the row as it now stands
    p.toggle(rows.value[0])
    expect(p.state.value).toBe('idle')
  })

  it('another list with a different station sharing a backup server is not taken for this one', () => {
    const X = { id: 'x', name: 'X', url: 'https://x.example/s', alternates: ['https://shared.example/fallback'] }
    const p = mk({ wantAnalyser: () => false })
    p.play(X)
    created.at(-1)!.succeed()
    p.follow([{ id: 'y', name: 'Y', url: 'https://y.example/s', alternates: ['https://shared.example/fallback'] }])
    expect(p.station.value?.name).toBe('X')
  })

  it('leaves a station alone that no row shares a stream with, and takes up a rename of its own row', () => {
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    created.at(-1)!.succeed()
    p.follow([{ ...B }])
    expect(p.station.value?.url).toBe(A.url)
    const before = loads.length
    p.follow([{ ...A, id: 'a-reloaded', name: 'Renamed' }])
    expect(p.station.value).toMatchObject({ name: 'Renamed', id: 'a-reloaded' }) // the bar shows the new name
    expect(loads).toHaveLength(before)
  })

  it('playing from a backup another row also lists: the station whose own address it now is, never the other', async () => {
    vi.useFakeTimers()
    const X = { id: 'x', name: 'X', url: 'https://x1.example/s', alternates: ['https://shared.example/s'] }
    const Y = { id: 'y', name: 'Y', url: 'https://y1.example/s', alternates: ['https://shared.example/s'] }
    const p = mk({ wantAnalyser: () => false })
    p.play(X)
    created.at(-1)!.fail(2) // x1 is down: on to the shared backup
    await vi.advanceTimersByTimeAsync(0)
    expect(p.currentServer.value).toBe('https://shared.example/s')
    created.at(-1)!.succeed()
    // Find backup servers puts the shared server first for X; Y comes first in the list.
    p.follow([Y, { ...X, url: 'https://shared.example/s', alternates: ['https://x1.example/s'] }], { sameList: true })
    expect(p.station.value?.name).toBe('X')
    // And a list of other stations, two of them sharing that backup, is not this one.
    const q = mk({ wantAnalyser: () => false })
    q.play(X)
    created.at(-1)!.fail(2)
    await vi.advanceTimersByTimeAsync(0)
    q.follow([Y, { id: 'z', name: 'Z', url: 'https://z1.example/s', alternates: ['https://shared.example/s'] }], { sameList: true })
    expect(q.station.value?.name).toBe('X')
  })

  it('played from elsewhere, a station in the open list that alone shares the backup playing is not taken for it', async () => {
    vi.useFakeTimers()
    const X = { id: 'x', name: 'X', url: 'https://x1.example/s', alternates: ['https://shared.example/s'] }
    const Z = { id: 'z', name: 'Z', url: 'https://z1.example/s', alternates: ['https://shared.example/s'] }
    const p = mk({ wantAnalyser: () => false })
    p.play(X) // from a search, the directory, or a list since closed
    created.at(-1)!.fail(2)
    await vi.advanceTimersByTimeAsync(0)
    expect(p.currentServer.value).toBe('https://shared.example/s')
    p.follow([Z]) // the open list is another one
    expect(p.station.value?.name).toBe('X')
    p.follow([Z], { sameList: true }) // in X's own list, the one row with that server would have been X's
    expect(p.station.value?.name).toBe('Z')
  })
})

describe('a stream that plays for a moment and drops', () => {
  it('backs off rather than moving between its servers with no pause, and reads its playlist once', async () => {
    vi.useFakeTimers()
    let reads = 0
    const s = { ...S, source: 'https://s.example/list.pls' }
    const p = mk({ wantAnalyser: () => false, refreshServers: async () => { reads++; return [] } })
    p.play(s)
    const before = loads.length
    // Each load the player starts plays for a moment and drops, with no time
    // passing: only loads it really started are answered.
    for (let seen = -1, i = 0; i < 50 && loads.length !== seen; i++) {
      seen = loads.length
      created.at(-1)!.succeed()
      created.at(-1)!.dispatchEvent(new Event('ended'))
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(loads.length - before).toBeLessThanOrEqual(2) // the other two servers once, then a pause
    expect(reads).toBe(1)
    expect(p.state.value).toBe('reconnecting')
    p.stop()
  })

  it('and with time passing, waits longer each round and gives up, rather than reconnecting for ever', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false, attempts: () => 3 })
    p.play({ ...S })
    const waits: number[] = []
    let seen = -1
    let quiet = 0
    for (let i = 0; i < 400 && p.state.value !== 'failed'; i++) {
      if (loads.length !== seen) { // a load the player started: it plays for a moment and drops
        seen = loads.length
        if (quiet) { waits.push(quiet); quiet = 0 }
        created.at(-1)!.succeed()
        created.at(-1)!.dispatchEvent(new Event('ended'))
        await vi.advanceTimersByTimeAsync(0)
      } else { await vi.advanceTimersByTimeAsync(500); quiet += 500 }
    }
    expect(p.state.value).toBe('failed')
    expect(waits).toEqual([...waits].sort((a, b) => a - b)) // each pause at least as long as the one before
    expect(waits.at(-1)!).toBeGreaterThan(waits[0])
  })

  it('a stream that plays a while and then stalls is not taken for steady: it still gives up', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false, attempts: () => 2 })
    p.play({ ...A })
    let seen = -1
    for (let i = 0; i < 300 && p.state.value !== 'failed'; i++) {
      if (loads.length !== seen) {
        seen = loads.length
        created.at(-1)!.succeed()
        await vi.advanceTimersByTimeAsync(13_000)          // plays for 13 s…
        created.at(-1)!.dispatchEvent(new Event('waiting')) // …and stalls
      }
      await vi.advanceTimersByTimeAsync(1_000)
    }
    expect(p.state.value).toBe('failed')
  })

  it('a stall that gets one more packet and then goes silent is still retried', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play({ ...A })
    created.at(-1)!.succeed()
    const before = loads.length
    created.at(-1)!.dispatchEvent(new Event('waiting'))
    await vi.advanceTimersByTimeAsync(5_000)
    created.at(-1)!.dispatchEvent(new Event('progress')) // one late chunk…
    await vi.advanceTimersByTimeAsync(60_000)            // …then nothing
    expect(loads.length).toBeGreaterThan(before)
  })

  it('a flaky link that rebuffers briefly every twenty seconds still counts as recovered between real drops', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false, attempts: () => 2 })
    p.play({ ...A })
    created.at(-1)!.succeed()
    for (let minute = 0; minute < 60; minute++) {
      for (let s = 0; s < 3; s++) { // three short rebuffers a minute
        await vi.advanceTimersByTimeAsync(18_000)
        created.at(-1)!.dispatchEvent(new Event('waiting'))
        await vi.advanceTimersByTimeAsync(2_000)
        created.at(-1)!.succeed()
      }
      if (minute % 5 === 4) { // and a real drop every five minutes, which reconnects at once
        created.at(-1)!.dispatchEvent(new Event('ended'))
        await vi.advanceTimersByTimeAsync(1_100)
        created.at(-1)!.succeed()
      }
    }
    expect(p.state.value).toBe('playing') // an hour on, not given up after the second drop
  })

  it('steady time that runs out in a stall settles the play when it plays again', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    created.at(-1)!.fail(2)                              // a round: the next pause would be two seconds
    await vi.advanceTimersByTimeAsync(1_000)
    created.at(-1)!.succeed()
    await vi.advanceTimersByTimeAsync(25_000)
    created.at(-1)!.dispatchEvent(new Event('waiting'))  // stalls before the 30 s are up…
    await vi.advanceTimersByTimeAsync(10_000)            // …and they run out in the stall
    created.at(-1)!.succeed()                            // back…
    await vi.advanceTimersByTimeAsync(GOOD_MS)           // …for good: settled now
    const before = loads.length
    created.at(-1)!.dispatchEvent(new Event('ended'))
    await vi.advanceTimersByTimeAsync(1_001)
    expect(loads.length).toBe(before + 1)                // the shortest pause again
  })

  it('a stall that trickles a byte now and then is still retried within a minute or so', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play({ ...A })
    created.at(-1)!.succeed()
    const before = loads.length
    created.at(-1)!.dispatchEvent(new Event('waiting'))
    for (let s = 0; s < 120 && loads.length === before; s += 5) {
      await vi.advanceTimersByTimeAsync(5_000)
      created.at(-1)!.dispatchEvent(new Event('progress'))
    }
    expect(loads.length).toBeGreaterThan(before)
  })

  it('the ordinary progress of a healthy stream is not a stall: it still counts as recovered', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    created.at(-1)!.fail(2)
    await vi.advanceTimersByTimeAsync(1_000)
    created.at(-1)!.succeed()
    for (let t = 0; t < STEADY_MS + 1_000; t += 300) {
      created.at(-1)!.dispatchEvent(new Event('progress'))
      await vi.advanceTimersByTimeAsync(300)
    }
    const before = loads.length
    created.at(-1)!.dispatchEvent(new Event('ended'))
    await vi.advanceTimersByTimeAsync(1_001)
    expect(loads.length).toBe(before + 1) // the shortest pause: it was steady
  })

  it('a near-silent link — a blip of sound between long stalls — is one long stall, and gives up', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false, attempts: () => 2 })
    p.play({ ...A })
    let seen = -1
    for (let i = 0; i < 600 && p.state.value !== 'failed'; i++) {
      if (loads.length !== seen) { seen = loads.length; created.at(-1)!.succeed() }
      if (p.state.value === 'playing') {
        await vi.advanceTimersByTimeAsync(500)                // half a second of sound…
        created.at(-1)!.dispatchEvent(new Event('waiting'))
        await vi.advanceTimersByTimeAsync(15_000)             // …then silence
        if (p.state.value === 'playing') created.at(-1)!.succeed()
      } else await vi.advanceTimersByTimeAsync(1_000)
    }
    expect(p.state.value).toBe('failed')
  })

  it('a stall mended by enough sound is over: a short one much later is not taken for its last seconds', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    const el = created.at(-1)!
    el.succeed()
    el.dispatchEvent(new Event('waiting'))
    for (let s = 0; s < 50; s += 5) {          // a long stall, kept alive by stray bytes: most of its minute used
      await vi.advanceTimersByTimeAsync(5_000)
      el.dispatchEvent(new Event('progress'))
    }
    el.succeed()
    await vi.advanceTimersByTimeAsync(70_000)  // well past GOOD_MS of sound: that stall is over
    const before = loads.length
    el.dispatchEvent(new Event('waiting'))
    await vi.advanceTimersByTimeAsync(15_000)
    expect(loads).toHaveLength(before)         // a new stall's full wait, not the old one's last seconds
  })

  it('a marginal link that plays nine seconds in ten counts as recovered, and does not give up', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false, attempts: () => 2 })
    p.play({ ...A })
    created.at(-1)!.succeed()
    for (let minute = 0; minute < 10; minute++) {
      for (let s = 0; s < 6; s++) {
        await vi.advanceTimersByTimeAsync(9_000)
        created.at(-1)!.dispatchEvent(new Event('waiting'))
        await vi.advanceTimersByTimeAsync(1_000)
        created.at(-1)!.succeed()
      }
      if (minute % 3 === 2) { // and a real drop now and then, which reconnects
        created.at(-1)!.dispatchEvent(new Event('ended'))
        await vi.advanceTimersByTimeAsync(1_100)
        created.at(-1)!.succeed()
      }
    }
    expect(p.state.value).toBe('playing')
  })

  it('a stream that has kept playing a while starts again from the shortest wait', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    created.at(-1)!.fail(2)                     // a round: back-off 1
    await vi.advanceTimersByTimeAsync(1_000)
    created.at(-1)!.succeed()
    await vi.advanceTimersByTimeAsync(STEADY_MS) // steady: history
    const before = loads.length
    created.at(-1)!.dispatchEvent(new Event('ended'))
    await vi.advanceTimersByTimeAsync(999)
    expect(loads).toHaveLength(before)          // waiting the first, shortest pause again…
    await vi.advanceTimersByTimeAsync(2)
    expect(loads.length).toBe(before + 1)       // …of one second, not two
  })
})

describe('a pause the player did not make', () => {
  it('shows as paused at once, keeps the stream for the grace period, then lets it go — not "playing" over silence', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    const el = created.at(-1)!
    el.succeed()
    await outsidePause(el) // headphones out, another app took the audio
    expect(p.state.value).toBe('resume')
    expect(el.src).not.toBe('')          // kept, for the system to resume…
    await vi.advanceTimersByTimeAsync(PAUSE_GRACE_MS)
    expect(el.src).toBe('')              // …and let go when nothing did
    const before = loads.length
    p.toggle()                           // the bar's tap, or the system's play button
    expect(p.state.value).toBe('connecting')
    expect(loads.length).toBe(before + 1) // a fresh load, at the live point
  })

  it('resumed by the system within the grace period (a call ended), it simply plays on', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    const el = created.at(-1)!
    el.succeed()
    await outsidePause(el)
    await vi.advanceTimersByTimeAsync(8_000)
    const before = loads.length
    el.succeed()                          // the browser resumes it
    expect(p.state.value).toBe('playing')
    expect(loads).toHaveLength(before)    // the same stream, not a new load
    await vi.advanceTimersByTimeAsync(PAUSE_GRACE_MS)
    expect(el.src).not.toBe('')           // and not let go later
  })

  it('a tap during the grace period starts it afresh, and the old stream is not let go twice', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    const el = created.at(-1)!
    el.succeed()
    await outsidePause(el)
    p.toggle()
    expect(p.state.value).toBe('connecting')
    created.at(-1)!.succeed()
    await vi.advanceTimersByTimeAsync(PAUSE_GRACE_MS)
    expect(p.state.value).toBe('playing') // the grace timer did not touch the new play
  })

  it('while waiting to reconnect too: the retry already armed does not start it again by itself', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    const el = created.at(-1)!
    el.succeed()
    el.dispatchEvent(new Event('waiting'))  // stalled…
    await vi.advanceTimersByTimeAsync(18_000)
    expect(p.state.value).toBe('reconnecting') // …one server, so a back-off is armed, the element still waiting
    const before = loads.length
    await outsidePause(el)                  // headphones out in the meantime
    expect(p.state.value).toBe('resume')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(loads).toHaveLength(before)     // nothing started by itself
  })

  it('a pause from an element no longer in use, or from one that failed, is not one', async () => {
    const p = mk({ wantAnalyser: () => true }) // CORS first: a refusal moves to a fresh element
    p.play(A)
    const first = created.at(-1)!
    first.fail(4)                               // refused in CORS mode: retried plainly on a new element
    const second = created.at(-1)!
    expect(second).not.toBe(first)
    second.succeed()
    Object.defineProperty(first, 'error', { value: null, configurable: true }) // the error check apart: this is about which element
    await outsidePause(first)     // the old element, let go
    expect(p.state.value).toBe('playing')
    Object.defineProperty(second, 'error', { value: { code: 2 }, configurable: true })
    await outsidePause(second)    // paused because it failed: the error event decides
    expect(p.state.value).toBe('playing')
  })

  it('the system\'s play button starts it afresh from the paused state', async () => {
    const handlers: Record<string, () => void> = {}
    Object.defineProperty(navigator, 'mediaSession', { configurable: true,
      value: { setActionHandler: (a: string, h: () => void) => { handlers[a] = h }, playbackState: 'none', metadata: null } })
    vi.stubGlobal('MediaMetadata', class { constructor (m: unknown) { Object.assign(this, m) } })
    try {
      const p = mk({ wantAnalyser: () => false })
      p.play(A)
      const el = created.at(-1)!
      el.succeed()
      await outsidePause(el)
      expect((navigator as unknown as { mediaSession: { playbackState: string } }).mediaSession.playbackState).toBe('paused')
      const before = loads.length
      handlers.play()
      expect(p.state.value).toBe('connecting')
      expect(loads.length).toBe(before + 1)
    } finally {
      delete (navigator as unknown as Record<string, unknown>).mediaSession
      vi.unstubAllGlobals()
    }
  })

  it('a load that fails while paused is let go, not retried: it does not come back on by itself', async () => {
    vi.useFakeTimers()
    // Paused while connecting, and the station refuses the spectrum's cross-origin check.
    const p = mk({ wantAnalyser: () => true })
    p.play(A)
    const el = created.at(-1)!
    await outsidePause(el)
    const before = loads.length
    el.fail(4)
    expect(p.state.value).toBe('resume')
    expect(loads).toHaveLength(before)
    // Paused while playing, and the network fails in the grace period.
    const q = mk({ wantAnalyser: () => false })
    q.play(S)
    const el2 = created.at(-1)!
    el2.succeed()
    await outsidePause(el2)
    await vi.advanceTimersByTimeAsync(5_000)
    const before2 = loads.length
    el2.fail(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(q.state.value).toBe('resume')
    expect(loads).toHaveLength(before2)
    expect(el2.src).toBe('') // let go
  })

  it('held through a pause, it still keeps to its row when the list changes meanwhile', async () => {
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    const el = created.at(-1)!
    el.succeed()
    await outsidePause(el)
    const edited = { ...A, url: 'https://first.example/s', alternates: [A.url] }
    p.follow([edited], { sameList: true })
    expect(p.station.value?.url).toBe(edited.url)
  })

  it('a stall under way when paused leaves nothing behind for the resumed stream', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    const el = created.at(-1)!
    el.succeed()
    el.dispatchEvent(new Event('waiting'))
    for (let s = 0; s < 55; s += 5) {             // a long stall, kept alive by stray bytes: most of its minute used
      await vi.advanceTimersByTimeAsync(5_000)
      el.dispatchEvent(new Event('progress'))
    }
    await outsidePause(el)
    el.succeed()                                  // the system resumes it
    const before = loads.length
    el.dispatchEvent(new Event('waiting'))        // a fresh stall, not the old one's last seconds
    await vi.advanceTimersByTimeAsync(15_000)
    expect(loads).toHaveLength(before)
  })

  it('a tap in the grace period that the autoplay policy refuses waits for a tap, whatever the old stream does', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    const el = created.at(-1)!
    el.succeed()
    await outsidePause(el)
    p.toggle()
    const next = created.at(-1)!
    next.rejectAll('NotAllowedError')
    await vi.advanceTimersByTimeAsync(0)
    expect(p.state.value).toBe('resume')
    next.dispatchEvent(new Event('playing'))
    expect(p.state.value).toBe('resume')
  })

  it('the end of a stream, which fires pause as well, is left to `ended`: it reconnects', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(S)
    const el = created.at(-1)!
    el.succeed()
    el.paused = true
    Object.defineProperty(el, 'ended', { value: true, configurable: true })
    el.dispatchEvent(new Event('pause'))
    el.dispatchEvent(new Event('ended'))
    await vi.advanceTimersByTimeAsync(0)
    expect(p.state.value).toBe('reconnecting')
  })

  it('and so where a browser does not yet say "ended" when it fires pause — one server, so it waits rather than loads', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    const el = created.at(-1)!
    el.succeed()
    el.paused = true
    el.dispatchEvent(new Event('pause'))                                   // `ended` still reads false…
    Object.defineProperty(el, 'ended', { value: true, configurable: true })
    el.dispatchEvent(new Event('ended'))                                   // …until this, in the same turn
    await vi.advanceTimersByTimeAsync(0)
    expect(p.state.value).toBe('reconnecting')                             // not "Tap to resume"
  })

  it('its own pauses — a stop, a move to another server — are not taken for one', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(S)
    created.at(-1)!.succeed()
    created.at(-1)!.dispatchEvent(new Event('ended')) // on to the next server: a new address, played at once…
    expect(created.at(-1)!.paused).toBe(false)        // …so the element is not paused,
    created.at(-1)!.dispatchEvent(new Event('pause')) // and a stray event heard on the way
    await vi.advanceTimersByTimeAsync(0)
    expect(p.state.value).toBe('reconnecting')        // is not taken for one
    p.stop()
    await outsidePause(created.at(-1)!)               // a stop is the player's own
    expect(p.state.value).toBe('idle')
  })
})

describe('the wait after every server has failed', () => {
  it('starts again from the first server when it ends', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(S)
    for (let i = 0; i < 3; i++) { created.at(-1)!.fail(2); await vi.advanceTimersByTimeAsync(0) } // s1, s2, s3
    expect(p.state.value).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(loads.at(-1)).toBe('https://s1.example/x')
  })

  it('and a stream that mends itself during it is still on the server it was', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(S)
    created.at(-1)!.fail(2); await vi.advanceTimersByTimeAsync(0) // s1
    created.at(-1)!.fail(2); await vi.advanceTimersByTimeAsync(0) // s2
    const s3 = created.at(-1)!
    s3.succeed()
    s3.dispatchEvent(new Event('waiting'))
    await vi.advanceTimersByTimeAsync(18_000)                    // s3 stalls: every server tried, a wait
    expect(p.state.value).toBe('reconnecting')
    s3.succeed()                                                  // and it comes back by itself
    expect(p.state.value).toBe('playing')
    expect(p.currentServer.value).toBe('https://s3.example/x')
    const before = loads.length
    s3.dispatchEvent(new Event('ended'))                          // drops again soon after
    await vi.advanceTimersByTimeAsync(0)
    expect(loads).toHaveLength(before)                            // every server was tried: a wait, not s2 at once
    await vi.advanceTimersByTimeAsync(2_000)
    expect(loads.at(-1)).toBe('https://s1.example/x')             // then from the first
  })
})

describe('a stall is waited out from the last byte', () => {
  it('a second `playing` with no silence between is still the same sound, and counts toward the stall\'s end', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play({ ...A })
    const el = created.at(-1)!
    el.succeed()
    el.dispatchEvent(new Event('waiting'))
    await vi.advanceTimersByTimeAsync(2_000)
    el.succeed()                                // sound…
    await vi.advanceTimersByTimeAsync(6_000)
    el.succeed()                                // …and `playing` again, no silence between
    await vi.advanceTimersByTimeAsync(4_500)    // 10.5 s of sound in all: the stall is over
    // A new stall now has its full minute of silence; with the old stall's 2 s
    // still counted against it, a stall of 59 s would be retried before its end.
    const before = loads.length
    el.dispatchEvent(new Event('waiting'))
    for (let s = 0; s < 55; s += 5) { await vi.advanceTimersByTimeAsync(5_000); el.dispatchEvent(new Event('progress')) }
    await vi.advanceTimersByTimeAsync(3_000)    // 58 s silent
    expect(p.state.value).toBe('playing')       // still waiting it out, not given up on
    expect(loads).toHaveLength(before)
  })

  it('a second `waiting` with no sound between is still the same silence, and counts', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play({ ...A })
    const el = created.at(-1)!
    el.succeed()
    const before = loads.length
    for (let s = 0; s < 120 && loads.length === before; s += 17) {
      el.dispatchEvent(new Event('waiting'))   // again and again, never a `playing` between
      await vi.advanceTimersByTimeAsync(17_000)
    }
    expect(loads.length).toBeGreaterThan(before) // retried within its minute of silence
  })

  it('18 s after the last byte, not after the stall began', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play({ ...A })
    const el = created.at(-1)!
    el.succeed()
    const before = loads.length
    el.dispatchEvent(new Event('waiting'))
    await vi.advanceTimersByTimeAsync(15_000)
    el.dispatchEvent(new Event('progress'))
    await vi.advanceTimersByTimeAsync(17_000)
    expect(loads).toHaveLength(before)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(loads.length).toBeGreaterThan(before)
  })
})

describe('time paused', () => {
  it('is not counted as steady playing', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    created.at(-1)!.fail(2)
    await vi.advanceTimersByTimeAsync(1_000)
    const el = created.at(-1)!
    el.succeed()
    await vi.advanceTimersByTimeAsync(20_000)
    await outsidePause(el)
    await vi.advanceTimersByTimeAsync(5_000)
    el.succeed()                               // the system resumes it, 25 s after it began…
    await vi.advanceTimersByTimeAsync(7_000)   // …and 32 s after, only 27 of them playing
    const before = loads.length
    el.dispatchEvent(new Event('ended'))
    await vi.advanceTimersByTimeAsync(1_001)
    expect(loads).toHaveLength(before)         // not settled: the longer wait, not the shortest
  })

  it('and a player no longer holding its stream does not follow rows', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    const el = created.at(-1)!
    el.succeed()
    await outsidePause(el)
    await vi.advanceTimersByTimeAsync(PAUSE_GRACE_MS)
    expect(p.follow([{ ...A, url: 'https://first.example/s', alternates: [A.url] }], { sameList: true })).toBeUndefined()
  })
})

describe('the level has one owner', () => {
  it('is read from the owner given, and a change made there is heard at once', async () => {
    const { ref } = await import('vue')
    const volume = ref(0.5)
    const muted = ref(false)
    const p = mk({ wantAnalyser: () => false, level: { volume, muted } })
    p.play(A)
    expect(created[0].volume).toBe(0.5)
    volume.value = 0.2          // Reset to defaults, a profile, another tab's storage
    expect(created[0].volume).toBe(0.2)
    p.setVolume(0.9)            // and the slider writes to the owner, not to a copy
    expect(volume.value).toBe(0.9)
    p.setVolume(7)
    expect(volume.value).toBe(1)
    muted.value = true
    expect(created[0].muted).toBe(true)
  })
})

describe('the transition table', () => {
  it('lets every state be stopped, and nothing play that was never started', async () => {
    const { TRANSITIONS } = await import('../src/composables/usePlayer')
    for (const [from, next] of Object.entries(TRANSITIONS)) {
      expect(next, from).toContain('idle')        // Stop always works
    }
    expect(TRANSITIONS.idle).not.toContain('playing')
    expect(TRANSITIONS.failed).not.toContain('playing')
    // `resume` → `playing` is there for one case only: a stream paused from
    // outside and resumed from outside within its grace period. A player
    // waiting for a tap after the autoplay policy refused does not start by itself.
  })

  it('waiting for a tap after the autoplay policy refused, a stray `playing` does not start it', async () => {
    const p = mk({ wantAnalyser: () => false })
    p.play(A)
    const el = created.at(-1)!
    el.rejectAll('NotAllowedError')
    await tick()
    expect(p.state.value).toBe('resume')
    el.dispatchEvent(new Event('playing'))
    expect(p.state.value).toBe('resume')
  })

  it('a station that failed can be tried again, and plays', async () => {
    const p = mk({ wantAnalyser: () => false, attempts: () => 0 })
    p.play(A)
    created.at(-1)!.fail(2)
    await tick()
    expect(p.state.value).toBe('failed')
    p.play(A)                                  // the row's button stays live for exactly this
    expect(p.state.value).toBe('connecting')
    created.at(-1)!.succeed()
    expect(p.state.value).toBe('playing')
  })
})

describe('a device on which nothing has played yet', () => {
  beforeEach(() => localStorage.removeItem('radio.everPlayed'))

  it('plays a station that refuses CORS plainly, instead of blaming the site policy', async () => {
    const p = mk()                       // the analyser is wanted: the first load is in CORS mode
    p.play(A)
    created.at(-1)!.fail(4)              // the same code a policy refusal gives
    await tick()
    expect(created).toHaveLength(2)      // retried on a plain element…
    expect(created[1].crossOrigin).toBeNull()
    expect(p.state.value).toBe('connecting')
    created[1].succeed()
    expect(p.state.value).toBe('playing') // …and it plays
  })

  it('still names the policy when the plain load is refused too', async () => {
    const p = mk()
    p.play(A)
    created.at(-1)!.fail(4); await tick()
    created.at(-1)!.fail(4); await tick()
    expect(p.state.value).toBe('failed')
    expect(p.error.value).toMatch(/media-src https:/)
  })
})

describe('a player that has given up', () => {
  afterEach(() => vi.useRealTimers())
  it('does not start playing when a load it abandoned answers late', async () => {
    vi.useFakeTimers()
    const p = mk({ wantAnalyser: () => false, attempts: () => 0 })
    p.play(A)
    await vi.advanceTimersByTimeAsync(26000) // the connect timer gives up, and there are no attempts left
    expect(p.state.value).toBe('failed')
    created[0].succeed()                     // the abandoned load starts after all
    expect(p.state.value).toBe('failed')
    expect(created[0].src).toBe('')          // it was let go, not left loading
  })
})

describe('a refused playlist is said only while it is the reason', () => {
  it('steady play again forgets an earlier refusal: a later failure, its playlist read that time, does not blame it', async () => {
    vi.useFakeTimers()
    let reads = 0
    const p = mk({
      wantAnalyser: () => false,
      attempts: () => 1,
      refreshServers: async () => { if (reads++ === 0) throw new Refused(); return [] }
    })
    p.play({ ...A, source: 'https://a.example/list.pls' })
    created.at(-1)!.fail(2) // refused: kept with the play, the server tried again after a wait
    await vi.advanceTimersByTimeAsync(0)
    expect(p.state.value).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(5_000)
    created.at(-1)!.succeed()
    await vi.advanceTimersByTimeAsync(STEADY_MS + 1_000) // plays steadily: what failed before is history
    expect(p.state.value).toBe('playing')
    created.at(-1)!.fail(2) // read this time, with nothing in it
    await vi.advanceTimersByTimeAsync(0)
    expect(reads).toBe(2)
    for (let i = 0; i < 20 && p.state.value !== 'failed'; i++) {
      if (p.state.value === 'connecting') created.at(-1)!.fail(2)
      await vi.advanceTimersByTimeAsync(5_000)
    }
    expect(p.state.value).toBe('failed')
    expect(p.error.value).not.toContain('could not be reached')
  })
})
