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
  var INK = '#231a14', PAPER = '#fbf7ef', RED = '#c8241b', GOLD = '#d6a84a';
  // 字(11-27 作り直し。ユウキさん「フォントに AI っぽさ。タイトルは 町中華の看板風に。色は白と赤」):
  // 壁の短冊だけ = Yuji Syuku(筆。数字は抜いてある)/ 画面の字・数字 = Zen Kaku Gothic New / ぴたっ等の飛び出す字と 看板 = Potta One(手描き看板の丸い筆)
  var FONT = '"YujiSyuku","ZenKaku",serif';
  var FONT_UI = '"ZenKaku","Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif';
  var FONT_POP = '"Potta","ZenKaku",sans-serif';

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
  var HAPT = { trigger: 8, spin: 14, load: 34, perfect: [12, 30, 22], ok: 14, loose: 6, tear: [70, 30, 130], gear: [10, 40, 10], plate: 10, plop: 8, open: [20, 30, 40], clear: [20, 60, 20, 60, 40], bad: 120, ui: 6,
    staple: [18, 24, 10], air: 8, cut: [6, 20, 16], promo: [16, 70, 16, 70, 50] };   // 2 面 = タッカーの ばちん / 空打ち、3 面 = 切り終わりの コッ、昇格
  var hapticLog = [];
  // アプリ(WebView)に いまの画面を知らせる(題名・結果だけ 下にバナーを出すため)。Web 版では何もしない
  function nativeScreen(n) { try { if (window.GZNative && window.GZNative.screen) window.GZNative.screen(n); } catch (e) {} }
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
    AC = new C(); master = AC.createGain(); master.gain.value = 0.6; setTimeout(voiceLoad, 0);
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
    clear: function (t) { [1047, 1319, 1568, 2093].forEach(function (f, i) { tone('sine', f, f, t + i * 0.09, 0.004, i === 3 ? 0.6 : 0.16, 0.09); }); },
    // 2 面: タッカー。ばちん = 鉄の口が鳴る(高い雑音 + 矩形)+ 皮を押さえる 鈍い 2 発目 / 空打ち = 乾いた 1 発だけ
    staple: function (t) { noise('highpass', 5200, 3600, 0.8, t, 0.001, 0.025, 0.45); tone('square', 1900, 900, t, 0.001, 0.02, 0.07); tone('sine', 120, 60, t + 0.012, 0.003, 0.09, 0.42); noise('lowpass', 900, 300, 0.9, t + 0.012, 0.004, 0.07, 0.25); },
    air: function (t) { noise('highpass', 4200, 3000, 0.9, t, 0.001, 0.02, 0.3); tone('square', 1300, 700, t, 0.001, 0.015, 0.05); },
    spoil: function (t) { noise('lowpass', 1100, 300, 0.9, t, 0.006, 0.18, 0.4); tone('sine', 140, 60, t, 0.004, 0.16, 0.22); },          // 具が はみ出る(むにゅ)
    roll: function (t) { noise('bandpass', 500, 900, 0.9, t, 0.05, 0.3, 0.07); },                                                    // 春巻が 台を すべってくる
    // 3 面: 切り終わりの 木の コッ(まな板)/ ちぎれ = びりっ / 斜めに それた = ぐしゃ
    cutEnd: function (t) { tone('sine', 1180, 980, t, 0.002, 0.06, 0.2); tone('sine', 520, 460, t, 0.002, 0.05, 0.08); },
    rip: function (t) { noise('bandpass', 2400, 700, 1.4, t, 0.004, 0.16, 0.35); },
    crook: function (t) { noise('lowpass', 1600, 400, 0.8, t, 0.01, 0.2, 0.3); tone('triangle', 300, 180, t, 0.004, 0.12, 0.08); },
    // 昇格: 銅鑼 + 札が返る かたっ + 上がる 3 音
    promo: function (t) { gong(t, 150, 0.16, 2.4, sfx); woodblock2(t + 0.25); [784, 1047, 1568].forEach(function (f, i) { tone('sine', f, f, t + 0.45 + i * 0.11, 0.004, i === 2 ? 0.7 : 0.18, 0.08); }); },
    peg: function (t) { tone('sine', 2600, 2400, t, 0.001, 0.05, 0.06); tone('sine', 380, 300, t, 0.002, 0.08, 0.12); }              // 工具が 釘に掛かる
  };
  function woodblock2(t) { tone('sine', 900, 760, t, 0.002, 0.07, 0.18); }
  // 3 面: カッターが 紙のような 干し豆腐を 引く音(指が動いている間だけ。速さで 大きさと 高さが変わる)
  var CUTS = null;
  function cutSound(v) {                               // v = 指の速さ(px/s)。0 で止める
    if (!AC || AC.state !== 'running') return;
    if (!CUTS) { var src = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(); src.buffer = noiseBuf; src.loop = true; f.type = 'bandpass'; f.Q.value = 1.6; g.gain.value = 0; src.connect(f); f.connect(g); g.connect(sfx); src.start(); CUTS = { f: f, g: g }; }
    var k = clamp(v / 1400, 0, 1), t = AC.currentTime;
    CUTS.g.gain.setTargetAtTime(v > 0 ? 0.05 + 0.3 * k : 0, t, 0.025); CUTS.f.frequency.setTargetAtTime(1400 + 2600 * k, t, 0.03);
  }
  // 大将の声(2026-11-26。中国語。OpenAI の読み上げで作った mp3 = out/voice/v3。字幕は端末の言語のまま)。効果音と同じ入/切
  var VOICE = {}, voiceSrc = null, voiceLoading = false;
  var VOICE_KEYS = ['open', 'stage1', 'stage2', 'tear', 'fired_say', 'wait', 'rank1', 'rank2', 'rank3', 'rank4', 'soup', 'slow', 'fired', 'idle'];
  function voiceLoad() {
    if (!AC || voiceLoading) return; voiceLoading = true;
    VOICE_KEYS.forEach(function (k) {
      fetch('assets/voice/' + k + '.mp3').then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { return new Promise(function (ok, ng) { AC.decodeAudioData(b, ok, ng); }); })
        .then(function (buf) { VOICE[k] = buf; }).catch(function () {});
    });
  }
  function voice(k) {
    soundLog.push('voice:' + k); if (soundLog.length > 800) soundLog.shift();
    if (!AC || AC.state !== 'running' || !VOICE[k]) return;
    try { if (voiceSrc) voiceSrc.stop(); } catch (e) {}
    try { var s = AC.createBufferSource(), g = AC.createGain(); g.gain.value = 1.1; s.buffer = VOICE[k]; s.connect(g); g.connect(sfx); s.start(AC.currentTime + 0.02); voiceSrc = s; } catch (e) {}
  }
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
  var BGI = { w: 1188, h: 2112, cx: 600 };                                    // 店の写真(shop / shop_pot は同じ構図)。cx = 画面の真ん中に来る x
  var POTW = { cx: 607, cy: 1313, rx: 348, ry: 150 };                          // shop_pot の 湯の面
  var PLATE = { cx: 618, cy: 1367, rx: 361, ry: 234 };                         // shop の 大皿
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
    var dh = 260 * img.dumpling.height / img.dumpling.width; c.drawImage(img.dumpling, -130, -dh, 260, dh);   // 手に持つのと同じ形(帯のとじ目)の餃子
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

  // ---- 背景 = 開店前の町中華の客席(生成写真 shop / 茹でる所は 同じ構図の shop_pot)。壁の短冊は 無地で撮って、字は ここで書く ----
  // 短冊 13 枚の 上の辺の両端と 下の辺の両端(写真の座標。目で測った値)。最後の黄色 = 「ネジ水餃子」。開店前は白紙、合格した時だけ 書き足す
  var STRIPS = [[122, 180, 157, 160, 210, 505], [215, 265, 162, 245, 292, 505], [297, 345, 168, 320, 365, 505], [383, 430, 177, 400, 442, 507], [478, 522, 185, 490, 530, 507],
    [552, 592, 190, 557, 597, 510], [624, 664, 195, 626, 665, 512], [695, 738, 200, 692, 733, 513], [765, 805, 203, 758, 800, 515], [835, 874, 208, 823, 862, 515],
    [903, 942, 212, 887, 927, 517], [965, 1005, 218, 948, 985, 517], [1032, 1068, 222, 1005, 1040, 520]];
  var MENU = [['餃子', '四五〇'], ['炒飯', '六〇〇'], ['拉麺', '六五〇'], ['天津飯', '七〇〇'], ['酢豚', '八五〇'], ['麻婆豆腐', '七五〇'], ['回鍋肉', '八〇〇'],
    ['中華丼', '七五〇'], ['青椒肉絲', '八〇〇'], ['八宝菜', '八五〇'], ['焼売', '四〇〇'], ['春巻', '三五〇'], ['ネジ水餃子', '時価']];
  var menuHung = false;                                                        // 合格すると 右端の黄色い短冊に「ネジ水餃子 時価」が載る
  function bgS() { return H / BGI.h; }
  function bgX() { return 540 - BGI.cx * bgS(); }
  function plateC() { var s = bgS(); return { x: bgX() + PLATE.cx * s, y: PLATE.cy * s, rx: PLATE.rx * s, ry: PLATE.ry * s }; }
  function drawMenu(c) {                              // 短冊に 墨で書く(紙に染みるよう multiply)。品名は上から、値段は朱で下に揃える
    var s = bgS(), ox = bgX(), i, k;
    c.save(); c.globalCompositeOperation = 'multiply'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (i = 0; i < STRIPS.length; i++) {
      if (i === STRIPS.length - 1 && !menuHung && !PROG.clear[0]) continue;   // 一品目に 一度合格したら ずっと掛かっている
      var q = STRIPS[i], tx = ox + (q[0] + q[1]) / 2 * s, ty = q[2] * s, bx = ox + (q[3] + q[4]) / 2 * s, by = q[5] * s, wdt = (q[1] - q[0]) * s;
      var len = Math.hypot(bx - tx, by - ty), nm = MENU[i][0], pr = MENU[i][1], fs = Math.min(wdt * 0.86, (len * 0.62) / nm.length), ps = Math.min(wdt * 0.62, fs * 0.72);
      c.save(); c.translate(tx, ty); c.rotate(-Math.atan2(bx - tx, by - ty)); c.translate((i % 3 - 1) * 0.6, 0);
      c.fillStyle = 'rgba(48,37,29,.94)'; c.font = fs + 'px ' + FONT;
      for (k = 0; k < nm.length; k++) c.fillText(nm[k], 0, len * 0.07 + fs * (k + 0.5));
      c.fillStyle = 'rgba(163,55,40,.92)'; c.font = ps + 'px ' + FONT;
      for (k = 0; k < pr.length; k++) c.fillText(pr[k], 0, len * 0.95 - ps * (pr.length - k - 0.5));
      c.restore();
    }
    c.restore();
  }
  function drawBg() {
    sx(bg); var boilBg = st === 'BOIL' || (st === 'RESULT' && boil), s = bgS(), kit = st !== 'TITLE' && STG[S].bg === 'kitchen';
    bg.fillStyle = '#2c160e'; bg.fillRect(0, 0, W, H);
    bg.drawImage(boilBg ? img.shop_pot : kit ? img.kitchen : img.shop, bgX(), 0, BGI.w * s, H);   // 二品目から = 奥の厨房(同じ大きさ・構図の写真)
    if (!kit) drawMenu(bg);
  }
  function traySlot(i) {                             // 大皿の上。奥の列から 並べる(手前は 手に隠れる)。20 コを超えたら 少しずらして重ねる
    var P = plateC(), rows = [[-0.6, 3], [-0.28, 4], [0.04, 5], [0.36, 5]], k = i % 17, r = 0;
    while (k >= rows[r][1]) { k -= rows[r][1]; r++; }
    var dy = rows[r][0], n = rows[r][1], hw = P.rx * 0.74 * Math.sqrt(Math.max(0.05, 1 - dy * dy)), lap = Math.floor(i / 17);
    return { x: P.x + (n === 1 ? 0 : lerp(-hw + 70, hw - 70, k / (n - 1))) + lap * 22, y: P.y + dy * P.ry * 0.86 - lap * 10, rot: Math.sin(i * 7.3) * 0.22 };
  }


  // 話す人の札。'大将「…」' / 'Chef: "…"' を 話す人(赤・小さく)と 台詞に分けて出す
  function splitSay(text) { var m = /^(.+?)「([\s\S]*)」$/.exec(text) || /^([A-Za-z][\w .'-]*): "([\s\S]*)"$/.exec(text); return m ? [m[1], m[2]] : ['', text]; }
  function say(text, ms) { var w = splitSay(text); bossEl.querySelector('b').textContent = w[0]; bossEl.querySelector('i').textContent = w[1]; bossEl.classList.add('on'); bossT = now() + (ms || 2200); }
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
        else { play('tear'); haptic('tear'); pop(T('やぶれた', 'Torn!'), 560, wy - 150, RED); burst(560, wy + 60); shakeT = now(); sq.v -= 2; say(T('大将「具が出てる！」', 'Chef: "The filling!"'), 1300); voice('tear'); }
        drill.lift.x = e.grade === 'tear' ? 90 : 40;
      } else if (e.type === 'dumpling') {
        goT = now() + (e.result === 'torn' ? 480 : 40);            // 手が 皿のほうへ下がる(破れたら 少し見せてから)
        if (e.result !== 'torn') { tray.push({ cv: snapshot(e.d), shown: false, d: e.d }); leaving.push({ kind: 'tray', t0: now() + 260, dur: 1, i: tray.length - 1 }); play('slide'); }
      } else if (e.type === 'spawn') { vis[e.d.id] = { inT: now() }; sq.t = 1; }
      else if (e.type === 'stage') {
        play('boss');
        if (e.stage === 1) { say(T('大将「湯が沸いてきた！ ネジは 4 本」', 'Chef: "Water\'s nearly boiling! Four screws each!"')); voice('stage1'); bgmLayer(1); }
        else {      // 30 秒: 店が開く = ドリルを 高速へ(11-27「のれん出すで！ ハイにせえ」が 伝わらなかったので 言い直し + 右上の札が 高速に変わる)
          say(T('大将「開店や！ 次のネジから ドリルは高速だ」', 'Chef: "We\'re open! High speed from the next screw!"'), 2800); voice('stage2'); play('gear'); play('gong'); haptic('gear'); drill.gearK.t = 1; bgmLayer(2); hiFlash = now();
        }
      } else if (e.type === 'timeup') { play('whistle'); }
      else if (e.type === 'end') finish(e.kind);
    }
  }
  function findD(id) { if (game.cur && game.cur.id === id) return game.cur; for (var i = 0; i < game.done.length; i++) if (game.done[i].id === id) return game.done[i]; return game.cur; }

  // ================= 修業(面・肩書き・工具掛け)=================
  // 話(11-27、Codex と 3 回相談して決めた): ネジで閉めた水餃子を 常連に気に入られた 町中華の見習いが、宴会の注文を ひと皿ずつ 自分の工具で仕上げて 肩書きを上げていく。
  // 面 = 料理 1 つ + 工具 1 つ(動きも 1 つ)。初めて合格すると 工具が 工具掛けに掛かり、肩書きが 1 段上がる。
  var LV = [['見習い', 'Apprentice'], ['餃子番', 'Dumpling Cook'], ['点心係', 'Dim Sum Cook'], ['仕込み頭', 'Prep Lead'], ['蒸し場担当', 'Steamer Chief'], ['宴会番', 'Banquet Cook'], ['料理長', 'Head Chef']];
  var STG = [
    { kind: 'drill', bg: 'shop', no: ['一品目', 'Order 1'], dish: ['ネジ水餃子', 'Screwed Dumplings'], tool: ['電動ドリル', 'Power drill'], take: ['ドリルを持つ', 'Grab the drill'],
      who: ['大将', 'Chef'], line: ['お前の包んだのは 茹でたら開く。ネジで 閉めとけ', 'Yours pop open in the pot. Screw them shut.'], voice: 'open',
      how: ['長押しで ネジを締める。頭が皮に沈んだら 離す', 'Hold to drive the screw. Let go when the head sinks in.'],
      goal: ['茹でても開かない餃子', 'Dumplings that survive the pot'], unit: ['コ', ''], quota: 5, best: ['最高 ', 'Best '] },
    { kind: 'staple', bg: 'kitchen', no: ['二品目', 'Order 2'], dish: ['三つ留め春巻', 'Triple-Stapled Spring Rolls'], tool: ['ホッチキス', 'Stapler'], take: ['ホッチキスを持つ', 'Grab the stapler'],
      who: ['常連', 'Regular'], line: ['ネジの餃子 うまかった。今度の宴会、春巻も 頼めるか？', 'Loved those screwed dumplings. Spring rolls for my party, too?'],
      how: ['赤い印が ホッチキスの口の真下に来たら タップ', 'Tap when a red mark is right under the stapler.'],
      goal: ['3 か所 留めた春巻', 'Rolls stapled 3 times'], unit: ['本', ''], quota: 5, best: ['最高 ', 'Best '] },
    { kind: 'cut', bg: 'kitchen', no: ['三品目', 'Order 3'], dish: ['干し豆腐の細切り', 'Shredded Tofu Skin'], tool: ['カッターと金尺', 'Knife & steel rule'], take: ['カッターを持つ', 'Grab the knife'],
      who: ['幹事', 'Party host'], line: ['冷菜も 味見させて。細く まっすぐ 頼むよ', 'Let me taste a cold dish too. Thin and straight, please.'],
      how: ['金尺に沿って 端から端まで 一息に なぞる', 'Swipe along the steel rule, end to end, in one go.'],
      goal: ['まっすぐな細切り', 'Straight strips'], unit: ['本', ''], quota: 12, best: ['最高 ', 'Best '] }
  ];
  // この先(写真を作ってから。いまは 工具掛けに 輪郭と「？」だけ)
  var FUTURE = [{ k: 'caulk', tool: ['コーキングガン', 'Caulking gun'], dish: ['花焼売', 'Flower shumai'] }, { k: 'trowel', tool: ['左官ごて', 'Plaster trowel'], dish: ['五目炒飯', 'Fried rice'] }, { k: 'crank', tool: ['手回しドリル', 'Hand drill'], dish: ['ねじり葱そば', 'Twisted noodles'] }];
  var TOOLK = ['drill', 'staple', 'cut'];
  var PROG_KEY = 'gyoza.progress.v1', PROG = { clear: [false, false, false], best: [0, 0, 0] };
  try { var pv = JSON.parse(localStorage.getItem(PROG_KEY) || '{}'); if (pv && pv.clear) for (var pi = 0; pi < STG.length; pi++) { PROG.clear[pi] = !!pv.clear[pi]; PROG.best[pi] = +(pv.best && pv.best[pi]) || 0; } } catch (e) {}
  function saveProg() { try { localStorage.setItem(PROG_KEY, JSON.stringify(PROG)); } catch (e) {} }
  function lvNow() { var n = 0; for (var i = 0; i < STG.length; i++) if (PROG.clear[i]) n++; return n; }
  function unlocked(i) { return i === 0 || PROG.clear[i - 1]; }
  function nextStage() { for (var i = 0; i < STG.length; i++) if (!PROG.clear[i]) return i; return -1; }      // -1 = 今ある注文は 全部合格
  var S = 0;                                                    // いまの面
  if (+Q.get('stage') >= 1 && +Q.get('stage') <= STG.length) S = +Q.get('stage') - 1; else S = Math.max(0, nextStage());
  var mini = null, hiFlash = -1e9;                              // mini = 2・3 面の 遊びと 見た目

  // ---- 題名の画面: 看板・肩書きの札・次の注文 ----
  function fillTitle() {
    var n = lvNow(), nx = nextStage();
    $('rank').querySelector('.lv').textContent = 'Lv.' + (n + 1); $('rank').querySelector('.nm').textContent = T(LV[n][0], LV[n][1]); $('rank').querySelector('.go').textContent = '';
    $('rank').setAttribute('aria-label', T('肩書き ' + LV[n][0] + '。工具掛けを開く', 'Rank: ' + LV[n][1] + '. Open the tool wall'));
    titleEl.querySelector('p').textContent = nx >= 0 ? T('次の注文　' + STG[nx].dish[0] + '（' + STG[nx].tool[0] + '）', 'Next order: ' + STG[nx].dish[1] + ' (' + STG[nx].tool[1].toLowerCase() + ')') : T('土曜の宴会に つづく', 'To be continued at Saturday\'s banquet');
    $('b-in').textContent = nx >= 0 ? T('次の注文へ', 'Next order') : T('注文を選ぶ', 'Pick an order');
    $('b-board').textContent = T('工具掛け', 'Tool wall'); $('b-set').textContent = T('設定', 'Settings');
  }
  function toTitle() {
    st = 'TITLE'; nativeScreen('title'); mini = null; game = new G.Game(1); vis = {}; vis[0] = { inT: -1000 }; tray = []; boil = null; endKind = null; S = Math.max(0, nextStage());
    resEl.classList.remove('on'); cardEl.classList.remove('on'); titleEl.classList.remove('off'); startEl.classList.remove('off'); hintEl.classList.remove('on'); bossEl.classList.remove('on');
    fillTitle(); drawBg(); bgmLayer(0);
  }

  // ---- 伝票(面の前): 何を・何で・誰の注文か・どう動かすか・いくつ ----
  var cardEl = $('card'), cardEnd = false;
  function openCard(i) {
    audioOn(); haptic('ui'); boardOpen(false);
    cardEnd = i >= STG.length;
    if (!cardEnd) S = i;
    st = 'CARD'; nativeScreen('title'); mini = null;
    if (!cardEnd && STG[i].kind !== 'drill') mini = STG[i].kind === 'staple' ? stapleStart(1) : cutStart(1);   // 伝票の後ろに 工具を見せておく(まだ動かない)
    else { game = new G.Game(1); vis = {}; vis[0] = { inT: -1000 }; drill.away = 0; endKind = null; } tray = []; boil = null; resEl.classList.remove('on'); titleEl.classList.add('off'); startEl.classList.add('off'); bossEl.classList.remove('on'); drawBg();
    if (cardEnd) {      // 3 品目のあと: 常連が 予約票を書く → つづく
      $('c-no').textContent = T('予約票', 'Reservation'); $('c-dish').textContent = T('土曜 六名様 宴会', 'Saturday — party of six');
      $('c-tool').innerHTML = ''; $('c-who').textContent = T('常連', 'Regular'); $('c-line').textContent = T('土曜、六名。全部 あんたの工具で 頼むよ', 'Saturday, six of us. Do it all with your tools.');
      $('c-how').textContent = T('つづく　焼売・炒飯・締めの麺は 準備中', 'To be continued — shumai, fried rice and noodles are on the way.'); $('c-goal').textContent = '';
      $('c-go').textContent = T('工具掛けを見る', 'See the tool wall'); $('c-back').textContent = T('題名へ', 'Title');
      voice('rank2');
    } else {
      var D = STG[i];
      $('c-no').textContent = T(D.no[0], D.no[1]); $('c-dish').textContent = T(D.dish[0], D.dish[1]);
      $('c-tool').innerHTML = T('道具 <b>' + D.tool[0] + '</b>', 'Tool: <b>' + D.tool[1] + '</b>');
      $('c-who').textContent = T(D.who[0], D.who[1]); $('c-line').textContent = T(D.line[0], D.line[1]); $('c-how').textContent = T(D.how[0], D.how[1]);
      $('c-goal').innerHTML = T(D.goal[0] + ' <span>' + D.quota + ' ' + D.unit[0] + '</span> で 合格', D.goal[1] + ': <span>' + D.quota + '</span> to pass');
      $('c-go').textContent = T(D.take[0], D.take[1]); $('c-back').textContent = T('もどる', 'Back');
      if (D.voice) voice(D.voice); else play('boss');
    }
    cardEl.classList.add('on'); $('c-go').focus({ preventScroll: true });
  }
  $('c-go').addEventListener('click', function () { if (cardEnd) { cardEl.classList.remove('on'); toTitle(); boardOpen(true); } else clockIn(); });
  $('c-back').addEventListener('click', function () { haptic('ui'); toTitle(); });

  function clockIn() {
    audioOn(); if (st !== 'TITLE' && st !== 'RESULT' && st !== 'CARD') return;
    boardOpen(false); setOpen(false);
    runs++; seed = +(Q.get('seed') || 0) || (Math.floor(Math.random() * 1e9) + 1);
    T0 = now(); parts = []; pops = []; leaving = []; stains = []; tray = []; boil = null; endKind = null; mini = null; hiFlash = -1e9;
    cardEl.classList.remove('on'); resEl.classList.remove('on'); startEl.classList.add('off'); titleEl.classList.add('off'); bossEl.classList.remove('on'); bgmLayer(0);
    var D = STG[S];
    hintEl.firstChild.textContent = T(D.how[0], D.how[1]); hintEl.classList.add('on');
    if (D.kind === 'drill') {
      game = new G.Game(seed); vis = {}; vis[0] = { inT: now() - 1000 };
      drill.away = 0; drill.gearK.t = 0; drill.gearK.x = 0; drill.rpm = 0; sq.t = 1; sq.x = 1;
      st = 'PLAY'; menuHung = false;
    } else {
      mini = D.kind === 'staple' ? stapleStart(seed) : cutStart(seed); st = 'MINI';
    }
    drawBg(); nativeScreen('play');
  }
  function finish(kind) {
    endKind = kind; endT = now(); hintEl.classList.remove('on'); drillSound(0, 0, 1);
    if (kind === 'fired') { st = 'OUT'; say(T('大将「ドリル置け。皿洗いや」', 'Chef: "Drop the drill. Go wash dishes."'), 1500); voice('fired_say'); haptic('bad'); }
    else if (kind === 'idle') { st = 'OUT'; }
    else if (!game.done.length) { st = 'OUT'; }
    else { st = 'WAIT'; say(T('大将「湯が沸いた。入れるで」', 'Chef: "It\'s boiling. In they go."'), 1500); voice('wait'); }
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
  // 皿の講評(その回の出来。肩書きとは別)。[名前 ja, en] は 面ごと、大将の一言と声は 共通
  var CRIT = [[['点心の神', 'Dim Sum God'], ['餃子大工', 'Dumpling Carpenter'], ['合格', 'Passed'], ['ぎりぎり', 'Just made it']],
    [['春巻の神', 'Spring Roll God'], ['留め職人', 'Staple Master'], ['合格', 'Passed'], ['ぎりぎり', 'Just made it']],
    [['細切りの神', 'Knife God'], ['金尺の鬼', 'Ruler Demon'], ['合格', 'Passed'], ['ぎりぎり', 'Just made it']]];
  var CHEF = [['大将「明日から お前が包め」', 'Chef: "You\'re wrapping from tomorrow."'], ['大将「やるやないか」', 'Chef: "Not bad."'], ['大将「まあ 出せる」', 'Chef: "Good enough to serve."'], ['大将「ぎりぎりやな」', 'Chef: "Barely."']];
  var shareText = '', promoFrom = -1;
  // 結果 = 品書きの札(何が いくつ 載ったか・講評・大将の一言・昇格)
  function showResult() {
    st = 'RESULT'; nativeScreen('result'); bgmLayer(0); hintEl.classList.remove('on');
    var D = STG[S], k = endKind, big = $('r-big'), rk = $('r-rank'), u = JA ? '<small>' + D.unit[0] + '</small>' : '', c, stat, L;
    big.className = ''; promoFrom = -1; $('r-promo').textContent = '';
    if (D.kind === 'drill') { c = game.closed; stat = [T('分速 ' + game.perMin() + ' コ', game.perMin() + '/min'), T('ぴたっ ' + game.flush() + '%', 'Flush ' + game.flush() + '%'), T('開いた ' + game.opened + ' コ', 'Opened ' + game.opened)]; }
    else if (D.kind === 'staple') { c = mini.g.closed; stat = [T('ぴたっ ' + mini.g.flush() + '%', 'Dead-on ' + mini.g.flush() + '%'), T('はみ出た ' + mini.g.spoiled + ' 本', 'Burst ' + mini.g.spoiled)]; }
    else { c = mini.g.cuts; stat = [T('ぴたっ ' + mini.g.flush() + '%', 'Dead-straight ' + mini.g.flush() + '%'), T('失敗 ' + mini.g.bad + ' 本', 'Ruined ' + mini.g.bad)]; }
    $('r-head').textContent = T('本日の品書き', "Today's menu");
    if (k === 'clear') {
      var ri = G.rank(c, D.quota, D.kind === 'drill' ? 0 : mini.g.cfg.top), r = CRIT[S][ri]; $('r-dish').textContent = T(D.dish[0], D.dish[1]); $('r-label').textContent = T(['茹でても 開かなかった', '3 か所 留まった', 'まっすぐ 切れた'][S], ['Stayed shut in the pot', 'Stapled three times', 'Cut dead straight'][S]); big.innerHTML = c + u;
      rk.textContent = T(r[0], r[1]); $('r-line').textContent = T(CHEF[ri][0], CHEF[ri][1]); voice('rank' + (ri + 1)); setStat(stat); play('clear'); play('gong'); haptic('clear');
      if (S === 0) { menuHung = true; drawBg(); }       // 壁の右端の黄色い短冊に「ネジ水餃子 時価」が 書き足される
      if (c > PROG.best[S]) PROG.best[S] = c;
      if (!PROG.clear[S]) {                             // 初めての合格 = 工具が 工具掛けに掛かり、肩書きが上がる
        promoFrom = lvNow(); PROG.clear[S] = true;
        $('r-promo').textContent = T('昇格 ' + LV[promoFrom][0] + ' → ' + LV[promoFrom + 1][0], 'Promoted: ' + LV[promoFrom][1] + ' → ' + LV[promoFrom + 1][1]);
      }
      saveProg();
      shareText = T('餃子とドリル: ' + D.tool[0] + 'で「' + D.dish[0] + '」' + c + ' ' + D.unit[0] + '。肩書きは「' + LV[lvNow()][0] + '」', 'Dumplings & Drill: ' + c + ' × ' + D.dish[1] + ' with a ' + D.tool[1].toLowerCase() + '. Rank: ' + LV[lvNow()][1]);
    } else {
      // [品書きに載った物, 説明, 大きい字, 大きい字が言葉か, 一言の所, 一言]
      var ko = u;
      L = { soup: [T('具スープ', 'Filling Soup'), T('ほとんど 開いた', 'Most of them opened'), game.opened + ko, false, '', T('大将「これは スープや」', 'Chef: "That\'s soup now."')],
        slow: [T(D.dish[0], D.dish[1]), T('足りなかった(' + D.quota + ' ' + D.unit[0] + ' で 合格)', 'Not enough (' + D.quota + ' to pass)'), c + ko, false, T('間に合わず', 'Too slow'), S === 0 ? T('大将「もう 店 開けたで」', 'Chef: "We\'re already open."') : T('大将「宴会に 足りんぞ」', 'Chef: "Not enough for the party."')],
        fired: [T('品切れ', 'Sold Out'), T('3 コ 破いた', 'Tore three dumplings'), T('没収', 'Confiscated'), true, '', T('大将「具が もったいない」', 'Chef: "Waste of good filling."')],
        idle: [T('品切れ', 'Sold Out'), T(D.tool[0] + 'を持って 立っていた', 'Stood there holding a ' + D.tool[1].toLowerCase()), '…', true, '', T('大将「…何しとんねん」', 'Chef: "...What are you doing?"')] }[k];
      $('r-dish').textContent = L[0]; $('r-label').textContent = L[1]; big.innerHTML = L[2]; if (L[3]) big.className = 'word';
      rk.textContent = L[4]; $('r-line').textContent = L[5]; voice(k); setStat(k === 'idle' ? [] : stat); play('over'); haptic('bad');
      shareText = T('餃子とドリル: 本日の品書き「' + L[0] + '」' + L[1] + '。' + splitSay(L[5])[1], 'Dumplings & Drill: Today\'s menu: ' + L[0] + '. ' + splitSay(L[5])[1]);
    }
    // ボタン: 合格 = 次の注文へ(大きい)+ もう一回 / 不合格 = もう一回(大きい)
    var ok = k === 'clear', nb = $('b-next'), ab = $('b-again');
    nb.textContent = ok ? (S + 1 < STG.length ? T('次の注文へ', 'Next order') : T('予約票を見る', 'See the reservation')) : T('もう一回', 'Again');
    ab.hidden = !ok; ab.textContent = T('もう一回', 'Again'); $('b-board2').textContent = T('工具掛け', 'Tool wall'); $('b-share').textContent = T('シェア', 'Share');
    nb.onclick = ok ? function () { openCard(S + 1); } : clockIn;
    resEl.classList.add('on');
    if (promoFrom >= 0) setTimeout(function () { if (st === 'RESULT') boardOpen(true, S); }, 900);       // 昇格の場面(工具が掛かる → 札が返る)
  }
  function setStat(a) { var el = $('r-stat'); el.textContent = ''; a.forEach(function (x) { var sp = document.createElement('span'); sp.textContent = x; el.appendChild(sp); }); }   // 成績は 3 組に分けて 組の間をあける
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
  cFx.addEventListener('pointerdown', function (e) { if (ptrId != null) return; ptrId = e.pointerId; try { cFx.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); if (st === 'MINI') miniDown(evT(e), stageXY(e)); else press(evT(e)); });
  cFx.addEventListener('pointermove', function (e) { if (e.pointerId !== ptrId || st !== 'MINI') return; var es = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; (es.length ? es : [e]).forEach(function (ce) { miniMove(fake != null ? fake : (ce.timeStamp > 0 ? ce.timeStamp : performance.now()), stageXY(ce)); }); });
  function up(e) { if (e.pointerId !== ptrId) return; ptrId = null; if (st === 'MINI') miniUp(evT(e), stageXY(e)); else release(evT(e)); }
  cFx.addEventListener('pointerup', up); cFx.addEventListener('pointercancel', up);
  cFx.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('keydown', function (e) { if (setEl.classList.contains('on')) { if (e.code === 'Escape') setOpen(false); return; } if (boardEl.classList.contains('on')) { if (e.code === 'Escape') boardOpen(false); return; } if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (st === 'CARD' || st === 'RESULT') clockIn(); else if (st === 'MINI' && mini.kind === 'staple') miniDown(evT(e), null); else if (st === 'PLAY') press(evT(e)); } });
  window.addEventListener('keyup', function (e) { if (e.code === 'Space') release(evT(e)); });
  window.addEventListener('blur', function () { if (ptrId != null || (game && game.down)) { ptrId = null; release(now()); } });
  $('b-in').addEventListener('click', function () { var nx = nextStage(); if (nx >= 0) openCard(nx); else boardOpen(true); }); $('b-again').addEventListener('click', clockIn); $('b-share').addEventListener('click', share);
  $('b-set').addEventListener('click', function () { setOpen(true, this); });
  $('rank').addEventListener('click', function () { haptic('ui'); boardOpen(true); }); $('b-board').addEventListener('click', function () { haptic('ui'); boardOpen(true); }); $('b-board2').addEventListener('click', function () { haptic('ui'); boardOpen(true); });

  // ================= 1 コマ =================
  function frame(tn) {
    var dt = clamp((tn - lastT) / 1000, 0, 0.05); lastT = tn;
    if (st === 'PLAY') handle(game.advance(tn - T0 - (fake != null ? 0 : 24)));     // 24 ms 遅らせて進める(同じ瞬間に離した指を 先に数えるため)
    if (bossT && tn > bossT) { bossEl.classList.remove('on'); bossT = 0; }
    if (st === 'WAIT' && tn - endT > 1500) startBoil();
    if (st === 'OUT') { drill.away = Math.pow(clamp((tn - endT - (endKind === 'fired' ? 500 : 0)) / 600, 0, 1), 2); if (tn - endT > 1900) showResult(); }
    if (st === 'BOIL' && tn - boil.t0 > boil.end) showResult();
    if (st === 'MINI_END' && tn - endT > 1600) showResult();
    sx(fx); fx.clearRect(0, 0, W, H);
    if (st === 'CARD' && cardEnd) { /* 予約票: 店の写真だけ */ }
    else if (mini && st !== 'TITLE') (mini.kind === 'staple' ? stapleFrame : cutFrame)(tn, dt);
    else if (st === 'BOIL' || (st === 'RESULT' && boil)) drawBoil(tn, dt); else drawBench(tn, dt);
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
      if (x >= 0 && !contactSeen) { contactSeen = true; var p0 = screwPos(d, d.i); puff(ho.x + p0.x, ho.y + p0.y, 3, 90);
        if (!PROG.clear[0] && game.pulls <= 2) { hintEl.firstChild.textContent = T('音が低くなった = 皮に届いた。ここで離す', 'Pitch dropped = it hit the skin. Let go now.'); hintEl.classList.add('on'); } }   // 1 品目の はじめ 2 本だけ: 音が下がる理由を その場で言う
      if (tn - hapT > (x >= 0 ? 60 : 110)) { hapT = tn; haptic(x >= 0 ? 'load' : 'spin'); }
      sq.t = 1 - clamp(x, 0, 0.2) * 0.5;
    } else sq.t = 1;
    sq.step(dt);
    handA.t = (st === 'PLAY' || st === 'WAIT') && d && d.result != null && tn >= goT ? 1 : (st === 'OUT' && endKind === 'fired' ? 1 : 0); handA.step(dt); ho = handAt();
    // 皿の上の 打ち終わった餃子(斜めから見ている皿なので 縦をつぶす)
    for (i = 0; i < tray.length; i++) if (tray[i].shown) { var s = traySlot(i); c.save(); c.translate(s.x, s.y); c.scale(0.64, 0.6); c.rotate(s.rot);
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
      var e = ease(a * 2.2), yy = p.y - 46 * e; c.globalAlpha = a < 0.7 ? 1 : 1 - (a - 0.7) / 0.3; c.font = (JA ? '80px ' : '70px ') + FONT_POP; c.lineWidth = 14; c.strokeStyle = PAPER; c.strokeText(p.text, clamp(p.x, 150, W - 150), yy); c.fillStyle = p.col; c.fillText(p.text, clamp(p.x, 150, W - 150), yy); }
    c.globalAlpha = 1;
  }
  // 上の帯: 残り時間 / 左 = いくつ できたか(合格の数まで)/ 右 = ドリルの速さの札・破いた数
  function pill(c, x, y, w, h) { c.fillStyle = 'rgba(28,12,6,.74)'; rr(c, x, y, w, h, h / 2); c.fill(); }
  function drawHud(c, tn) {
    var D = STG[S], t = tn - T0 - (fake != null ? 0 : 24), y = Math.round(H * 0.045) + 16, i, left, tot, got, lab;
    if (D.kind === 'drill') { left = game.left(t); tot = game.TIME; got = game.closed; lab = T('閉めた', 'Shut'); }
    else { left = mini.g.left(t); tot = mini.g.cfg.time; got = D.kind === 'staple' ? mini.g.closed : mini.g.cuts; lab = D.kind === 'staple' ? T('留めた', 'Done') : T('細切り', 'Strips'); }
    var k = left / tot;
    c.fillStyle = 'rgba(28,12,6,.74)'; rr(c, 54, y - 6, 972, 30, 15); c.fill();
    if (k > 0.004) { c.fillStyle = k < 0.2 ? RED : PAPER; rr(c, 60, y, Math.max(18, 960 * k), 18, 9); c.fill(); }
    // できた数(合格の数に届くと 赤い地に)
    var ok = got >= D.quota, txt = lab + ' ' + got + ' / ' + D.quota;
    c.font = '900 40px ' + FONT_UI; var tw = c.measureText(txt).width;
    c.fillStyle = ok ? RED : 'rgba(28,12,6,.74)'; rr(c, 54, y + 36, tw + 48, 60, 30); c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(txt, 78, y + 68);
    if (D.kind !== 'drill') return;
    // ドリルの速さの札: 低速 / 高速 ×1.5(30 秒で 店が開くと 変わる。回している途中なら「次から高速」)
    var hiNow = game.gear() > 1, curHi = game.phase === 'drill' ? game.g0 > 1 : hiNow, pend = hiNow && !curHi;
    var lt = curHi ? T('高速 ×1.5', 'HIGH ×1.5') : pend ? T('次から高速', 'HIGH next') : T('低速', 'LOW');
    c.font = '900 38px ' + FONT_UI; var lw = c.measureText(lt).width + 56, lx = 1026 - lw;
    c.fillStyle = curHi ? RED : pend ? (Math.floor(tn / 180) % 2 ? RED : 'rgba(28,12,6,.74)') : 'rgba(28,12,6,.74)'; rr(c, lx, y + 36, lw, 60, 30); c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(lt, lx + lw / 2, y + 68);
    // 破いた数(3 つで 没収)
    for (i = 0; i < game.TEARS; i++) { var px = lx - 40 - i * 40, py = y + 66; c.fillStyle = i < game.tears ? RED : 'rgba(28,12,6,.5)'; c.beginPath(); c.arc(px, py, 14, 0, 7); c.fill(); if (i < game.tears) { c.strokeStyle = PAPER; c.lineWidth = 4; c.beginPath(); c.moveTo(px - 7, py - 7); c.lineTo(px + 7, py + 7); c.moveTo(px + 7, py - 7); c.lineTo(px - 7, py + 7); c.stroke(); } }
    // 店が開いた瞬間: 真ん中に「高速」の判(1.4 秒)
    var ha = (tn - hiFlash) / 1400;
    if (ha >= 0 && ha < 1) {
      var sc = ha < 0.15 ? lerp(1.6, 1, ease(ha / 0.15)) : 1, al = ha < 0.75 ? 1 : 1 - (ha - 0.75) / 0.25;
      c.save(); c.globalAlpha = al; c.translate(540, H * 0.36); c.scale(sc, sc); c.rotate(-0.06);
      c.fillStyle = RED; rr(c, -230, -96, 460, 192, 14); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 6; rr(c, -214, -80, 428, 160, 8); c.stroke();
      c.fillStyle = '#fff'; c.font = (JA ? '120px ' : '96px ') + FONT_POP; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(T('高速', 'HIGH'), 0, 6);
      c.restore();
    }
  }
  // ---- 茹でる ----
  function drawBoil(tn, dt) {
    var c = fx, b = boil, t = tn - b.t0, s = bgS(), i, g, py = Math.round(H * 0.3);
    var wx = bgX() + POTW.cx * s, wy = POTW.cy * s, rx = POTW.rx * s, ry = POTW.ry * s;
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
      if (opened) { var ok2 = ease((t - it.landT - 620) / 220), os = lerp(0.9, 1, ok2); c.scale(os, os); c.rotate(it.ph); var oh = 240 * img.dumpling_open.height / img.dumpling_open.width; c.drawImage(img.dumpling_open, -120, -oh / 2, 240, oh); }
      else { c.rotate(Math.sin(it.ph * 3) * 0.5); c.drawImage(it.cv, -105, -110, 210, 140); }
      c.restore();
    }
    // 湯気
    for (i = 0; i < 7; i++) { var sp = ((tn / 2600 + i / 7) % 1), sxp = wx + Math.sin(i * 1.9 + tn / 1700) * rx * 0.6, syp = wy - 40 - sp * 560, sr = 110 + sp * 150;
      g = c.createRadialGradient(sxp, syp, 0, sxp, syp, sr); g.addColorStop(0, 'rgba(255,255,255,' + 0.2 * Math.sin(sp * Math.PI) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(sxp - sr, syp - sr, sr * 2, sr * 2); }
    drawPops(c, tn);
    if (st === 'BOIL') {                              // 数え上げ
      var yy = Math.round(H * 0.2), lab = T('開かなかった', 'Stayed shut'), num = String(b.shut + (t > 600 ? b.extraShut : 0));   // 漆の札(壁の品書きの前)
      c.save(); c.shadowColor = 'rgba(20,4,0,.45)'; c.shadowBlur = 24; c.shadowOffsetY = 10; c.fillStyle = PAPER; rr(c, 330, yy - 250, 420, 300, 6); c.fill(); c.restore();
      c.fillStyle = RED; c.fillRect(330, yy - 250, 420, 14);
      c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.font = '700 46px ' + FONT_UI; c.fillStyle = INK; c.fillText(lab, 540, yy - 172);
      c.font = '900 168px ' + FONT_UI; c.fillStyle = RED; c.fillText(num, 540, yy + 2);
    }
  }

  // ================= 工具の絵(コードで描く。工具掛けと 2・3 面で 同じ形を使う)=================
  // どれも (0, 0) を中心に 幅 300 ほど。mode = 'real'(色・光)/ 'line'(工具掛けに 白で描いた 輪郭 = まだ持っていない)
  function lg(c, x0, y0, x1, y1, stops) { var g = c.createLinearGradient(x0, y0, x1, y1); stops.forEach(function (s) { g.addColorStop(s[0], s[1]); }); return g; }
  function rrP(x, y, w, h, r) { var p = new Path2D(); p.moveTo(x + r, y); p.arcTo(x + w, y, x + w, y + h, r); p.arcTo(x + w, y + h, x, y + h, r); p.arcTo(x, y + h, x, y, r); p.arcTo(x, y, x + w, y, r); p.closePath(); return p; }
  function polyP(pts) { var p = new Path2D(); p.moveTo(pts[0], pts[1]); for (var i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]); p.closePath(); return p; }
  var STEEL = [[0, '#f4f6f8'], [0.45, '#c3c9ce'], [0.55, '#9aa1a8'], [1, '#e1e5e8']], BLACK = [[0, '#4a4a4c'], [0.5, '#1d1d1f'], [1, '#0c0c0d']], TEAL = [[0, '#3cc2bd'], [0.45, '#14918d'], [1, '#0a5f5c']];
  // 部品 = [Path2D, 色の作り方(c) → style]
  function toolParts(k) {
    var P = [];
    if (k === 'drill') {          // 電動ドリル(横から。青緑の胴・黒い握りと チャック・角い電池)
      P.push([rrP(-78, 52, 118, 46, 8), function (c) { return lg(c, 0, 52, 0, 98, BLACK); }]);
      P.push([polyP([-62, -16, -14, -16, -22, 58, -66, 58]), function (c) { return lg(c, -66, 0, -14, 0, BLACK); }]);
      P.push([rrP(-130, -78, 190, 66, 30), function (c) { return lg(c, 0, -78, 0, -12, TEAL); }]);
      P.push([rrP(56, -70, 44, 50, 8), function (c) { return lg(c, 0, -70, 0, -20, BLACK); }]);
      P.push([rrP(100, -51, 74, 12, 3), function (c) { return lg(c, 0, -51, 0, -39, STEEL); }]);
      P.push([rrP(-14, -10, 14, 30, 5), function () { return '#1a1a1a'; }]);
    } else if (k === 'staple') {  // 大きい ホッチキス(横から。台・腕・頭)
      P.push([rrP(-150, 40, 300, 22, 8), function (c) { return lg(c, 0, 40, 0, 62, STEEL); }]);
      P.push([rrP(-150, 30, 90, 14, 4), function (c) { return lg(c, 0, 30, 0, 44, BLACK); }]);
      P.push([polyP([-146, -40, 120, -54, 150, -40, 150, 20, 120, 28, -146, 8]), function (c) { return lg(c, 0, -54, 0, 28, [[0, '#d23a2e'], [0.5, '#a41f16'], [1, '#6e120c']]); }]);
      P.push([rrP(-150, 4, 52, 30, 5), function (c) { return lg(c, 0, 4, 0, 34, STEEL); }]);
      P.push([rrP(118, -20, 36, 80, 10), function (c) { return lg(c, 118, 0, 154, 0, BLACK); }]);
    } else if (k === 'cut') {     // 金尺 + カッター
      P.push([rrP(-150, -70, 300, 30, 2), function (c) { return lg(c, 0, -70, 0, -40, STEEL); }]);
      P.push([polyP([60, 10, 150, 4, 150, 22, 60, 30]), function (c) { return lg(c, 0, 4, 0, 30, STEEL); }]);
      P.push([rrP(-130, 4, 196, 38, 12), function (c) { return lg(c, 0, 4, 0, 42, [[0, '#ffd84a'], [0.5, '#f0b81a'], [1, '#b07f0c']]); }]);
      P.push([rrP(-60, 0, 40, 12, 4), function () { return '#262626'; }]);
    } else if (k === 'caulk') {   // コーキングガン(輪郭だけ)
      P.push([rrP(-150, -40, 210, 44, 20), null]); P.push([rrP(60, -24, 80, 10, 3), null]); P.push([rrP(-130, 4, 30, 80, 10), null]); P.push([rrP(-92, 4, 24, 66, 10), null]);
    } else if (k === 'trowel') {  // 左官ごて
      P.push([polyP([-140, 10, 140, 10, 120, 40, -120, 40]), null]); P.push([rrP(-10, -40, 20, 52, 6), null]); P.push([rrP(-90, -70, 180, 34, 16), null]);
    } else {                      // 手回しドリル
      P.push([rrP(-150, -14, 300, 22, 8), null]); var w = new Path2D(); w.arc(10, 30, 56, 0, 7); P.push([w, null]); P.push([rrP(4, 30, 12, 70, 4), null]); P.push([rrP(-14, 90, 48, 22, 10), null]);
    }
    return P;
  }
  function drawTool(c, k, mode, alpha) {
    var P = toolParts(k);
    if (mode === 'line') { c.save(); c.globalAlpha = alpha == null ? 1 : alpha; c.lineJoin = 'round'; c.lineWidth = 5; c.strokeStyle = 'rgba(255,250,240,.82)'; c.fillStyle = 'rgba(255,250,240,.07)'; P.forEach(function (p) { c.fill(p[0]); c.stroke(p[0]); }); c.restore(); return; }
    c.save(); c.shadowColor = 'rgba(30,14,4,.5)'; c.shadowBlur = 16; c.shadowOffsetX = 6; c.shadowOffsetY = 10;
    P.forEach(function (p) { c.fillStyle = p[1] ? p[1](c) : '#888'; c.fill(p[0]); }); c.restore();
    P.forEach(function (p) { c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1.5; c.stroke(p[0]); });     // 部品の境目
    if (k === 'cut') {          // 金尺の目盛り
      c.strokeStyle = 'rgba(40,44,48,.75)'; c.lineWidth = 1.5; for (var x = -144; x <= 144; x += 6) { var L = (x + 144) % 30 === 0 ? 12 : 6; c.beginPath(); c.moveTo(x, -40); c.lineTo(x, -40 - L); c.stroke(); }
      c.strokeStyle = 'rgba(80,84,90,.6)'; for (var bx = 74; bx < 150; bx += 16) { c.beginPath(); c.moveTo(bx, 6); c.lineTo(bx + 6, 28); c.stroke(); }    // 刃の 折る線
    }
  }

  // ================= 工具掛け(肩書き・工具・各皿の最高)=================
  var boardEl = $('board'), pegc = $('pegc'), pg = pegc.getContext('2d'), boardSel = 0, promo = null, boardRAF = 0;
  var SLOTS = [];    // 6 枠(上 3 = 今ある注文、下 3 = この先)
  function boardOpen(on, promoStage) {
    if (!on) { if (boardEl.classList.contains('on')) { boardEl.classList.remove('on'); promo = null; } return; }
    audioOn(); boardEl.classList.add('on');
    boardSel = promoStage != null ? promoStage : (st === 'RESULT' ? S : Math.max(0, nextStage()));
    promo = promoStage != null ? { s: promoStage, t0: now(), from: promoFrom, flipped: false } : null;
    if (promo) { play('peg'); }
    $('b-close').textContent = promo ? T('つづける', 'Continue') : T('閉じる', 'Close');
    boardText(); if (!boardRAF) boardRAF = requestAnimationFrame(boardLoop);
    $('b-close').focus({ preventScroll: true });
  }
  function boardText() {
    var n = promo && !promo.flipped ? promo.from : lvNow();
    $('b-title').querySelector('b').textContent = T('工具掛け', 'Tool wall'); $('b-title').querySelector('span').textContent = 'Lv.' + (n + 1) + ' ' + T(LV[n][0], LV[n][1]);
    var ld = $('ladder'); ld.innerHTML = ''; LV.forEach(function (l, i) { var sp = document.createElement('span'); sp.textContent = T(l[0], l[1]); if (i <= n) sp.className = 'got'; if (i === n) sp.className = 'got now'; ld.appendChild(sp); });
    var i = boardSel, note = $('b-note'), bp = $('b-play');
    if (promo) { note.textContent = T(STG[promo.s].tool[0] + 'を 工具掛けに掛けた', 'Hung the ' + STG[promo.s].tool[1].toLowerCase() + ' on the wall'); bp.hidden = true; return; }
    bp.hidden = false;
    if (i < STG.length) {
      var D = STG[i]; note.textContent = T(D.tool[0] + '　' + D.dish[0] + (PROG.best[i] ? '  最高 ' + PROG.best[i] + ' ' + D.unit[0] : ''), D.tool[1] + ' — ' + D.dish[1] + (PROG.best[i] ? '  Best ' + PROG.best[i] : ''));
      bp.disabled = !unlocked(i); bp.textContent = unlocked(i) ? T('この注文をやる', 'Take this order') : T('前の注文に 合格すると 出る', 'Pass the order before');
      bp.style.opacity = unlocked(i) ? '' : '.45';
    } else { var F = FUTURE[i - STG.length]; note.textContent = T('準備中　' + F.dish[0] + '(' + F.tool[0] + ')', 'Coming soon — ' + F.dish[1] + ' (' + F.tool[1].toLowerCase() + ')'); bp.disabled = true; bp.style.opacity = '.45'; bp.textContent = T('宴会の日に', 'On banquet day'); }
  }
  function boardLoop() {
    boardRAF = 0; if (!boardEl.classList.contains('on')) return;
    var r = pegc.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 3), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (w < 10) { boardRAF = requestAnimationFrame(boardLoop); return; }
    if (pegc.width !== w || pegc.height !== h) { pegc.width = w; pegc.height = h; }
    var c = pg, BW = 900, BH = 900, k = w / BW, tn = now(); c.setTransform(k, 0, 0, h / BH, 0, 0);
    // 有孔ボード(茶色の板に 穴の列)
    c.fillStyle = lg(c, 0, 0, 0, BH, [[0, '#a8794e'], [1, '#8d6038']]); c.fillRect(0, 0, BW, BH);
    c.fillStyle = 'rgba(40,20,6,.55)'; for (var y = 24; y < BH; y += 36) for (var x = 18 + ((y / 36) % 2) * 0; x < BW; x += 36) { c.beginPath(); c.arc(x, y, 4.2, 0, 7); c.fill(); }
    if (promo && !promo.flipped && tn - promo.t0 > 950) { promo.flipped = true; play('promo'); haptic('promo'); boardText(); var sp = $('b-title').querySelector('span'); sp.classList.remove('flip'); void sp.offsetWidth; sp.classList.add('flip'); }
    for (var i = 0; i < 6; i++) {
      var col = i % 3, row = Math.floor(i / 3), cx = 150 + col * 300, cy = 140 + row * 450, isNow = i < STG.length, tk = isNow ? TOOLK[i] : FUTURE[i - STG.length].k, has = isNow && PROG.clear[i];
      if (i === boardSel && !promo) { c.strokeStyle = '#fff'; c.lineWidth = 6; rr(c, cx - 140, cy - 120, 280, 410, 10); c.stroke(); }
      // 釘 2 本
      [-70, 70].forEach(function (dx) { c.fillStyle = lg(c, 0, cy - 96, 0, cy - 70, STEEL); rr(c, cx + dx - 6, cy - 96, 12, 30, 5); c.fill(); });
      var drop = 0, sc = 0.82;
      if (promo && promo.s === i) { var a = (tn - promo.t0) / 700; drop = a < 1 ? -260 * Math.pow(1 - a, 2) * Math.cos(a * 9) : 0; }
      c.save(); c.translate(cx, cy + drop); c.scale(sc, sc);
      if (has || (promo && promo.s === i)) drawTool(c, tk, 'real'); else drawTool(c, tk, 'line', isNow && unlocked(i) ? 0.9 : 0.5);
      c.restore();
      if (!isNow) { c.fillStyle = 'rgba(255,250,240,.85)'; c.font = '900 92px ' + FONT_UI; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', cx, cy + 4); }
      // 紙の札(料理と 最高)
      c.save(); c.translate(cx, cy + 200); c.rotate((i % 2 ? 1 : -1) * 0.025);
      c.shadowColor = 'rgba(30,14,4,.4)'; c.shadowBlur = 10; c.shadowOffsetY = 5; c.fillStyle = isNow ? PAPER : 'rgba(251,247,239,.55)'; c.fillRect(-120, -50, 240, 112); c.shadowColor = 'transparent';
      c.fillStyle = RED; c.fillRect(-120, -50, 240, 8);
      c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = INK;
      var nm = isNow ? T(STG[i].dish[0], STG[i].dish[1]) : T(FUTURE[i - STG.length].dish[0], FUTURE[i - STG.length].dish[1]);
      c.font = '900 ' + (nm.length > 7 && JA ? 26 : JA ? 30 : 22) + 'px ' + FONT_UI; c.fillText(nm, 0, -6, 224);
      c.font = '700 26px ' + FONT_UI; c.fillStyle = has ? RED : 'rgba(35,26,20,.5)';
      c.fillText(isNow ? (has ? T('最高 ' + PROG.best[i] + ' ' + STG[i].unit[0], 'Best ' + PROG.best[i]) : unlocked(i) ? T('まだ', 'Not yet') : T('前の注文のあと', 'Locked')) : T('準備中', 'Soon'), 0, 38, 224);
      c.restore();
    }
    boardRAF = requestAnimationFrame(boardLoop);
  }
  pegc.addEventListener('pointerdown', function (e) {
    if (promo) { promo.t0 = -1e9; return; }                  // 昇格の場面は 押すと 先送り
    var r = pegc.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 900, y = (e.clientY - r.top) / r.height * 900, i = Math.min(2, Math.floor(x / 300)) + (y > 450 ? 3 : 0);
    boardSel = i; haptic('ui'); boardText();
  });
  $('b-close').addEventListener('click', function () { haptic('ui'); if (promo) { promo.t0 = -1e9; if (!promo.flipped) return; } boardOpen(false); if (st === 'TITLE') fillTitle(); });
  $('b-play').addEventListener('click', function () { if (boardSel < STG.length && unlocked(boardSel)) openCard(boardSel); });
  boardEl.addEventListener('pointerdown', function (e) { if (e.target === boardEl) { if (promo) promo.t0 = -1e9; else boardOpen(false); } });

  // ================= 2 面: ホッチキスで 春巻を 3 か所 留める(奥の厨房)=================
  var GT = window.GZTools, RV = 0.32;                  // 春巻が流れる速さ(px/ms)
  function kitchenPlate() { var s = bgS(); return { x: bgX() + 600 * s, y: 1310 * s, rx: 300 * s, ry: 226 * s }; }   // 厨房の写真の 大皿(目で測った値)
  function stapleStart(sd) { return { kind: 'staple', g: new GT.Staple(sd), arm: new Spring(900, 30, 0), staples: {}, fly: [], plate: [], off: [], endAt: 0 }; }
  function stapleY() { return Math.round(H * 0.83); }
  var MX = 380;                                        // ホッチキスの口の x
  function markX(m, t) { return MX + (t - m.at) * RV; }
  function rollSpan(r, t) { var xs = r.marks.map(function (m) { return markX(m, t); }); return { a: Math.min.apply(null, xs) - 118, b: Math.max.apply(null, xs) + 118 }; }
  function drawRoll(c, r, a, b, y, R, t, st0) {        // 春巻 1 本(横に寝た筒)。a・b = 左右の端、y = 中心
    var len = b - a;
    c.save(); c.fillStyle = 'rgba(30,20,10,.32)'; c.beginPath(); c.ellipse((a + b) / 2 + 10, y + R * 0.95, len / 2 + 6, R * 0.32, 0, 0, 7); c.fill(); c.restore();
    var body = rrP(a, y - R, len, R * 2, R * 0.92);
    c.save(); c.fillStyle = lg(c, 0, y - R, 0, y + R, [[0, '#f7ead0'], [0.3, '#ecd7a8'], [0.75, '#cfae74'], [1, '#9d7b46']]); c.fill(body); c.clip(body);
    var rn = G.rng(r.id * 31 + 7);                     // 皮から うっすら 透ける具(にら・豚)
    for (var i = 0; i < 9; i++) { c.fillStyle = rn() < 0.5 ? 'rgba(96,128,64,.18)' : 'rgba(190,120,100,.14)'; c.beginPath(); c.ellipse(a + 30 + rn() * (len - 60), y + (rn() - 0.3) * R * 0.9, 26 + rn() * 40, 7 + rn() * 8, (rn() - 0.5) * 0.4, 0, 7); c.fill(); }
    c.strokeStyle = 'rgba(150,112,60,.35)'; c.lineWidth = 2; for (var fx = a + 14; fx < a + 54; fx += 13) { c.beginPath(); c.moveTo(fx, y - R); c.lineTo(fx - 16, y + R); c.stroke(); } for (var gx = b - 14; gx > b - 54; gx -= 13) { c.beginPath(); c.moveTo(gx, y - R); c.lineTo(gx + 16, y + R); c.stroke(); }
    c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(a, y - R * 0.72, len, R * 0.12);                  // 上の光
    c.restore();
    var sy = y - R * 0.42;                             // とじ目(皮の重なり)
    c.strokeStyle = 'rgba(140,104,56,.55)'; c.lineWidth = 3; c.beginPath(); c.moveTo(a + R * 0.6, sy); c.lineTo(b - R * 0.6, sy); c.stroke();
    c.strokeStyle = 'rgba(255,248,230,.6)'; c.lineWidth = 2; c.beginPath(); c.moveTo(a + R * 0.6, sy - 3); c.lineTo(b - R * 0.6, sy - 3); c.stroke();
    for (var k = 0; k < r.marks.length; k++) {
      var m = r.marks[k], mx = a + (len / 2) + (st0 ? st0[k] : markX(m, t) - (a + b) / 2);
      if (m.hit === 'hit' || m.hit === 'perfect') {   // 針(銀の コの字)
        c.fillStyle = 'rgba(90,60,24,.4)'; c.fillRect(mx - 22, sy + 1, 46, 9);                                  // 針が 皮を 押さえた へこみ
        c.fillStyle = lg(c, 0, sy - 6, 0, sy + 3, STEEL); c.fillRect(mx - 23, sy - 6, 46, 8); c.fillStyle = '#5c6268'; c.fillRect(mx - 23, sy - 6, 5, 12); c.fillRect(mx + 18, sy - 6, 5, 12);
      } else {                                         // 朱の印(鉛筆の チョン + 点)
        c.strokeStyle = m.hit === 'miss' ? 'rgba(120,90,60,.6)' : RED; c.lineWidth = 8; c.lineCap = 'round'; c.beginPath(); c.moveTo(mx, sy - 24); c.lineTo(mx, sy + 20); c.stroke(); c.lineCap = 'butt';
      }
    }
    if (r.result === 'spoiled') {                      // はみ出た具
      c.fillStyle = '#7f9c4e'; c.beginPath(); c.ellipse(b + 6, y + 6, 26, 18, 0.3, 0, 7); c.fill(); c.fillStyle = '#b98f78'; c.beginPath(); c.ellipse(b - 4, y + 18, 20, 14, -0.2, 0, 7); c.fill();
      c.fillStyle = '#7f9c4e'; c.beginPath(); c.ellipse(a - 4, y + 10, 18, 13, 0.5, 0, 7); c.fill();
    }
  }
  function drawStaplerBase(c, y, R) {                 // 台(奥へ のびる 鉄の板。春巻は この上を 流れる = 春巻より先に描く)
    c.fillStyle = lg(c, 0, y - R - 300, 0, y + R + 20, [[0, '#7d848b'], [1, '#c9ced3']]); c.fill(polyP([MX - 70, y - R - 300, MX + 70, y - R - 300, MX + 120, y + R + 22, MX - 120, y + R + 22]));
    c.fillStyle = '#3a3d41'; c.fillRect(MX - 26, y + R - 2, 52, 10);                                              // 金床(針を 曲げる くぼみ)
  }
  function drawStapler(c, y, R, down) {               // 大きい ホッチキスを 手前から見る(腕は 奥へ のびて、頭の顔が こちらを向く)。down = 0〜1 押した量
    var hy = y - R - 10 + down * 34, bw = 200;           // hy = 頭の下の辺
    // 腕(赤い琺瑯。奥ほど 細く・高く)
    var arm = polyP([MX - bw / 2 - 6, hy - 104, MX - 60, y - R - 330, MX + 60, y - R - 330, MX + bw / 2 + 6, hy - 104]);
    c.save(); c.shadowColor = 'rgba(20,8,2,.45)'; c.shadowBlur = 26; c.shadowOffsetY = 16; c.fillStyle = lg(c, MX - 80, 0, MX + 80, 0, [[0, '#6a110b'], [0.3, '#c32a1f'], [0.55, '#e0473a'], [1, '#7c140d']]); c.fill(arm); c.restore();
    c.fillStyle = 'rgba(255,255,255,.28)'; c.fill(polyP([MX - 30, hy - 110, MX - 14, y - R - 322, MX - 4, y - R - 322, MX - 8, hy - 110]));
    c.fillStyle = lg(c, 0, y - R - 360, 0, y - R - 310, BLACK); c.fill(rrP(MX - 66, y - R - 360, 132, 46, 18));      // 奥の 蝶番
    // 頭(こちらを向いた 顔。赤い丸い 打ち面 + 鉄の口)
    c.save(); c.shadowColor = 'rgba(20,8,2,.5)'; c.shadowBlur = 20; c.shadowOffsetY = 14;
    c.fillStyle = lg(c, 0, hy - 130, 0, hy, [[0, '#e4503f'], [0.45, '#b72519'], [1, '#6e120c']]); c.fill(rrP(MX - bw / 2 - 10, hy - 130, bw + 20, 104, 34)); c.restore();
    c.fillStyle = 'rgba(255,255,255,.3)'; c.fill(rrP(MX - bw / 2 + 10, hy - 122, bw - 20, 16, 8));
    c.fillStyle = lg(c, 0, hy - 40, 0, hy, STEEL); c.fill(rrP(MX - bw / 2 + 6, hy - 42, bw - 12, 42, 8));               // 口の鉄板
    c.fillStyle = '#26282b'; c.fillRect(MX - 28, hy - 8, 56, 8);                                                          // 針の出口
  }
  function stapleFrame(tn, dt) {
    var M = mini, g = M.g, t = tn - T0 - (fake != null ? 0 : 24), y = stapleY(), c = fx, i;
    if (st === 'MINI') handleMini(g.advance(t));
    var down = M.arm.step(dt);
    // 皿(写真の大皿)の上の 留まった春巻
    for (i = 0; i < M.plate.length; i++) { var p = M.plate[i]; c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.scale(0.5, 0.5); drawRoll(c, p.r, -p.len / 2, p.len / 2, 0, p.R, 0, p.st); c.restore(); }
    // 台の上を 流れる春巻
    drawStaplerBase(c, y, 78);
    for (i = 0; i < g.rolls.length; i++) {
      var r = g.rolls[i], R = r.thick ? 92 : 78; if (r.gone && r.result === 'closed') continue;
      var sp = rollSpan(r, t); if (sp.a > W + 40) continue; drawRoll(c, r, sp.a, sp.b, y, R, t);
    }
    // 皿へ 飛んでいく春巻
    for (i = M.fly.length - 1; i >= 0; i--) { var f = M.fly[i], a = clamp((tn - f.t0) / 520, 0, 1), e = ease(a), fxp = lerp(f.x0, f.x1, e), fyp = lerp(f.y0, f.y1, e) - Math.sin(a * Math.PI) * 220, s = lerp(1, 0.5, e);
      c.save(); c.translate(fxp, fyp); c.rotate(f.rot * e); c.scale(s, s); drawRoll(c, f.r, -f.len / 2, f.len / 2, 0, f.R, 0, f.st); c.restore();
      if (a >= 1) { M.plate.push({ r: f.r, x: f.x1, y: f.y1, rot: f.rot, len: f.len, R: f.R, st: f.st }); M.fly.splice(i, 1); play('plate'); haptic('plate'); } }
    drawStapler(c, y, 78, clamp(down, 0, 1.3));
    drawPops(c, tn); if (st === 'MINI' || st === 'MINI_END') drawHud(c, tn);
  }
  function handleMini(evs) { for (var i = 0; i < evs.length; i++) (mini.kind === 'staple' ? stapleEv : cutEv)(evs[i]); }
  function stapleEv(e) {
    var M = mini, y = stapleY();
    if (e.type === 'spawn') play('roll');
    else if (e.type === 'judge') {
      if (e.grade === 'perfect' || e.grade === 'hit') { play('staple'); haptic('staple'); M.arm.x = 1.15; M.arm.v = 0; pop(e.grade === 'perfect' ? T('ぴたっ', 'Dead on!') : T('ばちん', 'Snap'), MX + 230, y - 250, e.grade === 'perfect' ? RED : INK); puff(MX, y - 30, 3, 80); hintEl.classList.remove('on'); }
      else if (e.grade === 'air') { play('air'); haptic('air'); M.arm.x = 1.15; M.arm.v = 0; pop(T('スカッ', 'Missed'), MX + 230, y - 250); hintEl.classList.remove('on'); }
      else pop(T('おそい', 'Too late'), MX + 230, y - 250);
    } else if (e.type === 'roll') { if (e.result === 'spoiled') { play('spoil'); haptic('loose'); var sp = rollSpan(e.roll, e.t); pop(T('具がはみ出た', 'Burst!'), clamp((sp.a + sp.b) / 2, 200, 880), y + 170, RED); } }
    else if (e.type === 'leave' && e.roll.result === 'closed') {
      var r = e.roll, s = rollSpan(r, e.t), n = M.plate.length + M.fly.length, P = kitchenPlate(), col = n % 3, row = Math.floor(n / 3) % 3, R = r.thick ? 92 : 78;
      var st0 = r.marks.map(function (m) { return markX(m, e.t) - (s.a + s.b) / 2; });
      M.fly.push({ r: r, t0: now(), x0: (s.a + s.b) / 2, y0: y, x1: P.x + (col - 1) * P.rx * 0.5 + row * 18, y1: P.y - P.ry * 0.35 + row * P.ry * 0.32, rot: (col - 1) * 0.08 - 0.12, len: s.b - s.a, R: R, st: st0 }); play('slide');
    } else if (e.type === 'stage') { play('boss'); say(T('常連「端まで 具を 入れて！ 太巻きで」', 'Regular: "Fill them to the ends! Fat ones!"'), 2400); bgmLayer(1); }
    else if (e.type === 'timeup') play('whistle');
    else if (e.type === 'end') finishMini(e.kind);
  }

  // ================= 3 面: 金尺に カッターを当てて 干し豆腐を 細切り(奥の厨房)=================
  function cutY() { return Math.round(H * 0.77); }
  function cutStart(sd) { return { kind: 'cut', g: new GT.Cut(sd), sheetAt: 0, strips: [], plate: [], fly: [], cuts: [], last: null, spd: 0, tex: null, sheetIn: -1e9 }; }
  function sheetTex() {                                // 干し豆腐の板(布目)を 一度焼く
    var cv = mk(640, 640), c = cv.getContext('2d'), rn = G.rng(5), i;
    c.fillStyle = lg(c, 0, 0, 640, 640, [[0, '#f1e3bd'], [0.5, '#e8d6a6'], [1, '#ddc78f']]); c.fillRect(0, 0, 640, 640);
    c.globalAlpha = 0.2; c.strokeStyle = '#b89a5c'; c.lineWidth = 1; for (i = 0; i < 640; i += 5) { c.beginPath(); c.moveTo(i + rn() * 2, 0); c.lineTo(i + rn() * 2, 640); c.stroke(); c.beginPath(); c.moveTo(0, i + rn() * 2); c.lineTo(640, i + rn() * 2); c.stroke(); }
    c.globalAlpha = 1; for (i = 0; i < 40; i++) { c.fillStyle = 'rgba(160,120,60,' + (0.05 + rn() * 0.08) + ')'; c.beginPath(); c.ellipse(rn() * 640, rn() * 640, 10 + rn() * 40, 6 + rn() * 20, rn() * 3, 0, 7); c.fill(); }
    return cv;
  }
  function drawRuler(c, a, b, side) {                  // 金尺(切る線 = 尺の縁。尺は 線の 片側に寝る)
    var ang = Math.atan2(b.y - a.y, b.x - a.x), L = Math.hypot(b.x - a.x, b.y - a.y);
    c.save(); c.translate(a.x, a.y); c.rotate(ang);
    c.fillStyle = 'rgba(30,20,10,.3)'; c.fillRect(-40, side * 4 + 6, L + 80, side * 46);
    c.fillStyle = lg(c, 0, 0, 0, side * 44, STEEL); c.fillRect(-40, 0, L + 80, side * 44);
    c.strokeStyle = 'rgba(30,34,38,.8)'; c.lineWidth = 1.6;
    for (var x = 0; x <= L + 30; x += 10) { var l = x % 100 === 0 ? 18 : x % 50 === 0 ? 13 : 7; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, side * l); c.stroke(); }
    c.fillStyle = 'rgba(30,34,38,.85)'; c.font = '700 15px ' + FONT_UI; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (var n = 100; n <= L; n += 100) c.fillText(String(n / 10), n, side * 30);
    c.restore();
  }
  function drawCutter(c, x, y, ang, k) {               // カッター(黄色の柄 + 折れる刃)。(x, y) = 刃先
    c.save(); c.translate(x, y); c.rotate(ang); c.scale(k, k);
    c.fillStyle = 'rgba(30,20,10,.3)'; c.beginPath(); c.ellipse(-150, 26, 130, 16, 0, 0, 7); c.fill();
    c.fillStyle = lg(c, 0, -6, 0, 8, STEEL); c.fill(polyP([0, 0, -64, -10, -64, 14, -6, 6]));
    c.fillStyle = lg(c, 0, -20, 0, 22, [[0, '#ffd84a'], [0.5, '#f0b81a'], [1, '#a87808']]); c.fill(rrP(-260, -20, 200, 40, 12));
    c.fillStyle = '#262626'; c.fillRect(-150, -24, 36, 10);
    c.restore();
  }
  function cutFrame(tn, dt) {
    var M = mini, g = M.g, t = tn - T0 - (fake != null ? 0 : 24), cy = cutY(), c = fx, i, L;
    if (st === 'MINI') handleMini(g.advance(t));
    if (!M.tex) M.tex = sheetTex();
    // 皿の上の 細切り(山になっていく)
    var P = kitchenPlate();
    for (i = 0; i < M.plate.length; i++) { var q = M.plate[i]; c.strokeStyle = q.col; c.lineWidth = 9; c.lineCap = 'round'; c.beginPath(); c.moveTo(P.x + q.x0 * P.rx, P.y + q.y0 * P.ry); c.quadraticCurveTo(P.x + q.cx * P.rx, P.y + q.cy * P.ry, P.x + q.x1 * P.rx, P.y + q.y1 * P.ry); c.stroke(); c.strokeStyle = 'rgba(120,90,40,.35)'; c.lineWidth = 2; c.stroke(); } c.lineCap = 'butt';
    // 板(区間が変わると 新しい板が 右から すべってくる)
    var ph = g.phase(), ang = ph.dir === 'h' ? 0 : ph.dir === 'v' ? Math.PI / 2 : Math.PI / 4, sIn = clamp((tn - M.sheetIn) / 420, 0, 1), sx0 = (1 - ease(sIn)) * 900;
    c.save(); c.translate(540 + sx0, cy); c.rotate(ang);
    c.fillStyle = 'rgba(30,20,10,.3)'; c.fillRect(-312, -306, 640, 640);
    var S0 = 300; c.drawImage(M.tex, -S0, -S0, S0 * 2, S0 * 2);
    c.strokeStyle = 'rgba(110,80,40,.7)'; c.lineWidth = 2.5; for (i = 0; i < M.cuts.length; i++) { c.beginPath(); c.moveTo(-S0, M.cuts[i]); c.lineTo(S0, M.cuts[i]); c.stroke(); }
    c.restore();
    // 金尺(次に切る所)
    L = g.line(cy); var ready = g.ready(t) && st === 'MINI', s = g.stroke;
    if (sIn >= 1) drawRuler(c, L.a, L.b, -1);
    if (ready && !s && sIn >= 1) {                       // 引きはじめの所(両端)
      var pu = 0.5 + 0.5 * Math.sin(tn / 160);
      [L.a, L.b].forEach(function (p) { c.strokeStyle = 'rgba(200,36,27,' + (0.5 + 0.5 * pu) + ')'; c.lineWidth = 6; c.beginPath(); c.arc(p.x, p.y, 30 + pu * 8, 0, 7); c.stroke(); });
    }
    // 引いている間: 刃の通った跡 + カッター
    var la = Math.atan2(L.b.y - L.a.y, L.b.x - L.a.x);
    if (s && M.last) {
      var dx = s.to.x - s.from.x, dy = s.to.y - s.from.y, LL = Math.hypot(dx, dy), u = clamp(((M.last.x - s.from.x) * dx + (M.last.y - s.from.y) * dy) / (LL * LL), 0, 1);
      c.strokeStyle = s.dev > g.cfg.devOk ? 'rgba(200,36,27,.9)' : 'rgba(80,56,24,.85)'; c.lineWidth = 3; c.beginPath(); s.pts.forEach(function (p, j) { if (j) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }); c.stroke();
      drawCutter(c, M.last.x, M.last.y, Math.atan2(dy, dx) + Math.PI, 0.9);
      M.spd = M.spd * 0.7 + 0.3 * (M.lastV || 0); cutSound(M.spd);
    } else { cutSound(0); if (sIn >= 1 && st === 'MINI') drawCutter(c, L.a.x - 6, L.a.y + 40, la + Math.PI + 0.25, 0.8); }
    // 皿へ飛ぶ 細切り / 捨てる 切れ端
    for (i = M.fly.length - 1; i >= 0; i--) { var f = M.fly[i], a = clamp((tn - f.t0) / 560, 0, 1), e = ease(a);
      var x = lerp(f.x0, f.x1, e), y = lerp(f.y0, f.y1, e) - Math.sin(a * Math.PI) * 180;
      c.save(); c.translate(x, y); c.rotate(f.ang + f.spin * e); c.fillStyle = f.bad ? '#c9b07a' : '#ead8a8'; c.strokeStyle = 'rgba(120,90,40,.5)'; c.lineWidth = 2;
      c.beginPath(); if (f.bad) { c.moveTo(-f.len / 2, -8); c.lineTo(-f.len / 6, 10); c.lineTo(f.len / 6, -14); c.lineTo(f.len / 2, 6); c.lineTo(f.len / 2, 18); c.lineTo(-f.len / 2, 10); } else c.rect(-f.len / 2 * (1 - 0.4 * e), -8, f.len * (1 - 0.4 * e), 16); c.fill(); c.stroke(); c.restore();
      if (a >= 1) { if (!f.bad) { var rn = Math.random; M.plate.push({ x0: -0.55 + rn() * 0.3, y0: -0.4 + rn() * 0.6, cx: -0.1 + rn() * 0.2, cy: -0.5 + rn() * 0.7, x1: 0.25 + rn() * 0.3, y1: -0.3 + rn() * 0.6, col: ['#ecdcb0', '#e4d09c', '#f0e2bc'][M.plate.length % 3] }); play('plate'); } M.fly.splice(i, 1); } }
    drawPops(c, tn); if (st === 'MINI' || st === 'MINI_END') drawHud(c, tn);
  }
  function cutEv(e) {
    var M = mini, g = M.g, cy = cutY();
    if (e.type === 'start') { hintEl.classList.remove('on'); haptic('trigger'); }
    else if (e.type === 'judge') {
      var mxp = (e.from ? (e.from.x + e.to.x) / 2 : 540), myp = (e.from ? (e.from.y + e.to.y) / 2 : cy), ang = e.from ? Math.atan2(e.to.y - e.from.y, e.to.x - e.from.x) : 0, len = e.from ? Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y) : 400;
      var P = kitchenPlate();
      if (e.grade === 'perfect' || e.grade === 'good') {
        play('cutEnd'); haptic('cut'); pop(e.grade === 'perfect' ? T('ぴたっ', 'Dead straight!') : T('よし', 'OK'), clamp(mxp, 200, 880), myp - 120, e.grade === 'perfect' ? RED : INK);
        M.fly.push({ t0: now(), x0: mxp, y0: myp, x1: P.x + (Math.random() - 0.5) * P.rx * 0.6, y1: P.y + (Math.random() - 0.5) * P.ry * 0.5, ang: ang, spin: (Math.random() - 0.5) * 0.8, len: len, bad: false });
        var an = M.g.stage === 0 ? 0 : M.g.stage === 1 ? Math.PI / 2 : Math.PI / 4; M.cuts.push(-(mxp - 540) * Math.sin(an) + (myp - cy) * Math.cos(an));   // 切った所に 線が残る(板の向きで)
      } else if (e.grade === 'crooked' || e.grade === 'ripped') {
        play(e.grade === 'ripped' ? 'rip' : 'crook'); haptic('loose'); pop(e.grade === 'ripped' ? T('ちぎれた', 'Ripped') : T('曲がった', 'Crooked'), clamp(mxp, 200, 880), myp - 120, RED);
        M.fly.push({ t0: now(), x0: mxp, y0: myp, x1: W + 200, y1: myp + 300, ang: ang, spin: 2.4, len: len * 0.8, bad: true });
      } else { play('loose'); pop(e.grade === 'cut_short' && e.dur > g.cfg.maxMs ? T('のろい', 'Too slow') : T('切れてない', 'Not through'), clamp(mxp, 200, 880), myp - 120); }
      cutSound(0);
    } else if (e.type === 'miss_start') { /* 尺の端から外れた所を 押した: 何もしない */ }
    else if (e.type === 'stage') { play('boss'); M.sheetIn = now(); M.cuts = []; if (e.stage === 1) { say(T('幹事「取り分けやすい 長さで！」 → 縦に切る', 'Host: "Shorter, easier to share!" → cut down'), 2400); bgmLayer(1); } else { say(T('大将「最後は 斜め切りや」', 'Chef: "Finish with a bias cut."'), 2400); bgmLayer(2); hiFlash = now(); } }
    else if (e.type === 'timeup') { play('whistle'); cutSound(0); }
    else if (e.type === 'end') { cutSound(0); finishMini(e.kind); }
  }
  function finishMini(kind) { endKind = kind; endT = now(); st = 'MINI_END'; hintEl.classList.remove('on'); if (kind === 'idle') { play('over'); } }
  // 2・3 面の 指(画面の座標 → 舞台の座標)
  function stageXY(e) { var r = cFx.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; }
  function miniDown(t, p) { audioOn(); if (st !== 'MINI') return; if (mini.kind === 'staple') handleMini(mini.g.tap(t - T0)); else { handleMini(mini.g.down(t - T0, p.x, p.y, cutY())); mini.last = p; mini.lastT = t; mini.lastV = 0; } }
  function miniMove(t, p) { if (st !== 'MINI' || mini.kind !== 'cut' || !mini.g.stroke) return; mini.g.move(t - T0, p.x, p.y); var dtm = Math.max(1, t - (mini.lastT || t)); mini.lastV = Math.hypot(p.x - mini.last.x, p.y - mini.last.y) / dtm * 1000; mini.last = p; mini.lastT = t; }
  function miniUp(t, p) { if (st !== 'MINI' || mini.kind !== 'cut') return; handleMini(mini.g.up(t - T0, p.x, p.y)); mini.last = null; }

  // ---- 起動 ----
  function loop() { frame(now()); requestAnimationFrame(loop); }
  window.addEventListener('resize', layout);
  Promise.all(['shop', 'shop_pot', 'kitchen', 'dumpling', 'dumpling_open', 'hand', 'hand_thin', 'hand_torn', 'head', 'drill', 'screw', 'drill_side'].map(function (n) { return load(n, 'assets/' + n + '.webp'); }).concat(document.fonts ? [
      document.fonts.load('40px "Potta"', '餃子とドリルぴたっDumplings&Drill').catch(function () {}), document.fonts.load('40px "YujiSyuku"', '餃子麻婆豆腐').catch(function () {}),
      Promise.all(['500', '700', '900'].map(function (w) { return document.fonts.load(w + ' 40px "ZenKaku"', '餃子0123Aa'); })).catch(function () {})] : [])).then(function () {
    ['hand', 'hand_thin', 'hand_torn'].forEach(function (n) { spr[n] = bake(img[n], HS, 34, 30); }); spr.drill = bake(img.drill, DRL_F.ds, 30, 34); spr.drill_side = bake(img.drill_side, DRL_S.ds, 30, 34);
    ready = true; layout(); lastT = now();
    titleEl.querySelector('h1').innerHTML = T('餃子<span class="to">と</span><br>ドリル', 'Dumplings<br>&amp; Drill');   // 題字 = Potta One(町中華の手描き看板)
    if (!JA) titleEl.classList.add('en');
    buildSettings(); toTitle(); requestAnimationFrame(loop);
    if (Q.get('stage')) S = +Q.get('stage') - 1;          // 検査用: ?stage=N で その面の伝票から
  });

  // 検査用の のぞき窓
  window.__gz = {
    get state() { return st; }, get game() { return game; }, get T0() { return T0; }, get endKind() { return endKind; }, get boil() { return boil; },
    get audio() { return AC ? { state: AC.state, rate: AC.sampleRate } : null; }, get drillSnd() { return drillSnd; },
    get settings() { return SET; }, get S() { return S; }, set S(v) { S = v; }, get mini() { return mini; }, cutY: function () { return cutY(); }, get prog() { return PROG; }, openCard: openCard, boardOpen: boardOpen, toTitle: toTitle,
    tap: function (x, y) { miniDown(now(), { x: x, y: y }); }, move: function (x, y) { miniMove(now(), { x: x, y: y }); }, lift: function (x, y) { miniUp(now(), { x: x, y: y }); }, get bgm() { return { on: BGM.on, step: BGM.step, layer: BGM.layer, tempo: BGM.tempo, gain: bgmBus ? bgmBus.gain.value : null, sfxGain: sfx ? sfx.gain.value : null }; }, setOpen: setOpen,
    soundLog: soundLog, hapticLog: hapticLog, clockIn: clockIn, press: function () { press(now()); }, release: function () { release(now()); },
    setFake: function (t) { fake = t; lastT = t == null ? performance.now() : t; }, get fake() { return fake; },
    step: function (ms, each) { each = each || 16; for (var e = 0; e < ms - 1e-6; e += each) { fake += Math.min(each, ms - e); frame(fake); } },
    peak: function () { if (!analyser) return 0; var d = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(d); var m = 0; for (var i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); return m; },
    loud: function () { if (!analyser) return null; var d = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(d); var bi = 0; for (var i = 1; i < d.length; i++) if (d[i] > d[bi]) bi = i; return { hz: Math.round(bi * AC.sampleRate / analyser.fftSize), level: d[bi] }; }
  };
})();
