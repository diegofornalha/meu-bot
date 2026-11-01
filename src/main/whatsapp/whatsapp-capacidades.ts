/**
 * O que cada framework de agente sabe fazer no WhatsApp (puro, testável).
 *
 * O app é agnóstico: a tela não pergunta "é OpenClaw?", pergunta "esta máquina sabe listar
 * conversas?". Antes a decisão estava espalhada em vinte lugares, cada um comparando o nome do
 * gateway, e por isso uma máquina com Hermes via mensagens escritas como se o produto estivesse
 * faltando — quando o que falta é a capacidade, não o produto.
 *
 * Esta tabela é o único lugar que conhece nomes de framework. Ganhar suporte novo é mudar uma
 * linha aqui, não caçar comparações pela tela.
 */
import type { Gateway, WhatsappAlvo, WhatsappAlvoResolvido, WhatsappCapacidades } from "../../shared/ipc";
import type { SshHostInfo } from "../maquina/sshConfig";
import type { HermesPausaModo } from "./whatsapp-hermes-core";

/** Arquivo da máquina com o motor escolhido para o WhatsApp (uma palavra: openclaw, hermes ou picoclaw). */
export const WA_AGENTE_FILE = "$HOME/.local/share/meu-bot/whatsapp-agente";
/** O conteúdo do arquivo de escolha → o motor; qualquer outra coisa é "não escolheu". */
export const agenteEscolhido = (raw: string | undefined): Gateway | null => {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "openclaw" || v === "hermes" || v === "picoclaw" ? v : null;
};
/**
 * A regra única de qual motor atende o WhatsApp da máquina, em shell. Deixa $ESC (a escolha gravada), $MOTOR
 * (hermes, openclaw, picoclaw ou vazio) e `usa_hermes`. Precedência: escolha gravada > Hermes já com o WhatsApp
 * configurado (como era antes de existir escolha) > binário openclaw (PATH ou ~/.openclaw/bin) > binário hermes (PATH ou
 * ~/.local/bin) > picoclaw com ~/.picoclaw/config.json. Antes eram quatro regras que divergiam (status, sondagem do
 * seletor, módulos e o backend): a sondagem dava o OpenClaw na frente do Hermes configurado e ignorava a escolha.
 * Uma linha só e sem comentários (o probeScript do seletor junta tudo por `; `) e segura sob `set -e` (só `if`, e a
 * leitura do arquivo com `|| true`: sem ele, a substituição falhava e um script com `set -e`, como o do objetivo, parava ali).
 * backend-colima/motor-whatsapp.js é o espelho em JS; scripts/tests/motor-whatsapp.test.mjs prova que os dois concordam.
 */
export const WA_MOTOR_SH = `ESC=$(tr -d ' \n' < "${WA_AGENTE_FILE}" 2>/dev/null || true); MOTOR=; case "$ESC" in hermes|openclaw|picoclaw) MOTOR=$ESC;; esac; if [ -z "$MOTOR" ] && [ -d "$HOME/.hermes/whatsapp" ]; then MOTOR=hermes; fi; if [ -z "$MOTOR" ] && { command -v openclaw >/dev/null 2>&1 || [ -x "$HOME/.openclaw/bin/openclaw" ]; }; then MOTOR=openclaw; fi; if [ -z "$MOTOR" ] && { command -v hermes >/dev/null 2>&1 || [ -x "$HOME/.local/bin/hermes" ]; }; then MOTOR=hermes; fi; if [ -z "$MOTOR" ] && { command -v picoclaw >/dev/null 2>&1 || [ -x "$HOME/.local/bin/picoclaw" ]; } && [ -f "$HOME/.picoclaw/config.json" ]; then MOTOR=picoclaw; fi; usa_hermes() { [ "$MOTOR" = hermes ]; }`;

