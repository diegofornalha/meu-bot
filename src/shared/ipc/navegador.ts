/** Contrato IPC · Aba Navegador: extensões, serviços, espaços, favoritos, agente. Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */

/**
 * Notificações das páginas do Navegador (do REA do Rambox, com a camada do meu-bot por cima): cada notificação de
 * um site vira uma mensagem numa conversa, com a instrução da pessoa, e o agente a trata; a notificação do sistema
 * leva à conversa. `hosts` vazio = todo site; `mode` "site" = uma conversa por site, "each" = uma por notificação.
 */
/** Quando o Mac avisa: "tratado" = depois de o agente responder, com a resposta; "chegada" = na hora, com o aviso do site; "nunca" = só a conversa. */

/** Aba "Navegador" (módulo Pro): a sessão da máquina (partição dos `<webview>`) e as extensões instaladas nela. */
/** `icon` = data URL do ícone (para o botão na barra, como no Chrome/Rambox); `popup` = url chrome-extension:// do popup, se houver. */
export interface BrowserExtensionInfo { id: string; name: string; version: string; icon: string | null; popup: string | null; /** Vem com o app (extensão do CRM próprio): não se remove. */ embutida?: true }
export interface BrowserOpenInfo { partition: string; extensions: BrowserExtensionInfo[]; agent: BrowserAgentState; favoritos: NavFavorito[]; espacos: NavWorkspaces }
/**
 * Espaços de trabalho do Navegador (do REA do Rambox: grupos/workspaces com apps fixos num trilho). Por máquina.
 * O que cada espaço representa (um cliente, um projeto…) é a pessoa quem decide pelo nome; cada um tem os sites
 * fixos (serviços), que abrem em abas permanentes enquanto o Navegador existe (as notificações deles chegam).
 */
export interface NavService { id: string; nome: string; url: string; icone: string | null }
export interface NavWorkspace { id: string; nome: string; servicos: NavService[]; /** Oculto: fora do seletor e sem abas, sem apagar nada; volta pelo grupo "Ocultos". */ oculto?: true }
export interface NavWorkspaces { ativo: string | null; lista: NavWorkspace[] }
/** Favorito da barra do Navegador (por máquina; o agente também adiciona/remove pelas ações). */
export interface NavFavorito { id: string; titulo: string; url: string }
/** "Agente pode usar" o Navegador: ligado? o túnel reverso está de pé? em que porta da máquina? */
export interface BrowserAgentState { on: boolean; state: "up" | "down" | "connecting"; port: number | null }

/**
 * O Navegador para o agente do WhatsApp (botão 📱). `liberados` = números (só dígitos) que podem usá-lo. `suportado`
 * falso = o gateway da máquina não tem o recurso (`motivo` diz por quê). `editavel` = a lista é do app e a pessoa a
 * muda pelo 📱 (Hermes); no OpenClaw quem pode vem da configuração do gateway.
 */
export interface NavWhatsappInfo { on: boolean; liberados: string[]; gateway: "hermes" | "openclaw" | "picoclaw" | null; suportado: boolean; editavel: boolean; motivo?: string }
