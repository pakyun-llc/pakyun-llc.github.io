// 顔芸(試作): 顔の動きで、顔が変形して音が鳴る。映像は端末の中だけで処理する。
// 顔の追跡 = MediaPipe Face Landmarker(ブラウザ内)。変形 = WebGL の逆写像。音 = WebAudio の合成。
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const $ = (id) => document.getElementById(id);
const video = $("cam"), canvas = $("gl"), probe = $("probe");
const params = new URLSearchParams(location.search);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
// きっかけ(顔の動き)ごとに 1 つの型。ぜんぶ同時に効く。tilt と side は左右があるので -1〜1
const CH = ["open", "brow", "eye", "puck", "smile", "winkL", "winkR", "tilt", "side", "near", "tongue"];
const NAMES = { open: "アコーディオン", brow: "額ポンプ", eye: "目玉", puck: "吸いこみ", smile: "ほっぺ", winkL: "ねじれ", winkR: "ねじれ", tilt: "ずり落ち", side: "鼻ねじ", near: "むぎゅ", tongue: "舌キラキラ" };
const TRY = [["brow", "眉を上げる"], ["open", "口を開ける"], ["puck", "口をすぼめる"], ["smile", "にっこり笑う"], ["tilt", "首をかしげる"], ["winkL", "片目をつぶる"], ["eye", "目を見開く"], ["side", "口を横にずらす"], ["tongue", "舌を出す"], ["near", "顔を近づける"]];
const zero = () => Object.fromEntries(CH.map((k) => [k, 0]));
const state = { phase: "start", face: false, t: zero(), v: zero(), slide: [0, 0], fps: 0, pings: 0, err: "", force: null, done: {} };
window.__kao = state;

