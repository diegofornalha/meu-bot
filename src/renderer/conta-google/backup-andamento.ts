/**
 * Andamento da cópia no Drive na página Conta Google, puro (testado em backup-andamento.test.mjs). O main manda um
 * `backup-dados:progress` por etapa de cada conjunto; aqui se guarda o mais novo de cada um e se monta a linha
 * "2 de 5 · CRM ✓ 1 KB · Agente enviando…". Antes o botão "Guardar agora" só ficava apagado por uns 40 s (1 nov).
 */
import type { BackupDadosProgresso } from "../../shared/ipc";

/** "1 KB" / "6,0 MB", como a lista da última cópia sempre mostrou. */
export function fmtBytes(bytes: number): string {
  const kb = bytes / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
}

/** Guarda o evento mais novo de cada conjunto, na ordem de chegada. O primeiro "enviando" começa uma cópia nova. */
export function aplicarProgresso(lista: readonly BackupDadosProgresso[], p: BackupDadosProgresso): BackupDadosProgresso[] {
  const base = p.indice === 1 && p.etapa === "enviando" ? [] : lista.filter((x) => x.conjunto !== p.conjunto);
  return [...base, p];
}

export function rotuloEtapa(p: BackupDadosProgresso): string {
  switch (p.etapa) {
    case "enviando": return "enviando…";
    case "enviado": return p.bytes !== null ? `✓ ${fmtBytes(p.bytes)}` : "✓";
    case "pulado": return p.detalhe !== null ? `pulado (${p.detalhe})` : "pulado";
    case "ausente": return "não há nesta máquina";
    case "erro": return "✗ erro";
  }
}

/** A linha do andamento; vazia enquanto nenhuma etapa chegou (a sessão do Drive ainda está abrindo). */
export function textoAndamento(lista: readonly BackupDadosProgresso[]): string {
  const u = lista[lista.length - 1];
  if (u === undefined) return "";
  return `${u.indice} de ${u.total} · ${lista.map((p) => `${p.nome} ${rotuloEtapa(p)}`).join(" · ")}`;
}

/** O último conjunto já saiu do "enviando": a cópia acabou e a tela pode reler o estado gravado. */
export function terminou(lista: readonly BackupDadosProgresso[]): boolean {
  const u = lista[lista.length - 1];
  return u !== undefined && u.indice === u.total && u.etapa !== "enviando";
}
