// 顔芸(試作): 顔の動きで、顔が変形して音が鳴る。映像は端末の中だけで処理する。
// 顔の追跡 = MediaPipe Face Landmarker(ブラウザ内)。変形 = WebGL の逆写像。音 = WebAudio の合成。
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const HINTS = ["口を開ける", "口を開けたり閉じたりする", "舌を下に出して、動かす"];
const $ = (id) => document.getElementById(id);
const video = $("cam"), canvas = $("gl"), probe = $("probe");
const params = new URLSearchParams(location.search);
const state = { phase: "start", mode: 0, face: false, open: 0, tongue: 0, tongueX: 0, amt: 0, fps: 0, pings: 0, err: "" };
window.__kao = state;

// ---------- 見た目(WebGL) ----------
const gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: params.has("test") });
const VS = `attribute vec2 a; varying vec2 vS; void main(){ vS = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;
const FS = `precision highp float;
varying vec2 vS; uniform sampler2D uTex;
uniform vec2 uCover;      // 画面 → 映像の拡大(cover)
uniform float uAspect;    // 映像の 横/縦
uniform int uMode; uniform float uAmt;
uniform vec2 uEyeL, uEyeR, uFore, uNose, uMouth, uChin; uniform float uW;
vec2 bulge(vec2 p, vec2 c, float R, float k){
  vec2 d = p - c; float r = length(d) / R;
  if (r >= 1.0) return p;
  float f = 1.0 - r * r; return c + d * (1.0 - k * f * f);
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
  if (uAmt > 0.001) {
    vec2 up = normalize(uChin - uFore);
    if (uMode == 0) {
      p = bulge(p, uEyeL, uW * 0.34, 0.50 * uAmt);
      p = bulge(p, uEyeR, uW * 0.34, 0.50 * uAmt);
      p = bulge(p, uFore, uW * 0.86, 0.46 * uAmt);
    } else if (uMode == 1) {
      float L = max(dot(uChin - uNose, up), 0.01);
      p = stretch(p, uNose, up, L, L * 1.25 * uAmt, uW * 0.50, uW * 0.86, uW * 1.6);
    } else {
      float L = max(dot(uChin - uMouth, up), 0.01);
      p = stretch(p, uMouth, up, L, L * 2.2 * uAmt, uW * 0.26, uW * 0.52, uW * 1.4);
      p = bulge(p, uEyeL, uW * 0.30, 0.30 * uAmt);
      p = bulge(p, uEyeR, uW * 0.30, 0.30 * uAmt);
    }
  }
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
const U = {}; for (const n of ["uTex", "uCover", "uAspect", "uMode", "uAmt", "uEyeL", "uEyeR", "uFore", "uNose", "uMouth", "uChin", "uW"]) U[n] = gl.getUniformLocation(prog, n);
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
}

