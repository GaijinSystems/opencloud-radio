# -*- coding: utf-8 -*-
from common import icon, badge, STATIONS, LISTS, EQ

# ---------------------------------------------------------------- 01 three pane

CSS1 = """
.wrap{display:flex;flex:1;min-height:0}
.rail2{width:236px;flex:none;border-right:1px solid var(--oc-role-outline-variant);
  background:var(--oc-role-surface-container-low);display:flex;flex-direction:column;min-height:0}
.rail2 h2{font-size:11.5px;font-weight:600;letter-spacing:.4px;margin:16px 16px 8px;
  color:var(--oc-role-on-surface-variant)}
.rail2 a{display:flex;align-items:center;gap:10px;padding:8px 14px;margin:0 8px 2px;border-radius:6px;
  text-decoration:none;color:var(--oc-role-on-surface)}
.rail2 a:hover{background:var(--oc-role-surface-container-high)}
.rail2 a.on{background:var(--oc-role-secondary-container);color:var(--oc-role-on-secondary-container);font-weight:600}
.rail2 a .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rail2 a .c{font-size:12px;opacity:.7}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.hd{display:flex;align-items:center;gap:12px;padding:18px 24px 14px}
.hd h1{font-size:20px;font-weight:600;margin:0}
.hd .sub{font-size:12.5px;color:var(--oc-role-on-surface-variant)}
.tbl{width:100%;border-collapse:collapse}
.tbl th{font-size:11.5px;font-weight:600;text-align:left;padding:0 12px 8px;
  color:var(--oc-role-on-surface-variant);border-bottom:1px solid var(--oc-role-outline-variant)}
.tbl td{padding:9px 12px;border-bottom:1px solid var(--oc-role-outline-variant)}
.tbl tr:hover td{background:var(--oc-role-surface-container)}
.tbl tr.on td{background:var(--oc-role-surface-container-high)}
.tbl .nm{font-weight:500}
.tbl .sub{font-size:12px;color:var(--oc-role-on-surface-variant)}
.cellflex{display:flex;align-items:center;gap:10px}
.bar{display:flex;align-items:center;gap:14px;padding:10px 18px;flex:none;
  border-top:1px solid var(--oc-role-outline-variant);background:var(--oc-role-surface-container)}
.bar .np{flex:1;min-width:0}
.bar .np b{font-weight:600}
"""


def body1():
    rows = []
    for i, (n, net, det, grp, st, ini) in enumerate(STATIONS[:8]):
        rows.append("""<tr class="%s">
  <td><div class="cellflex"><button class="play %s" aria-label="Play %s">%s</button>
    <div><div class="nm">%s</div><div class="sub">%s</div></div></div></td>
  <td class="sub">%s</td><td class="sub mono">%s</td><td>%s</td>
  <td style="text-align:right">%s</td></tr>""" % (
            "on" if st == "live" else "",
            "" if st == "live" else "ghost", n,
            icon("pause" if st == "live" else "play", 15), n, net, grp, det, badge(st),
            '<button class="btn q" aria-label="More">%s</button>' % icon("more", 16)))
    lists = "".join(
        '<a href="#" class="%s">%s<span class="n">%s</span><span class="c mono">%d</span></a>'
        % ("on" if on else "", icon("list", 17), nm, ct) for nm, ct, on in LISTS)
    return """
<div class="wrap">
  <aside class="rail2">
    <h2>Station lists</h2>
    %(lists)s
    <a href="#" style="margin-top:4px">%(plus)s<span class="n">New list</span></a>
    <div style="flex:1"></div>
    <div style="padding:12px 16px;font-size:12px;color:var(--oc-role-on-surface-variant)">
      Stored in <b>Radio/</b> in your personal space.</div>
  </aside>
  <section class="main">
    <div class="hd">
      <div style="flex:1;min-width:0">
        <h1>Favourites</h1>
        <div class="sub">12 stations · Favourites.m3u8</div>
      </div>
      <button class="btn">%(imp)s Import</button>
      <button class="btn pri">%(plus)s Add station</button>
    </div>
    <div class="scroll" style="flex:1;padding:0 12px">
      <table class="tbl">
        <thead><tr><th>Station</th><th>Group</th><th>Stream</th><th>State</th><th></th></tr></thead>
        <tbody>%(rows)s</tbody>
      </table>
    </div>
    <div class="bar">
      <button class="play" aria-label="Pause">%(pause)s</button>
      <div class="logo">GS</div>
      <div class="np"><b>Groove Salad</b> <span class="dim">· SomaFM</span>
        <div class="sub dim">Bluetech — Peace Officer &nbsp;·&nbsp; 128 kbps AAC</div></div>
      <div class="vol">%(vol)s<input type="range" min="0" max="100" value="72" aria-label="Volume"></div>
    </div>
  </section>
</div>""" % dict(lists=lists, rows="".join(rows), plus=icon("plus", 17), imp=icon("import", 16),
                 pause=icon("pause", 16), vol=icon("vol", 18))


