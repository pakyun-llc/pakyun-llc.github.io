// 鼻ボタン: 画面・さわり心地・音・ふるえ・進行。遊びの式は game.js。
(function () {
  'use strict';
  var G = window.HBGame, Q = new URLSearchParams(location.search);
  var JA = (Q.get('lang') || navigator.language || 'ja').toLowerCase().indexOf('ja') === 0;
  function T(ja, en) { return JA ? ja : en; }
  document.documentElement.lang = JA ? 'ja' : 'en';
  document.title = T('鼻ボタン', 'Nose Button');

  // ---- 舞台(幅 1080 の座標。高さは画面の縦横比で決まる)----
  var W = 1080, H = 1920, U = 1, DPR = 1;
  var S = 1.35;                                  // 犬の絵の拡大
  var TEX = { w: 1200, h: 880 };                 // assets/dog.webp(tools/make_assets.py の実測)
  var NOSE_T = [625, 731], EYE_T = [[522, 547], [722, 546]], EAR_T = [[365, 265], [888, 268]];
  var RS = 150;                                  // スティックの倒し幅(舞台 px)= 1.0
  var nose = { x: 540, y: 1150 }, padY = 0;
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), cBg = $('bg'), cGl = $('gl'), cPad = $('pad'), cFx = $('fx');
  var bg = cBg.getContext('2d'), fx = cFx.getContext('2d'), pd = cPad.getContext('2d');
  var gl = cGl.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  var img = {}, ready = false;
  var INK = '#3a2819', PAPER = '#fff8ec', GINGER = '#d9781f', WARN = '#a8432a';
  var FONT = '"ZenMaru","Hiragino Maru Gothic ProN","Hiragino Sans",system-ui,sans-serif';

  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var cw = Math.min(vw, vh * 0.62), chh = vh;            // 横長の画面では 縦の柱にする
    H = Math.max(1500, Math.min(2500, Math.round(W * chh / cw)));
    U = cw / W; DPR = Math.min(window.devicePixelRatio || 1, 3);
    stage.style.width = cw + 'px'; stage.style.height = chh + 'px';
    stage.style.setProperty('--u', U + 'px');
    [cBg, cGl, cPad, cFx].forEach(function (c) { c.width = Math.round(cw * DPR); c.height = Math.round(chh * DPR); });
    nose.x = 540; nose.y = Math.round(H * 0.6);
    padY = nose.y - 800;
    if (ready) { drawBg(); drawPad(); }
  }
  function sx(c) { c.setTransform(cFx.width / W, 0, 0, cFx.height / H, 0, 0); }

  // ---- 小さな道具 ----
  function Spring(k, c, v) { this.k = k; this.c = c; this.x = v || 0; this.v = 0; this.t = v || 0; }
  Spring.prototype.step = function (dt) { var n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n; for (var i = 0; i < n; i++) { this.v += (-this.k * (this.x - this.t) - this.c * this.v) * h; this.x += this.v * h; } return this.x; };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }

  // ---- ふるえ(Android Chrome は navigator.vibrate。iPhone の Safari には無い = 何も起きない)----
  // ネイティブに包むときは window.HBNative.haptic(kind) を用意すれば そちらが呼ばれる
  var HAPT = { tick: 8, back: 5, good: 12, stir: [18, 50, 18, 50, 28], ear: [14], eye: [22, 40, 22], sneeze: [60, 40, 140], thud: 90, clear: [20, 60, 20, 60, 40] };
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
  var game = null, chart = null, P0 = 0, endKind = null, endT = 0, beatI = 0, noteS = 0, runs = 0;
  var ptr = { id: null, type: 'mouse', x: 0, y: 0, x0: 0, y0: 0, down: false, seen: false };
  var raw = { x: 0, y: 0, zone: null };          // 判定に使う倒し(ばねを通さない)
  var nx = new Spring(700, 38), ny = new Spring(700, 38);            // 鼻(見た目)
  var lx = new Spring(90, 13), ly = new Spring(90, 13);              // 顔が 遅れてついてくる
  var press = new Spring(900, 34);
  var eyeL = new Spring(260, 22), eyeR = new Spring(260, 22);       // 0 = とじる / 1 = あく
  var earL = new Spring(420, 9), earR = new Spring(420, 9);
  var headY = new Spring(300, 14), scr = new Spring(500, 18);
  var pops = [], drops = [], hitFx = [];
  var padDrop = 0, glAlpha = 1, go = null, lcdMsg = null, stirT = -1e9, startArm = 0, wiggled = false;
  var hintEl = $('hint'), titleEl = $('title'), resEl = $('result');

  // ---- 絵を読む ----
  function load(name, src) { return new Promise(function (ok, ng) { var i = new Image(); i.onload = function () { img[name] = i; ok(); }; i.onerror = ng; i.src = src; }); }

  // ---- 犬(WebGL。写真 1 枚を ゆがめる)----
  var prog, uni = {}, quad;
  var VS = 'attribute vec2 a;varying vec2 v;uniform vec4 R;uniform vec2 TS;void main(){v=a*TS;vec2 p=R.xy+a*R.zw;gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);}';
  var FS = [
    'precision highp float;varying vec2 v;uniform sampler2D T;uniform vec2 TS;uniform float A;',
    'uniform vec3 Hc[6];uniform vec2 Hd[6];uniform vec3 E[2];uniform vec4 P;',
    'float fall(float r){float q=clamp(1.-r*r,0.,1.);return q*q;}',
    'void main(){vec2 q=v;',
    // 押して ずらす: 行き先の点から 元の点へ戻す(持ち手は ずれた先に中心がある)
    ' for(int i=0;i<6;i++){float r0=i==0?58.:0.;q-=Hd[i]*fall(max(0.,distance(v,Hc[i].xy+Hd[i])-r0)/(Hc[i].z-r0));}',   // 鼻そのもの(半径 58)は形を保ち、まわりの皮だけ伸びる
    // 押しこみ(鼻が ひらたく広がる)
    ' vec2 d=q-P.xy;q=P.xy+d/(1.+P.w*fall(length(d)/P.z));',
    // まぶた: 目のまわりだけ 縦に つぶす(とじた目は 写真の目そのものが 細い線になる)
    ' for(int i=0;i<2;i++){float dx=q.x-E[i].x;float hw=1.-smoothstep(.55,1.,abs(dx)/78.);float cl=1.-E[i].z;',
    '  float cy=E[i].y+(6.+.0030*dx*dx)*cl*hw;float dy=q.y-cy;float a=abs(dy);float s=mix(.085,1.,E[i].z);float e=30.;float rv=92.;',
    '  float g=a<e*s?a/s:(a<rv?e+(a-e*s)*(rv-e)/(rv-e*s):a);q.y=cy+sign(dy)*mix(a,g,hw);}',
    ' vec2 uv=q/TS;vec4 c=texture2D(T,uv);if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)c=vec4(0.);',
    ' gl_FragColor=c*A;}'
  ].join('\n');
  function glInit() {
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    ['R', 'TS', 'T', 'A', 'Hc', 'Hd', 'E', 'P'].forEach(function (n) { uni[n] = gl.getUniformLocation(prog, n); });
    quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    var a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img.dog);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  function drawDog(time) {
    gl.viewport(0, 0, cGl.width, cGl.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (glAlpha <= 0.001) return;
    var x0 = nose.x - NOSE_T[0] * S, y0 = nose.y - NOSE_T[1] * S;
    gl.uniform4f(uni.R, x0 / W, y0 / H, TEX.w * S / W, TEX.h * S / H); gl.uniform2f(uni.TS, TEX.w, TEX.h); gl.uniform1f(uni.A, glAlpha);
    var br = Math.sin(time / 1000 * 1.9), k = 1 / S;
    var sc = scr.x;
    var hc = [NOSE_T[0], NOSE_T[1], 235,                       // 鼻と口もと(指についてくる)
      NOSE_T[0], NOSE_T[1] - 90, 520,                          // 顔ぜんたい(遅れて少し)
      EAR_T[0][0], EAR_T[0][1], 150, EAR_T[1][0], EAR_T[1][1], 150,
      625, 520, 620,                                           // 頭(くしゃみ・うなずき)
      600, 150, 430];                                          // 背中(寝息)
    var hd = [nx.x * k, ny.x * k - sc * 10, lx.x * k * 0.16, ly.x * k * 0.16,
      -earL.x * 9, earL.x * 22, earR.x * 9, earR.x * 22, 0, headY.x, 0, -5 * br - 3];
    gl.uniform3fv(uni.Hc, new Float32Array(hc)); gl.uniform2fv(uni.Hd, new Float32Array(hd));
    gl.uniform3fv(uni.E, new Float32Array([EYE_T[0][0], EYE_T[0][1], clamp(eyeL.x, 0, 1.05), EYE_T[1][0], EYE_T[1][1], clamp(eyeR.x, 0, 1.05)]));
    gl.uniform4f(uni.P, NOSE_T[0] + nx.x * k, NOSE_T[1] + ny.x * k, 105, 0.2 * press.x + 0.12 * sc);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ---- 床と影(下の層)----
  function drawBg() {
    bg.setTransform(cBg.width / W, 0, 0, cBg.height / H, 0, 0);
    var f = img.floor, sc = Math.max(W / f.width, H / f.height) * 1.02, fw = f.width * sc, fh = f.height * sc;
    bg.drawImage(f, (W - fw) / 2, H - fh, fw, fh);
    var g = bg.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(40,24,10,.30)'); g.addColorStop(0.35, 'rgba(40,24,10,0)'); g.addColorStop(1, 'rgba(255,240,210,.10)');
    bg.fillStyle = g; bg.fillRect(0, 0, W, H);
    if (glAlpha > 0.02) shadow(bg, nose.x, nose.y - 120, 760, 250, 0.42 * glAlpha);
    if (go) {
      var s = go.s; shadow(bg, go.x + 10, go.y + 8, 170 * s, 46 * s, 0.4 * go.a);
      bg.globalAlpha = go.a; var w = img.go.width * 1.25 * s, h = img.go.height * 1.25 * s; bg.drawImage(img.go, go.x - w / 2, go.y - h + Math.abs(Math.sin(go.ph)) * -14 * s, w, h); bg.globalAlpha = 1;
    }
  }
  function shadow(c, x, y, rx, ry, a) {
    c.save(); c.translate(x, y); c.scale(1, ry / rx);
    var g = c.createRadialGradient(0, 0, rx * 0.35, 0, 0, rx); g.addColorStop(0, 'rgba(38,22,8,' + a + ')'); g.addColorStop(1, 'rgba(38,22,8,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, rx, 0, 7); c.fill(); c.restore();
  }

  // ---- コントローラー(自前の形。⚠️仮の絵 = コードで描いたもの。本番は生成写真に差し替える)----
  var PADW = 880, PADH = 380, LCD = { x: -150, y: -128, w: 300, h: 176 };
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function drawPad() {
    sx(pd); pd.clearRect(0, 0, W, H); pd.save(); pd.translate(540, padY);
    var x = -PADW / 2, y = -PADH / 2;
    pd.save(); pd.shadowColor = 'rgba(30,14,4,.55)'; pd.shadowBlur = 46 * U * DPR; pd.shadowOffsetY = 30 * U * DPR; rr(pd, x, y, PADW, PADH, 150); pd.fillStyle = '#2b2c30'; pd.fill(); pd.restore();
    var g = pd.createLinearGradient(0, y, 0, y + PADH); g.addColorStop(0, '#4a4b51'); g.addColorStop(0.45, '#34353a'); g.addColorStop(1, '#232327');
    rr(pd, x, y, PADW, PADH, 150); pd.fillStyle = g; pd.fill();
    pd.save(); rr(pd, x, y, PADW, PADH, 150); pd.clip();
    var hl = pd.createRadialGradient(-180, y - 40, 20, -180, y - 40, 620); hl.addColorStop(0, 'rgba(255,244,226,.20)'); hl.addColorStop(1, 'rgba(255,244,226,0)'); pd.fillStyle = hl; pd.fillRect(x, y, PADW, PADH);
    var r = G.rng(7); pd.fillStyle = 'rgba(255,255,255,.035)'; for (var i = 0; i < 2600; i++) pd.fillRect(x + r() * PADW, y + r() * PADH, 2, 2);   // つや消しの粒
    pd.strokeStyle = 'rgba(255,255,255,.16)'; pd.lineWidth = 5; rr(pd, x + 5, y + 5, PADW - 10, PADH - 10, 146); pd.stroke();
    pd.strokeStyle = 'rgba(0,0,0,.35)'; pd.lineWidth = 10; rr(pd, x - 2, y + 4, PADW + 4, PADH, 150); pd.stroke();
    pd.restore();
    function btn(bx, by, rad, c0, c1) {
      pd.beginPath(); pd.arc(bx, by + 5, rad + 9, 0, 7); pd.fillStyle = 'rgba(0,0,0,.42)'; pd.fill();
      var q = pd.createRadialGradient(bx - rad * 0.35, by - rad * 0.4, rad * 0.1, bx, by, rad); q.addColorStop(0, c0); q.addColorStop(1, c1);
      pd.beginPath(); pd.arc(bx, by, rad, 0, 7); pd.fillStyle = q; pd.fill();
      pd.beginPath(); pd.ellipse(bx - rad * 0.25, by - rad * 0.42, rad * 0.42, rad * 0.2, -0.5, 0, 7); pd.fillStyle = 'rgba(255,255,255,.28)'; pd.fill();
    }
    btn(-322, -30, 58, '#f6a55a', '#c9661a'); btn(-236, 62, 44, '#fff4e0', '#cfc2a8');           // 左: 無地の丸 2 つ
    pd.save(); pd.translate(292, 8); pd.rotate(-0.42);                                         // 右: 無地の小判 2 つ
    for (var j = 0; j < 2; j++) { rr(pd, -74, -62 + j * 84 + 5, 148, 52, 26); pd.fillStyle = 'rgba(0,0,0,.42)'; pd.fill(); var q2 = pd.createLinearGradient(0, -62 + j * 84, 0, -10 + j * 84); q2.addColorStop(0, '#8d8f97'); q2.addColorStop(1, '#5c5e66'); rr(pd, -70, -62 + j * 84, 140, 46, 23); pd.fillStyle = q2; pd.fill(); }
    pd.restore();
    rr(pd, LCD.x - 22, LCD.y - 20, LCD.w + 44, LCD.h + 40, 30); pd.fillStyle = '#17171a'; pd.fill();   // 液晶のふち
    rr(pd, LCD.x, LCD.y, LCD.w, LCD.h, 12); pd.fillStyle = '#a9b596'; pd.fill();
    // スティックの穴(取れている。かわりに 鼻を使う)
    var hy = 128; pd.beginPath(); pd.arc(0, hy, 60, 0, 7); pd.fillStyle = '#101012'; pd.fill();
    pd.strokeStyle = 'rgba(255,255,255,.14)'; pd.lineWidth = 5; pd.beginPath(); pd.arc(0, hy + 2, 62, 0.2, 2.94); pd.stroke();
    pd.beginPath(); pd.arc(0, hy, 17, 0, 7); pd.fillStyle = '#6d6f76'; pd.fill(); pd.fillStyle = '#2a2a2e'; pd.fillRect(-11, hy - 3, 22, 6); pd.fillRect(-3, hy - 11, 6, 22);
    for (var d = 0; d < 6; d++) { pd.beginPath(); pd.arc(120 + (d % 3) * 22, 112 + Math.floor(d / 3) * 22, 6, 0, 7); pd.fillStyle = '#141416'; pd.fill(); }
    pd.restore();
  }

  // ---- 液晶(コントローラーの小さな画面)----
  var LD = '#27301f', LG = 'rgba(39,48,31,.16)';
  function drawLcd(time, ts) {
    fx.save(); fx.translate(540 + LCD.x, padY + LCD.y);
    fx.fillStyle = LD; fx.strokeStyle = LD; fx.textBaseline = 'middle';
    var cx = 78, cy = 88, r = 54;
    fx.lineWidth = 5; fx.beginPath(); fx.arc(cx, cy, r, 0, 7); fx.stroke();
    if (st === 'PLAY' && game) {
      var n = game.notes[Math.min(game.k, game.notes.length - 1)];
      if (n && !game.over) {
        var v = G.VEC[n.dir], lead = clamp((n.t - ts) / Math.min(n.gap, 750), 0, 1);
        fx.beginPath(); fx.arc(cx + v[0] * r, cy + v[1] * r, n.dir === 'C' ? 15 : 14, 0, 7); fx.fill();
        fx.lineWidth = 4; fx.beginPath(); fx.arc(cx + v[0] * r, cy + v[1] * r, 15 + lead * 26, 0, 7); fx.stroke();
      }
      fx.font = '66px ' + FONT; fx.textAlign = 'center'; fx.fillText(String(game.combo), 226, 60);
      fx.fillStyle = LG; fx.fillRect(150, 150, 130, 10); fx.fillStyle = LD; fx.fillRect(150, 150, 130 * game.progress(), 10);
      for (var i = 0; i < 3; i++) { fx.fillStyle = i < 3 - game.stage ? LD : LG; fx.font = (22 + i * 6) + 'px ' + FONT; fx.fillText('z', 172 + i * 34, 122 - i * 5); }
    } else {
      fx.font = '40px ' + FONT; fx.textAlign = 'center';
      var m = lcdMsg != null ? lcdMsg : (Math.floor(time / 600) % 2 ? T('グリグリ', 'WIGGLE') : '');
      fx.fillText(m, 214, 70); if (lcdMsg2) { fx.font = '30px ' + FONT; fx.fillText(lcdMsg2, 214, 122); }
    }
    fx.fillStyle = 'rgba(39,48,31,.85)'; fx.beginPath(); fx.arc(cx + clamp(raw.x, -1.2, 1.2) * r * 0.92, cy + clamp(raw.y, -1.2, 1.2) * r * 0.92, 9, 0, 7); fx.fill();
    fx.restore();
  }
  var lcdMsg2 = null;

  // ---- 親指(マウスのときだけ描く。⚠️仮の絵。スマホは 本物の親指が そこにある)----
  function drawThumb(x, y, down) {
    fx.save(); fx.translate(x, y); fx.rotate(-0.5); var s = down ? 0.97 : 1.03; fx.scale(s, s);
    var w = 176, L = 1500;
    fx.save(); fx.shadowColor = 'rgba(40,20,6,' + (down ? 0.5 : 0.3) + ')'; fx.shadowBlur = (down ? 18 : 44) * U * DPR; fx.shadowOffsetY = (down ? 8 : 30) * U * DPR; fx.shadowOffsetX = (down ? 4 : 16) * U * DPR;
    rr(fx, -w / 2, -70, w, L, w / 2); fx.fillStyle = '#e2ad8c'; fx.fill(); fx.restore();
    var g = fx.createLinearGradient(-w / 2, 0, w / 2, 0); g.addColorStop(0, '#c98f6f'); g.addColorStop(0.22, '#e9b898'); g.addColorStop(0.6, '#f1c5a6'); g.addColorStop(1, '#cf9676');
    rr(fx, -w / 2, -70, w, L, w / 2); fx.fillStyle = g; fx.fill();
    var ng = fx.createLinearGradient(0, -58, 0, 70); ng.addColorStop(0, '#fbe3d6'); ng.addColorStop(1, '#eeb9a6');
    rr(fx, -56, -56, 112, 128, 50); fx.fillStyle = ng; fx.fill(); fx.strokeStyle = 'rgba(150,90,70,.35)'; fx.lineWidth = 3; fx.stroke();
    fx.beginPath(); fx.ellipse(-18, -22, 16, 34, 0.2, 0, 7); fx.fillStyle = 'rgba(255,255,255,.35)'; fx.fill();
    fx.strokeStyle = 'rgba(150,90,60,.28)'; fx.lineWidth = 4; for (var i = 0; i < 3; i++) { fx.beginPath(); fx.moveTo(-58, 250 + i * 16); fx.quadraticCurveTo(0, 262 + i * 16 + (i - 1) * 6, 58, 250 + i * 16); fx.stroke(); }
    fx.restore();
  }

  // ---- 前の層(合図・判定の字・しぶき・親指)----
  function label(s, x, y, size, col, a, rot) {
    fx.save(); fx.translate(x, y); if (rot) fx.rotate(rot); fx.globalAlpha = a; fx.font = size + 'px ' + FONT; fx.textAlign = 'center'; fx.textBaseline = 'middle';
    fx.lineJoin = 'round'; fx.strokeStyle = PAPER; fx.lineWidth = size * 0.22; fx.strokeText(s, 0, 0); fx.fillStyle = col; fx.fillText(s, 0, 0); fx.restore();
  }
  function ring(x, y, r, lw, col, a) { fx.globalAlpha = a; fx.beginPath(); fx.arc(x, y, r, 0, 7); fx.lineWidth = lw + 6; fx.strokeStyle = PAPER; fx.stroke(); fx.lineWidth = lw; fx.strokeStyle = col; fx.stroke(); fx.globalAlpha = 1; }
  function drawFx(time, ts, dt) {
    sx(fx); fx.clearRect(0, 0, W, H);
    var i, p;
    if (padDrop < 0.02 && st !== 'LOAD') drawLcd(time, ts);
    // 合図: 鼻のまわりの輪と、倒す向きの印
    if (st === 'PLAY' && game && !game.over) {
      ring(nose.x, nose.y, RS, 5, INK, 0.5);
      for (var k = Math.min(game.k + 1, game.notes.length - 1); k >= game.k; k--) {
        var n = game.notes[k]; if (!n || n.t - ts > 1500) continue;
        var v = G.VEC[n.dir], tx = nose.x + v[0] * RS, ty = nose.y + v[1] * RS, cur = k === game.k;
        var lead = clamp((n.t - ts) / Math.min(n.gap, 750), 0, 1);
        if (!cur) { fx.globalAlpha = 0.35; fx.beginPath(); fx.arc(tx, ty, 14, 0, 7); fx.fillStyle = INK; fx.fill(); fx.globalAlpha = 1; continue; }
        if (n.dir === 'C') { ring(tx, ty, 64 + lead * 110, 7, WARN, 0.9); if (!n.hold || lead < 0.99) label(T('とめる', 'Still'), nose.x, nose.y - 215, 64, WARN, 1, 0); continue; }
        fx.beginPath(); fx.arc(tx, ty, 34, 0, 7); fx.fillStyle = PAPER; fx.fill(); fx.beginPath(); fx.arc(tx, ty, 26, 0, 7); fx.fillStyle = GINGER; fx.fill();
        ring(tx, ty, 34 + lead * 80, 6, INK, 0.85);
      }
    }
    for (i = hitFx.length - 1; i >= 0; i--) { p = hitFx[i]; p.t += dt; if (p.t > 0.3) { hitFx.splice(i, 1); continue; } ring(p.x, p.y, 34 + ease(p.t / 0.3) * 60, 8 * (1 - p.t / 0.3) + 1, p.c, 1 - p.t / 0.3); }
    for (i = drops.length - 1; i >= 0; i--) { p = drops[i]; p.t += dt; if (p.t > 0.6) { drops.splice(i, 1); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * dt; fx.globalAlpha = (1 - p.t / 0.6) * 0.8; fx.beginPath(); fx.arc(p.x, p.y, p.r, 0, 7); fx.fillStyle = '#f4fbff'; fx.fill(); fx.globalAlpha = 1; }
    for (i = pops.length - 1; i >= 0; i--) { p = pops[i]; p.t += dt; if (p.t > p.d) { pops.splice(i, 1); continue; } var a = Math.min(1, p.t / 0.08) * Math.min(1, (p.d - p.t) / 0.18), sc2 = 0.94 + 0.06 * ease(p.t / 0.12); label(p.s, p.x, p.y - ease(p.t / p.d) * 26, p.size * sc2, p.c, a, p.rot); }
    // 親指
    if (ptr.type !== 'touch' && ptr.seen && st !== 'RESULT' && st !== 'LOAD') drawThumb((ptr.down ? nose.x + nx.x : ptr.x) + 26, (ptr.down ? nose.y + ny.x : ptr.y) + 62, ptr.down);
  }
  function pop(s, c, size, x, y, d) { pops.push({ s: s, c: c, size: size || 60, x: x == null ? nose.x + 250 : x, y: y == null ? nose.y - 110 : y, t: 0, d: d || 0.55, rot: x == null ? 0.1 : 0 }); if (pops.length > 6) pops.shift(); }

  // ---- 入力(指 1 本。押した所からの ずれ = 倒し)----
  function toStage(e) { var r = cFx.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; }
  function setRaw(t, x, y, touch) {
    var m = Math.sqrt(x * x + y * y);
    if (m > 1) { var m2 = 1 + (1 - Math.exp(-(m - 1) * 0.9)) * 0.28; x *= m2 / m; y *= m2 / m; }   // 端は ゴムのように重くなる
    raw.x = x; raw.y = y;
    var z = null; ['L', 'R', 'U', 'D'].forEach(function (d) { if (G.inZone(d, x, y)) z = d; });
    if (z !== raw.zone) { if (z) { haptic('tick'); play('squish'); } else if (touch) haptic('back'); raw.zone = z; }
    if (st === 'ENDING' || st === 'RESULT') { x = 0; y = 0; press.t = 0; }      // 終わったら 鼻は戻る(指は置いたままでも)
    nx.t = x * RS; ny.t = y * RS; lx.t = nx.t; ly.t = ny.t;
    if (st === 'PLAY' && game && !game.over) handle(game.input(t - P0, x, y, touch));
    else if (st === 'TITLE' && touch && z && performance.now() > startArm) wiggled = true;
  }
  function down(e) {
    if (ptr.id !== null || st === 'RESULT' || st === 'LOAD') return;
    audioOn();
    var p = toStage(e); ptr.type = e.pointerType || 'mouse'; ptr.seen = true; ptr.x = p[0]; ptr.y = p[1];
    var dx = p[0] - (nose.x + nx.x), dy = p[1] - (nose.y + ny.x);
    if (dx * dx + dy * dy > 300 * 300) return;                 // 鼻の近くだけ
    ptr.id = e.pointerId; ptr.down = true; ptr.x0 = p[0]; ptr.y0 = p[1];
    try { cFx.setPointerCapture(e.pointerId); } catch (err) {}
    press.t = 1; nx.k = ny.k = 900; nx.c = ny.c = 46;          // 押している間は 指に ぴったり寄る
    cFx.style.cursor = 'grabbing';
    setRaw(e.timeStamp, 0, 0, true); e.preventDefault();
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
    audioOn();                                   // スマホは 指を離した時に はじめて音が出せる → だから「グリグリして 離すと はじまる」
    setRaw(e.timeStamp, 0, 0, false);
    if (st === 'TITLE' && wiggled) begin(e.timeStamp);
  }
  cFx.addEventListener('pointerdown', down); cFx.addEventListener('pointermove', move);
  cFx.addEventListener('pointerup', up); cFx.addEventListener('pointercancel', up);
  cFx.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

  // ---- 進行 ----
  function toTitle(first) {
    st = 'TITLE'; game = null; endKind = null; lcdMsg = null; lcdMsg2 = null; padDrop = 0; glAlpha = 1; go = null; cPad.style.transform = ''; cGl.style.opacity = 1;
    eyeL.t = eyeR.t = 0; earL.t = earR.t = 0; headY.t = 0; scr.t = 0; drawBg();
    titleEl.querySelector('h1').textContent = first ? T('鼻ボタン', 'Nose Button') : '';
    titleEl.querySelector('p').textContent = T('鼻を グリグリして 離すと はじまる', 'Wiggle the nose, then let go');
    titleEl.classList.remove('off'); resEl.classList.remove('on'); hintEl.classList.remove('on');
    startArm = performance.now() + (first ? 0 : 350); wiggled = false;
  }
  function begin(t) {
    st = 'PLAY'; runs++;
    var seed = +(Q.get('seed') || 0) || (Date.now() % 100000) + runs;
    chart = G.makeChart(seed); game = new G.Game(chart); P0 = t; beatI = 0; noteS = 0; stirT = -1e9;
    titleEl.classList.add('off');
    hintEl.textContent = T('いびきに合わせて 印のほうへ 倒す', 'On each snore, push toward the dot'); hintEl.classList.add('on');
  }
  var WORD = { perfect: ['ぴったり', 'Perfect'], good: ['いいね', 'Nice'], hold: ['そのまま', 'Good'], miss: ['フガッ', 'Snrk'], moved: ['うごいた', 'Moved'] };
  function handle(evs) {
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e.type === 'judge') {
        var gr = e.grade, n = e.note, v = G.VEC[n.dir];
        if (gr === 'ok') { pop(e.err < 0 ? T('はやい', 'Early') : T('おそい', 'Late'), INK, 52); play('ok'); }
        else if (n.early) { pop(T('はやすぎ', 'Too early'), WARN, 58); }
        else if (gr === 'idle') { /* さわっていない: 何も言わない */ }
        else { pop(T(WORD[gr][0], WORD[gr][1]), gr === 'perfect' ? GINGER : gr === 'miss' || gr === 'moved' ? WARN : INK, gr === 'perfect' ? 70 : 58); }
        if (gr === 'perfect' || gr === 'good') { play(gr); haptic('good'); hitFx.push({ x: nose.x + v[0] * RS, y: nose.y + v[1] * RS, t: 0, c: GINGER }); }
        if (gr === 'miss' || gr === 'moved') { play('miss'); scr.x = 1; headY.v += 120; }
        if (n.i === 7) hintEl.classList.remove('on');
      } else if (e.type === 'stage') {
        if (e.stage === 1) { earL.v = 7; play('ear'); haptic('ear'); setTimeout(function () { earR.v = 6; }, 130); eyeR.t = 0; }
        if (e.stage === 2) { eyeR.t = 0.92; play('eye'); haptic('eye'); earL.v = 5; }
        if (e.stage === 0) { eyeR.t = 0; }
      } else if (e.type === 'end') { endKind = e.kind; endT = performance.now(); st = 'ENDING'; hintEl.classList.remove('on'); endStep = 0; if (ptr.id === null) { nx.t = ny.t = 0; } }
    }
  }
  var endStep = 0;
  function ending(now) {
    var t = now - endT;
    function at(ms, step, fn) { if (t >= ms && endStep < step) { endStep = step; fn(); } }
    if (endKind === 'woke') {
      at(0, 1, function () { scr.t = 1; headY.t = -16; eyeR.t = 0.25; play('sniff'); haptic('stir'); });           // は…
      at(420, 2, function () { headY.t = 0; headY.v = 900; scr.t = 0; play('sneeze'); haptic('sneeze'); earL.v = 9; earR.v = -9;      // くしゅん
        for (var i = 0; i < 26; i++) { var a = Math.PI * (0.15 + Math.random() * 0.7); drops.push({ x: nose.x + (Math.random() - 0.5) * 60, y: nose.y + 40, vx: Math.cos(a) * (200 + Math.random() * 520) * (Math.random() < 0.5 ? -1 : 1), vy: 120 + Math.random() * 420, r: 4 + Math.random() * 7, t: 0 }); }
        pop(T('くしゅん', 'Achoo'), WARN, 96, nose.x, nose.y - 330, 0.9); });
      at(760, 3, function () { eyeL.t = eyeR.t = 1; lcdMsg = ''; });                                                 // 目があく
      at(2000, 4, function () { padDrop = 1; go = { x: nose.x, y: nose.y - 40, s: 1.5, a: 0, ph: 0 }; });             // 立って 行ってしまう
      if (endStep >= 4) {
        var q = clamp((t - 2000) / 2100, 0, 1), f = clamp((t - 2000) / 180, 0, 1);
        glAlpha = 1 - f; cGl.style.opacity = glAlpha; go.a = f * (1 - clamp((q - 0.86) / 0.14, 0, 1)); go.ph += 0.2;
        go.x = lerp(nose.x, 690, ease(q)); go.y = lerp(nose.y - 40, H * 0.12, q * q * 0.5 + q * 0.5); go.s = lerp(1.5, 0.62, q);
        var d = clamp((t - 2000) / 260, 0, 1), b = d < 1 ? d * d : 1 - Math.max(0, Math.sin((t - 2260) / 60)) * Math.exp(-(t - 2260) / 90) * 0.12;
        cPad.style.transform = 'translate(' + (-8 * b * U) + 'px,' + (150 * b * U) + 'px) rotate(' + (-3.5 * b) + 'deg)';
        if (d >= 1 && endStep < 5) { endStep = 5; play('thud'); haptic('thud'); }
        drawBg();
      }
      if (t > 4300) result();
    } else if (endKind === 'clear') {
      at(0, 1, function () { lcdMsg = T('クリア', 'CLEAR'); lcdMsg2 = game.percent() + '%'; play('clear'); haptic('clear'); });
      at(700, 2, function () { play('sigh'); headY.t = 5; });
      if (t > 1700) result();
    } else {
      at(0, 1, function () { lcdMsg = T('おしまい', 'GAME OVER'); lcdMsg2 = ''; play('over'); });
      if (t > 1900) result();
    }
  }
  var RANKS = [['鼻スティックの神', 'Nose-stick deity'], ['グリグリ名人', 'Wiggle master'], ['いい親指', 'Good thumb'], ['ふつうの親指', 'Average thumb'], ['ねぼけ親指', 'Sleepy thumb']];
  var shareText = '';
  function result() {
    st = 'RESULT';
    var pct = game.percent(), rk = G.rank(pct), big = $('r-big'), rank = $('r-rank');
    big.className = ''; rank.className = '';
    if (endKind === 'clear') {
      $('r-label').textContent = T('シンクロ率', 'In sync'); big.textContent = pct + '%'; rank.textContent = T(RANKS[rk][0], RANKS[rk][1]);
      $('r-line').textContent = T('最大コンボ ', 'Best combo ') + game.maxCombo + T(' ・ 犬は 寝たまま', ' · the dog slept through it');
      shareText = T('鼻ボタン シンクロ率 ' + pct + '%「' + RANKS[rk][0] + '」犬は寝たまま', 'Nose Button: ' + pct + '% in sync, "' + RANKS[rk][1] + '". The dog slept through it');
    } else if (endKind === 'woke') {
      $('r-label').textContent = Math.round(game.progress() * 100) + T('% のところで', '% of the way in'); big.className = 'word'; big.textContent = T('起こした', 'You woke him');
      rank.className = 'bad'; rank.textContent = T('犬は 行ってしまった', 'The dog walked off');
      $('r-line').textContent = T('いびきに合わせて、印のほうへ', 'Follow the snore, push toward the dot');
      shareText = T('鼻ボタン ' + Math.round(game.progress() * 100) + '% のところで犬を起こした', 'Nose Button: woke the dog ' + Math.round(game.progress() * 100) + '% of the way in');
    } else {
      $('r-label').textContent = T('犬は', 'The dog is'); big.className = 'word'; big.textContent = T('ぐっすり', 'Sound asleep');
      rank.className = 'bad'; rank.textContent = T('ゲームは だれも遊ばなかった', 'Nobody played the game');
      $('r-line').textContent = T('鼻が スティックです', 'The nose is the stick');
      shareText = T('鼻ボタン 犬はぐっすり', 'Nose Button: the dog is sound asleep');
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

  // ---- 毎コマ ----
  var last = 0;
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    var ts = st === 'PLAY' || st === 'ENDING' ? now - P0 : 0;
    if (st === 'PLAY' && game) {
      // 音は少し先まで予約する(いびき = 拍、ぴっ = 音符)
      while (beatI < chart.beats.length && chart.beats[beatI].t - ts < 180) { var b = chart.beats[beatI++]; if (!b.quiet) { play('snore', P0 + b.t); if (60000 / b.bpm > 500) play('whistle', P0 + b.t + 30000 / b.bpm); } }
      while (noteS < chart.notes.length && chart.notes[noteS].t - ts < 180) { var n = chart.notes[noteS++]; if (n.dir === 'C' && !n.hold) stirT = P0 + n.t - 60000 / 80; else if (n.dir !== 'C') play('pip', P0 + n.t); }
      if (stirT > 0 && now >= stirT) { stirT = -1e9; play('stir'); haptic('stir'); eyeL.t = 0.3; earR.v = 5; setTimeout(function () { if (st === 'PLAY') eyeL.t = 0; }, 520); }   // 犬が もぞっとする → とめる
      handle(game.advance(ts));
    }
    if (st === 'ENDING') ending(now);
    nx.step(dt); ny.step(dt); lx.step(dt); ly.step(dt); press.step(dt); eyeL.step(dt); eyeR.step(dt); earL.step(dt); earR.step(dt); headY.step(dt); scr.step(dt);
    if (st !== 'ENDING') scr.t = 0;
    drawDog(now); drawFx(now, ts, dt);
    requestAnimationFrame(frame);
  }

  // ---- 検査用の のぞき窓 ----
  window.__hb = {
    get state() { return st; }, get game() { return game; }, get chart() { return chart; }, get P0() { return P0; }, get end() { return endKind; },
    get nose() { var r = cFx.getBoundingClientRect(); return { x: r.left + nose.x / W * r.width, y: r.top + nose.y / H * r.height, rs: RS / W * r.width, nx: nx.x, ny: ny.x }; },
    get sounds() { return soundLog; }, get haptics() { return hapticLog; }, get audio() { return AC ? AC.state : 'none'; },
    get dog() { return { eyeL: eyeL.x, eyeR: eyeR.x, earL: earL.x, press: press.x, stage: game ? game.stage : 0 }; },
    get endStep() { return endStep; }, get endMs() { return st === 'ENDING' ? performance.now() - endT : -1; },
    level: function () { if (!analyser) return 0; var d = new Float32Array(analyser.fftSize), m = 0; analyser.getFloatTimeDomainData(d); for (var i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); return m; },
    spectrum: function () { if (!analyser) return []; var d = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(d); var best = 0, bi = 0; for (var i = 0; i < d.length; i++) if (d[i] > best) { best = d[i]; bi = i; } return [bi * AC.sampleRate / analyser.fftSize, best]; },
    lang: JA ? 'ja' : 'en', get H() { return H; }
  };

  layout(); window.addEventListener('resize', layout);
  Promise.all([load('dog', 'assets/dog.webp'), load('floor', 'assets/floor.webp'), load('go', 'assets/dog_go.webp'),
    (document.fonts && document.fonts.load ? document.fonts.load('700 40px "ZenMaru"', 'あ').catch(function () {}) : 0)]).then(function () {
    glInit(); ready = true; layout(); toTitle(true); requestAnimationFrame(frame);
  }).catch(function (e) { document.body.insertAdjacentHTML('beforeend', '<p style="color:#fff;padding:20px">load error: ' + e + '</p>'); });
})();
