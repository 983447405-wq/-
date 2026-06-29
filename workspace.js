const ffmpegGlobal = window.FFmpegWASM || {};
const utilGlobal = window.FFmpegUtil || {};
const { FFmpeg } = ffmpegGlobal;
const { fetchFile } = utilGlobal;

const state = {
  ffmpeg: null,
  ffmpegReady: null,
  jobs: [],
  isConverting: false,
  logExpanded: false,
  activeJobId: null
};

const els = {
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  formatSelect: document.getElementById("formatSelect"),
  widthSelect: document.getElementById("widthSelect"),
  fpsInput: document.getElementById("fpsInput"),
  qualityInput: document.getElementById("qualityInput"),
  qualityOutput: document.getElementById("qualityOutput"),
  levelSelect: document.getElementById("levelSelect"),
  convertAll: document.getElementById("convertAll"),
  downloadAll: document.getElementById("downloadAll"),
  downloadLabel: document.getElementById("downloadLabel"),
  clearAll: document.getElementById("clearAll"),
  jobList: document.getElementById("jobList"),
  emptyState: document.getElementById("emptyState"),
  summary: document.getElementById("summary"),
  engineState: document.getElementById("engineState"),
  themeToggle: document.getElementById("themeToggle"),
  logBox: document.getElementById("logBox"),
  toggleLog: document.getElementById("toggleLog")
};

const WEBM_PRESET = {
  format: "webm",
  width: "600",
  fpsCap: 30,
  videoBitrate: "1.5M",
  maxrate: "1.5M",
  bufsize: "3M",
  crf: 31,
  audioBitrate: "96k"
};

