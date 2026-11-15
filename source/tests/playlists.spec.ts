import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DavError, dav, disk, folders, ifMatchSeen, knobs, log, resetDav, seed, stamp, wait } from './support/dav'

vi.mock('@opencloud-eu/web-pkg', async () => (await import('./support/dav')).webPkgMock())

import { usePlaylists, BackupError, MAX_LIST_CHARS } from '../src/composables/usePlaylists'
import { mergeStations } from '../src/helpers/stations'
import { readConfig } from '../src/config'


beforeEach(resetDav)

/** Every copy in the backup folder whose name begins with `prefix`. */
const backupsOf = (prefix = '') => [...disk.keys()].filter((p) => p.startsWith(`/Radio/Backups/${prefix}`))

/** `n` edits of the open list, each saved: one backup apiece. The stamp is
 *  millisecond-resolution, so the saves are spaced rather than racing for a name. */
const saveTimes = async (p: ReturnType<typeof usePlaylists>, n: number, tag = 's') => {
  for (let i = 0; i < n; i++) {
    p.addStation({ id: `${tag}${i}`, name: `${tag.toUpperCase()}${i}`, url: `https://a/${tag}${i}` })
    await p.flush()
    await wait(2)
  }
}

describe('the debounced save and a list switch', () => {
  it('an edit followed immediately by opening another list is still written', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    seed('B.m3u8', '#EXTM3U\n#EXTINF:-1,Two\nhttps://b/2\n')
    // As the app runs it: every edit schedules its own save.
    const lists = usePlaylists(readConfig({}), { onSaveError: () => { throw new Error('save failed') } })
    const files = await lists.listFiles()
    await lists.open(files[0])
    vi.useFakeTimers() // the debounce is 800 ms; there is no need to really wait it out
    lists.addStation({ id: 'x', name: 'New', url: 'https://a/new' })
    await lists.open(files[1]) // within the 800 ms window
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/new')
    expect(disk.get('/Radio/B.m3u8')!.body).not.toContain('https://a/new')
    await vi.advanceTimersByTimeAsync(900)
    // and the timer did not later write B's contents anywhere. Backups are a
    // write of their own and are counted separately; what matters here is that
    // exactly one station list was written, and that it was A.
    expect(log.filter((l) => l.startsWith('PUT') && !l.includes('/Backups/')))
      .toEqual(['PUT /Radio/A.m3u8'])
  })

  it('a clean list is not rewritten just because another opens', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    seed('B.m3u8', '#EXTM3U\n')
    const lists = usePlaylists(readConfig({}))
    const files = await lists.listFiles()
    await lists.open(files[0])
    await lists.open(files[1])
    expect(log.filter((l) => l.startsWith('PUT'))).toEqual([])
  })
})

describe('a list longer than the cap', () => {
  it('shows the first N and writes ALL of them back', async () => {
    const body = '#EXTM3U\n' + Array.from({ length: 15 }, (_, i) => `#EXTINF:-1,S${i}\nhttps://a/${i}\n`).join('')
    seed('Big.m3u8', body)
    const lists = usePlaylists(readConfig({ maxStationsPerList: 10 }))
    await lists.open((await lists.listFiles())[0])
    expect(lists.current.value.stations).toHaveLength(10)
    expect(lists.status.value).toEqual({ text: expect.stringMatching(/kept in the file/), tone: 'ok' }) // information, not a failure
    lists.moveStation(lists.current.value.stations[0].id, 1)
    await lists.save()
    const written = disk.get('/Radio/Big.m3u8')!.body
    for (let i = 0; i < 15; i++) expect(written).toContain(`https://a/${i}`)
  })
})

describe('formats this app does not write', () => {
  it('a .pls list is read-only and save refuses', async () => {
    seed('Jazz.pls', '[playlist]\nFile1=https://a/1\nTitle1=One\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    expect(lists.readOnly.value).toBe(true)
    await expect(lists.save()).rejects.toThrow(/read-only/)
    expect(disk.get('/Radio/Jazz.pls')!.body).toContain('[playlist]')
  })
  it('convert writes a .m3u8 beside it and leaves the original alone', async () => {
    seed('Jazz.pls', '[playlist]\nFile1=https://a/1\nTitle1=One\n')
    const lists = usePlaylists(readConfig({}))
    const file = (await lists.listFiles())[0]
    await lists.open(file)
    const made = await lists.convertList(file)
    expect(made.name).toBe('Jazz.m3u8')
    expect(disk.get('/Radio/Jazz.m3u8')!.body).toContain('https://a/1')
    expect(disk.get('/Radio/Jazz.pls')!.body).toContain('[playlist]')
  })
  it('createList never produces a .pls name', async () => {
    folders.add('/Radio')
    const lists = usePlaylists(readConfig({}))
    await lists.listFiles()
    expect((await lists.createList('mix.pls')).name).toBe('mix.m3u8')
    expect((await lists.createList('old.m3u')).name).toBe('old.m3u')
  })
})

describe('the root folder', () => {
  it('is created on 404 only', async () => {
    const lists = usePlaylists(readConfig({}))
    await lists.listFiles()
    expect(log).toContain('MKCOL /Radio')
    log.length = 0
    knobs.listStatus = 403
    folders.clear()
    const again = usePlaylists(readConfig({}))
    await expect(again.listFiles()).rejects.toThrow()
    expect(log).not.toContain('MKCOL /Radio')
  })
})

describe('conflicts', () => {
  it('a stale etag is a ConflictError, and the edit is not written', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    disk.set('/Radio/A.m3u8', { body: '#EXTM3U\n#EXTINF:-1,Elsewhere\nhttps://a/2\n', etag: stamp() })
    lists.addStation({ id: 'x', name: 'Mine', url: 'https://a/mine' })
    await expect(lists.save()).rejects.toMatchObject({ name: 'ConflictError' })
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('Elsewhere')
  })
})

describe('an edit that flushes directly, without the debounce', () => {
  // Adding a directory station to the OPEN list, and moving a selection out of
  // it, both edit and then flush. `dirty` used to be set only by saveSoon, so
  // flush found nothing to do and the edit was never written.
  it('is written by flush', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    lists.addStation({ id: 'x', name: 'From the directory', url: 'https://a/new' })
    await lists.flush()
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/new')
  })

  it('is written for a removal too', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n#EXTINF:-1,Two\nhttps://a/2\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    lists.removeStations(new Set([lists.current.value.stations[0].id]))
    await lists.flush()
    const body = disk.get('/Radio/A.m3u8')!.body
    expect(body).not.toContain('https://a/1')
    expect(body).toContain('https://a/2')
  })

  it('a freshly opened list is not rewritten by the next flush', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    log.length = 0
    await lists.flush()
    expect(log.filter((l) => l.startsWith('PUT'))).toEqual([])
  })
})

