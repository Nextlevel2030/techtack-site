'use strict';
(() => {
  const root = document.documentElement;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const pad = k => String(k).padStart(2, '0');

  // Pace of the journey (seconds). Transitions play at this speed however fast the page is scrolled.
  const TEXT_OUT = 0.8;
  const TEXT_IN = 1.35;
  const TEXT_DELAY = 0.28;
  const SHAPE_MORPH = 2.5;
  const CAMERA_EASE = 0.8;

  // The same script runs the Arabic page (index.html, RTL) and the English one (en.html, LTR).
  const rtl = root.dir !== 'ltr';
  const T = rtl ? {
    greeting: 'مرّر للأسفل',
    soundOn: 'الموسيقى', soundOff: 'تشغيل الموسيقى',
    sentFrom: '— أُرسلت من موقع TECH TACK', mailOpened: 'فتحنا لك تطبيق البريد ورسالتك جاهزة، اضغط «إرسال» لإتمامها.'
  } : {
    greeting: 'Scroll Down',
    soundOn: 'Music', soundOff: 'Play music',
    sentFrom: '— Sent from the TECH TACK website', mailOpened: 'Your email app is open with the message ready. Press “Send” to finish.'
  };
  // data-side is written in reading order (start = where text begins); the scene and nebula work in screen left/right.
  const screenSide = s => rtl || s === 'center' ? s : s === 'start' ? 'end' : 'start';

  const journey = document.querySelector('.journey');
  const chapters = [...document.querySelectorAll('.chapter')];
  const contact = document.querySelector('.contact');
  const n = chapters.length;                 // journey chapters; the contact section comes after them
  const weights = chapters.map(c => parseFloat(c.dataset.weight) || 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const railButtons = [...document.querySelectorAll('.rail button')];
  const names = railButtons.map(b => b.querySelector('span').textContent);
  const railList = document.querySelector('.rail ol');
  // The rail shows one mark per section; services are folded into a single mark (their <li> are .rail-sub, hidden),
  // so a mark stands for every stop from its data-go up to the next mark's.
  const railMarks = railButtons.filter(b => !b.parentElement.classList.contains('rail-sub'));
  const railMarkStop = railMarks.map(b => parseInt(b.dataset.go, 10));
  const railMarkAt = s => { let m = 0; railMarkStop.forEach((g, k) => { if (g <= s) m = k; }); return m; };
  const railTrack = document.createElement('span');
  railTrack.className = 'rail-track';
  railTrack.innerHTML = '<span class="rail-fill"></span>';
  railList.append(railTrack);
  const railFill = railTrack.firstChild;
  const countNum = document.querySelector('.hud-count b');
  const countName = document.querySelector('.hud-count em');
  const canvas = document.querySelector('.gl');
  const nebula = document.querySelector('.nebula');
  const steps = [...document.querySelectorAll('.step')];
  const aboutIndex = chapters.findIndex(c => c.id === 'about');
  const workIndex = chapters.findIndex(c => c.id === 'work');
  const work = chapters[workIndex];
  const workBody = work.querySelector('.ch-body');
  const workHint = work.querySelector('.work-hint');
  const flyers = [...work.querySelectorAll('.fly')];
  const sides = [...chapters.map(c => screenSide(c.dataset.side)), screenSide('start')];

  // Text on stage comes in units: a whole chapter, or one panel of a chapter that has several
  // (About shows "من نحن" first, then "كيف نعمل" over the same shape).
  const units = [];
  chapters.forEach((ch, k) => {
    const panels = [...ch.querySelectorAll(':scope > .panel')];
    if (panels.length) panels.forEach((el, p) => units.push({ el, k, p, count: panels.length }));
    else units.push({ el: ch, k, p: 0, count: 1 });
  });
  const panelCount = chapters.map((_, k) => units.filter(u => u.k === k).length);
  const stops = [...units.map(u => ({ k: u.k, p: u.p, count: u.count })), { k: n, p: 0, count: 1 }];
  const stopOf = (k, p) => { const i = stops.findIndex(s => s.k === k && s.p === p); return i < 0 ? stops.length - 1 : i; };
  const approachStop = units.findIndex(u => u.el.id === 'approach');
  const workStop = stopOf(workIndex, 0);

  let motion = root.classList.contains('is-motion');
  let scene = null;
  let lenis = null;

  // A stable screen height (ignores the mobile address bar growing and shrinking).
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;height:100lvh;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  let unit = innerHeight;
  let starts = [];
  let journeyTop = 0;
  let contactTop = 0;
  let lastWidth = innerWidth;

  function layout() {
    unit = probe.getBoundingClientRect().height || innerHeight;
    let acc = 0;
    starts = weights.map(w => { const s = acc; acc += w * unit; return s; });
    journey.style.height = motion ? `${Math.round((total + 1) * unit)}px` : '';
    journeyTop = journey.getBoundingClientRect().top + scrollY;
    contactTop = contact.getBoundingClientRect().top + scrollY;
    canvas.style.height = `${unit}px`;
    if (scene) scene.resize(document.documentElement.clientWidth, unit);
    railCenters = [];
  }

  // Scroll position → chapter number with a fraction (0 … n + 1).
  function progressAt(y) {
    const local = y - journeyTop;
    if (local <= 0) return 0;
    const pinned = total * unit;
    if (local < pinned) {
      for (let k = n - 1; k >= 0; k--) if (local >= starts[k]) return k + (local - starts[k]) / (weights[k] * unit);
    }
    return n + clamp((local - pinned) / Math.max(1, contactTop - journeyTop - pinned), 0, 1);
  }

  function stopY(s) {
    const st = stops[s];
    if (!motion) {
      if (s === 0) return 0;
      const el = st.k < n ? units[s].el : contact;
      return el.getBoundingClientRect().top + scrollY - 8;
    }
    if (st.k >= n) return contactTop;
    if (s === 0) return 0;
    const f = (st.p + (st.k === workIndex ? 0.05 : 0.3)) / st.count;
    return journeyTop + starts[st.k] + weights[st.k] * unit * f;
  }
  function scrollToY(y, immediate) {
    if (lenis) lenis.scrollTo(y, immediate ? { immediate: true, force: true } : { duration: 2.2, easing: t => 1 - Math.pow(1 - t, 3), force: true });
    else window.scrollTo({ top: y, behavior: immediate || !motion ? 'auto' : 'smooth' });
  }
  let jump = null;
  function go(s, immediate) {
    s = clamp(s, 0, stops.length - 1);
    if (motion) jump = { s, until: performance.now() + (immediate ? 80 : 2300) };
    scrollToY(stopY(s), immediate);
  }
  function stopForId(id) {
    if (id === 'contact') return stops.length - 1;
    const u = units.findIndex(x => x.el.id === id);
    if (u >= 0) return u;
    const k = chapters.findIndex(c => c.id === id);
    return k >= 0 ? stopOf(k, 0) : -1;
  }

  function startLenis() {
    if (lenis || !window.Lenis) return;
    try { lenis = new window.Lenis({ lerp: 0.075, wheelMultiplier: 0.85, touchMultiplier: 1.1, smoothWheel: true }); } catch (e) { lenis = null; }
  }
  function stopLenis() { if (lenis) { lenis.destroy(); lenis = null; } }

  function ensureScene() {
    if (scene || !window.TTScene) return scene;
    try {
      scene = window.TTScene.create(canvas, { shapes: [...chapters.map(c => c.dataset.shape), 'question'], sides, logo: 'assets/logo-blue.png', question: rtl ? '؟' : '?', greeting: T.greeting });
    } catch (e) { scene = null; }
    if (scene) scene.resize(document.documentElement.clientWidth, unit);
    return scene;
  }

  /* ---------------- what is on stage ---------------- */
  let shown = 0;          // chapter (drives the shape and the camera)
  let shownPanel = 0;     // panel inside that chapter
  let shownStop = 0;      // index into stops (drives the text, the rail and the counter)
  let shownAt = 0;
  let dirSign = 1;
  const uvis = new Float32Array(units.length);   // how far each text unit has faded in (0 … 1, linear in time)

  function pickShown(g, now) {
    let k = shown, p = shownPanel;
    if (jump && now < jump.until) { k = stops[jump.s].k; p = stops[jump.s].p; }
    else {
      jump = null;
      const raw = clamp(Math.floor(g), 0, n);
      if (raw > shown && g >= raw + 0.02) k = raw;
      else if (raw < shown && g < shown - 0.02) k = raw;
      const count = k < n ? panelCount[k] : 1;
      if (count > 1) {
        const q = clamp(g - k, 0, 0.9999) * count;
        const rawP = Math.floor(q);
        if (k !== shown) p = clamp(rawP, 0, count - 1);
        else if (rawP > p && q >= rawP + 0.04) p = rawP;
        else if (rawP < p && q < p - 0.04) p = rawP;
      } else p = 0;
    }
    if (k !== shown || p !== shownPanel) {
      const s = stopOf(k, p);
      dirSign = s > shownStop ? 1 : -1;
      shown = k;
      shownPanel = p;
      shownStop = s;
      shownAt = now;
    }
  }

  // Text leaves first, then the next unit writes itself in, line by line.
  function renderText(now, dt) {
    let others = 0;
    for (let i = 0; i < units.length; i++) if (i !== shownStop) others = Math.max(others, uvis[i]);
    for (let i = 0; i < units.length; i++) {
      const el = units[i].el;
      if (i === shownStop) {
        if (ready && others < 0.3 && (now - shownAt) / 1000 > TEXT_DELAY) uvis[i] = Math.min(1, uvis[i] + dt / TEXT_IN);
      } else uvis[i] = Math.max(0, uvis[i] - dt / TEXT_OUT);
      const e = smooth(uvis[i]);
      if (e < 0.002) {
        if (el._v !== 0) { el._v = 0; el.style.setProperty('--v', '0'); el.classList.remove('is-moving'); }
        continue;
      }
      const dir = i === shownStop ? dirSign : -dirSign;
      if (el._v === e && el._dir === dir) continue;
      el._v = e;
      el._dir = dir;
      el.style.setProperty('--v', e.toFixed(3));
      el.style.setProperty('--dir', String(dir));
      el.classList.toggle('is-moving', e < 0.995);
    }
    chapters.forEach((ch, k) => {
      let on = false;
      for (let i = 0; i < units.length; i++) if (units[i].k === k && uvis[i] > 0.002) on = true;
      if (on !== ch.classList.contains('is-on')) ch.classList.toggle('is-on', on);
    });
    if (approachStop >= 0) {
      const lit = shownStop === approachStop ? clamp(Math.floor(((now - shownAt) / 1000 - 1.1) / 0.45) + 1, 0, 4) : uvis[approachStop] > 0 ? 4 : 0;
      steps.forEach((s, i) => s.classList.toggle('is-lit', i < lit));
    }
  }

  // Work: the pictures travel out of the depth of the scene and pass beside you (this part follows the scroll).
  // The title holds the screen alone until FLIGHT_AT (a fraction of the chapter), then steps towards you and fades,
  // and only then do the pictures start. SPEED grows with the number of pictures so the last one still clears the
  // camera; scale data-weight="…" on #work with it (about 4200 of SPEED per unit of weight, plus the title's share).
  const LANES = [[0.2, -0.09], [-0.21, 0.1], [0.15, 0.13], [-0.17, -0.12], [0.21, 0.05], [-0.13, -0.05]];
  const FLIGHT_AT = 0.2, TITLE_OUT = 0.06;
  const START = 2700, GAP = 1400, SPEED = START + (flyers.length - 1) * GAP + 1190;
  const flightQ = travel => FLIGHT_AT + travel / SPEED * (1 - FLIGHT_AT);
  let flightOn = false;
  function renderFlight(g) {
    const q = g - workIndex;
    const wv = smooth(uvis[workStop]);
    if (wv < 0.002 || q < -0.5 || q > 1.3) {
      if (flightOn) { flyers.forEach(f => { f.style.opacity = '0'; f.classList.remove('is-live'); }); flightOn = false; }
      // Past the pictures the title stays gone; before the chapter it follows the reveal.
      workBody.style.setProperty('--v', (q > 0 ? 0 : wv).toFixed(3));
      workBody.style.transform = '';
      return;
    }
    flightOn = true;
    const narrow = innerWidth < 760;
    const travel = Math.max(0, (q - FLIGHT_AT) / (1 - FLIGHT_AT)) * SPEED;
    flyers.forEach((f, i) => {
      const z = -(START + i * GAP) + travel;
      const lane = LANES[i % LANES.length];
      const x = lane[0] * innerWidth * (narrow ? 0.5 : 1);
      const y = lane[1] * unit * (narrow ? 0.9 : 1);
      // A picture only appears once the one before it on the same side has passed, so they never overlap.
      const o = wv * (narrow ? smooth((z + 1300) / 600) : smooth((z + 2700) / 800)) * (1 - smooth((z - 120) / 300));
      f.style.transform = `translate(-50%,-50%) translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,${z.toFixed(1)}px) rotateY(${lane[0] > 0 ? -7 : 7}deg)`;
      f.style.opacity = o.toFixed(3);
      f.style.zIndex = flyers.length - i;
      f.classList.toggle('is-live', o > 0.35 && z < 200);
    });
    const out = smooth((q - (FLIGHT_AT - TITLE_OUT)) / TITLE_OUT);
    const tv = wv * (1 - out);
    workBody.style.setProperty('--v', tv.toFixed(3));
    workBody.style.transform = out > 0 ? `scale(${(1 + out * 0.14).toFixed(4)})` : '';
    workBody.classList.toggle('is-moving', tv > 0.002 && tv < 0.995);
    workHint.style.setProperty('--hint', (wv * smooth((q - FLIGHT_AT - 0.04) / 0.06) * (1 - smooth((q - 0.9) / 0.08))).toFixed(3));
  }

  let activeStop = -1;
  let lastNebula = null;
  function renderHud(s, g) {
    if (s !== activeStop) {
      activeStop = s;
      countNum.textContent = pad(s + 1);
      countName.textContent = names[s] || '';
      const mark = railMarkAt(s);
      railMarks.forEach((b, k) => { if (k === mark) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    }
    const side = sides[stops[s].k];
    const nx = motion && innerWidth >= 760 ? (side === 'start' ? '-15vw' : side === 'end' ? '15vw' : '0px') : '0px';
    if (nx !== lastNebula) { lastNebula = nx; nebula.style.setProperty('--nx', nx); }
    renderRail();
  }
  // Rail: a line that fills smoothly with the scroll, from the first mark to the last.
  let railCenters = [];
  let railReached = -1;
  function measureRail() {
    railCenters = railMarks.map(b => b.offsetTop + b.offsetHeight / 2);
    const top = railCenters[0], end = railCenters[railCenters.length - 1];
    railTrack.style.top = `${top}px`;
    railTrack.style.height = `${end - top}px`;
  }
  function renderRail() {
    if (!railCenters.length) {
      if (!railList.offsetParent) return;   // the rail is hidden on phones
      measureRail();
    }
    const last = stops.length - 1;
    const y = scrollY;
    let f = last;
    let prev = stopY(0);
    for (let i = 1; i <= last; i++) {
      const next = stopY(i);
      if (y < next) { f = i - 1 + clamp((y - prev) / Math.max(1, next - prev), 0, 1); break; }
      prev = next;
    }
    const k = Math.min(railMarks.length - 2, railMarkAt(f));
    const t = clamp((f - railMarkStop[k]) / (railMarkStop[k + 1] - railMarkStop[k]), 0, 1);
    const px = railCenters[k] + (railCenters[k + 1] - railCenters[k]) * t - railCenters[0];
    const span = railCenters[railCenters.length - 1] - railCenters[0];
    railFill.style.transform = `scaleY(${span > 0 ? clamp(px / span, 0, 1).toFixed(4) : 0})`;
    const reached = railMarkAt(f + 0.02);
    if (reached !== railReached) {
      railReached = reached;
      railMarks.forEach((b, m) => b.parentElement.classList.toggle('is-past', m <= reached));
    }
  }

  function staticActive() {
    const line = innerHeight * 0.4;
    let a = 0;
    units.forEach((u, i) => { if (u.el.getBoundingClientRect().top <= line) a = i; });
    if (contact.getBoundingClientRect().top <= line) a = stops.length - 1;
    return a;
  }

  /* ---------------- pointer ---------------- */
  const pointer = { x: 0, y: 0, sx: 0, sy: 0, touch: 0, last: -1e9 };
  const trackPointer = e => {
    pointer.x = e.clientX / innerWidth * 2 - 1;
    pointer.y = -(e.clientY / innerHeight * 2 - 1);
    pointer.last = performance.now();
  };
  addEventListener('pointermove', trackPointer, { passive: true });
  addEventListener('pointerdown', trackPointer, { passive: true });

  /* ---------------- start-up ---------------- */
  // No loading screen: the stars show at once, and as soon as the formations are built the greeting
  // («مرّر للأسفل» / "Scroll down") fades in as plain text. After a pause it dissolves: the text fades
  // while particles take its place, letter for letter, and fly off to form the logo.
  // The opening text follows once the logo has formed. Scrolling early starts the dissolve at once.
  const GREET_IN = 0.9;          // seconds: the text fades in
  const GREET_HOLD = 2.4;        // seconds it stays
  const GREET_FADE = 0.9;        // seconds: text → particles
  const GREET_OUT = 2.8;         // seconds: particles → logo
  const INTRO_TEXT_WAIT = GREET_IN + GREET_HOLD + GREET_FADE + 1.6;   // seconds after start-up
  let greetEnd = 0;              // when the text starts dissolving
  let greetSkip = false;
  let greetNote = null;
  let loaded = false;
  let ready = false;
  let readyAt = 0;
  async function boot() {
    const fonts = document.fonts
      ? Promise.all([document.fonts.load('700 80px Bahij'), document.fonts.load('400 17px Bahij')]).catch(() => {})
      : Promise.resolve();
    await fonts;
    if (motion && ensureScene()) {
      try { await scene.build(); } catch (e) { console.warn(e); }
    }
    loaded = true;
  }
  setTimeout(() => { loaded = true; }, 9000);

  // The greeting as text. With particles it is laid exactly over them and driven by renderGreeting();
  // without them (calm mode, no WebGL) it simply fades in and out on its own (.is-solo).
  function showGreetingNote(solo) {
    if (scrollY > 40) return null;
    const note = document.createElement('p');
    note.className = solo ? 'greet-note is-solo' : 'greet-note';
    note.setAttribute('aria-hidden', 'true');
    note.textContent = T.greeting;
    document.body.append(note);
    if (solo) note.addEventListener('animationend', () => note.remove());
    return note;
  }
  function renderGreeting(now) {
    if (!greetNote) return;
    const box = scene.greetBox();
    const fadeIn = smooth((now - readyAt) / (GREET_IN * 1000));
    const fadeOut = smooth((now - greetEnd) / (GREET_FADE * 1000));
    if (!box || fadeOut >= 1) { greetNote.remove(); greetNote = null; return; }
    greetNote.style.cssText = `left:${box.x.toFixed(1)}px;top:${box.y.toFixed(1)}px;font-size:${box.font.toFixed(2)}px;` +
      `opacity:${(fadeIn * (1 - fadeOut)).toFixed(3)};filter:blur(${((1 - fadeIn) * 6 + fadeOut * 4).toFixed(2)}px)`;
  }

  /* ---------------- the shapes and the camera ---------------- */
  const morph = { from: 0, to: 0, mix: 1, hurry: 1 };
  let cam = 0;
  const state = { cam: 0, from: 0, to: 0, mix: 1, greet: 0, intro: 0, warp: 0, rays: 1, dim: 1, lift: 0, shrink: 1, px: 0, py: 0, mx: 0, my: 0, touch: 0 };
  function updateScene(now, dt, g) {
    // One shape at a time: finish the current change (quickly, if the reader has already moved on), then start the next.
    if (morph.mix >= 1) {
      if (morph.to !== shown) { morph.from = morph.to; morph.to = shown; morph.mix = 0; morph.hurry = 1; }
      else morph.from = morph.to;
    } else if (morph.to !== shown) morph.hurry = 2.6;
    if (morph.mix < 1) morph.mix = Math.min(1, morph.mix + dt / SHAPE_MORPH * morph.hurry);

    const camTarget = shown + clamp(g - shown, 0, 1) * 0.16;
    const before = cam;
    cam += (camTarget - cam) * (1 - Math.exp(-dt / CAMERA_EASE));
    const speed = Math.abs(cam - before) / dt;
    state.warp += (clamp(speed / 1.6, 0, 0.7) - state.warp) * Math.min(1, dt * 3);

    // On narrow screens the second About panel is longer, so the shape glides up and shrinks a little to make room.
    const makeRoom = shown === aboutIndex && shownPanel === 1 && innerWidth / unit < 1.02;
    const ease = Math.min(1, dt * 2.2);
    state.lift += ((makeRoom ? 0.55 : 0) - state.lift) * ease;
    state.shrink += ((makeRoom ? 0.76 : 1) - state.shrink) * ease;

    const inWork = smooth((cam - workIndex + 0.3) / 0.3) * (1 - smooth((cam - workIndex - 0.7) / 0.3));
    const inContact = smooth((cam - n + 0.5) / 0.5);
    state.cam = cam;
    state.from = morph.from;
    state.to = morph.to;
    state.mix = morph.mix;
    // Greeting: the particles hold the words, unseen, until the text dissolves into them.
    state.greet = greetSkip ? -1 : 1;
    state.intro = !ready ? 0 : greetSkip ? clamp((now - greetEnd) / 3200, 0, 1) : clamp((now - greetEnd - GREET_FADE * 350) / (GREET_OUT * 1000), 0, 1);
    const greeting = ready && !greetSkip && state.intro < 1;
    state.rays = (1 - 0.62 * smooth(cam / 0.9)) * (1 - 0.3 * inContact) + inWork * 0.2;
    state.dim = 1 - 0.45 * inWork * smooth((g - workIndex - FLIGHT_AT + 0.08) / 0.12) - 0.4 * inContact;
    if (!ready) state.dim = 0;
    else if (greeting) state.dim *= smooth((now - greetEnd) / (GREET_FADE * 1000));
    pointer.sx += (pointer.x - pointer.sx) * Math.min(1, dt * 3);
    pointer.sy += (pointer.y - pointer.sy) * Math.min(1, dt * 3);
    const touchTarget = clamp(1 - (now - pointer.last - 700) / 1400, 0, 1);
    pointer.touch += (touchTarget - pointer.touch) * Math.min(1, dt * 6);
    // keep the camera centred while the greeting is up, so the text and the particles line up
    const steady = greeting ? 1 - smooth(state.intro * 2) : 0;
    state.px = pointer.sx * (1 - steady); state.py = pointer.sy * (1 - steady);
    state.mx = pointer.x; state.my = pointer.y;
    state.touch = pointer.touch;
    scene.render(now / 1000, state);
    renderGreeting(now);
  }

  /* ---------------- frame ---------------- */
  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
    lastTime = now;
    if (lenis) lenis.raf(now);

    if (!ready && loaded) {
      ready = true;
      readyAt = now;
      // Arriving part-way down the page (a link or a reload): no greeting.
      greetSkip = progressAt(scrollY) > 0.03;
      greetEnd = greetSkip ? now : now + (GREET_IN + GREET_HOLD) * 1000;
      shownAt = now + (shownStop === 0 ? (greetSkip ? 1.8 : INTRO_TEXT_WAIT) * 1000 : 0);
      if (!motion || !scene || !scene.ready) showGreetingNote(true);
      else if (!greetSkip) greetNote = showGreetingNote(false);
    }

    if (motion) {
      const g = progressAt(scrollY);
      // Scrolling during the greeting: dissolve it now and go straight on to the logo.
      if (ready && !greetSkip && now < greetEnd && g > 0.03) greetEnd = now;
      pickShown(g, now);
      renderText(now, dt);
      renderFlight(g);
      renderHud(shownStop, g);
      const atEnd = g > n + 0.35;
      if (atEnd !== root.classList.contains('at-end')) root.classList.toggle('at-end', atEnd);
      if (scene) updateScene(now, dt, g);
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- motion on / off ---------------- */
  function resetJourney() {
    units.forEach(u => { u.el._v = undefined; u.el._dir = undefined; u.el.style.removeProperty('--v'); u.el.style.removeProperty('--dir'); u.el.classList.remove('is-moving'); });
    chapters.forEach(ch => ch.classList.remove('is-on'));
    workBody.style.removeProperty('--v');
    workBody.style.transform = '';
    workBody.classList.remove('is-moving');
    workHint.style.removeProperty('--hint');
    flyers.forEach(f => { f.style.transform = ''; f.style.opacity = ''; f.style.zIndex = ''; f.classList.remove('is-live'); });
    flightOn = false;
    nebula.style.setProperty('--nx', '0px');
    lastNebula = null;
    activeStop = -1;
  }
  function setMotion(on) {
    const a = motion ? shownStop : staticActive();
    motion = on;
    root.classList.toggle('is-motion', on);
    root.classList.toggle('is-static', !on);
    resetJourney();
    if (on) {
      startLenis();
      ready = true;
      readyAt = performance.now() - 6000;
      greetSkip = true;
      greetEnd = readyAt;
      if (greetNote) { greetNote.remove(); greetNote = null; }
      uvis.fill(0);
      if (a < units.length) uvis[a] = 1;
      shown = stops[a].k; shownPanel = stops[a].p; shownStop = a;
      shownAt = performance.now() - 5000;
      morph.from = morph.to = shown; morph.mix = 1;
      cam = shown;
      if (ensureScene() && !scene.ready) scene.build().catch(() => {});
    } else {
      stopLenis();
    }
    layout();
    go(a, true);
    if (!on) renderHud(staticActive(), 1);
  }
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', e => setMotion(!e.matches));

  /* ---------------- background music ---------------- */
  // On by default (unless the visitor switched it off before). Browsers only allow sound once the
  // visitor has interacted with the page, so if the first try is blocked the music starts on their
  // first tap, click or key press. It fades in and out and pauses in a hidden tab.
  const soundButton = document.querySelector('.hud-sound');
  const soundText = soundButton.querySelector('.hud-sound-text');
  const MUSIC_VOLUME = 0.35;
  const MUSIC_FADE = 1.2;
  // The track is fetched whole and played from a blob: Safari won't play media from servers
  // without byte-range support (python's http.server, for one).
  const MUSIC_SRC = 'assets/music.m4a';
  const SILENCE = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
  const GESTURES = ['pointerdown', 'touchend', 'keydown', 'click'];
  const music = new Audio();
  music.loop = true;
  music.volume = 0;
  let musicReady = null;
  let musicLoaded = false;
  let soundOn = false;
  let fadeRaf = 0;
  function fadeMusic(to, done) {
    cancelAnimationFrame(fadeRaf);
    const from = music.volume;
    const t0 = performance.now();
    const step = now => {
      const t = clamp((now - t0) / (MUSIC_FADE * 1000), 0, 1);
      music.volume = clamp(from + (to - from) * smooth(t), 0, 1);
      if (t < 1) fadeRaf = requestAnimationFrame(step);
      else if (done) done();
    };
    fadeRaf = requestAnimationFrame(step);
  }
  function loadMusic() {
    if (!musicReady) {
      musicReady = fetch(MUSIC_SRC)
        .then(r => { if (!r.ok) throw new Error(`${MUSIC_SRC}: ${r.status}`); return r.blob(); })
        .then(blob => { music.src = URL.createObjectURL(blob); musicLoaded = true; })
        .catch(err => { musicReady = null; throw err; });
    }
    return musicReady;
  }
  function startMusic() {
    return music.play().then(() => { disarm(); fadeMusic(MUSIC_VOLUME); });
  }
  function playMusic() {
    loadMusic()
      .then(() => { if (soundOn && !document.hidden && music.paused) return startMusic(); })
      .catch(err => {
        if (err && err.name === 'NotAllowedError') arm();   // blocked until the visitor interacts
        else { console.warn('TECH TACK music:', err); setSound(false, false); }
      });
  }
  // Waiting for the visitor's first interaction to start the sound.
  function onGesture(e) {
    if (!soundOn || !music.paused || document.hidden) { disarm(); return; }
    if (soundButton.contains(e.target) && e.type !== 'click') return;   // the button's own click handles it
    if (musicLoaded) startMusic().catch(() => {});
    else { music.src = SILENCE; music.play().catch(() => {}); playMusic(); }   // unlock now, play once loaded
  }
  function arm() { GESTURES.forEach(t => addEventListener(t, onGesture, true)); }
  function disarm() { GESTURES.forEach(t => removeEventListener(t, onGesture, true)); }
  function setSound(on, persist) {
    soundOn = on;
    soundButton.setAttribute('aria-pressed', String(on));
    soundText.textContent = on ? T.soundOn : T.soundOff;
    if (persist) { try { localStorage.setItem('techtack-sound', on ? 'on' : 'off'); } catch (e) {} }
    if (on) playMusic();
    else { disarm(); fadeMusic(0, () => music.pause()); }
  }
  soundButton.addEventListener('click', () => {
    // Shown as on but still silent (blocked): this click starts it rather than switching it off.
    if (soundOn && music.paused) { if (musicLoaded) startMusic().catch(() => {}); else playMusic(); return; }
    setSound(!soundOn, true);
  });
  document.addEventListener('visibilitychange', () => {
    if (!soundOn) return;
    if (document.hidden) { cancelAnimationFrame(fadeRaf); music.pause(); music.volume = 0; }
    else playMusic();
  });
  let storedSound = null;
  try { storedSound = localStorage.getItem('techtack-sound'); } catch (e) {}
  setSound(storedSound !== 'off', false);

  /* ---------------- navigation ---------------- */
  railButtons.forEach(b => b.addEventListener('click', () => go(parseInt(b.dataset.go, 10))));
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href').slice(1);
    const s = stopForId(id);
    if (s < 0) return;
    e.preventDefault();
    go(s);
    if (id === 'contact') setTimeout(() => document.getElementById('contact-subject').focus({ preventScroll: true }), motion ? 2300 : 50);
  });
  // Keyboard users: bring whatever receives focus into view.
  document.addEventListener('focusin', e => {
    if (!motion) return;
    const fly = e.target.closest('.fly');
    if (fly) {
      const i = flyers.indexOf(fly);
      const q = flightQ(START + i * GAP - 700);
      jump = { s: workStop, until: performance.now() + 2300 };
      scrollToY(journeyTop + starts[workIndex] + weights[workIndex] * unit * q, false);
      return;
    }
    const holder = e.target.closest('.panel, .chapter');
    const u = holder ? units.findIndex(x => x.el === holder || (x.el.classList.contains('chapter') && x.el === holder.closest('.chapter'))) : -1;
    if (u >= 0 && u !== shownStop) go(u);
  });
  addEventListener('scroll', () => { if (!motion) renderHud(staticActive(), 1); }, { passive: true });
  addEventListener('resize', () => {
    const widthChanged = innerWidth !== lastWidth;
    lastWidth = innerWidth;
    if (widthChanged || !matchMedia('(pointer: coarse)').matches) layout();
  });

  /* ---------------- lightbox ---------------- */
  (() => {
    const lightbox = document.querySelector('.lightbox');
    if (!lightbox || typeof lightbox.showModal !== 'function') return;
    const image = lightbox.querySelector('.lightbox-img');
    const caption = lightbox.querySelector('.lightbox-caption');
    const count = lightbox.querySelector('.lightbox-count');
    const closeButton = lightbox.querySelector('.lightbox-close');
    let index = 0, opener = null, startX = null, startY = 0, swiped = false;
    function show(next, direction = 0) {
      index = (next + flyers.length) % flyers.length;
      const source = flyers[index].querySelector('img');
      image.classList.remove('is-in');
      caption.classList.remove('is-in');
      image.style.setProperty('--from', `${direction * (rtl ? -48 : 48)}px`);
      image.src = source.currentSrc || source.src;
      image.alt = source.alt;
      caption.textContent = flyers[index].dataset.title || '';
      count.textContent = `${pad(index + 1)} / ${pad(flyers.length)}`;
      void image.offsetWidth;
      image.classList.add('is-in');
      caption.classList.add('is-in');
    }
    flyers.forEach((f, i) => f.addEventListener('click', () => {
      opener = f;
      show(i);
      lightbox.showModal();
      document.body.classList.add('dialog-open');
      if (lenis) lenis.stop();
      closeButton.focus({ preventScroll: true });
    }));
    closeButton.addEventListener('click', () => lightbox.close());
    lightbox.querySelector('.lightbox-next').addEventListener('click', () => show(index + 1, 1));
    lightbox.querySelector('.lightbox-prev').addEventListener('click', () => show(index - 1, -1));
    lightbox.addEventListener('keydown', e => {
      if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) { e.preventDefault(); show(index + 1, 1); }
      else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) { e.preventDefault(); show(index - 1, -1); }
    });
    lightbox.addEventListener('click', e => {
      if (swiped) { swiped = false; return; }
      if (e.target === lightbox || e.target.classList.contains('lightbox-stage')) lightbox.close();
    });
    lightbox.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') { startX = e.clientX; startY = e.clientY; } });
    lightbox.addEventListener('pointerup', e => {
      if (startX === null) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      startX = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        swiped = true;
        setTimeout(() => { swiped = false; }, 400);
        const step = (dx > 0) === rtl ? 1 : -1;
        show(index + step, step);
      }
    });
    lightbox.addEventListener('pointercancel', () => { startX = null; });
    lightbox.addEventListener('close', () => {
      document.body.classList.remove('dialog-open');
      if (lenis) lenis.start();
      if (opener && !motion) opener.focus({ preventScroll: true });
    });
  })();

  /* ---------------- contact form ---------------- */
  (() => {
    const form = document.querySelector('.contact-form');
    if (!form) return;
    const address = form.dataset.email;
    const status = form.querySelector('.form-status');
    const fields = [...form.querySelectorAll('input, textarea')];
    const errorFor = field => document.getElementById(`${field.id}-error`);
    function check(field) {
      const empty = !field.value.trim();
      field.setAttribute('aria-invalid', String(empty));
      errorFor(field).textContent = empty ? field.dataset.error : '';
      return !empty;
    }
    fields.forEach(field => field.addEventListener('input', () => {
      if (field.getAttribute('aria-invalid') === 'true') check(field);
      status.textContent = '';
    }));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const invalid = fields.filter(field => !check(field));
      if (invalid.length) { status.textContent = ''; invalid[0].focus(); return; }
      const subject = form.elements.subject.value.trim();
      const body = `${form.elements.message.value.trim()}\r\n\r\n${T.sentFrom}`;
      window.location.href = `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      status.textContent = T.mailOpened;
    });
  })();

  document.getElementById('year').textContent = new Date().getFullYear();

  // A small handle for jumping between stops, e.g. TECHTACK.go(3).
  window.TECHTACK = {
    go: (s, immediate) => go(s, immediate),
    get progress() { return progressAt(scrollY); },
    get stop() { return shownStop; },
    get shown() { return shown; },
    get settled() { return morph.mix >= 1 && morph.to === shown && Math.abs(cam - shown) < 0.2 && (shownStop >= units.length || uvis[shownStop] >= 1); }
  };

  /* ---------------- start ---------------- */
  // A reload always starts from the beginning (the browser would otherwise restore the old scroll).
  if (!location.hash) scrollTo(0, 0);
  if (motion) startLenis();
  layout();
  if (!motion) { ready = true; renderHud(staticActive(), 1); showGreetingNote(true); }
  boot();
  requestAnimationFrame(frame);
  addEventListener('load', () => {
    if (!location.hash) scrollTo(0, 0);
    layout();
    if (location.hash) {
      const s = stopForId(location.hash.slice(1));
      if (s >= 0) go(s, true);
    }
  });
})();
