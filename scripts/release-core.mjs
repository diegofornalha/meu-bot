// Regras da release, puras (testadas em scripts/tests/release-core.test.mjs): qual o próximo build staging, se um
// commit pode virar release estável e quais produtos cada canal publica. O release.mjs só executa.

import { join } from "node:path";

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

/**
 * Produtos que cada canal publica: staging = as linhas staging; estável = as estáveis (o admin inclusive). Ficam de
 * fora os produtos de módulos (`caps.modulos`, como o meu-bot-diego-staging): eles se empacotam à mão por enquanto
 * (docs/guia/meu-bot-diego.md); os módulos não vão no app, ele os baixa do repositório do produto.
 */
export const produtosDoCanal = (produtos, canal) => produtos.filter((p) => p.canal === canal && (p.caps?.modulos ?? null) === null);
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
  // Produto que sai para Windows precisa do .ico ao lado do .icns: sem ele o empacotamento falharia no meio da release.
  for (const p of produtos) {
    if (p.windows !== true) continue;
    const ico = p.icone.replace(/\.icns$/, ".ico");
    if (!existe(ico)) erros.push(`falta ${ico} (o instalador Windows do ${p.nome}): rode npm run icons`);
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

// ── Site (Worker conta-api): main → staging → produção, nessa ordem e no mesmo histórico ────────────────────────────
// O staging acompanha a main sozinho (agente da release); a produção só recebe o commit que está no staging e que o
// dono aprovou (scripts/site-publicar.mjs --aprovar <sha>, depois --producao).

/** Pasta do estado do agente da release (estado.json, trava, segurar-estavel) e da aprovação do site. */
export const dirDoEstado = ({ env, home }) => env.MEU_BOT_RELEASE_DIR ?? join(home, "Library", "Application Support", "meu-bot-release");
/** A aprovação do site, dentro da pasta de estado: { sha, aprovadoEm, roteiro }. */
export const ARQUIVO_APROVACAO = "site-aprovado.json";

/** Onde cada ambiente do site responde: `site` é a home, `conta` é a API (o /health). */
export const SITE_NO_AR = {
  staging: { site: "https://site-staging.agentesgrok.com", conta: "https://conta-staging.agentesgrok.com" },
  producao: { site: "https://agentesgrok.com", conta: "https://conta.agentesgrok.com" },
};

const SHA = /^[0-9a-f]{40}$/;
/** É um sha completo de commit (40 hexadecimais minúsculos)? */
export const ehSha = (v) => typeof v === "string" && SHA.test(v);
/**
 * O commit que o /health diz estar no ar. null = desconhecido: o ambiente não respondeu, ou foi publicado antes do
 * portão ou à mão (sem a variável COMMIT). Desconhecido não é erro, só não prova nada.
 */
export const commitNoAr = (health) => (ehSha(health?.commit) ? health.commit : null);

const ESTAVEL = /^v(\d+)\.(\d+)\.(\d+)$/;
/** A estável mais nova entre `tags` (ex.: "v0.83.0"), ou null. */
export function estavelMaisNova(tags) {
  let melhor = null, chave = null;
  for (const t of tags) {
    const m = ESTAVEL.exec(t.trim()); if (m === null) continue;
    const k = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (chave === null || k[0] > chave[0] || (k[0] === chave[0] && (k[1] > chave[1] || (k[1] === chave[1] && k[2] > chave[2])))) { chave = k; melhor = t.trim(); }
  }
  return melhor;
}

/**
 * O staging do site acompanha a main: o que a rodada faz com ele.
 * `main` = sha do origin/main; `stagingDe` = commit publicado no staging (o /health dele quando responde, senão o
 * estado do agente; null = desconhecido); `mudouSite` = conta-api/ difere entre `stagingDe` e `main` (null = não deu
 * para comparar).
 * - `publicar`: o staging não tem o conta-api da main (ou não dá para provar que tem);
 * - `nada`: staging em dia, ou a última tentativa falhou há menos de `esperaMs`.
 */
export function decideSiteStaging({ main, stagingDe = null, mudouSite = null, falhouEm = null, agora, esperaMs }) {
  if (stagingDe === main) return { acao: "nada" };
  if (stagingDe !== null && mudouSite === false) return { acao: "nada" };
  if (falhouEm !== null && agora - falhouEm < esperaMs) return { acao: "nada", motivo: "a última publicação do site falhou há pouco" };
  if (stagingDe === null) return { acao: "publicar", motivo: "não sei qual commit está no staging do site" };
  if (mudouSite === null) return { acao: "publicar", motivo: `não consegui comparar conta-api com o commit ${stagingDe.slice(0, 12)} do staging` };
  return { acao: "publicar", motivo: `conta-api mudou na main desde o commit ${stagingDe.slice(0, 12)} do staging` };
}

/**
 * Saiu estável nova: o que a rodada faz com a PRODUÇÃO do site. Ela não é mais publicada sozinha; o agente só avisa
 * que há o que aprovar. `siteDe` = a estável que o site já acompanhou (estado do agente).
 * - `marcar`: só anota a estável (primeira rodada do agente, ou conta-api não mudou desde `siteDe`);
 * - `avisar`: saiu estável nova (pelo agente ou à mão) e conta-api mudou: avisa uma vez e anota a estável;
 * - `nada`: já anotada.
 */
export function decideSite({ ultimaEstavel, siteDe = null, mudouSite }) {
  if (ultimaEstavel === null || siteDe === ultimaEstavel) return { acao: "nada" };
  if (siteDe === null) return { acao: "marcar", motivo: `primeira rodada: o site já estava no ar quando a ${ultimaEstavel} saiu` };
  if (!mudouSite) return { acao: "marcar", motivo: `conta-api não mudou desde a ${siteDe}` };
  return { acao: "avisar", motivo: `${ultimaEstavel} saiu e conta-api mudou desde a ${siteDe}` };
}

/**
 * `--so-staging`: o staging do site é a main, nunca um ramo. `head` = HEAD do worktree de onde se publica; `main` = sha
 * do origin/main (null = o git não soube dizer); `atualizada` = o `git fetch origin` de agora deu certo (sem ele, o
 * origin/main local pode ser velho e não prova nada). Devolve { ok: true } ou { erro }.
 */
export function podePublicarStaging({ head, main, atualizada = true }) {
  const caminho = "O caminho: abra a PR e mescle; o staging recebe a main sozinho (agente da release, em até 10 min), ou rode --so-staging de um worktree no origin/main";
  if (!atualizada) return { erro: `não consegui atualizar o origin/main (git fetch origin falhou: este Mac sem rede ou sem acesso ao GitHub?), então não dá para provar que este commit é a main. ${caminho}` };
  if (!ehSha(main)) return { erro: `não sei qual commit é o origin/main (git rev-parse origin/main não respondeu). ${caminho}` };
  if (!ehSha(head)) return { erro: "não consegui ler o commit deste worktree (git rev-parse HEAD)" };
  if (head !== main) return { erro: `este worktree está no commit ${head}, e o origin/main é ${main}. Ramo não vai para o staging: ele é sempre a main. ${caminho}. Para ver um ramo antes do merge, rode o Worker local (skill publicar-site)` };
  return { ok: true };
}

/**
 * `--aprovar <sha>`: só se aprova o commit que está no staging agora. `commitStaging` = commitNoAr do /health do
 * staging (null = desconhecido). Devolve { ok: true } ou { erro }.
 */
export function podeAprovar({ sha, commitStaging }) {
  if (!ehSha(sha)) return { erro: "diga o commit inteiro (40 caracteres): node scripts/site-publicar.mjs --aprovar <sha>" };
  if (commitStaging === null) return { erro: "o staging não diz qual commit está no ar (/health sem commit: sem resposta, ou publicado antes do portão ou à mão). Publique o staging por este script e aprove o commit que ele mostrar" };
  if (commitStaging !== sha) return { erro: `o staging está no commit ${commitStaging}, não no ${sha}. Só se aprova o que está no staging` };
  return { ok: true };
}

/**
 * `--producao`: a produção só recebe o commit aprovado, que tem de ser o que está no staging e o do worktree de onde
 * se publica. `aprovado` = sha da aprovação gravada (null = não há); `head` = HEAD do worktree; `commitStaging` =
 * commitNoAr do staging; `limpo` = conta-api/ sem mudança fora do commit; `naMain` = o commit está no origin/main.
 * Devolve { ok: true } ou { erro }.
 */
export function podePublicarProducao({ aprovado, head, commitStaging, limpo = true, naMain = true }) {
  if (!ehSha(aprovado)) return { erro: "não há aprovação do site. Confira o staging e aprove o commit dele: node scripts/site-publicar.mjs --aprovar <sha>" };
  if (head !== aprovado) return { erro: `o commit aprovado é ${aprovado}, e este worktree está em ${head ?? "um commit que não consegui ler"}. Publique de um worktree no commit aprovado` };
  if (commitStaging === null) return { erro: "o staging não diz qual commit está no ar (/health sem commit ou sem resposta): não dá para provar que a produção recebe o que foi conferido" };
  if (commitStaging !== aprovado) return { erro: `o staging andou: está no commit ${commitStaging}, e o aprovado é ${aprovado}. Confira o staging de novo e aprove o commit que está lá` };
  if (!limpo) return { erro: "conta-api/ tem mudanças fora do commit neste worktree: o que subiria não é o commit aprovado" };
  if (!naMain) return { erro: `o commit ${aprovado} não está no origin/main: a produção só recebe o que passou pela main` };
  return { ok: true };
}

/**
 * A ordem dos ambientes: a produção tem de ser um ancestral do staging (o mesmo histórico, o staging na frente).
 * `ancestral` = resultado do `git merge-base --is-ancestor <producao> <staging>`: true, false ou null (o git não
 * conhece um dos commits). Devolve { ok, texto }; `ok` null = não dá para dizer.
 */
export function ordemDosAmbientes({ staging, producao, ancestral = null }) {
  if (producao === null) return { ok: null, texto: "produção com commit desconhecido (publicada antes do portão ou à mão): a ordem só aparece depois da primeira publicação pelo script" };
  if (staging === null) return { ok: null, texto: "staging com commit desconhecido: não dá para comparar com a produção" };
  if (staging === producao) return { ok: true, texto: "produção e staging no mesmo commit" };
  if (ancestral === null) return { ok: null, texto: "não consegui comparar os commits neste clone (git fetch origin e rode de novo)" };
  if (ancestral) return { ok: true, texto: "a produção é um ancestral do staging (o staging está na frente, no mesmo histórico)" };
  return { ok: false, texto: "a produção NÃO é um ancestral do staging: ela tem um commit que não passou por ele" };
}

/**
 * As vars de cada ambiente no conta-api/wrangler.toml: `[vars]` é a produção, `[env.staging.vars]` o staging.
 * Devolve { producao: { CHAVE: valor }, staging: { … } }, com os valores como texto (o que o Worker recebe).
 */
export function varsDoWrangler(toml) {
  const secoes = { vars: "producao", "env.staging.vars": "staging" };
  const out = { producao: {}, staging: {} };
  let ambiente = null;
  for (const bruta of String(toml ?? "").split("\n")) {
    const linha = bruta.trim();
    if (linha === "" || linha.startsWith("#")) continue;
    const secao = /^\[+\s*([^\]]+?)\s*\]+$/.exec(linha);
    if (secao !== null) { ambiente = secoes[secao[1]] ?? null; continue; }
    if (ambiente === null) continue;
    const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(linha);
    if (m === null) continue;
    let valor = m[2];
    const literal = /^'([^']*)'/.exec(valor), basica = /^"((?:[^"\\]|\\.)*)"/.exec(valor);
    if (literal !== null) valor = literal[1];
    else if (basica !== null) { try { valor = JSON.parse(`"${basica[1]}"`); } catch { valor = basica[1]; } }
    else valor = valor.replace(/\s+#.*$/, "");
    out[ambiente][m[1]] = valor;
  }
  return out;
}

