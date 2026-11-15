# Regenerating the mockups

    python3 build.py

Writes `index.html` and the eleven mockup files into the parent directory. The colour
tokens in `common.py` are the real OpenCloud light and dark role values, taken from
`packages/design-system/src/styles/defaults.css` in `opencloud-eu/web` and
`services/web/assets/themes/opencloud/theme.json` in `opencloud-eu/opencloud`.
Re-copy them if the upstream theme changes.

Nothing here ships in the built app. It exists so the mockups can be changed in one
place instead of in eleven HTML files.
