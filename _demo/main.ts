/**
 * The demo: the real app, mounted as OpenCloud mounts it, with the demo's
 * stand-ins for the file client and the design system's button.
 */
import { createApp, defineComponent, h } from 'vue'
import App from '../src/App.vue'
import { resetDemo } from './dav'
import './shell.css'

/** The design system's `oc-button`, as far as the app uses it. */
const OcButton = defineComponent({
  name: 'OcButton',
  inheritAttrs: false,
  props: {
    appearance: { type: String, default: 'outline' },
    colorRole: { type: String, default: '' },
    disabled: { type: Boolean, default: false }
  },
  setup (props, { slots, attrs }) {
    return () => h('button', {
      type: 'button',
      ...attrs,
      disabled: props.disabled,
      class: ['oc-button', `oc-button-${props.appearance}`, props.colorRole && `oc-button-${props.colorRole}`, attrs.class]
    }, slots.default?.())
  }
})

// What an administrator would put in config.json: the online directory on, as
// a showcase (track titles are on by default). Play reports to the directory
// stay off.
const applicationConfig = { directoryEnabled: true, directoryReportClicks: false }

const app = createApp(App, { applicationConfig })
app.component('oc-button', OcButton)
app.mount('#app')

document.getElementById('reset')?.addEventListener('click', () => {
  if (!confirm('Put the demo back as it was when first opened? Your lists and settings here will be cleared.')) return
  resetDemo()
  location.reload()
})
