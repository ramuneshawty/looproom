# Looproom

The original Windows desktop app lives at the repository root. The separate free, browser-rendering Cloudflare edition is in [cloud](cloud/README.md).

A personal, offline music video studio for Windows.

This source repository excludes personal media, exports, the local SQLite database, and the bundled Windows FFmpeg executable. To run this checkout on Windows, put a compatible `ffmpeg.exe` at `bin/ffmpeg.exe` first. The Desktop installation already contains that executable. This repository is the local application source; it is not yet a Cloudflare deployment.

## Start

Double-click **Start Looproom.vbs**. Looproom opens in your default browser at http://127.0.0.1:8765. If Windows blocks the VBS launcher, use **Start Looproom.cmd** instead and leave its window open while exporting.

Python 3 is required (already installed on this computer). The FFmpeg video engine is included in `bin`. No Python packages, account, subscription, or hosting are required. The application listens only on your computer's loopback address.

## Make a video

1. Drop music files onto **Add your music**, or click to browse. Drop several tracks at once to make a batch. Selected files are copied into the app's local working folder, with progress and cancellation available; nothing is sent online.
2. Drop one still image or rendered video onto **Choose your artwork**, or click to browse. An MP4 exported from TouchDesigner works well. Native `.toe` projects must be exported from TouchDesigner first.
3. Enter the title, description, and tags. Each field has a Copy button for YouTube Studio. Enter or comma adds a tag; matching tags from previous exports appear as you type. Use the arrow keys to choose a suggestion and Enter to accept it. Tag matching ignores case and prevents duplicates.
4. Choose Fit (letterbox) or Fill (crop), plus 1080p or 720p. Video artwork automatically loops and its original audio is excluded. The optional 0.5-second loop crossfade blends the clip's end into its start; it needs a clip longer than 1.2 seconds. The preview displays the original artwork; crossfade is applied to the exported video.
5. Choose your export folder and click Create video. To change the folder, paste its full path from File Explorer's address bar. Batch tracks can have separate artwork and metadata. The Apply details & artwork to all tracks button shares the current settings while preserving individual titles.
6. Open the export folder. **Show folder** selects the finished video in File Explorer. Both folder buttons also show the folder path with a Copy button; a finished export offers **Save a copy of the MP4**. Each MP4 has matching `.txt` and `.json` metadata files. Upload the MP4 through YouTube Studio, then use Copy for the title, description, and comma-separated tags.

## Saved information

Drafts save automatically. Save as my defaults remembers your description, tags, resolution, framing, and crossfade preference for new tracks. Titles start from filenames. Tags enter history when an export is queued, so they are also retained for failed or cancelled attempts. Tag history lets you forget unwanted suggestions.

The `data` folder contains the SQLite database, render logs, and local working copies of selected files in `data/imports`. Keep this folder when moving or backing up the app. Working copies use additional disk space and are retained so drafts and old exports can be reopened. Files selected with the original version remain referenced in their original folders; re-select those if you move them. Videos go to the `Videos` folder unless you choose another destination.

The app continues working when you close its browser tab. Reopening the launcher returns to it. Use **Close Looproom** at the bottom of the page to stop the app after exports finish. A computer restart stops an in-progress export; its history will show Interrupted, and you can load its details to export again. Cancel removes the unfinished MP4. Keep the computer awake during long renders.

## Move to your Desktop

Close Looproom using the button at the bottom of the page. Move the **entire Looproom folder**, including `data`, `Videos`, and `bin`, to your Desktop. Open it there and run **Start Looproom.vbs**. The app updates saved paths for files inside its own folder when it detects the move. Custom export folders elsewhere on your computer stay at their existing locations. Keep one active copy so you do not accidentally open a different library.

## Formats and limitations

- Outputs: 16:9 MP4, H.264 at 30 fps, AAC at 320 kbps; audio is re-encoded.
- Still artwork: PNG, JPG, WebP, BMP. Artwork video: MP4, MOV, MKV, WebM, AVI, depending on the codecs inside the file.
- Some source formats cannot preview in a browser but can still export. MP4 with H.264 is the easiest preview format.
- Conversion runs one job at a time to avoid overwhelming the computer. Animated artwork and crossfades take more time than still images.
- No automatic YouTube publishing is configured. Upload through YouTube Studio.
- This is a personal local app, not a server to expose on a network.

## Video engine license

FFmpeg 7.1 is bundled from the imageio-ffmpeg 0.6.0 Windows wheel. See `THIRD_PARTY.md` and the included license notices. Looproom's source is included so you can customize it.
