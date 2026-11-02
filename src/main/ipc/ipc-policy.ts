/**
 * Política de variante dos canais IPC: cada canal está em exatamente uma lista. O registro (ipc/registry.ts)
 * é tipado por elas, então um canal novo sem lista não compila. "client" = só o meu-bot normal (no
 * meu-bot-admin vira um stub que recusa com ADMIN_READONLY_MSG); "admin" = só o meu-bot-admin; "shared" = os
 * dois. Puro: testável com node --test (o teste confere que todo canal dos preloads está aqui, uma vez só).
 */

/** Os dois apps: leituras da máquina e o que é só deste Mac (configurações, memória, arquivar). */
export const SHARED_CHANNELS = [
  // janela principal
  "window:info", "window:zoom", "whatsapp:group-clear-plan", "whatsapp:group-archive-crm", "whatsapp:group-clear", "whatsapp:group-mark", "google-conta:status", "google-conta:conectar", "google-conta:desconectar", "google-conta:adotar-do-mac", "gmail:listar", "gmail:ler", "gmail:apagar", "gmail:restaurar", "backup-dados:status", "backup-dados:agora", "backup-dados:ligar", "backup-dados:abrir-pasta", "backup-dados:senha", "google-conta:agenda", "google-conta:agenda-criar", "google-conta:planilha-ler", "google-conta:planilha-escrever", "ui:open-picker", "shell:open-external", "settings:get", "settings:set", "memory:get", "memory:set",
  "whatsapp:status", "whatsapp:chats", "whatsapp:thread", "whatsapp:export", "ui:wa-menu",
  // limpar o histórico, pausar o agente e arquivar/excluir por contato: a pessoa e o admin (no admin fica no registro da máquina dela)
  "whatsapp:clear-plan", "whatsapp:clear", "whatsapp:pause", "whatsapp:mark", "whatsapp:names",
  // meu-bot-crm: guardar a conversa no CRM antes de limpar (o handler recusa fora dele)
  "whatsapp:archive-crm",
  // grupos: ler, ligar/desligar o agente, quem aciona e reler a lista (a pessoa e o admin; mudanças na auditoria)
  "whatsapp:groups", "whatsapp:group-thread", "whatsapp:group-set", "whatsapp:groups-refresh", "ui:wa-group-menu",
  "claude-login:auth", "xai-login:auth", "xai-key:status", "contas:status", "link-publico:status",
  // terminal na máquina da janela (os dois apps; no admin a pessoa vê no registro dela)
  "term:open", "term:input", "term:resize", "term:close", "term:replay",
  // atualização automática do próprio app
  "update:state", "update:apply", "update:check",
  // internet deste Mac (faixa OFFLINE) e "a máquina desta janela é este Mac?"
  "net:check", "host:local-addr",
  // modo de depuração (faixa no topo): estado e ligar/desligar
  "depuracao:estado", "depuracao:ligar",
  // seletor
  "picker:list", "picker:plans", "picker:locais", "picker:probe", "picker:choose", "picker:use-port", "picker:shortcut", "picker:relief-shortcut", "picker:relieve",
  "picker:open-grokbot-reset", "picker:open-url", "picker:tailscale-credential", "picker:cancel",
  // alívio do Grok Bot (relief.ts registra sozinho)
  "relief:close", "relief:open-reset",
] as const;

