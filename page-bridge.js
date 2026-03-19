/**
 * page-bridge.js — Roda no MAIN world (contexto real da página WhatsApp Web)
 *
 * Responsabilidades:
 *  1. Recebe mensagem INIT do content-script com o nonce e a URL do bundle wa-js
 *  2. Injeta lib/wppconnect-wa.js via <script> tag
 *  3. Aguarda WPP.webpack.onReady()
 *  4. Valida nonce em todas as mensagens subsequentes (segurança)
 *  5. Resolve destinatário por telefone ou busca por nome em WPP.chat.list()
 *  6. Chama WPP.chat.sendTextMessage(chatId, text) — SEM abrir/trocar chat
 *  7. Responde via window.postMessage
 *
 * Protocolo postMessage:
 *   CS → Bridge: { source:'WAMS_CS', type:'INIT', nonce, waJsUrl }
 *   CS → Bridge: { source:'WAMS_CS', type:'SEND_MESSAGE', nonce, id, recipient, text }
 *   Bridge → CS: { source:'WAMS_BRIDGE', type:'INIT_OK', nonce }
 *   Bridge → CS: { source:'WAMS_BRIDGE', type:'INIT_ERROR', nonce, error }
 *   Bridge → CS: { source:'WAMS_BRIDGE', type:'SEND_RESULT', id, success, error? }
 */

