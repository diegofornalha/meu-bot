/**
 * Leitura de uma planilha do Google Sheets com a Conta Google da máquina (escopo de planilhas; a planilha precisa estar
 * compartilhada com essa conta). Quem usa é a página de um módulo
 * (modulos.ts › planilhaParaModulo, sempre depois da confirmação da pessoa). Erros viram frases para a tela.
 */
import { planilhaLer } from "./apis";
import { contaStatus } from "./conta-google";

/** As células (até A1:Z5000) da aba pedida, ou da primeira. Lança com a frase do que fazer. */
export async function lerValoresPlanilha(host: string, id: string, aba: string): Promise<string[][]> {
  const st = contaStatus(host);
  if (!st.conectado) throw new Error("conecte a Conta Google desta máquina na aba Conta Google: é por ela que o app lê a planilha");
  let valores: string[][];
  try { valores = (await planilhaLer(host, id, aba ? `'${aba.replace(/'/g, "''")}'!A1:Z5000` : "A1:Z5000")).valores; }
  catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/permission|not have|403|404|not found|Requested entity/i.test(m)) throw new Error(`não consegui abrir a planilha: compartilhe-a com ${st.perfil?.email ?? "a conta Google conectada no app"} (leitura basta)${aba ? ` e confira o nome da aba "${aba}"` : ""}`);
    throw new Error(`não consegui ler a planilha: ${m}`);
  }
  if (valores.length === 0) throw new Error("a planilha está vazia");
  return valores;
}
