# -*- coding: utf-8 -*-
from common import icon, badge, STATIONS, LISTS
from m2 import URLS

GEAR = ('<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
        '<path d="M12 8.6a3.4 3.4 0 100 6.8 3.4 3.4 0 000-6.8zm8.6 3.4c0 .5 0 1-.1 1.4l2 1.6-2 3.4-2.4-1a7.6 7.6 0 01-2.4 1.4L15.3 23h-4l-.4-2.6a7.6 7.6 0 01-2.4-1.4l-2.4 1-2-3.4 2-1.6a7.8 7.8 0 010-2.8l-2-1.6 2-3.4 2.4 1a7.6 7.6 0 012.4-1.4L11.3 1h4l.4 2.8a7.6 7.6 0 012.4 1.4l2.4-1 2 3.4-2 1.6c.1.5.1 1 .1 1.4z"/></svg>')

DEFAULT_W, MIN_W, MAX_W = 268, 208, 520
CTRL_H, EQ_H = 56, 84

# key, label, default visible. "station" is always shown and is not offered.
COLUMNS = [
    # key, label, visible by default, default width in px (None = takes the slack)
    ("index", "Position number", False, 46),
    ("logo", "Station logo", True, None),
    ("home", "Homepage link", True, None),
    ("network", "Network", True, 130),
    ("group", "Group", True, 110),
    ("bitrate", "Stream format", False, 124),
    ("url", "Stream address", False, 260),
    ("country", "Country", False, 130),
    ("language", "Language", False, 110),
    ("played", "Last played", True, 132),
    ("state", "State", True, 128),
]
# columns that are real table columns, in DOM order; "station" takes the slack
GRID = ["select", "index", "station", "network", "group", "bitrate", "url", "country",
        "language", "played", "state", "actions"]
WIDTHS = {"select": 40, "index": 46, "station": 300, "network": 130, "group": 110, "bitrate": 124, "url": 260,
          "country": 130, "language": 110, "played": 132, "state": 128}


# country, language, last played — the first two come from the imported playlist,
# the third only exists once a station has actually been played on this device.
EXTRA = {
    "Groove Salad": ("United States", "English", "Playing now"),
    "Drone Zone": ("United States", "English", "12 minutes ago"),
    "Deep Space One": ("United States", "English", "Yesterday"),
    "Radio Paradise Mellow": ("United States", "English", "3 days ago"),
    "FIP": ("France", "French", "—"),
    "KEXP 90.3": ("United States", "English", "—"),
    "NTS 1": ("United Kingdom", "English", "—"),
    "WFMU": ("United States", "English", "—"),
}


