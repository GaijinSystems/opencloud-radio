# -*- coding: utf-8 -*-
from common import icon, badge, STATIONS, LISTS, EQ

# ---------------------------------------------------------------- 06 dense

CSS6 = """
.dock{display:flex;align-items:center;gap:14px;padding:10px 20px;flex:none;
  background:var(--oc-role-surface-container-high);border-bottom:1px solid var(--oc-role-outline-variant)}
.dock .np{flex:1;min-width:0;display:flex;align-items:baseline;gap:10px}
.dock .np b{font-weight:600}
.tabs6{display:flex;gap:0;padding:0 20px;border-bottom:1px solid var(--oc-role-outline-variant);flex:none}
.tabs6 button{padding:10px 14px;font-size:13px;color:var(--oc-role-on-surface-variant);
  border-bottom:2px solid transparent;display:flex;align-items:center;gap:7px}
.tabs6 button .c{font-size:11px;padding:1px 6px;border-radius:999px;
  background:var(--oc-role-surface-container-highest)}
.tabs6 button.on{color:var(--oc-role-on-surface);border-bottom-color:var(--oc-role-primary);font-weight:600}
.t6{width:100%;border-collapse:collapse;font-size:13px}
.t6 thead th{position:sticky;top:0;background:var(--oc-role-background);text-align:left;
  font-size:11px;font-weight:600;letter-spacing:.3px;color:var(--oc-role-on-surface-variant);
  padding:8px 12px;border-bottom:1px solid var(--oc-role-outline-variant)}
.t6 td{padding:5px 12px;border-bottom:1px solid var(--oc-role-surface-container-high)}
.t6 tr:hover td{background:var(--oc-role-surface-container)}
.t6 tr.on td{background:var(--oc-role-primary-container);color:var(--oc-role-on-primary-container)}
.t6 .idx{color:var(--oc-role-on-surface-variant);width:34px;text-align:right}
.t6 .url{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
  color:var(--oc-role-on-surface-variant);max-width:280px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.keys{display:flex;gap:16px;padding:8px 20px;font-size:11.5px;flex:none;
  color:var(--oc-role-on-surface-variant);border-top:1px solid var(--oc-role-outline-variant)}
kbd{font:inherit;padding:1px 5px;border-radius:4px;border:1px solid var(--oc-role-outline-variant);
  background:var(--oc-role-surface-container)}
"""

URLS = ["ice1.somafm.com/groovesalad-128-aac", "ice1.somafm.com/dronezone-128-aac",
        "ice1.somafm.com/deepspaceone-128-mp3", "stream.radioparadise.com/mellow-flac",
        "icecast.radiofrance.fr/fip-midfi.mp3", "kexp-mp3-128.streamguys1.com/kexp128.mp3",
        "stream-relay-geo.ntslive.net/stream", "stream0.wfmu.org/freeform-128k",
        "uk2.streamingpulse.com/ssl/vcr1", "live.wostreaming.net/direct/ppm-jazz24aac-ibc1"]


