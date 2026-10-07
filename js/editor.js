/* Редактор планет: работает в браузере, черновик хранится в IndexedDB, результат — ZIP с папкой планеты. */
const Editor = (() => {
  const $ = (id) => document.getElementById(id);
  const DB = 'orbital-editor', STORE = 'drafts', KEY = 'current';
  const MAX_SAMPLES = 12, MAX_RINGS = 8;
  const PALETTE = ['#ff4d3d', '#ffb347', '#fff1c2', '#ffe08a', '#ff8fb1', '#d98cff', '#6fd3ff', '#3fb0ff', '#7cff8a', '#c8c8c8', '#ff9a5c', '#9cff7a'];
  let draft = null;
  let urlCache = new Map();
  let saveTimer = null;
  let previewEl = null;
  let previewKey = null;

  // ---------- Хранилище ----------
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(k) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction(STORE, 'readonly').objectStore(STORE).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
  }
  async function idbSet(k, v) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); });
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => idbSet(KEY, draft).catch(e => console.warn('draft save', e)), 400);
  }

  function blank() {
    return {
      id: 'my-planet', name: 'Моя планета', track: '', bpm: 110, trackUrl: '',
      colors: { accent: '#ff7a3d', orbit: '#8f7a6b', ray: '#fff1c2', text: '#fff4e6' },
      texture: null, background: null, samples: [], rings: [],
    };
  }

  function urlOf(file) {
    if (!file || !file.blob) return '';
    if (!urlCache.has(file.blob)) urlCache.set(file.blob, URL.createObjectURL(file.blob));
    return urlCache.get(file.blob);
  }

  function fileEntry(f) { return { name: f.name, type: f.type || '', blob: f }; }

  function ext(file) {
    const m = /\.([a-z0-9]+)$/i.exec(file.name || '');
    if (m) return m[1].toLowerCase();
    const t = (file.type || '').split('/')[1] || 'bin';
    return { mpeg: 'mp3', 'x-m4a': 'm4a', jpeg: 'jpg' }[t] || t;
  }

  const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  function slug(s) {
    return (s || '').toLowerCase().split('').map(c => TR[c] !== undefined ? TR[c] : c).join('')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  }

  function barSeconds() { return 240 / (draft.bpm || 110); }

  async function measure(entry) {
    if (!entry || entry.dur) return;
    await new Promise((res) => {
      const a = new Audio(); a.preload = 'metadata';
      a.onloadedmetadata = () => { entry.dur = a.duration; res(); };
      a.onerror = () => res();
      a.src = urlOf(entry);
    });
  }

  // ---------- Разметка ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function fileBtn(kind, idx, entry, accept) {
    const label = entry ? esc(entry.name) : 'Выбрать файл';
    return `<label class="filebtn ${entry ? 'has' : ''}"><input type="file" accept="${accept}" data-file="${kind}" data-i="${idx}"><span>${label}</span></label>`;
  }

  function imgPreview(entry) {
    return entry ? `<img class="thumb" src="${urlOf(entry)}" alt="">` : `<span class="thumb empty"></span>`;
  }

  function sampleRow(s, i) {
    return `<div class="erow" data-i="${i}">
      <input type="color" value="${s.color}" data-field="samples.${i}.color" aria-label="Цвет">
      <input type="text" value="${esc(s.name)}" placeholder="Название" data-field="samples.${i}.name">
      ${fileBtn('sample', i, s.file, 'audio/*')}
      <button type="button" class="ibtn" data-play="sample" data-i="${i}" aria-label="Прослушать" ${s.file ? '' : 'disabled'}>▶</button>
      <button type="button" class="ibtn" data-remove="sample" data-i="${i}" aria-label="Удалить">✕</button>
    </div>`;
  }

  function ringRow(r, i) {
    let durHint = '';
    if (r.file && r.file.dur) {
      const bars = r.file.dur / barSeconds();
      const near = Math.max(1, Math.round(bars));
      const ok = Math.abs(bars - near) < 0.06;
      durHint = `<span class="dur ${ok ? '' : 'warn'}">${r.file.dur.toFixed(2)} с ≈ ${bars.toFixed(2)} такт.${ok ? '' : ' Длина не кратна такту, луп будет подрезан до ' + near + '.'}</span>`;
    }
    return `<div class="erow ring" data-i="${i}">
      <input type="color" value="${r.color}" data-field="rings.${i}.color" aria-label="Цвет">
      <input type="text" value="${esc(r.name)}" placeholder="Название" data-field="rings.${i}.name">
      <select data-field="rings.${i}.bars" aria-label="Тактов">${[1, 2, 4, 8, 16].map(b => `<option value="${b}" ${+r.bars === b ? 'selected' : ''}>${b} т.</option>`).join('')}</select>
      ${fileBtn('ring', i, r.file, 'audio/*')}
      <button type="button" class="ibtn" data-play="ring" data-i="${i}" aria-label="Прослушать" ${r.file ? '' : 'disabled'}>▶</button>
      <button type="button" class="ibtn" data-remove="ring" data-i="${i}" aria-label="Удалить">✕</button>
      ${durHint}
    </div>`;
  }

  function render() {
    const d = draft;
    $('editor-card').innerHTML = `
      <div class="ehead"><h2>Редактор планеты</h2><button type="button" class="ibtn" data-act="close" aria-label="Закрыть">✕</button></div>

      <section class="esec">
        <h3>Основное</h3>
        <div class="egrid">
          <label>Название<input type="text" value="${esc(d.name)}" data-field="name"></label>
          <label>Название песни (подпись)<input type="text" value="${esc(d.track || '')}" data-field="track"></label>
          <label>Темп, bpm<input type="number" min="40" max="240" value="${d.bpm}" data-field="bpm"></label>
          <label>Папка (латиницей)<input type="text" value="${esc(d.id)}" data-field="id" pattern="[a-z0-9\\-]+"></label>
          <label class="wide">Ссылка на трек<input type="url" value="${esc(d.trackUrl)}" data-field="trackUrl" placeholder="https://"></label>
        </div>
      </section>

      <section class="esec">
        <h3>Внешний вид</h3>
        <div class="erow">
          ${imgPreview(d.texture)}
          <div class="col"><span class="lbl">Текстура планеты (квадрат, разворачивается на шар)</span>${fileBtn('texture', 0, d.texture, 'image/*')}</div>
        </div>
        <div class="erow">
          ${imgPreview(d.background)}
          <div class="col"><span class="lbl">Фон экрана</span>${fileBtn('background', 0, d.background, 'image/*')}</div>
        </div>
        <div class="colors">
          <label>Акцент<input type="color" value="${d.colors.accent}" data-field="colors.accent"></label>
          <label>Орбиты<input type="color" value="${d.colors.orbit}" data-field="colors.orbit"></label>
          <label>Луч<input type="color" value="${d.colors.ray}" data-field="colors.ray"></label>
          <label>Текст<input type="color" value="${d.colors.text}" data-field="colors.text"></label>
        </div>
      </section>

      <section class="esec">
        <h3>Звуки ударки <span class="cnt">${d.samples.length} / ${MAX_SAMPLES}</span></h3>
        <p class="lbl">Короткие удары до секунды: бочка, снейр, хэты, перкуссия, вокальные обрезки.</p>
        <div class="rows">${d.samples.map(sampleRow).join('')}</div>
        <button type="button" class="btn" data-act="add-sample" ${d.samples.length >= MAX_SAMPLES ? 'disabled' : ''}>+ Добавить звук</button>
      </section>

      <section class="esec">
        <h3>Звуки колец <span class="cnt">${d.rings.length} / ${MAX_RINGS}</span></h3>
        <p class="lbl">Лупы ровно на 1, 2, 4 или 8 тактов в темпе ${d.bpm} bpm: пад, бас, вокал, арпеджио.</p>
        <div class="rows">${d.rings.map(ringRow).join('')}</div>
        <button type="button" class="btn" data-act="add-ring" ${d.rings.length >= MAX_RINGS ? 'disabled' : ''}>+ Добавить кольцо</button>
      </section>

      <section class="esec actions-col">
        <button type="button" class="btn primary" data-act="apply">Проверить в сцене</button>
        <button type="button" class="btn" data-act="set-preset">Сделать текущий бит стартовым</button>
        <p class="lbl">${d.preset ? 'Стартовый бит задан: с ним планета откроется у слушателя.' : 'Стартовый бит не задан: планета откроется с пустыми орбитами.'}</p>
        <button type="button" class="btn" data-act="zip">Скачать ZIP планеты</button>
        <button type="button" class="btn" data-act="from-current">Взять за основу текущую планету</button>
        <button type="button" class="btn danger" data-act="reset">Очистить черновик</button>
        <p class="lbl">Черновик сохраняется в этом браузере сам. ZIP распаковывается в папку <code>planets/</code>, строка для <code>index.json</code> лежит внутри архива.</p>
      </section>`;
  }

  // ---------- Обработка ----------
  function setField(path, value) {
    const parts = path.split('.');
    let o = draft;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    const last = parts[parts.length - 1];
    if (last === 'bpm' || last === 'bars') value = Math.max(1, parseInt(value, 10) || 0);
    if (last === 'id') value = slug(value);
    o[last] = value;
    scheduleSave();
  }

  async function onFile(kind, i, f) {
    const entry = fileEntry(f);
    if (kind === 'texture') draft.texture = entry;
    else if (kind === 'background') draft.background = entry;
    else if (kind === 'sample') { draft.samples[i].file = entry; if (!draft.samples[i].name) draft.samples[i].name = f.name.replace(/\.[^.]+$/, ''); }
    else if (kind === 'ring') {
      draft.rings[i].file = entry;
      if (!draft.rings[i].name) draft.rings[i].name = f.name.replace(/\.[^.]+$/, '');
      await measure(entry);
      const bars = entry.dur ? Math.max(1, Math.round(entry.dur / barSeconds())) : draft.rings[i].bars;
      draft.rings[i].bars = [1, 2, 4, 8, 16].includes(bars) ? bars : draft.rings[i].bars;
    }
    scheduleSave();
    render();
  }

  function togglePreview(kind, i) {
    const row = kind === 'sample' ? draft.samples[i] : draft.rings[i];
    if (!row || !row.file) return;
    const key = kind + i;
    if (previewEl && previewKey === key) { previewEl.pause(); previewEl = null; previewKey = null; return; }
    if (previewEl) previewEl.pause();
    previewEl = new Audio(urlOf(row.file)); previewKey = key;
    previewEl.loop = kind === 'ring';
    previewEl.play().catch(() => {});
    previewEl.onended = () => { previewEl = null; previewKey = null; };
  }

  function buildConfig() {
    const d = draft;
    const samples = d.samples.filter(s => s.file).map((s, i) => ({ id: slug(s.name) || 'd' + i, name: s.name || 'Звук ' + (i + 1), file: urlOf(s.file), color: s.color }));
    const rings = d.rings.filter(r => r.file).map((r, i) => ({ id: slug(r.name) || 'r' + i, name: r.name || 'Кольцо ' + (i + 1), file: urlOf(r.file), bars: +r.bars || 4, color: r.color }));
    return {
      id: d.id || 'draft', name: d.name || 'Планета', track: d.track || '', bpm: +d.bpm || 110, trackUrl: d.trackUrl,
      texture: d.texture ? urlOf(d.texture) : null, background: d.background ? urlOf(d.background) : null,
      colors: Object.assign({}, d.colors), samples, rings, preset: d.preset || null,
    };
  }

  async function apply() {
    const cfg = buildConfig();
    if (!cfg.samples.length) { Orbital.hint('Добавь хотя бы один звук ударки', 2500); return; }
    close();
    $('editor-return').classList.remove('hidden');
    await Orbital.applyPlanet(cfg, '');
  }

  async function exportZip() {
    if (typeof JSZip === 'undefined') { Orbital.hint('Библиотека ZIP не загрузилась', 2500); return; }
    const d = draft;
    const id = slug(d.id) || 'planet';
    const zip = new JSZip();
    const folder = zip.folder(id);
    const cfg = {
      id, name: d.name, track: d.track || '', bpm: +d.bpm || 110, trackUrl: d.trackUrl,
      texture: null, background: null, colors: Object.assign({}, d.colors), samples: [], rings: [],
    };
    if (d.texture) { cfg.texture = 'planet.' + ext(d.texture); folder.file(cfg.texture, d.texture.blob); }
    if (d.background) { cfg.background = 'bg.' + ext(d.background); folder.file(cfg.background, d.background.blob); }
    d.samples.filter(s => s.file).forEach((s, i) => {
      const base = slug(s.name) || 'drum';
      const file = `samples/d${String(i + 1).padStart(2, '0')}-${base}.${ext(s.file)}`;
      folder.file(file, s.file.blob);
      cfg.samples.push({ id: base, name: s.name || 'Звук ' + (i + 1), file, color: s.color });
    });
    d.rings.filter(r => r.file).forEach((r, i) => {
      const base = slug(r.name) || 'ring';
      const file = `samples/r${String(i + 1).padStart(2, '0')}-${base}.${ext(r.file)}`;
      folder.file(file, r.file.blob);
      cfg.rings.push({ id: base, name: r.name || 'Кольцо ' + (i + 1), file, bars: +r.bars || 4, color: r.color });
    });
    if (d.preset) cfg.preset = d.preset;
    folder.file('planet.json', JSON.stringify(cfg, null, 2));
    folder.file('README.txt', `Папку "${id}" положить в planets/ рядом с остальными.\nВ planets/index.json добавить строку:\n\n    { "id": "${id}", "name": ${JSON.stringify(d.name)}, "track": ${JSON.stringify(d.track || '')} }\n`);
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${id}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    Orbital.hint('ZIP собран', 2000);
  }

  async function fromCurrent() {
    const cur = Orbital.current();
    if (!cur.cfg) return;
    Orbital.hint('Копирую файлы планеты…', 60000);
    const grab = async (file) => { const r = await fetch(cur.base + file); const b = await r.blob(); return { name: file.split('/').pop(), type: b.type, blob: b }; };
    const d = blank();
    const c = cur.cfg;
    d.id = slug(c.id + '-copy'); d.name = c.name; d.track = c.track || ''; d.bpm = c.bpm || 110; d.trackUrl = c.trackUrl || '';
    d.colors = Object.assign(d.colors, c.colors || {});
    d.preset = c.preset || null;
    if (c.texture) d.texture = await grab(c.texture);
    if (c.background) d.background = await grab(c.background);
    for (const s of c.samples) d.samples.push({ name: s.name, color: s.color, file: await grab(s.file) });
    for (const r of c.rings) { const f = await grab(r.file); await measure(f); d.rings.push({ name: r.name, color: r.color, bars: r.bars || 4, file: f }); }
    draft = d; scheduleSave(); render();
    Orbital.hint('Готово, редактируй', 1500);
  }

  function bind() {
    const card = $('editor-card');
    card.addEventListener('input', (e) => {
      const f = e.target.dataset.field; if (f) setField(f, e.target.value);
    });
    card.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.dataset.file && t.files && t.files[0]) await onFile(t.dataset.file, +t.dataset.i, t.files[0]);
      else if (t.dataset.field && t.tagName === 'SELECT') { setField(t.dataset.field, t.value); render(); }
      else if (t.dataset.field === 'bpm') render();
    });
    card.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.play) { togglePreview(b.dataset.play, +b.dataset.i); return; }
      if (b.dataset.remove) {
        const list = b.dataset.remove === 'sample' ? draft.samples : draft.rings;
        list.splice(+b.dataset.i, 1); scheduleSave(); render(); return;
      }
      switch (b.dataset.act) {
        case 'close': close(); break;
        case 'add-sample': draft.samples.push({ name: '', color: PALETTE[draft.samples.length % PALETTE.length], file: null }); scheduleSave(); render(); break;
        case 'add-ring': draft.rings.push({ name: '', color: PALETTE[(draft.rings.length + 5) % PALETTE.length], bars: 4, file: null }); scheduleSave(); render(); break;
        case 'apply': await apply(); break;
        case 'set-preset': draft.preset = Orbital.currentBeat(); scheduleSave(); render(); Orbital.hint('Текущий бит сохранён как стартовый', 1800); break;
        case 'zip': await exportZip(); break;
        case 'from-current': await fromCurrent(); break;
        case 'reset': if (confirm('Удалить черновик вместе с файлами?')) { draft = blank(); scheduleSave(); render(); } break;
      }
    });
    $('editor-return').addEventListener('click', open);
  }

  let bound = false;
  async function open() {
    if (!bound) { bind(); bound = true; }
    if (!draft) {
      try { draft = await idbGet(KEY); } catch (e) { draft = null; }
      if (!draft) draft = blank();
      for (const r of draft.rings) if (r.file) await measure(r.file);
    }
    render();
    $('editor').classList.remove('hidden');
  }

  function close() {
    if (previewEl) { previewEl.pause(); previewEl = null; previewKey = null; }
    $('editor').classList.add('hidden');
  }

  return { open, close };
})();