// ---------- 音(WebAudio の合成。素材ファイルは使わない) ----------
let ac, master, whistle, squeeze, shimmer;
function setupAudio() {
  ac = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
  master = ac.createGain(); master.gain.value = 0.7; master.connect(comp); comp.connect(ac.destination);
  if (params.has("test")) { const an = ac.createAnalyser(); an.fftSize = 2048; comp.connect(an); const buf = new Float32Array(2048);
    setInterval(() => { an.getFloatTimeDomainData(buf); let q = 0; for (const v of buf) q += v * v; state.rms = Math.sqrt(q / buf.length); }, 100); }

  // ゴム笛: 口の開きで音程が上がる
  { const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), g2 = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
    o.type = "triangle"; o2.type = "sine"; g.gain.value = 0; g2.gain.value = 0.35; lfo.frequency.value = 6.5; lg.gain.value = 0;
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(master); o.start(); o2.start(); lfo.start();
    whistle = { o, o2, g, lg }; }

  // 蛇腹: 開くときと閉じるときで和音が変わる。動かす速さで鳴る
  { const f = ac.createBiquadFilter(), g = ac.createGain(); f.type = "lowpass"; f.frequency.value = 700; f.Q.value = 1.2; g.gain.value = 0;
    const mk = (notes) => { const bus = ac.createGain(); bus.gain.value = 0; bus.connect(f);
      for (const n of notes) for (const det of [-7, 6]) { const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = n; o.detune.value = det; o.connect(bus); o.start(); }
      return bus; };
    const pull = mk([196.0, 246.9, 293.7, 392.0]), push = mk([220.0, 261.6, 349.2, 440.0]);
    f.connect(g); g.connect(master); squeeze = { f, g, pull, push }; }

  // キラキラ: 高い鈴の音。少し残響をつける
  { const bus = ac.createGain(), d = ac.createDelay(0.5), fb = ac.createGain(); bus.gain.value = 0.9; d.delayTime.value = 0.19; fb.gain.value = 0.32;
    bus.connect(master); bus.connect(d); d.connect(fb); fb.connect(d); d.connect(master); shimmer = bus; }
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
let lastOpen = 0, bellows = 0, lick = 0, lastTongue = 0, lastTX = 0, bell = 0;
function updateSound(dt) {
  if (!ac) return;
  const t = ac.currentTime, m = state.mode, a = state.face ? state.open : 0, tg = state.face ? state.tongue : 0;
  // 笛
  const wOn = m === 0 && a > 0.06;
  whistle.o.frequency.setTargetAtTime(330 * Math.pow(2, a * 1.7), t, 0.03);
  whistle.o2.frequency.setTargetAtTime(660 * Math.pow(2, a * 1.7), t, 0.03);
  whistle.lg.gain.setTargetAtTime(4 + a * 14, t, 0.1);
  whistle.g.gain.setTargetAtTime(wOn ? 0.10 + 0.20 * a : 0, t, wOn ? 0.03 : 0.06);
  // 蛇腹
  const vel = (a - lastOpen) / Math.max(dt, 0.001); lastOpen = a;
  bellows += (Math.min(Math.abs(vel) * 0.35, 1) - bellows) * Math.min(1, dt * 9);
  const on = m === 1 ? Math.min(1, bellows + 0.12 * (a > 0.1 ? a : 0)) : 0;
  if (Math.abs(vel) > 0.25) { squeeze.pull.gain.setTargetAtTime(vel > 0 ? 1 : 0, t, 0.03); squeeze.push.gain.setTargetAtTime(vel > 0 ? 0 : 1, t, 0.03); }
  squeeze.f.frequency.setTargetAtTime(600 + 2400 * a, t, 0.05);
  squeeze.g.gain.setTargetAtTime(on * 0.085, t, 0.04);
  // キラキラ: 舌が出た瞬間に 3 つ、動かすたびに 1 つ
  if (m === 2) {
    if (tg > 0.35 && lastTongue <= 0.35) { for (let i = 0; i < 3; i++) setTimeout(() => ping(bell++ + 2), i * 70); lick = 0; }
    if (tg > 0.35) { lick += Math.abs(state.tongueX - lastTX) * 3.2 + Math.abs(tg - lastTongue) * 0.8;
      if (lick > 0.16) { lick = 0; bell += Math.random() < 0.5 ? 1 : 2; ping(bell + (Math.random() < 0.3 ? 3 : 0)); } }
  }
  lastTongue = tg; lastTX = state.tongueX;
}

// ---------- 顔 ----------
let landmarker, lastVideoTime = -1;
const pts = { eyeL: [0, 0], eyeR: [0, 0], fore: [0, 0], nose: [0, 0], mouth: [0, 0], chin: [0, 0], w: 0.3 };
const pctx = probe.getContext("2d", { willReadFrequently: true });
const pink = (d, i) => { const r = d[i], g = d[i + 1], b = d[i + 2], s = r + g + b + 1; return (r - g) / s + 0.6 * (b - g) / s; };
function sample(d, x, y) { // 映像の 0〜1 座標。3x3 の平均
  const W = probe.width, H = probe.height, cx = Math.round(x * W), cy = Math.round(y * H); let s = 0, n = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const px = cx + i, py = cy + j; if (px < 0 || py < 0 || px >= W || py >= H) continue; s += pink(d, (py * W + px) * 4); n++; }
  return n ? s / n : 0;
}
// 舌: 下くちびるの下〜あごに、くちびると同じ色の面がどれだけあるか(簡易。アプリでは顔認識の値を使う)
let tongueBase = 1;
function readTongue(lm) {
  pctx.drawImage(video, 0, 0, probe.width, probe.height);
  const d = pctx.getImageData(0, 0, probe.width, probe.height).data;
  const L = lm[61], R = lm[291], chin = lm[152], up = lm[0], upIn = lm[13];
  const mx = (L.x + R.x) / 2, my = (L.y + R.y) / 2, mw = Math.hypot(R.x - L.x, R.y - L.y);
  const skin = (sample(d, lm[50].x, lm[50].y) + sample(d, lm[280].x, lm[280].y) + sample(d, lm[151].x, lm[151].y)) / 3;
  const lip = sample(d, (up.x + upIn.x) / 2, (up.y + upIn.y) / 2);
  const span = Math.max(lip - skin, 0.035);
  let hit = 0, n = 0, sx = 0;
  for (let r = 0; r < 5; r++) for (let c = -3; c <= 3; c++) {
    const k = 0.55 + 0.1 * r, x = mx + (chin.x - mx) * k + (R.x - L.x) * c * 0.11, y = my + (chin.y - my) * k + (R.y - L.y) * c * 0.11;
    const v = (sample(d, x, y) - skin) / span; n++;
    if (v > 0.6) { hit++; sx += c / 3; }
  }
  const frac = hit / n;
  // ひげ・手・照明で元から色が近い人がいるので、ふだんの値を覚えて、そこからの増えた分だけを見る(下がる方へはすぐ、上がる方へはゆっくり追う)
  tongueBase += (frac - tongueBase) * (frac < tongueBase ? 0.25 : 0.004);
  return { amount: Math.min(1, Math.max(0, (frac - tongueBase - 0.14) / 0.36)), x: hit ? sx / hit : 0, mw };
}
function track() {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const res = landmarker.detectForVideo(video, performance.now());
  const lm = res.faceLandmarks && res.faceLandmarks[0];
  state.face = !!lm;
  if (!lm) return;
  const asp = video.videoWidth / video.videoHeight, q = (a) => [a.x * asp, a.y], mid = (a, b) => [(a.x + b.x) / 2 * asp, (a.y + b.y) / 2];
  pts.eyeL = mid(lm[33], lm[133]); pts.eyeR = mid(lm[362], lm[263]);
  const brow = q(lm[9]), top = q(lm[10]);
  pts.fore = [(brow[0] + top[0]) / 2, (brow[1] + top[1]) / 2];
  pts.nose = q(lm[2]); pts.mouth = mid(lm[14], lm[17]); pts.chin = q(lm[152]);
  pts.w = Math.hypot((lm[454].x - lm[234].x) * asp, lm[454].y - lm[234].y);
  const shapes = res.faceBlendshapes && res.faceBlendshapes[0] && res.faceBlendshapes[0].categories;
  const jaw = shapes ? (shapes.find((c) => c.categoryName === "jawOpen") || { score: 0 }).score : 0;
  state.open = Math.min(1, Math.max(0, (jaw - 0.07) / 0.5));
  if (state.mode === 2) { const tg = readTongue(lm); state.tongue += (tg.amount - state.tongue) * 0.5; state.tongueX = tg.x; }
  else state.tongue = 0;
}

