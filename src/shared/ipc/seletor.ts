/** Contrato IPC · Janela do seletor de máquinas (picker). Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */
import type { PlanName } from "./licenca";
import type { ContaView } from "./conta";
import type { HostProbe, InstallBackendResult, PickerInit, SshSyncResult, TailscaleCredentialState, TailscaleSshResult } from "./maquina";
import type { SupportPerson, VpsNovaResultado } from "./suporte";

/** API exposta ao seletor de máquinas como window.picker. */
/** Seletor, os dois apps. */
export interface PickerSharedApi {
  list(): Promise<PickerInit>;
  /** Plano de cada host (lido por SSH, melhor esforço) para o selo "PRO" no seletor; hosts fora do ar ficam de fora. */
  /** Máquinas cujo SSH aponta para este Mac (127.0.0.1/localhost, ex.: a VM da Colima): vão para a aba "Este Mac". */
  locais(): Promise<string[]>;
  /** Plano por host; com `host`, só o dessa máquina (o seletor pergunta uma a uma e pinta o selo de quem responder). */
  plans(host?: string): Promise<Record<string, PlanName>>;
  probe(host: string): Promise<HostProbe>;
  choose(host: string): Promise<void>;
  /** O backend desta máquina está em outra porta: o app passa a usar `port` só para ela (configuração deste Mac; nada escrito na máquina, por isso o admin também pode). */
  usePort(host: string, port: number): Promise<void>;
  /** Cria (true) ou remove (false) o atalho "meu-bot <host>.app" na área de trabalho; devolve o estado final. */
  setShortcut(host: string, create: boolean): Promise<{ has: boolean; emoji: string | null }>;
  /** Abre a janela de alívio da máquina (computador do Grok Bot) e fecha o seletor. */
  relieve(host: string): Promise<void>;
  /** Cria (true) ou remove (false) o botão "aliviar <host>.app" na área de trabalho. */
  setReliefShortcut(host: string, create: boolean): Promise<{ has: boolean }>;
  /** Abre o app do Grok Bot no card "Reset computer" (pod congelado). false se não há quem atenda grokbot://. */
  openGrokbotReset(): Promise<boolean>;
  /** Estado da credencial do OAuth client do Tailscale (nunca o valor). */
  tailscaleCredential(): Promise<TailscaleCredentialState>;
  /** Abre no navegador uma página fixa (allowlist no main): "tailscale-keys". */
  openKnownUrl(which: "tailscale-keys"): Promise<void>;
  /** Acrescenta ao ~/.ssh/config deste Mac as máquinas do modelo versionado que faltam (o Cursor lê o mesmo arquivo); o admin também. */
  syncSsh(): Promise<SshSyncResult>;
  cancel(): void;
  /** Conta meu-bot deste Mac (o seletor é o portão: sem sessão, só o cartão de login aparece). */
  contaGet(forcar?: boolean): Promise<ContaView>;
  contaEntrar(): Promise<ContaView>;
  contaCancelar(): Promise<ContaView>;
  contaSair(): Promise<ContaView>;
  contaAbrirConsole(caminho: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  on(channel: "picker:init" | "picker:install-progress" | "picker:vps-nova-progresso" | "conta:changed", callback: (payload: unknown) => void): () => void;
}

/** Variante: cliente. Seletor do meu-bot normal: instalar, renomear, remover, Tailscale. */
export interface PickerClientApi {
  install(host: string): Promise<InstallBackendResult>;
  /** Instala a status line do Claude Code na máquina (statusline.sh + statusLine no settings.json); mesmo log de progresso. */
  installStatusLine(host: string): Promise<InstallBackendResult>;
  /** Liga a transcrição de áudio do agente do WhatsApp (OpenClaw) na máquina; mesmo log de progresso. */
  installTranscription(host: string): Promise<InstallBackendResult>;
  /** Ativa a guarda do WhatsApp (plugin meu-bot-guarda) no OpenClaw da máquina; mesmo log de progresso. */
  installGuarda(host: string): Promise<InstallBackendResult>;
  /** Instala o Claude Code na conta do alias (instalador oficial, ~/.local/bin); depois vêm o login e o backend. */
  installClaude(host: string): Promise<InstallBackendResult>;
  /** Tira a máquina do seletor e do ~/.ssh/config (backup em `backup`). */
  removeHost(host: string): Promise<{ backup: string }>;
  /** Apelido da máquina no app (vazio tira); a chave SSH não muda. */
  renameHost(host: string, name: string): Promise<void>;
  /** Caixinha "abrir direto" do rodapé. */
  setOpenDirect(value: boolean): Promise<void>;
  /** O ✨ colado no Intro, no rodapé (vale para todas as janelas). */
  setInstagramavel(value: boolean): Promise<void>;
  /** Caixinha "onboarding feito" do rodapé. */
  setOnboardingDone(value: boolean): Promise<void>;
  /** Verificação do Tailscale SSH: abre um ssh que espera, leva o link ao navegador e resolve quando a pessoa aprovar. */
  approveTailscale(host: string): Promise<{ ok: boolean; detail: string }>;
  saveTailscaleCredential(clientId: string, clientSecret: string): Promise<TailscaleCredentialState>;
  forgetTailscaleCredential(): Promise<TailscaleCredentialState>;
  /** Edita a política do tailnet (ssh: check → accept); `host` só invalida a sondagem em cache. */
  disableTailscaleCheck(host: string): Promise<TailscaleSshResult>;
  /** Abre a janela da máquina já no modal "Entrar no Claude Code". */
  claudeLogin(host: string): Promise<void>;
}

/** Variante: admin. Seletor de pessoas do meu-bot-admin. */
export interface PickerAdminApi {
  /** meu-bot-admin: lê a caixa de entrada e devolve as pessoas (warning se a caixa não respondeu). */
  supportRefresh(): Promise<{ people: SupportPerson[]; warning: string | null }>;
  /** meu-bot-admin: "Adicionar pessoa" colando o código de suporte. */
  supportAdd(code: string): Promise<SupportPerson>;
  /** meu-bot-admin: arquiva/desarquiva uma pessoa na lista; devolve as pessoas. */
  supportArchive(alias: string, archived: boolean): Promise<SupportPerson[]>;
  /** meu-bot-admin: apelido para a pessoa (vazio volta ao nome que ela deu); o alias não muda. */
  supportRename(alias: string, name: string): Promise<SupportPerson[]>;
  /**
   * meu-bot-admin: "Excluir máquina": limpa todo o histórico do WhatsApp na máquina dela, desliga o suporte e tira da
   * lista (e da caixa de entrada). Máquina fora do ar: erro e ela fica; `force` tira da lista mesmo assim.
   */
  supportRemove(alias: string, force: boolean): Promise<{ people: SupportPerson[]; cleared: number; detail: string }>;
  /** meu-bot-admin: abre (ou traz para a frente) a janela Produtos, onde um MVP nasce. */
  produtosAbrir(): Promise<void>;
  /**
   * meu-bot-admin: "Nova VPS": leva uma VPS recém-criada (chave deste Mac já cadastrada no painel) ao fluxo: alias root
   * no ~/.ssh/config, pessoa na lista, Preparar máquina, primeiro usuário. Progresso em `picker:vps-nova-progresso`.
   */
  vpsNova(pedido: unknown): Promise<VpsNovaResultado>;
}
export type PickerApi = PickerSharedApi & PickerClientApi & PickerAdminApi;
