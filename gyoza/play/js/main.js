// 餃子とドリル: 画面・さわり心地・音・ふるえ・進行。遊びの式は game.js。
// 絵は 生成写真(v3 = 正面打ち: 素手で持った餃子 3 種・真正面のネジの頭・自分の腕ごしのドリル・明るい机 + 皿・カセットコンロの鍋。皿と鍋の小さい餃子は v1 の真上からの絵)。前の版(v2 = 右上から斜めに打つ)は git の tag v2 と pakyun.net/gyoza/v2/。
// コードで描いているのは くぼみの影・粉・飛ぶ具・泡・湯気・回転の筋・腕の延長だけ。
(function () {
  'use strict';
  var G = window.GZGame, K = G.K, Q = new URLSearchParams(location.search);
  // ---- 設定(端末に保存。アプリに包んでも WebView の localStorage で そのまま残る)----
  // mode = 打ち方(front = 正面 / side = 右上から斜め = 前の v2)、bgm・sfx・vib = 入/切、lang = auto / ja / en
  var SET_KEY = 'gyoza.settings.v1', SET = { mode: 'front', bgm: true, sfx: true, vib: true, lang: 'auto' };
  try { var sv = JSON.parse(localStorage.getItem(SET_KEY) || '{}'); for (var sk in SET) if (sv && typeof sv[sk] === typeof SET[sk]) SET[sk] = sv[sk]; } catch (e) {}
  function saveSet() { try { localStorage.setItem(SET_KEY, JSON.stringify(SET)); } catch (e) {} }
  if (Q.get('mode') === 'side' || Q.get('mode') === 'front') SET.mode = Q.get('mode');      // ?mode= は その回だけ(保存しない)。/gyoza/v2/ は ?mode=side へ送る
  var LANG = Q.get('lang') || (SET.lang !== 'auto' ? SET.lang : navigator.language || 'ja');
  var JA = LANG.toLowerCase().indexOf('ja') === 0;
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
  var INK = '#241a12', PAPER = '#fff6e6', RED = '#b5281c', GOLD = '#d6a84a';
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
  // trigger = 引き金 / spin・load = 回している間(皮に入ると強く)/ perfect = ぴたっ と座った / tear = やぶれ / clear・bad = 結果 / ui = 設定の札
  var HAPT = { trigger: 8, spin: 14, load: 34, perfect: [12, 30, 22], ok: 14, loose: 6, tear: [70, 30, 130], gear: [10, 40, 10], plate: 10, plop: 8, open: [20, 30, 40], clear: [20, 60, 20, 60, 40], bad: 120, ui: 6 };
  var hapticLog = [];
  function haptic(kind) {
    if (!SET.vib) return;
    hapticLog.push(kind); if (hapticLog.length > 600) hapticLog.shift();
    try { if (window.GZNative && window.GZNative.haptic) return window.GZNative.haptic(kind); if (navigator.vibrate) navigator.vibrate(HAPT[kind]); } catch (e) {}
  }

  // ---- 音(全部 コードで作る)----
  // 道すじ: 効果音(sfx)と BGM(bgm)を 別々の音量で master へ。設定の 入/切 は それぞれの音量を 0 にするだけ
  var AC = null, master = null, sfx = null, bgmBus = null, noiseBuf = null, soundLog = [], analyser = null, DR = null;
  function audioOn() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); bgmSync(); return; }
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    AC = new C(); master = AC.createGain(); master.gain.value = 0.6;
    var comp = AC.createDynamicsCompressor(); master.connect(comp); comp.connect(AC.destination);
    analyser = AC.createAnalyser(); analyser.fftSize = 2048; master.connect(analyser);
    sfx = AC.createGain(); sfx.gain.value = SET.sfx ? 1 : 0; sfx.connect(master);
    bgmBus = AC.createGain(); bgmBus.gain.value = 0; bgmBus.connect(master);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // ドリル: モーターのうなり(のこぎり波)+ ギアの高い鳴き(矩形波 → 帯域)+ ブラシのシャー(雑音)。重くなると 音程が下がって ごろごろ言う
    var m = AC.createOscillator(), mg = AC.createGain(), mf = AC.createBiquadFilter(), w = AC.createOscillator(), wf = AC.createBiquadFilter(), wg = AC.createGain(),
      n = AC.createBufferSource(), nf = AC.createBiquadFilter(), ng = AC.createGain(), out = AC.createGain(), lfo = AC.createOscillator(), lg = AC.createGain();
    m.type = 'sawtooth'; mf.type = 'lowpass'; mf.frequency.value = 1400; m.connect(mf); mf.connect(mg); mg.connect(out);
    w.type = 'square'; wf.type = 'bandpass'; wf.Q.value = 5; w.connect(wf); wf.connect(wg); wg.connect(out);
    n.buffer = noiseBuf; n.loop = true; nf.type = 'highpass'; nf.frequency.value = 3200; n.connect(nf); nf.connect(ng); ng.connect(out);
    lfo.frequency.value = 31; lg.gain.value = 0; lfo.connect(lg); lg.connect(out.gain);
    out.gain.value = 1; mg.gain.value = 0; wg.gain.value = 0; ng.gain.value = 0; out.connect(sfx);
    m.start(); w.start(); n.start(); lfo.start();
    DR = { m: m, mg: mg, w: w, wf: wf, wg: wg, ng: ng, lg: lg, lfo: lfo };
    bgmSync();
  }
  function soundSync() { if (sfx) sfx.gain.setTargetAtTime(SET.sfx ? 1 : 0, AC.currentTime, 0.02); bgmSync(); }
  // 画面が裏に回ったら 音を止める(スマホで 鳴りっぱなしにしない)
  document.addEventListener('visibilitychange', function () { if (!AC) return; if (document.hidden) AC.suspend(); else if (AC.state === 'suspended') AC.resume(); });
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
    env(g, t, a, peak, d); o.connect(g); g.connect(sfx); o.start(t); o.stop(t + a + d + 0.05);
  }
  function noise(ftype, f0, f1, q, t, a, d, peak) {
    var s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(); s.buffer = noiseBuf; s.loop = true;
    f.type = ftype; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    env(g, t, a, peak, d); s.connect(f); f.connect(g); g.connect(sfx); s.start(t, Math.random()); s.stop(t + a + d + 0.05);
  }
  // 銅鑼(小さめ)。倍音を ずらした sine を重ねて 長く減衰。out = 送り先(効果音 / BGM)
  function gong(t, f, peak, dur, out) {
    [[1, 1], [1.47, 0.6], [2.09, 0.45], [2.76, 0.3], [3.9, 0.18]].forEach(function (h) {
      var o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f * h[0] * 1.02, t); o.frequency.exponentialRampToValueAtTime(f * h[0], t + 0.4);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak * h[1], t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur / h[0] + 0.2);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.3);
    });
    var s = AC.createBufferSource(), fl = AC.createBiquadFilter(), g2 = AC.createGain(); s.buffer = noiseBuf; fl.type = 'bandpass'; fl.frequency.value = f * 6; fl.Q.value = 1.5;
    env(g2, t, 0.004, peak * 0.4, 0.25); s.connect(fl); fl.connect(g2); g2.connect(out); s.start(t, Math.random()); s.stop(t + 0.3);
  }

  // ---- BGM(中華風。全部コード。旋律は この遊びのために書いたもの)----
  // 五音(D の 宮商角徵羽 = レ ミ ファ# ラ シ)。古箏っぽい はじき = Karplus-Strong を先に焼いておく / 拍木(木魚)/ 小さな銅鑼 / 二胡っぽい のばし(15 秒から)/ 鈸(30 秒の HI から、テンポも上がる)
  var BGM = { on: false, next: 0, step: 0, timer: null, tempo: 1, layer: 0, duck: 1, pluck: {}, log: [] };
  var NOTE = { D2: 73.42, A2: 110, B2: 123.47, E2: 82.41, 'F#2': 92.5, D3: 146.83, E3: 164.81, 'F#3': 185, A3: 220, B3: 246.94, D4: 293.66, E4: 329.63, 'F#4': 369.99, A4: 440, B4: 493.88, D5: 587.33, E5: 659.25, 'F#5': 739.99, A5: 880 };
  // 8 分音符で 1 小節 8 つ・8 小節で 1 巡。'.' = 休み、'-' = のばす(はじかない)
  var MEL = ['A4 . B4 A4 F#4 . E4 .', 'D4 . E4 F#4 A4 . - .', 'B4 . D5 B4 A4 . F#4 A4', 'E4 . F#4 E4 D4 . - .',
    'F#5 . E5 D5 B4 . A4 .', 'B4 D5 B4 A4 F#4 . E4 .', 'D4 E4 F#4 A4 B4 . A4 F#4', 'E4 . - D4 D4 . - .'].map(function (b) { return b.split(' '); });
  var BASS = [['D2', 'A2'], ['D2', 'A2'], ['B2', 'F#2'], ['A2', 'E2'], ['D2', 'A2'], ['B2', 'F#2'], ['D2', 'B2'], ['A2', 'D2']];
  var ERHU = ['A4', 'F#4', 'B4', 'E4', 'D5', 'B4', 'A4', 'D4'];
  function ksBuf(f) {                                  // はじいた弦(Karplus-Strong)。1.6 秒
    var sr = AC.sampleRate, n = Math.floor(sr * 1.6), N = Math.max(2, Math.round(sr / f)), b = AC.createBuffer(1, n, sr), d = b.getChannelData(0), i, damp = f > 400 ? 0.994 : 0.997;
    for (i = 0; i < N; i++) d[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(Math.PI * i / N));
    for (i = N; i < n; i++) d[i] = damp * (0.62 * d[i - N] + 0.38 * d[i - N + 1]);
    return b;
  }
  function pluck(name, t, peak, bend) {
    var b = BGM.pluck[name] || (BGM.pluck[name] = ksBuf(NOTE[name])), s = AC.createBufferSource(), g = AC.createGain(), f = AC.createBiquadFilter();
    s.buffer = b; f.type = 'lowpass'; f.frequency.value = 3800; g.gain.value = peak;
    if (bend) { s.playbackRate.setValueAtTime(1, t + 0.18); s.playbackRate.linearRampToValueAtTime(1.06, t + 0.34); s.playbackRate.linearRampToValueAtTime(1, t + 0.6); }   // 古箏の 押し(音を ゆらす)
    s.connect(f); f.connect(g); g.connect(bgmBus); s.start(t); s.stop(t + 1.6);
  }
  function woodblock(t, peak, hi) {
    var o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(hi ? 1250 : 880, t); o.frequency.exponentialRampToValueAtTime(hi ? 1100 : 760, t + 0.06);
    env(g, t, 0.002, peak, 0.07); o.connect(g); g.connect(bgmBus); o.start(t); o.stop(t + 0.12);
  }
  function cymbal(t, peak) {
    var s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(); s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = 5200;
    env(g, t, 0.003, peak, 0.22); s.connect(f); f.connect(g); g.connect(bgmBus); s.start(t, Math.random()); s.stop(t + 0.3);
  }
  function erhu(t, from, to, dur, peak) {                // のこぎり波を 帯域で絞って ビブラート、前の音から すべって入る
    var o = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain(), v = AC.createOscillator(), vg = AC.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(NOTE[from] || NOTE[to], t); o.frequency.exponentialRampToValueAtTime(NOTE[to], t + 0.14);
    v.frequency.value = 5.4; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(NOTE[to] * 0.012, t + dur * 0.5); v.connect(vg); vg.connect(o.frequency);
    f.type = 'bandpass'; f.frequency.value = NOTE[to] * 2.2; f.Q.value = 1.1;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.18); g.gain.setValueAtTime(peak, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(bgmBus); o.start(t); v.start(t); o.stop(t + dur + 0.05); v.stop(t + dur + 0.05);
  }
  function bgmTick() {
    if (!AC || AC.state !== 'running' || !BGM.on) return;
    var e8 = 60 / (100 * BGM.tempo) / 2;               // 8 分音符(100 BPM。HI で 1.2 倍)
    if (BGM.next < AC.currentTime) BGM.next = AC.currentTime + 0.05;
    while (BGM.next < AC.currentTime + 0.15) {
      var t = BGM.next, s = BGM.step % 64, bar = Math.floor(s / 8), k = s % 8, n = MEL[bar][k];
      if (n !== '.' && n !== '-') { pluck(n, t, 0.5, k === 0 && bar % 2 === 1); if (k % 2 === 0) pluck(n.replace(/\d/, function (o) { return +o - 1; }), t + 0.012, 0.16); }
      if (k === 0) pluck(BASS[bar][0], t, 0.42); if (k === 4) pluck(BASS[bar][1], t, 0.34);
      if (k === 2 || k === 6) woodblock(t, 0.1, false);
      if (BGM.layer >= 2 && k % 2 === 1) woodblock(t, 0.05, true);
      if (BGM.layer >= 2 && (k === 0 || k === 4)) cymbal(t, 0.035);
      if (BGM.layer >= 1 && k === 0) erhu(t, ERHU[(bar + 7) % 8], ERHU[bar], e8 * 7.6, 0.05);
      if (s === 0) gong(t, 196, 0.05, 2.4, bgmBus);
      BGM.log.push(s); if (BGM.log.length > 200) BGM.log.shift();
      BGM.step++; BGM.next += e8;
    }
  }
  // BGM の 入/切 と 音量(引き金を引いている間は 下げて ドリルを聞かせる)
  function bgmSync() {
    if (!AC) return;
    var want = SET.bgm && st !== 'LOAD';
    if (want && !BGM.on) { BGM.on = true; BGM.next = 0; if (!BGM.timer) BGM.timer = setInterval(bgmTick, 30); bgmTick(); }
    if (!want && BGM.on) { BGM.on = false; }
    bgmBus.gain.setTargetAtTime(want ? 0.2 * BGM.duck : 0, AC.currentTime, want ? 0.08 : 0.04);
  }
  function bgmDuck(k) { if (BGM.duck === k) return; BGM.duck = k; bgmSync(); }
  function bgmLayer(n) { BGM.layer = n; BGM.tempo = n >= 2 ? 1.2 : 1; }
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
    gong: function (t) { gong(t, 150, 0.2, 2.6, sfx); },                                                                                 // 大将の 銅鑼(のれん・結果)
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
  // v3: 画面 = 自分の目。左手で餃子を持ち(とじ目の帯がこちらを向く)、右手のドリルを 手前から奥へ まっすぐ突き出して、帯のネジを正面から打つ。
  // 位置は 絵の中の座標(build/meta.json と 目で測った値)
  var HS = 0.8, HND = { w: 1500, h: 1150, x0: -180 };                          // 餃子を持つ手(絵の下の辺 = 画面の下)。とじ目の帯の真ん中 = y = 50 + 0.00083 (x − 950)²
  var HR = 35;                                                                 // ネジの頭の半径(皮に付いた時)
  // 打ち方 2 つ(設定で選ぶ)。front = 正面(v3: 自分の腕ごしのドリル + 真正面のネジの頭)/ side = 斜め(v2: 右上から来る素手のドリル + 横から見た座金つきネジ)
  var DRL_F = { ds: 0.85, w: 760, h: 1318, tipx: 163, tipy: 1, ax: 0, ay: -1, chuck: [104, 198, 60] };    // ドリル + 右腕(一人称)。ビットの先、チャックの上下と半幅
  var DRL_S = { ds: 0.7, w: 1200, h: 1074, tipx: 1, tipy: 976, ax: 0.554, ay: -0.8325 };                  // ドリル + 右手(斜め)。ビットの先と 向き
  var SC = 0.29, SCR = { w: 220, h: 661, headH: 101 };                                                     // 斜めのネジ(座金つき頭)
  var TH = Math.atan2(DRL_S.ax, -DRL_S.ay);                                                                // 斜めのネジ・ドリルの傾き(まっすぐ上から 右へ 33.6 度)
  var FRONT = true, DS = 0.85, DRL = DRL_F;
  function setMode() { FRONT = SET.mode !== 'side'; DRL = FRONT ? DRL_F : DRL_S; DS = DRL.ds; }
  setMode();
  var BGI = { w: 1188, h: 2112 };
  var POTW = { cx: 578, cy: 1085, rx: 395, ry: 158 };                          // 鍋の絵の 湯の面
  function rnd(seed) { return G.rng(seed); }
  function bake(im, sc, blur, oy) {                 // 影つきで 先に焼いておく(毎コマ影を計算しない)
    var pad = 60, cv = mk(im.width * sc + pad * 2, im.height * sc + pad * 2), c = cv.getContext('2d');
    c.shadowColor = 'rgba(60,36,10,.42)'; c.shadowBlur = blur; c.shadowOffsetY = oy; c.shadowOffsetX = -oy * 0.4; c.drawImage(im, pad, pad, im.width * sc, im.height * sc); cv.pad = pad; return cv;
  }
  // ネジ 1 本を 正面から。(0, 0) = 皮に入る点、hgt = 頭の下の面が皮から浮いている高さ(マイナス = 沈んでいる)、rot = 回った角度、loose = ゆるいまま残った
  // 浮いている = 頭が手前にあるぶん 大きく・左上へずれ、影が右下へ離れ、軸が見える。触れる = 影が頭の下に入る。沈む = 頭が少し小さくなり、まわりの皮が くぼんで 縁が埋まる
  function drawHead(c, hgt, rot, spin, loose) {
    var up = Math.max(0, hgt), sink = Math.max(0, -hgt), hx = -0.25 * up, hy = -0.8 * up + sink * 0.12, sc = 1 + up * 0.003 - sink * 0.004, r = HR * sc, g;
    if (up > 0) {                                     // 影(皮の上。高いほど 離れて ぼける)
      var sx0 = 0.34 * up + 5, sy0 = 0.26 * up + 6, sr = HR * (1.05 + up * 0.004);
      g = c.createRadialGradient(sx0, sy0, sr * 0.3, sx0, sy0, sr * 1.25); g.addColorStop(0, 'rgba(60,42,20,' + (0.66 - up * 0.002) + ')'); g.addColorStop(0.6, 'rgba(60,42,20,' + (0.4 - up * 0.0015) + ')'); g.addColorStop(1, 'rgba(60,42,20,0)'); c.fillStyle = g; c.beginPath(); c.arc(sx0, sy0, sr * 1.25, 0, 7); c.fill();
      c.fillStyle = 'rgba(64,46,24,.5)'; c.beginPath(); c.ellipse(0, 1, 10, 7, 0, 0, 7); c.fill();                     // 入り口
      g = c.createLinearGradient(-8, 0, 8, 0); g.addColorStop(0, '#6e7378'); g.addColorStop(0.4, '#e9ecef'); g.addColorStop(1, '#7c8186');     // 軸(手前へ のびて 頭につながる)
      c.save(); c.rotate(Math.atan2(hx, -hy)); c.fillStyle = g; var len = Math.hypot(hx, hy); c.fillRect(-8, -len, 16, len);
      c.strokeStyle = 'rgba(50,54,58,.5)'; c.lineWidth = 2; for (var y = -len + ((rot * 3) % 7 + 7) % 7; y < 0; y += 7) { c.beginPath(); c.moveTo(-7, y + 3); c.lineTo(7, y); c.stroke(); } c.restore();
    } else {                                          // くぼみ(頭のまわりの皮が沈む)
      var kk = clamp(sink / 10, 0, 1), dr = r + 14 + sink * 1.8;
      g = c.createRadialGradient(0, hy + 2, r * 0.8, 0, hy + 2, dr); g.addColorStop(0, 'rgba(70,50,26,' + (0.4 + 0.5 * kk) + ')'); g.addColorStop(0.5, 'rgba(84,62,34,' + (0.2 + 0.3 * kk) + ')'); g.addColorStop(1, 'rgba(84,62,34,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, hy + 2, dr, 0, 7); c.fill();
    }
    c.save(); c.translate(hx, hy); if (loose) { c.rotate(loose); c.scale(1, 0.86); }
    c.save(); c.rotate(rot); c.drawImage(img.head, -r, -r, r * 2, r * 2); c.restore();
    if (spin > 0.05) { c.fillStyle = 'rgba(200,205,210,' + 0.3 * spin + ')'; c.beginPath(); c.arc(0, 0, r * 0.5, 0, 7); c.fill(); }      // 回っている十字の ぶれ
    g = c.createLinearGradient(-r, -r, r, r); g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.2)'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill();   // 光の向きは 回っても変わらない
    if (sink > 0) { c.strokeStyle = 'rgba(236,224,200,' + clamp(sink / 16, 0, 0.75) + ')'; c.lineWidth = 2 + sink * 0.3; c.beginPath(); c.arc(0, 0, r - 0.5, 0, 7); c.stroke(); }   // 縁が皮に埋まる
    c.restore();
  }
  // 斜めのネジ 1 本(v2。軸は まっすぐ上向きで描く。呼ぶ側が TH だけ回す)。(0, 0) = 皮に入る点、hgt = 頭の下の面が皮から浮いている高さ
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
    for (i = 0; i < n; i++) { var a = Math.PI * (n === 1 ? 0.5 : lerp(0.8, 0.2, i / (n - 1))), x = 116 * Math.cos(a), y = -128 * Math.sin(a) + 9, up = d.screws[i].grade === 'loose' ? 6 : 0;
      c.fillStyle = 'rgba(70,50,26,.45)'; c.beginPath(); c.arc(x + up * 0.9 + 1, y + up + 2, 10, 0, 7); c.fill();
      c.drawImage(img.head, x - 10 - up * 0.3, y - 10 - up, 20, 20); }
    return cv;
  }

  // ================= 状態 =================
  var st = 'LOAD';                 // TITLE → PLAY → OUT(クビ・放置)/ BOIL(茹でる)→ RESULT
  var game = null, T0 = 0, endKind = null, endT = 0, runs = 0, seed = 1;
  var vis = {};                    // 餃子 id → 見た目の付けたし { rot/tilt のネジごと, inT, sq }
  var drill = { x: new Spring(1500, 70, 900), y: new Spring(1700, 76, 0), rpm: 0, rot: 0, lift: new Spring(300, 26, 0), near: new Spring(420, 34, 1), gearK: new Spring(500, 30, 0), away: 0 };
  var sq = new Spring(520, 13, 1), shakeT = -1e9, handA = new Spring(230, 27, 0), goT = 0, spr = {};
  var parts = [], pops = [], leaving = [], stains = [], tray = [], boil = null;
  var hintEl = $('hint'), titleEl = $('title'), resEl = $('result'), bossEl = $('boss'), startEl = $('start');
  var bossT = 0, hapT = 0, lastT = 0, contactSeen = false, pressedAt = -1e9;

  // ---- 背景 = 開店前の町中華の客席。円卓(朱の漆)+ ガラスの回転台 + 大皿、奥の壁に 品書きの短冊と 提灯 ----
  // ⚠️いまは コードで描いた仮の絵。生成写真(shop.webp = 店 + 円卓 / shop_pot.webp = 同じ円卓に 大鍋)が来たら drawBg で そちらを使う
  var MENU = [['餃子', '四五〇'], ['炒飯', '六〇〇'], ['天津飯', '七〇〇'], ['麻婆豆腐', '七五〇'], ['酢豚', '八五〇'], ['ネジ水餃子', '時価']];
  function plateC() { return { x: 560, y: H * 0.515, rx: 470, ry: 250 }; }
  function drawShop(c) {
    var wallB = Math.round(H * 0.33), r = G.rng(7), i, g, k;
    // 壁(しっくい。煙で 少し黄ばんでいる)
    g = c.createLinearGradient(0, 0, 0, wallB + 160); g.addColorStop(0, '#d9bf8f'); g.addColorStop(0.6, '#ead6ad'); g.addColorStop(1, '#cfae7a'); c.fillStyle = g; c.fillRect(0, 0, W, wallB + 220);
    for (i = 0; i < 90; i++) { var bx = r() * W, by = r() * wallB, br = 30 + r() * 120; g = c.createRadialGradient(bx, by, 0, bx, by, br); g.addColorStop(0, 'rgba(120,84,40,' + (0.03 + r() * 0.05) + ')'); g.addColorStop(1, 'rgba(120,84,40,0)'); c.fillStyle = g; c.fillRect(bx - br, by - br, br * 2, br * 2); }
    // 腰壁(こげ茶の板)
    g = c.createLinearGradient(0, wallB - 30, 0, wallB + 200); g.addColorStop(0, '#5a3020'); g.addColorStop(1, '#2c160e'); c.fillStyle = g; c.fillRect(0, wallB - 30, W, 260);
    c.fillStyle = 'rgba(255,220,170,.18)'; c.fillRect(0, wallB - 30, W, 4);
    for (i = 0; i < 9; i++) { c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(i * 128 + 40, wallB - 26, 3, 230); }
    // 天井の梁
    g = c.createLinearGradient(0, 0, 0, 96); g.addColorStop(0, '#24140c'); g.addColorStop(1, '#4a2a1a'); c.fillStyle = g; c.fillRect(0, 0, W, 96);
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, 96, W, 8);
    // 品書きの短冊(手書きの紙。最後の 1 枚が この店の「ネジ水餃子 時価」)
    var sw = 110, gap = 26, x0 = (W - (MENU.length * sw + (MENU.length - 1) * gap)) / 2, top = 120, sh = Math.min(470, wallB - top - 60);
    c.fillStyle = '#3a2418'; c.fillRect(x0 - 30, top - 6, MENU.length * (sw + gap) + 34, 6);
    for (i = 0; i < MENU.length; i++) {
      var mx = x0 + i * (sw + gap), last = i === MENU.length - 1, rot = (r() - 0.5) * 0.03;
      c.save(); c.translate(mx + sw / 2, top); c.rotate(rot);
      c.fillStyle = 'rgba(60,30,10,.25)'; c.fillRect(-sw / 2 + 6, 8, sw, sh);                                                                    // 影
      g = c.createLinearGradient(0, 0, 0, sh); g.addColorStop(0, last ? '#f4d86a' : '#f6ecd3'); g.addColorStop(1, last ? '#e8c450' : '#eadbb8'); c.fillStyle = g; c.fillRect(-sw / 2, 0, sw, sh);
      c.fillStyle = 'rgba(120,80,30,.08)'; for (k = 0; k < 5; k++) c.fillRect(-sw / 2, r() * sh, sw, 2 + r() * 3);                                     // 紙の しみ
      var nm = MENU[i][0], pr = MENU[i][1], fs = Math.min(70, (sh - 70 - pr.length * 40) / nm.length);
      c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = fs + 'px ' + FONT;
      for (k = 0; k < nm.length; k++) c.fillText(nm[k], 0, 30 + fs * (k + 0.5));
      c.fillStyle = '#a3231a'; c.font = '38px ' + FONT;
      for (k = 0; k < pr.length; k++) c.fillText(pr[k], 0, sh - 26 - (pr.length - 1 - k) * 40);
      c.restore();
    }
    // 提灯(左右の すみ)
    [[58, top + 150], [W - 58, top + 150]].forEach(function (p) {
      g = c.createRadialGradient(p[0], p[1], 20, p[0], p[1], 260); g.addColorStop(0, 'rgba(255,170,90,.35)'); g.addColorStop(1, 'rgba(255,170,90,0)'); c.fillStyle = g; c.fillRect(p[0] - 260, p[1] - 260, 520, 520);
      c.strokeStyle = '#24140c'; c.lineWidth = 4; c.beginPath(); c.moveTo(p[0], 96); c.lineTo(p[0], p[1] - 110); c.stroke();
      g = c.createRadialGradient(p[0] - 22, p[1] - 30, 10, p[0], p[1], 112); g.addColorStop(0, '#ff7a4a'); g.addColorStop(0.55, '#d1301e'); g.addColorStop(1, '#7c140b'); c.fillStyle = g;
      c.beginPath(); c.ellipse(p[0], p[1], 76, 100, 0, 0, 7); c.fill();
      c.strokeStyle = 'rgba(90,10,4,.45)'; c.lineWidth = 2; for (k = -3; k <= 3; k++) { c.beginPath(); c.ellipse(p[0], p[1] + k * 26, 76 * Math.sqrt(1 - Math.pow(k * 26 / 100, 2)), 6, 0, 0, Math.PI); c.stroke(); }
      c.fillStyle = '#2a1a10'; c.fillRect(p[0] - 34, p[1] - 108, 68, 16); c.fillRect(p[0] - 34, p[1] + 92, 68, 16);
      c.fillStyle = GOLD; c.fillRect(p[0] - 34, p[1] - 110, 68, 4); c.fillRect(p[0] - 34, p[1] + 104, 68, 4);
      c.strokeStyle = GOLD; c.lineWidth = 3; for (k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(p[0] + k * 6, p[1] + 108); c.lineTo(p[0] + k * 7, p[1] + 160); c.stroke(); }
    });
    // 円卓(朱の漆。奥の縁が見えている)
    var tcx = 540, tcy = wallB + 1000, trx = 1260, tryy = 1000;
    g = c.createRadialGradient(tcx, tcy - 600, 100, tcx, tcy - 300, 1300); g.addColorStop(0, '#c23322'); g.addColorStop(0.6, '#9c2014'); g.addColorStop(1, '#5e100a'); c.fillStyle = g;
    c.beginPath(); c.ellipse(tcx, tcy, trx, tryy, 0, 0, 7); c.fill();
    c.strokeStyle = 'rgba(255,190,150,.45)'; c.lineWidth = 3; c.beginPath(); c.ellipse(tcx, tcy, trx - 2, tryy - 2, 0, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
    [[130, wallB + 230, 380, 90], [W - 120, wallB + 260, 340, 80]].forEach(function (h) {         // 提灯の 映りこみ(漆の つや)
      c.save(); c.translate(h[0], h[1]); c.scale(1, h[3] / h[2]); g = c.createRadialGradient(0, 0, 0, 0, 0, h[2]); g.addColorStop(0, 'rgba(255,200,160,.32)'); g.addColorStop(1, 'rgba(255,200,160,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, h[2], 0, 7); c.fill(); c.restore();
    });
    // 調味料(醤油・酢・ラー油)を 回転台の 奥の 卓に
    var cx0 = 150, cy0 = H * 0.39;
    c.fillStyle = 'rgba(40,6,2,.35)'; c.beginPath(); c.ellipse(cx0 + 50, cy0 + 8, 120, 26, 0, 0, 7); c.fill();
    [['#2a120a', '#b5281c'], ['rgba(214,196,150,.85)', '#f2ece0'], ['#b5321a', '#b5281c']].forEach(function (b, j) {
      var bxx = cx0 - 20 + j * 62, h2 = 112;
      g = c.createLinearGradient(bxx - 24, 0, bxx + 24, 0); g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(0.3, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.25)');
      c.fillStyle = b[0]; rr(c, bxx - 24, cy0 - h2, 48, h2, 16); c.fill(); c.fillStyle = g; rr(c, bxx - 24, cy0 - h2, 48, h2, 16); c.fill();
      c.fillStyle = b[1]; rr(c, bxx - 16, cy0 - h2 - 26, 32, 30, 6); c.fill(); c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(bxx - 16, cy0 - h2 - 2, 32, 4);
    });
    // ガラスの回転台
    var P = plateC(), sr = { x: P.x, y: P.y + 10, rx: 560, ry: 305 };
    c.fillStyle = 'rgba(50,8,4,.35)'; c.beginPath(); c.ellipse(sr.x + 10, sr.y + 26, sr.rx, sr.ry, 0, 0, 7); c.fill();
    g = c.createLinearGradient(0, sr.y - sr.ry, 0, sr.y + sr.ry); g.addColorStop(0, 'rgba(225,245,240,.16)'); g.addColorStop(1, 'rgba(225,245,240,.06)'); c.fillStyle = g;
    c.beginPath(); c.ellipse(sr.x, sr.y, sr.rx, sr.ry, 0, 0, 7); c.fill();
    c.strokeStyle = 'rgba(200,236,226,.55)'; c.lineWidth = 7; c.stroke(); c.strokeStyle = 'rgba(40,70,64,.35)'; c.lineWidth = 2; c.beginPath(); c.ellipse(sr.x, sr.y + 4, sr.rx - 6, sr.ry - 5, 0, 0, 7); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 5; c.beginPath(); c.ellipse(sr.x, sr.y, sr.rx - 30, sr.ry - 18, 0, Math.PI * 1.15, Math.PI * 1.45); c.stroke();
    // 大皿(白磁 + 縁に 朱の雷文)
    c.fillStyle = 'rgba(40,10,4,.32)'; c.beginPath(); c.ellipse(P.x + 14, P.y + 22, P.rx, P.ry, 0, 0, 7); c.fill();
    g = c.createRadialGradient(P.x - 120, P.y - 80, 40, P.x, P.y, P.rx); g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#f1efe9'); g.addColorStop(1, '#d9d4ca'); c.fillStyle = g;
    c.beginPath(); c.ellipse(P.x, P.y, P.rx, P.ry, 0, 0, 7); c.fill();
    c.strokeStyle = 'rgba(150,140,125,.5)'; c.lineWidth = 3; c.beginPath(); c.ellipse(P.x, P.y + 4, P.rx * 0.8, P.ry * 0.8, 0, 0, 7); c.stroke();
    c.strokeStyle = '#b5281c'; c.lineWidth = 3; c.beginPath(); c.ellipse(P.x, P.y, P.rx * 0.97, P.ry * 0.97, 0, 0, 7); c.stroke(); c.beginPath(); c.ellipse(P.x, P.y, P.rx * 0.84, P.ry * 0.84, 0, 0, 7); c.stroke();
    var NK = 34; c.lineWidth = 3.2; c.lineJoin = 'miter';
    for (k = 0; k < NK; k++) {                                                    // 雷文(四角い うず)を 縁に並べる
      var a = k / NK * Math.PI * 2, rxk = P.rx * 0.905, ryk = P.ry * 0.905, px = P.x + Math.cos(a) * rxk, py = P.y + Math.sin(a) * ryk, s = 15;
      c.save(); c.translate(px, py); c.scale(1, P.ry / P.rx); c.rotate(a + Math.PI / 2);
      c.beginPath(); c.moveTo(-s, s * 0.6); c.lineTo(-s, -s * 0.6); c.lineTo(s * 0.5, -s * 0.6); c.lineTo(s * 0.5, s * 0.3); c.lineTo(-s * 0.4, s * 0.3); c.lineTo(-s * 0.4, -s * 0.15); c.lineTo(s * 0.1, -s * 0.15); c.stroke(); c.restore();
    }
    // 店の明かり(上が 少し明るく、すみが 暗い)
    g = c.createRadialGradient(540, H * 0.42, H * 0.25, 540, H * 0.45, H * 0.8); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(20,6,2,.45)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  var potCv = null;
  function drawBg() {                                // 町中華の客席(仮の絵)/ 茹でる所は 同じ卓に 鍋(いまは 家の鍋の写真を 丸く切り抜いて 載せている)
    sx(bg); var boilBg = st === 'BOIL' || (st === 'RESULT' && boil), s = H / BGI.h;
    drawShop(bg);
    if (boilBg) {
      if (!potCv || potCv.h !== H) {
        potCv = mk(W, H); potCv.h = H; var c = potCv.getContext('2d');
        try { c.filter = 'saturate(0.35)'; } catch (e) {} c.drawImage(img.pot, 540 - POTW.cx * s, 0, BGI.w * s, H); try { c.filter = 'none'; } catch (e) {}   // 鍋の外がわに映った 家の机の色を 抜く
        // 鍋の形だけ残す(縁の楕円 + 胴。下の カセットコンロと 家の机は 消す)。座標は pot.webp の中の値
        c.globalCompositeOperation = 'destination-in'; c.save(); c.translate(540 - POTW.cx * s, 0); c.scale(s, s); try { c.filter = 'blur(2px)'; } catch (e) {}
        c.fillStyle = '#000'; c.beginPath(); c.ellipse(578, 915, 481, 352, 0, Math.PI, 0); c.quadraticCurveTo(1045, 1130, 930, 1250); c.ellipse(578, 1250, 352, 85, 0, 0, Math.PI); c.quadraticCurveTo(110, 1130, 97, 915); c.closePath(); c.fill(); c.restore();
      }
      var sh = bg.createRadialGradient(560, 1262 * s, 40, 560, 1262 * s, 470 * s); sh.addColorStop(0, 'rgba(30,4,2,.6)'); sh.addColorStop(1, 'rgba(30,4,2,0)');      // 鍋の影(円卓の上)
      bg.save(); bg.translate(0, 1262 * s); bg.scale(1, 0.3); bg.translate(0, -1262 * s); bg.fillStyle = sh; bg.fillRect(0, 1262 * s - 470 * s, W, 940 * s); bg.restore();
      bg.drawImage(potCv, 0, 0, W, H);
    }
  }
  function traySlot(i) {                             // 大皿の上(手に隠れない 上がわ)に 4 コずつ
    var col = i % 4, row = Math.floor(i / 4), r3 = Math.min(row, 3);
    var P = plateC(); return { x: P.x - 290 + col * 172 + (r3 % 2) * 60 + (row > 3 ? (row - 3) * 14 : 0), y: P.y - 100 + r3 * 80, rot: Math.sin(i * 7.3) * 0.35 };   // 円卓の大皿の上
  }

  function say(text, ms) { bossEl.firstChild.textContent = text; bossEl.classList.add('on'); bossT = now() + (ms || 2200); }
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
      if (e.type === 'start') { play('click'); haptic('trigger'); contactSeen = false; hintEl.classList.remove('on'); if (game.pulls === 1) titleEl.classList.add('off'); }
      else if (e.type === 'judge') {
        var dd = e.grade === 'tear' || !d || d.id !== e.d ? findD(e.d) : d, ho = handAt(); p = screwPos(dd, e.screw); var wx = ho.x + p.x, wy = ho.y + p.y;
        var v = (vis[dd.id] = vis[dd.id] || {}); v[e.screw] = { rot: drill.rot, tilt: (Math.random() - 0.5) * 0.22 };
        if (e.grade === 'perfect') { play('perfect'); haptic('perfect'); pop(T('ぴたっ', 'Flush!'), wx, wy - 90, RED); sq.v -= 1.6; puff(wx, wy, 5, 120); }
        else if (e.grade === 'ok') { play('ok'); haptic('ok'); pop(T('よし', 'OK'), wx, wy - 90); sq.v -= 0.9; }
        else if (e.grade === 'loose') { play('loose'); haptic('loose'); pop(T('ゆるい', 'Loose'), wx, wy - 90 - hgtOf(dd.screws[e.screw])); }
        else { play('tear'); haptic('tear'); pop(T('やぶれた', 'Torn!'), 560, wy - 150, RED); burst(560, wy + 60); shakeT = now(); sq.v -= 2; say(T('大将「具が出てる！」', 'Chef: "The filling!"'), 1300); }
        drill.lift.x = e.grade === 'tear' ? 90 : 40;
      } else if (e.type === 'dumpling') {
        goT = now() + (e.result === 'torn' ? 480 : 40);            // 手が 皿のほうへ下がる(破れたら 少し見せてから)
        if (e.result !== 'torn') { tray.push({ cv: snapshot(e.d), shown: false, d: e.d }); leaving.push({ kind: 'tray', t0: now() + 260, dur: 1, i: tray.length - 1 }); play('slide'); }
      } else if (e.type === 'spawn') { vis[e.d.id] = { inT: now() }; sq.t = 1; }
      else if (e.type === 'stage') {
        play('boss');
        if (e.stage === 1) { say(T('大将「湯が沸いてきた！ ネジは 4 本」', 'Chef: "Water\'s nearly boiling! Four screws each!"')); bgmLayer(1); }
        else { say(T('大将「のれん出すで！ ハイにせえ」', 'Chef: "We\'re opening! Switch it to HI!"')); play('gear'); play('gong'); haptic('gear'); drill.gearK.t = 1; bgmLayer(2); }
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
    hintEl.textContent = T('長押しで ネジを締める。頭が皮に沈んだら 離す', 'Hold to drive the screw. Let go when the head sinks in.'); setOpen(false); hintEl.classList.add('on');
    play('boss'); say(T('大将「お前の包んだのは 茹でたら開くねん」', 'Chef: "Yours always pop open in the pot."'), 3000); bgmLayer(0);
  }
  function finish(kind) {
    endKind = kind; endT = now(); hintEl.classList.remove('on'); drillSound(0, 0, 1);
    if (kind === 'fired') { st = 'OUT'; play('boss'); say(T('大将「ドリル置け。皿洗いや」', 'Chef: "Drop the drill. Go wash dishes."'), 1500); haptic('bad'); }
    else if (kind === 'idle') { st = 'OUT'; }
    else if (!game.done.length) { st = 'OUT'; }
    else { st = 'WAIT'; say(T('大将「湯が沸いた。入れるで」', 'Chef: "It\'s boiling. In they go."'), 1500); }
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
  var RANKS = [['点心の神', 'Dim Sum God', '大将「明日から お前が包め」', 'Chef: "You\'re wrapping from tomorrow."'], ['餃子大工', 'Dumpling Carpenter', '大将「やるやないか」', 'Chef: "Not bad."'],
    ['見習い卒業', 'Apprentice No More', '大将「まあ 出せる」', 'Chef: "Good enough to serve."'], ['まだ見習い', 'Still an Apprentice', '大将「ぎりぎりやな」', 'Chef: "Barely."']];
  var shareText = '';
  // 結果 = 店の品書き札。開かなかった数だけが「ネジ水餃子」として 今日の品書きに載る
  function showResult() {
    st = 'RESULT'; bgmLayer(0); var k = endKind, c = game.closed, big = $('r-big'), rk = $('r-rank'), ko = JA ? '<small>コ</small>' : ''; big.className = ''; rk.className = '';
    var stat = T('分速 ' + game.perMin() + ' コ　ぴたっ ' + game.flush() + '%　開いた ' + game.opened + ' コ', game.perMin() + ' per min   flush ' + game.flush() + '%   opened ' + game.opened);
    $('r-head').textContent = T('本日の品書き', "Today's menu");
    if (k === 'clear') {
      var r = RANKS[G.rank(c)]; $('r-dish').textContent = T('ネジ水餃子', 'Screwed Dumplings'); $('r-label').textContent = T('茹でても 開かなかった', 'Stayed shut in the pot'); big.innerHTML = c + ko;
      rk.textContent = T(r[0], r[1]); $('r-line').textContent = T(r[2], r[3]); $('r-stat').textContent = stat; play('clear'); play('gong'); haptic('clear');
      shareText = T('餃子とドリル: 本日の品書き「ネジ水餃子」' + c + ' コ。肩書きは「' + r[0] + '」', 'Dumplings & Drill: ' + c + ' screwed dumplings made the menu. Title: ' + r[1]);
    } else {
      // [品書きに載った物, 説明, 大きい字, 大きい字が言葉か, 肩書きの所, 大将の一言]
      var L = { soup: [T('具スープ', 'Filling Soup'), T('ほとんど 開いた', 'Most of them opened'), game.opened + ko, false, '', T('大将「これは スープや」', 'Chef: "That\'s soup now."')],
        slow: [T('ネジ水餃子', 'Screwed Dumplings'), T('茹でても 開かなかった', 'Stayed shut in the pot'), c + ko, false, T('間に合わず', 'Too slow'), T('大将「もう のれん出したで」', 'Chef: "We\'re already open."')],
        fired: [T('品切れ', 'Sold Out'), T('3 コ 破いた', 'Tore three dumplings'), T('没収', 'Confiscated'), true, '', T('大将「具が もったいない」', 'Chef: "Waste of good filling."')],
        idle: [T('品切れ', 'Sold Out'), T('ドリルを持って 立っていた', 'Stood there holding a drill'), '…', true, '', T('大将「…何しとんねん」', 'Chef: "...What are you doing?"')] }[k];
      $('r-dish').textContent = L[0]; $('r-label').textContent = L[1]; big.innerHTML = L[2]; if (L[3]) big.className = 'word';
      rk.textContent = L[4]; rk.className = 'bad'; $('r-line').textContent = L[5]; $('r-stat').textContent = k === 'idle' ? '' : stat; play('over'); haptic('bad');
      shareText = T('餃子とドリル: 本日の品書き「' + L[0] + '」' + L[1] + '。' + L[5], 'Dumplings & Drill: Today\'s menu: ' + L[0] + '. ' + L[5]);
    }
    $('b-again').textContent = T('もう一回', 'Again'); $('b-share').textContent = T('シェア', 'Share');
    resEl.classList.add('on');
  }
  function share() {
    var url = location.origin + location.pathname;
    if (navigator.share) { navigator.share({ text: shareText, url: url }).catch(function () {}); return; }
    window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(url), '_blank', 'noopener');
  }

  // ---- 設定の画面(品書きの札。題名と 結果から開く。遊んでいる間は 開けない)----
  var setEl = $('set'), setFrom = null;
  var ROWS = [
    { k: 'mode', lab: ['打ち方', 'Drilling'], opts: [['front', '正面', 'Straight'], ['side', '斜め', 'Angled']],
      cap: { front: ['餃子を 正面から まっすぐ打つ', 'Drive straight in, face-on'], side: ['右上から 斜めに打つ', 'Drive in at an angle from the upper right'] } },
    { k: 'bgm', lab: ['BGM', 'Music'], opts: [[true, '入', 'On'], [false, '切', 'Off']] },
    { k: 'sfx', lab: ['効果音', 'Sound'], opts: [[true, '入', 'On'], [false, '切', 'Off']] },
    { k: 'vib', lab: ['振動', 'Vibration'], opts: [[true, '入', 'On'], [false, '切', 'Off']],
      cap: (navigator.vibrate || (window.GZNative && window.GZNative.haptic)) ? null : { all: ['この端末のブラウザでは ふるえません', "This browser can't vibrate"] } },
    { k: 'lang', lab: ['言語', 'Language'], opts: [['auto', '自動', 'Auto'], ['ja', '日本語', '日本語'], ['en', 'English', 'English']] }
  ];
  function buildSettings() {
    $('s-title').textContent = T('設定', 'Settings'); $('s-close').textContent = T('閉じる', 'Close');
    var box = $('s-rows'); box.innerHTML = '';
    ROWS.forEach(function (R) {
      var row = document.createElement('div'), lab = document.createElement('span'), seg = document.createElement('div');
      row.className = 'row' + (R.cap ? ' wrap' : ''); row.setAttribute('role', 'group'); lab.className = 'lab' + (R.k === 'bgm' && JA ? ' lat' : ''); lab.textContent = T(R.lab[0], R.lab[1]); seg.className = 'seg';   // 筆の書体の 英字は 読みにくいので BGM だけ 明朝
      var cap = null; if (R.cap) { cap = document.createElement('div'); cap.className = 'cap'; }
      R.opts.forEach(function (o) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = T(o[1], o[2]); b.setAttribute('aria-pressed', String(SET[R.k] === o[0]));
        b.addEventListener('click', function () { pick(R, o[0], seg, cap); }); seg.appendChild(b);
      });
      row.appendChild(lab); row.appendChild(seg); if (cap) row.appendChild(cap); box.appendChild(row);
      if (cap) capText(R, cap);
    });
  }
  function capText(R, cap) { var c = R.cap.all || R.cap[SET[R.k]]; cap.textContent = c ? T(c[0], c[1]) : ''; }
  function pick(R, v, seg, cap) {
    audioOn(); haptic('ui');
    if (SET[R.k] === v) return;
    var old = SET[R.k]; SET[R.k] = v; saveSet();
    [].forEach.call(seg.children, function (b, i) { b.setAttribute('aria-pressed', String(R.opts[i][0] === v)); });
    if (cap) capText(R, cap);
    if (R.k === 'mode') { setMode(); drill.x.x = drill.x.t; drill.y.x = drill.y.t; }
    else if (R.k === 'bgm' || R.k === 'sfx') { soundSync(); if (R.k === 'sfx' && v) play('perfect'); }
    else if (R.k === 'vib' && v) haptic('perfect');
    else if (R.k === 'lang' && old !== v) location.reload();       // 字を全部 入れ替えるので 読み直す(設定は 保存済み)
  }
  function setOpen(on, from) {
    if (on && st !== 'TITLE' && st !== 'RESULT') return;
    if (on) { audioOn(); setFrom = from || null; setEl.classList.add('on'); var b = setEl.querySelector('[aria-pressed="true"]'); if (b) b.focus({ preventScroll: true }); }
    else if (setEl.classList.contains('on')) { setEl.classList.remove('on'); if (setFrom) setFrom.focus({ preventScroll: true }); }
  }
  $('s-close').addEventListener('click', function () { haptic('ui'); setOpen(false); });
  setEl.addEventListener('pointerdown', function (e) { if (e.target === setEl) setOpen(false); });

  // ---- 入力(指 1 本: 押す = 引き金を引く / 離す = 止める)----
  var ptrId = null;
  function evT(e) { return fake != null ? fake : (e && e.timeStamp > 0 ? e.timeStamp : performance.now()); }
  function press(t) { if (st !== 'PLAY') return; pressedAt = t; handle(game.input(t - T0, true)); }
  function release(t) { audioOn(); if (st !== 'PLAY') return; handle(game.input(t - T0, false)); }
  cFx.addEventListener('pointerdown', function (e) { if (ptrId != null) return; ptrId = e.pointerId; try { cFx.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); press(evT(e)); });
  function up(e) { if (e.pointerId !== ptrId) return; ptrId = null; release(evT(e)); }
  cFx.addEventListener('pointerup', up); cFx.addEventListener('pointercancel', up);
  cFx.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('keydown', function (e) { if (setEl.classList.contains('on')) { if (e.code === 'Escape') setOpen(false); return; } if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (st === 'TITLE' || st === 'RESULT') clockIn(); else press(evT(e)); } });
  window.addEventListener('keyup', function (e) { if (e.code === 'Space') release(evT(e)); });
  window.addEventListener('blur', function () { if (ptrId != null || (game && game.down)) { ptrId = null; release(now()); } });
  $('b-in').addEventListener('click', clockIn); $('b-again').addEventListener('click', clockIn); $('b-share').addEventListener('click', share);
  $('b-set').addEventListener('click', function () { setOpen(true, this); }); $('b-set2').addEventListener('click', function () { setOpen(true, this); });

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
    if (st === 'RESULT') { var g = fx.createLinearGradient(0, H * 0.35, 0, H); g.addColorStop(0, 'rgba(20,6,2,0)'); g.addColorStop(1, 'rgba(20,6,2,.55)'); fx.fillStyle = g; fx.fillRect(0, H * 0.35, W, H * 0.65); }
    bgmDuck(st === 'PLAY' && game && game.phase === 'drill' ? 0.4 : 1);
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
        c.save(); c.translate(ho.x + q.x, ho.y + q.y);
        if (FRONT) drawHead(c, on ? -x * PXU : hgtOf(scw), on ? drill.rot : (v ? v.rot : i * 1.3), on ? drill.rpm : 0, scw.grade === 'loose' && v ? v.tilt * 1.6 : 0);
        else { c.rotate(TH + (scw.grade === 'loose' && v ? v.tilt : 0)); drawScrew(c, on ? -x * PXU : hgtOf(scw), on ? drill.rot : (v ? v.rot : i * 1.3), on ? drill.rpm : 0); }
        c.restore();
      }
      sp = screwPos(d, cur); var hg = drilling ? -x * PXU : hgtOf(d.screws[cur]), up = Math.max(0, hg);
      if (FRONT) {
        hx = ho.x + sp.x - 0.25 * up; hy = ho.y + sp.y - 0.8 * up + Math.max(0, -hg) * 0.12;       // ビットの先 = 頭の真ん中
        drill.near.t = drilling ? clamp(up / 110, 0, 1) * 0.6 : 1;                                   // 1 = 手前で構える / 0 = いちばん奥まで押しこんだ
        if (torn || d.result != null) { hx = 620; hy = H * 0.66; drill.near.t = 1.4; }
      } else {
        var hh2 = hg + SCR.headH * SC + 5; hx = ho.x + sp.x + DRL.ax * hh2; hy = ho.y + sp.y + DRL.ay * hh2;   // ビットの先 = 頭の十字
        if (torn || d.result != null) { hx = 860; hy = H * 0.5; }
      }
    }
    // ドリル(正面: 手前から奥へ。回していない間は 少し引いて構える。押している間は 奥へ進む = 少し小さくなる / 斜め: 頭から 少し離して構える)
    drill.near.step(dt); drill.gearK.step(dt); drill.lift.t = drilling ? 0 : 50; drill.lift.step(dt);
    drill.x.t = hx; drill.y.t = hy; drill.x.step(dt); drill.y.step(dt);
    if (drilling) { drill.x.x = hx; drill.y.x = hy; }  // 回している間は ネジの頭に ぴったり
    var jx = drill.rpm * (Math.sin(tn / 9) * 1.6 + Math.sin(tn / 3.7) * 0.9) * (1 + loadK), jy = drill.rpm * Math.sin(tn / 5.3) * 1.2 * (1 + loadK * 1.5), nr = Math.max(0, drill.near.x);
    var away = st === 'OUT' ? drill.away : 0, back = (drilling ? 0 : 1) * Math.max(0, nr - 0.6) * 150, lf = Math.max(0, drill.lift.x);
    if (game || st === 'TITLE') {
      if (FRONT) drawDrill(c, drill.x.x + jx + away * 900 + back * 0.25, drill.y.x + jy + back + away * 1600, 0.95 + 0.11 * nr);
      else drawDrillSide(c, drill.x.x + jx + DRL.ax * lf + away * 1500, drill.y.x + jy + DRL.ay * lf - away * 1700);
    }
    // 粒
    for (i = parts.length - 1; i >= 0; i--) {
      var p = parts[i], a = (tn - p.t0) / p.life; if (a >= 1) { if (p.k === 'bit' && stains.length < 60) stains.push({ x: p.x, y: p.y, r: p.r, col: p.col }); parts.splice(i, 1); continue; }
      if (p.k === 'flour') { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; var rr2 = p.r * (1 + a * 1.6), g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr2); g.addColorStop(0, 'rgba(255,253,246,' + 0.5 * (1 - a) + ')'); g.addColorStop(1, 'rgba(255,253,246,0)'); c.fillStyle = g; c.fillRect(p.x - rr2, p.y - rr2, rr2 * 2, rr2 * 2); }
      else { p.vy += 2400 * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.y > p.fy && p.vy > 0) { p.y = p.fy; p.vx *= 0.8; p.vy = 0; } c.fillStyle = p.col; c.beginPath(); c.ellipse(p.x, p.y, p.r, p.r * 0.55, p.r * 1.7, 0, 7); c.fill(); c.fillStyle = 'rgba(60,30,10,.18)'; c.beginPath(); c.ellipse(p.x + 1, p.y + p.r * 0.2, p.r * 0.8, p.r * 0.3, p.r * 1.7, 0, 7); c.fill(); }
    }
    drawPops(c, tn);
    if (st === 'PLAY' || st === 'WAIT' || st === 'OUT') drawHud(c, tn);
  }
  function drawDrill(c, x, y, k) {                   // 写真 1 枚(ドリル + 右腕)。ビットの先が (x, y)、k = 大きさ(手前ほど大きい)
    var D = spr.drill, sc = DS * k;
    c.save(); c.translate(x, y); c.scale(k, k);
    // 腕は 絵の下の辺で切れているので、いちばん下の帯を 腕の向き(右下)へ引きのばして 画面の外まで続ける
    c.save(); c.translate(-DRL.tipx * DS, (DRL.h - DRL.tipy - 4) * DS); c.transform(1, 0, 0.5, 1, 0, 0); c.drawImage(img.drill, 364, DRL.h - 8, 396, 5, 364 * DS, 0, 396 * DS, 700); c.restore();
    c.drawImage(D, -DRL.tipx * DS - D.pad, -DRL.tipy * DS - D.pad);
    if (drill.rpm > 0.02) {                          // 回っているチャックの筋(写真の上に うすく)
      var y0 = DRL.chuck[0] * DS, y1 = DRL.chuck[1] * DS, w = DRL.chuck[2] * DS;
      c.beginPath(); c.moveTo(-w * 0.7, y0); c.lineTo(w * 0.7, y0); c.lineTo(w, y1); c.lineTo(-w, y1); c.closePath(); c.clip(); c.globalAlpha = 0.25 + 0.3 * drill.rpm;
      for (var i = 0; i < 5; i++) { var px = Math.cos(drill.rot * 0.9 + i * 1.2566) * w; c.fillStyle = i % 2 ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.35)'; c.fillRect(px - 8, y0, 16, y1 - y0); }
    }
    c.restore();
  }
  function drawDrillSide(c, x, y) {                  // 斜め(v2): 写真 1 枚(ドリル + 右手)。ビットの先が (x, y)
    var D = spr.drill_side, ox = x - DRL_S.tipx * DS, oy = y - DRL_S.tipy * DS;
    // 腕は 絵の上の辺で切れているので、いちばん上の帯を 腕の向きへ引きのばして 画面の外まで続ける
    c.save(); c.translate(ox, oy + 3); c.transform(1, 0, -0.45, 1, 0, 0); c.drawImage(img.drill_side, 836, 3, 362, 5, 836 * DS, -2400, 362 * DS, 2401); c.restore();
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
    c.fillStyle = 'rgba(36,18,10,.72)'; rr(c, 54, y - 6, 972, 30, 15); c.fill();                                   // 残り時間(梁の上に 金の帯)
    if (k > 0.004) { c.fillStyle = k < 0.2 ? '#e0452c' : GOLD; rr(c, 60, y, Math.max(18, 960 * k), 18, 9); c.fill(); }
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
      var yy = Math.round(H * 0.2), lab = T('開かなかった', 'Stayed shut'), num = String(b.shut + (t > 600 ? b.extraShut : 0));   // 漆の札(壁の品書きの前)
      c.fillStyle = 'rgba(40,18,10,.9)'; rr(c, 330, yy - 250, 420, 300, 16); c.fill(); c.strokeStyle = GOLD; c.lineWidth = 4; rr(c, 338, yy - 242, 404, 284, 12); c.stroke();
      c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.font = '50px ' + FONT; c.fillStyle = PAPER; c.fillText(lab, 540, yy - 168);
      c.font = '170px ' + FONT; c.fillStyle = '#f7d98e'; c.fillText(num, 540, yy + 4);
    }
  }

  // ---- 起動 ----
  function loop() { frame(now()); requestAnimationFrame(loop); }
  window.addEventListener('resize', layout);
  Promise.all(['pot', 'dumpling', 'dumpling_open', 'hand', 'hand_thin', 'hand_torn', 'head', 'drill', 'screw', 'drill_side'].map(function (n) { return load(n, 'assets/' + n + '.webp'); }).concat([ document.fonts ? document.fonts.load('40px "YujiBoku"', '餃子とドリル').catch(function () {}) : null, document.fonts ? document.fonts.load('40px "GZNum"', '0123').catch(function () {}) : null])).then(function () {
    ['hand', 'hand_thin', 'hand_torn'].forEach(function (n) { spr[n] = bake(img[n], HS, 34, 30); }); spr.drill = bake(img.drill, DRL_F.ds, 30, 34); spr.drill_side = bake(img.drill_side, DRL_S.ds, 30, 34);
    ready = true; layout();
    game = new G.Game(1); vis[0] = { inT: -1000 }; st = 'TITLE'; lastT = now();
    titleEl.querySelector('h1').innerHTML = T('餃子と<br>ドリル', 'Dumplings<br>&amp; Drill'); if (!JA) titleEl.classList.add('en');
    titleEl.querySelector('p').innerHTML = T('開店まで 45 秒<br>茹でても開かないように ネジで閉める', '45 seconds till we open.<br>Screw them shut so they survive the pot.');
    $('b-in').textContent = T('ドリルを持つ', 'Grab the drill'); $('b-set').textContent = T('設定', 'Settings'); $('b-set2').textContent = T('設定', 'Settings');
    buildSettings(); drawBg(); requestAnimationFrame(loop);
  });

  // 検査用の のぞき窓
  window.__gz = {
    get state() { return st; }, get game() { return game; }, get T0() { return T0; }, get endKind() { return endKind; }, get boil() { return boil; },
    get audio() { return AC ? { state: AC.state, rate: AC.sampleRate } : null; }, get drillSnd() { return drillSnd; },
    get settings() { return SET; }, get bgm() { return { on: BGM.on, step: BGM.step, layer: BGM.layer, tempo: BGM.tempo, gain: bgmBus ? bgmBus.gain.value : null, sfxGain: sfx ? sfx.gain.value : null }; }, setOpen: setOpen,
    soundLog: soundLog, hapticLog: hapticLog, clockIn: clockIn, press: function () { press(now()); }, release: function () { release(now()); },
    setFake: function (t) { fake = t; lastT = t == null ? performance.now() : t; }, get fake() { return fake; },
    step: function (ms, each) { each = each || 16; for (var e = 0; e < ms - 1e-6; e += each) { fake += Math.min(each, ms - e); frame(fake); } },
    peak: function () { if (!analyser) return 0; var d = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(d); var m = 0; for (var i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); return m; },
    loud: function () { if (!analyser) return null; var d = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(d); var bi = 0; for (var i = 1; i < d.length; i++) if (d[i] > d[bi]) bi = i; return { hz: Math.round(bi * AC.sampleRate / analyser.fftSize), level: d[bi] }; }
  };
})();
