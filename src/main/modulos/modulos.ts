/**
 * Módulos de produto, lado do app (I/O): os produtos de módulos de uma máquina são o fixo do app (caps.modulos) e os
 * add-ons com módulos liberados na licença dela (`produtosDeModulos`). Baixa com git o repositório de cada um para
 * <userData>/modulos-fonte/<produto> (src/main/modulos/modulos-fonte-core.ts), lê o modulos.json dele e liga, desliga e
 * configura cada módulo na máquina da janela por SSH. O app não leva módulo nenhum dentro; quem não tem acesso ao repositório só vê "sem acesso aos
 * módulos". O núcleo puro é o modulos-core.ts (manifesto, scripts) e o modulos-fonte-core.ts (URL, git, estados); o
 * contrato na máquina, backend-colima/modulos.js.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { app } from "electron";
import type { EstadoFonte, FonteModulos, LicenseView, Modulo, ModuloEstado, ModuloGateway, ModuloPaginaAberta, ModuloResultado, ModuloTeste, ModulosLista } from "../../shared/ipc";
import { caps } from "../app/variant";
import { getModulosRepo } from "../app/settings";
import { lerLicenca } from "../licenca/licenca-maquina";
import { acessoAddon } from "../licenca/licenca";
import { enviarModulo } from "../maquina/hostProbe";
import { runSsh } from "../whatsapp/whatsapp";
import { WA_MOTOR_SH } from "../whatsapp/whatsapp-capacidades";
import { origemForward, paginaStatusSh, parsePaginaStatus, particaoModulo, tokenSh, urlPagina } from "./modulos-pagina-core";
import { ensureForwardExtra } from "../maquina/tunnel";
import { LOCAL_HOST } from "../maquina/localBackend";
import { MODULOS_DIR, ambienteSh, credenciaisSh, desatualizado, estadoSh, lerTeste, mesclarOpcoes, opcoesSh, parseEstado, parseManifesto } from "./modulos-core";
import { type SaidaGit, ambienteGit, appTemModulos, cloneArgs, commitArgs, estadoDepois, lerResultado, montarFonte, parseFonteGravada, produtosDeModulos, pullArgs, repoEfetivo, repoPadrao } from "./modulos-fonte-core";

/** Onde o app guarda os repositórios de módulos baixados: uma pasta por produto e, ao lado, o <produto>.json da origem. */
const raizFonte = (): string => path.join(app.getPath("userData"), "modulos-fonte");
/** Pasta da cópia baixada do repositório de um produto de módulos. */
const pastaDe = (produto: string): string => path.join(raizFonte(), produto);
const arquivoDaFonte = (nome: string): string => path.join(raizFonte(), `${nome}.json`);
const lerGravada = (nome: string) => { try { return parseFonteGravada(fs.readFileSync(arquivoDaFonte(nome), "utf8")); } catch { return null; } };
/** A URL de Configurações (modulosRepo) só vale para o produto fixo do app; os add-ons da licença usam a padrão. */
const urlDe = (produto: string): string => (produto === caps().modulos ? repoEfetivo(getModulosRepo(), produto) : repoPadrao(produto));

/** Os módulos do produto dispensam a licença (a trava é o acesso git ao repositório privado: `Addon.semLicenca`)? */
const semLicenca = (produto: string): boolean => caps().addons.some((a) => a.nome === produto && a.semLicenca);
/** O produto está liberado nesta máquina: sem licença por desenho, ou o add-on na licença em dia. */
const produtoLiberado = (lic: LicenseView | null, host: string, produto: string): boolean => semLicenca(produto) || acessoAddon(lic, host, produto) === "ok";

/** O app pode ter módulos em alguma máquina (produto fixo ou add-on com módulos no catálogo)? */
export const temModulos = (): boolean => appTemModulos(caps().modulos, caps().addons);
/**
 * Os produtos de módulos desta máquina: o fixo do app e os add-ons com módulos liberados na licença dela.
 * `todos`: também os add-ons com módulos fora da licença (para desligar e testar o que já estava ligado).
 */
const produtosDe = (host: string, lic: LicenseView | null, todos = false): string[] =>
  produtosDeModulos(caps().modulos, caps().addons, (n) => todos || acessoAddon(lic, host, n) === "ok");

