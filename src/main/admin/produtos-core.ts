/**
 * Variante: admin. Registro de produtos derivados do meu-bot (MVPs de bots verticais: meu-bot-fit, meu-bot-vendas…),
 * parte pura: formato do produtos.json do admin, validação do que a tela manda, a definição exportável
 * (produto.json) e o checklist do que falta para virar uma variante de verdade (linha em variant-core.ts,
 * ícone, extensão/templates). Testado.
 */
import type { ProdutoMvp, ProdutoMvpPatch, ProdutoStatus } from "../../shared/ipc";
import { nomesReservados } from "../app/variant-core";

export const STATUS: readonly ProdutoStatus[] = ["ideia", "mvp", "beta", "lancado"];
export const STATUS_LABEL: Record<ProdutoStatus, string> = { ideia: "Ideia", mvp: "MVP", beta: "Beta", lancado: "Lançado" };
export const TIPOS_CAMPO = ["TEXT", "NUMBER", "DATE", "DROPDOWN", "TAG", "CHECKBOX"] as const;
/** meu-bot-<slug>: minúsculas, dígitos e hífen; nunca os nomes já tomados pela tabela de produtos. */
const SLUG_RE = /^meu-bot-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Apps da tabela, nomes de licença e add-ons (app/variant-core.ts): um produto novo na tabela já entra aqui. */
const RESERVADOS = nomesReservados();
export const nomeValido = (n: unknown): n is string => typeof n === "string" && SLUG_RE.test(n) && n.length <= 40 && !RESERVADOS.has(n);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const texto = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");
const lista = (v: unknown, max: number, each: number): string[] => (Array.isArray(v) ? v.map((x) => str(x, each)).filter((x) => x !== "").slice(0, max) : []);
const isIso = (v: unknown): v is string => typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v));

