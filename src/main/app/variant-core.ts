/**
 * Qual produto é este app (meu-bot, meu-bot-admin e os staging) e o que cada um pode fazer. Puro: testável com
 * node --test. Ler o variant.json e o ambiente é tarefa do variant.ts; aqui só a decisão e a tabela.
 *
 * PRODUTOS é a fonte dos apps do core: o runtime (caps, título, userData) e os scripts de empacotamento
 * (scripts/produtos.mjs lê dist/main/app/variant-core.js) saem daqui. Um app derivado (meu-bot-vendas,
 * meu-bot-imobiliaria…) NÃO entra aqui: a ficha dele vem do repositório dele (`parseFichaExterna`, abaixo).
 *
 * Canais (modelo VS Code / Insiders): o meu-bot tem cópias staging lado a lado, com nome, ícone,
 * dados e porta próprios, que recebe o que está em teste; a linha staging sai da estável (`staging()`), não é
 * escrita à mão. O meu-bot-admin é só estável.
 */
import type { AppVariant, Canal, Capabilities, PlanName } from "../../shared/ipc";

export type { AppVariant, Canal, Capabilities };

export interface Produto {
  variant: AppVariant;
  /** Nome do app: bundle (`<nome>.app`), título da janela, pasta de userData, asset da atualização. */
  nome: string;
  bundleId: string;
  /** Ícone .icns (o .svg de origem fica ao lado, mesmo nome). */
  icone: string;
  /** Pasta própria em ~/Library/Application Support; null = a padrão do Electron (productName "meu-bot"). */
  userData: string | null;
  /** Extensões embutidas (meu-bot CRM no Gmail, Autenticador): pastas de saída do build (relativas a build/ em dev, Resources/ empacotado). */
  extensoes: readonly string[];
  canal: Canal;
  /** Produto contratado que a licença libera (no staging, o do estável): vira `caps.produto`. */
  licenca: string;
  /** Pasta de dados de onde a primeira abertura copia (uma vez só); null = começa vazio. */
  herdaDe: string | null;
  /** Porta do backend local deste Mac (host "local"): apps abertos juntos não podem dividir. */
  portaLocal: number;
  /**
   * Porta do sshd da distro WSL do "Este Windows" (maquina/wsl-core.ts), em 127.0.0.1 do Windows: uma por produto, como a
   * `portaLocal`, porque cada app prepara a sua distro e dois apps abertos juntos não podem dividir.
   */
  portaWsl: number;
  /** Porta padrão do controle remoto (MCP) em 127.0.0.1; uma por app, fora da 7822 do Rambox. A pessoa pode trocar. */
  portaMcp: number;
  /** Pasta de dados de um app antecessor que a primeira abertura funde (união, sem apagar a origem); null = nenhum. */
  fundeDe: string | null;
  /** O que é este app, em uma frase (janela Produtos do admin). */
  descricao: string;
  /** Add-on (de ADDONS) que é a razão deste app: a entrada dele fica sempre à vista, mesmo antes da licença. null = nenhum. */
  addon: string | null;
  /** A release publica também o instalador .dmg deste app (scripts/dmg.mjs) e o site entrega ele: só o app das pessoas. */
  instalador: boolean;
  /** Sai também para Windows (x64, cliente remoto): tem ícone .ico ao lado do .icns e `--plataforma win32` empacota. */
  windows: boolean;
  /** Página que fica na frente quando a janela abre (de PAGINAS_INICIAIS); null = as abas de conversa, como sempre. */
  abreEm: PaginaInicial | null;
  caps: Omit<Capabilities, "variant" | "produto" | "canal" | "nome" | "titulo" | "addon" | "abreEm" | "addons" | CapDePlataforma>;
}
/**
 * Capacidades que saem da plataforma por cima das do produto (capsFor): o que hoje só existe no macOS (backend local,
 * sockets unix, AppleScript). No Windows o app é só cliente de uma máquina remota por SSH e nenhuma delas é oferecida.
 */
export const CAPS_DE_PLATAFORMA = ["hostLocal", "terminalLocal", "atalhosMesa", "agenteNavegador", "controleRemoto", "telaComputador", "semaforoNaBarra", "teclaCmd"] as const;
/**
 * O inverso: o que só existe no Windows. `hostWsl` = o "Este Windows" do seletor, a máquina Linux (WSL) que o app
 * prepara no próprio PC e alcança por SSH em 127.0.0.1 (maquina/wsl.ts). Só nos apps que instalam o backend.
 */
