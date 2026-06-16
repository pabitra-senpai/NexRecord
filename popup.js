/**
 * NexRecord – popup.js
 * Handles: recording via tabCapture + MediaRecorder, library CRUD,
 * audio player, theme system, and all UI interactions.
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const MSG = {
  START_RECORDING:  'START_RECORDING',
  PAUSE_RECORDING:  'PAUSE_RECORDING',
  RESUME_RECORDING: 'RESUME_RECORDING',
  STOP_RECORDING:   'STOP_RECORDING',
  GET_STATE:        'GET_STATE',
  STATE_UPDATE:     'STATE_UPDATE',
};

const THEMES = ['dark', 'light', 'amoled', 'system'];

const QUALITY_MAP = {
  low:    { audioBitsPerSecond: 64000  },
  medium: { audioBitsPerSecond: 128000 },
  high:   { audioBitsPerSecond: 256000 },
};

// ─── State ────────────────────────────────────────────────────────────────────

let mediaRecorder  = null;
let audioChunks    = [];
let timerInterval  = null;
let localStartTime = null;   // Date.now() when current segment started
let localElapsed   = 0;      // ms accumulated before current segment
let isPaused       = false;
let currentStatus  = 'idle'; // 'idle' | 'recording' | 'paused'
let pendingBlob    = null;   // blob awaiting save
let pendingDuration = 0;

let recordings     = [];     // array of recording metadata objects
let currentRecId   = null;   // id being played in player
let themeIndex     = 0;
let searchQuery    = '';
let sortMode       = 'date-desc';

let analyserNode   = null;
let animFrameId    = null;
let audioCtx       = null;
let sourceNode     = null;

// ─── DOM References ───────────────────────────────────────────────────────────

const dom = {
  body:           document.body,
  themeToggle:    document.getElementById('themeToggle'),
  themeIcon:      document.getElementById('themeIcon'),
  openOptions:    document.getElementById('openOptions'),
  recBadge:       document.getElementById('recBadge'),
  tabBtns:        document.querySelectorAll('.tab-btn'),
  tabPanels:      document.querySelectorAll('.tab-panel'),
  // Record tab
  vizCanvas:      document.getElementById('visualizerCanvas'),
  vizIdle:        document.getElementById('vizIdle'),
  timerText:      document.getElementById('timerText'),
  timerLabel:     document.getElementById('timerLabel'),
  btnRecord:      document.getElementById('btnRecord'),
  btnPause:       document.getElementById('btnPause'),
  btnStop:        document.getElementById('btnStop'),
  statusMsg:      document.getElementById('statusMsg'),
  qsFormat:       document.getElementById('qsFormat'),
  qsQuality:      document.getElementById('qsQuality'),
  saveDialog:     document.getElementById('saveDialog'),
  filenameInput:  document.getElementById('filenameInput'),
  btnSave:        document.getElementById('btnSave'),
  btnDiscard:     document.getElementById('btnDiscard'),
  // Library tab
  searchInput:    document.getElementById('searchInput'),
  sortSelect:     document.getElementById('sortSelect'),
  emptyState:     document.getElementById('emptyState'),
  recordingsList: document.getElementById('recordingsList'),
  // Player tab
  playerEmpty:    document.getElementById('playerEmpty'),
  playerCard:     document.getElementById('playerCard'),
  playerTrackName: document.getElementById('playerTrackName'),
  playerTrackDate: document.getElementById('playerTrackDate'),
  seekBar:        document.getElementById('seekBar'),
  playerCurrentTime: document.getElementById('playerCurrentTime'),
  playerDuration: document.getElementById('playerDuration'),
  playerPlay:     document.getElementById('playerPlay'),
  playIcon:       document.getElementById('playIcon'),
  pauseIcon:      document.getElementById('pauseIcon'),
  playerPrev:     document.getElementById('playerPrev'),
  playerNext:     document.getElementById('playerNext'),
  speedSelect:    document.getElementById('speedSelect'),
  volumeRange:    document.getElementById('volumeRange'),
  playerDownload: document.getElementById('playerDownload'),
  audioPlayer:    document.getElementById('audioPlayer'),
  // Rename modal
  renameModal:    document.getElementById('renameModal'),
  renameInput:    document.getElementById('renameInput'),
  renameCancelBtn: document.getElementById('renameCancelBtn'),
  renameConfirmBtn: document.getElementById('renameConfirmBtn'),
  toastWrap:      document.getElementById('toastWrap'),
  playerTabBtn:   document.getElementById('playerTabBtn'),
};

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  await loadSettings();
  await loadRecordings();

  bindEvents();
  renderLibrary();
  syncPlayerUI();

  // Sync state from background (in case SW restarted or popup reopened during recording)
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG.GET_STATE });
    if (res && res.success) {
      syncFromBGState(res.state);
    }
  } catch (_) { /* SW not ready */ }

  // Listen for background state pushes
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MSG.STATE_UPDATE) {
      syncFromBGState(msg.state);
    }
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function loadSettings() {
  const data = await chrome.storage.local.get(['theme', 'format', 'quality']);
  themeIndex = THEMES.indexOf(data.theme || 'dark');
  if (themeIndex < 0) themeIndex = 0;
  applyTheme();

  if (data.format)  dom.qsFormat.value  = data.format;
  if (data.quality) dom.qsQuality.value = data.quality;
}