describe('formats this app does not write, through the other doors', () => {
  it('appendTo refuses a .pls target', async () => {
    seed('Jazz.pls', '[playlist]\nFile1=https://a/1\n')
    const lists = usePlaylists(readConfig({}))
    const file = (await lists.listFiles())[0]
    await expect(lists.appendTo(file, [{ id: 'x', name: 'N', url: 'https://a/2' }])).rejects.toThrow(/read-only/)
    expect(disk.get('/Radio/Jazz.pls')!.body).toContain('[playlist]')
  })
  it('convert carries the overflow of a list longer than the cap', async () => {
    const body = '[playlist]\n' + Array.from({ length: 15 }, (_, i) => `File${i + 1}=https://a/${i}\n`).join('')
    seed('Big.pls', body)
    const lists = usePlaylists(readConfig({ maxStationsPerList: 10 }))
    const file = (await lists.listFiles())[0]
    await lists.open(file)
    await lists.convertList(file)
    const written = disk.get('/Radio/Big.m3u8')!.body
    for (let i = 0; i < 15; i++) expect(written).toContain(`https://a/${i}`)
  })
})

describe('after a conflict', () => {
  it('reload re-reads the file so the next save can land', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    disk.set('/Radio/A.m3u8', { body: '#EXTM3U\n#EXTINF:-1,Elsewhere\nhttps://a/2\n', etag: stamp() })
    lists.addStation({ id: 'x', name: 'Mine', url: 'https://a/mine' })
    await expect(lists.save()).rejects.toMatchObject({ name: 'ConflictError' })
    await lists.reload()
    expect(lists.current.value.stations.map((s) => s.url)).toEqual(['https://a/2'])
    lists.addStation({ id: 'y', name: 'Again', url: 'https://a/again' })
    await lists.flush()
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/again')
  })
})


describe('no list is modified without a backup first', () => {
  it('saving an edit backs up what was on the server first', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.open(p.files.value[0])
    p.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    await p.flush()

    const copies = backupsOf('A.')
    expect(copies).toHaveLength(1)
    // The copy is the PREVIOUS content, not what was just written.
    expect(disk.get(copies[0])!.body).toContain('One')
    expect(disk.get(copies[0])!.body).not.toContain('Two')
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('Two')
    // ...and it was made before the list itself was written.
    const copied = log.indexOf(`COPY /Radio/A.m3u8 ${copies[0]}`)
    expect(copied).toBeGreaterThan(-1)
    expect(copied).toBeLessThan(log.lastIndexOf('PUT /Radio/A.m3u8'))
  })

  it('deleting a list backs it up first', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.deleteList(p.files.value[0])
    expect(disk.has('/Radio/A.m3u8')).toBe(false)
    const copies = backupsOf('A.')
    expect(copies).toHaveLength(1)
    expect(disk.get(copies[0])!.body).toContain('One')
  })

  it('renaming a list backs it up first', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.renameList(p.files.value[0], 'B')
    expect(disk.has('/Radio/B.m3u8')).toBe(true)
    expect(backupsOf('A.')).toHaveLength(1)
  })

  it('appending to another list backs that list up first', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    const { added } = await p.appendTo(p.files.value[0], [{ id: 'n', name: 'New', url: 'https://a/9' }])
    expect(added).toBe(1)
    const copies = backupsOf('A.')
    expect(copies).toHaveLength(1)
    expect(disk.get(copies[0])!.body).not.toContain('New')
  })

  it('appending nothing new writes neither the list nor a backup', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    const { added, duplicates } = await p.appendTo(p.files.value[0], [{ id: 'n', name: 'One', url: 'https://a/1' }])
    expect(added).toBe(0)
    expect(duplicates).toBe(1)
    expect(backupsOf('A.')).toHaveLength(0)
    expect(log.filter((l) => l === 'PUT /Radio/A.m3u8')).toHaveLength(0)
  })

  it('a backup that cannot be written stops the modification', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.open(p.files.value[0])
    const before = disk.get('/Radio/A.m3u8')!.body

    knobs.putFails = /^\/Radio\/Backups\//
    p.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    await expect(p.flush()).rejects.toBeInstanceOf(BackupError)

    // The list is exactly as it was, and the edit is still pending.
    expect(disk.get('/Radio/A.m3u8')!.body).toBe(before)
    expect(log.filter((l) => l === 'PUT /Radio/A.m3u8')).toHaveLength(0)
  })

  it('a list that is not on the server yet needs no backup', async () => {
    folders.add('/Radio')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.createList('Fresh')
    expect(disk.has('/Radio/Fresh.m3u8')).toBe(true)
    expect(backupsOf('Fresh.')).toHaveLength(0)
  })

  it('every backup of one list is kept, not overwritten', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.open(p.files.value[0])
    await saveTimes(p, 2)
    expect(backupsOf('A.')).toHaveLength(2)
  })
})


describe('backups are pruned to the number the user asked for', () => {

  it('keeps five by default', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.open(p.files.value[0])
    await saveTimes(p, 8)
    expect(backupsOf('A.')).toHaveLength(5)
  })

  it('keeps the number the preference names, and it is the newest ones', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig(), { keepBackups: () => 2 })
    await p.listFiles()
    await p.open(p.files.value[0])
    await saveTimes(p, 5)

    const kept = backupsOf('A.').sort()
    expect(kept).toHaveLength(2)
    // The last backup holds everything written before the final save.
    expect(disk.get(kept[1])!.body).toContain('s3')
  })

  it('a value below one is still one: the newest copy always survives', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig(), { keepBackups: () => 0 })
    await p.listFiles()
    await p.open(p.files.value[0])
    await saveTimes(p, 3)
    expect(backupsOf('A.')).toHaveLength(1)
  })

  it('prunes only the list it was given', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    seed('B.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig(), { keepBackups: () => 1 })
    await p.listFiles()
    await p.open(p.files.value.find((f) => f.name === 'B.m3u8')!)
    await saveTimes(p, 2)
    expect(backupsOf('B.')).toHaveLength(1)

    await p.open(p.files.value.find((f) => f.name === 'A.m3u8')!)
    await saveTimes(p, 2)
    expect(backupsOf('A.')).toHaveLength(1)
    expect(backupsOf('B.')).toHaveLength(1) // B's copy was not swept up
  })

  it('does not mistake another list\'s copies for its own', async () => {
    seed('Rock.m3u8', '#EXTM3U\n')
    seed('Rock.old.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig(), { keepBackups: () => 1 })
    await p.listFiles()
    await p.open(p.files.value.find((f) => f.name === 'Rock.old.m3u8')!)
    await saveTimes(p, 1)
    const older = backupsOf('Rock.old.')
    expect(older).toHaveLength(1)

    // `Rock` pruning to one must not count `Rock.old`'s copy as one of its own.
    await p.open(p.files.value.find((f) => f.name === 'Rock.m3u8')!)
    await saveTimes(p, 2)
    expect(backupsOf('Rock.old.')).toEqual(older)
  })

  it('leaves files in the folder that it did not write', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig(), { keepBackups: () => 1 })
    await p.listFiles()
    await p.open(p.files.value[0])
    await saveTimes(p, 1)
    disk.set('/Radio/Backups/notes.txt', { body: 'mine', etag: '"x"' })
    disk.set('/Radio/Backups/A.m3u8', { body: 'also mine', etag: '"y"' })
    await saveTimes(p, 2)

    expect(disk.has('/Radio/Backups/notes.txt')).toBe(true)
    expect(disk.has('/Radio/Backups/A.m3u8')).toBe(true) // no stamp: not ours
  })

  it('a prune that fails does not fail the save', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig(), { keepBackups: () => 1 })
    await p.listFiles()
    await p.open(p.files.value[0])

    knobs.listFails = /^\/Radio\/Backups$/
    p.addStation({ id: 'x', name: 'X', url: 'https://a/x' })
    await expect(p.flush()).resolves.toBeUndefined()

    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/x') // the save landed
    expect(backupsOf('A.')).toHaveLength(1)                          // and so did the copy
  })
})