CSS11 = """
.wrap{display:flex;flex:1;min-height:0}
.rail2{width:%(dw)dpx;flex:none;background:var(--oc-role-surface-container-low);
  display:flex;flex-direction:column;min-height:0;min-width:0}
.rail2 h2{font-size:11.5px;font-weight:600;letter-spacing:.4px;margin:16px 16px 8px;
  color:var(--oc-role-on-surface-variant)}
.rail2 a{display:flex;align-items:center;gap:10px;padding:8px 14px;margin:0 8px 2px;border-radius:6px;
  text-decoration:none;color:var(--oc-role-on-surface)}
.rail2 a:hover{background:var(--oc-role-surface-container-high)}
.rail2 a.on{background:var(--oc-role-secondary-container);color:var(--oc-role-on-secondary-container);font-weight:600}
.rail2 a .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rail2 a .c{font-size:12px;opacity:.7}
.split{flex:none;width:9px;cursor:col-resize;position:relative;background:none;padding:0;
  border:0;border-left:1px solid var(--oc-role-outline-variant);touch-action:none}
.split::after{content:"";position:absolute;inset:0 3px;border-radius:2px}
.split:hover::after,.split.drag::after{background:var(--oc-role-primary);opacity:.55}
.split:focus-visible{outline:2px solid var(--oc-role-primary);outline-offset:-2px}
body.resizing{cursor:col-resize;user-select:none}
.main{flex:1;min-width:0;display:flex;flex-direction:column;
  border-left:1px solid var(--oc-role-outline-variant);margin-left:-1px}
.hd{display:flex;align-items:center;gap:12px;padding:18px 24px 14px}
.hd h1{font-size:20px;font-weight:600;margin:0}
.hd .sub{font-size:12.5px;color:var(--oc-role-on-surface-variant)}

.tbl{width:100%%;border-collapse:collapse;table-layout:fixed}
.tbl th{position:relative}
.tbl td,.tbl th{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.grip{position:absolute;top:0;right:-4px;width:9px;height:100%%;cursor:col-resize;
  z-index:2;touch-action:none;background:none;border:0;padding:0}
.grip::after{content:"";position:absolute;top:2px;bottom:8px;left:4px;width:1px;
  background:var(--oc-role-outline-variant)}
.grip:hover::after,.grip.drag::after{background:var(--oc-role-primary);width:2px;bottom:2px}
.grip:focus-visible{outline:2px solid var(--oc-role-primary);outline-offset:-2px}
.cellflex .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tbl th{font-size:11.5px;font-weight:600;text-align:left;padding:0 12px 8px;
  color:var(--oc-role-on-surface-variant);border-bottom:1px solid var(--oc-role-outline-variant);
  white-space:nowrap}
.tbl td{padding:9px 12px;border-bottom:1px solid var(--oc-role-outline-variant)}
.tbl tr:hover td{background:var(--oc-role-surface-container)}
.tbl tr.on td{background:var(--oc-role-surface-container-high)}
.tbl .nm{font-weight:500}
.tbl .sub{font-size:12px;color:var(--oc-role-on-surface-variant)}
.cellflex{display:flex;align-items:center;gap:10px}
.cellflex .logo{width:26px;height:26px;font-size:11px;border-radius:5px}
.hl{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:5px;
  color:var(--oc-role-on-surface-variant);text-decoration:none;opacity:.5}
tr:hover .hl,.hl:focus-visible{opacity:1}\n.hl:focus-visible{outline-offset:0}
.hl:hover{background:var(--oc-role-surface-container-highest);color:var(--oc-role-on-surface)}
.c-index{width:34px;text-align:right}
.c-url{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
  color:var(--oc-role-on-surface-variant);max-width:300px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
%(hide)s

.prefwrap{position:relative}
.pref{position:absolute;right:0;top:calc(100%% + 6px);z-index:20;width:262px;padding:8px;
  border-radius:10px;background:var(--oc-role-surface-container-low);
  border:1px solid var(--oc-role-outline-variant);box-shadow:var(--shadow)}
.pref[hidden]{display:none}
.pref h3{margin:6px 8px 4px;font-size:12px;font-weight:600;
  color:var(--oc-role-on-surface-variant)}
.pref label{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:6px;font-size:13.5px}
.pref label:hover{background:var(--oc-role-surface-container-high)}
.pref input{accent-color:var(--oc-role-primary);width:15px;height:15px}
.pref .fixed,.sect .fixed{opacity:.55}
.pref .kid,.sect .kid{padding-left:26px}
.pref .foot{padding:8px;margin-top:4px;font-size:11.5px;
  border-top:1px solid var(--oc-role-outline-variant);color:var(--oc-role-on-surface-variant);
  display:flex;align-items:center;gap:8px}
.pref .foot button{margin-left:auto;text-decoration:underline}

.ovl{position:fixed;inset:0;z-index:40;background:color-mix(in srgb,var(--oc-role-scrim) 45%%,transparent);
  display:grid;place-items:center;padding:24px}
.ovl[hidden]{display:none}
.dlg{width:560px;max-width:100%%;max-height:86vh;display:flex;flex-direction:column;
  border-radius:14px;background:var(--oc-role-surface-container-low);
  border:1px solid var(--oc-role-outline-variant);box-shadow:var(--shadow)}
.dlg header{display:flex;align-items:center;gap:10px;padding:16px 20px;
  border-bottom:1px solid var(--oc-role-outline-variant)}
.dlg header h2{margin:0;font-size:17px;font-weight:600;flex:1}
.dlg .bd{overflow:auto;padding:4px 20px 18px}
.dlg footer{display:flex;gap:8px;padding:14px 20px;
  border-top:1px solid var(--oc-role-outline-variant)}
.sect{padding:16px 0;border-bottom:1px solid var(--oc-role-outline-variant)}
.sect:last-child{border-bottom:0}
.sect h3{margin:0 0 10px;font-size:12.5px;font-weight:600;
  color:var(--oc-role-on-surface-variant)}
.sect label{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13.5px}
.sect label input[type=checkbox]{accent-color:var(--oc-role-primary);width:15px;height:15px}
.sect .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 24px}
.sect .fld{display:flex;align-items:center;gap:12px;padding:6px 0;font-size:13.5px}
.sect .fld span{flex:1}
.sect .fld select,.sect .fld input[type=text]{padding:5px 8px;border-radius:6px;min-width:160px;
  background:var(--oc-role-surface-container);border:1px solid var(--oc-role-outline-variant)}
.sect .exp{font-size:12px;color:var(--oc-role-on-surface-variant);margin:2px 0 0 25px}
.seg{display:flex;gap:2px;padding:2px;border-radius:8px;
  border:1px solid var(--oc-role-outline-variant)}
.seg button{padding:4px 12px;border-radius:6px;font-size:13px}
.seg button[aria-pressed=true]{background:var(--oc-role-secondary-container);
  color:var(--oc-role-on-secondary-container);font-weight:600}

.selbar{display:flex;align-items:center;gap:8px;margin:0 24px 10px;padding:8px 12px;
  border-radius:8px;background:var(--oc-role-secondary-container);
  color:var(--oc-role-on-secondary-container);font-size:13px}
.selbar[hidden]{display:none}
.selbar .btn{background:none;border-color:currentColor}
.c-select{width:40px}
.c-select input{accent-color:var(--oc-role-primary);width:15px;height:15px}

.player{flex:none;border-top:1px solid var(--oc-role-outline-variant);
  background:var(--oc-role-surface-container)}
.scope{height:%(eqh)dpx;display:flex;align-items:flex-end;gap:2px;padding:12px 18px 0;
  border-bottom:1px solid var(--oc-role-outline-variant);position:relative}
.scope i{flex:1;height:100%%;border-radius:1px 1px 0 0;transform-origin:bottom;
  transform:scaleY(.04);
  background:linear-gradient(to top,var(--oc-role-primary),var(--oc-role-tertiary));
  opacity:.55}
.scope.idle i{transform:scaleY(.03);opacity:.35}
.ctl{height:%(ch)dpx;display:flex;align-items:center;gap:14px;padding:0 18px}
.ctl .np{flex:1;min-width:0}
.ctl .np b{font-weight:600}

""" % dict(dw=DEFAULT_W, eqh=EQ_H, ch=CTRL_H,
           hide="\n".join(".tbl.h-%s .c-%s{display:none}" % (k, k) for k, _l, _d, _w in COLUMNS))