def body6():
    rows = []
    for i, ((n, net, det, grp, st, ini), u) in enumerate(zip(STATIONS, URLS), 1):
        rows.append("""<tr class="%s"><td class="idx mono">%d</td>
  <td style="font-weight:500">%s</td><td class="dim">%s</td><td class="dim">%s</td>
  <td class="url">%s%s</td><td class="mono dim">%s</td><td>%s</td></tr>""" % (
            "on" if st == "live" else "", i, n, net, grp,
            "http://" if st == "http" else "https://", u, det, badge(st)))
    tabs = "".join('<button class="%s">%s<span class="c mono">%d</span></button>'
                   % ("on" if on else "", nm, ct) for nm, ct, on in LISTS)
    return """
<div class="dock">
  <button class="play" aria-label="Pause">%(pause)s</button>
  <div class="np"><b>Groove Salad</b><span class="dim">SomaFM</span>
    <span class="dim">Bluetech — Peace Officer</span></div>
  <span class="badge live">%(eq)s 04:12</span>
  <div class="vol">%(vol)s<input type="range" min="0" max="100" value="72" aria-label="Volume"></div>
</div>
<div class="tabs6">%(tabs)s<button>%(plus)s</button>
  <span style="flex:1"></span>
  <button>%(imp)s Import</button><button>%(plus)s Add</button></div>
<div class="scroll" style="flex:1">
  <table class="t6">
    <thead><tr><th class="idx">#</th><th>Station</th><th>Network</th><th>Group</th>
      <th>Stream URL</th><th>Bitrate</th><th>State</th></tr></thead>
    <tbody>%(rows)s</tbody>
  </table>
</div>
<div class="keys">
  <span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> play</span>
  <span><kbd>Space</kbd> pause</span><span><kbd>E</kbd> edit</span>
  <span><kbd>⌥↑</kbd> reorder</span>
  <span style="margin-left:auto">Favourites.m3u8 · saved 2 minutes ago</span>
</div>""" % dict(rows="".join(rows), tabs=tabs, pause=icon("pause", 16), vol=icon("vol", 18),
                 eq=EQ, plus=icon("plus", 15), imp=icon("import", 15))


# ---------------------------------------------------------------- 07 master-detail editor

CSS7 = """
.md{display:flex;flex:1;min-height:0}
.mcol{width:300px;flex:none;border-right:1px solid var(--oc-role-outline-variant);
  display:flex;flex-direction:column;min-height:0;background:var(--oc-role-surface-container-low)}
.mcol .top{padding:12px 14px;display:flex;gap:8px;align-items:center;
  border-bottom:1px solid var(--oc-role-outline-variant)}
.mcol .top select{flex:1;background:none;border:0;font-weight:600;font-size:14px}
.itm{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 14px;
  border-bottom:1px solid var(--oc-role-surface-container-high)}
.itm:hover{background:var(--oc-role-surface-container-high)}
.itm.on{background:var(--oc-role-secondary-container);color:var(--oc-role-on-secondary-container)}
.itm .nm{flex:1;min-width:0}
.itm .nm div:first-child{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.itm .nm .s{font-size:12px;color:var(--oc-role-on-surface-variant)}
.itm.on .nm .s{color:inherit;opacity:.85}
.det{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.det .hd{display:flex;align-items:center;gap:16px;padding:22px 28px 18px;
  border-bottom:1px solid var(--oc-role-outline-variant)}
.det h1{margin:0;font-size:21px;font-weight:600}
.form{padding:22px 28px;max-width:640px;display:grid;gap:16px}
.f{display:grid;gap:5px}
.f label{font-size:12.5px;color:var(--oc-role-on-surface-variant)}
.f input,.f select{padding:8px 10px;border-radius:6px;background:var(--oc-role-surface-container-low);
  border:1px solid var(--oc-role-outline-variant);width:100%}
.f .hint{font-size:12px;color:var(--oc-role-on-surface-variant)}
.two7{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.actions{display:flex;gap:8px;padding-top:4px}
.bar7{display:flex;align-items:center;gap:12px;padding:9px 20px;flex:none;
  border-top:1px solid var(--oc-role-outline-variant);background:var(--oc-role-surface-container)}
"""


