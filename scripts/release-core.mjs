// Regras da release, puras (testadas em scripts/tests/release-core.test.mjs): qual o próximo build staging, se um
// commit pode virar release estável e quais produtos cada canal publica. O release.mjs só executa.

const STAGING = /^v(\d+\.\d+\.\d+)-staging\.(\d+)$/;

/** Próximo N do staging de `versao`, pelas tags que já existem (v0.2.0-staging.1, .2 → 3). */
export function proximaStaging(versao, tags) {
  let n = 0;
  for (const t of tags) { const m = STAGING.exec(t.trim()); if (m !== null && m[1] === versao) n = Math.max(n, Number(m[2])); }
  return n + 1;
}

/**
 * Promoção: a release estável v<versao> só sai de um commit que já foi publicado como staging DESSA versão
 * (alguma tag v<versao>-staging.N apontando para o HEAD). Devolve o motivo da recusa, ou null se pode.
 */
export function recusaPromocao(versao, tagsNoHead) {
  const st = tagsNoHead.map((t) => STAGING.exec(t.trim())).filter((m) => m !== null);
  if (st.length === 0) return `este commit não foi publicado como staging. Publique e aprove antes: npm run release:staging (e teste o v${versao}-staging.N instalado)`;
  if (!st.some((m) => m[1] === versao)) return `o staging deste commit é de outra versão (${st.map((m) => m[0]).join(", ")}); o package.json diz ${versao}`;
  return null;
}

/** Produtos que cada canal publica: staging = as linhas staging; estável = as estáveis (o admin inclusive). */
export const produtosDoCanal = (produtos, canal) => produtos.filter((p) => p.canal === canal);
/** Os do canal que também saem com o instalador .dmg (o app das pessoas: campo `instalador` em variant-core.ts). */
export const produtosComInstalador = (produtos, canal) => produtosDoCanal(produtos, canal).filter((p) => p.instalador === true);

/**
 * Componentes que mudaram desde a última release sem subir a versão (as máquinas só atualizam para cima: sem a
 * versão nova, a mudança nunca chega a elas). `componentes` vem de dist/main/maquina/backend-bundle-core.js (COMPONENTES);
 * `mudancas` = caminhos do `git diff --name-only <tag>..HEAD`; `versoes[nome]` = {antes, agora} lidas do arquivo de
 * versão nos dois pontos. Devolve uma linha por componente a corrigir (vazio = pode publicar).
 */
export function componentesSemVersao(componentes, mudancas, versoes) {
  const mudou = new Set(mudancas.map((m) => m.trim()).filter(Boolean));
  const out = [];
  for (const c of componentes) {
    const tocados = c.arquivos.filter((f) => mudou.has(f));
    if (tocados.length === 0) continue;
    const v = versoes[c.nome] ?? { antes: null, agora: null };
    if (v.agora !== null && v.agora !== v.antes) continue;
    out.push(`${c.nome}: mudou (${tocados.slice(0, 3).join(", ")}${tocados.length > 3 ? ` e mais ${tocados.length - 3}` : ""}) e a versão em ${c.versao} continua ${v.agora ?? "sem versão"}; suba a versão`);
  }
  return out;
}

