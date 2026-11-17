/**
 * Módulos de produto, lado do app (I/O): baixa com git o repositório do produto para <userData>/modulos-fonte/<produto>
 * (src/main/modulos/modulos-fonte-core.ts), lê o modulos.json dele e liga, desliga e configura cada módulo na máquina
 * da janela por SSH. O app não leva módulo nenhum dentro; quem não tem acesso ao repositório só vê "sem acesso aos
 * módulos". O núcleo puro é o modulos-core.ts (manifesto, scripts) e o modulos-fonte-core.ts (URL, git, estados); o
 * contrato na máquina, backend-colima/modulos.js.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { app } from "electron";
import type { EstadoFonte, FonteModulos, Modulo, ModuloEstado, ModuloGateway, ModuloResultado, ModuloTeste, ModulosLista } from "../../shared/ipc";
import { caps } from "../app/variant";
import { getModulosRepo } from "../app/settings";
import { lerLicenca } from "../licenca/licenca-maquina";
import { acessoAddon } from "../licenca/licenca";
import { enviarModulo } from "../maquina/hostProbe";
import { runSsh } from "../whatsapp/whatsapp";
import { WA_MOTOR_SH } from "../whatsapp/whatsapp-capacidades";
import { MODULOS_DIR, ambienteSh, credenciaisSh, desatualizado, estadoSh, lerTeste, mesclarOpcoes, opcoesSh, parseEstado, parseManifesto } from "./modulos-core";
import { type SaidaGit, ambienteGit, cloneArgs, commitArgs, estadoDepois, lerResultado, montarFonte, parseFonteGravada, pullArgs, repoEfetivo } from "./modulos-fonte-core";

/** Onde o app guarda os repositórios de módulos baixados: uma pasta por produto e, ao lado, o <produto>.json da origem. */
const raizFonte = (): string => path.join(app.getPath("userData"), "modulos-fonte");
/** Pasta da cópia baixada do repositório do produto; null = este app não tem módulos. */
export function pastaDoProduto(): string | null {
  const nome = caps().modulos;
  return nome === null ? null : path.join(raizFonte(), nome);
}
const arquivoDaFonte = (nome: string): string => path.join(raizFonte(), `${nome}.json`);
const lerGravada = (nome: string) => { try { return parseFonteGravada(fs.readFileSync(arquivoDaFonte(nome), "utf8")); } catch { return null; } };

/** Resultado da última tentativa de baixar, nesta sessão do app ("nunca" até a primeira). */
let ultimo: { estado: EstadoFonte; detalhe: string } = { estado: "nunca", detalhe: "" };
/** A fonte como está agora, sem rodar o git: repositório, commit e data da cópia, e o estado da última tentativa. */
export function fonteAtual(): FonteModulos {
  const nome = caps().modulos;
  if (nome === null) throw new Error("este app não tem módulos");
  return montarFonte({ url: repoEfetivo(getModulosRepo(), nome), gravada: lerGravada(nome), temManifesto: fs.existsSync(path.join(raizFonte(), nome, "modulos.json")), estado: ultimo.estado, detalhe: ultimo.detalhe, agora: Date.now() });
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

async function baixar(): Promise<FonteModulos> {
  const nome = caps().modulos;
  const pasta = pastaDoProduto();
  if (nome === null || pasta === null) throw new Error("este app não tem módulos");
  const url = repoEfetivo(getModulosRepo(), nome);
  const antes = fonteAtual();
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
        parseManifesto(JSON.parse(fs.readFileSync(path.join(nova, "modulos.json"), "utf8")));
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
    fs.writeFileSync(arquivoDaFonte(nome), `${JSON.stringify({ url, commit, em: new Date().toISOString() })}\n`, { mode: 0o600 });
  }
  ultimo = { estado: estadoDepois(resultado, antes.commit, commit), detalhe: resultado === "erro" ? ultimaLinha(saida.stderr) : "" };
  return fonteAtual();
}

let emCurso: Promise<FonteModulos> | null = null;
/**
 * Baixa o repositório dos módulos (primeira vez: `git clone`) ou o atualiza (`git pull --ff-only`). Uma tentativa por
 * vez: a página e o seletor que pedirem juntos esperam a mesma. Nunca lança por falta de acesso, rede ou git: devolve o
 * estado, e a página mostra a frase.
 */
