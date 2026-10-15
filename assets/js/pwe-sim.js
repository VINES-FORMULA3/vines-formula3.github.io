// Home page: an interactive, illustrative view of a dynamic programmable wireless
// environment. Three fixed two-minute scenarios (indoor, outdoor <-> indoor,
// and an outdoor street) play in the hero; visitors pick the scenario, a band, and switch the RIS and
// the MRA on or off. The timeline strip shows the whole scenario with the time
// below the target marked, and the results section compares the options.
// The link model lives in pwe-model.js.
(function () {
  var M = window.PWEModel;
  var canvas = document.getElementById('pwe-sim');
  if (!M || !canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var wrap = canvas.parentNode;
  var strip = document.getElementById('pwe-strip');
  var tctx = strip && strip.getContext ? strip.getContext('2d') : null;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var W = M.W, H = M.H, WALL = M.WALL, PERSON_R = M.PERSON_R;
  var DURATION = 120;        // seconds per scenario
  var DT = 0.05;             // fixed simulation step
  var N = Math.round(DURATION / DT);
  var TARGET = 2;            // Gbps: a multi-Gbps demo threshold
  var YMAX = 8;              // Gbps: strip scale
  var LINE = '#199e70', BELOW = '#d03b3b';
  var CONE = { sub6: 0.55, fr3: 0.24, mmw: 0.1 }; // beam half-width (rad), picture only

  // Representative scenarios (see README)
  var SCENES = {
    indoor: { make: M.createWorld, seed: 210 },
    o2i: { make: M.createO2IWorld, seed: 392 },
    out: { make: M.createOutdoorWorld, seed: 366 }
  };

  var bands = {};
  M.BANDS.forEach(function (b) { bands[b.key] = b; });
  var COMBOS = [
    { id: 'none', ris: false, mra: false, label: 'no surfaces' },
    { id: 'ris', ris: true, mra: false, label: 'RIS only' },
    { id: 'mra', ris: false, mra: true, label: 'MRA only' },
    { id: 'both', ris: true, mra: true, label: 'RIS + MRA' }
  ];
  function comboId(ris, mra) { return ris ? (mra ? 'both' : 'ris') : (mra ? 'mra' : 'none'); }
  function comboOf(id) { return COMBOS.filter(function (c) { return c.id === id; })[0]; }
  var configs = [];
  M.BANDS.forEach(function (b) {
    COMBOS.forEach(function (c) { configs.push({ key: b.key + '-' + c.id, band: b, ris: c.ris, mra: c.mra }); });
  });

  // ---------- Precompute each scenario for every option ----------
  var data = {};
  function precompute(sceneKey) {
    var sc = SCENES[sceneKey], w = sc.make(sc.seed), last = w.occupancy();
    var series = {}, stats = {}, events = [];
    configs.forEach(function (c) { series[c.key] = new Float32Array(N); });
    for (var i = 0; i < N; i++) {
      w.step(DT);
      configs.forEach(function (c) { series[c.key][i] = w.evaluate(c.band, c.ris, c.mra).rate; });
      var o = w.occupancy();
      if (o !== last) { events.push({ i: i, kind: o > last ? 'in' : 'out' }); last = o; }
      if (w.carEvent) { events.push({ i: i, kind: 'car' }); w.carEvent = false; }
    }
    configs.forEach(function (c) {
      var s = series[c.key], below = 0, sum = 0;
      for (var j = 0; j < N; j++) { if (s[j] < TARGET) below++; sum += s[j]; }
      stats[c.key] = { belowS: below * DT, avg: sum / N };
    });
    data[sceneKey] = { series: series, stats: stats, events: events };
  }
  precompute('indoor');
  precompute('o2i');
  precompute('out');

  var sel = { scene: 'indoor', band: 'fr3', ris: true, mra: true };
  function selKey() { return sel.band + '-' + comboId(sel.ris, sel.mra); }
  function cur() { return data[sel.scene]; }

  // ---------- Playback (fixed step, so it matches the precomputed run) ----------
  var world = null, k = 0;
  var tileGlow = [], mraGlow = [];
  function seek(toK) {
    toK = Math.max(1, Math.min(N, toK));
    if (!world || toK < k) {
      var sc = SCENES[sel.scene];
      world = sc.make(sc.seed); k = 0; tileGlow = []; mraGlow = [];
    }
    while (k < toK) { world.step(DT); k++; }
    glow(1);
  }
  function advance() {
    if (k >= N) { world = null; seek(1); return; }
    world.step(DT); k++;
  }
  function glow(ease) {
    world.tiles.forEach(function (tl, i) {
      var target = !sel.ris || tl.blocked ? 0 : world.best.indexOf(i) >= 0 ? 1 : 0.38;
      tileGlow[i] = tileGlow[i] === undefined ? target : tileGlow[i] + (target - tileGlow[i]) * ease;
    });
    world.mra.forEach(function (m, i) {
      var target = !sel.mra || m.blocked ? 0 : i === world.bestMra ? 1 : 0.38;
      mraGlow[i] = mraGlow[i] === undefined ? target : mraGlow[i] + (target - mraGlow[i]) * ease;
    });
  }
  function rateNow() { return cur().series[selKey()][k - 1]; }

  function db2lin(db) { return Math.pow(10, db / 10); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmtTime(sec) { sec = Math.round(sec); return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2); }
  function fmtS(s) { return (s >= 10 ? s.toFixed(0) : s.toFixed(1)) + ' s'; }

  // ---------- Scene drawing ----------
  var dpr = 1, scale = 1, ox = 0, oy = 0, phase = 0;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(wrap.clientWidth * dpr);
    canvas.height = Math.round(wrap.clientHeight * dpr);
    scale = Math.min(canvas.width / W, canvas.height / H);
    ox = (canvas.width - W * scale) / 2;
    oy = (canvas.height - H * scale) / 2;
    if (strip) {
      strip.width = Math.round(strip.clientWidth * dpr);
      strip.height = Math.round(strip.clientHeight * dpr);
    }
  }
  function X(x) { return ox + x * scale; }
  function Y(y) { return oy + y * scale; }
  function S(v) { return v * scale; }
  function label(text, x, y, align, color) {
    ctx.font = '600 ' + Math.max(10, Math.round(S(0.22))) + 'px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = color || 'rgba(148,163,184,.85)';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, X(x), Y(y));
  }
  function line(points, color, width, alpha, dash) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * dpr;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (dash) ctx.setLineDash(dash.map(function (d) { return d * dpr; }));
    else { ctx.shadowColor = color; ctx.shadowBlur = 10 * dpr; }
    ctx.beginPath();
    ctx.moveTo(X(points[0].x), Y(points[0].y));
    for (var i = 1; i < points.length; i++) ctx.lineTo(X(points[i].x), Y(points[i].y));
    ctx.stroke();
    ctx.restore();
  }
  function packets(points, color, reverse, offset) {
    if (reverse) points = points.slice().reverse();
    var lens = [], total = 0;
    for (var i = 1; i < points.length; i++) {
      var l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      lens.push(l); total += l;
    }
    ctx.fillStyle = color;
    for (var n = 0; n < 4; n++) {
      var s = ((phase + (offset || 0) + n / 4) % 1) * total;
      for (var m = 0; m < lens.length; m++) {
        if (s <= lens[m]) {
          var f = s / lens[m];
          ctx.beginPath();
          ctx.arc(X(points[m].x + (points[m + 1].x - points[m].x) * f), Y(points[m].y + (points[m + 1].y - points[m].y) * f), 2.4 * dpr, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        s -= lens[m];
      }
    }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  function wallLine(pts, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * dpr;
    ctx.beginPath();
    ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
    for (var i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
    ctx.stroke();
  }
  function grid(x0) {
    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    ctx.lineWidth = 1;
    for (var gx = Math.ceil(x0); gx < W; gx++) { ctx.beginPath(); ctx.moveTo(X(gx), Y(WALL)); ctx.lineTo(X(gx), Y(H - WALL)); ctx.stroke(); }
    for (var gy = 1; gy < H; gy++) { ctx.beginPath(); ctx.moveTo(X(Math.max(WALL, x0)), Y(gy)); ctx.lineTo(X(W - WALL), Y(gy)); ctx.stroke(); }
  }
  function desks(list) {
    ctx.fillStyle = 'rgba(148,163,184,.07)';
    ctx.strokeStyle = 'rgba(148,163,184,.14)';
    ctx.lineWidth = 1;
    list.forEach(function (d) { roundRect(X(d.x), Y(d.y), S(d.w), S(d.h), S(0.08)); ctx.fill(); ctx.stroke(); });
  }
  var DESKS_INDOOR = [
    { x: 2.1, y: 3.4, w: 1.5, h: 0.75 }, { x: 4.6, y: 3.4, w: 1.5, h: 0.75 },
    { x: 7.1, y: 3.4, w: 1.5, h: 0.75 }, { x: 4.6, y: 5.5, w: 1.5, h: 0.75 }
  ];
  var DESKS_O2I = [
    { x: 4.6, y: 2.3, w: 1.3, h: 0.7 }, { x: 7.3, y: 2.3, w: 1.3, h: 0.7 },
    { x: 4.6, y: 4.6, w: 1.3, h: 0.7 }, { x: 7.3, y: 4.6, w: 1.3, h: 0.7 }
  ];

  function drawIndoorBackdrop() {
    grid(0);
    desks(DESKS_INDOOR);
    var D = M.DOOR;
    wallLine([[WALL, D.y0], [WALL, WALL], [W - WALL, WALL], [W - WALL, H - WALL], [WALL, H - WALL], [WALL, D.y1]], 'rgba(148,163,184,.4)', 2);
    label('door', WALL + 0.12, (D.y0 + D.y1) / 2, 'left', 'rgba(148,163,184,.5)');
  }

  function drawO2IBackdrop() {
    var O = M.O2I, FX = O.FX;
    // Street and sidewalk
    ctx.fillStyle = '#080d1b';
    ctx.fillRect(X(1.1), Y(0), S(1.3), S(H));
    ctx.fillStyle = '#111a2f';
    ctx.fillRect(X(2.4), Y(0), S(FX - 2.4), S(H));
    ctx.save();
    ctx.setLineDash([6 * dpr, 8 * dpr]);
    wallLine([[O.LANE_X, 0], [O.LANE_X, H]], 'rgba(251,191,36,.35)', 1.2);
    ctx.restore();
    label('street', 1.75, H - 0.3, 'center', 'rgba(148,163,184,.5)');
    label('sidewalk', 2.9, 0.3, 'center', 'rgba(148,163,184,.5)');
    // Inside
    grid(FX);
    desks(DESKS_O2I);
    var D = O.DOOR;
    wallLine([[FX, WALL], [W - WALL, WALL], [W - WALL, D.y0]], 'rgba(148,163,184,.4)', 2);
    wallLine([[W - WALL, D.y1], [W - WALL, H - WALL], [FX, H - WALL]], 'rgba(148,163,184,.4)', 2);
    label('door', W - WALL - 0.14, (D.y0 + D.y1) / 2, 'right', 'rgba(148,163,184,.5)');
    // Facade: concrete piers and glass windows
    var spans = [], yPrev = WALL;
    O.WINDOWS.forEach(function (w) { spans.push([yPrev, w[0], 'c']); spans.push([w[0], w[1], 'g']); yPrev = w[1]; });
    spans.push([yPrev, H - WALL, 'c']);
    spans.forEach(function (s) {
      if (s[2] === 'c') wallLine([[FX, s[0]], [FX, s[1]]], '#64748b', 6);
      else {
        wallLine([[FX - 0.05, s[0]], [FX - 0.05, s[1]]], 'rgba(125,211,252,.55)', 1.4);
        wallLine([[FX + 0.05, s[0]], [FX + 0.05, s[1]]], 'rgba(125,211,252,.55)', 1.4);
      }
    });
    label('window', FX - 0.12, (O.WINDOWS[0][0] + O.WINDOWS[0][1]) / 2 - 0.9, 'right', 'rgba(125,211,252,.6)');
    label('concrete', FX - 0.12, (O.WINDOWS[0][1] + O.WINDOWS[1][0]) / 2, 'right', 'rgba(148,163,184,.65)');
  }

  function drawOutdoorBackdrop() {
    var O = M.OUT;
    ctx.fillStyle = '#0d1426';
    ctx.fillRect(X(0), Y(0), S(W), S(O.topFacade));
    ctx.fillRect(X(0), Y(O.bottomFacade), S(W), S(H - O.bottomFacade));
    ctx.fillStyle = '#111a2f';
    ctx.fillRect(X(0), Y(O.topFacade), S(W), S(O.street[0] - O.topFacade));
    ctx.fillRect(X(0), Y(O.street[1]), S(W), S(O.bottomFacade - O.street[1]));
    ctx.fillStyle = '#080d1b';
    ctx.fillRect(X(0), Y(O.street[0]), S(W), S(O.street[1] - O.street[0]));
    ctx.save();
    ctx.setLineDash([8 * dpr, 10 * dpr]);
    var mid = (O.street[0] + O.street[1]) / 2;
    wallLine([[0, mid], [W, mid]], 'rgba(251,191,36,.35)', 1.2);
    ctx.restore();
    wallLine([[0, O.topFacade], [W, O.topFacade]], '#64748b', 3);
    wallLine([[0, O.bottomFacade], [W, O.bottomFacade]], '#64748b', 3);
    label('building', 0.25, O.topFacade / 2, 'left', 'rgba(148,163,184,.45)');
    label('building', 0.25, (O.bottomFacade + H) / 2 + 0.2, 'left', 'rgba(148,163,184,.45)');
    label('street', W - 0.25, O.street[0] + 0.3, 'right', 'rgba(148,163,184,.5)');
    O.trees.forEach(function (t) {
      ctx.beginPath(); ctx.arc(X(t.x), Y(t.y), S(t.r), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(34,197,94,.22)'; ctx.fill();
      ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = 'rgba(74,222,128,.55)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(X(t.x), Y(t.y), S(0.07), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(74,222,128,.7)'; ctx.fill();
    });
  }

  function drawScene() {
    var band = bands[sel.band];
    var e = world.evaluate(band, sel.ris, sel.mra);
    var A = world.ap, u = world.user;
    var o2i = world.scene === 'o2i', out = world.scene === 'out';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a1124';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (o2i) drawO2IBackdrop(); else if (out) drawOutdoorBackdrop(); else drawIndoorBackdrop();

    // Beam footprint: wide at sub-6, a pencil at mmWave
    var ang = Math.atan2(u.y - A.y, u.x - A.x), half = CONE[sel.band];
    var reach = S(Math.hypot(u.x - A.x, u.y - A.y) + 0.6);
    var g = ctx.createRadialGradient(X(A.x), Y(A.y), 0, X(A.x), Y(A.y), reach);
    g.addColorStop(0, 'rgba(251,191,36,.22)');
    g.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(X(A.x), Y(A.y));
    ctx.arc(X(A.x), Y(A.y), reach, ang - half, ang + half);
    ctx.closePath();
    ctx.fill();

    var total = db2lin(e.snrDb);
    var losShare = db2lin(e.losDb) / total;
    var risShare = e.risDb === null ? 0 : db2lin(e.risDb) / total;
    var mraShare = e.mraDb === null ? 0 : db2lin(e.mraDb) / total;

    // Direct path: full strength up to the first obstruction, then faded by the loss
    var dx = u.x - A.x, dy = u.y - A.y, len = Math.hypot(dx, dy);
    var obst = [];
    if (world.losAll && world.losAll.length) {
      var fb = 1;
      world.losAll.forEach(function (b) {
        var r = b.len ? b.wid / 2 : PERSON_R;
        fb = Math.min(fb, clamp((((b.x - A.x) * dx + (b.y - A.y) * dy) / len - r) / len, 0, 1));
      });
      obst.push({ f: fb, kind: 'block' });
    }
    if (o2i && world.cross) obst.push({ f: (world.cross.x - A.x) / dx, kind: world.cross.glass ? 'glass' : 'wall' });
    if (out && world.treeCount > 0) {
      var ft = 1;
      M.OUT.trees.forEach(function (t) {
        var proj = ((t.x - A.x) * dx + (t.y - A.y) * dy) / (len * len);
        var px = A.x + dx * proj, py = A.y + dy * proj;
        if (proj > 0 && proj < 1 && Math.hypot(px - t.x, py - t.y) < t.r) ft = Math.min(ft, proj);
      });
      obst.push({ f: ft, kind: 'tree' });
    }
    obst.sort(function (a, c) { return a.f - c.f; });
    var losAlpha = clamp((e.losDb + 5) / 30, 0, 1);
    if (obst.length) {
      var p0 = { x: A.x + dx * obst[0].f, y: A.y + dy * obst[0].f };
      line([A, p0], '#fbbf24', 1.6, 0.55);
      if (losAlpha > 0.04) line([p0, u], '#fbbf24', 1.6, 0.55 * losAlpha);
    } else {
      line([A, u], '#fbbf24', 1.6, 0.55);
    }
    var nx = -dy / len, ny = dx / len;
    if (ny > 0) { nx = -nx; ny = -ny; }
    var late = [];  // loss labels, drawn last so people and cars never cover them
    obst.forEach(function (ob) {
      var hp = { x: A.x + dx * ob.f, y: A.y + dy * ob.f };
      var txt, col;
      if (ob.kind === 'block') {
        var cnt = { person: 0, car: 0, bus: 0 };
        world.losAll.forEach(function (b) { cnt[b.len ? (b.bus ? 'bus' : 'car') : 'person']++; });
        var parts = [];
        if (cnt.person) parts.push(cnt.person > 1 ? cnt.person + ' people' : 'person');
        if (cnt.car) parts.push(cnt.car > 1 ? cnt.car + ' cars' : 'car');
        if (cnt.bus) parts.push(cnt.bus > 1 ? cnt.bus + ' buses' : 'bus');
        txt = parts.join(' + ') + ' −' + Math.round(e.blockDb) + ' dB';
        col = band.block >= 20 ? '#f87171' : band.block >= 10 ? '#fb923c' : '#fbbf24';
        ctx.save();
        ctx.strokeStyle = col; ctx.lineWidth = 2 * dpr;
        var cx = X(hp.x), cy = Y(hp.y), r = 4 * dpr;
        ctx.beginPath(); ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r); ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r); ctx.stroke();
        ctx.restore();
      } else if (ob.kind === 'tree') {
        txt = 'tree −' + Math.round(e.foliageDb) + ' dB';
        col = '#4ade80';
        ctx.beginPath(); ctx.arc(X(hp.x), Y(hp.y), 3.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
      } else {
        var loss = ob.kind === 'glass' ? band.glass : band.concrete;
        txt = (ob.kind === 'glass' ? 'glass −' : 'wall −') + Math.round(loss) + ' dB';
        col = ob.kind === 'glass' ? 'rgba(125,211,252,.9)' : (loss >= 40 ? '#f87171' : '#fb923c');
        ctx.beginPath(); ctx.arc(X(hp.x), Y(hp.y), 3.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.fill();
      }
      if (ob.kind === 'glass' || ob.kind === 'wall') {
        // Facade loss: just inside the building, next to where the path crosses
        late.push([txt, hp.x + 0.18, clamp(hp.y - 0.32, WALL + 0.8, H - WALL - 0.3), 'left', col]);
        return;
      }
      var lx = hp.x + nx * 0.4, ly = hp.y + ny * 0.4;
      var du = Math.hypot(lx - u.x, ly - u.y);
      if (du < 1.1) { var back = 1.1 - du + 0.25; lx -= dx / len * back; ly -= dy / len * back; }
      lx = clamp(lx, WALL + 0.4, W - WALL - 0.4);
      ly = clamp(ly, WALL + 0.7, H - WALL - 0.3);
      late.push([txt, lx, ly, nx >= 0 ? 'left' : 'right', col]);
    });

    var paths = [{ share: losShare, pts: [A, u], color: '#fde68a' }];
    if (sel.ris) {
      world.best.forEach(function (idx, rank) {
        var tl = world.tiles[idx];
        var pts = [A, { x: tl.ax, y: tl.ay }, u];
        line(pts, '#2dd4bf', rank === 0 ? 2.2 : 1.2, (rank === 0 ? 0.25 : 0.12) + (rank === 0 ? 0.65 : 0.25) * Math.sqrt(risShare));
        if (rank === 0) paths.push({ share: risShare, pts: pts, color: '#ccfbf1' });
      });
    }
    if (sel.mra && world.bestMra !== null) {
      var m = world.mra[world.bestMra];
      var mp = [A, { x: m.ax, y: m.ay }, u];
      line(mp, '#a78bfa', 1.6, 0.2 + 0.6 * Math.sqrt(mraShare));
      paths.push({ share: mraShare, pts: mp, color: '#ede9fe' });
    }
    paths.sort(function (a, c) { return c.share - a.share; });
    if (e.rate >= TARGET / 4 && paths[0].share > 0.05) {
      packets(paths[0].pts, paths[0].color);
      if (o2i) packets(paths[0].pts, '#fbbf24', true, 0.125);
    }

    // RIS tiles: along the top wall indoors, on the windows outdoors-to-indoor
    var vert = world.tileOrient === 'v';
    var tw = vert ? 0.14 : (out ? 6.4 / 13 : 7.5 / 17) * 0.78;
    var th = vert ? (M.O2I.WINDOWS[0][1] - M.O2I.WINDOWS[0][0]) / 6 * 0.78 : 0.2;
    world.tiles.forEach(function (tl, i) {
      var x = X(tl.x - tw / 2), y = Y(tl.y - th / 2), w = S(tw), h = S(th);
      if (!sel.ris) {
        ctx.strokeStyle = 'rgba(148,163,184,.35)'; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      } else if (tl.blocked) {
        ctx.fillStyle = '#1b2438';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(148,163,184,.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + w - 2, y + h - 2); ctx.stroke();
      } else {
        ctx.save();
        ctx.shadowColor = '#2dd4bf';
        ctx.shadowBlur = 14 * dpr * tileGlow[i];
        ctx.fillStyle = 'rgba(45,212,191,' + (0.25 + 0.75 * tileGlow[i]).toFixed(3) + ')';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
      }
    });
    var risName = o2i ? 'RIS window' : 'RIS tiles';
    var risCol = sel.ris ? 'rgba(94,234,212,.85)' : 'rgba(148,163,184,.7)';
    if (out) risName = 'RIS façade';
    if (o2i) label(sel.ris ? risName : risName + ' · off', M.O2I.FX + 0.22, WALL + 0.45, 'left', risCol);
    else if (out) label(sel.ris ? risName : risName + ' · off', 2.3, M.OUT.topFacade - 0.42, 'left', risCol);
    else label(sel.ris ? risName : risName + ' · off', 1.08, WALL + 0.52, 'left', risCol);

    // MRA slats
    world.mra.forEach(function (mm, i) {
      ctx.save();
      ctx.translate(X(mm.x), Y(mm.y));
      ctx.rotate(mm.ang);
      if (!sel.mra) ctx.fillStyle = 'rgba(148,163,184,.3)';
      else if (mm.blocked) ctx.fillStyle = '#2a2f45';
      else {
        ctx.shadowColor = '#a78bfa';
        ctx.shadowBlur = 12 * dpr * mraGlow[i];
        ctx.fillStyle = 'rgba(167,139,250,' + (0.3 + 0.7 * mraGlow[i]).toFixed(3) + ')';
      }
      ctx.fillRect(-S(0.05), -S(0.28), S(0.1), S(0.56));
      ctx.restore();
    });
    var mraCol = sel.mra ? 'rgba(196,181,253,.85)' : 'rgba(148,163,184,.7)';
    if (o2i) label(sel.mra ? 'MRA' : 'MRA · off', W - WALL - 0.3, WALL + 0.62, 'right', mraCol);
    else if (out) label(sel.mra ? 'MRA' : 'MRA · off', 3.0, M.OUT.bottomFacade + 0.72, 'center', mraCol);
    else label(sel.mra ? 'MRA' : 'MRA · off', W - WALL - 0.42, 1.45, 'right', mraCol);

    // Cars (outdoors)
    world.cars.forEach(function (c) {
      var cw = c.horiz ? c.len : c.wid, ch = c.horiz ? c.wid : c.len;
      ctx.fillStyle = c.bus ? '#3b4a63' : '#334155';
      roundRect(X(c.x - cw / 2), Y(c.y - ch / 2), S(cw), S(ch), S(0.14)); ctx.fill();
      ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = 'rgba(203,213,225,.4)'; ctx.stroke();
      ctx.fillStyle = 'rgba(148,163,184,.5)';
      var fwd = (c.horiz ? c.vx : c.vy) > 0 ? 1 : -1, ws = 0.22;
      if (c.horiz) ctx.fillRect(X(c.x + fwd * (c.len / 2 - 0.12) - (fwd > 0 ? ws : 0)), Y(c.y - c.wid * 0.32), S(ws), S(c.wid * 0.64));
      else ctx.fillRect(X(c.x - c.wid * 0.32), Y(c.y + fwd * (c.len / 2 - 0.12) - (fwd > 0 ? ws : 0)), S(c.wid * 0.64), S(ws));
    });

    // People indoors and on the sidewalk
    world.people.concat(world.walkers).forEach(function (p) {
      var hd = p.vx !== undefined || p.vy !== undefined ? Math.atan2(p.vy || 0, p.vx || 0) : Math.atan2(p.ty - p.y, p.tx - p.x);
      ctx.save();
      ctx.translate(X(p.x), Y(p.y));
      ctx.rotate(hd);
      ctx.beginPath();
      if (ctx.ellipse) ctx.ellipse(0, 0, S(0.15), S(0.3), 0, 0, Math.PI * 2); else ctx.arc(0, 0, S(0.24), 0, Math.PI * 2);
      ctx.fillStyle = '#475569'; ctx.fill();
      ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = 'rgba(203,213,225,.4)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(S(0.02), 0, S(0.125), 0, Math.PI * 2);
      ctx.fillStyle = '#a5b1c2'; ctx.fill();
      ctx.restore();
    });

    var met = e.rate >= TARGET;
    var pulse = (Math.sin(world.t * 3) + 1) / 2;
    ctx.beginPath(); ctx.arc(X(u.x), Y(u.y), S(0.2 + 0.12 * pulse), 0, Math.PI * 2);
    ctx.fillStyle = met ? 'rgba(45,212,191,' + (0.25 - 0.15 * pulse).toFixed(3) + ')' : 'rgba(248,113,113,' + (0.3 - 0.15 * pulse).toFixed(3) + ')';
    ctx.fill();
    ctx.beginPath(); ctx.arc(X(u.x), Y(u.y), S(0.14), 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    label('user', u.x, u.y + 0.46, 'center', '#e2e8f0');

    ctx.save();
    ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 12 * dpr;
    ctx.fillStyle = '#fbbf24';
    roundRect(X(A.x - 0.17), Y(A.y - 0.17), S(0.34), S(0.34), S(0.07));
    ctx.fill();
    ctx.restore();
    if (o2i || out) label(world.apLabel + ' · ' + band.carrier, A.x - 0.15, A.y + (out ? 0.55 : 0.45), 'left', '#fde68a');
    else label(world.apLabel + ' · ' + band.carrier, A.x + 0.32, A.y + 0.3, 'left', '#fde68a');

    label(world.status(), W - WALL - 0.2, H - WALL - 0.28, 'right', 'rgba(148,163,184,.75)');

    // Stack labels that would overlap (boxes in world units)
    ctx.font = '600 ' + Math.max(10, Math.round(S(0.22))) + 'px "JetBrains Mono", ui-monospace, monospace';
    var placed = [];
    late.forEach(function (l) {
      var w = ctx.measureText(l[0]).width / scale, hgt = 0.34;
      function box() {
        var x0 = l[3] === 'left' ? l[1] : l[3] === 'right' ? l[1] - w : l[1] - w / 2;
        return { x0: x0, x1: x0 + w, y0: l[2] - hgt / 2, y1: l[2] + hgt / 2 };
      }
      var b = box(), guard = 0;
      while (guard++ < 6 && placed.some(function (p) { return b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0; })) {
        l[2] -= hgt + 0.04; b = box();
      }
      placed.push(b);
    });
    late.forEach(function (l) {
      ctx.save();
      ctx.font = '600 ' + Math.max(10, Math.round(S(0.22))) + 'px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = l[3]; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4 * dpr; ctx.strokeStyle = 'rgba(10,17,36,.9)'; ctx.lineJoin = 'round';
      ctx.strokeText(l[0], X(l[1]), Y(l[2]));
      ctx.restore();
      label(l[0], l[1], l[2], l[3], l[4]);
    });
  }

  // ---------- Timeline strip ----------
  var hoverI = null;
  function stripGeom() {
    var w = strip.width, h = strip.height;
    var g = { padL: 4 * dpr, padR: 4 * dpr, evH: 12 * dpr, belowH: 7 * dpr, axisH: 15 * dpr };
    g.plotT = g.evH + 3 * dpr;
    g.plotB = h - g.axisH - g.belowH - 5 * dpr;
    g.belowY = g.plotB + 3 * dpr;
    g.w = w; g.h = h;
    g.x = function (i) { return g.padL + (i / (N - 1)) * (w - g.padL - g.padR); };
    g.y = function (v) { return g.plotT + (g.plotB - g.plotT) * (1 - Math.min(v, YMAX) / YMAX); };
    return g;
  }
  function drawStrip() {
    if (!tctx || !strip.width) return;
    var g = stripGeom(), series = cur().series[selKey()];
    tctx.clearRect(0, 0, g.w, g.h);

    var start = -1;
    for (var i = 0; i <= N; i++) {
      var below = i < N && series[i] < TARGET;
      if (below && start < 0) start = i;
      if (!below && start >= 0) {
        var x0 = g.x(start), x1 = Math.max(g.x(i - 1), x0 + 2 * dpr);
        tctx.fillStyle = 'rgba(208,59,59,.16)';
        tctx.fillRect(x0, g.plotT, x1 - x0, g.plotB - g.plotT);
        tctx.fillStyle = BELOW;
        tctx.fillRect(x0, g.belowY, x1 - x0, g.belowH);
        start = -1;
      }
    }
    tctx.fillStyle = 'rgba(255,255,255,.07)';
    tctx.fillRect(g.padL, g.belowY + g.belowH, g.w - g.padL - g.padR, 1);

    tctx.save();
    tctx.setLineDash([4 * dpr, 4 * dpr]);
    tctx.strokeStyle = 'rgba(203,213,225,.5)';
    tctx.lineWidth = 1;
    tctx.beginPath(); tctx.moveTo(g.padL, g.y(TARGET)); tctx.lineTo(g.w - g.padR, g.y(TARGET)); tctx.stroke();
    tctx.restore();

    function path(from, to, alpha) {
      if (to - from < 1) return;
      tctx.save();
      tctx.globalAlpha = alpha;
      tctx.strokeStyle = LINE;
      tctx.lineWidth = 2 * dpr;
      tctx.lineJoin = 'round';
      tctx.beginPath();
      for (var j = from; j <= to; j++) { if (j === from) tctx.moveTo(g.x(j), g.y(series[j])); else tctx.lineTo(g.x(j), g.y(series[j])); }
      tctx.stroke();
      tctx.restore();
    }
    path(0, k - 1, 1);
    path(k - 1, N - 1, 0.32);

    cur().events.forEach(function (ev) {
      var ex = g.x(ev.i), s = 4 * dpr, cy = g.evH / 2 + 1 * dpr;
      tctx.fillStyle = ev.i < k ? 'rgba(203,213,225,.9)' : 'rgba(203,213,225,.35)';
      tctx.beginPath();
      if (ev.kind === 'in') { tctx.moveTo(ex - s, cy + s); tctx.lineTo(ex + s, cy + s); tctx.lineTo(ex, cy - s); }
      else if (ev.kind === 'out') { tctx.moveTo(ex - s, cy - s); tctx.lineTo(ex + s, cy - s); tctx.lineTo(ex, cy + s); }
      else tctx.rect(ex - s * 0.8, cy - s * 0.8, s * 1.6, s * 1.6);
      tctx.closePath(); tctx.fill();
    });

    tctx.font = '500 ' + Math.round(10.5 * dpr) + 'px "JetBrains Mono", ui-monospace, monospace';
    tctx.fillStyle = 'rgba(148,163,184,.9)';
    tctx.textBaseline = 'bottom';
    var plotCss = (g.w - g.padL - g.padR) / dpr;
    var tick = plotCss >= 560 ? 15 : plotCss >= 280 ? 30 : 60;
    for (var s = 0; s <= DURATION; s += tick) {
      var ii = Math.min(N - 1, Math.round(s / DT));
      tctx.textAlign = s === 0 ? 'left' : s === DURATION ? 'right' : 'center';
      tctx.fillText(fmtTime(s), g.x(ii), g.h);
    }
    tctx.textAlign = 'right';
    tctx.textBaseline = 'top';
    tctx.fillText(TARGET + ' Gbps target', g.w - g.padR, g.y(TARGET) + 2 * dpr);
    tctx.fillText(YMAX + ' Gbps', g.w - g.padR, g.plotT);

    var px = g.x(k - 1);
    tctx.fillStyle = '#f8fafc';
    tctx.fillRect(px - 0.75 * dpr, g.plotT - 3 * dpr, 1.5 * dpr, g.belowY + g.belowH - g.plotT + 3 * dpr);
    tctx.beginPath(); tctx.arc(px, g.y(series[k - 1]), 4.5 * dpr, 0, Math.PI * 2);
    tctx.fillStyle = series[k - 1] >= TARGET ? LINE : BELOW; tctx.fill();
    tctx.lineWidth = 2 * dpr; tctx.strokeStyle = '#0d1426'; tctx.stroke();

    if (hoverI !== null) {
      var hi = clamp(hoverI, 0, N - 1), hx = g.x(hi);
      tctx.strokeStyle = 'rgba(226,232,240,.55)'; tctx.lineWidth = 1;
      tctx.beginPath(); tctx.moveTo(hx, g.plotT); tctx.lineTo(hx, g.belowY + g.belowH); tctx.stroke();
      var v = series[hi];
      var txt = fmtTime((hi + 1) * DT) + ' · ' + v.toFixed(1) + ' Gbps · ' + (v >= TARGET ? 'meets' : 'below') + ' target · click to jump';
      tctx.font = '600 ' + Math.round(11 * dpr) + 'px Inter, system-ui, sans-serif';
      var tw = tctx.measureText(txt).width + 14 * dpr;
      var tx = clamp(hx - tw / 2, 0, g.w - tw);
      tctx.fillStyle = 'rgba(15,23,42,.95)';
      tctx.fillRect(tx, g.plotT, tw, 18 * dpr);
      tctx.fillStyle = '#f1f5f9';
      tctx.textAlign = 'left'; tctx.textBaseline = 'middle';
      tctx.fillText(txt, tx + 7 * dpr, g.plotT + 9 * dpr);
    }
  }
  function stripIndex(ev) {
    var rect = strip.getBoundingClientRect();
    var g = stripGeom();
    var xpx = (ev.clientX - rect.left) * (strip.width / rect.width);
    return Math.round(clamp((xpx - g.padL) / (g.w - g.padL - g.padR), 0, 1) * (N - 1));
  }

  // ---------- Text readouts ----------
  function q(s) { return document.querySelector(s); }
  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  var el = {
    time: q('[data-sim="time"]'), rate: q('[data-sim="rate"]'), status: q('[data-sim="status"]'),
    takeaway: q('[data-sim="takeaway"]'), play: q('[data-sim="play"]'), restart: q('[data-sim="restart"]')
  };
  var lastUi = -1;
  function updateUi(force) {
    if (!force && Math.abs(k - lastUi) < 5) return;
    lastUi = k;
    var r = rateNow();
    if (el.time) el.time.textContent = fmtTime(k * DT) + ' / ' + fmtTime(DURATION);
    if (el.rate) el.rate.textContent = r >= 1 ? r.toFixed(1) : r.toFixed(2);
    if (el.status) {
      var ok = r >= TARGET;
      el.status.className = 'sim-status ' + (ok ? 'is-ok' : 'is-below');
      el.status.textContent = ok ? '✓ Meets ' + TARGET + ' Gbps target' : '✕ Below ' + TARGET + ' Gbps target';
    }
    if (strip) {
      strip.setAttribute('aria-valuenow', String(Math.round(k * DT)));
      strip.setAttribute('aria-valuetext', fmtTime(k * DT) + ' of ' + fmtTime(DURATION));
    }
  }
  function updateTakeaway() {
    if (!el.takeaway) return;
    var st = cur().stats;
    var b = bands[sel.band], cid = comboId(sel.ris, sel.mra);
    var none = st[sel.band + '-none'].belowS, both = st[sel.band + '-both'].belowS, now = st[selKey()].belowS;
    var t;
    if (none >= DURATION - 0.01 && now >= DURATION - 0.01) {
      t = b.label + ' never reaches ' + TARGET + ' Gbps: ' + Math.round(b.bw * 1000) + ' MHz of spectrum caps it near ' + (b.bw * 7.5).toFixed(2) + ' Gbps, with or without surfaces.';
    } else if (cid === 'none') {
      t = (sel.scene === 'o2i' ? 'Between the street and indoors, the façade decides. Without surfaces, ' :
           sel.scene === 'out' ? 'On the street, traffic and trees get in the way. Without surfaces, ' : 'Without surfaces, ') +
        b.label + ' is below ' + TARGET + ' Gbps for ' + fmtS(none) + ' of these 2 minutes. With RIS + MRA: ' + fmtS(both) + '.';
    } else {
      var ratio = now > 0 ? none / now : Infinity;
      t = b.label + ' with ' + comboOf(cid).label + ': below ' + TARGET + ' Gbps for ' + fmtS(now) + ' of 2 minutes, versus ' + fmtS(none) + ' without surfaces' +
        (isFinite(ratio) ? ' (' + (ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)) + '× less).' : '.');
    }
    el.takeaway.textContent = t;
  }
  function fillTable() {
    var st = cur().stats;
    qa('[data-sim-cell]').forEach(function (cell) {
      var s = st[cell.getAttribute('data-sim-cell')];
      if (!s) return;
      cell.querySelector('.pct').textContent = fmtS(s.belowS);
      cell.querySelector('.avg').textContent = s.avg.toFixed(1) + ' Gbps';
      var frac = s.belowS / DURATION, ok = cell.querySelector('.cbar .ok'), bl = cell.querySelector('.cbar .below');
      if (ok && bl) {
        ok.style.flex = (1 - frac) + ' 1 0'; bl.style.flex = frac + ' 1 0';
        ok.style.display = frac >= 1 ? 'none' : '';
        bl.style.display = frac <= 0 ? 'none' : '';
        bl.style.minWidth = frac > 0 ? '3px' : '0';
      }
      cell.title = cell.querySelector('.sr-only').textContent.replace(/: $/, '') + ': below ' + TARGET + ' Gbps for ' + fmtS(s.belowS) + ' of 2 minutes, ' + s.avg.toFixed(1) + ' Gbps on average';
    });
  }

  // ---------- Results section (both scenarios) ----------
  function dumbbell(sceneKey, title) {
    var st = data[sceneKey].stats, max = 0;
    ['fr3', 'mmw'].forEach(function (bk) { max = Math.max(max, st[bk + '-none'].belowS); });
    max = Math.max(5, Math.ceil(max / 5) * 5);
    var step = max <= 25 ? 5 : max <= 60 ? 15 : 30;
    max = Math.ceil(max / step) * step;
    var html = '<div class="db-group"><p class="db-group-title">' + title + '</p>';
    M.BANDS.filter(function (b) { return b.key !== 'sub6'; }).forEach(function (b) {
      var a = st[b.key + '-none'].belowS, z = st[b.key + '-both'].belowS;
      html += '<div class="db-row"><div class="db-label">' + b.label + '<small>' + b.carrier + '</small></div><div class="db-track">';
      if (a > max) {
        html += '<span class="db-off">Below ' + TARGET + ' Gbps for all ' + fmtS(a) + ', with or without surfaces: bandwidth is the limit</span>';
      } else {
        var pa = a / max * 100, pz = z / max * 100;
        html += '<span class="db-line" style="left:' + pz.toFixed(2) + '%;width:' + (pa - pz).toFixed(2) + '%"></span>' +
          '<span class="db-dot before" style="left:' + pa.toFixed(2) + '%" title="' + b.label + ', no surfaces: ' + fmtS(a) + ' below ' + TARGET + ' Gbps"></span>' +
          '<span class="db-dot after" style="left:' + pz.toFixed(2) + '%" title="' + b.label + ', RIS + MRA: ' + fmtS(z) + ' below ' + TARGET + ' Gbps"></span>' +
          '<span class="db-val before" style="left:' + pa.toFixed(2) + '%">' + fmtS(a) + '</span>' +
          '<span class="db-val after" style="left:' + pz.toFixed(2) + '%">' + fmtS(z) + '</span>';
      }
      html += '</div></div>';
    });
    html += '<div class="db-row db-axis" aria-hidden="true"><div class="db-label"></div><div class="db-track">';
    for (var s = 0; s <= max; s += step) html += '<span style="left:' + (s / max * 100).toFixed(2) + '%">' + s + ' s</span>';
    html += '</div></div></div>';
    return html;
  }
  function fillResults() {
    var head = q('[data-impact="headline"]'), sub = q('[data-impact="sub"]'), db = q('[data-impact="dumbbell"]');
    var I = data.indoor.stats, O = data.o2i.stats, U = data.out.stats;
    function ratio(st) { return st['fr3-both'].belowS > 0 ? st['fr3-none'].belowS / st['fr3-both'].belowS : Infinity; }
    var rs = [ratio(I), ratio(O), ratio(U)].filter(isFinite);
    var lo = Math.round(Math.min.apply(null, rs)), hi = Math.round(Math.max.apply(null, rs));
    if (head) head.textContent = 'RIS + MRA cut FR3’s time below ' + TARGET + ' Gbps ' + lo + '–' + hi + '× across all three scenarios';
    if (sub) sub.textContent = 'Without surfaces → with RIS + MRA, FR3 is below ' + TARGET + ' Gbps for ' +
      fmtS(I['fr3-none'].belowS) + ' → ' + fmtS(I['fr3-both'].belowS) + ' indoors, ' +
      fmtS(O['fr3-none'].belowS) + ' → ' + fmtS(O['fr3-both'].belowS) + ' between the street and indoors (the façade decides), and ' +
      fmtS(U['fr3-none'].belowS) + ' → ' + fmtS(U['fr3-both'].belowS) + ' on the street, out of 2 minutes. Sub-6 never reaches ' + TARGET + ' Gbps.';
    if (db) db.innerHTML = dumbbell('indoor', 'Indoor') + dumbbell('o2i', 'Outdoor ↔ indoor') + dumbbell('out', 'Outdoor street') +
      '<p class="db-note">Sub-6 is below ' + TARGET + ' Gbps for the full 2 minutes in every scenario, with or without surfaces: its 100 MHz of spectrum is the limit.</p>';
  }

  // ---------- Controls ----------
  function check(name, value) {
    var r = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (r) r.checked = true;
  }
  function applySceneText() {
    qa('[data-scene-show]').forEach(function (n) { n.hidden = n.getAttribute('data-scene-show').split(' ').indexOf(sel.scene) < 0; });
  }
  function select(band, ris, mra) {
    sel.band = band; sel.ris = ris; sel.mra = mra;
    check('sim-band', band);
    check('sim-ris', ris ? 'on' : 'off');
    check('sim-mra', mra ? 'on' : 'off');
    qa('[data-sim-cell]').forEach(function (cell) {
      cell.setAttribute('aria-pressed', String(cell.getAttribute('data-sim-cell') === selKey()));
    });
    glow(1);
    updateTakeaway();
    updateUi(true);
    render();
  }
  function selectScene(scene) {
    if (!SCENES[scene]) return;
    sel.scene = scene;
    check('sim-scene', scene);
    world = null; hoverI = null;
    seek(1);
    applySceneText();
    fillTable();
    select(sel.band, sel.ris, sel.mra);
    kick();
  }
  qa('input[name="sim-scene"]').forEach(function (inp) {
    inp.addEventListener('change', function () { if (inp.checked) selectScene(inp.value); });
  });
  qa('input[name="sim-band"]').forEach(function (inp) {
    inp.addEventListener('change', function () { if (inp.checked) select(inp.value, sel.ris, sel.mra); });
  });
  qa('input[name="sim-ris"]').forEach(function (inp) {
    inp.addEventListener('change', function () { if (inp.checked) select(sel.band, inp.value === 'on', sel.mra); });
  });
  qa('input[name="sim-mra"]').forEach(function (inp) {
    inp.addEventListener('change', function () { if (inp.checked) select(sel.band, sel.ris, inp.value === 'on'); });
  });
  qa('[data-sim-cell]').forEach(function (cell) {
    cell.addEventListener('click', function () {
      var p = cell.getAttribute('data-sim-cell').split('-'), c = comboOf(p[1]);
      select(p[0], c.ris, c.mra);
    });
  });

  var playing = !reduceMotion;
  function setPlayUi() {
    if (!el.play) return;
    el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    el.play.className = 'sim-btn sim-play ' + (playing ? 'is-playing' : 'is-paused');
  }
  if (el.play) el.play.addEventListener('click', function () { playing = !playing; setPlayUi(); kick(); });
  if (el.restart) el.restart.addEventListener('click', function () { world = null; seek(1); updateUi(true); render(); kick(); });

  if (strip) {
    var dragging = false;
    strip.addEventListener('pointerdown', function (ev) {
      dragging = true;
      if (strip.setPointerCapture) strip.setPointerCapture(ev.pointerId);
      seek(stripIndex(ev) + 1); updateUi(true); render();
    });
    strip.addEventListener('pointermove', function (ev) {
      hoverI = stripIndex(ev);
      if (dragging) { seek(hoverI + 1); updateUi(true); }
      render();
    });
    strip.addEventListener('pointerup', function () { dragging = false; });
    strip.addEventListener('pointercancel', function () { dragging = false; });
    strip.addEventListener('pointerleave', function () { if (!dragging) { hoverI = null; render(); } });
    strip.addEventListener('keydown', function (ev) {
      var step = ev.shiftKey ? 200 : 20;
      if (ev.key === 'ArrowRight') seek(k + step);
      else if (ev.key === 'ArrowLeft') seek(k - step);
      else if (ev.key === 'Home') seek(1);
      else if (ev.key === 'End') seek(N);
      else if (ev.key === ' ' || ev.key === 'Enter') { playing = !playing; setPlayUi(); kick(); }
      else return;
      ev.preventDefault(); updateUi(true); render();
    });
  }

  // ---------- Loop ----------
  var rafId = null, last = null, acc = 0, onScreen = true;
  function render() { drawScene(); drawStrip(); }
  function frame(now) {
    rafId = null;
    var real = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      acc += real;
      while (acc >= DT) { acc -= DT; advance(); }
      glow(Math.min(1, real * 6));
      phase = (phase + real * (0.12 + rateNow() / 6)) % 1;
      updateUi(false);
    }
    render();
    if (playing && onScreen && !document.hidden) rafId = requestAnimationFrame(frame);
    else last = null;
  }
  function kick() { if (rafId === null) rafId = requestAnimationFrame(frame); }

  seek(1);
  fillResults();
  fillTable();
  applySceneText();
  resize();
  select(sel.band, sel.ris, sel.mra);
  setPlayUi();
  if (window.ResizeObserver) new ResizeObserver(function () { resize(); render(); }).observe(wrap);
  else window.addEventListener('resize', function () { resize(); render(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { onScreen = entries[0].isIntersecting; if (onScreen) kick(); }).observe(canvas);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
  kick();
})();
