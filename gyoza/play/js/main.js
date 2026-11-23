// 餃子とドリル: 画面・さわり心地・音・ふるえ・進行。遊びの式は game.js。
// ⚠️餃子・ネジ・ドリル・軍手・バット・湯は ぜんぶ「コードで描いた代役」(写真は 机と土鍋だけ)。本番の絵は CLAUDE.md の「ほしい絵」。
(function () {
  'use strict';
  var G = window.GZGame, K = G.K, Q = new URLSearchParams(location.search);
  var JA = (Q.get('lang') || navigator.language || 'ja').toLowerCase().indexOf('ja') === 0;
  function T(ja, en) { return JA ? ja : en; }
  document.documentElement.lang = JA ? 'ja' : 'en';
  document.title = T('餃子とドリル', 'Dumplings & Drill');

  // ---- 舞台(幅 1080 の座標。高さは画面の縦横比で決まる)----
  var W = 1080, H = 1920, U = 1, DPR = 1;
  var PXU = 130;                                 // ネジの長さ 1.0 = 130 px
  var BX = 540, BY = 1280;                       // 作業中の餃子(底の真ん中)
  var TRAY = { x: 60, y: 250, w: 960, h: 330 };
  var POT = { cx: 500, cy: 300, rx: 335, ry: 200, w: 1000, h: 750 };   // assets/pot.webp の口の中(tools/make_assets.py の実測を 内側へ寄せた値)
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), cBg = $('bg'), cFx = $('fx');
  var bg = cBg.getContext('2d'), fx = cFx.getContext('2d');
  var img = {}, ready = false;
  var INK = '#241a12', PAPER = '#fff6e6', RED = '#b5281c';
  var FONT = '"YujiBoku","GZNum","Hiragino Mincho ProN","Yu Mincho",serif';
  var SP = 1.25;                                 // 代役の絵を描いておく倍率

  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var cw = Math.min(vw, vh * 0.5), chh = vh;             // 横長の画面では 縦の柱にする(スマホと同じ縦横比。低いと 題字とドリルが重なる)
    H = Math.max(2000, Math.min(2500, Math.round(W * chh / cw)));
    U = cw / W; DPR = Math.min(window.devicePixelRatio || 1, 3);
    stage.style.width = cw + 'px'; stage.style.height = chh + 'px';
    stage.style.setProperty('--u', U + 'px');
    [cBg, cFx].forEach(function (c) { c.width = Math.round(cw * DPR); c.height = Math.round(chh * DPR); });
    BY = Math.round(H * 0.72); TRAY.y = Math.round(H * 0.135) + 20;
    if (ready) drawBg();
  }
  function sx(c) { c.setTransform(cFx.width / W, 0, 0, cFx.height / H, 0, 0); }

  // ---- 小さな道具 ----
  function Spring(k, c, v) { this.k = k; this.c = c; this.x = v || 0; this.v = 0; this.t = v || 0; }
  Spring.prototype.step = function (dt) { var n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n; for (var i = 0; i < n; i++) { this.v += (-this.k * (this.x - this.t) - this.c * this.v) * h; this.x += this.v * h; } return this.x; };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }
  function mk(w, h) { var c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; }
  var fake = null;                                // 検査用: 数字を入れると その時刻で動く
  function now() { return fake != null ? fake : performance.now(); }

  // ---- ふるえ(Android Chrome は navigator.vibrate。iPhone の Safari には無い = 何も起きない)----
  // ネイティブに包むときは window.GZNative.haptic(kind) を用意すれば そちらが呼ばれる
  var HAPT = { spin: 14, load: 34, perfect: [12, 30, 22], ok: 14, loose: 6, tear: [70, 30, 130], gear: [10, 40, 10], plate: 10, plop: 8, open: [20, 30, 40], clear: [20, 60, 20, 60, 40], bad: 120 };
  var hapticLog = [];
  function haptic(kind) {
    hapticLog.push(kind); if (hapticLog.length > 600) hapticLog.shift();
    try { if (window.GZNative && window.GZNative.haptic) return window.GZNative.haptic(kind); if (navigator.vibrate) navigator.vibrate(HAPT[kind]); } catch (e) {}
  }

  // ---- 音(全部 コードで作る)----
  var AC = null, master = null, noiseBuf = null, soundLog = [], analyser = null, DR = null;
  function audioOn() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    AC = new C(); master = AC.createGain(); master.gain.value = 0.6;
    var comp = AC.createDynamicsCompressor(); master.connect(comp); comp.connect(AC.destination);
    analyser = AC.createAnalyser(); analyser.fftSize = 2048; master.connect(analyser);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // ドリル: モーターのうなり(のこぎり波)+ ギアの高い鳴き(矩形波 → 帯域)+ ブラシのシャー(雑音)。重くなると 音程が下がって ごろごろ言う
    var m = AC.createOscillator(), mg = AC.createGain(), mf = AC.createBiquadFilter(), w = AC.createOscillator(), wf = AC.createBiquadFilter(), wg = AC.createGain(),
      n = AC.createBufferSource(), nf = AC.createBiquadFilter(), ng = AC.createGain(), out = AC.createGain(), lfo = AC.createOscillator(), lg = AC.createGain();
    m.type = 'sawtooth'; mf.type = 'lowpass'; mf.frequency.value = 1400; m.connect(mf); mf.connect(mg); mg.connect(out);
    w.type = 'square'; wf.type = 'bandpass'; wf.Q.value = 5; w.connect(wf); wf.connect(wg); wg.connect(out);
    n.buffer = noiseBuf; n.loop = true; nf.type = 'highpass'; nf.frequency.value = 3200; n.connect(nf); nf.connect(ng); ng.connect(out);
    lfo.frequency.value = 31; lg.gain.value = 0; lfo.connect(lg); lg.connect(out.gain);
    out.gain.value = 1; mg.gain.value = 0; wg.gain.value = 0; ng.gain.value = 0; out.connect(master);
    m.start(); w.start(); n.start(); lfo.start();
    DR = { m: m, mg: mg, w: w, wf: wf, wg: wg, ng: ng, lg: lg, lfo: lfo };
  }
  var drillSnd = { rpm: 0, load: 0, hz: 0 };
  function drillSound(rpm, load, gear) {            // 毎コマ: 回転(0〜1)・重さ(0〜1)・ギア
    var hz = (70 + 150 * rpm * (gear > 1 ? 1.32 : 1)) * (1 - 0.3 * load);
    drillSnd.rpm = rpm; drillSnd.load = load; drillSnd.hz = hz;
    if (!AC || AC.state !== 'running' || !DR) return;
    var t = AC.currentTime, k = 0.018;
    DR.m.frequency.setTargetAtTime(hz, t, k); DR.w.frequency.setTargetAtTime(hz * 7.02, t, k); DR.wf.frequency.setTargetAtTime(hz * 7.02, t, k);
    DR.mg.gain.setTargetAtTime(0.2 * Math.pow(rpm, 0.7) * (1 + 0.5 * load), t, k);
    DR.wg.gain.setTargetAtTime(0.11 * Math.pow(rpm, 1.4) * (1 - 0.4 * load), t, k);
    DR.ng.gain.setTargetAtTime(0.05 * rpm, t, k);
    DR.lg.gain.setTargetAtTime(0.45 * load * rpm, t, k); DR.lfo.frequency.setTargetAtTime(24 + 10 * rpm, t, k);
  }
  function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function tone(type, f0, f1, t, a, d, peak) {
    var o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    env(g, t, a, peak, d); o.connect(g); g.connect(master); o.start(t); o.stop(t + a + d + 0.05);
  }
  function noise(ftype, f0, f1, q, t, a, d, peak) {
    var s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(); s.buffer = noiseBuf; s.loop = true;
    f.type = ftype; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    env(g, t, a, peak, d); s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + a + d + 0.05);
  }
  var SND = {
    click: function (t) { noise('highpass', 2400, 1800, 0.7, t, 0.002, 0.02, 0.2); tone('square', 180, 120, t, 0.002, 0.02, 0.08); },          // 引き金
    perfect: function (t) { noise('bandpass', 620, 220, 2.4, t, 0.005, 0.07, 0.3); tone('sine', 1568, 1568, t + 0.03, 0.003, 0.5, 0.11); tone('sine', 3136, 3136, t + 0.03, 0.003, 0.22, 0.03); },   // ぷにっ + 卓上ベルのチン
    ok: function (t) { noise('bandpass', 560, 200, 2.2, t, 0.005, 0.07, 0.26); tone('sine', 196, 130, t, 0.004, 0.07, 0.14); },             // ぷにっ
    loose: function (t) { tone('triangle', 420, 300, t, 0.003, 0.05, 0.1); noise('highpass', 3000, 2500, 0.7, t, 0.002, 0.03, 0.05); },      // かちゃ(浮いたまま)
    tear: function (t) { noise('lowpass', 1500, 260, 0.9, t, 0.006, 0.22, 0.6); tone('sine', 150, 52, t, 0.004, 0.2, 0.4); noise('bandpass', 2600, 900, 3, t + 0.03, 0.01, 0.16, 0.2); },   // ぶちゅ
    slide: function (t) { noise('bandpass', 900, 1500, 0.8, t, 0.06, 0.16, 0.06); },
    plate: function (t) { tone('sine', 2100, 1900, t, 0.002, 0.07, 0.04); noise('highpass', 4200, 3000, 0.7, t, 0.002, 0.03, 0.05); },      // バットに置く
    gear: function (t) { noise('highpass', 1800, 1200, 0.8, t, 0.002, 0.03, 0.3); tone('square', 240, 160, t + 0.05, 0.002, 0.03, 0.12); },   // ギアを かちっ
    boss: function (t) { tone('sawtooth', 132, 96, t, 0.02, 0.16, 0.12); tone('sawtooth', 150, 104, t + 0.2, 0.02, 0.22, 0.12); },          // 店長の「おい」
    whistle: function (t) { noise('bandpass', 2300, 2300, 9, t, 0.02, 0.5, 0.2); tone('sine', 2300, 2250, t, 0.02, 0.5, 0.05); },             // そこまで
    plop: function (t) { tone('sine', 360, 120, t, 0.004, 0.09, 0.2); noise('lowpass', 2200, 600, 0.8, t + 0.02, 0.01, 0.12, 0.12); },        // ぽちゃ
    open: function (t) { tone('sine', 260, 700, t, 0.004, 0.06, 0.22); noise('bandpass', 1200, 500, 1.2, t, 0.004, 0.1, 0.2); },             // ぱかっ
    stay: function (t) { tone('sine', 1320, 1320, t, 0.003, 0.12, 0.06); },
    bubble: function (t) { tone('sine', 180 + Math.random() * 240, 520 + Math.random() * 300, t, 0.004, 0.05, 0.035); },
    over: function (t) { tone('square', 392, 392, t, 0.004, 0.12, 0.05); tone('square', 311, 311, t + 0.16, 0.004, 0.12, 0.05); tone('square', 262, 262, t + 0.32, 0.004, 0.26, 0.05); },
    clear: function (t) { [1047, 1319, 1568, 2093].forEach(function (f, i) { tone('sine', f, f, t + i * 0.09, 0.004, i === 3 ? 0.6 : 0.16, 0.09); }); }
  };
  function play(name) {
    soundLog.push(name); if (soundLog.length > 800) soundLog.shift();
    if (!AC || AC.state !== 'running') return;
    try { SND[name](AC.currentTime + 0.005); } catch (e) {}
  }

  // ---- 絵を読む ----
  function load(name, src) { return new Promise(function (ok, ng) { var i = new Image(); i.onload = function () { img[name] = i; ok(); }; i.onerror = ng; i.src = src; }); }

  // ================= 代役の絵(コードで描く)=================
  var RIM = { rx: 322, ry: 232, ox: 365, oy: 272, ix: 284, iy: 194 };          // ひだの帯(真ん中 / 外 / 内)。餃子は ∩ の形で、上の弧が とじ目
  var DO = { w: 800, h: 520, ox: 400, oy: 425 };                               // 餃子 1 コぶんの画布と 原点(底の真ん中)
  function shell(c, grow, keep) {                                              // 餃子の輪郭(keep = いまの道に足す)
    var g = grow || 0, i, n = 96;
    if (!keep) c.beginPath();
    for (i = 0; i <= n; i++) { var a = Math.PI * (1 - i / n), s = 1 + 0.016 * Math.abs(Math.sin(a * 13)) * Math.sin(a); var x = (RIM.ox + g) * Math.cos(a) * s, y = -(RIM.oy + g) * Math.sin(a) * s; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    c.bezierCurveTo(300, 92 + g, -300, 92 + g, -RIM.ox - g, 0); c.closePath();
  }
  function rnd(seed) { return G.rng(seed); }
  function makeDumpling(thin) {
    var cv = mk(DO.w * SP, DO.h * SP), c = cv.getContext('2d'), r = rnd(thin ? 77 : 31), i;
    c.scale(SP, SP); c.translate(DO.ox, DO.oy);
    // 生地
    var g = c.createLinearGradient(0, -280, 0, 95); g.addColorStop(0, '#f8eed8'); g.addColorStop(0.55, '#efe0bd'); g.addColorStop(1, '#d9c193');
    shell(c); c.fillStyle = g; c.fill();
    c.save(); shell(c); c.clip();
    // 中の具が うっすら透ける(薄皮は はっきり)
    for (i = 0; i < (thin ? 46 : 26); i++) {
      var bx = (r() - 0.5) * 430, by = -20 - r() * 150, br = 18 + r() * 40, al = (thin ? 0.2 : 0.07) * (0.5 + r());
      var col = r() < 0.55 ? '96,128,52' : r() < 0.5 ? '188,112,98' : '150,96,60';
      var bgd = c.createRadialGradient(bx, by, 0, bx, by, br); bgd.addColorStop(0, 'rgba(' + col + ',' + al + ')'); bgd.addColorStop(1, 'rgba(' + col + ',0)');
      c.fillStyle = bgd; c.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    // ふくらみ: 左上から光、底のほうが影
    g = c.createRadialGradient(-70, -120, 10, -30, -70, 330); g.addColorStop(0, 'rgba(255,255,250,.75)'); g.addColorStop(0.45, 'rgba(255,252,240,.22)'); g.addColorStop(1, 'rgba(255,250,235,0)');
    c.fillStyle = g; c.fillRect(-400, -300, 800, 400);
    g = c.createLinearGradient(0, -40, 0, 95); g.addColorStop(0, 'rgba(140,96,44,0)'); g.addColorStop(1, 'rgba(140,96,44,.42)');
    c.fillStyle = g; c.fillRect(-400, -40, 800, 140);
    // ひだの帯は 平たく 少し白い(粉)
    c.beginPath(); c.ellipse(0, 0, RIM.ox + 30, RIM.oy + 30, 0, Math.PI, 0); c.ellipse(0, 0, RIM.ix, RIM.iy, 0, 0, Math.PI, true); c.closePath();
    c.fillStyle = 'rgba(255,250,236,.34)'; c.fill();
    // ふくらみと帯の境(くぼみ)
    c.shadowColor = 'rgba(120,80,32,.75)'; c.shadowBlur = 16; c.lineCap = 'round';
    c.strokeStyle = 'rgba(150,108,56,.42)'; c.lineWidth = 9; c.beginPath(); c.ellipse(0, 0, RIM.ix, RIM.iy, 0, Math.PI * 1.02, Math.PI * 1.98); c.stroke();
    c.shadowColor = 'rgba(255,255,250,.9)'; c.shadowBlur = 10; c.strokeStyle = 'rgba(255,255,248,.5)'; c.lineWidth = 6;
    c.beginPath(); c.ellipse(0, 6, RIM.ix - 16, RIM.iy - 14, 0, Math.PI * 1.1, Math.PI * 1.75); c.stroke();
    // ひだ(つまんだ跡)
    for (i = 0; i < 15; i++) {
      var a = Math.PI * (0.06 + 0.88 * (i + 0.5) / 15) + (r() - 0.5) * 0.03, ca = Math.cos(a), sa = Math.sin(a), k0 = 0.8 + r() * 0.05, tw = (r() - 0.5) * 0.05;
      c.shadowColor = 'rgba(120,82,36,.8)'; c.shadowBlur = 7; c.strokeStyle = 'rgba(150,110,62,.34)'; c.lineWidth = 4.5;
      c.beginPath(); c.moveTo(RIM.ox * k0 * ca, -RIM.oy * k0 * sa); c.quadraticCurveTo(RIM.ox * 0.93 * Math.cos(a + tw), -RIM.oy * 0.93 * Math.sin(a + tw), RIM.ox * 1.01 * Math.cos(a + tw * 2), -RIM.oy * 1.01 * Math.sin(a + tw * 2)); c.stroke();
      c.shadowColor = 'rgba(255,255,250,.9)'; c.shadowBlur = 5; c.strokeStyle = 'rgba(255,255,248,.5)'; c.lineWidth = 3;
      var a2 = a - 0.028; c.beginPath(); c.moveTo(RIM.ox * (k0 + 0.02) * Math.cos(a2), -RIM.oy * (k0 + 0.02) * Math.sin(a2)); c.lineTo(RIM.ox * 0.985 * Math.cos(a2), -RIM.oy * 0.985 * Math.sin(a2)); c.stroke();
    }
    c.shadowBlur = 0; c.shadowColor = 'transparent';
    // ふちの丸み(内側の影)
    c.save(); c.shadowColor = 'rgba(128,88,40,.6)'; c.shadowBlur = 26; c.fillStyle = '#000';
    c.beginPath(); c.rect(-600, -500, 1200, 800); shell(c, 2, true); c.fill('evenodd'); c.restore();
    // 打ち粉
    for (i = 0; i < 520; i++) { c.fillStyle = 'rgba(255,255,252,' + (0.1 + r() * 0.3) + ')'; var fr = 0.6 + r() * 1.6; c.beginPath(); c.arc((r() - 0.5) * 760, -280 + r() * 370, fr, 0, 7); c.fill(); }
    c.restore();
    grain(cv, 9, r);
    return cv;
  }
  function grain(cv, amt, r) {                       // 平らな塗りを 写真のざらつきに寄せる
    var c = cv.getContext('2d'), d = c.getImageData(0, 0, cv.width, cv.height), p = d.data;
    for (var i = 0; i < p.length; i += 4) if (p[i + 3] > 8) { var n = (r() - 0.5) * 2 * amt; p[i] += n; p[i + 1] += n; p[i + 2] += n * 0.8; }
    c.putImageData(d, 0, 0);
  }
  function makeOpen() {                              // 茹でて開いた餃子(皮が ぱかっと分かれて 具が出ている)
    var cv = mk(300 * SP, 220 * SP), c = cv.getContext('2d'), r = rnd(5), i;
    c.scale(SP, SP); c.translate(150, 110);
    function half(rot, dx, dy) {
      c.save(); c.translate(dx, dy); c.rotate(rot); c.scale(0.31, 0.26);
      var g = c.createLinearGradient(0, -280, 0, 60); g.addColorStop(0, '#f6ecd6'); g.addColorStop(1, '#e2cfa4');
      c.beginPath(); c.ellipse(0, 0, RIM.ox, RIM.oy, 0, Math.PI, 0); c.bezierCurveTo(250, -150, -250, -150, -RIM.ox, 0); c.closePath();
      c.fillStyle = g; c.fill(); c.strokeStyle = 'rgba(140,100,50,.35)'; c.lineWidth = 8; c.stroke(); c.restore();
    }
    half(-0.5, -52, 16); half(2.5, 58, 22);
    for (i = 0; i < 22; i++) {
      var x = (r() - 0.5) * 110, y = (r() - 0.5) * 60 + 8, rr = 9 + r() * 15;
      var g = c.createRadialGradient(x - 3, y - 3, 1, x, y, rr); var col = r() < 0.45 ? ['#c7a48c', '#a17a63'] : r() < 0.6 ? ['#8fae5a', '#5f7d37'] : ['#d6b9a6', '#b08a74'];
      g.addColorStop(0, col[0]); g.addColorStop(1, col[1]); c.fillStyle = g; c.beginPath(); c.arc(x, y, rr, 0, 7); c.fill();
    }
    grain(cv, 8, r); return cv;
  }
  function metal(c, x0, x1, dark) {
    var g = c.createLinearGradient(x0, 0, x1, 0);
    if (dark) { g.addColorStop(0, '#1d1e21'); g.addColorStop(0.28, '#6a6d73'); g.addColorStop(0.5, '#34363a'); g.addColorStop(1, '#151618'); }
    else { g.addColorStop(0, '#5f6368'); g.addColorStop(0.3, '#f1f3f5'); g.addColorStop(0.55, '#a3a8ae'); g.addColorStop(1, '#474a4f'); }
    return g;
  }
  // ネジ 1 本。(x0, y0) = 皮に入る点、hgt = 頭が皮から浮いている高さ(px。マイナス = 沈んでいる)、rot = 回った角度
  function drawScrew(c, x0, y0, hgt, rot, tilt) {
    var yh = y0 - hgt, sink = Math.max(0, -hgt);
    c.save(); c.translate(x0, y0); if (tilt) c.rotate(tilt); c.translate(-x0, -y0);
    if (sink > 0) {                                   // くぼみ
      var kk = clamp(sink / 14, 0, 1), rx = 40 + sink * 2.4;
      var g = c.createRadialGradient(x0, y0 + sink * 0.6, 8, x0, y0 + sink * 0.6, rx); g.addColorStop(0, 'rgba(84,52,20,' + 0.8 * kk + ')'); g.addColorStop(0.55, 'rgba(110,74,34,' + 0.42 * kk + ')'); g.addColorStop(1, 'rgba(120,82,38,0)');
      c.save(); c.translate(x0, y0 + sink * 0.6); c.scale(1, 0.56); c.translate(-x0, -(y0 + sink * 0.6)); c.fillStyle = g; c.beginPath(); c.arc(x0, y0 + sink * 0.6, rx, 0, 7); c.fill(); c.restore();
      c.strokeStyle = 'rgba(255,255,248,' + 0.55 * kk + ')'; c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath(); c.ellipse(x0, y0 + sink * 0.6 + 3, rx * 0.62, rx * 0.36, 0, Math.PI * 0.12, Math.PI * 0.88); c.stroke();
    } else {
      c.fillStyle = 'rgba(96,62,26,.5)'; c.beginPath(); c.ellipse(x0, y0 + 1, 13, 6, 0, 0, 7); c.fill();                        // 入り口の影
      c.fillStyle = 'rgba(70,46,20,.16)'; c.beginPath(); c.ellipse(x0 + 16 + hgt * 0.18, y0 + 6, 20 + hgt * 0.2, 8, 0, 0, 7); c.fill();   // ネジの影
    }
    if (hgt > 3) {                                    // 軸とねじ山
      c.save(); c.beginPath(); c.rect(x0 - 8, yh + 6, 16, hgt - 6); c.clip();
      c.fillStyle = metal(c, x0 - 8, x0 + 8); c.fillRect(x0 - 8, yh, 16, hgt + 2);
      c.strokeStyle = 'rgba(40,42,46,.6)'; c.lineWidth = 2.4; var off = ((rot * 2.2) % 8 + 8) % 8;
      for (var y = yh - 8 + off; y < y0 + 8; y += 8) { c.beginPath(); c.moveTo(x0 - 9, y + 5); c.lineTo(x0 + 9, y); c.stroke(); }
      c.restore();
    }
    var hy = yh;                                      // 頭(なべ頭・十字穴)
    if (hgt > 1) { c.fillStyle = metal(c, x0 - 30, x0 + 30); c.beginPath(); c.ellipse(x0, hy + 8, 30, 12, 0, 0, Math.PI); c.lineTo(x0 - 30, hy); c.lineTo(x0 + 30, hy); c.closePath(); c.fill(); }
    var g2 = c.createLinearGradient(x0 - 30, hy - 12, x0 + 22, hy + 12); g2.addColorStop(0, '#fbfcfd'); g2.addColorStop(0.45, '#b9bec4'); g2.addColorStop(1, '#6c7076');
    c.fillStyle = g2; c.beginPath(); c.ellipse(x0, hy, 30, 12, 0, 0, 7); c.fill();
    c.strokeStyle = 'rgba(40,42,46,.55)'; c.lineWidth = 1.5; c.stroke();
    c.save(); c.translate(x0, hy); c.scale(1, 0.4); c.rotate(rot); c.strokeStyle = '#2a2c30'; c.lineWidth = 6; c.lineCap = 'butt';
    c.beginPath(); c.moveTo(-17, 0); c.lineTo(17, 0); c.moveTo(0, -17); c.lineTo(0, 17); c.stroke(); c.restore();
    c.restore();
  }
  // ドリル(先端が原点、上へ のびる)。自前の形: 明るい灰色の胴・黒いゴムの握り・軍手。ロゴや特定メーカーの配色は無い
  var DRO = { w: 780, h: 760, ox: 130, oy: 745 };
  var HA = { ax: 60, ay: -395, bx: 452, by: -486 };                            // 握りの軸(胴の横 → 電池)
  function makeDrill() {
    var cv = mk(DRO.w * SP, DRO.h * SP), c = cv.getContext('2d'), r = rnd(9), i, g;
    c.scale(SP, SP); c.translate(DRO.ox, DRO.oy);
    var ang = Math.atan2(HA.by - HA.ay, HA.bx - HA.ax), L = Math.hypot(HA.bx - HA.ax, HA.by - HA.ay);
    c.save(); c.translate(HA.ax, HA.ay); c.rotate(ang);
    // 電池
    g = c.createLinearGradient(0, -110, 0, 110); g.addColorStop(0, '#55585e'); g.addColorStop(0.3, '#3a3c41'); g.addColorStop(1, '#1b1c1f');
    c.fillStyle = g; rr(c, L - 30, -108, 170, 216, 22); c.fill();
    c.fillStyle = 'rgba(255,255,255,.08)'; rr(c, L - 18, -98, 146, 26, 12); c.fill();
    // 握り(胴と同じ灰色 + 黒いゴム)
    g = c.createLinearGradient(0, -62, 0, 62); g.addColorStop(0, '#e6e3dc'); g.addColorStop(0.35, '#cfccc4'); g.addColorStop(1, '#8d8a83');
    c.fillStyle = g; c.beginPath(); c.moveTo(-10, -66); c.lineTo(L, -56); c.lineTo(L, 56); c.lineTo(-10, 62); c.closePath(); c.fill();
    g = c.createLinearGradient(0, -60, 0, 20); g.addColorStop(0, '#3d3e42'); g.addColorStop(1, '#1e1f22');
    c.fillStyle = g; c.beginPath(); c.moveTo(70, -66); c.lineTo(L - 20, -57); c.lineTo(L - 20, 4); c.quadraticCurveTo(200, 18, 70, 2); c.closePath(); c.fill();
    // 引き金(握りの前がわ・胴の近く)
    c.fillStyle = '#232427'; c.beginPath(); c.moveTo(34, 60); c.quadraticCurveTo(60, 98, 100, 92); c.lineTo(108, 60); c.closePath(); c.fill();
    // 軍手(代役): 握りを包む こぶし + 指の筋 + 親指
    var gl = c.createLinearGradient(0, -90, 0, 110); gl.addColorStop(0, '#fbf8f0'); gl.addColorStop(0.5, '#ece7da'); gl.addColorStop(1, '#bdb6a4');
    c.fillStyle = gl; c.shadowColor = 'rgba(30,20,10,.45)'; c.shadowBlur = 18; c.shadowOffsetY = 8;
    c.beginPath(); c.moveTo(118, -84); c.bezierCurveTo(190, -108, 330, -104, 372, -70); c.bezierCurveTo(398, -30, 396, 60, 366, 96);
    c.bezierCurveTo(300, 128, 190, 124, 130, 104); c.bezierCurveTo(100, 60, 96, -40, 118, -84); c.closePath(); c.fill();
    c.shadowBlur = 0; c.shadowOffsetY = 0; c.shadowColor = 'transparent';
    c.fillStyle = gl; c.beginPath(); c.moveTo(134, 72); c.bezierCurveTo(100, 66, 62, 78, 52, 96); c.bezierCurveTo(56, 118, 110, 122, 150, 112); c.closePath(); c.fill();   // 人さし指 → 引き金
    c.strokeStyle = 'rgba(120,108,84,.5)'; c.lineWidth = 4; c.lineCap = 'round';
    for (i = 0; i < 3; i++) { var fxp = 196 + i * 62; c.beginPath(); c.moveTo(fxp, 6); c.quadraticCurveTo(fxp + 8, 70, fxp - 2, 116); c.stroke(); }
    c.beginPath(); c.moveTo(126, -40); c.bezierCurveTo(190, -62, 270, -58, 330, -30); c.stroke();                                       // 親指
    c.strokeStyle = 'rgba(150,140,118,.25)'; c.lineWidth = 1.5;                                                                           // 編み目
    c.save(); c.beginPath(); c.moveTo(118, -84); c.bezierCurveTo(190, -108, 330, -104, 372, -70); c.bezierCurveTo(398, -30, 396, 60, 366, 96); c.bezierCurveTo(300, 128, 190, 124, 130, 104); c.bezierCurveTo(100, 60, 96, -40, 118, -84); c.clip();
    for (i = 90; i < 410; i += 7) { c.beginPath(); c.moveTo(i, -110); c.lineTo(i + 10, 130); c.stroke(); }
    c.restore();
    c.restore();
    // 胴
    c.fillStyle = metal(c, -80, 80); c.globalAlpha = 1;
    g = c.createLinearGradient(-80, 0, 80, 0); g.addColorStop(0, '#8e8b84'); g.addColorStop(0.24, '#f0ede6'); g.addColorStop(0.6, '#cfccc4'); g.addColorStop(1, '#7c7972');
    c.fillStyle = g; c.beginPath(); c.moveTo(-74, -236); c.lineTo(74, -236); c.lineTo(78, -560); c.quadraticCurveTo(76, -622, 0, -626); c.quadraticCurveTo(-76, -622, -78, -560); c.closePath(); c.fill();
    c.fillStyle = 'rgba(30,30,32,.75)'; for (i = 0; i < 4; i++) { rr(c, 14, -590 + i * 20, 44, 9, 4); c.fill(); }                          // 風穴
    c.fillStyle = '#26272a'; rr(c, -56, -548, 30, 96, 10); c.fill();                                                                       // ギア切り替えの溝(つまみは あとで描く)
    // トルクの輪
    g = c.createLinearGradient(-66, 0, 66, 0); g.addColorStop(0, '#2a2b2e'); g.addColorStop(0.3, '#77797e'); g.addColorStop(0.6, '#45474b'); g.addColorStop(1, '#1c1d1f');
    c.fillStyle = g; rr(c, -66, -244, 132, 52, 8); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 2; for (i = -56; i <= 56; i += 14) { c.beginPath(); c.moveTo(i, -236); c.lineTo(i, -200); c.stroke(); }
    // チャック
    c.fillStyle = metal(c, -54, 54, true); c.beginPath(); c.moveTo(-54, -194); c.lineTo(54, -194); c.lineTo(30, -82); c.lineTo(-30, -82); c.closePath(); c.fill();
    c.fillStyle = metal(c, -22, 22); c.beginPath(); c.moveTo(-26, -84); c.lineTo(26, -84); c.lineTo(15, -60); c.lineTo(-15, -60); c.closePath(); c.fill();
    // ビット
    c.fillStyle = metal(c, -7, 7); c.fillRect(-7, -62, 14, 50);
    c.fillStyle = metal(c, -7, 7, true); c.beginPath(); c.moveTo(-7, -14); c.lineTo(7, -14); c.lineTo(2.5, 0); c.lineTo(-2.5, 0); c.closePath(); c.fill();
    grain(cv, 6, r);
    return cv;
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  var spr = {};
  function screwPos(d, i) { var n = d.screws.length, a = Math.PI * (n === 1 ? 0.5 : lerp(0.82, 0.18, i / (n - 1))); return { x: RIM.rx * Math.cos(a), y: -RIM.ry * Math.sin(a) }; }
  function hgtOf(s) { return -s.x * PXU; }           // x(単位)→ 頭の高さ(px)
  // 餃子 1 コを 原点 = 底の真ん中 で描く(ネジつき)。skip = いま回しているネジ(別に描く)
  function drawDumplingAt(c, d, vis, skip) {
    c.drawImage(spr[d.skin === 'thin' ? 'thin' : 'dough'], -DO.ox, -DO.oy, DO.w, DO.h);
    for (var i = 0; i < d.screws.length; i++) {
      if (i === skip) continue; var s = d.screws[i], p = screwPos(d, i), v = vis && vis[i];
      if (s.grade === 'tear') { drawTear(c, p.x, p.y, d.id * 7 + i); continue; }
      drawScrew(c, p.x, p.y, hgtOf(s), v ? v.rot : i * 1.3, s.grade === 'loose' ? (v ? v.tilt : 0.05) : 0);
    }
  }
  function drawTear(c, x, y, seed) {                 // 破れ目と はみ出した具
    var r = rnd(seed + 3), i;
    c.fillStyle = '#5b3a2a'; c.beginPath();
    for (i = 0; i < 14; i++) { var a = i / 14 * 6.283, rad = (i % 2 ? 62 : 34) + r() * 16; c.lineTo(x + Math.cos(a) * rad, y + 8 + Math.sin(a) * rad * 0.6); }
    c.closePath(); c.fill();
    for (i = 0; i < 16; i++) {
      var px = x + (r() - 0.5) * 110, py = y + 6 + (r() - 0.5) * 64, pr = 9 + r() * 16, col = r() < 0.45 ? ['#d2ae96', '#a67c64'] : r() < 0.6 ? ['#9dbb66', '#63823a'] : ['#e2c6b3', '#b58e78'];
      var g = c.createRadialGradient(px - 3, py - 4, 1, px, py, pr); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]); c.fillStyle = g; c.beginPath(); c.arc(px, py, pr, 0, 7); c.fill();
    }
  }
  function snapshot(d, vis) {                        // 作り終えた餃子を 小さい絵にして持つ(バット・鍋で使う)
    var s = 0.36, cv = mk(DO.w * s, DO.h * s), c = cv.getContext('2d'); c.scale(s, s); c.translate(DO.ox, DO.oy); drawDumplingAt(c, d, vis, -1); return cv;
  }

  // ================= 状態 =================
  var st = 'LOAD';                 // TITLE → PLAY → OUT(クビ・放置)/ BOIL(茹でる)→ RESULT
  var game = null, T0 = 0, endKind = null, endT = 0, runs = 0, seed = 1;
  var vis = {};                    // 餃子 id → 見た目の付けたし { rot/tilt のネジごと, inT, sq }
  var drill = { x: new Spring(1500, 70, BX), y: new Spring(1700, 76, 0), rpm: 0, rot: 0, lift: new Spring(300, 26, 0), gearK: new Spring(500, 30, 0), away: 0 };
  var sq = new Spring(520, 13, 1), shakeT = -1e9;
  var parts = [], pops = [], leaving = [], stains = [], tray = [], boil = null;
  var hintEl = $('hint'), titleEl = $('title'), resEl = $('result'), bossEl = $('boss'), startEl = $('start');
  var bossT = 0, hapT = 0, lastT = 0, contactSeen = false, pressedAt = -1e9;

  function drawBg() {                                // 机(写真)+ バット(代役)
    sx(bg); var im = img.table, s = Math.max(W / im.width, H / im.height);
    bg.drawImage(im, (W - im.width * s) / 2, H - im.height * s, im.width * s, im.height * s);
    bg.globalCompositeOperation = 'multiply'; bg.fillStyle = 'rgb(176,132,92)'; bg.fillRect(0, 0, W, H); bg.globalCompositeOperation = 'source-over';
    var v = bg.createRadialGradient(540, H * 0.6, H * 0.25, 540, H * 0.6, H * 0.8); v.addColorStop(0, 'rgba(30,18,8,0)'); v.addColorStop(1, 'rgba(30,18,8,.5)'); bg.fillStyle = v; bg.fillRect(0, 0, W, H);
    if (st === 'BOIL' || st === 'TITLE' || (st === 'RESULT' && boil)) return;
    var t = TRAY, g;
    bg.save(); bg.shadowColor = 'rgba(20,12,4,.55)'; bg.shadowBlur = 40; bg.shadowOffsetY = 18;
    g = bg.createLinearGradient(0, t.y, 0, t.y + t.h); g.addColorStop(0, '#d7dade'); g.addColorStop(1, '#8b8f94'); bg.fillStyle = g; rr(bg, t.x, t.y, t.w, t.h, 34); bg.fill(); bg.restore();
    g = bg.createLinearGradient(0, t.y, 0, t.y + t.h); g.addColorStop(0, '#9da1a6'); g.addColorStop(0.12, '#c9cdd1'); g.addColorStop(1, '#dfe2e5'); bg.fillStyle = g; rr(bg, t.x + 20, t.y + 18, t.w - 40, t.h - 34, 22); bg.fill();
    bg.save(); rr(bg, t.x + 20, t.y + 18, t.w - 40, t.h - 34, 22); bg.clip(); var r = rnd(4);
    for (var i = 0; i < 240; i++) { bg.strokeStyle = 'rgba(' + (r() < 0.5 ? '255,255,255' : '60,64,70') + ',' + (0.03 + r() * 0.06) + ')'; bg.lineWidth = 1 + r() * 1.5; var yy = t.y + 18 + r() * (t.h - 34), xx = t.x + r() * t.w; bg.beginPath(); bg.moveTo(xx, yy); bg.lineTo(xx + 80 + r() * 260, yy); bg.stroke(); }
    g = bg.createLinearGradient(t.x, 0, t.x + t.w, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.3, 'rgba(255,255,255,.28)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); bg.fillStyle = g; bg.fillRect(t.x, t.y, t.w, t.h);
    bg.restore();
  }
  function traySlot(i) { var col = i % 6, row = Math.floor(i / 6); return { x: TRAY.x + 118 + col * 145 + (row % 2) * 20, y: TRAY.y + 118 + Math.min(row, 3) * 62 + (row > 3 ? (row - 3) * 10 : 0) }; }

  function say(text, ms) { bossEl.textContent = text; bossEl.classList.add('on'); bossT = now() + (ms || 2200); }
  function pop(text, x, y, col) { pops.push({ text: text, x: x, y: y, t0: now(), col: col || INK }); }
  function puff(x, y, n, sp) { for (var i = 0; i < n; i++) { var a = Math.random() * 6.283, v = sp * (0.3 + Math.random()); parts.push({ k: 'flour', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5 - 20, r: 8 + Math.random() * 16, t0: now(), life: 420 + Math.random() * 300 }); } }
  function burst(x, y) {
    for (var i = 0; i < 26; i++) { var a = Math.random() * 6.283, v = 250 + Math.random() * 700, c = Math.random(); parts.push({ k: 'bit', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 260, r: 5 + Math.random() * 10, col: c < 0.5 ? '#b98f78' : c < 0.72 ? '#7f9c4e' : '#e3d3bf', t0: now(), life: 500 + Math.random() * 400, fy: y + 30 + Math.random() * 260 }); }
  }

  // ---- 遊びの出来事 → 絵・音・ふるえ ----
  function curPos() { return { x: BX, y: BY }; }
  function handle(evs) {
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i], d = game.cur, p;
      if (e.type === 'start') { play('click'); contactSeen = false; hintEl.classList.remove('on'); if (game.pulls === 1) titleEl.classList.add('off'); }
      else if (e.type === 'judge') {
        var dd = e.grade === 'tear' || !d || d.id !== e.d ? findD(e.d) : d; p = screwPos(dd, e.screw); var wx = BX + p.x, wy = BY + p.y;
        var v = (vis[dd.id] = vis[dd.id] || {}); v[e.screw] = { rot: drill.rot, tilt: (Math.random() - 0.5) * 0.22 };
        if (e.grade === 'perfect') { play('perfect'); haptic('perfect'); pop(T('ぴたっ', 'Flush!'), wx, wy - 90, RED); sq.v -= 1.6; puff(wx, wy, 5, 120); }
        else if (e.grade === 'ok') { play('ok'); haptic('ok'); pop(T('よし', 'OK'), wx, wy - 90); sq.v -= 0.9; }
        else if (e.grade === 'loose') { play('loose'); haptic('loose'); pop(T('ゆるい', 'Loose'), wx, wy - 90 - hgtOf(dd.screws[e.screw])); }
        else { play('tear'); haptic('tear'); pop(T('やぶれた', 'Torn!'), wx, wy - 110, RED); burst(wx, wy); shakeT = now(); sq.t = 0.84; sq.v -= 2; say(T('「具が出とる！」', '"You tore it!"'), 1300); }
        drill.lift.x = e.grade === 'tear' ? 90 : 40;
      } else if (e.type === 'dumpling') {
        var snap = snapshot(e.d, vis[e.d.id]);
        if (e.result === 'torn') leaving.push({ d: e.d, kind: 'torn', t0: now() + 520, dur: 380 });
        else { var slot = traySlot(tray.length); tray.push({ cv: snap, shown: false, d: e.d }); leaving.push({ d: e.d, kind: 'tray', t0: now(), dur: 400, slot: slot, i: tray.length - 1, snap: snap }); play('slide'); }
      } else if (e.type === 'spawn') { vis[e.d.id] = { inT: now() }; sq.t = 1; sq.x = 1; sq.v = 0; }
      else if (e.type === 'stage') {
        play('boss');
        if (e.stage === 1) say(T('「注文入った！ ネジは 4 本や」', '"Orders in! Four screws each!"'));
        else { say(T('「おそい！ ハイにせえ」', '"Too slow! Switch it to HI!"')); play('gear'); haptic('gear'); drill.gearK.t = 1; }
      } else if (e.type === 'timeup') { play('whistle'); }
      else if (e.type === 'end') finish(e.kind);
    }
  }
  function findD(id) { if (game.cur && game.cur.id === id) return game.cur; for (var i = 0; i < game.done.length; i++) if (game.done[i].id === id) return game.done[i]; return game.cur; }

  function clockIn() {
    audioOn(); if (st !== 'TITLE' && st !== 'RESULT') return;
    runs++; seed = +(Q.get('seed') || 0) || (Math.floor(Math.random() * 1e9) + 1);
    game = new G.Game(seed); T0 = now(); vis = {}; vis[0] = { inT: now() - 1000 };
    parts = []; pops = []; leaving = []; stains = []; tray = []; boil = null; endKind = null;
    drill.away = 0; drill.gearK.t = 0; drill.gearK.x = 0; drill.rpm = 0; sq.t = 1; sq.x = 1;
    st = 'PLAY'; drawBg();
    resEl.classList.remove('on'); startEl.classList.add('off'); titleEl.classList.add('off');
    hintEl.textContent = T('長押しで ネジを締める。頭が皮に沈んだら 離す', 'Hold to drive the screw. Let go when the head sinks in.'); hintEl.classList.add('on');
    play('boss'); say(T('「茹でても開かんように ネジで閉めとけ」', '"Screw \'em shut so they don\'t open in the pot."'), 3000);
  }
  function finish(kind) {
    endKind = kind; endT = now(); hintEl.classList.remove('on'); drillSound(0, 0, 1);
    if (kind === 'fired') { st = 'OUT'; play('boss'); say(T('「ドリル返せ」', '"Give me that drill."'), 1500); haptic('bad'); }
    else if (kind === 'idle') { st = 'OUT'; }
    else if (!game.done.length) { st = 'OUT'; }
    else { st = 'WAIT'; say(T('「そこまで。茹でるで」', '"Time. Into the pot."'), 1500); }
  }
  function startBoil() {
    var n = Math.min(game.done.length, 20), items = [], gap = Math.min(240, 3200 / n), i;
    for (i = 0; i < n; i++) {
      var d = game.done[game.done.length - n + i], rad = Math.sqrt((i + 0.6) / n), th = i * 2.39996 + 0.7;
      items.push({ d: d, cv: tray[game.done.length - n + i].cv, x: Math.cos(th) * rad * 0.74, y: Math.sin(th) * rad * 0.66, drop: 700 + i * gap, open: d.result === 'loose', ph: i * 1.7, landed: false, judged: false });
    }
    boil = { t0: now(), items: items, shut: 0, opened: 0, extraShut: 0, end: 700 + n * gap + 350 + 700 + 900, bub: 0 };
    // 画面に出しきれない分(21 コ目から)は 数だけ足す
    for (i = 0; i < game.done.length - n; i++) if (game.done[i].result === 'closed') boil.extraShut++;
    st = 'BOIL'; drawBg();
  }
  var RANKS = [['ネジ締めの神', 'Screw God', '「明日から 店長やれ」', '"You run the shop tomorrow."'], ['餃子大工', 'Dumpling Carpenter', '「時給 10 円 上げたる」', '"Ten-yen raise."'],
    ['ドリル見習い', 'Drill Apprentice', '「まあ 食えるわ」', '"Edible, I guess."'], ['ふつうのバイト', 'Regular Part-Timer', '「ぎりぎりやな」', '"Barely."']];
  var shareText = '';
  function showResult() {
    st = 'RESULT'; var k = endKind, c = game.closed, big = $('r-big'), rk = $('r-rank'); big.className = ''; rk.className = '';
    var stat = T('分速 ' + game.perMin() + ' コ　ぴたっ ' + game.flush() + '%　開いた ' + game.opened + ' コ', game.perMin() + ' per min   flush ' + game.flush() + '%   opened ' + game.opened);
    if (k === 'clear') {
      var r = RANKS[G.rank(c)]; $('r-label').textContent = T('茹でても 開かなかった', 'Stayed shut in the pot'); big.innerHTML = c + (JA ? '<small>コ</small>' : '');
      rk.textContent = T(r[0], r[1]); $('r-line').textContent = T(r[2], r[3]); $('r-stat').textContent = stat; play('clear'); haptic('clear');
      shareText = T('餃子とドリル: 茹でても開かなかった餃子 ' + c + ' コ。肩書きは「' + r[0] + '」', 'Dumplings & Drill: ' + c + ' dumplings stayed shut. Title: ' + r[1]);
    } else {
      var L = { soup: [T('ほとんど 開いた', 'Most of them opened'), T('具スープ', 'Filling soup'), T('「これは 餃子やない。スープや」', '"That\'s not dumplings. That\'s soup."')],
        slow: [T('茹でても 開かなかった', 'Stayed shut in the pot'), c + (JA ? '<small>コ</small>' : ''), T('「客 帰ったで」', '"The customers went home."')],
        fired: [T('3 コ 破いた', 'Tore three dumplings'), T('クビ', 'Fired'), T('「具が もったいない」', '"Waste of good filling."')],
        idle: [T('ドリルを持って 立っていた', 'Stood there holding a drill'), '…', T('「帰ってええよ」', '"You can go home."')] }[k];
      $('r-label').textContent = L[0]; big.innerHTML = L[1]; if (k !== 'slow') big.className = 'word';
      rk.textContent = k === 'slow' ? T('日が暮れる', 'Too slow') : ''; rk.className = 'bad'; $('r-line').textContent = L[2]; $('r-stat').textContent = k === 'idle' ? '' : stat; play('over'); haptic('bad');
      shareText = T('餃子とドリル: ' + L[0] + '…' + (k === 'slow' ? c + ' コ' : L[1]) + ' ' + L[2], 'Dumplings & Drill: ' + L[0] + '. ' + L[2]);
    }
    $('b-again').textContent = T('もう一回', 'Again'); $('b-share').textContent = T('シェア', 'Share');
    resEl.classList.add('on');
  }
  function share() {
    var url = location.origin + location.pathname;
    if (navigator.share) { navigator.share({ text: shareText, url: url }).catch(function () {}); return; }
    window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(url), '_blank', 'noopener');
  }

  // ---- 入力(指 1 本: 押す = 引き金を引く / 離す = 止める)----
  var ptrId = null;
  function evT(e) { return fake != null ? fake : (e && e.timeStamp > 0 ? e.timeStamp : performance.now()); }
  function press(t) { if (st !== 'PLAY') return; pressedAt = t; handle(game.input(t - T0, true)); }
  function release(t) { audioOn(); if (st !== 'PLAY') return; handle(game.input(t - T0, false)); }
  cFx.addEventListener('pointerdown', function (e) { if (ptrId != null) return; ptrId = e.pointerId; try { cFx.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); press(evT(e)); });
  function up(e) { if (e.pointerId !== ptrId) return; ptrId = null; release(evT(e)); }
  cFx.addEventListener('pointerup', up); cFx.addEventListener('pointercancel', up);
  cFx.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('keydown', function (e) { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (st === 'TITLE' || st === 'RESULT') clockIn(); else press(evT(e)); } });
  window.addEventListener('keyup', function (e) { if (e.code === 'Space') release(evT(e)); });
  window.addEventListener('blur', function () { if (ptrId != null || (game && game.down)) { ptrId = null; release(now()); } });
  $('b-in').addEventListener('click', clockIn); $('b-again').addEventListener('click', clockIn); $('b-share').addEventListener('click', share);

  // ================= 1 コマ =================
  function frame(tn) {
    var dt = clamp((tn - lastT) / 1000, 0, 0.05); lastT = tn;
    if (st === 'PLAY') handle(game.advance(tn - T0 - (fake != null ? 0 : 24)));     // 24 ms 遅らせて進める(同じ瞬間に離した指を 先に数えるため)
    if (bossT && tn > bossT) { bossEl.classList.remove('on'); bossT = 0; }
    if (st === 'WAIT' && tn - endT > 1500) startBoil();
    if (st === 'OUT') { drill.away = ease((tn - endT - (endKind === 'fired' ? 500 : 0)) / 700); if (tn - endT > 1900) showResult(); }
    if (st === 'BOIL' && tn - boil.t0 > boil.end) showResult();
    sx(fx); fx.clearRect(0, 0, W, H);
    if (st === 'BOIL' || (st === 'RESULT' && boil)) drawBoil(tn, dt); else drawBench(tn, dt);
    if (st === 'RESULT') { var g = fx.createLinearGradient(0, H * 0.5, 0, H); g.addColorStop(0, 'rgba(255,246,230,0)'); g.addColorStop(0.5, 'rgba(255,246,230,.7)'); g.addColorStop(1, 'rgba(255,246,230,.9)'); fx.fillStyle = g; fx.fillRect(0, H * 0.5, W, H * 0.5); }
  }

  function drawBench(tn, dt) {
    var c = fx, d = game ? game.cur : null, i, tg = game ? tn - T0 - (fake != null ? 0 : 24) : 0;
    var drilling = st === 'PLAY' && game.phase === 'drill', x = drilling ? game.depth(tg) : 0, gear = game ? game.gear() : 1;
    // 回転と重さ
    var skin = d ? K.SKIN[d.skin] : K.SKIN.normal, loadK = drilling ? clamp(x / 0.03, 0, 1) : 0;
    var rpmT = drilling ? clamp((tg - game.t0) / K.SPIN_MS, 0, 1) : 0;
    drill.rpm = rpmT > drill.rpm ? rpmT : Math.max(rpmT, drill.rpm - dt / 0.16);
    drill.rot += dt * drill.rpm * 46 * (drilling ? game.g0 : gear) * (1 - 0.55 * loadK);
    drillSound(drill.rpm, loadK, drilling ? game.g0 : gear);
    if (drilling) {
      if (x >= 0 && !contactSeen) { contactSeen = true; var p0 = screwPos(d, d.i); puff(BX + p0.x, BY + p0.y, 3, 90); }
      if (tn - hapT > (x >= 0 ? 60 : 110)) { hapT = tn; haptic(x >= 0 ? 'load' : 'spin'); }
      sq.t = 1 - clamp(x, 0, 0.2) * 0.5;
    } else if (!d || d.result !== 'torn') sq.t = 1;
    sq.step(dt);
    // バットの上
    for (i = 0; i < tray.length; i++) if (tray[i].shown) { var s = traySlot(i); c.drawImage(tray[i].cv, s.x - 100, s.y - 106, 200, 130); }
    // 机の しみ
    for (i = 0; i < stains.length; i++) { c.fillStyle = stains[i].col; c.globalAlpha = 0.8; c.beginPath(); c.ellipse(stains[i].x, stains[i].y, stains[i].r, stains[i].r * 0.6, 0, 0, 7); c.fill(); c.globalAlpha = 1; }
    // 出ていく餃子
    for (i = leaving.length - 1; i >= 0; i--) {
      var lv = leaving[i], k = (tn - lv.t0) / lv.dur;
      if (k >= 1) { if (lv.kind === 'tray') { tray[lv.i].shown = true; play('plate'); haptic('plate'); } leaving.splice(i, 1); continue; }
      if (lv.kind === 'tray') { var e = ease(Math.max(0, k)), sc = lerp(1, 0.25, e); c.save(); c.translate(lerp(BX, lv.slot.x, e), lerp(BY, lv.slot.y + 44, e)); c.scale(sc, sc); shadowUnder(c, 1 - e * 0.5); drawDumplingAt(c, lv.d, vis[lv.d.id], -1); c.restore(); }
      else { var e2 = Math.max(0, k); e2 = e2 * e2; c.save(); c.globalAlpha = 1 - e2; c.translate(BX + e2 * 900 + (k < 0 ? Math.sin(tn / 18) * 7 * clamp(-k * 2, 0, 1) : 0), BY + e2 * 80); c.scale(1, sq.x); shadowUnder(c, 1); drawDumplingAt(c, lv.d, vis[lv.d.id], -1); c.restore(); }
    }
    // いまの餃子
    var showCur = d && d.result == null && (st === 'PLAY' || st === 'TITLE' || st === 'OUT' || st === 'WAIT' || st === 'RESULT');
    var inK = 1, hx = BX, hy = BY - 420, sp = null;
    if (showCur) {
      var v = vis[d.id] || (vis[d.id] = { inT: tn - 1000 }); inK = ease((tn - (v.inT || 0)) / 300);
      c.save(); c.translate(BX - (1 - inK) * 1000, BY); shadowUnder(c, 1); c.scale(1 + (1 - sq.x) * 0.35, sq.x);
      drawDumplingAt(c, d, v, drilling ? d.i : -1);
      sp = screwPos(d, Math.min(d.i, d.screws.length - 1));
      if (drilling) drawScrew(c, sp.x, sp.y, -x * PXU, drill.rot, 0);
      c.restore();
      var cs = d.screws[Math.min(d.i, d.screws.length - 1)], hh = drilling ? -x * PXU : hgtOf(cs);
      hx = BX + sp.x * (1 + (1 - sq.x) * 0.35) - (1 - inK) * 1000 * 0; hy = BY + (sp.y - hh) * sq.x - 12;
    }
    // ドリル
    drill.lift.t = drilling ? 0 : 46; drill.lift.step(dt); drill.gearK.step(dt);
    drill.x.t = hx; drill.y.t = hy; drill.x.step(dt); drill.y.step(dt);
    if (drilling) drill.y.x = hy;                    // 回している間は ネジの頭に ぴったり
    var jx = drill.rpm * (Math.sin(tn / 9) * 1.6 + Math.sin(tn / 3.7) * 0.9) * (1 + loadK), jy = drill.rpm * Math.sin(tn / 5.3) * 1.2 * (1 + loadK * 1.5);
    var dx = drill.x.x + jx, dy = drill.y.x - Math.max(0, drill.lift.x) + jy - drill.away * (H + 400);
    if (game || st === 'TITLE') drawDrill(c, dx, dy, tn);
    // 粒
    for (i = parts.length - 1; i >= 0; i--) {
      var p = parts[i], a = (tn - p.t0) / p.life; if (a >= 1) { if (p.k === 'bit' && stains.length < 60) stains.push({ x: p.x, y: p.y, r: p.r, col: p.col }); parts.splice(i, 1); continue; }
      if (p.k === 'flour') { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; var rr2 = p.r * (1 + a * 1.6), g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr2); g.addColorStop(0, 'rgba(255,253,246,' + 0.5 * (1 - a) + ')'); g.addColorStop(1, 'rgba(255,253,246,0)'); c.fillStyle = g; c.fillRect(p.x - rr2, p.y - rr2, rr2 * 2, rr2 * 2); }
      else { p.vy += 2400 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > p.fy && p.vy > 0) { p.y = p.fy; p.vx *= 0.8; p.vy = 0; } c.fillStyle = p.col; c.beginPath(); c.ellipse(p.x, p.y, p.r, p.r * 0.55, p.r * 1.7, 0, 7); c.fill(); c.fillStyle = 'rgba(60,30,10,.18)'; c.beginPath(); c.ellipse(p.x + 1, p.y + p.r * 0.2, p.r * 0.8, p.r * 0.3, p.r * 1.7, 0, 7); c.fill(); }
    }
    drawPops(c, tn);
    if (st === 'PLAY' || st === 'WAIT' || st === 'OUT') drawHud(c, tn);
  }
  function shadowUnder(c, k) { var g = c.createRadialGradient(0, 30, 60, 0, 30, 430); g.addColorStop(0, 'rgba(30,16,4,' + 0.5 * k + ')'); g.addColorStop(1, 'rgba(30,16,4,0)'); c.save(); c.translate(12, 20); c.scale(1, 0.32); c.fillStyle = g; c.beginPath(); c.arc(0, 30, 430, 0, 7); c.fill(); c.restore(); }
  function drawDrill(c, x, y, tn) {
    c.save(); c.translate(x, y);
    // 腕(白い調理服の そで。代役)= 手首から 右上へ 画面の外まで
    var ang = Math.atan2(HA.by - HA.ay, HA.bx - HA.ax), wx = HA.ax + Math.cos(ang) * 300 + Math.sin(ang) * 70, wy = HA.ay + Math.sin(ang) * 300 - Math.cos(ang) * 70;
    c.save(); c.translate(wx, wy); c.rotate(-0.5);
    var g = c.createLinearGradient(0, -86, 0, 86); g.addColorStop(0, '#fdfcf8'); g.addColorStop(0.45, '#ebe8e0'); g.addColorStop(1, '#a9a498');
    c.fillStyle = g; c.shadowColor = 'rgba(20,12,4,.4)'; c.shadowBlur = 30; c.shadowOffsetY = 16; c.fillRect(40, -86, 2600, 172); c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
    g = c.createLinearGradient(0, -70, 0, 70); g.addColorStop(0, '#f1ede2'); g.addColorStop(1, '#b3ac9a'); c.fillStyle = g; rr(c, -30, -72, 110, 144, 18); c.fill();     // 軍手の口
    c.strokeStyle = 'rgba(120,108,84,.4)'; c.lineWidth = 3; for (var i = -14; i < 72; i += 12) { c.beginPath(); c.moveTo(i, -66); c.lineTo(i, 66); c.stroke(); }
    c.restore();
    c.shadowColor = 'rgba(20,12,4,.35)'; c.shadowBlur = 26; c.shadowOffsetY = 14; c.shadowOffsetX = 8;
    c.drawImage(spr.drill, -DRO.ox, -DRO.oy, DRO.w, DRO.h);
    c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0; c.shadowOffsetX = 0;
    // 回っているチャックの筋
    if (drill.rpm > 0.02) { c.save(); c.beginPath(); c.moveTo(-54, -194); c.lineTo(54, -194); c.lineTo(30, -82); c.lineTo(-30, -82); c.closePath(); c.clip(); c.globalAlpha = 0.3 + 0.3 * drill.rpm;
      for (var k = 0; k < 5; k++) { var px = Math.cos(drill.rot * 0.9 + k * 1.2566) * 50; c.fillStyle = k % 2 ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.4)'; c.fillRect(px - 4, -200, 8, 130); } c.restore(); }
    else { c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = 3; for (var j = -2; j <= 2; j++) { c.beginPath(); c.moveTo(j * 19, -190); c.lineTo(j * 11, -86); c.stroke(); } }
    // ギアのつまみ(LO = 下 / HI = 上)
    var gy = lerp(-492, -540, clamp(drill.gearK.x, 0, 1)); c.fillStyle = '#d8d5cd'; rr(c, -52, gy, 22, 34, 6); c.fill(); c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(-50, gy + 15, 18, 3);
    c.restore();
  }
  function drawPops(c, tn) {
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.lineJoin = 'round';
    for (var i = pops.length - 1; i >= 0; i--) { var p = pops[i], a = (tn - p.t0) / 800; if (a >= 1) { pops.splice(i, 1); continue; }
      var e = ease(a * 2.2), yy = p.y - 46 * e; c.globalAlpha = a < 0.7 ? 1 : 1 - (a - 0.7) / 0.3; c.font = '72px ' + FONT; c.lineWidth = 14; c.strokeStyle = PAPER; c.strokeText(p.text, clamp(p.x, 150, W - 150), yy); c.fillStyle = p.col; c.fillText(p.text, clamp(p.x, 150, W - 150), yy); }
    c.globalAlpha = 1;
  }
  function drawHud(c, tn) {
    var left = game.left(tn - T0), k = left / K.SHIFT_MS, y = Math.round(H * 0.045) + 16;
    c.fillStyle = 'rgba(36,26,18,.34)'; rr(c, 60, y, 960, 18, 9); c.fill();
    if (k > 0.004) { c.fillStyle = k < 0.2 ? RED : PAPER; rr(c, 60, y, Math.max(18, 960 * k), 18, 9); c.fill(); }
    for (var i = 0; i < K.MAX_TEARS; i++) { c.fillStyle = i < game.tears ? RED : 'rgba(36,26,18,.34)'; c.beginPath(); c.arc(1000 - i * 40, y + 52, 13, 0, 7); c.fill(); if (i < game.tears) { c.strokeStyle = PAPER; c.lineWidth = 4; c.beginPath(); c.moveTo(993 - i * 40, y + 45); c.lineTo(1007 - i * 40, y + 59); c.moveTo(1007 - i * 40, y + 45); c.lineTo(993 - i * 40, y + 59); c.stroke(); } }
  }

  // ---- 茹でる ----
  function drawBoil(tn, dt) {
    var c = fx, b = boil, t = tn - b.t0, s = 1.02, px = (W - POT.w * s) / 2, py = Math.round(H * 0.28), i;
    var wx = px + POT.cx * s, wy = py + (POT.cy + 22) * s, rx = POT.rx * s, ry = POT.ry * s;
    var g = c.createRadialGradient(0, 0, 100, 0, 0, 640); g.addColorStop(0, 'rgba(20,10,2,.6)'); g.addColorStop(1, 'rgba(20,10,2,0)');
    c.save(); c.translate(560, py + 640); c.scale(1, 0.34); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 640, 0, 7); c.fill(); c.restore();
    c.drawImage(img.pot, px, py, POT.w * s, POT.h * s);
    // 湯(代役)
    c.save(); c.beginPath(); c.ellipse(wx, wy, rx, ry, 0, 0, 7); c.clip();
    g = c.createRadialGradient(wx - 80, wy - 60, 30, wx, wy, rx); g.addColorStop(0, 'rgba(244,240,222,.95)'); g.addColorStop(1, 'rgba(206,196,160,.95)'); c.fillStyle = g; c.fillRect(wx - rx, wy - ry, rx * 2, ry * 2);
    for (i = 0; i < 46; i++) { var ph = (tn / (500 + (i * 37) % 400) + i * 0.37) % 1, bx = wx + Math.cos(i * 2.4) * rx * (0.15 + ((i * 53) % 80) / 100), by = wy + Math.sin(i * 2.4) * ry * (0.15 + ((i * 53) % 80) / 100), br = 5 + ph * (8 + (i % 5) * 3);
      c.strokeStyle = 'rgba(255,255,255,' + 0.75 * (1 - ph) + ')'; c.lineWidth = 2.5; c.beginPath(); c.arc(bx, by, br, 0, 7); c.stroke(); c.fillStyle = 'rgba(255,255,255,' + 0.18 * (1 - ph) + ')'; c.fill(); }
    g = c.createRadialGradient(wx, wy, rx * 0.7, wx, wy, rx * 1.02); g.addColorStop(0, 'rgba(90,60,30,0)'); g.addColorStop(1, 'rgba(90,60,30,.4)'); c.save(); c.translate(wx, wy); c.scale(1, ry / rx); c.translate(-wx, -wy); c.fillStyle = g; c.fillRect(wx - rx, wy - rx, rx * 2, rx * 2); c.restore();
    c.restore();
    if (t - b.bub > 130 && st === 'BOIL') { b.bub = t; play('bubble'); }
    // 餃子
    var order = b.items.slice().sort(function (a, z) { return a.y - z.y; }), sc = b.items.length > 12 ? 0.82 : 1;
    for (i = 0; i < order.length; i++) {
      var it = order[i], k = (t - it.drop) / 330; if (k < 0) continue;
      var ix = wx + it.x * rx, iy = wy + it.y * ry, bob = Math.sin(tn / 300 + it.ph) * 4, fall = k < 1 ? (1 - k * k) * -(iy + 200) : 0;
      if (k >= 1 && !it.landed) { it.landed = true; play('plop'); haptic('plop'); it.landT = t; }
      var opened = it.open && it.landed && t - it.landT > 620;
      if (it.landed && !it.judged && t - it.landT > 620) { it.judged = true; if (it.open) { b.opened++; play('open'); haptic('open'); pop(T('ぱかっ', 'Pop!'), ix, iy - 60, RED); } else { b.shut++; play('stay'); } }
      if (it.landed) { var rk = clamp((t - it.landT) / 500, 0, 1); c.strokeStyle = 'rgba(255,255,255,' + 0.7 * (1 - rk) + ')'; c.lineWidth = 4; c.beginPath(); c.ellipse(ix, iy + 10, 60 + rk * 70, (60 + rk * 70) * 0.5, 0, 0, 7); c.stroke(); }
      c.save(); c.translate(ix, iy + bob + fall); c.scale(sc, sc);
      if (opened) { var ok2 = ease((t - it.landT - 620) / 220), os = lerp(0.9, 1, ok2); c.scale(os, os); c.rotate(it.ph); c.drawImage(spr.open, -112, -82, 224, 164); }
      else { c.rotate(Math.sin(it.ph * 3) * 0.5); c.drawImage(it.cv, -96, -84, 192, 125); }
      c.restore();
    }
    // 湯気
    for (i = 0; i < 7; i++) { var sp = ((tn / 2600 + i / 7) % 1), sxp = wx + Math.sin(i * 1.9 + tn / 1700) * rx * 0.6, syp = wy - 40 - sp * 560, sr = 110 + sp * 150;
      g = c.createRadialGradient(sxp, syp, 0, sxp, syp, sr); g.addColorStop(0, 'rgba(255,255,255,' + 0.2 * Math.sin(sp * Math.PI) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(sxp - sr, syp - sr, sr * 2, sr * 2); }
    drawPops(c, tn);
    if (st === 'BOIL') {                              // 数え上げ
      c.textAlign = 'center'; c.lineJoin = 'round'; c.font = '54px ' + FONT; c.lineWidth = 12; c.strokeStyle = PAPER; var yy = py - 150, lab = T('開かなかった', 'Stayed shut');
      c.strokeText(lab, 540, yy - 150); c.fillStyle = INK; c.fillText(lab, 540, yy - 150);
      c.font = '170px ' + FONT; c.lineWidth = 18; var num = String(b.shut + (t > 600 ? b.extraShut : 0)); c.strokeText(num, 540, yy); c.fillStyle = RED; c.fillText(num, 540, yy);
    }
  }

  // ---- 起動 ----
  function loop() { frame(now()); requestAnimationFrame(loop); }
  window.addEventListener('resize', layout);
  Promise.all([load('table', 'assets/table.webp'), load('pot', 'assets/pot.webp'), document.fonts ? document.fonts.load('40px "YujiBoku"', '餃子とドリル').catch(function () {}) : null, document.fonts ? document.fonts.load('40px "GZNum"', '0123').catch(function () {}) : null]).then(function () {
    spr.dough = makeDumpling(false); spr.thin = makeDumpling(true); spr.open = makeOpen(); spr.drill = makeDrill();
    ready = true; layout();
    game = new G.Game(1); vis[0] = { inT: -1000 }; st = 'TITLE'; lastT = now();
    titleEl.querySelector('h1').innerHTML = T('餃子と<br>ドリル', 'Dumplings<br>&amp; Drill'); if (!JA) titleEl.classList.add('en');
    titleEl.querySelector('p').textContent = T('茹でても開かないように ネジで閉める', 'Screw them shut so they survive the pot');
    $('b-in').textContent = T('出勤する', 'Clock in');
    drawBg(); requestAnimationFrame(loop);
  });

  // 検査用の のぞき窓
  window.__gz = {
    get state() { return st; }, get game() { return game; }, get T0() { return T0; }, get endKind() { return endKind; }, get boil() { return boil; },
    get audio() { return AC ? { state: AC.state, rate: AC.sampleRate } : null; }, get drillSnd() { return drillSnd; },
    soundLog: soundLog, hapticLog: hapticLog, clockIn: clockIn, press: function () { press(now()); }, release: function () { release(now()); },
    setFake: function (t) { fake = t; lastT = t == null ? performance.now() : t; }, get fake() { return fake; },
    step: function (ms, each) { each = each || 16; for (var e = 0; e < ms - 1e-6; e += each) { fake += Math.min(each, ms - e); frame(fake); } },
    peak: function () { if (!analyser) return 0; var d = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(d); var m = 0; for (var i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); return m; },
    loud: function () { if (!analyser) return null; var d = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(d); var bi = 0; for (var i = 1; i < d.length; i++) if (d[i] > d[bi]) bi = i; return { hz: Math.round(bi * AC.sampleRate / analyser.fftSize), level: d[bi] }; }
  };
})();