async function saveSettings() {
  await chrome.storage.local.set({
    theme:   THEMES[themeIndex],
    format:  dom.qsFormat.value,
    quality: dom.qsQuality.value,
  });
}

// ─── Theme ────────────────────────────────────────────────────────────────────

function applyTheme() {
  const theme = THEMES[themeIndex];

  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    dom.body.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    dom.body.setAttribute('data-theme', theme);
  }

  updateThemeIcon(dom.body.getAttribute('data-theme'));
}

function updateThemeIcon(resolvedTheme) {
  const icons = {
    dark:  'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
    light: 'M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42M12 5a7 7 0 1 0 0 14A7 7 0 0 0 12 5z',
    amoled: 'M12 3a9 9 0 0 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 0 1 0 14V5z',
  };
  dom.themeIcon.setAttribute('d', icons[resolvedTheme] || icons.dark);
}

function cycleTheme() {
  themeIndex = (themeIndex + 1) % THEMES.length;
  applyTheme();
  saveSettings();
  toast(`Theme: ${THEMES[themeIndex].charAt(0).toUpperCase() + THEMES[themeIndex].slice(1)}`, 'info');
}

// ─── Tab navigation ───────────────────────────────────────────────────────────

function switchTab(tabId) {
  dom.tabBtns.forEach((btn) => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
  });
  dom.tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });
}

// ─── Recording logic ──────────────────────────────────────────────────────────

