// A toy, top-down illustration of a dynamic programmable wireless environment:
// an access point (AP) reaches a mobile user through RIS tiles on the top wall and a
// metallic reflector array (MRA) on the right wall, while people walking around
// shadow some tiles. Shadowed tiles are excluded, beams are steered toward the user's
// predicted position, and occupancy changes as people enter and leave.
// It is a visual metaphor, not a channel model.
(function () {
  var canvas = document.getElementById('pwe-sim');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var wrap = canvas.parentNode;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var hud = {
    tiles: document.querySelector('[data-hud="tiles"]'),
    los: document.querySelector('[data-hud="los"]'),
    occ: document.querySelector('[data-hud="occ"]')
  };

  // World (room) units
  var W = 10, H = 7.4;
  var WALL = 0.16;
  var DOOR = { y0: 1.55, y1: 2.65, x: WALL };
  var AP = { x: 0.85, y: 6.55 };
  var PERSON_R = 0.34;
  var LOOKAHEAD = 1.1; // seconds of "prediction" drawn ahead of the user

  var tiles = [];
  var NT = 18;
  for (var i = 0; i < NT; i++) {
    tiles.push({ x: 1.25 + i * (7.5 / (NT - 1)), y: WALL + 0.1, glow: 0.3, blocked: false });
  }
  var mra = [];
  for (var j = 0; j < 5; j++) {
    mra.push({ x: W - WALL - 0.1, y: 2.0 + j * 0.78, glow: 0.3, blocked: false });
  }
  var desks = [
    { x: 2.1, y: 3.4, w: 1.5, h: 0.75 }, { x: 4.6, y: 3.4, w: 1.5, h: 0.75 },
    { x: 7.1, y: 3.4, w: 1.5, h: 0.75 }, { x: 4.6, y: 5.5, w: 1.5, h: 0.75 }
  ];

  function rand(a, b) { return a + Math.random() * (b - a); }
  function newTarget(p) { p.tx = rand(1.2, 8.8); p.ty = rand(1.3, 6.5); }
  function makePerson(x, y, state) {
    var p = { x: x, y: y, tx: x, ty: y, speed: rand(0.45, 0.7), pause: 0, state: state || 'in' };
    if (p.state === 'entering') { p.tx = 1.4; p.ty = (DOOR.y0 + DOOR.y1) / 2; } else { newTarget(p); }
    return p;
  }
  var people = [makePerson(3.2, 2.2), makePerson(6.4, 4.8), makePerson(8.2, 2.6)];
  var occTimer = rand(6, 10);

  function userPos(t) {
    return {
      x: 5 + 3.1 * Math.sin(t * 0.21) + 0.6 * Math.sin(t * 0.57),
      y: 4.25 + 1.75 * Math.sin(t * 0.29 + 1.2) + 0.35 * Math.cos(t * 0.71)
    };
  }

  // Shortest distance from point (px,py) to segment (ax,ay)-(bx,by)
  function segDist(ax, ay, bx, by, px, py) {
    var dx = bx - ax, dy = by - ay;
    var l2 = dx * dx + dy * dy;
    var t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + t * dx - px, cy = ay + t * dy - py;
    return Math.sqrt(cx * cx + cy * cy);
  }
  function blockedBy(ax, ay, bx, by) {
    for (var k = 0; k < people.length; k++) {
      if (segDist(ax, ay, bx, by, people[k].x, people[k].y) < PERSON_R) return people[k];
    }
    return null;
  }

  var t = 0;
  var state = { user: userPos(0), pred: userPos(LOOKAHEAD), best: [], bestMra: null, los: null, active: 0 };

  function step(dt) {
    t += dt;

    // Occupancy changes: people come and go through the door
    occTimer -= dt;
    if (occTimer <= 0) {
      occTimer = rand(7, 12);
      var inside = people.filter(function (p) { return p.state !== 'leaving'; });
      var add = inside.length <= 1 ? true : inside.length >= 4 ? false : Math.random() < 0.5;
      if (add) {
        people.push(makePerson(-0.3, (DOOR.y0 + DOOR.y1) / 2, 'entering'));
      } else {
        var p = inside[Math.floor(Math.random() * inside.length)];
        p.state = 'leaving'; p.tx = -0.4; p.ty = (DOOR.y0 + DOOR.y1) / 2; p.pause = 0;
      }
    }

    for (var k = people.length - 1; k >= 0; k--) {
      var p = people[k];
      if (p.pause > 0) { p.pause -= dt; continue; }
      var dx = p.tx - p.x, dy = p.ty - p.y, d = Math.sqrt(dx * dx + dy * dy);
      var mv = p.speed * dt;
      if (d <= mv) {
        p.x = p.tx; p.y = p.ty;
        if (p.state === 'leaving') { people.splice(k, 1); continue; }
        if (p.state === 'entering') p.state = 'in';
        p.pause = rand(0.4, 2.2);
        newTarget(p);
      } else {
        p.x += dx / d * mv; p.y += dy / d * mv;
      }
    }

    state.user = userPos(t);
    state.pred = userPos(t + LOOKAHEAD);
    var u = state.user, q = state.pred;

    // Tile gains toward the predicted position; shadowed tiles are excluded
    var cand = [];
    state.active = 0;
    tiles.forEach(function (tl, idx) {
      tl.blocked = !!(blockedBy(AP.x, AP.y, tl.x, tl.y) || blockedBy(tl.x, tl.y, u.x, u.y));
      if (!tl.blocked) {
        state.active++;
        var d1 = Math.hypot(tl.x - AP.x, tl.y - AP.y), d2 = Math.hypot(tl.x - q.x, tl.y - q.y);
        cand.push({ i: idx, g: 1 / (d1 * d2) });
      }
    });
    cand.sort(function (a, b) { return b.g - a.g; });
    state.best = cand.slice(0, 3).map(function (c) { return c.i; });

    var bestM = null, bestG = 0;
    mra.forEach(function (m, idx) {
      m.blocked = !!(blockedBy(AP.x, AP.y, m.x, m.y) || blockedBy(m.x, m.y, u.x, u.y));
      if (!m.blocked) {
        var g = 1 / (Math.hypot(m.x - AP.x, m.y - AP.y) * Math.hypot(m.x - u.x, m.y - u.y));
        if (g > bestG) { bestG = g; bestM = idx; }
      }
    });
    state.bestMra = bestM;
    state.los = blockedBy(AP.x, AP.y, u.x, u.y);

    var ease = Math.min(1, dt * 6);
    tiles.forEach(function (tl, idx) {
      var target = tl.blocked ? 0 : state.best.indexOf(idx) >= 0 ? 1 : 0.38;
      tl.glow += (target - tl.glow) * ease;
    });
    mra.forEach(function (m, idx) {
      var target = m.blocked ? 0 : idx === state.bestMra ? 1 : 0.38;
      m.glow += (target - m.glow) * ease;
    });
  }

  // ---------- Drawing ----------
  var dpr = 1, scale = 1, ox = 0, oy = 0;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = wrap.clientWidth, h = wrap.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    scale = Math.min(canvas.width / W, canvas.height / H);
    ox = (canvas.width - W * scale) / 2;
    oy = (canvas.height - H * scale) / 2;
  }
  function X(x) { return ox + x * scale; }
  function Y(y) { return oy + y * scale; }
  function S(v) { return v * scale; }

  function label(text, x, y, align, color) {
    ctx.font = '600 ' + Math.max(9, Math.round(S(0.24))) + 'px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = color || 'rgba(148,163,184,.85)';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, X(x), Y(y));
  }

  function beam(points, color, width, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * dpr;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 10 * dpr;
    ctx.beginPath();
    ctx.moveTo(X(points[0].x), Y(points[0].y));
    for (var k = 1; k < points.length; k++) ctx.lineTo(X(points[k].x), Y(points[k].y));
    ctx.stroke();
    ctx.restore();
  }

  function packets(points, color, phase) {
    var lens = [], total = 0;
    for (var k = 1; k < points.length; k++) {
      var l = Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
      lens.push(l); total += l;
    }
    ctx.fillStyle = color;
    for (var n = 0; n < 3; n++) {
      var s = ((phase + n / 3) % 1) * total;
      for (var m = 0; m < lens.length; m++) {
        if (s <= lens[m]) {
          var f = s / lens[m];
          var px = points[m].x + (points[m + 1].x - points[m].x) * f;
          var py = points[m].y + (points[m + 1].y - points[m].y) * f;
          ctx.beginPath(); ctx.arc(X(px), Y(py), 2.2 * dpr, 0, Math.PI * 2); ctx.fill();
          break;
        }
        s -= lens[m];
      }
    }
  }

  function draw() {
    var cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0a1124';
    ctx.fillRect(0, 0, cw, ch);

    // Floor grid
    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    ctx.lineWidth = 1;
    for (var gx = 1; gx < W; gx++) { ctx.beginPath(); ctx.moveTo(X(gx), Y(WALL)); ctx.lineTo(X(gx), Y(H - WALL)); ctx.stroke(); }
    for (var gy = 1; gy < H; gy++) { ctx.beginPath(); ctx.moveTo(X(WALL), Y(gy)); ctx.lineTo(X(W - WALL), Y(gy)); ctx.stroke(); }

    // Desks (do not block in this toy model)
    ctx.fillStyle = 'rgba(148,163,184,.07)';
    ctx.strokeStyle = 'rgba(148,163,184,.14)';
    desks.forEach(function (d) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(X(d.x), Y(d.y), S(d.w), S(d.h), S(0.08)); else ctx.rect(X(d.x), Y(d.y), S(d.w), S(d.h));
      ctx.fill(); ctx.stroke();
    });

    // Walls, with a door on the left
    ctx.strokeStyle = 'rgba(148,163,184,.4)';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(X(WALL), Y(DOOR.y0));
    ctx.lineTo(X(WALL), Y(WALL)); ctx.lineTo(X(W - WALL), Y(WALL));
    ctx.lineTo(X(W - WALL), Y(H - WALL)); ctx.lineTo(X(WALL), Y(H - WALL));
    ctx.lineTo(X(WALL), Y(DOOR.y1));
    ctx.stroke();
    label('door', WALL + 0.12, (DOOR.y0 + DOOR.y1) / 2, 'left', 'rgba(148,163,184,.5)');

    var u = state.user, q = state.pred;

    // Line of sight
    if (state.los) {
      var b = state.los;
      var dx = u.x - AP.x, dy = u.y - AP.y, len = Math.hypot(dx, dy);
      var proj = ((b.x - AP.x) * dx + (b.y - AP.y) * dy) / len;
      var stopAt = Math.max(0, proj - PERSON_R) / len;
      ctx.save();
      ctx.setLineDash([4 * dpr, 5 * dpr]);
      ctx.strokeStyle = 'rgba(248,113,113,.75)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(X(AP.x), Y(AP.y)); ctx.lineTo(X(AP.x + dx * stopAt), Y(AP.y + dy * stopAt)); ctx.stroke();
      ctx.restore();
    } else {
      beam([AP, u], '#fbbf24', 1.6, 0.55);
    }

    // RIS-assisted beams, steered toward the predicted position
    var phase = (t * 0.55) % 1;
    state.best.forEach(function (idx, rank) {
      var tl = tiles[idx];
      var pts = [AP, { x: tl.x, y: tl.y + 0.12 }, u];
      beam(pts, '#2dd4bf', rank === 0 ? 2.2 : 1.2, rank === 0 ? 0.9 : 0.35);
      if (rank === 0) packets(pts, '#ccfbf1', phase);
    });
    if (state.best.length) {
      var top = tiles[state.best[0]];
      ctx.save();
      ctx.setLineDash([3 * dpr, 5 * dpr]);
      ctx.strokeStyle = 'rgba(45,212,191,.45)';
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.moveTo(X(top.x), Y(top.y + 0.12)); ctx.lineTo(X(q.x), Y(q.y)); ctx.stroke();
      ctx.restore();
    }
    if (state.bestMra !== null) {
      var m = mra[state.bestMra];
      var mp = [AP, { x: m.x - 0.1, y: m.y }, u];
      beam(mp, '#a78bfa', 1.6, 0.7);
      packets(mp, '#ede9fe', (phase + 0.5) % 1);
    }

    // RIS tiles
    var tw = 7.5 / (NT - 1) * 0.78;
    tiles.forEach(function (tl) {
      var x = X(tl.x - tw / 2), y = Y(tl.y - 0.07), w = S(tw), h = S(0.2);
      if (tl.blocked) {
        ctx.fillStyle = '#1b2438';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(148,163,184,.35)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + w - 2, y + h - 2); ctx.stroke();
      } else {
        ctx.save();
        ctx.shadowColor = '#2dd4bf';
        ctx.shadowBlur = 14 * dpr * tl.glow;
        ctx.fillStyle = 'rgba(45,212,191,' + (0.25 + 0.75 * tl.glow).toFixed(3) + ')';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
      }
    });
    label('RIS tiles', 1.08, WALL + 0.52, 'left', 'rgba(94,234,212,.8)');

    // MRA slats (angled metal strips)
    mra.forEach(function (m) {
      ctx.save();
      ctx.translate(X(m.x), Y(m.y));
      ctx.rotate(-0.5);
      if (m.blocked) {
        ctx.fillStyle = '#2a2f45';
      } else {
        ctx.shadowColor = '#a78bfa';
        ctx.shadowBlur = 12 * dpr * m.glow;
        ctx.fillStyle = 'rgba(167,139,250,' + (0.3 + 0.7 * m.glow).toFixed(3) + ')';
      }
      ctx.fillRect(-S(0.05), -S(0.28), S(0.1), S(0.56));
      ctx.restore();
    });
    label('MRA', W - WALL - 0.42, 1.45, 'right', 'rgba(196,181,253,.85)');

    // People (blockers)
    people.forEach(function (p) {
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), S(PERSON_R * 0.72), 0, Math.PI * 2);
      ctx.fillStyle = '#475569'; ctx.fill();
      ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = 'rgba(203,213,225,.35)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), S(0.12), 0, Math.PI * 2);
      ctx.fillStyle = '#94a3b8'; ctx.fill();
    });

    // Predicted user position
    ctx.save();
    ctx.setLineDash([3 * dpr, 4 * dpr]);
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), S(0.2), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    label('t+Δ', q.x, q.y - 0.4, 'center', 'rgba(255,255,255,.55)');

    // User
    var pulse = reduceMotion ? 0.5 : (Math.sin(t * 3) + 1) / 2;
    ctx.beginPath(); ctx.arc(X(u.x), Y(u.y), S(0.2 + 0.12 * pulse), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(45,212,191,' + (0.25 - 0.15 * pulse).toFixed(3) + ')'; ctx.fill();
    ctx.beginPath(); ctx.arc(X(u.x), Y(u.y), S(0.14), 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    label('user', u.x, u.y + 0.46, 'center', '#e2e8f0');

    // Access point
    ctx.save();
    ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 12 * dpr;
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(X(AP.x - 0.17), Y(AP.y - 0.17), S(0.34), S(0.34), S(0.07)); else ctx.rect(X(AP.x - 0.17), Y(AP.y - 0.17), S(0.34), S(0.34));
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(251,191,36,.45)';
    ctx.lineWidth = 1.4 * dpr;
    for (var r = 1; r <= 2; r++) {
      ctx.beginPath(); ctx.arc(X(AP.x), Y(AP.y), S(0.3 + r * 0.2), -Math.PI * 0.5, 0); ctx.stroke();
    }
    label('AP', AP.x + 0.32, AP.y + 0.28, 'left', '#fde68a');
  }

  var lastHud = -1;
  function updateHud(force) {
    if (!force && t - lastHud < 0.25) return;
    lastHud = t;
    var occ = people.filter(function (p) { return p.state !== 'leaving'; }).length + 1;
    var level = occ <= 2 ? 'low' : occ <= 4 ? 'medium' : 'high';
    if (hud.tiles) hud.tiles.textContent = state.active + ' / ' + NT;
    if (hud.los) hud.los.textContent = state.los ? 'Blocked' : 'Clear';
    if (hud.occ) hud.occ.textContent = occ + ' · ' + level;
  }

  resize();
  if (window.ResizeObserver) {
    new ResizeObserver(function () { resize(); draw(); }).observe(wrap);
  } else {
    window.addEventListener('resize', function () { resize(); draw(); });
  }

  if (reduceMotion) {
    // One representative still frame
    for (var s = 0; s < 240; s++) step(1 / 30);
    draw();
    updateHud(true);
    return;
  }

  var running = true, onScreen = true, last = null;
  function frame(now) {
    if (!running) { last = null; return; }
    if (last === null) last = now;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    updateHud(false);
    requestAnimationFrame(frame);
  }
  function setRunning(v) {
    var was = running;
    running = v;
    if (v && !was) requestAnimationFrame(frame);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
      setRunning(onScreen && !document.hidden);
    }).observe(canvas);
  }
  document.addEventListener('visibilitychange', function () { setRunning(onScreen && !document.hidden); });
  step(0.016);
  requestAnimationFrame(frame);
})();
