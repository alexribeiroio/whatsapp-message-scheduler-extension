# Changelog

Todas as mudanças notáveis neste projeto serão documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e o projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [Unreleased]

---

## [1.1.2] — 2026-03-19

### Corrigido

- **Emojis no nome do contato** — `norm()` agora remove todos os caracteres que não são letras ou números (`[^\p{L}\p{N}\s]`), incluindo emojis colados à palavra (ex: `"boa🍻"` → `"boa"`). Isso garante matching correto independentemente de emojis, pontuação ou hífens nos nomes.

---

## [1.1.1] — 2026-03-19

### Corrigido

- **`WPP.isReady` (propriedade booleana)** — `waitForWPP()` usava `WPP.webpack.onReady()` que pode não existir em algumas versões do wa-js. Substituído por polling simples em `WPP.isReady` (booleano oficial da API atual).
- **Resolução de contato com nome parcial** — `resolveChat()` agora busca também em `WPP.contact.list()` (contatos fora de conversas recentes) e aplica matching por palavras significativas, ignorando iniciais (ex: "Q." em "Alex Q. Teste" → encontra "Alex Teste").

---

## [1.1.0] — 2026-03-18

### Adicionado

- **Envio via API interna do WhatsApp** — mensagens agendadas agora são enviadas usando `@wppconnect/wa-js` (`WPP.chat.sendTextMessage`), sem interagir visualmente com a interface. O chat ativo do usuário não é alterado durante o envio.
- **Botão 📅 no chat** — ícone de calendário injetado ao lado do botão Enviar do WhatsApp Web. Abre um dialog pré-preenchido com destinatário e mensagem para agendamento rápido sem sair da conversa.
- **Recorrência personalizada** — novo tipo de recorrência com intervalo numérico e unidade configurável (minutos, horas, dias ou semanas).
- **Dias da semana na recorrência semanal** — checkboxes para selecionar quais dias da semana o envio deve ocorrer (Dom–Sáb), com possibilidade de selecionar múltiplos dias.
- **Condições de encerramento** — campos opcionais para definir data final e/ou número máximo de ocorrências em qualquer tipo de recorrência.
- **Paridade de funcionalidades** — dialog do botão 📅 no chat agora possui as mesmas opções de recorrência do popup principal.
- **Reload automático de abas** — ao instalar ou atualizar a extensão, abas abertas do WhatsApp Web são recarregadas automaticamente para garantir injeção dos content scripts atualizados.
- **`iconUrl` nas notificações** — adicionado campo obrigatório `iconUrl` na criação de notificações Chrome para evitar erro de propriedades ausentes.
- **`page-bridge.js`** — novo arquivo que roda no mundo MAIN da página e gerencia a comunicação segura com os internos do WhatsApp via nonce por sessão.

### Corrigido

- **Mensagens travadas em `sending`** — mensagens que permaneciam com status `sending` por mais de 15 minutos (ex: browser fechado durante o envio) são automaticamente resetadas para `pending` na próxima verificação.
- **Merge de configurações** — ao atualizar a extensão, as configurações existentes do usuário são mescladas com os valores padrão, garantindo que novos campos adicionados em atualizações recebam seu valor padrão em vez de ficarem `undefined`.
- **Botão 📅 não sumia ao apagar texto** — `button[data-tab="11"]` era usado para detectar o botão Enviar, mas o seletor também casava com o botão de microfone. Corrigido usando apenas `button[aria-label="Enviar"]` e `button[aria-label="Send"]`.
- **`WPP.webpack.isReady is not a function`** — a verificação prévia `WPP.webpack.isReady()` lançava erro na versão atual do wa-js, pois o método não é mais uma função. Removida a verificação; o código agora usa apenas `WPP.webpack.onReady()`, que é a API estável.
- **`iconUrl` ausente nas notificações Chrome** — notificações falhavam silenciosamente por falta do campo obrigatório `iconUrl`.

---

## [1.0.0] — 2026-03-17

### Adicionado

- **Agendamento de mensagens** — defina data e hora exatas para o envio de qualquer mensagem via popup da extensão.
- **Recorrências** — suporte a recorrências diária, semanal (mesmo dia da semana) e mensal (mesmo dia do mês).
- **Contatos e grupos** — envio para contatos individuais (por nome exato ou número com DDI) e grupos do WhatsApp Web.
- **Popup com três abas:**
  - *Nova* — formulário para criar agendamentos com validação em tempo real e contador de caracteres.
  - *Agendadas* — lista de mensagens pendentes com busca por destinatário e ações (enviar agora, cancelar).
  - *Histórico* — registro de mensagens enviadas e com falha, com botão para limpar.
- **Indicador de status** — ícone verde/vermelho no popup indicando se o WhatsApp Web está aberto e conectado.
- **Página de opções** — configurações avançadas: intervalo de verificação, máximo de tentativas, delays entre envios, notificações, abertura automática e retenção de histórico.
- **Retry automático** — mensagens com falha são reagendadas automaticamente com backoff de 5 minutos, até o número máximo de tentativas configurado.
- **Notificações Chrome** — notificação ao enviar com sucesso e ao falhar após todas as tentativas.
- **Limpeza automática de histórico** — mensagens enviadas e com falha são removidas automaticamente após o período de retenção configurado (padrão: 30 dias).
- **Abertura automática do WhatsApp** — opção para abrir `web.whatsapp.com` em nova aba quando há mensagens pendentes e o WhatsApp não está aberto.
- **Ícones da extensão** — ícones gerados em 16, 32, 48 e 128 px com design de balão de chat + relógio.

---

[Unreleased]: https://github.com/alexribeiroio/whatsapp-message-scheduler-extension/compare/v1.1.2...HEAD
[1.1.2]: https://github.com/alexribeiroio/whatsapp-message-scheduler-extension/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/alexribeiroio/whatsapp-message-scheduler-extension/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/alexribeiroio/whatsapp-message-scheduler-extension/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/alexribeiroio/whatsapp-message-scheduler-extension/releases/tag/v1.0.0