async function startRecording() {
  if (currentStatus !== 'idle') return;

  setStatus('requesting', 'Requesting tab permission…');

  const options = {
    quality: dom.qsQuality.value,
    format:  dom.qsFormat.value,
  };

  try {
    const mimeType = getSupportedMimeType(options.format);

    // ── Direct tabCapture in popup context ──────────────────────────────────
    // chrome.tabCapture.capture() works even when the tab already has audio
    // playing (YouTube etc.), unlike getMediaStreamId → getUserMedia which
    // throws "Cannot capture a tab with an active stream."
    const stream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture(
        { audio: true, video: false },
        (capturedStream) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!capturedStream) {
            reject(new Error('Tab capture returned no stream. Is another extension capturing this tab?'));
          } else {
            resolve(capturedStream);
          }
        }
      );
    });

    // Notify background so it can track state & duration
    const bgRes = await chrome.runtime.sendMessage({
      type: MSG.START_RECORDING,
      tabId: null,
    });
    if (!bgRes.success) console.warn('[NexRecord] BG state sync failed:', bgRes.error);

    const recOptions = {
      mimeType,
      ...QUALITY_MAP[options.quality],
    };

    mediaRecorder = new MediaRecorder(stream, recOptions);
    audioChunks   = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: mimeType });
      stream.getTracks().forEach((t) => t.stop());
      onRecordingStopped(blob);
    };

    // Stop recording automatically if the tab closes or navigates away
    stream.getAudioTracks()[0].addEventListener('ended', () => {
      if (currentStatus !== 'idle') stopRecording();
    });

    mediaRecorder.start(100); // collect every 100 ms

    // Set up visualizer
    setupVisualizer(stream);

    // Update local state
    currentStatus  = 'recording';
    isPaused       = false;
    localStartTime = Date.now();
    localElapsed   = 0;

    startTimer();
    updateRecordUI();
    setStatus('recording', 'Recording tab audio…');
    dom.body.classList.add('is-recording');

    // Badge
    dom.recBadge.textContent = 'REC';
    dom.recBadge.classList.add('visible');

  } catch (err) {
    console.error('[NexRecord Popup] Start error:', err);
    // Friendly messages for common errors
    let msg = err.message || 'Could not access tab audio.';
    if (msg.includes('active stream') || msg.includes('already')) {
      msg = 'Another extension is already capturing this tab. Disable it and try again.';
    } else if (msg.includes('permission') || msg.includes('denied')) {
      msg = 'Tab capture permission denied. Try closing and reopening the extension.';
    }
    setStatus('idle', msg);
    toast(msg, 'error');
  }
}

async function pauseRecording() {
  if (currentStatus !== 'recording') return;

  mediaRecorder.pause();
  pauseVisualizer();

  localElapsed += Date.now() - localStartTime;
  stopTimer();

  currentStatus = 'paused';
  isPaused = true;

  const res = await chrome.runtime.sendMessage({ type: MSG.PAUSE_RECORDING });
  if (!res.success) console.warn('BG pause failed:', res.error);

  updateRecordUI();
  setStatus('paused', 'Paused — press resume to continue.');
}

async function resumeRecording() {
  if (currentStatus !== 'paused') return;

  mediaRecorder.resume();
  resumeVisualizer();

  localStartTime = Date.now();
  startTimer();

  currentStatus = 'recording';
  isPaused = false;

  const res = await chrome.runtime.sendMessage({ type: MSG.RESUME_RECORDING });
  if (!res.success) console.warn('BG resume failed:', res.error);

  updateRecordUI();
  setStatus('recording', 'Recording tab audio…');
}

async function stopRecording() {
  if (currentStatus === 'idle') return;

  pendingDuration = localElapsed + (currentStatus === 'recording' ? Date.now() - localStartTime : 0);

  stopTimer();
  stopVisualizer();

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop(); // triggers onstop → onRecordingStopped
  }

  const res = await chrome.runtime.sendMessage({ type: MSG.STOP_RECORDING });
  if (!res.success && res.error !== 'Nothing to stop.') {
    console.warn('BG stop failed:', res.error);
  }

  currentStatus = 'idle';
  isPaused = false;
  dom.body.classList.remove('is-recording');
  dom.recBadge.classList.remove('visible');
  dom.recBadge.textContent = '';

  updateRecordUI();
  setTimerDisplay(pendingDuration);
  setStatus('idle', 'Processing…');
}

function onRecordingStopped(blob) {
  pendingBlob = blob;

  // Pre-fill filename
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  const timeStr = now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  dom.filenameInput.value = `Recording ${dateStr} ${timeStr}`;

  dom.saveDialog.classList.remove('hidden');
  dom.filenameInput.focus();
  dom.filenameInput.select();
  setStatus('idle', 'Recording complete — save or discard.');
}

