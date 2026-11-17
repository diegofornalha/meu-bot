/**
 * Módulos de produto, lado do app (puro, testado): o manifesto modulos.json do repositório do produto (baixado com git,
 * modulos-fonte-core.ts) e os scripts curtos que leem e gravam o estado na máquina. Além do que liga o módulo, o
 * manifesto traz a ficha dele (categoria, pedidos de exemplo, guia, teste de conexão e primeiros passos), que a página
 * Módulos desenha: tudo texto puro, cortado nos limites (o repositório é de fora; nada vira HTML). O contrato na máquina é o de
 * backend-colima/modulos.js: ~/.local/share/meu-bot/modulos/<id>/{ligado,VERSION,opcoes.json,turno.json} e as
 * credenciais em ~/.config/meu-bot/modulos/<id>.env (0600). As credenciais nunca voltam ao app: o estado só diz quais
 * chaves têm valor.
 */
import type { Modulo, ModuloCredencial, ModuloEstado, ModuloFerramenta, ModuloGateway, ModuloGuia, ModuloOpcao, ModuloPasso, ModuloTeste } from "../../shared/ipc";

export const MODULOS_DIR = "$HOME/.local/share/meu-bot/modulos";
export const MODULOS_CONF = "$HOME/.config/meu-bot/modulos";
const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;
const VERSAO_RE = /^\d+\.\d+\.\d+$/;
const PASTA_RE = /^[a-z0-9][a-z0-9._-]{0,60}$/;
const SCRIPT_RE = /^[A-Za-z0-9_.-]{1,60}\.sh$/;
const CRED_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const OPCAO_RE = /^[a-zA-Z][A-Za-z0-9_]{0,40}$/;
const GATEWAYS: readonly ModuloGateway[] = ["openclaw", "hermes"];

const str = (v: unknown, max = 400): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function credencial(v: unknown): ModuloCredencial | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const chave = str(o.chave, 64);
  return CRED_RE.test(chave) ? { chave, rotulo: str(o.rotulo, 80) || chave, ajuda: str(o.ajuda) } : null;
}
function opcao(v: unknown): ModuloOpcao | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const chave = str(o.chave, 41);
  const tipo = o.tipo === "numero" || o.tipo === "booleano" ? o.tipo : "texto";
  if (!OPCAO_RE.test(chave)) return null;
  const padrao = tipo === "booleano" ? o.padrao === true : tipo === "numero" ? (typeof o.padrao === "number" && Number.isFinite(o.padrao) ? o.padrao : 0) : str(o.padrao);
  return { chave, rotulo: str(o.rotulo, 80) || chave, tipo, padrao, ajuda: str(o.ajuda) };
}

/** Link de fora (o guia completo): só https, sem usuário e senha. */
const httpsOk = (v: unknown): string | null => {
  const t = str(v, 500);
  try { const u = new URL(t); return u.protocol === "https:" && u.username === "" && u.password === "" ? u.toString() : null; } catch { return null; }
};
function guia(v: unknown): ModuloGuia {
  const o = v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { paraQue: str(o.paraQue, 600), cuidados: lista(o.cuidados).map((c) => str(c, 300)).filter(Boolean).slice(0, 8), texto: lista(o.texto).map((c) => str(c, 1200)).filter(Boolean).slice(0, 20), completo: httpsOk(o.completo) };
}
/** Como um passo dos primeiros passos se conclui: pelo estado do módulo na máquina, pelo teste, ou à mão. */
const CONCLUI_RE = /^(credenciais|ligado|testado|manual|opcao:[a-zA-Z][A-Za-z0-9_]{0,40})$/;
function passos(v: unknown, opcoes: readonly ModuloOpcao[]): ModuloPasso[] {
  const out: ModuloPasso[] = [];
  for (const p of lista(v).slice(0, 10)) {
    const o = p !== null && typeof p === "object" ? (p as Record<string, unknown>) : {};
    const id = str(o.id, 41); const conclui = str(o.conclui, 50);
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(id) || out.some((x) => x.id === id) || !CONCLUI_RE.test(conclui)) continue;
    if (conclui.startsWith("opcao:") && !opcoes.some((x) => x.chave === conclui.slice(6))) continue;
    out.push({ id, titulo: str(o.titulo, 100) || id, texto: str(o.texto, 1200), conclui, botao: str(o.botao, 40) || "Feito", pergunta: str(o.pergunta, 400) });
  }
  return out;
}