def body7():
    items = []
    for n, net, det, grp, st, ini in STATIONS:
        items.append("""<button class="itm %s"><div class="logo">%s</div>
  <div class="nm"><div>%s</div><div class="s">%s · %s</div></div>%s</button>""" % (
            "on" if n == "WFMU" else "", ini, n, net, grp,
            EQ if st == "live" else (badge(st) if st in ("http", "down") else "")))
    return """
<div class="md">
  <aside class="mcol">
    <div class="top"><select aria-label="Station list"><option>Favourites</option>
      <option>Ambient &amp; downtempo</option></select>
      <button class="btn q" aria-label="Add station">%(plus)s</button></div>
    <div class="scroll" style="flex:1">%(items)s</div>
  </aside>
  <section class="det">
    <div class="hd"><div class="logo lg">WF</div>
      <div style="flex:1;min-width:0"><h1>WFMU</h1>
        <div class="dim" style="font-size:13px">Jersey City · Public</div></div>
      <button class="btn" disabled style="opacity:.5">%(play)s Play</button></div>
    <div class="scroll" style="flex:1">
      <div class="form">
        <div class="note">%(radio)s<div><b>This station uses an http address.</b>
          Browsers block insecure audio on a secure page, so it cannot play here.
          Ask the station for an https link, or edit the address below if you know one.</div></div>
        <div class="f"><label for="u">Stream address</label>
          <input id="u" value="http://stream0.wfmu.org/freeform-128k">
          <span class="hint">Direct stream, or a .pls or .m3u link — those are resolved when you save.</span></div>
        <div class="two7">
          <div class="f"><label for="n7">Name</label><input id="n7" value="WFMU"></div>
          <div class="f"><label for="g7">Group</label>
            <select id="g7"><option>Public</option><option>Eclectic</option><option>Jazz</option></select></div>
        </div>
        <div class="two7">
          <div class="f"><label for="h7">Homepage</label><input id="h7" value="https://wfmu.org"></div>
          <div class="f"><label for="l7">Logo address</label><input id="l7" placeholder="Optional"></div>
        </div>
        <div class="actions"><button class="btn pri">%(check)s Save station</button>
          <button class="btn">Cancel</button>
          <span style="flex:1"></span>
          <button class="btn">%(trash)s Remove</button></div>
      </div>
    </div>
    <div class="bar7">
      <button class="play" aria-label="Pause">%(pause)s</button>
      <div style="flex:1;min-width:0"><b>Groove Salad</b>
        <span class="dim"> · Bluetech — Peace Officer</span></div>
      <span class="badge live">%(eq)s 04:12</span>
      <div class="vol">%(vol)s<input type="range" min="0" max="100" value="72" aria-label="Volume"></div>
    </div>
  </section>
</div>""" % dict(items="".join(items), plus=icon("plus", 17), play=icon("play", 15),
                 radio=icon("radio", 18), check=icon("check", 16), trash=icon("trash", 15),
                 pause=icon("pause", 16), vol=icon("vol", 18), eq=EQ)


# ---------------------------------------------------------------- 08 search-first

CSS8 = """
.cmdwrap{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;padding:56px 20px 20px}
.cmd{width:100%;max-width:620px;display:flex;flex-direction:column;min-height:0}
.cmdbar{display:flex;align-items:center;gap:11px;padding:13px 16px;border-radius:12px;
  border:1px solid var(--oc-role-outline-variant);background:var(--oc-role-surface-container-low);
  box-shadow:var(--shadow)}
.cmdbar input{flex:1;border:0;background:none;outline:none;font-size:16px}
.cmdbar .k{font-size:11px;padding:2px 6px;border-radius:5px;
  border:1px solid var(--oc-role-outline-variant);color:var(--oc-role-on-surface-variant)}
.grp{font-size:11.5px;font-weight:600;letter-spacing:.3px;padding:18px 6px 6px;
  color:var(--oc-role-on-surface-variant)}
.res{display:flex;align-items:center;gap:11px;width:100%;text-align:left;padding:9px 12px;border-radius:8px}
.res:hover{background:var(--oc-role-surface-container)}
.res.on{background:var(--oc-role-secondary-container);color:var(--oc-role-on-secondary-container)}
.res .nm{flex:1;min-width:0}
.res .nm div:first-child{font-weight:500}
.res .nm .s{font-size:12px;color:var(--oc-role-on-surface-variant)}
.res.on .nm .s{color:inherit;opacity:.85}
.mini{position:fixed;left:76px;bottom:16px;width:320px;border-radius:12px;padding:12px 14px;
  background:var(--oc-role-surface-container-high);border:1px solid var(--oc-role-outline-variant);
  box-shadow:var(--shadow);display:flex;align-items:center;gap:12px}
.mini .nm{flex:1;min-width:0}
.mini .nm b{font-weight:600}
.mini .nm .s{font-size:12px;color:var(--oc-role-on-surface-variant);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
"""


