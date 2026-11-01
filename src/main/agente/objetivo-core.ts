/**
 * Tutorial 8 · "O que você quer resolver pelo WhatsApp?": a parte pura. A pessoa escolhe um objetivo e quanta
 * liberdade o agente tem; o app grava isso na máquina (objetivo.json), escreve uma skill de verdade no workspace
 * do OpenClaw (`<workspace>/skills/objetivo-whatsapp/SKILL.md`, que ele carrega como "openclaw-workspace") e
 * trava as ferramentas do dono conforme o nível. Testável sem Electron; o SSH fica em objetivo.ts.
 */
import type { FreedomLevel, MachineSkill, ObjectiveChoice, ObjectiveInfo } from "../../shared/ipc";
import { DESCONHECIDO_DENY, NAV_DENY } from "../navegador/navegador-whatsapp-core";
import { WA_MOTOR_SH } from "../whatsapp/whatsapp-capacidades";
import { HERMES_RESTART_SH, HERMES_WA_ENSURE_SH } from "../whatsapp/whatsapp-hermes-core";

/** Nome fixo da skill: salvar de novo substitui a anterior (uma por máquina). */
export const OBJECTIVE_SKILL = "objetivo-whatsapp";
/**
 * Skills que o próprio app semeia em ~/.claude/skills com o Navegador (backend-colima/skill-*.md). Não são
 * "aprendidas": listadas no Acervo assim que a pessoa entrava, mostravam Cloudflare, Streak, CRM e 2FA a quem nunca foi
 * apresentado a isso. As do Cloudflare seguem na Biblioteca do meu-bot (oculta até pedir).
 */
export const SKILLS_DO_APP: readonly string[] = ["cloudflare-token", "crm-api", "finance-api", "google-2fa-autenticador", "streak-crm-api", "streak-crm-navegador", "subir-site-cloudflare"];
export const OBJECTIVE_FILE = "$HOME/.local/share/meu-bot/objetivo.json";

/** O que um contato que não é o dono nunca pode usar (a mesma trava do pareamento, whatsapp.ts). */
const OTHERS_DENY = ["write", "edit", "apply_patch", "exec", "process", "code_execution", "cron", "gateway", "group:automation", "group:nodes", "terminal", "skill_workshop", "sessions_spawn"] as const;
/** O "*" da trava: o que muda a máquina e o Navegador do dono (liberado por remetente em navegador-whatsapp-core.ts). */
const STAR_DENY: readonly string[] = [...OTHERS_DENY, ...DESCONHECIDO_DENY, ...NAV_DENY];

/** Os três níveis: o que o agente pode fazer, para o dono. A trava do OpenClaw segue `deny`. */
export const LEVELS: readonly { id: FreedomLevel; title: string; text: string; rules: string[]; deny: readonly string[] }[] = [
  {
    id: "conversa", title: "Só conversa", text: "Responde, orienta e combina coisas, mas não mexe em nada: não roda comandos, não grava arquivos, não agenda.",
    rules: ["Você só conversa: responde, orienta e combina. Não rode comandos, não grave nem edite arquivos, não agende nada.", "Se a pessoa pedir uma ação na máquina, explique que isso fica para o dono fazer no computador."],
    deny: OTHERS_DENY,
  },
  {
    id: "consulta", title: "Consulta e organiza", text: "Lê arquivos e a internet, anota e organiza no seu workspace, mas não roda comandos nem agenda.",
    rules: ["Você pode ler arquivos e pesquisar, e pode anotar e organizar no seu workspace (notas, listas, memória).", "Não rode comandos no sistema, não agende tarefas e não mexa no gateway."],
    deny: ["exec", "process", "code_execution", "cron", "gateway", "group:automation", "group:nodes", "terminal", "skill_workshop", "sessions_spawn"],
  },
  {
    id: "age", title: "Age por mim", text: "Faz o que for preciso: roda comandos, mexe em arquivos e agenda, como se fosse o dono.",
    rules: ["Você age pelo dono: pode rodar comandos, mexer em arquivos e agendar tarefas quando isso resolver o pedido.", "Antes de algo irreversível (apagar, enviar para terceiros, gastar dinheiro), confirme em uma linha."],
    deny: [],
  },
];
export const levelOf = (id: string | null | undefined): (typeof LEVELS)[number] | null => LEVELS.find((l) => l.id === id) ?? null;

