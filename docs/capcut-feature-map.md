# Bản đồ chức năng: CapCut 9.6 (desktop) ↔ CutClone

Kết quả phân tích app CapCut đã cài trên máy (`C:\Users\HuyEndy\AppData\Local\CapCut`, phiên bản
9.6.0.4097) bằng bộ công cụ REA (`../rea`) + khảo sát cấu trúc cài đặt, đối chiếu với trạng thái
hiện tại của CutClone.

Phương pháp: REA `analyze` / `analyze-javascript-application` (2.343 artifact được inventoried —
phân tích đầy đủ bị timeout do khối lượng), đọc tên thành phần nhị phân (DLL), tên thư mục tài
nguyên và cấu hình mô tả thuật toán. Chỉ dùng kết quả ở mức **danh mục chức năng và hành vi**;
không sao chép mã nguồn, tài nguyên, font, LUT hay material nào của CapCut vào dự án. Toàn bộ
triển khai trong CutClone là code gốc.

## Cấu trúc app CapCut quan sát được

- Native core C++ (Qt6 + videoeditor.dll + EffectPlatform.dll + FusionUI.dll), UI chạy trên Lynx
  (`lynx_core.js`) + CEF + QuickJS cache.
- Thuật toán AI nội bộ: `Resources/AlgorithmCache`, `Chroma/` (khóa màu + matting
  "sexiangkoutu"), `Curves/` (đồ thị màu), `MixMode/` (chế độ pha trộn), `PrimaryWheel/`,
  `LogWheel/` (bánh xe màu), `FaceReshape_V3` (làm đẹp), `matting*` (tách nền), `rnnoise` (giảm ồn
  ML), `SceneEditDetection` (nhận diện phân cảnh), `lvop_intelligent_crop` (crop thông minh),
  `digital_human`, `tts/`, `lut/`, `speechsdk.dll` (TTS/STT), `smart_cut.ofx.bundle` (Smart Cut).

## Ma trận chức năng

Legend: ✅ đã có · 🟡 có bản đơn giản/hạn chế · ❌ chưa có (ghi rõ lý do nếu ngoài tầm với)

### Quản lý dự án
| CapCut | CutClone | Ghi chú |
|---|---|---|
| Trang chủ: dự án nháp/gần đây, dự án mới | ✅ | HomeModal — dự án mới, mở file, danh sách recent (userData/recent-projects.json) |
| Cloud projects / đồng bộ | ❌ | Cần tài khoản cloud của dịch vụ — ngoài phạm vi clone offline |
| Tự động lưu kháp phục | ✅ | autosave.json + prompt khôi phục |

### Media
| CapCut | CutClone | Ghi chú |
|---|---|---|
| Nhập media (picker + kéo thả) | ✅ | Ảnh đọc qua IPC bytes → blob image + thumbnail (không bị canvas tainted); video/audio hiện ngay trong thư viện rồi mới phân tích waveform/beats ở nền (`analyzeAssetAudio`) |
| Thư viện với tìm kiếm | ✅ | Tìm theo tên file |
| Tỷ lệ khung hình dự án 16:9/9:16/1:1/4:3/21:9 | ✅ | |
| Ghi màn hình | ✅ | RecordModal — desktopCapturer → WebM → nhập thư viện |
| Ghi camera | ✅ | RecordModal |
| Thu giọng nói (voiceover) | ✅ | RecordModal |
| Thư viện stock online (audio/video) | ❌ | Yêu cầu dịch vụ trực tuyến có bản quyền |
| Quản lý không gian đĩa | ❌ | |

### Timeline
| CapCut | CutClone | Ghi chú |
|---|---|---|
| Multi-track (video/audio/text) | ✅ | |
| Kéo/thả, trim 2 đầu, tách (split), nhân đôi | ✅ | |
| Snap + hướng dẫn từ trường | ✅ | |
| Zoom (Ctrl+lăn) | ✅ | |
| Xóa liên hoàn (ripple delete) | ✅ | Menu chuột phải |
| Chọn nhiều clip (Shift) | ✅ | |
| Copy/paste (Ctrl+C/V), Ctrl+D | ✅ | |
| Markers (đánh dấu) | ✅ | Nút cờ + phím M + menu chuột phải trên ruler |
| Nhóm clip, đóng băng khung | ✅/❌ | Đóng băng khung ✅ (Inspector → "Đóng băng khung"); nhóm clip ❌ |
| Reverse clip | ❌ | Cần decode toàn bộ + lưu buffer frame — nặng cho pipeline WebCodecs hiện tại |
| Nhận diện phân cảnh | ❌ | AI model riêng của CapCut (`SceneEditDetection`) |

