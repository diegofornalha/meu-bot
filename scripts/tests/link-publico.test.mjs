import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../../dist/main/admin/link-publico-core.js");
const cli = require("../../dist/main/agente/link-publico.js");
const page = await import("../../dist/renderer/admin/link-publico-page.js");

test("link público: o nginx só em 127.0.0.1, por subdomínio, sem listar pastas nem seguir symlink de outro dono; regex entre aspas (chaves)", () => {
  const n = core.nginxSite("agentesgrok.com");
  assert.match(n, /listen 127\.0\.0\.1:8099;/); assert.doesNotMatch(n, /listen 80|listen 443/);
  assert.match(n, /server_name "~\^\(\?<sub>\[a-z0-9\]\(\[a-z0-9-\]\{0,61\}\[a-z0-9\]\)\?\)\\\.agentesgrok\\\.com\$";/, "regex com chaves vai entre aspas, senão o nginx recusa");
  assert.match(n, /root \/var\/www\/publico\/\$sub;/); assert.match(n, /autoindex off;/); assert.match(n, /disable_symlinks if_not_owner from=\/var\/www\/publico;/);
  assert.match(n, /default_server; server_name _; return 404;/, "outro host: 404");
  assert.match(n, /include \/etc\/nginx\/mime\.types;\n\s+types \{ text\/markdown md markdown; \}/, "o .md sai como texto (sem tipo o navegador baixava)");
  assert.match(n, /charset utf-8;/);
  assert.match(n, /absolute_redirect off;/, "pasta sem barra: Location relativo, não http://host:8099/");
});

