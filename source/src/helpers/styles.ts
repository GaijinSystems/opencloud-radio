/**
 * The few style objects more than one component draws with. Layout stays in
 * inline styles (the host ships no utility classes for an extension's markup);
 * what is shared lives here so a change of look is made once.
 */

/** A small panel floating over the page: menus and the add-to-list popup. */
export const popupPanel = {
  borderRadius: '10px',
  background: 'var(--oc-role-surface-container-low)',
  border: '1px solid var(--oc-role-outline-variant)',
  boxShadow: '0 2px 10px rgba(0,0,0,.25)'
}

/** The rule between sections of such a panel. */
export const panelDivider = { border: 0, borderTop: '1px solid var(--oc-role-outline-variant)', margin: '6px 4px' }

/** A full-width text field in a dialog. */
export const dialogInput = {
  padding: '8px 10px', borderRadius: '6px', width: '100%',
  background: 'var(--oc-role-surface-container-low)',
  border: '1px solid var(--oc-role-outline-variant)'
}

/** A one-paragraph notice: `ok` is information, `bad` is something that went wrong. */
export const banner = (tone: 'ok' | 'bad') => ({
  padding: '9px 12px', borderRadius: '8px', fontSize: '12.5px',
  ...(tone === 'ok'
    ? { background: 'var(--oc-role-secondary-container)', color: 'var(--oc-role-on-secondary-container)' }
    : { background: 'var(--oc-role-error-container)', color: 'var(--oc-role-on-error-container)' })
})
