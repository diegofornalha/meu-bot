/**
 * Módulos de produto, a fonte (puro): o app não leva módulo nenhum dentro; baixa com git o repositório do produto
 * (`https://github.com/diegofornalha/<produto>.git`, ou a URL de Configurações) para <userData>/modulos-fonte/<produto>.
 * Aqui: validar a URL, os argumentos do git, o ambiente sem prompt, ler o resultado e montar o que a página mostra.
 * O I/O é o modulos.ts. Sem Electron: testável com node --test.
 */
import type { EstadoFonte, FonteModulos } from "../../shared/ipc";

/** Dono dos repositórios de módulos no GitHub (a URL padrão sai do nome do produto). */
export const DONO_PADRAO = "diegofornalha";
export const repoPadrao = (produto: string): string => `https://github.com/${DONO_PADRAO}/${produto}.git`;

/**
 * Os produtos de módulos de uma máquina, na ordem da página: o fixo do app (`caps.modulos`, sempre, mesmo sem licença: a
 * página diz como liberar) e depois cada add-on com `modulos` liberado na licença dela. Sem repetir.
 */
export function produtosDeModulos(fixo: string | null, addons: readonly { nome: string; modulos: boolean }[], liberado: (nome: string) => boolean): string[] {
  const out = fixo === null ? [] : [fixo];
  for (const a of addons) if (a.modulos && !out.includes(a.nome) && liberado(a.nome)) out.push(a.nome);
  return out;
}
/** O app pode ter módulos em alguma máquina? (sem isso, nem se lê a licença para procurar). */
export const appTemModulos = (fixo: string | null, addons: readonly { modulos: boolean }[]): boolean => fixo !== null || addons.some((a) => a.modulos);
// Só https, ssh:// e git@host:caminho, com caracteres de URL comuns: nada que o git leia como opção ("-…") ou como
// transporte que executa comando (ext::, file://, caminho local).
const REPO_HTTPS_RE = /^(https|ssh):\/\/[A-Za-z0-9][A-Za-z0-9._~@:/-]{2,300}$/;
const REPO_SCP_RE = /^git@[A-Za-z0-9][A-Za-z0-9.-]{0,100}:[A-Za-z0-9][A-Za-z0-9._~/-]{2,200}$/;
export const repoValido = (url: unknown): url is string => typeof url === "string" && !url.includes("..") && (REPO_HTTPS_RE.test(url) || REPO_SCP_RE.test(url));
/** A URL que vale: a de Configurações quando é válida; vazia ou inválida, a padrão do produto. */
export function repoEfetivo(configurado: string, produto: string): string {
  const c = configurado.trim();
  return repoValido(c) ? c : repoPadrao(produto);
}
const semSufixo = (url: string): string => url.replace(/\/+$/, "").replace(/\.git$/i, "");
/** Duas URLs do mesmo repositório (com ou sem ".git", barra no fim, maiúsculas): a cópia baixada de uma vale para a outra. */
export const mesmoRepo = (a: string, b: string): boolean => semSufixo(a).toLowerCase() === semSufixo(b).toLowerCase();
/** Como o repositório aparece na tela: "dono/nome" no GitHub; fora dele, "host/caminho". Nunca com usuário ou senha. */
export function rotuloRepo(url: string): string {
  const limpo = semSufixo(url).replace(/^(https|ssh):\/\//, "").replace(/^[^@/]*@/, "").replace(":", "/");
  return limpo.replace(/^github\.com\//i, "");
}
/** Cópia rasa (só o commit atual): o app precisa dos arquivos, não da história. `--` antes da URL: nunca vira opção. */
export const cloneArgs = (url: string, destino: string): string[] => ["clone", "--quiet", "--depth", "1", "--no-tags", "--", url, destino];
/** Só avança (`--ff-only`): a cópia do app nunca tem commit próprio; se a história do repositório foi reescrita, o modulos.ts clona de novo. */
export const pullArgs = (pasta: string): string[] => ["-C", pasta, "pull", "--quiet", "--ff-only", "--no-tags"];
export const commitArgs = (pasta: string): string[] => ["-C", pasta, "rev-parse", "--short", "HEAD"];

/**
 * Ambiente do git: o do usuário (credenciais do Keychain, do `gh` ou a chave SSH valem como no terminal), com o PATH que
 * o app monta para achar as CLIs, e sem nenhum jeito de pedir senha: sem prompt no terminal, sem janela de askpass, SSH
 * em BatchMode. Sem credencial guardada o git falha na hora, e isso é o "sem acesso". Mensagens em inglês (LC_ALL=C)
 * para o `lerResultado` reconhecer.
 */
export function ambienteGit(env: NodeJS.ProcessEnv, PATH: string): NodeJS.ProcessEnv {
  return { ...env, PATH, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", GCM_INTERACTIVE: "never", GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=20", LC_ALL: "C", LANG: "C" };
}
const SEM_GIT_RE = /xcode-select|xcrun: error|no developer tools|command not found/i;
const SEM_REDE_RE = /could not resolve host|couldn't resolve host|failed to connect|connection timed out|operation timed out|network is unreachable|no route to host|connection refused|connection reset|could not resolve hostname|temporary failure in name resolution|ssl connect error|couldn't connect to server/i;
const SEM_ACESSO_RE = /repository not found|authentication failed|could not read username|could not read password|terminal prompts disabled|permission denied|invalid username or (password|token)|access denied|returned error: 40[134]|could not read from remote repository|does not appear to be a git repository|host key verification failed/i;

export type ResultadoGit = "ok" | "sem-git" | "sem-rede" | "sem-acesso" | "erro";
export interface SaidaGit { code: number | null; stdout: string; stderr: string; naoAchou?: boolean }
/**
 * Lê o resultado de um `git clone`/`git pull`. A rede vem antes do acesso: sem internet o ssh também diz "could not
 * read from remote repository", e a pessoa precisa saber que é a rede. Repositório privado sem permissão responde
 * "Repository not found" (o GitHub não conta que ele existe): é sem acesso.
 */
export function lerResultado(s: SaidaGit): ResultadoGit {
  if (s.naoAchou === true) return "sem-git";
  if (s.code === 0) return "ok";
  if (SEM_GIT_RE.test(s.stderr)) return "sem-git";
  if (s.code === null) return "sem-rede";
  if (SEM_REDE_RE.test(s.stderr)) return "sem-rede";
  if (SEM_ACESSO_RE.test(s.stderr)) return "sem-acesso";
  return "erro";
}
/** Estado da fonte depois de uma tentativa: baixou coisa nova, já estava em dia, ou o motivo de não ter conseguido. */
export function estadoDepois(r: ResultadoGit, antes: string | null, depois: string | null): EstadoFonte {
  if (r !== "ok") return r;
  return antes !== null && antes === depois ? "em-dia" : "atualizado";
}
/**
 * Os módulos baixados aparecem? Sem acesso, nunca (a página só diz "sem acesso", mesmo que exista uma cópia de quando
 * havia acesso). Sem rede, sem git ou com erro, aparecem os já baixados.
 */
export const mostraModulos = (estado: EstadoFonte, baixados: boolean): boolean => baixados && estado !== "sem-acesso";
/** "há 5 min", "há 3 h", "há 2 dias" (para a linha de origem). */
export function haQuanto(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}
/** O aviso de cada estado, em uma frase; "" quando não há o que avisar. `detalhe`: a última linha do git no caso "erro". */
export function mensagemFonte(estado: EstadoFonte, repositorio: string, baixados: boolean, detalhe = ""): string {
  const ja = baixados ? " Mostrando os módulos já baixados." : "";
  switch (estado) {
    case "atualizado": return "Módulos atualizados.";
    case "em-dia": return "Os módulos já estavam em dia.";
    case "nunca": return "";
    case "sem-acesso": return `Sem acesso aos módulos: este Mac não tem acesso git ao repositório ${repositorio}.`;
    case "sem-rede": return baixados ? "Sem rede para conferir o repositório: mostrando os módulos já baixados." : "Sem rede: não consegui baixar os módulos. Tente de novo quando a internet voltar.";
    case "sem-git": return `Este Mac não tem o git, que baixa os módulos (instale com \`xcode-select --install\`).${ja}`;
    case "erro": return `Não consegui atualizar os módulos${detalhe ? `: ${detalhe}` : "."}${detalhe ? "." : ""}${ja}`.replace(/\.\.$/, ".");
  }
}
/** A linha de origem da página: "Módulos de dono/nome · commit abc1234 · atualizado há 5 min". */
export function linhaOrigem(repositorio: string, commit: string | null, atualizadoEm: string | null, agora: number): string {
  const partes = [`Módulos de ${repositorio}`];
  if (commit !== null) partes.push(`commit ${commit}`);
  const t = atualizadoEm === null ? NaN : Date.parse(atualizadoEm);
  if (Number.isFinite(t)) partes.push(`atualizado ${haQuanto(agora - t)}`);
  return partes.join(" · ");
}
/** O <produto>.json gravado depois de baixar: de onde veio, o commit e quando. */
export interface FonteGravada { url: string; commit: string | null; em: string }
export function parseFonteGravada(raw: string | null): FonteGravada | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (v === null || typeof v !== "object" || !repoValido(v["url"]) || typeof v["em"] !== "string" || !Number.isFinite(Date.parse(v["em"]))) return null;
    const c = v["commit"];
    return { url: v["url"], commit: typeof c === "string" && /^[0-9a-f]{4,40}$/.test(c) ? c : null, em: v["em"] };
  } catch { return null; }
}
/** Monta o que a página recebe. `gravada`: o <produto>.json (null = nunca baixou); `temManifesto`: a cópia tem modulos.json. */
export function montarFonte(i: { url: string; gravada: FonteGravada | null; temManifesto: boolean; estado: EstadoFonte; detalhe?: string; agora: number }): FonteModulos {
  const repositorio = rotuloRepo(i.url);
  // A cópia só vale para a URL de onde veio: trocada a URL em Configurações, a antiga não é mostrada como se fosse a nova.
  const baixados = i.temManifesto && i.gravada !== null && mesmoRepo(i.gravada.url, i.url);
  const commit = baixados ? (i.gravada?.commit ?? null) : null;
  const atualizadoEm = baixados ? (i.gravada?.em ?? null) : null;
  return {
    repositorio, url: i.url, estado: i.estado, commit, atualizadoEm, baixados,
    visiveis: mostraModulos(i.estado, baixados),
    linha: linhaOrigem(repositorio, commit, atualizadoEm, i.agora),
    mensagem: mensagemFonte(i.estado, repositorio, baixados, i.detalhe ?? ""),
  };
}
