/** Tipos da API da conta: o ambiente do Worker, as linhas do D1 e o que a API devolve ao app. */

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  CANAL: "producao" | "staging";
  /**
   * O commit publicado (sha completo), que o /health devolve. Não fica no wrangler.toml: entra no deploy pelo
   * scripts/site-publicar.mjs (`wrangler deploy --var COMMIT:<sha>`). Ausente = deploy antigo ou à mão.
   */
  COMMIT?: string;
  /** Origem da página de login e do console (CORS da API) e da API (as páginas chamam esta). */
  AUTH_ORIGIN: string;
  API_ORIGIN: string;
  CONSOLE_ORIGIN: string;
  /** A home (agentesgrok.com): "Baixar para macOS". `www.` redireciona para ela. */
  SITE_ORIGIN: string;
  /** Google Analytics 4 do site: um ou mais IDs "G-…" separados por vírgula; vazio ou ausente = sem tag. */
  GA_ID?: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_API_KEY: string;
  FIREBASE_AUTH_DOMAIN: string;
  /** Primeiro super admin: entra em `admins` no primeiro login dele. */
  ADMIN_BOOTSTRAP_EMAIL: string;
  /** Dias de trial do Pro para conta nova ("3"); "0" = começa free. */
  TRIAL_DIAS?: string;
  /** Secret: chave HMAC (base64) dos tokens de acesso. */
  SESSAO_HMAC_KEY: string;
  /** Secret: privada Ed25519 da licença (PKCS#8 DER base64). Sem ela, vincular máquina responde 503. */
  LICENCA_PRIVATE_KEY?: string;
  /** Secret: JSON da conta de serviço do Firebase (só para o super admin definir senhas); sem ele, só o e-mail. */
  FIREBASE_ADMIN_SA?: string;
  /** Secret: chave de API da AbacatePay (Modo Teste no staging, produção em produção). Sem ela, a assinatura fica desligada. */
  ABACATEPAY_KEY?: string;
  /** Secret: o secret do webhook v2 da AbacatePay (32+ caracteres), o mesmo cadastrado no dashboard. */
  ABACATEPAY_WEBHOOK_SECRET?: string;
  /** O produto de assinatura (prod_..., ciclo MONTHLY) criado na AbacatePay. */
  ABACATEPAY_PRODUTO?: string;
  /** Produto AVULSO (sem ciclo) do primeiro mês do Pro por Pix, com cupom; vazio = esse caminho fica desligado. */
  ABACATEPAY_PRODUTO_PRIMEIRO_MES?: string;
  /** Preço do Pro em centavos ("9700"): pagamento abaixo disso vai para revisão em vez de liberar. */
  ABACATEPAY_PRECO_CENTAVOS?: string;
  /** Apps vendidos à parte, cada um com produto mensal e preço próprios (JSON; a forma está em lerAddons, pagamento-core.ts). */
  ABACATEPAY_ADDONS?: string;
  /** Unidades extras vendidas à parte (lerExtras): `{"maquina":{"produto":"prod_...","centavos":9700,"rotulo":"Máquina extra"}}`. Vazio = nada à venda. */
  ABACATEPAY_EXTRAS?: string;
  /** Formas de pagamento da assinatura: "CARD" ou "CARD,PIX" (Pix Automático precisa estar liberado na conta). */
  ABACATEPAY_METODOS?: string;
  /** Código do cupom da promoção do primeiro mês do Pro na AbacatePay; vazio ou ausente = promoção desligada. */
  PROMO_CUPOM?: string;
  /** Quanto sai a primeira cobrança com o cupom, em centavos ("100"): preço cheio menos o desconto fixo do cupom. */
  PROMO_PRECO_CENTAVOS?: string;
  /** Por quantos dias depois do fim do teste grátis a promoção vale ("3"). */
  PROMO_DIAS?: string;
  /** Secret: api_secret do Measurement Protocol do fluxo Web do GA4 (a compra vai ao Analytics pelo servidor). */
  GA_MP_SECRET?: string;
  /** Secret: o token de quem atende os leads do site (32+ caracteres) para ler e qualificar um código por visita. Sem ele, /leads responde 503. */
  LEADS_TOKEN?: string;
  /**
   * Passkey (WebAuthn): o RP ID, o domínio de que a página de login e o console são subdomínios ("agentesgrok.com").
   * Vazio ou ausente = passkey desligada (as rotas respondem 503 e as páginas não mostram os botões).
   */
  PASSKEY_RP_ID?: string;
}

