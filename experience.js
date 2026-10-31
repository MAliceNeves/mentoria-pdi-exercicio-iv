(() => {
  'use strict';
  const garden = document.querySelector('#garden');
  const scenes = [...document.querySelectorAll('.scene')];
  const images = scenes.map(scene => scene.querySelector('img'));
  const blackout = document.querySelector('#blackout');
  const viewport = document.querySelector('.viewport');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = value => Math.min(1, Math.max(0, value));
  const smooth = value => { const t = clamp(value); return t * t * t * (t * (t * 6 - 15) + 10); };
  // Preserve the panorama's pace, then add a long, separate fade to darkness.
  const finalViewDuration = 2.4;
  const finalFadeStart = finalViewDuration * .8;
  const finalFadeDuration = 3.4;
  const durations = [1, 1, 1, 1, finalFadeStart + finalFadeDuration + .08];
  const cycleLength = durations.reduce((sum, duration) => sum + duration, 0);
  // The final view still uses placeholder frames until its artwork is ready.
  const imageCycles = {
    1: { frames: ['assets/fountain1.png', 'assets/fountain2.png', 'assets/fountain3.png'], interval: 200 },
    4: { frames: ['assets/final.png', 'assets/final.png', 'assets/final.png'], interval: 1200 }
  };
  const loadedFrames = new Map();
  Object.values(imageCycles).forEach(cycle => cycle.frames.forEach(src => {
    if (loadedFrames.has(src)) return;
    const image = new Image();
    image.src = src;
    loadedFrames.set(src, image);
  }));
  let sceneLength = 1;
  let cycleCount = 1;
  let position = 0;
  let target = 0;
  let frame = 0;
  let lastTime = 0;
  let activeChapter = -1;
  let cycleStarted = 0;
  const gateSound = new Audio('assets/tree-garden-sound.mp3');
  gateSound.loop = true;
  gateSound.preload = 'auto';
  gateSound.volume = 0;
  let gateVolume = 0;
  let soundBlocked = false;
  let soundPending = false;
  function createAmbience(src, { introBoost = 1, fadeIn = 700 } = {}) {
    const sound = new Audio(src);
    sound.loop = true;
    sound.preload = 'auto';
    sound.volume = 0;
    let volume = 0;
    let blocked = false;
    let pending = false;
    let fadeFrame = 0;
    let fadeTime = 0;
    let introStarted = null;

    function fade(now) {
      fadeFrame = 0;
      if (document.hidden) {
        sound.volume = 0;
        sound.pause();
        fadeTime = 0;
        return;
      }
      const dt = Math.min(now - (fadeTime || now - 16.67), 64);
      fadeTime = now;
      const introElapsed = introStarted === null ? 0 : now - introStarted;
      // Let the opening swell, then settle to the regular level over four seconds.
      const boost = 1 + (introBoost - 1) * (1 - smooth((introElapsed - 2000) / 4000));
      const desiredVolume = clamp(volume * boost);
      const introRunning = introBoost > 1 && volume > 0 && introStarted !== null && introElapsed < 6000;
      // Fade over time even when scrolling stops; never start at full volume.
      const duration = desiredVolume > sound.volume ? fadeIn : 300;
      sound.volume += (desiredVolume - sound.volume) * (1 - Math.exp(-dt / duration));
      // Count the loud opening only once it is actually audible at full level,
      // rather than spending those two seconds behind the scene's visual fade.
      if (introBoost > 1 && introStarted === null && sound.volume >= .95) introStarted = now;
      const introJustStarted = introStarted === now;
      if (Math.abs(desiredVolume - sound.volume) > .001 || introRunning || introJustStarted) {
        fadeFrame = requestAnimationFrame(fade);
      } else {
        sound.volume = desiredVolume;
        fadeTime = 0;
        if (volume === 0) sound.pause();
      }
    }

    function update() {
      if (document.hidden) {
        sound.volume = 0;
        sound.pause();
        return;
      }
      if (!sound.paused) {
        if (!fadeFrame) fadeFrame = requestAnimationFrame(fade);
        return;
      }
      if (volume === 0 || blocked || pending) return;
      pending = true;
      sound.volume = 0;
      sound.play().then(() => {
        pending = false;
        introStarted = null;
        update();
      }).catch(() => {
        pending = false;
        blocked = true;
      });
    }

    document.addEventListener('visibilitychange', update);
    return {
      setVolume(value) { volume = value; update(); },
      unlock() { blocked = false; update(); }
    };
  }

  const fountainAmbience = createAmbience('assets/fountain-sound.mp3');
  const treeAmbience = createAmbience('assets/tree-garden-sound.mp3');
  const tunnelAmbience = createAmbience('assets/tunnel-sound.mp3');
  const finalAmbience = createAmbience('assets/final-river-sound.mp3', { introBoost: 1 / .6, fadeIn: 250 });
  const finalMusic = createAmbience('assets/misterioso.mp3');

  function updateGateSound() {
    const shouldPlay = activeChapter === 0 && !document.hidden;
    gateSound.volume = shouldPlay ? gateVolume : 0;
    if (!shouldPlay) {
      gateSound.pause();
      return;
    }
    if (!gateSound.paused || soundBlocked || soundPending) return;
    soundPending = true;
    gateSound.play().then(() => {
      soundPending = false;
      if (activeChapter !== 0 || document.hidden) gateSound.pause();
    }).catch(() => {
      soundPending = false;
      soundBlocked = true;
    });
  }

  function unlockSound() {
    soundBlocked = false;
    updateGateSound();
    fountainAmbience.unlock();
    treeAmbience.unlock();
    tunnelAmbience.unlock();
    finalAmbience.unlock();
    finalMusic.unlock();
  }

  function updateImageCycle() {
    const cycle = imageCycles[activeChapter];
    if (!cycle || document.hidden) return;
    const index = reducedMotion.matches ? 0 : Math.floor((performance.now() - cycleStarted) / cycle.interval) % cycle.frames.length;
    const src = cycle.frames[index];
    const ready = loadedFrames.get(src);
    if (ready.complete && ready.naturalWidth && images[activeChapter].getAttribute('src') !== src) {
      images[activeChapter].src = src;
    }
  }

  function setHeight() {
    garden.style.height = `${cycleCount * cycleLength * sceneLength + viewport.clientHeight}px`;
  }

  function render() {
    let remaining = Math.max(0, position) % cycleLength;
    let chapter = 0;
    while (chapter < durations.length - 1 && remaining >= durations[chapter]) {
      remaining -= durations[chapter++];
    }
    const local = remaining / (chapter === 4 ? finalViewDuration : durations[chapter]);
    if (activeChapter !== chapter) {
      activeChapter = chapter;
      cycleStarted = performance.now();
      updateImageCycle();
    }
    // Broader fades have flat, gentle ends. The gate holds in darkness
    // before the fountain slowly appears on the other side.
    const entering = chapter === 1
      ? 1 - smooth((local - .09) / .34)
      : 1 - smooth((local - .025) / .3);
    const leaving = chapter === 0 ? smooth((local - .52) / .28)
      : chapter === 4 ? smooth((remaining - finalFadeStart) / finalFadeDuration)
      : smooth((local - .62) / .32);
    // Walk into light at the tunnel exit; return from the view through black.
    const white = (chapter === 3 && leaving > 0) || (chapter === 4 && entering > leaving);
    blackout.style.backgroundColor = white ? '#fff' : '#000';
    blackout.style.opacity = Math.max(entering, leaving);
    gateVolume = chapter === 0 ? .65 * (1 - Math.max(entering, leaving)) : 0;
    const sceneVolume = 1 - Math.max(entering, leaving);
    fountainAmbience.setVolume(chapter === 1 ? .6 * sceneVolume : 0);
    treeAmbience.setVolume(chapter === 2 ? .6 * sceneVolume : 0);
    tunnelAmbience.setVolume(chapter === 3 ? .6 * sceneVolume : 0);
    finalAmbience.setVolume(chapter === 4 ? .6 * sceneVolume : 0);
    finalMusic.setVolume(chapter === 4 ? .45 * sceneVolume : 0);
    updateGateSound();
    scenes.forEach((scene, index) => {
      const active = index === chapter;
      scene.style.opacity = active ? 1 : 0;
      scene.setAttribute('aria-hidden', String(!active));
      if (!active) return;
      let scale = 1;
      let x = 0;
      let y = 0;
      if (chapter === 4) {
        const pan = reducedMotion.matches ? .5 : smooth((local - .25) / .53);
        // Move the enlarged panorama past the viewport, exploring left to right.
        x = -(images[index].clientWidth - viewport.clientWidth) * pan;
        y = -viewport.clientHeight * .1;
      }
      scene.style.clipPath = 'none';
      if (!reducedMotion.matches) {
        // Cubic ease-in: almost still at first, accelerating into the gate.
        if (chapter === 0) scale = 1 + 2.4 * Math.pow(clamp(local / .98), 3);
        if (chapter === 3) scale = 1 + 2.1 * Math.pow(clamp((local - .12) / .86), 2);
        if (chapter === 2) {
          scene.style.clipPath = `inset(${(1 - smooth((local - .08) / .3)) * 100}% 0 0 0)`;
          // Start at the base and pan the view up toward the canopy.
          // The tall image moves down from its bottom-aligned starting point.
          const rise = Math.pow(clamp((local - .18) / .56), 3);
          y = -viewport.clientHeight * .4 * (1 - rise);
        }
      }
      images[index].style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    });
  }

  function animate(now) {
    const dt = Math.min(now - (lastTime || now - 16.67), 64);
    lastTime = now;
    // Time-based interpolation gives mouse wheels and trackpads the same glide.
    position += (target - position) * (reducedMotion.matches ? 1 : 1 - Math.exp(-dt / 260));
    if (Math.abs(target - position) < .00001) position = target;
    render();
    if (position !== target) frame = requestAnimationFrame(animate);
    else { frame = 0; lastTime = 0; }
  }

  function onScroll() {
    target = Math.max(0, window.scrollY / sceneLength);
    // Extend below the visitor, keeping the scroll position moving down naturally
    // when the final view gives way to the next gate. Never jump back to the top.
    if (target >= cycleCount * cycleLength - durations[4]) {
      cycleCount = Math.floor(target / cycleLength) + 2;
      setHeight();
    }
    if (!frame) frame = requestAnimationFrame(animate);
  }

  function resize() {
    sceneLength = Math.max(1500, viewport.clientHeight * 4);
    setHeight();
    onScroll();
  }

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', resize);
  addEventListener('pointerdown', unlockSound, { passive: true });
  addEventListener('touchend', unlockSound, { passive: true });
  addEventListener('keydown', unlockSound);
  document.addEventListener('visibilitychange', updateGateSound);
  reducedMotion.addEventListener('change', onScroll);
  setInterval(updateImageCycle, 100);
  resize();
  position = target;
  render();
})();
