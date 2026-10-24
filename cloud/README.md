# Looproom browser edition

This folder contains the Cloudflare-hosted version of Looproom. It runs on the free Workers Static Assets tier. The video work happens in the browser with `ffmpeg.wasm`, so your music and artwork stay on the device you're using. Keep the tab open while exporting, then download each MP4. The first export downloads the approximately 31 MB FFmpeg engine from jsDelivr.

The browser edition supports multiple audio tracks, ordered video/GIF/still-image clips with adjustable duration, synchronized preview, landscape/portrait/square canvas, fit/fill framing, title/description/tags with copy buttons, remembered tags, timed light/dark theme, and sequential MP4 exports. It does not yet include the desktop edition's release templates, persistent media library, cleanup controls, or transition crossfades. Browsers have tighter memory limits; the app limits source files to 500 MB each and 900 MB total per export.

## Develop

Install dependencies with `pnpm install`, then run `pnpm dev`. If Vite's default config loader fails on Windows, use `pnpm exec vite --configLoader runner`.

## Deploy

This project uses `cloudflare.config.ts` and the official `cf` CLI, following the repository's AGENTS.md instruction. Run `pnpm exec cf auth login` once. On Windows, if the default Vite config loader fails, run:

```
pnpm exec vite build --configLoader runner
pnpm exec cf deploy --prebuilt
```

The Worker name is `looproom-studio`. No R2 or paid Cloudflare product is used.
