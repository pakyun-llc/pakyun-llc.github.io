// 餃子とドリル: 画面・さわり心地・音・ふるえ・進行。遊びの式は game.js。
// 絵は 生成写真(v2: 素手で持った餃子 3 種・座金つきネジ・素手のドリル・明るい机 + 皿・カセットコンロの鍋。皿と鍋の小さい餃子は v1 の真上からの絵)。
// コードで描いているのは くぼみの影・粉・飛ぶ具・泡・湯気・回転の筋・腕の延長だけ。
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
    var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), cBg = $('bg'), cFx = $('fx');
  var bg = cBg.getContext('2d'), fx = cFx.getContext('2d');
  var img = {}, ready = false;
  var INK = '#241a12', PAPER = '#fff6e6', RED = '#b5281c';
  var FONT = '"YujiBoku","GZNum","Hiragino Mincho ProN","Yu Mincho",serif';

  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var cw = Math.min(vw, vh * 0.5), chh = vh;             // 横長の画面では 縦の柱にする(スマホと同じ縦横比。低いと 題字とドリルが重なる)
    H = Math.max(2000, Math.min(2500, Math.round(W * chh / cw)));
    U = cw / W; DPR = Math.min(window.devicePixelRatio || 1, 3);
    stage.style.width = cw + 'px'; stage.style.height = chh + 'px';
    stage.style.setProperty('--u', U + 'px');
    [cBg, cFx].forEach(function (c) { c.width = Math.round(cw * DPR); c.height = Math.round(chh * DPR); });
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

  // ================= 絵(写真。tools/make_assets.py が out/gen の生成写真から作る)=================
  // v2: 寄りのスマホ撮りの構図。左下から 素手が餃子を持ち、右上から ドリルが斜めに来る。位置は 絵の中の座標(build/meta.json と 目で測った値)
  var HS = 0.8, HND = { w: 1500, h: 1150, x0: -180 };                          // 餃子を持つ手(絵の下の辺 = 画面の下)。とじ目の帯の真ん中 = y = 50 + 0.00083 (x − 950)²
  var SC = 0.29, SCR = { w: 220, h: 661, headH: 101 };                         // ネジ(座金つき頭)
  var DS = 0.7, DRL = { w: 1200, h: 1074, tipx: 1, tipy: 976, ax: 0.554, ay: -0.8325 };   // ドリル + 右手。ビットの先と 向き
  var TH = Math.atan2(DRL.ax, -DRL.ay);                                        // ネジ・ドリルの傾き(まっすぐ上から 右へ 33.6 度)
  var BGI = { w: 1188, h: 2112 };
  var POTW = { cx: 578, cy: 1085, rx: 395, ry: 158 };                          // 鍋の絵の 湯の面
  function rnd(seed) { return G.rng(seed); }
  function bake(im, sc, blur, oy) {                 // 影つきで 先に焼いておく(毎コマ影を計算しない)
    var pad = 60, cv = mk(im.width * sc + pad * 2, im.height * sc + pad * 2), c = cv.getContext('2d');
    c.shadowColor = 'rgba(60,36,10,.42)'; c.shadowBlur = blur; c.shadowOffsetY = oy; c.shadowOffsetX = -oy * 0.4; c.drawImage(im, pad, pad, im.width * sc, im.height * sc); cv.pad = pad; return cv;
  }
  // ネジ 1 本(軸は まっすぐ上向きで描く。呼ぶ側が TH だけ回す)。(0, 0) = 皮に入る点、hgt = 頭の下の面が皮から浮いている高さ(マイナス = 沈んでいる)、spin = 回っている強さ
  function drawScrew(c, hgt, rot, spin) {
    var S = img.screw, hw = SCR.w * SC, hh = SCR.headH * SC, sink = Math.max(0, -hgt), yh = -hgt;
    if (sink > 0) {                                   // くぼみ(頭のまわりの皮が沈む)
      var kk = clamp(sink / 12, 0, 1), rx = 40 + sink * 2, cy = sink * 0.4;
      var g = c.createRadialGradient(0, cy, 10, 0, cy, rx); g.addColorStop(0, 'rgba(96,74,44,' + 0.7 * kk + ')'); g.addColorStop(0.6, 'rgba(120,96,60,' + 0.3 * kk + ')'); g.addColorStop(1, 'rgba(120,96,60,0)');
      c.save(); c.translate(0, cy); c.scale(1, 0.55); c.fillStyle = g; c.beginPath(); c.arc(0, 0, rx, 0, 7); c.fill(); c.restore();
    } else { c.fillStyle = 'rgba(80,58,30,.4)'; c.beginPath(); c.ellipse(0, 1, 16, 7, 0, 0, 7); c.fill(); }
    if (hgt > 1) {                                    // 軸(下は皮の中 = 絵の上から 要る長さだけ使う)
      c.drawImage(S, 0, SCR.headH, SCR.w, hgt / SC, -hw / 2, yh, hw, hgt + 1);
      if (spin > 0.05) { c.save(); c.beginPath(); c.rect(-12, yh, 24, hgt); c.clip(); for (var k = 0; k < 2; k++) { var bx = Math.sin(rot * 0.8 + k * 3.14) * 11; c.fillStyle = 'rgba(255,255,255,' + 0.32 * spin + ')'; c.fillRect(bx - 2.5, yh, 5, hgt); } c.restore(); }
    }
    var show = clamp(1 - sink / (hh * 2.2), 0.6, 1);  // 沈むと 頭の下がわが 皮に隠れる
    c.drawImage(S, 0, 0, SCR.w, SCR.headH * show, -hw / 2, yh - hh, hw, hh * show);
    if (spin > 0.05) {                                // 回っている間は 十字が ぶれて見えない
      var ty = yh - hh + 9; c.fillStyle = 'rgba(206,210,214,' + 0.75 * spin + ')'; c.beginPath(); c.ellipse(0, ty, 16, 6, 0, 0, 7); c.fill();
      c.save(); c.translate(0, ty); c.scale(1, 0.36); c.rotate(rot); c.strokeStyle = 'rgba(255,255,255,' + 0.6 * spin + ')'; c.lineWidth = 4; c.beginPath(); c.moveTo(-15, 0); c.lineTo(15, 0); c.stroke(); c.restore();
    }
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // ネジを打つ点(手の絵の左上からの位置。とじ目の帯の真ん中に 左から並ぶ)
  function screwPos(d, i) { var n = d.screws.length, ix = n === 1 ? 950 : lerp(690, 1300, i / (n - 1)); return { x: ix * HS, y: (50 + 0.00083 * (ix - 950) * (ix - 950) + 6) * HS }; }
  function hgtOf(s) { return -s.x * PXU; }           // x(単位)→ 頭の高さ(px)
  // 皿・鍋に置く 小さい餃子(真上から撮った v1 の絵 + ネジの頭)。ゆるいネジは 少し浮かせる
  function snapshot(d) {
    var cv = mk(300, 200), c = cv.getContext('2d'), n = d.screws.length, i; c.translate(150, 185);
    c.drawImage(img.dumpling, -130, -144, 260, 144);
    for (i = 0; i < n; i++) { var a = Math.PI * (n === 1 ? 0.5 : lerp(0.8, 0.2, i / (n - 1))), x = 116 * Math.cos(a), y = -128 * Math.sin(a) + 8, up = d.screws[i].grade === 'loose' ? 9 : 0;
      c.fillStyle = 'rgba(70,50,26,.4)'; c.beginPath(); c.ellipse(x, y + 2, 13, 5, 0, 0, 7); c.fill();
      if (up) c.drawImage(img.screw, 0, SCR.headH, SCR.w, 60, x - 5, y - up, 10, up);
      c.drawImage(img.screw, 0, 0, SCR.w, SCR.headH, x - 12, y - up - 9, 24, 11); }
    return cv;
  }

  // ================= 状態 =================
  var st = 'LOAD';                 // TITLE → PLAY → OUT(クビ・放置)/ BOIL(茹でる)→ RESULT
  var game = null, T0 = 0, endKind = null, endT = 0, runs = 0, seed = 1;
  var vis = {};                    // 餃子 id → 見た目の付けたし { rot/tilt のネジごと, inT, sq }
  var drill = { x: new Spring(1500, 70, 900), y: new Spring(1700, 76, 0), rpm: 0, rot: 0, lift: new Spring(300, 26, 0), gearK: new Spring(500, 30, 0), away: 0 };
  var sq = new Spring(520, 13, 1), shakeT = -1e9, handA = new Spring(230, 27, 0), goT = 0, spr = {};
  var parts = [], pops = [], leaving = [], stains = [], tray = [], boil = null;
  var hintEl = $('hint'), titleEl = $('title'), resEl = $('result'), bossEl = $('boss'), startEl = $('start');
  var bossT = 0, hapT = 0, lastT = 0, contactSeen = false, pressedAt = -1e9;

  function drawBg() {                                // 机 + 皿(写真)/ 茹でる所は 同じ机に カセットコンロと鍋
    sx(bg); var boilBg = st === 'BOIL' || (st === 'RESULT' && boil), s = H / BGI.h;
    bg.drawImage(boilBg ? img.pot : img.table, boilBg ? 540 - POTW.cx * s : 0, 0, BGI.w * s, H);
  }
  function traySlot(i) {                             // 皿の上(手に隠れない 上がわ)に 4 コずつ
    var col = i % 4, row = Math.floor(i / 4), r3 = Math.min(row, 3);
    return { x: 240 + col * 172 + (r3 % 2) * 70 + (row > 3 ? (row - 3) * 14 : 0), y: H * (0.44 + r3 * 0.05), rot: Math.sin(i * 7.3) * 0.35 };
  }

  function say(text, ms) { bossEl.textContent = text; bossEl.classList.add('on'); bossT = now() + (ms || 2200); }
  function pop(text, x, y, col) { pops.push({ text: text, x: x, y: y, t0: now(), col: col || INK }); }
  function puff(x, y, n, sp) { for (var i = 0; i < n; i++) { var a = Math.random() * 6.283, v = sp * (0.3 + Math.random()); parts.push({ k: 'flour', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5 - 20, r: 8 + Math.random() * 16, t0: now(), life: 420 + Math.random() * 300 }); } }
  function burst(x, y) {
    for (var i = 0; i < 26; i++) { var a = Math.random() * 6.283, v = 250 + Math.random() * 700, c = Math.random(); parts.push({ k: 'bit', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 260, r: 5 + Math.random() * 10, col: c < 0.5 ? '#b98f78' : c < 0.72 ? '#7f9c4e' : '#e3d3bf', t0: now(), life: 500 + Math.random() * 400, fy: y + 30 + Math.random() * 260 }); }
  }

  // ---- 遊びの出来事 → 絵・音・ふるえ ----
  function handAt() { var a = handA.x, push = (1 - sq.x) * 150; return { x: HND.x0 - a * 560 - push * DRL.ax, y: H - HND.h * HS + a * 980 - push * DRL.ay }; }
  function handle(evs) {
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i], d = game.cur, p;
      if (e.type === 'start') { play('click'); contactSeen = false; hintEl.classList.remove('on'); if (game.pulls === 1) titleEl.classList.add('off'); }
      else if (e.type === 'judge') {
        var dd = e.grade === 'tear' || !d || d.id !== e.d ? findD(e.d) : d, ho = handAt(); p = screwPos(dd, e.screw); var wx = ho.x + p.x, wy = ho.y + p.y;
        var v = (vis[dd.id] = vis[dd.id] || {}); v[e.screw] = { rot: drill.rot, tilt: (Math.random() - 0.5) * 0.22 };
        if (e.grade === 'perfect') { play('perfect'); haptic('perfect'); pop(T('ぴたっ', 'Flush!'), wx, wy - 90, RED); sq.v -= 1.6; puff(wx, wy, 5, 120); }
        else if (e.grade === 'ok') { play('ok'); haptic('ok'); pop(T('よし', 'OK'), wx, wy - 90); sq.v -= 0.9; }
        else if (e.grade === 'loose') { play('loose'); haptic('loose'); pop(T('ゆるい', 'Loose'), wx, wy - 90 - hgtOf(dd.screws[e.screw])); }
        else { play('tear'); haptic('tear'); pop(T('やぶれた', 'Torn!'), 560, wy - 150, RED); burst(560, wy + 60); shakeT = now(); sq.v -= 2; say(T('「具が出てる！」', '"The filling!"'), 1300); }
        drill.lift.x = e.grade === 'tear' ? 90 : 40;
      } else if (e.type === 'dumpling') {
        goT = now() + (e.result === 'torn' ? 480 : 40);            // 手が 皿のほうへ下がる(破れたら 少し見せてから)
        if (e.result !== 'torn') { tray.push({ cv: snapshot(e.d), shown: false, d: e.d }); leaving.push({ kind: 'tray', t0: now() + 260, dur: 1, i: tray.length - 1 }); play('slide'); }
      } else if (e.type === 'spawn') { vis[e.d.id] = { inT: now() }; sq.t = 1; }
      else if (e.type === 'stage') {
        play('boss');
        if (e.stage === 1) say(T('「お湯わいてきた！ ネジは 4 本」', '"Water\'s nearly boiling! Four screws each!"'));
        else { say(T('「おなかすいた！ ハイにして」', '"We\'re starving! Switch it to HI!"')); play('gear'); haptic('gear'); drill.gearK.t = 1; }
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
    play('boss'); say(T('「お父さんのは 茹でたら開くやん」', '"Dad\'s always pop open in the pot."'), 3000);
  }
  function finish(kind) {
    endKind = kind; endT = now(); hintEl.classList.remove('on'); drillSound(0, 0, 1);
    if (kind === 'fired') { st = 'OUT'; play('boss'); say(T('「ドリル没収」', '"Hand over the drill."'), 1500); haptic('bad'); }
    else if (kind === 'idle') { st = 'OUT'; }
    else if (!game.done.length) { st = 'OUT'; }
    else { st = 'WAIT'; say(T('「お湯わいた。入れるで」', '"It\'s boiling. In they go."'), 1500); }
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
  var RANKS = [['ネジ締めの神', 'Screw God', '「来年も お父さんが包んで」', '"You\'re wrapping next year too."'], ['餃子大工', 'Dumpling Carpenter', '「やるやん」', '"Not bad."'],
    ['日曜大工', 'Weekend Carpenter', '「まあ 食べられる」', '"Edible, I guess."'], ['ふつうの父', 'Regular Dad', '「ぎりぎりやな」', '"Barely."']];
  var shareText = '';
  function showResult() {
    st = 'RESULT'; var k = endKind, c = game.closed, big = $('r-big'), rk = $('r-rank'); big.className = ''; rk.className = '';
    var stat = T('分速 ' + game.perMin() + ' コ　ぴたっ ' + game.flush() + '%　開いた ' + game.opened + ' コ', game.perMin() + ' per min   flush ' + game.flush() + '%   opened ' + game.opened);
    if (k === 'clear') {
      var r = RANKS[G.rank(c)]; $('r-label').textContent = T('茹でても 開かなかった', 'Stayed shut in the pot'); big.innerHTML = c + (JA ? '<small>コ</small>' : '');
      rk.textContent = T(r[0], r[1]); $('r-line').textContent = T(r[2], r[3]); $('r-stat').textContent = stat; play('clear'); haptic('clear');
      shareText = T('餃子とドリル: 茹でても開かなかった餃子 ' + c + ' コ。肩書きは「' + r[0] + '」', 'Dumplings & Drill: ' + c + ' dumplings stayed shut. Title: ' + r[1]);
    } else {
      var L = { soup: [T('ほとんど 開いた', 'Most of them opened'), T('具スープ', 'Filling soup'), T('「これ スープやん」', '"That\'s soup."')],
        slow: [T('茹でても 開かなかった', 'Stayed shut in the pot'), c + (JA ? '<small>コ</small>' : ''), T('「もう 先に食べたで」', '"We already ate."')],
        fired: [T('3 コ 破いた', 'Tore three dumplings'), T('没収', 'Confiscated'), T('「具が もったいない」', '"Waste of good filling."')],
        idle: [T('ドリルを持って 立っていた', 'Stood there holding a drill'), '…', T('「…何してんの」', '"...What are you doing?"')] }[k];
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
    if (st === 'OUT') { drill.away = Math.pow(clamp((tn - endT - (endKind === 'fired' ? 500 : 0)) / 600, 0, 1), 2); if (tn - endT > 1900) showResult(); }
    if (st === 'BOIL' && tn - boil.t0 > boil.end) showResult();
    sx(fx); fx.clearRect(0, 0, W, H);
    if (st === 'BOIL' || (st === 'RESULT' && boil)) drawBoil(tn, dt); else drawBench(tn, dt);
    if (st === 'RESULT') { var g = fx.createLinearGradient(0, H * 0.5, 0, H); g.addColorStop(0, 'rgba(255,246,230,0)'); g.addColorStop(0.4, 'rgba(255,246,230,.82)'); g.addColorStop(1, 'rgba(255,246,230,.94)'); fx.fillStyle = g; fx.fillRect(0, H * 0.5, W, H * 0.5); }
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
    var ho = handAt(), showD = d && (st !== 'TITLE' || true), sp, P;
    if (drilling) {
      if (x >= 0 && !contactSeen) { contactSeen = true; var p0 = screwPos(d, d.i); puff(ho.x + p0.x, ho.y + p0.y, 3, 90); }
      if (tn - hapT > (x >= 0 ? 60 : 110)) { hapT = tn; haptic(x >= 0 ? 'load' : 'spin'); }
      sq.t = 1 - clamp(x, 0, 0.2) * 0.5;
    } else sq.t = 1;
    sq.step(dt);
    handA.t = (st === 'PLAY' || st === 'WAIT') && d && d.result != null && tn >= goT ? 1 : (st === 'OUT' && endKind === 'fired' ? 1 : 0); handA.step(dt); ho = handAt();
    // 皿の上の 打ち終わった餃子(斜めから見ている皿なので 縦をつぶす)
    for (i = 0; i < tray.length; i++) if (tray[i].shown) { var s = traySlot(i); c.save(); c.translate(s.x, s.y); c.scale(1, 0.7); c.rotate(s.rot);
      var sg = c.createRadialGradient(0, 0, 60, 0, 0, 132); sg.addColorStop(0, 'rgba(70,56,36,.34)'); sg.addColorStop(1, 'rgba(70,56,36,0)'); c.save(); c.translate(8, 2); c.scale(1, 0.6); c.fillStyle = sg; c.beginPath(); c.arc(0, 0, 132, 0, 7); c.fill(); c.restore();
      c.drawImage(tray[i].cv, -126, -132, 252, 168); c.restore(); }
    for (i = leaving.length - 1; i >= 0; i--) { var lv = leaving[i]; if (tn - lv.t0 >= lv.dur) { tray[lv.i].shown = true; play('plate'); haptic('plate'); leaving.splice(i, 1); } }
    // 机に落ちた具
    for (i = 0; i < stains.length; i++) { c.fillStyle = stains[i].col; c.globalAlpha = 0.85; c.beginPath(); c.ellipse(stains[i].x, stains[i].y, stains[i].r, stains[i].r * 0.6, 0, 0, 7); c.fill(); c.globalAlpha = 1; }
    // 餃子を持つ手
    var hx = 900, hy = H * 0.5;
    if (d) {
      var torn = d.result === 'torn', hc = spr[torn ? 'hand_torn' : d.skin === 'thin' ? 'hand_thin' : 'hand'];
      c.drawImage(hc, ho.x - hc.pad, ho.y - hc.pad);
      var cur = Math.min(d.i, d.screws.length - 1);
      if (!torn) for (i = 0; i < d.screws.length; i++) {
        var scw = d.screws[i], q = screwPos(d, i), v = vis[d.id] && vis[d.id][i], on = drilling && i === d.i;
        c.save(); c.translate(ho.x + q.x, ho.y + q.y); c.rotate(TH + (scw.grade === 'loose' && v ? v.tilt : 0));
        drawScrew(c, on ? -x * PXU : hgtOf(scw), on ? drill.rot : (v ? v.rot : i * 1.3), on ? drill.rpm : 0); c.restore();
      }
      sp = screwPos(d, cur); var hh2 = (drilling ? -x * PXU : hgtOf(d.screws[cur])) + SCR.headH * SC + 5;
      hx = ho.x + sp.x + DRL.ax * hh2; hy = ho.y + sp.y + DRL.ay * hh2;
      if (torn || d.result != null) { hx = 860; hy = H * 0.5; }
    }
    // ドリル(回していない間は ネジの頭から 少し離して構える)
    drill.lift.t = drilling ? 0 : 50; drill.lift.step(dt); drill.gearK.step(dt);
    drill.x.t = hx; drill.y.t = hy; drill.x.step(dt); drill.y.step(dt);
    if (drilling) { drill.x.x = hx; drill.y.x = hy; }  // 回している間は ネジの頭に ぴったり
    var jx = drill.rpm * (Math.sin(tn / 9) * 1.6 + Math.sin(tn / 3.7) * 0.9) * (1 + loadK), jy = drill.rpm * Math.sin(tn / 5.3) * 1.2 * (1 + loadK * 1.5), lf = Math.max(0, drill.lift.x);
    var away = st === 'OUT' ? drill.away : 0;
    if (game || st === 'TITLE') drawDrill(c, drill.x.x + jx + DRL.ax * lf + away * 1500, drill.y.x + jy + DRL.ay * lf - away * 1700, tn);
    // 粒
    for (i = parts.length - 1; i >= 0; i--) {
      var p = parts[i], a = (tn - p.t0) / p.life; if (a >= 1) { if (p.k === 'bit' && stains.length < 60) stains.push({ x: p.x, y: p.y, r: p.r, col: p.col }); parts.splice(i, 1); continue; }
      if (p.k === 'flour') { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; var rr2 = p.r * (1 + a * 1.6), g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr2); g.addColorStop(0, 'rgba(255,253,246,' + 0.5 * (1 - a) + ')'); g.addColorStop(1, 'rgba(255,253,246,0)'); c.fillStyle = g; c.fillRect(p.x - rr2, p.y - rr2, rr2 * 2, rr2 * 2); }
      else { p.vy += 2400 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > p.fy && p.vy > 0) { p.y = p.fy; p.vx *= 0.8; p.vy = 0; } c.fillStyle = p.col; c.beginPath(); c.ellipse(p.x, p.y, p.r, p.r * 0.55, p.r * 1.7, 0, 7); c.fill(); c.fillStyle = 'rgba(60,30,10,.18)'; c.beginPath(); c.ellipse(p.x + 1, p.y + p.r * 0.2, p.r * 0.8, p.r * 0.3, p.r * 1.7, 0, 7); c.fill(); }
    }
    drawPops(c, tn);
    if (st === 'PLAY' || st === 'WAIT' || st === 'OUT') drawHud(c, tn);
  }
  function drawDrill(c, x, y, tn) {                  // 写真 1 枚(ドリル + 右手)。ビットの先が (x, y)
    var D = spr.drill, ox = x - DRL.tipx * DS, oy = y - DRL.tipy * DS;
    // 腕は 絵の上の辺で切れているので、いちばん上の帯を 腕の向きへ引きのばして 画面の外まで続ける
    c.save(); c.translate(ox, oy + 3); c.transform(1, 0, -0.45, 1, 0, 0); c.drawImage(img.drill, 836, 3, 362, 5, 836 * DS, -2400, 362 * DS, 2401); c.restore();
    c.drawImage(D, ox - D.pad, oy - D.pad);
    if (drill.rpm > 0.02) {                          // 回っているチャックの筋(写真の上に うすく)。ビットの軸に沿った枠の中
      c.save(); c.translate(x, y); c.rotate(TH); var y0 = -470 * DS, y1 = -200 * DS, w = 78 * DS;
      c.beginPath(); c.moveTo(-w, y0); c.lineTo(w, y0); c.lineTo(w * 0.72, y1); c.lineTo(-w * 0.72, y1); c.closePath(); c.clip(); c.globalAlpha = 0.25 + 0.3 * drill.rpm;
      for (var k = 0; k < 5; k++) { var px = Math.cos(drill.rot * 0.9 + k * 1.2566) * w; c.fillStyle = k % 2 ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.4)'; c.fillRect(px - 9, y0, 18, y1 - y0); }
      c.restore();
    }
  }
  function drawPops(c, tn) {
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.lineJoin = 'round';
    for (var i = pops.length - 1; i >= 0; i--) { var p = pops[i], a = (tn - p.t0) / 800; if (a >= 1) { pops.splice(i, 1); continue; }
      var e = ease(a * 2.2), yy = p.y - 46 * e; c.globalAlpha = a < 0.7 ? 1 : 1 - (a - 0.7) / 0.3; c.font = '72px ' + FONT; c.lineWidth = 14; c.strokeStyle = PAPER; c.strokeText(p.text, clamp(p.x, 150, W - 150), yy); c.fillStyle = p.col; c.fillText(p.text, clamp(p.x, 150, W - 150), yy); }
    c.globalAlpha = 1;
  }
  function drawHud(c, tn) {
    var left = game.left(tn - T0), k = left / K.SHIFT_MS, y = Math.round(H * 0.045) + 16;
    c.fillStyle = 'rgba(255,246,230,.7)'; rr(c, 57, y - 3, 966, 24, 12); c.fill();
    if (k > 0.004) { c.fillStyle = k < 0.2 ? RED : INK; rr(c, 60, y, Math.max(18, 960 * k), 18, 9); c.fill(); }
    for (var i = 0; i < K.MAX_TEARS; i++) { c.fillStyle = i < game.tears ? RED : 'rgba(36,26,18,.34)'; c.beginPath(); c.arc(1000 - i * 40, y + 52, 13, 0, 7); c.fill(); if (i < game.tears) { c.strokeStyle = PAPER; c.lineWidth = 4; c.beginPath(); c.moveTo(993 - i * 40, y + 45); c.lineTo(1007 - i * 40, y + 59); c.moveTo(1007 - i * 40, y + 45); c.lineTo(993 - i * 40, y + 59); c.stroke(); } }
  }

  // ---- 茹でる ----
  function drawBoil(tn, dt) {
    var c = fx, b = boil, t = tn - b.t0, s = H / BGI.h, i, g, py = Math.round(H * 0.3);
    var wx = 540, wy = POTW.cy * s, rx = POTW.rx * s, ry = POTW.ry * s;
    c.save(); c.beginPath(); c.ellipse(wx, wy, rx, ry, 0, 0, 7); c.clip();   // 泡(写真の湯の上に足す)
    for (i = 0; i < 40; i++) { var ph = (tn / (500 + (i * 37) % 400) + i * 0.37) % 1, bx = wx + Math.cos(i * 2.4) * rx * (0.15 + ((i * 53) % 80) / 100), by = wy + Math.sin(i * 2.4) * ry * (0.15 + ((i * 53) % 80) / 100), br = 4 + ph * (7 + (i % 5) * 3);
      c.strokeStyle = 'rgba(255,255,255,' + 0.7 * (1 - ph) + ')'; c.lineWidth = 2.5; c.beginPath(); c.arc(bx, by, br, 0, 7); c.stroke(); c.fillStyle = 'rgba(255,255,255,' + 0.16 * (1 - ph) + ')'; c.fill(); }
    c.restore();
    if (t - b.bub > 130 && st === 'BOIL') { b.bub = t; play('bubble'); }
    // 餃子
    var order = b.items.slice().sort(function (a, z) { return a.y - z.y; }), sc = b.items.length > 12 ? 0.74 : 0.9;
    for (i = 0; i < order.length; i++) {
      var it = order[i], k = (t - it.drop) / 330; if (k < 0) continue;
      var ix = wx + it.x * rx, iy = wy + it.y * ry, bob = Math.sin(tn / 300 + it.ph) * 4, fall = k < 1 ? (1 - k * k) * -(iy + 200) : 0;
      if (k >= 1 && !it.landed) { it.landed = true; play('plop'); haptic('plop'); it.landT = t; }
      var opened = it.open && it.landed && t - it.landT > 620;
      if (it.landed && !it.judged && t - it.landT > 620) { it.judged = true; if (it.open) { b.opened++; play('open'); haptic('open'); pop(T('ぱかっ', 'Pop!'), ix, iy - 60, RED); } else { b.shut++; play('stay'); } }
      if (it.landed) { var rk = clamp((t - it.landT) / 500, 0, 1); c.strokeStyle = 'rgba(255,255,255,' + 0.7 * (1 - rk) + ')'; c.lineWidth = 4; c.beginPath(); c.ellipse(ix, iy + 10, 60 + rk * 70, (60 + rk * 70) * 0.5, 0, 0, 7); c.stroke(); }
      if (it.landed) { c.fillStyle = 'rgba(20,30,34,.2)'; c.beginPath(); c.ellipse(ix + 6, iy + 14, 92 * sc, 44 * sc, 0, 0, 7); c.fill(); }
      c.save(); c.translate(ix, iy + bob + fall); c.scale(sc, sc);
      if (opened) { var ok2 = ease((t - it.landT - 620) / 220), os = lerp(0.9, 1, ok2); c.scale(os, os); c.rotate(it.ph); c.drawImage(img.dumpling_open, -120, -72, 240, 143); }
      else { c.rotate(Math.sin(it.ph * 3) * 0.5); c.drawImage(it.cv, -105, -110, 210, 140); }
      c.restore();
    }
    // 湯気
    for (i = 0; i < 7; i++) { var sp = ((tn / 2600 + i / 7) % 1), sxp = wx + Math.sin(i * 1.9 + tn / 1700) * rx * 0.6, syp = wy - 40 - sp * 560, sr = 110 + sp * 150;
      g = c.createRadialGradient(sxp, syp, 0, sxp, syp, sr); g.addColorStop(0, 'rgba(255,255,255,' + 0.2 * Math.sin(sp * Math.PI) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(sxp - sr, syp - sr, sr * 2, sr * 2); }
    drawPops(c, tn);
    if (st === 'BOIL') {                              // 数え上げ
      c.textAlign = 'center'; c.lineJoin = 'round'; c.font = '54px ' + FONT; c.lineWidth = 12; c.strokeStyle = PAPER; var yy = Math.round(H * 0.2), lab = T('開かなかった', 'Stayed shut');
      c.strokeText(lab, 540, yy - 160); c.fillStyle = INK; c.fillText(lab, 540, yy - 160);
      c.font = '170px ' + FONT; c.lineWidth = 18; var num = String(b.shut + (t > 600 ? b.extraShut : 0)); c.strokeText(num, 540, yy); c.fillStyle = RED; c.fillText(num, 540, yy);
    }
  }

  // ---- 起動 ----
  function loop() { frame(now()); requestAnimationFrame(loop); }
  window.addEventListener('resize', layout);
  Promise.all(['table', 'pot', 'dumpling', 'dumpling_open', 'hand', 'hand_thin', 'hand_torn', 'screw', 'drill'].map(function (n) { return load(n, 'assets/' + n + '.webp'); }).concat([ document.fonts ? document.fonts.load('40px "YujiBoku"', '餃子とドリル').catch(function () {}) : null, document.fonts ? document.fonts.load('40px "GZNum"', '0123').catch(function () {}) : null])).then(function () {
    ['hand', 'hand_thin', 'hand_torn'].forEach(function (n) { spr[n] = bake(img[n], HS, 34, 30); }); spr.drill = bake(img.drill, DS, 30, 34);
    ready = true; layout();
    game = new G.Game(1); vis[0] = { inT: -1000 }; st = 'TITLE'; lastT = now();
    titleEl.querySelector('h1').innerHTML = T('餃子と<br>ドリル', 'Dumplings<br>&amp; Drill'); if (!JA) titleEl.classList.add('en');
    titleEl.querySelector('p').textContent = T('茹でても開かないように ネジで閉める', 'Screw them shut so they survive the pot');
    $('b-in').textContent = T('ドリルを持つ', 'Grab the drill');
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
