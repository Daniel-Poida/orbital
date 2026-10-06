/* Звук: Tone.js. Короткие семплы по шагам, кольца как синхронные лупы. */
const AudioEngine = (() => {
  const STEPS = 16;
  let players = [];
  let ringPlayers = [];
  let ringCfgs = [];
  let activeRings = new Set();
  let seq = null;
  let planetBpm = 110;
  let gridFn = () => [];
  let onStep = () => {};
  let unlocked = false;

  async function unlock() {
    if (unlocked) return;
    await Tone.start();
    const el = document.getElementById('unlock');
    if (el) { try { await el.play(); } catch (e) { /* не критично */ } }
    unlocked = true;
  }

  function dispose() {
    stop();
    if (seq) { seq.dispose(); seq = null; }
    for (const p of players) p.dispose();
    for (const p of ringPlayers) p.dispose();
    players = []; ringPlayers = []; ringCfgs = []; activeRings.clear();
  }

  async function load(planet, baseUrl, onProgress) {
    dispose();
    planetBpm = planet.bpm || 110;
    Tone.Transport.bpm.value = planetBpm;
    const limiter = new Tone.Limiter(-1).toDestination();
    const bus = new Tone.Gain(0.9).connect(limiter);
    let done = 0;
    const total = planet.samples.length + planet.rings.length;
    const tick = () => { done++; if (onProgress) onProgress(done, total); };
    const loads = [];
    players = planet.samples.map(s => {
      const p = new Tone.Player({ url: baseUrl + s.file, onload: tick, fadeOut: 0.01 }).connect(bus);
      loads.push(p.loaded); return p;
    });
    ringCfgs = planet.rings;
    ringPlayers = planet.rings.map(r => {
      // Режим stretch: гранулярное растяжение, высота тона не меняется при смене темпа.
      // Режим resample: обычное ускорение, как на пластинке.
      const url = baseUrl + r.file;
      let p;
      if (r.mode === 'resample') {
        p = new Tone.Player({ url, onload: tick, loop: true, fadeIn: 0.02, fadeOut: 0.05 });
      } else {
        p = new Tone.GrainPlayer({ url, onload: tick, loop: true, grainSize: r.grainSize || 0.16, overlap: r.overlap || 0.08 });
      }
      p.connect(bus);
      p.volume.value = typeof r.gain === 'number' ? r.gain : -4;
      loads.push(p.loaded); return p;
    });
    await Tone.loaded();
    ringPlayers.forEach((p, i) => {
      const bars = ringCfgs[i].bars || 4;
      const want = bars * 240 / planetBpm;
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

  function setGrid(fn) { gridFn = fn; }
  function setOnStep(fn) { onStep = fn; }

  function barSecondsNative() { return 240 / planetBpm; }

  function ringOffset(i) {
    const bars = ringCfgs[i].bars || 4;
    const tpb = Tone.Transport.PPQ * 4;
    const barsElapsed = Tone.Transport.ticks / tpb;
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

  // Жёстко выравнивает активные кольца по позиции транспорта (после смены темпа).
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

  return { unlock, load, setGrid, setOnStep, start, stop, isPlaying, setBpm, resyncRings, setRing, preview, progress, STEPS };
})();
