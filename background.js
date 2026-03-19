/**
 * WhatsApp Message Scheduler - Background Service Worker
 * Handles scheduling, alarm management, and message queue processing.
 */

const ALARM_NAME = 'whatsapp-scheduler';

const DEFAULT_SETTINGS = {
  processingInterval: 1, // minutes
  maxRetries: 3,
  minDelay: 5,  // seconds between messages
  maxDelay: 15, // seconds between messages
  notifyOnSend: true,
  notifyOnFailure: true,
  autoOpenWhatsApp: false,
  historyRetentionDays: 30
};

// ─── Initialization ───────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await initDefaultSettings();
  await initAlarm();
  await cleanOldHistory();

  // Recarrega abas abertas do WhatsApp Web para que os novos content scripts
  // (incluindo page-bridge.js) sejam injetados corretamente.
  setTimeout(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    for (const tab of tabs) {
      chrome.tabs.reload(tab.id);
    }
  }, 500);
});

chrome.runtime.onStartup.addListener(async () => {
  await initAlarm();
});

async function initAlarm() {
  const alarm = await chrome.alarms.get(ALARM_NAME);
  if (!alarm) {
    const settings = await getSettings();
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 0.1, // fire soon after startup
      periodInMinutes: settings.processingInterval
    });
  }
}

async function initDefaultSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
}

// ─── Alarm Handler ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await processScheduledMessages();
  }
});

async function processScheduledMessages() {
  const now = Date.now();
  let { scheduledMessages = [], settings = DEFAULT_SETTINGS } =
    await chrome.storage.local.get(['scheduledMessages', 'settings']);

  // Recupera mensagens travadas em 'sending' por mais de 15 min (browser fechou a meio envio)
  const STUCK_MS = 15 * 60 * 1000;
  let stuckFixed = false;
  for (const msg of scheduledMessages) {
    if (msg.status === 'sending' && msg.lastAttemptAt && (now - msg.lastAttemptAt) > STUCK_MS) {
      msg.status = 'pending';
      stuckFixed = true;
    }
  }
  if (stuckFixed) {
    await chrome.storage.local.set({ scheduledMessages });
  }

  const dueMessages = scheduledMessages.filter(
    (msg) => msg.status === 'pending' && msg.scheduledTime <= now
  );

  if (dueMessages.length === 0) return;

  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });

  if (tabs.length === 0) {
    if (settings.autoOpenWhatsApp) {
      await chrome.tabs.create({ url: 'https://web.whatsapp.com', active: false });
      // Can't guarantee it's ready immediately; will process on next alarm tick
    }
    showNotification('whatsapp-not-open', 'WhatsApp não está aberto', {
      message: `${dueMessages.length} mensagem(ns) aguardando. Abra o WhatsApp Web para enviar.`
    });
    return;
  }

  const tab = tabs[0];
  const minDelay = (settings.minDelay || 5) * 1000;
  const maxDelay = (settings.maxDelay || 15) * 1000;

  for (const message of dueMessages) {
    await updateMessageField(message.id, { status: 'sending', lastAttemptAt: now });

    try {
      const result = await sendViaContentScript(tab.id, message);

      if (result.success) {
        await handleSuccess(message, settings);
      } else {
        throw new Error(result.error || 'Resposta inválida do script');
      }
    } catch (err) {
      await handleFailure(message, err.message, settings);
    }

    const delay = minDelay + Math.random() * (maxDelay - minDelay);
    await sleep(delay);
  }

  await cleanOldHistory();
}

// ─── Content Script Communication ─────────────────────────────────────────────

function sendViaContentScript(tabId, message) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ success: false, error: 'Timeout: WhatsApp demorou demais para responder' });
    }, 45000);

    chrome.tabs.sendMessage(
      tabId,
      { action: 'sendMessage', recipient: message.recipient, message: message.message },
      (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: 'Sem resposta do script' });
        }
      }
    );
  });
}

// ─── Message State Management ─────────────────────────────────────────────────