/** Arquivo da máquina com onde vive o WhatsApp (conta, agente e dono do gateway); sem ele, o padrão. Dono: este módulo. */
export const WA_ALVO_FILE = "$HOME/.local/share/meu-bot/whatsapp-alvo.json";
/** Trecho de shell (uma linha) que imprime `alvo=<json ou vazio>`; vai junto do status e da sonda do motor. */
export const WA_ALVO_SH = `echo "alvo=$(cat "${WA_ALVO_FILE}" 2>/dev/null | tr -d '\n')"`;
const ID_RE = /^[a-z0-9][a-z0-9_.-]{0,31}$/;
const USUARIO_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
export const ALVO_PADRAO: WhatsappAlvo = { accountId: "default", agentId: "main", gatewayUser: null };
/** O JSON do arquivo (ou qualquer lixo) → um alvo válido; ids fora do padrão caem no padrão, campo por campo. */
export function parseAlvo(raw: unknown): WhatsappAlvo {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ...ALVO_PADRAO };
  const o = raw as Record<string, unknown>;
  const id = (v: unknown, padrao: string): string => (typeof v === "string" && ID_RE.test(v) ? v : padrao);
  const gatewayUser = typeof o["gatewayUser"] === "string" && USUARIO_RE.test(o["gatewayUser"]) ? o["gatewayUser"] : null;
  const numero = typeof o["numero"] === "string" && /^\d{8,15}$/.test(o["numero"]) ? o["numero"] : null;
  return { accountId: id(o["accountId"], "default"), agentId: id(o["agentId"], "main"), gatewayUser, ...(numero === null ? {} : { numero }) };
}
/** Um alvo válido para gravar, ou a razão da recusa. */
export function alvoValido(a: WhatsappAlvo): string | null {
  if (!ID_RE.test(a.accountId)) return "conta inválida (letras minúsculas, dígitos, _ . -; até 32)";
  if (!ID_RE.test(a.agentId)) return "agente inválido (letras minúsculas, dígitos, _ . -; até 32)";
  if (a.gatewayUser !== null && !USUARIO_RE.test(a.gatewayUser)) return "usuário do gateway inválido";
  if (a.numero !== undefined && a.numero !== null && !/^\d{8,15}$/.test(a.numero)) return "número inválido (só dígitos, com DDI, 8 a 15)";
  return null;
}
/**
 * O alias SSH do gateway, neste Mac: o host do ~/.ssh/config com o mesmo HostName do alias da máquina e User igual ao
 * `gatewayUser`. Sem alias para esse usuário, `gatewayHost` fica null e a tela explica o que falta (o app não inventa
 * conexão). `gatewayUser` null (ou igual ao User do próprio alias) = gateway próprio.
 */
export function resolverAlvo(alvo: WhatsappAlvo, host: string, hosts: readonly SshHostInfo[]): WhatsappAlvoResolvido {
  const meu = hosts.find((h) => h.host === host) ?? null;
  if (alvo.gatewayUser === null || (meu !== null && meu.user === alvo.gatewayUser)) return { ...alvo, gatewayUser: null, gatewayHost: null, proprio: true };
  const alvoHost = meu === null || meu.hostName === null ? null : hosts.find((h) => h.hostName === meu.hostName && h.user === alvo.gatewayUser)?.host ?? null;
  return { ...alvo, gatewayHost: alvoHost, proprio: false };
}
/** O que falta quando o gateway é de outro usuário e este Mac não tem alias para ele (pt-BR). */
export const alvoSemAlias = (a: WhatsappAlvoResolvido): string | null =>
  a.proprio || a.gatewayHost !== null ? null : `o WhatsApp desta conta vive no gateway do usuário ${a.gatewayUser ?? "?"} nesta máquina, e este Mac não tem um alias SSH para ele (mesmo HostName, User ${a.gatewayUser ?? "?"}): no meu-bot-admin, aba Usuários, sincronize os seletores`;

const NADA: WhatsappCapacidades = {
  parear: false, listarConversas: false, lerConversa: false, limparHistorico: false, gatewayProprio: false, gruposAtualizar: false,
  pausar: false, pausaPrazo: false, pausaNativa: false, grupos: false, guarda: false, politicaDm: false, audio: false, politicaReinicia: false,
};