### Biến đổi & màu
| CapCut | CutClone | Ghi chú |
|---|---|---|
| Scale/X/Y/Xoay/Opacity/Flip | ✅ | |
| Crop (tự do + tỷ lệ) | ✅ | Slider 4 cạnh + preset 1:1/9:16/4:5/16:9 |
| Mặt nạ hình dạng (mask) + feather + invert | ✅ | Tròn/vuông/tam giác/sao/tim/dải — canvas path |
| Khóa màu xanh (chroma key) + khử lem | ✅ | Per-pixel trên nguồn, cache theo frame |
| Chế độ pha trộn (MixMode) | ✅ | 16 blend mode canvas |
| Điều chỉnh: sáng/tương phản/bão hòa/nhiệt độ | ✅ | |
| Phơi sáng/sắc độ/diểm sáng/điểm tối | ✅ | Xấp xỉ CSS filter |
| Đồ thị đường cong RGB (Curves) | ❌ | Cần UI kéo điểm bezier; hiện chỉ có slider |
| Bánh xe màu Primary/Log | ❌ | |
| LUT (.cube import) | ❌ | Cần WebGL 3D texture cho hiệu năng đủ dùng |
| Keyframe + easing | ✅ | scale/x/y/rotation/opacity/volume; linear/ease-in/out/in-out/hold |
| Keyframe hiển thị trên timeline | ❌ | Hiện quản lý trong Inspector |

### Hiệu ứng / chuyển cảnh / filter
| CapCut | CutClone | Ghi chú |
|---|---|---|
| Thư viện hiệu ứng theo danh mục | ✅ | 24 hiệu ứng, 13 kind render thật, 4 danh mục |
| Thumbnail hiệu ứng động (GIF preview) | ✅ | Bake GIF 240×160 bằng GifEncoder trong app: `activeEffects` + `drawEffectPasses` trên cảnh minh họa (`lib/effectPreview.ts`); tile Bộ lọc dùng cảnh JPEG tĩnh + CSS filter |
| Chuyển cảnh + chỉnh thời lượng | ✅ | 17 loại |
| Filter preset | ✅ | 16 preset |
| Hiệu ứng trên dải thời gian (kéo/co giãn) | ✅ | Bar trên clip |
| Body/AI effects, hiệu ứng Pro online | ❌ | Material bản quyền của CapCut, không sao chép được |

### Text / Sticker
| CapCut | CutClone | Ghi chú |
|---|---|---|
| Text presets, font, viền, nền | ✅ | 8 font hệ thống |
| Hoạt ảnh chữ (vào/ra) | ✅ | 9 kiểu: fade/slide×4/typewriter/zoom/pop/bounce |
| Sticker | ✅ | Thư viện emoji hệ thống 6 danh mục (không dùng material CapCut) |
| Text template online | ❌ | Material trực tuyến |

### Âm thanh
| CapCut | CutClone | Ghi chú |
|---|---|---|
| Âm lượng, fade in/out, volume theo track | ✅ | |
| Tách âm thanh khỏi video | ✅ | |
| Tốc độ ảnh hưởng âm thanh (kể cả ramp) | ✅ | Lập lịch chunk theo tích phân tốc độ |
| Hiệu ứng âm thanh (vọng/vang/robot/điện thoại/trầm/cao) | ✅ | Preview WebAudio; pitch áp dụng đầy đủ khi xuất |
| Giảm ồn | 🟡 | Bản cơ bản (highpass/lowpass/compressor); CapCut dùng model RNNoise |
| Chuẩn hóa âm lượng | ❌ | |
| Nhạc/SFX stock online | ❌ | Dịch vụ trực tuyến |
| Nhận diện nhịp (beat) | ❌ | Chưa làm — có thể thêm sau từ waveform peaks |

