# WhatsApp Message Scheduler — Guia de Desenvolvimento

## Visão Geral

Extensão Chrome (Manifest V3) que agenda mensagens no WhatsApp Web para datas/horários específicos e recorrências. Envia para contatos individuais e grupos **sem interagir com a UI** do WhatsApp.

**Versão atual:** 1.1.0
**Bump de versão:** incrementar `manifest.json` → aciona `onInstalled` (reason: 'update') em usuários existentes, que recarrega as abas do WhatsApp.

---

## Estrutura de Arquivos

```
background.js          — Service worker: alarmes, fila de envio, persistência
content-script.js      — Mundo ISOLATED: bridge postMessage + botão 📅 no WhatsApp
page-bridge.js         — Mundo MAIN: injeta wa-js, usa WPP.chat.sendTextMessage()
manifest.json          — MV3: permissões, content scripts, web_accessible_resources
popup.html/js/css      — UI da extensão: abas Nova / Agendadas / Histórico
options.html/js/css    — Configurações: intervalo, retries, delays, notificações
lib/wppconnect-wa.js   — Bundle UMD do @wppconnect/wa-js (~482KB)
generate-icons.js      — Script Node.js para gerar ícones PNG (requer `canvas`)
icons/                 — icon16/32/48/128.png
```

---

## Arquitetura de Envio (sem interação com UI)

```
background.js
  └── chrome.tabs.sendMessage({ action:'sendMessage', recipient, message })
        └── content-script.js  [ISOLATED world]
              └── window.postMessage({ source:'WAMS_CS', type:'SEND_MESSAGE', nonce, ... })
                    └── page-bridge.js  [MAIN world — acessa window.WPP]
                          └── WPP.chat.sendTextMessage(chatId, text, { createChat:true })
                    └── window.postMessage({ source:'WAMS_BRIDGE', type:'SEND_RESULT', ... })
              └── sendResponse({ success, error })
```

**Por que MAIN world?** O content script roda em sandbox (ISOLATED) e não consegue acessar `window.WPP` nem os módulos internos do WhatsApp. O `page-bridge.js` declarado com `"world": "MAIN"` no manifest tem acesso ao contexto real da página.

**Segurança:** Um nonce UUID gerado no mundo isolado (`BRIDGE_NONCE = crypto.randomUUID()`) é enviado no INIT e validado em cada mensagem subsequente. Scripts de página externos não conseguem obter o nonce.

**`chrome.runtime.getURL()` não existe no MAIN world** — a URL do bundle wa-js é passada pelo content-script via mensagem INIT.

---

## Protocolo postMessage

```
CS → Bridge:   { source:'WAMS_CS',     type:'INIT',         nonce, waJsUrl }
CS → Bridge:   { source:'WAMS_CS',     type:'SEND_MESSAGE', nonce, id, recipient, text }
Bridge → CS:   { source:'WAMS_BRIDGE', type:'INIT_OK',      nonce }
Bridge → CS:   { source:'WAMS_BRIDGE', type:'INIT_ERROR',   nonce, error }
Bridge → CS:   { source:'WAMS_BRIDGE', type:'SEND_RESULT',  id, success, error? }
```

---

## Seletores CSS do WhatsApp Web (confirmados março/2026)

```
Campo de busca:    #side input[type="text"]               ← <input> comum, usa nativeInputValueSetter
Resultado busca:   #pane-side span[title="NOME"]          → .closest('[tabindex="-1"]')
Caixa de texto:    .lexical-rich-text-input [contenteditable]   (editor Lexical, data-tab="10")
Botão enviar:      button[aria-label="Enviar"]            ← sem data-testid na UI nova
```

**Atenção:** O WhatsApp **não usa** `data-testid` na UI atual. Não use seletores `data-testid`.
**Atenção:** A caixa de texto é um editor **Lexical** (React). Use `document.execCommand('insertText')` para inserir texto, não `.value =` nem `.textContent =`.
**React inputs:** Para o campo de busca (`<input>`), usar `nativeInputValueSetter` + dispatch de `Event('input')` e `Event('change')`.

---

## Modelo de Dados (`chrome.storage.local`)

### Mensagem agendada
```js
{
  id: string,            // crypto.randomUUID()
  recipient: string,     // nome do contato/grupo ou número com DDI
  message: string,
  scheduledTime: number, // timestamp ms
  recurrence: {
    type: 'none' | 'daily' | 'weekly' | 'monthly' | 'custom',
    daysOfWeek?: number[],  // weekly: [0-6], dom=0
    dayOfMonth?: number,    // monthly
    interval?: number,      // custom
    unit?: 'minutes' | 'hours' | 'days' | 'weeks',  // custom
    endDate?: number,       // timestamp ms — opcional
    endAfterCount?: number  // opcional
  },
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled',
  createdAt: number,
  scheduledTime: number,
  lastAttemptAt: number | null,
  sentAt: number | null,
  failureReason: string | null,
  retryCount: number,
  occurrenceCount: number
}
```