export function atualizarFonte(): Promise<FonteModulos> {
  emCurso ??= baixar().catch((e: unknown) => { ultimo = { estado: "erro", detalhe: e instanceof Error ? e.message : String(e) }; return fonteAtual(); }).finally(() => { emCurso = null; });
  return emCurso;
}

/** O manifesto da cópia baixada, relido a cada chamada (um pull pode ter trocado o arquivo). */
export function manifesto(): { produto: string; modulos: Modulo[] } {
  const dir = pastaDoProduto();
  if (dir === null) throw new Error("este app não tem módulos");
  if (!fonteAtual().visiveis) throw new Error("sem acesso aos módulos: o repositório ainda não foi baixado neste Mac (página Módulos › Atualizar módulos)");
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, "modulos.json"), "utf8")); }
  catch (e) { throw new Error(`não li o modulos.json dos módulos baixados (${e instanceof Error ? e.message : String(e)})`); }
  return parseManifesto(raw);
}
const moduloDe = (id: string): Modulo => {
  const m = manifesto().modulos.find((x) => x.id === id);
  if (m === undefined) throw new Error(`módulo desconhecido: ${id}`);
  return m;
};

// O motor pela regra única (WA_MOTOR_SH); os módulos só conhecem Hermes e OpenClaw (PicoClaw sai vazio, como antes).
const GATEWAY_SH = `export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:$PATH"; ${WA_MOTOR_SH}; case "$MOTOR" in hermes|openclaw) echo "gw=$MOTOR";; *) echo gw=;; esac`;
const gatewayDe = (stdout: string): ModuloGateway | null => { const m = /^gw=(hermes|openclaw)$/m.exec(stdout); return m === null ? null : (m[1] as ModuloGateway); };
const SEM_ESTADO: ModuloEstado = { ligado: false, versao: null, preenchidas: [], opcoes: {} };

/**
 * Os módulos baixados com o estado de cada um na máquina. Sem conseguir ler a máquina (SSH caiu), a lista vem assim
 * mesmo, com `erroMaquina`: a pessoa vê o que tem e a versão, só não liga nem desliga.
 */
export async function listarModulos(host: string): Promise<ModulosLista> {
  const { produto, modulos } = manifesto();
  const [lic, r] = await Promise.all([lerLicenca(host).catch(() => null), runSsh(host, `${estadoSh(modulos.map((m) => m.id))}\n${GATEWAY_SH}\n`, 30_000)]);
  const erroMaquina = r.code === 0 ? null : `não consegui ler os módulos na máquina: ${r.stderr.trim().split("\n").pop() || "ssh falhou"}`;
  const estado = erroMaquina === null ? parseEstado(r.stdout) : {};
  return {
    produto,
    liberado: acessoAddon(lic, host, produto) === "ok",
    gateway: gatewayDe(r.stdout),
    fonte: fonteAtual(),
    erroMaquina,
    modulos: modulos.map((m) => {
      const e = estado[m.id] ?? SEM_ESTADO;
      return { ...m, estado: e, desatualizado: desatualizado(e.versao, m.versao), teste: testeDe(host, m.id) };
    }),
  };
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
  const { produto } = manifesto();
  const m = moduloDe(id);
  if (m.testar === null) throw new Error(`${m.rotulo} não traz teste de conexão`);
  const pasta = path.join(pastaDoProduto() ?? "", m.pasta);
  if (!fs.existsSync(path.join(pasta, m.testar))) throw new Error(`o repositório dos módulos não trouxe ${m.pasta}/${m.testar}`);
  const linhas: string[] = [];
  const r = await enviarModulo(host, id, pasta, `${ambienteSh(id, produto, m.versao)} && [ -f "${MODULOS_DIR}/${id}/ligado" ] || { echo "teste=erro ligue o módulo antes de testar"; exit 0; }; bash ./${m.testar}`, (l) => { linhas.push(l); if (!l.startsWith("ferramenta\t")) onLine?.(l); });
  const t = lerTeste(linhas.length > 0 ? linhas : r.log, new Date().toISOString());
  gravarTeste(host, id, t);
  return t;
}

async function assertLiberado(host: string): Promise<void> {
  const { produto } = manifesto();
  const a = acessoAddon(await lerLicenca(host), host, produto);
  if (a === "ausente" || a === "expirada") throw new Error(`MODULOS_REQUIRED:${produto}`);
}