export const CAPS_SO_WINDOWS = ["hostWsl"] as const;
export type CapDePlataforma = (typeof CAPS_DE_PLATAFORMA)[number] | (typeof CAPS_SO_WINDOWS)[number];

/**
 * Módulos pagos à parte (add-ons): acumulativos por cima do plano, com ou sem o Pro, liberados por máquina na licença
 * (`licenca.produtos`). Única lista do app: licença, admin (rótulo, candidatos a incluir) e nomes reservados saem daqui.
 * O backend da máquina tem a cópia dele em backend-colima/licenca.js; o teste produtos-alinhados confere as duas.
 */
/**
 * `modulos`: o add-on chega como módulos baixados do repositório dele (`github.com/diegofornalha/<nome>`, modulos-fonte-core.ts):
 * com ele na licença da máquina, a página Módulos aparece em qualquer app de cliente, com os módulos dele. É o whitelabel:
 * quem decide o que a pessoa vê é a licença, não o app. Liga-se quando o repositório existe e foi testado.
 */
export interface Addon {
  nome: string; rotulo: string; descricao: string; modulos: boolean;
  /**
   * `semLicenca`: os módulos dele não pedem o add-on na licença; a trava é o acesso git ao repositório privado (quem não
   * tem acesso nem baixa os módulos). Vale para o produto próprio de alguém (meu-bot-diego); add-on pago, de repositório
   * público, continua na licença. A cópia no backend é `MODULOS_SEM_LICENCA` (backend-colima/licenca.js).
   */
  semLicenca: boolean;
}
export const ADDONS: readonly Addon[] = [
  { nome: "meu-bot-finance", rotulo: "Finanças", descricao: "O agente vira o financeiro da pessoa no WhatsApp e no chat; página Finanças e Curva ABC. É o módulo Finanças (página Módulos).", modulos: true, semLicenca: false },
  { nome: "meu-bot-diego", rotulo: "Módulos do Diego", descricao: "Os módulos do produto meu-bot-diego (Salvy, Sendfy…), baixados do repositório dele e ligados um a um na página Módulos, cada um com o seu tutorial.", modulos: false, semLicenca: true },
  { nome: "meu-bot-grok", rotulo: "Grok (xAI)", descricao: "O Grok da xAI como mais um modelo do agente, com o login da conta xAI da pessoa e sem chave de API; pode servir de reserva quando o Claude falha. É o módulo Grok (xAI) (página Módulos).", modulos: true, semLicenca: false },
];
/** Nomes na licença que não são add-on: o admin, e o meu-bot-crm (o CRM entrou no Pro em 22 out). */
export const NAO_ADDON: readonly string[] = ["meu-bot-admin", "meu-bot-crm"];
/** O plano "personalizado" (removido em 22 out) liberava o Pro e estes add-ons; quem o tinha vira Pro com eles. */
export const ADDONS_DO_PERSONALIZADO: readonly string[] = ["meu-bot-finance"];
/** Páginas que um produto pode pôr na frente ao abrir (Produto.abreEm); o renderer sabe abrir cada uma. */
export const PAGINAS_INICIAIS = ["inspector", "modulos"] as const;
export type PaginaInicial = (typeof PAGINAS_INICIAIS)[number];

const PESSOA: Produto["caps"] = {
  chat: true, pair: true, login: true, manageWa: true, tunnel: true, install: true, supportClient: true, supportAdmin: false,
  navegador: true, planoExigido: "free", usuariosMac: false, inspector: false, modulos: null,
};
const ADMIN: Produto["caps"] = {
  chat: false, pair: false, login: false, manageWa: false, tunnel: false, install: false, supportClient: false, supportAdmin: true,
  navegador: false, planoExigido: "free", usuariosMac: false, inspector: false, modulos: null,
};

// meu-bot: o app da pessoa. Traz as duas extensões; o CRM próprio no Gmail abre pela licença da máquina (Pro ou superior,
// ou o produto meu-bot-crm contratado), nunca por variante. Funde a pasta do antigo meu-bot-crm na primeira abertura.
const CLIENT: Produto = { variant: "client", nome: "meu-bot", bundleId: "local.meu-bot", icone: "assets/icon.icns", userData: null, extensoes: ["extensao-crm", "extensao-autenticador"], canal: "estavel", licenca: "meu-bot", herdaDe: null, portaLocal: 8790, portaWsl: 2290, portaMcp: 7830, fundeDe: "meu-bot-crm", addon: null, instalador: true, windows: false, abreEm: null, caps: PESSOA,
  descricao: "O app da pessoa: chat e WhatsApp no plano Free; Navegador e CRM próprio no Pro; add-ons por cima, com ou sem o Pro." };