async function handleSuccess(message, settings) {
  const { scheduledMessages = [] } = await chrome.storage.local.get('scheduledMessages');
  const idx = scheduledMessages.findIndex((m) => m.id === message.id);
  if (idx === -1) return;

  const now = Date.now();
  const newCount = (message.occurrenceCount || 0) + 1;

  scheduledMessages[idx].sentAt = now;
  scheduledMessages[idx].occurrenceCount = newCount;
  scheduledMessages[idx].retryCount = 0;
  scheduledMessages[idx].failureReason = null;

  const nextTime = calculateNextOccurrence(message);
  const continueRecurring = nextTime && checkShouldContinue(message, nextTime, newCount);

  if (continueRecurring) {
    scheduledMessages[idx].scheduledTime = nextTime;
    scheduledMessages[idx].status = 'pending';
    scheduledMessages[idx].lastAttemptAt = now;
    scheduledMessages[idx].sentAt = null;
  } else {
    scheduledMessages[idx].status = 'sent';
  }

  await chrome.storage.local.set({ scheduledMessages });

  if (settings.notifyOnSend) {
    showNotification(`sent-${message.id}`, 'Mensagem Enviada', {
      message: `Para ${message.recipient}: "${truncate(message.message, 60)}"`
    });
  }
}

async function handleFailure(message, errorMsg, settings) {
  const { scheduledMessages = [], settings: s = DEFAULT_SETTINGS } =
    await chrome.storage.local.get(['scheduledMessages', 'settings']);
  const maxRetries = (settings || s).maxRetries || 3;

  const idx = scheduledMessages.findIndex((m) => m.id === message.id);
  if (idx === -1) return;

  const retryCount = (message.retryCount || 0) + 1;
  scheduledMessages[idx].retryCount = retryCount;
  scheduledMessages[idx].lastAttemptAt = Date.now();
  scheduledMessages[idx].failureReason = errorMsg;

  if (retryCount >= maxRetries) {
    scheduledMessages[idx].status = 'failed';
    if (settings.notifyOnFailure) {
      showNotification(`fail-${message.id}`, 'Falha ao Enviar', {
        message: `Para ${message.recipient}: ${errorMsg}`
      });
    }
  } else {
    // Retry in 5 minutes
    scheduledMessages[idx].status = 'pending';
    scheduledMessages[idx].scheduledTime = Date.now() + 5 * 60 * 1000;
  }

  await chrome.storage.local.set({ scheduledMessages });
}

async function updateMessageField(id, fields) {
  const { scheduledMessages = [] } = await chrome.storage.local.get('scheduledMessages');
  const idx = scheduledMessages.findIndex((m) => m.id === id);
  if (idx !== -1) {
    Object.assign(scheduledMessages[idx], fields);
    await chrome.storage.local.set({ scheduledMessages });
  }
}

// ─── Recurrence Logic ─────────────────────────────────────────────────────────

function calculateNextOccurrence(message) {
  const { recurrence, scheduledTime } = message;
  if (!recurrence || recurrence.type === 'none') return null;

  const base = new Date(scheduledTime);

  switch (recurrence.type) {
    case 'daily': {
      const next = new Date(base);
      next.setDate(next.getDate() + 1);
      return next.getTime();
    }

    case 'weekdays': {
      const next = new Date(base);
      next.setDate(next.getDate() + 1);
      while (next.getDay() === 0 || next.getDay() === 6) {
        next.setDate(next.getDate() + 1);
      }
      return next.getTime();
    }

    case 'weekly': {
      const days = recurrence.daysOfWeek?.length ? recurrence.daysOfWeek : [base.getDay()];
      const next = new Date(base);
      next.setDate(next.getDate() + 1);
      for (let i = 0; i < 7; i++) {
        if (days.includes(next.getDay())) return next.getTime();
        next.setDate(next.getDate() + 1);
      }
      return null;
    }

    case 'monthly': {
      const next = new Date(base);
      const day = recurrence.dayOfMonth || base.getDate();
      next.setMonth(next.getMonth() + 1);
      const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, daysInMonth));
      return next.getTime();
    }

    case 'custom': {
      const multipliers = {
        minutes: 60 * 1000,
        hours: 60 * 60 * 1000,
        days: 24 * 60 * 60 * 1000,
        weeks: 7 * 24 * 60 * 60 * 1000
      };
      const ms = (recurrence.interval || 1) * (multipliers[recurrence.unit] || 60000);
      return scheduledTime + ms;
    }

    default:
      return null;
  }
}

