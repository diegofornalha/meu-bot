/**
 * Ficha de um módulo, a parte pura (testada): a situação que o selo mostra, o "há quanto tempo" e quando um passo dos
 * primeiros passos está feito. Sem DOM.
 */
import type { ModuloPasso, ModuloVista } from "../../shared/ipc";

/** O selo do cabeçalho e do cartão: desligado; ligado (com atualização ou não); e o último teste, quando houver. */
export function situacao(m: Pick<ModuloVista, "estado" | "desatualizado" | "teste" | "testar" | "versao">): { texto: string; classe: "" | "pill-on" | "pill-off" } {
  if (!m.estado.ligado) return { texto: "Desligado", classe: "" };
  if (m.desatualizado) return { texto: `Atualização disponível (${m.versao})`, classe: "pill-off" };
  if (m.testar === null) return { texto: "Ligado", classe: "pill-on" };
  if (m.teste === null) return { texto: "Ligado · não testado", classe: "" };
  return m.teste.ok ? { texto: "Conectado", classe: "pill-on" } : { texto: "Falhou no teste", classe: "pill-off" };
}

/** "agora há pouco", "há 5 min", "há 3 h", "há 2 dias". */
export function tempoDesde(iso: string, agora: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "em data desconhecida";
  const min = Math.floor(Math.max(0, agora - t) / 60_000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

/** Um passo está feito? Pelo estado do módulo nesta máquina, pelo último teste, ou pela marcação à mão. */
export function passoFeito(p: Pick<ModuloPasso, "id" | "conclui">, m: Pick<ModuloVista, "estado" | "credenciais" | "teste">, marcados: readonly string[]): boolean {
  if (p.conclui === "credenciais") return m.credenciais.every((c) => m.estado.preenchidas.includes(c.chave));
  if (p.conclui === "ligado") return m.estado.ligado;
  if (p.conclui === "testado") return m.estado.ligado && m.teste?.ok === true;
  if (p.conclui.startsWith("opcao:")) { const v = m.estado.opcoes[p.conclui.slice(6)]; return v !== undefined && v !== "" && v !== false; }
  return marcados.includes(p.id);
}
