# -*- coding: utf-8 -*-
"""Shared pieces for the OpenCloud Radio layout mockups."""

LIGHT = """
  --oc-font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --oc-role-background: #ffffff;
  --oc-role-on-background: #191c1d;
  --oc-role-chrome: #20434f;
  --oc-role-on-chrome: #ffffff;
  --oc-role-primary: #00677f;
  --oc-role-on-primary: #ffffff;
  --oc-role-primary-container: #b7eaff;
  --oc-role-on-primary-container: #001f28;
  --oc-role-secondary: #20434f;
  --oc-role-on-secondary: #ffffff;
  --oc-role-secondary-container: #cfe6f1;
  --oc-role-on-secondary-container: #071e26;
  --oc-role-tertiary: #5a5c7e;
  --oc-role-tertiary-container: #e0e0ff;
  --oc-role-on-tertiary-container: #171937;
  --oc-role-error: #ba1a1a;
  --oc-role-on-error: #ffffff;
  --oc-role-error-container: #ffdad6;
  --oc-role-on-error-container: #410002;
  --oc-role-surface: #ffffff;
  --oc-role-on-surface: #191c1d;
  --oc-role-surface-variant: #dbe4e8;
  --oc-role-on-surface-variant: #40484c;
  --oc-role-outline: #70787c;
  --oc-role-outline-variant: #bfc8cc;
  --oc-role-surface-dim: #d8dadc;
  --oc-role-surface-bright: #f8f9fb;
  --oc-role-surface-container-lowest: #ffffff;
  --oc-role-surface-container-low: #fbfcfe;
  --oc-role-surface-container: #f6f8fa;
  --oc-role-surface-container-high: #f2f4f5;
  --oc-role-surface-container-highest: #eceef0;
  --oc-role-inverse-surface: #2e3132;
  --oc-role-inverse-on-surface: #eff1f2;
  --oc-role-inverse-primary: #5cd5fb;
  --shadow: 0 1px 2px rgba(0,0,0,.08), 0 2px 8px rgba(0,0,0,.04);
"""

DARK = """
  --oc-role-background: #191c1d;
  --oc-role-on-background: #e1e3e4;
  --oc-role-chrome: #20434f;
  --oc-role-on-chrome: #ffffff;
  --oc-role-primary: #5cd5fb;
  --oc-role-on-primary: #003543;
  --oc-role-primary-container: #004e60;
  --oc-role-on-primary-container: #b7eaff;
  --oc-role-secondary: #b3cad4;
  --oc-role-on-secondary: #1e333b;
  --oc-role-secondary-container: #344a52;
  --oc-role-on-secondary-container: #cfe6f1;
  --oc-role-tertiary: #c3c3eb;
  --oc-role-tertiary-container: #424465;
  --oc-role-on-tertiary-container: #e0e0ff;
  --oc-role-error: #ffb4ab;
  --oc-role-on-error: #690005;
  --oc-role-error-container: #93000a;
  --oc-role-on-error-container: #ffb4ab;
  --oc-role-surface: #191c1d;
  --oc-role-on-surface: #e1e3e4;
  --oc-role-surface-variant: #40484c;
  --oc-role-on-surface-variant: #bfc8cc;
  --oc-role-outline: #8a9296;
  --oc-role-outline-variant: #40484c;
  --oc-role-surface-dim: #111415;
  --oc-role-surface-bright: #373a3b;
  --oc-role-surface-container-lowest: #0c0f10;
  --oc-role-surface-container-low: #191c1d;
  --oc-role-surface-container: #1d2021;
  --oc-role-surface-container-high: #272a2c;
  --oc-role-surface-container-highest: #323537;
  --oc-role-inverse-surface: #e1e3e4;
  --oc-role-inverse-on-surface: #2e3132;
  --oc-role-inverse-primary: #00677f;
  --shadow: 0 1px 2px rgba(0,0,0,.4), 0 2px 10px rgba(0,0,0,.25);
"""