def body8():
    def res(n, sub, on=False, right=""):
        return """<button class="res %s"><div class="logo">%s</div>
  <div class="nm"><div>%s</div><div class="s">%s</div></div>%s</button>""" % (
            "on" if on else "", n[:2].upper(), n, sub, right)
    stations = "".join(res(n, "%s · %s" % (net, grp), st == "live",
                           EQ if st == "live" else '<span class="dim">%s</span>' % icon("play", 15))
                       for n, net, det, grp, st, ini in STATIONS[:5])
    return """
<div class="cmdwrap">
  <div class="cmd">
    <div class="cmdbar">%(srch)s
      <input placeholder="Search stations, or paste a stream address" value="so" aria-label="Search">
      <span class="k">Esc</span></div>
    <div class="scroll" style="flex:1;margin-top:6px">
      <div class="grp">Stations in your lists</div>
      %(stations)s
      <div class="grp">Actions</div>
      <button class="res"><div class="logo">%(plus)s</div>
        <div class="nm"><div>Add “so” as a new station</div>
        <div class="s">Paste a stream address to save it to Favourites</div></div></button>
      <button class="res"><div class="logo">%(imp)s</div>
        <div class="nm"><div>Import a playlist file</div>
        <div class="s">M3U, M3U8, PLS or XSPF from your space</div></div></button>
      <div class="grp">Lists</div>
      <button class="res"><div class="logo">%(list)s</div>
        <div class="nm"><div>Ambient &amp; downtempo</div><div class="s">24 stations</div></div></button>
      <button class="res"><div class="logo">%(list)s</div>
        <div class="nm"><div>Public radio</div><div class="s">9 stations</div></div></button>
    </div>
  </div>
</div>
<div class="mini">
  <button class="play" aria-label="Pause">%(pause)s</button>
  <div class="nm"><b>Groove Salad</b><div class="s">Bluetech — Peace Officer</div></div>
  <button class="btn q" aria-label="Volume">%(vol)s</button>
</div>""" % dict(stations=stations, srch=icon("search", 19), plus=icon("plus", 17),
                 imp=icon("import", 17), list=icon("list", 17), pause=icon("pause", 16),
                 vol=icon("vol", 18))


# ---------------------------------------------------------------- 09 console

CSS9 = """
.console{flex:none;padding:18px 24px;background:var(--oc-role-surface-container);
  border-bottom:1px solid var(--oc-role-outline-variant);display:flex;gap:22px;align-items:stretch}
.console .now{width:250px;flex:none;display:flex;gap:12px;align-items:center}
.console h1{margin:0;font-size:17px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.scope{flex:1;min-width:0;border-radius:10px;padding:10px 12px;
  background:var(--oc-role-surface-container-lowest);border:1px solid var(--oc-role-outline-variant);
  display:flex;flex-direction:column;gap:6px}
.scope .lbl{font-size:10.5px;letter-spacing:.4px;color:var(--oc-role-on-surface-variant);
  display:flex;justify-content:space-between}
.bars{flex:1;display:flex;align-items:flex-end;gap:2px;min-height:62px}
.bars i{flex:1;border-radius:1px 1px 0 0;background:var(--oc-role-primary);opacity:.55;transform-origin:bottom;
  animation:b9 1.1s ease-in-out infinite alternate}
@keyframes b9{from{transform:scaleY(.3)}to{transform:scaleY(1)}}
@media (prefers-reduced-motion:reduce){.bars i{animation:none}}
.ctl9{width:210px;flex:none;display:flex;flex-direction:column;justify-content:center;gap:10px}
.cols{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:0 1px;
  background:var(--oc-role-outline-variant)}
.pane{background:var(--oc-role-background);display:flex;flex-direction:column;min-height:0}
.pane .ph{display:flex;align-items:center;gap:8px;padding:11px 18px;
  border-bottom:1px solid var(--oc-role-outline-variant)}
.pane .ph h2{margin:0;font-size:13px;font-weight:600}
.ln{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 18px;
  border-bottom:1px solid var(--oc-role-surface-container-high)}
.ln:hover{background:var(--oc-role-surface-container)}
.ln.on{background:var(--oc-role-primary-container);color:var(--oc-role-on-primary-container)}
.ln .nm{flex:1;min-width:0}
.ln .nm div:first-child{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ln .nm .s{font-size:12px;color:var(--oc-role-on-surface-variant)}
.ln.on .nm .s{color:inherit;opacity:.85}
"""