/** A cópia staging de um app estável: "<nome>-staging", ícone com a faixa, dados próprios herdados dele, porta própria. */
function staging(base: Produto, variant: AppVariant, portaLocal: number, portaWsl: number, portaMcp: number): Produto {
  const nome = `${base.nome}-staging`;
  return { ...base, descricao: `Canal de teste do ${base.nome}, ao lado do estável (como o VS Code Insiders): recebe o que está em teste; a licença é a do estável.`, variant, nome, bundleId: `${base.bundleId}.staging`, icone: base.icone.replace(/\.icns$/, "-staging.icns"), userData: nome, canal: "staging", herdaDe: base.nome, portaLocal, portaWsl, portaMcp, fundeDe: base.fundeDe === null ? null : `${base.fundeDe}-staging` };
}

export const PRODUTOS: readonly Produto[] = [
  CLIENT,
  // Até 4 nov chamava-se meu-bot-admin: a pasta de dados antiga é trazida na primeira abertura (admin/user-data.ts). A licença
  // continua "meu-bot-admin" (é o nome contratado, não o do app).
  { variant: "admin", nome: "meu-bot-admin-gestao", bundleId: "local.meu-bot-admin-gestao", icone: "assets/icon-admin.icns", userData: "meu-bot-admin-gestao", extensoes: [], canal: "estavel", licenca: "meu-bot-admin", herdaDe: null, portaLocal: 8790, portaWsl: 2292, portaMcp: 7833, fundeDe: null, addon: null, instalador: false, windows: false, abreEm: null, caps: ADMIN,
    descricao: "Este app: suporte, licenças, espelho das máquinas, auditoria e o registro de produtos (MVPs)." },
  // O primeiro a sair para Windows: só no canal de teste, até o instalador ter assinatura Authenticode.
  { ...staging(CLIENT, "client-staging", 8791, 2291, 7831), windows: true },
  // meu-bot-admin-mac: só as contas deste Mac (quem abre o meu-bot aqui; o bot de cada um roda numa VM, assunto do
  // meu-bot-admin). Sem seletor, sem chat; cria contas administrador com o meu-bot na mesa, muda o apelido e apaga.
  { variant: "admin-mac", nome: "meu-bot-admin-mac", bundleId: "local.meu-bot-admin-mac", icone: "assets/icon-admin-mac.icns", userData: "meu-bot-admin-mac", extensoes: [], canal: "estavel", licenca: "meu-bot-admin", herdaDe: null, portaLocal: 8790, portaWsl: 2295, portaMcp: 7834, fundeDe: null, addon: null, instalador: false, windows: false, abreEm: null, caps: { ...ADMIN, supportAdmin: false, usuariosMac: true },
    descricao: "As contas deste Mac: cria (administrador, senha mostrada uma vez, meu-bot na mesa), muda o apelido e apaga. O bot de cada pessoa roda numa VM." },
  // meu-bot-inspector-staging: o meu-bot em teste com o MCP Inspector na frente (abre na página Inspector, que sobe a
  // interface oficial do @modelcontextprotocol/inspector já ligada ao controle externo deste app). Nome, ícone, dados e portas próprios; nasce como cópia dos dados do meu-bot-staging. Só staging.
  { ...staging(CLIENT, "inspector-staging", 8793, 2293, 7835), nome: "meu-bot-inspector-staging", bundleId: "local.meu-bot-inspector.staging", icone: "assets/icon-inspector-staging.icns", userData: "meu-bot-inspector-staging", herdaDe: "meu-bot-staging", fundeDe: null, addon: null, instalador: false, abreEm: "inspector", caps: { ...PESSOA, inspector: true },
    descricao: "O meu-bot em teste com o MCP Inspector na frente (abre na página Inspector): a interface oficial do Inspector ligada ao controle externo (MCP) do próprio app." },
  // meu-bot-diego-staging: o meu-bot em teste com a página Módulos na frente. O app não leva módulo nenhum: baixa-os
  // com git do repositório do produto (diegofornalha/meu-bot-diego, src/main/modulos/modulos-fonte-core.ts) e cada
  // módulo traz o MCP, as regras e o tutorial dele. Liberado pelo add-on meu-bot-diego na licença. Fica fora da release
  // automática (release-core.mjs, `caps.modulos`): empacota-se à mão (docs/guia/meu-bot-diego.md).
  { ...staging(CLIENT, "diego-staging", 8794, 2294, 7836), nome: "meu-bot-diego-staging", bundleId: "local.meu-bot-diego.staging", icone: "assets/icon-diego-staging.icns", userData: "meu-bot-diego-staging", herdaDe: "meu-bot-staging", fundeDe: null, addon: "meu-bot-diego", instalador: false, abreEm: "modulos", caps: { ...PESSOA, modulos: "meu-bot-diego" },
    descricao: "O meu-bot em teste com os módulos do Diego na frente (abre na página Módulos): os módulos vêm do repositório meu-bot-diego, baixados pelo app, com MCP e tutorial." },
];

