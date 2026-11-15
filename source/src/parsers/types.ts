/**
 * A station is one entry in a playlist file.
 *
 * `extra` and `lead` exist so that a file written by another player survives a
 * round trip through this one. Anything we do not understand is carried, not
 * dropped: people edit these files by hand and in other tools, and silently
 * losing a tag is a data-loss bug that goes unnoticed until it matters.
 */
export interface Station {
  /** Stable within one loaded list; assigned on parse, never persisted. */
  id: string
  name: string
  url: string
  group?: string
  logo?: string
  homepage?: string
  country?: string
  language?: string
  network?: string
  /**
   * Backup servers, in order. The whole value of a station's .pls or .m3u is
   * that it lists several: when one dies the player moves to the next rather
   * than giving up. Resolving such a file to a single address throws that away.
   */
  alternates?: string[]
  /** The playlist this station came from, so the server list can be refreshed. */
  source?: string
  /**
   * Where to ask what is playing, when the stream does not say: NPR's Cadence
   * for a public radio station, an Icecast status, SomaFM's song feed.
   * Written as `radio-nowplaying`; https only, since a page asks it directly.
   */
  nowPlaying?: string
  /** `#EXTINF` attributes we do not recognise, preserved verbatim. */
  extra?: Record<string, string>
  /** Unrecognised lines that appeared immediately before this entry. */
  lead?: string[]
  /** Unrecognised lines between the entry's `#EXTINF` and its URL. */
  between?: string[]
  /** The `#EXTINF` duration as written, when it was not -1. Carried, not used. */
  duration?: string
}

export interface Playlist {
  /** The `#EXTM3U` line when it carried more than the tag itself. */
  header?: string
  /** From `#PLAYLIST:`, if present. */
  title?: string
  stations: Station[]
  /** Unrecognised lines after the last entry. */
  trailing: string[]
}

export type PlaylistFormat = 'm3u' | 'pls' | 'xspf' | 'hls' | 'unknown'

export const emptyPlaylist = (title?: string): Playlist => ({
  title,
  stations: [],
  trailing: []
})

let counter = 0
export const nextId = (): string => `s${++counter}`
