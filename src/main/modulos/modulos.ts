/**
 * Módulos de produto, lado do app (I/O): lê o modulos.json que veio com este app (Resources/<caps.modulos>/ empacotado;
 * produtos/<caps.modulos>/ em dev, o submódulo) e liga, desliga e configura cada módulo na máquina da janela por SSH.
 * O núcleo puro (manifesto, scripts) é o modulos-core.ts; o contrato na máquina, backend-colima/modulos.js.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { Modulo, ModuloGateway, ModuloResultado, ModulosLista } from "../../shared/ipc";
import { caps } from "../app/variant";
import { lerLicenca } from "../licenca/licenca-maquina";
import { acessoAddon } from "../licenca/licenca";
import { enviarModulo } from "../maquina/hostProbe";
import { runSsh } from "../whatsapp/whatsapp";
import { WA_MOTOR_SH } from "../whatsapp/whatsapp-capacidades";
import { MODULOS_DIR, ambienteSh, credenciaisSh, desatualizado, estadoSh, mesclarOpcoes, opcoesSh, parseEstado, parseManifesto } from "./modulos-core";

/** Pasta do repositório do produto que veio com este app; null = este app não tem módulos. */
export function pastaDoProduto(): string | null {
  const nome = caps().modulos;
  if (nome === null) return null;
  return app.isPackaged ? path.join(process.resourcesPath, nome) : path.join(app.getAppPath(), "produtos", nome);
}

let cache: { produto: string; modulos: Modulo[] } | null = null;
export function manifesto(): { produto: string; modulos: Modulo[] } {
  if (cache !== null) return cache;
  const dir = pastaDoProduto();
  if (dir === null) throw new Error("este app não tem módulos");
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, "modulos.json"), "utf8")); }
  catch (e) { throw new Error(`não li o modulos.json do produto (${e instanceof Error ? e.message : String(e)}); o submódulo veio junto?`); }
  cache = parseManifesto(raw);
  return cache;
}
const moduloDe = (id: string): Modulo => {
  const m = manifesto().modulos.find((x) => x.id === id);
  if (m === undefined) throw new Error(`módulo desconhecido: ${id}`);
  return m;
};

// O motor pela regra única (WA_MOTOR_SH); os módulos só conhecem Hermes e OpenClaw (PicoClaw sai vazio, como antes).
const GATEWAY_SH = `export PATH="$HOME/.openclaw/bin:$HOME/.local/bin:/opt/node/bin:$PATH"; ${WA_MOTOR_SH}; case "$MOTOR" in hermes|openclaw) echo "gw=$MOTOR";; *) echo gw=;; esac`;
const gatewayDe = (stdout: string): ModuloGateway | null => { const m = /^gw=(hermes|openclaw)$/m.exec(stdout); return m === null ? null : (m[1] as ModuloGateway); };

