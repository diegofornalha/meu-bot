/**
 * meu-bot-admin-mac: a janela das contas deste Mac sobre window.contasMac (usuarios-mac-preload.ts). Lista, cria
 * (administrador, senha gerada e mostrada uma vez, meu-bot na mesa), muda o apelido e apaga (a janela de senha do macOS é
 * a confirmação). O main confere tudo de
 * novo; criar, apagar e apelido abrem a janela de senha de administrador do macOS.
 */
import type { UsuarioMac, UsuarioMacCriado, UsuariosMacVisao } from "../shared/ipc";
import { byId, el } from "./lib/dom.js";
import { carregando } from "./lib/carregando.js";
import { ipcErrorText } from "./lib/ipc-error.js";

const api = window.contasMac;
const box = byId<HTMLElement>("mac-lista");
const NOME_RE = /^[a-z][a-z0-9_-]{1,31}$/;

let visao: UsuariosMacVisao | null = null;
let erro: string | null = null;
let ocupado: string | null = null;
let nome = ""; let senha = "";
let criado: UsuarioMacCriado | null = null;
let msg: { text: string; bad: boolean } | null = null;
let editando: string | null = null; let apelidoTxt = "";

async function rodar(chave: string, f: () => Promise<void>): Promise<void> {
  ocupado = chave; msg = null; render();
  try { await f(); } catch (e) { msg = { text: ipcErrorText(e), bad: true }; }
  ocupado = null; render();
  // O aviso fica no topo: rola até ele (a ação pode ter sido lá embaixo, numa conta do fim da lista).
  if (msg !== null) box.scrollTo({ top: 0, behavior: "smooth" });
}
async function ler(): Promise<void> { try { visao = await api.listar(); erro = null; } catch (e) { erro = ipcErrorText(e); } if (ocupado === null) render(); }

const botao = (texto: string, cls: string, run: () => void, desligado = false): HTMLButtonElement => {
  const b = el("button", `btn ${cls} btn-small`, texto); b.type = "button"; b.disabled = desligado || ocupado !== null; b.addEventListener("click", run); return b;
};

function cartaoCriar(): HTMLElement {
  const c = el("div", "admin-card");
  const h = el("div", "admin-card-head"); h.append(el("strong", "", "Criar conta")); c.append(h);
  c.append(el("p", "hint", "Conta administrador: a pessoa (e o agente dela, se rodar aqui) pode mudar qualquer coisa neste Mac. Ela nasce com o meu-bot em Mesa › meu-bot. Sem senha escolhida, o app gera uma forte e a mostra uma vez só."));
  const linha = el("div", "admin-actions");
  const i = el("input"); i.type = "text"; i.placeholder = "nome da conta (ex.: meu-box)"; i.maxLength = 32; i.value = nome; i.disabled = ocupado !== null;
  i.addEventListener("input", () => { nome = i.value.trim().toLowerCase(); ok.disabled = ocupado !== null || !NOME_RE.test(nome); });
  const f = el("label", "admin-field"); f.append(el("span", "hint", "Nome"), i);
  const sIn = el("input"); sIn.type = "password"; sIn.autocomplete = "new-password"; sIn.placeholder = "vazio = o app gera uma forte"; sIn.maxLength = 64; sIn.value = senha; sIn.disabled = ocupado !== null;
  sIn.addEventListener("input", () => { senha = sIn.value; });
  const fs = el("label", "admin-field"); fs.append(el("span", "hint", "Senha (opcional, 8 a 64)"), sIn);
  const ok = botao(ocupado === "criar" ? "Criando…" : "Criar", "btn-primary", () => {
    if (senha !== "" && senha.length < 8) { msg = { text: "a senha precisa ter ao menos 8 caracteres (ou deixe vazio para gerar)", bad: true }; render(); return; }
    void rodar("criar", async () => { criado = await api.criar(nome, senha); visao = criado.visao; nome = ""; senha = ""; });
  }, !NOME_RE.test(nome));
  linha.append(f, fs, ok);
  c.append(linha);
  if (ocupado === "criar") c.append(carregando("Esperando a senha de administrador do macOS e criando a conta…"));
  if (criado !== null) {
    const r = el("div", "admin-card");
    r.append(el("strong", "", `✓ Conta ${criado.nome} criada`));
    if (criado.senha !== null) {
      r.append(el("p", "hint", "Anote a senha: ela não aparece de novo. A pessoa pode trocar depois em Ajustes › Usuários e Grupos."));
      const s = el("input"); s.type = "text"; s.readOnly = true; s.value = criado.senha; s.className = "mac-senha";
      const copiar = botao("Copiar", "btn-ghost", () => { void navigator.clipboard.writeText(s.value).then(() => { copiar.textContent = "Copiado ✓"; }); });
      const l = el("div", "admin-actions"); l.append(s, copiar); r.append(l);
    } else r.append(el("p", "hint", "Com a senha que você escolheu."));
    r.append(el("p", criado.repo === "ok" ? "hint audio-ok" : "hint bad-hint", criado.repo === "ok" ? "meu-bot na mesa da conta nova (Desktop/meu-bot)." : criado.repo === "sem-git" ? "Sem as ferramentas de linha de comando do Xcode neste Mac: o meu-bot não foi para a mesa (xcode-select --install e clone depois)." : "O clone do meu-bot falhou (internet?): a conta foi criada; clone depois em Desktop/meu-bot."));
    r.append(el("p", criado.oauth === "ok" ? "hint audio-ok" : "hint bad-hint", criado.oauth === "ok" ? "Client do Google levado junto: a Conta Google abre no meu-bot dela." : "Este Mac não tem o client do Google (config/google-oauth.json) para levar: a Conta Google dela vai mostrar \"não configurado\" até alguém copiar o arquivo (docs/guia/google.md)."));
    r.append(botao(criado.senha !== null ? "Esconder a senha" : "Ok", "btn-ghost", () => { criado = null; render(); }));
    c.append(r);
  }
  return c;
}