/**
 * Nomes que um MVP novo não pode usar: os apps da tabela (e o que eles herdam ou fundem), os nomes de licença e os
 * add-ons. Derivado, para um produto novo na tabela já entrar aqui sozinho.
 */
export function nomesReservados(): Set<string> {
  const r = new Set<string>([...ADDONS.map((a) => a.nome), ...NAO_ADDON]);
  for (const p of PRODUTOS) for (const n of [p.nome, p.licenca, p.herdaDe, p.fundeDe]) if (n !== null) r.add(n);
  return r;
}

/**
 * Esquema de URL (deep link) de um produto: `meu-bot://`, `meu-bot-staging://`… É o próprio nome do app, que já é
 * único e válido como scheme (RFC 3986: letra, depois letras, dígitos e hífen). Um por variante, para o staging não
 * roubar o retorno do login do estável. Entra no Info.plist (CFBundleURLTypes, scripts/package.mjs) e no
 * `setAsDefaultProtocolClient` (src/main/conta/deep-link.ts).
 */
export const ESQUEMA_RE = /^[a-z][a-z0-9-]*$/;
export const esquemaDe = (p: Produto): string => p.nome;

/**
 * Apps derivados: um derivado é um meu-bot com nome, ícone, dados e portas próprios, cuja FICHA mora no repositório
 * dele (`produto.json`), não nesta tabela. O empacotamento (`--produto <pasta>`, scripts/produtos.mjs) valida a ficha e
 * a embute DENTRO do asar (dist/main/app/produto-embutido.json, FICHA_EMBUTIDA): a integridade do asar a cobre, e
 * ninguém troca as capacidades do app editando um arquivo solto em Resources/. Ao abrir, o app a registra aqui
 * (variant.ts) e passa a ser a variante "derivado". Assim um derivado novo não acrescenta linha nenhuma ao core
 * (docs/guia/derivados.md).
 *
 * As duas linhas da tabela com `herdaDe: "meu-bot-staging"` (inspector e diego) são os derivados antigos, de saída
 * para os repositórios deles; enquanto não saem, uma ficha externa pode repetir o nome e o bundle id delas.
 */
const ehDerivadoDaTabela = (p: Produto): boolean => p.herdaDe === "meu-bot-staging";
/** Os apps do core: a tabela sem os derivados antigos. */
export const produtosDoCore = (): readonly Produto[] => PRODUTOS.filter((p) => !ehDerivadoDaTabela(p));

/** Campos que a ficha de um derivado aceita; qualquer outro é erro (um nome trocado não pode passar calado). */
const CAMPOS_DA_FICHA = ["nome", "bundleId", "canal", "portaLocal", "portaWsl", "portaMcp", "herdaDe", "abreEm", "modulos", "inspector", "addon", "descricao"] as const;
/**
 * O nome é também a pasta de dados, o esquema do deep link e o nome do app no servidor de contas, que só aceita
 * `meu-bot` mais até 6 pedaços de letras e dígitos, com no máximo 30 caracteres depois de "meu-bot-"
 * (ESQUEMA_RE e APP_RE em conta-api/src/sessao-core.ts): fora disso o login da conta falharia.
 */
