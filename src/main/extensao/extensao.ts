/**
 * Página própria de um app derivado, lado do processo principal: carrega o código que o empacotamento compilou para
 * dentro do asar (dist/main/derivado/index.js, de scripts/derivado-codigo.mjs), entrega a ele a API estreita do
 * contrato (src/shared/ipc/derivado.ts) e o encerra ao sair. Só quando a ficha do app tem `extensao`: nos apps da
 * tabela nada aqui roda. A parte pura (registro, despacho, regras) está em extensao-core.ts.
 *
 * O app nunca cai por causa da extensão: código que falta, que lança ao carregar ou ao ativar fica no log, e o app
 * abre sem a página (o `ext:invoke` passa a recusar dizendo que a extensão não carregou).
 */
import { app } from "electron";
import path from "node:path";
import type { ExtensaoMain, ExtensaoMainApi } from "../../shared/ipc";
import { caps } from "../app/variant";
import { garantirControleRemoto } from "../controle-remoto/garantir";
import { log } from "../maquina/backend";
import { findNode } from "../maquina/localBackend";
import { ativarDoModulo, criarRegistro, encerrarDoRetorno } from "./extensao-core";
import { definirEstadoDaExtensao } from "./registro";

/** Onde o empacotamento deixa o compilado do derivado: ao lado desta pasta, em dist/main/derivado (dentro do asar). */
const MODULO = path.join(__dirname, "..", "derivado", "index.js");

let ativa: ExtensaoMain | null = null;
const motivo = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Na abertura do app, antes das janelas: ativa a extensão se a ficha tem uma. Não lança. */
export function ativarExtensao(): void {
  if (caps().extensao === null || ativa !== null) return;
  const registro = criarRegistro();
  // O que o `ativar` devolveu, guardado fora do try: se algo falhar depois dele, é por aqui que se para o que ele iniciou.
  let devolvido: unknown;
  try {
    const api: ExtensaoMainApi = {
      pastaDados: path.join(app.getPath("userData"), "extensao"),
      log: (linha) => { log(String(linha)); },
      acharNode: () => findNode(),
      controleRemoto: { garantir: () => garantirControleRemoto() },
      canal: (nome, handler) => { registro.canal(nome, handler); },
      webview: (w) => { registro.webview(w); },
    };
    // `require` de um caminho calculado: o arquivo só existe no pacote de um derivado com código, nunca em src/.
    const modulo: unknown = require(MODULO);
    const ativar = ativarDoModulo(modulo);
    if (ativar === null) throw new Error("o código do derivado não exporta a função ativar");
    const r = ativar(api);
    devolvido = r;
    registro.fechar();
    const encerrar = encerrarDoRetorno(r);
    if (encerrar === null) throw new Error("o ativar não devolveu { encerrar }");
    ativa = { encerrar };
    definirEstadoDaExtensao({ kind: "ativa", registro });
    const wv = registro.webviewDeclarado();
    log(`[extensão] ativa: canais ${registro.nomes().join(", ") || "(nenhum)"}${wv === null ? "" : `; <webview> na partição ${wv.particao}`}`);
  } catch (e) {
    registro.fechar();
    // O `ativar` pode já ter subido um processo ou um timer antes de a ativação falhar: se devolveu um `encerrar`, ele
    // roda agora, para nada ficar de pé sem dono. Sem `encerrar` devolvido não há o que chamar; por isso o contrato
    // diz que o `ativar` não inicia nada que o `encerrar` devolvido não pare (docs/guia/derivados.md).
    const encerrar = encerrarDoRetorno(devolvido);
    if (encerrar !== null) { try { encerrar(); } catch (err) { log(`[extensão] o encerrar depois da falha também falhou: ${motivo(err)}`); } }
    definirEstadoDaExtensao({ kind: "falhou" });
    log(`[extensão] não carregou, o app segue sem a página: ${motivo(e)}${app.isPackaged ? "" : " (em dev, compile o código do derivado depois do build: node scripts/derivado-codigo.mjs <pasta>)"}`);
  }
}

/** Ao sair do app, no mesmo ponto em que o Inspector é parado. Não lança: a saída do app não espera a extensão. */
export function encerrarExtensao(): void {
  if (ativa === null) return;
  const e = ativa; ativa = null;
  try { e.encerrar(); } catch (err) { log(`[extensão] o encerrar falhou: ${motivo(err)}`); }
}
