// Regras do painel do admin que não dependem do DOM. O console.js importa, o teste também.

/** Idade a partir da qual a lista do admin é relida quando a aba volta a ficar visível. */
export const VISAO_VELHA_MS = 60_000;

/**
 * Uma ação do admin que volta 404 agiu sobre algo que a lista ainda mostra mas o servidor já não tem (a conta ou o
 * device foi removido depois da leitura): a lista está velha e precisa ser relida. Os outros erros não dizem isso.
 */
export function pedeReleitura(status) {
  return status === 404;
}

/**
 * O aviso depois de um 404 numa ação sobre a conta `contaId`. `contasRelidas` é a lista que a releitura trouxe
 * (objetos com `id`), ou `null` quando a releitura falhou e não se sabe o que existe.
 * O que decide "a conta foi removida" é ela ter saído da lista relida, não o texto do erro.
 */
export function avisoDepoisDo404(erro, contaId, contasRelidas) {
  if (contasRelidas === null) return `${erro}. Não deu para reler a lista; recarregue a página.`;
  const aindaExiste = contasRelidas.some((c) => c?.id === contaId);
  if (!aindaExiste) return "Esta conta não existe mais (foi removida depois que a lista foi lida). A lista foi atualizada.";
  return `${erro}. A lista foi atualizada.`;
}

/** A lista do admin lida em `lidaEm` (ms) está velha em `agora`? Sem leitura ainda (`null`), não há o que reler. */
export function visaoVelha(lidaEm, agora) {
  return lidaEm !== null && agora - lidaEm > VISAO_VELHA_MS;
}
