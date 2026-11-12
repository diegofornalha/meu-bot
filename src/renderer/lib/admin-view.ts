/**
 * Variante: admin. Textos e linhas da página "Suporte" do meu-bot-admin e do seletor de pessoas, sem DOM.
 * Puro: testável com node --test. O desenho fica em admin/suporte-page.ts e admin/picker-chrome.ts.
 */
import type { Abertura, AdminAction, AdminHealth, LicenseDevice, LicenseView, PrepararVisao, SupportPerson, SupportProgress } from "../../shared/ipc";
import { tutorialNumber } from "./tutoriais.js";

/** Preparar máquina: um item por linha; ok → ✓, falta → ✗ com o detalhe, humano → • com o que a pessoa faz. */
export function linhasPreparar(v: Pick<PrepararVisao, "itens">): HealthLine[] {
  return v.itens.map((i) => { const l: HealthLine = { text: i.titulo, ok: i.estado === "ok" ? true : i.estado === "falta" ? false : null }; if (i.detalhe !== "") l.step = ` · ${i.detalhe}`; return l; });
}

/** Backend de uma box atrás do que o app traz: sem versão gravada conta como antigo; compara número a número (1.10 > 1.9). */
export function backendAtras(instalada: string | null, doApp: string | null): boolean {
  if (doApp === null) return false;
  if (instalada === null) return true;
  const a = instalada.split(".").map(Number); const b = doApp.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] ?? 0; const y = b[i] ?? 0; if (x !== y) return x < y; }
  return false;
}

/** Limite de disco de uma conta em % do disco principal, arredondado; null = sem limite ou disco não lido. */
export const pctDe = (limiteKb: number | null, discoKb: number | null): number | null => (limiteKb === null || discoKb === null || discoKb === 0 ? null : Math.round((limiteKb * 100) / discoKb));
/**
 * O texto do campo "% do disco" de uma conta, o mesmo para mostrar e para Salvar: o rascunho digitado ou, sem ele, o %
 * atual. Vazio = sem limite. Antes o Salvar lia só o rascunho: salvar sem editar (como a dica "sem folga" manda) zerava o limite.
 */
export const textoDoLimite = (rascunho: string | undefined, limiteKb: number | null, discoKb: number | null): string => {
  if (rascunho !== undefined) return rascunho;
  const pct = pctDe(limiteKb, discoKb);
  return pct === null ? "" : String(pct);
};

export const ADMIN_ACTIONS: readonly { id: AdminAction; label: string; confirm: string }[] = [
  { id: "install-backend", label: "Instalar o backend do meu-bot", confirm: "Confirmar? instala na conta dela (porta livre escolhida sozinha)" },
  { id: "restart-gateway", label: "Reiniciar o gateway do WhatsApp", confirm: "Confirmar? o WhatsApp dela cai por ~1 min" },
  { id: "restart-backend", label: "Reiniciar o backend do meu-bot", confirm: "Confirmar? conversas em andamento caem" },
  { id: "transcription", label: "Ativar a transcrição de áudio", confirm: "Confirmar? baixa ~500 MB na máquina dela" },
  { id: "transcription-off", label: "Desativar a transcrição de áudio", confirm: "Confirmar? o agente dela deixa de entender áudios" },
  { id: "support-off", label: "Desligar o suporte desta pessoa", confirm: "Confirmar? o seu acesso a esta máquina acaba agora" },
  { id: "support-on", label: "Religar o suporte deste Mac", confirm: "Confirmar? o admin volta a entrar neste Mac" },
];

/** Uma linha da lista de saúde/progresso: ✓ (ok), ✗ (bad) ou • (null). */
export interface HealthLine { text: string; ok: boolean | null; step?: string }

/** MB → "12 GB" / "820 MB" (uma casa só abaixo de 10 GB). */
export const gb = (mb: number): string => (mb >= 10_240 ? `${Math.round(mb / 1024)} GB` : mb >= 1024 ? `${(mb / 1024).toFixed(1).replace(".", ",")} GB` : `${Math.round(mb)} MB`);