/** Resultado da última tentativa de baixar cada produto, nesta sessão do app ("nunca" até a primeira). */
const ultimos = new Map<string, { estado: EstadoFonte; detalhe: string }>();
/** A fonte de um produto como está agora, sem rodar o git: repositório, commit e data da cópia, e a última tentativa. */
function fonteAtual(produto: string): FonteModulos {
  const u = ultimos.get(produto) ?? { estado: "nunca", detalhe: "" };
  return montarFonte({ url: urlDe(produto), gravada: lerGravada(produto), temManifesto: fs.existsSync(path.join(pastaDe(produto), "modulos.json")), estado: u.estado, detalhe: u.detalhe, agora: Date.now() });
}

/**
 * O git com o ambiente do usuário (as credenciais dele valem como no terminal) e o PATH que o app monta para as CLIs
 * (app de GUI tem PATH mínimo). Nunca pede senha: ver `ambienteGit`. Prazo de 2 min; estourado, conta como sem rede.
 */
function git(args: string[]): Promise<SaidaGit> {
  const PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env["PATH"] ?? ""].join(":");
  return new Promise((resolve) => {
    let stdout = ""; let stderr = ""; let fim = false;
    const acabar = (r: SaidaGit): void => { if (!fim) { fim = true; clearTimeout(prazo); resolve(r); } };
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"], env: ambienteGit(process.env, PATH) });
    const prazo = setTimeout(() => { child.kill("SIGKILL"); acabar({ code: null, stdout, stderr }); }, 120_000);
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("error", (e: NodeJS.ErrnoException) => acabar({ code: 1, stdout, stderr: e.message, naoAchou: e.code === "ENOENT" }));
    child.on("close", (code) => acabar({ code, stdout, stderr }));
  });
}
const ultimaLinha = (s: string): string => (s.trim().split("\n").pop() ?? "").replace(/^(fatal|error): /, "").slice(0, 200);

async function baixar(produto: string): Promise<FonteModulos> {
  const pasta = pastaDe(produto);
  const url = urlDe(produto);
  const antes = fonteAtual(produto);
  // Cópia desta mesma URL: só avança. Se o pull falhar por outro motivo que não rede nem acesso (história reescrita,
  // pasta mexida à mão), ou se ainda não há cópia (ou é de outra URL), clona de novo numa pasta ao lado e troca no fim:
  // um clone que falha no meio nunca deixa a cópia boa pela metade.
  let saida: SaidaGit = antes.baixados && fs.existsSync(path.join(pasta, ".git")) ? await git(pullArgs(pasta)) : { code: 1, stdout: "", stderr: "" };
  if (lerResultado(saida) === "erro") {
    const nova = `${pasta}.baixando`;
    fs.mkdirSync(raizFonte(), { recursive: true, mode: 0o700 });
    fs.rmSync(nova, { recursive: true, force: true });
    saida = await git(cloneArgs(url, nova));
    if (lerResultado(saida) === "ok") {
      try {
        lerManifesto(nova, produto);
        fs.rmSync(pasta, { recursive: true, force: true });
        fs.renameSync(nova, pasta);
      } catch (e) {
        saida = { code: 1, stdout: "", stderr: `o repositório não tem um modulos.json válido (${e instanceof Error ? e.message : String(e)})` };
      }
    }
    fs.rmSync(nova, { recursive: true, force: true });
  }
  const resultado = lerResultado(saida);
  let commit: string | null = null;
  if (resultado === "ok") {
    const c = await git(commitArgs(pasta));
    commit = c.code === 0 && /^[0-9a-f]{4,40}$/.test(c.stdout.trim()) ? c.stdout.trim() : null;
    fs.writeFileSync(arquivoDaFonte(produto), `${JSON.stringify({ url, commit, em: new Date().toISOString() })}\n`, { mode: 0o600 });
  }
  ultimos.set(produto, { estado: estadoDepois(resultado, antes.commit, commit), detalhe: resultado === "erro" ? ultimaLinha(saida.stderr) : "" });
  return fonteAtual(produto);
}