async function saveRecording() {
  if (!pendingBlob) return;

  const name     = dom.filenameInput.value.trim() || 'Untitled Recording';
  const format   = dom.qsFormat.value;
  const ext      = format === 'wav' ? 'wav' : 'webm';
  const filename = `${name}.${ext}`;
  const mimeType = pendingBlob.type;

  // Convert to ArrayBuffer and store in chrome.storage.local
  const buffer = await pendingBlob.arrayBuffer();
  const uint8  = Array.from(new Uint8Array(buffer));

  const id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const meta = {
    id,
    name,
    filename,
    mimeType,
    format: ext,
    duration: pendingDuration,
    size: pendingBlob.size,
    date: new Date().toISOString(),
    quality: dom.qsQuality.value,
  };

  // Save audio data separately (key: id + '_data')
  await chrome.storage.local.set({ [`${id}_data`]: uint8 });

  // Save metadata
  recordings.unshift(meta);
  await saveRecordingsMeta();

  pendingBlob = null;
  dom.saveDialog.classList.add('hidden');
  dom.filenameInput.value = '';

  renderLibrary();
  toast(`Saved: ${name}`, 'success');
  setStatus('idle', 'Press record to capture your tab\'s audio');
}

function discardRecording() {
  pendingBlob = null;
  dom.saveDialog.classList.add('hidden');
  dom.filenameInput.value = '';
  setStatus('idle', 'Press record to capture your tab\'s audio');
  setTimerDisplay(0);
  toast('Recording discarded.', 'info');
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function loadRecordings() {
  const data = await chrome.storage.local.get('recordings_meta');
  recordings = data.recordings_meta || [];
}

async function saveRecordingsMeta() {
  await chrome.storage.local.set({ recordings_meta: recordings });
}

async function getRecordingBlob(id) {
  const data = await chrome.storage.local.get(`${id}_data`);
  const uint8 = data[`${id}_data`];
  if (!uint8) return null;
  return new Blob([new Uint8Array(uint8)], { type: getMetaById(id)?.mimeType || 'audio/webm' });
}

function getMetaById(id) {
  return recordings.find((r) => r.id === id) || null;
}

async function deleteRecording(id) {
  recordings = recordings.filter((r) => r.id !== id);
  await saveRecordingsMeta();
  await chrome.storage.local.remove(`${id}_data`);
  if (currentRecId === id) {
    currentRecId = null;
    dom.audioPlayer.src = '';
    syncPlayerUI();
  }
  renderLibrary();
  toast('Recording deleted.', 'info');
}

// ─── Library ──────────────────────────────────────────────────────────────────

function getFilteredSorted() {
  let list = recordings.slice();

  // Filter by search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter((r) => r.name.toLowerCase().includes(q));
  }

  // Sort
  const [key, dir] = sortMode.split('-');
  list.sort((a, b) => {
    let va, vb;
    if (key === 'date')     { va = new Date(a.date).getTime(); vb = new Date(b.date).getTime(); }
    else if (key === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
    else if (key === 'duration') { va = a.duration; vb = b.duration; }
    else return 0;

    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  return list;
}

function renderLibrary() {
  const list = getFilteredSorted();
  dom.recordingsList.innerHTML = '';

  if (list.length === 0) {
    dom.emptyState.classList.remove('hidden');
    return;
  }

  dom.emptyState.classList.add('hidden');

  list.forEach((rec) => {
    const li = document.createElement('li');
    li.className = 'rec-item';
    li.setAttribute('data-id', rec.id);

    const durationStr = formatDuration(rec.duration);
    const dateStr     = new Date(rec.date).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
    const sizeStr = formatBytes(rec.size);

    li.innerHTML = `
      <button class="rec-play-btn" aria-label="Play ${escapeHtml(rec.name)}" data-action="play">
        <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
      </button>
      <div class="rec-info">
        <p class="rec-name" title="${escapeHtml(rec.name)}">${escapeHtml(rec.name)}</p>
        <p class="rec-meta">${durationStr} · ${sizeStr} · ${dateStr}</p>
      </div>
      <div class="rec-actions">
        <button class="rec-action-btn" aria-label="Download" title="Download" data-action="download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button class="rec-action-btn" aria-label="Rename" title="Rename" data-action="rename">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="rec-action-btn danger" aria-label="Delete" title="Delete" data-action="delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    `;

    // Delegate events
    li.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = li.dataset.id;
      if (action === 'play')     playInPlayer(id);
      if (action === 'download') downloadRecording(id);
      if (action === 'rename')   openRenameModal(id);
      if (action === 'delete')   confirmDelete(id);
    });

    dom.recordingsList.appendChild(li);
  });
}

// ─── Player ───────────────────────────────────────────────────────────────────

async function playInPlayer(id) {
  const meta = getMetaById(id);
  if (!meta) return;

  const blob = await getRecordingBlob(id);
  if (!blob) { toast('Recording data not found.', 'error'); return; }

  const url = URL.createObjectURL(blob);
  dom.audioPlayer.src = url;
  dom.audioPlayer.playbackRate = parseFloat(dom.speedSelect.value);
  dom.audioPlayer.volume = dom.volumeRange.value / 100;
  dom.audioPlayer.play();

  currentRecId = id;
  syncPlayerUI(meta);
  switchTab('player');

  toast(`Now playing: ${meta.name}`, 'info');
}

function syncPlayerUI(meta) {
  if (!meta && currentRecId) meta = getMetaById(currentRecId);

  const hasTrack = !!meta;
  dom.playerEmpty.classList.toggle('hidden', hasTrack);
  dom.playerCard.classList.toggle('hidden', !hasTrack);

  if (hasTrack) {
    dom.playerTrackName.textContent = meta.name;
    dom.playerTrackDate.textContent = new Date(meta.date).toLocaleString('en-GB');
  }
}

function updatePlayerProgress() {
  const audio = dom.audioPlayer;
  if (!audio.duration) return;

  const pct = (audio.currentTime / audio.duration) * 100;
  dom.seekBar.value = pct;
  dom.playerCurrentTime.textContent = formatTime(audio.currentTime);
  dom.playerDuration.textContent    = formatTime(audio.duration);

  // Update seek bar gradient
  dom.seekBar.style.background = `linear-gradient(to right, var(--primary) ${pct}%, var(--bg-elevated) ${pct}%)`;
}

function getAdjacentId(delta) {
  const list = getFilteredSorted();
  const idx  = list.findIndex((r) => r.id === currentRecId);
  if (idx === -1) return null;
  const nextIdx = idx + delta;
  if (nextIdx < 0 || nextIdx >= list.length) return null;
  return list[nextIdx].id;
}

// ─── Download ─────────────────────────────────────────────────────────────────

async function downloadRecording(id) {
  const meta = getMetaById(id);
  if (!meta) return;
  const blob = await getRecordingBlob(id);
  if (!blob) { toast('Recording data not found.', 'error'); return; }

  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = meta.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`Downloading: ${meta.filename}`, 'success');
}