/** "este Mac": o backend é o de cada app aberto; nenhum aberto não é defeito (sobe quando um abrir). */
export function linhaAppsDoMac(apps: readonly { nome: string; porta: number; noAr: boolean }[]): HealthLine {
  const noAr = apps.filter((a) => a.noAr);
  return noAr.length > 0
    ? { text: `backend dos apps no ar: ${noAr.map((a) => `${a.nome} (${a.porta})`).join(", ")}`, ok: true }
    : { text: "nenhum app meu-bot aberto: o backend de cada app sobe quando ele abre", ok: null };
}
export function healthLines(h: AdminHealth, fmtPhone: (digits: string | null) => string): HealthLine[] {
  const p = h.probe;
  const lines: HealthLine[] = [];
  // Versão e última abertura do app dela ficam nos devices da licença (cada app se apresenta ao abrir), não aqui.
  lines.push(
    { text: p.reachable ? `entra por SSH (${p.user ?? "?"} · ${p.os ?? "?"})` : `não entra por SSH: ${p.error ?? "sem detalhes"}`, ok: p.reachable },
    h.appsDoMac !== undefined ? linhaAppsDoMac(h.appsDoMac) : { text: p.backendListening ? "backend do meu-bot no ar" : p.backendInstalled ? "backend instalado mas parado" : "sem o backend do meu-bot", ok: p.backendListening },
    { text: p.claudeLoggedIn ? "Claude Code logado" : "Claude Code deslogado", ok: p.claudeLoggedIn },
    h.xai === null ? { text: "xAI (Grok): não preparada nesta máquina", ok: null }
      : h.xai.loggedIn ? { text: `xAI (Grok) logada${h.xai.email !== null ? ` (${h.xai.email})` : ""}`, ok: true }
        : { text: "xAI (Grok) deslogada: o grok-4 não responde", ok: false },
    { text: p.statusLine ? "status line instalada" : "sem status line", ok: p.statusLine },
  );
  // Disco da home e memória (como o Rambox mede): o whisper baixa ~500 MB e o OpenClaw enche de transcripts.
  if (typeof p.diskTotalMb === "number" && p.diskTotalMb > 0 && typeof p.diskFreeMb === "number") {
    lines.push({ text: `disco: ${gb(p.diskFreeMb)} livres de ${gb(p.diskTotalMb)}${p.diskFreeMb < 2048 ? " · pouco espaço" : ""}`, ok: p.diskFreeMb >= 2048 });
  }
  // Memória "apertada" com a mesma régua do vigia do backend (saude-maquina.js: menos de 10% livre) ou abaixo de 512 MB.
  if (typeof p.memTotalMb === "number" && p.memTotalMb > 0 && typeof p.memFreeMb === "number") {
    const apertada = p.memFreeMb < 512 || p.memFreeMb / p.memTotalMb < 0.1;
    const swap = p.swapTotalMb === 0 ? " · sem swap" : typeof p.swapTotalMb === "number" && typeof p.swapFreeMb === "number" ? ` · swap ${gb(p.swapFreeMb)} livres` : "";
    lines.push({ text: `memória: ${gb(p.memFreeMb)} livres de ${gb(p.memTotalMb)}${swap}${apertada ? " · apertada" : ""}`, ok: apertada ? false : null });
  }
  // Alerta do vigia (o backend já avisou o dono pelo WhatsApp): a box dela no limite, memória da máquina acabando por 90 s, disco cheio ou travando.
  if (p.backendAlerta !== null && p.backendAlerta !== undefined) {
    lines.push({ text: p.backendAlerta === "box" ? "vigia: a box dela está no limite de RAM/CPU (a pessoa foi avisada): aumente a RAM máx na aba Usuários ou veja o que pesa" : p.backendAlerta === "memoria" ? "vigia: memória quase no fim (a pessoa foi avisada)" : p.backendAlerta === "disco" ? "vigia: disco quase cheio (a pessoa foi avisada)" : "vigia: o backend está travando (a pessoa foi avisada)", ok: false });
  }
  const wa = h.whatsapp;
  if (wa !== null && wa.present) {
    lines.push({ text: wa.connected ? `WhatsApp conectado${wa.number !== null ? ` (${fmtPhone(wa.number)})` : ""}` : `WhatsApp: ${wa.detail}`, ok: wa.connected });
    if (wa.dmPolicy !== null) lines.push({ text: `responde: ${wa.dmPolicy === "open" ? "todo mundo" : wa.dmPolicy === "allowlist" ? "só a dona do número" : wa.dmPolicy}`, ok: null });
    if (wa.audioIn !== undefined) lines.push({ text: wa.audioIn ? "entende áudios" : "não entende áudios (sem transcrição)", ok: wa.audioIn });
    if (wa.audioOut !== undefined) lines.push({ text: `responde em áudio: ${wa.audioOut === "inbound" ? "quando recebe áudio" : wa.audioOut === "always" ? "sempre" : "nunca"}`, ok: null });
  }
  return lines;
}

