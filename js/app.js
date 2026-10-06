/* Склейка: состояние, интерфейс, ссылка, указатель. */
(() => {
  const STEPS = Scene.STEPS;
  const $ = (id) => document.getElementById(id);
  const state = {
    planetId: null,
    planet: null,
    base: '',
    bpm: 110,
    orbits: 3,
    grid: [],          // grid[orbit][step] = индекс семпла или -1
    rings: new Set(),
    selected: -1,      // выбранный семпл в палитре
  };
  let planetsIndex = [];
  let hintTimer = null;

  // ---------- Хэш-ссылка ----------
  function encode() {
    const o = state.grid.map(row => row.map(v => v < 0 ? '-' : v.toString(36)).join('')).join('.');
    const r = [...state.rings].sort().join(',');
    const q = new URLSearchParams({ p: state.planetId, b: String(state.bpm), o });
    if (r) q.set('r', r);
    return '#' + q.toString();
  }

  function decode() {
    const h = location.hash.replace(/^#/, '');
    if (!h) return null;
    const q = new URLSearchParams(h);
    const out = { planetId: q.get('p'), bpm: parseInt(q.get('b') || '', 10), grid: null, rings: [] };
    const o = q.get('o');
    if (o) out.grid = o.split('.').map(row => [...Array(STEPS).keys()].map(i => { const c = row[i]; return (!c || c === '-') ? -1 : parseInt(c, 36); }));
    const r = q.get('r');
    if (r) out.rings = r.split(',').map(x => parseInt(x, 10)).filter(x => !isNaN(x));
    return out;
  }

  function syncHash() { history.replaceState(null, '', encode()); }

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
    state.orbits = n; ensureGrid(n);
    Scene.setOrbitCount(n);
    $('orbit-count').textContent = n;
    syncHash();
  }

  function place(o, s, sample) {
    const cur = state.grid[o][s];
    const next = (cur === sample) ? -1 : sample;
    state.grid[o][s] = next;
    Scene.setSatellite(o, s, next >= 0 ? state.planet.samples[next] : null);
    if (next >= 0 && !AudioEngine.isPlaying()) AudioEngine.preview(next);
    syncHash();
  }

  function toggleRing(i) {
    const on = !state.rings.has(i);
    if (on) state.rings.add(i); else state.rings.delete(i);
    AudioEngine.setRing(i, on);
    Scene.setRing(i, on);
    const chip = document.querySelector(`#rings .chip[data-i="${i}"]`);
    if (chip) chip.classList.toggle('active', on);
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
    document.documentElement.style.setProperty('--text', c.text || '#fff4e6');
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
    if (on) AudioEngine.start(); else AudioEngine.stop();
    Scene.setPlaying(on);
    $('play-btn').textContent = on ? '■' : '▶';
    $('play-btn').setAttribute('aria-label', on ? 'Стоп' : 'Играть');
    if (!on) Scene.setProgress(0);
  }

  function buildPlanetList() {
    const list = $('planet-list'); list.innerHTML = '';
    planetsIndex.forEach(p => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn' + (p.id === state.planetId ? ' current' : '');
      b.style.setProperty('--c', p.accent || '#fff');
      b.innerHTML = `<span class="dot"></span><span>${p.name}${p.track ? `<small>${p.track}</small>` : ''}</span>`;
      b.addEventListener('click', () => { $('picker').classList.add('hidden'); loadPlanet(p.id, null); });
      list.appendChild(b);
    });
  }

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
    state.planetId = id || p.id; state.planet = p; state.base = base;
    state.bpm = (fromHash && fromHash.bpm) || p.bpm || 110;
    state.rings = new Set(((fromHash && fromHash.rings) || []).filter(i => i < p.rings.length));
    state.grid = (fromHash && fromHash.grid) || [];
    state.orbits = Math.max(1, Math.min(Scene.MAX_ORBITS, state.grid.length || 3));
    ensureGrid(state.orbits);
    for (const row of state.grid) for (let s = 0; s < STEPS; s++) if (row[s] >= p.samples.length) row[s] = -1;
    state.selected = -1;

    applyTheme(p);
    buildPalette(p);
    Scene.setPlanet(p, base);
    Scene.setOrbitCount(state.orbits);
    redrawSatellites();
    $('orbit-count').textContent = state.orbits;
    $('bpm').value = state.bpm; $('bpm-label').textContent = state.bpm;
    buildPlanetList();

    $('load-status').textContent = 'загрузка…';
    hint('Загружаю звуки…', 60000);
    await AudioEngine.load(p, base, (d, t) => { $('load-status').textContent = `${d} / ${t}`; });
    $('load-status').textContent = 'готово';
    hint('Звуки готовы', 1200);
    AudioEngine.setBpm(state.bpm);
    for (const i of state.rings) { AudioEngine.setRing(i, true); Scene.setRing(i, true); }
    document.querySelectorAll('#rings .chip').forEach(c => c.classList.toggle('active', state.rings.has(+c.dataset.i)));
    syncHash();
    if (wasPlaying) setPlaying(true);
  }

  // ---------- Указатель на сцене и перетаскивание чипов ----------
  function bindPointer() {
    const canvas = $('scene');
    const active = new Map();
    let gesture = null;
    canvas.addEventListener('pointerdown', (e) => {
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (active.size === 1) gesture = { type: 'tap', x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY };
      else if (active.size === 2) {
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
      } else if (gesture.type === 'tap' || gesture.type === 'pan') {
        if (gesture.type === 'tap' && Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) > 10) gesture.type = 'pan';
        if (gesture.type === 'pan') { Scene.panBy(e.clientX - gesture.lx, e.clientY - gesture.ly); }
        gesture.lx = e.clientX; gesture.ly = e.clientY;
      }
    });
    const endPointer = (e) => {
      const wasTap = gesture && gesture.type === 'tap' && active.size === 1;
      active.delete(e.pointerId);
      if (wasTap && e.type === 'pointerup') onTap(e.clientX, e.clientY);
      if (active.size === 0) gesture = null;
      else if (active.size === 1) { const [a] = [...active.values()]; gesture = { type: 'pan', lx: a.x, ly: a.y }; }
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); Scene.setZoom(Scene.getZoom() * (e.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });
    canvas.addEventListener('dblclick', () => Scene.resetView());

    const ghost = $('drag-ghost');
    let drag = null;
    $('palette').addEventListener('pointerdown', (e) => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      drag = { i: +chip.dataset.i, x: e.clientX, y: e.clientY, moving: false, chip };
      chip.setPointerCapture(e.pointerId);
    });
    $('palette').addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moving && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 12) {
        drag.moving = true;
        ghost.style.setProperty('--c', state.planet.samples[drag.i].color);
        ghost.classList.remove('hidden');
      }
      if (drag.moving) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; }
    });
    const endDrag = (e) => {
      if (!drag) return;
      const d = drag; drag = null; ghost.classList.add('hidden');
      if (d.moving) {
        const hit = Scene.pick(e.clientX, e.clientY);
        if (hit && hit.type === 'step') place(hit.orbit, hit.step, d.i);
        else hint('Отпусти спутник на точке орбиты');
      } else {
        select(d.i);
      }
    };
    $('palette').addEventListener('pointerup', endDrag);
    $('palette').addEventListener('pointercancel', () => { drag = null; ghost.classList.add('hidden'); });
  }

  function onTap(x, y) {
    const hit = Scene.pick(x, y);
    if (!hit) return;
    if (hit.type === 'planet') { setPlaying(!AudioEngine.isPlaying()); return; }
    if (hit.type === 'ring') { toggleRing(hit.index); return; }
    if (hit.type === 'step') {
      const cur = state.grid[hit.orbit][hit.step];
      if (state.selected >= 0) place(hit.orbit, hit.step, state.selected);
      else if (cur >= 0) place(hit.orbit, hit.step, cur);
      else hint('Сначала выбери спутник внизу');
    }
  }

  // ---------- Старт ----------
  async function boot() {
    const wantEdit = location.hash === '#edit';
    Scene.init($('scene'));
    Scene.setBottomPad(document.querySelector('.panel').offsetHeight);
    window.addEventListener('resize', () => Scene.setBottomPad(document.querySelector('.panel').offsetHeight));
    AudioEngine.setGrid(hitsAt);
    AudioEngine.setOnStep((step, hits) => { for (const h of hits) Scene.flash(h.orbit, h.step); });
    (function tick() { Scene.setProgress(AudioEngine.progress()); requestAnimationFrame(tick); })();

    const idx = await (await fetch('planets/index.json')).json();
    planetsIndex = idx.planets;
    for (const p of planetsIndex) {
      try { const cfg = await (await fetch(planetBase(p.id) + 'planet.json')).json(); p.accent = (cfg.colors || {}).accent; } catch (e) { /* пусто */ }
    }
    const fromHash = decode();
    const id = (fromHash && planetsIndex.some(p => p.id === fromHash.planetId)) ? fromHash.planetId : planetsIndex[0].id;
    await loadPlanet(id, fromHash);

    $('start-btn').addEventListener('click', async () => {
      await AudioEngine.unlock();
      $('start').classList.add('hidden');
      hint('Нажми на планету, чтобы запустить', 2500);
    });
    $('play-btn').addEventListener('click', () => setPlaying(!AudioEngine.isPlaying()));
    $('orbit-plus').addEventListener('click', () => setOrbits(state.orbits + 1));
    $('orbit-minus').addEventListener('click', () => setOrbits(state.orbits - 1));
    $('clear-btn').addEventListener('click', () => {
      state.grid = []; ensureGrid(state.orbits); redrawSatellites();
      for (const i of [...state.rings]) toggleRing(i);
      syncHash();
    });
    $('bpm').addEventListener('input', (e) => {
      state.bpm = +e.target.value; $('bpm-label').textContent = state.bpm; AudioEngine.setBpm(state.bpm);
    });
    $('bpm').addEventListener('change', () => { AudioEngine.resyncRings(); syncHash(); });
    $('planet-btn').addEventListener('click', () => { buildPlanetList(); $('picker').classList.remove('hidden'); });
    $('share-btn').addEventListener('click', () => {
      syncHash(); $('share-url').value = location.href; $('share').classList.remove('hidden');
    });
    $('copy-btn').addEventListener('click', async () => {
      const url = $('share-url').value;
      if (navigator.share) { try { await navigator.share({ title: state.planet.name, url }); return; } catch (e) { /* отмена */ } }
      try { await navigator.clipboard.writeText(url); hint('Ссылка скопирована'); } catch (e) { $('share-url').select(); }
    });
    $('editor-open').addEventListener('click', () => { $('picker').classList.add('hidden'); if (window.Editor) Editor.open(); });
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden')));
    bindPointer();
    window.Orbital = {
      applyPlanet: (cfg, base) => applyPlanet(cfg, base, null, cfg.id || 'draft'),
      current: () => ({ cfg: state.planet, base: state.base }),
      hint, setPlaying, isReady: () => !$('start').classList.contains('hidden'),
    };
    if (wantEdit && window.Editor) Editor.open();
  }

  boot().catch(err => { console.error(err); $('load-status').textContent = 'ошибка: ' + err.message; });
})();
