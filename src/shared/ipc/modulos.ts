/**
 * Módulos de produto (o add-on fixo de um app, como o meu-bot-diego no meu-bot-diego-staging, e os add-ons com módulos
 * na licença da máquina): o repositório do produto, que o app baixa com git
 * (src/main/modulos/modulos-fonte-core.ts), traz um modulos.json; o meu-bot só conhece este contrato. Ver
 * src/main/modulos/modulos-core.ts.
 */

/** Uma credencial que a pessoa cola no app (vai para ~/.config/meu-bot/modulos/<id>.env, 0600; nunca volta ao app). */
export interface ModuloCredencial { chave: string; rotulo: string; ajuda: string }
/** Uma opção do módulo (vai para ~/.local/share/meu-bot/modulos/<id>/opcoes.json). */
export interface ModuloOpcao { chave: string; rotulo: string; tipo: "texto" | "numero" | "booleano"; padrao: string | number | boolean; ajuda: string }
export type ModuloGateway = "openclaw" | "hermes";

/** Um módulo do manifesto, já validado. */
export interface Modulo {
  id: string;
  rotulo: string;
  descricao: string;
  versao: string;
  /** Pasta do módulo no repositório do produto (relativa ao modulos.json). */
  pasta: string;
  /** Scripts dentro da pasta: o instalador recebe MODULO_ID, MODULO_DIR, MODULO_ENV e MODULO_OPCOES. */
  instalar: string;
  desinstalar: string;
  credenciais: ModuloCredencial[];
  opcoes: ModuloOpcao[];
  /** Só nestes gateways do WhatsApp (vazio = qualquer um). */
  gateways: ModuloGateway[];
  /** Avisos do que a máquina precisa ter (Chrome logado, ffmpeg…), mostrados no cartão. */
  requisitos: string[];
  /** A ficha (página Módulos): categoria, pedidos de exemplo, guia, script de teste e primeiros passos. */
  categoria: string;
  exemplos: string[];
  guia: ModuloGuia;
  /** Script de teste na pasta do módulo (`testar.sh`); null = o módulo não sabe se testar. */
  testar: string | null;
  passos: ModuloPasso[];
  /** Página própria do módulo (um serviço web dele na máquina, aberto num <webview> isolado); null = não tem. */
  pagina: ModuloPagina | null;
}

/** A página do módulo: o rótulo da aba, a porta do serviço na máquina (só 127.0.0.1) e o caminho de entrada. */
export interface ModuloPagina { rotulo: string; porta: number; caminho: string }
/** Para o <webview>: o endereço pelo forward local (com o token) e a partição que o main aceita. */
export interface ModuloPaginaAberta { url: string; particao: string }
/** O que o módulo respondeu sobre a planilha (a prévia ou o resultado), em texto puro. */
export interface ModuloPlanilhaResultado { mensagem: string; linhas: string[]; podeImportar: boolean }

/** O guia da ficha: para que serve, os cuidados, parágrafos a mais e o link do guia completo (só https). */
export interface ModuloGuia { paraQue: string; cuidados: string[]; texto: string[]; completo: string | null }
/**
 * Um passo dos primeiros passos. `conclui`: credenciais (todas preenchidas), ligado, testado (último teste ok),
 * opcao:<chave> (a opção tem valor) ou manual (a pessoa marca com o `botao`). `pergunta`: leva ao chat do agente.
 */
export interface ModuloPasso { id: string; titulo: string; texto: string; conclui: string; botao: string; pergunta: string }
export interface ModuloFerramenta { nome: string; descricao: string }
/** O último teste de conexão do módulo nesta máquina (guardado no Mac). */
export interface ModuloTeste { ok: boolean; em: string; ferramentas: ModuloFerramenta[]; erro: string | null }

/** O que a máquina diz de um módulo. */
export interface ModuloEstado {
  ligado: boolean;
  /** Versão instalada; null = nunca instalado. */
  versao: string | null;
  /** Chaves de credencial que já têm valor (só os nomes). */
  preenchidas: string[];
  opcoes: Record<string, string | number | boolean>;
}

export interface ModuloVista extends Modulo { estado: ModuloEstado; desatualizado: boolean; /** null = nunca testado nesta máquina. */ teste: ModuloTeste | null }

/** Os módulos de um produto (o app tem o fixo dele e os add-ons com módulos na licença da máquina: uma lista por produto). */
export interface ModulosLista {
  /** Nome do produto dono dos módulos (o add-on na licença). */
  produto: string;
  /** Rótulo do add-on no catálogo ("Módulos do Diego"). */
  rotulo: string;
  modulos: ModuloVista[];
  /** O add-on está liberado na licença desta máquina. */
  liberado: boolean;
  /** Gateway do WhatsApp da máquina; null = nenhum. */
  gateway: ModuloGateway | null;
  /** De onde vieram os módulos (o repositório baixado) e o estado da última tentativa. */
  fonte: FonteModulos;
  /** Não deu para ler a máquina (SSH caiu): a lista vem assim mesmo, sem ligar nem desligar. */
  erroMaquina: string | null;
  /** O que deu errado no manifesto deste produto (inválido, id repetido de outro produto); vazio = nada. */
  avisos: string[];
}

/** A última tentativa de baixar o repositório dos módulos (nunca, atualizado, em dia, ou o motivo de não ter dado). */
export type EstadoFonte = "nunca" | "atualizado" | "em-dia" | "sem-acesso" | "sem-rede" | "sem-git" | "erro";
/** O repositório de módulos baixado neste Mac, como a página mostra. */
export interface FonteModulos {
  /** "dono/nome" (nunca com usuário ou senha). */
  repositorio: string;
  url: string;
  estado: EstadoFonte;
  commit: string | null;
  atualizadoEm: string | null;
  /** Há uma cópia baixada desta mesma URL. */
  baixados: boolean;
  /** Os módulos baixados aparecem (sem acesso, nunca). */
  visiveis: boolean;
  /** "Módulos de dono/nome · commit abc1234 · atualizado há 5 min". */
  linha: string;
  /** O aviso do estado; "" quando não há o que avisar. */
  mensagem: string;
}

export interface ModuloResultado { ok: boolean; log: string[] }
