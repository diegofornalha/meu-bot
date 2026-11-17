/**
 * Variante: admin. O seletor do meu-bot-admin lista pessoas, não máquinas: os aliases `suporte-…` das pessoas
 * com suporte ligado (admin/support-admin.ts). Os handlers só dele: atualizar pela caixa de entrada e
 * "Adicionar pessoa" colando o código, arquivar, apelido e "Excluir máquina" (limpa o WhatsApp dela e desliga o
 * suporte). Nada de instalar nem de mexer no ~/.ssh/config: a máquina é dela. "este Mac" vem primeiro enquanto
 * este Mac ainda não é pessoa: o Abrir o adota (esteMacComoPessoa, SSH em 127.0.0.1) e dali em diante ele é uma
 * pessoa da lista como as outras, com o espelho e as ações de suporte.
 */
import type { PickerSource } from "../maquina/picker";
import { handleAdmin } from "../ipc/registry";
import { caps } from "../app/variant";
import { isSupportAlias } from "../suporte/support-code";
import { windowForHost } from "../app/windows";
import { LOCAL_HOST } from "../maquina/localBackend";
import { addSupportCode, adminKeyExists, aliasDoEsteMac, esteMacComoPessoa, archivePerson, knownPeople, removePerson, renamePerson, supportPeople } from "./support-admin";
import { registerProdutosIpc, showProdutos } from "./produtos-janela";
import { vpsNova } from "./vps-nova-admin";

export const adminPickerSource: PickerSource = {
  title: "meu-bot-admin-gestao · escolher pessoa",
  hosts: () => [...(caps().hostLocal && aliasDoEsteMac() === null ? [LOCAL_HOST] : []), ...knownPeople().filter((p) => p.on).map((p) => p.alias)],
  abrirComo: async (host) => (host === LOCAL_HOST ? esteMacComoPessoa() : host),
  support: () => ({ people: knownPeople(), adminKey: adminKeyExists() }),
  registerIpc: ({ fromPicker, progressoLivre }) => {
    // Produtos (MVPs de bots verticais) moram numa janela própria; o seletor só a abre.
    registerProdutosIpc();
    handleAdmin("picker:produtos-abrir", (event) => { if (!fromPicker(event)) throw new Error("origem inválida"); showProdutos(); });
    handleAdmin("picker:support-refresh", async (event) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      return supportPeople();
    });
    handleAdmin("picker:support-add", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      return addSupportCode(String((payload as { code?: unknown } | null)?.code ?? ""));
    });
    // "Nova VPS": o job inteiro (src/main/admin/vps-nova-admin.ts), com o progresso na janela do seletor.
    handleAdmin("picker:vps-nova", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      return vpsNova((payload as { pedido?: unknown } | null)?.pedido, progressoLivre);
    });
    handleAdmin("picker:support-archive", (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const p = payload as { alias?: unknown; archived?: unknown } | null;
      const alias = String(p?.alias ?? "");
      if (!isSupportAlias(alias)) throw new Error("pessoa inválida");
      return archivePerson(alias, p?.archived === true);
    });
    handleAdmin("picker:support-rename", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const p = payload as { alias?: unknown; name?: unknown } | null;
      const alias = String(p?.alias ?? "");
      if (!isSupportAlias(alias)) throw new Error("pessoa inválida");
      return renamePerson(alias, String(p?.name ?? ""));
    });
    handleAdmin("picker:support-remove", async (event, payload: unknown) => {
      if (!fromPicker(event)) throw new Error("origem inválida");
      const p = payload as { alias?: unknown; force?: unknown } | null;
      const alias = String(p?.alias ?? "");
      if (!isSupportAlias(alias)) throw new Error("pessoa inválida");
      const r = await removePerson(alias, p?.force === true);
      windowForHost(alias)?.close();
      return r;
    });
  },
};
