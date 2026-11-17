/**
 * Opções do `ssh` do túnel, por plataforma. No macOS e no Linux os clientes (chave, forward, checagens) pegam carona
 * num master autenticado uma vez (`ControlPath`). O OpenSSH do Windows não tem conexão compartilhada (`ControlMaster`,
 * `-O check|exit|cancel`): lá cada `ssh` é uma conexão própria e o forward é um `ssh -N -L` de vida longa.
 */

/** A plataforma tem conexão SSH compartilhada? (process.platform) */
export const compartilhaConexao = (plataforma: string): boolean => plataforma !== "win32";

/** Opções comuns de todo `ssh` do túnel, terminando em `-- host`. `controlPath` null = conexão própria, sem master. */
export function opcoesDoTunel(host: string, controlPath: string | null): string[] {
  return [
    "-o", `ControlPath=${controlPath ?? "none"}`,
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=15",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "TCPKeepAlive=yes",
    "--", host,
  ];
}