TOGGLE11 = """
<div class="tt" role="group" aria-label="Theme">
  <button data-mode="light">Light</button>
  <button data-mode="dark">Dark</button>
  <button data-mode="system" aria-pressed="true">System</button>
</div>
"""

JS11 = """
(function(){
  var KEY_W='radio.listWidth', KEY_T='radio.theme', KEY_C='radio.columns';
  var root=document.documentElement;

  /* ---- theme: app mode over the OpenCloud setting ------------------------ */
  var mode='system';
  try{var m=localStorage.getItem(KEY_T); if(m)mode=m;}catch(e){}
  /* The theme the OpenCloud shell reports. The real app reads this from the
     runtime theme store; 'auto' there means the shell itself follows the OS. */
  var host='dark';

  function resolve(){
    var t = mode==='system' ? host : mode;
    if(t==='auto'){
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    root.setAttribute('data-theme', t);
  }
  /* both switchers — the corner one and the one in preferences — are views of
     the same value, so every control is painted from state, never toggled. */
  function paint(){
    document.querySelectorAll('[data-mode]').forEach(function(b){
      b.setAttribute('aria-pressed', String(b.dataset.mode===mode));});
    resolve();
  }
  document.querySelectorAll('[data-mode]').forEach(function(b){
    b.addEventListener('click',function(){
      mode=b.dataset.mode;
      try{ mode==='system' ? localStorage.removeItem(KEY_T)
                           : localStorage.setItem(KEY_T,mode); }catch(e){}
      paint();});});
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',resolve);
  paint();

  /* ---- columns ----------------------------------------------------------- */
  var tbl=document.getElementById('tbl'), panel=document.getElementById('pref'),
      btn=document.getElementById('prefbtn');
  var defaults=%(defaults)s, cols={};
  Object.keys(defaults).forEach(function(k){cols[k]=defaults[k];});
  try{
    var raw=localStorage.getItem(KEY_C);
    if(raw){var p=JSON.parse(raw);
      Object.keys(cols).forEach(function(k){if(typeof p[k]==='boolean')cols[k]=p[k];});}
  }catch(e){}
  function applyCols(save){
    Object.keys(cols).forEach(function(k){tbl.classList.toggle('h-'+k, !cols[k]);});
    /* every checkbox bound to a column, in the menu and in the dialog alike */
    document.querySelectorAll('input[data-col]').forEach(function(i){
      i.checked=cols[i.dataset.col];});
    if(save){try{localStorage.setItem(KEY_C,JSON.stringify(cols));}catch(e){}}
    if(colEls)applyWidths(false);   /* undefined until the widths block runs */
  }
  document.querySelectorAll('input[data-col]').forEach(function(i){
    i.addEventListener('change',function(){cols[i.dataset.col]=i.checked; applyCols(true);});});
  document.getElementById('prefreset').addEventListener('click',function(){
    Object.keys(defaults).forEach(function(k){cols[k]=defaults[k];});
    cw={}; applyWidths(true); applyCols(true);});
  btn.addEventListener('click',function(e){
    e.stopPropagation();
    var open=panel.hasAttribute('hidden');
    panel.toggleAttribute('hidden'); btn.setAttribute('aria-expanded',String(open));});
  document.addEventListener('click',function(e){
    if(!panel.hidden && !panel.contains(e.target)){
      panel.hidden=true; btn.setAttribute('aria-expanded','false');}});
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape' && !panel.hidden){panel.hidden=true;btn.focus();}});
  applyCols(false);

  /* ---- bulk selection ---------------------------------------------------- */
  var selall=document.getElementById('selall'), selbar=document.getElementById('selbar'),
      selcount=document.getElementById('selcount');
  function rowBoxes(){return [].slice.call(document.querySelectorAll('.rowsel'));}
  function syncSel(){
    var b=rowBoxes(), n=b.filter(function(x){return x.checked;}).length;
    selbar.hidden = n===0;
    selcount.textContent = n===1 ? '1 station selected' : n+' stations selected';
    selall.checked = n>0 && n===b.length;
    selall.indeterminate = n>0 && n<b.length;
  }
  selall.addEventListener('change',function(){
    rowBoxes().forEach(function(x){x.checked=selall.checked;}); syncSel();});
  rowBoxes().forEach(function(x){x.addEventListener('change',syncSel);});
  document.getElementById('selclear').addEventListener('click',function(){
    rowBoxes().forEach(function(x){x.checked=false;}); syncSel();});
  syncSel();

  /* ---- column widths ----------------------------------------------------- */
  var KEY_CW='radio.columnWidths', DEFW=%(defw)s, MINC=64;
  var cw={};
  try{var rw=localStorage.getItem(KEY_CW); if(rw)cw=JSON.parse(rw)||{};}catch(e){}
  var GRID=%(grid)s, cg=document.getElementById('cg');
  var colEls=true;   /* the colgroup exists; see the guard in applyCols */
  /* A hidden cell is display:none, which REMOVES it from its row — so a colgroup
     that still carries the hidden column shifts every later cell into the wrong
     width slot. The colgroup is therefore rebuilt from the visible columns only. */
  function visible(g){
    if(g==='station'||g==='actions')return true;
    return !(g in cols) || cols[g];
  }
  function applyWidths(save){
    cg.innerHTML = GRID.filter(visible).map(function(g){
      if(g==='actions')return '<col>';               /* trailing slack, as in Files */
      return '<col style="width:'+(cw[g]||DEFW[g]||110)+'px">';
    }).join('');
    if(save){try{localStorage.setItem(KEY_CW,JSON.stringify(cw));}catch(e){}}
  }
  function setW(g,v,save){cw[g]=Math.max(MINC,Math.round(v)); applyWidths(save);}
  document.querySelectorAll('.grip').forEach(function(gp){
    var g=gp.dataset.grip, th=gp.parentNode, x0=0, w0=0, on=false;
    gp.addEventListener('pointerdown',function(e){
      on=true; x0=e.clientX; w0=th.getBoundingClientRect().width;
      gp.setPointerCapture(e.pointerId); gp.classList.add('drag');
      document.body.classList.add('resizing'); e.preventDefault();});
    gp.addEventListener('pointermove',function(e){
      if(on)setW(g,w0+(e.clientX-x0),false);});
    function stop(){
      if(!on)return; on=false; gp.classList.remove('drag');
      document.body.classList.remove('resizing'); applyWidths(true);}
    gp.addEventListener('pointerup',stop);
    gp.addEventListener('pointercancel',stop);
    gp.addEventListener('dblclick',function(){delete cw[g]; applyWidths(true);});
    gp.addEventListener('keydown',function(e){
      var w=th.getBoundingClientRect().width, step=e.shiftKey?32:8;
      if(e.key==='ArrowLeft'){setW(g,w-step,true);e.preventDefault();}
      if(e.key==='ArrowRight'){setW(g,w+step,true);e.preventDefault();}
      if(e.key==='Home'){delete cw[g]; applyWidths(true); e.preventDefault();}});
  });

  applyWidths(false);

  /* ---- preferences dialog ------------------------------------------------ */
  var ovl=document.getElementById('ovl'), prefsbtn=document.getElementById('prefsbtn');
  var KEY_P='radio.playback', pb={};
  try{var rp=localStorage.getItem(KEY_P); if(rp)pb=JSON.parse(rp);}catch(e){}
  function applyPb(save){
    document.querySelectorAll('[data-pb]').forEach(function(el){
      var k=el.dataset.pb;
      if(!(k in pb)){pb[k]= el.type==='checkbox' ? el.checked : el.value; return;}
      if(el.type==='checkbox')el.checked=pb[k]; else el.value=pb[k];
    });
    if(save){try{localStorage.setItem(KEY_P,JSON.stringify(pb));}catch(e){}}
  }
  document.querySelectorAll('[data-pb]').forEach(function(el){
    el.addEventListener('change',function(){
      pb[el.dataset.pb]= el.type==='checkbox' ? el.checked : el.value;
      applyPb(true);
      if(el.dataset.pb==='analyser')setScope();
    });});
  applyPb(false);

  function openDlg(){
    ovl.hidden=false;
    panel.hidden=true; btn.setAttribute('aria-expanded','false');
    ovl.querySelector('#dlgx').focus();
  }
  function closeDlg(){ovl.hidden=true; prefsbtn.focus();}
  prefsbtn.addEventListener('click',openDlg);
  document.getElementById('dlgx').addEventListener('click',closeDlg);
  document.getElementById('dlgdone').addEventListener('click',closeDlg);
  ovl.addEventListener('click',function(e){if(e.target===ovl)closeDlg();});
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape' && !ovl.hidden)closeDlg();});
  document.getElementById('dlgreset').addEventListener('click',function(){
    Object.keys(defaults).forEach(function(k){cols[k]=defaults[k];});
    cw={}; applyWidths(true); applyCols(true);
    mode='system'; try{localStorage.removeItem(KEY_T);}catch(e){} paint();
  });

  /* ---- resizable list ---------------------------------------------------- */
  var rail=document.getElementById('rail'), sp=document.getElementById('split');
  var MIN=%(min)d, MAX=%(max)d, DEF=%(def)d;
  function clamp(v){
    var room=Math.max(MIN, Math.round(window.innerWidth*0.4));
    return Math.max(MIN, Math.min(Math.min(MAX,room), Math.round(v)));
  }
  function applyW(v,save){
    rail.style.width=v+'px'; sp.setAttribute('aria-valuenow',v);
    if(save){try{localStorage.setItem(KEY_W,String(v));}catch(e){}}
  }
  var start=DEF;
  try{var s=parseInt(localStorage.getItem(KEY_W),10); if(!isNaN(s))start=s;}catch(e){}
  applyW(clamp(start),false);
  window.addEventListener('resize',function(){applyW(clamp(parseInt(rail.style.width,10)),false);});

  var dragging=false;
  sp.addEventListener('pointerdown',function(e){
    dragging=true; sp.setPointerCapture(e.pointerId);
    sp.classList.add('drag'); document.body.classList.add('resizing');});
  sp.addEventListener('pointermove',function(e){
    if(dragging)applyW(clamp(e.clientX-rail.getBoundingClientRect().left),false);});
  function end(){
    if(!dragging)return; dragging=false;
    sp.classList.remove('drag'); document.body.classList.remove('resizing');
    applyW(parseInt(rail.style.width,10),true);}
  sp.addEventListener('pointerup',end);
  sp.addEventListener('pointercancel',end);
  sp.addEventListener('dblclick',function(){applyW(DEF,true);});
  sp.addEventListener('keydown',function(e){
    var w=parseInt(rail.style.width,10), step=e.shiftKey?40:8;
    if(e.key==='ArrowLeft'){applyW(clamp(w-step),true);e.preventDefault();}
    if(e.key==='ArrowRight'){applyW(clamp(w+step),true);e.preventDefault();}
    if(e.key==='Home'){applyW(DEF,true);e.preventDefault();}});

  /* ---- spectrum ----------------------------------------------------------
     Stand-in for an AnalyserNode: same shape (log-spaced bins, high end rolling
     off, peaks decaying) so the layout is judged against something realistic.
     The real one reads getByteFrequencyData into these same elements.        */
  var scope=document.getElementById('scope');
  var bars=[].slice.call(scope.children), N=bars.length;
  /* three states: analysed (Web Audio available), indicative (station blocks
     Web Audio but is playing), idle (nothing playing). The middle one is what
     the mockup shows — motion that is honest about being a stand-in. */
  var playing=true;
  function setScope(){
    var on = playing && pb.analyser!==false;
    scope.classList.toggle('idle', !on);
    if(!on){for(var i=0;i<N;i++){level[i]=0.03;} paintBars();}
  }
  var still=window.matchMedia('(prefers-reduced-motion: reduce)');
  var level=new Float32Array(N), peak=new Float32Array(N), phase=0;
  var MID=(N-1)/2, EDGE=2;   /* at most two immobile bars at each end */
  function shape(i){
    if(i<EDGE || i>=N-EDGE) return 0;
    var d=Math.abs(i-MID)/MID;
    return 0.22+0.78*Math.pow(1-d,1.25);
  }
  for(var i=0;i<N;i++){level[i]=peak[i]=Math.max(0.05,shape(i));}
  function paintBars(){
    for(var i=0;i<N;i++){
      bars[i].style.transform='scaleY('+Math.max(0.03,level[i]).toFixed(3)+')';}
  }
  function tick(){
    phase+=0.045;
    if(scope.classList.contains('idle')){requestAnimationFrame(tick);return;}
    for(var i=0;i<N;i++){
      var tilt=shape(i);            /* loudest in the middle, easing to both ends */
      if(tilt===0){level[i]=0.05; continue;}
      var wob=0.55+0.45*Math.sin(phase*(0.7+i*0.035)+i*0.6);
      var target=tilt*(0.35+0.65*wob)*(0.75+0.25*Math.random());
      level[i]+=(target-level[i])*(target>level[i]?0.55:0.16);
      peak[i]=Math.max(level[i],peak[i]-0.006);
    }
    paintBars();
    requestAnimationFrame(tick);
  }
  setScope();
  if(still.matches){paintBars();}else{requestAnimationFrame(tick);}

  /* the transport button drives the scope, so the idle state is visible here */
  var toggleBtn=document.querySelector('.ctl .play');
  toggleBtn.addEventListener('click',function(){
    playing=!playing;
    toggleBtn.innerHTML=playing
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6.5 6.5h11v11h-11z"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6L19 12z"/></svg>';
    toggleBtn.setAttribute('aria-label', playing?'Stop':'Play');
    setScope();
  });
})();
""" % dict(min=MIN_W, max=MAX_W,
           grid="[" + ",".join('"%s"' % g for g in GRID) + "]",
           defw="{" + ",".join("%s:%d" % (k, v) for k, v in sorted(WIDTHS.items())) + "}",
           defaults="{" + ",".join("%s:%s" % (k, "true" if d else "false")
                                   for k, _l, d, _w in COLUMNS) + "}",
           **{'def': DEFAULT_W})