// ---------- 見た目(WebGL) ----------
const gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: params.has("test") });
const VS = `attribute vec2 a; varying vec2 vS; void main(){ vS = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;
const FS = `precision highp float;
varying vec2 vS; uniform sampler2D uTex;
uniform vec2 uCover;      // 画面 → 映像の拡大(cover)
uniform float uAspect;    // 映像の 横/縦
uniform float uOpen, uBrow, uEye, uPuck, uSmile, uWinkL, uWinkR, uSide, uNear, uTongue;
uniform vec2 uSlide;      // ずり落ちる向き × 量
uniform vec2 uEyeL, uEyeR, uFore, uNose, uMouth, uChin; uniform float uW;
float fall(float r){ float f = 1.0 - r * r; return f * f; }
vec2 bulge(vec2 p, vec2 c, float R, float k){
  vec2 d = p - c; float r = length(d) / R;
  if (r >= 1.0) return p;
  return c + d * (1.0 - k * fall(r));
}
vec2 swirl(vec2 p, vec2 c, float R, float ang){
  vec2 d = p - c; float r = length(d) / R;
  if (r >= 1.0) return p;
  float a = ang * fall(r), cs = cos(a), sn = sin(a);
  return c + vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
}
// 軸 u に沿って、from から先の長さ L を ext だけ引き伸ばす(横幅 w0〜w1 の帯だけ)
vec2 stretch(vec2 p, vec2 from, vec2 u, float L, float ext, float w0, float w1, float tail){
  vec2 v = vec2(-u.y, u.x); vec2 d = p - from;
  float t = dot(d, u), s = dot(d, v), t2 = t;
  if (t > 0.0) {
    if (t <= L + ext) t2 = t * L / (L + ext);
    else if (t <= L + ext + tail) t2 = L + (t - L - ext) * (ext + tail) / tail;
  }
  float w = 1.0 - smoothstep(w0, w1, abs(s));
  return from + u * mix(t, t2, w) + v * s;
}
void main(){
  vec2 uv = (vS - 0.5) * uCover + 0.5; uv.x = 1.0 - uv.x; uv.y = 1.0 - uv.y;
  vec2 p = vec2(uv.x * uAspect, uv.y);
  vec2 up = normalize(uChin - uFore), rt = vec2(-up.y, up.x);
  // 大きい変形から順に。どれも元の顔の位置を基準にしているので、同時に効かせても破綻しにくい
  p = bulge(p, uNose, uW * 1.15, 0.5 * uNear);                       // むぎゅ(魚眼)
  { vec2 d = p - uNose; float r = length(d) / (uW * 0.62);           // ずり落ち
    if (r < 1.0) p -= uSlide * uW * 0.34 * fall(r); }
  { float L = max(dot(uChin - uNose, up), 0.01);                      // アコーディオン
    p = stretch(p, uNose, up, L, L * 1.25 * uOpen, uW * 0.50, uW * 0.86, uW * 1.6); }
  { float L = max(dot(uChin - uMouth, up), 0.01);                     // 舌
    p = stretch(p, uMouth, up, L, L * 2.0 * uTongue, uW * 0.26, uW * 0.52, uW * 1.4); }
  { vec2 d = p - uMouth; float r = length(d) / (uW * 0.75);          // ほっぺ(横に伸びる)
    if (r < 1.0) { float s = dot(d, rt); p -= rt * s * (1.0 - 1.0 / (1.0 + 1.1 * uSmile * fall(r))); } }
  p = bulge(p, uMouth, uW * 0.95, -0.95 * uPuck);                    // 吸いこみ
  p = swirl(p, mix(uNose, uMouth, 0.6), uW * 0.5, 1.6 * uSide);      // 鼻ねじ
  float ek = min(0.30 * uBrow + 0.62 * uEye, 0.8);                    // 額ポンプ+目玉
  p = bulge(p, uEyeL, uW * 0.34, ek); p = bulge(p, uEyeR, uW * 0.34, ek);
  p = bulge(p, uFore, uW * 0.86, 0.46 * uBrow);
  p = swirl(p, uEyeL, uW * 0.36, 2.6 * uWinkL);                      // ねじれ
  p = swirl(p, uEyeR, uW * 0.36, -2.6 * uWinkR);
  uv = vec2(p.x / uAspect, p.y);
  gl_FragColor = texture2D(uTex, clamp(uv, 0.0, 1.0));
}`;
function shader(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog); gl.useProgram(prog);
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.bindAttribLocation(prog, 0, "a"); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
const U = {}; for (const n of ["uTex", "uCover", "uAspect", "uOpen", "uBrow", "uEye", "uPuck", "uSmile", "uWinkL", "uWinkR", "uSide", "uNear", "uTongue", "uSlide", "uEyeL", "uEyeR", "uFore", "uNose", "uMouth", "uChin", "uW"]) U[n] = gl.getUniformLocation(prog, n);
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
}

// ---------- 音(WebAudio の合成。素材ファイルは使わない) ----------
let ac, master, whistle, squeeze, shimmer, V = {};
function setupAudio() {
  ac = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 8;
  master = ac.createGain(); master.gain.value = 0.7; master.connect(comp); comp.connect(ac.destination);
  if (params.has("test")) { const an = ac.createAnalyser(); an.fftSize = 2048; comp.connect(an); const buf = new Float32Array(2048);
    setInterval(() => { an.getFloatTimeDomainData(buf); let q = 0; for (const v of buf) q += v * v; state.rms = Math.sqrt(q / buf.length); }, 100); }
  const osc = (type, f, to) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; if (to) o.connect(to); o.start(); return o; };
  const gain = (v, to) => { const g = ac.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };

  // 眉 = ゴム笛: 上げるほど音程が上がる
  { const g = gain(0, master), g2 = gain(0.35, g), lg = gain(0);
    const o = osc("triangle", 330, g), o2 = osc("sine", 660, g2), lfo = osc("sine", 6.5, lg);
    lg.connect(o.frequency); lg.connect(o2.frequency); whistle = { o, o2, g, lg }; }

  // 口 = 蛇腹: 開くときと閉じるときで和音が変わる。動かす速さで鳴る
  { const f = ac.createBiquadFilter(), g = gain(0, master); f.type = "lowpass"; f.frequency.value = 700; f.Q.value = 1.2; f.connect(g);
    const mk = (notes) => { const bus = gain(0, f); for (const n of notes) for (const det of [-7, 6]) osc("sawtooth", n, bus).detune.value = det; return bus; };
    squeeze = { f, g, pull: mk([196.0, 246.9, 293.7, 392.0]), push: mk([220.0, 261.6, 349.2, 440.0]) }; }

  // 舌 = キラキラ: 高い鈴の音。少し残響をつける
  { const bus = gain(0.9, master), d = ac.createDelay(0.5), fb = gain(0.32); d.delayTime.value = 0.19;
    bus.connect(d); d.connect(fb); fb.connect(d); d.connect(master); shimmer = bus; }

  // 目 = ひゅいん
  { const g = gain(0, master); V.eye = { o: osc("sine", 900, g), g }; }
  // すぼめる = じゅるる(雑音を細く通して、ごぼごぼ揺らす)
  { const n = ac.createBufferSource(), b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), ch = b.getChannelData(0);
    for (let k = 0; k < ch.length; k++) ch[k] = Math.random() * 2 - 1;
    n.buffer = b; n.loop = true; const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1000; f.Q.value = 5;
    const wob = gain(0.5), g = gain(0, master), lg = gain(0.5); osc("sine", 17, lg); lg.connect(wob.gain);
    n.connect(f); f.connect(wob); wob.connect(g); n.start(); V.puck = { f, g }; }
  // 笑う = ゴム弦(動かした時だけ びよん)
  { const f = ac.createBiquadFilter(), g = gain(0, master); f.type = "lowpass"; f.frequency.value = 900; f.connect(g); V.smile = { o: osc("sawtooth", 98, f), g }; }
  // かしげる = ぽよよ
  { const g = gain(0, master), lg = gain(0), o = osc("sine", 262, g); osc("sine", 9, lg); lg.connect(o.frequency); V.tilt = { o, g, lg }; }
  // 口を横に = きゅっ
  { const g = gain(0, master); V.side = { o: osc("triangle", 1400, g), g }; }
  // 近づく = むぎゅ
  { const f = ac.createBiquadFilter(), g = gain(0, master); f.type = "lowpass"; f.frequency.value = 300; f.connect(g); V.near = { o: osc("sawtooth", 62, f), f, g }; }
}
const BELLS = [1568, 1760, 2093, 2349, 2637, 3136, 3520, 4186];
function ping(i) {
  if (!ac) return; state.pings++;
  const t = ac.currentTime, f = BELLS[((i % BELLS.length) + BELLS.length) % BELLS.length];
  for (const [mul, vol, dec] of [[1, 0.20, 0.55], [2.76, 0.05, 0.22], [5.4, 0.02, 0.12]]) {
    const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f * mul;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(g); g.connect(shimmer); o.start(t); o.stop(t + dec + 0.05);
  }
}
function blip(f) { // ウインクの くりっ
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(); o.type = "square";
  o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.07);
  g.gain.setValueAtTime(0.11, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.14);
}
const last = zero(), move = zero();
let lick = 0, lastTX = 0, bell = 0;
function updateSound(dt) {
  if (!ac) return;
  const t = ac.currentTime, x = state.face || state.force ? state.t : zero();
  // 動かした速さ(0〜1)。止めている間は静かになる音に使う
  const vel = {}; for (const k of CH) { vel[k] = (x[k] - last[k]) / Math.max(dt, 0.001); move[k] += (Math.min(Math.abs(vel[k]) * 0.35, 1) - move[k]) * Math.min(1, dt * 9); }
  const set = (p, v, tc = 0.04) => p.setTargetAtTime(v, t, tc);
  // 眉: 笛
  const b = x.brow; set(whistle.o.frequency, 330 * Math.pow(2, b * 1.7), 0.03); set(whistle.o2.frequency, 660 * Math.pow(2, b * 1.7), 0.03);
  set(whistle.lg.gain, 4 + b * 14, 0.1); set(whistle.g.gain, b > 0.08 ? 0.07 + 0.16 * b : 0, b > 0.08 ? 0.03 : 0.06);
  // 口: 蛇腹
  const a = x.open;
  if (Math.abs(vel.open) > 0.25) { set(squeeze.pull.gain, vel.open > 0 ? 1 : 0, 0.03); set(squeeze.push.gain, vel.open > 0 ? 0 : 1, 0.03); }
  set(squeeze.f.frequency, 600 + 2400 * a, 0.05); set(squeeze.g.gain, Math.min(1, move.open + 0.12 * (a > 0.1 ? a : 0)) * 0.085);
  // 目
  set(V.eye.o.frequency, 900 * Math.pow(2, x.eye * 1.1), 0.05); set(V.eye.g.gain, x.eye > 0.1 ? 0.03 + 0.08 * x.eye : 0, 0.05);
  // すぼめる
  set(V.puck.f.frequency, 1100 - 650 * x.puck, 0.06); set(V.puck.g.gain, x.puck > 0.1 ? 1.3 * x.puck : 0, 0.05);
  // 笑う
  set(V.smile.o.frequency, 98 * Math.pow(2, x.smile * 1.4), 0.03); set(V.smile.g.gain, move.smile * 0.11 + (x.smile > 0.1 ? 0.012 * x.smile : 0));
  // かしげる
  const tl = Math.abs(x.tilt); set(V.tilt.o.frequency, 262 * Math.pow(2, x.tilt * 0.7), 0.05); set(V.tilt.lg.gain, 6 + move.tilt * 40, 0.08);
  set(V.tilt.g.gain, tl > 0.08 ? 0.04 + 0.09 * tl : 0, 0.06);
  // 口を横に
  set(V.side.o.frequency, 1400 * Math.pow(2, x.side * 0.5), 0.02); set(V.side.g.gain, Math.abs(x.side) > 0.08 ? move.side * 0.09 : 0, 0.03);
  // 近づく
  set(V.near.f.frequency, 300 + 500 * x.near, 0.06); set(V.near.g.gain, x.near > 0.08 ? 0.2 * x.near : 0, 0.06);
  // ウインク: つぶった瞬間に 1 回
  if (x.winkL > 0.5 && last.winkL <= 0.5) blip(320);
  if (x.winkR > 0.5 && last.winkR <= 0.5) blip(640);
  // 舌: 出た瞬間に 3 つ、動かすたびに 1 つ
  const tg = x.tongue;
  if (tg > 0.35 && last.tongue <= 0.35) { for (let i = 0; i < 3; i++) setTimeout(() => ping(bell++ + 2), i * 70); lick = 0; }
  if (tg > 0.35) { lick += Math.abs(state.tongueX - lastTX) * 3.2 + Math.abs(tg - last.tongue) * 0.8;
    if (lick > 0.16) { lick = 0; bell += Math.random() < 0.5 ? 1 : 2; ping(bell + (Math.random() < 0.3 ? 3 : 0)); } }
  lastTX = state.tongueX || 0;
  const voices = [b > 0.08, a > 0.1 || move.open > 0.1, x.eye > 0.1, x.puck > 0.1, move.smile > 0.1, tl > 0.08, x.near > 0.08].filter(Boolean).length;
  set(master.gain, 0.7 / Math.sqrt(Math.max(1, voices)), 0.08);
  for (const k of CH) last[k] = x[k];
}

// ---------- 顔 ----------
let landmarker, lastVideoTime = -1, lastSeen = 0;
const pts = { eyeL: [0, 0], eyeR: [0, 0], fore: [0, 0], nose: [0, 0], mouth: [0, 0], chin: [0, 0], w: 0.3 };
const pctx = probe.getContext("2d", { willReadFrequently: true });
const pink = (d, i) => { const r = d[i], g = d[i + 1], b = d[i + 2], s = r + g + b + 1; return (r - g) / s + 0.6 * (b - g) / s; };
function sample(d, x, y) { // 映像の 0〜1 座標。3x3 の平均
  const W = probe.width, H = probe.height, cx = Math.round(x * W), cy = Math.round(y * H); let s = 0, n = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const px = cx + i, py = cy + j; if (px < 0 || py < 0 || px >= W || py >= H) continue; s += pink(d, (py * W + px) * 4); n++; }
  return n ? s / n : 0;
}
// 人によって、ふだんの顔でも値が高い。ふだんの値を覚えて、そこから増えた分だけを見る。
// 下がる方へはすぐ(0.3 秒)、上がる方へはゆっくり(15 秒)追う。効いている間は上げない(表情を保っても消えないように)
const bases = {}; let liveT = 0;
function over(name, raw, dead, range, dt) {
  let b = bases[name]; if (b === undefined) b = raw;
  // はじめの 1.5 秒は覚えるだけ(その間に出た一番高い値を「ふだん」にする)
  if (liveT < 1.5) { bases[name] = Math.max(b, raw); return 0; }
  const amt = clamp((raw - b - dead) / range);
  b += (raw - b) * (1 - Math.exp(-dt / (raw < b ? 0.3 : amt > 0 ? 45 : 15)));
  bases[name] = b; return amt;
}
// 舌: 下くちびるの下〜あごに、くちびると同じ色の面がどれだけあるか(簡易。アプリでは顔認識の値を使う)
function readTongue(lm, dt) {
  pctx.drawImage(video, 0, 0, probe.width, probe.height);
  const d = pctx.getImageData(0, 0, probe.width, probe.height).data;
  const L = lm[61], R = lm[291], chin = lm[152], up = lm[0], upIn = lm[13], low = lm[17];
  const skin = (sample(d, lm[50].x, lm[50].y) + sample(d, lm[280].x, lm[280].y) + sample(d, lm[151].x, lm[151].y)) / 3;
  const lowIn = lm[14], lip = Math.max(sample(d, (up.x + upIn.x) / 2, (up.y + upIn.y) / 2), sample(d, (low.x + lowIn.x) / 2, (low.y + lowIn.y) / 2));
  // くちびるが手などで隠れて肌と見分けられない時は、舌も判定しない
  if (lip - skin < 0.04) { over("tongue", 0, 0.14, 0.36, dt); return { amount: 0, x: 0 }; }
  const span = lip - skin;
  let hit = 0, n = 0, sx = 0;
  for (let r = 0; r < 5; r++) for (let c = -3; c <= 3; c++) {
    const k = 0.45 + 0.12 * r, x = low.x + (chin.x - low.x) * k + (R.x - L.x) * c * 0.11, y = low.y + (chin.y - low.y) * k + (R.y - L.y) * c * 0.11;
    const v = (sample(d, x, y) - skin) / span; n++;
    if (v > 0.75) { hit++; sx += c / 3; }
  }
  return { amount: over("tongue", hit / n, 0.14, 0.36, dt), x: hit ? sx / hit : 0 };
}
let winkT = [0, 0], tongueT = 0, wBase = 0, rollBase = null, trackT = 0;
function track(now) {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const dt = clamp((now - trackT) / 1000, 0.005, 0.2); trackT = now;
  const res = landmarker.detectForVideo(video, now);
  const lm = res.faceLandmarks && res.faceLandmarks[0];
  state.face = !!lm;
  if (!lm) return;
  lastSeen = now; liveT += dt;
  const asp = video.videoWidth / video.videoHeight, q = (a) => [a.x * asp, a.y], mid = (a, b) => [(a.x + b.x) / 2 * asp, (a.y + b.y) / 2];
  pts.eyeL = mid(lm[33], lm[133]); pts.eyeR = mid(lm[362], lm[263]);
  const brow = q(lm[9]), top = q(lm[10]);
  pts.fore = [(brow[0] + top[0]) / 2, (brow[1] + top[1]) / 2];
  pts.nose = q(lm[2]); pts.mouth = mid(lm[14], lm[17]); pts.chin = q(lm[152]);
  pts.w = Math.hypot((lm[454].x - lm[234].x) * asp, lm[454].y - lm[234].y);
  const B = {}; for (const c of (res.faceBlendshapes && res.faceBlendshapes[0] && res.faceBlendshapes[0].categories) || []) B[c.categoryName] = c.score;
  const g = (n) => B[n] || 0, T = state.t;
  state.raw = B;
  T.open = clamp((g("jawOpen") - 0.07) / 0.5);
  T.brow = Math.max(over("browIn", g("browInnerUp"), 0.10, 0.40, dt), (over("browL", g("browOuterUpLeft"), 0.10, 0.40, dt) + over("browR", g("browOuterUpRight"), 0.10, 0.40, dt)) / 2);
  const bl = g("eyeBlinkLeft"), br = g("eyeBlinkRight");
  T.eye = Math.max(bl, br) > 0.3 ? 0 : (over("wideL", g("eyeWideLeft"), 0.10, 0.30, dt) + over("wideR", g("eyeWideRight"), 0.10, 0.30, dt)) / 2;
  T.puck = over("puck", g("mouthPucker"), 0.15, 0.45, dt) * (1 - T.open);
  T.smile = (over("smileL", g("mouthSmileLeft"), 0.10, 0.50, dt) + over("smileR", g("mouthSmileRight"), 0.10, 0.50, dt)) / 2;
  // ウインク: 反対の目が開いたまま 0.12 秒続いたら。blendshape の Left は本人の左目 = 映像では右側
  const wk = [clamp((bl - br - 0.35) / 0.40) * (br < 0.25 ? 1 : 0), clamp((br - bl - 0.35) / 0.40) * (bl < 0.25 ? 1 : 0)];
  for (const k of [0, 1]) winkT[k] = wk[k] > 0 ? winkT[k] + dt : 0;
  T.winkR = winkT[0] > 0.12 ? wk[0] : 0; T.winkL = winkT[1] > 0.12 ? wk[1] : 0;
  const sd = g("mouthLeft") - g("mouthRight"); T.side = Math.sign(sd) * clamp((Math.abs(sd) - 0.08) / 0.25);
  // かしげる: 両目を結ぶ線の傾き。ふだんの角度からの差で見る
  const ex = pts.eyeR[0] - pts.eyeL[0], ey = pts.eyeR[1] - pts.eyeL[1], roll = Math.atan2(ey, ex), el = Math.hypot(ex, ey) || 1;
  if (rollBase === null) rollBase = roll;
  const dr = roll - rollBase; T.tilt = Math.sign(dr) * clamp((Math.abs(dr) - 0.12) / 0.35);
  if (T.tilt === 0) rollBase += (roll - rollBase) * (1 - Math.exp(-dt / 15));
  state.slide = [ex / el, ey / el];
  // 近づく: 顔の幅が、ふだん(8 秒でゆっくり追う)よりどれだけ大きいか
  if (!wBase) wBase = pts.w;
  T.near = clamp((pts.w / wBase - 1.12) / 0.35);
  if (T.near === 0) wBase += (pts.w - wBase) * (1 - Math.exp(-dt / 8));
  // 舌: 口が開いている時だけ。0.15 秒続いたら
  const tg = readTongue(lm, dt), tv = T.open > 0.16 ? tg.amount : 0;
  tongueT = tv > 0.2 ? tongueT + dt : 0;
  T.tongue += ((tongueT > 0.15 ? tv : 0) - T.tongue) * 0.5; state.tongueX = tg.x;
}

// ---------- まわす ----------
const vel = zero();
let prev = performance.now(), frames = 0, fpsT = prev, idleT = 0, tryI = 0, capText = "", hintText = "";
function setText(id, text, old) { if (text !== old) $(id).textContent = text; return text; }
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  if (state.phase !== "live") return;
  try { track(now); } catch (e) { state.err = String(e).slice(0, 160); }
  if (now - lastSeen > 500) state.face = false;   // 映像が止まった時に鳴りっぱなしにしない
  if (state.force) Object.assign(state.t, zero(), state.force);
  // ばね: 行きすぎて戻る(びよん)
  const on = state.face || state.force;
  for (const k of CH) {
    const target = on ? state.t[k] : 0, signed = k === "tilt" || k === "side";
    vel[k] += ((target - state.v[k]) * 260 - vel[k] * 17) * dt;
    state.v[k] = clamp(state.v[k] + vel[k] * dt, signed ? -1.15 : -0.1, 1.15);
  }
  updateSound(dt);
  resize();
  if (video.readyState >= 2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
  const va = video.videoWidth / Math.max(1, video.videoHeight), ca = canvas.width / canvas.height, v = state.v, pos = (x) => Math.max(0, x);
  gl.uniform2f(U.uCover, va > ca ? ca / va : 1, va > ca ? 1 : va / ca); gl.uniform1f(U.uAspect, va);
  for (const [n, k] of [["uOpen", "open"], ["uBrow", "brow"], ["uEye", "eye"], ["uPuck", "puck"], ["uSmile", "smile"], ["uWinkL", "winkL"], ["uWinkR", "winkR"], ["uNear", "near"], ["uTongue", "tongue"]]) gl.uniform1f(U[n], pos(v[k]));
  gl.uniform1f(U.uSide, v.side); gl.uniform2f(U.uSlide, state.slide[0] * v.tilt, state.slide[1] * v.tilt);
  for (const [n, k] of [["uEyeL", "eyeL"], ["uEyeR", "eyeR"], ["uFore", "fore"], ["uNose", "nose"], ["uMouth", "mouth"], ["uChin", "chin"]]) gl.uniform2f(U[n], pts[k][0], pts[k][1]);
  gl.uniform1f(U.uW, pts.w);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  frames++; if (now - fpsT > 1000) { state.fps = frames; frames = 0; fpsT = now; }
  // 下の字 = いま効いている型(強い順に 3 つまで)。上の字 = まだやっていない動きを 1 つずつ
  const act = CH.filter((k) => Math.abs(state.t[k]) > 0.3 && on).sort((a, b) => Math.abs(state.t[b]) - Math.abs(state.t[a]));
  for (const k of act) state.done[k] = true;
  capText = setText("cap", [...new Set(act.map((k) => NAMES[k]))].slice(0, 3).join("\n"), capText);
  idleT = act.length ? 0 : idleT + dt;
  if (idleT > 4) { idleT = 1.5; tryI++; }
  const left = TRY.filter(([k]) => !state.done[k]), tip = left.length ? left[tryI % left.length][1] : "";
  hintText = setText("hint", !on ? "顔を映してください" : act.length || idleT < 1.5 ? "" : tip, hintText);
  if (params.has("test")) { $("kdebug").style.display = "block";
    $("kdebug").textContent = `fps ${state.fps} face ${state.face}\n` + CH.map((k) => `${k} ${state.t[k].toFixed(2)}`).join("\n") + `\npings ${state.pings}\n${state.err}`; }
}
requestAnimationFrame(frame);
// 字は使う文字だけ先に読んでおく(途中で別の字に化けないように)
if (document.fonts) document.fonts.load('24px "Dela Gothic One"', Object.values(NAMES).join("") + TRY.map((t) => t[1]).join("") + "顔を映してください").catch(() => {});

async function makeLandmarker(delegate) {
  const files = await FilesetResolver.forVisionTasks(MP);
  return FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true });
}
$("go").addEventListener("click", async () => {
  const go = $("go"), msg = $("msg"); go.disabled = true;
  try {
    if (!ac) setupAudio();
    ac.resume();   // 音はタップの中で起こす(iOS)
    msg.textContent = "カメラを起こしています";
    if (!video.srcObject) video.srcObject = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } });
    await video.play();
    msg.textContent = "顔を見つける準備をしています";
    if (!landmarker) { try { landmarker = await makeLandmarker("GPU"); } catch (e) { landmarker = await makeLandmarker("CPU"); } }
    $("start").style.display = "none"; $("hud").style.display = "block"; state.phase = "live";
  } catch (e) {
    state.err = String(e).slice(0, 160); go.disabled = false;
    msg.textContent = e && e.name === "NotAllowedError" ? "カメラが許可されていません。ブラウザの設定で許可してから、もう一度押してください。" : "カメラを使えませんでした。もう一度押してください。";
  }
});
// 別のアプリから戻った時に音が止まったままになることがある(iOS)。画面を触れば戻る
document.addEventListener("visibilitychange", () => { if (ac) document.hidden ? ac.suspend() : ac.resume(); });
document.addEventListener("pointerdown", () => { if (ac && ac.state !== "running") ac.resume(); if (state.phase === "live" && video.paused) video.play().catch(() => {}); });