# ---------------------------------------------------------------- 02 files-native

CSS2 = """
.crumb{display:flex;align-items:center;gap:6px;padding:14px 20px 10px;font-size:13px}
.crumb a{color:var(--oc-role-on-surface-variant);text-decoration:none}
.crumb b{font-weight:600}
.toolbar{display:flex;align-items:center;gap:8px;padding:0 20px 12px}
.toolbar .grow{flex:1}
.srch{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;
  border:1px solid var(--oc-role-outline-variant);background:var(--oc-role-surface-container-low);width:260px}
.srch input{border:0;background:none;outline:none;width:100%}
.split{display:flex;flex:1;min-height:0}
.list{flex:1;min-width:0;display:flex;flex-direction:column}
.r{display:flex;align-items:center;gap:12px;padding:8px 20px;border-bottom:1px solid var(--oc-role-outline-variant)}
.r:hover{background:var(--oc-role-surface-container)}
.r.on{background:var(--oc-role-secondary-container);color:var(--oc-role-on-secondary-container)}
.r .nm{flex:1;min-width:0}
.r .nm div:first-child{font-weight:500}
.r .nm .s{font-size:12px;color:var(--oc-role-on-surface-variant)}
.r.on .nm .s{color:inherit;opacity:.8}
.side{width:320px;flex:none;border-left:1px solid var(--oc-role-outline-variant);
  background:var(--oc-role-surface-container-low);display:flex;flex-direction:column;min-height:0}
.side .top{padding:20px;text-align:center;border-bottom:1px solid var(--oc-role-outline-variant)}
.side h2{margin:12px 0 2px;font-size:17px}
.tabs{display:flex;gap:2px;padding:8px 12px 0;border-bottom:1px solid var(--oc-role-outline-variant)}
.tabs button{padding:8px 12px;font-size:13px;color:var(--oc-role-on-surface-variant);
  border-bottom:2px solid transparent}
.tabs button.on{color:var(--oc-role-on-surface);border-bottom-color:var(--oc-role-primary);font-weight:600}
.kv{display:grid;grid-template-columns:96px 1fr;gap:10px 12px;padding:16px 20px;font-size:13px}
.kv dt{color:var(--oc-role-on-surface-variant)}
.kv dd{margin:0;word-break:break-all}
.bar2{display:flex;align-items:center;gap:12px;padding:8px 20px;flex:none;
  border-top:1px solid var(--oc-role-outline-variant);background:var(--oc-role-surface-container)}
"""