def body9():
    bars = "".join('<i style="height:%d%%;animation-delay:-%.2fs"></i>' % (h, (i % 7) * .17)
                   for i, h in enumerate(
                       [22, 40, 62, 78, 94, 70, 52, 80, 96, 64, 44, 68, 88, 60, 42, 56, 74, 48,
                        34, 26, 40, 58, 46, 32, 24, 37, 52, 30, 22, 16, 28, 44, 36, 24, 18, 30,
                        42, 26, 20, 14]))
    left = "".join("""<button class="ln %s"><div class="logo">%s</div>
  <div class="nm"><div>%s</div><div class="s">%s</div></div>%s</button>""" % (
        "on" if st == "live" else "", ini, n, net,
        EQ if st == "live" else '<span class="dim">%s</span>' % icon("play", 15))
        for n, net, det, grp, st, ini in STATIONS[:5])
    right = "".join("""<button class="ln"><div class="logo">%s</div>
  <div class="nm"><div>%s</div><div class="s">%s</div></div>%s</button>""" % (
        ini, n, net, badge(st) if st in ("http", "down") else
        '<span class="dim">%s</span>' % icon("play", 15))
        for n, net, det, grp, st, ini in STATIONS[5:])
    return """
<div class="console">
  <div class="now"><div class="logo lg">GS</div>
    <div style="min-width:0"><h1>Groove Salad</h1>
      <div class="dim" style="font-size:12.5px">SomaFM · 128 kbps AAC</div>
      <div style="font-size:12.5px;margin-top:3px">Bluetech — Peace Officer</div></div></div>
  <div class="scope"><div class="lbl"><span>Spectrum — placeholder for a later step</span>
    <span class="mono">20 Hz – 20 kHz</span></div>
    <div class="bars" aria-hidden="true">%(bars)s</div></div>
  <div class="ctl9">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="play big" aria-label="Pause">%(pause)s</button>
      <div><div class="mono" style="font-weight:600">04:12</div>
        <div class="dim" style="font-size:12px">connected</div></div></div>
    <div class="vol">%(vol)s<input type="range" min="0" max="100" value="72" aria-label="Volume"></div>
  </div>
</div>
<div class="cols">
  <div class="pane">
    <div class="ph">%(list)s<h2>Favourites</h2><span class="dim mono" style="font-size:12px">12</span>
      <span style="flex:1"></span><button class="btn q" aria-label="Add">%(plus)s</button></div>
    <div class="scroll" style="flex:1">%(left)s</div>
  </div>
  <div class="pane">
    <div class="ph">%(list)s<h2>Ambient &amp; downtempo</h2>
      <span class="dim mono" style="font-size:12px">24</span>
      <span style="flex:1"></span><button class="btn q" aria-label="Add">%(plus)s</button></div>
    <div class="scroll" style="flex:1">%(right)s</div>
  </div>
</div>""" % dict(bars=bars, left=left, right=right, pause=icon("pause", 22),
                 vol=icon("vol", 18), list=icon("list", 16), plus=icon("plus", 16))