/** modulos.json → { produto, modulos }; erro com a frase do que está errado (o build do produto falha com ela). */
export function parseManifesto(raw: unknown): { produto: string; modulos: Modulo[] } {
  if (raw === null || typeof raw !== "object") throw new Error("modulos.json: não é um objeto");
  const o = raw as Record<string, unknown>;
  const produto = str(o.produto, 40);
  if (!/^meu-bot-[a-z0-9-]{1,30}$/.test(produto)) throw new Error("modulos.json: `produto` precisa ser meu-bot-<nome> (o add-on na licença)");
  const modulos: Modulo[] = [];
  for (const [i, v] of lista(o.modulos).entries()) {
    const m = v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
    const id = str(m.id, 41);
    const onde = `modulos.json: módulo ${i + 1}${id ? ` (${id})` : ""}`;
    if (!ID_RE.test(id)) throw new Error(`${onde}: id inválido (letras minúsculas, números e hífen)`);
    if (modulos.some((x) => x.id === id)) throw new Error(`${onde}: id repetido`);
    const versao = str(m.versao, 20);
    if (!VERSAO_RE.test(versao)) throw new Error(`${onde}: versao precisa ser x.y.z`);
    const pasta = str(m.pasta, 61) || id;
    if (!PASTA_RE.test(pasta)) throw new Error(`${onde}: pasta inválida`);
    const instalar = str(m.instalar, 61) || "instalar.sh";
    const desinstalar = str(m.desinstalar, 61) || "desinstalar.sh";
    if (!SCRIPT_RE.test(instalar) || !SCRIPT_RE.test(desinstalar)) throw new Error(`${onde}: instalar/desinstalar precisam ser <nome>.sh dentro da pasta`);
    const credenciais = lista(m.credenciais).map(credencial).filter((c): c is ModuloCredencial => c !== null);
    const opcoes = lista(m.opcoes).map(opcao).filter((c): c is ModuloOpcao => c !== null);
    const gateways = lista(m.gateways).filter((g): g is ModuloGateway => GATEWAYS.includes(g as ModuloGateway));
    const testar = str(m.testar, 61) || null;
    if (testar !== null && !SCRIPT_RE.test(testar)) throw new Error(`${onde}: testar precisa ser <nome>.sh dentro da pasta`);
    modulos.push({ id, rotulo: str(m.rotulo, 80) || id, descricao: str(m.descricao, 600), versao, pasta, instalar, desinstalar, credenciais, opcoes, gateways, requisitos: lista(m.requisitos).map((r) => str(r, 200)).filter(Boolean) ,
      categoria: str(m.categoria, 40), exemplos: lista(m.exemplos).map((e) => str(e, 200)).filter(Boolean).slice(0, 6), guia: guia(m.guia), testar, passos: passos(m.passos, opcoes) });
  }
  if (modulos.length === 0) throw new Error("modulos.json: nenhum módulo");
  return { produto, modulos };
}

/** x.y.z → número comparável; a versão instalada é mais antiga que a do app? */
const num = (v: string): number => v.split(".").reduce((a, p) => a * 1000 + (Number(p) || 0), 0);
export const desatualizado = (instalada: string | null, doApp: string): boolean => instalada !== null && VERSAO_RE.test(instalada) && num(instalada) < num(doApp);