def body2():
    rows = []
    for n, net, det, grp, st, ini in STATIONS:
        rows.append("""<div class="r %s">
  <button class="play %s" aria-label="Play %s">%s</button>
  <div class="logo">%s</div>
  <div class="nm"><div>%s</div><div class="s">%s · %s</div></div>
  <div class="s dim mono" style="font-size:12px">%s</div>
  %s
  <button class="btn q" aria-label="More">%s</button></div>""" % (
            "on" if n == "Drone Zone" else "",
            "" if st == "live" else "ghost", n,
            icon("pause" if st == "live" else "play", 15), ini, n, net, grp, det,
            badge(st), icon("more", 16)))
    return """
<div class="crumb"><a href="#">Personal</a>%(chev)s<a href="#">Radio</a>%(chev)s<b>Favourites.m3u8</b></div>
<div class="toolbar">
  <div class="srch">%(srch)s<input placeholder="Filter stations" aria-label="Filter stations"></div>
  <span class="grow"></span>
  <button class="btn">%(ref)s Reload</button>
  <button class="btn">%(imp)s Import</button>
  <button class="btn pri">%(plus)s Add station</button>
</div>
<div class="split">
  <div class="list scroll">%(rows)s</div>
  <aside class="side">
    <div class="top">
      <div class="logo xl" style="margin:0 auto">DZ</div>
      <h2>Drone Zone</h2>
      <div class="dim" style="font-size:13px">SomaFM · Ambient</div>
      <div style="margin-top:14px"><button class="btn pri">%(play)s Play station</button></div>
    </div>
    <div class="tabs"><button class="on">Details</button><button>Now playing</button></div>
    <dl class="kv">
      <dt>Stream</dt><dd>https://ice1.somafm.com/dronezone-128-aac</dd>
      <dt>Format</dt><dd>128 kbps AAC</dd>
      <dt>Status</dt><dd>Played 4 minutes ago</dd>
      <dt>Homepage</dt><dd>somafm.com/dronezone</dd>
      <dt>Group</dt><dd>Ambient</dd>
    </dl>
    <div style="padding:0 20px"><hr class="sep"></div>
    <div style="padding:14px 20px;display:flex;gap:8px">
      <button class="btn">%(edit)s Edit</button><button class="btn">%(link)s Copy URL</button>
    </div>
  </aside>
</div>
<div class="bar2">
  <button class="play" aria-label="Pause">%(pause)s</button>
  <div class="logo">GS</div>
  <div style="flex:1;min-width:0"><b>Groove Salad</b>
    <div class="dim" style="font-size:12px">SomaFM · 128 kbps AAC</div></div>
  <span class="badge live">%(eq)s Playing</span>
  <div class="vol">%(vol)s<input type="range" min="0" max="100" value="72" aria-label="Volume"></div>
</div>""" % dict(rows="".join(rows), chev=icon("chev", 13), srch=icon("search", 16),
                 ref=icon("refresh", 16), imp=icon("import", 16), plus=icon("plus", 17),
                 play=icon("play", 16), edit=icon("edit", 15), link=icon("link", 15),
                 pause=icon("pause", 16), vol=icon("vol", 18), eq=EQ)


# ---------------------------------------------------------------- 03 tile wall

CSS3 = """
.hd3{display:flex;align-items:center;gap:12px;padding:20px 26px 6px}
.hd3 h1{margin:0;font-size:22px;font-weight:600}
.chips{display:flex;gap:8px;flex-wrap:wrap;padding:10px 26px 16px}
.chip{padding:5px 13px;border-radius:999px;font-size:12.5px;
  border:1px solid var(--oc-role-outline-variant);color:var(--oc-role-on-surface-variant)}
.chip.on{background:var(--oc-role-secondary-container);color:var(--oc-role-on-secondary-container);
  border-color:transparent;font-weight:600}
.tiles{display:grid;gap:14px;padding:0 26px 26px;
  grid-template-columns:repeat(auto-fill,minmax(212px,1fr))}
.tile{border:1px solid var(--oc-role-outline-variant);border-radius:12px;padding:16px;
  background:var(--oc-role-surface-container-low);display:flex;flex-direction:column;gap:10px;position:relative}
.tile:hover{background:var(--oc-role-surface-container-high)}
.tile.on{border-color:var(--oc-role-primary);background:var(--oc-role-surface-container-high)}
.tile h3{margin:0;font-size:15px;font-weight:600}
.tile .s{font-size:12.5px;color:var(--oc-role-on-surface-variant)}
.tile .row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto}
.bar3{display:flex;align-items:center;gap:14px;padding:12px 26px;flex:none;
  border-top:1px solid var(--oc-role-outline-variant);background:var(--oc-role-surface-container)}
"""


def body3():
    tiles = []
    for n, net, det, grp, st, ini in STATIONS:
        tiles.append("""<article class="tile %s">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
    <div class="logo lg">%s</div>%s</div>
  <div><h3>%s</h3><div class="s">%s · %s</div></div>
  <div class="row"><span class="s mono">%s</span>
    <button class="play %s" aria-label="Play %s">%s</button></div>
</article>""" % ("on" if st == "live" else "", ini, badge(st), n, net, grp, det,
                 "" if st == "live" else "ghost", n,
                 icon("pause" if st == "live" else "play", 16)))
    chips = "".join('<button class="chip %s">%s</button>' % ("on" if i == 0 else "", c)
                    for i, c in enumerate(
                        ["All 12", "Ambient 4", "Eclectic 3", "Public 2", "Classical 1", "Jazz 1"]))
    return """
<div class="hd3">
  <div style="flex:1"><h1>Favourites</h1>
    <div class="dim" style="font-size:12.5px">Radio / Favourites.m3u8</div></div>
  <button class="btn">%(imp)s Import</button>
  <button class="btn pri">%(plus)s Add station</button>
</div>
<div class="chips">%(chips)s</div>
<div class="scroll" style="flex:1"><div class="tiles">%(tiles)s</div></div>
<div class="bar3">
  <button class="play" aria-label="Pause">%(pause)s</button>
  <div style="flex:1;min-width:0"><b>Groove Salad</b> <span class="dim">· SomaFM</span>
    <div class="dim" style="font-size:12px">Bluetech — Peace Officer</div></div>
  <div class="vol">%(vol)s<input type="range" min="0" max="100" value="72" aria-label="Volume"></div>
</div>""" % dict(tiles="".join(tiles), chips=chips, plus=icon("plus", 17), imp=icon("import", 16),
                 pause=icon("pause", 16), vol=icon("vol", 18))