test("link público: instalar valida o domínio, grava config, modelos, site e os dois comandos; a pasta dos links é root 1733", () => {
  const sh = core.lpInstalarSh("agentesgrok.com");
  assert.match(sh, /^\[ "\$\(id -u\)" = 0 \]/m, "só root");
  assert.match(sh, /chmod 1733 \/var\/www\/publico/); assert.match(sh, /chmod 755 \/etc\/meu-bot-link-publico/, "os usuários leem o domínio e os modelos daqui (não de /etc/meu-bot, que é 700)");
  assert.match(sh, /"dominio": "agentesgrok.com", "porta": 8099/);
  assert.match(sh, /cat > \/usr\/local\/bin\/publicar <<'EOF_PUB'/); assert.match(sh, /cat > \/usr\/local\/bin\/link-publico-nome <<'EOF_NOME'/);
  assert.match(sh, /cat > \/etc\/meu-bot-link-publico\/md2html\.py <<'EOF_MD'\n#!\/usr\/bin\/env python3/, "conversor de markdown vai junto");
  assert.match(sh, /apt-get -y -qq install python3-markdown/);
  assert.match(sh, /cloudflared-linux-\$a\.deb/); assert.match(sh, /^echo "INSTALADO=ok"$/m);
  assert.throws(() => core.lpInstalarSh("agentes grok.com"), /domínio inválido/);
  assert.throws(() => core.lpInstalarSh("x; rm -rf /"), /domínio inválido/);
});

test("link público: ligar cria a pasta (dona o usuário), respeita um nome já trocado, e o que vai no home é gravado por ele; desligar guarda a pasta", () => {
  const sh = core.lpLigarSh("box-2");
  assert.match(sh, /mkdir "\$D"; chown box-2:box-2 "\$D"; chmod 755 "\$D"/);
  assert.match(sh, /\.desligado-box-2/, "voltar do desligado");
  assert.match(sh, /runuser -u box-2 -- sh -c '\n  ln -sfn "\$1" "\$HOME\/publico"/, "quem grava no home é o usuário");
  assert.match(sh, /\.hermes\/skills\/meu-bot-link-publico\/SKILL\.md/); assert.match(sh, /agent-workspace\/CLAUDE\.md/);
  assert.doesNotMatch(sh, /chown [^\n]*\$H\//, "o root não dá chown dentro do home");
  assert.match(sh, /^echo "LINK=ok \$NOME\$\{AV:\+ \$AV\}"$/m, "o ligar diz o que pulou");
  assert.match(sh, /else echo sem-hermes; fi/); assert.match(sh, /else echo sem-workspace; fi/);
  assert.ok(sh.includes(core.LP_AGENTE_SH), "ligar e atualizar usam o mesmo corpo");
  assert.throws(() => core.lpLigarSh("box-2; id"), /inválido/);
  const d = core.lpDesligarSh("box-2");
  assert.match(d, /mv "\$A" "\/var\/www\/publico\/\.desligado-box-2"/); assert.match(d, /rm -rf "\$HOME\/\.hermes\/skills\/meu-bot-link-publico"/); assert.match(d, /^echo "LINK=desligado"$/m);
});

test("link público: túnel cria uma vez (deleted_at dos vivos vem como 0001-…), rota curinga e serviço; login sobe o cloudflared solto e devolve o link", () => {
  const sh = core.lpTunelSh("agentesgrok.com");
  assert.match(sh, /startswith\("0001"\)/, "túnel vivo tem deleted_at 0001-01-01, não vazio");
  assert.match(sh, /hostname: "\*\.agentesgrok\.com"\n    service: http:\/\/127\.0\.0\.1:8099\n  - service: http_status:404/);
  assert.match(sh, /cloudflared tunnel route dns meu-bot-publico "\*\.agentesgrok\.com"/); assert.match(sh, /^echo "TUNEL=ok \$ID"$/m);
  assert.match(core.LP_LOGIN_SH, /setsid nohup cloudflared tunnel login/); assert.match(core.LP_LOGIN_SH, /pkill -f '\^cloudflared tunnel login'/, "o pkill ancorado não mata o próprio bash");
  assert.match(core.LP_LOGIN_SH, /echo "URL=\$u"/);
});

test("link público: os comandos do usuário recusam fora da pasta dos links, limpam o nome e trocam o subdomínio com regras", () => {
  assert.match(core.PUBLICAR_SH, /case "\$ALVO" in \/var\/www\/publico\/\*\) ;; \*\) echo "ERRO: o seu link público não está ligado/);
  assert.match(core.PUBLICAR_SH, /tr -c 'A-Za-z0-9\._-' '-'/, "nome no link só com caracteres seguros");
  assert.match(core.PUBLICAR_SH, /case "\$N" in ""\|\.\|\.\.\|\.\*\) echo "ERRO: nome inválido"/, "--remover .. não passa");
  assert.match(core.PUBLICAR_SH, /\[ -e "\$ALVO\/\$N" \] \|\| \{ echo "ERRO: não está no ar/);
  assert.match(core.PUBLICAR_SH, /cp -f "\$ARQ" "\$ALVO\/\$DEST" \|\| \{ echo "\$SEM_ESPACO"/, "cp falhando vira ERRO, não URL");
  assert.match(core.PUBLICAR_SH, /cp -r "\$ARQ" "\$ALVO\/\$DEST" \|\|/);
  assert.match(core.PUBLICAR_SH, /case "\$ARQ" in \*\.md\|\*\.MD\|\*\.markdown\)/, "md vira página");
  assert.match(core.PUBLICAR_SH, /DEST=\$\{DEST%\.md\}/, "a URL do .md fica sem extensão (…/fluxo/)");
  assert.match(core.PUBLICAR_SH, /python3 \/etc\/meu-bot-link-publico\/md2html\.py "\$ARQ" > "\$ALVO\/\$DEST\/index\.html"/);
  assert.match(core.PUBLICAR_SH, /cp -f "\$ARQ" "\$ALVO\/\$DEST\/\$DEST\.md"/, "o .md original fica ao lado da página");
  assert.match(core.MD2HTML_PY, /import markdown/); assert.match(core.MD2HTML_PY, /except ImportError:\n\s+corpo = "<pre>"/, "sem o módulo, ainda sai página");
  assert.match(core.MD2HTML_PY, /lang="pt-BR"/); assert.match(core.MD2HTML_PY, /prefers-color-scheme:dark/);
  assert.match(core.skillLinkPublico("agentesgrok.com"), /publicar fluxo-atendimento\.md.*fluxo-atendimento\//, "a skill diz que .md vira página");
  assert.match(core.LINK_NOME_SH, /www\|admin\|api\|mail/, "nomes reservados");
  assert.match(core.LINK_NOME_SH, /getent passwd "\$NOVO"/, "nome de outro usuário não vale");
  assert.match(core.LINK_NOME_SH, /mv "\/var\/www\/publico\/\$ATUAL" "\/var\/www\/publico\/\$NOVO"/, "a pasta é dele: renomeia sem root (sticky bit)");
  assert.match(core.skillLinkPublico("agentesgrok.com"), /^name: meu-bot-link-publico$/m); assert.match(core.skillLinkPublico("agentesgrok.com"), /https:\/\/<nome>\.agentesgrok\.com\//);
  assert.match(core.claudeMdLinkPublico("agentesgrok.com"), /<!-- meu-bot:link-publico v1 inicio -->[\s\S]*<!-- meu-bot:link-publico v1 fim -->/);
});

test("link público: estado lido da linha ESTADO=, com usuários e link validados; etapa da aba em ordem", () => {
  const e = core.lerEstadoLp(`x\nESTADO=${JSON.stringify({ instalado: true, nginx: true, login: true, loginUrl: "https://dash.cloudflare.com/argotunnel?x", tunel: "afb28655-3bbe-406a-9f5a-c1f9c3bef802", servico: true, rota: true, dominio: "agentesgrok.com", usuarios: [{ nome: "box-2", ligado: true, link: "daniel", arquivos: 3 }, { nome: "x;y", ligado: true }, { nome: "box-3", ligado: true, link: "Ruim Nome", arquivos: 0 }] })}\n`);
  assert.equal(e.dominio, "agentesgrok.com"); assert.equal(e.usuarios.length, 2); assert.equal(e.usuarios[0].link, "daniel"); assert.equal(e.usuarios[1].link, null, "link fora do padrão não passa");
  assert.equal(core.lerEstadoLp("NAOROOT\n"), null);
  assert.equal(page.etapaLp({ ...e, instalado: false }), "instalar"); assert.equal(page.etapaLp({ ...e, login: false }), "entrar");
  assert.equal(page.etapaLp({ ...e, tunel: null }), "tunel"); assert.equal(page.etapaLp({ ...e, servico: false }), "tunel"); assert.equal(page.etapaLp(e), "pronto");
});

test("link público da pessoa: lê LINK=1 + json; desligado, json torto ou nome fora do padrão → null", () => {
  const ok = cli.lerLinkPublico('LINK=1 2 box-2\n{"url": "https://daniel.agentesgrok.com/", "nome": "daniel", "dominio": "agentesgrok.com"}\n');
  assert.deepEqual(ok, { url: "https://daniel.agentesgrok.com/", nome: "daniel", dominio: "agentesgrok.com", arquivos: 2, usuario: "box-2" });
  assert.equal(cli.lerLinkPublico("LINK=0\n"), null);
  assert.deepEqual(cli.lerLinkPublicoStatus("LINK=root\n"), { info: null, possivel: false, global: false }, "janela do root: sem link por desenho");
  assert.deepEqual(cli.lerLinkPublicoStatus("GLOBAL=0\nLINK=0\n"), { info: null, possivel: true, global: false }, "máquina sem o Link Público Global: é o admin quem instala");
  assert.deepEqual(cli.lerLinkPublicoStatus("GLOBAL=1\nLINK=0\n"), { info: null, possivel: true, global: true }, "global na máquina, link da pessoa desligado");
  assert.equal(cli.lerLinkPublicoStatus('GLOBAL=1\nLINK=1 2 box-2\n{"url": "https://daniel.agentesgrok.com/", "nome": "daniel", "dominio": "agentesgrok.com"}\n').global, true);
  assert.equal(cli.lerLinkPublicoStatus('LINK=1 2 box-2\n{"url": "https://daniel.agentesgrok.com/", "nome": "daniel", "dominio": "agentesgrok.com"}\n').info.nome, "daniel");
  assert.equal(cli.lerLinkPublico('LINK=1 0 box-2\n{"url": "javascript:x", "nome": "daniel", "dominio": "agentesgrok.com"}\n'), null);
  assert.equal(cli.lerLinkPublico('LINK=1 0 box-2\n{"url": "https://a.b/", "nome": "Ruim Nome", "dominio": "b"}\n'), null);
});

test("link público: atualizar a instalação refaz skill e CLAUDE.md de quem está ligado, como cada um; o ligar e o atualizar dizem o que pularam", () => {
  const sh = core.lpAtualizarAgentesSh();
  assert.match(sh, /^\[ "\$\(id -u\)" = 0 \]/m, "só root");
  assert.match(sh, /getent passwd \| awk/); assert.match(sh, /case "\$A" in \/var\/www\/publico\/\*\)/);
  assert.match(sh, /runuser -u "\$u" -- sh -c '/, "quem grava no home é o usuário"); assert.doesNotMatch(sh, /chown/);
  assert.ok(sh.includes(core.LP_AGENTE_SH)); assert.match(sh, /^echo "AGENTES=ok \$N"$/m);
  assert.deepEqual(core.lerAgentes("AGENTE=box-2 daniel sem-workspace\nAGENTE=x;y z\nAGENTE=box-4 box-4\nAGENTES=ok 2\n"), [{ usuario: "box-2", nome: "daniel", avisos: ["sem-workspace"] }, { usuario: "box-4", nome: "box-4", avisos: [] }]);
  assert.deepEqual(core.lerLinkOk("LINK=ok box-2 sem-hermes sem-workspace sem-hermes\n"), { nome: "box-2", avisos: ["sem-hermes", "sem-workspace"] });
  assert.deepEqual(core.lerLinkOk("LINK=ok daniel\n"), { nome: "daniel", avisos: [] });
  assert.deepEqual(core.lerLinkOk("LINK=ok daniel bobagem\n"), { nome: "daniel", avisos: [] }, "aviso desconhecido é ignorado");
  assert.equal(core.lerLinkOk("ERRO=x\n"), null); assert.equal(core.lerLinkOk("LINK=ok Ruim Nome\n"), null);
  assert.match(core.textoAvisos(["sem-hermes"]), /não tem Hermes.*prepare a conta na aba Usuários/); assert.equal(core.textoAvisos([]), "");
});

test("link público: publicar e tirar do ar pelo admin rodam o `publicar` COMO o usuário (runuser, caminho absoluto); o root só entrega em /tmp e limpa a passagem", () => {
  const st = "/tmp/meu-bot-publicar-0123456789ab";
  const sh = core.lpPublicarSh("box-4", st, "arquivo.md", "fluxo");
  assert.match(sh, /runuser -u box-4 -- \/usr\/local\/bin\/publicar "\$F" 'fluxo'/);
  assert.match(sh, /chown root:box-4 "\$S" "\$F" && chmod 750 "\$S" && chmod 640 "\$F"/, "só o grupo dele lê, e só em /tmp");
  assert.doesNotMatch(sh, /chown [^\n]*publico/); assert.doesNotMatch(sh, /chown [^\n]*\$HOME/);
  assert.ok((sh.match(/rm -rf "\$S"/g) ?? []).length >= 4, "a passagem some em todo caminho");
  assert.match(sh, /echo "PUBLICADO=\$\(printf/); assert.match(sh, /echo "ERRO=\$\(printf[^\n]*sed 's\/\^ERRO: \/\/'/);
  assert.match(core.lpStageSh(st), /mkdir -m 700 '\/tmp\/meu-bot-publicar-0123456789ab' && echo "STAGE=ok"/);
  assert.throws(() => core.lpPublicarSh("box-4; id", st, "arquivo.md", "fluxo"), /inválido/);
  assert.throws(() => core.lpPublicarSh("box-4", "/tmp/x", "arquivo.md", "fluxo"), /passagem inválida/);
  assert.throws(() => core.lpPublicarSh("box-4", st, "../etc", "fluxo"), /arquivo inválido/);
  for (const ruim of [".ssh", "a b", "a/b", "", "x".repeat(129)]) assert.throws(() => core.lpPublicarSh("box-4", st, "arquivo.pdf", ruim), /item inválido/, `nome ${JSON.stringify(ruim)}`);
  const rm = core.lpRemoverSh("box-4", "fluxo");
  assert.match(rm, /runuser -u box-4 -- \/usr\/local\/bin\/publicar --remover 'fluxo'/); assert.doesNotMatch(rm, /rm -rf/, "quem apaga é o publicar, como o usuário");
  assert.match(rm, /echo "REMOVIDO=\$\(printf[^\n]*sed 's\/\^fora do ar: \/\/'/);
  for (const ruim of ["..", ".x", "a b", "a/b"]) assert.throws(() => core.lpRemoverSh("box-4", ruim), /item inválido/);
  assert.equal(core.nomeNoLinkDe("Relatório Final (v2).MD"), "relatorio-final-v2.md");
  assert.equal(core.nomeNoLinkDe(".env"), "env"); assert.equal(core.nomeNoLinkDe("///"), null); assert.equal(core.nomeNoLinkDe("  ólá mundo.pdf "), "ola-mundo.pdf");
});

test("link público: o ESTADO= traz até 50 itens (lstat, sem dotfile, nome seguro) e o estado da skill/CLAUDE.md do agente, só leitura; lerEstadoLp valida", () => {
  assert.match(core.LP_ESTADO_SH, /os\.lstat\(c\)/); assert.match(core.LP_ESTADO_SH, /out\[:50\]/); assert.match(core.LP_ESTADO_SH, /O_NOFOLLOW/);
  assert.match(core.LP_ESTADO_SH, /"itens": itens, "agente": agente/); assert.doesNotMatch(core.LP_ESTADO_SH, /chown|open\([^)]*"w"\)/, "o estado não grava nada");
  const muitos = Array.from({ length: 60 }, (_, i) => ({ nome: `a${i}.pdf`, tipo: "arquivo", bytes: i, mtime: i }));
  const e = core.lerEstadoLp(`ESTADO=${JSON.stringify({ instalado: true, nginx: true, login: true, loginUrl: null, tunel: null, servico: false, rota: false, dominio: "agentesgrok.com", usuarios: [
    { nome: "box-2", ligado: true, link: "daniel", arquivos: 4, itens: [{ nome: "fluxo", tipo: "pagina", bytes: null, mtime: 1 }, { nome: "../x", tipo: "arquivo" }, { nome: "a.pdf", tipo: "zzz", bytes: "7" }, { nome: ".oculto", tipo: "arquivo" }], agente: { skill: "antiga", claudeMd: "ok" } },
    { nome: "box-3", ligado: false, link: null, arquivos: 0, itens: [{ nome: "x", tipo: "arquivo" }], agente: { skill: "ok", claudeMd: "ok" } },
    { nome: "box-4", ligado: true, link: "box-4", arquivos: 60, itens: muitos, agente: { skill: "zzz" } },
  ] })}\n`);
  assert.deepEqual(e.usuarios[0].itens, [{ nome: "fluxo", tipo: "pagina", bytes: null, mtime: 1 }, { nome: "a.pdf", tipo: "arquivo", bytes: null, mtime: 0 }], "item inválido cai; tipo/bytes tortos normalizam");
  assert.deepEqual(e.usuarios[0].agente, { skill: "antiga", claudeMd: "ok" });
  assert.deepEqual(e.usuarios[1].itens, []); assert.equal(e.usuarios[1].agente, null, "desligado: sem itens nem agente");
  assert.equal(e.usuarios[2].itens.length, 50); assert.deepEqual(e.usuarios[2].agente, { skill: "faltando", claudeMd: "faltando" });
  assert.equal(page.urlDoItem("daniel", "agentesgrok.com", { nome: "a.pdf", tipo: "arquivo" }), "https://daniel.agentesgrok.com/a.pdf");
  assert.equal(page.urlDoItem("daniel", "agentesgrok.com", { nome: "fluxo", tipo: "pagina" }), "https://daniel.agentesgrok.com/fluxo/");
  assert.equal(page.resumoAgente({ skill: "sem-hermes", claudeMd: "ok" }).falta, true); assert.equal(page.resumoAgente({ skill: "ok", claudeMd: "ok" }).falta, false);
  assert.match(page.resumoAgente({ skill: "antiga", claudeMd: "ok" }).titulo, /Atualizar a instalação/); assert.equal(page.resumoAgente(null).texto, "—");
  assert.equal(page.textoAvisosLp(["sem-workspace"]), core.textoAvisos(["sem-workspace"]), "a tela e o main dizem a mesma frase");
});

test("link público da pessoa: lista só URLs do link dela com nome seguro; o nome no link reanexa a extensão; a URL publicada é a última antes do LINK=", () => {
  const info = { url: "https://daniel.agentesgrok.com/", nome: "daniel", dominio: "agentesgrok.com", arquivos: 2, usuario: "box-2" };
  const out = ["LINK=1 2 box-2", "LISTA-INICIO", "https://daniel.agentesgrok.com/ola.html", "https://daniel.agentesgrok.com/fluxo/", "https://outro.agentesgrok.com/x", "https://daniel.agentesgrok.com.evil/x",
    "javascript:alert(1)", "https://daniel.agentesgrok.com/../etc", "https://daniel.agentesgrok.com/com espaco", "https://daniel.agentesgrok.com/.oculto", "http://daniel.agentesgrok.com/a", "https://daniel.agentesgrok.com/fluxo/", "LISTA-FIM"].join("\n");
  assert.deepEqual(cli.lerListaPublicar(out, info), [{ url: "https://daniel.agentesgrok.com/fluxo/", nome: "fluxo", pasta: true }, { url: "https://daniel.agentesgrok.com/ola.html", nome: "ola.html", pasta: false }]);
  assert.equal(cli.nomeNoLink("foto.jpg", "foto"), "foto.jpg", "sem extensão o nginx mandaria octet-stream");
  assert.equal(cli.nomeNoLink("fluxo.md", "processo"), "processo"); assert.equal(cli.nomeNoLink("Relatório.md", undefined), "relatorio.md");
  assert.equal(cli.nomeNoLink("foto.jpg", "Minha Foto.png"), "minha-foto.png"); assert.equal(cli.nomeNoLink("x", ""), "x");
  assert.equal(cli.lerUrlPublicada("https://daniel.agentesgrok.com/fluxo/\nLINK=1 3 box-2\n{}\nLISTA-INICIO\nhttps://daniel.agentesgrok.com/ola.html\nLISTA-FIM\n", info), "https://daniel.agentesgrok.com/fluxo/");
  assert.equal(cli.lerUrlPublicada("https://outro.agentesgrok.com/fluxo/\nLINK=1 3 box-2\n", info), null);
  assert.equal(cli.lerUrlPublicada("ERRO: não existe: x\nLINK=1 3 box-2\n", info), null);
});