const SAFE_TEXT_RE = /[^\p{L}\p{N} .,;:!?()'"\-\n]/gu;
const clean = (s: string, max: number): string => s.replace(SAFE_TEXT_RE, "").replace(/\s+/g, " ").trim().slice(0, max);

/** Saneia o que a tela mandou: id curto, rótulo e frase sem caracteres estranhos. */
export function parseObjectiveChoice(v: unknown): ObjectiveChoice | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as { id?: unknown; label?: unknown; text?: unknown };
  if (typeof o.id !== "string" || !/^[a-z][a-z0-9-]{1,30}$/.test(o.id)) return null;
  const label = clean(typeof o.label === "string" ? o.label : "", 60);
  const text = clean(typeof o.text === "string" ? o.text : "", 300);
  if (label === "") return null;
  if (o.id === "outro" && text === "") return null;
  return { id: o.id, label, text };
}

/** O objetivo.json da máquina, saneado; lixo = nada escolhido. */
export function parseObjectiveFile(raw: unknown): Pick<ObjectiveInfo, "objective" | "level" | "savedAt"> {
  const none = { objective: null, level: null, savedAt: null };
  if (raw === null || typeof raw !== "object") return none;
  const o = raw as { objective?: unknown; level?: unknown; savedAt?: unknown };
  const savedAt = typeof o.savedAt === "string" && !Number.isNaN(Date.parse(o.savedAt)) ? o.savedAt : null;
  return { objective: parseObjectiveChoice(o.objective), level: levelOf(typeof o.level === "string" ? o.level : null)?.id ?? null, savedAt };
}

/** Linhas "K<TAB>nome<TAB>descrição" do script remoto → skills do workspace. */
export function parseMachineSkills(stdout: string): MachineSkill[] {
  const out: MachineSkill[] = [];
  for (const line of stdout.split("\n")) {
    const [tag, name, description] = line.split("\t");
    if ((tag !== "K" && tag !== "L") || name === undefined || !/^[A-Za-z0-9._-]{1,80}$/.test(name)) continue;
    const learned = tag === "L";
    if (learned && SKILLS_DO_APP.includes(name)) continue;
    out.push({ name, description: (description ?? "").slice(0, 300), objective: !learned && name === OBJECTIVE_SKILL, ...(learned ? { learned: true } : {}) });
  }
  return out.sort((a, b) => Number(b.objective) - Number(a.objective) || Number(a.learned === true) - Number(b.learned === true) || a.name.localeCompare(b.name));
}

