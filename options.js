/**
 * WhatsApp Message Scheduler - Options Page Script
 */

const DEFAULT_SETTINGS = {
  processingInterval: 1,
  maxRetries: 3,
  minDelay: 5,
  maxDelay: 15,
  notifyOnSend: true,
  notifyOnFailure: true,
  autoOpenWhatsApp: false,
  historyRetentionDays: 30
};

const fields = {
  processingInterval: document.getElementById('processingInterval'),
  maxRetries:         document.getElementById('maxRetries'),
  minDelay:           document.getElementById('minDelay'),
  maxDelay:           document.getElementById('maxDelay'),
  notifyOnSend:       document.getElementById('notifyOnSend'),
  notifyOnFailure:    document.getElementById('notifyOnFailure'),
  autoOpenWhatsApp:   document.getElementById('autoOpenWhatsApp'),
  historyRetentionDays: document.getElementById('historyRetentionDays')
};

const saveMsg = document.getElementById('saveMsg');
const form    = document.getElementById('settingsForm');
const btnReset = document.getElementById('btnReset');

// ─── Load Settings ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
  applyToForm({ ...DEFAULT_SETTINGS, ...settings });

  form.addEventListener('submit', handleSave);
  btnReset.addEventListener('click', handleReset);
});

function applyToForm(settings) {
  for (const [key, el] of Object.entries(fields)) {
    if (!el) continue;
    if (el.type === 'checkbox') {
      el.checked = !!settings[key];
    } else {
      el.value = settings[key] ?? DEFAULT_SETTINGS[key] ?? '';
    }
  }
}

// ─── Save Settings ────────────────────────────────────────────────────────────

async function handleSave(e) {
  e.preventDefault();

  const minDelay = parseInt(fields.minDelay.value) || 5;
  const maxDelay = parseInt(fields.maxDelay.value) || 15;

  if (minDelay > maxDelay) {
    alert('O intervalo mínimo não pode ser maior que o máximo.');
    return;
  }

  const settings = {
    processingInterval:   Math.max(1, parseInt(fields.processingInterval.value) || 1),
    maxRetries:           Math.max(1, parseInt(fields.maxRetries.value) || 3),
    minDelay,
    maxDelay,
    notifyOnSend:         fields.notifyOnSend.checked,
    notifyOnFailure:      fields.notifyOnFailure.checked,
    autoOpenWhatsApp:     fields.autoOpenWhatsApp.checked,
    historyRetentionDays: Math.max(1, parseInt(fields.historyRetentionDays.value) || 30)
  };

  chrome.runtime.sendMessage({ action: 'updateSettings', settings }, (res) => {
    if (res?.success) {
      showSaveMsg();
    }
  });
}

async function handleReset() {
  if (!confirm('Restaurar todas as configurações para os valores padrão?')) return;
  applyToForm(DEFAULT_SETTINGS);
  chrome.runtime.sendMessage({ action: 'updateSettings', settings: DEFAULT_SETTINGS }, () => {
    showSaveMsg();
  });
}

function showSaveMsg() {
  saveMsg.classList.remove('hidden');
  setTimeout(() => saveMsg.classList.add('hidden'), 2500);
}