// ---------- まわす ----------
let amtV = 0, prev = performance.now(), frames = 0, fpsT = prev;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  if (state.phase !== "live") return;
  try { track(); } catch (e) { state.err = String(e).slice(0, 160); }
  // ばね: 行きすぎて戻る(びよん)
  const target = state.face ? (state.mode === 2 ? state.tongue : state.open) : 0;
  amtV += ((target - state.amt) * 260 - amtV * 17) * dt; state.amt = Math.max(-0.1, state.amt + amtV * dt);
  updateSound(dt);
  resize();
  if (video.readyState >= 2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
  const va = video.videoWidth / Math.max(1, video.videoHeight), ca = canvas.width / canvas.height;
  gl.uniform2f(U.uCover, va > ca ? ca / va : 1, va > ca ? 1 : va / ca);
  gl.uniform1f(U.uAspect, va); gl.uniform1i(U.uMode, state.mode); gl.uniform1f(U.uAmt, Math.max(0, state.amt));
  for (const [n, k] of [["uEyeL", "eyeL"], ["uEyeR", "eyeR"], ["uFore", "fore"], ["uNose", "nose"], ["uMouth", "mouth"], ["uChin", "chin"]]) gl.uniform2f(U[n], pts[k][0], pts[k][1]);
  gl.uniform1f(U.uW, pts.w);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  frames++; if (now - fpsT > 1000) { state.fps = frames; frames = 0; fpsT = now; }
  $("hint").textContent = state.face ? HINTS[state.mode] : "顔を映してください";
  if (params.has("test")) { $("kdebug").style.display = "block"; $("kdebug").textContent = `fps ${state.fps} face ${state.face}\nopen ${state.open.toFixed(2)} tongue ${state.tongue.toFixed(2)} x ${state.tongueX.toFixed(2)}\namt ${state.amt.toFixed(2)} pings ${state.pings}\n${state.err}`; }
}
requestAnimationFrame(frame);

async function makeLandmarker(delegate) {
  const files = await FilesetResolver.forVisionTasks(MP);
  return FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true });
}
$("go").addEventListener("click", async () => {
  const go = $("go"), msg = $("msg"); go.disabled = true;
  try {
    setupAudio(); ac.resume();   // 音はタップの中で起こす(iOS)
    msg.textContent = "カメラを起こしています";
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } });
    video.srcObject = stream; await video.play();
    msg.textContent = "顔を見つける準備をしています";
    try { landmarker = await makeLandmarker("GPU"); } catch (e) { landmarker = await makeLandmarker("CPU"); }
    $("start").style.display = "none"; $("hud").style.display = "block"; state.phase = "live";
  } catch (e) {
    state.err = String(e).slice(0, 160); go.disabled = false;
    msg.textContent = e && e.name === "NotAllowedError" ? "カメラが許可されていません。ブラウザの設定で許可してから、もう一度押してください。" : "カメラを使えませんでした。もう一度押してください。";
  }
});
for (const b of document.querySelectorAll("#modes button")) b.addEventListener("click", () => {
  state.mode = +b.dataset.mode;
  for (const o of document.querySelectorAll("#modes button")) o.setAttribute("aria-pressed", String(o === b));
});
document.addEventListener("visibilitychange", () => { if (ac) document.hidden ? ac.suspend() : ac.resume(); });
