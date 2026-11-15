import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowRef, nextTick } from 'vue'
import { usePlayer } from '../src/composables/usePlayer'
import { useFollow } from '../src/composables/useFollow'
import { readConfig } from '../src/config'
import { created, installFakeAudio } from './support/audio'
import type { Station } from '../src/parsers/types'

/**
 * Which list a play belongs to, and so which rows under another address may
 * be taken for it. The player and the wiring are the real ones; the lists
 * stand in for the store: the stations open, and the file they are from.
 */
beforeEach(() => {
  installFakeAudio()
  localStorage.setItem('radio.everPlayed', '1')
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
const players: Array<{ stop: () => void }> = []
afterEach(() => { for (const p of players.splice(0)) p.stop(); vi.useRealTimers(); vi.restoreAllMocks() })

const setup = (stations: Station[], path: string | null = '/Radio/A.m3u8') => {
  const lists = { current: shallowRef({ stations }), currentFile: shallowRef(path ? { path } : null) }
  const player = usePlayer(readConfig({}), { wantAnalyser: () => false, attempts: () => 5 })
  players.push(player) // stopped after each test: no timer left running
  const follow = useFollow(player, lists)
  const show = (rows: Station[], file: string | null = lists.currentFile.value?.path ?? null) => {
    lists.currentFile.value = file ? { path: file } : null
    lists.current.value = { stations: rows }
  }
  return { lists, player, follow, show }
}
const X: Station = { id: 'x', name: 'X', url: 'https://x1.example/s', alternates: ['https://shared.example/s'] }
const Z: Station = { id: 'z', name: 'Z', url: 'https://z1.example/s', alternates: ['https://shared.example/s'] }
/** X's first server fails: it plays on from the backup it shares with Z. */
const ontoShared = async () => { created.at(-1)!.fail(2); await vi.advanceTimersByTimeAsync(0); created.at(-1)!.succeed() }

describe('a play keeps to its row', () => {
  it('played from the open list, and its address changed there', async () => {
    const { player, show } = setup([X])
    player.play(X)
    created.at(-1)!.succeed()
    show([{ ...X, url: 'https://x2.example/s', alternates: [X.url] }]) // the form puts another server first
    await nextTick()
    expect(player.station.value?.url).toBe('https://x2.example/s')
  })

  it('played from elsewhere: a station of the open list sharing the backup playing is not taken for it', async () => {
    vi.useFakeTimers()
    const { player } = setup([Z]) // the open list holds Z, not X
    player.play(X)                // from the directory, a search, another list
    await ontoShared()
    await nextTick()
    expect(player.station.value?.name).toBe('X')
  })

  it('played from elsewhere but in the open list by its address: that row is its own, through a later change', async () => {
    const row = { ...X, id: 'row' }
    const { player, show } = setup([row])
    player.play({ ...X, id: 'from-the-directory' })
    created.at(-1)!.succeed()
    await nextTick()
    expect(player.station.value?.id).toBe('row')
    show([{ ...row, url: 'https://x2.example/s', alternates: [X.url] }]) // its playlist read again, say
    await nextTick()
    expect(player.station.value?.url).toBe('https://x2.example/s')
  })

  it('the list renamed while it plays is still the one it belongs to', async () => {
    const { player, lists, show } = setup([X])
    player.play(X)
    created.at(-1)!.succeed()
    lists.currentFile.value = { path: '/Radio/Renamed.m3u8' } // the same list, a new name
    await nextTick()
    show([{ ...X, url: 'https://x2.example/s', alternates: [X.url] }])
    await nextTick()
    expect(player.station.value?.url).toBe('https://x2.example/s')
  })

  it('another list opened is not taken for its own: a station there sharing the backup playing is left alone', async () => {
    vi.useFakeTimers()
    const { player, follow, show } = setup([X])
    player.play(X)
    await ontoShared()
    show([Z], '/Radio/B.m3u8')
    await nextTick()
    expect(follow.playedFrom()).toBe('/Radio/A.m3u8')
    expect(player.station.value?.name).toBe('X')
  })

  it('and back in its own list, after the row changed meanwhile, it is found again', async () => {
    const { player, show } = setup([X])
    player.play(X)
    created.at(-1)!.succeed()
    show([Z], '/Radio/B.m3u8')
    await nextTick()
    show([{ ...X, id: 'x-again', url: 'https://x2.example/s', alternates: [X.url] }], '/Radio/A.m3u8') // changed on another device, say
    await nextTick()
    expect(player.station.value?.url).toBe('https://x2.example/s')
  })

  it('the list deleted, and a new one made at its path, is not the one it belonged to', async () => {
    vi.useFakeTimers()
    const { player, follow, show } = setup([X])
    player.play(X)
    await ontoShared()
    show([], null) // deleted: nothing open
    await nextTick()
    expect(follow.playedFrom()).toBeUndefined()
    show([Z], '/Radio/A.m3u8') // a new list at the same path, Z alone sharing the backup playing
    await nextTick()
    expect(player.station.value?.name).toBe('X')
  })
})
