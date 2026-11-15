# -*- coding: utf-8 -*-
import os
from common import page, LIGHT, DARK, BASE_CSS, TOGGLE_JS, TOGGLE
import m1
import m2
import m3

# The mockups go beside this folder: docs/mockups/.
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
os.makedirs(OUT, exist_ok=True)

MOCKUPS = [
    ("01-three-pane.html", "Three pane",
     m1.body1, m1.CSS1,
     "Lists on the left, a station table in the middle, a player bar along the bottom.",
     "Reads as a native OpenCloud screen and needs no explanation. The list rail is always "
     "visible, so moving between lists is one click.",
     "The least distinctive of the ten. The table gives each station the same weight, which "
     "makes a 60-station list hard to scan."),
    ("02-files-native.html", "Files-native with details panel",
     m1.body2, m1.CSS2,
     "Breadcrumb, row list and a right-hand details panel, borrowing the Files layout directly.",
     "Users already know this shape. The details panel is the natural home for the stream "
     "address, format and last-played time without a modal.",
     "Two side panels plus a player bar leaves a narrow middle column on small screens. The "
     "breadcrumb implies folder navigation the app does not actually offer."),
    ("03-tile-wall.html", "Tile wall",
     m1.body3, m1.CSS3,
     "Stations as cards in a responsive grid, with group filters as chips above.",
     "Logos carry recognition better than text, and the grid reflows to any width without a "
     "separate mobile design.",
     "Low density — about twelve stations per screen against forty in the table layouts. Without "
     "logos the tiles are mostly empty space."),
    ("04-tuner.html", "Tuner",
     m1.body4, m1.CSS4,
     "A now-playing stage over a horizontal band of stations, with tick marks suggesting a dial.",
     "The only layout with a point of view about what radio is. The stage has room for the "
     "spectrum analyser without redesigning anything.",
     "Horizontal scrolling hides stations and is awkward with a keyboard. The dial metaphor "
     "stops paying off past about twenty stations."),
    ("05-hero-column.html", "Hero and column",
     m1.body5, m1.CSS5,
     "A large now-playing panel with the station list as a narrow column on the right.",
     "Puts the thing that is actually happening at the centre. Calm, and it works well as a "
     "screen left open on a second monitor.",
     "Editing and reordering have nowhere to live, so both need a modal. Half the screen is "
     "given to four lines of text."),
    ("06-dense-table.html", "Dense table",
     m2.body6, m2.CSS6,
     "Full-width data table with the stream address visible, a docked player, keyboard hints.",
     "Highest density of the ten and the only one that shows the stream URL in the list, which "
     "is what you need when a station stops working. Tabs replace the rail and reclaim the width.",
     "It looks like a database table rather than a music player. The URL column pushes the "
     "minimum comfortable width up."),
    ("07-master-detail.html", "Master and detail editor",
     m2.body7, m2.CSS7,
     "Station list on the left, a full editing form on the right, shown here in an error state.",
     "Adding and fixing stations is the work this app actually involves, and this is the only "
     "layout that treats it as a first-class screen rather than a modal. Blocked-station "
     "explanations have room to be useful.",
     "The detail pane is mostly empty when you are only listening. Optimises for the setup "
     "task over the everyday one."),
    ("08-search-first.html", "Search first",
     m2.body8, m2.CSS8,
     "One search field over everything, with a small floating player card.",
     "Scales past a thousand stations without a scrollbar, and the same field accepts a pasted "
     "stream address, so adding a station and finding one are the same gesture.",
     "Nothing is visible until you type, which hides the library and makes browsing impossible. "
     "Reordering a list has no home here at all."),
    ("09-console.html", "Console",
     m2.body9, m2.CSS9,
     "A player console strip across the top with a dedicated analyser panel, two list panes below.",
     "Designs the spectrum in from the start rather than bolting it on, and two visible lists "
     "make dragging a station between them possible.",
     "The console takes a fixed 170 px of height whether or not anything is playing. Two panes "
     "need real width to work."),
    ("10-narrow.html", "Narrow and touch",
     m2.body10, m2.CSS10,
     "The single-column layout at phone width, with a bottom sheet player and a floating add button.",
     "The only one that answers what happens below about 700 px, which every other layout still "
     "needs. Large touch targets, one-handed transport controls.",
     "Not a desktop design — this is the companion to whichever of the others is chosen, "
     "not an alternative to them."),
    ("11-three-pane-tuned.html", "Three pane, tuned",
     m3.body11, m3.CSS11,
     "Mockup 01 with a resizable list divider, a columns preference, and a taller player "
     "carrying the spectrum above the transport row.",
     "The divider defaults to 268 px, which fits the longest list name without truncation, "
     "clamps to 208-520 px, and stores the value in localStorage. Drag it, arrow-key it, or "
     "double-click to reset. The analyser strip is 84 px, one and a half times the 56 px "
     "transport row below it. Visible columns — including the full stream address — are chosen from the Columns menu and stored per device. Theme follows the OpenCloud setting unless it is overridden in the switch.",
     "The player now takes 141 px of vertical space whether or not anything is playing, which "
     "is about three station rows."),
]