function linhaConta(u: UsuarioMac): HTMLElement {
  const c = el("div", "admin-card");
  const h = el("div", "admin-card-head");
  if (editando === u.nome) {
    const i = el("input"); i.type = "text"; i.value = apelidoTxt; i.maxLength = 60; i.addEventListener("input", () => { apelidoTxt = i.value; });
    h.append(i, botao("Salvar", "btn-primary", () => { const a = apelidoTxt; void rodar(`apelido:${u.nome}`, async () => { visao = await api.apelido(u.nome, a); editando = null; }); }), botao("Cancelar", "btn-ghost", () => { editando = null; render(); }));
  } else {
    h.append(el("strong", "", u.apelido !== "" ? `${u.apelido} (${u.nome})` : u.nome));
    const selos = el("span", "hint", [u.admin ? "administrador" : "padrão", `UID ${u.uid}`, u.nome === visao?.atual ? "você" : "", u.nome === visao?.naTela && u.nome !== visao?.atual ? "na tela agora" : ""].filter(Boolean).join(" · "));
    h.append(selos);
  }
  c.append(h);
  if (editando !== u.nome) {
    const a = el("div", "admin-actions");
    a.append(botao("Apelido", "btn-ghost", () => { editando = u.nome; apelidoTxt = u.apelido; render(); }));
    // Sem confirmação no app: a senha no Terminal já é a confirmação (fechar a janela sem digitar não apaga nada).
    if (u.protegida === null) a.append(botao("Apagar", "btn-danger", () => { void rodar(`apagar:${u.nome}`, async () => { visao = await api.apagar(u.nome); msg = { text: `Conta ${u.nome} apagada (com tudo o que estava nela).`, bad: false }; }); }));
    else a.append(el("span", "hint", `Não se apaga daqui: ${u.protegida}.`));
    if (ocupado === `apagar:${u.nome}`) a.append(carregando("Digite a senha do Mac no Terminal que abriu; a lista atualiza sozinha quando a conta sumir…"));
    if (ocupado === `apelido:${u.nome}`) a.append(carregando("Esperando a senha de administrador do macOS…"));
    c.append(a);
  }
  return c;
}

function render(): void {
  box.replaceChildren();
  const topo = el("div", "admin-actions");
  topo.append(botao(ocupado === "ler" ? "Atualizando…" : "Atualizar", "btn-ghost", () => { void rodar("ler", ler); }));
  box.append(topo);
  if (msg !== null) box.append(el("p", msg.bad ? "hint bad-hint" : "hint audio-ok", msg.text));
  box.append(cartaoCriar());
  if (erro !== null) box.append(el("p", "hint bad-hint", erro));
  if (visao === null) { if (erro === null) box.append(carregando("Lendo as contas deste Mac…")); return; }
  for (const u of visao.usuarios) box.append(linhaConta(u));
}

render();
void ler();