export interface ContaLinha {
  id: string; firebase_uid: string; email: string; email_verificado: number; nome: string | null; foto: string | null;
  criada_em: string; atualizada_em: string; apagada_em: string | null;
  /** O que a pessoa digitou no console (0002_perfil.sql); `nome` continua sendo o do Firebase. */
  nome_proprio: string | null; sobrenome: string | null;
  /** JSON: provedores de login já usados (google.com, emailLink, password). */
  provedores: string;
  /** 1 = a conta guarda nome, usuário, plataforma e apps dos devices; 0 = só id e status. */
  dados_uso: number;
}
/** O perfil editável (console › Perfil), como a API devolve e recebe (`PATCH /conta`). */
export interface PerfilApi { nomeProprio: string | null; sobrenome: string | null }
export interface LicencaLinha {
  conta_id: string; plan: string; status: string; interval: string | null; member_since: string; trial_end: string | null;
  expires_at: string | null; device_limit: number; maquina_limit?: number; org_limit?: number; produtos: string; pagamento: string | null; updated_at: string; updated_by: string;
}
export interface DeviceLinha {
  conta_id: string; id: string; alias_legado: string | null; name: string | null; user: string | null; platform: string | null;
  status: string; requested_at: string | null; first_seen: string; last_seen: string; apps: string;
}
export interface MaquinaLinha { id: string; conta_id: string | null; apelido: string | null; vinculada_por: string; criada_em: string; ultima_emissao_em: string | null; ultimo_hello_em: string | null; desvinculada_em: string | null }
export interface SessaoLinha {
  id: string; conta_id: string; refresh_hash: string; familia: string; device_id: string | null; app: string | null; versao_app: string | null;
  criada_em: string; usada_em: string; expira_em: string; revogada_em: string | null;
}
export interface OrgLinha { id: string; slug: string; nome: string; dona_conta_id: string; dominio_email: string | null; assentos: number; criada_em: string; atualizada_em: string; apagada_em: string | null }
export interface MembroLinha { org_id: string; email: string; conta_id: string | null; papel: string; status: string; convidado_por: string | null; convidado_em: string; entrou_em: string | null }
export type PapelOrg = "dona" | "admin" | "membro";
/** Uma organização da pessoa, como vai em `ContaApi.orgs` (menu do console e do app). */
export interface OrgResumo { id: string; slug: string; nome: string; papel: PapelOrg; membros: number; assentos: number }
export interface MembroApi { email: string; nome: string | null; foto: string | null; papel: PapelOrg; status: "convidado" | "ativo"; convidadoPor: string | null; convidadoEm: string; entrouEm: string | null; eu: boolean; /** Dentro das vagas da organização (os que entraram primeiro): é quem recebe o Pro por ela quando a dona tem o Pro valendo. */ coberto: boolean }
/** `GET /orgs/:slug`: a organização inteira para quem é membro (ou super admin). */
export interface OrgApi { id: string; slug: string; nome: string; dominioEmail: string | null; /** Usuários em vigor: `assentosInclusos` (a dona e as cortesias do super admin) mais `assentosPagos` (usuários pagos em dia). */ assentos: number; assentosInclusos: number; /** Usuários de cortesia do admin, em dia. */ assentosCortesia: number; assentosPagos: number; /** O Pro de quem é a dona está valendo: sem ele, os usuários ficam sem o Pro pela organização. */ donaComPro: boolean; ocupados: number; criadaEm: string; dona: { email: string; nome: string | null }; meuPapel: PapelOrg | "super"; membros: MembroApi[]; url: string }
/** `GET /admin/visao`: uma linha por organização. */
/** Um encerramento feito pelo admin (tabela `encerramentos`), como a ficha da conta mostra. */
export interface AdminEncerramento { alvo: string; ref: string; motivo: string; detalhe: string | null; cobranca: string | null; por: string; quando: string }
export interface AdminOrg { id: string; slug: string; nome: string; dona: string; membros: number; /** A parte inclusa (a dona), editada pelo super admin. */ assentos: number; /** Usuários de cortesia do admin em dia. */ assentosCortesia: number; /** Usuários pagos em dia. */ assentosPagos: number; criadaEm: string }
export interface CodigoLinha { code: string; conta_id: string; state: string; challenge: string; esquema: string; app: string | null; versao_app: string | null; criado_em: string; expira_em: string; usado_em: string | null }

