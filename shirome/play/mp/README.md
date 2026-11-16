# 顔検出の部品(MediaPipe Tasks Vision)
見守りモードで「見ている人の顔の位置」を取るために使う。映像はページの中だけで処理し、どこにも送らない。
- `vision_bundle.mjs` `wasm/vision_wasm_internal.{js,wasm}`: npm `@mediapipe/tasks-vision` 1.2.3(Apache-2.0、Google)をそのまま
- `blaze_face_short_range.tflite`: https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/ (Apache-2.0)
- 取得日 2026-11-16(ユウキさんの OK あり)。外部の CDN からは読まず、ここに置いた物だけを使う