/** Versão de um arquivo de versão: VERSION é texto puro; package.json, o campo `version`; plugin.yaml, a linha `version:`. null = ausente/ilegível. */
export function lerVersao(caminho, conteudo) {
  if (conteudo === null || conteudo === undefined) return null;
  if (caminho.endsWith(".json")) { try { const v = JSON.parse(conteudo).version; return typeof v === "string" && v !== "" ? v : null; } catch { return null; } }
  if (/\.ya?ml$/.test(caminho)) { const m = /^version:\s*["']?([\w.-]+)["']?\s*$/m.exec(String(conteudo)); return m === null ? null : m[1]; }
  const t = String(conteudo).trim();
  return t === "" ? null : t;
}

/** Os clients OAuth do Google que a release publica como assets avulsos (assinados): só os que existem em config/ neste Mac. */
export const CLIENTES_GOOGLE = ["google-oauth.json", "google-conta-oauth.json"];
export const clientesGoogleParaPublicar = (existe) => CLIENTES_GOOGLE.filter((n) => existe(`config/${n}`));

/**
 * Corpo da release: a seção "Ainda não lançado" do `docs/CHANGELOG.md`, que já é escrita em linguagem de quem usa.
 * Sem ela a release sairia com a lista de commits do GitHub (`--generate-notes`), que descreve o diff, não a mudança.
 * A seção vale para o staging e para a estável do mesmo commit: são a mesma mudança vista pela pessoa. Só depois que
 * a estável sai é que a seção é renomeada para a versão publicada, e uma "Ainda não lançado" nova começa vazia.
 * null = não há seção, ou ela só tem espaço: quem publica decide se escreve ou aceita a lista de commits.
 */
export function notasDaRelease(changelog, fragmentos = "") {
  const linhas = String(changelog ?? "").split("\n");
  const i = linhas.findIndex((l) => /^##\s+Ainda não lançado\s*$/.test(l));
  const corpo = [];
  if (i >= 0) {
    for (const l of linhas.slice(i + 1)) {
      if (/^##\s/.test(l) || /^-{3,}\s*$/.test(l)) break;
      corpo.push(l);
    }
  }
  // Os arquivos de docs/changelog/ (um por PR) vêm antes do que ainda estiver escrito direto no CHANGELOG.
  const texto = [String(fragmentos ?? "").trim(), corpo.join("\n").trim()].filter((t) => t !== "").join("\n\n");
  return texto === "" ? null : texto;
}

/**
 * Itens do CHANGELOG ainda não lançados, um arquivo por PR em `docs/changelog/<branch>.md`: cada PR escreve no seu
 * arquivo, e não no topo do CHANGELOG, onde toda PR mexia nas mesmas linhas e dava conflito. `arquivos` é
 * [{ nome, texto }]; o README.md da pasta e o que não é .md ficam de fora. Ordem pelo nome (estável entre máquinas).
 */
export const PASTA_FRAGMENTOS = "docs/changelog";
export function juntarFragmentos(arquivos) {
  return [...(arquivos ?? [])]
    .filter((a) => /\.md$/i.test(a.nome) && !/^readme\.md$/i.test(a.nome))
    .sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0))
    .map((a) => String(a.texto ?? "").trim())
    .filter((t) => t !== "")
    .join("\n\n");
}

/**
 * `npm run release -- --conferir` (skill aprovar-estavel, fase 2): o que ainda impede ou empobrece esta release, depois
 * das recusas que o release.mjs já faz no começo (árvore, gh, tag, promoção, chave, componentes). `erros` param;
 * `avisos` deixam sair. `existe(caminho)` é o existsSync (injetado para o teste).
 */
export function faltasParaPublicar({ produtos, existe, notas }) {
  const erros = [];
  const avisos = [];
  if (produtos.length === 0) erros.push("nenhum produto neste canal");
  const temAdmin = produtos.some((p) => p.caps?.supportAdmin === true);
  if (temAdmin && !existe("build/suporte/admins.json") && !existe("build/suporte/suporte.json")) {
    erros.push("falta build/suporte/ (o meu-bot-admin sairia sem o suporte.json): copie do checkout principal ou rode scripts/suporte-setup.mjs");
  }
  if (notas === null) avisos.push('docs/CHANGELOG.md sem "Ainda não lançado" com conteúdo: a release sairia com a lista de commits do GitHub');
  return { erros, avisos };
}

// ── Release automática (scripts/release-auto.mjs): o que fazer em cada rodada do agente deste Mac ──────────────────

/** Espera depois do último merge antes de soltar o staging: junta merges seguidos numa release só. */
export const QUIETUDE_MS = 10 * 60 * 1000;
/** Quanto o staging fica no ar antes de virar estável (se passou na prova de saúde). */
export const SOAK_MS = 24 * 60 * 60 * 1000;

/** Trava sem PID (gravada por versão antiga do agente) só vale como órfã depois disso: uma rodada com notarização leva horas. */
export const TRAVA_SEM_DONO_MS = 12 * 60 * 60 * 1000;
/**
 * A trava da rodada é órfã quando o processo que a criou não existe mais: o Mac reiniciou no meio de uma rodada (12 nov
 * 2026, esperando a notarização da Apple) e a pasta ficou, travando todas as rodadas seguintes.
 */
export function travaOrfa({ pid, idadeMs, vivo }) {
  if (Number.isInteger(pid) && pid > 0) return !vivo(pid);
  return idadeMs > TRAVA_SEM_DONO_MS;
}

/** Arquivos que, sozinhos, não justificam um staging novo (o PR "Versão: base sobe" só mexe neles). */
const SO_VERSAO = new Set(["package.json", "package-lock.json", "docs/CHANGELOG.md"]);

/** O staging mais novo da versão `base` entre `tags` (ex.: "v0.80.0-staging.2"), ou null. */
export function stagingMaisNovo(base, tags) {
  let melhor = null, n = 0;
  for (const t of tags) { const m = STAGING.exec(t.trim()); if (m !== null && m[1] === base && Number(m[2]) > n) { n = Number(m[2]); melhor = t.trim(); } }
  return melhor;
}

/**
 * Decide a rodada, olhando só para o `origin/main`:
 * - `subir-base`: a estável v<base> já saiu (em qualquer commit) → o PR "Versão: base sobe" ainda não entrou;
 * - `staging`: o HEAD não tem staging desta base e o último commit tem ≥ QUIETUDE_MS;
 * - `promover`: o staging do HEAD tem ≥ SOAK_MS e a saúde passou;
 * - `aguardar`: qualquer outra coisa (o motivo diz o quê; `abrirStaging` pede para abrir o app staging, que só se
 *   atualiza aberto).
 * `mudouDesdeRelease` = arquivos do diff entre a última tag v* e o HEAD (null = não sei).
 * Datas em ms. `saude` = { ok, motivo } de saudeStaging (só conta quando há staging no HEAD).
 */
export function decideRodada({ base, tagsTodas, tagsNoHead, commitEm, stagingEm, saude, agora, mudouDesdeRelease = null }) {
  if (tagsTodas.some((t) => t.trim() === `v${base}`)) return { acao: "subir-base", motivo: `v${base} já é estável: a base do main precisa subir` };
  const tag = stagingMaisNovo(base, tagsNoHead);
  if (tag === null) {
    if (mudouDesdeRelease !== null && mudouDesdeRelease.every((f) => SO_VERSAO.has(f))) return { acao: "aguardar", motivo: "nada novo desde a última release além da versão e do CHANGELOG" };
    const falta = commitEm + QUIETUDE_MS - agora;
    if (falta > 0) return { acao: "aguardar", motivo: `último merge há pouco: staging em ${Math.ceil(falta / 60000)} min, se nada mais entrar` };
    return { acao: "staging", motivo: `main sem staging da ${base}` };
  }
  if (stagingEm === null) return { acao: "aguardar", motivo: `${tag} sem data de publicação no GitHub (release ainda subindo?)` };
  if (saude === null || !saude.ok) return { acao: "aguardar", motivo: `${tag}: ${saude?.motivo ?? "saúde não conferida"}`, abrirStaging: true };
  const falta = stagingEm + SOAK_MS - agora;
  if (falta > 0) return { acao: "aguardar", motivo: `${tag} saudável; vira estável em ${Math.ceil(falta / 3600000)} h` };
  return { acao: "promover", motivo: `${tag} no ar há 24 h, aberto e confirmado neste Mac` };
}

/**
 * Prova de saúde do staging, lida do meu-bot-staging deste Mac: está na versão, veio da release (não de build local),
 * o atualizador confirmou que ela ficou de pé e não voltou para a anterior. `log` = conteúdo do meu-bot.log;
 * `pendente` = update-pendente.json lido (ou null).
 */
export function saudeStaging({ versao, plistVersao, origem, log, pendente }) {
  if (plistVersao === null) return { ok: false, motivo: "meu-bot-staging não está instalado neste Mac" };
  const esc = versao.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`${esc} não passou das primeiras aberturas`).test(log ?? "")) return { ok: false, motivo: `${versao} voltou para a anterior neste Mac (não ficou de pé)`, falhou: true };
  if (plistVersao !== versao) return { ok: false, motivo: `meu-bot-staging deste Mac ainda está na ${plistVersao}` };
  if (origem !== "release") return { ok: false, motivo: "meu-bot-staging deste Mac é build local, não da release" };
  if (pendente !== null && pendente?.para === versao) return { ok: false, motivo: `troca para a ${versao} ainda não confirmada (app precisa ficar 30 s de pé)` };
  if (!new RegExp(`\\[atualização\\] ${esc} confirmada`).test(log ?? "")) return { ok: false, motivo: `o atualizador ainda não confirmou a ${versao}` };
  return { ok: true, motivo: `${versao} confirmada neste Mac` };
}