/**
 * Estado dos módulos na máquina: uma linha por módulo, `mod=<id> ligado=0|1 versao=<v> preenchidas=<A,B>
 * opcoes=<base64>`. Só os NOMES das credenciais com valor saem da máquina.
 */
export function estadoSh(ids: readonly string[]): string {
  const ok = ids.filter((id) => ID_RE.test(id));
  return `for id in ${ok.join(" ")}; do
  d="${MODULOS_DIR}/$id"; e="${MODULOS_CONF}/$id.env"
  l=0; [ -f "$d/ligado" ] && l=1
  v=$(head -c 20 "$d/VERSION" 2>/dev/null | tr -cd '0-9.')
  p=$(grep -E '^[A-Z][A-Z0-9_]*=.+' "$e" 2>/dev/null | cut -d= -f1 | tr '\\n' ',' )
  o=$(head -c 20000 "$d/opcoes.json" 2>/dev/null | base64 | tr -d '\\n')
  echo "mod=$id ligado=$l versao=$v preenchidas=$p opcoes=$o"
done`;
}

export function parseEstado(stdout: string): Record<string, ModuloEstado> {
  const out: Record<string, ModuloEstado> = {};
  for (const linha of stdout.split("\n")) {
    const m = /^mod=([a-z][a-z0-9-]{1,40}) ligado=([01]) versao=([0-9.]*) preenchidas=(\S*) opcoes=([A-Za-z0-9+/=]*)$/.exec(linha.trim());
    if (m === null) continue;
    let opcoes: Record<string, string | number | boolean> = {};
    try {
      const j = m[5] ? JSON.parse(Buffer.from(m[5], "base64").toString("utf8")) as unknown : {};
      if (j !== null && typeof j === "object" && !Array.isArray(j)) opcoes = Object.fromEntries(Object.entries(j as Record<string, unknown>).filter((e): e is [string, string | number | boolean] => ["string", "number", "boolean"].includes(typeof e[1])));
    } catch { /* opcoes.json corrompido: sem opções */ }
    out[m[1]!] = { ligado: m[2] === "1", versao: m[3] ? m[3] : null, preenchidas: (m[4] ?? "").split(",").filter((c) => CRED_RE.test(c)), opcoes };
  }
  return out;
}

/**
 * Grava credenciais no .env do módulo (0600, tmp + mv), uma `CHAVE=valor` cru por linha (sem aspas: quem lê pega
 * tudo depois do primeiro "="; módulos não fazem `source` dele). Valor vazio apaga a chave; as outras ficam. Os
 * valores vão em base64 dentro do script e nunca são impressos. Só chaves declaradas no manifesto. Imprime `cred=ok`.
 */
export function credenciaisSh(m: Modulo, patch: Record<string, string>): string {
  const validas = new Set(m.credenciais.map((c) => c.chave));
  const limpo: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!validas.has(k)) throw new Error(`credencial desconhecida: ${k}`);
    if (typeof v !== "string" || v.length > 4000 || /[\n\r]/.test(v)) throw new Error(`${k}: valor inválido (uma linha só)`);
    limpo[k] = v.trim();
  }
  const b64 = Buffer.from(JSON.stringify(limpo), "utf8").toString("base64");
  return `python3 - "${MODULOS_CONF}/${m.id}.env" '${b64}' <<'PY'
import base64, json, os, sys
p = os.path.expandvars(sys.argv[1]); patch = json.loads(base64.b64decode(sys.argv[2]).decode("utf-8"))
cur = {}
try:
    for l in open(p):
        if "=" in l and not l.startswith("#"):
            k, v = l.rstrip("\\n").split("=", 1); cur[k] = v
except FileNotFoundError: pass
for k, v in patch.items():
    if v == "": cur.pop(k, None)
    else: cur[k] = v
os.makedirs(os.path.dirname(p), mode=0o700, exist_ok=True)
t = p + ".tmp"; fd = os.open(t, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f: f.write("".join(f"{k}={v}\\n" for k, v in cur.items()))
os.replace(t, p); print("cred=ok")
PY`;
}

