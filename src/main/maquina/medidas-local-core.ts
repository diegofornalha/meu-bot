/**
 * Memória e swap deste Mac a partir do que o macOS imprime, para o "Este Mac" mostrar na saúde o mesmo que uma
 * máquina por SSH mostra (hostProbe.probeLocal). Puro: recebe o texto dos comandos, devolve MB.
 */

/**
 * Memória disponível, em MB, a partir do `vm_stat`: páginas livres, inativas, especulativas e descartáveis. É a conta
 * que corresponde ao "available" do `free` no Linux; só as páginas livres (o `os.freemem()`) dariam um Mac sempre
 * "apertado", porque o macOS enche a memória de cache que devolve na hora.
 */
export function memDisponivelMb(vmStat: string): number | null {
  const pagina = /page size of (\d+) bytes/.exec(vmStat);
  if (pagina === null) return null;
  const paginas = (nome: string): number | null => { const m = new RegExp(`^Pages ${nome}:\\s+(\\d+)\\.?\\s*$`, "m").exec(vmStat); return m === null ? null : Number(m[1]); };
  const livres = paginas("free"), inativas = paginas("inactive");
  if (livres === null || inativas === null) return null;
  const total = livres + inativas + (paginas("speculative") ?? 0) + (paginas("purgeable") ?? 0);
  return Math.round((total * Number(pagina[1])) / 1_048_576);
}

/** Swap, em MB, a partir do `sysctl -n vm.swapusage` ("total = 2048,00M  used = 877,38M  free = 1170,62M"; vírgula ou ponto). */
export function swapMb(swapusage: string): { swapTotalMb: number | null; swapFreeMb: number | null } {
  const campo = (nome: string): number | null => {
    const m = new RegExp(`${nome} = (\\d+(?:[.,]\\d+)?)([KMG])`).exec(swapusage);
    if (m === null) return null;
    const n = Number(m[1]!.replace(",", "."));
    return Math.round(m[2] === "G" ? n * 1024 : m[2] === "K" ? n / 1024 : n);
  };
  const total = campo("total"), livre = campo("free");
  return total === null || livre === null ? { swapTotalMb: null, swapFreeMb: null } : { swapTotalMb: total, swapFreeMb: livre };
}