/** Rótulos do plano/status, como as telas de billing do Rambox. */
export const PLAN_LABEL: Record<LicenseView["license"]["plan"], string> = { free: "Free", pro: "Pro" };
export const STATUS_LABEL: Record<LicenseView["license"]["status"], string> = { free: "Free", trialing: "Trial", active: "Ativo", expired: "Expirado" };
/** Ciclo de cobrança legível; "-" quando não há (ex.: em trial), como a tela colada. */
export const billingCycleText = (interval: LicenseView["license"]["interval"]): string => (interval === "month" ? "mensal" : interval === "year" ? "anual" : "-");

/** "15 de out. de 2026" a partir de um ISO; "-" se a data não vale. */
export function fmtDate(iso: string | null): string {
  if (iso === null || iso === "") return "-";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "-" : new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

/** O resumo da conta (plano, status, membro desde, ciclo, validade, devices), como o painel do Rambox. */
/** Add-on como a janela recebe do main (caps.addons, catálogo em app/variant-core.ts). */
export type AddonRotulo = { nome: string; rotulo: string };
/** Nome do add-on para ler ("Financeiro"); MVP fora do catálogo fica com o id. */
export const produtoLabel = (id: string, addons: readonly AddonRotulo[] = []): string => addons.find((a) => a.nome === id)?.rotulo ?? id;
export function licenseSummary(view: LicenseView, now: number = Date.now(), addons: readonly AddonRotulo[] = []): HealthLine[] {
  const l = view.license;
  const lines: HealthLine[] = [
    // `produtos` pode faltar num backend antigo (licença sem o campo): trata como nenhum.
    { text: `Plano: ${PLAN_LABEL[l.plan]}${(l.produtos ?? []).length > 0 ? ` + ${l.produtos.map((p) => produtoLabel(p, addons)).join(", ")}` : ""}`, ok: l.plan !== "free" || (l.produtos ?? []).length > 0 ? true : null },
    { text: `Status: ${STATUS_LABEL[l.status]}`, ok: l.status === "active" ? true : l.status === "expired" ? false : null },
    { text: `Membro desde: ${fmtDate(l.memberSince)}`, ok: null },
    { text: `Ciclo de cobrança: ${billingCycleText(l.interval)}`, ok: null },
  ];
  if (l.status === "trialing" && l.trialEnd !== null) lines.push({ text: `Trial termina: ${fmtDate(l.trialEnd)}`, ok: null });
  if (l.expiresAt !== null) lines.push({ text: `Expira: ${fmtDate(l.expiresAt)}`, ok: Date.parse(l.expiresAt) < now ? false : null });
  lines.push({ text: `Devices: ${view.activeCount}/${view.deviceLimit} ativos${view.pendingCount > 0 ? ` · ${view.pendingCount} pedido(s) de device` : ""}`, ok: view.pendingCount > 0 ? false : null });
  return lines;
}

/** ISO → "2027-10-15" para preencher um <input type=date>; "" quando nulo/inválido. */
export function isoToDateInput(iso: string | null): string {
  if (iso === null || iso === "") return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toISOString().slice(0, 10);
}
/** "2027-10-15" (valor de <input type=date>) → ISO meia-noite UTC; null se vazio ou inválido (limpa o campo). */
export function dateInputToIso(value: string): string | null {
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00.000Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Rótulo de status de um device. */
export const deviceStatusLabel = (s: LicenseDevice["status"]): string => (s === "pending" ? "Pendente" : "Ativo");
/** "meu-bot 0.2.0 · meu-bot-crm 0.2.0" quando o device já se apresentou com mais de um app; senão a versão do app (registro antigo). */
export function appsText(d: Pick<LicenseDevice, "app" | "apps">): string {
  const names = Object.keys(d.apps ?? {}).sort();
  if (names.length === 0) return d.app !== "" ? d.app : "?";
  return names.map((n) => `${n} ${d.apps[n]?.version || "?"}`).join(" · ");
}
/** Um device em partes: nome em destaque, metadados (sistema · apps) em cinza, status e "visto há" (ou "mão levantada"). */
export interface DeviceParts { name: string; meta: string; status: string; seen: string; ok: boolean }
export function deviceParts(d: LicenseDevice, now: number = Date.now()): DeviceParts {
  const seen = d.status === "pending" ? "mão levantada" : d.lastSeen !== "" ? timeAgo(d.lastSeen, now) : "";
  return { name: d.name !== "" ? d.name : d.id, meta: `${d.platform !== "" ? d.platform : "?"} · ${appsText(d)}`, status: deviceStatusLabel(d.status), seen, ok: d.status !== "pending" };
}
/** Uma linha de device para a tabela de máquinas (nome + sistema + apps/versão + status + visto há). */
export function deviceLine(d: LicenseDevice, now: number = Date.now()): HealthLine {
  const p = deviceParts(d, now);
  return { text: `${p.name} · ${p.meta} · ${p.status}${p.seen !== "" ? ` · ${p.seen}` : ""}`, ok: p.ok };
}

/** Canal pelo nome do app: meu-bot-staging (e outros -staging) é staging; o resto é produção. */
export const canalDoProduto = (produto: string): "staging" | "produção" => (/-staging$/.test(produto) ? "staging" : "produção");
const quandoCurto = (iso: string): string => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
/** Uso do app: a última abertura de cada app (produção, staging…), mais recente primeiro, com a versão. */
export function usoResumo(ab: readonly Abertura[], now: number = Date.now()): HealthLine[] {
  const ultima = new Map<string, Abertura>();
  for (const a of ab) if (!ultima.has(a.produto)) ultima.set(a.produto, a);
  return [...ultima.values()].map((a) => ({ text: `${canalDoProduto(a.produto) === "staging" ? "Staging" : "Produção"} (${a.produto}): versão ${a.versao}${a.conta !== "" ? ` · conta ${a.conta}` : ""} · aberto ${agoText(a.em, now) || quandoCurto(a.em)}`, ok: null }));
}
/** Uma linha do histórico: quando, app (canal), versão e o Mac. */
export const aberturaTexto = (a: Abertura): string =>
  `${quandoCurto(a.em)} · ${a.produto} (${canalDoProduto(a.produto)}) ${a.versao}${a.conta !== "" ? ` · ${a.conta}` : ""}${a.mac !== "" ? ` · Mac ${a.mac}` : ""}`;
export const USO_VAZIO_TEXTO = "Ainda sem registro: as aberturas aparecem aqui quando o app da pessoa abrir com o backend atualizado.";

export function progressLines(prog: SupportProgress): HealthLine[] {
  const lines: HealthLine[] = [
    { text: prog.tour === "done" ? "Tour do meu-bot: feito" : prog.tour === "skipped" ? "Tour do meu-bot: pulado" : "Tour do meu-bot: não feito", ok: prog.tour === "done" },
  ];
  for (const t of prog.tutorials) {
    // O payload traz só o id; o número fixo vem da trilha ("17 · Status line do Claude"), para o suporte dizer "faz o 17".
    const n = tutorialNumber(t.id);
    const name = n === null ? t.title : `${n} · ${t.title}`;
    if (t.comingSoon) { lines.push({ text: `${name}: em breve`, ok: null }); continue; }
    const line: HealthLine = { text: `${name}: ${t.finished ? "concluído" : `${t.done} de ${t.total}`}`, ok: t.finished ? true : t.done > 0 ? null : false };
    if (!t.finished && t.current !== null) line.step = ` · parou em "${t.current}"`;
    lines.push(line);
  }
  return lines;
}

export const progressEmptyText = (who: string): string =>
  `Ainda sem dados: o meu-bot de ${who} grava o progresso na máquina quando ela abre o app com o suporte ligado.`;

export const progressUpdatedText = (at: string): string =>
  `Atualizado ${new Date(at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}, quando o meu-bot dela estava aberto.`;

/**
 * Ações que fazem sentido: reiniciar sempre; transcrição só em máquina cujo agente transcreve áudio (capacidade
 * `audio`: Ativar quando ela não entende áudios, Desativar quando entende). Sem saúde ainda, só o que não depende dela.
 */
/** `machine` da pessoa "este Mac" (o Mac do próprio admin, adotado pelo seletor; support-admin.ts esteMacComoPessoa). */
export const ESTE_MAC_MAQUINA = "este-mac";
/**
 * Por que este Mac não tem Instalar/Reiniciar o backend: o backend dele é o dos apps meu-bot (cada app sobe o seu ao
 * abrir). O instalador é o das VMs Linux: aqui, sem systemd, ele subia o backend em primeiro plano e o "Rodando…" não
 * acabava (10 nov 2026).
 */
export const ESTE_MAC_BACKEND_TEXTO = "Neste Mac o backend é o dos apps meu-bot: cada app (meu-bot, staging…) sobe o seu ao abrir; para reiniciar, feche e abra o app. O agente do WhatsApp (e o gateway dele) só roda nas máquinas, por isso não há o que reiniciar aqui.";
/**
 * `desligado`: o admin acabou de desligar o suporte nesta janela. No este Mac sobra só "Religar" (o admin pode, a
 * máquina é dele); nas outras pessoas não sobra nada: quem religa é ela, no app dela.
 */
export const visibleActions = (h: AdminHealth | null, esteMac = false, desligado = false): readonly (typeof ADMIN_ACTIONS)[number][] =>
  ADMIN_ACTIONS.filter((o) => {
    if (o.id === "support-on") return esteMac && desligado;
    if (desligado) return false;
    if (esteMac && (o.id === "install-backend" || o.id === "restart-backend" || o.id === "restart-gateway")) return false;
    // Instalar só aparece quando a máquina está sem backend (com ele, "Reiniciar"); sem saúde ainda, não aparece.
    if (o.id === "install-backend") return h !== null && h.probe.reachable && !h.probe.backendInstalled;
    if (o.id === "restart-backend") return h === null || h.probe.backendInstalled;
    if (o.id !== "transcription" && o.id !== "transcription-off") return true;
    const wa = h?.whatsapp ?? null;
    if (wa === null || !wa.present || !wa.capacidades.audio) return false;
    // Ativar só quando a máquina tem o necessário (transcritor do root ou ffmpeg); sem isso é a aba Preparar máquina.
    return o.id === "transcription" ? wa.audioIn === false && wa.audioMaquina !== false : wa.audioIn === true;
  });

/** Por que não há ação de transcrição (null = há). */
export function transcriptionNote(h: AdminHealth | null): string | null {
  if (h === null) return null;
  if (h.whatsapp === null) return h.share.whatsapp ? "Transcrição de áudio: a máquina não tem agente com WhatsApp." : "Transcrição de áudio: ela não compartilha o WhatsApp.";
  if (!h.whatsapp.present) return "Transcrição de áudio: a máquina não tem agente com WhatsApp (a transcrição é dele).";
  if (!h.whatsapp.capacidades.audio) return `Transcrição de áudio: o agente desta máquina (${h.whatsapp.gateway ?? "desconhecido"}) não transcreve áudio pelo app.`;
  if (h.whatsapp.audioIn === false && h.whatsapp.audioMaquina === false) return "Transcrição de áudio: a máquina não tem o transcritor compartilhado nem o ffmpeg. Como root: Preparar máquina › Transcritor de áudio; o app da pessoa liga sozinho depois.";
  return null;
}

export const actionResultText = (label: string, r: { ok: boolean; detail: string }): string =>
  `${label}: ${r.ok ? "feito" : "falhou"}${r.detail !== "" ? ` · ${r.detail}` : ""}`;

/** "há …" / "agora" a partir de um ISO; "" se a data não vale. */
export function agoText(iso: string, now: number = Date.now()): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000);
  return Number.isNaN(min) ? "" : min < 1 ? "agora" : min < 60 ? `há ${min} min` : min < 48 * 60 ? `há ${Math.round(min / 60)} h` : `há ${Math.round(min / 1440)} dias`;
}
/** "visto há …" a partir de um ISO; "" se a data não vale. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = agoText(iso, now);
  return t === "" ? "" : `visto ${t}`;
}

/** O que vai depois do nome da pessoa na lista do seletor: endereço, alcance e "visto há". */
export const personSuffix = (p: SupportPerson, now: number = Date.now()): string =>
  ` · ${p.machine !== null ? `${p.machine} · ` : ""}${p.hostname}${p.port !== 22 ? `:${p.port}` : ""}${p.local ? " · só alcançável deste Mac" : ""}${p.seenAt !== "" ? ` · ${timeAgo(p.seenAt, now)}` : ""}`;