/** O SKILL.md: frontmatter que o OpenClaw lê (nome, descrição) e instruções em português para o agente. */
export function skillMarkdown(objective: ObjectiveChoice, level: FreedomLevel, machine: string): string {
  const lv = levelOf(level) ?? LEVELS[0]!;
  const desc = `Objetivo deste agente no WhatsApp: ${objective.label}${objective.text !== "" ? `. ${objective.text}` : ""}`.replace(/"/g, "'");
  return [
    "---",
    `name: ${OBJECTIVE_SKILL}`,
    `description: "${desc}"`,
    // Um cabeçalho só para os dois agentes: o OpenClaw lê "openclaw" (o emoji), o Hermes lê "hermes" (as etiquetas).
    'metadata: { "openclaw": { "emoji": "🎯" }, "hermes": { "tags": ["meu-bot", "WhatsApp", "objetivo"] } }',
    "---",
    "",
    "# O que você resolve pelo WhatsApp",
    "",
    `Gerado pelo meu-bot (tutorial 8) na máquina ${machine}. Salvar de novo no app substitui este arquivo.`,
    "",
    `**Objetivo:** ${objective.label}${objective.text !== "" ? ` — ${objective.text}` : ""}`,
    "",
    "Toda conversa no WhatsApp gira em torno desse objetivo. Se alguém pedir algo fora dele, atenda em uma linha ou diga que isso fica fora do que você faz aqui, e volte ao objetivo.",
    "",
    `## Quanta liberdade você tem: ${lv.title}`,
    "",
    ...lv.rules.map((r) => `- ${r}`),
    "",
    "## Como agir",
    "",
    "- Comece pelo que a pessoa precisa agora; uma pergunta por vez quando faltar informação.",
    "- Mensagens curtas, como no WhatsApp; confirme o combinado no fim.",
    "- O dono do número é quem configura você; os outros contatos só recebem atendimento dentro do objetivo.",
    "",
  ].join("\n");
}

/** A trava `tools.toolsBySender` para o nível: o dono conforme o nível; qualquer outro remetente sem as ferramentas que mudam a máquina. */
export function toolsBySenderFor(level: FreedomLevel, ownerNumber: string): string {
  const lv = levelOf(level) ?? LEVELS[0]!;
  return JSON.stringify({ [`e164:+${ownerNumber}`]: lv.deny.length === 0 ? {} : { deny: lv.deny }, "*": { deny: STAR_DENY } });
}

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");
/**
 * Pasta-base das skills do agente da máquina, em `$W` (as skills ficam em `$W/skills/<nome>/SKILL.md`). Hermes: a
 * pasta dele (`~/.hermes`), que é onde ele lê as skills; antes ia sempre para o workspace do OpenClaw, que o Hermes
 * nem olha (27 out). OpenClaw: o agents.defaults.workspace do openclaw.json, senão ~/.openclaw/workspace.
 */
export const WORKSPACE_SH = `${WA_MOTOR_SH}
if usa_hermes; then W="$HOME/.hermes"; else W=$(python3 -c 'import json,os,sys
try:
    d=json.load(open(os.path.expanduser("~/.openclaw/openclaw.json")))
    w=(d.get("agents") or {}).get("defaults",{}).get("workspace") or ""
except Exception:
    w=""
print(os.path.expanduser(w) if w else os.path.expanduser("~/.openclaw/workspace"))' 2>/dev/null); [ -n "$W" ] || W="$HOME/.openclaw/workspace"; fi`;

/** Lê objetivo.json e as skills do workspace (uma linha K por SKILL.md, com nome e descrição do frontmatter). */
export function objectiveInfoSh(): string {
  return `${WORKSPACE_SH}
# Hermes com a skill ainda no lugar antigo (workspace do OpenClaw, que ele não lê): muda para a pasta dele.
if usa_hermes && [ -f "$HOME/.openclaw/workspace/skills/${OBJECTIVE_SKILL}/SKILL.md" ] && [ ! -f "$W/skills/${OBJECTIVE_SKILL}/SKILL.md" ]; then
  mkdir -p "$W/skills" && mv "$HOME/.openclaw/workspace/skills/${OBJECTIVE_SKILL}" "$W/skills/${OBJECTIVE_SKILL}"
  rmdir "$HOME/.openclaw/workspace/skills" "$HOME/.openclaw/workspace" 2>/dev/null || true
fi
echo "O=$(cat "${OBJECTIVE_FILE}" 2>/dev/null | tr -d '\\n')"
for f in "$W"/skills/*/SKILL.md; do
  [ -f "$f" ] || continue
  n=$(sed -n 's/^name:[[:space:]]*//p' "$f" | head -n1 | tr -d '"\\r')
  [ -n "$n" ] || n=$(basename "$(dirname "$f")")
  d=$(sed -n 's/^description:[[:space:]]*//p' "$f" | head -n1 | sed 's/^"//; s/"$//' | tr -d '\\t\\r')
  printf 'K\\t%s\\t%s\\n' "$n" "$d"
done
for f in "$HOME"/.claude/skills/*/SKILL.md; do
  [ -f "$f" ] || continue
  case "$f" in */synced/*) continue;; esac
  n=$(sed -n 's/^name:[[:space:]]*//p' "$f" | head -n1 | tr -d '"\\r')
  [ -n "$n" ] || n=$(basename "$(dirname "$f")")
  d=$(sed -n 's/^description:[[:space:]]*//p' "$f" | head -n1 | sed 's/^"//; s/"$//' | tr -d '\\t\\r')
  printf 'L\\t%s\\t%s\\n' "$n" "$d"
done
`;
}

/** Grava objetivo.json (merge com o que havia: a tela manda só o que mudou). */
export function setObjectiveSh(patch: { objective?: ObjectiveChoice | null; level?: FreedomLevel | null; savedAt?: string | null }): string {
  return `mkdir -p "$HOME/.local/share/meu-bot" && printf '%s' '${b64(JSON.stringify(patch))}' | base64 -d | python3 -c '
import json, sys, os
f = os.path.expandvars("${OBJECTIVE_FILE}")
try:
    cur = json.load(open(f)); assert isinstance(cur, dict)
except Exception:
    cur = {}
cur.update(json.load(sys.stdin))
tmp = f + ".tmp"
json.dump(cur, open(tmp, "w"), ensure_ascii=False, indent=1); os.chmod(tmp, 0o600); os.replace(tmp, f)
print("OBJ=1")
'`;
}

/**
 * Salva a skill no workspace e aplica a trava do nível (se há número pareado). Marca savedAt no objetivo.json.
 * Sem python3 ou sem workspace, falha antes de escrever qualquer coisa.
 */
export function saveObjectiveSh(objective: ObjectiveChoice, level: FreedomLevel, machine: string, savedAt: string): string {
  const md = skillMarkdown(objective, level, machine);
  return `set -e
export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH
${WORKSPACE_SH}
mkdir -p "$W/skills/${OBJECTIVE_SKILL}"
printf '%s' '${b64(md)}' | base64 -d > "$W/skills/${OBJECTIVE_SKILL}/SKILL.md.tmp" && mv "$W/skills/${OBJECTIVE_SKILL}/SKILL.md.tmp" "$W/skills/${OBJECTIVE_SKILL}/SKILL.md"
echo "SKILL=$W/skills/${OBJECTIVE_SKILL}/SKILL.md"
N=$(python3 -c 'import json,sys;print((json.load(open(sys.argv[1])).get("dono") or {}).get("numero",""))' "$HOME/.local/share/meu-bot/whatsapp-lista.json" 2>/dev/null | tr -dc '0-9')
[ -n "$N" ] || N=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$HOME/.openclaw/credentials/whatsapp/default/creds.json" 2>/dev/null | sed 's/[:@].*//' | tr -dc '0-9')
if usa_hermes; then
  # Hermes: quem executa é o Claude Code do backend (modelo "whatsapp"), que lê o nível do objetivo.json a cada
  # mensagem. Aqui só garante o modelo; se ele mudou, o gateway relê a config.
  HWA=$(${HERMES_WA_ENSURE_SH}) || true
  echo "$HWA"
  case "$HWA" in *modelo:whatsapp*) { ${HERMES_RESTART_SH}; } >/dev/null 2>&1 || true ;; esac
  case "$HWA" in *modelo:agente*) echo LOCK=antigo ;; *) echo LOCK=backend ;; esac
elif [ -n "$N" ] && command -v openclaw >/dev/null 2>&1; then
  LOCK=$(python3 -c 'import json,sys;lv=sys.argv[1];n=sys.argv[2];others=${JSON.stringify(OTHERS_DENY)};star=${JSON.stringify(STAR_DENY)};deny={"conversa":others,"consulta":["exec","process","cron","gateway"],"age":[]}[lv];print(json.dumps({"e164:+"+n:({"deny":deny} if deny else {}),"*":{"deny":star}}))' '${level}' "$N")
  openclaw config set tools.toolsBySender "$LOCK" --strict-json >/dev/null 2>&1 && echo LOCK=1 || echo LOCK=0
else
  echo LOCK=skip
fi
${setObjectiveSh({ objective, level, savedAt })}
`;
}

/** "Refazer do zero": apaga a skill e o objetivo.json; o dono volta à liberdade total (a trava dos outros fica). */
export function resetObjectiveSh(): string {
  return `export PATH=$HOME/.openclaw/bin:$HOME/.local/bin:$PATH
${WORKSPACE_SH}
rm -rf "$W/skills/${OBJECTIVE_SKILL}"
rm -f "${OBJECTIVE_FILE}"
N=$(python3 -c 'import json,sys;print((json.load(open(sys.argv[1])).get("dono") or {}).get("numero",""))' "$HOME/.local/share/meu-bot/whatsapp-lista.json" 2>/dev/null | tr -dc '0-9')
[ -n "$N" ] || N=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("me",{}).get("id",""))' "$HOME/.openclaw/credentials/whatsapp/default/creds.json" 2>/dev/null | sed 's/[:@].*//' | tr -dc '0-9')
if [ -n "$N" ] && command -v openclaw >/dev/null 2>&1; then
  LOCK=$(python3 -c 'import json,sys;n=sys.argv[1];star=${JSON.stringify(STAR_DENY)};print(json.dumps({"e164:+"+n:{},"*":{"deny":star}}))' "$N")
  openclaw config set tools.toolsBySender "$LOCK" --strict-json >/dev/null 2>&1 || true
fi
echo RESET=1
`;
}
