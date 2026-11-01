/** meu-bot-admin-mac: as contas deste Mac (src/main/usuarios-mac/). Só tipos. */

export interface UsuarioMac {
  nome: string;
  uid: number;
  /** Nome completo (RealName), o "apelido" na tela. */
  apelido: string;
  admin: boolean;
  /** Não pode ser apagada daqui (a conta de quem usa o app, quem está na tela, sistema) e o porquê. */
  protegida: string | null;
}

export interface UsuariosMacVisao { usuarios: UsuarioMac[]; atual: string; naTela: string | null }

/** Conta criada. `senha`: a gerada pelo app, mostrada só aqui, uma vez (null = a pessoa escolheu a dela). `repo`: o meu-bot clonado na mesa. */
/** `oauth`: os clients do Google foram para a conta nova ("sem-origem" = este Mac não tem nenhum para levar). */
export interface UsuarioMacCriado { nome: string; senha: string | null; repo: "ok" | "falhou" | "sem-git"; oauth: "ok" | "sem-origem"; visao: UsuariosMacVisao }

export interface UsuariosMacApi {
  listar(): Promise<UsuariosMacVisao>;
  /** `senha` vazia = o app gera uma forte. */
  criar(nome: string, senha: string): Promise<UsuarioMacCriado>;
  apagar(nome: string): Promise<UsuariosMacVisao>;
  apelido(nome: string, apelido: string): Promise<UsuariosMacVisao>;
}