/** Mesmo esquema de License em src/shared/ipc/licenca.ts (o app confere o alinhamento por teste). */
export interface License {
  plan: "free" | "pro";
  status: "free" | "trialing" | "active" | "expired";
  interval: "month" | "year" | null;
  memberSince: string;
  trialEnd: string | null;
  expiresAt: string | null;
  deviceLimit: number;
  produtos: string[];
  pagamento: { instrucoes: string; link: string | null } | null;
  updatedAt: string;
  updatedBy: "admin" | "system";
  /** Só na licença entregue (nunca gravada): a conta é de super admin e o Pro não tem prazo (licencaDoSuper). As telas mostram "∞". */
  semPrazo?: true;
}
/** Um device da conta como a API o devolve (o app monta o LicenseDevice da tela a partir daqui). */
export interface DeviceApi {
  id: string; alias: string | null; name: string; user: string; platform: string; status: "active" | "pending";
  requestedAt: string | null; firstSeen: string; lastSeen: string; apps: Record<string, { version: string; lastSeen: string }>;
  /** É o device desta sessão. */
  este: boolean;
}
/** Uma máquina da conta. `desvinculadaEm` preenchido = a pessoa tirou a licença pelo console e a vaga abre em `proAte`. */
export interface MaquinaApi { id: string; apelido: string | null; vinculadaPor: string; proAte: string | null; desvinculadaEm: string | null }
/** Máquina que a pessoa usa pelo app com a licença que o admin gravou nela: aparece no console, sem ocupar vaga. */
export interface MaquinaVistaApi { id: string; apelido: string | null; origem: "admin" | "conta"; vistaEm: string; /** O admin atribuiu esta máquina à conta (não some sem aviso do app). */ atribuida: boolean }
/** O que `GET /conta` e `POST /token` devolvem: a conta como o app a mostra. */
/** Uma assinatura paga da conta, como o console › Plano a mostra: `produto` null é o Pro; "extra-maquina" é uma máquina extra (uma por assinatura). */
export interface ContaAssinatura { id: string; produto: string | null; status: "ACTIVE" | "CANCELLED"; valorCentavos: number | null; valeAte: string | null }
/** A promoção do primeiro mês a que a conta tem direito agora (console › Plano): o preço, até quando e o código do cupom. */
export interface PromoApi { precoCentavos: number; ate: string; cupom: string }
/** Uma cortesia do admin como a própria pessoa a vê: o que é e até quando; `encerradaEm` quando o suporte a encerrou antes. */
export interface CortesiaDaConta { id: string; tipo: import("./cortesia-core.js").TipoCortesia; produto: string | null; orgId: string | null; quantidade: number; inicio: string; fim: string; encerradaEm: string | null }
export interface ContaApi {
  id: string;
  email: string;
  /** Nome de exibição: o digitado no console (nome próprio + sobrenome); senão o do login. */
  nome: string | null;
  /** O nome que veio do Firebase (Google ou e-mail), para o console mostrar de onde vem. */
  nomeLogin: string | null;
  foto: string | null;
  perfil: PerfilApi;
  /** Provedores de login já usados nesta conta: "google.com", "emailLink", "password". */
  provedores: string[];
  /** Console › "Dados de uso do produto": false = a conta guarda só id e status dos devices. */
  dadosUso: boolean;
  admin: "super" | "admin" | null;
  licenca: License;
  devices: DeviceApi[];
  /** As máquinas (VMs por SSH) que usam a licença desta conta; `proAte` é até quando a última emissão vale lá. */
  maquinas: MaquinaApi[];
  /** As máquinas em uso que não estão em `maquinas` (licença do admin), vistas pelo app nos últimos 30 dias. */
  maquinasVistas: MaquinaVistaApi[];
  /** O Pro desta conta vem de uma organização em que ela é usuário coberto (e não do próprio plano): qual, e até quando; null quando o Pro é dela ou não há. */
  proPelaOrg: { slug: string; nome: string; ate: string | null } | null;
  /** Criar organização: quantas a conta pode ter como dona (`limite`), quantas já tem (`donaDe`) e por que não pode criar outra agora (`motivo`; null = pode). */
  orgCriar: { limite: number; donaDe: number; motivo: "sem-pro" | "no-limite" | null };
  /** Em quantas máquinas a conta pode usar a licença ao mesmo tempo: o que o admin gravou (licencas.maquina_limit) mais as máquinas extras pagas em dia. */
  maquinaLimite: number;
  /** Quantas das vagas de `maquinaLimite` vêm de máquina extra paga (extras_pagos em dia); o resto é o que o plano inclui. */
  maquinaExtras: number;
  /** Quantas das vagas de `licenca.deviceLimit` vêm de device extra pago (extras_pagos em dia). */
  deviceExtras: number;
  /** Quantas das vagas de `licenca.deviceLimit` são cortesia do admin; o resto (menos `deviceExtras`) é o que o plano inclui. */
  deviceCortesias: number;
  /** Quantas das vagas de `maquinaLimite` são cortesia do admin. */
  maquinaCortesias: number;
  /** De onde vem o Pro que a conta tem agora (cortesia-core.ts, `origemDoPro`); null sem Pro. */
  origemDoPro: import("./cortesia-core.js").OrigemPro | null;
  /** As cortesias do admin que valem e as que acabaram nos últimos 30 dias (sem quem liberou nem o motivo). */
  cortesias: CortesiaDaConta[];
  /** Pedidos abertos desta conta (Pro, add-on, device). */
  pedidos: number;
  /**
   * Add-ons pagos que tiveram pedido "Liberar na máquina": `aberta` enquanto o admin não atendeu (o add-on já vale na
   * conta, mas ainda não foi gravado na máquina). Add-on sem pedido não entra.
   */
  liberacoes: import("./pagamento-core.js").Liberacao[];
  /** As assinaturas pagas da conta (Pro e add-ons), a mais nova primeiro. */
  assinaturas: ContaAssinatura[];
  /** Organizações de que a conta é membro (dona, admin ou membro). */
  orgs: OrgResumo[];
  /** Primeiro mês do Pro pelo preço da promoção, se a conta tem direito agora; null sem direito ou com a promoção desligada. */
  promo: PromoApi | null;
}
/** `GET /admin/visao`: todas as contas (com licença, devices e máquinas), os pedidos abertos e os totais. Só admin. */
export interface AdminContaResumo { id: string; email: string; nome: string | null; foto: string | null; admin: "super" | "admin" | null; criadaEm: string; /** A licença em vigor (para o super admin, o Pro sem prazo). */ licenca: License; /** Só vem para conta de super admin: o que está gravado, que o editor de licença mostra e muda. */ licencaGravada?: License; /** Add-ons pagos pela AbacatePay, com o prazo de cada um (os concedidos pelo admin estão em licenca.produtos). */ addonsPagos: { produto: string; expiresAt: string }[]; /** Unidades extras pagas (máquina extra), uma por assinatura, com o prazo de cada uma; `maquinaLimite` aqui é só o que o admin gravou, sem elas. */ extrasPagos: { assinaturaId: string; tipo: string; expiresAt: string }[]; devices: DeviceApi[]; maquinas: number; maquinaLimite: number; /** Quantas organizações a conta pode criar (licencas.org_limit). */ orgLimite: number; pedidos: number; /** Todas as cortesias que a conta recebeu, com quem liberou e o motivo. */ cortesias: import("./cortesia-core.js").Cortesia[]; /** Os últimos encerramentos feitos pelo admin nesta conta. */ encerramentos: AdminEncerramento[]; /** De onde vem o Pro (sem o de organização, que a lista não lê). */ origemDoPro: import("./cortesia-core.js").OrigemPro | null }
export interface AdminPedido { id: string; tipo: string; detalhe: string | null; maquinaId: string | null; criadoEm: string; atendidoEm: string | null; atendidoPor: string | null; conta: { id: string; email: string; nome: string | null } }
/** `fixo`: o admin inicial (ADMIN_BOOTSTRAP_EMAIL), que não é removido nem rebaixado. */
export interface AdminPerfil { email: string; papel: "super" | "admin"; criadoEm: string; entrou: boolean; fixo: boolean }
/** Uma assinatura paga (subs_...): `produto` null é o Pro; `valeAte` é o prazo que ela sustenta hoje na conta. */
export interface AdminAssinatura { id: string; produto: string | null; status: "ACTIVE" | "CANCELLED"; valorCentavos: number | null; criadaEm: string; atualizadaEm: string; valeAte: string | null; ultimoPagamentoEm: string | null; conta: { id: string; email: string; nome: string | null } }
/** Uma conta apagada, como o super admin a vê na Auditoria: o e-mail que ela tinha, quem apagou e o que ficou guardado. */
export interface AdminContaApagada { id: string; email: string; criadaEm: string; apagadaEm: string; /** E-mail de quem apagou (o da própria conta = a própria pessoa); null sem registro. */ apagadaPor: string | null; plan: string | null; status: string | null; expiresAt: string | null; pagoCentavos: number }
/** Uma linha da tabela `auditoria`; `conta` é a conta afetada, com o e-mail original mesmo depois de apagada. */
export interface AdminRegistro { id: number; quando: string; quem: string; acao: string; detalhe: string | null; conta: { id: string; email: string | null; apagada: boolean } | null }
/** `GET /admin/auditoria`: as contas apagadas (até 200), as vendas ocultadas (até 500 de cada lista) e as ações mais recentes (até 500), das mais novas para as antigas. */
export interface AdminAuditoria { apagadas: AdminContaApagada[]; ocultas: AdminVendaOculta[]; registro: AdminRegistro[] }
/** As duas listas da tela Assinaturas de onde o super admin oculta linhas. */
export type TipoVenda = "assinaturas" | "pagamentos";
/** Uma assinatura ou um pagamento que o super admin tirou da tela Assinaturas; `quando` é a criação ou o pagamento. */
export interface AdminVendaOculta { tipo: TipoVenda; id: string; produto: string | null; valorCentavos: number | null; quando: string; ocultaEm: string; ocultaPor: string | null; conta: { id: string; email: string } }
export interface AdminPagamento { id: string; produto: string | null; valorCentavos: number; primeira: boolean; pagoEm: string; noAnalytics: boolean; conta: { id: string; email: string; nome: string | null } }
/** Quem paga o quê: só o super admin recebe (para o admin comum vem null). */
export interface AdminVendas { assinaturas: AdminAssinatura[]; pagamentos: AdminPagamento[]; totais: { proPago: number; addons: Record<string, number>; mensalCentavos: number; aRevisar: number } }
/** Lista de espera do site (só o super admin recebe): o total por plataforma e os contatos mais novos. */
export interface AdminListaEspera { total: number; semAviso: number; contatos: { contato: string; tipo: "email" | "whatsapp"; plataforma: string; origem: string; viaAnuncio: boolean; criadoEm: string; avisadoEm: string | null }[] }
export interface AdminVisao { contas: AdminContaResumo[]; pedidos: AdminPedido[]; perfis: AdminPerfil[]; orgs: AdminOrg[]; vendas: AdminVendas | null; listaEspera: AdminListaEspera | null; totais: { contas: number; pro: number; devicesPendentes: number; pedidosAbertos: number; orgs: number } }
/** O que o app manda no `POST /token` para se registrar como device. */
export interface DevicePedido { id: string; alias: string | null; name: string; user: string; platform: string; app: string; versao: string }
/** Claims do token de acesso (HS256, 1 h). */
export interface AcessoClaims { sub: string; sid: string; dev: string | null; adm: "super" | "admin" | null; iat: number; exp: number }
