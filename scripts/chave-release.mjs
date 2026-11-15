// Chaves Ed25519 das releases (o SUPublicEDKey do meu-bot, como o Sparkle no Brave): o `npm run release` assina cada
// .zip com a privada PRINCIPAL e o app só instala o que confere com uma das públicas embutidas em
// src/main/atualizacao/updater-core.ts (UPDATE_PUBLIC_KEYS: a principal e a RESERVA).
//
// Onde mora cada privada:
// - principal: no Chaveiro de login (serviço meu-bot-release, conta principal), criada sem nenhum app confiável
//   (-T ""): o macOS pede a aprovação com a senha até o dono clicar em "Sempre Permitir" (feito no Mac da release em
//   15 nov 2026, para a release automática não esperar ninguém). Cópia no gerenciador de senhas do dono.
// - reserva: SÓ no gerenciador de senhas (nunca neste Mac). Serve para trocar de chave sem reinstalar ninguém se a
//   principal se perder ou vazar (procedimento na skill publicar e em docs/guia/app.md).
//
// Regra de ouro: nenhuma privada vai para a saída do terminal (o que a sessão vê vai para o transcript). Estes
// comandos só imprimem a pública; a privada vai para a área de transferência, e `--limpar` a esvazia.
//
//   npm run chave-release -- --reserva            gera a reserva: privada → área de transferência, pública na tela
//   npm run chave-release -- --migrar [arquivo]   arquivo .pem → Chaveiro (confere e apaga o arquivo)
//   npm run chave-release -- --copiar-principal   principal do Chaveiro → área de transferência (para o backup)
//   npm run chave-release -- --testar             assina um teste com a principal e confere com UPDATE_PUBLIC_KEYS
//   npm run chave-release -- --limpar             esvazia a área de transferência
//
// No --migrar a chave passa por um instante como argumento do `security` (visível na lista de processos deste Mac).
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

/** Onde a principal morava antes do Chaveiro (só para migrar e para avisar se ainda existe). */
export const CHAVE_RELEASE_ANTIGA = join(homedir(), ".config", "meu-bot", "release-ed25519.pem");
const SERVICO = "meu-bot-release", CONTA = "principal";

/** A privada numa linha (PKCS#8 DER em base64): o `security` devolve igual, sem virar hexadecimal. */
const emLinha = (k) => k.export({ type: "pkcs8", format: "der" }).toString("base64");
/** A pública no formato de UPDATE_PUBLIC_KEYS: SPKI DER em base64. */
export const publicaDe = (k) => createPublicKey(k).export({ type: "spki", format: "der" }).toString("base64");
const copiar = (texto) => execFileSync("pbcopy", { input: texto });

