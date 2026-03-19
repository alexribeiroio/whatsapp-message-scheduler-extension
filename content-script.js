/**
 * WhatsApp Message Scheduler - Content Script
 *
 * Confirmed selectors (inspected live on web.whatsapp.com, Mar 2026):
 *   Search input  : #side input[type="text"]   (regular <input>, NOT contenteditable)
 *   Search result : #pane-side span[title="NAME"] → closest('[tabindex="-1"]')
 *   Compose box   : .lexical-rich-text-input [contenteditable]  (Lexical editor, data-tab="10")
 *   Send button   : button[aria-label="Enviar"]   (no data-testid in new UI)
 */

// ─── Selectors ────────────────────────────────────────────────────────────────

const COMPOSE_SELS = [
  '.lexical-rich-text-input [contenteditable]',
  'div[data-tab="10"][data-lexical-editor="true"]',
  'footer div[contenteditable="true"]',
  'div[role="textbox"][aria-placeholder*="mensagem"]',
  'div[role="textbox"][aria-placeholder*="message"]'
];

const SEND_SELS = [
  'button[aria-label="Enviar"]',
  'button[aria-label="Send"]',
  'button[data-tab="11"]'
];

// ─── Utilities ─────────────────────────────────────────────────────────────────

function findEl(sels) {
  for (const s of (Array.isArray(sels) ? sels : [sels])) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

function waitFor(sels, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const list = Array.isArray(sels) ? sels : [sels];
    const existing = findEl(list);
    if (existing) { resolve(existing); return; }

    let done = false;
    const finish = (val, err) => {
      if (done) return;
      done = true;
      obs.disconnect();
      clearTimeout(timer);
      err ? reject(val) : resolve(val);
    };

    const obs = new MutationObserver(() => {
      const el = findEl(list);
      if (el) finish(el, false);
    });
    obs.observe(document.body, { childList: true, subtree: true });

    const timer = setTimeout(
      () => finish(new Error(`Timeout: nenhum elemento encontrado (${list[0]})`), true),
      timeout
    );
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Set text in a regular <input> and properly trigger React / WhatsApp's state */
function setInputValue(input, value) {
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Insert text into a Lexical contenteditable div */
function insertTextIntoLexical(el, text) {
  el.focus();
  document.execCommand('selectAll', false);
  document.execCommand('delete', false);
  if (text) {
    // Multi-line: insert line by line with Shift+Enter
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) document.execCommand('insertText', false, lines[i]);
      if (i < lines.length - 1) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keyup',  { key: 'Enter', shiftKey: true, bubbles: true }));
      }
    }
  }
}

// ─── Auth Check ───────────────────────────────────────────────────────────────

function isWhatsAppReady() {
  return !!(document.querySelector('#side') && document.querySelector('#side input[type="text"]'));
}

// ─── Chat Opening ─────────────────────────────────────────────────────────────

async function openChat(recipient) {
  if (!isWhatsAppReady()) {
    throw new Error('WhatsApp Web não está pronto. Verifique se está autenticado.');
  }

  const searchInput = document.querySelector('#side input[type="text"]');
  if (!searchInput) throw new Error('Campo de pesquisa não encontrado no WhatsApp Web.');

  // Clear and type search term
  setInputValue(searchInput, '');
  await sleep(150);
  setInputValue(searchInput, recipient);
  await sleep(1200); // wait for search results

  // Find exact match first, then partial
  let titleSpan =
    document.querySelector(`#pane-side span[title="${CSS.escape(recipient)}"]`) ||
    Array.from(document.querySelectorAll('#pane-side span[title]'))
      .find(el => el.getAttribute('title').toLowerCase() === recipient.toLowerCase()) ||
    Array.from(document.querySelectorAll('#pane-side span[title]'))
      .find(el => el.getAttribute('title').toLowerCase().includes(recipient.toLowerCase()));

  if (!titleSpan) {
    throw new Error(`Contato ou grupo não encontrado: "${recipient}". Verifique o nome exato no WhatsApp.`);
  }

  // Click the outermost clickable container (tabindex="-1")
  const clickTarget = titleSpan.closest('[tabindex="-1"]') || titleSpan.parentElement;
  clickTarget.click();
  await sleep(500);

  // Clear search box
  setInputValue(searchInput, '');

  // Confirm compose box appeared
  await waitFor(COMPOSE_SELS, 7000);
}