export function vazio(nome: string, now: number = Date.now()): ProdutoMvp {
  const at = new Date(now).toISOString();
  return { nome, vertical: "", pitch: "", publico: "", modulos: { chat: true, whatsapp: true, navegador: true, crm: true, extras: "" }, pipeline: { etapas: [], campos: [] }, status: "ideia", notas: "", proximos: "", createdAt: at, updatedAt: at };
}
/** Normaliza uma entrada lida do arquivo; inválida → null. */
export function parseProduto(raw: unknown, now: number = Date.now()): ProdutoMvp | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!nomeValido(o["nome"])) return null;
  const base = vazio(o["nome"], now);
  const m = o["modulos"] !== null && typeof o["modulos"] === "object" ? (o["modulos"] as Record<string, unknown>) : {};
  const p = o["pipeline"] !== null && typeof o["pipeline"] === "object" ? (o["pipeline"] as Record<string, unknown>) : {};
  const campos = Array.isArray(p["campos"]) ? p["campos"].map((c) => { const cc = c !== null && typeof c === "object" ? (c as Record<string, unknown>) : {}; const nome = str(cc["nome"], 60); const tipo = (TIPOS_CAMPO as readonly string[]).includes(String(cc["tipo"])) ? (cc["tipo"] as (typeof TIPOS_CAMPO)[number]) : "TEXT"; return nome === "" ? null : { nome, tipo }; }).filter((c): c is { nome: string; tipo: (typeof TIPOS_CAMPO)[number] } => c !== null).slice(0, 40) : [];
  return {
    ...base,
    vertical: str(o["vertical"], 80), pitch: str(o["pitch"], 240), publico: str(o["publico"], 240),
    modulos: { chat: m["chat"] !== false, whatsapp: m["whatsapp"] !== false, navegador: m["navegador"] !== false, crm: m["crm"] !== false, extras: texto(m["extras"], 1000) },
    pipeline: { etapas: lista(p["etapas"], 30, 60), campos },
    status: (STATUS as readonly string[]).includes(String(o["status"])) ? (o["status"] as ProdutoStatus) : "ideia",
    notas: texto(o["notas"], 8000), proximos: texto(o["proximos"], 4000),
    createdAt: isIso(o["createdAt"]) ? o["createdAt"] : base.createdAt, updatedAt: isIso(o["updatedAt"]) ? o["updatedAt"] : base.updatedAt,
  };
}
/** O arquivo inteiro: lista de produtos, por nome, sem repetidos. */
export function parseProdutos(raw: unknown, now: number = Date.now()): ProdutoMvp[] {
  const arr = raw !== null && typeof raw === "object" && Array.isArray((raw as { produtos?: unknown }).produtos) ? ((raw as { produtos: unknown[] }).produtos) : Array.isArray(raw) ? raw : [];
  const out = new Map<string, ProdutoMvp>();
  for (const r of arr) { const p = parseProduto(r, now); if (p !== null && !out.has(p.nome)) out.set(p.nome, p); }
  return [...out.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}
/** O que a tela mandou (criar ou editar): `nome` obrigatório e válido; o resto só o que veio. Lança com a mensagem para a pessoa. */
export function parseProdutoPatch(payload: unknown): ProdutoMvpPatch {
  const o = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nome = str(o["nome"], 60).toLowerCase();
  if (!nomeValido(nome)) throw new Error("o nome precisa ser meu-bot-<algo> (minúsculas, dígitos e hífen; meu-bot, meu-bot-admin e meu-bot-finance já existem)");
  const p = parseProduto({ ...o, nome });
  if (p === null) throw new Error("produto inválido");
  const patch: ProdutoMvpPatch = { nome };
  for (const k of ["vertical", "pitch", "publico", "notas", "proximos", "status"] as const) if (k in o) (patch as Record<string, unknown>)[k] = p[k];
  if ("modulos" in o) patch.modulos = p.modulos;
  if ("pipeline" in o) patch.pipeline = p.pipeline;
  return patch;
}
export function aplicarPatch(cur: ProdutoMvp | null, patch: ProdutoMvpPatch, now: number = Date.now()): ProdutoMvp {
  const base = cur ?? vazio(patch.nome, now);
  return { ...base, ...patch, modulos: patch.modulos ?? base.modulos, pipeline: patch.pipeline ?? base.pipeline, updatedAt: new Date(now).toISOString() };
}
/** A definição exportável (produto.json): o insumo para a implementação como variante. */
export function definicao(p: ProdutoMvp): Record<string, unknown> {
  const variant = p.nome.replace(/^meu-bot-/, "");
  return {
    produto: p.nome, variant, bundleId: `local.${p.nome}`, icone: `assets/icon-${variant}.icns`, userData: p.nome, planoExigido: "free", addon: p.nome,
    vertical: p.vertical, pitch: p.pitch, publico: p.publico, status: p.status,
    caps: { chat: p.modulos.chat, pair: p.modulos.whatsapp, manageWa: p.modulos.whatsapp, navegador: p.modulos.navegador, crm: p.modulos.crm },
    extras: p.modulos.extras,
    pipelineModelo: { etapas: p.pipeline.etapas, campos: p.pipeline.campos },
    notas: p.notas, proximos: p.proximos, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}
export const definicaoJson = (p: ProdutoMvp): string => `${JSON.stringify(definicao(p), null, 2)}\n`;
/** O que falta para o MVP virar um app de verdade, na ordem. */
export function checklist(p: ProdutoMvp): string[] {
  const variant = p.nome.replace(/^meu-bot-/, "");
  return [
    p.pitch === "" ? "Escrever a ideia em uma frase (para quem e o que a pessoa ganha)" : "",
    p.modulos.crm && p.pipeline.etapas.length === 0 ? "Definir as etapas do pipeline modelo" : "",
    `Adicionar "${variant}" em AppVariant (src/shared/ipc/app.ts) e a linha em PRODUTOS (src/main/app/variant-core.ts), com addon e abreEm`,
    `Registrar o add-on ${p.nome} em ADDONS (src/main/app/variant-core.ts) e em backend-colima/licenca.js`,
    `Desenhar assets/icon-${variant}.svg e rodar npm run icons`,
    p.modulos.crm ? "Templates do pipeline em produtos/" + p.nome + "/ (etapas e campos iniciais)" : "",
    "Módulo em repositório próprio, no molde do meu-bot-finance: modulos.json, instalar.sh, desinstalar.sh, testar.sh e a página servida pelo próprio módulo",
    `Liberar pela licença: o add-on ${p.nome} em Suporte › Conta e licença (com ou sem o Pro)`,
    `Empacotar: npm run dist -- --variant ${variant}`,
  ].filter((x) => x !== "");
}
