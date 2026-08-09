# Waveframe Runbook

Plain-language instructions for running, building, releasing and rolling
back Lightmorphic Waveframe. No terminal knowledge assumed beyond copying
the commands shown.

## Run the app (development)

```bash
cd ~/GitHub/waveframe
npm install     # only needed the first time, or after pulling changes
npm start
```

## Run the tests

```bash
npm test
```

This opens the real app several times, loads test images and audio, does
five real exports, and checks each one, including that the audio in the
output is bit-for-bit identical to the input. Everything should say `ok`.
If anything says `FAIL`, don't release.

## Build the AppImage

```bash
npm run build
```

The finished file appears in `dist/`, named like
`Lightmorphic-Waveframe-1.0.0-x86_64.AppImage`. To check it works:

```bash
node test/appimage-smoke.js
```

This launches the actual AppImage, does one export, and confirms the audio
came through untouched.

## Publish a release

Releases are automated. Pushing a version tag makes GitHub build the
AppImage and publish the release with it attached (the workflow lives in
`.github/workflows/release.yml`).

1. Bump the `"version"` in `package.json` (e.g. `1.0.0` → `1.0.1`).
2. Run the tests, then the build, then the smoke test (all above).
3. Update the release notes line in `.github/workflows/release.yml` if
   the standard text no longer fits, then:

```bash
git add -A && git commit -m "Release v1.0.1" && git push
git tag -a v1.0.1 -m "Waveframe 1.0.1" && git push origin v1.0.1
```

A few minutes later the release appears on the Releases page. Check it at
https://github.com/lightmorphic/waveframe/releases

The website's download button always points at the *latest* release, so
there is nothing to change on the site.

## Roll back a bad release

If a new release turns out broken, point people back at the previous one:

```bash
gh release delete v1.0.1 --yes
git push --delete origin v1.0.1
```

That removes the broken release; the "latest" link then serves the previous
release again. Users who already downloaded the bad version just download
again.

To also undo the code changes on `main`:

```bash
git revert HEAD --no-edit && git push
```

(`git revert` adds a new commit that undoes the last one, so history stays
intact.)

## Where things live

| What | Where |
|---|---|
| App code | `src/` (main process in `src/main/`, window UI in `src/renderer/`) |
| Website | `site/` (one page, self-contained) |
| Tests | `test/run-tests.js` and `test/appimage-smoke.js` |
| Screenshots | `docs/shots/` (regenerate with `node scripts/screenshots.js`) |
| App icon | `assets/icon.png` (regenerate with `npx electron scripts/make-icon.js`) |

## If an export fails for a user

The app shows plain-language messages for every failure it knows about
(unreadable file, image too small, disk full, and so on). If someone
reports a failure the app couldn't explain, ask for: the audio format,
the image size, and roughly how long the audio is, then reproduce with
`npm start`.
