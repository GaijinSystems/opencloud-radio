import { describe, it, expect } from 'vitest'
import { streamsInPage, cadenceAddress } from '../scripts/find-nowplaying.mjs'
import { trackFromJson } from '../src/helpers/nowPlaying'

/**
 * The lookup an administrator runs for a public radio station's now-playing
 * address (the app cannot: station websites do not let a page on another site
 * read them). The markup is KCUR's player as it was in November 2026.
 */
const KCUR = `<ul class="BrightspotPersistentPlayer-streamsList" data-streams-list>
<li><ps-stream data-stream-name="KCUR" data-stream-id="stream-00000170" data-stream-channel-id="2edfb643-4010-4f9e-a6f8-78b08d5dbc2d" >
<ps-stream-url data-stream-format="audio/mp4" data-stream-url="https://kcur.streamguys1.com/kcur-website-icy"> </ps-stream-url>
<button class="Stream"><span class="Stream-name">KCUR</span></button></ps-stream></li>
<li><ps-stream data-stream-name="91.9 Classical KC" data-stream-id="stream-00000171" data-stream-channel-id="bff7476e-7a94-46bd-a35c-0fc00c9f0d51" >
<ps-stream-url data-stream-format="audio/mp4" data-stream-url="https://kcur.streamguys1.com/classicalkc-website-icy"> </ps-stream-url>
</ps-stream></li></ul>`

describe('finding a public radio station\'s now-playing address', () => {
  it('reads each player stream, its address and its Cadence channel from the website', () => {
    expect(streamsInPage(KCUR)).toEqual([
      { name: 'KCUR', id: '2edfb643-4010-4f9e-a6f8-78b08d5dbc2d', streams: ['https://kcur.streamguys1.com/kcur-website-icy'] },
      { name: '91.9 Classical KC', id: 'bff7476e-7a94-46bd-a35c-0fc00c9f0d51', streams: ['https://kcur.streamguys1.com/classicalkc-website-icy'] }
    ])
  })

  it('finds a channel written outside a player element, once', () => {
    const html = '<div data-stream-channel-id="1929734a-b12b-4add-bf5a-e6334c525ac5"></div><span data-stream-channel-id="1929734a-b12b-4add-bf5a-e6334c525ac5">'
    expect(streamsInPage(html)).toEqual([{ name: '', id: '1929734a-b12b-4add-bf5a-e6334c525ac5', streams: [] }])
    expect(streamsInPage('<html>no player here</html>')).toEqual([])
  })

  it('gives an address the app reads', () => {
    const at = cadenceAddress('2edfb643-4010-4f9e-a6f8-78b08d5dbc2d')
    expect(at).toBe('https://cadence.nprstations.org/api/cadence/widget/2edfb643-4010-4f9e-a6f8-78b08d5dbc2d?show_song=true')
    expect(trackFromJson({ onNow: { programName: 'All Things Considered' } }, 'https://kcur.streamguys1.com/kcur-website-icy'))
      .toEqual({ title: 'All Things Considered' })
  })
})