# ---------------------------------------------------------------- 04 tuner

CSS4 = """
.stage{padding:26px 30px 10px;display:flex;gap:26px;align-items:center}
.stage .meta{min-width:0}
.stage h1{margin:0 0 2px;font-size:30px;font-weight:700;letter-spacing:-.4px}
.stage .net{font-size:14px;color:var(--oc-role-on-surface-variant)}
.stage .track{margin-top:14px;font-size:15px}
.spectrum{flex:1;min-width:0;height:84px;display:flex;align-items:flex-end;gap:3px;
  padding:0 4px;border-bottom:1px solid var(--oc-role-outline-variant)}
.spectrum i{flex:1;background:linear-gradient(to top,var(--oc-role-primary),var(--oc-role-primary) 55%,
  var(--oc-role-tertiary));border-radius:2px 2px 0 0;opacity:.85;transform-origin:bottom;animation:sp 1.3s ease-in-out infinite alternate}
@keyframes sp{from{transform:scaleY(.25)}to{transform:scaleY(1)}}
@media (prefers-reduced-motion:reduce){.spectrum i{animation:none}}
.spectrum.ph{opacity:.28}
.dialwrap{padding:16px 0 4px;border-top:1px solid var(--oc-role-outline-variant);
  border-bottom:1px solid var(--oc-role-outline-variant);background:var(--oc-role-surface-container-low)}
.dial{display:flex;gap:10px;padding:0 30px 16px;overflow-x:auto}
.st{flex:none;width:150px;padding:12px;border-radius:10px;text-align:left;
  border:1px solid var(--oc-role-outline-variant);background:var(--oc-role-surface-container-low)}
.st:hover{background:var(--oc-role-surface-container-high)}
.st.on{border-color:var(--oc-role-primary);background:var(--oc-role-surface-container-high)}
.st .t{font-weight:600;font-size:13.5px;margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st .s{font-size:12px;color:var(--oc-role-on-surface-variant)}
.ticks{display:flex;align-items:flex-end;gap:0;height:16px;padding:0 30px;margin-bottom:8px}
.ticks i{flex:1;height:6px;border-left:1px solid var(--oc-role-outline-variant)}
.ticks i:nth-child(5n+1){height:13px}
.lists4{display:flex;gap:8px;padding:16px 30px;align-items:center;flex-wrap:wrap}
.lists4 button{padding:6px 13px;border-radius:999px;font-size:13px;
  border:1px solid var(--oc-role-outline-variant);color:var(--oc-role-on-surface-variant)}
.lists4 button.on{background:var(--oc-role-secondary-container);
  color:var(--oc-role-on-secondary-container);border-color:transparent;font-weight:600}
"""


def body4():
    bars = "".join('<i style="height:%d%%"></i>' % h for h in
                   [18, 34, 52, 70, 88, 64, 46, 72, 90, 58, 40, 62, 84, 56, 38, 50, 68, 44, 30,
                    22, 36, 54, 42, 28, 20, 33, 48, 26, 18, 14])
    ticks = "".join("<i></i>" for _ in range(40))
    stations = "".join("""<button class="st %s"><div style="display:flex;justify-content:space-between;
  align-items:center"><div class="logo">%s</div>%s</div>
  <div class="t">%s</div><div class="s">%s</div></button>""" % (
        "on" if st == "live" else "", ini,
        icon("pause" if st == "live" else "play", 15, "dim"), n, net)
        for n, net, det, grp, st, ini in STATIONS)
    lists = "".join('<button class="%s">%s</button>' % ("on" if on else "", nm)
                    for nm, ct, on in LISTS)
    return """
<div class="stage">
  <div class="logo xl">GS</div>
  <div class="meta">
    <h1>Groove Salad</h1>
    <div class="net">SomaFM · Ambient · 128 kbps AAC</div>
    <div class="track">Bluetech — Peace Officer</div>
  </div>
  <div class="spectrum ph" aria-hidden="true">%(bars)s</div>
</div>
<div style="display:flex;align-items:center;gap:16px;padding:6px 30px 20px">
  <button class="play big" aria-label="Pause">%(pause)s</button>
  <div class="vol">%(vol)s<input type="range" min="0" max="100" value="72" aria-label="Volume"></div>
  <span class="dim" style="font-size:12.5px">Spectrum is a placeholder — later step</span>
</div>
<div class="dialwrap">
  <div class="ticks" aria-hidden="true">%(ticks)s</div>
  <div class="dial">%(stations)s</div>
</div>
<div class="lists4">%(lists)s
  <button style="border-style:dashed">%(plus)s New list</button>
  <span style="flex:1"></span>
  <button class="btn">%(imp)s Import</button>
  <button class="btn pri">%(plus)s Add station</button>
</div>""" % dict(bars=bars, ticks=ticks, stations=stations, lists=lists,
                 pause=icon("pause", 22), vol=icon("vol", 18), plus=icon("plus", 15),
                 imp=icon("import", 16))