/** Só o meu-bot normal: tudo que conversa com o agente ou escreve na máquina. */
export const CLIENT_CHANNELS = [
  // conversas com o agente
  "chat:send", "chat:cancel", "chat:new", "chat:list", "chat:rename", "chat:set-model", "chat:reorder", "chat:close",
  "chat:delete", "chat:apagadas", "chat:open", "chat:archive", "chat:duplicate", "chat:branch", "chat:export", "chat:reference", "ui:tab-menu", "ui:notify", "ui:notify-test", "alerts:get", "alerts:set", "license:get",
  "backend:account",
  // entrada rápida (quickEntry.ts registra sozinho, e só sobe com caps.chat)
  "ui:quick-toggle", "quick:submit", "quick:hide", "quick:ack",
  // WhatsApp: o que mexe na máquina ou no agente dela
  "whatsapp:pair", "whatsapp:audio", "whatsapp:logout", "whatsapp:dm-policy", "whatsapp:agente", "whatsapp:branch",
  "whatsapp:cancel", "whatsapp:pausa-plugin", "whatsapp:dono",
  // logins
  "claude-login:start", "claude-login:code", "claude-login:logout", "claude-login:cancel",
  // várias contas do Claude na máquina (rodízio no limite de uso)
  "contas-claude:listar", "contas-claude:criar", "contas-claude:entrar", "contas-claude:atualizar", "contas-claude:reordenar", "contas-claude:remover", "contas-claude:usar-agora", "contas-claude:conferir", "contas-claude:limiares",
  "xai-login:prepare", "xai-login:start", "xai-login:logout", "xai-login:cancel",
  "contas:entrar", "contas:cancelar", "contas:sair", "contas:instalar-gh",
  // link público da pessoa (tutorial 14): trocar o nome do subdomínio dela, ver o que está no ar, tirar do ar e publicar um arquivo deste Mac
  "link-publico:nome", "link-publico:lista", "link-publico:remover", "link-publico:publicar",
  // espaço da conta na máquina (Configurações › Espaço): a cota relida, o que dá para apagar, apagar e pedir mais ao admin
  "cota:status", "cota:maiores", "cota:apagar-item", "cota:pedir-mais",
  // instalar e configurar a máquina
  "backend:presente", "backend:install",
  "statusline:status", "statusline:install", "statusline:segments", "statusline:set-segments", "statusline:uninstall",
  "guarda:status", "guarda:install", "guarda:uninstall", "navegador:status", "navegador:install", "gmail:agent", "gmail:status", "gmail:install", "finance:info", "finance:abc", "finance:importar-planilha", "finance:lancamentos", "finance:categorias", "finance:lancar", "finance:confirmar", "finance:descartar", "finance:corrigir", "finance:linha-salvar", "finance:linha-remover", "finance:comprovante", "finance:confirmar-todas", "finance:conta-criar", "finance:mes", "finance:fechar-mes", "finance:config-ler", "finance:config-salvar", "finance:install", "finance:pedir", "modulos:listar", "modulos:ligar", "modulos:desligar", "modulos:credenciais", "modulos:opcoes", "crm:info", "crm:local", "crm:pipeline-criar", "crm:pipeline-padrao", "crm:install", "crm:set", "crm:test", "crm:reset",
  // aba Navegador (módulo Pro)
  "browser:open", "browser:permissao", "browser:permissoes-esquecer", "browser:agent-whatsapp", "browser:extensions", "browser:remove-extension", "browser:request-pro", "plano:avisar-pagamento", "computador:status", "computador:acordar", "computador:instalar", "computador:url", "browser:agent", "browser:active", "browser:favorite-add", "browser:favorite-remove", "browser:workspaces-set",
  "tailscale:disable-check", "tailscale:restore",
  // tutorial 8: objetivo do WhatsApp (objetivo.json, skill no workspace do OpenClaw, trava do nível)
  "objective:info", "objective:set", "objective:save", "objective:reset",
  // suporte, lado da pessoa
  "support:info", "support:set", "support:progress", "support:name", "support:deliver", "support:code", "support:share", "support:reset",
  // seletor
  "picker:install", "picker:install-statusline", "picker:install-transcricao", "picker:install-claude", "picker:install-guarda", "picker:remove-host", "picker:rename-host",
  "picker:sync-ssh", "picker:open-direct", "picker:onboarding-done", "picker:claude-login",
  "picker:approve-tailscale", "picker:tailscale-disable-check", "picker:tailscale-credential-save", "picker:tailscale-credential-forget",
] as const;

/** Só o meu-bot-admin: a página "Suporte" e as pessoas do seletor. */
export const ADMIN_CHANNELS = ["admin:health", "admin:logs", "admin:action", "admin:bot-chats", "admin:bot-thread", "admin:bot-delete", "admin:license-set", "admin:license-approve", "admin:license-revoke", "admin:produtos-list", "admin:auditoria-visivel", "admin:auditoria", "admin:auditoria-exportar", "admin:usuarios-visivel", "admin:usuarios", "admin:usuario-criar", "admin:usuario-limite", "admin:usuario-apagar", "admin:usuario-recursos", "admin:swap-ligar", "admin:governanca", "admin:backends-atualizar", "admin:preparar-estado", "admin:preparar-aplicar", "admin:hermes-global", "admin:whatsapp-alvo", "admin:usuario-apelido", "admin:usuario-ligado", "admin:usuario-preparar", "admin:claude-global", "admin:claude-global-instalar", "admin:claude-global-limiares", "admin:claude-global-entrar", "admin:claude-global-conta-editar", "admin:claude-global-conta-nova", "admin:claude-global-conta-remover", "admin:claude-global-conta-usar", "admin:claude-global-usuario", "admin:link-publico", "admin:link-publico-instalar", "admin:link-publico-entrar", "admin:link-publico-tunel", "admin:link-publico-usuario", "admin:link-publico-publicar", "admin:link-publico-remover", "admin:usuario-seletores", "admin:usuarios-sincronizar", "admin:usuario-maiores", "admin:usuario-apagar-item", "admin:backup-listar", "admin:backup-criar", "admin:backup-conferir", "admin:backup-restaurar", "admin:backup-whatsapp", "picker:support-refresh", "picker:support-add", "picker:support-archive", "picker:support-rename", "picker:support-remove", "picker:produtos-abrir", "produtos:listar", "produtos:salvar", "produtos:remover", "produtos:exportar", "produtos:catalogo", "ui:bot-menu"] as const;

export type SharedChannel = (typeof SHARED_CHANNELS)[number];
export type ClientChannel = (typeof CLIENT_CHANNELS)[number];
export type AdminChannel = (typeof ADMIN_CHANNELS)[number];
/** meu-bot-admin-mac: as contas deste Mac (a janela única do app). Só respondem nessa variante (caps.usuariosMac). */
export const MAC_CHANNELS = ["mac:usuarios", "mac:usuario-criar", "mac:usuario-apagar", "mac:usuario-apelido"] as const;
export type MacChannel = (typeof MAC_CHANNELS)[number];
export type IpcChannel = SharedChannel | ClientChannel | AdminChannel;

/** O que um canal de cliente responde no meu-bot-admin. */
export const ADMIN_READONLY_MSG = "o meu-bot-admin só lê; use as ações de suporte";
/** O que um canal de admin responde no meu-bot normal (ninguém chama; é só a recusa). */
export const NOT_ADMIN_MSG = "origem inválida";
