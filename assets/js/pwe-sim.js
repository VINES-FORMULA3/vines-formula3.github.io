// Home page: an interactive, illustrative view of a dynamic programmable wireless
// environment. A fixed two-minute scenario (same people, same moves for everyone)
// plays in the hero; visitors pick a band and switch the RIS and the MRA on or off.
// The timeline strip shows the whole scenario with the time below the target
// marked, and the results section compares the options. The link model lives in
// pwe-model.js.
(function () {
  var M = window.PWEModel;
  var canvas = document.getElementById('pwe-sim');
  if (!M || !canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var wrap = canvas.parentNode;
  var strip = document.getElementById('pwe-strip');
  var tctx = strip && strip.getContext ? strip.getContext('2d') : null;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var W = M.W, H = M.H, WALL = M.WALL, DOOR = M.DOOR, AP = M.AP, PERSON_R = M.PERSON_R;
  var SEED = 210;            // a representative scenario (see README)
  var DURATION = 120;        // seconds
  var DT = 0.05;             // fixed simulation step
  var N = Math.round(DURATION / DT);
  var TARGET = 2;            // Gbps: a multi-Gbps demo threshold
  var YMAX = 8;              // Gbps: strip scale
  var LINE = '#199e70', BELOW = '#d03b3b';
  var CONE = { sub6: 0.55, fr3: 0.24, mmw: 0.1 }; // AP beam half-width (rad), picture only

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

  // ---------- Precompute the whole scenario for every option ----------
  var series = {}, stats = {}, events = [];
  (function () {
    var w = M.createWorld(SEED), last = w.occupancy();
    configs.forEach(function (c) { series[c.key] = new Float32Array(N); });
    for (var i = 0; i < N; i++) {
      w.step(DT);
      configs.forEach(function (c) { series[c.key][i] = w.evaluate(c.band, c.ris, c.mra).rate; });
      var o = w.occupancy();
      if (o !== last) { events.push({ i: i, dir: o > last ? 1 : -1 }); last = o; }
    }
    configs.forEach(function (c) {
      var s = series[c.key], below = 0, sum = 0;
      for (var j = 0; j < N; j++) { if (s[j] < TARGET) below++; sum += s[j]; }
      stats[c.key] = { belowS: below * DT, avg: sum / N };
    });
  })();

  var sel = { band: 'fr3', ris: true, mra: true };
  function selKey() { return sel.band + '-' + comboId(sel.ris, sel.mra); }

  // ---------- Playback (fixed step, so it matches the precomputed run) ----------
  var world = null, k = 0;
  var tileGlow = [], mraGlow = [];
  function seek(toK) {
    toK = Math.max(1, Math.min(N, toK));
    if (!world || toK < k) { world = M.createWorld(SEED); k = 0; }
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
  function rateNow() { return series[selKey()][k - 1]; }

  function db2lin(db) { return Math.pow(10, db / 10); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function fmtTime(sec) { sec = Math.round(sec); return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2); }
  function fmtS(s) { return (s >= 10 ? s.toFixed(0) : s.toFixed(1)) + ' s'; }

  // ---------- Room ----------
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
  function packets(points, color) {
    var lens = [], total = 0;
    for (var i = 1; i < points.length; i++) {
      var l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      lens.push(l); total += l;
    }
    ctx.fillStyle = color;
    for (var n = 0; n < 4; n++) {
      var s = ((phase + n / 4) % 1) * total;
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
  var desks = [
    { x: 2.1, y: 3.4, w: 1.5, h: 0.75 }, { x: 4.6, y: 3.4, w: 1.5, h: 0.75 },
    { x: 7.1, y: 3.4, w: 1.5, h: 0.75 }, { x: 4.6, y: 5.5, w: 1.5, h: 0.75 }
  ];

  function drawRoom() {
    var band = bands[sel.band];
    var e = world.evaluate(band, sel.ris, sel.mra);
    var u = world.user, q = world.pred;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a1124';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    ctx.lineWidth = 1;
    for (var gx = 1; gx < W; gx++) { ctx.beginPath(); ctx.moveTo(X(gx), Y(WALL)); ctx.lineTo(X(gx), Y(H - WALL)); ctx.stroke(); }
    for (var gy = 1; gy < H; gy++) { ctx.beginPath(); ctx.moveTo(X(WALL), Y(gy)); ctx.lineTo(X(W - WALL), Y(gy)); ctx.stroke(); }
    ctx.fillStyle = 'rgba(148,163,184,.07)';
    ctx.strokeStyle = 'rgba(148,163,184,.14)';
    desks.forEach(function (d) { roundRect(X(d.x), Y(d.y), S(d.w), S(d.h), S(0.08)); ctx.fill(); ctx.stroke(); });
    ctx.strokeStyle = 'rgba(148,163,184,.4)';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(X(WALL), Y(DOOR.y0));
    ctx.lineTo(X(WALL), Y(WALL)); ctx.lineTo(X(W - WALL), Y(WALL));
    ctx.lineTo(X(W - WALL), Y(H - WALL)); ctx.lineTo(X(WALL), Y(H - WALL));
    ctx.lineTo(X(WALL), Y(DOOR.y1));
    ctx.stroke();
    label('door', WALL + 0.12, (DOOR.y0 + DOOR.y1) / 2, 'left', 'rgba(148,163,184,.5)');

    var ang = Math.atan2(u.y - AP.y, u.x - AP.x), half = CONE[sel.band];
    var reach = S(Math.hypot(u.x - AP.x, u.y - AP.y) + 0.6);
    var g = ctx.createRadialGradient(X(AP.x), Y(AP.y), 0, X(AP.x), Y(AP.y), reach);
    g.addColorStop(0, 'rgba(251,191,36,.22)');
    g.addColorStop(1, 'rgba(251,191,36,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(X(AP.x), Y(AP.y));
    ctx.arc(X(AP.x), Y(AP.y), reach, ang - half, ang + half);
    ctx.closePath();
    ctx.fill();

    var total = db2lin(e.snrDb);
    var losShare = db2lin(e.losDb) / total;
    var risShare = e.risDb === null ? 0 : db2lin(e.risDb) / total;
    var mraShare = e.mraDb === null ? 0 : db2lin(e.mraDb) / total;

    var losAlpha = clamp((e.losDb + 5) / 30, 0, 1);
    if (world.losBlocker) {
      var b = world.losBlocker;
      var dx = u.x - AP.x, dy = u.y - AP.y, len = Math.hypot(dx, dy);
      var f = clamp((((b.x - AP.x) * dx + (b.y - AP.y) * dy) / len - PERSON_R) / len, 0, 1);
      var hit = { x: AP.x + dx * f, y: AP.y + dy * f };
      line([AP, hit], '#fbbf24', 1.6, 0.55);
      if (losAlpha > 0.04) line([hit, u], '#fbbf24', 1.6, 0.55 * losAlpha);
      var sev = band.block >= 20 ? '#f87171' : band.block >= 10 ? '#fb923c' : '#fbbf24';
      ctx.save();
      ctx.strokeStyle = sev; ctx.lineWidth = 2 * dpr;
      var cx = X(hit.x), cy = Y(hit.y), r = 4 * dpr;
      ctx.beginPath(); ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r); ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r); ctx.stroke();
      ctx.restore();
      var nx = -dy / len, ny = dx / len;
      if (ny > 0) { nx = -nx; ny = -ny; }
      var lx = hit.x + nx * 0.4, ly = hit.y + ny * 0.4;
      var du = Math.hypot(lx - u.x, ly - u.y);
      if (du < 1.1) { var back = 1.1 - du + 0.25; lx -= dx / len * back; ly -= dy / len * back; }
      lx = clamp(lx, WALL + 0.4, W - WALL - 0.4);
      ly = clamp(ly, WALL + 0.7, H - WALL - 0.3);
      label('−' + band.block * world.losCount + ' dB', lx, ly, nx >= 0 ? 'left' : 'right', sev);
    } else {
      line([AP, u], '#fbbf24', 1.6, 0.55);
    }

    var paths = [{ share: losShare, pts: [AP, u], color: '#fde68a' }];
    if (sel.ris) {
      world.best.forEach(function (idx, rank) {
        var tl = world.tiles[idx];
        var pts = [AP, { x: tl.x, y: tl.y + 0.12 }, u];
        line(pts, '#2dd4bf', rank === 0 ? 2.2 : 1.2, (rank === 0 ? 0.25 : 0.12) + (rank === 0 ? 0.65 : 0.25) * Math.sqrt(risShare));
        if (rank === 0) paths.push({ share: risShare, pts: pts, color: '#ccfbf1' });
      });
      if (world.best.length) {
        var top = world.tiles[world.best[0]];
        line([{ x: top.x, y: top.y + 0.12 }, q], 'rgba(45,212,191,.45)', 1.2, 1, [3, 5]);
      }
    }
    if (sel.mra && world.bestMra !== null) {
      var m = world.mra[world.bestMra];
      var mp = [AP, { x: m.x - 0.1, y: m.y }, u];
      line(mp, '#a78bfa', 1.6, 0.2 + 0.6 * Math.sqrt(mraShare));
      paths.push({ share: mraShare, pts: mp, color: '#ede9fe' });
    }
    paths.sort(function (a, c) { return c.share - a.share; });
    if (e.rate >= TARGET / 4 && paths[0].share > 0.05) packets(paths[0].pts, paths[0].color);

    var tw = 7.5 / (world.NT - 1) * 0.78;
    world.tiles.forEach(function (tl, i) {
      var x = X(tl.x - tw / 2), y = Y(tl.y - 0.07), w = S(tw), h = S(0.2);
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
    label(sel.ris ? 'RIS tiles' : 'RIS tiles · off', 1.08, WALL + 0.52, 'left', sel.ris ? 'rgba(94,234,212,.85)' : 'rgba(148,163,184,.7)');

    world.mra.forEach(function (mm, i) {
      ctx.save();
      ctx.translate(X(mm.x), Y(mm.y));
      ctx.rotate(-0.5);
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
    label(sel.mra ? 'MRA' : 'MRA · off', W - WALL - 0.42, 1.45, 'right', sel.mra ? 'rgba(196,181,253,.85)' : 'rgba(148,163,184,.7)');

    world.people.forEach(function (p) {
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), S(PERSON_R * 0.72), 0, Math.PI * 2);
      ctx.fillStyle = '#475569'; ctx.fill();
      ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = 'rgba(203,213,225,.35)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), S(0.12), 0, Math.PI * 2);
      ctx.fillStyle = '#94a3b8'; ctx.fill();
    });

    if (sel.ris) {
      ctx.save();
      ctx.setLineDash([3 * dpr, 4 * dpr]);
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), S(0.2), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      label('t+Δ', q.x, q.y - 0.4, 'center', 'rgba(255,255,255,.55)');
    }

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
    roundRect(X(AP.x - 0.17), Y(AP.y - 0.17), S(0.34), S(0.34), S(0.07));
    ctx.fill();
    ctx.restore();
    label('AP · ' + band.carrier, AP.x + 0.32, AP.y + 0.3, 'left', '#fde68a');

    var occ = world.occupancy();
    label('occupancy ' + occ + ' · ' + (occ <= 2 ? 'low' : occ <= 4 ? 'medium' : 'high'), W - WALL - 0.2, H - WALL - 0.28, 'right', 'rgba(148,163,184,.75)');
  }

  // ---------- Timeline strip: the whole scenario, playhead, time below target ----------
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
    var g = stripGeom(), data = series[selKey()];
    tctx.clearRect(0, 0, g.w, g.h);

    // Time below target: a tint behind the plot and a solid band underneath
    var start = -1;
    for (var i = 0; i <= N; i++) {
      var below = i < N && data[i] < TARGET;
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
      for (var j = from; j <= to; j++) { if (j === from) tctx.moveTo(g.x(j), g.y(data[j])); else tctx.lineTo(g.x(j), g.y(data[j])); }
      tctx.stroke();
      tctx.restore();
    }
    path(0, k - 1, 1);
    path(k - 1, N - 1, 0.32);

    events.forEach(function (ev) {
      var ex = g.x(ev.i), s = 4 * dpr, cy = g.evH / 2 + 1 * dpr;
      tctx.fillStyle = ev.i < k ? 'rgba(203,213,225,.9)' : 'rgba(203,213,225,.35)';
      tctx.beginPath();
      if (ev.dir > 0) { tctx.moveTo(ex - s, cy + s); tctx.lineTo(ex + s, cy + s); tctx.lineTo(ex, cy - s); }
      else { tctx.moveTo(ex - s, cy - s); tctx.lineTo(ex + s, cy - s); tctx.lineTo(ex, cy + s); }
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
    tctx.textBaseline = 'top';
    tctx.fillText(YMAX + ' Gbps', g.w - g.padR, g.plotT);

    var px = g.x(k - 1);
    tctx.fillStyle = '#f8fafc';
    tctx.fillRect(px - 0.75 * dpr, g.plotT - 3 * dpr, 1.5 * dpr, g.belowY + g.belowH - g.plotT + 3 * dpr);
    tctx.beginPath(); tctx.arc(px, g.y(data[k - 1]), 4.5 * dpr, 0, Math.PI * 2);
    tctx.fillStyle = data[k - 1] >= TARGET ? LINE : BELOW; tctx.fill();
    tctx.lineWidth = 2 * dpr; tctx.strokeStyle = '#0d1426'; tctx.stroke();

    if (hoverI !== null) {
      var hi = clamp(hoverI, 0, N - 1), hx = g.x(hi);
      tctx.strokeStyle = 'rgba(226,232,240,.55)'; tctx.lineWidth = 1;
      tctx.beginPath(); tctx.moveTo(hx, g.plotT); tctx.lineTo(hx, g.belowY + g.belowH); tctx.stroke();
      var v = data[hi];
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
    if (strip) strip.setAttribute('aria-valuenow', String(Math.round(k * DT)));
    if (strip) strip.setAttribute('aria-valuetext', fmtTime(k * DT) + ' of ' + fmtTime(DURATION));
  }
  function updateTakeaway() {
    if (!el.takeaway) return;
    var b = bands[sel.band], cid = comboId(sel.ris, sel.mra);
    var none = stats[sel.band + '-none'].belowS, both = stats[sel.band + '-both'].belowS, cur = stats[selKey()].belowS;
    var t;
    if (none >= DURATION - 0.01) {
      t = b.label + ' never reaches ' + TARGET + ' Gbps: ' + Math.round(b.bw * 1000) + ' MHz of spectrum caps it near ' + (b.bw * 7.5).toFixed(2) + ' Gbps, with or without surfaces.';
    } else if (cid === 'none') {
      t = 'Without surfaces, ' + b.label + ' is below ' + TARGET + ' Gbps for ' + fmtS(none) + ' of these 2 minutes. With RIS + MRA: ' + fmtS(both) + '.';
    } else {
      var ratio = cur > 0 ? none / cur : Infinity;
      t = b.label + ' with ' + comboOf(cid).label + ': below ' + TARGET + ' Gbps for ' + fmtS(cur) + ' of 2 minutes, versus ' + fmtS(none) + ' without surfaces' +
        (isFinite(ratio) ? ' (' + (ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)) + '× less).' : '.');
    }
    el.takeaway.textContent = t;
  }

  // ---------- Results section ----------
  function fillResults() {
    var head = q('[data-impact="headline"]'), sub = q('[data-impact="sub"]'), db = q('[data-impact="dumbbell"]');
    var f0 = stats['fr3-none'].belowS, f1 = stats['fr3-both'].belowS;
    var m0 = stats['mmw-none'].belowS, m1 = stats['mmw-both'].belowS;
    var ratio = f1 > 0 ? Math.round(f0 / f1) : null;
    if (head) head.textContent = ratio ? 'RIS + MRA cut FR3’s time below ' + TARGET + ' Gbps about ' + ratio + '×' : 'RIS + MRA keep FR3 above ' + TARGET + ' Gbps throughout';
    if (sub) sub.textContent = 'In the same 2-minute scenario, FR3 falls below ' + TARGET + ' Gbps for ' + fmtS(f0) + ' without surfaces and ' + fmtS(f1) +
      ' with RIS + MRA. mmWave improves from ' + fmtS(m0) + ' to ' + fmtS(m1) + ', while sub-6 never reaches ' + TARGET + ' Gbps.';

    if (db) {
      var max = 0;
      ['fr3', 'mmw'].forEach(function (bk) { max = Math.max(max, stats[bk + '-none'].belowS); });
      max = Math.ceil(max / 5) * 5;
      var html = '';
      M.BANDS.forEach(function (b) {
        var a = stats[b.key + '-none'].belowS, z = stats[b.key + '-both'].belowS;
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
      for (var s = 0; s <= max; s += 5) html += '<span style="left:' + (s / max * 100).toFixed(2) + '%">' + s + ' s</span>';
      html += '</div></div>';
      db.innerHTML = html;
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-sim-cell]'), function (cell) {
      var st = stats[cell.getAttribute('data-sim-cell')];
      if (!st) return;
      cell.querySelector('.pct').textContent = fmtS(st.belowS);
      cell.querySelector('.avg').textContent = st.avg.toFixed(1) + ' Gbps';
      var frac = st.belowS / DURATION, ok = cell.querySelector('.cbar .ok'), bl = cell.querySelector('.cbar .below');
      if (ok && bl) {
        ok.style.flex = (1 - frac) + ' 1 0'; bl.style.flex = frac + ' 1 0';
        ok.style.display = frac >= 1 ? 'none' : '';
        bl.style.display = frac <= 0 ? 'none' : '';
        bl.style.minWidth = frac > 0 ? '3px' : '0';
      }
      cell.title = cell.querySelector('.sr-only').textContent.replace(/: $/, '') + ': below ' + TARGET + ' Gbps for ' + fmtS(st.belowS) + ' of 2 minutes, ' + st.avg.toFixed(1) + ' Gbps on average';
    });
  }

  // ---------- Controls ----------
  function check(name, value) {
    var r = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (r) r.checked = true;
  }
  function select(band, ris, mra) {
    sel.band = band; sel.ris = ris; sel.mra = mra;
    check('sim-band', band);
    check('sim-ris', ris ? 'on' : 'off');
    check('sim-mra', mra ? 'on' : 'off');
    Array.prototype.forEach.call(document.querySelectorAll('[data-sim-cell]'), function (cell) {
      cell.setAttribute('aria-pressed', String(cell.getAttribute('data-sim-cell') === selKey()));
    });
    glow(1);
    updateTakeaway();
    updateUi(true);
    render();
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name="sim-band"]'), function (inp) {
    inp.addEventListener('change', function () { if (inp.checked) select(inp.value, sel.ris, sel.mra); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="sim-ris"]'), function (inp) {
    inp.addEventListener('change', function () { if (inp.checked) select(sel.band, inp.value === 'on', sel.mra); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="sim-mra"]'), function (inp) {
    inp.addEventListener('change', function () { if (inp.checked) select(sel.band, sel.ris, inp.value === 'on'); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-sim-cell]'), function (cell) {
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
  function render() { drawRoom(); drawStrip(); }
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
