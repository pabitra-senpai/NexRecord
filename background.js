/**
 * NexRecord - background.js
 * Service Worker: Manages recording state and communicates with popup.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const MSG = {
  START_RECORDING:  'START_RECORDING',
  PAUSE_RECORDING:  'PAUSE_RECORDING',
  RESUME_RECORDING: 'RESUME_RECORDING',
  STOP_RECORDING:   'STOP_RECORDING',
  GET_STATE:        'GET_STATE',
  STATE_UPDATE:     'STATE_UPDATE',
  GET_ACTIVE_TAB:   'GET_ACTIVE_TAB',
};

const RECORDING_STATE = {
  IDLE:      'idle',
  RECORDING: 'recording',
  PAUSED:    'paused',
};

// ─── In-memory state ─────────────────────────────────────────────────────────

let state = {
  status:    RECORDING_STATE.IDLE,
  tabId:     null,
  startTime: null,
  pausedAt:  null,
  elapsed:   0,
};

// ─── Command shortcuts ────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-recording') {
    if (state.status === RECORDING_STATE.IDLE) {
      // Open popup — user must click record there
      chrome.action.openPopup?.().catch(() => {});
    } else {
      // Send message to popup to stop current recording gracefully
      chrome.runtime.sendMessage({ type: 'COMMAND_STOP' }).catch(() => {});
    }
  } else if (command === 'toggle-pause') {
    if (state.status === RECORDING_STATE.RECORDING) {
      chrome.runtime.sendMessage({ type: 'COMMAND_PAUSE' }).catch(() => {});
    } else if (state.status === RECORDING_STATE.PAUSED) {
      chrome.runtime.sendMessage({ type: 'COMMAND_RESUME' }).catch(() => {});
    }
  }
});

// ─── Message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    case MSG.GET_STATE:
      sendResponse({ success: true, state: getPublicState() });
      break;

    case MSG.START_RECORDING:
      handleStartRecording(message.tabId)
        .then((result) => sendResponse(result))
        .catch((err)  => sendResponse({ success: false, error: err.message }));
      return true;

    case MSG.PAUSE_RECORDING:
      sendResponse(handlePauseRecording());
      break;

    case MSG.RESUME_RECORDING:
      sendResponse(handleResumeRecording());
      break;

    case MSG.STOP_RECORDING:
      sendResponse(handleStopRecording());
      break;

    case MSG.GET_ACTIVE_TAB:
      chrome.tabs.query({ active: true, currentWindow: true })
        .then(([tab]) => {
          if (tab) sendResponse({ success: true, tabId: tab.id, tabUrl: tab.url });
          else     sendResponse({ success: false, error: 'No active tab.' });
        })
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleStartRecording(tabId) {
  if (state.status !== RECORDING_STATE.IDLE) {
    return { success: false, error: 'Already recording.' };
  }
  state = {
    status:    RECORDING_STATE.RECORDING,
    tabId:     tabId || null,
    startTime: Date.now(),
    pausedAt:  null,
    elapsed:   0,
  };
  broadcastState();
  return { success: true };
}

function handlePauseRecording() {
  if (state.status !== RECORDING_STATE.RECORDING) {
    return { success: false, error: 'Not recording.' };
  }
  state.elapsed  += Date.now() - state.startTime;
  state.pausedAt  = Date.now();
  state.status    = RECORDING_STATE.PAUSED;
  broadcastState();
  return { success: true, state: getPublicState() };
}

function handleResumeRecording() {
  if (state.status !== RECORDING_STATE.PAUSED) {
    return { success: false, error: 'Not paused.' };
  }
  state.startTime = Date.now();
  state.pausedAt  = null;
  state.status    = RECORDING_STATE.RECORDING;
  broadcastState();
  return { success: true, state: getPublicState() };
}

function handleStopRecording() {
  if (state.status === RECORDING_STATE.IDLE) {
    return { success: false, error: 'Nothing to stop.' };
  }
  let finalElapsed = state.elapsed;
  if (state.status === RECORDING_STATE.RECORDING && state.startTime) {
    finalElapsed += Date.now() - state.startTime;
  }
  state = {
    status: RECORDING_STATE.IDLE, tabId: null,
    startTime: null, pausedAt: null, elapsed: 0,
  };
  broadcastState();
  return { success: true, duration: finalElapsed };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPublicState() {
  const now = Date.now();
  let liveElapsed = state.elapsed;
  if (state.status === RECORDING_STATE.RECORDING && state.startTime) {
    liveElapsed += now - state.startTime;
  }
  return { status: state.status, tabId: state.tabId, elapsed: liveElapsed };
}

function broadcastState() {
  chrome.runtime.sendMessage({ type: MSG.STATE_UPDATE, state: getPublicState() })
    .catch(() => {});
}