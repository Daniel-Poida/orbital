/* Склейка: состояние, интерфейс, ссылка, жесты, история, обучение, выбор планет. */
(() => {
  const STEPS = Scene.STEPS;
  const $ = (id) => document.getElementById(id);
  const state = {
    planetId: null,
    planet: null,
    base: '',
    bpm: 110,
    orbits: 3,
    grid: [],            // grid[orbit][step] = индекс семпла или -1
    rings: new Set(),
    selected: -1,        // выбранный семпл в палитре
    mixerReady: false,
    loaded: false,
    pendingPlay: false,  // запустить, как только догрузятся звуки
  };
  let planetsIndex = [];
  let hintTimer = null;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } },
  };
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) { /* нет вибро */ } }

  // ---------- Хэш-ссылка ----------
  function gridToString(grid) { return grid.map(row => row.map(v => v < 0 ? '-' : v.toString(36)).join('')).join('.'); }
  function stringToGrid(o) {
    return o.split('.').map(row => [...Array(STEPS).keys()].map(i => { const c = row[i]; return (!c || c === '-') ? -1 : parseInt(c, 36); }));
  }

  function encode() {
    const q = new URLSearchParams({ p: state.planetId, b: String(state.bpm), o: gridToString(state.grid) });
    const r = [...state.rings].sort((a, b) => a - b).join(',');
    if (r) q.set('r', r);
    if (typeof Mixer !== 'undefined' && state.mixerReady) {
      const mx = Mixer.encode();
      if (mx.m) q.set('m', mx.m);
      if (mx.x) q.set('x', mx.x);
    }
    return '#' + q.toString();
  }

  function decode() {
    const h = location.hash.replace(/^#/, '');
    if (!h || h === 'edit') return null;
    const q = new URLSearchParams(h);
    const out = { planetId: q.get('p'), bpm: parseInt(q.get('b') || '', 10), grid: null, rings: [] };
    const o = q.get('o');
    if (o) out.grid = stringToGrid(o);
    const r = q.get('r');
    if (r) out.rings = r.split(',').map(x => parseInt(x, 10)).filter(x => !isNaN(x));
    out.m = q.get('m') || ''; out.x = q.get('x') || '';
    return out;
  }

  let hashTimer = null;
  function syncHash() { clearTimeout(hashTimer); history.replaceState(null, '', encode()); }
  // Safari ограничивает частоту replaceState, поэтому при движении ползунков пишем с задержкой.
  function syncHashSoon() { clearTimeout(hashTimer); hashTimer = setTimeout(syncHash, 350); }

  // ---------- История для «Отменить» ----------
  const undoStack = [];
  function snapshot() { return { grid: state.grid.map(r => r.slice()), rings: [...state.rings], orbits: state.orbits }; }
  function remember() { undoStack.push(snapshot()); if (undoStack.length > 60) undoStack.shift(); updateUndo(); }
  function updateUndo() { $('undo-btn').disabled = undoStack.length === 0; }
  function undo() {
    const s = undoStack.pop(); if (!s) return;
    restore(s); updateUndo(); buzz(6); hint('Отменено', 900);
  }
  function restore(s) {
    state.orbits = s.orbits; Scene.setOrbitCount(s.orbits); $('orbit-count').textContent = s.orbits;
    state.grid = s.grid.map(r => r.slice()); ensureGrid(s.orbits);
    redrawSatellites();
    setRingsTo(new Set(s.rings));
    syncHash();
  }

  // ---------- Сетка ----------
  function ensureGrid(n) {
    while (state.grid.length < n) state.grid.push(Array(STEPS).fill(-1));
    state.grid.length = n;
  }

  function hitsAt(step) {
    const hits = [];
    for (let o = 0; o < state.orbits; o++) { const v = state.grid[o][step]; if (v >= 0) hits.push({ orbit: o, step, sample: v }); }
    return hits;
  }

  function redrawSatellites() {
    Scene.clearSatellites();
    for (let o = 0; o < state.orbits; o++) for (let s = 0; s < STEPS; s++) {
      const v = state.grid[o][s];
      if (v >= 0 && state.planet.samples[v]) Scene.setSatellite(o, s, state.planet.samples[v]);
    }
  }

  function setOrbits(n) {
    n = Math.max(1, Math.min(Scene.MAX_ORBITS, n));
    if (n === state.orbits) return;
    remember();
    state.orbits = n; ensureGrid(n);
    Scene.setOrbitCount(n);
    $('orbit-count').textContent = n;
    syncHash();
  }

  function setCell(o, s, v) {
    state.grid[o][s] = v;
    Scene.setSatellite(o, s, v >= 0 ? state.planet.samples[v] : null);
  }

  // Поставить спутник; тот же семпл на той же точке снимает его.
  function place(o, s, sample) {
    remember();
    const next = state.grid[o][s] === sample ? -1 : sample;
    setCell(o, s, next);
    if (next >= 0 && !AudioEngine.isPlaying()) AudioEngine.preview(next);
    buzz(next >= 0 ? 10 : 6);
    if (next >= 0) Coach.done('place');
    syncHash();
  }

  function moveSatellite(from, to) {
    const v = state.grid[from.orbit][from.step];
    if (v < 0) return;
    if (from.orbit === to.orbit && from.step === to.step) { setCell(from.orbit, from.step, v); return; }
    remember();
    setCell(from.orbit, from.step, -1);
    setCell(to.orbit, to.step, v);
    buzz(10); Coach.done('place');
    syncHash();
  }

  function removeSatellite(at) {
    remember();
    setCell(at.orbit, at.step, -1);
    buzz(16); hint('Спутник улетел', 900);
    syncHash();
  }

  // ---------- Кольца ----------
  function applyRing(i, on) {
    if (on) state.rings.add(i); else state.rings.delete(i);
    AudioEngine.setRing(i, on);
    Scene.setRing(i, on);
    const chip = document.querySelector(`#rings .chip[data-i="${i}"]`);
    if (chip) { chip.classList.toggle('active', on); chip.setAttribute('aria-pressed', String(on)); }
  }
  function setRingsTo(set) {
    if (!state.planet) return;
    for (let i = 0; i < state.planet.rings.length; i++) if (set.has(i) !== state.rings.has(i)) applyRing(i, set.has(i));
    if (state.mixerReady) Mixer.render();
  }
  function toggleRing(i) {
    remember();
    applyRing(i, !state.rings.has(i));
    if (state.mixerReady) Mixer.render();
    buzz(8); Coach.done('ring');
    syncHash();
  }

  // ---------- «Удиви меня» ----------
  const KICKS = ['0---0---0---0---', '0-----0-0-------', '0--0--0---0-0---', '0---------0-----', '0-0---0---0--0--', '0---0-----0---0-', '0--0----0-0-----'];
  const SNARES = ['----x-------x---', '--------x-------', '----x-------x--x', '----x--x----x---', '----x-------x-x-'];
  const HATS = ['x-x-x-x-x-x-x-x-', 'xxxxxxxxxxxxxxxx', '--x---x---x---x-', 'x---x---x---x---', 'x-xxx-x-x-xxx-x-', 'x-x-x-xxx-x-x-xx'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function guessRoles(samples) {
    const find = (re, fallback) => { const i = samples.findIndex(s => re.test(s.name)); return i >= 0 ? i : fallback; };
    const kick = find(/боч|kick|808|бездн/i, 0);
    const snare = find(/снейр|snare|клэп|clap|рим/i, Math.min(1, samples.length - 1));
    const hat = find(/хэт|hat|бубен|шейк/i, Math.min(2, samples.length - 1));
    return { kick, snare, hat };
  }

  function surprise() {
    const p = state.planet; if (!p) return;
    remember();
    const roles = guessRoles(p.samples);
    const orbits = 3 + Math.floor(Math.random() * 3);
    const grid = [...Array(orbits)].map(() => Array(STEPS).fill(-1));
    const fill = (row, pattern, v) => { for (let s = 0; s < STEPS; s++) if (pattern[s] !== '-') grid[row][s] = v; };
    fill(0, pick(KICKS), roles.kick);
    fill(1, pick(SNARES), roles.snare);
    fill(2, pick(HATS), roles.hat);
    const others = p.samples.map((_, i) => i).filter(i => ![roles.kick, roles.snare, roles.hat].includes(i));
    for (let o = 3; o < orbits; o++) {
      if (!others.length) break;
      const v = pick(others);
      const hits = 1 + Math.floor(Math.random() * 3);
      const slots = [2, 3, 6, 7, 10, 11, 14, 15, 0, 8].sort(() => Math.random() - 0.5).slice(0, hits);
      for (const s of slots) grid[o][s] = v;
    }
    state.orbits = orbits; Scene.setOrbitCount(orbits); $('orbit-count').textContent = orbits;
    state.grid = grid;
    redrawSatellites();
    const ringIdx = p.rings.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, Math.min(p.rings.length, 1 + Math.floor(Math.random() * 3)));
    setRingsTo(new Set(ringIdx));
    const btn = $('surprise-btn'); btn.classList.remove('spin'); void btn.offsetWidth; btn.classList.add('spin');
    buzz([8, 40, 8]);
    if (!AudioEngine.isPlaying() && state.loaded) setPlaying(true);
    Coach.done('surprise');
    syncHash();
  }

  // ---------- Интерфейс ----------
  function hint(text, ms = 1800) {
    const el = $('hint'); el.textContent = text; el.classList.add('show');
    clearTimeout(hintTimer); hintTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function applyTheme(p) {
    const c = p.colors || {};
    document.documentElement.style.setProperty('--accent', c.accent || '#ff7a3d');
    document.documentElement.style.setProperty('--text', c.text || '#f4f2ff');
    document.body.style.backgroundImage = p.background ? `url(${state.base}${p.background})` : 'none';
    $('planet-dot').style.background = c.accent || '#ff7a3d';
    $('planet-name').textContent = p.name;
    $('planet-artist').textContent = p.track || '';
    $('start-title').textContent = p.name;
    $('track-link').href = p.trackUrl || '#';
    $('track-link').style.display = p.trackUrl ? '' : 'none';
  }

  function buildPalette(p) {
    const pal = $('palette'); pal.innerHTML = '';
    p.samples.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.i = i; b.style.setProperty('--c', s.color);
      b.setAttribute('role', 'option');
      b.innerHTML = `<span class="sw"></span>${s.name}`;
      pal.appendChild(b);
    });
    const rg = $('rings'); rg.innerHTML = '';
    p.rings.forEach((r, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip ring'; b.dataset.i = i; b.style.setProperty('--c', r.color);
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `<span class="sw"></span>${r.name}`;
      b.addEventListener('click', () => toggleRing(i));
      rg.appendChild(b);
    });
  }

  function select(i) {
    state.selected = (state.selected === i) ? -1 : i;
    document.querySelectorAll('#palette .chip').forEach(c => c.classList.toggle('selected', +c.dataset.i === state.selected));
    if (state.selected >= 0) { AudioEngine.preview(state.selected); hint('Теперь нажми на точку орбиты'); }
  }

  function setPlaying(on) {
    if (on && Tone.context.state !== 'running') { try { Tone.start(); } catch (e) { /* пусто */ } }
    if (on) AudioEngine.start(); else AudioEngine.stop();
    Scene.setPlaying(on);
    $('play-btn').classList.toggle('on', on);
    $('play-btn').setAttribute('aria-label', on ? 'Стоп' : 'Играть');
    if (!on) Scene.setProgress(0);
  }
  function togglePlay() {
    if (!state.loaded) { state.pendingPlay = !state.pendingPlay; hint(state.pendingPlay ? 'Запущу, как только загрузятся звуки' : 'Отменено', 1400); return; }
    setPlaying(!AudioEngine.isPlaying());
    Coach.done('planet');
  }

  function fillRange(el) {
    el.style.setProperty('--val', ((el.value - el.min) / (el.max - el.min) * 100).toFixed(1) + '%');
  }

  function showTab(name) {
    const tabs = [...document.querySelectorAll('.tab')];
    const idx = tabs.findIndex(t => t.dataset.tab === name);
    if (idx < 0) return;
    tabs.forEach(x => { x.classList.toggle('on', x.dataset.tab === name); x.setAttribute('aria-selected', String(x.dataset.tab === name)); });
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === name));
    document.querySelector('.tab-ind').style.transform = `translateX(${idx * 100}%)`;
    if (name === 'mixer' && state.mixerReady) Mixer.render();
    if (name === 'master' && state.mixerReady) Mixer.renderMaster();
  }
  function bindTabs() {
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { setDock(false); showTab(t.dataset.tab); Coach.reposition(); }));
  }

  // ---------- Сворачиваемая панель ----------
  function setDock(collapsed) {
    const dock = $('dock');
    dock.classList.toggle('collapsed', collapsed);
    $('dock-grab').setAttribute('aria-expanded', String(!collapsed));
    $('dock-grab').setAttribute('aria-label', collapsed ? 'Развернуть панель' : 'Свернуть панель');
  }
  function bindDock() {
    const grab = $('dock-grab');
    let y0 = null, moved = false;
    grab.addEventListener("pointerdown", (e) => { y0 = e.clientY; moved = false; try { grab.setPointerCapture(e.pointerId); } catch (err) { /* синтетическое событие */ } });
    grab.addEventListener('pointermove', (e) => {
      if (y0 == null) return;
      const dy = e.clientY - y0;
      if (dy > 24) { setDock(true); moved = true; y0 = null; }
      else if (dy < -24) { setDock(false); moved = true; y0 = null; }
    });
    grab.addEventListener('pointerup', () => { if (y0 != null && !moved) setDock(!$('dock').classList.contains('collapsed')); y0 = null; });
    grab.addEventListener('pointercancel', () => { y0 = null; });
  }

  // ---------- Обучение: три подсказки поверх сцены ----------
  const Coach = (() => {
    const KEY = 'orbital.coach.v1';
    const steps = [
      { id: 'planet', text: 'Нажми на планету: пауза и запуск', tab: null, at: () => { const p = Scene.planetScreen(); return { x: p.x, y: p.y - 70 }; } },
      { id: 'place', text: 'Перетащи спутник на орбиту', tab: 'sounds', at: () => rectTop(document.querySelector('#palette .chip')) },
      { id: 'ring', text: 'Нажми на кольцо вокруг планеты', tab: null, at: () => { const p = Scene.planetScreen(); return { x: p.x, y: p.y - 115 }; } },
    ];
    let i = -1;
    const el = () => $('coach');
    let pulse = null;
    function rectTop(node) { if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top }; }
    function start() {
      if (store.get(KEY) === 'done') return;
      i = 0; show();
    }
    function show() {
      const s = steps[i];
      if (s.tab) showTab(s.tab);
      $('coach-step').textContent = `${i + 1} / ${steps.length}`;
      $('coach-text').textContent = s.text;
      el().classList.remove('hidden');
      if (!pulse) { pulse = document.createElement('div'); pulse.className = 'coach-pulse'; document.body.appendChild(pulse); }
      reposition();
    }
    function reposition() {
      if (i < 0) return;
      const pt = steps[i].at(); if (!pt) return;
      const c = el();
      const w = c.offsetWidth / 2 + 8;
      c.style.left = Math.max(w, Math.min(window.innerWidth - w, pt.x)) + 'px';
      c.style.top = Math.max(c.offsetHeight + 70, pt.y) + 'px';
      if (pulse) {
        const target = steps[i].id === 'place' ? { x: pt.x, y: pt.y + 20 } : steps[i].id === 'planet' ? Scene.planetScreen() : { x: pt.x, y: pt.y + 115 - 40 };
        pulse.style.left = target.x + 'px'; pulse.style.top = target.y + 'px';
      }
    }
    function finish() {
      i = -1; el().classList.add('hidden');
      if (pulse) { pulse.remove(); pulse = null; }
      store.set(KEY, 'done');
    }
    function done(id) {
      if (i < 0 || steps[i].id !== id) return;
      i++;
      if (i >= steps.length) { finish(); hint('Готово! Дальше — твой бит', 1800); } else show();
    }
    return { start, done, reposition, finish, active: () => i >= 0 };
  })();

  // ---------- Выбор планеты: система со свайпом ----------
  const System = (() => {
    const W = 180;
    let current = 0;
    function build() {
      const track = $('planet-list');
      track.innerHTML = '';
      planetsIndex.forEach((p, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sys-planet'; b.dataset.i = i; b.setAttribute('role', 'option');
        b.setAttribute('aria-label', p.name);
        b.style.setProperty('--c', p.accent || '#888');
        if (p.texture) b.style.setProperty("--tex", `url("${new URL(planetBase(p.id) + p.texture, location.href).href}")`);
        b.innerHTML = '<span class="sys-sphere"></span>';
        b.addEventListener('click', () => { if (i === current) go(); else scrollTo(i); });
        track.appendChild(b);
      });
      $('sys-dots').innerHTML = planetsIndex.map(() => '<i></i>').join('');
    }
    function scrollTo(i, instant) { $('planet-list').scrollTo({ left: i * W, behavior: instant ? 'auto' : 'smooth' }); }
    function update() {
      const track = $('planet-list');
      const i = Math.max(0, Math.min(planetsIndex.length - 1, Math.round(track.scrollLeft / W)));
      current = i;
      track.querySelectorAll('.sys-planet').forEach((b, k) => { b.classList.toggle('on', k === i); b.setAttribute('aria-selected', String(k === i)); });
      $('sys-dots').querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
      const p = planetsIndex[i];
      $('sys-name').textContent = p.name;
      $('sys-track').textContent = p.track || '';
      $('picker').style.setProperty('--accent', p.accent || '#ff7a3d');
      $('sys-open').textContent = p.id === state.planetId ? 'Остаться здесь' : 'Лететь на планету';
    }
    function open() {
      build();
      $('picker').classList.remove('hidden');
      const idx = Math.max(0, planetsIndex.findIndex(p => p.id === state.planetId));
      requestAnimationFrame(() => { scrollTo(idx, true); update(); });
    }
    function go() {
      const p = planetsIndex[current];
      $('picker').classList.add('hidden');
      if (p.id !== state.planetId) loadPlanet(p.id, null);
    }
    function bind() {
      let raf = 0;
      $('planet-list').addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); });
      $('sys-open').addEventListener('click', go);
      $('picker').addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') scrollTo(Math.min(planetsIndex.length - 1, current + 1));
        if (e.key === 'ArrowLeft') scrollTo(Math.max(0, current - 1));
        if (e.key === 'Enter') go();
      });
    }
    return { open, bind };
  })();

  // ---------- Загрузка планеты ----------
  function planetBase(id) { return `planets/${id}/`; }

  async function loadPlanet(id, fromHash) {
    const res = await fetch(planetBase(id) + 'planet.json');
    const p = await res.json();
    await applyPlanet(p, planetBase(id), fromHash, id);
  }

  // Применяет конфиг планеты. base — префикс к путям файлов ('' для blob-ссылок редактора).
  async function applyPlanet(p, base, fromHash, id) {
    const wasPlaying = AudioEngine.isPlaying();
    setPlaying(false);
    state.loaded = false;
    state.planetId = id || p.id; state.planet = p; state.base = base;
    state.bpm = (fromHash && fromHash.bpm) || p.bpm || 110;
    // Живой старт: без расстановки в ссылке берём стартовый бит артиста.
    const preset = p.preset && p.preset.o ? p.preset : null;
    const useHash = fromHash && fromHash.grid;
    state.grid = useHash ? fromHash.grid : preset ? stringToGrid(preset.o) : [];
    const ringList = useHash ? (fromHash.rings || []) : preset ? (preset.r || []) : [];
    state.rings = new Set(ringList.filter(i => i < p.rings.length));
    state.orbits = Math.max(1, Math.min(Scene.MAX_ORBITS, state.grid.length || 3));
    ensureGrid(state.orbits);
    for (const row of state.grid) for (let s = 0; s < STEPS; s++) if (row[s] >= p.samples.length) row[s] = -1;
    state.selected = -1;
    undoStack.length = 0; updateUndo();

    applyTheme(p);
    buildPalette(p);
    Scene.setPlanet(p, base);
    Scene.setOrbitCount(state.orbits);
    redrawSatellites();
    $('orbit-count').textContent = state.orbits;
    $('bpm').value = state.bpm; $('bpm-label').textContent = state.bpm; fillRange($('bpm'));
    state.mixerReady = false;

    $('load-status').textContent = 'загрузка…';
    $('start-btn').classList.add('loading');
    await AudioEngine.load(p, base, (d, t) => {
      $('load-status').textContent = `${d} / ${t}`;
      $('start-btn').style.setProperty('--progress', Math.round(d / t * 100) + '%');
    });
    $('load-status').textContent = 'готово';
    $('start-btn').classList.remove('loading');
    AudioEngine.setBpm(state.bpm);
    for (const i of state.rings) { AudioEngine.setRing(i, true); Scene.setRing(i, true); }
    Mixer.apply(fromHash && fromHash.m, fromHash && fromHash.x);
    Mixer.setPlanet(p, { onChange: syncHashSoon, onRingToggle: toggleRing, ringState: (i) => state.rings.has(i) });
    state.mixerReady = true;
    state.loaded = true;
    document.querySelectorAll('#rings .chip').forEach(c => c.classList.toggle('active', state.rings.has(+c.dataset.i)));
    syncHash();
    if (wasPlaying || state.pendingPlay) { state.pendingPlay = false; setPlaying(true); }
  }

  // ---------- Жесты на сцене ----------
  function bindPointer() {
    const canvas = $('scene');
    const ghost = $('drag-ghost');
    const active = new Map();
    let gesture = null;
    let lastHover = null;

    function hoverAt(x, y, color) {
      const hit = Scene.pick(x, y);
      const key = hit && hit.type === 'step' ? hit.orbit + ':' + hit.step : null;
      if (key !== lastHover) { lastHover = key; if (key) buzz(4); }
      if (hit && hit.type === 'step') Scene.setHover(hit.orbit, hit.step, color); else Scene.setHover(null);
      return hit;
    }
    function ghostAt(x, y, color) {
      ghost.style.setProperty('--c', color); ghost.classList.remove('hidden');
      ghost.style.left = x + 'px'; ghost.style.top = y + 'px';
    }
    function endHover() { Scene.setHover(null); ghost.classList.add('hidden'); lastHover = null; }

    canvas.addEventListener('pointerdown', (e) => {
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* синтетическое событие */ }
      if (active.size === 1) {
        const hit = Scene.pick(e.clientX, e.clientY);
        const sat = hit && hit.type === 'step' && state.grid[hit.orbit][hit.step] >= 0 ? hit : null;
        gesture = { type: 'tap', x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, sat };
      } else if (active.size === 2) {
        if (gesture && gesture.type === 'sat') { setCell(gesture.sat.orbit, gesture.sat.step, gesture.v); endHover(); }
        const [a, b] = [...active.values()];
        gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), z0: Scene.getZoom() };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!active.has(e.pointerId)) return;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gesture) return;
      if (gesture.type === 'pinch' && active.size === 2) {
        const [a, b] = [...active.values()];
        Scene.setZoom(gesture.z0 * Math.hypot(a.x - b.x, a.y - b.y) / gesture.d0);
        return;
      }
      if (gesture.type === 'tap' && Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) > 10) {
        if (gesture.sat) {
          // Тянем спутник: убираем с места, показываем «призрак» и цель.
          gesture.type = 'sat';
          gesture.v = state.grid[gesture.sat.orbit][gesture.sat.step];
          gesture.color = state.planet.samples[gesture.v].color;
          Scene.setSatellite(gesture.sat.orbit, gesture.sat.step, null);
        } else gesture.type = 'pan';
      }
      if (gesture.type === 'sat') {
        ghostAt(e.clientX, e.clientY, gesture.color);
        const hit = hoverAt(e.clientX, e.clientY, gesture.color);
        ghost.classList.toggle('away', !(hit && hit.type === 'step'));
      } else if (gesture.type === 'pan') {
        Scene.panBy(e.clientX - gesture.lx, e.clientY - gesture.ly);
      }
      gesture.lx = e.clientX; gesture.ly = e.clientY;
    });
    const endPointer = (e) => {
      const g = gesture;
      active.delete(e.pointerId);
      if (g && g.type === 'tap' && e.type === 'pointerup' && active.size === 0) onTap(e.clientX, e.clientY);
      if (g && g.type === 'sat' && active.size === 0) {
        endHover(); ghost.classList.remove('away');
        const hit = e.type === 'pointerup' ? Scene.pick(e.clientX, e.clientY) : null;
        if (hit && hit.type === 'step') { state.grid[g.sat.orbit][g.sat.step] = g.v; moveSatellite(g.sat, hit); }
        else if (e.type === 'pointerup') { state.grid[g.sat.orbit][g.sat.step] = g.v; removeSatellite(g.sat); }
        else setCell(g.sat.orbit, g.sat.step, g.v);
      }
      if (active.size === 0) gesture = null;
      else if (active.size === 1) { const [a] = [...active.values()]; gesture = { type: 'pan', lx: a.x, ly: a.y }; }
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); Scene.setZoom(Scene.getZoom() * (e.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });
    canvas.addEventListener('dblclick', () => Scene.resetView());

    // Перетаскивание из палитры. Движение и отпускание слушаем на окне,
    // чтобы жест не зависел от захвата указателя (в iOS он бывает ненадёжен).
    let drag = null;
    const onMove = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      // Горизонтальный жест оставляем прокрутке палитры, вертикальный — это перетаскивание.
      if (!drag.moving && Math.abs(e.clientY - drag.y) > 12 && Math.abs(e.clientY - drag.y) > Math.abs(e.clientX - drag.x)) drag.moving = true;
      if (drag.moving) {
        e.preventDefault();
        const color = state.planet.samples[drag.i].color;
        ghostAt(e.clientX, e.clientY, color);
        hoverAt(e.clientX, e.clientY, color);
      }
    };
    const onUp = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null; endHover();
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      if (e.type === 'pointercancel') return;
      if (d.moving) {
        e.stopPropagation();
        const hit = Scene.pick(e.clientX, e.clientY);
        if (hit && hit.type === 'step') { if (state.grid[hit.orbit][hit.step] === d.i) buzz(4); else place(hit.orbit, hit.step, d.i); }
        else hint('Отпусти спутник на точке орбиты');
      } else if (Math.abs(e.clientX - d.x) < 10) {
        select(d.i);
      }
    };
    $('palette').addEventListener('pointerdown', (e) => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      drag = { id: e.pointerId, i: +chip.dataset.i, x: e.clientX, y: e.clientY, moving: false };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
    });
  }

  function onTap(x, y) {
    const hit = Scene.pick(x, y);
    if (!hit) return;
    if (hit.type === 'planet') { togglePlay(); return; }
    if (hit.type === 'ring') { toggleRing(hit.index); return; }
    if (hit.type === 'step') {
      const cur = state.grid[hit.orbit][hit.step];
      if (state.selected >= 0) place(hit.orbit, hit.step, state.selected);
      else if (cur >= 0) place(hit.orbit, hit.step, cur);
      else hint('Выбери спутник внизу или перетащи его сюда');
    }
  }

  // ---------- Старт ----------
  async function boot() {
    const wantEdit = location.hash === '#edit';
    Scene.init($('scene'));
    const dock = $('dock');
    const padNow = () => { Scene.setBottomPad(window.innerHeight - dock.getBoundingClientRect().top); Coach.reposition(); };
    padNow();
    window.addEventListener('resize', padNow);
    if (window.ResizeObserver) new ResizeObserver(padNow).observe(dock);
    bindTabs();
    bindDock();
    System.bind();

    // Кнопка старта работает сразу, ещё до загрузки семплов. Окно закрывается синхронно,
    // звук разблокируется в фоне, бит артиста стартует сразу или как только загрузится.
    const startOverlay = () => {
      if ($('start').classList.contains('hidden')) return;
      $('start').classList.add('hidden');
      AudioEngine.unlock();
      if (state.loaded) setPlaying(true); else state.pendingPlay = true;
      setTimeout(Coach.start, 700);
    };
    $('start-btn').addEventListener('click', startOverlay);
    $('start').addEventListener('click', (e) => { if (e.target === $('start')) startOverlay(); });
    // Если звук всё-таки не проснулся (Safari), будим его при следующем нажатии в любом месте.
    document.addEventListener('pointerdown', () => {
      if (Tone.context.state !== 'running') { try { Tone.start(); } catch (e) { /* пусто */ } }
    }, { capture: true });
    AudioEngine.setGrid(hitsAt);
    AudioEngine.setOnStep((step, hits) => { for (const h of hits) Scene.flash(h.orbit, h.step); });
    let frame = 0;
    (function tick() {
      Scene.setProgress(AudioEngine.progress());
      if (state.planet && AudioEngine.isPlaying()) {
        for (const i of state.rings) Scene.setRingLevel(i, AudioEngine.level('r' + i));
        Scene.setEnergy(AudioEngine.masterLevel());
      } else Scene.setEnergy(0);
      if (Coach.active() && (++frame % 10 === 0)) Coach.reposition();
      requestAnimationFrame(tick);
    })();

    $('play-btn').addEventListener('click', togglePlay);
    $('undo-btn').addEventListener('click', undo);
    $('surprise-btn').addEventListener('click', surprise);
    $('coach-skip').addEventListener('click', () => Coach.finish());
    $('orbit-plus').addEventListener('click', () => setOrbits(state.orbits + 1));
    $('orbit-minus').addEventListener('click', () => setOrbits(state.orbits - 1));
    $('clear-btn').addEventListener('click', () => {
      remember();
      state.grid = []; ensureGrid(state.orbits); redrawSatellites();
      setRingsTo(new Set());
      hint('Орбиты очищены. Отменить — стрелка слева', 2200);
      syncHash();
    });
    $('bpm').addEventListener('input', (e) => {
      state.bpm = +e.target.value; $('bpm-label').textContent = state.bpm; AudioEngine.setBpm(state.bpm); fillRange(e.target);
    });
    $('bpm').addEventListener('change', () => { AudioEngine.resyncRings(); syncHash(); });
    $('planet-btn').addEventListener('click', () => System.open());
    $('share-btn').addEventListener('click', () => {
      syncHash(); $('share-url').value = location.href; $('share').classList.remove('hidden');
    });
    $('copy-btn').addEventListener('click', async () => {
      const url = $('share-url').value;
      if (navigator.share) { try { await navigator.share({ title: state.planet.name, url }); return; } catch (e) { /* отмена */ } }
      try { await navigator.clipboard.writeText(url); hint('Ссылка скопирована'); } catch (e) { $('share-url').select(); }
    });
    $('editor-open').addEventListener('click', () => { $('picker').classList.add('hidden'); if (typeof Editor !== 'undefined') Editor.open(); });
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden')));
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select') || !$('start').classList.contains('hidden')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); togglePlay(); }
      else if (e.key === 'Escape') document.querySelectorAll('.overlay:not(#start):not(#editor)').forEach(o => o.classList.add('hidden'));
    });
    bindPointer();

    const idx = await (await fetch('planets/index.json')).json();
    planetsIndex = idx.planets;
    await Promise.all(planetsIndex.map(async (p) => {
      try {
        const cfg = await (await fetch(planetBase(p.id) + 'planet.json')).json();
        p.accent = (cfg.colors || {}).accent; p.texture = cfg.texture; p.track = cfg.track || p.track || '';
      } catch (e) { /* пусто */ }
    }));
    const fromHash = decode();
    const id = (fromHash && planetsIndex.some(p => p.id === fromHash.planetId)) ? fromHash.planetId : planetsIndex[0].id;

    window.Orbital = {
      applyPlanet: (cfg, base) => applyPlanet(cfg, base, null, cfg.id || 'draft'),
      current: () => ({ cfg: state.planet, base: state.base }),
      currentBeat: () => ({ o: gridToString(state.grid), r: [...state.rings].sort((a, b) => a - b) }),
      hint, setPlaying, isReady: () => !$('start').classList.contains('hidden'),
    };
    if (wantEdit && typeof Editor !== 'undefined') { $('start').classList.add('hidden'); Editor.open(); }
    await loadPlanet(id, fromHash);
  }

  boot().catch(err => { console.error(err); $('load-status').textContent = 'ошибка: ' + err.message; });
})();
