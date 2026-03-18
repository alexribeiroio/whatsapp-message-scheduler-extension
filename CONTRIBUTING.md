# Contribuindo com o WhatsApp Message Scheduler

Obrigado pelo interesse em contribuir! Este guia cobre tudo que você precisa para entender a arquitetura, configurar o ambiente e abrir um pull request.

---

## Pré-requisitos

- **Google Chrome** 111+
- **Node.js** 18+ e **npm**
- Familiaridade com Chrome Extensions (Manifest V3)
- Conhecimento básico de JavaScript assíncrono (`async/await`, `Promise`)

---

## Configurando o ambiente

```bash
# 1. Clone o repositório
git clone https://github.com/alexribeiroio/whatsapp-message-scheduler-extension.git
cd whatsapp-message-scheduler-extension

# 2. Instale as dependências
npm install

# 3. Copie o bundle do wa-js para lib/
cp node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js lib/wppconnect-wa.js

# 4. Carregue no Chrome
# → chrome://extensions → Modo desenvolvedor → Carregar sem compactação → selecione esta pasta
```

Após qualquer modificação no código, recarregue a extensão em `chrome://extensions` (botão ↻). A aba do WhatsApp Web é recarregada automaticamente ao instalar/atualizar.

---

## Estrutura de arquivos

```
manifest.json          — Configuração MV3: permissões, scripts, ícones, versão
background.js          — Service Worker: alarmes, fila de envio, retry, storage
content-script.js      — Mundo ISOLATED: bridge postMessage + botão 📅 no chat
page-bridge.js         — Mundo MAIN: injeta wa-js, chama WPP.chat.sendTextMessage()
lib/wppconnect-wa.js   — Bundle UMD do @wppconnect/wa-js (~482 KB)
popup.html/js/css      — UI da extensão: abas Nova / Agendadas / Histórico
options.html/js/css    — Página de configurações
generate-icons.js      — Script Node.js para gerar ícones PNG
icons/                 — icon{16,32,48,128}.png
```

---

## Arquitetura

### Manifest V3 e os dois mundos

O Chrome MV3 separa os content scripts em dois mundos de execução:

| Mundo | Arquivo | Acesso |
|---|---|---|
| **ISOLATED** | `content-script.js` | DOM do WhatsApp, APIs do Chrome (`chrome.*`) |
| **MAIN** | `page-bridge.js` | DOM + variáveis globais da página (`window.WPP`, módulos internos do WhatsApp) |

Os dois mundos **não compartilham variáveis**. A comunicação é feita via `window.postMessage` com um nonce de segurança gerado pelo content script a cada sessão.

### Por que essa separação é necessária

O `@wppconnect/wa-js` expõe `window.WPP`, que só existe no mundo MAIN da página. Content scripts rodam em sandbox (ISOLATED) e não enxergam `window.WPP`. Por isso o `page-bridge.js` é declarado com `"world": "MAIN"` no `manifest.json`.

### Fluxo completo de envio

```
Popup / Alarm
  └── background.js (service worker)
        └── chrome.tabs.sendMessage({ action: 'sendMessage', recipient, message })
              └── content-script.js [ISOLATED]
                    └── window.postMessage({ source:'WAMS_CS', type:'SEND_MESSAGE', nonce, ... })
                          └── page-bridge.js [MAIN]
                                └── WPP.chat.sendTextMessage(chatId, text, { createChat: true })
                          └── window.postMessage({ source:'WAMS_BRIDGE', type:'SEND_RESULT', ... })
                    └── sendResponse({ success, error })
              └── background.js atualiza storage (status: 'sent' | retry)
```

### Protocolo postMessage

```
CS → Bridge:  { source:'WAMS_CS',     type:'INIT',         nonce, waJsUrl }
CS → Bridge:  { source:'WAMS_CS',     type:'SEND_MESSAGE', nonce, id, recipient, text }
Bridge → CS:  { source:'WAMS_BRIDGE', type:'INIT_OK',      nonce }
Bridge → CS:  { source:'WAMS_BRIDGE', type:'INIT_ERROR',   nonce, error }
Bridge → CS:  { source:'WAMS_BRIDGE', type:'SEND_RESULT',  id, success, error? }
```

O nonce é um UUID gerado em `content-script.js` (mundo isolado) e passado no INIT. O `page-bridge.js` valida o nonce em todas as mensagens subsequentes para evitar interceptação por scripts de página.

---

## Modelo de dados (`chrome.storage.local`)

### Mensagem agendada

```javascript
{
  id: "uuid",
  recipient: "Nome do Contato",   // ou número ex: "5511999998888"
  message: "texto",
  scheduledTime: 1710825600000,   // timestamp ms

  recurrence: {
    type: "none | daily | weekly | monthly | custom",
    daysOfWeek: [1, 3, 5],        // weekly: [0=Dom .. 6=Sáb]
    dayOfMonth: 15,               // monthly
    interval: 2,                  // custom: valor
    unit: "minutes|hours|days|weeks", // custom: unidade
    endDate: 1712332800000,       // opcional
    endAfterCount: 10             // opcional
  },

  status: "pending | sending | sent | failed | cancelled",
  createdAt: 1710739200000,
  lastAttemptAt: null,
  sentAt: null,
  failureReason: null,
  retryCount: 0,
  occurrenceCount: 0
}
```

### Configurações

```javascript
{
  processingInterval: 1,     // minutos entre verificações
  maxRetries: 3,
  minDelay: 5,               // segundos (delay mínimo entre envios)
  maxDelay: 15,              // segundos (delay máximo entre envios)
  notifyOnSend: true,
  notifyOnFailure: true,
  autoOpenWhatsApp: false,
  historyRetentionDays: 30
}
```

