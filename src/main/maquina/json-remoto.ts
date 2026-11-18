/** Gravar um JSON na máquina da pessoa por SSH, de forma atômica (o admin na licença, o app na licença da conta). */
import { runSsh } from "../whatsapp/whatsapp";

const ultimaLinha = (r: { stdout: string; stderr: string }): string => (r.stderr.trim() || r.stdout.trim()).split("\n").pop() ?? "";

/** Grava `value` em `remotePath` (base64 pela stdin do bash, .tmp + mv, 600 como o backend); lança se a máquina não aceita. */
export async function gravarJsonRemoto(host: string, remotePath: string, value: unknown): Promise<void> {
  const b64 = Buffer.from(JSON.stringify(value, null, 1), "utf8").toString("base64");
  const script = `set -e\numask 077\nmkdir -p "$HOME/.local/share/meu-bot"\nprintf '%s' '${b64}' | base64 -d > "${remotePath}.tmp"\nchmod 600 "${remotePath}.tmp"\nmv "${remotePath}.tmp" "${remotePath}"\n`;
  const r = await runSsh(host, script, 20_000);
  if (r.code !== 0) throw new Error(`não consegui gravar na máquina: ${ultimaLinha(r)}`);
}