const NOME_DERIVADO_RE = /^meu-bot(?:-[a-z0-9]+){1,6}$/;
const NOME_DERIVADO_MAX = "meu-bot-".length + 30;
const BUNDLE_RE = /^[a-z0-9]+(\.[a-z0-9-]+){1,5}$/;
const PRODUTO_MODULOS_RE = /^meu-bot-[a-z0-9-]{1,30}$/;
const ehPorta = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1024 && v <= 65535;
export type FichaExterna = { ok: true; produto: Produto } | { ok: false; erro: string };
/**
 * A ficha de um derivado (o `produto.json` do repositório dele) vira um Produto, ou o motivo da recusa. Um derivado é
 * sempre um app da pessoa (as capacidades do meu-bot): a ficha escolhe o nome, o bundle id, o canal, as portas, de
 * quem herda os dados na primeira abertura, a página que abre na frente e o produto de módulos fixo. O resto vem do
 * meu-bot (extensões, licença "meu-bot") e não é da ficha. Não pode repetir nome, bundle id nem porta de um app do core.
 */
export function parseFichaExterna(raw: unknown): FichaExterna {
  const nao = (erro: string): FichaExterna => ({ ok: false, erro });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return nao("a ficha tem de ser um objeto");
  const o = raw as Record<string, unknown>;
  const estranho = Object.keys(o).find((k) => !(CAMPOS_DA_FICHA as readonly string[]).includes(k));
  if (estranho !== undefined) return nao(`campo desconhecido "${estranho}" (aceitos: ${CAMPOS_DA_FICHA.join(", ")})`);
  const core = produtosDoCore();
  const { nome, bundleId, canal, portaLocal, portaWsl, portaMcp } = o;
  if (typeof nome !== "string" || !NOME_DERIVADO_RE.test(nome) || nome.length > NOME_DERIVADO_MAX) return nao("nome: use meu-bot-<nome>, só minúsculas, dígitos e hífen (até 6 pedaços e 30 caracteres depois de meu-bot-)");
  const reservados = new Set<string>([...ADDONS.map((a) => a.nome), ...NAO_ADDON]);
  for (const p of core) for (const n of [p.nome, p.licenca, p.fundeDe]) if (n !== null) reservados.add(n);
  if (reservados.has(nome)) return nao(`nome: "${nome}" já é de um app do core, de uma licença ou de um add-on`);
  if (typeof bundleId !== "string" || !BUNDLE_RE.test(bundleId)) return nao("bundleId: use o formato local.meu-bot-<nome>");
  if (core.some((p) => p.bundleId === bundleId)) return nao(`bundleId: "${bundleId}" já é de um app do core`);
  // Só o canal de teste por enquanto: a promoção para estável (24 h, prova de saúde) é uma esteira do core.
  if (canal !== "staging") return nao('canal: por enquanto só "staging"');
  for (const [campo, v] of [["portaLocal", portaLocal], ["portaWsl", portaWsl], ["portaMcp", portaMcp]] as const) {
    if (!ehPorta(v)) return nao(`${campo}: um número inteiro de 1024 a 65535`);
    if (core.some((p) => p[campo] === v)) return nao(`${campo}: ${v} já é de um app do core (dois apps abertos juntos não podem dividir a porta)`);
  }
  const herdaDe = o.herdaDe ?? null;
  // Só de um app da pessoa do core: é de lá que vêm as configurações que um derivado sabe ler.
  if (herdaDe !== null && !core.some((p) => p.nome === herdaDe && p.caps.chat)) return nao(`herdaDe: null ou um destes: ${core.filter((p) => p.caps.chat).map((p) => p.nome).join(", ")}`);
  const abreEm = o.abreEm ?? null;
  if (abreEm !== null && !(PAGINAS_INICIAIS as readonly unknown[]).includes(abreEm)) return nao(`abreEm: null ou uma destas: ${PAGINAS_INICIAIS.join(", ")}`);
  const modulos = o.modulos ?? null;
  if (modulos !== null && (typeof modulos !== "string" || !PRODUTO_MODULOS_RE.test(modulos))) return nao("modulos: null ou o nome do produto de módulos (meu-bot-<nome>)");
  const inspector = o.inspector ?? false;
  if (typeof inspector !== "boolean") return nao("inspector: true ou false");
  const addon = o.addon ?? null;
  if (addon !== null && !ADDONS.some((a) => a.nome === addon)) return nao(`addon: null ou um destes: ${ADDONS.map((a) => a.nome).join(", ")}`);
  const descricao = o.descricao ?? "";
  if (typeof descricao !== "string" || descricao.length > 300) return nao("descricao: um texto de até 300 caracteres");
  return { ok: true, produto: {
    ...CLIENT, variant: "derivado", nome, bundleId, icone: "assets/icon.icns", userData: nome, canal, herdaDe: herdaDe as string | null, portaLocal: portaLocal as number, portaWsl: portaWsl as number, portaMcp: portaMcp as number,
    fundeDe: null, descricao, addon: addon as string | null, instalador: false, windows: false, abreEm: abreEm as PaginaInicial | null, caps: { ...PESSOA, inspector, modulos: modulos as string | null },
  } };
}
/** Nome do arquivo da ficha embutida, ao lado do variant-core.js compilado (dentro do asar). */
export const FICHA_EMBUTIDA = "produto-embutido.json";
/** O derivado deste processo: a ficha embutida no pacote, registrada uma vez ao abrir (variant.ts). null = app da tabela. */
let derivado: Produto | null = null;
export function registrarDerivado(p: Produto | null): void { derivado = p; }
/**
 * A ficha embutida no pacote (o conteúdo de FICHA_EMBUTIDA), já validada; null quando o pacote é de um app da tabela
 * (não há arquivo) ou a ficha não passa. O empacotamento recusa ficha inválida, então null com arquivo presente é
 * pacote estragado: o app abre como meu-bot, a regra de sempre para o que não reconhece.
 */
