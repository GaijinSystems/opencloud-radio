# OpenCloud Radio — demo site

The site at [radio.gaijin.systems](https://radio.gaijin.systems): the real app,
built from `main`, on stand-in services that keep a visitor's station lists in
their own browser.

This branch holds only the site. Its source is in `_demo/` (not published);
everything else at the root is the built site. Each release on `main` rebuilds
it from the tagged code and publishes it here. To rebuild it by hand, from the
root of this branch, with a checkout of `main` beside it:

```
_demo/build.sh ../path/to/main
```

or, to build into a folder of its own and leave the branch alone,
`_demo/build.sh ../path/to/main ../site`. It needs only podman. The app's own
source and documentation are on `main`.