describe('the backup folder can go missing and come back', () => {

  it('a folder removed by hand mid-session is recreated, and the save still lands', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.open(p.files.value[0])
    p.addStation({ id: 'a', name: 'A', url: 'https://a/1' })
    await p.flush()
    expect(backupsOf()).toHaveLength(1)

    // The user tidies the folder away in Files.
    for (const k of backupsOf()) disk.delete(k)
    folders.delete('/Radio/Backups')

    p.addStation({ id: 'b', name: 'B', url: 'https://a/2' })
    await expect(p.flush()).resolves.toBeUndefined()
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/2')
    expect(folders.has('/Radio/Backups')).toBe(true)
    expect(backupsOf()).toHaveLength(1)
    expect(log.filter((l) => l === 'MKCOL /Radio/Backups')).toHaveLength(2)
  })
})

describe('pruning is bookkeeping, not a listing per save', () => {
  it('lists the folder once per list per session', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig(), { keepBackups: () => 2 })
    await p.listFiles()
    await p.open(p.files.value[0])
    await saveTimes(p, 5)
    expect(log.filter((l) => l === 'LIST /Radio/Backups')).toHaveLength(1)
    expect(backupsOf('A.')).toHaveLength(2)
  })

  it('a copy already removed by hand does not stop the others being pruned', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    let keep = 10
    const p = usePlaylists(readConfig(), { keepBackups: () => keep })
    await p.listFiles()
    await p.open(p.files.value[0])
    await saveTimes(p, 3)
    const three = backupsOf('A.').sort()
    expect(three).toHaveLength(3)
    disk.delete(three[0]) // gone behind the app's back, which still counts it
    keep = 1
    await saveTimes(p, 1, 'w')
    // Four known, one kept: three deletes attempted, one of them a 404, the rest done.
    expect(backupsOf('A.')).toHaveLength(1)
  })

})

describe('a pending edit that cannot be saved keeps its list open', () => {
  it('open() refuses to switch, and the edit is still there', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    seed('B.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    const [a, b] = p.files.value
    await p.open(a)
    p.addStation({ id: 'x', name: 'X', url: 'https://a/x' })
    knobs.putFails = /^\/Radio\/Backups\//

    await expect(p.open(b)).rejects.toBeInstanceOf(BackupError)
    expect(p.currentFile.value?.name).toBe('A.m3u8')
    expect(p.current.value.stations.map((s) => s.url)).toContain('https://a/x')
    expect(p.isDirty()).toBe(true)
    expect(p.status.value).toEqual({ text: expect.stringMatching(/A\.m3u8 stays open/), tone: 'bad' })
    expect(disk.get('/Radio/A.m3u8')!.body).not.toContain('https://a/x')

    // Once the cause is fixed the same switch goes through, writing the edit first.
    knobs.putFails = /(?!)/
    await p.open(b)
    expect(p.currentFile.value?.name).toBe('B.m3u8')
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/x')
    expect(p.isDirty()).toBe(false)
  })

  it('isDirty follows the edit and the write', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.open(p.files.value[0])
    expect(p.isDirty()).toBe(false)
    p.addStation({ id: 'x', name: 'X', url: 'https://a/x' })
    expect(p.isDirty()).toBe(true)
    await p.flush()
    expect(p.isDirty()).toBe(false)
  })
})

describe('settings profiles', () => {
  it('a name that is taken is refused, not overwritten', async () => {
    folders.add('/Radio')
    const p = usePlaylists(readConfig())
    await p.saveProfile('laptop', '[profile]\nversion=1\n')
    await expect(p.saveProfile('laptop', 'something else')).rejects.toThrow(/already exists/)
    expect(disk.get('/Radio/Settings/laptop.ini')!.body).toContain('version=1')
  })

  it('a missing folder is an empty list; a failing server is an error', async () => {
    folders.add('/Radio')
    const p = usePlaylists(readConfig())
    expect(await p.listProfiles()).toEqual([])
    knobs.listFails = /^\/Radio\/Settings$/
    folders.add('/Radio/Settings')
    await expect(p.listProfiles()).rejects.toThrow()
  })
})


describe('a folder removed under the app is put back', () => {
  it('deleting Radio/ mid-session no longer wedges every save', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.open(p.files.value[0])
    p.addStation({ id: 'a', name: 'A', url: 'https://a/1' })
    await p.flush()

    // The user removes the whole folder in Files. `rootKnown` still says it is
    // there, and until 1.1.8 every later save failed on a missing parent —
    // the same never-revisited-flag shape as the backups folder.
    for (const k of [...disk.keys()]) if (k.startsWith('/Radio')) disk.delete(k)
    folders.delete('/Radio'); folders.delete('/Radio/Backups')

    p.addStation({ id: 'b', name: 'B', url: 'https://a/2' })
    await expect(p.flush()).resolves.toBeUndefined()
    expect(folders.has('/Radio')).toBe(true)
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/2')
  })

  it('createList recovers too, and a genuine refusal is still a refusal', async () => {
    folders.add('/Radio')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    folders.delete('/Radio')
    await p.createList('Fresh')
    expect(disk.has('/Radio/Fresh.m3u8')).toBe(true)
    // A name that is taken is a 412, not a missing folder: not retried, refused.
    await expect(p.createList('Fresh')).rejects.toThrow(/already exists/)
  })
})


