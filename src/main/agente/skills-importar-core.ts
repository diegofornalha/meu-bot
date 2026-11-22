/**
 * Importar uma skill pelo link do repositório (docs/planos/marketplace-skills.md, fase 1): a parte pura. A skill é um
 * repositório com um `SKILL.md` na raiz; o download roda NA MÁQUINA, com o git e o GitHub que a pessoa conectou nela
 * (repositório privado funciona), e a pessoa vê nome, descrição, arquivos e commit antes de instalar. O commit visto
 * é o instalado (fixado); atualizar é outro pedido. Aqui: ler o link, ler o SKILL.md, os scripts de shell e a leitura
 * das saídas. O SSH fica em skills-importar.ts. Testável sem Electron.
 */
import type { SkillDestino, SkillImportada, SkillPrevia, SkillPreviaResultado } from "../../shared/ipc";
import { ambienteGit, cloneArgs, lerResultado, repoValido, rotuloRepo } from "../modulos/modulos-fonte-core";
import { OBJECTIVE_SKILL, SKILLS_DO_APP, WORKSPACE_SH } from "./objetivo-core";

/** Nome da skill: vira nome de pasta na máquina, então só minúsculas, dígitos e hífen. */
export const SKILL_NOME_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
/** Limites do que se importa: uma skill é texto e alguns scripts, não um projeto. */
export const SKILL_MAX_ARQUIVOS = 300;
export const SKILL_MAX_BYTES = 20 * 1024 * 1024;
/** Nomes que o próprio meu-bot instala: uma skill importada com um deles tomaria o lugar da do app. */
export const SKILLS_RESERVADAS: readonly string[] = [...SKILLS_DO_APP, OBJECTIVE_SKILL, "whatsapp-grupos"];

/**
 * O link que a pessoa colou → a URL do git. Aceita "dono/repo", a página do GitHub (com ou sem /tree/…, ?aba, #ancora)
 * e qualquer URL que os módulos aceitam (`repoValido`: https, ssh://, git@host:caminho). null = não é um repositório.
 */
export function linkDaSkill(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  const t = texto.trim();
  if (t === "" || t.length > 400) return null;
  const curto = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/.exec(t);
  if (curto !== null) return linkDaSkill(`https://github.com/${curto[1]}/${curto[2]}`);
  const gh = /^https:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:[/?#].*)?$/.exec(t);
  if (gh !== null) { const url = `https://github.com/${gh[1]}/${gh[2]}.git`; return repoValido(url) ? url : null; }
  // Endereço do GitHub que não é dono/repositório (a página de um perfil, por exemplo) não é uma skill.
  if (/^https?:\/\/(?:www\.)?github\.com(?:\/|$)/i.test(t)) return null;
  return repoValido(t) ? t : null;
}

const semAspas = (s: string): string => s.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
/**
 * O cabeçalho do SKILL.md: `---`, `name:` e `description:`, `---`. O nome precisa servir de pasta; a descrição é o que
 * o agente lê para decidir quando usar a skill, então vazia não serve.
 */
export function parseSkillMd(md: string): { nome: string; descricao: string } | { erro: string } {
  const t = md.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!t.startsWith("---\n")) return { erro: "o SKILL.md não começa com o cabeçalho (--- / name / description / ---)" };
  const fim = t.indexOf("\n---", 4);
  if (fim < 0) return { erro: "o cabeçalho do SKILL.md não fecha com ---" };
  const linhas = t.slice(4, fim).split("\n");
  const campo = (k: string): string => semAspas(linhas.find((l) => l.startsWith(`${k}:`))?.slice(k.length + 1) ?? "");
  const nome = campo("name"); const descricao = campo("description");
  if (nome === "") return { erro: "o SKILL.md não tem \"name:\" no cabeçalho" };
  if (!SKILL_NOME_RE.test(nome)) return { erro: `o nome da skill ("${nome.slice(0, 60)}") precisa ter só minúsculas, números e hífen (de 2 a 41 caracteres)` };
  if (SKILLS_RESERVADAS.includes(nome)) return { erro: `"${nome}" é o nome de uma skill do próprio meu-bot; troque o "name:" do SKILL.md` };
  if (descricao === "") return { erro: "o SKILL.md não tem \"description:\" no cabeçalho (é por ela que o agente sabe quando usar a skill)" };
  return { nome, descricao: descricao.slice(0, 600) };
}