// ─── Send Message ─────────────────────────────────────────────────────────────

async function sendMessage(recipient, message) {
  await openChat(recipient);

  const compose = findEl(COMPOSE_SELS);
  if (!compose) throw new Error('Campo de mensagem não encontrado após abrir o chat.');

  insertTextIntoLexical(compose, message);
  await sleep(400);

  const sendBtn = findEl(SEND_SELS);
  if (sendBtn) {
    sendBtn.click();
  } else {
    // Fallback: press Enter
    compose.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
  }

  await sleep(800);
}

// ─── WPP Bridge (postMessage → MAIN world → page-bridge.js) ──────────────────
//
// O content-script roda no mundo isolado (sem acesso a window.WPP).
// O page-bridge.js roda no MAIN world e injeta wa-js para acessar o WPP.
// A comunicação é feita via window.postMessage com um nonce por sessão.

const BRIDGE_NONCE = crypto.randomUUID();
let bridgeInitPromise = null;

function initBridge() {
  if (bridgeInitPromise) return bridgeInitPromise;

  bridgeInitPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onInit);
      reject(new Error('Timeout: page-bridge não respondeu ao INIT (10s). Recarregue o WhatsApp Web.'));
    }, 10000);

    function onInit(e) {
      if (e.source !== window) return;
      const m = e.data;
      if (!m || m.source !== 'WAMS_BRIDGE') return;

      if (m.type === 'INIT_OK' && m.nonce === BRIDGE_NONCE) {
        clearTimeout(timeout);
        window.removeEventListener('message', onInit);
        resolve();
      } else if (m.type === 'INIT_ERROR' && m.nonce === BRIDGE_NONCE) {
        clearTimeout(timeout);
        window.removeEventListener('message', onInit);
        reject(new Error(m.error || 'Erro desconhecido ao inicializar bridge'));
      }
    }

    window.addEventListener('message', onInit);

    // Envia INIT — inclui a URL do bundle wa-js (chrome.runtime só acessível aqui)
    window.postMessage({
      source: 'WAMS_CS',
      type: 'INIT',
      nonce: BRIDGE_NONCE,
      waJsUrl: chrome.runtime.getURL('lib/wppconnect-wa.js')
    }, '*');
  });

  return bridgeInitPromise;
}

function sendViaBridge(recipient, text) {
  return new Promise(async (resolve, reject) => {
    try {
      await initBridge();
    } catch (err) {
      // Re-throw com mensagem mais clara
      return reject(new Error(`Falha ao inicializar WPP bridge: ${err.message}`));
    }

    const msgId  = crypto.randomUUID();
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onResult);
      reject(new Error('Timeout: bridge não respondeu após 30s'));
    }, 30000);

    function onResult(e) {
      if (e.source !== window) return;
      const m = e.data;
      if (!m || m.source !== 'WAMS_BRIDGE' || m.type !== 'SEND_RESULT' || m.id !== msgId) return;
      clearTimeout(timeout);
      window.removeEventListener('message', onResult);
      m.success
        ? resolve({ success: true })
        : resolve({ success: false, error: m.error });
    }

    window.addEventListener('message', onResult);
    window.postMessage({
      source: 'WAMS_CS',
      type: 'SEND_MESSAGE',
      nonce: BRIDGE_NONCE,
      id: msgId,
      recipient,
      text
    }, '*');
  });
}

// ─── Message Listener (from background) ───────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== 'sendMessage') return;

  if (!isWhatsAppReady()) {
    sendResponse({ success: false, error: 'WhatsApp Web não está pronto. Verifique se está autenticado.' });
    return true;
  }

  sendViaBridge(request.recipient, request.message)
    .then(sendResponse)
    .catch(err => {
      console.error('[WAMS] Erro no bridge:', err.message);
      sendResponse({ success: false, error: err.message });
    });

  return true; // mantém o canal aberto para sendResponse assíncrono
});

// ─── Schedule Button Injection ────────────────────────────────────────────────