describe('writes do not overtake one another', () => {
  // A save is four requests and the debounce is 800 ms. On a slow link the
  // second save started while the first PUT was out, carried the etag the
  // first was replacing, drew a 412, and App answered the ConflictError by
  // reloading — which threw the newer edit away. Verified against 1.1.8 with
  // this exact test before the fix: the second save rejected and "Three"
  // never reached the server.
  it('a second save started during the first waits for it and lands', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    vi.useFakeTimers()
    knobs.putDelay = 60
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    const first = lists.save()
    await vi.advanceTimersByTimeAsync(10) // the first save's backup is done and its PUT is in flight
    lists.addStation({ id: 'y', name: 'Three', url: 'https://a/3' })
    const second = lists.save()
    await vi.advanceTimersByTimeAsync(500)
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
    const body = disk.get('/Radio/A.m3u8')!.body
    expect(body).toContain('https://a/2')
    expect(body).toContain('https://a/3')
    expect(lists.isDirty()).toBe(false)
  })

  it('a delete of the list a save is halfway through does not leave the file revived', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    seed('B.m3u8', '#EXTM3U\n')
    const lists = usePlaylists(readConfig({}))
    const files = await lists.listFiles()
    await lists.open(files[0])
    vi.useFakeTimers()
    knobs.putDelay = 60
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    const save = lists.save()
    await vi.advanceTimersByTimeAsync(10) // the PUT is out
    const deleting = lists.deleteList(files[0])
    await vi.advanceTimersByTimeAsync(500)
    await deleting
    await save.catch(() => undefined)
    expect(disk.has('/Radio/A.m3u8')).toBe(false)
    expect(lists.currentFile.value).toBeNull()
  })

  it('opening another list waits for a save in flight, so the switch cannot half-happen', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    seed('B.m3u8', '#EXTM3U\n#EXTINF:-1,Two\nhttps://b/2\n')
    const lists = usePlaylists(readConfig({}))
    const files = await lists.listFiles()
    await lists.open(files[0])
    vi.useFakeTimers()
    knobs.putDelay = 60
    lists.addStation({ id: 'x', name: 'New', url: 'https://a/new' })
    const save = lists.save()
    await vi.advanceTimersByTimeAsync(10) // the PUT is out
    const opening = lists.open(files[1])
    await vi.advanceTimersByTimeAsync(500)
    await opening
    await save
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/new')
    expect(lists.currentFile.value?.name).toBe('B.m3u8')
  })
})

describe('etags, as the client actually spells them', () => {
  it('the read cache hits when the listing and the GET describe the same file', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    seed('B.m3u8', '#EXTM3U\n#EXTINF:-1,Two\nhttps://b/2\n')
    const lists = usePlaylists(readConfig({}))
    const files = await lists.listFiles()
    await lists.readList(files[1])
    await lists.readList(files[1])
    await lists.readList(files[1])
    // Until 1.1.8 the cache stored the GET header (quoted) and compared it to
    // the listing's etag (stripped), so every search re-read every list.
    expect(log.filter((l) => l.startsWith('GET'))).toEqual(['GET /Radio/B.m3u8'])
  })

  it('a list edited elsewhere is re-read because its etag moved', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    let files = await lists.listFiles()
    expect((await lists.readList(files[0])).stations).toHaveLength(1)
    disk.set('/Radio/A.m3u8', { body: '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n#EXTINF:-1,Two\nhttps://a/2\n', etag: stamp() })
    files = await lists.listFiles()
    expect((await lists.readList(files[0])).stations).toHaveLength(2)
  })

  it('If-Match goes out quoted whichever spelling the etag arrived in', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0]) // etag from the GET header: quoted
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    await lists.save()                              // etag from the PUT result: bare
    lists.addStation({ id: 'y', name: 'Three', url: 'https://a/3' })
    await lists.save()
    await lists.appendTo(lists.files.value[0], [{ id: 'z', name: 'Four', url: 'https://a/4' }])
    expect(ifMatchSeen.length).toBeGreaterThanOrEqual(3)
    for (const tag of ifMatchSeen) expect(tag).toMatch(/^"e\d+"$/)
  })

  it('the second save of a session sends an etag the server recognises', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    await lists.save()
    lists.addStation({ id: 'y', name: 'Three', url: 'https://a/3' })
    await expect(lists.save()).resolves.toBeUndefined()
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/3')
  })
})

describe('a name taken since the last listing', () => {
  it('createList says so in words, not in a status code', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const lists = usePlaylists(readConfig({}))
    await lists.listFiles()
    disk.set('/Radio/B.m3u8', { body: '#EXTM3U\n', etag: stamp() }) // another tab, just now
    await expect(lists.createList('B')).rejects.toThrow(/already exists/)
    expect(lists.files.value.map((f) => f.name)).toContain('B.m3u8') // and the rail caught up
  })

  it('renameList likewise', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const lists = usePlaylists(readConfig({}))
    const files = await lists.listFiles()
    await lists.open(files[0])
    disk.set('/Radio/B.m3u8', { body: '#EXTM3U\n', etag: stamp() })
    await expect(lists.renameList(files[0], 'B')).rejects.toThrow(/already exists/)
    expect(disk.has('/Radio/A.m3u8')).toBe(true)
  })
})

describe('what convert keeps', () => {
  it('the original title, not the filename', async () => {
    seed('Mix.xspf', '<?xml version="1.0"?><playlist version="1" xmlns="http://xspf.org/ns/0/"><title>Late Night Mix</title><trackList><track><location>https://a/1</location><title>One</title></track></trackList></playlist>')
    const lists = usePlaylists(readConfig({}))
    const file = (await lists.listFiles())[0]
    await lists.open(file)
    await lists.convertList(file)
    expect(disk.get('/Radio/Mix.m3u8')!.body).toContain('#PLAYLIST:Late Night Mix')
  })
})

describe('what a profile save reports', () => {
  it('is the name the file was given', async () => {
    folders.add('/Radio')
    const lists = usePlaylists(readConfig({}))
    await lists.listFiles()
    await expect(lists.saveProfile('lap/top:1', '[profile]\nversion=1\n')).resolves.toBe('laptop1')
    expect(disk.has('/Radio/Settings/laptop1.ini')).toBe(true)
  })
})