/** O que a máquina tem além do motor: como a pausa por contato é feita no Hermes (whatsapp-hermes-core.ts › hermesPausaModo) e se o gateway é desta conta. */
export interface CapacidadesHermes { pausaModo: HermesPausaModo; proprio?: boolean }
const HERMES_PADRAO: CapacidadesHermes = { pausaModo: "allowlist" };

/**
 * `ready` = dá para parear (tem bridge/plugin). `connected` = o número está vinculado. Capacidade
 * que depende de conversa existir só vale com o número conectado; sem isso a tela ofereceria algo
 * que falharia na primeira tentativa. `hermes` só é lido para o Hermes.
 */
export function capacidadesDe(gateway: Gateway | null, ready: boolean, connected: boolean, hermes: CapacidadesHermes = HERMES_PADRAO): WhatsappCapacidades {
  if (gateway === null || !ready) return NADA;
  const proprio = hermes.proprio !== false;
  switch (gateway) {
    // OpenClaw guarda a conversa num banco próprio e expõe sessões pelo gateway: dá para tudo.
    // Pausar lá é `sendPolicy: deny` na sessão do contato (sem prazo; o agente vê e não responde).
    // Com o gateway de outro usuário (uma conta num gateway único): a guarda é do gateway, e "Atualizar lista" de grupos
    // para o gateway inteiro, então ficam fora; o resto vale igual, pela conta.
    case "openclaw":
      return {
        parear: true, listarConversas: connected, lerConversa: connected, limparHistorico: connected, gatewayProprio: proprio, gruposAtualizar: connected && proprio,
        pausar: connected, pausaPrazo: false, pausaNativa: false, grupos: connected, guarda: proprio, politicaDm: true, audio: true, politicaReinicia: false,
      };
    // Hermes não tem banco de conversas; o histórico vem do hook `wa-mirror`, que grava em
    // ~/.hermes/wa-mirror/inbox.jsonl o que o agente atendeu (mensagem truncada em 500 caracteres,
    // limite do próprio Hermes). Dá para listar, ler e limpar (encerra as sessões do contato no state.db);
    // quem responde vive no ~/.hermes/.env (whatsapp-hermes-core.ts) e aplicar reinicia o gateway.
    // Grupos: ligar/desligar e "quando chamado" vão para o config.yaml (platforms.whatsapp) com reinício; quem aciona
    // é a lista única das conversas diretas. Guarda não existe lá.
    // Pausar por contato: o Hermes não tem (NousResearch/hermes-agent#146672). Com o plugin meu-bot-pausa carregado
    // (`pausaPrazo`), pausar é só a marca em whatsapp-lista.json: vale em qualquer política, tem prazo e as mensagens
    // da pausa ficam guardadas (contorno #2). Sem ele, é tirar da WHATSAPP_ALLOWED_USERS com reinício, e o agente nem
    // vê as mensagens nesse período (contorno #1). `pausaNativa` é o dia em que o Hermes trouxer isso de fábrica.
    // Áudio: o app grava `stt` e `voice.auto_tts` no config.yaml (hermes-audio.ts); só não há escolha de voz.
    case "hermes": {
      const prazo = connected && hermes.pausaModo !== "allowlist";
      return { ...NADA, parear: true, listarConversas: connected, lerConversa: connected, limparHistorico: connected, gatewayProprio: true, gruposAtualizar: connected, pausar: connected, pausaPrazo: prazo, pausaNativa: hermes.pausaModo === "nativa", grupos: connected, politicaDm: true, audio: true, politicaReinicia: true };
    }
    // PicoClaw: pareia e tem política de quem o agente responde; o resto ainda não foi mapeado.
    case "picoclaw":
      return { ...NADA, parear: true, politicaDm: true, gatewayProprio: true };
    default:
      return NADA;
  }
}