# ---------------------------------------------------------------- 05 hero + column

CSS5 = """
.two{display:flex;flex:1;min-height:0}
.hero{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;
  align-items:center;text-align:center;padding:40px 36px;gap:6px}
.hero .logo{box-shadow:var(--shadow)}
.hero h1{margin:22px 0 2px;font-size:28px;font-weight:700;letter-spacing:-.3px}
.hero .net{color:var(--oc-role-on-surface-variant)}
.hero .track{margin-top:18px;font-size:15px;max-width:34ch}
.hero .ctl{display:flex;align-items:center;gap:18px;margin-top:26px}
.col{width:330px;flex:none;border-left:1px solid var(--oc-role-outline-variant);
  background:var(--oc-role-surface-container-low);display:flex;flex-direction:column;min-height:0}
.col .hd{display:flex;align-items:center;gap:8px;padding:14px 16px 10px}
.col .hd select{background:none;border:0;font-weight:600;font-size:15px;flex:1}
.it{display:flex;align-items:center;gap:11px;padding:9px 16px;width:100%;text-align:left}
.it:hover{background:var(--oc-role-surface-container-high)}
.it.on{background:var(--oc-role-secondary-container);color:var(--oc-role-on-secondary-container)}
.it .nm{flex:1;min-width:0}
.it .nm div:first-child{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.it .nm .s{font-size:12px;color:var(--oc-role-on-surface-variant)}
.it.on .nm .s{color:inherit;opacity:.8}
.foot{padding:12px 16px;border-top:1px solid var(--oc-role-outline-variant);display:flex;gap:8px}
"""


def body5():
    items = []
    for n, net, det, grp, st, ini in STATIONS:
        items.append("""<button class="it %s"><div class="logo">%s</div>
  <div class="nm"><div>%s</div><div class="s">%s</div></div>%s</button>""" % (
            "on" if st == "live" else "", ini, n, net,
            EQ if st == "live" else ('<span class="dim">%s</span>' % icon("play", 15)
                                     if st not in ("http", "down") else badge(st))))
    return """
<div class="two">
  <section class="hero">
    <div class="logo xl">GS</div>
    <h1>Groove Salad</h1>
    <div class="net">SomaFM · Ambient</div>
    <div class="track">Bluetech — Peace Officer</div>
    <div class="ctl">
      <button class="btn q" aria-label="Previous station">%(up)s</button>
      <button class="play big" aria-label="Pause">%(pause)s</button>
      <button class="btn q" aria-label="Next station">%(down)s</button>
    </div>
    <div class="vol" style="margin-top:18px">%(vol)s
      <input type="range" min="0" max="100" value="72" aria-label="Volume"></div>
    <div class="dim mono" style="margin-top:22px;font-size:12px">128 kbps AAC · connected 04:12</div>
  </section>
  <aside class="col">
    <div class="hd">
      <select aria-label="Station list">
        <option>Favourites</option><option>Ambient &amp; downtempo</option>
        <option>Public radio</option>
      </select>
      <button class="btn q" aria-label="List options">%(more)s</button>
    </div>
    <div class="scroll" style="flex:1">%(items)s</div>
    <div class="foot">
      <button class="btn" style="flex:1">%(plus)s Add station</button>
      <button class="btn" aria-label="Import">%(imp)s</button>
    </div>
  </aside>
</div>""" % dict(items="".join(items), pause=icon("pause", 22), up=icon("up", 20),
                 down=icon("down", 20), vol=icon("vol", 18), more=icon("more", 16),
                 plus=icon("plus", 16), imp=icon("import", 16))
