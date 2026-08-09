# Security policy

## Reporting a problem

If you find a security problem in Waveframe, please email
claude@charlie.cx rather than opening a public issue. You will get a
reply within a week.

## Supported versions

Only the latest release is supported. If a security fix is needed, it
ships as a new release and the old one is removed from the Releases page.

## What Waveframe does and does not do

- Waveframe is a local desktop app. It makes no network connections:
  no updates check, no telemetry, no external fonts or scripts.
- It reads exactly two files you choose (an image and an audio file),
  and writes one video file where you tell it to.
- FFmpeg is bundled and is always run with argument arrays, never
  through a shell, so file names cannot inject commands.
- The app window runs sandboxed with context isolation on, and every
  message from the window to the main process is validated before any
  file is touched.