# ---------------------------------------------------------------- 10 narrow / touch

CSS10 = """
.sh-rail{display:none}
.app{align-items:center;background:var(--oc-role-surface-dim);padding:18px 0;overflow:auto}
.phone{width:390px;max-width:100%;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;
  border-radius:22px;overflow:hidden;background:var(--oc-role-background);
  border:1px solid var(--oc-role-outline-variant);box-shadow:var(--shadow)}
.ph10{display:flex;align-items:center;gap:10px;padding:14px 16px 8px}
.ph10 h1{margin:0;font-size:19px;font-weight:600}
.pick{display:flex;gap:8px;padding:2px 16px 12px;overflow-x:auto}
.pick button{flex:none;padding:6px 13px;border-radius:999px;font-size:13px;
  border:1px solid var(--oc-role-outline-variant);color:var(--oc-role-on-surface-variant)}
.pick button.on{background:var(--oc-role-secondary-container);
  color:var(--oc-role-on-secondary-container);border-color:transparent;font-weight:600}
.row10{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:11px 16px;
  border-bottom:1px solid var(--oc-role-surface-container-high);min-height:60px}
.row10.on{background:var(--oc-role-secondary-container);color:var(--oc-role-on-secondary-container)}
.row10 .nm{flex:1;min-width:0}
.row10 .nm div:first-child{font-weight:500;font-size:15px}
.row10 .nm .s{font-size:12.5px;color:var(--oc-role-on-surface-variant)}
.row10.on .nm .s{color:inherit;opacity:.85}
.sheet{flex:none;padding:12px 16px 16px;background:var(--oc-role-surface-container-high);
  border-top:1px solid var(--oc-role-outline-variant);display:flex;flex-direction:column;gap:10px}
.sheet .top{display:flex;align-items:center;gap:12px}
.sheet .grab{width:38px;height:4px;border-radius:2px;margin:0 auto 4px;
  background:var(--oc-role-outline-variant)}
.fab{position:absolute;right:18px;bottom:130px;width:52px;height:52px;border-radius:16px;
  display:grid;place-items:center;background:var(--oc-role-primary);color:var(--oc-role-on-primary);
  box-shadow:var(--shadow)}
"""


def body10():
    rows = "".join("""<button class="row10 %s"><div class="logo lg" style="width:44px;height:44px;
  font-size:15px">%s</div><div class="nm"><div>%s</div><div class="s">%s · %s</div></div>%s</button>""" % (
        "on" if st == "live" else "", ini, n, net, grp,
        EQ if st == "live" else (badge(st) if st in ("http", "down")
                                 else '<span class="dim">%s</span>' % icon("play", 17)))
        for n, net, det, grp, st, ini in STATIONS[:8])
    return """
<div class="phone" style="position:relative">
  <div class="ph10"><h1>Radio</h1><span style="flex:1"></span>
    <button class="btn q" aria-label="Search">%(srch)s</button>
    <button class="btn q" aria-label="More">%(more)s</button></div>
  <div class="pick"><button class="on">Favourites</button><button>Ambient</button>
    <button>Public radio</button><button>Winamp</button></div>
  <div class="scroll" style="flex:1">%(rows)s</div>
  <button class="fab" aria-label="Add station">%(plus)s</button>
  <div class="sheet">
    <div class="grab"></div>
    <div class="top"><div class="logo lg">GS</div>
      <div style="flex:1;min-width:0"><div style="font-weight:600">Groove Salad</div>
        <div class="dim" style="font-size:12.5px">Bluetech — Peace Officer</div></div>
      <button class="play big" aria-label="Pause">%(pause)s</button></div>
    <div class="vol">%(vol)s<input type="range" min="0" max="100" value="72" style="flex:1"
      aria-label="Volume"></div>
  </div>
</div>""" % dict(rows=rows, srch=icon("search", 19), more=icon("more", 19), plus=icon("plus", 22),
                 pause=icon("pause", 22), vol=icon("vol", 18))
