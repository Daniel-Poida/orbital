/* Звук: Tone.js. Шаговый секвенсор, кольца-лупы, микшер с эффектами на каждом канале и мастер. */
const AudioEngine = (() => {
  const STEPS = 16;
  let players = [];
  let ringPlayers = [];
  let ringCfgs = [];
  let strips = new Map();      // 'd0', 'r3' -> канальная линейка
  let activeRings = new Set();
  let seq = null;
  let planetBpm = 110;
  let gridFn = () => [];
  let onStep = () => {};
  let unlocked = false;
  let master = null;

  // Значения по умолчанию для канала. Всё в диапазоне 0..1, кроме vol (дБ).
  const CH_DEFAULT = { vol: 0, mute: false, filter: 1, drive: 0, reverb: 0, delay: 0 };
  const MASTER_DEFAULT = { vol: 0, filter: 1, size: 0.4, time: 1, feedback: 0.35, width: 0.5 };
  const DELAY_TIMES = ['16n', '8n', '8n.', '4n'];

  // Разблокировка звука по первому жесту. Вызывается синхронно из обработчика нажатия
  // и никогда не блокирует интерфейс: в Safari промисы play()/resume() могут не завершаться.
  function unlock() {
    if (unlocked) return Promise.resolve();
    unlocked = true;
    const raw = Tone.getContext().rawContext;
    // iOS: тихий буфер, проигранный внутри жеста, окончательно будит AudioContext.
    try {
      const b = raw.createBuffer(1, 1, raw.sampleRate || 44100);
      const src = raw.createBufferSource(); src.buffer = b; src.connect(raw.destination); src.start(0);
    } catch (e) { /* не критично */ }
    // iOS: HTML-аудио переводит сессию в режим «воспроизведение», звук идёт и при беззвучном режиме.
    const el = document.getElementById('unlock');
    if (el) { try { const p = el.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* не критично */ } }
    const started = Promise.resolve().then(() => Tone.start()).catch(() => {});
    const timeout = new Promise(res => setTimeout(res, 1500));
    return Promise.race([started, timeout]);
  }

  function isUnlocked() { return unlocked && Tone.context.state === 'running'; }

  function cutoff(x) { return 120 * Math.pow(20000 / 120, Math.max(0, Math.min(1, x))); }

  function buildMaster() {
    if (master) return master;
    const limiter = new Tone.Limiter(-1).toDestination();
    const out = new Tone.Volume(0).connect(limiter);
    const filter = new Tone.Filter({ type: 'lowpass', frequency: 20000, rolloff: -24, Q: 0.7 }).connect(out);
    const widener = new Tone.StereoWidener(0.5).connect(filter);
    const bus = new Tone.Gain(0.85).connect(widener);
    const reverb = new Tone.Reverb({ decay: 3, preDelay: 0.02, wet: 1 }).connect(widener);
    const delay = new Tone.PingPongDelay({ delayTime: '8n', feedback: 0.35, wet: 1 }).connect(widener);
    const meter = new Tone.Meter({ smoothing: 0.8 });
    out.connect(meter);
    master = { limiter, out, filter, widener, bus, reverb, delay, meter, params: Object.assign({}, MASTER_DEFAULT) };
    return master;
  }

  function makeStrip(key, defVol) {
    const m = buildMaster();
    const filter = new Tone.Filter({ type: 'lowpass', frequency: 20000, rolloff: -12, Q: 1 });
    const drive = new Tone.Distortion({ distortion: 0, wet: 0, oversample: '2x' });
    const vol = new Tone.Volume(defVol);
    const revSend = new Tone.Gain(0);
    const dlySend = new Tone.Gain(0);
    const meter = new Tone.Meter({ smoothing: 0.7 });
    filter.connect(drive); drive.connect(vol);
    vol.connect(m.bus); vol.connect(revSend); vol.connect(dlySend); vol.connect(meter);
    revSend.connect(m.reverb); dlySend.connect(m.delay);
    const s = { key, input: filter, filter, drive, vol, revSend, dlySend, meter, params: Object.assign({}, CH_DEFAULT, { vol: defVol }) };
    strips.set(key, s);
    return s;
  }

  function applyStrip(s) {
    const p = s.params;
    const now = Tone.now();
    s.vol.volume.rampTo(p.vol, 0.05, now);
    s.vol.mute = !!p.mute;
    s.filter.frequency.rampTo(cutoff(p.filter), 0.05, now);
    s.drive.distortion = 0.15 + 0.85 * p.drive;
    s.drive.wet.rampTo(p.drive > 0.01 ? Math.min(1, 0.35 + p.drive) : 0, 0.05, now);
    s.revSend.gain.rampTo(p.reverb * 0.9, 0.05, now);
    s.dlySend.gain.rampTo(p.delay * 0.7, 0.05, now);
  }

  function dispose() {
    stop();
    if (seq) { seq.dispose(); seq = null; }
    for (const p of players) p.dispose();
    for (const p of ringPlayers) p.dispose();
    for (const s of strips.values()) for (const n of [s.filter, s.drive, s.vol, s.revSend, s.dlySend, s.meter]) n.dispose();
    strips.clear();
    players = []; ringPlayers = []; ringCfgs = []; activeRings.clear();
  }

  async function load(planet, baseUrl, onProgress) {
    dispose();
    buildMaster();
    planetBpm = planet.bpm || 110;
    Tone.Transport.bpm.value = planetBpm;
    let done = 0;
    const total = planet.samples.length + planet.rings.length;
    const tick = () => { done++; if (onProgress) onProgress(done, total); };
    players = planet.samples.map((s, i) => {
      const strip = makeStrip('d' + i, typeof s.gain === 'number' ? s.gain : 0);
      return new Tone.Player({ url: baseUrl + s.file, onload: tick, fadeOut: 0.01 }).connect(strip.input);
    });
    ringCfgs = planet.rings;
    ringPlayers = planet.rings.map((r, i) => {
      // stretch (по умолчанию): гранулярное растяжение, высота тона не меняется при смене темпа.
      // resample: обычное ускорение, как на пластинке.
      const strip = makeStrip('r' + i, typeof r.gain === 'number' ? r.gain : -4);
      const url = baseUrl + r.file;
      const p = r.mode === 'resample'
        ? new Tone.Player({ url, onload: tick, loop: true, fadeIn: 0.02, fadeOut: 0.05 })
        : new Tone.GrainPlayer({ url, onload: tick, loop: true, grainSize: r.grainSize || 0.16, overlap: r.overlap || 0.08 });
      return p.connect(strip.input);
    });
    await Tone.loaded();
    ringPlayers.forEach((p, i) => {
      const want = (ringCfgs[i].bars || 4) * 240 / planetBpm;
      if (p.buffer && p.buffer.duration > want + 0.02) p.loopEnd = want;
    });
    seq = new Tone.Sequence((time, step) => {
      const hits = gridFn(step);
      const fired = new Set();
      for (const h of hits) {
        if (fired.has(h.sample)) continue;
        fired.add(h.sample);
        const p = players[h.sample];
        if (p && p.loaded) { try { p.start(time); } catch (e) { /* повторный старт в то же время */ } }
      }
      Tone.Draw.schedule(() => onStep(step, hits), time);
    }, [...Array(STEPS).keys()], '16n');
    seq.start(0);
  }

  // ---------- Микшер ----------
  function getChannel(key) { const s = strips.get(key); return s ? Object.assign({}, s.params) : null; }
  function setChannel(key, patch) {
    const s = strips.get(key); if (!s) return;
    Object.assign(s.params, patch);
    applyStrip(s);
  }
  function resetChannel(key) {
    const s = strips.get(key); if (!s) return;
    const isRing = key[0] === 'r';
    const cfg = isRing ? ringCfgs[+key.slice(1)] : null;
    s.params = Object.assign({}, CH_DEFAULT, { vol: isRing ? (cfg && typeof cfg.gain === 'number' ? cfg.gain : -4) : 0 });
    applyStrip(s);
  }
  function channelKeys() { return [...strips.keys()]; }
  function channelDefaults(key) {
    const isRing = key[0] === 'r';
    return Object.assign({}, CH_DEFAULT, { vol: isRing ? -4 : 0 });
  }
  function level(key) {
    const s = strips.get(key); if (!s) return 0;
    const db = s.meter.getValue();
    return Math.max(0, Math.min(1, (db + 48) / 48));
  }

  function getMaster() { return Object.assign({}, buildMaster().params); }
  function setMaster(patch) {
    const m = buildMaster();
    Object.assign(m.params, patch);
    const p = m.params, now = Tone.now();
    m.out.volume.rampTo(p.vol, 0.05, now);
    m.filter.frequency.rampTo(cutoff(p.filter), 0.08, now);
    m.widener.width.rampTo(p.width, 0.05, now);
    m.delay.feedback.rampTo(Math.min(0.85, p.feedback), 0.05, now);
    m.delay.delayTime.value = DELAY_TIMES[Math.max(0, Math.min(DELAY_TIMES.length - 1, Math.round(p.time)))];
    const decay = 0.8 + p.size * 7.2;
    if (Math.abs(m.reverb.decay - decay) > 0.05) m.reverb.decay = decay;
  }
  function masterLevel() {
    const m = buildMaster(); const db = m.meter.getValue();
    return Math.max(0, Math.min(1, (db + 48) / 48));
  }

  // ---------- Транспорт ----------
  function setGrid(fn) { gridFn = fn; }
  function setOnStep(fn) { onStep = fn; }
  function barSecondsNative() { return 240 / planetBpm; }

  function ringOffset(i) {
    const bars = ringCfgs[i].bars || 4;
    const barsElapsed = Tone.Transport.ticks / (Tone.Transport.PPQ * 4);
    return (barsElapsed % bars) * barSecondsNative();
  }

  function start() {
    if (Tone.Transport.state === 'started') return;
    const t = Tone.now() + 0.08;
    Tone.Transport.start(t);
    for (const i of activeRings) { const p = ringPlayers[i]; if (p && p.loaded) p.start(t, 0); }
  }

  function stop() {
    for (const p of ringPlayers) if (p.state === 'started') p.stop();
    Tone.Transport.stop();
    Tone.Transport.position = 0;
  }

  function isPlaying() { return Tone.Transport.state === 'started'; }

  function setBpm(b) {
    Tone.Transport.bpm.value = b;
    const rate = b / planetBpm;
    for (const p of ringPlayers) p.playbackRate = rate;
  }

  function resyncRings() {
    if (!isPlaying()) return;
    const t = Tone.now() + 0.03;
    for (const i of activeRings) {
      const p = ringPlayers[i]; if (!p || !p.loaded) continue;
      if (p.state === 'started') p.stop(t);
      p.start(t, ringOffset(i));
    }
  }

  function setRing(i, on) {
    const p = ringPlayers[i]; if (!p) return;
    if (on) {
      activeRings.add(i);
      if (isPlaying() && p.loaded) p.start(Tone.now(), ringOffset(i));
    } else {
      activeRings.delete(i);
      if (p.state === 'started') p.stop();
    }
  }

  function preview(i) { const p = players[i]; if (p && p.loaded) { try { p.start(); } catch (e) { /* слишком частый старт */ } } }

  function progress() {
    if (!isPlaying()) return 0;
    const tpb = Tone.Transport.PPQ * 4;
    return (Tone.Transport.ticks % tpb) / tpb;
  }

  return {
    unlock, isUnlocked, load, setGrid, setOnStep, start, stop, isPlaying, setBpm, resyncRings, setRing, preview, progress,
    getChannel, setChannel, resetChannel, channelKeys, channelDefaults, level, getMaster, setMaster, masterLevel,
    MASTER_DEFAULT, DELAY_TIMES, STEPS,
  };
})();
