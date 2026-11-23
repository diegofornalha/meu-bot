/**
 * Variante: admin. "Preparar máquina" (IO): lê o estado por SSH, aplica os passos que faltam um a um (cada um com o
 * prazo e a auditoria do instalador que já existia) e devolve o estado relido. Falhar num passo não para os outros:
 * os itens são independentes e os dependentes já imprimem o próprio ERRO=. Não importa usuarios-admin.ts (que importa
 * daqui para o "Criar usuário"), para não fechar um ciclo.
 */
import type { PrepararId, PrepararVisao } from "../../shared/ipc";
import { ORDEM_PREPARAR, PREPARAR_ESTADO_SH, TITULOS, faltamAoCriarUsuario, lerPreparar, passosPreparar, type PrepararLido } from "./preparar-core";
import { runSsh } from "../whatsapp/whatsapp";
import { registrar } from "../auditoria/auditoria";
import { log } from "../maquina/backend";
import { installClaudeGlobal, installOllamaGlobal } from "../maquina/hostProbe";

const visaoDe = (l: PrepararLido): PrepararVisao => ({ root: l.root, itens: l.itens, faltam: l.faltam });

export async function estadoPreparar(host: string): Promise<PrepararLido> {
  const r = await runSsh(host, `${PREPARAR_ESTADO_SH}\n`, 60_000);
  if (r.code !== 0) throw new Error(`não consegui ler o estado da máquina: ${r.stderr.trim().split("\n").pop() ?? "ssh falhou"}`);
  const l = lerPreparar(r.stdout);
  if (!l.root) throw new Error("o preparo da máquina é do root: abra o admin pela conta root desta máquina");
  return l;
}

const isId = (v: unknown): v is PrepararId => typeof v === "string" && (ORDEM_PREPARAR as readonly string[]).includes(v);
/** Uma rodada por máquina de cada vez: "Criar usuário" e o botão da aba juntos, o segundo só avisa. */
const emAndamento = new Set<string>();

/**
 * Aplica os ids pedidos (`undefined` = tudo que falta, sem os opcionais) na ordem de dependência. Devolve o estado
 * relido mais `falhas` com o que não deu e por quê.
 */
export async function aplicarPreparar(host: string, ids?: unknown, onLine?: (line: string) => void): Promise<PrepararVisao> {
  if (emAndamento.has(host)) throw new Error("já estou preparando esta máquina; espere terminar");
  emAndamento.add(host);
  try {
    const v = await estadoPreparar(host);
    const pedidos: PrepararId[] = Array.isArray(ids) ? ids.filter(isId) : v.faltam;
    const passos = passosPreparar(pedidos, v);
    if (passos.length === 0) { onLine?.("nada a aplicar: a máquina já está preparada"); return visaoDe(v); }
    const falhas: NonNullable<PrepararVisao["falhas"]>[number][] = [];
    const feitos: string[] = [];
    for (const p of passos) {
      onLine?.(`${p.titulo}…`);
      try {
        let alvo = "";
        if (p.sh === null && p.id === "ollama") {
          const r = await installOllamaGlobal(host, onLine);
          if (!r.ok) throw new Error(r.erro ?? "o instalador não respondeu");
          alvo = r.porta !== null ? `porta ${r.porta}` : "";
        } else if (p.sh === null) {
          const r = await installClaudeGlobal(host);
          if (!r.ok) throw new Error(r.erro ?? "o instalador não respondeu");
          alvo = r.email ?? (r.porta !== null ? `porta ${r.porta}` : "");
        } else {
          const r = await runSsh(host, `${p.sh}\n`, p.timeoutMs);
          const erro = /^ERRO=(.*)$/m.exec(r.stdout)?.[1];
          if (erro !== undefined) throw new Error(erro);
          if (!p.ok.test(r.stdout)) throw new Error((r.stderr.trim() || r.stdout.trim()).split("\n").pop() || "sem resposta");
          alvo = p.alvo(r.stdout);
        }
        log(`[preparar] ${host}: ${p.titulo} ok${alvo !== "" ? ` (${alvo})` : ""}`);
        onLine?.(`✓ ${p.titulo}${alvo !== "" ? ` (${alvo})` : ""}`);
        void registrar(host, p.acao, alvo);
        if (!feitos.includes(p.id)) feitos.push(p.id);
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        log(`[preparar] ${host}: ${p.titulo} falhou: ${motivo}`);
        onLine?.(`✗ ${p.titulo}: ${motivo}`);
        falhas.push({ id: p.id, motivo });
      }
    }
    if (feitos.length > 0) void registrar(host, "maquina.preparar", feitos.join(", "));
    return { ...visaoDe(await estadoPreparar(host)), falhas };
  } finally {
    emAndamento.delete(host);
  }
}

/** Para "Criar usuário": aplica o que falta sem nunca lançar (a conta nova não pode nascer numa máquina sem preparo, mas também não pode deixar de nascer por isso). */
export async function prepararMaquinaSuave(host: string, onLine?: (line: string) => void): Promise<void> {
  try {
    const v = await estadoPreparar(host);
    const faltam = faltamAoCriarUsuario(v.faltam);
    if (faltam.length === 0) { onLine?.("máquina já preparada"); return; }
    onLine?.(`preparando a máquina antes: ${faltam.map((id) => TITULOS[id]).join(", ")}`);
    await aplicarPreparar(host, faltam, onLine);
  } catch (e) {
    log(`[preparar] ${host}: preparo suave não rodou: ${e instanceof Error ? e.message : String(e)}`);
  }
}