/** Páginas que têm de responder 200 em cada canal (o staging fica fora dos buscadores pelo cabeçalho, sem sitemap). */
export const PAGINAS_DO_SITE = { staging: ["/", "/obrigado"], producao: ["/", "/obrigado", "/robots.txt", "/sitemap.xml", "/llms.txt"] };

/**
 * O que está errado no site no ar (lista vazia = conferido). `health` = corpo JSON de /health (ou null),
 * `download` = corpo JSON de /download/mac.json (ou null), `paginas` = { caminho: status HTTP }.
 */
export function faltasDoSite({ canal, health, download, paginas }) {
  const f = [];
  if (health?.ok !== true || health?.canal !== canal) f.push(`/health não respondeu {"ok":true,"canal":"${canal}"}`);
  if (typeof download?.versao !== "string" || typeof download?.nome !== "string" || typeof download?.url !== "string") f.push("/download/mac.json sem versao, nome ou url");
  else if (canal === "producao" && !/^\d+\.\d+\.\d+$/.test(download.versao)) f.push(`produção entregando ${download.versao}, que não é estável`);
  for (const c of PAGINAS_DO_SITE[canal]) if (paginas?.[c] !== 200) f.push(`${c} respondeu ${paginas?.[c] ?? "nada"}`);
  return f;
}