export async function listarModulos(host: string): Promise<ModulosLista> {
  const { produto, modulos } = manifesto();
  const [lic, r] = await Promise.all([lerLicenca(host), runSsh(host, `${estadoSh(modulos.map((m) => m.id))}\n${GATEWAY_SH}\n`, 30_000)]);
  if (r.code !== 0) throw new Error(`não consegui ler os módulos na máquina: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
  const estado = parseEstado(r.stdout);
  return {
    produto,
    liberado: acessoAddon(lic, host, produto) === "ok",
    gateway: gatewayDe(r.stdout),
    modulos: modulos.map((m) => {
      const e = estado[m.id] ?? { ligado: false, versao: null, preenchidas: [], opcoes: {} };
      return { ...m, estado: e, desatualizado: desatualizado(e.versao, m.versao) };
    }),
  };
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
export async function ligarModulo(host: string, id: string, onLine?: (line: string) => void): Promise<ModuloResultado> {
  await assertLiberado(host);
  const { produto } = manifesto();
  const m = moduloDe(id);
  const lista = await listarModulos(host);
  const v = lista.modulos.find((x) => x.id === id);
  if (m.gateways.length > 0 && (lista.gateway === null || !m.gateways.includes(lista.gateway))) return { ok: false, log: [`este módulo precisa do WhatsApp pelo ${m.gateways.join(" ou ")}; a máquina usa ${lista.gateway ?? "nenhum"}`] };
  const faltam = m.credenciais.filter((c) => !(v?.estado.preenchidas ?? []).includes(c.chave));
  if (faltam.length > 0) return { ok: false, log: [`preencha antes: ${faltam.map((c) => c.rotulo).join(", ")}`] };
  const opcoes = mesclarOpcoes(m, v?.estado.opcoes ?? {}, {});
  const pasta = path.join(pastaDoProduto() ?? "", m.pasta);
  if (!fs.existsSync(path.join(pasta, m.instalar))) return { ok: false, log: [`o produto não trouxe ${m.pasta}/${m.instalar}`] };
  const cmd = `${opcoesSh(id, opcoes)} >/dev/null && ${ambienteSh(id, produto, m.versao)} && bash ./${m.instalar} && printf '%s\\n' '${m.versao}' > "${MODULOS_DIR}/${id}/VERSION" && touch "${MODULOS_DIR}/${id}/ligado" && echo "✓ ${m.rotulo} ligado (${m.versao})"`;
  return enviarModulo(host, id, pasta, cmd, onLine);
}

/** Desliga: roda o desinstalador do módulo e tira o `ligado` (credenciais e opções ficam para religar depois). */
export async function desligarModulo(host: string, id: string, onLine?: (line: string) => void): Promise<ModuloResultado> {
  const { produto } = manifesto();
  const m = moduloDe(id);
  const pasta = path.join(pastaDoProduto() ?? "", m.pasta);
  const cmd = `${ambienteSh(id, produto, m.versao)} && { [ -f ./${m.desinstalar} ] && bash ./${m.desinstalar} || true; } && rm -f "${MODULOS_DIR}/${id}/ligado" && echo "✓ ${m.rotulo} desligado"`;
  return enviarModulo(host, id, pasta, cmd, onLine);
}

export async function salvarCredenciais(host: string, id: string, patch: Record<string, string>): Promise<void> {
  await assertLiberado(host);
  const r = await runSsh(host, `${credenciaisSh(moduloDe(id), patch)}\n`, 30_000);
  if (!/^cred=ok$/m.test(r.stdout)) throw new Error(`não gravei as credenciais: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
}

/** Grava opções; com o módulo ligado, roda o instalador de novo para valerem (serviços relidos). */
export async function salvarOpcoes(host: string, id: string, patch: Record<string, unknown>, onLine?: (line: string) => void): Promise<ModuloResultado> {
  await assertLiberado(host);
  const m = moduloDe(id);
  const v = (await listarModulos(host)).modulos.find((x) => x.id === id);
  const opcoes = mesclarOpcoes(m, v?.estado.opcoes ?? {}, patch);
  const r = await runSsh(host, `${opcoesSh(id, opcoes)}\n`, 30_000);
  if (!/^opcoes=ok$/m.test(r.stdout)) throw new Error(`não gravei as opções: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
  if (v?.estado.ligado === true) return ligarModulo(host, id, onLine);
  return { ok: true, log: ["opções salvas"] };
}

/** Seletor: módulos ligados numa versão anterior à deste app são reinstalados sozinhos (só sobe de versão). */
export async function atualizarModulos(host: string, log: (l: string) => void): Promise<void> {
  if (caps().modulos === null) return;
  const lista = await listarModulos(host);
  if (!lista.liberado) return;
  for (const m of lista.modulos.filter((x) => x.estado.ligado && x.desatualizado)) {
    log(`[modulos] ${host}: ${m.id} ${m.estado.versao ?? "?"} → ${m.versao}; atualizando`);
    const r = await ligarModulo(host, m.id);
    log(`[modulos] ${host}: ${m.id} ${r.ok ? "atualizado" : `falhou: ${r.log.at(-1) ?? "?"}`}`);
  }
}
