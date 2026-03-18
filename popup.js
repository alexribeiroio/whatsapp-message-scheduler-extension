/**
 * WhatsApp Message Scheduler - Popup Script
 */

// ─── State ────────────────────────────────────────────────────────────────────

let allMessages = [];

// ─── DOM Refs ─────────────────────────────────────────────────────────────────

const tabs           = document.querySelectorAll('.tab');
const tabContents    = document.querySelectorAll('.tab-content');
const scheduleForm   = document.getElementById('scheduleForm');
const recipientInput = document.getElementById('recipient');
const messageInput   = document.getElementById('message');
const charCount      = document.getElementById('charCount');
const schedDate      = document.getElementById('schedDate');
const schedTime      = document.getElementById('schedTime');
const recurrenceType = document.getElementById('recurrenceType');
const weeklyOptions  = document.getElementById('weeklyOptions');
const monthlyOptions = document.getElementById('monthlyOptions');
const customOptions  = document.getElementById('customOptions');
const recurrenceEnd  = document.getElementById('recurrenceEnd');
const dayOfMonth     = document.getElementById('dayOfMonth');
const customInterval = document.getElementById('customInterval');
const customUnit     = document.getElementById('customUnit');
const endDate        = document.getElementById('endDate');
const endAfterCount  = document.getElementById('endAfterCount');
const formError      = document.getElementById('formError');
const pendingBadge   = document.getElementById('pendingBadge');
const scheduledList  = document.getElementById('scheduledList');
const historyList    = document.getElementById('historyList');
const historyCount   = document.getElementById('historyCount');
const searchScheduled = document.getElementById('searchScheduled');
const btnOptions     = document.getElementById('btnOptions');
const btnClearHistory = document.getElementById('btnClearHistory');
const waStatus       = document.getElementById('waStatus');

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  setMinDateTime();
  await loadMessages();
  checkWhatsAppStatus();
  setupEventListeners();
});

function setMinDateTime() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  schedDate.value = dateStr;
  schedTime.value = timeStr;
  schedDate.min = dateStr;
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
  // Tab switching
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Message character counter
  messageInput.addEventListener('input', () => {
    const len = messageInput.value.length;
    charCount.textContent = `${len} / 4096`;
    charCount.style.color = len > 3800 ? '#e44' : '#aaa';
  });

  // Recurrence type change
  recurrenceType.addEventListener('change', updateRecurrenceUI);

  // Form submit
  scheduleForm.addEventListener('submit', handleFormSubmit);

  // Filter scheduled
  searchScheduled.addEventListener('input', renderScheduled);

  // Options page
  btnOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // Clear history
  btnClearHistory.addEventListener('click', handleClearHistory);

  // Live storage updates
  chrome.storage.local.onChanged.addListener((changes) => {
    if (changes.scheduledMessages) {
      allMessages = changes.scheduledMessages.newValue || [];
      renderScheduled();
      renderHistory();
      updateBadge();
    }
  });
}

// ─── Tab Logic ────────────────────────────────────────────────────────────────

function switchTab(name) {
  tabs.forEach((t) => t.classList.toggle('tab--active', t.dataset.tab === name));
  tabContents.forEach((c) => {
    const active = c.id === `tab-${name}`;
    c.classList.toggle('tab-content--active', active);
    c.style.display = active ? 'flex' : 'none';
  });
}

// ─── Recurrence UI ────────────────────────────────────────────────────────────

function updateRecurrenceUI() {
  const type = recurrenceType.value;
  weeklyOptions.classList.toggle('hidden', type !== 'weekly');
  monthlyOptions.classList.toggle('hidden', type !== 'monthly');
  customOptions.classList.toggle('hidden', type !== 'custom');
  recurrenceEnd.classList.toggle('hidden', type === 'none');
}

// ─── Load & Render ────────────────────────────────────────────────────────────

async function loadMessages() {
  const { scheduledMessages = [] } = await chrome.storage.local.get('scheduledMessages');
  allMessages = scheduledMessages;
  renderScheduled();
  renderHistory();
  updateBadge();
}