BASE_CSS = """
*,*::before,*::after{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;font-family:var(--oc-font-family);font-size:14px;line-height:1.45;
  background:var(--oc-role-background);color:var(--oc-role-on-background);
  -webkit-font-smoothing:antialiased;
}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
input,select{font:inherit;color:inherit}
svg{display:block;flex:none}
:focus-visible{outline:2px solid var(--oc-role-primary);outline-offset:2px;border-radius:4px}
.sh{display:flex;flex-direction:column;height:100vh;min-height:0}
.sh-top{
  height:48px;flex:none;display:flex;align-items:center;gap:12px;padding:0 12px;
  background:var(--oc-role-chrome);color:var(--oc-role-on-chrome);
}
.sh-top .brand{display:flex;align-items:center;gap:9px;font-weight:600;letter-spacing:.1px}
.sh-top .spacer{flex:1}
.sh-top .av{
  width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,.22);
  display:grid;place-items:center;font-size:11px;font-weight:600
}
.sh-body{flex:1;display:flex;min-height:0}
.sh-rail{
  width:60px;flex:none;background:var(--oc-role-surface-container-low);
  border-right:1px solid var(--oc-role-outline-variant);
  display:flex;flex-direction:column;align-items:center;gap:4px;padding-top:10px;
}
.sh-rail a{
  width:44px;height:44px;border-radius:8px;display:grid;place-items:center;
  color:var(--oc-role-on-surface-variant);text-decoration:none
}
.sh-rail a.on{background:var(--oc-role-secondary-container);color:var(--oc-role-on-secondary-container)}
.app{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--oc-role-background)}
.tt{
  position:fixed;right:12px;bottom:12px;z-index:50;display:flex;gap:2px;padding:3px;
  border-radius:999px;background:var(--oc-role-surface-container-high);
  border:1px solid var(--oc-role-outline-variant);box-shadow:var(--shadow);font-size:11px
}
.tt button{padding:4px 10px;border-radius:999px;color:var(--oc-role-on-surface-variant)}
.tt button[aria-pressed=true]{background:var(--oc-role-secondary-container);color:var(--oc-role-on-secondary-container)}
.btn{
  display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;
  border:1px solid var(--oc-role-outline-variant);color:var(--oc-role-on-surface);
  background:var(--oc-role-surface-container-low)
}
.btn:hover{background:var(--oc-role-surface-container-high)}
.btn.pri{background:var(--oc-role-primary);color:var(--oc-role-on-primary);border-color:transparent}
.btn.pri:hover{filter:brightness(1.06)}
.btn.q{border-color:transparent;background:none}
.btn.q:hover{background:var(--oc-role-surface-container-high)}
.play{
  width:36px;height:36px;border-radius:50%;display:grid;place-items:center;flex:none;
  background:var(--oc-role-primary);color:var(--oc-role-on-primary)
}
.play.big{width:56px;height:56px}
.play.ghost{background:var(--oc-role-surface-container-high);color:var(--oc-role-on-surface)}
.mono{font-variant-numeric:tabular-nums}
.dim{color:var(--oc-role-on-surface-variant)}
.badge{
  display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;
  font-size:11.5px;white-space:nowrap;border:1px solid transparent
}
.badge.live{background:var(--oc-role-primary-container);color:var(--oc-role-on-primary-container)}
.badge.ok{border-color:var(--oc-role-outline-variant);color:var(--oc-role-on-surface-variant)}
.badge.new{color:var(--oc-role-on-surface-variant);opacity:.75}
.badge.bad{background:var(--oc-role-error-container);color:var(--oc-role-on-error-container)}
.dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.logo{
  width:34px;height:34px;border-radius:6px;flex:none;display:grid;place-items:center;
  font-weight:600;font-size:13px;letter-spacing:-.2px;
  background:var(--oc-role-surface-container-highest);color:var(--oc-role-on-surface-variant)
}
.logo.lg{width:56px;height:56px;border-radius:10px;font-size:19px}
.logo.xl{width:104px;height:104px;border-radius:14px;font-size:34px}
.sep{height:1px;background:var(--oc-role-outline-variant);border:0;margin:0}
.scroll{overflow:auto;min-height:0}
.scroll::-webkit-scrollbar{width:10px;height:10px}
.scroll::-webkit-scrollbar-thumb{background:var(--oc-role-outline-variant);border-radius:6px;border:3px solid transparent;background-clip:content-box}
.vol{display:flex;align-items:center;gap:8px;color:var(--oc-role-on-surface-variant)}
.vol input{width:88px;accent-color:var(--oc-role-primary)}
.note{
  display:flex;gap:8px;padding:9px 12px;border-radius:8px;font-size:12.5px;
  background:var(--oc-role-error-container);color:var(--oc-role-on-error-container)
}
.eq{display:flex;align-items:flex-end;gap:2px;height:14px}
.eq i{width:3px;border-radius:1px;background:currentColor;transform-origin:bottom;animation:eq .9s ease-in-out infinite alternate}
.eq i:nth-child(1){height:40%;animation-delay:-.1s}
.eq i:nth-child(2){height:95%;animation-delay:-.45s}
.eq i:nth-child(3){height:60%;animation-delay:-.3s}
.eq i:nth-child(4){height:80%;animation-delay:-.6s}
@keyframes eq{from{transform:scaleY(.35)}to{transform:scaleY(1)}}
@media (prefers-reduced-motion:reduce){.eq i{animation:none}}
"""

