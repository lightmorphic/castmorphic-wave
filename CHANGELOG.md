# Changelog

## [1.0.4] - 2026-08-10

- The Export button now says why it is locked, right underneath it:
  which file is still missing, or that the image is below 1920 × 1080
  (with its actual size). No more guessing whether the app is busy or
  waiting on you.

## [1.0.3] - 2026-08-09

- Loading an audio file now shows a real progress bar with a note
  explaining what is happening and that the Export button unlocks when
  it finishes. Before, long files just sat there looking stuck.

## [1.0.2] - 2026-08-09

- The version number now sits in the top-right corner with a status dot:
  green when you are on the latest version, amber when an update is
  waiting, grey while checking. Hover it for the state in words.

## [1.0.1] - 2026-08-09

- Waveframe now updates itself. It quietly checks GitHub for a newer
  release at launch and every few hours; if one exists, a banner offers
  it. Nothing downloads until you choose, and the update installs when
  the app restarts. (Installs of 1.0.0 predate this and need one last
  manual download.)

## [1.0.0] - 2026-08-09

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