const shq = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;
/** O ambiente do git sem prompt de senha, o mesmo dos módulos (`ambienteGit`), como `export` de shell. */
const GIT_ENV_SH = `export ${Object.entries(ambienteGit({}, "")).filter(([k]) => k !== "PATH").map(([k, v]) => `${k}=${shq(v ?? "")}`).join(" ")}`;
const BASE_SH = `${GIT_ENV_SH}
BASE="$HOME/.local/share/meu-bot/skills"; P="$BASE/.previa"
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
falha_git() { echo "GIT_RC=$1"; echo "GIT_ERR=$(tr '\\n' ' ' <"$E" | cut -c1-600)"; rm -f "$E"; rm -rf "$P"; exit 0; }
contar() { echo "LINKS=$(find "$P" -path "$P/.git" -prune -o -type l -print | wc -l | tr -d ' ')"; echo "N=$(find "$P" -path "$P/.git" -prune -o -type f -print | wc -l | tr -d ' ')"; echo "BYTES=$(tar -cf - --exclude .git -C "$P" . 2>/dev/null | wc -c | tr -d ' ')"; }
command -v git >/dev/null 2>&1 || { echo "ERRO=sem-git"; exit 0; }
mkdir -p "$BASE"; E=$(mktemp)`;
/** `git clone` raso (os argumentos dos módulos, `cloneArgs`) para a pasta de prévia. */
const cloneSh = (url: string): string => `git ${[...cloneArgs(url, "").slice(0, -1).map(shq), '"$P"'].join(" ")} 2>"$E" || falha_git $?`;

/** Baixa o repositório para a pasta de prévia e descreve o que veio: commit, SKILL.md, arquivos. Não instala nada. */
export function previaSh(url: string): string {
  if (!repoValido(url)) throw new Error("link inválido");
  return `${BASE_SH}
rm -rf "$P"
${cloneSh(url)}
rm -f "$E"
echo "COMMIT=$(git -C "$P" rev-parse HEAD)"
echo "DATA=$(git -C "$P" log -1 --format=%cI)"
if [ -f "$P/SKILL.md" ]; then echo "MD=$(head -c 8192 "$P/SKILL.md" | base64 | tr -d '\\n')"; else echo "MD="; fi
contar
find "$P" -path "$P/.git" -prune -o -type f -print | sed "s|^$P/||" | LC_ALL=C sort | head -n 200 | awk '{ print "F\\t" $0 }'
echo "FIM=1"
`;
}

const GIT_FALHA: Record<string, string> = {
  "sem-git": "esta máquina não tem o git instalado",
  "sem-rede": "a máquina não alcançou o repositório (sem rede ou endereço errado)",
  "sem-acesso": "a máquina não tem acesso a esse repositório: confira o link e, se ele for privado, conecte o GitHub nesta máquina",
  erro: "o git não conseguiu baixar o repositório",
};
const linha = (out: string, k: string): string | null => { const l = out.split("\n").find((x) => x.startsWith(`${k}=`)); return l === undefined ? null : l.slice(k.length + 1).trim(); };
/** Falha do git ou do script dita para a pessoa; null = não houve. */
function falhaDe(out: string): string | null {
  if (linha(out, "ERRO") === "sem-git") return GIT_FALHA["sem-git"]!;
  const rc = linha(out, "GIT_RC");
  if (rc === null) return null;
  const stderr = linha(out, "GIT_ERR") ?? "";
  const r = lerResultado({ code: Number(rc) || 1, stdout: "", stderr });
  return r === "erro" && stderr !== "" ? `${GIT_FALHA.erro}: ${stderr.slice(0, 200)}` : GIT_FALHA[r === "ok" ? "erro" : r]!;
}

/** Lê a saída do `previaSh`: a prévia para a tela, ou o motivo de não dar para importar. */
export function parsePrevia(out: string, url: string): SkillPreviaResultado {
  const falha = falhaDe(out);
  if (falha !== null) return { ok: false, erro: falha };
  const commit = linha(out, "COMMIT") ?? "";
  if (linha(out, "FIM") !== "1" || !COMMIT_RE.test(commit)) return { ok: false, erro: "não consegui ler o repositório na máquina" };
  const md = linha(out, "MD") ?? "";
  if (md === "") return { ok: false, erro: "esse repositório não tem um SKILL.md na raiz: não é uma skill" };
  const cab = parseSkillMd(Buffer.from(md, "base64").toString("utf8"));
  if ("erro" in cab) return { ok: false, erro: cab.erro };
  const total = Number(linha(out, "N") ?? "0") || 0; const bytes = Number(linha(out, "BYTES") ?? "0") || 0;
  if ((Number(linha(out, "LINKS") ?? "0") || 0) > 0) return { ok: false, erro: "o repositório tem atalhos (symlinks); uma skill importada só pode ter arquivos comuns" };
  if (total > SKILL_MAX_ARQUIVOS) return { ok: false, erro: `o repositório tem ${total} arquivos; o limite de uma skill é ${SKILL_MAX_ARQUIVOS}` };
  if (bytes > SKILL_MAX_BYTES) return { ok: false, erro: `o repositório tem ${Math.round(bytes / 1024 / 1024)} MB; o limite de uma skill é ${SKILL_MAX_BYTES / 1024 / 1024} MB` };
  const arquivos = out.split("\n").filter((l) => l.startsWith("F\t")).map((l) => l.slice(2).slice(0, 200));
  const previa: SkillPrevia = { url, rotulo: rotuloRepo(url), nome: cab.nome, descricao: cab.descricao, commit, data: linha(out, "DATA") || null, arquivos, total, bytes };
  return { ok: true, previa };
}

