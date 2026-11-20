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

// ---- Cortesias e encerramentos (cortesia-core.ts no servidor).

/** O selo do plano na lista do admin, pela origem do Pro (`origemDoPro` da visão); sem Pro, o plano gravado. */
export const ROTULO_ORIGEM_PRO = { pago: "Pro pago", cortesia: "Pro cortesia", teste: "Pro em teste", organizacao: "Pro pela organização", super: "Pro", admin: "Pro (ajuste do admin)" };
export function seloDoPlano(c) {
  const o = c.origemDoPro ?? null;
  if (o !== null && ROTULO_ORIGEM_PRO[o]) return { texto: ROTULO_ORIGEM_PRO[o], tom: o === "pago" || o === "super" ? "ok" : o === "cortesia" || o === "admin" ? "aviso" : "" };
  return { texto: c.licenca?.plan === "pro" ? "Pro" : "Free", tom: "" };
}
/** Situação de uma cortesia agora: valendo, venceu (o prazo passou) ou encerrada (pelo admin, antes do prazo). */
export function estadoCortesia(c, agoraMs = Date.now()) {
  if (c.encerradaEm) return "encerrada";
  return Date.parse(c.fim) > agoraMs ? "vale" : "venceu";
}
/**
 * O que a cortesia dá, em palavras: "Pro", o nome do add-on, "2 máquinas", "1 device", "3 usuários na <org>".
 * `rotuloProduto` e `nomeDaOrg` vêm do console (catálogo e organizações da visão).
 */
export function oQueACortesiaDa(c, rotuloProduto = (p) => p, nomeDaOrg = (id) => id) {
  const n = c.quantidade ?? 1, plural = (um, varios) => `${n} ${n === 1 ? um : varios}`;
  if (c.tipo === "pro") return "Pro";
  if (c.tipo === "addon") return rotuloProduto(c.produto);
  if (c.tipo === "maquina") return plural("máquina", "máquinas");
  if (c.tipo === "device") return plural("device", "devices");
  if (c.tipo === "assento") return `${plural("usuário", "usuários")} na ${nomeDaOrg(c.orgId)}`;
  return c.tipo;
}
/** As cortesias da ficha da conta: as que valem primeiro (a que acaba antes no topo), depois as dos últimos 90 dias. */
export function cortesiasDaFicha(cs, agoraMs = Date.now()) {
  const desde = agoraMs - 90 * 86400000;
  const vale = cs.filter((c) => estadoCortesia(c, agoraMs) === "vale").sort((a, b) => Date.parse(a.fim) - Date.parse(b.fim));
  const antigas = cs.filter((c) => estadoCortesia(c, agoraMs) !== "vale" && Date.parse(c.encerradaEm ?? c.fim) > desde).sort((a, b) => Date.parse(b.encerradaEm ?? b.fim) - Date.parse(a.encerradaEm ?? a.fim));
  return { vale, antigas };
}
/** Os motivos de encerramento (MOTIVOS_ENCERRAMENTO no servidor), com o texto da tela. */
export const MOTIVOS_ENCERRAR = [["reembolso", "Reembolso pedido pela pessoa"], ["disputa", "Disputa ou estorno"], ["pedido-da-pessoa", "A pessoa pediu para cancelar"], ["erro-ou-teste", "Erro ou compra de teste"], ["outro", "Outro (escreva)"]];
export const rotuloMotivo = (m) => MOTIVOS_ENCERRAR.find(([v]) => v === m)?.[1] ?? m;
/** O que foi encerrado, numa linha do histórico. */
export const ROTULO_ALVO = { pro: "Pro", addon: "Add-on", extra: "Unidade extra", cortesia: "Cortesia" };
/** A data "até" do formulário (AAAA-MM-DD) vira o fim do dia em UTC, como o "Vale até" do editor. */
export const fimDoDia = (dia) => (/^\d{4}-\d{2}-\d{2}$/.test(dia) ? `${dia}T23:59:59.000Z` : null);
/** O dia (AAAA-MM-DD) daqui a `dias` dias: o padrão do "até" de uma cortesia nova (30) e o limite (365). */
export const diaDaqui = (dias, agoraMs = Date.now()) => new Date(agoraMs + dias * 86400000).toISOString().slice(0, 10);
