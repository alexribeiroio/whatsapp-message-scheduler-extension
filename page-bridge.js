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
      // Nota: WPP.webpack.isReady não é uma função na versão atual do wa-js.
      // Usar apenas onReady() via polling, que é a API estável.
      const deadline = Date.now() + timeoutMs;

      const poll = setInterval(() => {
        if (typeof WPP !== 'undefined' && WPP.webpack) {
          clearInterval(poll);
          WPP.webpack.onReady(() => resolve());
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

    // Estratégia 2 — Busca por nome em todos os chats carregados
    let chats = [];
    try {
      chats = await WPP.chat.list({});
    } catch (e) {
      throw new Error(`Falha ao listar chats: ${e.message}`);
    }

    if (!chats || chats.length === 0) {
      throw new Error('Nenhum chat carregado. Aguarde o WhatsApp carregar a lista de conversas.');
    }

    const needle = trimmed.toLowerCase();

    const getName = (c) =>
      (c.name || c.contact?.pushname || c.contact?.formattedName || '').toLowerCase();

    // Match exato primeiro, depois parcial
    const exact   = chats.find(c => getName(c) === needle);
    const partial = exact || chats.find(c => getName(c).includes(needle));

    if (!partial) {
      throw new Error(`Contato/grupo não encontrado: "${recipient}". Use o nome exato como aparece no WhatsApp ou um número de telefone com DDI.`);
    }

    // Serializa o ID para string (formato: "5511999@c.us" ou "12036xxx@g.us")
    return partial.id?._serialized ?? partial.id ?? String(partial.id);
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
