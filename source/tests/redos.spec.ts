import { describe, it, expect } from 'vitest'
import { trackFromTritonXml, trackFromText } from '../src/helpers/nowPlaying'
import { parseM3u } from '../src/parsers/m3u'

/**
 * Text from a station, a playlist or a now-playing service is untrusted, and a
 * regular expression that backtracks on it freezes the whole OpenCloud tab.
 * Each case here is the input that made one such pattern take time growing
 * with the cube of its length — a Triton answer of 4 000 spaces took 15 s —
 * or one built to try; each must now be read in well under a second.
 */
const elapsed = (run: () => unknown) => {
  const t0 = performance.now()
  run()
  return performance.now() - t0
}

describe('untrusted text is read in one pass', () => {
  it('a Triton answer of endless spaces with no end tag', () => {
    const evil = '<nowplaying-info><property name="cue_title">' + ' '.repeat(500_000)
    expect(elapsed(() => trackFromTritonXml(evil))).toBeLessThan(500)
    expect(elapsed(() => trackFromText(evil, 'https://x.example/s'))).toBeLessThan(500)
  })

  it('a Triton answer made of the property name over and over', () => {
    const evil = '<nowplaying-info>' + 'name="cue_title">'.repeat(4000)
    expect(elapsed(() => trackFromTritonXml(evil))).toBeLessThan(50)
  })

  it('and a CDATA title with a ] in it is read whole', () => {
    expect(trackFromTritonXml('<nowplaying-info><property name="cue_title"><![CDATA[Song [Live]]]></property></nowplaying-info>'))
      .toMatchObject({ title: 'Song [Live]' })
  })

  it('an empty property is empty, not the next one; entities are read', () => {
    const xml = '<nowplaying-info><property name="cue_title">Mrs Robinson</property><property name="track_artist_name"/>' +
      '<property name="track_album_name"><![CDATA[Alb]]></property></nowplaying-info>'
    expect(trackFromTritonXml(xml)).toEqual({ title: 'Mrs Robinson' })
    expect(trackFromTritonXml('<nowplaying-info><property name="cue_title">The Boxer</property><property name="track_artist_name">Simon &amp; Garfunkel</property></nowplaying-info>'))
      .toMatchObject({ artist: 'Simon & Garfunkel' })
  })

  it('and still reads a real one, CDATA or not', () => {
    const ok = '<nowplaying-info type="track"><property name="cue_title"><![CDATA[Templar]]></property>' +
      '<property name="track_artist_name">  Harold Budd </property></nowplaying-info>'
    expect(trackFromTritonXml(ok)).toMatchObject({ title: 'Templar', artist: 'Harold Budd' })
  })

  it('an #EXTINF line of endless attribute-like text', () => {
    const evil = '#EXTM3U\n#EXTINF:-1 ' + 'a='.repeat(100_000) + ',Name\nhttps://a.example/s\n'
    expect(elapsed(() => parseM3u(evil))).toBeLessThan(500)
  })
})
