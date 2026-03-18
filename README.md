# WhatsApp Message Scheduler

Extensão para Google Chrome que permite agendar mensagens no **WhatsApp Web** para datas e horários específicos, com suporte a recorrências e envio para contatos individuais e grupos — **sem interromper sua sessão ativa**.

> As mensagens são enviadas usando a API interna do WhatsApp Web via `@wppconnect/wa-js`, sem automação visual da interface. Você pode continuar usando o WhatsApp normalmente enquanto as mensagens agendadas são disparadas em background.

---

## Funcionalidades

- **Agendamento preciso** — defina data e hora exatas para o envio
- **Recorrências flexíveis:**
  - Nenhuma (envio único)
  - Diária
  - Semanal (dias da semana configuráveis)
  - Mensal (mesmo dia do mês)
  - Personalizada (ex: a cada 2 horas, a cada 3 dias)
- **Condições de encerramento** — data final ou número máximo de ocorrências
- **Contatos e grupos** — use o nome exato como aparece no WhatsApp ou o número com DDI
- **Botão 📅 no chat** — agende a mensagem que você acabou de digitar sem sair da conversa
- **Histórico completo** — acompanhe enviadas, pendentes e falhas
- **Retry automático** — tenta reenviar em caso de falha (backoff de 5 min)
- **Notificações Chrome** — aviso de sucesso e falha no envio
- **Configurável** — intervalo de verificação, delays entre envios, retenção de histórico

---

## Requisitos

- **Google Chrome** versão 111 ou superior
- **WhatsApp Web** autenticado em `web.whatsapp.com`
- **Node.js** 18+ e **npm** (apenas para setup inicial)

> A extensão **não** funciona no Firefox (requer `world: "MAIN"` do MV3, disponível apenas no Chrome).

---

## Instalação (modo desenvolvedor)

A extensão ainda não está publicada na Chrome Web Store. Para instalar manualmente:

**1. Clone ou baixe o repositório:**
```bash
git clone https://github.com/alexribeiroio/whatsapp-message-scheduler-extension.git
cd whatsapp-message-scheduler-extension
```

**2. Instale as dependências e copie o bundle do wa-js:**
```bash
npm install
cp node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js lib/wppconnect-wa.js
```

**3. Carregue a extensão no Chrome:**
1. Acesse `chrome://extensions` na barra de endereços
2. Ative o **Modo do desenvolvedor** (toggle no canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta do projeto (`whatsapp-message-scheduler-extension/`)
5. A extensão aparecerá na barra de ferramentas do Chrome

---

## Como usar

### Pelo popup da extensão

1. Acesse `web.whatsapp.com` e autentique sua conta
2. Clique no ícone 📅 da extensão na barra do Chrome
3. Na aba **Nova**, preencha:
   - **Destinatário** — nome exato do contato/grupo ou número com DDI (ex: `5511999998888`)
   - **Mensagem** — até 4.096 caracteres
   - **Data** e **Hora** do envio
   - **Recorrência** — configure se desejar repetição automática
4. Clique em **Agendar Mensagem**
5. Acompanhe na aba **Agendadas** e depois no **Histórico**

### Pelo botão 📅 no chat

1. Abra qualquer conversa no WhatsApp Web
2. Digite a mensagem que deseja agendar na caixa de texto
3. Clique no ícone 📅 que aparece ao lado do botão **Enviar**
4. O dialog pré-preenche o destinatário e a mensagem automaticamente
5. Defina data, hora e recorrência → clique em **Agendar**
6. A caixa de texto é limpa automaticamente após o agendamento

> O botão 📅 aparece apenas quando há texto na caixa de mensagem e some quando ela é esvaziada.

### Como identificar o destinatário

| Tipo | Exemplo |
|---|---|
| Nome do contato | `João Silva` (exato como no WhatsApp) |
| Nome do grupo | `Família` (exato como no WhatsApp) |
| Número com DDI | `5511999998888` (somente dígitos) |
| Número com formatação | `+55 11 99999-8888` (dígitos extraídos automaticamente) |

---

## Configurações

Acesse as configurações pelo ícone ⚙ no popup ou via `chrome://extensions` → Detalhes → Opções.

| Configuração | Padrão | Descrição |
|---|---|---|
| Intervalo de verificação | 1 min | Com que frequência verifica mensagens para enviar |
| Máximo de tentativas | 3 | Tentativas antes de marcar como falha permanente |
| Delay mínimo entre envios | 5 s | Intervalo mínimo entre mensagens consecutivas |
| Delay máximo entre envios | 15 s | Intervalo máximo (valor aleatório no intervalo) |
| Notificar ao enviar | Ativado | Notificação Chrome ao enviar com sucesso |
| Notificar em caso de falha | Ativado | Notificação Chrome ao falhar após todas as tentativas |
| Abrir WhatsApp automaticamente | Desativado | Abre `web.whatsapp.com` quando há mensagens pendentes e o WhatsApp não está aberto |
| Retenção de histórico | 30 dias | Mensagens enviadas/com falha são removidas após esse período |

> O delay aleatório entre envios simula comportamento humano e reduz o risco de bloqueio pelo WhatsApp.

---

## Perguntas Frequentes

**O WhatsApp precisa estar aberto no browser?**
Sim. A extensão requer que `web.whatsapp.com` esteja aberto e autenticado em uma aba do Chrome. Se estiver fechado, a mensagem fica aguardando (ou o WhatsApp é aberto automaticamente, se a opção estiver ativada).

**Funciona com grupos?**
Sim. Use o nome exato do grupo como aparece no WhatsApp Web.

**Posso enviar para múltiplos destinatários ao mesmo tempo?**
Agende uma mensagem para cada destinatário separadamente.

**As mensagens são enviadas com atraso?**
O verificador roda a cada 1 minuto por padrão. Uma mensagem agendada para 14:00 será enviada entre 14:00 e 14:01. Ajuste o intervalo nas configurações para maior precisão.

**O que acontece se o browser fechar antes do envio?**
A mensagem permanece pendente no storage. Na próxima vez que o Chrome abrir com o WhatsApp Web, o envio será retomado. Mensagens presas em estado de envio por mais de 15 minutos são resetadas automaticamente.

**Existe risco de bloqueio pelo WhatsApp?**
A extensão usa a API interna do WhatsApp (não simula cliques) e aplica delays aleatórios entre envios. Use com moderação e dentro dos limites pessoais de uso.

---

## Aviso Legal

Esta extensão é um projeto independente, não afiliado, endossado ou associado ao WhatsApp LLC ou Meta Platforms. O uso é de responsabilidade do usuário e deve respeitar os [Termos de Serviço do WhatsApp](https://www.whatsapp.com/legal/terms-of-service).

---

## Contribuindo

Contribuições são bem-vindas! Leia o [CONTRIBUTING.md](CONTRIBUTING.md) para entender a arquitetura, como configurar o ambiente de desenvolvimento e as diretrizes para pull requests.

---

## Licença

MIT — veja [LICENSE](LICENSE) para detalhes.
