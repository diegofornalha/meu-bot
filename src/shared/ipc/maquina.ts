/** Contrato IPC · Máquinas: sondagem, backend, instalação, Tailscale, SSH. Só tipos (nada é emitido); reexportado por src/shared/ipc.ts. */
import type { SupportPerson } from "./suporte";
import type { Capabilities } from "./app";

/** Estado do túnel/backend, enviado ao renderer. */
export interface BackendStatusEvent {
  /** Host SSH a que o estado se refere (um túnel por host). */
  host: string;
  state: "idle" | "connecting" | "ready" | "degraded" | "error";
  detail: string;
  /** A máquina não tem o backend do meu-bot: a janela oferece "Instalar backend" ali mesmo. */
  semBackend?: true;
}

/** Resultado da sondagem de um host SSH, para o seletor de máquinas. */
export interface HostProbe {
  host: string;
  /** `HostName` do bloco deste alias no ~/.ssh/config deste Mac (IP ou nome DNS, como está lá); null sem bloco ou sem HostName. */
  hostName: string | null;
  reachable: boolean;
  /** O ssh recusou entrar porque a chave da máquina mudou (sistema reinstalado, ou outra máquina no mesmo endereço): não é "fora do ar". */
  hostKeyChanged: boolean;
  user: string | null;
  /** Apelido da conta gravado na máquina (o admin dá na aba Usuários); null = nenhum. Vale para qualquer Mac. */
  apelido: string | null;
  os: string | null;
  arch: string | null;
  /** Há o backend do meu-bot (server.js nosso e .env) na pasta dele: ~/.local/share/meu-bot/backend, ou a herdada quando o server.js lá é o nosso. */
  backendInstalled: boolean;
  /** A pasta herdada (~/.hermes/agente-rene/backend-sdk-claude) tem o server.js de OUTRO backend (o do Hermes): nunca é tocada; o nosso vai na pasta própria, em porta livre. */
  backendForeign: boolean;
  /** Alguém escuta na porta do backend (a do .env dele quando existe; senão `appPort`). */
  backendListening: boolean;
  /** O serviço meu-bot-backend desta conta está no ar, mas os arquivos sumiram do disco (pasta apagada; o node antigo roda de memória): reinstalar na porta dele, nunca instalar outro ao lado. */
  backendSumiu: boolean;
  /** Porta em que o processo desse serviço escuta (só com `backendSumiu`); null se não deu para ler. */
  backendUnitPort: number | null;
  /** Versão do backend instalado (VERSION gravado pelo install.sh); null = sem arquivo (anterior ao versionamento) ou sem backend. */
  backendVersion: string | null;
  /** Chats em andamento no backend (/health); null = não respondeu ou backend antigo. */
  backendBusy: number | null;
  /** Porta que o app usa para esta máquina (a sondagem foi feita com ela). */
  appPort: number;
  /** Porta declarada no .env do backend instalado; null sem backend ou sem PORT no .env. */
  backendPort: number | null;
  /** Alguém escuta em `appPort` nesta máquina. Sem backend instalado, é outra conta ou outro programa. */
  portBusy: boolean;
  /** Primeira porta livre acima de `appPort` (até +30), para instalar sem conflito; null se nenhuma. */
  freePort: number | null;
  claudePath: string | null;
  claudeLoggedIn: boolean;
  node: string | null;
  systemd: boolean;
  /** Computador do Grok Bot (pod): PID 1 pod-daemon/tini ou cgroup pod-…; tem botão de alívio. */
  grokPod: boolean;
  /** O Tailscale SSH pediu a verificação extra (check mode): a pessoa precisa aprovar um link no navegador. */
  tailscaleCheck: boolean;
  /** ~/.claude/statusline.sh é o nosso: grava ~/.cache/claude-statusline/ratelimits.json, que a status line do app lê. */
  statusLine: boolean;
  /** OpenClaw: a guarda do WhatsApp do meu-bot (plugin meu-bot-guarda) está nesta máquina; null = sem OpenClaw. */
  guarda: boolean | null;
  /** Versão da guarda instalada (package.json do plugin); null = sem guarda ou desconhecida. */
  guardaVersion: string | null;
  /** Plugin de pausa por contato do Hermes (meu-bot-pausa) instalado? null fora do Hermes. */
  hermesPausa?: boolean | null;
  hermesPausaVersion?: string | null;
  /** CRM do meu-bot instalado na máquina (null = não consultado) e a versão do plugin. */
  crm: boolean | null;
  crmVersion: string | null;
  /** Financeiro (produto meu-bot-finance) instalado na máquina (null = não consultado) e a versão do plugin. */
  finance: boolean | null;
  financeVersion: string | null;
  /** OpenClaw: o agente do WhatsApp entende áudio (transcritor configurado); null = sem OpenClaw. */
  audioIn: boolean | null;
  /** Agente de chat da máquina (openclaw tem preferência quando os dois existem). */
  gateway: Gateway | null;
  /** Disco da home e memória da máquina, em MB (null quando a sondagem não trouxe). */
  diskFreeMb: number | null;
  diskTotalMb: number | null;
  memFreeMb: number | null;
  memTotalMb: number | null;
  /** Swap da máquina em MB (0 = sem swap; null quando a sondagem não trouxe). */
  swapTotalMb: number | null;
  swapFreeMb: number | null;
  /** Alerta do vigia do backend (/health › maquina.alerta): memória, disco ou backend travando; null = nenhum ou backend antigo. */
  backendAlerta: MaquinaAlerta | null;
  /** Modelos que o backend desse host anuncia em /v1/models (vazio se não respondeu). */
  models: string[];
  error: string | null;
}

