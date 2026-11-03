/**
 * Botão "sincronizar ssh" do seletor: acrescenta ao ~/.ssh/config do Mac as máquinas do modelo
 * versionado (config/ssh-hosts.conf) que ainda faltam. O Cursor (Remote SSH) lê o mesmo arquivo (ou um
 * arquivo que este inclui), então depois disso as duas listas, a do seletor e a do Cursor, ficam iguais.
 * Nunca altera um Host existente, não traz de volta o que foi removido pelo seletor nem repete uma máquina
 * que já existe com outro nome; faz backup antes de escrever.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import type { SshSyncResult } from "../../shared/ipc";
import { identityFiles, includedTexts, planSshSync, removeSshHost, renderSshAppend } from "./ssh-sync";
import { expandInclude } from "./sshConfig";

/** config/ssh-hosts.conf: Resources/config no .app; raiz do projeto no dev. */
export function sshHostsTemplatePath(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "config", "ssh-hosts.conf") : path.join(app.getAppPath(), "config", "ssh-hosts.conf");
}

const stamp = (): string => new Date().toISOString().slice(0, 19).replace("T", " ");

const lerOuNull = (f: string): string | null => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };

export function syncSshConfig(): SshSyncResult {
  const home = os.homedir();
  const sshDir = path.join(home, ".ssh");
  const configPath = path.join(sshDir, "config");
  const template = fs.readFileSync(sshHostsTemplatePath(), "utf8");
  let current = "";
  let exists = false;
  try { current = fs.readFileSync(configPath, "utf8"); exists = true; } catch { /* ainda não há ~/.ssh/config */ }
  const plan = planSshSync(template, current, home, includedTexts(current, expandInclude, lerOuNull));
  const append = renderSshAppend(plan, stamp());
  let backup: string | null = null;
  if (append !== "") {
    if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { mode: 0o700 });
    if (exists) {
      backup = `${configPath}.bak-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
      fs.copyFileSync(configPath, backup);
    }
    const sep = exists && current !== "" && !current.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(configPath, `${sep}${append}`, { mode: 0o600 });
    try { fs.chmodSync(configPath, 0o600); } catch { /* cortesia */ }
  }
  return {
    configPath,
    added: plan.hostsToAdd.flatMap((b) => b.aliases),
    includesAdded: plan.includesToAdd.length,
    kept: plan.kept,
    onlyLocal: plan.onlyLocal,
    skipped: plan.skipped,
    sameTarget: plan.sameTarget,
    backup,
    missingKeys: identityFiles(template, home).filter((p) => !fs.existsSync(p)),
  };
}

/**
 * "Remover do seletor": tira o host do ~/.ssh/config (backup antes; o Cursor e o ssh deixam de ver a
 * máquina também). Host que vem de um Include não é mexido: diz de onde ele vem.
 */
export function removeHostFromSshConfig(host: string): { backup: string; removed: "block" | "alias" } {
  const configPath = path.join(os.homedir(), ".ssh", "config");
  let current = "";
  try { current = fs.readFileSync(configPath, "utf8"); } catch { throw new Error("não há ~/.ssh/config neste Mac"); }
  const r = removeSshHost(current, host);
  if (r.removed === null) throw new Error(`${host} não está escrito no ~/.ssh/config: vem de um arquivo incluído (Include). Remova lá.`);
  const backup = `${configPath}.antes-de-remover-${host}`;
  fs.copyFileSync(configPath, backup);
  fs.writeFileSync(configPath, r.text, { mode: 0o600 });
  return { backup, removed: r.removed };
}