> **Importante:** `getSettings()` sempre mescla com `DEFAULT_SETTINGS` para garantir que novos campos adicionados em atualizações tenham valor padrão em instalações existentes.

---

## Como testar

### Ciclo básico de desenvolvimento

1. Modifique o código
2. Vá em `chrome://extensions` → clique ↻ na extensão
3. A aba do WhatsApp recarrega automaticamente
4. Teste a funcionalidade

### DevTools do Service Worker

Em `chrome://extensions`, clique em **"Visualizar serviço de worker"** para abrir o DevTools do `background.js`. Útil para inspecionar o storage e os alarmes.

### DevTools da aba WhatsApp

Abra o DevTools (F12) na aba `web.whatsapp.com`. No Console, filtre por `[WAMS` para ver os logs da extensão:

```
[WAMS-Bridge] page-bridge.js carregado no mundo MAIN — aguardando INIT.
[WAMS-Bridge] WPP pronto — envios em background ativados.
```

### Inspecionar o storage

No DevTools do service worker:
```javascript
chrome.storage.local.get(null, console.log)
```

### Verificar sintaxe JS

```bash
node -e "new (require('vm').Script)(require('fs').readFileSync('background.js','utf8'))"
```

---

## Seletores CSS do WhatsApp Web

> **Atenção:** O WhatsApp atualiza sua interface frequentemente. Confirme os seletores no DevTools antes de qualquer mudança que os envolva.

| Elemento | Seletor (confirmado mar/2026) |
|---|---|
| Campo de busca | `#side input[type="text"]` |
| Resultado de busca | `#pane-side span[title="NOME"]` → `.closest('[tabindex="-1"]')` |
| Caixa de mensagem | `.lexical-rich-text-input [contenteditable]` |
| Botão Enviar | `button[aria-label="Enviar"]` |
| Botão Microfone | `button[aria-label="Mensagem de voz"]` |

- **Não use** `data-testid` — não está presente na UI atual do WhatsApp Web
- O campo de busca é um `<input>` comum; use `nativeInputValueSetter` para definir seu valor em React
- A caixa de mensagem usa o editor **Lexical** (React); use `document.execCommand('insertText')` para inserir texto

---

## Boas práticas

### Service Worker (`background.js`)

- **Nunca use `window.localStorage`** — não existe em service workers. Use sempre `chrome.storage.local`
- **Nunca use `window` diretamente** — o contexto do SW não tem `window`
- **Alarmes:** use apenas 1 alarme periódico + fila no storage (limite de 500 alarmes no Chrome)

### Content Script (`content-script.js`)

- **`chrome.runtime.getURL()` funciona aqui** — passe a URL para o MAIN world via postMessage
- **Sempre valide o nonce** antes de processar mensagens vindas do MAIN world
- Use `aria-label` para detectar o botão Enviar — mais estável que `data-tab`

### Page Bridge (`page-bridge.js`)

- **`chrome.runtime.getURL()` NÃO funciona aqui** — receba a URL pelo INIT
- Aguarde `WPP.webpack.onReady()` antes de qualquer chamada ao WPP
- Use `WPP.chat.sendTextMessage(chatId, text, { createChat: true })` — não navega na UI

### Editor Lexical

- Para inserir texto: `document.execCommand('insertText', false, 'texto')`
- Para limpar: `document.execCommand('selectAll', false)` + `document.execCommand('insertText', false, '')`
- **Não use** `.value =`, `.textContent =` ou `.innerHTML =`

---

## Atualizando o wa-js

Quando uma atualização do WhatsApp Web quebrar a integração, atualize o bundle:

```bash
npm update @wppconnect/wa-js
cp node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js lib/wppconnect-wa.js
```

Recarregue a extensão e verifique se `[WAMS-Bridge] WPP pronto` aparece no console do WhatsApp.

---

## Regenerando ícones

Se precisar alterar o design dos ícones:

```bash
# Edite drawIcon() em generate-icons.js, então:
node generate-icons.js
# Gera icons/icon{16,32,48,128}.png
```

Requer `canvas` instalado: `npm install canvas`.

---

## Diretrizes para Pull Requests

1. **Bump de versão:** incremente `manifest.json` → `"version"` antes de abrir o PR. Isso garante que o `onInstalled` seja acionado em usuários existentes e os content scripts sejam recarregados.

2. **Entradas no CHANGELOG:** adicione uma entrada em `CHANGELOG.md` descrevendo a mudança na seção `[Unreleased]` ou na nova versão.

3. **Mensagens de commit:** use verbos no imperativo em português ou inglês:
   - `fix: botão 📅 não some ao apagar texto`
   - `feat: adicionar recorrência personalizada no dialog do chat`
   - `refactor: extrair isSendButtonVisible() do observer`

4. **Seletores novos:** se adicionar ou alterar seletores CSS do WhatsApp, documente-os no `CLAUDE.md` com a data de confirmação.

5. **Testes manuais mínimos antes do PR:**
   - [ ] Agendar mensagem via popup → confirmar envio após 1–2 min
   - [ ] Agendar via botão 📅 no chat → confirmar limpeza da caixa
   - [ ] Verificar console do WhatsApp: sem erros `[WAMS-Bridge]`
   - [ ] Verificar console do service worker: sem erros

---

## Dúvidas

Abra uma [issue](https://github.com/alexribeiroio/whatsapp-message-scheduler-extension/issues) descrevendo o contexto, o comportamento esperado e o comportamento atual.
