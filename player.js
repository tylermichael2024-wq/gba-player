// Shared emulator page for every system. Each page sets window.PLAYER before loading this:
//   id      storage prefix ('gba', 'ds')     core    EmulatorJS core name
//   title   page heading                      system  description shown on the setup screen
//   accept  file types for the picker         aspect  width / height of the game picture
//   smooth  false for 3D systems, where the 2D pixel-art upscaling filter would look wrong
//   extraHelp  optional extra line for the setup screen
//   threads true for cores that need multi-threading (PSP); needs coi-sw.js
const C = window.PLAYER;

// ---- page markup ----
document.body.insertAdjacentHTML('afterbegin', `
<div id="setup">
  <div id="drop">
    <h1>${C.title}</h1>
    <p>Load a ${C.system} game you own (${(C.showTypes || C.accept).split(',').map(e => `<code>${e}</code>`).join(', ')}).
       You only do this once. The file stays in your own browser and is never uploaded.
       After that, opening this page starts your game.</p>
    <p style="font-size:13px">During play: <b>P</b> pauses (save/load state, resolution, change game) · <b>F1</b> switches 5x fast forward on and off.${C.extraHelp || ''}</p>
    <label class="btn">Choose ROM file<input id="file" type="file" accept="${C.accept}"></label>
    <div id="status"></div>
    <a class="home" href="./">← Back to system select</a>
  </div>
</div>
<div id="ff">▶▶ 5x</div>
<button id="forget" title="Remove the remembered ROM from this browser">Change ROM</button>
<div id="menu">
  <div class="box">
    <h2>Paused</h2>
    <h3>Save state</h3>
    <div class="slots" id="save-slots"></div>
    <h3>Load state</h3>
    <div class="slots" id="load-slots"></div>
    <h3>Frame rate</h3>
    <div class="slots" id="fps-opts"></div>
    <h3>Resolution</h3>
    <div class="slots" id="res-opts"></div>
    <div id="menu-msg"></div>
    <div class="row">
      <button id="resume">Resume</button>
      <button id="change-rom" class="secondary">Load different ROM</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button id="home" class="secondary">System select</button>
    </div>
    <input id="file2" type="file" accept="${C.accept}">
    <div class="hint">Press P or Esc to resume</div>
  </div>
</div>
<div id="game-wrap"><div id="game"></div></div>`);

// ---- tiny IndexedDB key/value store for the ROM and save states ----
const DB = C.id + '-player', STORE = 'roms', KEY = 'current';
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      for (const name of [STORE, 'states'])
        if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbOp(mode, fn, store = STORE) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
const getRom = () => dbOp('readonly', s => s.get(KEY)).catch(() => null);
const putRom = v => dbOp('readwrite', s => s.put(v, KEY));
const delRom = () => dbOp('readwrite', s => s.delete(KEY));

const $ = id => document.getElementById(id);
const status = t => $('status').textContent = t;

// ---- launch the emulator (EmulatorJS) ----
function start(rom) {
  $('setup').style.display = 'none';
  $('game-wrap').style.display = 'block';
  $('forget').style.display = 'block';
  window.EJS_player = '#game';
  window.EJS_core = C.core;
  // Save files are keyed by game name, so keep it stable for the same ROM.
  window.EJS_gameName = rom.name.replace(/\.[^.]+$/, '');
  window.EJS_gameUrl = URL.createObjectURL(new Blob([rom.data]));
  window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
  window.EJS_startOnLoaded = true;
  window.EJS_color = '#3fb37f';
  if (C.threads) window.EJS_threads = true;   // PSP: multi-threaded core
  window.EJS_onGameStart = () => { applySpeed(); applyResolution(); };
  const s = document.createElement('script');
  s.src = window.EJS_pathtodata + 'loader.js';
  document.body.appendChild(s);
}

async function useFile(file) {
  if (!file) return;
  status('Loading…');
  const rom = { name: file.name, data: await file.arrayBuffer() };
  try { await putRom(rom); } catch (e) { console.warn('Could not remember ROM', e); }
  start(rom);
}