/**
 * Liga (ou atualiza) um módulo: grava as opções que faltarem com os padrões, manda a pasta do módulo e roda o
 * instalador com o ambiente do contrato; com sucesso, marca VERSION e `ligado` (é o que o backend lê).
 */
export async function ligarModulo(host: string, id: string, onLine?: (l: string) => void): Promise<ModuloResultado> {
  await assertLiberado(host);
  const { produto } = manifesto();
  const m = moduloDe(id);
  const lista = await listarModulos(host);
  if (lista.erroMaquina !== null) return { ok: false, log: [lista.erroMaquina] };
  const v = lista.modulos.find((x) => x.id === id);
  if (m.gateways.length > 0 && (lista.gateway === null || !m.gateways.includes(lista.gateway))) return { ok: false, log: [`este módulo precisa do WhatsApp pelo ${m.gateways.join(" ou ")}; a máquina usa ${lista.gateway ?? "nenhum"}`] };
  const faltam = m.credenciais.filter((c) => !(v?.estado.preenchidas ?? []).includes(c.chave));
  if (faltam.length > 0) return { ok: false, log: [`preencha antes: ${faltam.map((c) => c.rotulo).join(", ")}`] };
  const opcoes = mesclarOpcoes(m, v?.estado.opcoes ?? {}, {});
  const pasta = path.join(pastaDoProduto() ?? "", m.pasta);
  if (!fs.existsSync(path.join(pasta, m.instalar))) return { ok: false, log: [`o repositório dos módulos não trouxe ${m.pasta}/${m.instalar}`] };
  const cmd = `${opcoesSh(id, opcoes)} >/dev/null && ${ambienteSh(id, produto, m.versao)} && bash ./${m.instalar} && printf '%s\\n' '${m.versao}' > "${MODULOS_DIR}/${id}/VERSION" && touch "${MODULOS_DIR}/${id}/ligado" && echo "✓ ${m.rotulo} ligado (${m.versao})"`;
  return enviarModulo(host, id, pasta, cmd, onLine);
}

/** Desliga: roda o desinstalador do módulo e tira o `ligado` (credenciais e opções ficam para religar depois). */
export async function desligarModulo(host: string, id: string, onLine?: (l: string) => void): Promise<ModuloResultado> {
  const { produto } = manifesto();
  const m = moduloDe(id);
  const pasta = path.join(pastaDoProduto() ?? "", m.pasta);
  const cmd = `${ambienteSh(id, produto, m.versao)} && { [ -f ./${m.desinstalar} ] && bash ./${m.desinstalar} || true; } && rm -f "${MODULOS_DIR}/${id}/ligado" && echo "✓ ${m.rotulo} desligado"`;
  const r = await enviarModulo(host, id, pasta, cmd, onLine);
  // Desligado, o teste antigo deixa de valer (a conta pode ter saído junto, como no Salvy).
  if (r.ok) gravarTeste(host, id, null);
  return r;
}

export async function salvarCredenciais(host: string, id: string, patch: Record<string, string>): Promise<void> {
  await assertLiberado(host);
  const r = await runSsh(host, `${credenciaisSh(moduloDe(id), patch)}\n`, 30_000);
  if (!/^cred=ok$/m.test(r.stdout)) throw new Error(`não gravei as credenciais: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
}

/** Grava opções; com o módulo ligado, roda o instalador de novo para valerem (serviços relidos). */
export async function salvarOpcoes(host: string, id: string, patch: Record<string, unknown>, onLine?: (l: string) => void): Promise<ModuloResultado> {
  await assertLiberado(host);
  const m = moduloDe(id);
  const lista = await listarModulos(host);
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
  if (caps().modulos === null) return;
  const fonte = await atualizarFonte();
  if (!fonte.visiveis) { log(`[modulos] ${host}: ${fonte.mensagem || "módulos ainda não baixados"}`); return; }
  const lista = await listarModulos(host);
  if (!lista.liberado || lista.erroMaquina !== null) return;
  for (const m of lista.modulos.filter((x) => x.estado.ligado && x.desatualizado)) {
    log(`[modulos] ${host}: ${m.id} ${m.estado.versao ?? "?"} → ${m.versao}; atualizando`);
    const r = await ligarModulo(host, m.id);
    log(`[modulos] ${host}: ${m.id} ${r.ok ? "atualizado" : `falhou: ${r.log.at(-1) ?? "?"}`}`);
  }
}