const emCurso = new Map<string, Promise<FonteModulos>>();
/**
 * Baixa o repositório de módulos de um produto (primeira vez: `git clone`) ou o atualiza (`git pull --ff-only`). Uma
 * tentativa por produto por vez: a página e o seletor que pedirem juntos esperam a mesma. Nunca lança por falta de
 * acesso, rede ou git: devolve o estado, e a página mostra a frase.
 */
function atualizarFonte(produto: string): Promise<FonteModulos> {
  let p = emCurso.get(produto);
  if (p === undefined) {
    p = baixar(produto).catch((e: unknown) => { ultimos.set(produto, { estado: "erro", detalhe: e instanceof Error ? e.message : String(e) }); return fonteAtual(produto); }).finally(() => { emCurso.delete(produto); });
    emCurso.set(produto, p);
  }
  return p;
}

/** Lê e valida o modulos.json de uma pasta; o `produto` dele tem de ser o do repositório (é ele que a licença confere). */
function lerManifesto(dir: string, produto: string): { produto: string; modulos: Modulo[] } {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, "modulos.json"), "utf8")); }
  catch (e) { throw new Error(`não li o modulos.json (${e instanceof Error ? e.message : String(e)})`); }
  const m = parseManifesto(raw);
  if (m.produto !== produto) throw new Error(`o modulos.json diz produto ${m.produto}, mas o repositório é do ${produto}`);
  return m;
}
/** Os módulos baixados de um produto, relidos a cada chamada (um pull pode ter trocado o arquivo); null = não aparecem. */
function modulosDe(produto: string): Modulo[] | null {
  if (!fonteAtual(produto).visiveis) return null;
  return lerManifesto(pastaDe(produto), produto).modulos;
}
/**
 * Acha o módulo pelo id entre os produtos da máquina, na ordem da página (um id repetido num produto seguinte é
 * ignorado, como na lista: o estado na máquina é por id).
 */
function localizar(host: string, id: string, lic: LicenseView | null, todos = false): { produto: string; m: Modulo; pasta: string } {
  for (const produto of produtosDe(host, lic, todos)) {
    let lista: Modulo[] | null = null;
    try { lista = modulosDe(produto); } catch { /* manifesto ruim: a lista mostra o aviso */ }
    const m = lista?.find((x) => x.id === id);
    if (m !== undefined) return { produto, m, pasta: path.join(pastaDe(produto), m.pasta) };
  }
  throw new Error(`módulo desconhecido: ${id}`);
}

// O motor pela regra única (WA_MOTOR_SH); os módulos só conhecem Hermes e OpenClaw (PicoClaw sai vazio, como antes).
const GATEWAY_SH = `export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:$PATH"; ${WA_MOTOR_SH}; case "$MOTOR" in hermes|openclaw) echo "gw=$MOTOR";; *) echo gw=;; esac`;
const gatewayDe = (stdout: string): ModuloGateway | null => { const m = /^gw=(hermes|openclaw)$/m.exec(stdout); return m === null ? null : (m[1] as ModuloGateway); };
const SEM_ESTADO: ModuloEstado = { ligado: false, versao: null, preenchidas: [], opcoes: {} };

/**
 * Os produtos de módulos da máquina, cada um com a fonte, a licença e os módulos baixados com o estado de cada um. O
 * produto que nunca foi baixado neste Mac é baixado aqui na primeira vez. Sem conseguir ler a máquina (SSH caiu), as
 * listas vêm assim mesmo, com `erroMaquina`: a pessoa vê o que tem e a versão, só não liga nem desliga.
 */