### AI / Thông minh
| CapCut | CutClone | Ghi chú |
|---|---|---|
| TTS (chữ thành giọng đọc) | ✅ | Windows SAPI cục bộ (không phải cloud của CapCut) |
| Auto captions (nhận diện giọng nói) | ❌ | Cần model STT lớn; có thể dùng whisper local nếu muốn sau này |
| Tách nền (matting) | ❌ | Model AI riêng; chroma key phủ trường hợp nền xanh |
| Làm đẹp/face reshape, relight, digital human, Smart Cut | ❌ | AI model độc quyền |

### Phụ đề & xuất
| CapCut | CutClone | Ghi chú |
|---|---|---|
| Phụ đề SRT nhập/xuất | ✅ | Track "Phụ đề" từ SRT; xuất từ clip chữ |
| Xuất MP4 (H.264 + AAC) | ✅ | |
| Xuất WebM (VP9 + Opus) | ✅ | |
| Chọn độ phân giải (480p→4K) | ✅ | |
| Chọn fps | ✅ | |
| Chất lượng/bitrate (thấp/TB/cao/tùy chỉnh) | ✅ | Ước tính dung lượng trước khi xuất |
| Bitrate âm thanh 128–320 kbps | ✅ | |
| Xuất GIF, MOV/WMV, export trực tiếp TikTok/YouTube | ❌ | GIF cần encoder riêng; mạng xã hội cần API nền tảng |
| Chọn ảnh bìa khi xuất | ❌ | |

## Hạn chế đã biết của bản clone

1. Chroma key xử lý per-pixel bằng CPU — preview có thể giảm FPS trên 1080p; export vẫn đúng.
2. Tông cao/trầm (pitch) chỉ áp dụng khi xuất; preview giữ nguyên cao độ.
3. Keyframe chỉ thêm/xóa/đổi easing trong Inspector, chưa có hàng keyframe trên timeline.
4. Khi import draft CapCut, sticker/effect Pro không có bản tương đương sẽ bị bỏ qua kèm cảnh báo.

## Việc có thể làm tiếp

- Hàng keyframe trên timeline (diamond, kéo thời điểm).
- Đồ thị đường cong màu (curves) + LUT .cube qua WebGL.
- Beat detection từ waveform → tự tạo markers.
- Chuẩn hóa âm lượng (loudness EBU R128 xấp xỉ).
- Whisper.cpp local cho auto captions (nếu chấp nhận thêm ~150MB model).

---

# Bổ sung phân tích (leanrea, 2026-10-27)

Thống kê lại CapCut 9.6.0.4097 đã cài tại `C:\Users\HuyEndy\AppData\Local\CapCut\Apps\9.6.0.4097` với
nhiều nguồn bằng chứng mà lần phân tích trước bỏ sót (đánh dấu **seen** = trực tiếp quan sát được):

## Bằng chứng mới từ thư mục install

- **en.po** (`Resources\po\en.po`) — catalog i18n đầy đủ, 17.869 chuỗi `msgid`: liệt kê toàn bộ
  nhãn tính năng của UI (**seen**).
- **`common_agent/` + `packaged-skills.json`**: runtime AI Agent cục bộ — skills
  `canvas-node-cli`, `capcut-browser`, `lark-doc`, `timeline-draft-cli` (cho phép AI đọc và
  sửa draft trực tiếp) trong `skills/*/SKILL.md` (**seen**).
- **`builtin_skills/`**: `jianying.agent.highlight`, `material_understanding`, `script`,
  `speaker`, `align_bgm_with_video`, `lvc` — các builtin skill của agent: tạo highlight, hiểu
  material, viết kịch bản (script), chọn giọng đọc (speaker), đồng bộ nhạc nền (**seen**).
- DLL khối AI: `DeepAgentsService.dll` (4.2MB), `deepagents_capi.dll` (40.1MB),
  `agent_runtime_addon.node`, `bun.exe` (102.5MB — Bun runtime cho agent), `speechsdk.dll`,
  `smart_cut.ofx.bundle` (**seen**).
