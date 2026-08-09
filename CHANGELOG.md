# Changelog

## 1.0.0 (2026-08-09)

First release.

- Background image (JPG/PNG, minimum 1920 × 1080; smaller images refused
  with a plain warning, never upscaled) plus audio (MP3, WAV, FLAC,
  AAC/M4A, OGG) in; 1080p H.264 video out.
- Draggable, resizable waveform box positioned freely on a live 16:9 preview.
- 20 waveform styles, each shown as an animated thumbnail.
- Waveform colour auto-matched to the image, with picker and hex override.
- Audio always stream-copied, bit-for-bit. Container auto-selected (MP4 for
  MP3/AAC, MKV otherwise) with a plain-language warning if a manual MP4
  choice would force a re-encode; the compatible container is used instead.
- Video duration matches the audio exactly.
- Packaged as a Linux AppImage with FFmpeg bundled.
