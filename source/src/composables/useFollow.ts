import { watch, type Ref } from 'vue'
import type { Station } from '../parsers/types'

interface Player {
  plays: Ref<number>
  station: Ref<Station | null>
  currentServer: Ref<string>
  follow: (rows: readonly Station[], o?: { sameList?: boolean }) => 'exact' | 'guess' | undefined
}
interface Lists {
  current: Ref<{ stations: Station[] }>
  currentFile: Ref<{ path: string } | null | undefined>
}

/**
 * Keeps the player on the row it is playing, whatever changes the open list
 * — the playlist read again, Find backup servers, the station form, a reload
 * after a refused save — and whenever the server playing changes, since the
 * playlist read again saves its servers to the list before the player has
 * moved onto them. See `follow` in `usePlayer`.
 *
 * Only in the list a play belongs to may a row under another address be
 * taken for it: played from a search, the directory or another list, a
 * station there that shares a backup is a different station. A play belongs
 * to the list it was started from, noted as it starts while that is still
 * what is open; to a list it is found in by its own row or address since;
 * still to that list when it is renamed; and to no list once that list is
 * deleted, so a new one made at the same path is not taken for it.
 */
export const useFollow = (player: Player, lists: Lists) => {
  let playedFrom: string | undefined
  const here = () => lists.currentFile.value?.path
  watch(() => player.plays.value, () => {
    const s = player.station.value
    playedFrom = s && lists.current.value.stations.some((r) => r.id === s.id) ? here() : undefined
  }, { flush: 'sync' })
  watch([here, () => lists.current.value], ([path, list], [was, wasList]) => {
    if (was === undefined || was !== playedFrom) return
    if (!path) playedFrom = undefined                                   // deleted
    else if (path !== was && list === wasList) playedFrom = path        // renamed: the list open did not change
  })
  watch([() => lists.current.value, () => player.currentServer.value], ([l]) => {
    const how = player.follow(l.stations, { sameList: playedFrom !== undefined && playedFrom === here() })
    if (how === 'exact') playedFrom = here()
  })
  return { playedFrom: () => playedFrom }
}
