/** Aba a reaproveitar para o pedido "preparar o WhatsApp": a de antes, se ainda está aberta; null = abrir uma nova. */
export function abaDoPedido(anterior: string | null, aberta: (id: string) => boolean): string | null {
  return anterior !== null && aberta(anterior) ? anterior : null;
}

/**
 * Uma execução por vez: enquanto a de `fn` ainda roda, chamadas novas recebem a mesma promessa (clique duplo antes
 * de a aba existir não abre a segunda). `estado.p` é o lugar onde a promessa em curso fica; some quando termina.
 */
export function umaPorVez<T>(estado: { p: Promise<T> | null }, fn: () => Promise<T>): Promise<T> {
  if (estado.p !== null) return estado.p;
  const p = fn().finally(() => { if (estado.p === p) estado.p = null; });
  estado.p = p;
  return p;
}