function checkShouldContinue(message, nextTime, newCount) {
  const { recurrence } = message;
  if (!recurrence || recurrence.type === 'none') return false;
  if (!nextTime) return false;
  if (recurrence.endDate && nextTime > recurrence.endDate) return false;
  if (recurrence.endAfterCount && newCount >= recurrence.endAfterCount) return false;
  return true;
}

// ─── Popup Message Handlers ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'addMessage':
      addScheduledMessage(request.message).then(sendResponse);
      return true;
    case 'deleteMessage':
      deleteScheduledMessage(request.id).then(sendResponse);
      return true;
    case 'cancelMessage':
      cancelScheduledMessage(request.id).then(sendResponse);
      return true;
    case 'sendNow':
      sendMessageNow(request.id).then(sendResponse);
      return true;
    case 'updateSettings':
      updateSettings(request.settings).then(sendResponse);
      return true;
    case 'clearHistory':
      clearHistory().then(sendResponse);
      return true;
    case 'getStatus':
      getStatus().then(sendResponse);
      return true;
  }
});

async function addScheduledMessage(data) {
  const { scheduledMessages = [] } = await chrome.storage.local.get('scheduledMessages');

  const msg = {
    id: crypto.randomUUID(),
    recipient: data.recipient,
    message: data.message,
    scheduledTime: data.scheduledTime,
    recurrence: data.recurrence || { type: 'none' },
    status: 'pending',
    createdAt: Date.now(),
    lastAttemptAt: null,
    sentAt: null,
    failureReason: null,
    retryCount: 0,
    occurrenceCount: 0
  };

  scheduledMessages.push(msg);
  await chrome.storage.local.set({ scheduledMessages });
  return { success: true, id: msg.id };
}

async function deleteScheduledMessage(id) {
  const { scheduledMessages = [] } = await chrome.storage.local.get('scheduledMessages');
  await chrome.storage.local.set({ scheduledMessages: scheduledMessages.filter((m) => m.id !== id) });
  return { success: true };
}

async function cancelScheduledMessage(id) {
  await updateMessageField(id, { status: 'cancelled' });
  return { success: true };
}

async function sendMessageNow(id) {
  await updateMessageField(id, { scheduledTime: Date.now() - 1 });
  await processScheduledMessages();
  return { success: true };
}

async function updateSettings(newSettings) {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
  const updated = { ...settings, ...newSettings };
  await chrome.storage.local.set({ settings: updated });

  if (newSettings.processingInterval) {
    await chrome.alarms.clear(ALARM_NAME);
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: newSettings.processingInterval });
  }

  return { success: true };
}

async function clearHistory() {
  const { scheduledMessages = [] } = await chrome.storage.local.get('scheduledMessages');
  const keep = scheduledMessages.filter((m) => ['pending', 'sending'].includes(m.status));
  await chrome.storage.local.set({ scheduledMessages: keep });
  return { success: true };
}

async function getStatus() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  return { whatsappOpen: tabs.length > 0 };
}

// ─── Maintenance ──────────────────────────────────────────────────────────────

async function cleanOldHistory() {
  const { scheduledMessages = [], settings = DEFAULT_SETTINGS } =
    await chrome.storage.local.get(['scheduledMessages', 'settings']);
  const days = settings.historyRetentionDays || 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const cleaned = scheduledMessages.filter(
    (m) => m.status === 'pending' || m.status === 'sending' || (m.sentAt || m.createdAt) > cutoff
  );

  if (cleaned.length !== scheduledMessages.length) {
    await chrome.storage.local.set({ scheduledMessages: cleaned });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  // Merge com DEFAULT_SETTINGS para que novos campos adicionados em updates
  // tenham seus valores padrão mesmo em configurações existentes.
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function showNotification(id, title, opts = {}) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message: opts.message || '',
    priority: 1
  });
}
