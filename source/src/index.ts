import { computed } from 'vue'
import {
  defineWebApplication,
  type AppMenuItemExtension,
  type Extension
} from '@opencloud-eu/web-pkg'
import { urlJoin } from '@opencloud-eu/web-client'
import type { RouteRecordRaw } from 'vue-router'
import App from './App.vue'
import { readConfig } from './config'

const APPID = 'radio'

/**
 * A standalone app, not a file viewer: no `extensions` on `appInfo`, no
 * `AppWrapper`.
 *
 * The application-menu entry is an `appMenuItem` **extension**, which is how
 * every built-in standalone app does it — `ApplicationInformation` has no
 * `applicationMenu` field, and `navItems` does not produce a menu entry here.
 * Its `path` is the app id: the host mounts an app's routes under `/<id>`, so
 * the route below is `/` within that namespace.
 */
export default defineWebApplication({
  setup({ applicationConfig }) {
    const config = readConfig(applicationConfig)

    const appInfo = {
      name: 'Radio',
      id: APPID,
      icon: 'radio',
      color: '#00677f'
    }

    const routes: RouteRecordRaw[] = [
      {
        path: '/',
        name: 'root',
        component: App,
        props: () => ({ applicationConfig }),
        meta: { authContext: 'user', title: appInfo.name }
      }
    ]

    const menuItem: AppMenuItemExtension = {
      id: `app.${APPID}.menuItem`,
      type: 'appMenuItem',
      label: () => appInfo.name,
      color: appInfo.color,
      icon: appInfo.icon,
      priority: 30,
      path: urlJoin(APPID)
    }
    const extensions = computed<Extension[]>(() => [menuItem])

    return {
      appInfo,
      routes,
      extensions,
      ready() {
        console.debug('[radio] ready', { rootFolder: config.rootFolder })
      }
    }
  }
})