/**
 * As pastas dos agentes que recebem a skill, uma por linha "Rótulo:pasta": o Claude Code sempre; e a do agente do
 * WhatsApp (`$W` do WORKSPACE_SH: ~/.hermes no Hermes, o workspace no OpenClaw) quando esse agente existe na máquina.
 */
const DESTINOS_SH = `${WORKSPACE_SH}
destinos() {
  printf 'Claude:%s\\n' "$HOME/.claude"
  if usa_hermes; then printf 'Hermes:%s\\n' "$W"; elif [ -d "$HOME/.openclaw" ]; then printf 'OpenClaw:%s\\n' "$W"; fi
}`;
const MARCA = ".meu-bot-importada";

/**
 * Instala o commit visto na prévia. Reaproveita a pasta de prévia quando ela é desse repositório e desse commit; senão
 * baixa de novo e vai ao commit pedido. Pasta de skill que já existe e não foi importada pelo app nunca é tocada: a
 * instalação inteira para. Na atualização, o SKILL.md que o agente editou fica (como nas skills semente do app).
 */
export function instalarSh(url: string, commit: string, nome: string, em: string): string {
  if (!repoValido(url) || !COMMIT_RE.test(commit) || !SKILL_NOME_RE.test(nome) || !/^[0-9TZ:.+-]{10,40}$/.test(em)) throw new Error("pedido de instalação inválido");
  return `${DESTINOS_SH}
${BASE_SH}
U=${shq(url)}; C=${shq(commit)}; NOME=${shq(nome)}
if ! { [ -d "$P/.git" ] && [ "$(git -C "$P" rev-parse HEAD 2>/dev/null)" = "$C" ] && [ "$(git -C "$P" config --get remote.origin.url 2>/dev/null)" = "$U" ]; }; then
  rm -rf "$P"
  ${cloneSh(url)}
  if [ "$(git -C "$P" rev-parse HEAD)" != "$C" ]; then
    git -C "$P" fetch --quiet --depth 1 --no-tags origin "$C" 2>"$E" || falha_git $?
    git -C "$P" checkout --quiet --detach FETCH_HEAD 2>"$E" || falha_git $?
  fi
fi
rm -f "$E"
[ "$(git -C "$P" rev-parse HEAD)" = "$C" ] || { echo "ERRO=commit"; exit 0; }
N=$(sed -n 's/^name:[[:space:]]*//p' "$P/SKILL.md" 2>/dev/null | head -n1 | tr -d "\\"'\\r" | sed 's/[[:space:]]*$//')
[ "$N" = "$NOME" ] || { echo "ERRO=nome"; exit 0; }
[ -z "$(find "$P" -path "$P/.git" -prune -o -type l -print | head -n1)" ] || { echo "ERRO=links"; exit 0; }
while IFS= read -r D; do
  T="\${D#*:}/skills/$NOME"
  if [ -e "$T" ] && [ ! -f "$T/${MARCA}" ]; then echo "ERRO=ocupado:\${D%%:*}"; exit 0; fi
done < <(destinos)
ANT=$(cat "$BASE/$NOME/skill.sha256" 2>/dev/null || true)
FONTE="$BASE/$NOME/fonte"; rm -rf "$FONTE"; mkdir -p "$FONTE"
tar -cf - --exclude .git -C "$P" . | tar -xf - -C "$FONTE"
NOVA=$(sha "$FONTE/SKILL.md")
while IFS= read -r D; do
  T="\${D#*:}/skills/$NOME"; EDIT=""
  if [ -f "$T/SKILL.md" ] && [ -n "$ANT" ] && [ "$(sha "$T/SKILL.md")" != "$ANT" ] && [ "$(sha "$T/SKILL.md")" != "$NOVA" ]; then EDIT=$(mktemp); cp "$T/SKILL.md" "$EDIT"; fi
  rm -rf "$T"; mkdir -p "$T"; cp -R "$FONTE"/. "$T"/; printf '%s\\n' "$C" > "$T/${MARCA}"
  if [ -n "$EDIT" ]; then cp "$EDIT" "$T/SKILL.md"; rm -f "$EDIT"; echo "DEST=editada:\${D%%:*}"; else echo "DEST=ok:\${D%%:*}"; fi
done < <(destinos)
printf '%s\\n' "$NOVA" > "$BASE/$NOME/skill.sha256"
printf '{"url":"%s","commit":"%s","em":"%s","origem":"link"}\\n' "$U" "$C" ${shq(em)} > "$BASE/$NOME/origem.json"
rm -rf "$P"
echo "OK=1"
`;
}