- `Resources/models/`: các mô hình AI — `interpolation` (nội khung hình), `object_tracking`,
  `deflicker`, `noise_reduction`, `facebeautifymodel`, `hairparser`, `avatar3d`, `avatar_drive`,
  `idream` (sinh ảnh), `depthmodel`, `mattingmodel`, `media_search` (**seen**).
- `commonSetting.ini`: `video_track_limit=40`, `homepage_edit_pilot_…`, `web_ai_design_…`,
  `quality_enhance_last_choose` (**seen**).
- `vesdk.ini`: `hdr_mode`, `proxy_hw_accels=1057` (proxy preview cho file nặng), `enable_smart_codec`
  (**seen**).
- Nhóm chuỗi UI chọn lọc từ `en.po` (**seen** — đáng chú ý nhất):
  - Keyframe: `keyframe_animation`, `close_keyframes_graph_panel`, `expand_keyframes`,
    `click_to_add_keyframes`, `keyframe_preset_ease*` — **bảng điều chỉnh keyframe dạng đồ thị
    (graph panel) trên timeline**.
  - Compound: `create_compound_clips`, `compound_fragment_dismiss_failed` — **nhóm nhiều clip thành một**
    (nested sequence).
  - Beat: `add_beat`, `auto_beat`, `pc_add_beat`, `beat_metre_1`, `beat_metre_2`,
    `beat_sync_videos`, `match_video_to_music_beat` — **đặt nhịp + đồng bộ cắt theo nhạc**.
  - Speed curve: `curve_speed`, `curve_line`, `free_curve`, `auto_curve`.
  - AI content: `ai_edit_agent_*` (tác nhân AI ngay trong màn hình edit), `ccug_pc_copilot_removeBG_*`,
    `ai_avatar_*` (digital human), `pc_ai_avatar_video_translator` (dịch video + lip-sync),
    `generate_subtitles_from_speech_or_lyrics`, `identify_subtitles`,
    `ai_pc__lyrics_adaptation` (khớp lời hát), `pc_ad_maker_audioEnhancement_…removeFillerWords`
    (làm sạch lời nhắc "ừm/à"), `change_voice_param_pitch(_shift)`, `image_quality_enhancement`.
  - Xuất: `confirm_cover`, `cover_selection`, `audio_and_subtitle_export_complete`,
    `current_content_not_in_the_export_area_will_not_exported` (chỉ xuất vùng được chọn).
  - HDR: `detect_imported_footage_as_hlg/pq_hdr_color_space_footage…` — HLG/PQ pipeline.
  - Caption resources: `Resources/icon/cc_caption_duration_info_*.json` cho 17 ngôn ngữ.

## Gợi ý bổ sung cho CutClone — 3 lớp ưu tiên

### Lớp 1 — thêm ngay được, hoàn toàn offline (đề xuất thực hiện gần nhất)

