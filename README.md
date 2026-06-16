# NexRecord 🎙️

> A lightweight, privacy-first browser extension for capturing tab audio — no servers, no API keys, completely offline.

![Version](https://img.shields.io/badge/version-1.0.0-blueviolet)
![Manifest](https://img.shields.io/badge/manifest-V3-7c4dff)
![License](https://img.shields.io/badge/license-MIT-e040fb)

---

## ✨ Features

- **Tab Audio Capture** — Records audio directly from any browser tab using Chrome's `tabCapture` API
- **Pause & Resume** — Mid-recording pause support with accurate elapsed time tracking
- **Built-in Library** — Search, sort, rename, and manage all your recordings from the popup
- **Built-in Player** — Play recordings with seek bar, speed control (0.5×–2×), and volume adjustment
- **Multiple Formats** — Export as WebM (Opus, compressed) or WAV (PCM, uncompressed)
- **Quality Presets** — Low (64 kbps), Medium (128 kbps), High (256 kbps)
- **Keyboard Shortcuts** — Start/stop and pause/resume without opening the popup
- **Theme Support** — Dark, Light, AMOLED, and System themes
- **Privacy First** — All data stays on your device via `chrome.storage.local`

---

## 🚀 Installation

### Load as an Unpacked Extension (Developer Mode)

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the root folder of this project

The NexRecord icon will appear in your Chrome toolbar.

---

## 📁 Project Structure

```
nexrecord/
├── manifest.json          # Extension manifest (V3)
├── background.js          # Service worker — recording state & tab capture
├── popup.html             # Main popup UI
├── popup.js               # Popup logic (recorder, library, player)
├── popup.css              # Popup styles
├── options.html           # Full settings page
├── options.js             # Settings logic
├── options.css            # Settings page styles
└── assets/
    └── icons/
        ├── icon16.png
        ├── icon32.png
        ├── icon48.png
        └── icon128.png
```

---

## 🎛️ How to Use

### Recording

1. Click the NexRecord icon in the toolbar to open the popup
2. Navigate to the tab you want to record
3. Click the **Record** button (or press `Ctrl+Shift+R`)
4. The waveform visualizer will animate while recording
5. Click **Stop** to finish — a save dialog will appear
6. Enter a file name and click **Save**

### Pausing

- Click the **Pause** button during recording, or press `Ctrl+Shift+P`
- Click **Resume** (or press the shortcut again) to continue
- Elapsed time pauses accurately and resumes from where you left off

### Library

- Switch to the **Library** tab to see all saved recordings
- Use the search bar to filter by name
- Sort by date, name, or duration
- Click the **Play** button on any recording to open it in the Player
- Long-press or right-click a recording for **Rename**, **Download**, or **Delete**

### Player

- Full-featured audio player with seek bar and track info
- Adjust **playback speed** (0.5× to 2×) and **volume**
- Use **Previous / Next** to cycle through your library
- Click **Download** to export the current track

---

## ⌨️ Keyboard Shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Start / Stop Recording | `Ctrl+Shift+R` | `Cmd+Shift+R` |
| Pause / Resume Recording | `Ctrl+Shift+P` | `Cmd+Shift+P` |

> Shortcuts can be customized at `chrome://extensions/shortcuts`

---

## ⚙️ Settings

Open the settings page via the gear icon in the popup header.

| Setting | Description |
|---|---|
| Default Export Format | WebM or WAV for new recordings |
| Default Audio Quality | Low / Medium / High bitrate preset |
| Auto-generate File Name | Pre-fills save dialog with date & time |
| Theme | Dark, Light, AMOLED, or System |

---

## 🔊 Audio Formats

| Format | Codec | Compression | File Size | Best For |
|---|---|---|---|---|
| WebM | Opus | Compressed | ~1 MB/min | General use, sharing |
| WAV | PCM | None | ~10 MB/min | Editing, maximum quality |

---

## 🔐 Permissions

| Permission | Reason |
|---|---|
| `tabCapture` | Capture audio stream from the active tab |
| `storage` | Save recordings and settings locally |
| `tabs` | Identify the active tab to record |
| `activeTab` | Access the currently active tab |
| `scripting` | Inject helpers when required |

> No data is ever sent to any external server. Everything stays on your device.

---

## 🧩 Technical Details

- **Manifest Version:** V3
- **Background:** Service Worker (`background.js`)
- **Audio Capture:** `chrome.tabCapture.getMediaStreamId` → `MediaRecorder` in popup context
- **Storage:** `chrome.storage.local` (5 MB limit)
- **Codecs:** Opus (WebM), PCM (WAV)
- **Supported Browsers:** Chrome, Edge, Brave, Kiwi

### Architecture Notes

The service worker (`background.js`) handles recording **state** and issues the `tabCapture` stream ID, but the actual `MediaRecorder` lives in the popup context. This avoids the service worker's memory cap and keeps audio processing in a long-lived page context.

---

## 🛠️ Development

No build step required — this is plain HTML, CSS, and JavaScript.

```bash
# Clone the repo
git clone https://github.com/your-username/nexrecord.git

# Load in Chrome
# chrome://extensions/ → Developer mode → Load unpacked → select folder
```

To make changes:
- Edit source files directly
- Go to `chrome://extensions/` and click the **refresh** icon on the NexRecord card
- Re-open the popup to see your changes

---

## 📋 Known Limitations

- Chrome's `tabCapture` API only captures audio from the **active tab** at the time recording starts
- `chrome.storage.local` has a **5 MB** quota — very long recordings in WAV format may approach this limit
- The service worker resets on browser restart; an in-progress recording is lost if the browser closes
- WAV export reconstructs PCM from WebM chunks and may not be sample-perfect on all platforms

---

## 📄 License

MIT © NexRecord Team

---

*Made with 💜 — built for the web, staying on your device.*