const STATUS_LABELS = {
  queued: "待转换",
  reading: "读取中",
  running: "转换中",
  ready: "已完成",
  error: "失败"
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function timestampFolder(format = getSettings().format) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const formatName = format === "webp" ? "WebP" : "WebM";
  return `Video${formatName}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function sanitizeName(name) {
  const normalized = name.normalize("NFKC").replace(/\.[^.]+$/, "");
  return normalized.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "video";
}

function isVideoFile(file) {
  return file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv|flv|wmv)$/i.test(file.name);
}

function makeJob(file) {
  const id = crypto.randomUUID();
  return {
    id,
    file,
    inputName: `input-${id}.${file.name.split(".").pop() || "video"}`,
    outputName: "",
    outputFormat: "",
    outputMime: "",
    outputSettingsSignature: "",
    status: "queued",
    progress: 0,
    duration: null,
    dimensions: null,
    outputBlob: null,
    outputBytes: 0,
    error: ""
  };
}

function readMetadata(job) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(job.file);
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.remove();
      resolve();
    };

    video.preload = "metadata";
    video.onloadedmetadata = () => {
      job.duration = video.duration;
      if (video.videoWidth && video.videoHeight) {
        job.dimensions = `${video.videoWidth}x${video.videoHeight}`;
      }
      done();
    };
    video.onerror = done;
    video.src = url;
    setTimeout(done, 3000);
  });
}

function getSettings() {
  return {
    format: WEBM_PRESET.format,
    width: WEBM_PRESET.width,
    fps: WEBM_PRESET.fpsCap,
    quality: WEBM_PRESET.crf,
    compression: 2
  };
}

function getFormatLabel(format) {
  return format === "webp" ? "WebP" : "WebM";
}

function getOutputExtension(format) {
  return format === "webp" ? "webp" : "webm";
}

function getOutputMime(format) {
  return format === "webp" ? "image/webp" : "video/webm";
}

function getSettingsSignature(settings = getSettings()) {
  return [settings.format, settings.width, `max-${settings.fps}-fps`, `vp9-crf-${WEBM_PRESET.crf}`, WEBM_PRESET.videoBitrate, `opus-${WEBM_PRESET.audioBitrate}`].join("|");
}

function needsConversion(job) {
  return !job.outputBlob || job.outputSettingsSignature !== getSettingsSignature();
}

function getVp9Crf(quality, compression) {
  const normalized = Math.max(0, Math.min(1, (quality - 30) / 65));
  const base = Math.round(36 - normalized * 22);
  const compressionOffset = compression >= 6 ? 7 : compression >= 4 ? -1 : -2;
  return Math.max(8, Math.min(50, base + compressionOffset));
}

function getVp8Crf(quality, compression) {
  const normalized = Math.max(0, Math.min(1, (quality - 30) / 65));
  const base = Math.round(34 - normalized * 20);
  const compressionOffset = compression >= 6 ? 6 : compression >= 4 ? -1 : -2;
  return Math.max(8, Math.min(45, base + compressionOffset));
}

function getSmallFileProfile(sourceBytes, compression) {
  const mb = 1024 * 1024;
  if (sourceBytes < mb) {
    if (compression >= 6) return { ratio: 0.82, targetOutputRatio: 0.95, minKbps: 240, maxKbps: 2600, crfOffset: 4, retryCrfOffset: 6, fallbackKbps: 720, maxOutputRatio: 1.08 };
    if (compression >= 4) return { ratio: 1.05, targetOutputRatio: 1.18, minKbps: 260, maxKbps: 3600, crfOffset: 1, retryCrfOffset: 3, fallbackKbps: 900, maxOutputRatio: 1.32 };
    return { ratio: 1.32, targetOutputRatio: 1.36, minKbps: 300, maxKbps: 5600, crfOffset: -3, retryCrfOffset: -1, fallbackKbps: 1200, maxOutputRatio: 1.52 };
  }
  if (sourceBytes < 2 * mb) {
    if (compression >= 6) return { ratio: 0.76, targetOutputRatio: 0.88, minKbps: 250, maxKbps: 2800, crfOffset: 4, retryCrfOffset: 6, fallbackKbps: 760, maxOutputRatio: 1.0 };
    if (compression >= 4) return { ratio: 0.98, targetOutputRatio: 1.1, minKbps: 280, maxKbps: 3800, crfOffset: 1, retryCrfOffset: 3, fallbackKbps: 920, maxOutputRatio: 1.24 };
    return { ratio: 1.18, targetOutputRatio: 1.24, minKbps: 320, maxKbps: 5600, crfOffset: -3, retryCrfOffset: 0, fallbackKbps: 1150, maxOutputRatio: 1.38 };
  }
  if (compression >= 6) return { ratio: 0.7, targetOutputRatio: 0.82, minKbps: 280, maxKbps: 3200, crfOffset: 4, retryCrfOffset: 6, fallbackKbps: 820, maxOutputRatio: 0.94 };
  if (compression >= 4) return { ratio: 0.92, targetOutputRatio: 1.02, minKbps: 300, maxKbps: 4200, crfOffset: 1, retryCrfOffset: 3, fallbackKbps: 980, maxOutputRatio: 1.14 };
  return { ratio: 1.08, targetOutputRatio: 1.14, minKbps: 340, maxKbps: 5200, crfOffset: -2, retryCrfOffset: 0, fallbackKbps: 1100, maxOutputRatio: 1.25 };
}

function getSmallFileCrf(crf, compression, sourceBytes = Infinity, retrySmaller = false) {
  if (sourceBytes < 3 * 1024 * 1024) {
    const profile = getSmallFileProfile(sourceBytes, compression);
    const offset = retrySmaller && Number.isFinite(profile.retryCrfOffset) ? profile.retryCrfOffset : profile.crfOffset;
    return clamp(crf + (retrySmaller ? Math.max(offset, profile.crfOffset) : offset), 8, 50);
  }
  if (compression <= 2) return crf;
  const bump = compression >= 6 ? 8 : 4;
  return clamp(crf + bump, 18, 50);
}

function getMediumFileProfile(sourceBytes, compression) {
  const mb = 1024 * 1024;
  if (sourceBytes <= 4 * mb) {
    if (compression >= 6) return { ratio: 0.58, minKbps: 1400, maxKbps: 4200, fallbackKbps: 1900 };
    if (compression >= 4) return { ratio: 0.9, minKbps: 2000, maxKbps: 6500, fallbackKbps: 2900 };
    return { ratio: 1.28, minKbps: 3000, maxKbps: 9800, fallbackKbps: 4300 };
  }
  if (sourceBytes <= 6 * mb) {
    if (compression >= 6) return { ratio: 0.28, minKbps: 780, maxKbps: 2200, fallbackKbps: 1100 };
    if (compression >= 4) return { ratio: 0.48, minKbps: 1100, maxKbps: 3400, fallbackKbps: 1650 };
    return { ratio: 0.74, minKbps: 1400, maxKbps: 5600, fallbackKbps: 2400 };
  }
  return null;
}

function getMediumFileCrf(crf, compression, sourceBytes) {
  const mb = 1024 * 1024;
  if (sourceBytes > 3 * mb && sourceBytes <= 4 * mb) {
    const offset = compression >= 6 ? 2 : compression >= 4 ? -1 : -4;
    return clamp(crf + offset, 8, 50);
  }
  if (sourceBytes > 4 * mb && sourceBytes <= 6 * mb) {
    const offset = compression >= 6 ? 3 : compression >= 4 ? 0 : -2;
    return clamp(crf + offset, 8, 50);
  }
  return crf;
}

function getWebmEncodingProfile(baseProfile, settings, sourceBytes) {
  const mb = 1024 * 1024;
  if (sourceBytes > 3 * mb && sourceBytes <= 4 * mb) {
    if (settings.compression <= 2) return { deadline: "good", cpuUsed: "2" };
    if (settings.compression <= 4) return { deadline: "realtime", cpuUsed: "4" };
  }
  return { deadline: baseProfile.deadline, cpuUsed: baseProfile.cpuUsed };
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return String(error || "转换失败");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSourceBitrateKbps(job) {
  if (!Number.isFinite(job.duration) || job.duration <= 0) return null;
  return Math.round((job.file.size * 8) / job.duration / 1000);
}

function getCompressionProfile(compression) {
  if (compression >= 6) {
    return { ratio: 0.52, minKbps: 900, maxKbps: 7000, largeRatio: 0.16, largeMinKbps: 420, largeMaxKbps: 1500, deadline: "realtime", cpuUsed: "8" };
  }
  if (compression >= 4) {
    return { ratio: 0.78, minKbps: 1800, maxKbps: 11000, largeRatio: 0.3, largeMinKbps: 780, largeMaxKbps: 2600, deadline: "realtime", cpuUsed: "6" };
  }
  return { ratio: 0.94, minKbps: 2200, maxKbps: 14000, largeRatio: 0.42, largeMinKbps: 1100, largeMaxKbps: 4200, deadline: "realtime", cpuUsed: "5" };
}

function getOutputRatioBitrateKbps(job, outputRatio, safety = 0.94) {
  if (!Number.isFinite(job.duration) || job.duration <= 0 || !Number.isFinite(outputRatio)) return null;
  return Math.max(120, Math.round((job.file.size * outputRatio * 8 * safety) / job.duration / 1000));
}

function getPrimaryCodec(settings) {
  return "vp9";
}

function getFallbackCodec(codec) {
  return null;
}

function getTargetBitrateKbps(job, settings) {
  return 1500;
}

function buildOutputArgs(settings, outputName, options = {}) {
  const { includeAudio = true } = options;
  const audioArgs = includeAudio
    ? ["-map", "0:a?", "-c:a", "libopus", "-b:a", WEBM_PRESET.audioBitrate]
    : ["-an"];
  return [
    "-map", "0:v:0",
    ...audioArgs,
    "-c:v", "libvpx-vp9",
    "-crf", String(WEBM_PRESET.crf),
    "-b:v", WEBM_PRESET.videoBitrate,
    "-maxrate", WEBM_PRESET.maxrate,
    "-bufsize", WEBM_PRESET.bufsize,
    "-deadline", "good",
    "-cpu-used", "4",
    "-pix_fmt", "yuv420p",
    outputName
  ];
}

function buildVideoFilter(settings) {
  return `fps=fps='min(source_fps,${WEBM_PRESET.fpsCap})',scale=${WEBM_PRESET.width}:-2`;
}

function updateEngineState(text, busy = false) {
  els.engineState.textContent = text;
  els.engineState.classList.toggle("is-busy", busy);
}

function logLine(message) {
  const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  els.logBox.textContent = `[${stamp}] ${message}\n${els.logBox.textContent}`.slice(0, 12000);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const isDark = theme === "dark";
  els.themeToggle.classList.toggle("is-dark", isDark);
  els.themeToggle.setAttribute("aria-label", isDark ? "切换为亮色模式" : "切换为暗色模式");
  els.themeToggle.title = isDark ? "切换为亮色模式" : "切换为暗色模式";
}

function render() {
  els.emptyState.hidden = state.jobs.length > 0;
  els.summary.textContent = `${state.jobs.length} 个文件`;
  els.downloadLabel.textContent = `下载全部 ${getFormatLabel(getSettings().format)}`;
  els.convertAll.disabled = state.isConverting || !state.jobs.some(needsConversion);
  els.downloadAll.disabled = !state.jobs.some((job) => job.outputBlob);
  els.clearAll.disabled = state.isConverting || state.jobs.length === 0;

  els.jobList.innerHTML = "";
  for (const job of state.jobs) {
    const card = document.createElement("article");
    card.className = "job-card";
    card.dataset.id = job.id;

    const statusClass = job.status === "ready" ? "ready" : job.status === "running" || job.status === "reading" ? "running" : job.status === "error" ? "error" : "";
    const ratio = job.outputBytes ? `${Math.round((job.outputBytes / job.file.size) * 100)}%` : "--";
    const details = [
      `源文件 ${formatBytes(job.file.size)}`,
      `输出 ${job.outputBytes ? formatBytes(job.outputBytes) : "--"}`,
      `格式 ${job.outputFormat ? getFormatLabel(job.outputFormat) : getFormatLabel(getSettings().format)}`,
      `压缩比 ${ratio}`,
      `时长 ${formatDuration(job.duration)}`,
      job.dimensions || "尺寸 --"
    ];

    card.innerHTML = `
      <div class="job-main">
        <div class="job-title">
          <strong title="${escapeHtml(job.file.name)}">${escapeHtml(job.file.name)}</strong>
          <span class="status-pill ${statusClass}">${STATUS_LABELS[job.status] || job.status}</span>
        </div>
        <div class="job-meta">${details.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
        ${job.error ? `<div class="job-meta"><span>${escapeHtml(job.error)}</span></div>` : ""}
        <div class="progress-track"><div class="progress-bar" style="width:${Math.round(job.progress * 100)}%"></div></div>
      </div>
      <div class="job-actions">
        <button class="icon-button" data-action="download" title="下载" ${job.outputBlob ? "" : "disabled"}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="M7 10l5 5 5-5"></path><path d="M5 21h14"></path></svg>
        </button>
        <button class="icon-button" data-action="remove" title="移除" ${state.isConverting ? "disabled" : ""}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 14h10l1-14"></path><path d="M9 7V4h6v3"></path></svg>
        </button>
      </div>
    `;
    els.jobList.append(card);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function ensureFFmpeg() {
  if (!FFmpeg || !fetchFile) {
    throw new Error("FFmpeg 运行文件缺失，请确认 vendor/ffmpeg 文件夹完整。");
  }
  if (state.ffmpegReady) return state.ffmpegReady;

  state.ffmpeg = new FFmpeg();
  state.ffmpeg.on("log", ({ message }) => {
    if (message) logLine(message);
  });
  state.ffmpeg.on("progress", ({ progress }) => {
    const job = state.jobs.find((item) => item.id === state.activeJobId);
    if (job && Number.isFinite(progress)) {
      job.progress = Math.max(job.progress, Math.min(progress, 0.98));
      render();
    }
  });

  updateEngineState("加载引擎", true);
  state.ffmpegReady = state.ffmpeg.load({
    coreURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.js"),
    wasmURL: chrome.runtime.getURL("vendor/ffmpeg/ffmpeg-core.wasm")
  }).then(() => {
    updateEngineState("引擎就绪");
    logLine("FFmpeg WebAssembly loaded.");
  }).catch((error) => {
    state.ffmpegReady = null;
    updateEngineState("引擎失败");
    throw error;
  });
  return state.ffmpegReady;
}

async function reloadFFmpeg() {
  if (state.ffmpeg) {
    state.ffmpeg.terminate();
  }
  state.ffmpeg = null;
  state.ffmpegReady = null;
  await ensureFFmpeg();
}

function releaseFFmpeg() {
  if (state.ffmpeg) {
    state.ffmpeg.terminate();
  }
  state.ffmpeg = null;
  state.ffmpegReady = null;
}

function waitForIdleFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

async function readOutputBlob(ffmpeg, outputName, mimeType) {
  const output = await ffmpeg.readFile(outputName);
  return new Blob([output], { type: mimeType });
}

function isWrapperStartsWithError(error) {
  return getErrorMessage(error).includes("startsWith");
}

function validateVideoBlob(blob) {
  return new Promise((resolve, reject) => {
    if (!blob || blob.size <= 0) {
      reject(new Error("输出文件为空"));
      return;
    }

    const video = document.createElement("video");
    const url = URL.createObjectURL(blob);
    let settled = false;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    video.preload = "metadata";
    video.onloadedmetadata = () => {
      if (video.videoWidth !== 600) {
        finish(reject, new Error(`输出宽度为 ${video.videoWidth}，不是 600`));
        return;
      }
      if (video.videoHeight % 2 !== 0) {
        finish(reject, new Error(`输出高度为 ${video.videoHeight}，不是偶数`));
        return;
      }
      finish(resolve, {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration
      });
    };
    video.onerror = () => finish(reject, new Error("输出 WebM 无法被浏览器读取"));
    video.src = url;
    setTimeout(() => finish(reject, new Error("读取输出 WebM 元数据超时")), 5000);
  });
}

async function readValidatedOutput(ffmpeg, outputName, mimeType) {
  const blob = await readOutputBlob(ffmpeg, outputName, mimeType);
  await validateVideoBlob(blob);
  return blob;
}

async function recoverOutputAfterWrapperError(ffmpeg, outputName, mimeType, error, label) {
  if (!isWrapperStartsWithError(error)) return null;
  try {
    const blob = await readValidatedOutput(ffmpeg, outputName, mimeType);
    logLine(`${label} produced a valid WebM despite FFmpeg wrapper error; using recovered output.`);
    return blob;
  } catch (readError) {
    logLine(`${label} recovery failed: ${getErrorMessage(readError)}`);
    return null;
  }
}

async function execAndReadOutput(ffmpeg, args, outputName, mimeType, label) {
  let exitCode;
  try {
    exitCode = await ffmpeg.exec(args);
  } catch (error) {
    const recoveredBlob = await recoverOutputAfterWrapperError(ffmpeg, outputName, mimeType, error, label);
    if (recoveredBlob) return recoveredBlob;
    throw error;
  }
  if (exitCode !== 0) {
    throw new Error(`FFmpeg 退出码 ${exitCode}`);
  }
  return readValidatedOutput(ffmpeg, outputName, mimeType);
}

function getSmallerRetryBitrateKbps(job, currentTargetKbps) {
  const sourceKbps = getSourceBitrateKbps(job);
  if (job.file.size < 3 * 1024 * 1024) {
    const settings = getSettings();
    const profile = getSmallFileProfile(job.file.size, settings.compression);
    const sizeCapKbps = getOutputRatioBitrateKbps(job, profile.maxOutputRatio, 0.9);
    const sourceLimitedKbps = sourceKbps ? Math.round(sourceKbps * Math.min(profile.ratio, profile.maxOutputRatio)) : currentTargetKbps;
    const cappedKbps = sizeCapKbps ? Math.min(sourceLimitedKbps, sizeCapKbps) : sourceLimitedKbps;
    const shrinkFactor = settings.compression >= 6 ? 0.76 : settings.compression >= 4 ? 0.84 : 0.9;
    return clamp(Math.min(Math.round(currentTargetKbps * shrinkFactor), cappedKbps), 120, currentTargetKbps);
  }
  const sourceLimitedKbps = sourceKbps ? Math.round(sourceKbps * 0.48) : currentTargetKbps;
  return clamp(Math.min(Math.round(currentTargetKbps * 0.62), sourceLimitedKbps), 160, currentTargetKbps);
}

function shouldRetryForSmallerOutput(job, settings) {
  return false;
}

async function convertJob(job) {
  let ffmpeg = state.ffmpeg;
  const settings = getSettings();
  const settingsSignature = getSettingsSignature(settings);
  const extension = getOutputExtension(settings.format);
  const outputName = `output-${job.id}.${extension}`;
  job.outputName = `${sanitizeName(job.file.name)}.${extension}`;
  job.outputFormat = settings.format;
  job.outputMime = getOutputMime(settings.format);
  job.outputSettingsSignature = settingsSignature;
  job.outputBlob = null;
  job.outputBytes = 0;

  job.status = "reading";
  job.progress = 0.02;
  job.error = "";
  render();

  await ffmpeg.writeFile(job.inputName, await fetchFile(job.file));
  job.status = "running";
  job.progress = 0.06;
  render();

  const inputArgs = [
    "-y",
    "-i", job.inputName,
    "-vf", buildVideoFilter(settings)
  ];

  logLine(`Converting ${job.file.name} -> ${job.outputName}`);
  const targetBitrateKbps = getTargetBitrateKbps(job, settings);
  const primaryCodec = getPrimaryCodec(settings);
  if (settings.format === "webm") {
    logLine(`Target video bitrate: ${targetBitrateKbps} kbps (${primaryCodec.toUpperCase()} + OPUS).`);
  }
  try {
    job.outputBlob = await execAndReadOutput(ffmpeg, [
      ...inputArgs,
      ...buildOutputArgs(settings, outputName, { includeAudio: true })
    ], outputName, job.outputMime, "VP9 + Opus");
  } catch (error) {
    if (settings.format !== "webm") throw error;
    logLine(`VP9 + Opus failed in browser wasm: ${getErrorMessage(error)}; retrying VP9 video-only compatibility mode.`);
    await cleanupFFmpegFiles(outputName);
    await reloadFFmpeg();
    ffmpeg = state.ffmpeg;
    await ffmpeg.writeFile(job.inputName, await fetchFile(job.file));
    job.outputBlob = await execAndReadOutput(ffmpeg, [
      ...inputArgs,
      ...buildOutputArgs(settings, outputName, { includeAudio: false })
    ], outputName, job.outputMime, "VP9 video-only");
  }

  if (shouldRetryForSmallerOutput(job, settings)) {
    const retryBitrateKbps = getSmallerRetryBitrateKbps(job, targetBitrateKbps);
    logLine(`Output exceeds size target; retrying at ${retryBitrateKbps} kbps.`);
    await cleanupFFmpegFiles(outputName);
    const smallerBlob = await execAndReadOutput(ffmpeg, [
      ...inputArgs,
      ...buildOutputArgs(settings, outputName, {
        includeAudio: false
      })
    ], outputName, job.outputMime, "VP9 smaller retry");
    if (smallerBlob.size <= job.outputBlob.size) {
      job.outputBlob = smallerBlob;
    }
  }
  job.outputBytes = job.outputBlob.size;
  job.progress = 1;
  job.status = "ready";

  await cleanupFFmpegFiles(job.inputName, outputName);
  logLine(`Finished ${job.outputName} (${formatBytes(job.outputBytes)}).`);
}

async function cleanupFFmpegFiles(...paths) {
  if (!state.ffmpeg) return;
  for (const path of paths) {
    try {
      await state.ffmpeg.deleteFile(path);
    } catch {
      // Files may already be gone after a failed conversion.
    }
  }
}

async function convertAll() {
  state.isConverting = true;
  updateEngineState("转换中", true);
  render();

  let engineReady = false;
  try {
    for (const job of state.jobs) {
      if (!needsConversion(job)) continue;
      state.activeJobId = job.id;
      try {
        await ensureFFmpeg();
        engineReady = true;
        await convertJob(job);
      } catch (error) {
        job.status = "error";
        job.progress = 0;
        job.error = getErrorMessage(error);
        logLine(`${job.file.name} failed: ${job.error}`);
        await cleanupFFmpegFiles(job.inputName, `output-${job.id}.webm`, `output-${job.id}.webp`);
      } finally {
        releaseFFmpeg();
        await waitForIdleFrame();
      }
      render();
    }
  } catch (error) {
    logLine(`Engine failed: ${getErrorMessage(error)}`);
    for (const job of state.jobs) {
      if (job.status !== "ready") {
        job.status = "error";
        job.error = "转换引擎加载失败";
      }
    }
  } finally {
    state.activeJobId = null;
    state.isConverting = false;
    updateEngineState(engineReady ? "引擎待加载" : "引擎失败");
    render();
  }
}

function chromeDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}

async function downloadJob(job, folder = timestampFolder(job.outputFormat)) {
  if (!job.outputBlob) return;
  const url = URL.createObjectURL(job.outputBlob);
  try {
    await chromeDownload({
      url,
      filename: `${folder}/${job.outputName}`,
      conflictAction: "uniquify",
      saveAs: false
    });
    logLine(`Download queued: ${folder}/${job.outputName}`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

async function downloadAll() {
  const readyJobs = state.jobs.filter((job) => job.outputBlob);
  if (!readyJobs.length) return;
  const folder = timestampFolder(readyJobs[0].outputFormat);
  els.downloadAll.disabled = true;
  try {
    for (const job of readyJobs) {
      await downloadJob(job, folder);
    }
  } finally {
    render();
  }
}

async function addFiles(fileList) {
  const files = Array.from(fileList).filter(isVideoFile);
  if (!files.length) return;

  const jobs = files.map(makeJob);
  state.jobs.push(...jobs);
  render();

  for (const job of jobs) {
    await readMetadata(job);
    render();
  }
}

els.fileInput.addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
});

for (const type of ["dragenter", "dragover"]) {
  els.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropZone.classList.add("is-dragging");
  });
}

for (const type of ["dragleave", "drop"]) {
  els.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("is-dragging");
  });
}

els.dropZone.addEventListener("drop", (event) => {
  addFiles(event.dataTransfer.files);
});

els.qualityInput.addEventListener("input", () => {
  els.qualityOutput.value = els.qualityInput.value;
  els.qualityOutput.textContent = els.qualityInput.value;
  render();
});

for (const input of [els.formatSelect, els.widthSelect, els.fpsInput, els.levelSelect]) {
  input.addEventListener("change", render);
}

els.convertAll.addEventListener("click", convertAll);
els.downloadAll.addEventListener("click", downloadAll);
els.clearAll.addEventListener("click", () => {
  for (const job of state.jobs) {
    if (job.outputBlob) job.outputBlob = null;
  }
  state.jobs = [];
  render();
});

els.jobList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = event.target.closest(".job-card");
  const job = state.jobs.find((item) => item.id === card?.dataset.id);
  if (!job) return;

  if (button.dataset.action === "download") {
    downloadJob(job);
  }
  if (button.dataset.action === "remove" && !state.isConverting) {
    state.jobs = state.jobs.filter((item) => item.id !== job.id);
    render();
  }
});

els.toggleLog.addEventListener("click", () => {
  state.logExpanded = !state.logExpanded;
  els.logBox.hidden = !state.logExpanded;
  els.toggleLog.textContent = state.logExpanded ? "收起" : "展开";
});

els.themeToggle.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

setTheme("light");
render();