$('file').addEventListener('change', e => useFile(e.target.files[0]));
const drop = $('drop');
['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => useFile(e.dataTransfer.files[0]));

// ---- F1: toggle 5x fast forward ----
const FF_SPEED = 5;
let fastForward = false;
window.addEventListener('keydown', e => {
  if (e.key !== 'F1') return;
  e.preventDefault();           // stop the browser's help page
  e.stopPropagation();
  if (e.repeat || menuOpen) return;
  const gm = window.EJS_emulator && window.EJS_emulator.gameManager;
  if (!gm) return;              // game not running yet
  fastForward = !fastForward;
  applySpeed();
}, true);

// ---- frame rate and output resolution ----
const FPS_OPTIONS = [60];
// Target height of the game picture in real pixels (0 = draw at screen size).
const RES_HEIGHTS = [0, 1080, 2160];
const RES_NAMES = { 0: 'Default', 1080: '1080p', 2160: '4K' };
const resLabel = h => h ? `${Math.round(h * C.aspect)} × ${h}` : 'Screen size';
const loadSetting = (k, d) => { try { const v = localStorage.getItem(C.id + '-' + k); return v === null ? d : Number(v); } catch (_) { return d; } };
const saveSetting = (k, v) => { try { localStorage.setItem(C.id + '-' + k, v); } catch (_) {} };
let fps = loadSetting('fps', 60);
let res = loadSetting('res', 0);
if (!FPS_OPTIONS.includes(fps)) fps = 60;
if (!RES_HEIGHTS.includes(res)) res = 0;

function applySpeed() {
  const gm = window.EJS_emulator && window.EJS_emulator.gameManager;
  if (!gm) return;
  const ratio = (fps / 60) * (fastForward ? FF_SPEED : 1);
  gm.toggleFastForward(0);
  if (ratio > 1) {
    gm.setFastForwardRatio(ratio);
    setTimeout(() => gm.toggleFastForward(1), 10);
  }
  $('ff').textContent = `▶▶ ${ratio}x`;
  $('ff').style.display = ratio > 1 ? 'block' : 'none';
}
// The emulator draws at the canvas's layout size, so for 1080p/4K we lay the canvas
// out at the target pixel size and shrink it visually with a CSS transform to fit.
function layoutCanvas() {
  const emu = window.EJS_emulator;
  const c = emu && emu.canvas;
  if (!c) return;
  if (!res) {
    Object.assign(c.style, { width: '', height: '', transform: '', transformOrigin: '' });
  } else {
    const box = c.parentElement.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const boxAspect = box.width / box.height, gameW = Math.round(res * C.aspect);
    const W = boxAspect >= C.aspect ? Math.round(res * boxAspect) : gameW;
    const H = boxAspect >= C.aspect ? res : Math.round(gameW / boxAspect);
    Object.assign(c.style, { width: W + 'px', height: H + 'px',
      transformOrigin: '0 0', transform: `scale(${box.width / W})` });
  }
  window.dispatchEvent(new Event('resize'));
}
function applyResolution() {
  const emu = window.EJS_emulator;
  if (!emu || !emu.gameManager) return;
  // HQ upscaling filter so the extra pixels add smooth detail instead of bigger blocks
  // (2D systems only; 3D systems just get the sharper high-resolution output).
  emu.enableShader(res && C.smooth !== false ? '4xScaleHQ.glslp' : 'disabled');
  layoutCanvas();
}
let lastBox = '';
new ResizeObserver(() => {
  const r = $('game').getBoundingClientRect();
  const key = r.width + 'x' + r.height;
  if (key !== lastBox) { lastBox = key; if (res) layoutCanvas(); }
}).observe($('game'));
function renderOptions() {
  const build = (rowId, values, current, label, pick) => {
    const row = $(rowId);
    row.innerHTML = '';
    values.forEach(v => {
      const b = document.createElement('button');
      b.className = 'slot opt' + (v === current ? ' active' : '');
      b.innerHTML = label(v);
      b.onclick = () => { pick(v); renderOptions(); };
      row.appendChild(b);
    });
  };
  build('fps-opts', FPS_OPTIONS, fps,
    v => `<b>${v} fps</b><span>Normal speed</span>`,
    v => { fps = v; saveSetting('fps', v); applySpeed(); });
  build('res-opts', RES_HEIGHTS, res,
    v => `<b>${RES_NAMES[v]}</b><span>${resLabel(v)}</span>`,
    v => { res = v; saveSetting('res', v); applyResolution(); });
}

// ---- P: pause menu (save state / load state / load different ROM) ----
const SLOTS = 3;
let menuOpen = false;
const slotKey = i => `${window.EJS_gameName}:${i}`;
const putState = (i, v) => dbOp('readwrite', s => s.put(v, slotKey(i)), 'states');
const getState = i => dbOp('readonly', s => s.get(slotKey(i)), 'states').catch(() => null);
const fmtTime = t => new Date(t).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
const msg = t => $('menu-msg').textContent = t;

async function renderSlots() {
  const saveRow = $('save-slots'), loadRow = $('load-slots');
  const states = [];
  for (let i = 1; i <= SLOTS; i++) states.push(await getState(i));
  saveRow.innerHTML = loadRow.innerHTML = '';
  states.forEach((st, idx) => {
    const i = idx + 1;
    const html = `<b>Slot ${i}</b><span>${st ? fmtTime(st.time) : 'Empty'}</span>`;
    const sb = document.createElement('button');
    sb.className = 'slot'; sb.innerHTML = html; sb.onclick = () => saveSlot(i);
    const lb = document.createElement('button');
    lb.className = 'slot'; lb.innerHTML = html; lb.disabled = !st; lb.onclick = () => loadSlot(i);
    saveRow.appendChild(sb); loadRow.appendChild(lb);
  });
}

function openMenu() {
  const emu = window.EJS_emulator;
  if (!emu || !emu.gameManager) return;   // game not running yet
  menuOpen = true;
  emu.pause();
  msg('');
  $('menu').style.display = 'flex';
  renderSlots();
  renderOptions();
}
function closeMenu() {
  menuOpen = false;
  $('menu').style.display = 'none';
  if (window.EJS_emulator) window.EJS_emulator.play();
}
async function saveSlot(i) {
  try {
    const data = window.EJS_emulator.gameManager.getState();
    await putState(i, { data: new Uint8Array(data), time: Date.now() });
    msg(`Saved to slot ${i}.`);
    renderSlots();
  } catch (e) { console.error(e); msg('Could not save state.'); }
}
async function loadSlot(i) {
  const st = await getState(i);
  if (!st) return;
  try {
    closeMenu();
    window.EJS_emulator.gameManager.loadState(new Uint8Array(st.data));
  } catch (e) { console.error(e); openMenu(); msg('Could not load state.'); }
}

$('resume').addEventListener('click', closeMenu);
$('home').addEventListener('click', () => { location.href = './'; });
$('change-rom').addEventListener('click', () => $('file2').click());
$('file2').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  msg('Loading…');
  await putRom({ name: file.name, data: await file.arrayBuffer() });
  location.reload();   // restart the emulator with the new game
});

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'p') {
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat) menuOpen ? closeMenu() : openMenu();
    return;
  }
  if (menuOpen) {               // keep keys away from the game while paused
    e.stopPropagation();
    if (k === 'escape') closeMenu();
  }
}, true);

$('forget').addEventListener('click', async () => {
  if (!confirm('Forget the remembered ROM? (In-game saves are kept.)')) return;
  await delRom();
  location.reload();
});

// ---- on open: start the game this browser remembers, otherwise ask ----
(async () => {
  const saved = await getRom();
  if (saved) start(saved);
})();
