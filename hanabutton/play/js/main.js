// 鼻ボタン(2 版め): 画面・さわり心地・音・ふるえ・進行。遊びの式は game.js。
// 構図: 真上から。パッドが犬の顔(目とおでこ)を隠し、パッドの下のふちの くぼみ から 鼻が出ている。鼻 = スティック。
(function () {
  'use strict';
  var G = window.HBGame, Q = new URLSearchParams(location.search);
  var JA = (Q.get('lang') || navigator.language || 'ja').toLowerCase().indexOf('ja') === 0;
  function T(ja, en) { return JA ? ja : en; }
  document.documentElement.lang = JA ? 'ja' : 'en';
  document.title = T('鼻ボタン', 'Nose Button');

  // ---- 絵の実測(assets/meta.json と同じ数字。tools/make_assets.py が測る)----
  var DOG = { w: 1080, h: 1920, nose: [568, 800], rx: 108, ry: 76 };
  var PAD = { w: 1200, h: 473, lcd: [382, 100, 817, 375] };
  var THUMB = { w: 900, h: 1015, pad: [118, 120] };      // 指の腹(ここが鼻に乗る)
  var PAD_W = 1010;                                      // 犬の絵 1.0 倍のときのパッドの幅
  var EDGE = 0.72, NOTCH = 24;                           // パッドの下のふち = 鼻の中心から 鼻の高さ × 0.72 上 / くぼみ = 鼻の幅 + 24 の円
  var NOSE_VIS = 22;                                     // 倒しきった時に 鼻が ずれる幅(写真の px)。小さなゴムのスティック。口までは伸ばさない
  var LAND_TOP = 320, LAND_BOT = 1060;                   // スマホ横: 写真の この縦の範囲を 画面の高さに合わせる(パッドの上 〜 口の下)

  // ---- 舞台(縦の画面 = 幅 1080・高さは画面で決まる / スマホ横 = 高さ 1080・幅は画面で決まる)----
  var W = 1080, H = 1920, U = 1, DPR = 1, ps = 1.06, RS = 150, imgY = 0, LAND = false;
  var mqLand = window.matchMedia('(pointer: coarse) and (orientation: landscape) and (max-height: 540px)');
  var mqRot = window.matchMedia('(pointer: coarse) and (orientation: portrait) and (max-width: 540px)');
  var nose = { x: 540, y: 850 }, pad = { x: 0, y: 0, w: 0, h: 0, k: 1 }, lcd = { x: 0, y: 0, w: 0, h: 0, k: 1 };
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), cGl = $('gl'), cPad = $('pad'), cFx = $('fx');
  var fx = cFx.getContext('2d'), pd = cPad.getContext('2d');
  var gl = cGl.getContext('webgl', { premultipliedAlpha: true, alpha: false, antialias: false });
  var img = {}, ready = false;
  var INK = '#3a2819', PAPER = '#fff8ec', WARN = '#a8432a';
  var FONT = '"ZenMaru","Hiragino Maru Gothic ProN","Hiragino Sans",system-ui,sans-serif';

  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight, cw;
    LAND = mqLand.matches || Q.get('land') === '1';
    document.body.classList.toggle('land', LAND);
    if (LAND) {                                          // スマホ横: 画面いっぱい。写真の左右の外は 鏡うつしで埋める(シェーダ)
      cw = vw; H = 1080; W = Math.round(H * vw / vh); U = vh / H;
      ps = H / (LAND_BOT - LAND_TOP); imgY = LAND_TOP * ps;
    } else {                                             // 縦の画面・PC: 縦の柱(いままでどおり)
      cw = Math.min(vw, vh * 0.62); W = 1080;
      H = Math.max(1500, Math.min(2500, Math.round(W * vh / cw))); U = cw / W;
      ps = Math.max(1.06, H / DOG.h); imgY = 0;
    }
    DPR = Math.min(window.devicePixelRatio || 1, 3);
    stage.style.width = cw + 'px'; stage.style.height = vh + 'px'; stage.style.setProperty('--u', U + 'px');
    [cGl, cPad, cFx].forEach(function (c) { c.width = Math.round(cw * DPR); c.height = Math.round(vh * DPR); });
    nose.x = W / 2; nose.y = DOG.nose[1] * ps - imgY;
    pad.k = PAD_W * ps / PAD.w; pad.w = PAD.w * pad.k; pad.h = PAD.h * pad.k;
    pad.x = nose.x - pad.w / 2; pad.y = nose.y - DOG.ry * ps * EDGE - pad.h;
    lcd.k = pad.k; lcd.x = pad.x + PAD.lcd[0] * pad.k; lcd.y = pad.y + PAD.lcd[1] * pad.k; lcd.w = (PAD.lcd[2] - PAD.lcd[0]) * pad.k; lcd.h = (PAD.lcd[3] - PAD.lcd[1]) * pad.k;
    cPad.style.transformOrigin = (nose.x / W * 100) + '% ' + ((pad.y + pad.h) / H * 100) + '%';
    if (ready) drawPad();
  }
  function sx(c) { c.setTransform(cFx.width / W, 0, 0, cFx.height / H, 0, 0); }

  function Spring(k, c, v) { this.k = k; this.c = c; this.x = v || 0; this.v = 0; this.t = v || 0; }
  Spring.prototype.step = function (dt) { var n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n; for (var i = 0; i < n; i++) { this.v += (-this.k * (this.x - this.t) - this.c * this.v) * h; this.x += this.v * h; } return this.x; };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }

  // ---- ふるえ(Android Chrome は navigator.vibrate。iPhone の Safari には無い = 何も起きない)----
  // ネイティブに包むときは window.HBNative.haptic(kind) を用意すれば そちらが呼ばれる
  var HAPT = { tick: 8, back: 5, good: 12, bad: [30], stir: [18, 50, 18, 50, 28], snort: [40, 30, 60], sneeze: [60, 40, 160], thud: 90, clear: [20, 60, 20, 60, 40] };
  var hapticLog = [];
  function haptic(kind) {
    hapticLog.push(kind); if (hapticLog.length > 400) hapticLog.shift();
    try { if (window.HBNative && window.HBNative.haptic) return window.HBNative.haptic(kind); if (navigator.vibrate) navigator.vibrate(HAPT[kind]); } catch (e) {}
  }

  // ---- 音(全部 コードで作る)----
  var AC = null, master = null, noiseBuf = null, soundLog = [], analyser = null;
  function audioOn() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    AC = new C(); master = AC.createGain(); master.gain.value = 0.55;
    var comp = AC.createDynamicsCompressor(); master.connect(comp); comp.connect(AC.destination);
    analyser = AC.createAnalyser(); analyser.fftSize = 2048; master.connect(analyser);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // ぎむぎむ(ゴムが こすれる音): のこぎり波 = こすれの つっかかり → 2 つの山の帯域 → 細かく途切れさせる → 音量は 動かす速さで
    var o = AC.createOscillator(), f1 = AC.createBiquadFilter(), f2 = AC.createBiquadFilter(), am = AC.createGain(), g = AC.createGain(), g2 = AC.createGain(), lfo = AC.createOscillator(), la = AC.createGain();
    o.type = 'sawtooth'; o.frequency.value = 70;
    f1.type = 'bandpass'; f1.Q.value = 6; f1.frequency.value = 900; f2.type = 'bandpass'; f2.Q.value = 5; f2.frequency.value = 2100; g2.gain.value = 0.45;
    lfo.type = 'square'; lfo.frequency.value = 12; la.gain.value = 0.45; am.gain.value = 0.55; lfo.connect(la); la.connect(am.gain);
    o.connect(f1); o.connect(f2); f2.connect(g2); f1.connect(am); g2.connect(am); am.connect(g); g.gain.value = 0; g.connect(master);
    o.start(); lfo.start(); rub = { o: o, f1: f1, f2: f2, g: g, lfo: lfo };
  }
  // 鼻を動かす速さ(スティック/秒)と 外向き(+)か 内向き(−)か → ぎ(高い)/ む(低い)
  var rub = null, rubLv = 0, rubT = 0, rubPeak = 0;
  function rubMove(speed, radial) {
    var s = clamp(speed / 6, 0, 1); if (s < 0.04) return;
    rubLv = 0.2 * Math.pow(s, 0.7); rubT = performance.now(); rubPeak = Math.max(rubPeak, rubLv);
    if (!rub || AC.state !== 'running') return;
    var now = AC.currentTime, up = radial >= 0 ? 1.3 : 0.82;
    rub.g.gain.setTargetAtTime(rubLv, now, 0.012);
    rub.o.frequency.setTargetAtTime((52 + 80 * s) * up, now, 0.02);
    rub.f1.frequency.setTargetAtTime((650 + 800 * s) * up, now, 0.03); rub.f2.frequency.setTargetAtTime((1700 + 900 * s) * up, now, 0.03);
    rub.lfo.frequency.setTargetAtTime(8 + 16 * s, now, 0.05);
  }
  function rubIdle(now) {                       // 50 ms 動かなければ 消す
    if (rubLv > 0 && now - rubT > 50) { rubLv = 0; if (rub && AC.state === 'running') rub.g.gain.setTargetAtTime(0, AC.currentTime, 0.035); }
  }
  function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function tone(type, f0, f1, t, a, d, peak) {
    var o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    env(g, t, a, peak, d); o.connect(g); g.connect(master); o.start(t); o.stop(t + a + d + 0.05); return g;
  }
  function noise(ftype, f0, f1, q, t, a, d, peak) {
    var s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(); s.buffer = noiseBuf; s.loop = true;
    f.type = ftype; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    env(g, t, a, peak, d); s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + a + d + 0.05);
  }
  var SND = {
    snore: function (t) {                      // ぐー(拍の頭)
      var o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter(), l = AC.createOscillator(), lg = AC.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(74, t); o.frequency.linearRampToValueAtTime(58, t + 0.3);
      f.type = 'lowpass'; f.frequency.value = 520; l.frequency.value = 24; lg.gain.value = 0.12; l.connect(lg); lg.connect(g.gain);
      env(g, t, 0.05, 0.3, 0.27); o.connect(f); f.connect(g); g.connect(master); o.start(t); o.stop(t + 0.4); l.start(t); l.stop(t + 0.4);
      noise('bandpass', 300, 180, 1.2, t, 0.05, 0.25, 0.12);
    },
    whistle: function (t) { tone('sine', 980, 1420, t, 0.06, 0.16, 0.035); },      // ぴー(裏)
    pip: function (t) { tone('square', 660, 660, t, 0.004, 0.03, 0.018); },
    squish: function (t) { noise('bandpass', 700, 240, 2.5, t, 0.006, 0.07, 0.22); tone('sine', 210, 120, t, 0.005, 0.08, 0.16); },
    perfect: function (t) { tone('square', 988, 988, t, 0.004, 0.05, 0.05); tone('square', 1319, 1319, t + 0.055, 0.004, 0.09, 0.05); },
    good: function (t) { tone('square', 880, 880, t, 0.004, 0.07, 0.045); },
    ok: function (t) { tone('square', 587, 587, t, 0.004, 0.05, 0.03); },
    miss: function (t) { noise('lowpass', 420, 160, 1, t, 0.02, 0.16, 0.38); tone('sawtooth', 96, 70, t, 0.02, 0.14, 0.12); },   // フガッ
    stir: function (t) { var g = tone('triangle', 236, 176, t, 0.08, 0.42, 0.13); void g; tone('triangle', 240, 181, t + 0.01, 0.08, 0.4, 0.06); },   // んん…
    ear: function (t) { tone('sine', 520, 760, t, 0.005, 0.05, 0.05); },
    eye: function (t) { tone('triangle', 196, 262, t, 0.05, 0.22, 0.14); },                       // ん?
    sniff: function (t) { noise('highpass', 1800, 3200, 0.7, t, 0.14, 0.05, 0.12); },
    sneeze: function (t) { noise('highpass', 900, 2600, 0.8, t, 0.012, 0.22, 0.6); tone('sawtooth', 320, 110, t, 0.01, 0.16, 0.2); },
    thud: function (t) { tone('sine', 110, 42, t, 0.004, 0.16, 0.5); noise('lowpass', 900, 200, 0.7, t, 0.003, 0.05, 0.25); },
    sigh: function (t) { noise('bandpass', 900, 420, 0.9, t, 0.25, 0.7, 0.1); },
    buzz: function (t) { tone('square', 150, 110, t, 0.004, 0.16, 0.06); },
    over: function (t) { tone('square', 392, 392, t, 0.004, 0.12, 0.05); tone('square', 311, 311, t + 0.16, 0.004, 0.12, 0.05); tone('square', 262, 262, t + 0.32, 0.004, 0.26, 0.05); },
    clear: function (t) { [523, 659, 784, 1047].forEach(function (f, i) { tone('square', f, f, t + i * 0.09, 0.004, i === 3 ? 0.3 : 0.08, 0.05); }); }
  };
  function play(name, atMs) {
    soundLog.push(name); if (soundLog.length > 600) soundLog.shift();
    if (!AC || AC.state !== 'running') return;
    var t = AC.currentTime + 0.005;
    if (atMs != null) t = Math.max(t, AC.currentTime + (atMs - performance.now()) / 1000 - (AC.outputLatency || AC.baseLatency || 0));
    try { SND[name](t); } catch (e) {}
  }

  // ---- 状態 ----
  var st = 'LOAD';                 // TITLE(さわって遊べる)→ PLAY → ENDING → RESULT
  var game = null, chart = null, P0 = 0, endKind = null, endT = 0, endStep = 0, runs = 0, snoreT = 0, tickI = 0, warnI = 0;
  var ptr = { id: null, type: 'mouse', x: 0, y: 0, x0: 0, y0: 0, down: false, seen: false };
  var raw = { x: 0, y: 0, t: 0 };
  var tdog = G.K.START.slice(), tface = [0, 1], tbone = null;          // タイトルの 練習(液晶の犬を動かして ほねを 1 本たべると 準備できる)
  var nx = new Spring(620, 15), ny = new Spring(620, 15);            // 鼻(見た目)
  var lx = new Spring(90, 13), ly = new Spring(90, 13);              // 口もとが 遅れてついてくる
  var press = new Spring(900, 34), headY = new Spring(260, 12), headX = new Spring(260, 10), lift = new Spring(60, 14);
  var padY = new Spring(180, 9), padR = new Spring(160, 8), padUp = new Spring(40, 12);     // パッドの はね・かたむき・浮き
  var tiltSign = 1, drops = [], flash = { t: -1, ok: true, x: 0, y: 0 }, lcdMsg = null, lcdMsg2 = null, padOff = 0, wiggled = false, startArm = 0, wakeShown = 0, blinkI = -1;
  var hintEl = $('hint'), titleEl = $('title'), resEl = $('result');

  function load(name, src) { return new Promise(function (ok, ng) { var i = new Image(); i.onload = function () { img[name] = i; ok(); }; i.onerror = ng; i.src = src; }); }

  // ---- 犬(WebGL。写真 1 枚を ゆがめる。鼻そのものは形を保ち、まわりの毛と皮が伸びる)----
  var prog, uni = {};
  // 画面いっぱいの四角。v = その点に当たる 写真の px(R.xy = 画面の左上に当たる写真の px、R.zw = 画面の広さを写真の px で)
  var VS = 'attribute vec2 a;varying vec2 v;uniform vec4 R;void main(){v=R.xy+a*R.zw;gl_Position=vec4(a.x*2.-1.,1.-a.y*2.,0.,1.);}';
  var FS = [
    'precision highp float;varying vec2 v;uniform sampler2D T;uniform vec2 TS;',
    'uniform vec4 Hc[5];uniform vec2 Hd[5];uniform vec4 P;uniform vec4 Z;',
    'float fall(float r){float q=clamp(1.-r*r,0.,1.);return q*q;}',
    'void main(){vec2 q=v;',
    ' vec2 z=q-Z.xy;q=Z.xy+z/(1.+Z.w*fall(length(z)/Z.z));',                       // 顔が こちらへ持ち上がる(起きたとき)
    ' for(int i=0;i<5;i++){q-=Hd[i]*fall(max(0.,distance(q,Hc[i].xy+Hd[i])-Hc[i].w)/(Hc[i].z-Hc[i].w));}',   // 持ち手: ずれた先を中心に重みを取る。w = 形を保つ半径
    ' vec2 d=q-P.xy;q=P.xy+d/(1.+P.w*fall(length(d)/P.z));',                       // 押しこみ(鼻が ひらたく広がる)
    ' vec2 u=q/TS;float o=max(max(-u.x,u.x-1.),0.);',                                // 写真の外(スマホ横の左右)は ふちの毛を 鏡うつしで 横へ のばす。
    ' u.x=clamp(u.x,0.,1.)+(u.x<0.?o*.38:-o*.38);u.y=1.-abs(1.-mod(u.y,2.));',        //   0.38 に縮めて写す = 目(ふちから 230 px)までは届かない。外ほど 少し暗く
    ' gl_FragColor=vec4(texture2D(T,u).rgb*(1.-min(.22,o*.9)),1.);}'
  ].join('\n');
  function glInit() {
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    ['R', 'TS', 'T', 'Hc', 'Hd', 'P', 'Z'].forEach(function (n) { uni[n] = gl.getUniformLocation(prog, n); });
    var quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    var a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img.dog);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  function drawDog(time, wake) {
    gl.viewport(0, 0, cGl.width, cGl.height);
    var x0 = nose.x - DOG.nose[0] * ps, k = 1 / ps, N = DOG.nose;
    gl.uniform4f(uni.R, -x0 / ps, imgY / ps, W / ps, H / ps); gl.uniform2f(uni.TS, DOG.w, DOG.h);
    var br = Math.sin(time / 1000 * (1.7 + wake * 2.2)), sh = wake > 0.3 ? Math.sin(time / 37) * (wake - 0.3) * 3 : 0;
    gl.uniform4fv(uni.Hc, new Float32Array([
      N[0], N[1], 200, 96,                         // 鼻(半径 96 の内側は 形を保つ)。ゆがみは鼻のまわり 200 まで = 口(鼻の下 190)は ほぼ動かない
      N[0], N[1] - 40, 420, 0,                     // 顔の上半分(遅れて ほんの少し)
      N[0], N[1] - 120, 900, 0,                    // 頭ぜんたい(もぞっ・くしゃみ)
      540, 1500, 700, 0,                           // 胸(寝息)
      N[0], N[1] + 170, 240, 0]));                 // あご(フガッ)
    gl.uniform2fv(uni.Hd, new Float32Array([nx.x * k, ny.x * k, lx.x * k * 0.15, ly.x * k * 0.15, headX.x + sh, headY.x, 0, -7 * br * (1 + wake), 0, Math.max(0, headY.x) * 0.5]));
    gl.uniform4f(uni.P, N[0] + nx.x * k, N[1] + ny.x * k, 135, 0.10 * press.x);
    gl.uniform4f(uni.Z, N[0], N[1] - 180, 1100, 0.085 * lift.x);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ---- パッド(生成した写真。下のふちに 鼻の入る くぼみ を切る)----
  function drawPad() {
    var o = document.createElement('canvas'); o.width = cPad.width; o.height = cPad.height; var c = o.getContext('2d');
    c.setTransform(cPad.width / W, 0, 0, cPad.height / H, 0, 0);
    c.drawImage(img.pad, pad.x, pad.y, pad.w, pad.h);
    var R = (DOG.rx + NOTCH) * ps, g;
    c.globalCompositeOperation = 'source-atop';                                   // くぼみの ふち(内側が暗い)
    g = c.createRadialGradient(nose.x, nose.y, R, nose.x, nose.y, R + 26 * ps); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.35, 'rgba(255,255,255,.10)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(nose.x, nose.y, R + 26 * ps, 0, 7); c.fill();
    c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(nose.x, nose.y, R, 0, 7); c.fill();
    c.globalCompositeOperation = 'source-over';
    pd.setTransform(1, 0, 0, 1, 0, 0); pd.clearRect(0, 0, cPad.width, cPad.height);
    pd.save(); pd.shadowColor = 'rgba(60,45,30,.55)'; pd.shadowBlur = 34 * U * DPR; pd.shadowOffsetY = 20 * U * DPR; pd.drawImage(o, 0, 0); pd.restore();   // 毛に落ちる影
    pd.save(); pd.shadowColor = 'rgba(40,28,18,.5)'; pd.shadowBlur = 7 * U * DPR; pd.shadowOffsetY = 5 * U * DPR; pd.drawImage(o, 0, 0); pd.restore();     // 接している所の濃い影
    // 液晶の地(中身は fx の層で描く)
    sx(pd); pd.fillStyle = '#aab79a'; pd.fillRect(lcd.x, lcd.y, lcd.w, lcd.h);
    g = pd.createLinearGradient(0, lcd.y, 0, lcd.y + lcd.h); g.addColorStop(0, 'rgba(0,0,0,.22)'); g.addColorStop(0.12, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(255,255,255,.08)'); pd.fillStyle = g; pd.fillRect(lcd.x, lcd.y, lcd.w, lcd.h);
  }

  // ---- 液晶のゲーム「ほねパクパク」: 鼻で 液晶の犬(= 夢の中の この犬)を動かして、出てきた ほねを たべる ----
  var LD = '#27301f', LG = 'rgba(39,48,31,.11)', LW = G.K.FW, LH = G.K.FH;
  function bone(c, x, y, col) {
    c.fillStyle = col; c.save(); c.translate(x, y); c.rotate(-0.35);
    c.fillRect(-13, -4, 26, 8); [[-14, -6], [-14, 6], [14, -6], [14, 6]].forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], 6.5, 0, 7); c.fill(); }); c.restore();
  }
  function lcdDog(c, p, f, col, chomp) {          // 小さな犬の顔(たれ耳・目・鼻先)。鼻先が 進む向きを向く
    c.save(); c.translate(p[0], p[1]); c.rotate(Math.atan2(f[1], f[0]) - Math.PI / 2); c.fillStyle = col;
    c.beginPath(); c.ellipse(-20, -2, 8, 15, 0.35, 0, 7); c.fill(); c.beginPath(); c.ellipse(20, -2, 8, 15, -0.35, 0, 7); c.fill();   // たれ耳
    c.beginPath(); c.arc(0, -2, 18, 0, 7); c.fill();                                                                         // 頭
    c.beginPath(); c.ellipse(0, 17, 10, chomp ? 13 : 10, 0, 0, 7); c.fill();                                                // 鼻先
    c.fillStyle = '#aab79a'; c.beginPath(); c.arc(-7, 3, 3.2, 0, 7); c.arc(7, 3, 3.2, 0, 7); c.fill();                     // 目(液晶の地の色で ぬく)
    if (chomp) { c.beginPath(); c.moveTo(-6, 26); c.lineTo(0, 19); c.lineTo(6, 26); c.fill(); }                              // ぱくっ
    c.restore();
  }
  function drawLcd(time, ts) {
    var c = fx; c.save(); c.translate(lcd.x, lcd.y); c.scale(lcd.w / LW, lcd.h / LH);
    c.beginPath(); c.rect(0, 0, LW, LH); c.clip(); c.textBaseline = 'middle';
    var i, fl = flash.t >= 0 && time - flash.t < 300;
    if (st === 'PLAY' && game) {
      var b = game.bone;
      if (b) { var left = b.t1 - ts; if (left > G.K.BLINK || Math.floor(left / 140) % 2 === 0) bone(c, b.x, b.y, LD); else bone(c, b.x, b.y, LG); }
      if (fl && !flash.ok && Math.floor((time - flash.t) / 75) % 2 === 0) { c.fillStyle = LD; c.font = '40px ' + FONT; c.textAlign = 'center'; c.fillText('×', flash.x, flash.y); }
      lcdDog(c, game.dog, game.face, LD, fl && flash.ok);
      c.fillStyle = LD; c.font = '40px ' + FONT; c.textAlign = 'left'; c.fillText(game.caught + '/' + G.K.GOAL, 14, 30);
      for (i = 0; i < G.K.LIVES; i++) { c.fillStyle = i < game.missed ? LD : LG; c.font = '28px ' + FONT; c.textAlign = 'center'; c.fillText('×', LW - 22 - i * 28, 28); }
      var zs = 3 - game.stage, blink = game.light && Math.floor(time / 180) % 2 === 0;
      for (i = 0; i < 3; i++) { c.fillStyle = i < zs && !blink ? LD : LG; c.font = (22 + i * 7) + 'px ' + FONT; c.textAlign = 'center'; c.fillText('z', 26 + i * 27, LH - 26 - i * 6); }
    } else if (st === 'TITLE') {                   // 練習: ほねを 1 本たべたら「はなすと スタート」
      if (tbone) bone(c, tbone[0], tbone[1], LD);
      lcdDog(c, tdog, tface, LD, fl);
      c.fillStyle = LD; c.textAlign = 'center'; c.font = '34px ' + FONT;
      c.fillText(tbone ? (Math.floor(time / 700) % 2 ? T('ほねパクパク', 'BONE MUNCH') : '') : T('はなすと スタート', 'LET GO TO START'), LW / 2, 32);
    } else {
      if (game) lcdDog(c, game.dog, game.face, LD, false);
      c.fillStyle = LD; c.textAlign = 'center';
      c.font = '38px ' + FONT; c.fillText(lcdMsg || '', LW / 2, 36); if (lcdMsg2) { c.font = '34px ' + FONT; c.fillText(lcdMsg2, LW / 2, LH - 32); }
    }
    c.restore();
  }

  function drawFx(time, ts, dt) {
    sx(fx); fx.clearRect(0, 0, W, H);
    var i, p;
    for (i = drops.length - 1; i >= 0; i--) { p = drops[i]; p.t += dt; if (p.t > 0.6) { drops.splice(i, 1); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * dt; fx.globalAlpha = (1 - p.t / 0.6) * 0.85; fx.beginPath(); fx.arc(p.x, p.y, p.r, 0, 7); fx.fillStyle = '#e9f6ff'; fx.fill(); fx.globalAlpha = 1; }
    // 親指(マウスのときだけ。スマホは 本物の親指が そこにある)
    if (ptr.type !== 'touch' && ptr.seen && st !== 'RESULT' && st !== 'LOAD' && img.thumb && !(st === 'ENDING' && endKind === 'woke' && endStep >= 2)) {
      var k = 0.8 * ps * (ptr.down ? 0.985 : 1.03), tx = (ptr.down ? nose.x + nx.x : ptr.x) + 52 * ps, ty = (ptr.down ? nose.y + ny.x : ptr.y) + 40 * ps;
      fx.save(); fx.shadowColor = 'rgba(50,35,20,' + (ptr.down ? 0.5 : 0.28) + ')'; fx.shadowBlur = (ptr.down ? 14 : 40) * U * DPR; fx.shadowOffsetY = (ptr.down ? 6 : 26) * U * DPR; fx.shadowOffsetX = (ptr.down ? 3 : 12) * U * DPR;
      fx.drawImage(img.thumb, tx - THUMB.pad[0] * k, ty - THUMB.pad[1] * k, THUMB.w * k, THUMB.h * k); fx.restore();
    }
  }
  // 液晶は パッドと一緒に動くので、パッドの層に重ねて描く(fx と同じ変形を掛ける)
  var cLcd = document.createElement('canvas');

  // ---- 入力(指 1 本。押した所からの ずれ = 倒し)----
  function toStage(e) { var r = cFx.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; }
  function setRaw(t, x, y, touch) {
    var m = Math.sqrt(x * x + y * y);
    if (m > 1) { var m2 = 1 + (1 - Math.exp(-(m - 1) * 0.9)) * 0.28; x *= m2 / m; y *= m2 / m; }   // 端は ゴムのように重くなる
    if (st === 'ENDING' || st === 'RESULT') { x = 0; y = 0; press.t = 0; }
    if (touch && ptr.down) {                                            // ぎむぎむ: 押したまま動かす速さで鳴る
      var ddt = Math.max(4, Math.min(50, t - raw.t)) / 1000, d = Math.hypot(x - raw.x, y - raw.y);
      if (d > 0) rubMove(d / ddt, (Math.hypot(x, y) - Math.hypot(raw.x, raw.y)) / ddt);
    }
    raw.x = x; raw.y = y; raw.t = t;
    nx.t = x * NOSE_VIS * ps; ny.t = y * NOSE_VIS * ps; lx.t = nx.t; ly.t = ny.t;     // 鼻は 少しだけ動く(指は もっと大きく動いている)
    if (st === 'PLAY' && game && !game.over) handle(game.input(t - P0, x, y, touch));
  }
  function down(e) {
    if (ptr.id !== null || st === 'RESULT' || st === 'LOAD') return;
    audioOn();
    var p = toStage(e); ptr.type = e.pointerType || 'mouse'; ptr.seen = true; ptr.x = p[0]; ptr.y = p[1];
    var dx = p[0] - (nose.x + nx.x), dy = p[1] - (nose.y + ny.x);
    if (dx * dx + dy * dy > 330 * 330) return;                 // 鼻の近くだけ
    ptr.id = e.pointerId; ptr.down = true; ptr.x0 = p[0]; ptr.y0 = p[1];
    try { cFx.setPointerCapture(e.pointerId); } catch (err) {}
    press.t = 1; nx.k = ny.k = 900; nx.c = ny.c = 46;          // 押している間は 指に ぴったり寄る
    cFx.style.cursor = 'grabbing';
    raw.t = e.timeStamp; setRaw(e.timeStamp, 0, 0, true); play('squish'); e.preventDefault();
  }
  function move(e) {
    var list = (e.getCoalescedEvents && e.getCoalescedEvents()) || []; if (!list.length) list = [e];
    for (var i = 0; i < list.length; i++) {
      var c = list[i], p = toStage(c);
      if (ptr.id === null) { ptr.x = p[0]; ptr.y = p[1]; ptr.type = e.pointerType || 'mouse'; ptr.seen = true; continue; }
      if (e.pointerId !== ptr.id) return;
      ptr.x = p[0]; ptr.y = p[1];
      setRaw(c.timeStamp || e.timeStamp, (p[0] - ptr.x0) / RS, (p[1] - ptr.y0) / RS, true);
    }
  }
  function up(e) {
    if (e.pointerId !== ptr.id) return;
    ptr.id = null; ptr.down = false; press.t = 0; nx.k = ny.k = 620; nx.c = ny.c = 15;   // 離すと ぷるんと戻る
    cFx.style.cursor = 'grab';
    audioOn();                                   // スマホは 指を離した時に はじめて音が出せる → 「練習の ほねを たべて 離すと はじまる」
    setRaw(e.timeStamp, 0, 0, false);
    if (st === 'TITLE' && wiggled && performance.now() > startArm) begin(e.timeStamp);
  }
  cFx.addEventListener('pointerdown', down); cFx.addEventListener('pointermove', move);
  cFx.addEventListener('pointerup', up); cFx.addEventListener('pointercancel', up);
  cFx.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

  // ---- 進行 ----
  function toTitle(first) {
    st = 'TITLE'; game = null; endKind = null; lcdMsg = null; lcdMsg2 = null; padOff = 0; wakeShown = 0;
    headY.t = headX.t = 0; lift.t = 0; padUp.t = 0; padY.t = 0; padR.t = 0;
    titleEl.querySelector('h1').textContent = first ? T('鼻ボタン', 'Nose Button') : '';
    titleEl.querySelector('p').textContent = T('鼻で 犬を動かして ほねを たべよう', 'Steer the dog with the nose. Eat the bone');
    titleEl.classList.remove('off'); resEl.classList.remove('on'); hintEl.classList.remove('on');
    startArm = performance.now() + (first ? 0 : 350); wiggled = false;
    tdog = G.K.START.slice(); tface = [0, 1]; tbone = [G.K.FW - 90, G.K.FH / 2 + 20];
  }
  function begin(t) {
    st = 'PLAY'; runs++;
    var seed = +(Q.get('seed') || 0) || (Date.now() % 100000) + runs;
    tiltSign = seed % 2 ? 1 : -1;
    chart = G.makeChart(seed); game = new G.Game(chart); P0 = t; snoreT = 500; warnI = 0; blinkI = -1;
    titleEl.classList.add('off');
    hintEl.textContent = T('そっと。雑に動かすと 犬が起きる', 'Gently. Rough moves wake the dog'); hintEl.classList.add('on');
  }
  function handle(evs) {
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e.type === 'catch') { flash = { t: performance.now(), ok: true, x: e.bone.x, y: e.bone.y }; play('good'); haptic('good'); if (game.caught === 3) hintEl.classList.remove('on'); }
      else if (e.type === 'miss') { flash = { t: performance.now(), ok: false, x: e.bone.x, y: e.bone.y }; play('buzz'); haptic('bad'); }
      else if (e.type === 'spawn') { play('pip'); haptic('tick'); }
      else if (e.type === 'stage' && e.up) {
        if (e.stage === 1) { play('stir'); haptic('stir'); headX.v = 60; padR.v = 5; }                    // もぞっ
        if (e.stage === 2) { play('miss'); haptic('snort'); headY.v = 150; padY.v = -260; padR.v = -9; }  // フガッ。パッドがはねる
      } else if (e.type === 'light') { if (!e.on) padUp.t = 0; }
      else if (e.type === 'end') { endKind = e.kind; endT = performance.now(); st = 'ENDING'; endStep = 0; lcdMsg = ''; hintEl.classList.remove('on'); if (ptr.id === null) { nx.t = ny.t = 0; } }
    }
  }
  function ending(now) {
    var t = now - endT;
    function at(ms, step, fn) { if (t >= ms && endStep < step) { endStep = step; fn(); } }
    if (endKind === 'woke') {
      at(0, 1, function () { headY.t = -18; play('sniff'); haptic('stir'); padUp.t = 1; lcdMsg = ''; });                       // は…
      at(430, 2, function () { headY.t = 0; headY.v = 1000; play('sneeze'); haptic('sneeze'); padOff = now;         // くしゅん → パッドが飛ぶ
        for (var i = 0; i < 28; i++) { var a = Math.PI * (0.15 + Math.random() * 0.7); drops.push({ x: nose.x + (Math.random() - 0.5) * 80, y: nose.y + 50, vx: Math.cos(a) * (200 + Math.random() * 560) * (Math.random() < 0.5 ? -1 : 1), vy: 120 + Math.random() * 440, r: 4 + Math.random() * 8, t: 0 }); } });
      at(900, 3, function () { lift.t = 1; play('thud'); haptic('thud'); });                                         // 顔が出る。こっちを見ている
      if (t > 3200) result();          // 顔が出てから 2 秒ほど 見つめ合う
    } else if (endKind === 'clear') {
      at(0, 1, function () { lcdMsg = T('クリア', 'CLEAR'); lcdMsg2 = game.caught + ' / ' + G.K.GOAL; play('clear'); haptic('clear'); });
      at(800, 2, function () { play('sigh'); });
      if (t > 1700) result();
    } else {
      at(0, 1, function () { lcdMsg = T('おしまい', 'GAME OVER'); lcdMsg2 = String(game.caught); play('over'); });
      if (t > 1700) result();
    }
  }
  var TITLES = [['しのびの親指', 'Ninja thumb'], ['いい親指', 'Good thumb'], ['ひやひや親指', 'Close-call thumb'], ['やさしすぎる親指', 'Too-gentle thumb'], ['起こした', 'You woke him']];
  var shareText = '';
  function result() {
    st = 'RESULT';
    var ti = G.title(game), big = $('r-big'), rank = $('r-rank'), bones = game.caught, all = G.K.GOAL, sl = game.sleepPct();
    big.className = ''; rank.className = '';
    if (endKind === 'woke') {
      $('r-label').textContent = T('顔が 出た', 'The face came out'); big.className = 'word'; big.textContent = T('起こした', 'You woke him');
      rank.className = 'bad'; rank.textContent = T('ほね ', 'Bones ') + bones + T(' 本で おしまい', ', then game over');
      $('r-line').textContent = T('そっと、ゆっくり。\nいびきが止まったら もっとそっと', 'Slow and gentle.\nEven gentler when the snoring stops');
      shareText = T('鼻ボタン ほね ' + bones + ' 本で犬を起こした', 'Nose Button: woke the dog after ' + bones + ' bones');
    } else {
      $('r-label').textContent = endKind === 'clear' ? T('クリア ・ 犬は 寝たまま', 'Cleared · the dog slept on') : T('液晶のゲームは おしまい ・ 犬は 寝たまま', 'Lost the little game · the dog slept on');
      big.textContent = bones + (endKind === 'clear' ? ' / ' + all : ''); rank.textContent = T(TITLES[ti][0], TITLES[ti][1]); if (ti === 3) rank.className = 'bad';
      $('r-line').textContent = T('ほね ', 'Bones ') + bones + T(' 本 ・ ねむり ', ' · Sleep ') + sl + '%';
      shareText = T('鼻ボタン ほね ' + bones + ' 本・ねむり ' + sl + '%「' + TITLES[ti][0] + '」', 'Nose Button: ' + bones + ' bones, sleep ' + sl + '%, "' + TITLES[ti][1] + '"');
    }
    $('b-again').textContent = T('もういちど', 'Again'); $('b-share').textContent = T('シェア', 'Share');
    resEl.classList.add('on');
  }
  $('b-again').addEventListener('click', function () { audioOn(); toTitle(false); });
  $('b-share').addEventListener('click', function () {
    var url = location.origin + location.pathname;
    if (navigator.share) navigator.share({ text: shareText, url: url }).catch(function () {});
    else window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(url), '_blank', 'noopener');
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && (st === 'PLAY' || st === 'ENDING')) toTitle(false); });
  // スマホを縦にしたら(「横にして」の画面が出る)遊びは タイトルへ戻す
  function onRotate() { if (mqRot.matches && (st === 'PLAY' || st === 'ENDING')) toTitle(false); }
  // Android の Chrome は 全画面にすれば 横に固定できる。iPhone の Safari は できない(ボタンを出さない)
  var rotBtn = $('b-rot'), canLock = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen && screen.orientation && screen.orientation.lock);
  $('rot-t').textContent = T('スマホを 横にして あそぶ', 'Turn your phone sideways');
  rotBtn.textContent = T('横にする', 'Rotate'); rotBtn.hidden = !canLock;
  rotBtn.addEventListener('click', function () {
    document.documentElement.requestFullscreen().then(function () { return screen.orientation.lock('landscape'); }).catch(function () {});
  });

  // ---- 毎コマ ----
  var last = 0;
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    var ts = st === 'PLAY' || st === 'ENDING' ? now - P0 : 0, wake = game ? Math.min(1, game.wake) : 0;
    if (st === 'PLAY' && game) {
      handle(game.advance(ts));
      // いびき: 深く寝ている間だけ。眠りが浅くなる少し前に止まる(= 合図)
      var L = chart.lights, quiet = game.stage >= 2, i;
      for (i = 0; i < L.length; i++) if (snoreT >= L[i].warn - 300 && snoreT < L[i].t1) quiet = true;
      if (snoreT - ts < 180) { if (!quiet) { play('snore', P0 + snoreT); play('whistle', P0 + snoreT + 700); } snoreT += 1500 - 500 * wake; }
      if (warnI < L.length && ts >= L[warnI].warn) { warnI++; play('stir'); haptic('stir'); padUp.t = 0.55; headX.v = 40; }
      // ほねが消えかけたら(点滅の はじめ)液晶の ぴっぴっ
      var b = game.bone; if (b && b.i !== blinkI && b.t1 - ts < G.K.BLINK) { blinkI = b.i; play('ok'); }
    } else if (st === 'TITLE' && ptr.down && tbone) {                  // 練習: 液晶の犬が 鼻で動く。ほねを たべたら「はなすと スタート」
      var v = G.moveDog(tdog, raw.x, raw.y, dt); if (v[0] || v[1]) { var vm = Math.hypot(v[0], v[1]); tface = [v[0] / vm, v[1] / vm]; }
      if (Math.hypot(tbone[0] - tdog[0], tbone[1] - tdog[1]) < G.K.EAT) {
        tbone = null; wiggled = true; flash = { t: now, ok: true, x: 0, y: 0 }; play('good'); haptic('good');
        titleEl.querySelector('p').textContent = T('指を はなすと はじまる', 'Let go to start');
      }
    }
    rubIdle(now);
    if (st === 'ENDING') ending(now);
    wakeShown += (wake - wakeShown) * Math.min(1, dt * 6);
    nx.step(dt); ny.step(dt); lx.step(dt); ly.step(dt); press.step(dt); headY.step(dt); headX.step(dt); lift.step(dt); padY.step(dt); padR.step(dt); padUp.step(dt);
    // パッド: 犬が起きかけるほど 浮いて ゆれる。くしゃみで飛ぶ
    var up = wakeShown * 44 + padUp.x * 16, rot = padR.x + wakeShown * wakeShown * 5 * tiltSign + Math.sin(now / (430 - 200 * wakeShown)) * (wakeShown * 3.2 + padUp.x * 1.3), tx = 0, ty = -up + padY.x, op = 1;
    if (padOff) { var q = clamp((now - padOff) / 520, 0, 1), e2 = ease(q); tx = 260 * e2; ty = -up - 1500 * e2 + 300 * q * q; rot = 34 * e2; op = 1 - clamp((q - 0.7) / 0.3, 0, 1); }
    var tf = 'translate(' + (tx * U) + 'px,' + (ty * U) + 'px) rotate(' + rot + 'deg)';
    cPad.style.transform = tf; cPad.style.opacity = op; cLcd.style.transform = tf; cLcd.style.opacity = op;
    drawDog(now, wakeShown);
    drawFx(now, ts, dt);
    var lc = cLcd.getContext('2d'); lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, cLcd.width, cLcd.height);
    if (st !== 'LOAD') { var keep = fx; fx = lc; sx(fx); drawLcd(now, ts); fx = keep; }
    requestAnimationFrame(frame);
  }

  // ---- 検査用の のぞき窓 ----
  window.__hb = {
    get state() { return st; }, get game() { return game; }, get chart() { return chart; }, get P0() { return P0; }, get end() { return endKind; },
    get nose() { var r = cFx.getBoundingClientRect(); return { x: r.left + nose.x / W * r.width, y: r.top + nose.y / H * r.height, rs: RS / W * r.width, nx: nx.x, ny: ny.x }; },
    get rub() { return rubPeak; }, resetRub: function () { rubPeak = 0; }, get land() { return LAND; }, get tdog() { return tdog; }, get tbone() { return tbone; },
    get sounds() { return soundLog; }, get haptics() { return hapticLog; }, get audio() { return AC ? AC.state : 'none'; },
    get press() { return press.x; }, get endStep() { return endStep; }, get endMs() { return st === 'ENDING' ? performance.now() - endT : -1; },
    level: function () { if (!analyser) return 0; var d = new Float32Array(analyser.fftSize), m = 0; analyser.getFloatTimeDomainData(d); for (var i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); return m; },
    lang: JA ? 'ja' : 'en', get H() { return H; }, get layout() { return { nose: nose, pad: pad, lcd: lcd, ps: ps }; }
  };

  cLcd.id = 'lcd'; cPad.parentNode.insertBefore(cLcd, cFx);
  function sizeLcd() { cLcd.width = cPad.width; cLcd.height = cPad.height; cLcd.style.transformOrigin = cPad.style.transformOrigin; }
  layout(); sizeLcd(); window.addEventListener('resize', function () { layout(); sizeLcd(); onRotate(); });
  Promise.all([load('dog', 'assets/dog.webp'), load('pad', 'assets/pad.webp'), load('thumb', 'assets/thumb.webp'),
    (document.fonts && document.fonts.load ? document.fonts.load('700 40px "ZenMaru"', 'あ').catch(function () {}) : 0)]).then(function () {
    glInit(); ready = true; layout(); sizeLcd(); toTitle(true); requestAnimationFrame(frame);
  }).catch(function (e) { document.body.insertAdjacentHTML('beforeend', '<p style="color:#fff;padding:20px">load error: ' + e + '</p>'); });
})();