/** Próxima base depois de uma estável: sobe o minor (0.80.0 → 0.81.0). */
export function proximaBase(base) {
  const [ma, mi] = base.split(".").map(Number);
  return `${ma}.${mi + 1}.0`;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "10 de novembro de 2026" (no fuso de São Paulo). */
export function dataPorExtenso(d) {
  const [a, m, dia] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d).split("-").map(Number);
  return `${dia} de ${MESES[m - 1]} de ${a}`;
}

/**
 * Depois da estável: "Ainda não lançado" vira "## <data> · v<versão>" e um "Ainda não lançado" novo, vazio, entra em
 * cima. null = não há a seção (nada a fazer).
 */
export function fecharChangelog(texto, versao, data, fragmentos = "") {
  const re = /^##[ \t]+Ainda não lançado[ \t]*$/m;
  if (!re.test(texto)) return null;
  // Os arquivos de docs/changelog/ entram no topo da seção datada (quem chama apaga os arquivos no mesmo commit).
  const f = String(fragmentos ?? "").trim();
  return texto.replace(re, () => `## Ainda não lançado\n\n---\n\n## ${data} · v${versao}${f === "" ? "" : `\n\n${f}`}`);
}

/**
 * Dependências diretas (dependencies + devDependencies do package-lock) cuja versão instalada no node_modules não é a
 * do lockfile. A release empacota com o node_modules do Mac: um node_modules velho já soltou a 0.83.0-staging.2 com o
 * Electron 44.7.2 quando o lock pedia 44.10.2. `instalada(nome)` devolve a versão do node_modules/<nome> ou null.
 */
export function dependenciasDesalinhadas(lock, instalada) {
  const pacotes = lock?.packages ?? {};
  const raiz = pacotes[""] ?? {};
  const nomes = [...Object.keys(raiz.dependencies ?? {}), ...Object.keys(raiz.devDependencies ?? {})];
  const erradas = [];
  for (const nome of nomes) {
    const quer = pacotes[`node_modules/${nome}`]?.version;
    if (!quer) continue;
    const tem = instalada(nome);
    if (tem !== quer) erradas.push(`${nome}: o lockfile pede ${quer}, o node_modules tem ${tem ?? "nada"}`);
  }
  return erradas;
}
