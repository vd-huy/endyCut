# RE: Giảm nhiễu (Noise Reduction) & Giảm rung (Stabilization) của CapCut

Kết quả mổ xẻ CapCut Desktop **9.6.0.4097** (Windows) bằng phân tích tĩnh
(leanrea), và cách EndyCut tái hiện 2 chức năng đó cục bộ.

Mục tiêu phân tích: `%LOCALAPPDATA%\CapCut\Apps\9.6.0.4097\` — ứng dụng Qt6 C++
(`Qt6Core.dll`…), core dựng video nằm trong `videoeditor.dll` (namespace C++
`lvve`), hiệu ứng âm thanh trong `audioeffect.dll`, UI trong `CefCreator.dll`.
Draft mẫu: `%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft\<id>\draft_content.json`.

Ký hiệu: **seen** = đọc trực tiếp trong binary/draft (trích dẫn file/symbol);
**inferred** = suy luận từ bằng chứng; **unknown** = không tìm thấy.

---

## 1. Giảm nhiễu (Noise Reduction)

### Bằng chứng từ CapCut

- **seen** — `draft_content.json` có mảng `realtime_denoises` cấp dự án; denoise
  gắn vào cả `SegmentAudio` lẫn `SegmentVideo`
  (`?get_realtime_denoise@SegmentAudio@lvve…` trong `videoeditor.dll`).
- **seen** — class draft `MaterialRealtimeDenoise`
  (`videoeditor\lyra\generated\draft\material_realtime_denoise.cpp`) với các
  key JSON: `is_denoise` (bool), `denoise_mode` (số ≥ 0), `denoise_rate`
  (số), `sami_name`, `sami_version`, `sami_type`. Thông báo validate trong
  binary: *"denoise_mode must be non-negative and denoise_rate must be in
  [0, 1]"*.
- **seen** — engine là **SAMI** (ByteDance speech/audio middleware) trong
  `audioeffect.dll`: `SAMIDenoiseV2`
  (`sami_core_executor_denoise_v2.cpp`), model neural
  `tcn_denoise_espresso_44k_model`, `unet_denoise_speech/music_espresso_44k/16k`,
  `unet_denoise_dereverb_espresso_44k`; tham số engine: `denoisetype`,
  `denoiserate`, `denoisemode`; các biến thể `Denoise_V3_Music / _Speech /
  _DeHowling / _DeReverb`.
- **seen** — model UNet nằm sẵn trong app:
  `resources/audiosami/unet_denoise_44k_music_model_v1.0.model`.
- **seen** — chuỗi UI trong `CefCreator.dll`: "Noise reduction successful",
  "Noise reduction canceled".
- **unknown** — không dump được đồ thị model neural (file `.model` là định dạng
  đóng của SAMI) và không thấy mức chi tiết của `denoise_mode` ngoài "số
  nguyên ≥ 0".

Cơ chế **inferred**: khi bật "Giảm nhiễu", CapCut tạo một
`MaterialRealtimeDenoise` trên segment, `denoise_rate` là thanh cường độ 0–100%,
`denoise_mode` chọn biến thể (thường 0 = tiêu chuẩn), render/preview chạy qua
SAMI neural denoise theo thời gian thực.

### Tái hiện trong EndyCut

`src/renderer/src/core/audio/denoise.ts` — spectral gating thay cho neural net,
nhưng giữ nguyên mô hình điều khiển của CapCut:

| CapCut (draft) | EndyCut |
| --- | --- |
| `is_denoise` | `clip.denoise.enabled` |
| `denoise_rate` ∈ [0,1] | `clip.denoise.rate` (slider 0–100%) |
| `denoise_mode` | `clip.denoise.mode`: `standard` \| `voice` \| `music` |
| SAMI neural denoise (44k/16k model) | STFT 1024/hop 256, sàn nhiễu minima-controlled, gain kiểu Wiener `max(floor, (|X|−k·noise)/|X|)` |

- `denoiseBuffer()` — xử lý nguyên buffer khi **xuất** (một pass liên tục nên
  sàn nhiễu liền mạch; stereo dùng phổ joint max để giữ pha).
- `DENOISE_WORKLET_SRC` + `ensureDenoiseNode()` — **preview** thời gian thực qua
  AudioWorklet (FFT 512/hop 128), nối vào chuỗi WebAudio như pitch shifter.
- `mode` ảnh hưởng DSP: `voice` bảo vệ dải formant 180 Hz–4 kHz và lọc mạnh hơn
  trên 6.8 kHz; `music` giảm over-subtraction (k×0.7) và tăng sàn để giữ hòa
  âm; `tau` (hằng số thời gian rise của sàn nhiễu) bảo nội dung sustain không
  bị "ăn" sau vài trăm ms.
- Rõ ràng đã biết (giới hạn): tiếng ồn **xung khắc/đột biến** (tiếng gõ, phấn
  khích) và nhạc nền trộn sẵn không tách được bằng spectral gating — CapCut dùng
  model neural nên xử lý tốt hơn ở các trường hợp này.

## 2. Giảm rung (Video Stabilization)

### Bằng chứng từ CapCut

- **seen** — `videoeditor.dll`: class draft `Stable`
  (`lyra/generated/draft/stable.cpp`) với `stable_level` (int) và
  `matrix_path`; gắn vào `SegmentVideo` (`?get_stable@SegmentVideo@lvve…`,
  `?set_stable_level@Stable@lvve…`). Lua glue trong binary:
  `local stable_level = stable["stable_level"]` + `if stable_level ~= 0 then` →
  **level 0 = tắt**.
- **seen** — service riêng: `VideoStableService`
  (`lyra/service/video_stable/video_stable_service.cpp`) và
  `VideoStableAlgorithm` (`lyra/ve_wrapper/algorithm/video_stable/`). Cache
  kết quả phân tích ra file: *"video_stable matrix file"*, chứa `pts_list` +
  `matrix`, thư mục cache `Resources/video_stable/`. Tham số: *"invalid
  video_stable level/config/time range"*, *"video_stable level 0 is only
  valid when disabling"*.
- **seen** — có chế độ khóa đối tượng: `ObjectLocked` +
  `stable_object_box` (`?get_stable_object_box@ObjectLocked@lvve…`).
- **seen** — UI (`CefCreator.dll`): "Video stabilization completed", "The
  stabilized effect switched", "Removing background and stabilizing...".
- **unknown** — thuật toán chính xác bên trong `VideoStableAlgorithm` (native,
  không có symbol chi tiết cho từng bước); số cấp level tối đa trong UI.

Cơ chế **inferred**: bật stabilization → chạy một task phân tích toàn clip →
sinh **ma trận biến đổi mỗi frame** (2D affine/homography) → lưu cache (`matrix_path`)
→ render bù ngược transform theo `pts_list`, crop-in để che viền; `stable_level`
điều khiển độ mạnh làm mượt.

### Tái hiện trong EndyCut

`src/renderer/src/core/media/stabilization.ts` — cùng kiến trúc 3 lớp:

1. **Phân tích** (`analyzeStabilization`): giải mã frame giãn cách ~20 Hz (tối
   đa 600 mẫu) qua mediabunny, hạ về ảnh xám 96 px, ước lượng chuyển động toàn
   cục từng cặp frame bằng block-matching SAD (lưới 6×4, tìm kiếm ±6 px,
   tie-break về 0) + khớp góc quay nhỏ theo least-squares trên residual các
   block; tích lũy thành quỹ đạo camera thô.
2. **Làm mượt** (`buildStabilizationData`): moving average giữa, bán kính tăng
   theo `level` 1..4 (≈0.2–0.8 s); `corrections = smoothed − raw`; `zoom` là
   crop-in nhỏ nhất che viền (tính từ biên độ correction lớn nhất, trần 1.4×).
3. **Render** (`frameRenderer.ts` → `drawImageClip`): nội dung được trượt/ quay
   ngược theo `sampleCorrection()` tại thời điểm source hiện tại, nhân thêm
   `zoom`.

Cache theo `assetId|inPoint|span|level` (đóng vai trò `matrix_path` của
CapCut), có dedupe task đang chạy (`inFlight`), kích hoạt lười: preview tự
kick-off khi vẽ, export `await ensureStabilization()` trước khi render frame.
Xóa asset thì drop cache tương ứng (`dropStabilizationForAsset`).

| CapCut (draft) | EndyCut |
| --- | --- |
| `stable` trên `SegmentVideo` | `clip.stabilization` |
| `stable_level` int (0 = tắt) | `level` 1..4 (`enabled` = on/off) |
| `matrix_path` + `pts_list`/`matrix` | cache trong bộ nhớ + `times`/`corrections` |
| ObjectLocked (`stable_object_box`) | chưa tái hiện (không có khái niệm chọn đối tượng) |

Giới hạn đã biết: ước lượng translate + roll nhỏ (không có homography/parallax
3 trục), tốc độ phân tích phụ thuộc độ dài clip.

---

## 3. Bảng ánh xạ schema draft CapCut → EndyCut

```jsonc
// CapCut draft_content.json (schema quan sát được qua lyve/lyra)
"realtime_denoises": [{ "is_denoise": true, "denoise_mode": 0, "denoise_rate": 0.8, "sami_name": "…" }]
// SegmentVideo:
"stable": { "stable_level": 2, "matrix_path": "…/video_stable/….bin" }
```

```ts
// EndyCut — src/shared/document.ts
clip.denoise        // { enabled, rate: 0..1, mode: 'standard' | 'voice' | 'music' }
clip.stabilization  // { enabled, level: 1..4 }
```

## 4. Phương pháp & công cụ

- Định vị cài đặt: `%LOCALAPPDATA%\CapCut` → `Apps/9.6.0.4097`.
- Quét chuỗi trên binary: `rg -a -o` quanh các needle `denoise`, `stabil`,
  `stable_level`, `realtime_denoise` trên `videoeditor.dll`, `audioeffect.dll`,
  `CefCreator.dll` (đủ để đọc C++ symbol MSVC mangled + resource string).
- Đọc draft thật `User Data/Projects/com.lveditor.draft/1025/draft_content.json`
  để thấy các key schema cấp dự án.
- Không chạy CapCut, không hook runtime — toàn bộ là phân tích tĩnh.