export const EMPTY_PEOPLE_TEXT = "Ninguém ainda. Clique em ⇅ para trazer as máquinas do seu ~/.ssh/config, ou use Adicionar pessoa com o código dela ou um host (ssh agente-box). Com a caixa de entrada configurada (scripts/suporte-setup.mjs), quem ligar \"Permitir suporte\" no meu-bot aparece aqui sozinho.";
/**
 * Máquinas do ~/.ssh/config deste Mac que o ⇅ do admin ainda precisa pôr na lista: todo alias que o meu-bot mostraria
 * (menos "local"), tirando os aliases de suporte (`suporte-…`, são as próprias pessoas) e as máquinas que já são
 * pessoa (`machine`). Ordem de chegada, sem repetir.
 */
export function maquinasParaAdotar(aliases: readonly string[], people: readonly Pick<SupportPerson, "alias" | "machine">[]): string[] {
  const fora = new Set<string>(["local"]);
  for (const p of people) { fora.add(p.alias); if (p.machine !== null) fora.add(p.machine); }
  const out: string[] = [];
  for (const a of aliases) if (!fora.has(a) && !a.startsWith("suporte-") && !out.includes(a)) out.push(a);
  return out;
}

export const MISSING_ADMIN_KEY_TEXT = "⚠ falta a chave ~/.ssh/meu-bot-admin neste Mac: rode node scripts/suporte-setup.mjs no projeto.";
