/**
 * The parts of OpenCloud's web package the app uses, served by the demo:
 * its file client, the user's personal space, and the theme store (one theme
 * here, so the app offers no choice of theme).
 */
import { webdav } from './dav'

export const useClientService = () => ({ webdav })
export const useSpacesStore = () => ({ personalSpace: { id: 'demo-personal' } })
export const useThemeStore = () => ({ availableThemes: [] })