describe('two lists asked for in a row', () => {
  it('the one asked for last is the one shown, whichever answers last', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    seed('B.m3u8', '#EXTM3U\n#EXTINF:-1,Two\nhttps://b/2\n')
    const lists = usePlaylists(readConfig({}))
    const [a, b] = await lists.listFiles()
    vi.useFakeTimers()
    knobs.getDelay['/Radio/A.m3u8'] = 40
    const first = lists.open(a)
    const second = lists.open(b)
    await vi.advanceTimersByTimeAsync(100)
    expect(await second).toBe(true)
    expect(await first).toBe(false) // answered late, and stood down
    expect(lists.currentFile.value?.name).toBe('B.m3u8')
    expect(lists.current.value.stations[0].url).toBe('https://b/2')
    expect(lists.loading.value).toBe(false)
  })

  it('an edit made while the next list is still loading is written to the list it was made in', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    seed('B.m3u8', '#EXTM3U\n#EXTINF:-1,Two\nhttps://b/2\n')
    const lists = usePlaylists(readConfig({}), { onSaveError: () => undefined })
    const [a, b] = await lists.listFiles()
    await lists.open(a)
    vi.useFakeTimers()
    knobs.getDelay['/Radio/B.m3u8'] = 40
    const switching = lists.open(b)
    await vi.advanceTimersByTimeAsync(5) // B is still being read
    lists.addStation({ id: 'x', name: 'Late', url: 'https://a/late' })
    await vi.advanceTimersByTimeAsync(100)
    await switching
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/late')
    expect(lists.currentFile.value?.name).toBe('B.m3u8')
    expect(lists.isDirty()).toBe(false)
    await vi.advanceTimersByTimeAsync(900) // past the 800 ms debounce the edit armed
    expect(log.filter((l) => l === 'PUT /Radio/B.m3u8')).toEqual([]) // and B was not rewritten for nothing
  })
})

describe('a delete that fails', () => {
  it('leaves the pending edit pending', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    const [a] = await lists.listFiles()
    await lists.open(a)
    lists.addStation({ id: 'x', name: 'New', url: 'https://a/new' })
    knobs.putFails = /^\/Radio\/Backups\//
    await expect(lists.deleteList(a)).rejects.toBeInstanceOf(BackupError)
    expect(disk.has('/Radio/A.m3u8')).toBe(true)
    expect(lists.isDirty()).toBe(true) // or nothing would ever write it, and no prompt on leaving
  })
})

describe('renaming', () => {
  it('does not double an extension typed with the name', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const lists = usePlaylists(readConfig({}))
    const [a] = await lists.listFiles()
    expect((await lists.renameList(a, 'Rock.m3u8')).name).toBe('Rock.m3u8')
    expect(disk.has('/Radio/Rock.m3u8')).toBe(true)
  })

  it('allows a change of case alone, and does nothing for the same name', async () => {
    seed('Rock.m3u8', '#EXTM3U\n')
    const lists = usePlaylists(readConfig({}))
    const [a] = await lists.listFiles()
    expect((await lists.renameList(a, 'Rock')).name).toBe('Rock.m3u8')
    expect(backupsOf('')).toEqual([]) // nothing changed, nothing copied
    expect((await lists.renameList(a, 'rock')).name).toBe('rock.m3u8')
    expect(disk.has('/Radio/rock.m3u8')).toBe(true)
  })

  it('a new list carries no title of its own, so its heading follows its file name', async () => {
    folders.add('/Radio')
    const lists = usePlaylists(readConfig({}))
    await lists.listFiles()
    await lists.createList('Favourites')
    expect(disk.get('/Radio/Favourites.m3u8')!.body).not.toContain('#PLAYLIST')
  })
})

describe('a save is written once', () => {
  it('a flush while that save is in flight does not write it again', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    vi.useFakeTimers()
    knobs.putDelay = 40
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    const save = lists.save()
    await vi.advanceTimersByTimeAsync(5) // the PUT is out
    const flushing = lists.flush()
    await vi.advanceTimersByTimeAsync(200)
    await flushing
    await save
    expect(log.filter((l) => l === 'PUT /Radio/A.m3u8')).toHaveLength(1)
    expect(backupsOf('')).toHaveLength(1)
  })

  it('two changes inside one millisecond each keep a backup of their own', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    vi.useFakeTimers({ toFake: ['Date'] }) // the clock stands still; timers still run
    try {
      lists.addStation({ id: 'x', name: 'One', url: 'https://a/1' })
      await lists.save()
      vi.setSystemTime(Date.now()) // still the same millisecond
      lists.addStation({ id: 'y', name: 'Two', url: 'https://a/2' })
      const second = lists.save()
      await wait(1); vi.setSystemTime(Date.now() + 5)
      await second
    } finally { vi.useRealTimers() }
    expect(backupsOf('')).toHaveLength(2)
  })
})

describe('a save that landed although the client reported a failure', () => {
  it('is recognised, so the next save is not a false conflict', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    knobs.propfindLost = /^\/Radio\/A\.m3u8$/
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    await expect(lists.save()).resolves.toBeUndefined()
    expect(lists.isDirty()).toBe(false)
    knobs.propfindLost = /(?!)/
    lists.addStation({ id: 'y', name: 'Three', url: 'https://a/3' })
    await expect(lists.save()).resolves.toBeUndefined() // until fixed: ConflictError, and a reload that dropped it
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/3')
  })

  it('a save that really did not land is still a failure', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    knobs.putFails = /^\/Radio\/A\.m3u8$/
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    await expect(lists.save()).rejects.toThrow(/could not be saved/)
    expect(lists.isDirty()).toBe(true)
  })
})

describe('opening a list when things are not as usual', () => {
  it('an edit with no list open to hold it does not stop the next list opening', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    const [a] = await lists.listFiles()
    // Nothing is open, so there is nowhere to save it: refused, not accepted and lost.
    const res = lists.addStations([{ id: 'x', name: 'Stray', url: 'https://a/stray' }])
    expect(res.added).toBe(0)
    expect(res.left).toHaveLength(1)
    expect(lists.isDirty()).toBe(false)
    // and nothing is left waiting that could hang the next open
    expect(await Promise.race([lists.open(a), wait(500).then(() => 'hung')])).toBe(true)
    expect(lists.currentFile.value?.name).toBe('A.m3u8')
  })

  it('a switch that is refused does not leave the list looking as if it were still loading', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    seed('B.m3u8', '#EXTM3U\n')
    seed('C.m3u8', '#EXTM3U\n')
    const lists = usePlaylists(readConfig({}))
    const [a, b, c] = await lists.listFiles()
    await lists.open(a)
    vi.useFakeTimers()
    knobs.getDelay['/Radio/B.m3u8'] = 40
    const toB = lists.open(b)                 // still reading
    await vi.advanceTimersByTimeAsync(5)
    lists.addStation({ id: 'x', name: 'X', url: 'https://a/x' })
    knobs.putFails = /^\/Radio\/Backups\//         // the edit cannot be saved…
    const refused = expect(lists.open(c)).rejects.toBeInstanceOf(BackupError) // …so this switch is refused
    await vi.advanceTimersByTimeAsync(100)
    await refused
    expect(await toB).toBe(false)             // and the earlier one stands down
    expect(lists.loading.value).toBe(false)
    expect(lists.currentFile.value?.name).toBe('A.m3u8')
  })

  it('a save whose follow-up request was refused with a status still counts as landed', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    knobs.propfindStatus = 503
    knobs.propfindLost = /^\/Radio\/A\.m3u8$/
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    await expect(lists.save()).resolves.toBeUndefined()
    knobs.propfindLost = /(?!)/
    lists.addStation({ id: 'y', name: 'Three', url: 'https://a/3' })
    await expect(lists.save()).resolves.toBeUndefined()
  })
})