function getCurrentChatName() {
  const compose = findEl(COMPOSE_SELS);
  if (!compose) return '';
  // aria-label = "Digite uma mensagem para CONTACT_NAME"
  const label = compose.getAttribute('aria-label') || '';
  const match = label.match(/\bpara\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function getCurrentMessage() {
  const compose = findEl(COMPOSE_SELS);
  return compose ? compose.textContent.trim() : '';
}

function removeScheduleDialog() {
  document.querySelector('#wams-dialog-overlay')?.remove();
}

function showScheduleDialog() {
  removeScheduleDialog();

  const recipient = getCurrentChatName();
  const message   = getCurrentMessage();

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  // Detect WhatsApp theme (dark or light)
  const isDark = document.body.dataset.theme === 'dark' ||
    getComputedStyle(document.body).backgroundColor.includes('17, 27, 33') ||
    getComputedStyle(document.body).backgroundColor.includes('32, 44, 51') ||
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  const bg      = isDark ? '#202c33' : '#ffffff';
  const surface = isDark ? '#2a3942' : '#f0f2f5';
  const text     = isDark ? '#e9edef' : '#111b21';
  const subtext  = isDark ? '#8696a0' : '#667781';
  const border   = isDark ? '#374045' : '#d1d7db';
  const inputBg  = isDark ? '#1a2229' : '#ffffff';
  const green    = '#00a884';

  const inputStyle = `width:100%;padding:8px 10px;border:1.5px solid ${border};border-radius:6px;background:${inputBg};color:${text};font-size:13px;outline:none;box-sizing:border-box;`;
  const labelStyle = `display:block;font-size:11px;font-weight:600;color:${subtext};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px`;

  const overlay = document.createElement('div');
  overlay.id = 'wams-dialog-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0,0,0,0.3);
    display: flex; align-items: flex-end; justify-content: flex-end;
    padding: 0 16px 90px 0;
  `;

  overlay.innerHTML = `
    <div id="wams-dialog" style="
      background:${bg}; border-radius:12px; padding:18px;
      width:300px; box-shadow:0 8px 24px rgba(0,0,0,0.5);
      border:1px solid ${border}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      color:${text}; font-size:13px; max-height:90vh; overflow-y:auto;
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${green}">
            <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/>
          </svg>
          Agendar Mensagem
        </div>
        <span id="wams-close" style="cursor:pointer;color:${subtext};font-size:20px;line-height:1;padding:2px 4px">×</span>
      </div>

      ${recipient ? `
        <div style="background:${surface};border-radius:6px;padding:8px 10px;margin-bottom:12px;font-size:12px;color:${subtext}">
          Para: <strong style="color:${text}">${escHtml(recipient)}</strong>
        </div>
      ` : `
        <div style="background:#ff4d4d22;border:1px solid #ff4d4d55;border-radius:6px;padding:8px 10px;margin-bottom:12px;font-size:12px;color:#ff6b6b">
          ⚠ Nenhum chat aberto. Abra uma conversa primeiro.
        </div>
      `}

      ${message ? `
        <div style="background:${surface};border-radius:6px;padding:8px 10px;margin-bottom:12px;font-size:12px;color:${subtext};max-height:60px;overflow:hidden;text-overflow:ellipsis">
          Msg: <span style="color:${text}">${escHtml(message.slice(0,80))}${message.length>80?'…':''}</span>
        </div>
      ` : `
        <div style="background:#ff4d4d22;border:1px solid #ff4d4d55;border-radius:6px;padding:8px 10px;margin-bottom:12px;font-size:12px;color:#ff6b6b">
          ⚠ Nenhuma mensagem digitada.
        </div>
      `}

      <div style="margin-bottom:10px">
        <label style="${labelStyle}">Data</label>
        <input id="wams-date" type="date" value="${dateStr}" min="${dateStr}" style="${inputStyle}"/>
      </div>

      <div style="margin-bottom:10px">
        <label style="${labelStyle}">Hora</label>
        <input id="wams-time" type="time" value="${timeStr}" style="${inputStyle}"/>
      </div>

      <div style="margin-bottom:10px">
        <label style="${labelStyle}">Recorrência</label>
        <select id="wams-recurrence" style="${inputStyle}">
          <option value="none">Nenhuma (envio único)</option>
          <option value="daily">Diária</option>
          <option value="weekdays">Dias úteis (seg–sex)</option>
          <option value="weekly">Semanal</option>
          <option value="monthly">Mensal (mesmo dia)</option>
          <option value="custom">Personalizada</option>
        </select>
      </div>

      <!-- Weekly days (shown only for weekly) -->
      <div id="wams-weekly-section" style="display:none;margin-bottom:10px">
        <label style="${labelStyle}">Dias da semana</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((d, i) => `
            <label style="display:flex;flex-direction:column;align-items:center;gap:3px;font-size:11px;color:${subtext};cursor:pointer">
              <input type="checkbox" value="${i}" class="wams-dow" style="cursor:pointer"/>
              ${d}
            </label>
          `).join('')}
        </div>
      </div>

      <!-- Custom interval (shown only for custom) -->
      <div id="wams-custom-section" style="display:none;margin-bottom:10px">
        <label style="${labelStyle}">Intervalo</label>
        <div style="display:flex;gap:8px">
          <input id="wams-interval" type="number" min="1" value="1" style="${inputStyle}width:70px;flex-shrink:0"/>
          <select id="wams-unit" style="${inputStyle}">
            <option value="minutes">Minutos</option>
            <option value="hours">Horas</option>
            <option value="days" selected>Dias</option>
            <option value="weeks">Semanas</option>
          </select>
        </div>
      </div>

      <!-- End conditions (shown for all recurring types) -->
      <div id="wams-end-section" style="display:none;margin-bottom:10px">
        <label style="${labelStyle}">Encerramento (opcional)</label>
        <div style="margin-bottom:6px">
          <label style="font-size:12px;color:${subtext};display:block;margin-bottom:3px">Data final</label>
          <input id="wams-end-date" type="date" style="${inputStyle}"/>
        </div>
        <div>
          <label style="font-size:12px;color:${subtext};display:block;margin-bottom:3px">Após quantos envios</label>
          <input id="wams-end-count" type="number" min="1" placeholder="Ilimitado" style="${inputStyle}"/>
        </div>
      </div>

      <div id="wams-error" style="display:none;background:#ff4d4d22;border:1px solid #ff4d4d55;border-radius:6px;padding:8px;font-size:12px;color:#ff6b6b;margin-bottom:10px"></div>

      <div style="display:flex;gap:8px">
        <button id="wams-cancel-btn" style="
          flex:1;padding:9px;background:${surface};color:${subtext};
          border:1px solid ${border};border-radius:8px;font-size:13px;cursor:pointer;
        ">Cancelar</button>
        <button id="wams-schedule-btn" style="
          flex:2;padding:9px;background:${green};color:#fff;
          border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
        ">📅 Agendar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Show/hide conditional sections based on recurrence selection
  const recSelect      = document.getElementById('wams-recurrence');
  const weeklySection  = document.getElementById('wams-weekly-section');
  const customSection  = document.getElementById('wams-custom-section');
  const endSection     = document.getElementById('wams-end-section');

  function updateSections() {
    const val = recSelect.value;
    weeklySection.style.display = val === 'weekly'  ? 'block' : 'none';
    customSection.style.display = val === 'custom'  ? 'block' : 'none';
    endSection.style.display    = val !== 'none'    ? 'block' : 'none';
  }

  recSelect.addEventListener('change', updateSections);

  // Close on overlay click
  overlay.addEventListener('click', e => { if (e.target === overlay) removeScheduleDialog(); });
  document.getElementById('wams-close').addEventListener('click', removeScheduleDialog);
  document.getElementById('wams-cancel-btn').addEventListener('click', removeScheduleDialog);

  document.getElementById('wams-schedule-btn').addEventListener('click', () => {
    const dateVal = document.getElementById('wams-date').value;
    const timeVal = document.getElementById('wams-time').value;
    const recVal  = recSelect.value;
    const errEl   = document.getElementById('wams-error');

    const scheduledTime = new Date(`${dateVal}T${timeVal}`).getTime();

    if (!recipient) {
      errEl.textContent = 'Nenhum chat aberto. Abra uma conversa primeiro.';
      errEl.style.display = 'block';
      return;
    }
    if (!message) {
      errEl.textContent = 'Nenhuma mensagem digitada no chat.';
      errEl.style.display = 'block';
      return;
    }
    if (isNaN(scheduledTime) || scheduledTime < Date.now() - 60000) {
      errEl.textContent = 'Data/hora inválida ou no passado.';
      errEl.style.display = 'block';
      return;
    }

    const recurrence = { type: recVal };
    if (recVal === 'weekly') {
      const checked = [...document.querySelectorAll('.wams-dow:checked')].map(cb => parseInt(cb.value));
      recurrence.daysOfWeek = checked.length ? checked : [new Date(scheduledTime).getDay()];
    } else if (recVal === 'monthly') {
      recurrence.dayOfMonth = new Date(scheduledTime).getDate();
    } else if (recVal === 'custom') {
      recurrence.interval = parseInt(document.getElementById('wams-interval').value) || 1;
      recurrence.unit = document.getElementById('wams-unit').value;
    }

    if (recVal !== 'none') {
      const endDateVal  = document.getElementById('wams-end-date').value;
      const endCountVal = document.getElementById('wams-end-count').value;
      if (endDateVal)  recurrence.endDate       = new Date(endDateVal).getTime();
      if (endCountVal) recurrence.endAfterCount = parseInt(endCountVal);
    }

    chrome.runtime.sendMessage({
      action: 'addMessage',
      message: { recipient, message, scheduledTime, recurrence }
    }, response => {
      if (response?.success) {
        removeScheduleDialog();
        showInlineToast(`✔ Mensagem agendada para ${formatDateTime(scheduledTime)}`, green);

        // Small delay so the overlay is fully removed before trying to focus the compose box.
        // Lexical requires selectAll + insertText('') — execCommand('delete') alone is ignored.
        setTimeout(() => {
          const compose = findEl(COMPOSE_SELS);
          if (compose) {
            compose.focus();
            document.execCommand('selectAll', false);
            document.execCommand('insertText', false, '');
          }
        }, 80);
      } else {
        errEl.textContent = 'Erro ao agendar: ' + (response?.error || 'desconhecido');
        errEl.style.display = 'block';
      }
    });
  });
}

function injectScheduleButton() {
  if (document.getElementById('wams-inject-btn')) return;

  const sendBtn = findEl(SEND_SELS);
  if (!sendBtn) return;

  // Container: 4 children (left-icons, mid-icons, compose, send-wrapper)
  // send-wrapper is: sendBtn > span > div > div(wrapper)
  const sendWrapper = sendBtn.parentElement?.parentElement?.parentElement;
  const container   = sendWrapper?.parentElement;
  if (!container || container.children.length < 2) return;

  const btn = document.createElement('div');
  btn.id = 'wams-inject-btn';
  btn.title = 'Agendar mensagem (WhatsApp Scheduler)';
  btn.style.cssText = `
    display:flex;align-items:center;justify-content:center;
    width:42px;height:42px;cursor:pointer;border-radius:50%;
    color:#8696a0;transition:color 0.2s,background 0.2s;
    flex-shrink:0;user-select:none;
  `;
  btn.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/>
    </svg>
  `;

  btn.addEventListener('mouseenter', () => {
    btn.style.color = '#00a884';
    btn.style.background = 'rgba(0,168,132,0.12)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.color = '#8696a0';
    btn.style.background = 'transparent';
  });
  btn.addEventListener('click', showScheduleDialog);

  container.insertBefore(btn, sendWrapper);
}

function showInlineToast(msg, color = '#00a884') {
  document.getElementById('wams-toast')?.remove();
  const t = document.createElement('div');
  t.id = 'wams-toast';
  t.textContent = msg;
  t.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:${color};color:#fff;padding:8px 16px;
    border-radius:8px;font-size:13px;z-index:99999;
    box-shadow:0 4px 12px rgba(0,0,0,0.4);
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    pointer-events:none;
  `;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function formatDateTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── MutationObserver: inject button when footer loads / chat changes ──────────

// Checks only aria-label selectors — data-tab="11" matches both Send AND Mic buttons
// and would prevent the icon from hiding when text is deleted.
function isSendButtonVisible() {
  return !!(
    document.querySelector('button[aria-label="Enviar"]') ||
    document.querySelector('button[aria-label="Send"]')
  );
}

const footerObserver = new MutationObserver(() => {
  const sendVisible = isSendButtonVisible();
  const wamsBtn = document.getElementById('wams-inject-btn');

  if (sendVisible && !wamsBtn) {
    injectScheduleButton();
  } else if (!sendVisible && wamsBtn) {
    wamsBtn.remove();
    removeScheduleDialog();
  }
});

footerObserver.observe(document.body, { childList: true, subtree: true });

// Initial injection attempt
setTimeout(injectScheduleButton, 2000);

// Notify background (ignore errors if not listening)
chrome.runtime.sendMessage({ action: 'contentScriptReady' }).catch(() => {});