function renderScheduled() {
  const filter = searchScheduled.value.trim().toLowerCase();
  const msgs = allMessages
    .filter((m) => ['pending', 'sending'].includes(m.status))
    .filter((m) =>
      !filter ||
      m.recipient.toLowerCase().includes(filter) ||
      m.message.toLowerCase().includes(filter)
    )
    .sort((a, b) => a.scheduledTime - b.scheduledTime);

  scheduledList.innerHTML = '';
  if (msgs.length === 0) {
    scheduledList.innerHTML = emptyState('📭', 'Nenhuma mensagem agendada');
    return;
  }
  msgs.forEach((m) => scheduledList.appendChild(buildCard(m)));
}

function renderHistory() {
  const msgs = allMessages
    .filter((m) => ['sent', 'failed', 'cancelled'].includes(m.status))
    .sort((a, b) => (b.sentAt || b.createdAt) - (a.sentAt || a.createdAt));

  historyCount.textContent = msgs.length ? `${msgs.length} registro(s)` : '';
  historyList.innerHTML = '';

  if (msgs.length === 0) {
    historyList.innerHTML = emptyState('📜', 'Nenhum histórico disponível');
    return;
  }
  msgs.forEach((m) => historyList.appendChild(buildCard(m)));
}

function updateBadge() {
  const count = allMessages.filter((m) => m.status === 'pending').length;
  pendingBadge.textContent = count;
  pendingBadge.classList.toggle('hidden', count === 0);
}

// ─── Card Builder ─────────────────────────────────────────────────────────────

function buildCard(msg) {
  const card = document.createElement('div');
  card.className = `msg-card msg-card--${msg.status}`;
  card.dataset.id = msg.id;

  const statusLabels = {
    pending: 'Agendada',
    sending: 'Enviando...',
    sent: 'Enviada',
    failed: 'Falhou',
    cancelled: 'Cancelada'
  };

  const scheduledStr = formatDateTime(msg.scheduledTime);
  const recurrenceStr = formatRecurrence(msg.recurrence);
  const isPending = msg.status === 'pending';
  const isFailed  = msg.status === 'failed';

  card.innerHTML = `
    <div class="msg-card-header">
      <span class="msg-recipient" title="${escHtml(msg.recipient)}">
        ${escHtml(msg.recipient)}
      </span>
      <span class="msg-status status--${msg.status}">${statusLabels[msg.status] || msg.status}</span>
    </div>
    <div class="msg-preview" title="${escHtml(msg.message)}">${escHtml(truncate(msg.message, 80))}</div>
    <div class="msg-meta">
      <span>🕐 ${scheduledStr}</span>
      ${recurrenceStr ? `<span class="recurrence-badge">🔁 ${recurrenceStr}</span>` : ''}
      ${msg.failureReason ? `<span title="${escHtml(msg.failureReason)}" style="color:#e44">⚠ Erro</span>` : ''}
    </div>
    <div class="msg-card-actions">
      ${isPending ? `<button class="action-btn primary" data-action="sendNow">▶ Enviar agora</button>` : ''}
      ${isFailed  ? `<button class="action-btn primary" data-action="retry">↺ Tentar novamente</button>` : ''}
      ${isPending ? `<button class="action-btn"        data-action="cancel">⊘ Cancelar</button>` : ''}
      <button class="action-btn danger" data-action="delete">🗑 Excluir</button>
    </div>
  `;

  card.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleCardAction(btn.dataset.action, msg.id);
    });
  });

  return card;
}

function emptyState(icon, text) {
  return `<div class="empty-state"><span class="empty-icon">${icon}</span><p>${text}</p></div>`;
}

// ─── Card Actions ─────────────────────────────────────────────────────────────

async function handleCardAction(action, id) {
  switch (action) {
    case 'sendNow':
      if (!(await confirmWhatsAppOpen())) return;
      chrome.runtime.sendMessage({ action: 'sendNow', id }, (r) => {
        toast(r?.success ? 'Enviando mensagem…' : 'Erro: ' + r?.error, r?.success ? 'success' : 'error');
      });
      break;

    case 'retry':
      chrome.runtime.sendMessage({ action: 'sendNow', id }, (r) => {
        toast(r?.success ? 'Tentando novamente…' : 'Erro: ' + r?.error, r?.success ? 'success' : 'error');
      });
      break;

    case 'cancel':
      chrome.runtime.sendMessage({ action: 'cancelMessage', id }, () => {
        toast('Mensagem cancelada');
        loadMessages();
      });
      break;

    case 'delete':
      chrome.runtime.sendMessage({ action: 'deleteMessage', id }, () => {
        toast('Mensagem excluída');
        loadMessages();
      });
      break;
  }
}