describe('loose ends of opening and renaming', () => {
  it('a superseded open that then fails says nothing about the list on screen', async () => {
    seed('B.m3u8', '#EXTM3U\n#EXTINF:-1,Two\nhttps://b/2\n')
    const lists = usePlaylists(readConfig({}))
    const [b] = await lists.listFiles()
    const gone = { name: 'A.m3u8', path: '/Radio/A.m3u8' }
    knobs.getDelay['/Radio/A.m3u8'] = 30 // answers late, with a 404
    const first = lists.open(gone)
    await lists.open(b)
    expect(await first).toBe(false)
    expect(lists.status.value).toBeNull()
    expect(lists.currentFile.value?.name).toBe('B.m3u8')
  })

  it('two flushes at once write a pending edit once', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    await Promise.all([lists.flush(), lists.flush()])
    expect(log.filter((l) => l === 'PUT /Radio/A.m3u8')).toHaveLength(1)
  })

  it('a renamed list is saved under its new name even if it was never reopened', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    const [a] = await lists.listFiles()
    await lists.open(a)
    await lists.renameList(a, 'Rock')
    expect(lists.currentFile.value?.path).toBe('/Radio/Rock.m3u8')
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    await expect(lists.flush()).resolves.toBeUndefined()
    expect(disk.get('/Radio/Rock.m3u8')!.body).toContain('https://a/2')
  })
})

describe('how a backup is made', () => {

  it('the server copies the list itself: a save does not download it and upload it again', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    log.length = 0
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    await lists.flush()
    expect(log.filter((l) => l.startsWith('GET'))).toEqual([])
    expect(log.filter((l) => l.startsWith('PUT'))).toEqual(['PUT /Radio/A.m3u8'])
    expect(backupsOf()).toHaveLength(1)
    expect(disk.get(backupsOf()[0])!.body).not.toContain('https://a/2') // what was there before
  })

  it('a server that will not copy changes nothing about the guarantee', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    knobs.copySupported = false
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    await lists.flush()
    expect(backupsOf()).toHaveLength(1)
    expect(disk.get(backupsOf()[0])!.body).toContain('https://a/1')
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/2')
    // …and when neither way works, the list is still not touched.
    knobs.putFails = /^\/Radio\/Backups\//
    lists.addStation({ id: 'y', name: 'Three', url: 'https://a/3' })
    await expect(lists.flush()).rejects.toBeInstanceOf(BackupError)
    expect(disk.get('/Radio/A.m3u8')!.body).not.toContain('https://a/3')
  })
})

describe('what may join a list', () => {
  const st = (n: number) => ({ id: `s${n}`, name: `S${n}`, url: `https://a/${n}` })

  it('one row per address, counting the batch itself, and no more than the list holds', () => {
    const m = mergeStations([st(1), st(2)], [st(2), st(3), st(3), st(4), st(5)], 4)
    expect(m.stations.map((s) => s.url)).toEqual(['https://a/1', 'https://a/2', 'https://a/3', 'https://a/4'])
    expect(m.added).toBe(2)
    expect(m.duplicates).toBe(2) // one already there, one listed twice
    expect(m.left.map((s) => s.url)).toEqual(['https://a/5'])
  })

  it('the open list applies it to every add', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({ maxStationsPerList: 10 }))
    await lists.open((await lists.listFiles())[0])
    expect(lists.addStation(st(1)).added).toBe(0) // already there
    const many = lists.addStations(Array.from({ length: 12 }, (_, i) => st(i + 2)))
    expect(many.added).toBe(9)
    expect(many.left).toHaveLength(3)
    expect(lists.current.value.stations).toHaveLength(10)
  })

  it('so does a move into another list: what it has no room for is handed back, not lost', async () => {
    seed('A.m3u8', '#EXTM3U\n' + Array.from({ length: 9 }, (_, i) => `#EXTINF:-1,S${i}\nhttps://t/${i}\n`).join(''))
    const lists = usePlaylists(readConfig({ maxStationsPerList: 10 }))
    const [a] = await lists.listFiles()
    const res = await lists.appendTo(a, [st(1), st(2), st(3)])
    expect(res.added).toBe(1)
    expect(res.left.map((s) => s.url)).toEqual(['https://a/2', 'https://a/3'])
  })

  it('and a new list', async () => {
    folders.add('/Radio')
    const lists = usePlaylists(readConfig({ maxStationsPerList: 10 }))
    await lists.listFiles()
    await lists.createList('Seeded', [st(1), st(1), ...Array.from({ length: 12 }, (_, i) => st(i + 2))])
    expect(disk.get('/Radio/Seeded.m3u8')!.body.match(/^https:/gm)).toHaveLength(10)
  })

  it('an edit cannot give a station the address of another', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n#EXTINF:-1,Two\nhttps://a/2\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    const [one, two] = lists.current.value.stations
    expect(lists.updateStation(two.id, { url: 'https://a/1' })).toBe(false)
    expect(lists.current.value.stations[1].url).toBe('https://a/2')
    expect(lists.updateStation(one.id, { url: 'https://a/1', name: 'Renamed' })).toBe(true) // its own address is not a collision
  })
})

describe('every edit goes through one door', () => {
  it('a list this app does not write refuses all of them, and is never left waiting to be saved', async () => {
    seed('Jazz.pls', '[playlist]\nFile1=https://a/1\nTitle1=One\nFile2=https://a/2\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    const [one] = lists.current.value.stations
    expect(lists.addStation({ id: 'x', name: 'X', url: 'https://a/x' }).added).toBe(0)
    expect(lists.updateStation(one.id, { name: 'Changed' })).toBe(false)
    expect(lists.moveStation(one.id, 1)).toBe(false)
    expect(lists.removeStations(new Set([one.id]))).toBe(false)
    expect(lists.current.value.stations.map((s) => s.name)).toEqual(['One', 'https://a/2'])
    expect(lists.isDirty()).toBe(false) // until fixed: dirty, unwritable, and the next list switch refused for it
  })

  it('given somewhere to report to, an edit saves itself', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const errors: Error[] = []
    const lists = usePlaylists(readConfig({}), { onSaveError: (e) => errors.push(e) })
    await lists.open((await lists.listFiles())[0])
    vi.useFakeTimers()
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    lists.moveStation('x', -1) // a burst is one write
    await vi.advanceTimersByTimeAsync(900)
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/2')
    expect(log.filter((l) => l === 'PUT /Radio/A.m3u8')).toHaveLength(1)
    expect(errors).toEqual([])
    // An edit flushed before its timer fires is not written a second time.
    lists.addStation({ id: 'y', name: 'Three', url: 'https://a/3' })
    await lists.flush()
    await vi.advanceTimersByTimeAsync(900)
    expect(log.filter((l) => l === 'PUT /Radio/A.m3u8')).toHaveLength(2)
    // …and a save that fails is reported, with the edit still waiting.
    knobs.putFails = /^\/Radio\/Backups\//
    knobs.copySupported = false
    lists.addStation({ id: 'z', name: 'Four', url: 'https://a/4' })
    await vi.advanceTimersByTimeAsync(900)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(BackupError)
    expect(lists.isDirty()).toBe(true)
  })

  it('a delete that fails gives the waiting edit back its save', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}), { onSaveError: () => undefined })
    const [a] = await lists.listFiles()
    await lists.open(a)
    vi.useFakeTimers()
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    knobs.putFails = /^\/Radio\/Backups\//
    knobs.copySupported = false
    await expect(lists.deleteList(a)).rejects.toBeInstanceOf(BackupError)
    knobs.putFails = /(?!)/
    await vi.advanceTimersByTimeAsync(900)
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/2')
  })
})