/** Alertas do vigia da máquina (backend-colima/saude-maquina.js). */
export type MaquinaAlerta = "box" | "memoria" | "disco" | "lag";

export interface InstallBackendResult {
  ok: boolean;
  log: string[];
  /** Código de saída do instalador, quando houve um (3 = precisa do admin: faltam pacotes e não há sudo). */
  codigo?: number | null;
}

export interface InstallProgressEvent {
  host: string;
  line: string;
}

/** Dados iniciais do seletor de máquinas. */
export interface PickerInit {
  hosts: string[];
  /** Endereço de cada alias no ~/.ssh/config deste Mac (HostName e User do bloco), para a lista diferenciar máquinas de mesmo nome. */
  enderecos: Record<string, { hostName: string | null; user: string | null }>;
  /** meu-bot-admin: as pessoas (os hosts são os aliases delas, só as com suporte ligado). null = meu-bot normal. */
  support: { people: SupportPerson[]; adminKey: boolean } | null;
  /** Máquina a pré-selecionar (última aberta); null = a lista está vazia (sem o host "local" e sem máquina no ~/.ssh/config). */
  preselect: string | null;
  /** Máquinas que já têm janela aberta. */
  open: string[];
  /** Máquinas (e "seletor") com atalho na área de trabalho, com o emoji do ícone de cada um. */
  shortcuts: { host: string; emoji: string | null }[];
  /** Máquinas reconhecidas como computador do Grok Bot (lembradas entre sondagens). */
  pods: string[];
  /** Máquinas com o botão "aliviar <host>.app" na área de trabalho. */
  reliefShortcuts: string[];
  /** O que o seletor esconde por capacidade (Capabilities): sem `atalhosMesa`, o botão de atalho de cada linha e o do alívio na mesa. */
  caps: Pick<Capabilities, "atalhosMesa">;
  /** Caixinha "abrir direto": marcada = sem a abertura animada. */
  /** Apelidos das máquinas (host → nome mostrado). */
  names: Record<string, string>;
  openDirect: boolean;
  /** Primeira abertura do seletor nesta sessão do app: toca a chegada animada (logo que nasce grande e vai para o cabeçalho). */
  arrival: boolean;
  /** Caixinha "onboarding feito": marcada = respeita; desmarcada = força o onboarding na próxima janela. */
  onboardingDone: boolean;
  error: string | null;
  /** Versão deste app (package.json): aparece ao lado do título, como nas janelas. */
  version: string;
  /** Reenvio porque a lista mudou com o seletor aberto: mantém a máquina selecionada (senão vale `preselect`). */
  manterSelecao?: true;
  /** Máquinas cuja sondagem guardada ficou velha (a conta acabou de ser preparada): o seletor sonda estas de novo. */
  resondar?: string[];
}

/** Agente/gateway de chat que a máquina roda; o app detecta e se adapta, nunca pressupõe. */
export type Gateway = "hermes" | "openclaw" | "picoclaw";

/** Credencial do OAuth client do Tailscale: só o estado, nunca o valor. */
export interface TailscaleCredentialState { configured: boolean; encryptionAvailable: boolean }

/** Resultado de editar a política do tailnet (ssh: check → accept) ou de restaurar um backup. */
export interface TailscaleSshResult {
  ok: boolean;
  changed: boolean;
  /** Não há OAuth client salvo: configurar no seletor. */
  needsCredential: boolean;
  detail: string;
  backupPath: string | null;
}

/** Resultado do botão "sincronizar ssh": o que entrou no ~/.ssh/config e o que faltava no Mac. */
export interface SshSyncResult {
  configPath: string;
  /** Aliases acrescentados. */
  added: string[];
  includesAdded: number;
  /** Aliases do modelo que já existiam (não tocados). */
  kept: string[];
  /** Aliases só deste Mac, que o modelo versionado não conhece. */
  onlyLocal: string[];
  /** Aliases do modelo removidos pela pessoa (marca `# meu-bot: não sincronizar …` no ~/.ssh/config): não voltaram. */
  skipped: string[];
  /** Aliases do modelo cuja máquina já existe neste Mac com outro nome (mesmo HostName, User e Port): não entraram. */
  sameTarget: { alias: string; as: string }[];
  backup: string | null;
  /** Chaves (IdentityFile) do modelo que não existem neste Mac. */
  missingKeys: string[];
}
