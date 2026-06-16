/**
 * NexRecord - background.js
 * Service Worker: Handles tab audio capture, recording state,
 * and communication between popup and content scripts.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const MSG = {
  START_RECORDING:  'START_RECORDING',
  PAUSE_RECORDING:  'PAUSE_RECORDING',
  RESUME_RECORDING: 'RESUME_RECORDING',
  STOP_RECORDING:   'STOP_RECORDING',
  GET_STATE:        'GET_STATE',
  STATE_UPDATE:     'STATE_UPDATE',
  RECORDING_DONE:   'RECORDING_DONE',
  ERROR:            'ERROR',
};

const RECORDING_STATE = {
  IDLE:      'idle',
  RECORDING: 'recording',
  PAUSED:    'paused',
};

// ─── In-memory state (lives in SW; resets on SW restart) ─────────────────────

let state = {
  status:     RECORDING_STATE.IDLE,
  tabId:      null,
  startTime:  null,
  pausedAt:   null,
  elapsed:    0,          // ms accumulated before current segment
  streamId:   null,
};

// ─── Command shortcuts ────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-recording') {
    if (state.status === RECORDING_STATE.IDLE) {
      handleStartRecording();
    } else {
      handleStopRecording();
    }
  } else if (command === 'toggle-pause') {
    if (state.status === RECORDING_STATE.RECORDING) {
      handlePauseRecording();
    } else if (state.status === RECORDING_STATE.PAUSED) {
      handleResumeRecording();
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
      handleStartRecording(message.options)
        .then((result) => sendResponse(result))
        .catch((err)  => sendResponse({ success: false, error: err.message }));
      return true; // async

    case MSG.PAUSE_RECORDING:
      sendResponse(handlePauseRecording());
      break;

    case MSG.RESUME_RECORDING:
      sendResponse(handleResumeRecording());
      break;

    case MSG.STOP_RECORDING:
      sendResponse(handleStopRecording());
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * Begin capturing the active tab's audio.
 * @param {object} options - { quality, format }
 */
async function handleStartRecording(options = {}) {
  if (state.status !== RECORDING_STATE.IDLE) {
    return { success: false, error: 'Already recording.' };
  }

  try {
    // Get the currently active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      return { success: false, error: 'No active tab found.' };
    }

    // chrome.tabCapture requires the call to happen in response to a user
    // gesture; we relay the stream ID back to the popup which does the actual
    // MediaRecorder work so the audio never touches the SW (avoids memory cap).
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId(
        { targetTabId: tab.id },
        (id) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(id);
          }
        }
      );
    });

    state = {
      status:    RECORDING_STATE.RECORDING,
      tabId:     tab.id,
      startTime: Date.now(),
      pausedAt:  null,
      elapsed:   0,
      streamId,
    };

    broadcastState();
    return { success: true, streamId, tabId: tab.id, options };
  } catch (err) {
    console.error('[NexRecord BG] Start error:', err);
    return { success: false, error: err.message };
  }
}

function handlePauseRecording() {
  if (state.status !== RECORDING_STATE.RECORDING) {
    return { success: false, error: 'Not recording.' };
  }
  // Accumulate elapsed time
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

  // Calculate final duration
  let finalElapsed = state.elapsed;
  if (state.status === RECORDING_STATE.RECORDING && state.startTime) {
    finalElapsed += Date.now() - state.startTime;
  }

  state = {
    status:     RECORDING_STATE.IDLE,
    tabId:      null,
    startTime:  null,
    pausedAt:   null,
    elapsed:    0,
    streamId:   null,
  };

  broadcastState();
  return { success: true, duration: finalElapsed };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip internal fields before sending state to popup */
function getPublicState() {
  const now = Date.now();
  let liveElapsed = state.elapsed;
  if (state.status === RECORDING_STATE.RECORDING && state.startTime) {
    liveElapsed += now - state.startTime;
  }
  return {
    status:  state.status,
    tabId:   state.tabId,
    elapsed: liveElapsed,
  };
}

/** Notify all extension pages of the current state */
function broadcastState() {
  chrome.runtime.sendMessage({
    type:  MSG.STATE_UPDATE,
    state: getPublicState(),
  }).catch(() => {
    // Popup may be closed – silently ignore
  });
}