// ─── Rename ───────────────────────────────────────────────────────────────────

let renameTargetId = null;

function openRenameModal(id) {
  renameTargetId = id;
  const meta = getMetaById(id);
  dom.renameInput.value = meta ? meta.name : '';
  dom.renameModal.classList.remove('hidden');
  dom.renameInput.focus();
  dom.renameInput.select();
}

function closeRenameModal() {
  dom.renameModal.classList.add('hidden');
  renameTargetId = null;
}

async function confirmRename() {
  if (!renameTargetId) return;
  const newName = dom.renameInput.value.trim();
  if (!newName) { toast('Name cannot be empty.', 'error'); return; }

  const meta = getMetaById(renameTargetId);
  if (meta) {
    meta.name = newName;
    meta.filename = `${newName}.${meta.format}`;
    await saveRecordingsMeta();
    renderLibrary();
    if (currentRecId === renameTargetId) syncPlayerUI(meta);
    toast(`Renamed to: ${newName}`, 'success');
  }
  closeRenameModal();
}

function confirmDelete(id) {
  // Simple inline confirm via toast-style check
  if (window.confirm('Delete this recording? This cannot be undone.')) {
    deleteRecording(id);
  }
}

// ─── Visualizer ───────────────────────────────────────────────────────────────

function setupVisualizer(stream) {
  try {
    audioCtx    = new AudioContext();
    sourceNode  = audioCtx.createMediaStreamSource(stream);
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 256;
    sourceNode.connect(analyserNode);

    dom.vizIdle.classList.add('hidden');
    dom.vizCanvas.style.display = 'block';

    drawVisualizer();
  } catch (err) {
    console.warn('[NexRecord] Visualizer setup failed:', err);
  }
}