export async function listarModulos(host: string): Promise<ModulosLista[]> {
  const lic = await lerLicenca(host).catch(() => null);
  const produtos = produtosDe(host, lic);
  if (produtos.length === 0) throw new Error("esta máquina não tem módulos: nenhum add-on com módulos na licença dela");
  await Promise.all(produtos.filter((p) => !ultimos.has(p) && !fonteAtual(p).baixados).map((p) => atualizarFonte(p)));
  const vistos = new Set<string>();
  const partes = produtos.map((produto) => {
    const avisos: string[] = [];
    let modulos: Modulo[] = [];
    try { modulos = modulosDe(produto) ?? []; } catch (e) { avisos.push(e instanceof Error ? e.message : String(e)); }
    const repetidos = modulos.filter((m) => vistos.has(m.id));
    if (repetidos.length > 0) avisos.push(`ignorado(s) por repetir o id de um módulo de outro produto: ${repetidos.map((m) => m.id).join(", ")}`);
    modulos = modulos.filter((m) => !vistos.has(m.id));
    for (const m of modulos) vistos.add(m.id);
    return { produto, modulos, avisos };
  });
  const r = await runSsh(host, `${estadoSh([...vistos])}\n${GATEWAY_SH}\n`, 30_000);
  const erroMaquina = r.code === 0 ? null : `não consegui ler os módulos na máquina: ${r.stderr.trim().split("\n").pop() || "ssh falhou"}`;
  const estado = erroMaquina === null ? parseEstado(r.stdout) : {};
  return partes.map(({ produto, modulos, avisos }) => ({
    produto,
    rotulo: caps().addons.find((a) => a.nome === produto)?.rotulo ?? produto,
    liberado: produtoLiberado(lic, host, produto),
    gateway: gatewayDe(r.stdout),
    fonte: fonteAtual(produto),
    erroMaquina,
    avisos,
    modulos: modulos.map((m) => {
      const e = estado[m.id] ?? SEM_ESTADO;
      return { ...m, estado: e, desatualizado: desatualizado(e.versao, m.versao), teste: testeDe(host, m.id) };
    }),
  }));
}

/** Atualizar módulos (página): confere o repositório de cada produto da máquina (pull) e relê tudo. */
export async function atualizarFontes(host: string): Promise<ModulosLista[]> {
  const lic = await lerLicenca(host).catch(() => null);
  await Promise.all(produtosDe(host, lic).map((p) => atualizarFonte(p)));
  return listarModulos(host);
}

