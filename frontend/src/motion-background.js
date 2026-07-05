function ensureMotionBackground() {
  if (document.querySelector(".motion-canvas")) return;
  const canvas = document.createElement("canvas");
  canvas.className = "motion-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.insertBefore(canvas, document.querySelector("#app"));

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pointer = { x: -9999, y: -9999, vx: 0, vy: 0, target: 0, glow: 0 };
  const particles = [];
  const bursts = [];
  let width = 0;
  let height = 0;
  let dpr = 1;
  let raf = 0;
  let lastTime = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seedParticles();
  }

  function seedParticles() {
    particles.length = 0;
    const count = Math.min(7600, Math.max(2400, Math.floor((width * height) / 210)));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        size: 0.7 + Math.random() * 1.7,
        phase: Math.random() * Math.PI * 2,
        depth: 0.35 + Math.random() * 0.9
      });
    }
  }

  function pointerMove(event) {
    if (pointer.x > -1000) {
      pointer.vx = event.clientX - pointer.x;
      pointer.vy = event.clientY - pointer.y;
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.target = 1;
  }

  function pointerDown(event) {
    bursts.push({ x: event.clientX, y: event.clientY, life: 1, radius: 34 });
    if (bursts.length > 8) bursts.shift();
  }

  function drawStatic() {
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";
    for (const particle of particles) {
      const alpha = 0.05 + particle.depth * 0.1;
      ctx.fillStyle = `rgba(245,200,75,${alpha})`;
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function draw(time) {
    const dt = Math.min(34, time - (lastTime || time)) || 16;
    lastTime = time;
    const step = dt / 16;
    const t = time * 0.00018;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";
    pointer.target *= 0.925;
    pointer.glow += (pointer.target - pointer.glow) * 0.055 * step;
    for (let i = bursts.length - 1; i >= 0; i--) {
      bursts[i].life -= 0.034;
      bursts[i].radius += 8.5 * step;
      if (bursts[i].life <= 0) bursts.splice(i, 1);
    }

    for (const particle of particles) {
      const waveX = Math.sin(particle.y * 0.006 + t * 2.2 + particle.phase);
      const waveY = Math.cos(particle.x * 0.005 + t * 1.8 + particle.phase * 0.7);
      particle.vx += (waveX * 0.032 + 0.018 * particle.depth) * step;
      particle.vy += (waveY * 0.026 - 0.006) * step;

      const dx = particle.x - pointer.x;
      const dy = particle.y - pointer.y;
      const distSq = dx * dx + dy * dy;
      const radius = 210;
      if (pointer.glow > 0.01 && distSq < radius * radius) {
        const dist = Math.sqrt(distSq) || 1;
        const force = (1 - dist / radius) * pointer.glow;
        const tangentX = -dy / dist;
        const tangentY = dx / dist;
        particle.vx += (tangentX * 0.42 + pointer.vx * 0.012) * force * particle.depth;
        particle.vy += (tangentY * 0.42 + pointer.vy * 0.012) * force * particle.depth;
      }

      let burstGlow = 0;
      for (const burst of bursts) {
        const bx = particle.x - burst.x;
        const by = particle.y - burst.y;
        const burstDistance = Math.sqrt(bx * bx + by * by) || 1;
        const ring = Math.abs(burstDistance - burst.radius);
        const ringForce = Math.max(0, 1 - ring / 68) * burst.life;
        const coreForce = Math.max(0, 1 - burstDistance / 170) * burst.life;
        if (ringForce > 0 || coreForce > 0) {
          const push = ringForce * 1.9 + coreForce * 0.42;
          particle.vx += (bx / burstDistance) * push * particle.depth;
          particle.vy += (by / burstDistance) * push * particle.depth;
          burstGlow = Math.max(burstGlow, ringForce + coreForce * 0.45);
        }
      }

      particle.vx *= 0.965;
      particle.vy *= 0.965;
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;

      if (particle.x < -12) particle.x = width + 12;
      if (particle.x > width + 12) particle.x = -12;
      if (particle.y < -12) particle.y = height + 12;
      if (particle.y > height + 12) particle.y = -12;

      const nearPointer = Math.max(0, 1 - distSq / (190 * 190));
      const alpha = 0.035 + particle.depth * 0.105 + nearPointer * 0.34 * pointer.glow + burstGlow * 0.42;
      const size = particle.size + nearPointer * 2.2 * pointer.glow + burstGlow * 2.8;
      ctx.fillStyle = `rgba(245,200,75,${alpha})`;
      ctx.fillRect(particle.x, particle.y, size, size);
    }

    ctx.globalCompositeOperation = "source-over";
    raf = window.requestAnimationFrame(draw);
  }

  function start() {
    window.cancelAnimationFrame(raf);
    resize();
    if (reduced.matches) {
      drawStatic();
      return;
    }
    raf = window.requestAnimationFrame(draw);
  }

  window.addEventListener("resize", start);
  window.addEventListener("pointermove", pointerMove, { passive: true });
  window.addEventListener("pointerdown", pointerDown, { passive: true });
  reduced.addEventListener?.("change", start);
  start();
}

export { ensureMotionBackground };
