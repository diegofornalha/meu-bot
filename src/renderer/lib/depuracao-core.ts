/** Faixa de depuração: o que é texto e regra fica aqui, sem DOM, com teste. */
export interface EstadoBatimento { ok: boolean; segundos: number }
/** O main manda um tique por segundo; mais de `limiarMs` sem tique = fio principal preso (Chaveiro, ssh síncrono). */
export function estadoBatimento(ultimoEm: number | null, agora: number, limiarMs = 3000): EstadoBatimento {
  if (ultimoEm === null) return { ok: false, segundos: 0 };
  const d = Math.max(0, agora - ultimoEm);
  return { ok: d < limiarMs, segundos: Math.floor(d / 1000) };
}
/** "v0.4.0 · navegador-recarrega-aba-ao-fechar · 18fb6f9"; sem build.json, só a versão; em dev, "dev". */
export function rotuloBuild(version: string, c: { commit: string; branch: string } | null): string {
  const v = version !== "" ? `v${version}` : "v?";
  if (c === null) return v;
  if (c.branch === "dev" && c.commit === "dev") return `${v} · dev`;
  return [v, c.branch, c.commit].filter((x) => x !== "").join(" · ");
}
export function rotuloReversos(nav: number | null, gmail: number | null): string {
  const p: string[] = [];
  if (nav !== null) p.push(`nav :${nav}`);
  if (gmail !== null) p.push(`gmail :${gmail}`);
  return p.join(" · ");
}
/** Estado do túnel na faixa; fora do "ativo", o `detail` do backend:status vai junto (o motivo: backend parado, SSH, timeout). */
export function rotuloTunel(state: string | null, detail = ""): string {
  const motivo = detail.trim() === "" ? "" : `: ${detail.trim().slice(0, 70)}`;
  switch (state) {
    case "ready": return "túnel ativo";
    case "connecting": return motivo === "" ? "túnel conectando…" : `túnel conectando${motivo}`;
    case "degraded": return `túnel instável${motivo}`;
    case "error": return `túnel: erro${motivo}`;
    case "idle": return "túnel parado";
    default: return "túnel: ?";
  }
}
export function textoSaude(b: EstadoBatimento, marca: string | null): string {
  if (b.ok) return "main ok";
  return `main sem responder há ${b.segundos} s${marca !== null && marca !== "" ? ` · última marca: ${marca}` : ""}`;
}
/** Uma linha do fluxo: "15:40:02 navegador (agente) /fechar: fechou aba 5 → recarregou [4]". */
export function linhaEvento(e: { em: number; origem: string; dono: string | null; rota: string; ok: boolean; resumo: string }, hora: (em: number) => string): string {
  return `${hora(e.em)} ${e.origem}${e.dono !== null ? ` (${e.dono})` : ""} ${e.rota}${e.ok ? "" : " ✗"}: ${e.resumo}`;
}
