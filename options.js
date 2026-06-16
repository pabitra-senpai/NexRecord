/**
 * NexRecord – options.js
 * Full settings page: theme, audio, storage stats, sidebar navigation.
 */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let settings = {
  theme:        'dark',
  format:       'webm',
  quality:      'medium',
  autoFilename: true,
};

// ─── DOM ──────────────────────────────────────────────────────────────────────

const dom = {
  navLinks:        document.querySelectorAll('.nav-link'),
  sections:        document.querySelectorAll('.settings-section'),
  themeRadios:     document.querySelectorAll('input[name="theme"]'),
  defaultFormat:   document.getElementById('defaultFormat'),
  defaultQuality:  document.getElementById('defaultQuality'),
  autoFilename:    document.getElementById('autoFilename'),
  clearAllBtn:     document.getElementById('clearAllBtn'),
  storageUsedText: document.getElementById('storageUsedText'),
  storageBarFill:  document.getElementById('storageBarFill'),
  storageDetail:   document.getElementById('storageDetail'),
  totalRecCount:   document.getElementById('totalRecCount'),
  saveIndicator:   document.getElementById('saveIndicator'),
  exitSettingsBtn: document.getElementById('exitSettingsBtn'),
  storageLimitLabel: document.getElementById('storageLimitLabel'),
};

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  await loadSettings();
  applySettingsToUI();
  bindEvents();
  updateStorageStats();
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function loadSettings() {
  const data = await chrome.storage.local.get(['theme', 'format', 'quality', 'autoFilename']);
  settings.theme        = data.theme        || 'dark';
  settings.format       = data.format       || 'webm';
  settings.quality      = data.quality      || 'medium';
  settings.autoFilename = data.autoFilename !== undefined ? data.autoFilename : true;
}

async function persistSettings() {
  await chrome.storage.local.set(settings);
  showSaveIndicator();
}

function applySettingsToUI() {
  applyTheme(settings.theme);

  dom.themeRadios.forEach((r) => {
    r.checked = r.value === settings.theme;
  });

  dom.defaultFormat.value  = settings.format;
  dom.defaultQuality.value = settings.quality;
  dom.autoFilename.checked = settings.autoFilename;
}

// ─── Theme ────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.body.setAttribute('data-theme', theme);
  }
}

// ─── Sidebar navigation ───────────────────────────────────────────────────────

function switchSection(sectionId) {
  dom.navLinks.forEach((link) => {
    link.classList.toggle('active', link.dataset.section === sectionId);
  });
  dom.sections.forEach((sec) => {
    sec.classList.toggle('active', sec.id === `section-${sectionId}`);
  });

  if (sectionId === 'storage') updateStorageStats();
}

// ─── Storage stats (Dynamic System Quota) ─────────────────────────────────────

async function updateStorageStats() {
  const data = await chrome.storage.local.get(null);

  // Count recordings
  const meta = data.recordings_meta || [];
  dom.totalRecCount.textContent = `${meta.length} recording${meta.length !== 1 ? 's' : ''}`;

  // Estimate storage usage in bytes
  const jsonStr = JSON.stringify(data);
  const bytes   = new TextEncoder().encode(jsonStr).byteLength;
  
  // Default fallback limit of 500MB if estimate API fails
  let maxBytes = 500 * 1024 * 1024;
  let limitLabelText = "Unlimited Storage Active";

  try {
    // Dynamic Storage Estimate API to show genuine computer storage capacity
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota) {
        maxBytes = estimate.quota;
        limitLabelText = "Unlimited Storage (Device Managed)";
      }
    }
  } catch (err) {
    console.warn('Storage estimation error:', err);
  }

  const usedMB  = bytes / (1024 * 1024);
  const usedPct = Math.min((bytes / maxBytes) * 100, 100);

  dom.storageUsedText.textContent = `${usedMB.toFixed(2)} MB`;
  dom.storageBarFill.style.width  = `${usedPct.toFixed(3)}%`;
  dom.storageDetail.textContent   = `${formatBytes(bytes)} used of total storage quota`;
  if (dom.storageLimitLabel) {
    dom.storageLimitLabel.textContent = limitLabelText;
  }
}

async function clearAllRecordings() {
  const confirmed = window.confirm(
    'This will permanently delete ALL recordings and their audio data.\n\nThis cannot be undone. Continue?'
  );
  if (!confirmed) return;

  const data = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(data).filter(
    (k) => k === 'recordings_meta' || k.endsWith('_data')
  );

  await chrome.storage.local.remove(keysToRemove);
  await updateStorageStats();
  showSaveIndicator('All recordings cleared');
}

// ─── Save indicator ───────────────────────────────────────────────────────────

let saveIndicatorTimeout = null;

function showSaveIndicator(msg = 'Settings saved') {
  dom.saveIndicator.querySelector('span') && (dom.saveIndicator.querySelector('span').textContent = msg);
  dom.saveIndicator.classList.remove('hidden');

  clearTimeout(saveIndicatorTimeout);
  saveIndicatorTimeout = setTimeout(() => {
    dom.saveIndicator.classList.add('hidden');
  }, 2500);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // Sidebar navigation
  dom.navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      switchSection(link.dataset.section);
    });
  });

  // Theme radios
  dom.themeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      settings.theme = radio.value;
      applyTheme(settings.theme);
      persistSettings();
    });
  });

  // Default format
  dom.defaultFormat.addEventListener('change', () => {
    settings.format = dom.defaultFormat.value;
    persistSettings();
  });

  // Default quality
  dom.defaultQuality.addEventListener('change', () => {
    settings.quality = dom.defaultQuality.value;
    persistSettings();
  });

  // Auto filename toggle
  dom.autoFilename.addEventListener('change', () => {
    settings.autoFilename = dom.autoFilename.checked;
    persistSettings();
  });

  // Clear all
  dom.clearAllBtn.addEventListener('click', clearAllRecordings);

  // System theme change
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.theme === 'system') applyTheme('system');
  });

  // Dynamic Back/Exit Settings tab close event
  if (dom.exitSettingsBtn) {
    dom.exitSettingsBtn.addEventListener('click', () => {
      window.close(); // Closes options page tab seamlessly
    });
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);