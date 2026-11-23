// 顔芸(試作): 顔の動きで、顔が変形して音が鳴る。映像は端末の中だけで処理する。
// 顔の追跡 = MediaPipe Face Landmarker(ブラウザ内)。変形 = WebGL の逆写像。音 = WebAudio の合成。
import { FaceLandmarker, FilesetResolver, ImageSegmenter } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const $ = (id) => document.getElementById(id);
const video = $("cam"), canvas = $("gl"), probe = $("probe");
const params = new URLSearchParams(location.search);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
// きっかけ(顔の動き)ごとに 1 つの型。ぜんぶ同時に効く。tilt と side は左右があるので -1〜1
const CH = ["open", "brow", "eye", "puck", "smile", "winkL", "winkR", "tilt", "side", "near", "tongue"];
// ことば: 日本語(ひらがな)と英語。?lang=en / ?lang=ja で切り替え、なければ端末の言語
const EN = (params.get("lang") || navigator.language || "ja").toLowerCase().startsWith("en");
document.documentElement.lang = EN ? "en" : "ja";
const NAMES = EN
  ? { open: "accordion", brow: "forehead pump", eye: "big eyes", puck: "slurp", smile: "cheeks", winkL: "twist", winkR: "twist", tilt: "slide", side: "nose twist", near: "squish", tongue: "sparkle tongue" }
  : { open: "アコーディオン", brow: "デコポンプ", eye: "めだま", puck: "すいこみ", smile: "ほっぺ", winkL: "ねじれ", winkR: "ねじれ", tilt: "ずりおち", side: "はなねじ", near: "むぎゅ", tongue: "ベロキラキラ" };
// れんしゅうの順番: [見るきっかけ, やること, 起きること]
const TODO = EN ? ["raise your eyebrows", "open wide", "pucker up", "big smile", "open your eyes wide", "wink", "tilt your head", "move your mouth sideways", "come closer", "stick out your tongue"]
  : ["まゆを あげる", "くちを あける", "くちを すぼめる", "にっこり わらう", "めを みひらく", "かためを つぶる", "くびを かしげる", "くちを よこに ずらす", "かおを ちかづける", "ベロを だす"];
const STEPS = [["brow"], ["open"], ["puck"], ["smile"], ["eye"], ["winkL", "winkR"], ["tilt"], ["side"], ["near"], ["open", "tongue"]].map((keys, i) => [keys, TODO[i], NAMES[keys[keys.length - 1]]]);
const W = EN ? { and: " + ", show: "show your face", move: "move your face", becomes: (n) => "→ " + n, stuck: (n) => `→ ${n}. not working? skip it`, nice: "nice", panels: "3 panels", first: "first: ", panel: (k) => `${k}/3 `, ofPanels: (n) => `${n} of 3 panels`, done: (n, m) => `${n} of ${m}`, skipped: "skipped", hit: "ok", miss: "x",
    play: "play", practice: "practice", game: "3 panels", skip: "skip", start: "go", shuffle: "shuffle", again: "again",
    tryStill: "try holding still", other: "make a different face", still: "hold still", strain: "move to crack", mirror: "broken mirror", kinds: ["bumpy", "road mirror", "potato chip"], back: "back", settings: "settings", soundOn: "sound: on", soundOff: "sound: off", cam: "starting the camera", prep: "getting ready to find your face", denied: "Camera access is off. Allow it in your browser settings, then tap again.", fail: "Couldn't use the camera. Tap again." }
  : { and: " と ", show: "かおを うつして", move: "かおを うごかす", becomes: (n) => n + "に なる", stuck: (n) => `${n}に なる。だめなら とばす`, nice: "できた", panels: "3コマ", first: "まずは ", panel: (k) => `${k}コマめ `, ofPanels: (n) => `3コマちゅう ${n}コマ`, done: (n, m) => `${n} / ${m} できた`, skipped: "とばした", hit: "○", miss: "×",
    play: "あそぶ", practice: "れんしゅう", game: "3コマ", skip: "とばす", start: "はじめる", shuffle: "かえる", again: "もういっかい",
    tryStill: "じっと してみる", other: "ちがう かおを する", still: "じっと して", strain: "うごいて わる", mirror: "こわれた かがみ", kinds: ["ボコボコ", "カーブミラー", "ポテチ"], back: "もどる", settings: "せってい", soundOn: "おと: あり", soundOff: "おと: なし", cam: "カメラを起こしています", prep: "顔を見つける準備をしています", denied: "カメラが許可されていません。ブラウザの設定で許可してから、もう一度押してください。", fail: "カメラを使えませんでした。もう一度押してください。" };