describe('a file too large to be a station list', () => {
  it('is not opened, searched or appended to — and can still be deleted, with its backup', async () => {
    seed('Huge.m3u8', '#EXTM3U\n' + '#'.repeat(MAX_LIST_CHARS))
    seed('B.m3u8', '#EXTM3U\n')
    const lists = usePlaylists(readConfig({}))
    const files = await lists.listFiles()
    const huge = files.find((f) => f.name === 'Huge.m3u8')!
    await expect(lists.open(huge)).rejects.toThrow(/too large/)
    await expect(lists.readList(huge)).rejects.toThrow(/too large/)
    await expect(lists.appendTo(huge, [{ id: 'x', name: 'X', url: 'https://a/x' }])).rejects.toThrow(/too large/)
    knobs.copySupported = false // the slow way has to manage it as well
    await lists.deleteList(huge)
    expect(disk.has('/Radio/Huge.m3u8')).toBe(false)
    expect(backupsOf('Huge.')).toHaveLength(1)
  })
})

describe('the copy just made is never the one pruned', () => {
  it('even when the folder holds copies stamped later than now', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,Before\nhttps://a/before\n')
    folders.add('/Radio/Backups')
    // Another device, its clock years ahead, has been here.
    for (let i = 0; i < 6; i++) {
      disk.set(`/Radio/Backups/A.2099-01-0${i + 1}T00-00-00-000Z.m3u8`, { body: 'from the future', etag: stamp() })
    }
    const lists = usePlaylists(readConfig({}), { keepBackups: () => 3 })
    await lists.open((await lists.listFiles())[0])
    lists.addStation({ id: 'x', name: 'After', url: 'https://a/after' })
    await lists.flush()
    const kept = [...disk.entries()].filter(([k]) => k.startsWith('/Radio/Backups/A.'))
    expect(kept).toHaveLength(3)
    // Until fixed: three copies from 2099, and none of what the list had been.
    expect(kept.some(([, f]) => f.body.includes('https://a/before'))).toBe(true)
  })
})

describe('an edit that names nothing changes nothing', () => {
  it('an id from before a reload is refused, and costs no write and no backup', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    await lists.open((await lists.listFiles())[0])
    log.length = 0
    expect(lists.updateStation('no-such-id', { name: 'Ghost' })).toBe(false)
    expect(lists.removeStations(new Set(['no-such-id']))).toBe(false)
    expect(lists.isDirty()).toBe(false)
    await lists.flush()
    expect(log).toEqual([])
  })

  it('an edit made during a slow switch, whose own save had already started, is written once', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    seed('B.m3u8', '#EXTM3U\n')
    const lists = usePlaylists(readConfig({}), { onSaveError: () => undefined })
    const [a, b] = await lists.listFiles()
    await lists.open(a)
    knobs.getDelay['/Radio/B.m3u8'] = 830 // longer than the 800 ms an edit waits to save itself
    knobs.putDelay = 100
    vi.useFakeTimers()
    const switching = lists.open(b)
    await vi.advanceTimersByTimeAsync(5) // B is still being read
    lists.addStation({ id: 'x', name: 'Late', url: 'https://a/late' })
    await vi.advanceTimersByTimeAsync(2000)
    await switching
    expect(log.filter((l) => l === 'PUT /Radio/A.m3u8')).toHaveLength(1)
    expect(backupsOf('A.')).toHaveLength(1)
  })

  it('a COPY that answers without having created anything is not taken for a backup', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const real = dav.copyFiles
    dav.copyFiles = (async () => ({ status: 207 })) as never // resolves, copies nothing
    try {
      const lists = usePlaylists(readConfig({}))
      await lists.open((await lists.listFiles())[0])
      lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
      await lists.flush()
      const copies = backupsOf('A.')
      expect(copies).toHaveLength(1) // made the slow way
      expect(disk.get(copies[0])!.body).toContain('https://a/1')
    } finally { dav.copyFiles = real }
  })
})

describe('the write path, once', () => {
  it('old copies are pruned after the change is made, not before it', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig(), { keepBackups: () => 1 })
    await p.listFiles()
    await p.open(p.files.value[0])
    await saveTimes(p, 2)
    log.length = 0
    await saveTimes(p, 1, 'x')
    const put = log.indexOf('PUT /Radio/A.m3u8')
    const deleted = log.findIndex((l) => l.startsWith('DELETE /Radio/Backups/'))
    expect(put).toBeGreaterThan(-1)
    expect(deleted).toBeGreaterThan(put)
  })

  it('no folder is made in case: a session whose folders exist sends no MKCOL', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    folders.add('/Radio/Backups')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.open(p.files.value[0])
    await saveTimes(p, 2)
    expect(log.filter((l) => l.startsWith('MKCOL'))).toEqual([])
  })

  it('a list deleted elsewhere while it was being edited is written back with the edit', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.open(p.files.value[0])
    disk.delete('/Radio/A.m3u8') // another tab, in Files
    p.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    await expect(p.flush()).resolves.toBeUndefined()
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/2')
    // …and one changed elsewhere is still a conflict, not overwritten.
    disk.set('/Radio/A.m3u8', { body: '#EXTM3U\n#EXTINF:-1,Theirs\nhttps://t/1\n', etag: stamp() })
    p.addStation({ id: 'y', name: 'Three', url: 'https://a/3' })
    await expect(p.flush()).rejects.toMatchObject({ name: 'ConflictError' })
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('Theirs')
  })
})

