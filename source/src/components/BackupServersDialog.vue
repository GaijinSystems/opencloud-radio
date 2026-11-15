<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import RadioDialog from './RadioDialog.vue'
import type { Station } from '../parsers/types'
import type { Found } from '../helpers/backupServers'
import { Refused, hostOf, refusedClause, refusedClauseMany, refusedClauseOneHost, type RefusedKind } from '../helpers/fetch'

/**
 * "Find backup servers" for a whole list: each station's playlist looked for,
 * and what was found shown — station by station, ticked by default — before
 * anything is changed. Nothing is written until Apply, and then through the
 * list's ordinary save, which copies the list to Backups first.
 */
const props = defineProps<{
  stations: Station[]
  findServers: (s: Station) => Promise<Found | null>
}>()
const emit = defineEmits<{
  (e: 'apply', changes: Array<{ id: string; found: Found }>): void
  (e: 'close'): void
}>()

/** How many stations are looked up at once: enough to be quick, few enough to be polite. */
const AT_ONCE = 3
const done = ref(0)
/** Stations whose lookup could not be made from this page, by what could not be read: see `Refused`. */
const KINDS = ['playlist', 'found', 'channels', 'directory'] as const
type Tally = {
  n: number; last?: Refused; lastName: string; linked: number; http: number; httpLinked: number; answered: number; hosts: Set<string | undefined>
}
/**
 * Per kind: how many; the last refusal and its station (said as it is, when
 * it is the only one); how many led through another playlist; how many were
 * http, and of those how many a playlist led to; how many hosts answered
 * without the playlist (see `Refused`); and the hosts, to name where it is one.
 */
const refused = reactive(Object.fromEntries(KINDS.map((k) => [k, {
  n: 0, lastName: '', linked: 0, http: 0, httpLinked: 0, answered: 0, hosts: new Set()
}])) as Record<RefusedKind, Tally>)
const refusedTotal = computed(() => KINDS.reduce((sum, k) => sum + refused[k].n, 0))
const count = (r: Refused, s: Station) => {
  const c = refused[r.kind]
  c.n++
  c.last = r
  c.lastName = s.name
  c.hosts.add(r.host)
  if (r.linked) c.linked++
  if (r.http) c.http++
  if (r.http && r.linked) c.httpLinked++
  if (r.answered) c.answered++
}
/** Several stations, by kind. */
const MANY: Record<RefusedKind, string> = {
  playlist: 'the playlists',
  found: 'the playlists found for them',
  channels: "SomaFM's channel list (on api.somafm.com)",
  directory: 'the online directory'
}
/** The one host of a kind's refusals, said for several stations: "(both on h)", "(all on h)". */
const onOne = (k: RefusedKind): string => {
  const { n, hosts } = refused[k]
  const [only] = hosts
  return hosts.size === 1 && only ? ` (${n === 2 ? 'both' : 'all'} on ${only})` : ''
}
/** Several playlists: the hosts are several — or one, then named — and so are the reasons. */
const playlistsNote = (k: 'playlist' | 'found') => {
  const { n, linked, http, httpLinked, answered } = refused[k]
  const on = onOne(k)
  // Where every one was a playlist they lead to, those are the subject; where
  // some were, both are.
  const what = linked === n
    ? `${k === 'found' ? 'the playlists that those found for them lead to' : 'the playlists they lead to'}${on}`
    : linked ? `${MANY[k]}, or the playlists they lead to${on},` : `${MANY[k]}${on}`
  const clause = answered === n
    ? `could not be read over https from this page: ${on ? 'that host' : 'their hosts'} answered, but not with them.`
    : (on ? refusedClauseOneHost : refusedClauseMany) +
      (answered ? ` For ${answered === 1 ? 'one' : answered} of them, the host answered over https, but not with the playlist.` : '')
  // Of those http: their own address, or one a playlist they lead to has.
  const one = http === 1 && http !== n
  const who = http === n ? (n === 2 ? 'Both of those playlists' : 'All of those playlists')
    : http === 1 ? 'One of those playlists' : `${http} of those playlists`
  const has = one ? 'has' : 'have'
  const lead = one ? 'leads' : 'lead'
  // Where every one was a playlist they lead to, the http address is that one's own.
  const which = httpLinked === 0 || linked === n ? `${has} an http address`
    : httpLinked === http ? `${lead} to a playlist with an http address`
      : `${has} an http address, or ${lead} to a playlist that has one`
  return `For ${n} stations, ${what} ${clause}` +
    (http ? ` ${who} ${which}, and this https page may not read http: a host that serves one only over http cannot be read here.` : '')
}
/** One note per kind met: "For 2 stations, the playlists could not…"; for one station, named, its own message. */
const refusedNotes = computed(() => KINDS.filter((k) => refused[k].n).map((k) => {
  const { n, last, lastName } = refused[k]
  if (n === 1 && last) return `For ${lastName}, ${last.message.replace(/^(The|A) /, (m) => m.toLowerCase()).replace(/^a playlist found for this station/, 'a playlist found for it')}`
  if (k === 'playlist' || k === 'found') return playlistsNote(k)
  const [dir] = refused.directory.hosts
  return `For ${n} stations, ${MANY[k]}${k === 'directory' && refused.directory.hosts.size === 1 && dir ? ` (${dir})` : ''} ${refusedClause}`
}))
const found = ref<Array<{ station: Station; found: Found; take: boolean }>>([])
let cancelled = false