def main():
    for fn, title, body_fn, css, summary, pro, con in MOCKUPS:
        tuned = fn.startswith('11')
        html = page(title, body_fn(), extra_css=css,
                    extra_js=(m3.JS11 if tuned else ''),
                    toggle_html=(m3.TOGGLE11 if tuned else None))
        with open(os.path.join(OUT, fn), "w") as f:
            f.write(html)

    cards = []
    for i, (fn, title, _b, _c, summary, pro, con) in enumerate(MOCKUPS, 1):
        cards.append("""<article class="card">
  <div class="frame"><iframe src="%(fn)s" title="%(title)s preview" loading="lazy"
    tabindex="-1" scrolling="no"></iframe>
    <a class="hit" href="%(fn)s" target="_blank" rel="noopener"
      aria-label="Open %(title)s full size"></a></div>
  <div class="txt">
    <h2><span class="num mono">%(i)02d</span> %(title)s</h2>
    <p class="sum">%(summary)s</p>
    <dl><dt>Works because</dt><dd>%(pro)s</dd>
        <dt>Costs you</dt><dd>%(con)s</dd></dl>
    <a class="btn" href="%(fn)s" target="_blank" rel="noopener">Open full size</a>
  </div>
</article>""" % dict(fn=fn, title=title, i=i, summary=summary, pro=pro, con=con))

    index = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenCloud Radio — layout mockups</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{%(light)s}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){%(dark)s}}
:root[data-theme="dark"]{%(dark)s}
%(base)s
body{overflow:auto}
.page{max-width:1180px;margin:0 auto;padding:40px 24px 80px}
header.intro{max-width:64ch;margin-bottom:40px}
h1{margin:0 0 10px;font-size:30px;font-weight:700;letter-spacing:-.5px}
.lede{font-size:16px;color:var(--oc-role-on-surface-variant);margin:0 0 14px}
.meta{font-size:13px;color:var(--oc-role-on-surface-variant)}
.card{display:grid;grid-template-columns:minmax(0,480px) minmax(0,1fr);gap:28px;
  padding:26px 0;border-top:1px solid var(--oc-role-outline-variant);align-items:start}
.card:last-of-type{border-bottom:1px solid var(--oc-role-outline-variant)}
.frame{position:relative;border-radius:10px;overflow:hidden;
  border:1px solid var(--oc-role-outline-variant);background:var(--oc-role-surface-container-low);
  aspect-ratio:16/10}
.frame iframe{position:absolute;top:0;left:0;width:1440px;height:900px;border:0;
  transform:scale(.3333);transform-origin:0 0;pointer-events:none}
.hit{position:absolute;inset:0}
.hit:hover{box-shadow:inset 0 0 0 2px var(--oc-role-primary)}
.txt h2{margin:0 0 8px;font-size:19px;font-weight:600;display:flex;align-items:baseline;gap:10px}
.num{font-size:13px;color:var(--oc-role-on-surface-variant);font-weight:500}
.sum{margin:0 0 14px;max-width:56ch}
dl{display:grid;grid-template-columns:110px 1fr;gap:8px 14px;margin:0 0 18px;font-size:13.5px;
  max-width:62ch}
dt{color:var(--oc-role-on-surface-variant)}
dd{margin:0}
a.btn{text-decoration:none}
footer{margin-top:40px;font-size:13px;color:var(--oc-role-on-surface-variant);max-width:70ch}
@media (max-width:860px){.card{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="page">
<header class="intro">
  <h1>OpenCloud Radio — layouts</h1>
  <p class="lede">Ten directions for the internet radio player, and a tuned version of the first
    (11), the one it implements. Same content and the same OpenCloud colour roles in every one, so the
    only variable is the layout.</p>
  <p class="meta">Colours are the real light and dark role tokens from the OpenCloud design
    system and server theme, so these should sit correctly next to Files. Every mockup follows
    the system theme and carries a Light / Dark / System switch in the bottom right. Where a
    spectrum analyser appears it is drawn as a placeholder in 04 and 09, the two that reserve
    real space for it; 11 draws it.</p>
</header>
%(cards)s
<footer>
  <p>Previews are scaled to a third. Click one to open it at full size, then resize the window —
    every layout has a responsive story except 10, which is the narrow-width answer for whichever
    of the others is chosen.</p>
</footer>
</div>
%(toggle)s
<script>%(js)s</script>
</body>
</html>
""" % dict(light=LIGHT, dark=DARK, base=BASE_CSS, cards="\n".join(cards), toggle=TOGGLE,
           js=TOGGLE_JS)

    with open(os.path.join(OUT, "index.html"), "w") as f:
        f.write(index)

    print("wrote", len(MOCKUPS) + 1, "files to", OUT)


if __name__ == "__main__":
    main()
