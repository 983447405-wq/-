const LOCAL_HELPER_URL = "http://127.0.0.1:17777";
const LOCAL_HELPER_REQUIRED_MESSAGE = "未连接本地 FFmpeg 助手。请先运行 install_local_helper_autostart.command 完成一次性自启动安装，或临时双击 start_local_ffmpeg_server.command。";

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

const state = {
  jobs: [],
  isConverting: false,
  logExpanded: false,
  activeJobId: null,
  localHelper: {
    available: false,
    checked: false,
    info: null
  }
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

function timestampFolder(format = WEBM_PRESET.format) {
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
  return {
    id: crypto.randomUUID(),
    file,
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

function getSettings() {
  return {
    format: WEBM_PRESET.format,
    width: WEBM_PRESET.width,
    fps: WEBM_PRESET.fpsCap,
    quality: WEBM_PRESET.crf
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
  return [
    settings.format,
    settings.width,
    `max-${settings.fps}-fps`,
    `vp9-crf-${WEBM_PRESET.crf}`,
    WEBM_PRESET.videoBitrate,
    `opus-${WEBM_PRESET.audioBitrate}`
  ].join("|");
}

function needsConversion(job) {
  return !job.outputBlob || job.outputSettingsSignature !== getSettingsSignature();
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return String(error || "转换失败");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function decodeBase64Utf8(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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

async function readMetadata(job) {
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

async function checkLocalHelper({ quiet = false } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${LOCAL_HELPER_URL}/health`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "本地助手不可用");
    }
    state.localHelper = {
      available: true,
      checked: true,
      info: data
    };
    updateEngineState("本地 FFmpeg");
    if (!quiet) logLine(`已连接本地 FFmpeg 助手：${data.version || "ready"}`);
    return true;
  } catch (error) {
    state.localHelper = {
      available: false,
      checked: true,
      info: null
    };
    updateEngineState("需本地助手");
    if (!quiet) logLine(LOCAL_HELPER_REQUIRED_MESSAGE);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
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

function startLocalProgress(job) {
  return setInterval(() => {
    if (job.status !== "running") return;
    job.progress = Math.min(0.94, job.progress + Math.max(0.004, (0.94 - job.progress) * 0.035));
    render();
  }, 700);
}

async function readLocalHelperError(response) {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return data.error || text || `HTTP ${response.status}`;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

async function convertJobWithLocalHelper(job) {
  const settings = getSettings();
  const settingsSignature = getSettingsSignature(settings);
  const extension = getOutputExtension(settings.format);
  job.outputName = `${sanitizeName(job.file.name)}.${extension}`;
  job.outputFormat = settings.format;
  job.outputMime = getOutputMime(settings.format);
  job.outputSettingsSignature = settingsSignature;
  job.outputBlob = null;
  job.outputBytes = 0;

  job.status = "reading";
  job.progress = 0.04;
  job.error = "";
  render();

  job.status = "running";
  job.progress = 0.08;
  render();

  logLine(`本地 FFmpeg 转换 ${job.file.name} -> ${job.outputName}`);
  const progressTimer = startLocalProgress(job);
  try {
    const response = await fetch(`${LOCAL_HELPER_URL}/convert?filename=${encodeURIComponent(job.file.name)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream"
      },
      body: job.file
    });
    if (!response.ok) {
      throw new Error(await readLocalHelperError(response));
    }
    const encodedName = response.headers.get("X-Output-File-Name-B64");
    if (encodedName) {
      job.outputName = decodeBase64Utf8(encodedName);
    }
    const blob = await response.blob();
    const meta = await validateVideoBlob(blob);
    job.outputBlob = blob;
    job.outputBytes = blob.size;
    job.progress = 1;
    job.status = "ready";
    job.dimensions = `${meta.width}x${meta.height}`;
    logLine(`本地 FFmpeg 完成 ${job.outputName} (${formatBytes(job.outputBytes)})。`);
  } finally {
    clearInterval(progressTimer);
  }
}

async function convertAll() {
  state.isConverting = true;
  updateEngineState("检查助手", true);
  render();

  const useLocalHelper = await checkLocalHelper({ quiet: false });
  if (!useLocalHelper) {
    for (const job of state.jobs) {
      if (!needsConversion(job)) continue;
      job.status = "error";
      job.progress = 0;
      job.error = LOCAL_HELPER_REQUIRED_MESSAGE;
    }
    state.isConverting = false;
    updateEngineState("需本地助手");
    render();
    return;
  }

  updateEngineState("转换中", true);
  try {
    for (const job of state.jobs) {
      if (!needsConversion(job)) continue;
      state.activeJobId = job.id;
      try {
        await convertJobWithLocalHelper(job);
      } catch (error) {
        job.status = "error";
        job.progress = 0;
        job.error = getErrorMessage(error);
        logLine(`${job.file.name} failed: ${job.error}`);
      }
      await waitForIdleFrame();
      render();
    }
  } finally {
    state.activeJobId = null;
    state.isConverting = false;
    updateEngineState("本地 FFmpeg");
    render();
  }
}

function waitForIdleFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

function hasChromeDownloadsApi() {
  return Boolean(globalThis.chrome?.downloads?.download);
}

function chromeDownload(options) {
  if (!hasChromeDownloadsApi()) {
    return Promise.reject(new Error("Chrome downloads API unavailable"));
  }

  return new Promise((resolve, reject) => {
    globalThis.chrome.downloads.download(options, (downloadId) => {
      const error = globalThis.chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(downloadId);
      }
    });
  });
}

function anchorDownload(url, filename) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.split("/").pop() || "video.webm";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function triggerDownload(url, filename) {
  try {
    await chromeDownload({
      url,
      filename,
      conflictAction: "uniquify",
      saveAs: false
    });
    return "chrome";
  } catch (error) {
    anchorDownload(url, filename);
    return "browser";
  }
}

async function downloadJob(job, folder = timestampFolder(job.outputFormat)) {
  if (!job.outputBlob) return;
  const url = URL.createObjectURL(job.outputBlob);
  const filename = `${folder}/${job.outputName}`;
  try {
    const mode = await triggerDownload(url, filename);
    if (mode === "chrome") {
      logLine(`Download queued: ${filename}`);
    } else {
      logLine(`Browser download started: ${job.outputName}`);
    }
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
      try {
        await downloadJob(job, folder);
      } catch (error) {
        job.error = `下载失败：${getErrorMessage(error)}`;
        logLine(`${job.outputName} download failed: ${getErrorMessage(error)}`);
      }
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
checkLocalHelper({ quiet: true }).finally(render);
render();
