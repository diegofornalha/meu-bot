/**
 * Cache por chave com validade e coalescência (puro, testável): a mesma leitura pedida por várias janelas ou várias
 * vezes por minuto vira uma só. No WhatsApp cada consulta à máquina sobe um `openclaw` (~300 MB na VM) e o app perguntava
 * o estado a cada 60 s por janela; agora quem pergunta dentro da validade recebe o que já veio, e quem pergunta durante
 * uma consulta em voo espera por ela. `force` pula a validade (botão Atualizar), mas ainda se junta a uma consulta em voo.
 * Uma leitura que falha não fica guardada: a próxima tenta de novo.
 */
export class TtlCache<T> {
  private readonly entradas = new Map<string, { em: number; valor: T }>();
  private readonly emVoo = new Map<string, Promise<T>>();
  constructor(private readonly agora: () => number = Date.now) {}

  get(chave: string, validadeMs: number, ler: () => Promise<T>, force = false): Promise<T> {
    const voo = this.emVoo.get(chave);
    if (voo !== undefined) return voo;
    const e = this.entradas.get(chave);
    if (!force && e !== undefined && this.agora() - e.em < validadeMs) return Promise.resolve(e.valor);
    const p = ler().then((valor) => { this.entradas.set(chave, { em: this.agora(), valor }); return valor; })
      .finally(() => { if (this.emVoo.get(chave) === p) this.emVoo.delete(chave); });
    this.emVoo.set(chave, p);
    return p;
  }
  /** O que está guardado para a chave, sem consultar (null = nada ou vencido). */
  vigente(chave: string, validadeMs: number): T | null {
    const e = this.entradas.get(chave);
    return e !== undefined && this.agora() - e.em < validadeMs ? e.valor : null;
  }
  /** Esquece a chave: a próxima leitura vai à máquina (uma consulta em voo continua e é o que a próxima recebe). */
  esquecer(chave: string): void { this.entradas.delete(chave); }
}
