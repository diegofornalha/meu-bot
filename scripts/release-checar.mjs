// Confere, já no PR, o que faria a release recusar (e a release automática travar): componente da máquina (backend,
// CRM, guarda) que mudou desde a última release sem subir a versão. Também avisa (sem falhar) quando o PR
// muda o app sem escrever o item dele em docs/changelog/<branch>.md (que vira as notas da release), ou quando escreve
// direto em "Ainda não lançado" do docs/CHANGELOG.md, onde toda PR mexe nas mesmas linhas e dá conflito.
//   node scripts/release-checar.mjs            (precisa do dist/main: rode depois do `npm run build`)
// O release.mjs usa a mesma conferência (componentesPendentes) antes de empacotar.
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { componentesSemVersao, lerVersao, notasDaRelease, PASTA_FRAGMENTOS } from "./release-core.mjs";

const git = (args) => { try { return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };

/** { ultima, falta }: a última tag v* alcançável do HEAD e as linhas de componentesSemVersao (vazio = ok). */
export function componentesPendentes() {
  const ultima = git(["describe", "--tags", "--abbrev=0", "--match", "v*"])?.trim() || null;
  if (ultima === null) return { ultima: null, falta: [] };
  const { COMPONENTES } = createRequire(import.meta.url)("../dist/main/maquina/backend-bundle-core.js");
  const mudancas = (git(["diff", "--name-only", `${ultima}..HEAD`]) ?? "").split("\n");
  const versoes = Object.fromEntries(COMPONENTES.map((c) => [c.nome, { antes: lerVersao(c.versao, git(["show", `${ultima}:${c.versao}`])), agora: lerVersao(c.versao, existsSync(c.versao) ? readFileSync(c.versao, "utf8") : null) }]));
  return { ultima, falta: componentesSemVersao(COMPONENTES, mudancas, versoes) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { ultima, falta } = componentesPendentes();
  if (falta.length > 0) {
    console.error(`✗ desde ${ultima}, componente da máquina mudou sem subir a versão (a release automática recusaria):\n  ${falta.join("\n  ")}`);
    process.exit(1);
  }
  console.log(ultima === null ? "sem release anterior: nada a comparar" : `✓ versões dos componentes ok desde ${ultima}`);
  // CHANGELOG: só aviso. Num PR, compara com a base dele; fora de PR, não há o que avisar.
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    const mb = git(["merge-base", "HEAD", `origin/${baseRef}`])?.trim();
    const mudou = mb ? (git(["diff", "--name-only", `${mb}..HEAD`]) ?? "").split("\n").filter(Boolean) : [];
    const app = mudou.some((f) => /^(src|backend-colima|conta-api|crm|guarda|extensao-crm)\//.test(f));
    const antes = mb ? notasDaRelease(git(["show", `${mb}:docs/CHANGELOG.md`])) : null;
    const agora = notasDaRelease(existsSync("docs/CHANGELOG.md") ? readFileSync("docs/CHANGELOG.md", "utf8") : null);
    const fragmento = mudou.some((f) => f.startsWith(`${PASTA_FRAGMENTOS}/`) && /\.md$/i.test(f) && !/\/readme\.md$/i.test(f));
    if (app && antes === agora && !fragmento) console.log(`::warning file=docs/CHANGELOG.md::Este PR muda o app mas não escreve o item dele: crie ${PASTA_FRAGMENTOS}/<branch>.md (veja o README da pasta), que vira as notas da release.`);
    // Item novo direto no topo do CHANGELOG: é o que dava conflito entre PRs.
    if (antes !== agora) console.log(`::warning file=docs/CHANGELOG.md::Este PR escreve direto em "Ainda não lançado" do CHANGELOG, o que dá conflito com as outras PRs: mova o item para ${PASTA_FRAGMENTOS}/<branch>.md.`);
  }
}