// ─── Form Submit ──────────────────────────────────────────────────────────────

async function handleFormSubmit(e) {
  e.preventDefault();
  hideError();

  const recipient = recipientInput.value.trim();
  const message   = messageInput.value.trim();
  const dateStr   = schedDate.value;
  const timeStr   = schedTime.value;

  if (!recipient || !message || !dateStr || !timeStr) {
    showError('Preencha todos os campos obrigatórios.');
    return;
  }

  const scheduledTime = new Date(`${dateStr}T${timeStr}`).getTime();
  if (isNaN(scheduledTime)) {
    showError('Data ou hora inválida.');
    return;
  }

  if (scheduledTime < Date.now() - 60000) {
    showError('O horário agendado está no passado.');
    return;
  }

  const recurrence = buildRecurrence();
  if (!recurrence) return; // error shown inside

  const data = { recipient, message, scheduledTime, recurrence };

  chrome.runtime.sendMessage({ action: 'addMessage', message: data }, (response) => {
    if (response?.success) {
      toast('Mensagem agendada com sucesso!', 'success');
      scheduleForm.reset();
      setMinDateTime();
      updateRecurrenceUI();
      loadMessages();
      switchTab('scheduled');
    } else {
      showError('Erro ao salvar: ' + (response?.error || 'desconhecido'));
    }
  });
}

function buildRecurrence() {
  const type = recurrenceType.value;

  if (type === 'none') {
    return { type: 'none' };
  }

  const endDateVal    = endDate.value ? new Date(endDate.value).getTime() : null;
  const endCountVal   = parseInt(endAfterCount.value) || null;

  if (type === 'weekly') {
    const daysOfWeek = Array.from(
      weeklyOptions.querySelectorAll('input[type=checkbox]:checked')
    ).map((cb) => parseInt(cb.value));

    if (daysOfWeek.length === 0) {
      showError('Selecione pelo menos um dia da semana.');
      return null;
    }

    return { type, daysOfWeek, endDate: endDateVal, endAfterCount: endCountVal };
  }

  if (type === 'monthly') {
    return {
      type,
      dayOfMonth: parseInt(dayOfMonth.value) || 1,
      endDate: endDateVal,
      endAfterCount: endCountVal
    };
  }

  if (type === 'custom') {
    const interval = parseInt(customInterval.value) || 1;
    const unit = customUnit.value;
    return { type, interval, unit, endDate: endDateVal, endAfterCount: endCountVal };
  }

  return { type, endDate: endDateVal, endAfterCount: endCountVal };
}

// ─── Clear History ────────────────────────────────────────────────────────────

async function handleClearHistory() {
  const histMsgs = allMessages.filter((m) => ['sent', 'failed', 'cancelled'].includes(m.status));
  if (histMsgs.length === 0) return;
  chrome.runtime.sendMessage({ action: 'clearHistory' }, () => {
    toast('Histórico limpo');
    loadMessages();
  });
}

// ─── WhatsApp Status Check ────────────────────────────────────────────────────

async function checkWhatsAppStatus() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
    const open = res?.whatsappOpen;
    waStatus.className = `wa-status ${open ? 'wa-status--open' : 'wa-status--closed'}`;
    waStatus.title = open ? 'WhatsApp Web está aberto' : 'WhatsApp Web não está aberto';
  });
}

async function confirmWhatsAppOpen() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
      if (res?.whatsappOpen) {
        resolve(true);
      } else {
        showError('Abra o WhatsApp Web antes de enviar.');
        resolve(false);
      }
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRecurrence(rec) {
  if (!rec || rec.type === 'none') return '';
  const labels = {
    daily: 'Diária',
    weekly: 'Semanal',
    monthly: 'Mensal',
    custom: `A cada ${rec.interval} ${rec.unit}`
  };
  return labels[rec.type] || rec.type;
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showError(msg) {
  formError.textContent = msg;
  formError.classList.remove('hidden');
}

function hideError() {
  formError.classList.add('hidden');
}

let toastTimer;
function toast(msg, type = '') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