describe('a rename or delete with a save waiting', () => {
  it('a delete is not undone by the save of an edit made while it ran', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    seed('B.m3u8', '#EXTM3U\n')
    const lists = usePlaylists(readConfig({}), { onSaveError: () => undefined })
    const [a] = await lists.listFiles()
    await lists.open(a)
    vi.useFakeTimers()
    const realCopy = dav.copyFiles
    dav.copyFiles = (async (...args: Parameters<typeof realCopy>) => { await wait(900); return realCopy(...args) }) as typeof realCopy
    try {
      const deleting = lists.deleteList(a)
      await vi.advanceTimersByTimeAsync(10)
      lists.addStation({ id: 'x', name: 'Late', url: 'https://a/late' }) // e.g. a server list refreshed by the player
      await vi.advanceTimersByTimeAsync(3000)
      await deleting
      await vi.advanceTimersByTimeAsync(3000)
    } finally { dav.copyFiles = realCopy }
    expect(disk.has('/Radio/A.m3u8')).toBe(false) // until fixed: written straight back
  })

  it('a rename does not leave the old name behind', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}), { onSaveError: () => undefined })
    const [a] = await lists.listFiles()
    await lists.open(a)
    vi.useFakeTimers()
    const realCopy = dav.copyFiles
    dav.copyFiles = (async (...args: Parameters<typeof realCopy>) => { await wait(900); return realCopy(...args) }) as typeof realCopy
    try {
      const renaming = lists.renameList(a, 'Renamed')
      await vi.advanceTimersByTimeAsync(10)
      lists.addStation({ id: 'x', name: 'Late', url: 'https://a/late' })
      await vi.advanceTimersByTimeAsync(3000)
      await renaming
      await vi.advanceTimersByTimeAsync(3000)
    } finally { dav.copyFiles = realCopy }
    expect(disk.has('/Radio/A.m3u8')).toBe(false)
    expect(disk.get('/Radio/Renamed.m3u8')!.body).toContain('https://a/late') // the edit went to the list it was made in
  })
})

describe('the write path, corner by corner', () => {
  it('after the folder is put back, the write carries no If-Match', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.open(p.files.value[0])
    // The folder goes between the backup and the write: the write is the one
    // that finds it missing and puts it back.
    const realCopy = dav.copyFiles
    dav.copyFiles = (async (...args: Parameters<typeof realCopy>) => {
      const answer = await realCopy(...args)
      for (const k of [...disk.keys()]) if (!k.startsWith('/Radio/Backups/')) disk.delete(k)
      folders.delete('/Radio')
      return answer
    }) as typeof realCopy
    ifMatchSeen.length = 0
    log.length = 0
    try {
      p.addStation({ id: 'x', name: 'X', url: 'https://a/x' })
      await p.flush()
    } finally { dav.copyFiles = realCopy }
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/x')
    expect(ifMatchSeen).toEqual([]) // an If-Match here describes a file that went with its folder
    expect(log.filter((l) => l === 'GET /Radio/A.m3u8')).toEqual([]) // and it went straight in, not via "gone"
  })

  it('a list recreated elsewhere in the moment it was found gone is a conflict, not overwritten', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.open(p.files.value[0])
    disk.delete('/Radio/A.m3u8')
    const realGet = dav.getFileContents
    dav.getFileContents = (async (...args: Parameters<typeof realGet>) => {
      try { return await realGet(...args) } finally {
        // just after "gone" is established, another tab writes the file again
        if (!disk.has('/Radio/A.m3u8')) disk.set('/Radio/A.m3u8', { body: '#EXTM3U\n#EXTINF:-1,Theirs\nhttps://t/1\n', etag: stamp() })
      }
    }) as typeof realGet
    try {
      p.addStation({ id: 'x', name: 'Mine', url: 'https://a/mine' })
      await expect(p.flush()).rejects.toMatchObject({ name: 'ConflictError' })
    } finally { dav.getFileContents = realGet }
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('Theirs')
  })

  it('a list that cannot be checked after a refusal is a failure to save, not a conflict that reloads the edit away', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const p = usePlaylists(readConfig())
    await p.listFiles()
    await p.open(p.files.value[0])
    disk.set('/Radio/A.m3u8', { body: '#EXTM3U\n', etag: stamp() })
    const realGet = dav.getFileContents
    dav.getFileContents = (async () => { throw new DavError(503) }) as typeof realGet
    try {
      p.addStation({ id: 'x', name: 'Mine', url: 'https://a/mine' })
      await expect(p.flush()).rejects.toThrow(/could not be saved/)
      expect(p.isDirty()).toBe(true)
    } finally { dav.getFileContents = realGet }
  })
})

describe('found by the review of the 1.2.0 work', () => {
  it('a write whose answer names no version is read back, so the next save is not taken for a conflict', async () => {
    seed('A.m3u8', '#EXTM3U\n#EXTINF:-1,One\nhttps://a/1\n')
    const lists = usePlaylists(readConfig({}))
    const [a] = await lists.listFiles()
    await lists.open(a)
    knobs.etagLost = /\/Radio\/A\.m3u8$/
    lists.addStation({ id: 'x', name: 'Two', url: 'https://a/2' })
    await lists.save()
    expect(lists.currentFile.value?.etag).toBeTruthy()
    knobs.etagLost = /(?!)/
    lists.addStation({ id: 'y', name: 'Three', url: 'https://a/3' })
    await lists.save() // a ConflictError before
    expect(disk.get('/Radio/A.m3u8')!.body).toContain('https://a/3')
  })

  it('adding to a list whose save landed but whose answer was lost is not reported as a failure', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    seed('B.m3u8', '#EXTM3U\n#EXTINF:-1,Two\nhttps://b/2\n')
    const lists = usePlaylists(readConfig({}))
    const [, b] = await lists.listFiles()
    knobs.propfindLost = /\/Radio\/B\.m3u8$/
    expect(await lists.appendTo(b, [{ id: 'n', name: 'New', url: 'https://b/new' }])).toMatchObject({ added: 1 })
    expect(disk.get('/Radio/B.m3u8')!.body).toContain('https://b/new')
  })

  it('adding to a list that changed elsewhere meanwhile merges into what it holds now', async () => {
    seed('A.m3u8', '#EXTM3U\n')
    seed('B.m3u8', '#EXTM3U\n#EXTINF:-1,Two\nhttps://b/2\n')
    const lists = usePlaylists(readConfig({}))
    const [, b] = await lists.listFiles()
    knobs.getDelay['/Radio/B.m3u8'] = 30
    const adding = lists.appendTo(b, [{ id: 'n', name: 'New', url: 'https://b/new' }])
    await wait(10) // read, not yet written: another device saves B
    disk.set('/Radio/B.m3u8', { body: '#EXTM3U\n#EXTINF:-1,Two\nhttps://b/2\n#EXTINF:-1,Other\nhttps://b/other\n', etag: stamp() })
    expect(await adding).toMatchObject({ added: 1 })
    const body = disk.get('/Radio/B.m3u8')!.body
    expect(body).toContain('https://b/other') // theirs kept
    expect(body).toContain('https://b/new')   // and ours added
  })
})