/** O objeto que o /config.js do site entrega (`window.MEU_BOT_CONTA = {…};`), ou null se não for isso. */
export function lerConfigJs(texto) {
  const m = /^\s*window\.MEU_BOT_CONTA\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(String(texto ?? ""));
  if (m === null) return null;
  try { const o = JSON.parse(m[1]); return o !== null && typeof o === "object" ? o : null; } catch { return null; }
}

const idsDeMedicao = (v) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean).join(",");
/**
 * Conferência de conteúdo, além dos 200: o que o site no ar mostra bate com a configuração do ambiente?
 * `home` = { status, texto } de `/`; `configJs` = { status, texto } de `/config.js` do site; `health` = corpo JSON de
 * /health; `esperado` = { trialDias, ga, commit }: TRIAL_DIAS e GA_ID do ambiente no wrangler.toml e o commit recém
 * publicado (`commit` undefined = não conferir, como no --conferir avulso).
 * Devolve { faltas, desfazer }: `desfazer` só quando a própria página respondeu (200) com o conteúdo errado; sem
 * resposta, ou só o commit faltando no /health, não prova que o deploy é ruim.
 */
export function faltasDeConteudo({ canal, home, configJs, health, esperado }) {
  const faltas = [];
  let desfazer = false;
  const dias = Number(esperado?.trialDias);
  if (Number.isInteger(dias) && dias > 0 && home?.status === 200) {
    const ditos = [...String(home.texto ?? "").matchAll(/(\d+) dias grátis/g)].map((m) => m[1]);
    const errados = [...new Set(ditos.filter((d) => d !== String(dias)))];
    if (ditos.length === 0) { faltas.push(`a home não cita o teste grátis ("${dias} dias grátis")`); desfazer = true; }
    else if (errados.length > 0) { faltas.push(`a home diz ${errados.join(" e ")} dias grátis; o TRIAL_DIAS deste ambiente é ${dias}`); desfazer = true; }
  }
  if (configJs?.status === 200) {
    const cfg = lerConfigJs(configJs.texto);
    if (cfg === null) { faltas.push("/config.js do site não é o window.MEU_BOT_CONTA esperado"); desfazer = true; }
    else {
      if (cfg.canal !== canal) { faltas.push(`/config.js do site diz canal "${cfg.canal ?? ""}", esperado "${canal}"`); desfazer = true; }
      const ga = idsDeMedicao(esperado?.ga);
      if (idsDeMedicao(cfg.ga) !== ga) { faltas.push(`/config.js do site com a medição "${cfg.ga ?? ""}", esperado "${ga}" (GA_ID deste ambiente)`); desfazer = true; }
    }
  } else { faltas.push(`/config.js do site respondeu ${configJs?.status || "nada"}`); if (typeof configJs?.status === "number" && configJs.status !== 0) desfazer = true; }
  if (esperado?.commit !== undefined && commitNoAr(health) !== esperado.commit) faltas.push(`/health diz commit ${commitNoAr(health) ?? "desconhecido"}, esperado ${esperado.commit}`);
  return { faltas, desfazer };
}

