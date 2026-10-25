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
| Nhập media (picker + kéo thả) | ✅ | |
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
