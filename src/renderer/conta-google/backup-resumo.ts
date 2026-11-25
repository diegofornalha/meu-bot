/**
 * A linha de resumo da seção "Backup no Drive" e o motivo para ela abrir sozinha, puros (testados em
 * backup-resumo.test.mjs). A página Conta Google mostra o backup fechado em uma linha (25 nov); o detalhe abre no
 * clique, ou sozinho quando há algo que pede a pessoa.
 */

export interface ResumoBackupEntrada {
  /** O estado do backup já chegou do main. */
  lido: boolean;
  /** A leitura do estado falhou (a seção mostra o erro e "Tentar de novo"). */
  erroLeitura: boolean;
  ligado: boolean;
  /** A data da última cópia já formatada para a tela ("25/11, 14:30"), ou null se nunca houve. */
  ultimaEm: string | null;
  /** Cópia em curso (clique em "Guardar agora" ou a diária). */
  guardando: boolean;
  /** A última tentativa terminou em erro. */
  falhou: boolean;
}

/** "diário · última cópia em 25/11, 14:30", "diário · nenhuma cópia ainda", "desligado", "guardando…". */
export function resumoBackup(e: ResumoBackupEntrada): string {
  if (e.guardando) return "guardando…";
  if (!e.lido) return e.erroLeitura ? "não deu para ler o estado" : "carregando…";
  const partes = [e.ligado ? "diário" : "desligado"];
  if (e.ultimaEm !== null && e.ultimaEm !== "") partes.push(`última cópia em ${e.ultimaEm}`);
  else if (e.ligado) partes.push("nenhuma cópia ainda");
  if (e.falhou) partes.push("a última tentativa falhou");
  return partes.join(" · ");
}

export interface AtencaoBackupEntrada { erroLeitura: boolean; falhou: boolean; semSenha: boolean; guardando: boolean; restauro: boolean }

/** Os motivos pelos quais a seção abre sozinha, num texto estável ("" = nenhum): muda o texto, a seção reabre. */
export function atencaoBackup(e: AtencaoBackupEntrada): string {
  const m: string[] = [];
  if (e.erroLeitura) m.push("leitura");
  if (e.falhou) m.push("erro");
  if (e.semSenha) m.push("sem-senha");
  if (e.guardando) m.push("guardando");
  if (e.restauro) m.push("restauro");
  return m.join("+");
}