TOGGLE_JS = """
(function(){
  var root=document.documentElement;
  var q=new URLSearchParams(location.search).get('theme');
  if(q==='dark'||q==='light')root.setAttribute('data-theme',q);
  document.querySelectorAll('.tt button').forEach(function(b){
    b.addEventListener('click',function(){
      var m=b.dataset.mode;
      if(m==='system')root.removeAttribute('data-theme');else root.setAttribute('data-theme',m);
      document.querySelectorAll('.tt button').forEach(function(o){
        o.setAttribute('aria-pressed',String(o.dataset.mode===m));
      });
    });
  });
})();
"""

ICONS = {
    "play": '<path d="M8 5.2v13.6L19 12z"/>',
    "stop": '<path d="M6.5 6.5h11v11h-11z"/>',
    "pause": '<path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/>',
    "plus": '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>',
    "search": '<path d="M10.5 3a7.5 7.5 0 015.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z"/>',
    "radio": '<path d="M12 9.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zm5.7-4.9l1.4 1.4a8 8 0 010 12l-1.4-1.4a6 6 0 000-9.2zm-11.4 0l1.4 1.4a6 6 0 000 9.2l-1.4 1.4a8 8 0 010-12zM20.5 2l1.4 1.4a12 12 0 010 17.2L20.5 19a10 10 0 000-15zM3.5 2L4.9 3.4a10 10 0 000 15L3.5 20A12 12 0 013.5 2z"/>',
    "folder": '<path d="M3 4h6l2 2h10v14H3z"/>',
    "list": '<path d="M4 5h16v2H4zm0 6h16v2H4zm0 6h10v2H4z"/>',
    "share": '<path d="M12 3l5 5h-3v7h-4V8H7z"/><path d="M4 18h16v3H4z"/>',
    "trash": '<path d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z"/>',
    "clock": '<path d="M12 2a10 10 0 110 20 10 10 0 010-20zm1 5h-2v6l5 3 1-1.7-4-2.4z"/>',
    "star": '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    "more": '<path d="M12 4a2 2 0 110 4 2 2 0 010-4zm0 6a2 2 0 110 4 2 2 0 010-4zm0 6a2 2 0 110 4 2 2 0 010-4z"/>',
    "vol": '<path d="M4 9h3.5L12 5v14l-4.5-4H4z"/><path d="M15 9.2a4 4 0 010 5.6l1.4 1.4a6 6 0 000-8.4z"/>',
    "up": '<path d="M12 6l6 7h-4v5h-4v-5H6z"/>',
    "down": '<path d="M12 18l-6-7h4V6h4v5h4z"/>',
    "edit": '<path d="M4 16.5L15.6 4.9l3.5 3.5L7.5 20H4z"/>',
    "import": '<path d="M12 3v9l3.5-3.5 1.4 1.4L11 16 5.1 9.9l1.4-1.4L10 12V3z"/><path d="M4 18h16v3H4z"/>',
    "grid": '<path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z"/>',
    "chev": '<path d="M9 5.5L15.5 12 9 18.5 7.6 17l5-5-5-5z"/>',
    "check": '<path d="M9.5 16.2L5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/>',
    "refresh": '<path d="M12 4a8 8 0 017.5 5.3l-1.9.7A6 6 0 006 9V7H4v6h6v-2H7.3A6 6 0 0112 6z"/><path d="M12 20a8 8 0 01-7.5-5.3l1.9-.7A6 6 0 0018 15v2h2v-6h-6v2h2.7A6 6 0 0112 18z"/>',
    "cmd": '<path d="M6 3a3 3 0 013 3v2h6V6a3 3 0 113 3h-2v6h2a3 3 0 11-3 3v-2H9v2a3 3 0 11-3-3h2V9H6a3 3 0 010-6zm3 6v6h6V9z"/>',
    "link": '<path d="M10 13a5 5 0 007.1 0l2.8-2.8A5 5 0 0012.8 3L11 4.9l1.4 1.4 1.8-1.8a3 3 0 014.3 4.3l-2.9 2.8a3 3 0 01-4.2 0zm4-2a5 5 0 00-7.1 0l-2.8 2.8A5 5 0 0011.2 21l1.8-1.9-1.4-1.4-1.8 1.8a3 3 0 01-4.3-4.3l2.9-2.8a3 3 0 014.2 0z"/>',
}