/** Os últimos testes de conexão, por máquina e módulo, guardados no Mac (<userData>/modulos-testes.json, 0600). */
const arquivoTestes = (): string => path.join(app.getPath("userData"), "modulos-testes.json");
function lerTestes(): Record<string, ModuloTeste> {
  try { const j = JSON.parse(fs.readFileSync(arquivoTestes(), "utf8")) as unknown; return j !== null && typeof j === "object" ? (j as Record<string, ModuloTeste>) : {}; } catch { return {}; }
}
const chaveTeste = (host: string, id: string): string => `${host}::${id}`;
const testeDe = (host: string, id: string): ModuloTeste | null => lerTestes()[chaveTeste(host, id)] ?? null;
function gravarTeste(host: string, id: string, t: ModuloTeste | null): void {
  const todos = lerTestes();
  if (t === null) delete todos[chaveTeste(host, id)]; else todos[chaveTeste(host, id)] = t;
  const tmp = `${arquivoTestes()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(todos), { mode: 0o600 });
  fs.renameSync(tmp, arquivoTestes());
}

/**
 * Testar conexão: roda o `testar` do módulo na máquina (com o ambiente do contrato, como o instalador), lê as
 * ferramentas e o resultado (`lerTeste`) e guarda no Mac. Só com o módulo ligado: o teste usa o que o instalador deixou.
 */
export async function testarModulo(host: string, id: string, onLine?: (l: string) => void): Promise<ModuloTeste> {
  const { produto, m, pasta } = localizar(host, id, await lerLicenca(host).catch(() => null), true);
  if (m.testar === null) throw new Error(`${m.rotulo} não traz teste de conexão`);
  if (!fs.existsSync(path.join(pasta, m.testar))) throw new Error(`o repositório dos módulos não trouxe ${m.pasta}/${m.testar}`);
  const linhas: string[] = [];
  const r = await enviarModulo(host, id, pasta, `${ambienteSh(id, produto, m.versao)} && [ -f "${MODULOS_DIR}/${id}/ligado" ] || { echo "teste=erro ligue o módulo antes de testar"; exit 0; }; bash ./${m.testar}`, (l) => { linhas.push(l); if (!l.startsWith("ferramenta\t")) onLine?.(l); });
  const t = lerTeste(linhas.length > 0 ? linhas : r.log, new Date().toISOString());
  gravarTeste(host, id, t);
  return t;
}

/** O módulo, só se o produto dele estiver liberado na licença da máquina (lida agora; sem conseguir ler, a ação falha). */
async function liberado(host: string, id: string): Promise<{ produto: string; m: Modulo; pasta: string }> {
  const lic = await lerLicenca(host);
  const achado = localizar(host, id, lic);
  if (semLicenca(achado.produto)) return achado;
  const a = acessoAddon(lic, host, achado.produto);
  if (a === "ausente" || a === "expirada") throw new Error(`MODULOS_REQUIRED:${achado.produto}`);
  return achado;
}

/**
 * Liga (ou atualiza) um módulo: grava as opções que faltarem com os padrões, manda a pasta do módulo e roda o
 * instalador com o ambiente do contrato; com sucesso, marca VERSION e `ligado` (é o que o backend lê).
 */
export async function ligarModulo(host: string, id: string, onLine?: (l: string) => void): Promise<ModuloResultado> {
  const { produto, m, pasta } = await liberado(host, id);
  const lista = (await listarModulos(host)).find((l) => l.produto === produto);
  if (lista === undefined) return { ok: false, log: [`módulo desconhecido: ${id}`] };
  if (lista.erroMaquina !== null) return { ok: false, log: [lista.erroMaquina] };
  const v = lista.modulos.find((x) => x.id === id);
  if (m.gateways.length > 0 && (lista.gateway === null || !m.gateways.includes(lista.gateway))) return { ok: false, log: [`este módulo precisa do WhatsApp pelo ${m.gateways.join(" ou ")}; a máquina usa ${lista.gateway ?? "nenhum"}`] };
  const faltam = m.credenciais.filter((c) => !(v?.estado.preenchidas ?? []).includes(c.chave));
  if (faltam.length > 0) return { ok: false, log: [`preencha antes: ${faltam.map((c) => c.rotulo).join(", ")}`] };
  const opcoes = mesclarOpcoes(m, v?.estado.opcoes ?? {}, {});
  if (!fs.existsSync(path.join(pasta, m.instalar))) return { ok: false, log: [`o repositório dos módulos não trouxe ${m.pasta}/${m.instalar}`] };
  const cmd = `${opcoesSh(id, opcoes)} >/dev/null && ${m.pagina === null ? "true" : tokenSh(id)} && ${ambienteSh(id, produto, m.versao)} && bash ./${m.instalar} && printf '%s\\n' '${m.versao}' > "${MODULOS_DIR}/${id}/VERSION" && touch "${MODULOS_DIR}/${id}/ligado" && echo "✓ ${m.rotulo} ligado (${m.versao})"`;
  return enviarModulo(host, id, pasta, cmd, onLine);
}

/** Desliga: roda o desinstalador do módulo e tira o `ligado` (credenciais e opções ficam para religar depois). */
export async function desligarModulo(host: string, id: string, onLine?: (l: string) => void): Promise<ModuloResultado> {
  const { produto, m, pasta } = localizar(host, id, await lerLicenca(host).catch(() => null), true);
  const cmd = `${ambienteSh(id, produto, m.versao)} && { [ -f ./${m.desinstalar} ] && bash ./${m.desinstalar} || true; } && rm -f "${MODULOS_DIR}/${id}/ligado" && echo "✓ ${m.rotulo} desligado"`;
  const r = await enviarModulo(host, id, pasta, cmd, onLine);
  // Desligado, o teste antigo deixa de valer (a conta pode ter saído junto, como no Salvy).
  if (r.ok) gravarTeste(host, id, null);
  return r;
}

export async function salvarCredenciais(host: string, id: string, patch: Record<string, string>): Promise<void> {
  const { m } = await liberado(host, id);
  const r = await runSsh(host, `${credenciaisSh(m, patch)}\n`, 30_000);
  if (!/^cred=ok$/m.test(r.stdout)) throw new Error(`não gravei as credenciais: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
}