def body11():
    rows = []
    for i, (((n, net, det, grp, st, ini), u)) in enumerate(zip(STATIONS[:8], URLS), 1):
        url = ("http://" if st == "http" else "https://") + u
        country, lang, played = EXTRA[n]
        rows.append("""<tr class="%s">
  <td class="c-select"><input type="checkbox" class="rowsel" aria-label="Select %s"></td>
  <td class="mono sub c-index">%d</td>
  <td><div class="cellflex"><button class="play %s" aria-label="Play %s">%s</button>
    <span class="logo c-logo">%s</span>
    <span class="nm">%s</span>
    <a class="hl c-home" href="#" aria-label="%s homepage" title="Open homepage">%s</a></div></td>
  <td class="sub c-network">%s</td>
  <td class="sub c-group">%s</td>
  <td class="sub mono c-bitrate">%s</td>
  <td class="c-url" title="%s">%s</td>
  <td class="sub c-country">%s</td>
  <td class="sub c-language">%s</td>
  <td class="sub c-played">%s</td>
  <td class="c-state">%s</td>
  <td style="text-align:right">%s</td></tr>""" % (
            "on" if st == "live" else "", n, i,
            "" if st == "live" else "ghost", n,
            icon("play" if st != "live" else "stop", 15), ini, n, n, icon("link", 13),
            net, grp, det, url, url, country, lang, played, badge(st),
            '<button class="btn q" aria-label="More">%s</button>' % icon("more", 16)))
    lists = "".join(
        '<a href="#" class="%s">%s<span class="n">%s</span><span class="c mono">%d</span></a>'
        % ("on" if on else "", icon("list", 17), nm, ct) for nm, ct, on in LISTS)
    bars = "<i></i>" * 48
    def toggles():
        out = []
        for k, label, d, _w in COLUMNS:
            if k == "logo":                      # Station sits here in the table
                out.append('<label class="fixed"><input type="checkbox" checked disabled>'
                           ' Station</label>')
            cls = ' class="kid"' if k in ("logo", "home") else ""
            out.append('<label%s><input type="checkbox" data-col="%s"%s> %s</label>'
                       % (cls, k, " checked" if d else "", label))
        return "".join(out)
    checks = toggles()
    dchecks = toggles()
    colgroup = "".join('<col data-gc="%s">' % g for g in GRID)
    labels = dict((k, l) for k, l, _d, _w in COLUMNS)
    labels["station"] = "Station"
    grips = dict(("g_%s" % g,
                  '<button class="grip" data-grip="%s" role="separator" aria-orientation="vertical"'
                  ' aria-label="Resize %s column"></button>' % (g, labels.get(g, g)))
                 for g in GRID)
    heads = {"t_network": "Network", "t_group": "Group", "t_bitrate": "Stream",
             "t_url": "Stream address", "t_country": "Country",
             "t_language": "Language", "t_played": "Last played"}
    hide_classes = " ".join("h-%s" % k for k, _l, d, _w in COLUMNS if not d)
    return """
<div class="wrap">
  <aside class="rail2" id="rail">
    <h2>Station lists</h2>
    %(lists)s
    <a href="#" style="margin-top:4px">%(plus)s<span class="n">New list</span></a>
    <div style="flex:1"></div>
    <div style="padding:12px 16px;font-size:12px;color:var(--oc-role-on-surface-variant)">
      Stored in <b>Radio/</b> in your personal space.</div>
  </aside>
  <div class="split" id="split" role="separator" aria-orientation="vertical" tabindex="0"
    aria-label="Resize station list" aria-valuemin="%(min)d" aria-valuemax="%(max)d"
    title="Drag to resize · double-click to reset"></div>
  <section class="main">
    <div class="hd">
      <div style="flex:1;min-width:0">
        <h1>Favourites</h1>
        <div class="sub">12 stations · Favourites.m3u8</div>
      </div>
      <div class="prefwrap">
        <button class="btn" id="prefbtn" aria-expanded="false" aria-controls="pref">%(grid)s Columns</button>
        <div class="pref" id="pref" hidden>
          <h3>Show these columns</h3>
          %(checks)s
          <div class="foot">Saved on this device
            <button id="prefreset">Reset</button></div>
        </div>
      </div>
      <button class="btn" id="prefsbtn" aria-haspopup="dialog">%(gear)s</button>
      <button class="btn">%(imp)s Import</button>
      <button class="btn pri">%(plus)s Add station</button>
    </div>
    <div class="selbar" id="selbar" hidden>
      <span id="selcount">0 selected</span>
      <span style="flex:1"></span>
      <button class="btn">Move to list…</button>
      <button class="btn">Copy addresses</button>
      <button class="btn">%(trash)s Remove</button>
      <button class="btn q" id="selclear">Clear</button>
    </div>
    <div class="scroll" style="flex:1;padding:0 12px">
      <table class="tbl %(hide)s" id="tbl">
        <colgroup id="cg">%(cols)s</colgroup>
        <thead><tr>
          <th class="c-select"><input type="checkbox" id="selall" aria-label="Select all stations"></th>
          <th class="c-index">#%(g_index)s</th><th>Station%(g_station)s</th>
          <th class="c-network">%(t_network)s%(g_network)s</th><th class="c-group">%(t_group)s%(g_group)s</th>
          <th class="c-bitrate">%(t_bitrate)s%(g_bitrate)s</th><th class="c-url">%(t_url)s%(g_url)s</th>
          <th class="c-country">%(t_country)s%(g_country)s</th><th class="c-language">%(t_language)s%(g_language)s</th>
          <th class="c-played">%(t_played)s%(g_played)s</th>
          <th class="c-state">State%(g_state)s</th><th class="c-actions"></th></tr></thead>
        <tbody>%(rows)s</tbody>
      </table>
    </div>
    <div class="player">
      <div class="scope" id="scope" aria-hidden="true">%(bars)s</div>
      <div class="ctl">
        <button class="play" aria-label="Stop">%(stop)s</button>
        <div class="logo">GS</div>
        <div class="np"><b>Groove Salad</b> <span class="dim">· SomaFM</span>
          <div class="sub dim" style="font-size:12px">Bluetech — Peace Officer &nbsp;·&nbsp; 128 kbps AAC</div></div>
        <div class="vol">%(vol)s<input type="range" min="0" max="100" value="72" aria-label="Volume"></div>
      </div>
    </div>
  </section>
</div>

<div class="ovl" id="ovl" hidden>
  <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlgt">
    <header><h2 id="dlgt">Radio preferences</h2>
      <button class="btn q" id="dlgx" aria-label="Close">%(close)s</button></header>
    <div class="bd">
      <div class="sect"><h3>Station list columns</h3>
        <div class="grid">
          <label><input type="checkbox" checked disabled> Station</label>
          %(dchecks)s
        </div>
        <p class="exp">The same choices as the Columns menu above the list. Drag the right edge of a column heading to change its width, or double-click the edge to reset it.</p>
      </div>
      <div class="sect"><h3>Playback</h3>
        <label><input type="checkbox" data-pb="resume" checked> Start the last station when I open Radio</label>
        <div class="fld"><span>Reconnect attempts before giving up</span>
          <select data-pb="retries"><option>3</option><option selected>5</option><option>10</option></select></div>
        <label><input type="checkbox" data-pb="meta"> Show track titles where the station provides them</label>
        <p class="exp">Most stations do not. Turning this on adds one request per station.</p>
      </div>
      <div class="sect"><h3>Spectrum</h3>
        <label><input type="checkbox" data-pb="analyser" checked> Show the spectrum while a station plays</label>
        <p class="exp">Stations that allow it are analysed directly. The rest show
          indicative movement while playing, and a flat line when stopped.</p>
      </div>
      <div class="sect"><h3>Appearance</h3>
        <div class="fld"><span>Theme</span>
          <div class="seg" id="dlgtheme">
            <button data-mode="light">Light</button>
            <button data-mode="dark">Dark</button>
            <button data-mode="system">System</button></div></div>
        <p class="exp">System follows your OpenCloud theme.</p>
        <label><input type="checkbox" data-pb="logos" checked> Show station logos</label>
      </div>
      <div class="sect"><h3>Settings profiles</h3>
        <div class="fld"><span>Load settings saved earlier</span>
          <select aria-label="Saved profiles"><option>laptop</option><option>desktop</option>
            <option>studio pc</option></select></div>
        <div class="fld"><span>Save these settings as</span>
          <input type="text" placeholder="laptop" aria-label="Profile name"></div>
        <label><input type="checkbox" data-pb="profgeom" checked> Include column widths and list width</label>
        <p class="exp">Profiles are files in <b>Radio/Settings/</b>. Nothing is applied until you
          load one, so a profile made on another machine never overwrites this one by itself.</p>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn">Load profile</button>
          <button class="btn">Save profile</button></div>
      </div>
      <div class="sect"><h3>Storage</h3>
        <div class="fld"><span>Folder holding your station lists</span>
          <input type="text" value="Radio"></div>
        <p class="exp">In your personal space. Moving it does not move the files.</p>
      </div>
    </div>
    <footer><button class="btn" id="dlgreset">Reset to defaults</button>
      <span style="flex:1"></span>
      <button class="btn pri" id="dlgdone">Done</button></footer>
  </div>
</div>""" % dict(dict(list(grips.items()) + list(heads.items())),
                 lists=lists, rows="".join(rows), bars=bars, checks=checks, hide=hide_classes,
                 cols=colgroup, dchecks=dchecks, plus=icon("plus", 17), imp=icon("import", 16),
                 grid=icon("grid", 15), gear=GEAR, trash=icon("trash", 14), close=('<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" '
                        'aria-hidden="true"><path d="M6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12 19 17.6'
                        ' 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/></svg>'),
                 stop=icon("stop", 16), vol=icon("vol", 18), min=MIN_W, max=MAX_W)
