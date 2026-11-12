/** Tipos da API da conta: o ambiente do Worker, as linhas do D1 e o que a API devolve ao app. */

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  CANAL: "producao" | "staging";
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
  /** Dias de trial do Pro para conta nova ("14"); "0" = começa free. */
  TRIAL_DIAS?: string;
  /** Secret: chave HMAC (base64) dos tokens de acesso. */
  SESSAO_HMAC_KEY: string;
  /** Secret: privada Ed25519 da licença (PKCS#8 DER base64); só a partir da PR 5. */
  LICENCA_PRIVATE_KEY?: string;
  /** Secret: JSON da conta de serviço do Firebase (só para o super admin definir senhas); sem ele, só o e-mail. */
  FIREBASE_ADMIN_SA?: string;
  /** Secret: chave de API da AbacatePay (Modo Teste no staging, produção em produção). Sem ela, a assinatura fica desligada. */
  ABACATEPAY_KEY?: string;
  /** Secret: o secret do webhook v2 da AbacatePay (32+ caracteres), o mesmo cadastrado no dashboard. */
  ABACATEPAY_WEBHOOK_SECRET?: string;
  /** O produto de assinatura (prod_..., ciclo MONTHLY) criado na AbacatePay. */
  ABACATEPAY_PRODUTO?: string;
  /** Preço do Pro em centavos ("9700"): pagamento abaixo disso vai para revisão em vez de liberar. */
  ABACATEPAY_PRECO_CENTAVOS?: string;
  /** Formas de pagamento da assinatura: "CARD" ou "CARD,PIX" (Pix Automático precisa estar liberado na conta). */
  ABACATEPAY_METODOS?: string;
  /** Secret: api_secret do Measurement Protocol do fluxo Web do GA4 (a compra vai ao Analytics pelo servidor). */
  GA_MP_SECRET?: string;
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
  expires_at: string | null; device_limit: number; produtos: string; pagamento: string | null; updated_at: string; updated_by: string;
}
export interface DeviceLinha {
  conta_id: string; id: string; alias_legado: string | null; name: string | null; user: string | null; platform: string | null;
  status: string; requested_at: string | null; first_seen: string; last_seen: string; apps: string;
}
export interface MaquinaLinha { id: string; conta_id: string | null; apelido: string | null; vinculada_por: string; criada_em: string; ultima_emissao_em: string | null; ultimo_hello_em: string | null }
export interface SessaoLinha {
  id: string; conta_id: string; refresh_hash: string; familia: string; device_id: string | null; app: string | null; versao_app: string | null;
  criada_em: string; usada_em: string; expira_em: string; revogada_em: string | null;
}
export interface OrgLinha { id: string; slug: string; nome: string; dona_conta_id: string; dominio_email: string | null; assentos: number; criada_em: string; atualizada_em: string; apagada_em: string | null }
export interface MembroLinha { org_id: string; email: string; conta_id: string | null; papel: string; status: string; convidado_por: string | null; convidado_em: string; entrou_em: string | null }
export type PapelOrg = "dona" | "admin" | "membro";
/** Uma organização da pessoa, como vai em `ContaApi.orgs` (menu do console e do app). */
export interface OrgResumo { id: string; slug: string; nome: string; papel: PapelOrg; membros: number; assentos: number }
export interface MembroApi { email: string; nome: string | null; foto: string | null; papel: PapelOrg; status: "convidado" | "ativo"; convidadoPor: string | null; convidadoEm: string; entrouEm: string | null; eu: boolean }
/** `GET /orgs/:slug`: a organização inteira para quem é membro (ou super admin). */
export interface OrgApi { id: string; slug: string; nome: string; dominioEmail: string | null; assentos: number; ocupados: number; criadaEm: string; dona: { email: string; nome: string | null }; meuPapel: PapelOrg | "super"; membros: MembroApi[]; url: string }
/** `GET /admin/visao`: uma linha por organização. */
export interface AdminOrg { id: string; slug: string; nome: string; dona: string; membros: number; assentos: number; criadaEm: string }
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
}
/** Um device da conta como a API o devolve (o app monta o LicenseDevice da tela a partir daqui). */
export interface DeviceApi {
  id: string; alias: string | null; name: string; user: string; platform: string; status: "active" | "pending";
  requestedAt: string | null; firstSeen: string; lastSeen: string; apps: Record<string, { version: string; lastSeen: string }>;
  /** É o device desta sessão. */
  este: boolean;
}
/** O que `GET /conta` e `POST /token` devolvem: a conta como o app a mostra. */
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
  maquinas: { id: string; apelido: string | null; vinculadaPor: string }[];
  /** Pedidos abertos desta conta (Pro, add-on, device). */
  pedidos: number;
  /** Organizações de que a conta é membro (dona, admin ou membro). */
  orgs: OrgResumo[];
}
/** `GET /admin/visao`: todas as contas (com licença, devices e máquinas), os pedidos abertos e os totais. Só admin. */
export interface AdminContaResumo { id: string; email: string; nome: string | null; foto: string | null; admin: "super" | "admin" | null; criadaEm: string; licenca: License; devices: DeviceApi[]; maquinas: number; pedidos: number }
export interface AdminPedido { id: string; tipo: string; detalhe: string | null; maquinaId: string | null; criadoEm: string; atendidoEm: string | null; atendidoPor: string | null; conta: { id: string; email: string; nome: string | null } }
export interface AdminPerfil { email: string; papel: "super" | "admin"; criadoEm: string; entrou: boolean }
export interface AdminVisao { contas: AdminContaResumo[]; pedidos: AdminPedido[]; perfis: AdminPerfil[]; orgs: AdminOrg[]; totais: { contas: number; pro: number; devicesPendentes: number; pedidosAbertos: number; orgs: number } }
/** O que o app manda no `POST /token` para se registrar como device. */
export interface DevicePedido { id: string; alias: string | null; name: string; user: string; platform: string; app: string; versao: string }
/** Claims do token de acesso (HS256, 1 h). */
export interface AcessoClaims { sub: string; sid: string; dev: string | null; adm: "super" | "admin" | null; iat: number; exp: number }
