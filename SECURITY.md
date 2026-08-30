# Security policy

## Reporting a problem

If you find a security problem in Wave, please email
claude@charlie.cx rather than opening a public issue. You will get a
reply within a week.

## Supported versions

Only the latest release is supported. If a security fix is needed, it
ships as a new release and the old one is removed from the Releases page.

## What Wave does and does not do

- Wave is a local desktop app. Its only network activity is an
  update check against this repository's GitHub Releases page, at launch
  and every few hours. An update downloads only when you click for it.
  No telemetry, no other connections, no external fonts or scripts.
- It reads exactly two files you choose (an image and an audio file),
  and writes one video file where you tell it to.
- FFmpeg is bundled and is always run with argument arrays, never
  through a shell, so file names cannot inject commands.
- The app window runs sandboxed with context isolation on, and every
  message from the window to the main process is validated before any
  file is touched.