/** Valida as opções contra o manifesto (tipos) e devolve o objeto completo (padrões + o que já havia + o patch). */
export function mesclarOpcoes(m: Modulo, atuais: Record<string, string | number | boolean>, patch: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const o of m.opcoes) {
    const v = Object.prototype.hasOwnProperty.call(patch, o.chave) ? patch[o.chave] : Object.prototype.hasOwnProperty.call(atuais, o.chave) ? atuais[o.chave] : o.padrao;
    if (o.tipo === "booleano") { if (typeof v !== "boolean") throw new Error(`${o.rotulo}: sim ou não`); out[o.chave] = v; }
    else if (o.tipo === "numero") { const n = typeof v === "number" ? v : Number(v); if (!Number.isFinite(n)) throw new Error(`${o.rotulo}: número`); out[o.chave] = n; }
    else { if (typeof v !== "string" || v.length > 2000) throw new Error(`${o.rotulo}: texto até 2000 caracteres`); out[o.chave] = v.trim(); }
  }
  for (const k of Object.keys(patch)) if (!m.opcoes.some((o) => o.chave === k)) throw new Error(`opção desconhecida: ${k}`);
  return out;
}

/** Grava opcoes.json do módulo (tmp + mv, 0600). Imprime `opcoes=ok`. */
export function opcoesSh(id: string, opcoes: Record<string, string | number | boolean>): string {
  if (!ID_RE.test(id)) throw new Error("módulo inválido");
  const b64 = Buffer.from(JSON.stringify(opcoes), "utf8").toString("base64");
  return `d="${MODULOS_DIR}/${id}"; mkdir -p "$d" && umask 077 && echo '${b64}' | base64 -d > "$d/opcoes.json.tmp" && mv "$d/opcoes.json.tmp" "$d/opcoes.json" && echo opcoes=ok`;
}

/** Variáveis que o instalador e o desinstalador recebem (o contrato do repositório do produto). */
export function ambienteSh(id: string, produto: string, versao: string): string {
  if (!ID_RE.test(id) || !VERSAO_RE.test(versao) || !/^meu-bot-[a-z0-9-]{1,30}$/.test(produto)) throw new Error("módulo inválido");
  return `export MODULO_ID=${id} MODULO_PRODUTO=${produto} MODULO_VERSAO=${versao} MODULO_DIR="${MODULOS_DIR}/${id}" MODULO_ENV="${MODULOS_CONF}/${id}.env" MODULO_OPCOES="${MODULOS_DIR}/${id}/opcoes.json"`;
}

/**
 * Saída do testar.sh de um módulo: uma linha por ferramenta (`ferramenta\t<nome>\t<descrição>`) e, no fim,
 * `teste=ok` ou `teste=erro <motivo>`. Sem a linha final (o script caiu ou o SSH cortou), conta como erro.
 */
export function lerTeste(linhas: readonly string[], em: string): ModuloTeste {
  const ferramentas: ModuloFerramenta[] = [];
  let fim: string | null = null;
  for (const l of linhas) {
    const f = /^ferramenta\t([A-Za-z0-9_.:-]{1,80})\t?(.*)$/.exec(l);
    if (f !== null && ferramentas.length < 200 && !ferramentas.some((x) => x.nome === f[1])) ferramentas.push({ nome: f[1]!, descricao: f[2]!.trim().slice(0, 300) });
    else if (/^teste=/.test(l)) fim = l;
  }
  if (fim === "teste=ok") return { ok: true, em, ferramentas, erro: null };
  const motivo = fim !== null ? fim.replace(/^teste=erro\s*/, "").slice(0, 300) : (linhas.filter((l) => !l.startsWith("ferramenta\t")).at(-1) ?? "o teste não terminou");
  return { ok: false, em, ferramentas, erro: motivo || "o teste falhou" };
}