### Configurações padrão (`DEFAULT_SETTINGS` em background.js)
```js
{
  processingInterval: 1,   // minutos entre verificações de alarme
  maxRetries: 3,
  minDelay: 5,             // segundos entre envios consecutivos
  maxDelay: 15,
  notifyOnSend: true,
  notifyOnFailure: true,
  autoOpenWhatsApp: false,
  historyRetentionDays: 30
}
```

**Merge de settings:** `getSettings()` sempre faz `{ ...DEFAULT_SETTINGS, ...(settings||{}) }` para garantir que novos campos tenham valor padrão em instalações existentes.

---

## Decisões Técnicas Importantes

| Decisão | Motivo |
|---|---|
| `chrome.alarms` (1 ticker periódico) + fila no storage | Limite de 500 alarmes simultâneos no Chrome |
| `@wppconnect/wa-js` via script tag no MAIN world | Acessa módulos internos do WhatsApp sem automação visual |
| Nonce por sessão para postMessage | Evitar que scripts de página interceptem mensagens da extensão |
| Delay aleatório entre envios (5–15s padrão) | Simular comportamento humano, reduzir risco de ban |
| Retry em 5 min após falha (até maxRetries) | Tolerância a erros temporários (rede, WhatsApp carregando) |
| Reset de mensagens travadas em `'sending'` (>15 min) | Recuperação após crash do browser durante envio |
| Reload de abas WhatsApp no `onInstalled` | Garantir que content scripts atualizados sejam injetados |

---

## Resolução de Destinatário (em page-bridge.js)

1. Se `recipient` contém apenas dígitos (≥7): tenta como telefone → `digits@c.us` via `WPP.chat.get(chatId)`
2. Fallback: busca em `WPP.chat.list({})` por match **exato** no `name`/`contact.pushname`, depois **parcial**
3. Erro se não encontrado — usuário deve usar nome exato como aparece no WhatsApp ou número com DDI

---

## Botão 📅 no WhatsApp Web (`content-script.js`)

- Injetado ao lado do botão "Enviar" via `MutationObserver` (`footerObserver`)
- **Aparece** quando o botão Enviar existe (ou seja, há texto na caixa de mensagem)
- **Some** automaticamente quando o botão Enviar desaparece (caixa vazia) — o observer também fecha o dialog aberto
- Abre um dialog flutuante (canto inferior direito, 300px) com:
  - Destinatário detectado via `aria-label` da caixa de texto
  - Mensagem capturada via `textContent` da caixa
  - Data, hora, recorrência (none/daily/weekly/monthly/custom)
  - Seção de dias da semana (aparece para `weekly`)
  - Seção de intervalo + unidade (aparece para `custom`)
  - Seção de encerramento — data final e/ou após N envios (aparece para qualquer recorrência)
- Após agendar: limpa a caixa de texto e exibe toast de confirmação

---

## Como Testar / Recarregar

1. Ir em `chrome://extensions`
2. Clicar em ↻ (recarregar) na extensão
3. A aba do WhatsApp Web recarrega automaticamente (handler `onInstalled`)
4. Verificar no DevTools da aba WhatsApp (Console): `[WAMS-Bridge] page-bridge.js carregado no mundo MAIN`
5. Para depurar o service worker: `chrome://extensions` → "Visualizar serviço de worker"

---

## Ambiente / Ferramentas

- **npm:** não está no PATH padrão. Usar: `export PATH="/home/alex/.nvm/versions/node/v24.14.0/bin:$PATH"`
- **Regenerar ícones:** `node generate-icons.js` (requer `npm install canvas` antes)
- **Atualizar wa-js:** `npm install @wppconnect/wa-js && cp node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js lib/wppconnect-wa.js`
- **Verificar sintaxe JS:** `node -e "new (require('vm').Script)(require('fs').readFileSync('arquivo.js','utf8'))"`
- Sempre verifique os plugins disponíveis e use os que forem relevantes para a tarefa atual.

---

## Armadilhas Conhecidas

- **Não há `window.localStorage` no service worker** — todo estado usa `chrome.storage.local`
- **`chrome.runtime.getURL()` não funciona no MAIN world** — passar URLs via postMessage do content script
- **`world: "MAIN"` requer Chrome 111+** — sem suporte em Firefox
- **Lexical editor ignora `.value =`** — usar `execCommand('insertText')` ou eventos de teclado
- **WhatsApp pode mudar seletores a qualquer momento** — verificar no DevTools se algo parar de funcionar
- **wa-js depende de `WPP.webpack.onReady()`** — aguardar até 25s com polling de 250ms antes de tentar enviar