/**
 * Conferência reprovada depois de um deploy: desfazer só quando o próprio Worker respondeu errado (/health com outro
 * canal, página com erro). Sem resposta (status 0: este Mac sem rede) ou só o /download/mac.json falhando (ele depende
 * do GitHub) não prova nada contra o deploy: ele fica, e a publicação é tentada de novo.
 * `statusHealth` e `paginas` são status HTTP (0 = sem resposta).
 */
export function desfazDeploy({ canal, health, statusHealth, paginas }) {
  if (statusHealth !== 0 && (health?.ok !== true || health?.canal !== canal)) return true;
  return PAGINAS_DO_SITE[canal].some((c) => typeof paginas?.[c] === "number" && paginas[c] !== 0 && paginas[c] !== 200);
}

// ── O agente no launchd ────────────────────────────────────────────────────────────────────────────────────────

const xml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/**
 * O plist do agente. O launchd parte do checkout principal, que existe enquanto o repositório existir, e não do
 * worktree da release: em 14 nov 2026 a pasta ../meu-bot-release foi apagada da Mesa e o agente, que morava nela,
 * ficou dois dias saindo com 78 (EX_CONFIG) sem publicar nada. Agora a partida recria o worktree que sumiu
 * (`git worktree prune` + `add`) e só então roda o agente de dentro dele.
 * A partida é do próprio node (`node -e`), não um `sh -c`: a permissão do macOS para ler a Mesa é do executável que o
 * launchd chama, e o /bin/sh não a tem ("getcwd: Operation not permitted").
 */