export function fichaEmbutida(conteudo: unknown): Produto | null {
  if (conteudo === undefined || conteudo === null) return null;
  const r = parseFichaExterna(conteudo);
  return r.ok ? r.produto : null;
}

export function produtoDe(v: AppVariant): Produto {
  if (v === "derivado") { if (derivado === null) throw new Error("produto desconhecido: derivado sem ficha registrada"); return derivado; }
  const p = PRODUTOS.find((x) => x.variant === v);
  if (p === undefined) throw new Error(`produto desconhecido: ${v}`);
  return p;
}
const isVariant = (v: unknown): v is AppVariant => typeof v === "string" && PRODUTOS.some((p) => p.variant === v);

export interface VariantInput {
  /** app.isPackaged: empacotado lê o variant.json; em dev vale a variável de ambiente. */
  packaged: boolean;
  /** MEU_BOT_VARIANT (só em dev). */
  env: string | undefined;
  /** Conteúdo do Resources/variant.json já parseado (undefined/null = sem arquivo ou inválido). */
  variantJson: unknown;
}

export function resolveVariant(i: VariantInput): AppVariant {
  if (!i.packaged) return isVariant(i.env) ? i.env : "client";
  const v = i.variantJson !== null && typeof i.variantJson === "object" ? (i.variantJson as { variant?: unknown }).variant : undefined;
  return isVariant(v) ? v : "client";
}

/** Nome do app; no staging com a versão junto ("meu-bot-staging 0.2.0-staging.3"): a janela diz qual build está aberto. */
export const titleFor = (v: AppVariant, versao?: string): string => { const p = produtoDe(v); return p.canal === "staging" && versao !== undefined && versao !== "" ? `${p.nome} ${versao}` : p.nome; };
export const userDataNameFor = (v: AppVariant): string | null => produtoDe(v).userData;

/**
 * O admin só lê e faz as ações de suporte; os outros produtos fazem tudo o mais (ver a tabela). As de CAPS_DE_PLATAFORMA
 * saem daqui: fora do Windows valem onde o produto já permitia (o agente no Navegador pede `navegador`, o Computador
 * pede `chat`; as outras quatro são de todos os apps, como os canais IPC comuns delas); no Windows, nenhuma. As de
 * CAPS_SO_WINDOWS ao contrário: só no Windows, onde o produto instala o backend (`install`).
 */
export function capsFor(variant: AppVariant, versao?: string, plataforma: NodeJS.Platform = "darwin"): Capabilities {
  const p = produtoDe(variant);
  const tem = plataforma !== "win32";
  return { variant, produto: p.licenca, canal: p.canal, nome: p.nome, titulo: titleFor(variant, versao), addon: p.addon, abreEm: p.abreEm, addons: ADDONS.map((a) => ({ nome: a.nome, rotulo: a.rotulo, modulos: a.modulos, semLicenca: a.semLicenca })), ...p.caps,
    hostLocal: tem, terminalLocal: tem, atalhosMesa: tem, agenteNavegador: tem && p.caps.navegador, controleRemoto: tem, telaComputador: tem && p.caps.chat, semaforoNaBarra: tem, teclaCmd: tem,
    hostWsl: !tem && p.caps.install };
}