(function () {
  'use strict';

  // ─── Estado ─────────────────────────────────────────────────────────────────

  let sessionNonce  = null;
  let wppReady      = false;

  // ─── Injeção do wa-js ────────────────────────────────────────────────────────

  function injectWaJs(url) {
    return new Promise((resolve, reject) => {
      // Evita injeção dupla (ex: navegação pwa interna sem reload completo)
      if (document.querySelector('script[data-wams]')) {
        waitForWPP().then(resolve).catch(reject);
        return;
      }

      const script = document.createElement('script');
      script.src = url;
      script.dataset.wams = 'wppconnect';
      script.onload  = () => waitForWPP().then(resolve).catch(reject);
      script.onerror = () => reject(new Error('Falha ao carregar wa-js: verifique web_accessible_resources'));
      (document.head || document.documentElement).appendChild(script);
    });
  }

  // ─── Aguarda WPP estar pronto ────────────────────────────────────────────────

  function waitForWPP(timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
      // WPP.isReady é a propriedade booleana oficial do wa-js atual.
      // Evitar chamar WPP.webpack.isReady() ou WPP.webpack.onReady() pois
      // podem não existir dependendo da versão do wa-js.
      if (window.WPP && WPP.isReady) { resolve(); return; }

      const deadline = Date.now() + timeoutMs;
      const poll = setInterval(() => {
        if (window.WPP && WPP.isReady) {
          clearInterval(poll);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(poll);
          reject(new Error('WPP não ficou pronto no tempo limite (25s). O WhatsApp pode ter mudado sua estrutura interna.'));
        }
      }, 250);
    });
  }

  // ─── Resolução de destinatário ────────────────────────────────────────────────

  async function resolveChat(recipient) {
    const trimmed = recipient.trim();

    // Estratégia 1 — Número de telefone (somente dígitos, ≥7 caracteres)
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length >= 7) {
      const chatId = `${digits}@c.us`;
      try {
        // WPP.chat.get() busca localmente; não faz chamada de rede
        const chat = await WPP.chat.get(chatId);
        if (chat) return chatId;
      } catch (_) {
        // Não é um número registrado — tenta busca por nome
      }
    }

    // Normaliza removendo acentos, maiúsculas e espaços extras
    const norm = s => (s || '').toLowerCase()
      .normalize('NFD').replace(/\p{M}/gu, '').trim();

    const needle = norm(trimmed);

    // Estratégia 2 — Busca por nome em todos os chats carregados
    let chats = [];
    try {
      chats = await WPP.chat.list({});
    } catch (e) {
      console.warn('[WAMS-Bridge] WPP.chat.list() falhou:', e.message);
    }

    if (chats && chats.length > 0) {
      const getChatName = (c) =>
        norm(c.name || c.contact?.pushname || c.contact?.formattedName || '');

      // Palavras significativas do needle (≥3 chars, ignora iniciais como "Q.")
      const sigWords = needle.split(/\s+/).filter(w => w.replace(/\W/g, '').length >= 3);
      const wordMatch = c => sigWords.length > 0 && sigWords.every(w => getChatName(c).includes(w));

      const exact   = chats.find(c => getChatName(c) === needle);
      const partial = exact
        || chats.find(c => getChatName(c).includes(needle))
        || chats.find(c => wordMatch(c));
      if (partial) return partial.id?._serialized ?? partial.id ?? String(partial.id);
    }

    // Estratégia 3 — Busca em WPP.contact.list() (inclui contatos fora das conversas recentes)
    let contacts = [];
    try {
      contacts = WPP.contact.list();
    } catch (_) { /* contact.list pode não existir em todas as versões */ }

    if (contacts && contacts.length > 0) {
      const getContactName = (c) =>
        norm(c.name || c.pushname || c.formattedName || '');

      const sigWordsC = needle.split(/\s+/).filter(w => w.replace(/\W/g, '').length >= 3);
      const wordMatchC = c => sigWordsC.length > 0 && sigWordsC.every(w => getContactName(c).includes(w));

      const exactContact   = contacts.find(c => getContactName(c) === needle);
      const partialContact = exactContact
        || contacts.find(c => getContactName(c).includes(needle))
        || contacts.find(c => wordMatchC(c));
      if (partialContact) return partialContact.id?._serialized ?? String(partialContact.id);
    }

    // Estratégia 4 — WPP.chat.search() se disponível
    try {
      if (typeof WPP.chat.search === 'function') {
        const results = await WPP.chat.search({ query: trimmed, count: 10 });
        console.log('[WAMS-Bridge] WPP.chat.search() resultados:', results?.map(r => norm(r.name || '')));
        if (results && results.length > 0) {
          return results[0].id?._serialized ?? String(results[0].id);
        }
      }
    } catch (_) { /* search pode não existir */ }

    throw new Error(`Contato/grupo não encontrado: "${recipient}". Use o nome exato como aparece no WhatsApp ou um número de telefone com DDI.`);
  }

  // ─── Envio via WPP ───────────────────────────────────────────────────────────

  async function sendMessage(recipient, text) {
    if (!wppReady) {
      throw new Error('WPP ainda não está pronto. Aguarde alguns instantes e tente novamente.');
    }

    const chatId = await resolveChat(recipient);

    // sendTextMessage NÃO troca o chat ativo na UI — envia em background
    await WPP.chat.sendTextMessage(chatId, text, {
      createChat: true  // abre o objeto de chat internamente sem navegar
    });

    return chatId;
  }

  // ─── Listener de postMessage ─────────────────────────────────────────────────

  window.addEventListener('message', async (event) => {
    // Apenas mensagens da mesma janela (mesma aba, mesmo frame)
    if (event.source !== window) return;

    const msg = event.data;
    if (!msg || msg.source !== 'WAMS_CS') return;

    // ── INIT: primeira mensagem — recebe nonce e injeta wa-js ─────────────────
    if (msg.type === 'INIT') {
      sessionNonce = msg.nonce;

      try {
        await injectWaJs(msg.waJsUrl);
        wppReady = true;
        window.postMessage({ source: 'WAMS_BRIDGE', type: 'INIT_OK', nonce: sessionNonce }, '*');
        console.log('[WAMS-Bridge] WPP pronto — envios em background ativados.');
      } catch (err) {
        window.postMessage({
          source: 'WAMS_BRIDGE',
          type: 'INIT_ERROR',
          nonce: sessionNonce,
          error: err.message
        }, '*');
        console.error('[WAMS-Bridge] Falha na inicialização:', err.message);
      }
      return;
    }

    // ── Validação de nonce para todas as demais mensagens ─────────────────────
    if (!sessionNonce || msg.nonce !== sessionNonce) {
      // Ignora silenciosamente — pode ser outra extensão ou script de página
      return;
    }

    // ── SEND_MESSAGE ──────────────────────────────────────────────────────────
    if (msg.type === 'SEND_MESSAGE') {
      let result;
      try {
        const chatId = await sendMessage(msg.recipient, msg.text);
        result = { source: 'WAMS_BRIDGE', type: 'SEND_RESULT', id: msg.id, success: true, chatId };
      } catch (err) {
        console.error('[WAMS-Bridge] Erro ao enviar:', err.message);
        result = { source: 'WAMS_BRIDGE', type: 'SEND_RESULT', id: msg.id, success: false, error: err.message };
      }
      window.postMessage(result, '*');
    }
  });

  console.log('[WAMS-Bridge] page-bridge.js carregado no mundo MAIN — aguardando INIT.');
})();