export function plistDoAgente({ rotulo, node, principal, wt, path, log, intervalo = 600 }) {
  const partida = [
    `const { existsSync } = require("node:fs"), { spawnSync } = require("node:child_process");`,
    `const p = ${JSON.stringify(principal)}, wt = ${JSON.stringify(wt)};`,
    // O fetch pode falhar sem rede (o origin/main local serve); prune e add têm de dar certo, senão sai com o motivo.
    `if (!existsSync(wt + "/.git")) for (const a of [["worktree", "prune"], ["fetch", "-q", "origin", "main"], ["worktree", "add", "-q", "--detach", wt, "origin/main"]]) { if (spawnSync("git", a, { cwd: p, stdio: "inherit" }).status !== 0 && a[0] !== "fetch") { console.error(new Date().toISOString() + " ✗ não recriei o worktree da release: git " + a.join(" ")); process.exit(1); } }`,
    `process.exit(spawnSync(process.execPath, [wt + "/scripts/release-auto.mjs", "--run"], { cwd: wt, stdio: "inherit" }).status ?? 1);`,
  ].join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(rotulo)}</string>
  <key>ProgramArguments</key><array><string>${xml(node)}</string><string>-e</string><string>${xml(partida)}</string></array>
  <key>WorkingDirectory</key><string>${xml(principal)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
  <key>StartInterval</key><integer>${intervalo}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;
}