/** Grava opções; com o módulo ligado, roda o instalador de novo para valerem (serviços relidos). */
export async function salvarOpcoes(host: string, id: string, patch: Record<string, unknown>, onLine?: (l: string) => void): Promise<ModuloResultado> {
  const { produto, m } = await liberado(host, id);
  const lista = (await listarModulos(host)).find((l) => l.produto === produto);
  if (lista === undefined) throw new Error(`módulo desconhecido: ${id}`);
  if (lista.erroMaquina !== null) throw new Error(lista.erroMaquina);
  const v = lista.modulos.find((x) => x.id === id);
  const opcoes = mesclarOpcoes(m, v?.estado.opcoes ?? {}, patch);
  const r = await runSsh(host, `${opcoesSh(id, opcoes)}\n`, 30_000);
  if (!/^opcoes=ok$/m.test(r.stdout)) throw new Error(`não gravei as opções: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
  if (v?.estado.ligado === true) return ligarModulo(host, id, onLine);
  return { ok: true, log: ["opções salvas"] };
}

/**
 * Seletor: confere o repositório (pull) e reinstala sozinho os módulos ligados numa versão anterior à do manifesto (só
 * sobe de versão). É assim que um push no repositório com a `versao` maior chega às máquinas, sem release do app.
 */
export async function atualizarModulos(host: string, log: (l: string) => void): Promise<void> {
  if (!temModulos()) return;
  const lic = await lerLicenca(host).catch(() => null);
  if (produtosDe(host, lic).length === 0) return;
  for (const lista of await atualizarFontes(host)) {
    if (!lista.fonte.visiveis) { log(`[modulos] ${host}: ${lista.produto}: ${lista.fonte.mensagem || "módulos ainda não baixados"}`); continue; }
    if (!lista.liberado || lista.erroMaquina !== null) continue;
    for (const m of lista.modulos.filter((x) => x.estado.ligado && x.desatualizado)) {
      log(`[modulos] ${host}: ${m.id} ${m.estado.versao ?? "?"} → ${m.versao}; atualizando`);
      const r = await ligarModulo(host, m.id);
      log(`[modulos] ${host}: ${m.id} ${r.ok ? "atualizado" : `falhou: ${r.log.at(-1) ?? "?"}`}`);
    }
  }
}

/** Partições de página de módulo abertas nesta sessão: a máquina e a origem do forward que cada uma pode carregar. */
const paginas = new Map<string, { host: string; origem: string; id: string; rotulo: string }>();
/** O que o windows.ts confere ao anexar o <webview> e a cada navegação; null = partição que o app não abriu. */
export const paginaRegistrada = (particao: string): { host: string; origem: string; id: string; rotulo: string } | null => paginas.get(particao) ?? null;
/** As partições de página abertas para uma máquina (o windows.ts acha a do <webview> anexado pela sessão). */
export const particoesDaMaquina = (host: string): string[] => [...paginas].filter(([, r]) => r.host === host).map(([p]) => p);

/**
 * Abre a página própria do módulo: confere a licença, lê na máquina o token e se o serviço responde, abre o forward
 * até a porta dele e registra a partição com a origem do forward (o windows.ts só deixa o <webview> carregar dali).
 */
export async function abrirPaginaModulo(host: string, id: string): Promise<ModuloPaginaAberta> {
  if (host === LOCAL_HOST) throw new Error("a página do módulo mora numa máquina por SSH");
  const { m } = await liberado(host, id);
  if (m.pagina === null) throw new Error(`${m.rotulo} não tem página própria`);
  const r = await runSsh(host, `${paginaStatusSh(id, m.pagina.porta)}\n`, 30_000);
  const st = r.code === 0 ? parsePaginaStatus(r.stdout) : null;
  if (st === null) throw new Error(`não consegui ler a página de ${m.rotulo} na máquina: ${r.stderr.trim().split("\n").pop() || "ssh falhou"}`);
  if (st.token === null) throw new Error(`ligue ${m.rotulo} de novo nesta versão do app: a página ainda não tem a chave de acesso desta instalação`);
  if (!st.rodando) throw new Error(`a página de ${m.rotulo} não respondeu na máquina (o serviço do módulo parou). Desligue e ligue o módulo de novo.`);
  const local = await ensureForwardExtra(host, m.pagina.porta);
  const particao = particaoModulo(id, host);
  paginas.set(particao, { host, origem: origemForward(local), id, rotulo: m.rotulo });
  return { url: urlPagina(local, m.pagina.caminho, st.token), particao };
}