for (const [id, k] of [["go", "play"], ["goGame", "game"], ["goMirror", "mirror"], ["goSet", "settings"], ["setBack", "back"], ["setHead", "settings"], ["back", "back"], ["sumFree", "play"], ["sumAgain", "again"]]) $(id).textContent = W[k];
// せってい: 音を出さない(顔の変形だけ)。端末に覚えておく。保存できない環境(プライベート表示など)でも動くように
let soundOff = false; try { soundOff = localStorage.getItem("soundOff") === "1"; } catch (e) {}
const zero = () => Object.fromEntries(CH.map((k) => [k, 0]));
const state = { phase: "start", face: false, t: zero(), v: zero(), slide: [0, 0], fps: 0, pings: 0, err: "", force: null, done: {}, mode: "free", only: null, step: 0, results: [], soundOff };
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
// こわれた かがみ(iOS の WarpShader.swift と同じ式)。uKind: -1 = かがみでない / 0 = ボコボコ / 1 = カーブミラー / 2 = ポテチ
uniform float uKind, uVA;   // uVA = 画面の 横/縦
uniform vec4 uDents[12];    // (x, y, 半径, 強さ)。意味は種類ごとに違う(main.js の shuffleDents)
uniform sampler2D uMirror;  // カーブミラーの写真(まわりとガラスは透明。色は濃さを掛けた後のもの)
uniform vec4 uPhoto;        // 画面の 0〜1 → 写真の 0〜1: (画面 - xy) / zw
// 土の顔: 顔を灰色の土のかたまりに塗りかえる(目と口の中だけ生きたまま)。uSkin = 映像と同じ座標の塗り分け(R 顔 / G 目 / B 髪のあたり / A くちびる 0.6 〜 口の中 1)
uniform float uStone, uHairOn, uPxW; uniform sampler2D uSkin, uNorm, uHair; uniform vec3 uSkinC;   // uHair = 髪の切り抜き(6 番)/ uPxW = 顔の幅が画面で何画素か   // uNorm = 顔の網の面の向き(映像と同じ座標)
uniform float uTurn, uCrack, uBreak;   // uTurn = 首から上へ石が上がってくる量(0〜1)/ uCrack = ひびの本数(0〜4。途中の値は伸びている途中)/ uBreak = 割れ落ちる(0〜1)
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float h2(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
float pit2(vec2 p){ vec2 i = floor(p), f = fract(p) - 0.5; float k = h2(i + 3.0);
  return step(0.70, k) * (1.0 - smoothstep(0.08, 0.10 + 0.20 * k, length(f - (vec2(h2(i + 11.0), h2(i + 23.0)) - 0.5) * 0.5))); }
// ひび 1 本: A から B へ、ゆらぎながら伸びる。返り値 = (線からの距離(符号つき), その場所の線の太さ。0 なら無い)
vec2 crackLine(vec2 f, vec2 A, vec2 B, float grow, float seed){
  vec2 ab = B - A; float len = length(ab); vec2 d = ab / len;
  float t = dot(f - A, d) / len;
  float dist = dot(f - A, vec2(-d.y, d.x)) + (n2(vec2(t * 6.0, seed)) - 0.5) * 0.11 + (n2(vec2(t * 21.0, seed + 3.0)) - 0.5) * 0.035 + (n2(f * 55.0) - 0.5) * 0.010;   // 乾いた土の ひび: ふちが ぼろぼろ
  return vec2(dist, (0.0065 + 0.0012 * uCrack) * smoothstep(-0.02, 0.10, t) * smoothstep(grow, grow - 0.30, t) * step(0.001, grow));
}
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
  if (uKind > -0.5) {
    // 画面の座標(左上が 0,0・y は下向き)に 横/縦 を掛けたもので考える。顔の位置は使わない
    vec2 s = vec2(vS.x, 1.0 - vS.y), p = vec2(s.x * uVA, s.y);
    float shade = 1.0, sheen = 0.0; vec4 over = vec4(0.0);
    if (uKind > 0.5 && uKind < 1.5) {
      // カーブミラー: 顔は鏡のガラスの中にだけ映る。uDents[0] = (ガラスの中心 x, y, 半径)、[1..7] = ガラスの面のへこみ(半径を 1 とした位置)
      float R = uDents[0].z; vec2 d = p - uDents[0].xy; float r = length(d) / R;
      vec4 photo = texture2D(uMirror, (s - uPhoto.xy) / uPhoto.zw);
      if (r >= 1.0) { gl_FragColor = vec4(vec3(0.62, 0.69, 0.72) * (1.0 - photo.a) + photo.rgb, 1.0); return; }   // 鏡の外: くもり空(平らな 1 色)
      vec2 m = d / R;
      for (int i = 1; i < 8; i++) m = bulge(m, uDents[i].xy, uDents[i].z, uDents[i].w);
      float f = 0.80 + 0.55 * min(dot(m, m), 1.0);               // 広角(ふちほど広く詰めこむ。はみ出た分は折り返して映す)
      p = vec2(uVA * 0.5, 0.5) + m * f * uVA * 0.5;
      p.x = uVA - abs(uVA - abs(p.x));
      shade = 1.0 - 0.50 * smoothstep(0.78, 1.0, r);             // 枠の内側の影
      sheen = 0.06 + 0.12 * (1.0 - smoothstep(-0.9, 0.3, d.y / R));   // ガラスに空の明るさが薄く乗る(上ほど)
      over = photo;
    } else if (uKind > 1.5) {
      // ポテチ: 画面全体が反ったチップスみたいにたわむ(鞍の形)。uDents[0] = (向きの角度, 強さ, 波の細かさ, 波の深さ)
      float cs = cos(uDents[0].x), sn = sin(uDents[0].x);
      vec2 d = p - vec2(uVA * 0.5, 0.5);
      vec2 q = vec2(d.x * cs + d.y * sn, -d.x * sn + d.y * cs) / vec2(uVA, 1.0);
      float k = uDents[0].y;
      vec2 w = vec2(q.x * (1.0 + k * 2.6 * (q.y * q.y - 0.07)), q.y + k * 1.5 * (q.x * q.x - 0.07));
      w.y += uDents[0].w * sin(q.x * uDents[0].z);               // ギザギザのひだ
      w *= vec2(uVA, 1.0);
      p = vec2(uVA * 0.5, 0.5) + vec2(w.x * cs - w.y * sn, w.x * sn + w.y * cs);
    } else {
      // ボコボコ: 画面に固定したへこみ(強さが負)・でっぱり(正)
      for (int i = 0; i < 12; i++) p = bulge(p, uDents[i].xy, uDents[i].z, uDents[i].w);
    }
    vec2 t = (vec2(p.x / uVA, p.y) - 0.5) * uCover + 0.5; t.x = 1.0 - t.x;   // 画面 → 映像(鏡うつし)
    vec3 rgb = texture2D(uTex, clamp(t, 0.0, 1.0)).rgb;
    gl_FragColor = vec4(mix(rgb * shade, vec3(0.82, 0.86, 0.90), sheen) * (1.0 - over.a) + over.rgb, 1.0);
    return;
  }
  vec2 uv = (vS - 0.5) * uCover + 0.5; uv.x = 1.0 - uv.x; uv.y = 1.0 - uv.y;
  vec2 p = vec2(uv.x * uAspect, uv.y);
  vec2 up = normalize(uChin - uFore), rt = vec2(-up.y, up.x);
  // 大きい変形から順に。どれも元の顔の位置を基準にしているので、同時に効かせても破綻しにくい
  p = bulge(p, mix(uNose, uFore, 0.35), uW * 1.45, 0.17 * uStone);    // 土の顔: 頭を少し大きく。鼻は大きく、ほお と あご は厚く、口は横に広く(人形の つくり)
  p = bulge(p, uNose - up * 0.10 * uW, uW * 0.40, 0.18 * uStone);
  p = bulge(p, uMouth, uW * 1.00, 0.05 * uStone);
  p = bulge(p, uNose, uW * 1.15, 0.5 * uNear);                       // むぎゅ(魚眼)
  { vec2 d = p - uNose; float r = length(d) / (uW * 0.62);           // ずり落ち
    if (r < 1.0) p -= uSlide * uW * 0.34 * fall(r); }
  { float L = max(dot(uChin - uNose, up), 0.01);                      // アコーディオン
    p = stretch(p, uNose, up, L, L * 1.25 * uOpen, uW * 0.50, uW * 0.86, uW * 1.6); }
  { float L = max(dot(uChin - uMouth, up), 0.01);                     // 舌
    p = stretch(p, uMouth, up, L, L * 2.0 * uTongue, uW * 0.26, uW * 0.52, uW * 1.4); }
  { vec2 d = p - uMouth; float r = length(d) / (uW * 0.75);          // ほっぺ(横に伸びる)
    if (r < 1.0) { float s = dot(d, rt); p -= rt * s * (1.0 - 1.0 / (1.0 + 1.1 * (uSmile + 0.16 * uStone) * fall(r))); } }
  p = bulge(p, uMouth, uW * 0.95, -0.95 * uPuck);                    // 吸いこみ
  p = swirl(p, mix(uNose, uMouth, 0.6), uW * 0.5, 1.6 * uSide);      // 鼻ねじ
  float ek = min(0.30 * uBrow + 0.62 * uEye, 0.8);                    // 額ポンプ+目玉
  p = bulge(p, uEyeL, uW * 0.34, ek); p = bulge(p, uEyeR, uW * 0.34, ek);
  p = bulge(p, uFore, uW * 0.86, 0.46 * uBrow);
  p = swirl(p, uEyeL, uW * 0.36, 2.6 * uWinkL);                      // ねじれ
  p = swirl(p, uEyeR, uW * 0.36, -2.6 * uWinkR);
  uv = clamp(vec2(p.x / uAspect, p.y), 0.0, 1.0);
  vec3 rgb = texture2D(uTex, uv).rgb;
  if (uStone > 0.001) {
    // 変形した後の「元の映像の位置」で塗るので、石の肌も顔と一緒に伸びる
    vec4 m = texture2D(uSkin, uv);
    vec2 q = p - uNose, fl = vec2(dot(q, rt), dot(q, up)) / uW;       // 顔に固定した座標(鼻が原点・顔の幅が 1)
    vec2 e = vec2(uW / uAspect, uW);
    float L = lum(rgb), skinL = max(lum(uSkinC), 0.10), Ls = 0.0, Lw = 0.0, Lx = 0.0;
    // 3 つの ぼかし: 細かい所を消した明るさ(Ls)/ まわりの明るさ(Lw)/ 大きな形だけの明るさ(Lx)
    for (int i = 0; i < 8; i++) { float an = 0.7854 * float(i); vec2 d = vec2(cos(an), sin(an)) * e;
      Ls += lum(texture2D(uTex, uv + d * 0.011).rgb); if (i < 4) { Lw += lum(texture2D(uTex, uv + d.yx * 0.045).rgb); Lx += lum(texture2D(uTex, uv + d * 0.10).rgb); } }
    Ls = (Ls + L) / 9.0; Lw *= 0.25; Lx *= 0.25;
    float eyeIn = smoothstep(0.93, 1.0, m.g), mouthIn = smoothstep(0.96, 1.0, m.a), lipS = smoothstep(0.42, 0.60, m.a) * (1.0 - mouthIn);
    // 土の人: 写真の肌(色むら・ひげ・しわ・くちびるの色)は土の中に消す。残すのは、生きた目と、その人の形だけ。
    // 形は写真の陰ではなく、顔の網の面の向きに左上から光を当てて出す(土で作った胸像のように。面の向きは 256x256 の絵なので、角のない鈍い形になる)
    // 荒く: 面の向きの絵を引く位置そのものを ゆらす(鼻すじ・ほお・あご の形が いびつ になる)。目のまわりは荒らさない
    float calm = smoothstep(0.2, 0.7, m.g);
    vec2 jit = (vec2(n2(fl * 4.0 + 11.0), n2(fl * 4.0 + 41.0)) - 0.5) * 0.055 + (vec2(n2(fl * 11.0 + 5.0), n2(fl * 11.0 + 23.0)) - 0.5) * 0.020;
    vec3 nn = texture2D(uNorm, uv + jit * (1.0 - calm) * e).rgb * 2.0 - 1.0; nn.xy *= 1.6;
    // 親指で押した面: 所どころ決まった向きへ傾いた平らな面(境目は やわらかく。くっきり切ると、重ねた紙のような線が出た)。そこへ大きな こぶ・へこみ と、わずかな左右の ゆがみ
    // (でこぼこ は面の向きそのものを変えるので、光の当たり方が変わる = 粒を散らした写真ではなく、土のかたまりに見える)
    vec2 thumb = smoothstep(0.34, 0.66, vec2(n2(fl * 3.6 + 2.0), n2(fl * 3.6 + 19.0))) - 0.5;
    nn.xy += (1.0 - calm) * (0.60 * thumb + 0.55 * (vec2(n2(fl * 5.0 + 3.0), n2(fl * 5.0 + 31.0)) - 0.5) + 0.34 * (vec2(n2(fl * 12.0 + 7.0), n2(fl * 12.0 + 47.0)) - 0.5)) + vec2(0.06, 0.0);
    nn = normalize(nn - vec3(0.0, 0.0, 0.0001));
    float ndl = max(dot(nn, normalize(vec3(-0.50, -0.58, -0.64))), 0.0), rimL = pow(1.0 - clamp(-nn.z, 0.0, 1.0), 2.0);
    float g = 0.63 * (0.54 + 0.62 * ndl) * (1.0 - 0.24 * rimL);   // 灰色の土(肌の色を暗く塗ったようには見せない)
    // 写真から借りるもの: その人の顔の大きな陰と中くらいの陰(ほおの折れ・目の下 = その人らしさ)、本当に暗い穴(鼻の穴・口の線)。眉・ひげは うっすら
    float line = smoothstep(0.08, 0.26, (Lw - Ls) / skinL), dark = 1.0 - smoothstep(0.16, 0.50, Ls / skinL);
    g *= 1.0 + 0.36 * clamp((0.5 * Lw + 0.5 * Lx) / skinL - 1.0, -0.45, 0.22) + 0.30 * clamp((Lw - Lx) / skinL, -0.30, 0.15);
    g *= 1.0 - max(0.16 * line, 0.30 * dark);
    // まぶた と くちびる は、丸めた土を貼りつけたように: 盛り上がった帯+まわりの溝。目のまわりは影を浅く(目が くぼみに沈まないように)
    g *= 1.0 + 0.20 * smoothstep(0.15, 0.75, m.g) + 0.10 * smoothstep(0.25, 0.55, m.g) * (1.0 - smoothstep(0.58, 0.80, m.g));
    g *= 1.0 - 0.18 * smoothstep(0.62, 0.86, m.g) * (1.0 - smoothstep(0.88, 0.98, m.g));
    g *= 1.0 + 0.08 * smoothstep(0.50, 0.90, m.a) * (1.0 - mouthIn) - 0.11 * smoothstep(0.22, 0.42, m.a) * (1.0 - smoothstep(0.52, 0.72, m.a));
    // 土の肌: 荒い粒。大きさは顔の幅で決めるが、画面の上で 3.4 / 8 / 20 画素より細かくはしない(引いて撮っても粒が消えて「灰色に塗った肌」にならないように)
    // (粒は向きを変えた 3 枚の雑音を重ねる。1 枚だと ます目が見えて、モザイクのようになった)
    vec2 f1 = vec2(0.80 * fl.x - 0.60 * fl.y, 0.60 * fl.x + 0.80 * fl.y), f2 = vec2(0.36 * fl.x + 0.93 * fl.y, -0.93 * fl.x + 0.36 * fl.y);
    float F1 = min(64.0, uPxW / 3.4), F2 = min(27.0, uPxW / 8.0), F3 = min(11.0, uPxW / 20.0);
    float c1 = (n2(fl * F1) + n2(f1 * F1 * 0.71 + 9.0) + n2(f2 * F1 * 1.30 + 4.0)) / 3.0, c2 = 0.5 * (n2(f1 * F2 * 1.35 + 7.0) + n2(f2 * F2 + 2.0)), c3 = n2(f1 * F3 + 5.0);
    float sp = clamp((c1 - 0.5) * 2.8, -0.5, 0.5), surf = 1.0 - max(eyeIn, mouthIn);
    float fine = surf * (1.0 - 0.5 * calm);                                                         // まぶたの上は弱く(目つきが消えないように)
    // 所どころ: 穴だらけの所(patchP)と、乾いて細かく ひび割れた所(patchC)
    float patchP = smoothstep(0.50, 0.68, n2(fl * 2.6 + 8.0)), patchC = smoothstep(0.52, 0.70, n2(fl * 2.1 + 27.0));
    float pores = pit2(f1 * F2 * 1.25 + 9.0 * vec2(n2(fl * 6.0), n2(fl * 6.0 + 14.0))), crust = 1.0 - smoothstep(0.0, 0.035, abs(n2(fl * 13.0 + 3.0) - 0.5));
    g *= 1.0 + fine * (0.13 * sp + 0.17 * (c2 - 0.5) + 0.12 * (c3 - 0.5)) + surf * 0.10 * (n2(f2 * 7.0 + 2.0) - 0.5) - fine * (0.16 * pores * patchP + 0.18 * crust * patchC);
    g += fine * 0.07 * smoothstep(0.15, 0.40, sp) * ndl;                                            // 出っぱりに乗った白っぽい土ぼこり
    vec3 sum3 = vec3(rgb.r + rgb.g + rgb.b + 0.03, uSkinC.r + uSkinC.g + uSkinC.b + 0.03, 0.0);
    vec3 stone = vec3(g) * mix(vec3(1.0, 1.0, 0.99), vec3(1.07, 0.99, 0.90), 0.5 * n2(fl * 3.1 + 6.0));   // 灰色の土。所どころ黄土がかる
    // 目玉・歯・口の中は生きたまま(色を半分ぬく)
    stone = mix(stone, mix(rgb, vec3(L), 0.5) * mix(1.0, 1.12, eyeIn), 0.92 * max(eyeIn, mouthIn));
    // 顔の外(耳・首)は、肌に近い色の所だけ土にする。境目は欠けた形に
    float sim = (1.0 - smoothstep(0.05, 0.12, length(rgb.rg / sum3.x - uSkinC.rg / sum3.y))) * smoothstep(0.30, 0.50, L / skinL);
    float a = max(smoothstep(0.12, 0.42, m.r + 0.30 * (n2(fl * 9.0 + 1.0) - 0.5) * (1.0 - smoothstep(0.90, 0.99, m.r))) * mix(sim, 1.0, smoothstep(0.90, 0.99, m.r)), smoothstep(0.55, 0.9, m.b) * sim);
    // 髪: 髪の切り抜き(uHair)が使える時は、髪ぜんぶを けばだった黒い土のかたまりに(明るい髪でも)。使えない間は前のやり方 = 生えぎわから上の暗い所だけを つぶす
    float hmass = smoothstep(0.48, 0.62, texture2D(uHair, uv).r + 0.10 * (c2 - 0.5)) * uHairOn * surf;
    // 髪の切り抜きがある時は、顔と髪のあいだに残る おでこ(生えぎわの上)も土にする(髪でなく、肌にやや近い色の所)
    a = max(a, uHairOn * smoothstep(0.35, 0.70, m.b) * (1.0 - smoothstep(0.10, 0.24, length(rgb.rg / sum3.x - uSkinC.rg / sum3.y))));
    float hairy = m.b * (1.0 - smoothstep(0.34, 0.60, L / skinL)) * (1.0 - a) * (1.0 - uHairOn);
    vec3 lumpc = vec3(0.06 + 0.22 * Lw) * (1.0 + 0.7 * sp + 0.5 * (c2 - 0.5));
    vec3 hairC = vec3(0.155, 0.150, 0.143) * (1.0 + 0.45 * sp + 0.5 * (c2 - 0.5) + 0.6 * (c3 - 0.5)) * (1.0 + 0.5 * clamp(-fl.y - 0.55, 0.0, 0.6));
    // ひび: 表情の種類が 1 つ増えるたびに 1 本。目と口にはかからない。顔と一緒に伸びる
    if (uCrack > 0.001) {
      float gr = 0.0, bv = 0.0; vec2 c;
      c = crackLine(fl, vec2(-0.36, -0.84), vec2(0.03, -0.54), clamp(uCrack, 0.0, 1.0) * 1.3, 1.0); gr = max(gr, 1.0 - smoothstep(c.y * 0.45, c.y, abs(c.x))); bv = max(bv, smoothstep(c.y, c.y * 1.3, c.x) * (1.0 - smoothstep(c.y * 1.5, c.y * 2.8, c.x)) * step(0.0005, c.y));
      c = crackLine(fl, vec2(-0.12, -0.66), vec2(-0.30, -0.58), clamp(uCrack - 0.5, 0.0, 1.0) * 1.3, 2.0); gr = max(gr, 1.0 - smoothstep(c.y * 0.3, c.y * 0.7, abs(c.x)));
      c = crackLine(fl, vec2(0.54, -0.08), vec2(0.22, 0.36), clamp(uCrack - 1.0, 0.0, 1.0) * 1.3, 3.0); gr = max(gr, 1.0 - smoothstep(c.y * 0.45, c.y, abs(c.x))); bv = max(bv, smoothstep(c.y, c.y * 1.3, c.x) * (1.0 - smoothstep(c.y * 1.5, c.y * 2.8, c.x)) * step(0.0005, c.y));
      c = crackLine(fl, vec2(-0.56, 0.02), vec2(-0.16, 0.56), clamp(uCrack - 2.0, 0.0, 1.0) * 1.3, 4.0); gr = max(gr, 1.0 - smoothstep(c.y * 0.45, c.y, abs(c.x))); bv = max(bv, smoothstep(c.y, c.y * 1.3, c.x) * (1.0 - smoothstep(c.y * 1.5, c.y * 2.8, c.x)) * step(0.0005, c.y));
      c = crackLine(fl, vec2(-0.36, 0.30), vec2(-0.52, 0.48), clamp(uCrack - 2.5, 0.0, 1.0) * 1.3, 5.0); gr = max(gr, 1.0 - smoothstep(c.y * 0.3, c.y * 0.7, abs(c.x)));
      c = crackLine(fl, vec2(0.50, -0.80), vec2(0.47, -0.32), clamp(uCrack - 3.0, 0.0, 1.0) * 1.3, 6.0); gr = max(gr, 1.0 - smoothstep(c.y * 0.45, c.y, abs(c.x))); bv = max(bv, smoothstep(c.y, c.y * 1.3, c.x) * (1.0 - smoothstep(c.y * 1.5, c.y * 2.8, c.x)) * step(0.0005, c.y));
      c = crackLine(fl, vec2(0.10, 0.62), vec2(0.34, 0.28), clamp(uCrack - 3.4, 0.0, 1.0) * 1.3, 7.0); gr = max(gr, 1.0 - smoothstep(c.y * 0.3, c.y * 0.7, abs(c.x)));
      float keep = 1.0 - smoothstep(0.15, 0.6, max(m.g, m.a));
      stone = stone * (1.0 - 0.74 * gr * keep) + vec3(0.15) * bv * keep * (1.0 - gr);
    }
    // 石になる時: 首から上へ上がってくる(境目は少し欠けた 1 本の線。すぐ下に石の厚みの影)
    float th = clamp(0.60 - fl.y * 0.52, 0.0, 1.0) * 0.92 + 0.08 * n2(fl * 7.0), tn = uTurn * 1.05;
    float up1 = step(th, tn); stone *= mix(0.62, 1.0, smoothstep(th + 0.003, th + 0.022, tn));
    // 割れ落ちる時: かけらの区切りごとに はがれる(口のまわりから先に)。残っているかけらの縁は暗い溝
    if (uBreak > 0.001) {
      vec2 x = fl * 3.3, ni = floor(x), nf = fract(x), r1 = vec2(0.0), r2 = vec2(0.0); float d1 = 8.0, d2 = 8.0, id = 0.0;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 gI = vec2(float(i), float(j)), cI = ni + gI, r = gI + vec2(h2(cI), h2(cI + 17.0)) - nf; float dd = dot(r, r);
        if (dd < d1) { d2 = d1; r2 = r1; d1 = dd; r1 = r; id = h2(cI + 5.0); } else if (dd < d2) { d2 = dd; r2 = r; } }
      float edge = dot(0.5 * (r1 + r2), normalize(r2 - r1 + 0.0001));
      up1 *= step(uBreak * 1.15, 0.55 * id + 0.45 * clamp(length(fl - vec2(0.0, 0.15)) * 0.8, 0.0, 1.0) + 0.05);
      stone *= 1.0 - 0.8 * (1.0 - smoothstep(0.02, 0.06, edge));
    }
    rgb = mix(mix(mix(rgb, lumpc, hairy * uStone * up1), stone, a * uStone * up1), hairC, hmass * uStone * up1);
  }
  gl_FragColor = vec4(rgb, 1.0);
}`;
function shader(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog); gl.useProgram(prog);
const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0); gl.bindAttribLocation(prog, 0, "a"); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
const U = {}; for (const n of ["uTex", "uCover", "uAspect", "uOpen", "uBrow", "uEye", "uPuck", "uSmile", "uWinkL", "uWinkR", "uSide", "uNear", "uTongue", "uSlide", "uEyeL", "uEyeR", "uFore", "uNose", "uMouth", "uChin", "uW", "uKind", "uVA", "uDents", "uMirror", "uPhoto", "uStone", "uSkin", "uNorm", "uHair", "uHairOn", "uPxW", "uSkinC", "uTurn", "uCrack", "uBreak"]) U[n] = gl.getUniformLocation(prog, n);
// 0 番 = カメラの映像、1 番 = カーブミラーの写真(読めるまでは透明な 1 点)
for (const unit of [gl.TEXTURE1, gl.TEXTURE0]) {
  gl.activeTexture(unit); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  if (unit === gl.TEXTURE1) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
}
gl.uniform1i(U.uTex, 0); gl.uniform1i(U.uMirror, 1); gl.uniform1i(U.uSkin, 4); gl.uniform1i(U.uNorm, 5); gl.uniform1i(U.uHair, 6);
// 写真は 720x1280。透明な所にも色が残っているので、濃さを掛けてから渡す(掛けないと縁に色がにじむ)
const PHOTO = { w: 720, h: 1280, cx: 0.5007, cy: 0.3078, r: 213 / 1280 };   // ガラスの丸: 写真の 0〜1 での中心と、写真の高さを 1 とした半径
let mirrorImg;
function loadMirror() {
  if (mirrorImg) return;
  mirrorImg = new Image();
  mirrorImg.onload = () => {
    gl.activeTexture(gl.TEXTURE1); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mirrorImg);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.activeTexture(gl.TEXTURE0); state.mirrorReady = true;
  };
  mirrorImg.onerror = () => { mirrorImg = null; };
  mirrorImg.src = "mirror.png";
}

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
    setInterval(() => { an.getFloatTimeDomainData(buf); let q = 0; for (const v of buf) q += v * v; state.rms = Math.sqrt(q / buf.length); state.rmsMax = Math.max(state.rmsMax || 0, state.rms); }, 100); }
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
  // いしの かお: 固まっていく間の ごりごり(ざらついた低い雑音を、ふるえる音量で)
  { const n = ac.createBufferSource(), b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), ch = b.getChannelData(0); let x = 0;
    for (let k = 0; k < ch.length; k++) { x = x * 0.96 + (Math.random() * 2 - 1) * 0.3; ch[k] = x * 0.6 + (Math.random() < 0.004 ? Math.random() * 1.6 - 0.8 : 0); }
    n.buffer = b; n.loop = true; const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 240; f.Q.value = 0.7;
    const wob = gain(0.6), g = gain(0, master), lg = gain(0.4); osc("sawtooth", 13, lg); lg.connect(wob.gain);
    n.connect(f); f.connect(wob); wob.connect(g); n.start(); V.stone = { f, g }; }
}
const BELLS = [1568, 1760, 2093, 2349, 2637, 3136, 3520, 4186];
function ping(i) {
  if (!ac || state.soundOff) return; state.pings++;
  const t = ac.currentTime, f = BELLS[((i % BELLS.length) + BELLS.length) % BELLS.length];
  for (const [mul, vol, dec] of [[1, 0.20, 0.55], [2.76, 0.05, 0.22], [5.4, 0.02, 0.12]]) {
    const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f * mul;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(g); g.connect(shimmer); o.start(t); o.stop(t + dec + 0.05);
  }
}
function blip(f) { // ウインクの くりっ
  if (!ac || state.soundOff) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(); o.type = "square";
  o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.07);
  g.gain.setValueAtTime(0.11, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.14);
}
// 止めた時に鳴っていた音が、次に入った瞬間に残って聞こえないように、続けて鳴る音をいったん 0 にする
function hush() {
  for (const g of [whistle.g, squeeze.g, ...Object.values(V).map((v) => v.g)]) { g.gain.cancelScheduledValues(ac.currentTime); g.gain.setValueAtTime(0, ac.currentTime); }
}
function crack() { // こわれた かがみ: へこみを作り直した時の ぱきっ(0.06 秒で消える雑音)
  if (!ac || state.soundOff) return; state.cracks = (state.cracks || 0) + 1;
  const n = Math.round(ac.sampleRate * 0.1), b = ac.createBuffer(1, n, ac.sampleRate), ch = b.getChannelData(0), src = ac.createBufferSource();
  for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * 0.5 * Math.pow(0.001, i / (0.06 * ac.sampleRate));
  src.buffer = b; src.connect(master); src.start();
}
const last = zero(), move = zero();
let lick = 0, lastTX = 0, bell = 0;
function updateSound(dt) {
  if (!ac || state.soundOff) return;
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
  // 下がる方へ 0.3 秒で追っていた時は、値の ゆれ の「いちばん低い所」をふだんの値として覚えてしまい、ゆれ の山が毎回はみ出していた(ちょっとの動きで効く原因の 1 つ)。1.5 秒に
  // (はじめの 6 秒だけは前どおり 0.3 秒: 笑いながら始めた人の基準が、すぐ下がって戻るように)
  b += (raw - b) * (1 - Math.exp(-dt / (raw < b ? (liveT < 6 ? 0.3 : 1.5) : amt > 0 ? 45 : 15)));
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
// 確認用(?jitter=1、?jitter=2 で 2 倍): 止まった絵に「本物の顔らしい小さな ゆれ」を足す。大きさは見積もり(実測ではない):
// 値の ゆれ = ゆっくり変わる雑音(±0.03 前後。口をすぼめる・眉の内側は ゆれ が大きいので ±0.06 / ±0.05)、息で あごが 0.03 上下(4 秒周期)、
// まばたき 3.5 秒ごと(0.15 秒・左右 0.04 秒ずれ・開けた直後に見開きが +0.12)、首の傾き ±2.5 度(2.5 秒周期)、顔の大きさ ±2%(3.3 秒周期)、手ぶれ ±顔の幅の 1%(2 Hz 前後)。
// そこへ「ちょっとした顔の動き」(MOVES: 数秒おきに ゆっくり出て引っこむ。少し口が開く +0.08・少し笑う +0.15・眉が少し上がる +0.15・口が少しすぼむ +0.20・目が少し開く +0.10・口が少し片寄る +0.08)と、首が もう ±2.5 度・顔の大きさが もう ±4% ゆっくり動く分を足す
const MOVES = { jawOpen: 0.08, mouthSmileLeft: 0.15, mouthSmileRight: 0.15, browInnerUp: 0.15, browOuterUpLeft: 0.10, browOuterUpRight: 0.10, mouthPucker: 0.20, eyeWideLeft: 0.10, eyeWideRight: 0.10, mouthLeft: 0.08 };
const jmove = (k, t, i) => { const v = Math.max(0, Math.sin(t * (0.45 + 0.07 * i) + i * 1.9)); return (MOVES[k] || 0) * JIT * v * v; };
const JIT = parseFloat(params.get("jitter")) || 0, jn = {};
function jnoise(k, t, amp) { const j = jn[k] || (jn[k] = { a: Math.random() * 9, b: Math.random() * 9 }); return amp * JIT * (Math.sin(t * 2.1 + j.a) * 0.5 + Math.sin(t * 5.3 + j.b) * 0.3 + Math.sin(t * 11.7 + j.a * 2) * 0.2 + (Math.random() - 0.5) * 0.6); }
function jitterFace(lm, res, now) {
  const t = now / 1000, cats = (res.faceBlendshapes && res.faceBlendshapes[0] && res.faceBlendshapes[0].categories) || [];
  const ph = t % 3.5, blinkL = ph < 0.15 ? 0.9 : 0, blinkR = ph > 0.04 && ph < 0.19 ? 0.85 : 0, after = ph > 0.19 && ph < 0.40 ? 0.12 * JIT : 0;
  let ci = 0;
  for (const c of cats) { const n = c.categoryName, amp = n === "mouthPucker" ? 0.06 : n === "browInnerUp" ? 0.05 : n === "jawOpen" ? 0.02 : 0.03;
    c.score = clamp(c.score + jnoise(n, t, amp) + jmove(n.replace("Right", "Left") in MOVES && n.includes("Right") ? n.replace("Right", "Left") : n, t, n.includes("Right") ? ci - 1 : ci++) + (n === "jawOpen" ? 0.03 * JIT * (0.5 + 0.5 * Math.sin(t * 1.57)) : 0) + (n === "eyeBlinkLeft" ? blinkL : n === "eyeBlinkRight" ? blinkR : 0) + (n.startsWith("eyeWide") ? after : 0)); }
  const cx = lm[1].x, cy = lm[1].y, asp = video.videoWidth / video.videoHeight, w = lm[454].x - lm[234].x;
  const ang = 0.044 * JIT * (Math.sin(t * 2.5) + Math.sin(t * 0.52 + 1.0)) + jnoise("roll", t, 0.006), sc = 1 + JIT * (0.02 * Math.sin(t * 1.9) + 0.04 * Math.sin(t * 0.37 + 2.0)), cs = Math.cos(ang), sn = Math.sin(ang);
  const dx = w * 0.01 * JIT * Math.sin(t * 12.6 + 1) + jnoise("px", t, w * 0.004), dy = w * asp * 0.01 * JIT * Math.sin(t * 10.1) + jnoise("py", t, w * asp * 0.004);
  for (const q of lm) { const x = (q.x - cx) * asp * sc, y = (q.y - cy) * sc; q.x = cx + (x * cs - y * sn) / asp + dx; q.y = cy + x * sn + y * cs + dy; q.z *= sc; }
}
let winkT = [0, 0], tongueT = 0, wBase = 0, rollBase = null, sideBase = null, blinkT = 9, trackT = 0;
// 型が「効きはじめる」までの あそび(小さな動き・まばたき・手ぶれ・値の ゆれ では効かせない)。
// [入り, 切れ]: 0〜1 に直した値が「入り」を 0.07 秒こえたら効きはじめ、「切れ」を下回るまで続く。効いている間の値は前と同じ(入りの所から ぽんと効く。ばね が ならす)。
// だから、わざとやった時の強さ・3コマ の ○ の取りやすさ(0.5 以上)は前のまま。眉は ゆれ が大きいので広め、目は まばたきの反動があるので広め
const GATE = { open: [0.22, 0.12], brow: [0.32, 0.15], eye: [0.45, 0.20], puck: [0.38, 0.18], smile: [0.25, 0.12], winkL: [0.30, 0.15], winkR: [0.30, 0.15], tilt: [0.20, 0.12], side: [0.25, 0.18], near: [0.20, 0.12] };
// 効きぐあい: 効きはじめた後の強さは、動かした量に合わせる(少し動かしただけで強く効かないように)。
//   出る強さ = max × ((動かした量 − 切れ) / (1 − 切れ)) ^ p      (動かした量が「切れ」の所で 0、1 で max)
// p が大きいほど、中くらいの動きが弱くなる(最大は変わらない)。max は型ごとの上限(いまは全部 1 = 前と同じ最大)。次の感想で ここだけ直せるように型ごとに置く
const CURVE = { open: [1.6, 1], brow: [1.8, 1], eye: [2.0, 1], puck: [1.9, 1], smile: [1.6, 1], winkL: [1.5, 1], winkR: [1.5, 1], tilt: [1.6, 1], side: [1.6, 1], near: [1.6, 1] };
const curve = (k, m) => { const [pw, mx] = CURVE[k], off = GATE[k][1], a = Math.abs(m); return a <= off ? 0 : (m < 0 ? -1 : 1) * mx * Math.pow((a - off) / (1 - off), pw); };
state.m = zero();   // 型ごとの「動かした量」(あそび を通った後・効きぐあいを掛ける前)。3コマ の ○・土の種類・じっと は こちらで見る(取りやすさを変えないため)
const gOn = {}, gT = {}, gSg = {}; state.dbg = {};
function gate(k, x, dt, wary = 1, hold = 0.07) {
  if (state.rawForce && k in state.rawForce) x = state.rawForce[k];   // 確認用: あそび と効きぐあいを通る前の値を決め打ちする
  const a = Math.abs(x), [on, off] = GATE[k], sg = x < 0 ? -1 : 1;
  // 1 こまの間が空いた時に、それだけで「0.07 秒続いた」ことにしない(1 回の観測は 0.05 秒まで)。向きが逆になったら(右へ傾けた → 左へ)入り直し
  if (!gOn[k]) { gT[k] = a > on * wary ? (gT[k] || 0) + Math.min(dt, 0.05) : 0; if (gT[k] >= hold) { gOn[k] = true; gSg[k] = sg; } }
  else if (a < off || sg !== gSg[k]) { gOn[k] = false; gT[k] = 0; }
  const out = gOn[k] ? x : 0;
  state.dbg[k] = [x, out]; return out;
}
function track(now) {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const dt = clamp((now - trackT) / 1000, 0.005, 0.2); trackT = now;
  const res = landmarker.detectForVideo(video, now);
  const lm = res.faceLandmarks && res.faceLandmarks[0];
  state.face = !!lm;
  if (!lm) return;
  if (JIT) jitterFace(lm, res, now);   // 確認用: 本物の顔らしい小さな ゆれ を足す(?jitter=1)
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
  // 顔が横を向くほど、目・眉・口の値は当てにならない(片目だけ閉じた・口が片寄った、と出る)。横向きの間は「入り」を最大 1.6 倍きびしく
  const yawN = (lm[1].x - (lm[234].x + lm[454].x) / 2) / ((lm[454].x - lm[234].x) || 1), wary = 1 + 0.6 * clamp((Math.abs(yawN) - 0.10) / 0.15);
  state.yaw = yawN;
  T.open = gate("open", clamp((g("jawOpen") - 0.07) / 0.5), dt);
  T.brow = gate("brow", Math.max(over("browIn", g("browInnerUp"), 0.10, 0.40, dt), (over("browL", g("browOuterUpLeft"), 0.10, 0.40, dt) + over("browR", g("browOuterUpRight"), 0.10, 0.40, dt)) / 2), dt, wary);
  const bl = g("eyeBlinkLeft"), br = g("eyeBlinkRight");
  // 目を見開く: まばたきの間と、開けた直後 0.25 秒(開けた反動で値がはね上がる)は見ない
  blinkT = Math.max(bl, br) > 0.3 ? 0 : blinkT + dt;
  const wide = (over("wideL", g("eyeWideLeft"), 0.10, 0.30, dt) + over("wideR", g("eyeWideRight"), 0.10, 0.30, dt)) / 2;
  T.eye = gate("eye", blinkT < 0.25 ? 0 : wide, dt, wary);
  T.puck = gate("puck", over("puck", g("mouthPucker"), 0.15, 0.45, dt) * (1 - T.open), dt, wary);
  T.smile = gate("smile", (over("smileL", g("mouthSmileLeft"), 0.10, 0.50, dt) + over("smileR", g("mouthSmileRight"), 0.10, 0.50, dt)) / 2, dt, wary);
  // ウインク: 反対の目が開いたまま 0.12 秒続いたら。blendshape の Left は本人の左目 = 映像では右側
  // (まばたきは両目が ほぼ同時だが、少しずれる。差が 0.35 をこえる瞬間があるので、0.12 秒の持続+下の あそび で落とす)
  const wk = [clamp((bl - br - 0.35) / 0.40) * (br < 0.25 ? 1 : 0), clamp((br - bl - 0.35) / 0.40) * (bl < 0.25 ? 1 : 0)];
  for (const k of [0, 1]) winkT[k] = wk[k] > 0 ? winkT[k] + dt : 0;
  T.winkR = gate("winkR", winkT[0] > 0.12 ? wk[0] : 0, dt, wary, 0); T.winkL = gate("winkL", winkT[1] > 0.12 ? wk[1] : 0, dt, wary, 0);   // (0.12 秒の持続を もう見ているので、ここでは待たない)
  // 口を横に: 左右の差。ふだんから片寄っている人がいるので、ふだんの差を覚えて引く(効いていない間に 10 秒で追う)
  const sdRaw = g("mouthLeft") - g("mouthRight"); if (sideBase === null) sideBase = sdRaw;
  const sd = sdRaw - sideBase; T.side = gate("side", liveT < 1.5 ? 0 : Math.sign(sd) * clamp((Math.abs(sd) - 0.08) / 0.25), dt, wary);
  // ふだんの差は、はじめの 1.5 秒は速く(0.5 秒)、あとは 10 秒で追う。効いている間も 6 秒で追う(片寄せたまま落ち着いた人が、いつまでも「効いたまま」にならないように。下の傾き・近づく も同じ)
  sideBase += (sdRaw - sideBase) * (1 - Math.exp(-dt / (liveT < 1.5 ? 0.5 : T.side === 0 ? 10 : 6)));
  // かしげる: 両目を結ぶ線の傾き。ふだんの角度からの差で見る
  const ex = pts.eyeR[0] - pts.eyeL[0], ey = pts.eyeR[1] - pts.eyeL[1], roll = Math.atan2(ey, ex), el = Math.hypot(ex, ey) || 1;
  if (rollBase === null) rollBase = roll;
  const dr = roll - rollBase; T.tilt = gate("tilt", Math.sign(dr) * clamp((Math.abs(dr) - 0.12) / 0.35), dt);   // 入りは 0.12 + 0.35 × 0.20 = 0.19 rad(11 度)
  rollBase += (roll - rollBase) * (1 - Math.exp(-dt / (T.tilt === 0 ? 15 : 6)));
  state.slide = [ex / el, ey / el];
  // 近づく: 顔の幅が、ふだん(8 秒でゆっくり追う)よりどれだけ大きいか
  if (!wBase) wBase = pts.w;
  T.near = gate("near", clamp((pts.w / wBase - 1.12) / 0.30), dt);   // 入りは顔が 1.18 倍(スマホが少し寄っただけでは効かない)
  wBase += (pts.w - wBase) * (1 - Math.exp(-dt / (T.near === 0 ? 8 : 6)));
  // 舌: 口が開いている時だけ。0.15 秒続いたら
  const tg = readTongue(lm, dt), tv = T.open > 0.16 ? tg.amount : 0;
  tongueT = tv > 0.2 ? tongueT + dt : 0;
  T.tongue += ((tongueT > 0.15 ? tv : 0) - T.tongue) * 0.5; state.tongueX = tg.x;
  // ここまでの T は「動かした量」。覚えておいてから、効きぐあいを掛けて「出る強さ」にする(変形・音・字は出る強さで動く)
  for (const k of Object.keys(GATE)) { state.m[k] = T[k]; T[k] = curve(k, T[k]); state.dbg[k][2] = T[k]; }
  state.m.tongue = T.tongue;
  if (state.mode === "stone") stoneTrack(lm, dt);
  if (state.mode === "free") skinTrack(lm, dt);
}

// ---------- いしの かお(石の肌): 顔のどこを石に塗るかを、顔の網から小さな絵(256x256)に描く。塗るのは上の FS ----------
// 進行(あそぶ の中だけ): じっと STONE_AFTER 秒 → 首から石が上がって石になる → 動いても戻らない → ちがう表情を NEED 種類やると割れ落ちて肌に戻る
const STONE_AFTER = parseFloat(params.get("stoneAfter")) || 5;   // じっとしている秒数(ユウキさんの数字。?stoneAfter=3 で確認用に変える)
const STONE_HINT = Math.min(1.8, STONE_AFTER * 0.4), STONE_NEED = 5, STONE_GRACE = 4;
const STILL_SPEED = 0.45;   // ならした後の頭の速さが これ(顔の幅 / 秒)をこえたら「動いている」。スマホを持って見ているだけなら 0.1 前後のはず(見積もり)   // 終わりぎわの前ぶれの秒数 / 割るのに要る表情の種類 / 割れた直後だけ足す秒数
// 数える表情 9 種(ウインクは左右で 1 種。ベロは判定があてにならないので数えない)
const KINDS = [["open"], ["brow"], ["eye"], ["puck"], ["smile"], ["winkL", "winkR"], ["tilt"], ["side"], ["near"]];
const K = state.stoneSkin = { amt: 0, skin: [0.6, 0.45, 0.4], gl: null, phase: "skin", still: 0, turn: 0, crack: 0, brk: 0, kinds: [], hold: KINDS.map(() => 0), speed: 0, last: null, bits: [], knocks: 0, snaps: 0, falls: 0, stall: 0, playT: 0, tell: false, tipUsed: false, tipT: 0, why: "" };
// 髪の切り抜き(MediaPipe の HairSegmenter。Apache-2.0、約 0.78MB。顔を見つける仕組みと同じ置き場 = Google の storage から読む。映像は端末の外へ出ない)。
// 土になりかける時に はじめて読む(ふだんの あそぶ は何も負担しない)。読めない・こわれた時は何もしないで、前のやり方(暗い所だけ つぶす)のまま
const HAIR_MODEL = params.get("hair") === "bad" ? "https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/nope.tflite"   // ?hair=bad = 読めない時の確認用 / ?hair=0 = 使わない
  : "https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite";
const HAIR_EVERY = 100;   // ミリ秒。毎こまは回さず、切り抜きは次に回すまで使い回す
const H = state.hair = { seg: null, loading: false, failed: params.get("hair") === "0", has: false, on: 0, t: 0, ms: 0, runs: 0, tex: null, px: null, delegate: "" };
async function hairLoad() {
  if (H.seg || H.loading || H.failed) return; H.loading = true;
  try { const files = await FilesetResolver.forVisionTasks(MP);
    const mk = (delegate) => ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: HAIR_MODEL, delegate }, runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false });
    try { H.seg = await mk("GPU"); H.delegate = "GPU"; } catch (e) { H.seg = await mk("CPU"); H.delegate = "CPU"; }
  } catch (e) { H.failed = true; }
  H.loading = false;
}
function hairStep(now, dt) {
  const want = state.mode === "free" && state.phase === "live" && (K.phase !== "skin" || K.still > STONE_AFTER - STONE_HINT);
  if (want && !H.seg) hairLoad();
  H.on += ((want && H.has && K.turn > 0.001 ? 1 : 0) - H.on) * Math.min(1, dt * 6);
  if (!want || !H.seg || !state.face || video.readyState < 2 || now - H.t < HAIR_EVERY) return;
  H.t = now; const t0 = performance.now();
  try {
    H.seg.segmentForVideo(video, now, (res) => {
      const mk = res.confidenceMasks && res.confidenceMasks[res.confidenceMasks.length - 1]; if (!mk) return;   // 最後の 1 枚 = 髪
      const f = mk.getAsFloat32Array(), w = mk.width, h = mk.height, N = 256; if (!H.px) H.px = new Uint8Array(N * N);
      for (let y = 0; y < N; y++) { const sy = Math.min(h - 1, Math.floor((y + 0.5) * h / N)) * w; for (let x = 0; x < N; x++) H.px[y * N + x] = f[sy + Math.min(w - 1, Math.floor((x + 0.5) * w / N))] * 255; }
      gl.activeTexture(gl.TEXTURE6);
      if (!H.tex) { H.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, H.tex);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, N, N, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, H.px); gl.activeTexture(gl.TEXTURE0); H.has = true;
    });
  } catch (e) { H.failed = true; H.seg = null; H.has = false; state.hairErr = String(e).slice(0, 160); }
  H.ms += (performance.now() - t0 - H.ms) * (H.runs ? 0.15 : 1); H.runs++;
}
let turnedOnce = false;
// ちがう かおを する を もう見せたか(端末に覚えておく。覚えられない環境では、ページを開いている間だけ)
let clayTold = false; try { clayTold = localStorage.getItem("clayTold") === "1"; } catch (e) {}
// まだ数えていない動き(判定が確かな順)の、れんしゅう用の言い方
function stoneTip() { const i = [1, 0, 4, 3, 6, 8, 7, 2, 5].find((k) => !K.kinds.includes(k)); return (STEPS.find((st) => st[0][0] === KINDS[i][0]) || STEPS[0])[1]; }
function skinReset(stone) { H.has = false; H.on = 0; Object.assign(K, { stall: 0, playT: 0, tell: false, tipUsed: false, tipT: 0, phase: stone ? "stone" : "skin", still: 0, turn: stone ? 1 : 0, crack: 0, brk: 0, kinds: [], hold: KINDS.map(() => 0), speed: 0, last: null, bits: [], amt: 0 }); }
function skinStep(dt, on) {
  const t = state.m, moving = CH.filter((k) => k !== "tongue" && Math.abs(t[k]) > 0.02), expr = moving.length ? 1 : 0, head = K.speed > STILL_SPEED ? 1 : 0;
  let grind = 0;
  if (K.phase === "skin") {
    // 表情が 1 つも効いていなくて、頭もほぼ止まっている間だけ数える。動いたら はじめから
    // じっと = 型が 1 つも効いていない(あそび を通った後の値。まばたき・小さな動きは もう 0)+頭が大きく動いていない。
    // 型が効いたら(わざと顔を動かした)はじめから。頭が少し動いただけなら、止めて少し巻き戻すだけ(手ぶれで毎回 0 に戻らないように)
    if (K.still < 0) K.still = Math.min(0, K.still + dt);   // 割れた直後の待ち時間(何をしていても進む)
    else if (!on || liveT <= 1.5) { K.still = 0; K.why = !on ? "no face" : "learning"; }
    else if (expr) { K.still = 0; K.why = "warp " + moving.join(","); }
    else if (head) { K.still = Math.max(0, K.still - dt * 1.5); K.why = "head " + K.speed.toFixed(2); }
    else K.still += dt;
    // 前ぶれ: 終わりぎわに、首から石が少しだけ上がってきて、小さく ごりごり 鳴る(動けば引っこむ)。数字も字も出さない
    const hint = clamp((K.still - (STONE_AFTER - STONE_HINT)) / STONE_HINT);
    K.turn += (0.32 * hint - K.turn) * Math.min(1, dt * (hint > 0 ? 6 : 8)); grind = 0.3 * hint;
    if (on) K.playT += dt;
    if (K.still >= STONE_AFTER) { K.phase = "turning"; turnedOnce = true; K.tell = !clayTold; K.tipUsed = false; K.tipT = 0;
      if (!clayTold) { clayTold = true; try { localStorage.setItem("clayTold", "1"); } catch (e) {} } }
  } else if (K.phase === "turning") {
    K.turn = Math.min(1, K.turn + dt / 1.1); grind = 1;
    if (K.turn >= 1) { K.phase = "stone"; K.kinds = []; K.hold.fill(0); K.stall = 0; K.knocks++; stoneKnock(); }
  } else if (K.phase === "stone" && on) {
    K.stall += dt; K.tipT = Math.max(0, K.tipT - dt);
    if (!K.tipUsed && K.stall > 12) { K.tipUsed = true; K.tipT = 6; }
    // ちがう種類を はっきりやるたびに ひびが 1 本(同じ種類は 1 回だけ数える)。3コマ と同じ見方: 0.5 以上が 0.2 秒
    KINDS.forEach((keys, i) => {
      K.hold[i] = Math.max(...keys.map((k) => Math.abs(t[k]))) >= 0.5 ? K.hold[i] + dt : 0;
      if (K.hold[i] > 0.2 && !K.kinds.includes(i)) { K.kinds.push(i); K.stall = 0; K.tipT = 0;
        if (K.kinds.length >= STONE_NEED) { K.phase = "breaking"; K.brk = 0; K.falls++; stoneFall(); bitsSpawn(); } else { K.snaps++; stoneSnap(); } }
    });
  } else if (K.phase === "breaking") {
    K.brk += dt / 0.75;
    if (K.brk >= 1) Object.assign(K, { phase: "skin", turn: 0, crack: 0, brk: 0, kinds: [], still: -STONE_GRACE });   // 割れた直後は少し長く待つ(すぐ また石にならないように)
  }
  const want = K.phase === "breaking" ? 4 : Math.min(K.kinds.length, 4); K.crack = K.phase === "skin" ? 0 : Math.min(want, K.crack + dt * 3.5);
  if (ac && !state.soundOff && V.stone) { const now = ac.currentTime; V.stone.g.gain.setTargetAtTime(grind * (0.10 + 0.14 * K.turn), now, 0.08); V.stone.f.frequency.setTargetAtTime(170 + 190 * K.turn, now, 0.1); }
}
// 割れ落ちる石のかけら(平たい石の破片。顔の絵は乗せない): 顔のあたりから外へ押し出されて下へ落ちる
let BG = null;
function bitsSpawn() {
  const w = pts.w, c = [pts.nose[0], pts.nose[1] - 0.1 * w];
  K.bits = Array.from({ length: 25 }, (_, n) => { const small = n >= 13; /* 厚いかけら 13 個+土くれ 12 個 */ const a = rnd(0, 6.283), r = Math.sqrt(Math.random()), x = Math.cos(a) * r * 0.5, y = Math.sin(a) * r * 0.72;
    return { x: c[0] + x * w, y: c[1] + y * w, vx: x * rnd(0.6, 1.6) * w, vy: (y * 0.5 - rnd(0.1, 0.7)) * w, rot: rnd(0, 6.283), spin: rnd(-1.5, 1.5), size: (small ? rnd(0.02, 0.045) : rnd(0.09, 0.19)) * w, t: -rnd(0, 0.35) - Math.hypot(x, y) * 0.3,
      shape: Array.from({ length: 5 }, (_, i) => [i * 1.2566 + rnd(-0.4, 0.4), rnd(0.55, 1)]), shade: rnd(0.40, 0.60) }; });
}
function bitsDraw(dt, va, ca) {
  if (!BG) { const pr = gl.createProgram();
    gl.attachShader(pr, shader(gl.VERTEX_SHADER, `attribute vec2 aP; attribute vec3 aC; varying vec3 vC; void main(){ vC = aC; gl_Position = vec4(aP, 0.0, 1.0); }`));
    gl.attachShader(pr, shader(gl.FRAGMENT_SHADER, `precision mediump float; varying vec3 vC;
      float h(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      void main(){ float g = vC.z * (0.86 + 0.28 * h(floor(vC.xy * 46.0))); gl_FragColor = vec4(vec3(g) * vec3(1.06, 0.98, 0.96), 1.0); }`));
    gl.bindAttribLocation(pr, 0, "aP"); gl.bindAttribLocation(pr, 1, "aC"); gl.linkProgram(pr); BG = { pr, buf: gl.createBuffer(), data: new Float32Array(25 * 2 * 9 * 5) }; }
  const cvx = va > ca ? ca / va : 1, cvy = va > ca ? 1 : va / ca, d = BG.data; let n = 0, alive = 0;
  for (const b of K.bits) { b.t += dt; if (b.t < 0) { alive++; continue; } if (b.t > 1.4) continue; alive++;
    const x = b.x + b.vx * b.t * 0.6, y = b.y + b.vy * b.t * 0.5 + 4.6 * pts.w * b.t * b.t, an = b.rot + b.spin * b.t;
    const P = b.shape.map(([a, r]) => [Math.cos(a + an) * r * b.size, Math.sin(a + an) * r * b.size, Math.cos(a), Math.sin(a) * r]);
    // 先に、少し下へずらした暗い面(石の厚み)。その上に表の面(角ごとに明るさを少し変えて、面の向きを出す)
    for (const [off, mul] of [[0.22 * b.size, 0.38], [0, 1]]) for (let i = 1; i < 4; i++) for (const [k, q] of [[0, P[0]], [i, P[i]], [i + 1, P[i + 1]]]) {
      d[n++] = (1 - 2 * (x + q[0] + off * 0.5) / va) / cvx; d[n++] = (1 - 2 * (y + q[1] + off)) / cvy; d[n++] = q[2]; d[n++] = q[3]; d[n++] = b.shade * mul * (k % 2 ? 0.82 : 1.0); } }
  if (!alive) { K.bits = []; return; }
  if (!n) return;
  gl.useProgram(BG.pr); gl.bindBuffer(gl.ARRAY_BUFFER, BG.buf); gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, n), gl.DYNAMIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8);
  gl.drawArrays(gl.TRIANGLES, 0, n / 5);
  gl.disableVertexAttribArray(1); gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}
const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
function skinSetup() {
  const pr = gl.createProgram();
  gl.attachShader(pr, shader(gl.VERTEX_SHADER, `attribute vec2 aP; attribute vec4 aC; varying vec4 vC; void main(){ vC = aC; gl_Position = vec4(aP * 2.0 - 1.0, 0.0, 1.0); }`));
  gl.attachShader(pr, shader(gl.FRAGMENT_SHADER, `precision mediump float; varying vec4 vC; void main(){ gl_FragColor = vC; }`));
  gl.bindAttribLocation(pr, 0, "aP"); gl.bindAttribLocation(pr, 1, "aC"); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  // 三角形: 外の縁(先に描く)→ 顔の網 → 目と口の穴の埋め
  const cs = FaceLandmarker.FACE_LANDMARKS_TESSELATION, tris = [];
  for (let i = 0; i < NO; i++) { const j = (i + 1) % NO, a = OVAL[i], b = OVAL[j], c = NF + i, d = NF + j, e = NF + NO + i, f = NF + NO + j; tris.push(a, b, c, b, d, c, c, d, e, d, f, e); }
  for (let i = 0; i + 2 < cs.length; i += 3) tris.push(cs[i].start, cs[i].end, cs[i + 1].end);
  for (const ring of [EYES.slice(0, 16), EYES.slice(16), INLIP]) for (let i = 1; i + 1 < ring.length; i++) tris.push(ring[0], ring[i], ring[i + 1]);
  // 色 = (顔, 目, 髪のあたり, くちびる 0.6 〜 口の中 1)。輪郭の上半分は髪のあたり、下半分は首へぼかす
  const col = new Float32Array(NV * 4); for (let i = 0; i < NF; i++) col[i * 4] = 1;
  for (const i of EYES) col[i * 4 + 1] = 1; for (const i of LIPS) col[i * 4 + 3] = 0.6; for (const i of INLIP) col[i * 4 + 3] = 1;
  for (let i = 0; i < NO; i++) { const top = clamp(Math.cos(i / NO * Math.PI * 2) * 2.2 + 0.3);
    col[OVAL[i] * 4 + 2] = top; col.set([(1 - top) * 0.9, 0, top, 0], (NF + i) * 4); }
  const ib = gl.createBuffer(), cb = gl.createBuffer(), pb = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(tris), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.activeTexture(gl.TEXTURE4); const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.activeTexture(gl.TEXTURE0);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  // 5 番 = 面の向きの絵(土の形を照らすのに使う)
  gl.activeTexture(gl.TEXTURE5); const tex2 = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex2);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.activeTexture(gl.TEXTURE0);
  const fb2 = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb2); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex2, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  K.gl = { pr, ib, cb, pb, fb, fb2, nb: gl.createBuffer(), tris, n: tris.length, pos: new Float32Array(NV * 2), p3: new Float32Array(NV * 3), nor: new Float32Array(NV * 4), ready: false };
}
// 新しい映像が来るたび: 塗り分けの形と、肌の色(小さい写しから。ゆっくり追う)
function skinTrack(lm, dt) {
  if (!K.gl) try { skinSetup(); } catch (e) { state.err = String(e).slice(0, 160); return; }
  const pos = K.gl.pos, asp = video.videoWidth / video.videoHeight;
  for (let i = 0; i < NF; i++) { pos[i * 2] = lm[i].x; pos[i * 2 + 1] = lm[i].y; }
  // 縁: 輪郭から外へ。上(髪)と下(首)は広く、横(耳)は狭く
  const cx = lm[1].x * asp, cy = lm[1].y; let ux = (lm[152].x - lm[10].x) * asp, uy = lm[152].y - lm[10].y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
  const w = Math.hypot((lm[454].x - lm[234].x) * asp, lm[454].y - lm[234].y);
  for (let i = 0; i < NO; i++) { const o = lm[OVAL[i]]; let dx = o.x * asp - cx, dy = o.y - cy; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const down = dx * ux + dy * uy, ext = w * (down < 0 ? 0.12 + 0.58 * down * down : 0.10 + 0.50 * down * down);
    pos.set([o.x + dx * ext * 0.5 / asp, o.y + dy * ext * 0.5], (NF + i) * 2); pos.set([o.x + dx * ext / asp, o.y + dy * ext], (NF + NO + i) * 2);
    K.gl.p3[(NF + i) * 3 + 2] = o.z * asp + ext * 0.45; K.gl.p3[(NF + NO + i) * 3 + 2] = o.z * asp + ext * 1.3; }   // 縁は奥へ丸める(頭と首の丸み)
  // 面の向き: 三角形ごとの向きを頂点に集めて ならす(カメラの方を向かせる)。色 = 向き × 0.5 + 0.5
  const p3 = K.gl.p3, nor = K.gl.nor, tr = K.gl.tris; nor.fill(0);
  for (let i = 0; i < NF; i++) p3[i * 3 + 2] = lm[i].z * asp;
  for (let i = 0; i < NV; i++) { p3[i * 3] = pos[i * 2] * asp; p3[i * 3 + 1] = pos[i * 2 + 1]; }
  for (let t = 0; t < tr.length; t += 3) { const a = tr[t] * 3, b = tr[t + 1] * 3, c = tr[t + 2] * 3;
    const ax = p3[b] - p3[a], ay = p3[b + 1] - p3[a + 1], az = p3[b + 2] - p3[a + 2], bx = p3[c] - p3[a], by = p3[c + 1] - p3[a + 1], bz = p3[c + 2] - p3[a + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; if (nz > 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (const k of [tr[t], tr[t + 1], tr[t + 2]]) { nor[k * 4] += nx; nor[k * 4 + 1] += ny; nor[k * 4 + 2] += nz; } }
  for (let i = 0; i < NV; i++) { const l = Math.hypot(nor[i * 4], nor[i * 4 + 1], nor[i * 4 + 2]) || 1; nor[i * 4] = nor[i * 4] / l * 0.5 + 0.5; nor[i * 4 + 1] = nor[i * 4 + 1] / l * 0.5 + 0.5; nor[i * 4 + 2] = nor[i * 4 + 2] / l * 0.5 + 0.5; nor[i * 4 + 3] = 1; }
  K.gl.ready = true;
  // 頭の動きの速さ(顔の幅 / 秒 + 傾きの変わる速さ)。じっとしているかの判定に使う。
  // 手ぶれ・点の ふるえ を速さに数えないよう、先に位置と傾きを 0.25 秒で ならしてから、その動きの速さを見る(さらに 0.3 秒で ならす)
  const roll = Math.atan2(lm[263].y - lm[33].y, (lm[263].x - lm[33].x) * asp);
  if (K.last) { const e = 1 - Math.exp(-dt / 0.25), nx = K.last[0] + (cx - K.last[0]) * e, ny = K.last[1] + (cy - K.last[1]) * e, nr = K.last[2] + (roll - K.last[2]) * e;
    const sp = Math.hypot(nx - K.last[0], ny - K.last[1]) / w / dt + Math.abs(nr - K.last[2]) / dt; K.speed += (sp - K.speed) * (1 - Math.exp(-dt / 0.3)); K.last = [nx, ny, nr]; }
  else K.last = [cx, cy, roll];
  const d = pctx.getImageData(0, 0, probe.width, probe.height).data, PW = probe.width, PH = probe.height, e = liveT < 0.5 ? 1 : Math.min(1, dt * 3), c = [0, 0, 0];
  for (const i of [50, 280, 151, 205, 425]) { const k = (clamp(Math.round(lm[i].y * PH), 0, PH - 1) * PW + clamp(Math.round(lm[i].x * PW), 0, PW - 1)) * 4; for (let j = 0; j < 3; j++) c[j] += d[k + j] / 255 / 5; }
  for (let j = 0; j < 3; j++) K.skin[j] += (c[j] - K.skin[j]) * e;
}
function skinMask() {
  const g = K.gl; if (!g || !g.ready) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, g.fb); gl.viewport(0, 0, 256, 256); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(g.pr); gl.bindBuffer(gl.ARRAY_BUFFER, g.pb); gl.bufferData(gl.ARRAY_BUFFER, g.pos, gl.DYNAMIC_DRAW); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, g.cb); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ib); gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0);
  // 同じ形をもう 1 枚: 面の向き(外は「正面向き」で塗っておく)
  gl.bindFramebuffer(gl.FRAMEBUFFER, g.fb2); gl.clearColor(0.5, 0.5, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindBuffer(gl.ARRAY_BUFFER, g.nb); gl.bufferData(gl.ARRAY_BUFFER, g.nor, gl.DYNAMIC_DRAW); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.drawElements(gl.TRIANGLES, g.n, gl.UNSIGNED_SHORT, 0);
  // 元の描き方に戻す
  gl.disableVertexAttribArray(1); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}

// ---------- いしの かお(前の試作。?stone=crumble の時だけ): じっとしていると石像になり、動くと石にひびが入って割れ落ちる ----------
// 2 回目の描画で、顔の網(MediaPipe の 478 点)+頭と首のぶんの縁を三角形で重ねる。石の粒・くぼみ・ひびは「頭に固定した座標」で作るので顔に貼りつく。
// 固まった瞬間の映像と形を覚え、あとは頭の向きにだけ合わせて硬いまま動かす(表情は石の中に閉じこめられる)。
const S = state.stone = { phase: "soft", p: 0, c: 0, k: 0, knocks: 0, snaps: 0, falls: 0, ms: 0 };
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const EYES = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
const INLIP = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
const NF = 478, NO = OVAL.length, NV = NF + NO * 2, CELL = 2.5, JN = 16, FL = 17;
let SG = null;   // 描く仕組み(はじめて入った時に作る)
const CAP = params.get("cap") === "0" ? 0.3 : 1;   // 確認用: ?cap=0 で頭と首のぶんの縁をほぼ無くす(顔だけ石)。見くらべ用
const SVS = `attribute vec3 aPos; attribute vec2 aUV; attribute vec3 aLoc, aNor; attribute vec4 aAtt; attribute float aAl;
varying vec2 vUV; varying vec3 vL, vN; varying vec4 vA; varying float vAl;   // aAl = このかけらの番号(0〜1)。負なら割っていない
void main(){ vUV = aUV; vL = aLoc; vN = aNor; vA = aAtt; vAl = aAl; gl_Position = vec4(aPos, 1.0); }`;
const SFS = `precision highp float;
varying vec2 vUV; varying vec3 vL, vN; varying vec4 vA; varying float vAl;   // vA = (目, 口の中, 縁, 縁の消え方)
uniform sampler2D uSrc, uJit; uniform vec2 uPx; uniform vec3 uSkin, uIris[2]; uniform vec2 uMouthL;
uniform float uP, uC, uAsp;
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float h3(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ return 0.5 * n3(p) + 0.3 * n3(p * 2.1 + 3.0) + 0.2 * n3(p * 4.3 + 7.0); }
// 小さな丸い穴(ます目ごとに、あったり無かったり)
float pits(vec3 p){ vec3 i = floor(p), f = fract(p) - 0.5; float k = h3(i + 3.0);
  vec3 o = (vec3(h3(i + 11.0), h3(i + 23.0), h3(i + 37.0)) - 0.5) * 0.5;
  return step(0.62, k) * (1.0 - smoothstep(0.10, 0.10 + 0.22 * k, length(f - o))); }
// 石の面の高さ: ゆるいでこぼこ+ざらつき+穴
float height(vec3 p){ return 0.36 * fbm(p * 5.0) + 0.07 * n3(p * 40.0) - 0.11 * pits(p * 24.0) - 0.05 * pits(p * 43.0 + 7.0); }
// ひびの網: 割れるかけらと同じ区切り(main.js の cellOf と同じ表を引く)。返り値 = (境目までの近さ, かけらの乱数, 境目の向きの明暗)
vec3 voro(vec2 x){
  vec2 n = floor(x), f = fract(x); float d1 = 8.0, d2 = 8.0; vec2 r1 = vec2(0.0), r2 = vec2(0.0); float id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec4 t = texture2D(uJit, (mod(n + g, ${JN}.0) + 0.5) / ${JN}.0);
    vec2 r = g + t.xy - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; r2 = r1; d1 = d; r1 = r; id = t.z; } else if (d < d2) { d2 = d; r2 = r; }
  }
  vec2 e = normalize(r2 - r1 + 0.0001);
  return vec3(dot(0.5 * (r1 + r2), e), id, dot(e, normalize(vec2(-0.6, -0.8))));
}
void main(){
  vec3 src = texture2D(uSrc, vUV).rgb; float L = lum(src), Lb = L * 0.2;
  Lb += 0.1 * (lum(texture2D(uSrc, vUV + uPx * vec2(1.0, 0.0)).rgb) + lum(texture2D(uSrc, vUV + uPx * vec2(-1.0, 0.0)).rgb)
             + lum(texture2D(uSrc, vUV + uPx * vec2(0.0, 1.0)).rgb) + lum(texture2D(uSrc, vUV + uPx * vec2(0.0, -1.0)).rgb)
             + lum(texture2D(uSrc, vUV + uPx * vec2(0.7, 0.7)).rgb) + lum(texture2D(uSrc, vUV + uPx * vec2(-0.7, 0.7)).rgb)
             + lum(texture2D(uSrc, vUV + uPx * vec2(0.7, -0.7)).rgb) + lum(texture2D(uSrc, vUV + uPx * vec2(-0.7, -0.7)).rgb));
  float skinL = max(lum(uSkin), 0.10), rel = Lb / skinL, det = (L - Lb) / skinL;
  float eye = smoothstep(0.985, 1.0, vA.x), lid = smoothstep(0.62, 0.97, vA.x) * (1.0 - eye), mouth = smoothstep(0.80, 0.98, vA.y), skirt = vA.z;
  // 目: 白目・黒目・まつげを消して、彫った輪と浅いくぼみに置きかえる
  float carve = 0.0;
  for (int i = 0; i < 2; i++) { float r = length((vUV - uIris[i].xy) * vec2(uAsp, 1.0)) / uIris[i].z;
    carve += 0.60 * (1.0 - smoothstep(0.03, 0.15, abs(r - 0.90))) + 0.75 * (1.0 - smoothstep(0.24, 0.38, r)); }
  // 肌の明暗は「形の影」としてだけ薄く残す(写真の細部は捨てる)。顔の外(髪・耳・首)は写真を使わず、彫った形だけにする
  float outer = smoothstep(0.0, 0.22, skirt), keep = 0.16 * (1.0 - outer);
  float tone = mix(1.0, clamp(rel, 0.22, 1.25), keep) + det * 0.08 * (1.0 - outer);
  // 髪: 一段暗い石のかたまり。生えぎわに浅い溝だけ(筋は彫らない。筋を入れるとゴムのかつらに見えた)
  float hair = outer * smoothstep(-0.02, -0.26, vL.y);
  tone *= mix(1.0, 0.70, hair) * (1.0 - 0.28 * hair * (1.0 - smoothstep(0.03, 0.14, skirt)));
  tone = mix(tone, 0.90 - 0.26 * carve, eye) * (1.0 - 0.22 * lid);
  tone = mix(tone, 0.34, mouth);
  // 網の向きから彫刻として照らし直す(左上の前から)
  vec3 N = normalize(vN), Ld = normalize(vec3(-0.42, -0.58, -0.70));
  float shade = 0.44 + 0.80 * max(dot(N, Ld), 0.0);
  float rough = 1.0 - eye * 0.6;
  float relief = (height(vL) - height(vL + vec3(-0.006, -0.008, -0.003))) * rough;
  float grain = n3(vL * 150.0), fleck = step(0.83, n3(vL * 75.0 + 5.0));
  tone *= 1.0 - 0.30 * rough * (pits(vL * 24.0) + 0.6 * pits(vL * 43.0 + 7.0));
  tone *= shade * (1.0 + 3.0 * relief) * (0.88 + 0.24 * grain) * (1.0 - 0.16 * fleck * rough);
  vec3 col = mix(vec3(0.70, 0.69, 0.65), vec3(0.56, 0.58, 0.58), fbm(vL * 2.3 + 2.0)) * tone * 1.06;
  // ひび: 口のまわりから外へ広がる。暗い溝+光の当たる側の細い面取り
  vec3 v = voro(vL.xy * ${CELL.toFixed(1)});
  float reach = length(vL.xy - uMouthL) * 0.95 + 0.30 * n3(vL * 3.0 + 5.0);
  // 全部の境目は見せない(亀の甲にならないように)。枝だけ見えて、割れる直前にほぼつながる
  float on = smoothstep(reach - 0.10, reach + 0.02, uC * 1.75) * smoothstep(0.50 - 0.42 * uC * uC, 0.56 - 0.42 * uC * uC, n3(vec3(vL.xy * 4.2, 9.0)));
  on = max(on, step(0.0, vAl) * step(0.999, uC));
  float wd = (0.007 + 0.016 * uC) * (0.6 + 0.8 * n3(vL * 17.0));
  float groove = (1.0 - smoothstep(wd * 0.35, wd, v.x)) * on;
  float bevel = (smoothstep(wd, wd * 1.4, v.x) - smoothstep(wd * 1.6, wd * 3.2, v.x)) * on;
  col *= 1.0 - 0.80 * groove; col += vec3(0.20) * bevel * (0.5 + 0.5 * v.z);
  // 固まっていく境目: 首から上へ。境目は欠けた形にして、石の厚みの影をつける
  float th = clamp(0.52 - vL.y * 0.5, 0.0, 1.0) * 0.93 + 0.07 * fbm(vL * 6.0);
  float a = step(th, uP * 1.04);
  col *= mix(0.6, 1.0, smoothstep(th + 0.004, th + 0.02, uP * 1.04));
  // 頭と首の縁: 欠けた輪郭で終わらせる(ぼかさない)
  float edge = vA.w * 1.5 - 0.55 * fbm(vL * 7.0 + 4.0);
  a *= step(0.12, edge);
  col *= mix(0.6, 1.0, smoothstep(0.12, 0.30, edge));
  if (a < 0.5 || (vAl >= 0.0 && abs(v.y - vAl) > 0.002)) discard;   // かけらは、自分の区切りの中だけ描く
  gl_FragColor = vec4(col, 1.0);
}`;
function stoneSetup() {
  const pr = gl.createProgram();
  gl.attachShader(pr, shader(gl.VERTEX_SHADER, SVS)); gl.attachShader(pr, shader(gl.FRAGMENT_SHADER, SFS));
  ["aPos", "aUV", "aLoc", "aNor", "aAtt", "aAl"].forEach((n, i) => gl.bindAttribLocation(pr, i, n));
  gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
  const u = {}; for (const n of ["uSrc", "uJit", "uPx", "uSkin", "uIris", "uMouthL", "uP", "uC", "uAsp"]) u[n] = gl.getUniformLocation(pr, n);
  // 顔の網の三角形: MediaPipe の線の一覧は 3 本ずつで 1 つの三角形になっている
  const cs = FaceLandmarker.FACE_LANDMARKS_TESSELATION, tris = [];
  for (let i = 0; i + 2 < cs.length; i += 3) { if (cs[i + 1].start !== cs[i].end || cs[i + 2].end !== cs[i].start) throw new Error("mesh"); tris.push(cs[i].start, cs[i].end, cs[i + 1].end); }
  // 目と口の穴をふさぐ(石像に穴は開いていない)
  for (const ring of [EYES.slice(0, 16), EYES.slice(16), INLIP]) for (let i = 1; i + 1 < ring.length; i++) tris.push(ring[0], ring[i], ring[i + 1]);
  // 縁: 顔の輪郭 → 中の輪(NF〜)→ 外の輪(NF+NO〜)
  for (let i = 0; i < NO; i++) { const j = (i + 1) % NO, a = OVAL[i], b = OVAL[j], c = NF + i, d = NF + j, e = NF + NO + i, f = NF + NO + j; tris.push(a, b, c, b, d, c, c, d, e, d, f, e); }
  const att = new Float32Array(NV * 4);   // (目, 口の中, 縁, 縁の消え方)
  for (let i = 0; i < NF; i++) att[i * 4 + 3] = 1;
  for (const i of EYES) att[i * 4] = 1; for (const i of INLIP) att[i * 4 + 1] = 1;
  for (let i = 0; i < NO; i++) { att.set([0, 0, 0.55, 1], (NF + i) * 4); att.set([0, 0, 1, 0], (NF + NO + i) * 4); }
  // かけらの区切りの表(シェーダと同じものを引く)
  const jit = new Uint8Array(JN * JN * 4); for (let i = 0; i < jit.length; i++) jit[i] = Math.floor(Math.random() * 256);
  const tex = (unit) => { gl.activeTexture(unit); const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
  tex(gl.TEXTURE2); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(3));   // 2 番 = 固まった瞬間の映像
  tex(gl.TEXTURE3); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, JN, JN, 0, gl.RGBA, gl.UNSIGNED_BYTE, jit); gl.activeTexture(gl.TEXTURE0);
  const nt = tris.length / 3;
  SG = { pr, u, tris, nt, att, jit, buf: gl.createBuffer(), data: new Float32Array(nt * 3 * FL * 3), parts: [],
    loc: new Float32Array(NV * 3), uv: new Float32Array(NV * 2), pos: new Float32Array(NV * 3), nor: new Float32Array(NV * 3),
    fLoc: new Float32Array(NV * 3), fUV: new Float32Array(NV * 2), cells: [], pose: null,
    skin: [0.6, 0.45, 0.4], iris: new Float32Array(6), mouthL: [0, 0.5], fSkin: null, fIris: new Float32Array(6), frozen: false, speed: 0 };
}
// シェーダの voro と同じ: その点がどのかけらに入るか
function cellOf(x, y) {
  const nx = Math.floor(x), ny = Math.floor(y); let best = 9, id = 0, sx = 0, sy = 0, z = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = nx + i, cy = ny + j, k = ((((cy % JN) + JN) % JN) * JN + (((cx % JN) + JN) % JN)) * 4;
    const px = cx + SG.jit[k] / 255, py = cy + SG.jit[k + 1] / 255, d = (px - x) * (px - x) + (py - y) * (py - y);
    if (d < best) { best = d; id = (cy + 64) * 128 + cx + 64; sx = px; sy = py; z = SG.jit[k + 2] / 255; }
  }
  return [id, sx / CELL, sy / CELL, z];
}
const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] };
// 新しい映像が来るたび: 頭の向きを出し、(固まる前なら)頭に固定した座標を作り直す
function stoneTrack(lm, dt) {
  if (!SG) return;
  const G0 = SG, asp = video.videoWidth / video.videoHeight, P = (i) => [lm[i].x * asp, lm[i].y, lm[i].z * asp];
  // 向きは、あごの動きに引っぱられない点から(両耳の前・額の上・鼻の下・眉間)
  const a = P(234), b = P(454), o = P(168); let r = v3.sub(b, a); const w = Math.hypot(r[0], r[1], r[2]) || 0.3; r = v3.norm(r);
  const f = v3.norm(v3.cross(r, v3.sub(P(2), P(10)))), u = v3.cross(f, r);
  const old = G0.pose;
  if (old) { const sp = Math.hypot(o[0] - old.o[0], o[1] - old.o[1]) / w / dt + Math.hypot(r[0] - old.r[0], r[1] - old.r[1], r[2] - old.r[2]) / dt; G0.speed += (sp - G0.speed) * Math.min(1, dt * 8); }
  G0.pose = { o, r, u, f, w };
  if (G0.frozen) return;
  for (let i = 0; i < NF; i++) { const d = v3.sub(P(i), o); G0.loc.set([v3.dot(d, r) / w, v3.dot(d, u) / w, v3.dot(d, f) / w], i * 3); G0.uv.set([lm[i].x, lm[i].y], i * 2); }
  // 縁: 輪郭から外へ。上(髪)と下(首)は広く、横は狭く。奥へ丸める
  for (let i = 0; i < NO; i++) {
    const k = OVAL[i] * 3, lx = G0.loc[k], ly = G0.loc[k + 1], lz = G0.loc[k + 2]; let dx = lx, dy = ly - 0.15; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const ext = (dy < 0 ? 0.16 + 0.36 * dy * dy : 0.14 + 0.08 * dx * dx + 0.34 * dy * dy) * CAP;
    G0.loc.set([lx + dx * ext * 0.55, ly + dy * ext * 0.55, lz + ext * 0.25], (NF + i) * 3);
    G0.loc.set([lx + dx * ext, ly + dy * ext, lz + ext * 1.0], (NF + NO + i) * 3);
  }
  // 肌の明るさ(小さい写しから)。ゆっくり追う。肌の色が濃くても薄くても、同じ明るさの石になるように使う
  const d = pctx.getImageData(0, 0, probe.width, probe.height).data, PW = probe.width, PH = probe.height;
  const rgb = (x, y) => { const k = (clamp(Math.round(y * PH), 0, PH - 1) * PW + clamp(Math.round(x * PW), 0, PW - 1)) * 4; return [d[k] / 255, d[k + 1] / 255, d[k + 2] / 255]; };
  const avg = (ps) => ps.reduce((s, p) => [s[0] + p[0] / ps.length, s[1] + p[1] / ps.length, s[2] + p[2] / ps.length], [0, 0, 0]);
  const skin = avg([50, 280, 151, 205, 425].map((i) => rgb(lm[i].x, lm[i].y)));
  const e = Math.min(1, dt * 4); for (let i = 0; i < 3; i++) G0.skin[i] += (skin[i] - G0.skin[i]) * e;
  for (const [n, c, q] of [[0, 468, 469], [1, 473, 474]]) G0.iris.set([lm[c].x, lm[c].y, Math.hypot((lm[q].x - lm[c].x) * asp, lm[q].y - lm[c].y) || 0.01], n * 3);
  G0.mouthL = [G0.loc[13 * 3], G0.loc[13 * 3 + 1]];
}
// 固まった瞬間: 映像と形を覚え、かけらの割りふりを決める
function stoneFreeze() {
  const G0 = SG; if (!G0 || !G0.pose || G0.frozen) return;
  gl.activeTexture(gl.TEXTURE2); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video); gl.activeTexture(gl.TEXTURE0);
  stonePlace(); G0.fLoc.set(G0.loc);
  const asp = video.videoWidth / video.videoHeight; for (let i = 0; i < NV; i++) G0.fUV.set(i < NF ? [G0.uv[i * 2], G0.uv[i * 2 + 1]] : [G0.pos[i * 3] / asp, G0.pos[i * 3 + 1]], i * 2);
  G0.fSkin = G0.skin.slice(); G0.fIris.set(G0.iris);
  // 三角形は、またいでいる区切りの数だけ描く(シェーダが区切りの外を捨てるので、かけらの縁はひびの線と同じ形になる)
  const map = new Map(); G0.cells = []; G0.parts = [];
  for (let t = 0; t < G0.nt; t++) { const q = [0, 1, 2].map((k) => [G0.fLoc[G0.tris[t * 3 + k] * 3], G0.fLoc[G0.tris[t * 3 + k] * 3 + 1]]), seen = [];
   for (const [cx, cy] of [...q, [(q[0][0] + q[1][0] + q[2][0]) / 3, (q[0][1] + q[1][1] + q[2][1]) / 3], [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2], [(q[1][0] + q[2][0]) / 2, (q[1][1] + q[2][1]) / 2], [(q[2][0] + q[0][0]) / 2, (q[2][1] + q[0][1]) / 2]]) {
    const [id, sx, sy, z] = cellOf(cx * CELL, cy * CELL); if (seen.includes(id)) continue; seen.push(id);
    if (!map.has(id)) { const dx = sx - G0.mouthL[0], dy = sy - G0.mouthL[1], dl = Math.hypot(dx, dy) || 1;
      // 口の近くから先に落ちる。外へ押し出されてから下へ
      map.set(id, G0.cells.length); G0.cells.push({ x: sx, y: sy, delay: clamp(dl * 0.38 + Math.random() * 0.16, 0, 0.6), dx: dx / dl * rnd(0.25, 0.7) + rnd(-0.15, 0.15), dy: dy / dl * 0.3 - rnd(0.1, 0.5), spin: rnd(-1.6, 1.6), z }); }
    if (G0.parts.length < G0.nt * 6) G0.parts.push(t, map.get(id));
   } }
  G0.frozen = true;
}
// 頭の向きに合わせて、座標(loc か fLoc)を画面に置く。向きは少しだけならす(石がぶるぶるしないように)
let sm = null;
function stonePlace() {
  const G0 = SG, ps = G0.pose, src = G0.frozen ? G0.fLoc : G0.loc;
  if (!sm || !G0.frozen) sm = { o: ps.o.slice(), r: ps.r.slice(), u: ps.u.slice(), f: ps.f.slice(), w: ps.w };
  else { const e = 0.55; for (const k of ["o", "r", "u", "f"]) for (let i = 0; i < 3; i++) sm[k][i] += (ps[k][i] - sm[k][i]) * e; sm.w += (ps.w - sm.w) * e; }
  const { o, r, u, f, w } = sm;
  for (let i = 0; i < NV; i++) { const x = src[i * 3] * w, y = src[i * 3 + 1] * w, z = src[i * 3 + 2] * w;
    G0.pos[i * 3] = o[0] + r[0] * x + u[0] * y + f[0] * z; G0.pos[i * 3 + 1] = o[1] + r[1] * x + u[1] * y + f[1] * z; G0.pos[i * 3 + 2] = r[2] * x + u[2] * y + f[2] * z; }
  return sm;
}
function stoneDraw(va, ca) {
  const G0 = SG; if (!G0 || !G0.pose || S.p <= 0) return;
  const t0 = performance.now(), ps = stonePlace(), pos = G0.pos, nor = G0.nor, tris = G0.tris, asp = va;
  nor.fill(0);
  for (let t = 0; t < tris.length; t += 3) { const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; if (nz > 0) { nx = -nx; ny = -ny; nz = -nz; }   // カメラの方を向かせる
    for (const k of [a, b, c]) { nor[k] += nx; nor[k + 1] += ny; nor[k + 2] += nz; } }
  const cvx = va > ca ? ca / va : 1, cvy = va > ca ? 1 : va / ca, uv = G0.frozen ? G0.fUV : null, data = G0.data, loc = G0.frozen ? G0.fLoc : G0.loc, att = G0.att;
  const tb = S.phase === "break" ? S.k : -1, split = tb >= 0, np = split ? G0.parts.length / 2 : G0.nt; let n = 0;   // 割れ落ちる間だけ、かけらに分けて描く
  for (let q = 0; q < np; q++) {
    const t = split ? G0.parts[q * 2] : q, c = split ? G0.cells[G0.parts[q * 2 + 1]] : null;
    let ox = 0, oy = 0, cs = 1, sn = 0, px = 0, py = 0, al = c ? c.z : -1, lift = 0;
    if (tb >= 0) { const tt = tb - c.delay;
      if (tt > 0) { const w = ps.w; if (tt > 1.1) continue;   // 画面の下へ落ちきった
        px = ps.o[0] + (ps.r[0] * c.x + ps.u[0] * c.y) * w; py = ps.o[1] + (ps.r[1] * c.x + ps.u[1] * c.y) * w;
        ox = c.dx * w * tt * 0.9; oy = (c.dy * tt * 0.7 + 5.0 * tt * tt) * w; cs = Math.cos(c.spin * tt); sn = Math.sin(c.spin * tt); lift = 0.3; } }
    for (let k = 0; k < 3; k++) { const i = tris[t * 3 + k], i3 = i * 3;
      let x = pos[i3], y = pos[i3 + 1]; if (lift) { const rx = x - px, ry = y - py; x = px + rx * cs - ry * sn + ox; y = py + rx * sn + ry * cs + oy; }
      data[n] = (1 - 2 * x / asp) / cvx; data[n + 1] = (1 - 2 * y) / cvy; data[n + 2] = clamp(pos[i3 + 2] * 1.5 - lift, -0.95, 0.95);
      if (uv) { data[n + 3] = uv[i * 2]; data[n + 4] = uv[i * 2 + 1]; } else { data[n + 3] = pos[i3] / asp; data[n + 4] = pos[i3 + 1]; }
      data[n + 5] = loc[i3]; data[n + 6] = loc[i3 + 1]; data[n + 7] = loc[i3 + 2];
      data[n + 8] = nor[i3]; data[n + 9] = nor[i3 + 1]; data[n + 10] = nor[i3 + 2];
      data[n + 11] = att[i * 4]; data[n + 12] = att[i * 4 + 1]; data[n + 13] = att[i * 4 + 2]; data[n + 14] = att[i * 4 + 3]; data[n + 15] = al; n += FL; }
  }
  const u = G0.u, F = FL * 4, skin = G0.frozen ? G0.fSkin : G0.skin;
  gl.useProgram(G0.pr); gl.bindBuffer(gl.ARRAY_BUFFER, G0.buf); gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n), gl.DYNAMIC_DRAW);
  [[3, 0], [2, 3], [3, 5], [3, 8], [4, 11], [1, 15]].forEach(([size, off], i) => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, size, gl.FLOAT, false, F, off * 4); });
  gl.uniform1i(u.uSrc, G0.frozen ? 2 : 0); gl.uniform1i(u.uJit, 3); gl.uniform2f(u.uPx, 0.03 * ps.w / asp, 0.03 * ps.w); gl.uniform1f(u.uAsp, asp);
  gl.uniform3fv(u.uSkin, skin); gl.uniform3fv(u.uIris, G0.frozen ? G0.fIris : G0.iris); gl.uniform2fv(u.uMouthL, G0.mouthL);
  gl.uniform1f(u.uP, S.p); gl.uniform1f(u.uC, S.phase === "break" ? 1 : S.c);
  gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, n / FL);
  // 元の描き方に戻す
  gl.disable(gl.DEPTH_TEST); for (let i = 1; i < 6; i++) gl.disableVertexAttribArray(i);
  gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  S.ms += (performance.now() - t0 - S.ms) * 0.1;
}
function stoneReset() {
  if (!SG) try { stoneSetup(); } catch (e) { state.err = String(e).slice(0, 160); }
  Object.assign(S, { phase: "soft", p: 0, c: 0, k: 0 }); if (SG) { SG.frozen = false; SG.pose = null; SG.speed = 0; } sm = null;
}
// 石の音(合成): どん(固まった)/ ぴしっ(ひび)/ がらがら(割れ落ちる)
function stoneHit(f0, vol, dec, snap, at = 0) {
  if (!ac || state.soundOff) return;
  const t = ac.currentTime + at, n = Math.round(ac.sampleRate * (dec + 0.05)), b = ac.createBuffer(1, n, ac.sampleRate), ch = b.getChannelData(0), src = ac.createBufferSource();
  for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(0.001, i / (dec * ac.sampleRate));
  const f = ac.createBiquadFilter(), g = ac.createGain(); f.type = snap ? "highpass" : "lowpass"; f.frequency.value = snap ? 1700 : f0 * 4; f.Q.value = snap ? 0.7 : 2.5; g.gain.value = vol;
  src.buffer = b; src.connect(f); f.connect(g); g.connect(master); src.start(t);
  if (!snap) { const o = ac.createOscillator(), og = ac.createGain(); o.frequency.setValueAtTime(f0 * 1.5, t); o.frequency.exponentialRampToValueAtTime(f0, t + dec * 0.6);
    og.gain.setValueAtTime(vol * 0.9, t); og.gain.exponentialRampToValueAtTime(0.0001, t + dec); o.connect(og); og.connect(master); o.start(t); o.stop(t + dec + 0.05); }
}
function stoneKnock() { S.knocks++; stoneHit(82, 0.55, 0.20, false); stoneHit(0, 0.10, 0.02, true); }
function stoneSnap() { S.snaps++; for (let i = 0, at = 0; i < 3; i++, at += rnd(0.012, 0.05)) stoneHit(0, rnd(0.16, 0.30), rnd(0.008, 0.02), true, at); stoneHit(rnd(170, 240), 0.22, 0.06, false, 0.01); }
function stoneFall() { S.falls++; stoneSnap(); for (let i = 0, at = 0.05; i < 13; i++, at += 0.03 + i * 0.012 * rnd(0.6, 1.4)) stoneHit(rnd(70, 230), rnd(0.10, 0.34) * (1 - i / 18), rnd(0.05, 0.11), false, at); }
// 進行: じっとしている → 固まる(p) → 固まった(set)→ 動くとひび(c)→ 割れ落ちる(break)→ はじめへ
function stoneStep(dt, on) {
  if (!SG) return;
  const t = state.t, expr = Math.max(t.open, t.brow, t.smile, t.puck, Math.abs(t.side), t.eye * 0.6, t.winkL * 0.6, t.winkR * 0.6);
  const head = clamp((SG.speed - 0.35) / 1.2), F = state.stoneForce;
  let grind = 0;
  if (F) {            // 確認用: __kao.stoneForce = { p, c } / { fall: true }
    if (F.fall && S.phase === "set") { S.phase = "break"; S.k = 0; stoneFall(); F.fall = false; }
    if (S.phase !== "break") { if (F.p !== undefined) S.p = F.p; if (F.c !== undefined) S.c = F.c; if (S.p >= 1 && !SG.frozen && SG.pose) { stoneFreeze(); S.phase = "set"; } if (S.p < 1) { SG.frozen = false; S.phase = "soft"; } }
  } else if (!on) { if (S.phase !== "soft" || S.p > 0) stoneReset(); }
  else if (S.phase === "soft") {
    const still = expr < 0.18 && head < 0.15;
    if (still && liveT > 1.5) { S.p += dt / 2.6; grind = 1; } else S.p -= dt * (0.5 + 2.5 * Math.max(expr, head));
    S.p = clamp(S.p);
    if (S.p >= 1) { stoneFreeze(); S.phase = "set"; S.c = 0; stoneKnock(); }
  } else if (S.phase === "set") {
    const strain = Math.max(expr, head * 0.45), before = Math.floor(S.c * 4);
    if (strain > 0.2) S.c += dt * strain * 1.15;
    if (S.c >= 1) { S.c = 1; S.phase = "break"; S.k = 0; stoneFall(); } else if (Math.floor(S.c * 4) > before) stoneSnap();
  }
  if (S.phase === "break") { S.k += dt; if (S.k > 1.75) { Object.assign(S, { phase: "soft", p: 0, c: 0, k: 0 }); SG.frozen = false; } }
  if (ac && !state.soundOff && V.stone) { const now = ac.currentTime; V.stone.g.gain.setTargetAtTime(grind * (0.10 + 0.14 * S.p), now, 0.08); V.stone.f.frequency.setTargetAtTime(170 + 190 * S.p, now, 0.1); }
}
// ---------- まわす ----------
const vel = zero();
let prev = performance.now(), frames = 0, fpsT = prev;
// ---------- 字と進行 ----------
const shown = {};
const nb = (s) => s.replace(/ /g, "\u00A0");   // 1 つの言葉の途中では折り返さない(「くちを / あける」「forehead / pump」にならないように)
function put(id, text) { if (shown[id] !== text) { shown[id] = text; $(id).textContent = text; if (id === "cap") $(id).classList.toggle("long", text.length > (EN ? 16 : 9)); } }
let capKey = "", capT = 0, armed = false, holdT = 0, okT = 0, waitT = 0;
function ui(dt, on) {
  if (state.mode === "mirror") { M.nameT = Math.max(0, M.nameT - dt); put("cap", M.nameT > 0 ? W.kinds[M.kind] : ""); put("sub", ""); $("meter").style.transform = "scaleX(0)"; return; }
  if (state.mode === "stone") { put("cap", !on ? W.show : S.phase === "soft" ? W.still : S.phase === "set" ? W.strain : ""); put("sub", ""); $("meter").style.transform = "scaleX(0)"; return; }
  if (state.mode === "practice") return practice(dt, on);
  if (state.mode === "game") return game(dt, on);
  // あそぶ: いちばん強く効いている型を 1 行で(2 つまで)。ちらつかないよう 0.8 秒は保つ
  const act = CH.filter((k) => Math.abs(state.t[k]) > 0.3 && on).sort((a, b) => Math.abs(state.t[b]) - Math.abs(state.t[a]));
  const key = [...new Set(act.map((k) => nb(NAMES[k])))].slice(0, 2).join(W.and);
  capT += dt; if (key !== capKey && (capT > 0.8 || !capKey)) { capKey = key; capT = 0; }
  // 何もしていない時の字: ふだんは かおを うごかす。しばらく遊んでも一度も土になっていなければ じっと してみる(1 回の起動で土になるまで)。
  // 土の間は何も出さない(型の名前だけ)。ちがう かおを する は、この端末で はじめて土になった 1 回だけ。
  // 12 秒ひびが増えなければ、まだ数えていない動きを 1 つ、6 秒だけ言う(土になるたびに 1 回まで)
  const idle = K.phase === "stone" || K.phase === "turning" ? (K.tipT > 0 ? nb(stoneTip()) : K.tell ? W.other : "") : !turnedOnce && K.playT > 15 ? W.tryStill : W.move;
  put("cap", !on ? W.show : capKey || idle); put("sub", "");
  $("meter").style.transform = "scaleX(0)";
}
function practice(dt, on) {
  const [keys, todo, name] = STEPS[state.step], main = keys[keys.length - 1] === "tongue" ? ["tongue"] : keys;
  const val = Math.max(...main.map((k) => Math.abs(state.m[k])));
  if (okT > 0) { okT -= dt; if (okT <= 0) nextStep(true); return; }
  put("cap", `${state.step + 1}/${STEPS.length}  ${todo}`);
  waitT += dt; put("sub", !on ? W.show : waitT > 6 ? W.stuck(name) : W.becomes(name));
  $("meter").style.transform = `scaleX(${on ? clamp(val / 0.5).toFixed(3) : 0})`;
  if (!on) { holdT = 0; return; }
  if (val < 0.2) armed = true;                       // いったん戻してから(張り付いた値で勝手に進まないように)
  holdT = armed && val >= 0.5 ? holdT + dt : 0;
  if (holdT > 0.3) { okT = 1.3; put("cap", W.nice); put("sub", name); ping(4); setTimeout(() => ping(7), 110); }
}
// ---------- 3コマ: 3 つの動きを 5 秒ずつ。前のコマの変形は残るので、だんだん変になる。反応しなくても 15 秒で必ず終わる
const POOL = [[0, 4, 3, 5, 7], [6, 2, 3, 0], [1, 8, 2]];   // 1 コマ目は小さい動き、3 コマ目は大きい動き(オチ)。舌は判定が怪しいので入れない
const G = state.game = { moves: [], keys: [], phase: "pre", t: 0, koma: -1, hits: [], hold: 0 };
function pickMoves() {
  const m = []; for (const pool of POOL) { const c = pool.filter((i) => !m.includes(i) && !(G.moves.includes(i) && pool.length > 2)); m.push(c[Math.floor(Math.random() * c.length)]); }
  G.moves = m; G.keys = m.map((i) => STEPS[i][0]);
}
function gamePre() { G.phase = "pre"; G.t = 0; G.koma = -1; G.hits = []; state.only = null; $("bM").style.visibility = $("bR").style.visibility = "visible"; $("sum").style.display = "none"; }
function game(dt, on) {
  const todo = (k) => STEPS[G.moves[k]][1];
  $("meter").style.transform = "scaleX(0)";
  if (G.phase === "pre") { put("cap", W.panels); put("sub", G.moves.map((_, k) => nb(todo(k))).join(" → ")); return; }
  G.t += dt;
  if (G.phase === "count") {
    const n = 3 - Math.floor(G.t); if (n <= 0) { G.phase = "play"; G.t = 0; } else { if (shown.cap !== String(n)) blip(440); put("cap", String(n)); put("sub", W.first + todo(0)); return; }
  }
  if (G.phase !== "play") return;
  const k = Math.floor(G.t / 5);
  if (k >= 3) return gameEnd();
  if (k !== G.koma) { G.koma = k; G.hold = 0; blip(k === 2 ? 880 : 660); state.only = G.keys.slice(0, k + 1).flat(); }
  const val = Math.max(...G.keys[k].map((key) => Math.abs(state.m[key])));   // ○ は「動かした量」で見る(効きぐあいを弱めても取りやすさは同じ)
  G.hold = on && val >= 0.5 ? G.hold + dt : 0;
  if (!G.hits[k] && G.hold > 0.2) { G.hits[k] = true; ping(3 + k * 2); setTimeout(() => ping(6 + k * 2), 110); }
  put("cap", W.panel(k + 1) + todo(k) + (G.hits[k] ? " " + W.hit : "")); put("sub", !on ? W.show : W.becomes(STEPS[G.moves[k]][2]));
  $("meter").style.transform = `scaleX(${(1 - (G.t % 5) / 5).toFixed(3)})`;
}
function gameEnd() {
  G.phase = "end"; state.only = ["none"];
  $("sumHead").textContent = W.ofPanels(G.hits.filter(Boolean).length);
  $("sumList").innerHTML = G.moves.map((i, k) => `<li><span>${W.panel(k + 1)}${STEPS[i][1]}</span><span>${G.hits[k] ? W.hit : W.miss}</span></li>`).join("");
  $("sum").style.display = "flex";
}
function setStep(i) { state.step = i; state.only = STEPS[i][0]; armed = false; holdT = 0; okT = 0; waitT = 0; }
function nextStep(ok) {
  state.results[state.step] = ok;
  if (state.step + 1 < STEPS.length) return setStep(state.step + 1);
  // おわり: できたものの一覧
  const n = state.results.filter(Boolean).length;
  $("sumHead").textContent = W.done(n, STEPS.length);
  $("sumList").innerHTML = STEPS.map((st, i) => `<li><span>${st[1]}</span><span>${state.results[i] ? W.hit : W.skipped}</span></li>`).join("");
  $("sum").style.display = "flex"; state.only = ["none"];
}
// ---------- こわれた かがみ: 「かえる」で ボコボコ → カーブミラー → ポテチ。へこみは種類が出るたびに作り直す(iOS の AppModel.shuffleDents と同じ範囲)
const M = state.mirror = { kind: 2, dents: [], nameT: 0 };
const rnd = (a, b) => a + Math.random() * (b - a);
function shuffleDents() {
  const forced = parseInt(params.get("mirror"), 10);   // ?mirror=0|1|2 で種類を固定(確認用)
  M.kind = forced >= 0 && forced <= 2 ? forced : (M.kind + 1) % 3;
  M.nameT = 1.6; crack();
  if (M.kind === 1) {        // カーブミラー: [0] はガラスの丸(描く時に写真から決める)、[1..7] = 鏡の面のへこみ。小さく強い 3 個+中くらい 4 個
    M.dents = [[0, 0, 0, 0]].concat(Array.from({ length: 7 }, (_, i) => {
      const a = i * 0.9 + rnd(0, 0.9), d = rnd(0.08, 0.80), k = Math.random() < 0.65 ? -rnd(0.7, 0.95) : rnd(0.5, 0.75);
      return [Math.cos(a) * d, Math.sin(a) * d, i < 3 ? rnd(0.24, 0.34) : rnd(0.36, 0.55), k];
    }));
  } else if (M.kind === 2) { // ポテチ: たわむ向きと強さ、ひだの細かさと深さ
    M.dents = [[rnd(-0.6, 0.6), (Math.random() < 0.5 ? 1 : -1) * rnd(0.7, 1.0), rnd(34, 52), rnd(0.006, 0.012)]];
  } else {                   // ボコボコ: 12 個(へこみ多め)。8 個は顔が来る真ん中あたりに集める
    M.dents = Array.from({ length: 12 }, (_, i) => {
      const k = Math.random() < 0.6 ? rnd(-0.9, -0.5) : rnd(0.4, 0.7), r = rnd(0.07, 0.15);
      return i < 8 ? [rnd(0.22, 0.78), rnd(0.22, 0.68), r, k] : [rnd(0.08, 0.92), rnd(0.10, 0.90), r, k];
    });
  }
  if (M.kind === 1) loadMirror();
}
const dentBuf = new Float32Array(48);
function mirrorUniforms(ca) {   // ca = 画面の 横/縦
  dentBuf.fill(0);
  M.dents.forEach((d, i) => { dentBuf.set(d, i * 4); if (M.kind === 0) dentBuf[i * 4] = d[0] * ca; });
  // 写真を画面いっぱいに切り抜いて映す(cover): 画面 = 写真 × (w, h) + ずれ
  const cw = canvas.width, ch = canvas.height, sc = Math.max(cw / PHOTO.w, ch / PHOTO.h), w = PHOTO.w * sc / cw, h = PHOTO.h * sc / ch, ox = (1 - w) / 2, oy = (1 - h) / 2;
  if (M.kind === 1) dentBuf.set([(PHOTO.cx * w + ox) * ca, PHOTO.cy * h + oy, PHOTO.r * h, 0]);
  gl.uniform4fv(U.uDents, dentBuf); gl.uniform4f(U.uPhoto, ox, oy, w, h); gl.uniform1f(U.uVA, ca);
}
// 下のボタン: 左は空き(はじめの画面へは左上の「もどる」)。あそぶ = 右に 3コマ / 3コマ = はじめる・かえる / かがみ = かえる
function enter(mode) {
  state.mode = mode; $("sum").style.display = "none"; capKey = ""; state.results = []; $("bL").style.visibility = $("bM").style.visibility = "hidden"; $("bR").style.visibility = "visible";
  if (mode === "practice") { setStep(0); $("bR").textContent = W.skip; }   // 入口は外した(iOS と同じ)。3コマがお題の言葉を使うので進行は残してある
  else if (mode === "game") { pickMoves(); gamePre(); $("bM").textContent = W.start; $("bR").textContent = W.shuffle; }
  else if (mode === "stone") { state.only = []; stoneReset(); $("bR").style.visibility = "hidden"; }   // 表情の変形と音は切る。下のボタンは無い
  else if (mode === "mirror") { state.only = []; M.kind = 2; shuffleDents(); $("bR").textContent = W.shuffle; }   // 表情の変形と音は切る
  else { state.only = null; $("bR").textContent = W.game; }
  skinReset(mode === "free" && params.get("skin") === "stone");   // 石は あそぶ の中だけ。3コマ・かがみ に入れば消える(?skin=stone = はじめから石。確認用)
}
$("bM").addEventListener("click", () => { if (state.mode === "game" && G.phase === "pre") { G.phase = "count"; G.t = 0; $("bM").style.visibility = $("bR").style.visibility = "hidden"; } });
$("bR").addEventListener("click", () => { if (state.mode === "practice") { if (okT <= 0) nextStep(false); } else if (state.mode === "game") { if (G.phase === "pre") pickMoves(); } else if (state.mode === "mirror") shuffleDents(); else enter("game"); });
$("back").addEventListener("click", toStart);
$("sumFree").addEventListener("click", () => enter("free"));
$("sumAgain").addEventListener("click", () => { if (state.mode === "game") gamePre(); else enter("practice"); });
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  if (state.phase !== "live") return;
  const mirror = state.mode === "mirror";
  if (!mirror) try { track(now); } catch (e) { state.err = String(e).slice(0, 160); }
  if (now - lastSeen > 500) state.face = false;   // 映像が止まった時に鳴りっぱなしにしない
  if (state.force) { Object.assign(state.t, zero(), state.force); Object.assign(state.m, zero(), state.force); }
  if (state.mode === "stone") stoneStep(dt, state.face || !!state.force);
  if (state.only) for (const k of CH) if (!state.only.includes(k)) state.t[k] = 0;   // れんしゅう中は、いまの 1 手だけ効かせる
  // ばね: 行きすぎて戻る(びよん)
  const on = state.face || state.force;
  for (const k of CH) {
    const target = on ? state.t[k] : 0, signed = k === "tilt" || k === "side";
    vel[k] += ((target - state.v[k]) * 260 - vel[k] * 17) * dt;
    state.v[k] = clamp(state.v[k] + vel[k] * dt, signed ? -1.15 : -0.1, 1.15);
  }
  updateSound(dt);
  if (state.mode === "free") skinStep(dt, on);
  K.amt += ((state.mode === "free" && state.face && K.turn > 0.001 ? 1 : 0) - K.amt) * Math.min(1, dt * 7);
  if (K.amt > 0.001) skinMask();
  hairStep(now, dt);
  resize();
  if (video.readyState >= 2) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
  const va = video.videoWidth / Math.max(1, video.videoHeight), ca = canvas.width / canvas.height, v = state.v, pos = (x) => Math.max(0, x);
  gl.uniform2f(U.uCover, va > ca ? ca / va : 1, va > ca ? 1 : va / ca); gl.uniform1f(U.uAspect, va);
  for (const [n, k] of [["uOpen", "open"], ["uBrow", "brow"], ["uEye", "eye"], ["uPuck", "puck"], ["uSmile", "smile"], ["uWinkL", "winkL"], ["uWinkR", "winkR"], ["uNear", "near"], ["uTongue", "tongue"]]) gl.uniform1f(U[n], pos(v[k]));
  gl.uniform1f(U.uSide, v.side); gl.uniform2f(U.uSlide, state.slide[0] * v.tilt, state.slide[1] * v.tilt);
  for (const [n, k] of [["uEyeL", "eyeL"], ["uEyeR", "eyeR"], ["uFore", "fore"], ["uNose", "nose"], ["uMouth", "mouth"], ["uChin", "chin"]]) gl.uniform2f(U[n], pts[k][0], pts[k][1]);
  gl.uniform1f(U.uW, pts.w);
  gl.uniform1f(U.uStone, K.amt); gl.uniform3fv(U.uSkinC, K.skin); gl.uniform1f(U.uHairOn, H.on); gl.uniform1f(U.uPxW, pts.w * canvas.height / (va > ca ? 1 : va / ca)); gl.uniform1f(U.uTurn, K.turn); gl.uniform1f(U.uCrack, K.crack); gl.uniform1f(U.uBreak, K.phase === "breaking" ? K.brk : 0);
  gl.uniform1f(U.uKind, mirror ? M.kind : -1); if (mirror) mirrorUniforms(ca);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  if (K.bits.length) bitsDraw(dt, va, ca);
  if (state.mode === "stone" && state.face) stoneDraw(va, ca);
  frames++; if (now - fpsT > 1000) { state.fps = frames; frames = 0; fpsT = now; }
  ui(dt, on);
  if (params.has("test")) { $("kdebug").style.display = "block";
    // 型ごと: もとの値(0〜1)> あそび を通った後の「動かした量」> 効きぐあいを掛けた「出る強さ」。その下に ふだんの値(覚えた基準)、じっと の秒数と、最後に止めた理由
    $("kdebug").textContent = `fps ${state.fps} face ${state.face} yaw ${(state.yaw || 0).toFixed(2)}\n` + CH.map((k) => `${k} ${state.dbg[k] ? state.dbg[k][0].toFixed(2) + " > " + state.m[k].toFixed(2) + " > " : ""}${state.t[k].toFixed(2)}`).join("\n")
      + `\nbase ${Object.entries(bases).map(([k, v], i) => (i % 3 ? " " : "\n ") + k + " " + v.toFixed(2)).join("")}\nstill ${K.still.toFixed(1)}/${STONE_AFTER} ${K.phase} speed ${K.speed.toFixed(2)}\nwhy ${K.why || ""}\nkinds ${K.kinds.length} hair ${H.has ? "on" : H.failed ? "failed" : H.loading ? "loading" : "-"}\n${state.err}`; }
}
requestAnimationFrame(frame);
// 字は使う文字だけ先に読んでおく(途中で別の字に化けないように)
const FV = ["k", "y", "h"].includes(params.get("f")) ? params.get("f") : "s";
document.body.classList.add("f" + FV);
const FACE = { s: '24px "Slackside One"', k: '24px "Zen Kurenaido"', y: '24px "Yomogi"', h: '24px "Hachi Maru Pop"' }[FV];
if (EN && document.fonts) document.fonts.load('24px "Just Me Again Down Here"', "waowao").catch(() => {});
if (document.fonts) document.fonts.load(FACE, Object.values(NAMES).join("") + STEPS.map((t) => t[1]).join("") + Object.values(W).filter((v) => typeof v === "string").join("") + W.kinds.join("") + "0123456789/→○×になるコマめちゅうできた").catch(() => {});

async function makeLandmarker(delegate) {
  const files = await FilesetResolver.forVisionTasks(MP);
  return FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true });
}
const ENTRIES = ["go", "goGame", "goMirror", "goSet"];
let busy = false;
async function start(mode) {
  if (busy || state.phase === "live") return;
  const msg = $("msg"); busy = true; for (const id of ENTRIES) $(id).disabled = true;
  try {
    // 音はタップの中で起こす(iOS)。「おと: なし」の時は鳴らす仕組みごと起こさない
    if (!state.soundOff) { if (!ac) setupAudio(); hush(); ac.resume(); }
    msg.textContent = W.cam;
    if (!video.srcObject) video.srcObject = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } });
    await video.play();
    // かがみは顔の位置を使わないので、顔を見つける仕組みは読まない
    if (mode !== "mirror" && !landmarker) { msg.textContent = W.prep; try { landmarker = await makeLandmarker("GPU"); } catch (e) { landmarker = await makeLandmarker("CPU"); } }
    msg.textContent = ""; show("hud"); enter(mode); state.phase = "live";
  } catch (e) {
    state.err = String(e).slice(0, 160); stopCamera(); if (ac) ac.suspend();
    msg.textContent = e && e.name === "NotAllowedError" ? W.denied : W.fail;
  }
  busy = false; for (const id of ENTRIES) $(id).disabled = false;
}
function show(id) { for (const k of ["start", "settings", "hud", "sum"]) $(k).style.display = k !== id ? "none" : k === "hud" ? "block" : "flex"; }
function stopCamera() { const s = video.srcObject; if (s) { for (const t of s.getTracks()) t.stop(); video.srcObject = null; } }
// 左上の「もどる」: はじめの画面へ。カメラと音を止め、覚えた「ふだんの顔」も忘れる(次は別の人かもしれない)
function toStart() {
  state.phase = "start"; state.only = null; state.face = false; skinReset(false); stopCamera(); if (ac) ac.suspend();
  for (const k of CH) state.t[k] = state.m[k] = state.v[k] = vel[k] = last[k] = move[k] = 0;
  for (const k of Object.keys(bases)) delete bases[k];
  stoneReset(); liveT = 0; rollBase = null; sideBase = null; blinkT = 9; wBase = 0; for (const k of Object.keys(gOn)) { gOn[k] = false; gT[k] = 0; } lastVideoTime = -1; winkT = [0, 0]; tongueT = 0; G.phase = "pre";
  $("msg").textContent = ""; show("start");
}
function soundLabel() { $("setSound").textContent = state.soundOff ? W.soundOff : W.soundOn; }
$("go").addEventListener("click", () => start("free"));
$("goGame").addEventListener("click", () => start("game"));
$("goMirror").addEventListener("click", () => start("mirror"));
// 石の肌に入口は無い(あそぶ で じっとしていると石になる)。前の試作(固まって割れる石像)も入口なし: __kao.start("stone") でだけ開く
$("goSet").addEventListener("click", () => show("settings"));
$("setBack").addEventListener("click", () => show("start"));
$("setSound").addEventListener("click", () => { state.soundOff = !state.soundOff; try { localStorage.setItem("soundOff", state.soundOff ? "1" : "0"); } catch (e) {} soundLabel(); });
soundLabel();
if (params.get("screen") === "settings") show("settings");   // 確認用
// 確認用の入口: __kao.start("free" | "game" | "mirror" | "practice")、__kao.toStart()、__kao.setKind(0〜2)、__kao.audio()
Object.assign(state, { start, toStart, setKind: (k) => { M.kind = (k + 2) % 3; shuffleDents(); }, audio: () => (ac ? ac.state : "none") });
// 別のアプリから戻った時に音が止まったままになることがある(iOS)。画面を触れば戻る
const wantSound = () => state.phase === "live" && !state.soundOff;
document.addEventListener("visibilitychange", () => { if (ac) document.hidden || !wantSound() ? ac.suspend() : ac.resume(); });
document.addEventListener("pointerdown", () => { if (ac && ac.state !== "running" && wantSound()) ac.resume(); if (state.phase === "live" && video.paused) video.play().catch(() => {}); });
