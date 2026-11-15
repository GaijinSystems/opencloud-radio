import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/**
 * Closes a menu on a click anywhere outside it and, unless told otherwise, on
 * Escape. A menu that only closes from its own button is a menu that gets left
 * open over the table.
 *
 * This listens for `click`, so the opener must stop the click that opens the
 * menu (`@click.stop`), or that same click closes it again. The add-to-list
 * popup cannot do that and keeps its own deferred `pointerdown` listener.
 */
export const useDismiss = (root: Ref<HTMLElement | null>, open: Ref<boolean>, { escape = true } = {}) => {
  const onClick = (e: MouseEvent) => {
    if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
  }
  const onKey = (e: KeyboardEvent) => { if (escape && e.key === 'Escape') open.value = false }
  onMounted(() => {
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('click', onClick)
    document.removeEventListener('keydown', onKey)
  })
}
