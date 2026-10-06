/* Микшер: громкость и эффекты для каждого кольца и звука ударки, мастер-секция, сохранение в ссылку. */
const Mixer = (() => {
  const $ = (id) => document.getElementById(id);
  let planet = null;
  let view = 'r';            // 'r' — кольца, 'd' — ударка
  let openFx = null;         // ключ канала с раскрытыми эффектами
  let onChange = () => {};
  let onRingToggle = () => {};
  let ringState = () => false;
  let raf = 0;

  const FX = [
    { k: 'filter', label: 'Фильтр', fmt: v => v >= 0.995 ? 'откр.' : Math.round(120 * Math.pow(20000 / 120, v)) + ' Гц' },
    { k: 'drive', label: 'Драйв', fmt: v => Math.round(v * 100) + '%' },
    { k: 'reverb', label: 'Реверб', fmt: v => Math.round(v * 100) + '%' },
    { k: 'delay', label: 'Дилей', fmt: v => Math.round(v * 100) + '%' },
  ];
  const DELAY_LABELS = ['1/16', '1/8', '1/8.', '1/4'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function dbFmt(v) { return (v > 0 ? '+' : '') + Math.round(v) + ' дБ'; }
  function pct(v, min, max) { return ((v - min) / (max - min) * 100).toFixed(1) + '%'; }

  function slider(attrs, value, min, max, step) {
    return `<input type="range" ${attrs} min="${min}" max="${max}" step="${step}" value="${value}" style="--val:${pct(value, min, max)}">`;
  }

  // ---------- Каналы ----------
  function channelList() {
    const list = view === 'r' ? planet.rings : planet.samples;
    return list.map((c, i) => ({ key: view + i, i, cfg: c }));
  }

  function rowHtml({ key, i, cfg }) {
    const p = AudioEngine.getChannel(key) || AudioEngine.channelDefaults(key);
    const isRing = key[0] === 'r';
    const on = isRing && ringState(i);
    const fxOpen = openFx === key;
    const fxUsed = p.filter < 0.995 || p.drive > 0.01 || p.reverb > 0.01 || p.delay > 0.01;
    return `<div class="mrow ${fxOpen ? 'open' : ''} ${p.mute ? 'muted' : ''}" data-key="${key}" style="--c:${cfg.color}">
      <div class="mhead">
        ${isRing ? `<button type="button" class="power ${on ? 'on' : ''}" data-act="power" data-i="${i}" aria-label="${on ? 'Выключить' : 'Включить'} кольцо" aria-pressed="${on}"></button>` : `<span class="cdot"></span>`}
        <span class="mname">${esc(cfg.name)}</span>
        <span class="mval" data-out="vol">${dbFmt(p.vol)}</span>
        <button type="button" class="tbtn ${p.mute ? 'act' : ''}" data-act="mute" aria-pressed="${p.mute}" aria-label="Заглушить">M</button>
        <button type="button" class="tbtn ${fxOpen ? 'act' : ''} ${fxUsed ? 'used' : ''}" data-act="fx" aria-expanded="${fxOpen}">FX</button>
      </div>
      <div class="mfader">
        ${slider(`data-p="vol" aria-label="Громкость ${esc(cfg.name)}"`, p.vol, -40, 6, 1)}
        <span class="meter"><i data-meter="${key}"></i></span>
      </div>
      ${fxOpen ? `<div class="mfx">
        ${FX.map(f => `<label class="knob"><span>${f.label}<b data-out="${f.k}">${f.fmt(p[f.k])}</b></span>${slider(`data-p="${f.k}"`, p[f.k], 0, 1, 0.01)}</label>`).join('')}
        <button type="button" class="linkbtn" data-act="reset">Сбросить канал</button>
      </div>` : ''}
    </div>`;
  }

  function render() {
    if (!planet) return;
    const box = $('mixer');
    box.innerHTML = `
      <div class="seg" role="tablist">
        <button type="button" role="tab" class="${view === 'r' ? 'on' : ''}" data-view="r" aria-selected="${view === 'r'}">Кольца</button>
        <button type="button" role="tab" class="${view === 'd' ? 'on' : ''}" data-view="d" aria-selected="${view === 'd'}">Ударка</button>
      </div>
      <div class="mlist">${channelList().map(rowHtml).join('')}</div>`;
  }

  function renderMaster() {
    const p = AudioEngine.getMaster();
    $('master').innerHTML = `
      <div class="mgrid">
        <label class="knob"><span>Громкость<b data-mout="vol">${dbFmt(p.vol)}</b></span>${slider('data-m="vol"', p.vol, -30, 6, 1)}</label>
        <label class="knob"><span>Фильтр<b data-mout="filter">${FX[0].fmt(p.filter)}</b></span>${slider('data-m="filter"', p.filter, 0, 1, 0.01)}</label>
        <label class="knob"><span>Размер реверба<b data-mout="size">${Math.round(p.size * 100)}%</b></span>${slider('data-m="size"', p.size, 0, 1, 0.01)}</label>
        <label class="knob"><span>Повторы дилея<b data-mout="feedback">${Math.round(p.feedback * 100)}%</b></span>${slider('data-m="feedback"', p.feedback, 0, 0.85, 0.01)}</label>
        <label class="knob"><span>Ширина стерео<b data-mout="width">${Math.round(p.width * 100)}%</b></span>${slider('data-m="width"', p.width, 0, 1, 0.01)}</label>
        <div class="knob"><span>Шаг дилея</span>
          <div class="seg small">${DELAY_LABELS.map((l, i) => `<button type="button" class="${Math.round(p.time) === i ? 'on' : ''}" data-mtime="${i}">${l}</button>`).join('')}</div>
        </div>
      </div>
      <div class="mfoot">
        <span class="meter wide"><i data-meter="master"></i></span>
        <button type="button" class="linkbtn" data-act="master-reset">Сбросить мастер</button>
      </div>`;
  }

  function updateSliderFill(el) {
    el.style.setProperty('--val', pct(+el.value, +el.min, +el.max));
  }

  // ---------- События ----------
  function bind() {
    const box = $('mixer');
    box.addEventListener('input', (e) => {
      const el = e.target; if (!el.dataset.p) return;
      const row = el.closest('.mrow'); const key = row.dataset.key;
      const v = +el.value;
      AudioEngine.setChannel(key, { [el.dataset.p]: v });
      updateSliderFill(el);
      const out = row.querySelector(`[data-out="${el.dataset.p}"]`);
      if (out) out.textContent = el.dataset.p === 'vol' ? dbFmt(v) : FX.find(f => f.k === el.dataset.p).fmt(v);
      if (el.dataset.p !== 'vol') {
        const p = AudioEngine.getChannel(key);
        const used = p.filter < 0.995 || p.drive > 0.01 || p.reverb > 0.01 || p.delay > 0.01;
        row.querySelector('[data-act="fx"]').classList.toggle('used', used);
      }
      onChange();
    });
    box.addEventListener('click', (e) => {
      const v = e.target.closest('[data-view]');
      if (v) { view = v.dataset.view; openFx = null; render(); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      const row = b.closest('.mrow'); const key = row && row.dataset.key;
      switch (b.dataset.act) {
        case 'power': onRingToggle(+b.dataset.i); render(); break;
        case 'mute': {
          const p = AudioEngine.getChannel(key);
          AudioEngine.setChannel(key, { mute: !p.mute }); render(); onChange(); break;
        }
        case 'fx': openFx = openFx === key ? null : key; render(); break;
        case 'reset': AudioEngine.resetChannel(key); render(); onChange(); break;
      }
    });

    const m = $('master');
    m.addEventListener('input', (e) => {
      const el = e.target; if (!el.dataset.m) return;
      const v = +el.value;
      AudioEngine.setMaster({ [el.dataset.m]: v });
      updateSliderFill(el);
      const out = m.querySelector(`[data-mout="${el.dataset.m}"]`);
      if (out) out.textContent = el.dataset.m === 'vol' ? dbFmt(v) : el.dataset.m === 'filter' ? FX[0].fmt(v) : Math.round(v * 100) + '%';
      onChange();
    });
    m.addEventListener('click', (e) => {
      const t = e.target.closest('[data-mtime]');
      if (t) { AudioEngine.setMaster({ time: +t.dataset.mtime }); renderMaster(); onChange(); return; }
      const b = e.target.closest('[data-act="master-reset"]');
      if (b) { AudioEngine.setMaster(Object.assign({}, AudioEngine.MASTER_DEFAULT)); renderMaster(); onChange(); }
    });
  }

  // ---------- Индикаторы уровня ----------
  function meters() {
    document.querySelectorAll('[data-meter]').forEach(el => {
      const k = el.dataset.meter;
      const lv = k === 'master' ? AudioEngine.masterLevel() : AudioEngine.level(k);
      el.style.transform = `scaleX(${lv.toFixed(3)})`;
    });
    raf = requestAnimationFrame(meters);
  }

  // ---------- Ссылка ----------
  // m=r0.-6.0.100.0.20.0~d3...  (vol дБ, mute 0/1, filter, drive, reverb, delay в процентах)
  function encode() {
    const parts = [];
    for (const key of AudioEngine.channelKeys()) {
      const p = AudioEngine.getChannel(key), d = AudioEngine.channelDefaults(key);
      const same = Math.round(p.vol) === Math.round(d.vol) && !p.mute && p.filter >= 0.995 && p.drive < 0.01 && p.reverb < 0.01 && p.delay < 0.01;
      if (same) continue;
      parts.push([key, Math.round(p.vol), p.mute ? 1 : 0, Math.round(p.filter * 100), Math.round(p.drive * 100), Math.round(p.reverb * 100), Math.round(p.delay * 100)].join('.'));
    }
    const mp = AudioEngine.getMaster(), md = AudioEngine.MASTER_DEFAULT;
    const mx = [Math.round(mp.vol), Math.round(mp.filter * 100), Math.round(mp.size * 100), Math.round(mp.time), Math.round(mp.feedback * 100), Math.round(mp.width * 100)];
    const mdef = [md.vol, md.filter * 100, md.size * 100, md.time, md.feedback * 100, md.width * 100].map(Math.round);
    return { m: parts.join('~'), x: mx.join('.') === mdef.join('.') ? '' : mx.join('.') };
  }

  function apply(m, x) {
    if (m) for (const part of m.split('~')) {
      const [key, vol, mute, filter, drive, reverb, delay] = part.split('.');
      if (!AudioEngine.getChannel(key)) continue;
      AudioEngine.setChannel(key, { vol: +vol || 0, mute: mute === '1', filter: (+filter || 0) / 100, drive: (+drive || 0) / 100, reverb: (+reverb || 0) / 100, delay: (+delay || 0) / 100 });
    }
    if (x) {
      const [vol, filter, size, time, feedback, width] = x.split('.').map(Number);
      AudioEngine.setMaster({ vol, filter: filter / 100, size: size / 100, time, feedback: feedback / 100, width: width / 100 });
    } else {
      AudioEngine.setMaster(Object.assign({}, AudioEngine.MASTER_DEFAULT));
    }
  }

  let bound = false;
  function setPlanet(p, opts) {
    planet = p; openFx = null;
    onChange = opts.onChange || onChange;
    onRingToggle = opts.onRingToggle || onRingToggle;
    ringState = opts.ringState || ringState;
    if (!bound) { bind(); bound = true; cancelAnimationFrame(raf); meters(); }
    render(); renderMaster();
  }

  return { setPlanet, render, renderMaster, encode, apply };
})();
