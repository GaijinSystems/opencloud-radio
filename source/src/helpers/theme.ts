/**
 * Radio's theme preference, applied the way the shell applies its own.
 *
 * The shell does not use a `data-theme` attribute — which is what this app set
 * until 1.1.6, to no effect. It writes each design token of the current theme
 * as an inline `--oc-role-<name>` custom property on `:root`, camelCase turned
 * to kebab-case, with `chrome` falling back to `surfaceContainer` when a theme
 * does not name one. Doing exactly that on Radio's own root element gives the
 * app a theme of its own: custom properties inherit, so every design-system
 * component inside picks it up, and nothing outside is touched — which means
 * there is nothing to restore on leaving, either.
 */
export interface ThemeLike {
  isDark: boolean
  label?: string
  designTokens?: { roles?: Record<string, string> }
}

export const kebab = (s: string): string => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)

/** The custom properties the shell would set for `theme`, name to value. */
export const themeVars = (theme: ThemeLike): Record<string, string> => {
  const roles = theme.designTokens?.roles ?? {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(roles)) {
    if (typeof value === 'string') out[`--oc-role-${kebab(key)}`] = value
  }
  if (!roles.chrome) {
    if (roles.surfaceContainer) out['--oc-role-chrome'] = roles.surfaceContainer
    if (roles.onSurface) out['--oc-role-on-chrome'] = roles.onSurface
  }
  // The shell needs no equivalent of this: it writes to `:root`, where the
  // design system's own defaults sit, so a role a theme omits lands on a
  // neutral value. These properties go on Radio's root instead, one level
  // down, where an omitted role inherits whatever `:root` holds — which is
  // the OTHER theme's value. `background` and `onBackground` are the two that
  // decide the page itself, so they are filled from their surface equivalents
  // rather than left to fall through.
  if (!roles.background && roles.surface) out['--oc-role-background'] = roles.surface
  if (!roles.onBackground && roles.onSurface) out['--oc-role-on-background'] = roles.onSurface
  return out
}

/** The instance\'s theme for a mode, or nothing when it offers none of that kind. */
export const pickTheme = <T extends ThemeLike>(themes: readonly T[], mode: 'light' | 'dark'): T | undefined =>
  themes.find((t) => t.isDark === (mode === 'dark'))

/** Whether there is a choice to offer at all. */
export const canChooseTheme = (themes: readonly ThemeLike[]): boolean =>
  themes.some((t) => t.isDark) && themes.some((t) => !t.isDark)

/**
 * Put a theme on one element, taking off whatever the last call left. The
 * names now set are returned, for the caller to hand back next time — the
 * element is shared with the rest of the app and this must never clear a
 * property it did not write.
 *
 * `null` means "follow the shell": everything is removed and the properties
 * resolve to `:root` again.
 */
export const applyThemeTo = (
  el: HTMLElement,
  theme: ThemeLike | null,
  previous: readonly string[] = []
): string[] => {
  for (const name of previous) el.style.removeProperty(name)
  if (!theme) return []
  const vars = themeVars(theme)
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value)
  return Object.keys(vars)
}