const ERRO_INSTALAR: Record<string, string> = {
  commit: "não consegui chegar ao commit visto na prévia; peça a prévia de novo",
  nome: "o nome no SKILL.md mudou desde a prévia; peça a prévia de novo",
  links: "o repositório tem atalhos (symlinks); uma skill importada só pode ter arquivos comuns",
};
/** Lê a saída do `instalarSh`: onde a skill ficou, ou o motivo de não ter instalado. */
export function parseInstalar(out: string): { ok: true; destinos: SkillDestino[] } | { ok: false; erro: string } {
  const falha = falhaDe(out);
  if (falha !== null) return { ok: false, erro: falha };
  const erro = linha(out, "ERRO");
  if (erro !== null) {
    if (erro.startsWith("ocupado:")) return { ok: false, erro: `já existe uma skill com esse nome no ${erro.slice(8)} que não foi importada pelo meu-bot; nada foi alterado. Renomeie a sua (o "name:" do SKILL.md) ou remova a que está lá` };
    return { ok: false, erro: ERRO_INSTALAR[erro] ?? "a instalação não concluiu" };
  }
  if (linha(out, "OK") !== "1") return { ok: false, erro: "a instalação não concluiu" };
  const destinos: SkillDestino[] = [];
  for (const l of out.split("\n")) { const m = /^DEST=(ok|editada):(Claude|Hermes|OpenClaw)$/.exec(l.trim()); if (m !== null) destinos.push({ agente: m[2] as SkillDestino["agente"], editada: m[1] === "editada" }); }
  return { ok: true, destinos };
}

/** As skills importadas nesta máquina: uma linha S por skill, com o origem.json e a descrição do SKILL.md guardado. */
export function listarSh(): string {
  return `BASE="$HOME/.local/share/meu-bot/skills"
for f in "$BASE"/*/origem.json; do
  [ -f "$f" ] || continue
  n=$(basename "$(dirname "$f")")
  d=$(sed -n 's/^description:[[:space:]]*//p' "$BASE/$n/fonte/SKILL.md" 2>/dev/null | head -n1 | sed 's/^"//; s/"$//' | tr -d '\\t\\r' | cut -c1-600)
  printf 'S\\t%s\\t%s\\t%s\\n' "$n" "$(tr -d '\\n\\t' <"$f")" "$d"
done
echo "FIM=1"
`;
}
function lerOrigem(json: string): { url?: unknown; commit?: unknown; em?: unknown } | null {
  try { const o: unknown = JSON.parse(json); return o !== null && typeof o === "object" ? o : null; } catch { return null; }
}
export function parseLista(out: string): SkillImportada[] {
  const skills: SkillImportada[] = [];
  for (const l of out.split("\n")) {
    if (!l.startsWith("S\t")) continue;
    const [, nome = "", json = "", descricao = ""] = l.split("\t");
    if (!SKILL_NOME_RE.test(nome)) continue;
    const o = lerOrigem(json);
    if (o === null || !repoValido(o.url) || typeof o.commit !== "string" || !COMMIT_RE.test(o.commit)) continue;
    skills.push({ nome, descricao: descricao.trim(), url: o.url, rotulo: rotuloRepo(o.url), commit: o.commit, em: typeof o.em === "string" ? o.em : null });
  }
  return skills.sort((a, b) => a.nome.localeCompare(b.nome));
}

/** Remove a skill importada: das pastas dos agentes só o que tem a marca do app, e o registro dela. */
export function removerSh(nome: string): string {
  if (!SKILL_NOME_RE.test(nome)) throw new Error("nome inválido");
  return `${DESTINOS_SH}
NOME=${shq(nome)}; BASE="$HOME/.local/share/meu-bot/skills"
[ -f "$BASE/$NOME/origem.json" ] || { echo "ERRO=ausente"; exit 0; }
while IFS= read -r D; do
  T="\${D#*:}/skills/$NOME"
  if [ -f "$T/${MARCA}" ]; then rm -rf "$T"; fi
done < <(destinos)
rm -rf "$BASE/$NOME"
echo "OK=1"
`;
}