/** A principal, do Chaveiro (o macOS pede aprovação). null = não está lá ou o dono negou. */
export function lerChavePrincipal() {
  try {
    const b64 = execFileSync("security", ["find-generic-password", "-s", SERVICO, "-a", CONTA, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" });
  } catch { return null; }
}
/** Uma privada de um arquivo (.pem, ou a linha base64 que o --reserva copia): emergência com a reserva. */
export function lerChaveArquivo(caminho) {
  const t = readFileSync(caminho, "utf8").trim();
  return t.startsWith("-----BEGIN") ? createPrivateKey(t) : createPrivateKey({ key: Buffer.from(t, "base64"), format: "der", type: "pkcs8" });
}
const temNoChaveiro = () => { try { execFileSync("security", ["find-generic-password", "-s", SERVICO, "-a", CONTA], { stdio: "ignore" }); return true; } catch { return false; } };

/** As públicas que os apps aceitam, do build (npm run build:main antes). */
function publicasDoApp() {
  const f = new URL("../dist/main/atualizacao/updater-core.js", import.meta.url);
  if (!existsSync(f)) { console.error("✗ falta dist/main/atualizacao/updater-core.js: rode `npm run build:main` antes"); process.exit(1); }
  return createRequire(import.meta.url)("../dist/main/atualizacao/updater-core.js").UPDATE_PUBLIC_KEYS;
}

function reserva() {
  const { privateKey } = generateKeyPairSync("ed25519");
  copiar(emLinha(privateKey));
  console.log("✓ reserva gerada. A PRIVADA está na área de transferência (não aparece aqui):");
  console.log("  1. cole agora no gerenciador de senhas, numa nota segura \"meu-bot · chave reserva das releases\";");
  console.log("  2. depois rode `npm run chave-release -- --limpar`.");
  console.log(`\nPública da reserva (para UPDATE_PUBLIC_KEYS em src/main/atualizacao/updater-core.ts):\n${publicaDe(privateKey)}`);
}

function migrar(arquivo) {
  if (temNoChaveiro()) { console.error(`✗ o Chaveiro já tem a principal (${SERVICO}/${CONTA}); para trocar, apague-a antes no app Acesso às Chaves`); process.exit(64); }
  if (!existsSync(arquivo)) { console.error(`✗ não achei ${arquivo}`); process.exit(64); }
  const k = lerChaveArquivo(arquivo);
  // -T "": nenhum app confiável → todo acesso pede aprovação do dono, inclusive pelo próprio `security`.
  execFileSync("security", ["add-generic-password", "-s", SERVICO, "-a", CONTA, "-l", "meu-bot · chave principal das releases", "-T", "", "-w", emLinha(k)], { stdio: "ignore" });
  const lida = lerChavePrincipal();
  if (lida === null || publicaDe(lida) !== publicaDe(k)) { console.error("✗ gravei no Chaveiro, mas não consegui reler a mesma chave: o arquivo NÃO foi apagado"); process.exit(1); }
  const aceitas = publicasDoApp();
  const id = aceitas.find((p) => p.chave === publicaDe(k))?.id;
  if (id === undefined) console.log("⚠ esta chave não está em UPDATE_PUBLIC_KEYS: os apps não aceitariam o que ela assinar");
  rmSync(arquivo, { force: true });
  console.log(`✓ principal no Chaveiro (${id ?? "fora da lista"}); ${arquivo} apagado.\nPública: ${publicaDe(k)}`);
}

function copiarPrincipal() {
  const k = lerChavePrincipal();
  if (k === null) { console.error("✗ não li a principal do Chaveiro (não está lá, ou o acesso foi negado)"); process.exit(1); }
  copiar(emLinha(k));
  console.log("✓ a PRINCIPAL está na área de transferência (não aparece aqui): cole no gerenciador de senhas, numa nota");
  console.log("  \"meu-bot · chave principal das releases\", e depois rode `npm run chave-release -- --limpar`.");
}

function testar() {
  const k = lerChavePrincipal();
  if (k === null) { console.error("✗ não li a principal do Chaveiro (não está lá, ou o acesso foi negado)"); process.exit(1); }
  const { verificaAssinatura, UPDATE_PUBLIC_KEYS } = createRequire(import.meta.url)("../dist/main/atualizacao/updater-core.js");
  const buf = Buffer.from(`teste ${Date.now()}`), sig = sign(null, buf, k).toString("base64");
  const id = UPDATE_PUBLIC_KEYS.find((p) => verificaAssinatura(buf, sig, p.chave))?.id;
  if (id === undefined || !verificaAssinatura(buf, sig)) { console.error("✗ a principal do Chaveiro NÃO confere com nenhuma pública embutida no app"); process.exit(1); }
  console.log(`✓ ok · ${id} (os apps aceitam o que ela assinar)`);
}

const a = process.argv;
if (a.includes("--reserva")) reserva();
else if (a.includes("--migrar")) { const i = a.indexOf("--migrar"); migrar(a[i + 1] !== undefined && !a[i + 1].startsWith("--") ? a[i + 1] : CHAVE_RELEASE_ANTIGA); }
else if (a.includes("--copiar-principal")) copiarPrincipal();
else if (a.includes("--testar")) testar();
else if (a.includes("--limpar")) { copiar(""); console.log("✓ área de transferência vazia"); }
else if (process.argv[1]?.endsWith("chave-release.mjs")) console.log("uso: npm run chave-release -- --reserva | --migrar [arquivo] | --copiar-principal | --testar | --limpar");