onMounted(async () => {
  const queue = [...props.stations]
  const worker = async () => {
    for (let s = queue.shift(); s && !cancelled; s = queue.shift()) {
      const f = await props.findServers(s).catch((e: unknown) => {
        if (e instanceof Refused) count(e, s)
        return null
      })
      if (cancelled) return
      if (f && (f.added || f.converted)) found.value = [...found.value, { station: s, found: f, take: true }]
      if (f?.unread) count(f.unread, s) // converted, but the lookup for more was refused: counted too
      done.value++
    }
  }
  await Promise.all(Array.from({ length: AT_ONCE }, worker))
})
onBeforeUnmount(() => { cancelled = true })

const finished = computed(() => done.value >= props.stations.length)
const chosen = computed(() => found.value.filter((f) => f.take))
const apply = () => emit('apply', chosen.value.map((f) => ({ id: f.station.id, found: f.found })))
</script>

<template>
  <RadioDialog title="Find backup servers" @close="emit('close')">
    <div :style="{ paddingTop: '12px', display: 'grid', gap: '12px', fontSize: '13.5px' }">
      <p :style="{ margin: 0, color: 'var(--oc-role-on-surface-variant)' }">
        Each station's own playlist is looked for — from its playlist address, its host (SomaFM,
        StreamTheWorld) or the online directory — and any servers it lists that the station does
        not have yet are offered here. A station entered with your relay's address is given back its
        own, which it still plays from the relay. Nothing changes until you apply.
      </p>
      <p role="status" :style="{ margin: 0 }">
        <template v-if="!finished">Looked at {{ done }} of {{ stations.length }}…</template>
        <template v-else-if="found.length">Found changes for {{ found.length }} of {{ stations.length }}
          station{{ stations.length === 1 ? '' : 's' }}.</template>
        <template v-else-if="refusedTotal && refusedTotal >= stations.length">No station in this list could be fully looked up.</template>
        <template v-else-if="refusedTotal">No station that could be looked up has servers to add.</template>
        <template v-else>No station in this list has servers to add.</template>
      </p>
      <p v-for="note in refusedNotes" :key="note" role="note" :style="{ margin: 0, color: 'var(--oc-role-on-surface-variant)' }">
        {{ note }}
      </p>
      <label
        v-for="f in found" :key="f.station.id"
        :style="{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '6px 0',
                  borderTop: '1px solid var(--oc-role-outline-variant)' }"
      >
        <input v-model="f.take" type="checkbox" :style="{ marginTop: '3px' }">
        <span>
          <b>{{ f.station.name }}</b> —
          <template v-if="f.found.added">{{ f.found.added }} more server{{ f.found.added === 1 ? '' : 's' }},
            {{ f.found.alternates.length + 1 }} in all</template>
          <template v-else>its own address{{ f.found.converted === 1 ? '' : 'es' }} instead of your relay's</template>
          <span :style="{ display: 'block', fontSize: '12px', color: 'var(--oc-role-on-surface-variant)' }">
            <template v-if="f.found.playlist">from {{ hostOf(f.found.playlist) ?? f.found.playlist }}</template>
            <template v-if="f.found.added && f.found.converted">; </template>
            <template v-if="f.found.converted">still played from your relay</template>
            <template v-else-if="f.found.url !== f.station.url">; plays from {{ hostOf(f.found.url) ?? f.found.url }} first</template>
          </span>
        </span>
      </label>
    </div>
    <template #footer>
      <oc-button appearance="filled" color-role="primary" :disabled="!chosen.length" @click="apply">
        Apply to {{ chosen.length }} station{{ chosen.length === 1 ? '' : 's' }}
      </oc-button>
      <oc-button appearance="outline" @click="emit('close')">{{ finished ? 'Close' : 'Cancel' }}</oc-button>
    </template>
  </RadioDialog>
</template>
