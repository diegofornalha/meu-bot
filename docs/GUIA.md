> Para quem é cada máquina (camadas Essencial/Hermes e Evolução/OpenClaw, risco de ban): [PRODUTO.md](PRODUTO.md).
> Roteiro passo a passo para uma máquina nova: [PLAYBOOK-nova-maquina.md](PLAYBOOK-nova-maquina.md). Mapa do código: [ARQUITETURA.md](ARQUITETURA.md).

# Guia do meu-bot (índice)

O diário técnico (o que foi feito, por quê e as pegadinhas) fica dividido por assunto em `docs/guia/`. Cada seção mantém
a data em que entrou. Coisa nova vai no guia do assunto dela, no fim.

| Guia | Seções |
|---|---|
| [História: do REA ao meu-bot (13 e 14 out)](guia/historia.md) | Visão geral; Passo 1: preparar o REA no Mac; Passo 2: engenharia reversa do Grok Bot com o REA; Passo 3: o que descobrimos sobre o Grok Bot; Passo 4: botão "REA Grok Bot" na área de trabalho; Passo 5: o backend do Hermes na VM… |
| [Máquinas, backend e seletor](guia/maquinas.md) | Backend local no Colima; Máquinas; Máquina "local"; Modelo `agente` na grokbot-1; Mapa das máquinas; v3: uma janela por máquina; Claude Code Global; Link Público Global… |
| [Agente: modelos, fallback, status line, Claude e xAI](guia/agente.md) | Provedores com fallback e o modelo grok-4; Status line e seção Fallback; Instalar status line pelo seletor; Entrar no Claude Code pelo app; Grok; Limite do Fable: o turno refaz com o Opus 5.5… |
| [WhatsApp do agente](guia/whatsapp.md) | WhatsApp do Hermes: estado e pareamento por QR no app; WhatsApp: "Só alguns contatos"; Voz das respostas em áudio e o modelo do agente; Skill whatsapp-grupos; Pausar contato no Hermes; Grupos no Hermes: ligar/desligar e "quando chamado"… |
| [CRM](guia/crm.md) | CRM: caminho real da chave da API do Streak; CRM: o agente gera a chave da API do Streak; CRM → WhatsApp; Limpar histórico do WhatsApp guarda antes no CRM; Google Contatos → CRM; Caixa fixa do grupo no CRM ao limpar o histórico… |
| [Financeiro](guia/financeiro.md) | CRM e financeiro numa máquina sem OpenClaw; Curva ABC: submódulo de Finanças; Vendas do CRM alimentam o financeiro |
| [Conta Google, Drive e backups](guia/google.md) | Tutorial 15 "Gmail (Pro)"; Backup completo e mudança de máquina; Cópia dos dados da VM no Drive do dono; Backup: tar 1; Conversas no Google Drive ao limpar; Conta Google por máquina |
| [Navegador](guia/navegador.md) | Tutorial do Navegador concluía sem o agente ter navegado; Tutorial "Extensões no Navegador" (o 10 da época) removido; Notificações do Navegador removidas; Espaços de trabalho do Navegador; Balão "guardar numa skill" depois de o agente navegar; Navegador para o agente do WhatsApp… |
| [Terminal](guia/terminal.md) | Terminal na aba; Terminal controlado de fora, divisão por arrasto e trava de leitura |
| [App: variantes, canais, atualização, produtos, onboarding e tutoriais](guia/app.md) | Modo de depuração: faixa no topo com build, batimento do main e túnel; | Fluxo: worktree por PR, DevTools remoto, rebuild enxuto e lembrete de PR; Tutorial 15 "Gmail (Pro)" pela receita nova; Guia: `GuideContext` fatiado por fonte (`tutoriais/fontes.ts`); um dono por peça (`<domínio>/<x>-guia.ts`, catálogo em `tutoriais/catalogo.ts`); registro de passos (`tutoriais/passos.ts`) no lugar da cadeia de `if/else`; `lib/tutoriais.ts` só motor (regras de WhatsApp, grupos, fallback e objetivo em libs próprias); Tutoriais renumerados na ordem da trilha (mapa antigo → novo); Onboarding guiado; Mapa de variantes: meu-bot e meu-bot-admin; Atualização automática do app; Tutoriais: "ainda não consultei" não é "não feito"; Produtos: meu-bot, meu-bot-admin e meu-bot-crm; Assinatura dos apps e o chaveiro do macOS… |
| [Contornos de limitações do Hermes e do OpenClaw](guia/contornos.md) | Regra; Tabela (pausa pela lista, plugin meu-bot-pausa, stt-whisper em Hermes global, transcritor compartilhado); Como o app decide |
| [Suporte, meu-bot-admin, auditoria e licença](guia/suporte-admin.md) | Suporte: meu-bot-admin; Auditoria: quem fez o quê; Licença lida por SSH quando o backend não tem a rota |
| [CI e Claude no GitHub](guia/ci-e-claude.md) | Testes; Claude sob demanda (`@claude`); Claude automático (issue vira PR, falha diagnosticada, `sem-claude`); Token |
| [meu-bot-diego: módulos de produto num submódulo](guia/meu-bot-diego.md) | O que é e onde mora cada coisa; Primeira vez: clonar com os módulos; Puxar as atualizações do meu-bot; Trazer uma versão nova dos módulos; Versões: o que precisa subir; Atualização do app para o Diego; Liberar para uma pessoa |
