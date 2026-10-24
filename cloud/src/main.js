import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import "./style.css";
import "./tags.css";

const $ = (id) => document.getElementById(id);
const state = { tracks: [], clips: [], ffmpeg: null, exporting: false, cancelled: false, previewIndex: -1, downloads: [] };
const saved = JSON.parse(localStorage.getItem("looproom-cloud-details") || "{}");
const history = JSON.parse(localStorage.getItem("looproom-cloud-tags") || "[]");
for (const key of ["title", "description", "tags", "resolution", "ratio", "framing"]) if (saved[key]) $(key).value = saved[key];

function theme() {
  const today = new Date().toDateString();
  const override = JSON.parse(localStorage.getItem("looproom-cloud-theme") || "null");
  document.documentElement.dataset.theme = override?.day === today ? override.value : (new Date().getHours() >= 18 || new Date().getHours() < 7 ? "dark" : "light");
}
theme();
setInterval(theme, 60000);
$("themeButton").onclick = () => {
  const value = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("looproom-cloud-theme", JSON.stringify({ day: new Date().toDateString(), value }));
  theme();
};

function saveDetails(commitTags = false) {
  const details = Object.fromEntries(["title", "description", "tags", "resolution", "ratio", "framing"].map((key) => [key, $(key).value]));
  localStorage.setItem("looproom-cloud-details", JSON.stringify(details));
  if (commitTags) {
    const tags = details.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    for (const tag of tags) if (!history.includes(tag)) history.unshift(tag);
    history.splice(30);
    localStorage.setItem("looproom-cloud-tags", JSON.stringify(history));
  }
  showTagSuggestions();
}
saveDetails();
for (const key of ["title", "description", "tags", "resolution", "ratio", "framing"]) $(key).addEventListener("input", () => { saveDetails(); if (key === "title" || key === "ratio") updateSummary(); });
$("tags").addEventListener("blur", () => setTimeout(() => saveDetails(true), 120));
function showTagSuggestions() {
  const parts = $("tags").value.split(",");
  const current = parts.at(-1).trim().toLowerCase();
  const used = parts.slice(0, -1).map((tag) => tag.trim().toLowerCase());
  const matches = current ? history.filter((tag) => tag.toLowerCase().includes(current) && tag.toLowerCase() !== current && !used.includes(tag.toLowerCase())).slice(0, 6) : [];
  $("tagSuggestions").replaceChildren(...matches.map((tag) => button(tag, () => {
    parts[parts.length - 1] = ` ${tag}`;
    $("tags").value = parts.join(",").trimStart() + ", ";
    saveDetails(true); $("tags").focus();
  })));
}
document.querySelectorAll(".copy").forEach((button) => button.onclick = async () => {
  await navigator.clipboard.writeText($(button.dataset.copy).value);
  const old = button.textContent; button.textContent = "Copied ✓";
  setTimeout(() => button.textContent = old, 1600);
});