| # | Chức năng CapCut | Trạng thái clone | Cách bổ sung |
|---|---|---|---|
| 1 | Hàng keyframe trên timeline + panel đồ thị keyframe | ✅ | Diamond đỏ-âm trên clip (kéo = retime, nhấp = nhảy tới, chỉ khi chọn clip); panel đồ thị SVG (`KeyframeGraphPanel`) toggle bằng nút `Activity` trên toolbar timeline: chips property (kèm ease theo đoạn, đúp nhấp để thêm, select easing, xóa) |
| 2 | Compound clip (nhóm track thành sequence lồng nhau) | ✅ | `Clip.compound={duration,tracks}`; Inspector: "Gộp compound (≥2 clip chọn)" / "Tách compound"; render nội bộ qua `renderTracks` đệ quy + `splitCompound` cắt tại playhead |
| 3 | Beat detection → auto markers + grid nhịp cho "cắt theo nhạc" | ✅ | `detectBeats` (onset band-energy) tại import gán `asset.beats/bpm`; Inspector/menu phải: "Đánh dấu beat" → marker màu `#22c55e`; vạch dẫn hướng màu marker chạy dọc lane |
| 4 | Chuẩn hóa âm lượng (loudness) | ✅ | `asset.rms` tại import; `loudnessGain` target 0.07 (clamp 0.05–6) áp tại preview + export; checkbox "Chuẩn hóa âm lượng" trong Inspector Âm thanh |
| 5 | Pitch preview real-time | ✅ | AudioWorklet granular dual delay-line (Doppler 60ms sweep) — `ensurePitchNode` splice vào chain preview; export vẫn `pitchShiftBuffer` |
| 6 | Color curves RGB + color wheel + LUT `.cube` | ✅ | Pass WebGL2 chung `colorGrade.ts` call sau chroma-key (fallback Canvas nếu không WebGL2); `CurveEditor`/`WheelEditor` SVG kéo được; LUT parse 33³/65³ có cache |
| 7 | Xuất: chọn ảnh bìa, GIF xuất thẳng, audio-only + file phụ đề đồng thời | ✅ | Modal xuất: GIF (fps 8/10/12, ≤480px, LZW 255 màu), "Chỉ âm thanh", slider chọn khung bìa + thumbnail preview, "Kèm phụ đề .srt"; viết `*-cover.jpg` / `*.srt` cạnh file chính |
| 8 | Keymap tuỳ chỉnh + bảng shortcut | ✅ | `lib/keymap.ts` (`Ctrl+B|Delete|?`…, localStorage, bắt phím trực tiếp, cảnh báo trùng); nút⚙ TopBar → `KeymapModal`; App route mọi shortcut qua map (+ Backspace fallback) |
| 9 | Preset chỉnh màu/âm thanh người dùng | ✅ | localStorage `cc-user-color-presets`/`cc-user-audio-presets` — lưu/xóa/áp trong Inspector (màu: filters + advanced; âm: volume/fade/normalize/effect) |
| 10 | Proxy preview clip nặng | ✅ | Auto-generate proxy nửa phân giải (scale ≥0.5, cap 1280, codec avc) qua `media:writeProxy` vào userData/proxy; preview tự dùng proxy, export full-res |
| 11 | Reverse clip | ✅ | `buildReversedMediaAsset`: decode forward → dump frame JPEG pass 1 → encode đảo ngược pass 2 (avc, cap 30s/MAX_EDGE 1920), audio rỗng rồi flip từng kênh; clip trỏ asset mới, không đổi doc gốc |

### Lớp 2 — cần model/runtime hơn về sau

- Auto captions STT local: whisper.cpp / vosk-browser.
- Tách nền (matting) không chroma-key: modnet/u2net onnxruntime-web.
- Frame interpolation (nội khung) — bản clone có thể tạm mô phỏng chuyển động bằng cross-fade;
  thực chất cần model optical-flow (nặng — chỉ tiếp khi thật sự cần).

### Lớp 3 — cloud/độc quyền của CapCut (chỉ ghi nhận, không làm)

- AI Edit Agent (tác nhân AI chạy ngay trong UI — `ai_edit_agent_*`), kiến trúc tương tự
  `timeline-draft-cli`/`capcut-browser`.
- Digital human / AI avatar + dịch video lip-sync; lyrics adaptation; ad maker; highlight/speaker/
  script/align BGM/LVC builtin skills.
- Material online (music bản quyền, sticker Giphy, template Cloud, Dreamina text-to-image).
- HDR HLG/PQ, C2PA content credentials (`tt_c2pa_sdk.dll`).

## Kết luận chênh lệch mới so với phân tích lần trước

Ngoài ❌ hoặc 🟡 đã liệt kê trong ma trận trên, các hệ thống vẫn còn thiếu mà lần trước không liệt kê:

1. **Compound clip / group nested sequence**.
2. **Beat detection & "cắt theo nhạc"** (grid nhịp + auto markers + snap).
3. **Panel đồ thị keyframe** trên timeline.
4. **Color wheel/curves/LUT** backend WebGL.
5. **Keymap tuỳ chỉnh** và **lưu preset người dùng**.
6. **Proxy preview** cho video nặng.
7. **Xuất thêm**: ảnh bìa, GIF, audio-only + file phụ đề, "export area".
8. **Chuẩn hóa âm lượng + làm sạch lời nói (remove filler words)** — bản clone có thể làm mức cơ bản
   bằng WebAudio (trim đoạn im lặng + enhance voice).
