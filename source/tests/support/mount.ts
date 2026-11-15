import { afterEach } from 'vitest'
import { createApp, defineComponent, h, type Component } from 'vue'

/**
 * Mount a component into the document for one test, with the one global the
 * design system registers at runtime and nothing here does: `oc-button`, as a
 * plain button carrying its attributes. Everything mounted is unmounted after
 * each test.
 */
const mounted: Array<{ app: ReturnType<typeof createApp>; host: HTMLElement }> = []
export const mount = (component: Component, props: Record<string, unknown> = {}) => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp({ setup: () => () => h(component, props) })
  app.component('oc-button', defineComponent({
    setup: (_p, { slots, attrs }) => () => h('button', { ...attrs }, slots.default?.())
  }))
  app.mount(host)
  mounted.push({ app, host })
  return host
}
afterEach(() => {
  for (const { app, host } of mounted.splice(0)) { app.unmount(); host.remove() }
})

/** The first button whose text contains `text`. */
export const buttonNamed = (host: ParentNode, text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement
