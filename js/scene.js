/* 3D-сцена: планета, кольца, орбиты, спутники, луч-курсор. three.js r128. */
const Scene = (() => {
  const STEPS = 16;
  const MAX_ORBITS = 16;
  const MAX_RINGS = 8;
  let orbitBase = 3.0;
  const ORBIT_GAP = 0.8;
  const RING_INNER = 1.35;
  let ringWidth = 0.26;
  let ringGap = 0.07;
  const ELEVATION = 56 * Math.PI / 180;

  let renderer, scene, camera, raycaster, pointer;
  let planet, planetGlow, rayLine, raySweep, stars;
  let orbitGroup, satGroup, ringGroup;
  let orbitObjs = [];
  let satObjs = new Map();
  let ringObjs = [];
  let colors = { accent: '#ff7a3d', orbit: '#8f7a6b', ray: '#ffffff' };
  let orbitCount = 3;
  let pulses = [];
  let energy = 0;
  let glowTex = null;
  let planetHalo = null;
  let rimLight = null;

  // Мягкая радиальная текстура для свечений (рисуется один раз на canvas).
  function makeGlowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,.55)');
    grd.addColorStop(0.6, 'rgba(255,255,255,.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  function glowSprite(color, size, opacity) {
    const m = new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    const sp = new THREE.Sprite(m); sp.scale.setScalar(size);
    return sp;
  }
  let playing = false;
  let bottomPad = 0;
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tmpV = new THREE.Vector3();
  const texLoader = new THREE.TextureLoader();

  function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    glowTex = makeGlowTexture();
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(-6, 8, 4);
    scene.add(sun);
    rimLight = new THREE.DirectionalLight(0xff7a3d, 1.4);
    rimLight.position.set(5, -2, -6);
    scene.add(rimLight);

    planet = new THREE.Mesh(
      new THREE.SphereGeometry(1, 56, 56),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 })
    );
    scene.add(planet);

    // Атмосфера: френелевское свечение по краю шара.
    planetGlow = new THREE.Mesh(
      new THREE.SphereGeometry(1.16, 48, 48),
      new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color(0xffffff) }, intensity: { value: 0.6 } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform vec3 color; uniform float intensity; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.6); gl_FragColor = vec4(color, f * intensity); }',
        transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      })
    );
    scene.add(planetGlow);
    planetHalo = glowSprite(0xffffff, 5.5, 0.18);
    planetHalo.renderOrder = -1;
    scene.add(planetHalo);

    orbitGroup = new THREE.Group();
    satGroup = new THREE.Group();
    ringGroup = new THREE.Group();
    scene.add(orbitGroup, satGroup, ringGroup);

    const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, 0.02, -1)]);
    rayLine = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    scene.add(rayLine);

    const sweepGeo = new THREE.RingGeometry(1.2, 2, 48, 1, 0, 0.5);
    raySweep = new THREE.Mesh(sweepGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    raySweep.rotation.x = -Math.PI / 2;
    scene.add(raySweep);

    const starGeo = new THREE.BufferGeometry();
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 60 + Math.random() * 40, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true, opacity: 0.7 }));
    scene.add(stars);

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(loop);
  }

  function setBottomPad(px) { bottomPad = px; resize(); }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    fitCamera();
  }

  function outerRadius() { return orbitBase + (orbitCount - 1) * ORBIT_GAP + 0.7; }

  let zoom = 1;
  const pan = new THREE.Vector3(0, 0, 0);
  let fitDistance = 20;

  function fitCamera() {
    const w = window.innerWidth, h = window.innerHeight, pad = bottomPad;
    const R = outerRadius();
    camera.aspect = w / (h + pad);
    const tanV = Math.tan(camera.fov * Math.PI / 360);
    const dW = R * 1.08 / (tanV * camera.aspect);
    const availHalf = Math.max(120, (h - pad) / 2 - 56);
    const dH = R * Math.sin(ELEVATION) * 1.18 * ((h + pad) / 2) / (availHalf * tanV);
    fitDistance = Math.max(dW, dH);
    camera.setViewOffset(w, h + pad, 0, pad, w, h);
    camera.updateProjectionMatrix();
    placeCamera();
  }

  function placeCamera() {
    const d = fitDistance / zoom;
    camera.position.set(pan.x, d * Math.sin(ELEVATION) + pan.y, d * Math.cos(ELEVATION) + pan.z);
    camera.lookAt(pan.x, pan.y, pan.z);
  }

  function setZoom(z) { zoom = Math.max(1, Math.min(6, z)); placeCamera(); }
  function getZoom() { return zoom; }

  // Сдвиг вида на dx, dy экранных пикселей (панорамирование по плоскости орбит).
  function panBy(dx, dy) {
    const worldPerPx = (fitDistance / zoom) * Math.tan(camera.fov * Math.PI / 360) * 2 / (window.innerHeight + bottomPad);
    const limit = outerRadius();
    pan.x = Math.max(-limit, Math.min(limit, pan.x - dx * worldPerPx));
    pan.z = Math.max(-limit, Math.min(limit, pan.z - dy * worldPerPx / Math.sin(ELEVATION)));
    placeCamera();
  }

  function resetView() { zoom = 1; pan.set(0, 0, 0); placeCamera(); }

  function setPlanet(cfg, baseUrl) {
    colors = Object.assign({}, colors, cfg.colors || {});
    planet.material.color.set(0xffffff);
    if (cfg.texture) {
      texLoader.load(baseUrl + cfg.texture, (t) => { planet.material.map = t; planet.material.needsUpdate = true; });
    } else {
      planet.material.map = null; planet.material.color.set(colors.accent); planet.material.needsUpdate = true;
    }
    planetGlow.material.uniforms.color.value.set(colors.accent);
    planetHalo.material.color.set(colors.accent);
    rimLight.color.set(colors.accent);
    rayLine.material.color.set(colors.ray);
    raySweep.material.color.set(colors.ray);
    for (const o of orbitObjs) { o.line.material.color.set(colors.orbit); o.pts.material.color.set(colors.orbit); }
    clearSatellites();
    buildRings(cfg.rings || []);
  }

  function orbitRadius(i) { return orbitBase + i * ORBIT_GAP; }

  function buildOrbit(i) {
    const r = orbitRadius(i);
    const pts = [];
    for (let k = 0; k <= 128; k++) { const a = k / 128 * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(a) * r, 0, -Math.cos(a) * r)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: colors.orbit, transparent: true, opacity: 0.32 }));
    const mpts = [];
    for (let s = 0; s < STEPS; s++) { const a = s / STEPS * Math.PI * 2; mpts.push(new THREE.Vector3(Math.sin(a) * r, 0, -Math.cos(a) * r)); }
    const geo = new THREE.BufferGeometry().setFromPoints(mpts);
    const markers = new THREE.Points(geo, new THREE.PointsMaterial({ color: colors.orbit, size: 0.1, transparent: true, opacity: 0.7, map: glowTex, depthWrite: false }));
    const beatPts = [0, 4, 8, 12].map(s => mpts[s]);
    const beats = new THREE.Points(new THREE.BufferGeometry().setFromPoints(beatPts), new THREE.PointsMaterial({ color: 0xffffff, size: 0.26, transparent: true, opacity: 0.6, map: glowTex, depthWrite: false, blending: THREE.AdditiveBlending }));
    const g = new THREE.Group(); g.add(line, markers, beats);
    orbitGroup.add(g);
    return { group: g, line, pts: markers };
  }

  function setOrbitCount(n) {
    n = Math.max(1, Math.min(MAX_ORBITS, n));
    while (orbitObjs.length < n) orbitObjs.push(buildOrbit(orbitObjs.length));
    while (orbitObjs.length > n) { const o = orbitObjs.pop(); orbitGroup.remove(o.group); }
    orbitCount = n;
    rayLine.scale.z = outerRadius() - 0.3;
    for (const [key, m] of satObjs) { if (m.userData.orbit >= n) { satGroup.remove(m); satObjs.delete(key); } }
    fitCamera();
  }

  function satKey(o, s) { return o + ':' + s; }

  function setSatellite(o, s, sampleCfg) {
    const key = satKey(o, s);
    const prev = satObjs.get(key);
    if (prev) { satGroup.remove(prev); satObjs.delete(key); }
    if (!sampleCfg) return;
    const a = s / STEPS * Math.PI * 2, r = orbitRadius(o);
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 24),
      new THREE.MeshStandardMaterial({ color: sampleCfg.color, emissive: sampleCfg.color, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.1 }));
    m.position.set(Math.sin(a) * r, 0, -Math.cos(a) * r);
    const halo = glowSprite(sampleCfg.color, 1.1, 0.45);
    m.add(halo);
    m.userData = { orbit: o, step: s, base: 1, halo };
    satGroup.add(m);
    satObjs.set(key, m);
  }

  function clearSatellites() { for (const m of satObjs.values()) satGroup.remove(m); satObjs.clear(); }

  function flash(o, s) {
    const m = satObjs.get(satKey(o, s));
    if (!m) return;
    m.scale.setScalar(1.7);
    m.material.emissiveIntensity = 1.8;
    if (m.userData.halo) m.userData.halo.material.opacity = 1;
    pulses.push(m);
  }

  function buildRings(cfgs) {
    for (const r of ringObjs) ringGroup.remove(r.mesh);
    ringObjs = [];
    cfgs = cfgs.slice(0, MAX_RINGS);
    ringWidth = cfgs.length > 4 ? 0.2 : 0.26;
    ringGap = cfgs.length > 4 ? 0.05 : 0.07;
    cfgs.forEach((cfg, i) => {
      const inner = RING_INNER + i * (ringWidth + ringGap);
      const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, inner + ringWidth, 96),
        new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData = { ring: i, active: false, level: 0 };
      ringGroup.add(mesh);
      ringObjs.push({ mesh, cfg });
    });
    const base = Math.max(2.6, RING_INNER + cfgs.length * (ringWidth + ringGap) + 0.55);
    if (Math.abs(base - orbitBase) > 1e-6) { orbitBase = base; rebuildOrbits(); }
  }

  function rebuildOrbits() {
    const n = orbitObjs.length;
    for (const o of orbitObjs) orbitGroup.remove(o.group);
    orbitObjs = [];
    for (let i = 0; i < n; i++) orbitObjs.push(buildOrbit(i));
    for (const m of satObjs.values()) {
      const a = m.userData.step / STEPS * Math.PI * 2, r = orbitRadius(m.userData.orbit);
      m.position.set(Math.sin(a) * r, 0, -Math.cos(a) * r);
    }
    rayLine.scale.z = outerRadius() - 0.3;
    fitCamera();
  }

  function setRing(i, active) {
    const r = ringObjs[i]; if (!r) return;
    r.mesh.userData.active = active;
    r.mesh.material.opacity = active ? 0.55 : 0.1;
  }

  // Уровень звука кольца 0..1, кольцо светится в такт своему инструменту.
  function setRingLevel(i, lv) {
    const r = ringObjs[i]; if (!r) return;
    r.mesh.userData.level += (lv - r.mesh.userData.level) * 0.35;
  }

  function setEnergy(e) {
    energy += (e - energy) * (e > energy ? 0.5 : 0.08);
  }

  function setPlaying(p) { playing = p; }

  function setProgress(p) {
    const a = p * Math.PI * 2;
    rayLine.rotation.y = -a;
    raySweep.rotation.z = Math.PI / 2 - a - 0.5;
  }

  function pick(clientX, clientY) {
    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.intersectObject(planet).length) return { type: 'planet' };
    if (!raycaster.ray.intersectPlane(plane, tmpV)) return null;
    const r = Math.hypot(tmpV.x, tmpV.z);
    let a = Math.atan2(tmpV.x, -tmpV.z); if (a < 0) a += Math.PI * 2;
    for (const ro of ringObjs) {
      const inner = ro.mesh.geometry.parameters.innerRadius, outer = ro.mesh.geometry.parameters.outerRadius;
      if (r >= inner - 0.05 && r <= outer + 0.05) return { type: 'ring', index: ro.mesh.userData.ring };
    }
    const idx = Math.round((r - orbitBase) / ORBIT_GAP);
    if (idx < 0 || idx >= orbitCount) return null;
    if (Math.abs(r - orbitRadius(idx)) > ORBIT_GAP * 0.5) return null;
    const step = Math.round(a / (Math.PI * 2 / STEPS)) % STEPS;
    return { type: 'step', orbit: idx, step };
  }

  let last = 0;
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
    planet.rotation.y += dt * (playing ? 0.35 : 0.08);
    stars.rotation.y += dt * 0.004;
    const u = planetGlow.material.uniforms.intensity;
    u.value += ((playing ? 0.9 + energy * 1.4 : 0.55) - u.value) * 0.12;
    planetHalo.material.opacity = 0.14 + energy * 0.3;
    const ps = 1 + energy * 0.035; planet.scale.setScalar(ps); planetGlow.scale.setScalar(ps);
    for (const ro of ringObjs) {
      const d = ro.mesh.userData;
      ro.mesh.material.opacity = d.active ? (playing ? 0.18 + d.level * 0.55 : 0.38) : 0.07;
      if (!playing) d.level *= 0.9;
    }
    for (const m of satObjs.values()) if (m.userData.halo && m.userData.halo.material.opacity > 0.45) m.userData.halo.material.opacity += (0.45 - m.userData.halo.material.opacity) * 0.12;
    raySweep.material.opacity = playing ? 0.12 : 0.0;
    rayLine.material.opacity = playing ? 0.9 : 0.35;
    for (const ro of ringObjs) if (ro.mesh.userData.active && playing) ro.mesh.rotation.z += dt * 0.25;
    pulses = pulses.filter(m => {
      m.scale.setScalar(m.scale.x + (1 - m.scale.x) * 0.2);
      m.material.emissiveIntensity += (0.35 - m.material.emissiveIntensity) * 0.15;
      return Math.abs(m.scale.x - 1) > 0.01;
    });
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }

  return { init, setPlanet, setZoom, getZoom, panBy, resetView, setOrbitCount, setSatellite, clearSatellites, setRing, setRingLevel, setEnergy, flash, setProgress, setPlaying, pick, setBottomPad, STEPS, MAX_ORBITS, MAX_RINGS };
})();
