/**
 * Contrato IPC · Conta meu-bot (login no navegador do sistema, volta por deep link; conta.agentesgrok.com). Só tipos;
 * reexportado por src/shared/ipc.ts. É a conta da PESSOA neste Mac (uma por app), não a conta de uma máquina.
 */
import type { Canal } from "./app";
import type { License } from "./licenca";

/** Um device (Mac) registrado na conta, como a API devolve. `este` = o Mac desta sessão. */
export interface ContaDevice {
  id: string;
  /** Id antigo (12 hex de hostname+usuário), para casar com o maquinas.json das máquinas. */
  alias: string | null;
  name: string;
  user: string;
  platform: string;
  status: "active" | "pending";
  requestedAt: string | null;
  firstSeen: string;
  lastSeen: string;
  apps: Record<string, { version: string; lastSeen: string }>;
  este: boolean;
}
/** Uma máquina (VM com backend) vinculada à conta. */
export interface ContaMaquina {
  id: string; apelido: string | null; vinculadaPor: string;
  /** Até quando a última licença emitida vale naquela máquina; null em API antiga ou sem emissão. */
  proAte: string | null;
  /** Preenchido = a pessoa tirou a licença pelo console; a vaga abre em `proAte`. */
  desvinculadaEm: string | null;
}
/** O perfil que a pessoa edita no console (console.agentesgrok.com/account/profile): nome e sobrenome. */
export interface ContaPerfil { nomeProprio: string | null; sobrenome: string | null }
/** A conta como a API a devolve (`POST /token`, `GET /conta`). */
export interface ContaInfo {
  id: string;
  email: string;
  /** Nome de exibição: o digitado no console, senão o do login. */
  nome: string | null;
  /** O nome que veio do login (Google ou e-mail). */
  nomeLogin: string | null;
  foto: string | null;
  perfil: ContaPerfil;
  /** Provedores de login já usados: "google.com", "emailLink", "password". */
  provedores: string[];
  /** Console › "Dados de uso do produto": false = o app manda só o mínimo ao registrar este Mac como device. */
  dadosUso: boolean;
  admin: "super" | "admin" | null;
  licenca: License;
  devices: ContaDevice[];
  maquinas: ContaMaquina[];
  /** Em quantas máquinas a conta pode usar a licença ao mesmo tempo; null = a API ainda não leva a licença a máquinas. */
  maquinaLimite: number | null;
  /** Pedidos abertos desta conta (Pro, add-on, device). */
  pedidos: number;
  /** Organizações de que a conta é membro (console › /organizations/<slug>/members). */
  orgs: ContaOrg[];
}
export interface ContaOrg { id: string; slug: string; nome: string; papel: "dona" | "admin" | "membro"; membros: number; assentos: number }
/**
 * Onde a conta está: fora (nunca entrou ou saiu), entrando (o navegador está aberto na página de login, até 10 min),
 * dentro (sessão guardada neste Mac), erro (o último passo falhou; `erro` diz o quê; o botão "Entrar" volta).
 */
export type ContaSituacao = "fora" | "entrando" | "dentro" | "erro";
export interface ContaView {
  situacao: ContaSituacao;
  conta: ContaInfo | null;
  /** Foto do perfil já baixada pelo main, em data URL (a janela não carrega imagem de fora); null = sem foto ainda. */
  foto: string | null;
  erro: string | null;
  /** O Chaveiro cifra o arquivo da sessão (no staging é só ofuscação: use-mock-keychain). */
  keychain: boolean;
  /** Canal deste app: a conta de staging fala só com a API de staging. */
  canal: Canal;
  /** Id (uuid) deste Mac como device da conta. */
  device: string;
  /** Página de login (para a tela dizer onde o navegador foi). */
  urlLogin: string;
  /** Console da conta no navegador (perfil, plano, devices): o menu da conta leva até lá. */
  urlConsole: string;
}