def icon(name, size=18, cls=""):
    c = ' class="%s"' % cls if cls else ""
    return ('<svg%s width="%d" height="%d" viewBox="0 0 24 24" fill="currentColor" '
            'aria-hidden="true">%s</svg>') % (c, size, size, ICONS[name])


EQ = '<span class="eq">' + "<i></i>" * 4 + "</span>"

# name, network, detail, group, state, initials
STATIONS = [
    ("Groove Salad", "SomaFM", "128 kbps AAC", "Ambient", "live", "GS"),
    ("Drone Zone", "SomaFM", "128 kbps AAC", "Ambient", "ok", "DZ"),
    ("Deep Space One", "SomaFM", "128 kbps MP3", "Ambient", "ok", "DS"),
    ("Radio Paradise Mellow", "Radio Paradise", "320 kbps FLAC", "Eclectic", "ok", "RP"),
    ("FIP", "Radio France", "192 kbps MP3", "Eclectic", "new", "FI"),
    ("KEXP 90.3", "Seattle", "128 kbps MP3", "Public", "new", "KX"),
    ("NTS 1", "London", "128 kbps MP3", "Eclectic", "new", "N1"),
    ("WFMU", "Jersey City", "128 kbps MP3", "Public", "http", "WF"),
    ("Venice Classic", "Venice", "128 kbps MP3", "Classical", "down", "VC"),
    ("Jazz24", "KNKX", "128 kbps AAC", "Jazz", "new", "J24"),
]

LISTS = [
    ("Favourites", 12, True),
    ("Ambient & downtempo", 24, False),
    ("Public radio", 9, False),
    ("Imported from Winamp", 63, False),
]

BADGE = {
    "live": ('live', EQ + "Playing"),
    "ok": ('ok', '<span class="dot"></span>Ready'),
    "new": ('new', 'Not played yet'),
    "http": ('bad', 'Blocked'),
    "down": ('bad', 'No response'),
}


def badge(state):
    cls, label = BADGE[state]
    return '<span class="badge %s">%s</span>' % (cls, label)


RAIL = """
<nav class="sh-rail" aria-label="Applications">
  <a href="#" title="Files">{f}</a>
  <a href="#" title="Shares">{s}</a>
  <a href="#" title="Spaces">{g}</a>
  <a href="#" class="on" aria-current="page" title="Radio">{r}</a>
</nav>
""".format(f=icon("folder", 20), s=icon("share", 20), g=icon("grid", 20), r=icon("radio", 20))

TOPBAR = """
<header class="sh-top">
  <span class="brand">{r}<span>OpenCloud</span></span>
  <span class="spacer"></span>
  {s}
  <span class="av">RS</span>
</header>
""".format(r=icon("radio", 20), s=icon("search", 19))

TOGGLE = """
<div class="tt" role="group" aria-label="Theme">
  <button data-mode="light" aria-pressed="false">Light</button>
  <button data-mode="dark" aria-pressed="false">Dark</button>
  <button data-mode="system" aria-pressed="true">System</button>
</div>
"""


def page(title, body, extra_css="", extra_js="", toggle_html=None):
    return """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(title)s — OpenCloud Radio mockup</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{%(light)s}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){%(dark)s}}
:root[data-theme="dark"]{%(dark)s}
%(base)s
%(extra)s
</style>
</head>
<body>
<div class="sh">
%(top)s
<div class="sh-body">
%(rail)s
<main class="app">
%(body)s
</main>
</div>
</div>
%(toggle)s
<script>%(js)s
%(extrajs)s</script>
</body>
</html>
""" % dict(title=title, light=LIGHT, dark=DARK, base=BASE_CSS, extra=extra_css,
           top=TOPBAR, rail=RAIL, body=body,
           toggle=TOGGLE if toggle_html is None else toggle_html,
           js=TOGGLE_JS if toggle_html is None else '', extrajs=extra_js)