function drawVisualizer() {
  if (!analyserNode) return;

  const canvas = dom.vizCanvas;
  const ctx    = canvas.getContext('2d');
  const W      = canvas.width;
  const H      = canvas.height;
  const bufLen = analyserNode.frequencyBinCount;
  const data   = new Uint8Array(bufLen);

  function draw() {
    if (!analyserNode) return;
    animFrameId = requestAnimationFrame(draw);

    analyserNode.getByteFrequencyData(data);

    ctx.clearRect(0, 0, W, H);

    const barW = (W / bufLen) * 2.5;
    let x = 0;

    const theme = document.body.getAttribute('data-theme') || 'dark';
    const colors = theme === 'light'
      ? { from: '#9c27b0', to: '#5c35cc' }
      : { from: '#e040fb', to: '#7c4dff' };

    for (let i = 0; i < bufLen; i++) {
      const barH = (data[i] / 255) * H;
      const grad = ctx.createLinearGradient(0, H - barH, 0, H);
      grad.addColorStop(0, colors.from);
      grad.addColorStop(1, colors.to);

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, H - barH, barW - 1, barH, 2);
      ctx.fill();
      x += barW + 1;
    }
  }

  draw();
}

function pauseVisualizer() {
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
}

function resumeVisualizer() {
  drawVisualizer();
}