function fileUrl(file) { return URL.createObjectURL(file); }
function durationOf(url, type) {
  return new Promise((resolve) => {
    const element = document.createElement(type === "audio" ? "audio" : "video");
    element.preload = "metadata"; element.src = url;
    element.onloadedmetadata = () => resolve(Number.isFinite(element.duration) ? element.duration : 0);
    element.onerror = () => resolve(0);
    setTimeout(() => resolve(0), 8000);
  });
}
function minutes(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }
function kind(file) { return file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(file.name) ? "video" : /\.gif$/i.test(file.name) ? "gif" : "image"; }
function button(label, handler, title = label) { const el = document.createElement("button"); el.textContent = label; el.title = title; el.onclick = handler; return el; }
function setStatus(message) { $("status").textContent = message; }
function refreshTracks() {
  $("audioList").replaceChildren(...state.tracks.map((track, index) => {
    const row = document.createElement("div"); row.className = "track";
    const name = document.createElement("span"); name.textContent = `♫  ${track.file.name} · ${minutes(track.duration)}`;
    row.append(name, button("×", () => { URL.revokeObjectURL(track.url); state.tracks.splice(index, 1); refreshTracks(); }, "Remove track"));
    return row;
  }));
  $("player").src = state.tracks[0]?.url || "";
  if (!$("title").value && state.tracks[0]) $("title").value = state.tracks[0].file.name.replace(/\.[^.]+$/, "");
  saveDetails(); updateSummary();
}
async function addAudio(files) {
  for (const file of files) {
    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|flac|ogg)$/i.test(file.name)) continue;
    const url = fileUrl(file); const duration = await durationOf(url, "audio");
    if (!duration) { URL.revokeObjectURL(url); setStatus(`Could not read ${file.name}.`); continue; }
    state.tracks.push({ file, url, duration });
  }
  refreshTracks();
}
async function addArtwork(files) {
  for (const file of files) {
    const type = kind(file);
    if (type === "image" && !file.type.startsWith("image/")) continue;
    const url = fileUrl(file);
    const mediaDuration = type === "video" ? await durationOf(url, "video") : 0;
    state.clips.push({ file, url, type, duration: type === "video" ? Math.max(0.5, Math.min(mediaDuration || 3, 20)) : type === "gif" ? 3 : 5 });
  }
  refreshClips();
}
function moveClip(from, to) {
  if (to < 0 || to >= state.clips.length || from === to) return;
  state.clips.splice(to, 0, state.clips.splice(from, 1)[0]);
  refreshClips();
}
function refreshClips() {
  $("clipList").replaceChildren(...state.clips.map((clip, index) => {
    const card = document.createElement("article"); card.className = "clip"; card.draggable = true;
    card.ondragstart = (event) => event.dataTransfer.setData("text/plain", String(index));
    card.ondragover = (event) => event.preventDefault();
    card.ondrop = (event) => { event.preventDefault(); moveClip(Number(event.dataTransfer.getData("text/plain")), index); };
    const head = document.createElement("div"); head.className = "clip-head";
    head.append(document.createTextNode(`⠿  ${index + 1}`), button("×", () => { URL.revokeObjectURL(clip.url); state.clips.splice(index, 1); refreshClips(); }, "Remove clip"));
    const media = document.createElement(clip.type === "video" ? "video" : "img"); media.src = clip.url; media.muted = true; media.playsInline = true; media.preload = "metadata";
    if (clip.type === "video") media.onloadedmetadata = () => { media.currentTime = Math.min(0.1, media.duration / 2); };
    const name = document.createElement("div"); name.className = "clip-name"; name.title = clip.file.name; name.textContent = clip.file.name;
    const controls = document.createElement("div"); controls.className = "clip-controls";
    const seconds = document.createElement("input"); seconds.type = "number"; seconds.min = "0.5"; seconds.max = "30"; seconds.step = "0.5"; seconds.value = clip.duration; seconds.title = "Seconds in each loop";
    seconds.onchange = () => { clip.duration = Math.max(0.5, Math.min(30, Number(seconds.value) || 3)); seconds.value = clip.duration; updateSummary(); syncPreview(); };
    controls.append(seconds, document.createTextNode("sec"), button("←", () => moveClip(index, index - 1)), button("→", () => moveClip(index, index + 1)));
    card.append(head, media, name, controls); return card;
  }));
  $("clipCount").textContent = `${state.clips.length} clip${state.clips.length === 1 ? "" : "s"}`;
  updateSummary(); syncPreview();
}
function updateSummary() {
  const total = state.clips.reduce((sum, clip) => sum + clip.duration, 0);
  $("loopSummary").textContent = state.clips.length ? `${state.clips.length} clips · ${total.toFixed(1)}-second loop` : "Add artwork to build a loop";
  $("orderSummary").textContent = state.clips.length ? `Playback order: ${state.clips.map((_, i) => i + 1).join(" → ")} → repeat` : "Playback order will appear here.";
  $("previewTitle").textContent = $("title").value || state.tracks[0]?.file.name.replace(/\.[^.]+$/, "") || "Untitled";
  $("previewRatio").textContent = $("ratio").value;
  $("stage").style.aspectRatio = $("ratio").value.replace(":", "/");
  $("exportButton").disabled = !state.tracks.length || !state.clips.length || state.exporting;
  if (!state.exporting && state.tracks.length && state.clips.length && $("status").textContent === "Choose music and artwork to begin.") setStatus("Ready to create your video.");
}
function syncPreview() {
  const player = $("player");
  const total = state.clips.reduce((sum, clip) => sum + clip.duration, 0);
  if (!total) { $("previewVideo").hidden = true; $("previewImage").hidden = true; $("emptyStage").hidden = false; return; }
  let point = player.currentTime % total; let index = 0;
  while (index < state.clips.length - 1 && point >= state.clips[index].duration) point -= state.clips[index++].duration;
  const clip = state.clips[index], video = $("previewVideo"), image = $("previewImage");
  $("emptyStage").hidden = true;
  if (clip.type === "image" || clip.type === "gif") {
    video.pause(); video.hidden = true; image.hidden = false;
    if (state.previewIndex !== index) image.src = clip.url;
  } else {
    image.hidden = true; video.hidden = false;
    if (state.previewIndex !== index) video.src = clip.url;
    const wanted = point % (video.duration || clip.duration);
    if (video.readyState >= 1 && Math.abs(video.currentTime - wanted) > 0.35) video.currentTime = wanted;
    if (!player.paused && video.paused) video.play().catch(() => {});
    if (player.paused && !video.paused) video.pause();
  }
  state.previewIndex = index;
}
$("player").addEventListener("play", syncPreview);
$("player").addEventListener("pause", syncPreview);
$("player").addEventListener("seeked", syncPreview);
setInterval(syncPreview, 120);

function dropTarget(id, inputId, handler) {
  const zone = $(id), input = $(inputId);
  input.onchange = () => { handler([...input.files]); input.value = ""; };
  zone.ondragover = (event) => { event.preventDefault(); zone.classList.add("over"); };
  zone.ondragleave = () => zone.classList.remove("over");
  zone.ondrop = (event) => { event.preventDefault(); zone.classList.remove("over"); handler([...event.dataTransfer.files]); };
}
dropTarget("audioDrop", "audioInput", addAudio);
dropTarget("artDrop", "artInput", addArtwork);