function stopVisualizer() {
  pauseVisualizer();
  analyserNode = null;

  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }

  sourceNode = null;

  const canvas = dom.vizCanvas;
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.display = 'none';
  dom.vizIdle.classList.remove('hidden');
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer() {
  stopTimer();
  timerInterval = setInterval(() => {
    const total = localElapsed + (Date.now() - localStartTime);
    setTimerDisplay(total);
  }, 250);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function setTimerDisplay(ms) {
  dom.timerText.textContent = formatDuration(ms);
}

// ─── UI sync ──────────────────────────────────────────────────────────────────

function syncFromBGState(bgState) {
  // Only update visual state; actual MediaRecorder is managed in popup
  if (bgState.status === 'idle' && currentStatus !== 'idle') {
    // BG reset (e.g. service worker restarted) – clean up
    stopTimer();
    stopVisualizer();
    currentStatus = 'idle';
    dom.body.classList.remove('is-recording');
    dom.recBadge.classList.remove('visible');
    updateRecordUI();
    setStatus('idle', 'Press record to capture your tab\'s audio');
  }
}

function updateRecordUI() {
  const isIdle      = currentStatus === 'idle';
  const isRecording = currentStatus === 'recording';
  const isPaused_   = currentStatus === 'paused';

  dom.btnRecord.disabled = !isIdle;
  dom.btnPause.disabled  = isIdle;
  dom.btnStop.disabled   = isIdle;

  // Record button appearance
  dom.btnRecord.classList.toggle('recording', isRecording || isPaused_);

  // Pause/Resume icon toggle
  dom.btnPause.innerHTML = isPaused_
    ? `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

  dom.btnPause.setAttribute('aria-label', isPaused_ ? 'Resume recording' : 'Pause recording');

  // Timer label
  if (isIdle)      dom.timerLabel.textContent = 'READY';
  if (isRecording) dom.timerLabel.textContent = 'RECORDING';
  if (isPaused_)   dom.timerLabel.textContent = 'PAUSED';
}

function setStatus(type, msg) {
  dom.statusMsg.textContent = msg;
  const colors = { recording: 'var(--rec-red)', paused: 'var(--warning)', idle: '', requesting: 'var(--primary)' };
  dom.statusMsg.style.color = colors[type] || '';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSupportedMimeType(format) {
  const candidates = format === 'wav'
    ? ['audio/wav', 'audio/wave', 'audio/webm;codecs=pcm', 'audio/webm']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];

  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return 'audio/webm';
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

function formatTime(seconds) {
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function toast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-dot"></span>${escapeHtml(msg)}`;
  dom.toastWrap.appendChild(el);

  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

// ─── Event binding ────────────────────────────────────────────────────────────

function bindEvents() {
  // Theme toggle
  dom.themeToggle.addEventListener('click', cycleTheme);

  // Open options
  dom.openOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Tab navigation
  dom.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Record controls
  dom.btnRecord.addEventListener('click', startRecording);
  dom.btnPause.addEventListener('click', () => {
    if (currentStatus === 'recording') pauseRecording();
    else if (currentStatus === 'paused') resumeRecording();
  });
  dom.btnStop.addEventListener('click', stopRecording);

  // Quick settings change → save preferences
  dom.qsFormat.addEventListener('change', saveSettings);
  dom.qsQuality.addEventListener('change', saveSettings);

  // Save dialog
  dom.btnSave.addEventListener('click', saveRecording);
  dom.btnDiscard.addEventListener('click', discardRecording);
  dom.filenameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveRecording();
    if (e.key === 'Escape') discardRecording();
  });

  // Library search & sort
  dom.searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderLibrary();
  });

  dom.sortSelect.addEventListener('change', (e) => {
    sortMode = e.target.value;
    renderLibrary();
  });

  // ── Player ──
  const audio = dom.audioPlayer;

  audio.addEventListener('timeupdate', updatePlayerProgress);

  audio.addEventListener('loadedmetadata', () => {
    dom.playerDuration.textContent = formatTime(audio.duration);
    dom.seekBar.max = 100;
  });

  audio.addEventListener('play', () => {
    dom.playIcon.classList.add('hidden');
    dom.pauseIcon.classList.remove('hidden');
  });

  audio.addEventListener('pause', () => {
    dom.playIcon.classList.remove('hidden');
    dom.pauseIcon.classList.add('hidden');
  });

  audio.addEventListener('ended', () => {
    dom.playIcon.classList.remove('hidden');
    dom.pauseIcon.classList.add('hidden');
    dom.seekBar.value = 0;
  });

  dom.playerPlay.addEventListener('click', () => {
    if (!audio.src) return;
    audio.paused ? audio.play() : audio.pause();
  });

  dom.seekBar.addEventListener('input', (e) => {
    if (!audio.duration) return;
    audio.currentTime = (e.target.value / 100) * audio.duration;
  });

  dom.speedSelect.addEventListener('change', (e) => {
    audio.playbackRate = parseFloat(e.target.value);
  });

  dom.volumeRange.addEventListener('input', (e) => {
    audio.volume = e.target.value / 100;
    dom.volumeRange.style.background =
      `linear-gradient(to right, var(--primary) ${e.target.value}%, var(--bg-elevated) ${e.target.value}%)`;
  });

  dom.playerPrev.addEventListener('click', () => {
    const id = getAdjacentId(-1);
    if (id) playInPlayer(id);
  });

  dom.playerNext.addEventListener('click', () => {
    const id = getAdjacentId(1);
    if (id) playInPlayer(id);
  });

  dom.playerDownload.addEventListener('click', () => {
    if (currentRecId) downloadRecording(currentRecId);
  });

  // ── Rename modal ──
  dom.renameCancelBtn.addEventListener('click', closeRenameModal);
  dom.renameConfirmBtn.addEventListener('click', confirmRename);
  dom.renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') closeRenameModal();
  });
  dom.renameModal.addEventListener('click', (e) => {
    if (e.target === dom.renameModal) closeRenameModal();
  });

  // ── System theme change ──
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (THEMES[themeIndex] === 'system') applyTheme();
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