async function engine() {
  if (state.ffmpeg) return state.ffmpeg;
  setStatus("Loading the video engine (about 31 MB)…");
  const ffmpeg = new FFmpeg();
  const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm")
  });
  state.ffmpeg = ffmpeg;
  return ffmpeg;
}
function dimensions() {
  const short = Number($("resolution").value);
  if ($("ratio").value === "9:16") return [short, Math.round(short * 16 / 9 / 2) * 2];
  if ($("ratio").value === "1:1") return [short, short];
  return [Math.round(short * 16 / 9 / 2) * 2, short];
}
function safeName(name) { return name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 70) || "looproom"; }
async function run(ffmpeg, args, step) {
  setStatus(step);
  const code = await ffmpeg.exec(args);
  if (code !== 0) throw new Error(`${step} failed (video engine exit ${code}). Try 480p or shorter clips.`);
  if (state.cancelled) throw new Error("Export cancelled.");
}
async function createVideo(track, trackIndex) {
  const ffmpeg = await engine();
  const [width, height] = dimensions();
  const scale = $("framing").value === "fill"
    ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
    : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
  const videoFilter = `${scale},fps=20,format=yuv420p,setsar=1`;
  const sources = [track.file, ...state.clips.map((clip) => clip.file)];
  if (sources.some((file) => file.size > 500 * 1024 * 1024) || sources.reduce((sum, file) => sum + file.size, 0) > 900 * 1024 * 1024)
    throw new Error("These files are too large for browser export. Use smaller source files (under 500 MB each and 900 MB total).");
  const created = [];
  try {
    for (let i = 0; i < state.clips.length; i++) {
      const clip = state.clips[i], input = `art${i}.${clip.file.name.split(".").pop().toLowerCase()}`, output = `segment${i}.mp4`;
      await ffmpeg.writeFile(input, await fetchFile(clip.file)); created.push(input, output);
      const loop = clip.type === "image" ? ["-loop", "1"] : ["-stream_loop", "-1"];
      await run(ffmpeg, ["-y", ...loop, "-i", input, "-t", String(clip.duration), "-an", "-vf", videoFilter, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", output], `Rendering clip ${i + 1} of ${state.clips.length}…`);
      $("progress").value = Math.round((i + 1) / (state.clips.length + 2) * 100);
    }
    const manifest = state.clips.map((_, i) => `file 'segment${i}.mp4'`).join("\n") + "\n";
    await ffmpeg.writeFile("sequence.txt", new TextEncoder().encode(manifest)); created.push("sequence.txt", "sequence.mp4");
    await run(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", "sequence.txt", "-c", "copy", "sequence.mp4"], "Joining the artwork sequence…");
    const audioInput = `audio${trackIndex}.${track.file.name.split(".").pop().toLowerCase()}`;
    const output = `looproom-${trackIndex}.mp4`;
    await ffmpeg.writeFile(audioInput, await fetchFile(track.file)); created.push(audioInput, output);
    await run(ffmpeg, ["-y", "-stream_loop", "-1", "-i", "sequence.mp4", "-i", audioInput, "-t", String(track.duration), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", output], `Adding music to ${track.file.name}…`);
    const data = await ffmpeg.readFile(output);
    const url = URL.createObjectURL(new Blob([data], { type: "video/mp4" }));
    state.downloads.push(url);
    const link = document.createElement("a"); link.href = url; link.download = `${safeName(track.file.name)}-looproom.mp4`; link.className = "download"; link.textContent = `↓ Download ${link.download}`;
    $("downloads").append(link);
    $("progress").value = 100;
  } finally {
    for (const name of created) try { await ffmpeg.deleteFile(name); } catch { /* best effort cleanup */ }
  }
}
$("exportButton").onclick = async () => {
  if (state.exporting || !state.tracks.length || !state.clips.length) return;
  state.exporting = true; state.cancelled = false;
  $("exportButton").disabled = true; $("cancelButton").hidden = false; $("progress").hidden = false;
  $("downloads").replaceChildren();
  for (const url of state.downloads) URL.revokeObjectURL(url);
  state.downloads = [];
  $("player").pause();
  try {
    for (let i = 0; i < state.tracks.length; i++) {
      if (state.cancelled) break;
      await createVideo(state.tracks[i], i);
    }
    if (!state.cancelled) setStatus(`Finished ${state.tracks.length} video${state.tracks.length === 1 ? "" : "s"}. Use the download links above.`);
  } catch (error) { setStatus(error.message || "Export failed."); }
  finally { state.exporting = false; $("cancelButton").hidden = true; $("progress").hidden = true; updateSummary(); }
};
$("cancelButton").onclick = () => { state.cancelled = true; state.ffmpeg?.terminate(); state.ffmpeg = null; setStatus("Export cancelled."); };
updateSummary();
