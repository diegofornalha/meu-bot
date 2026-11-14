# Changelog

O que mudou no meu-bot, em linguagem de quem usa. Cada item é uma frase; detalhe de implementação fica
no [diário técnico](GUIA.md). O que ainda não saiu fica em [`changelog/`](changelog/README.md), um arquivo por PR,
e entra aqui na seção da versão quando ela vira estável.

> **Sobre a numeração.** O meu-bot foi de 0.4.0 direto para 0.78.4. Não houve 77 versões no meio: o salto
> alinha a numeração com a do Grok Bot, de onde este app nasceu, para dar para comparar os dois lado a
> lado. As quatro releases anteriores (v0.1.0 a v0.4.0-staging.3) não têm entrada própria aqui; esta
> primeira entrada descreve o app inteiro como ele está hoje.

---

## Ainda não lançado

---

## 14 de novembro de 2026 · v0.83.0

### Admin › Usuários: Salvar o limite de disco sem editar não apaga mais o limite
#### Corrigido
- Clicar em Salvar no campo "% do disco" de uma conta sem mudar o número tirava o limite dela ("sem limite"). Agora Salvar grava o % que o campo mostra.

### Admin › Usuários: conta com OpenClaw deixa de mostrar "Preparar" depois de pronta
#### Corrigido
- Uma conta criada com o OpenClaw como agente do WhatsApp continuava com o botão Preparar mesmo depois de pronta. Agora o botão some, como já acontecia com o Hermes.

#### Corrigido

- Site: o Google Analytics passa a receber a campanha de quem chega por anúncio (utm e gclid), e cada download conta uma vez só. A política de privacidade explica a medição de anúncios, sem remarketing.

#### Corrigido

- Analytics: conta criada direto no login (pelo app, com Google ou link por e-mail) passa a contar como cadastro concluído.

#### Corrigido

- Site: quem volta do login do Google não aparece mais como visita vinda de accounts.google.com, então a campanha do anúncio de origem continua contando.

### Assinatura Developer ID e notarização
#### Mudado
- O app passa a sair assinado com o Developer ID da Apple e notarizado quando o certificado está no Mac que publica: abre em qualquer Mac com dois cliques, sem o "Abrir Mesmo Assim". Na primeira abertura com a assinatura nova, o macOS pode pedir "Permitir sempre" para o chaveiro.

### Controle externo (MCP): Atualizar também corrige o comando antigo colado numa pasta
#### Corrigido
- Quem colou o comando antigo do Claude Code continuava, naquela pasta, com a chave anterior depois de "Gerar outra", mesmo com o app mostrando "instalado". Agora o app mostra "desatualizado", e Atualizar ou Remover limpam também essa configuração antiga.

### Controle externo (MCP): instalar no Claude Code e no Cursor com um clique
#### Novo
- Em Configurações › Controle externo (MCP), o botão Instalar registra o app no Claude Code, para o seu usuário e em qualquer pasta, sem colar comando no terminal. No Cursor, ele abre o pedido de instalação para você confirmar.
- Cada cliente mostra se o app está instalado. Depois de gerar outra chave ou trocar a porta, ele aparece como desatualizado, e o botão Atualizar resolve. O Claude Code também tem Remover.
- As ações feitas pelo Claude Code aparecem no app com o selo "Claude Code (MCP)".

### Controle externo (MCP): configuração do comando antigo aparece como desatualizada
#### Corrigido
- Quem configurou o Claude Code pelo comando antigo via as ações dele no app como "Cliente MCP (Mac)", e a tela dizia "instalado". Agora aparece "desatualizado", e Atualizar regrava a configuração com o nome do cliente.

#### Novo

- Console: "Assinar por R$ 97/mês" no Plano. O pagamento é feito na página da AbacatePay e o Pro é liberado na conta assim que o pagamento é confirmado, sem esperar o admin. Por enquanto só no staging, em modo de teste.

#### Corrigido

- Site: endereços com barra no fim (agentesgrok.com/baixar/) redirecionam para a página certa em vez de dar 404.

#### Corrigido

- Site: nas páginas Grok no WhatsApp e Parceria com a xAI, o botão "Testar grátis por 14 dias" volta a ter a letra branca sobre o azul.

#### Corrigido

- Site: a imagem que aparece quando alguém compartilha o link (WhatsApp, X, LinkedIn) não sai mais cortada.

#### Corrigido

- Site: respostas mais francas sobre o risco de bloqueio no WhatsApp, a diferença entre o Grok Bot e o meu-bot em tabela, e textos dos guias alinhados ao que o app faz hoje.

#### Corrigido

- Site: o Google Analytics deixa de perder visitas (a política de segurança bloqueava parte dos envios), os botões azuis têm mais contraste no modo escuro e os links do rodapé ficam mais fáceis de tocar no celular.

#### Novo

- Site: agentesgrok.com.br (com e sem www) leva ao agentesgrok.com, na mesma página.

### Site: Grok no WhatsApp e a parceria com a xAI
#### Novo
- **agentesgrok.com/grok-no-whatsapp** explica que não existe número oficial do Grok no WhatsApp e mostra o jeito seguro de ter o Grok respondendo no seu número com o meu-bot, passo a passo.
- **agentesgrok.com/parceria-xai** diz o que a parceria da Coflow com a xAI significa para o seu negócio, e o que ela não é.
- A home liga as duas páginas, e os dados da Coflow passam a aparecer para o Google como empresa responsável pelo meu-bot.

#### Novo

- Site: guia "API oficial do WhatsApp ou número próprio", que compara a API da Meta (coexistência, limite inicial, preço por mensagem, regra de janeiro de 2026) com o número de sempre como aparelho vinculado, e ajuda a escolher.

#### Novo

- Site: guia "Como automatizar o WhatsApp com IA", que compara os 4 caminhos (app Business, plataforma pela API da Meta, n8n ou Evolution e um agente no Mac) e ajuda a escolher.

#### Novo

- Site: guia "O WhatsApp bloqueia o número que usa IA?", com o que a Meta escreve, a regra de janeiro de 2026 e o que aumenta ou diminui o risco.

#### Corrigido

- Site: os guias do Gmail e de fora do horário ganham links para as páginas oficiais do Google e do WhatsApp, e o de fora do horário ganha mais modelos de mensagem de ausência para copiar.

#### Novo

- Site: guias para quem toca um negócio (agentesgrok.com/guias), com três textos (IA para pequena empresa, responder clientes no WhatsApp fora do horário e IA que lê o seu Gmail), e a página "Grok Bot e meu-bot", que explica a diferença entre os dois.

#### Corrigido

- Site: o llms.txt só fala da assinatura pelo console quando ela está ligada.

#### Corrigido

- Site: o llms.txt (o resumo do site para assistentes de IA) passa a listar os cinco guias, a assinatura pelo console e a documentação do app.

#### Corrigido

- Site: dados estruturados completos (pergunta do macOS na home, preço mensal, privacidade, termos e novidades com prévia para redes) e páginas que o navegador pode reaproveitar ao voltar.

#### Corrigido

- Site: o link para os Guias aparece no rodapé de todas as páginas; links do site compartilhados no WhatsApp e no X mostram a imagem grande do meu-bot; http://www.agentesgrok.com e agentesgrok.com/index.html levam direto à página certa num redirecionamento só; e o Google passa a ver a data real da última mudança de cada página.

#### Novo

- Site: páginas "Baixar o meu-bot para Mac" (agentesgrok.com/baixar) e "Perguntas frequentes" (agentesgrok.com/perguntas), e o mesmo menu (Baixar, Grok no WhatsApp, Perguntas, Novidades, Console) em todas as páginas.

### Versões publicadas mais enxutas
#### Mudado
- A lista "Versões publicadas" (Configurações › Sobre e atualização) mostra só a instalada, as mais novas e as 2 mais velhas; as outras ficam em "Mostrar mais".

### Admin: a pressão da box diz quanto subir

#### Melhorado

- **Box apertada ou estrangulada mostra o que fazer, com número.** Na aba Usuários, a coluna Pressão agora escreve a
  sugestão embaixo do estado, sem precisar passar o mouse: "suba a RAM máx dele de 1280 para 1792 MB" ou "suba o CPU %
  dele de 200 para 300". O número cabe no que a máquina comporta (o teto de todos os usuários juntos e os núcleos);
  sem espaço, ela diz isso e sugere a memória de reserva ou baixar o teto de outra box. O botão "Usar sugestão" preenche
  os campos de RAM máx e CPU %; nada muda até você clicar em Salvar.

---

## 11 de novembro de 2026 · v0.82.0

### Cloudflare e GitHub neste Mac
#### Corrigido
- O tutorial "Contas de linha de comando" deixa de ficar em "Consultando a máquina…" na janela "Este Mac": mostra o Cloudflare e o GitHub deste Mac, e "Conectar" abre o login aqui.

### Seu link público
#### Corrigido
- O tutorial "Seu link público" não aparece mais na janela "Este Mac", onde ficava em "Consultando a máquina…": o link público é de uma conta numa máquina, ligado pelo admin.

---

## 10 de novembro de 2026 · v0.81.0

### Grupos do WhatsApp neste Mac
#### Corrigido
- "Atualizar lista" dos grupos funciona na janela "Este Mac": antes parava em "já há uma listagem em andamento", porque o Mac não tem o programa de trava do Linux. O agente do WhatsApp fica fora uns 20 s e volta sozinho, como nas máquinas.

### Guarda do WhatsApp neste Mac
#### Novo
- **Guarda do WhatsApp neste Mac**: o tutorial 8 deixa de ficar em "Consultando a máquina…"; "Ativar" instala a guarda no OpenClaw daqui (avisos técnicos não vão ao contato, conversa bot-com-bot em loop é pausada).

### Grok neste Mac: o proxy volta depois de fechar e reabrir o app
#### Corrigido
- Depois de fechar o app (ou de ele se atualizar), o Grok do "Este Mac" podia ficar preso num proxy da abertura anterior, e o app tentava subir outro a cada 15 s sem conseguir ("address already in use" no `xai-proxy.log`). Agora o app encerra o proxy inteiro ao fechar, e ao abrir encerra sozinho um que tenha sobrado.

---

## 10 de novembro de 2026 · v0.80.0

### "Este Mac": Grok, WhatsApp e áudios
#### Novo
- **Grok (xAI) na janela "Este Mac"**: o tutorial 4 aparece também aqui. O app instala o proxy do Grok numa pasta própria, sem mexer num Hermes que você já tenha, e a página da xAI abre para você entrar.
- **WhatsApp na janela "Este Mac"**, pelo OpenClaw: o tutorial 3 instala o agente com um serviço do Mac (ele responde mesmo com o meu-bot fechado, enquanto o Mac estiver ligado), mostra o QR e conecta o número. O passo concluído diz qual agente ficou ("Agente: OpenClaw").
- **Ouvir áudios neste Mac**: "Ativar transcrição" passa a valer aqui; os áudios do WhatsApp viram texto no próprio Mac, sem sair dele. Responder em áudio continua só nas máquinas.

### Super admin: escolher a versão do app
#### Novo
- Quem entra com uma conta super admin vê em Configurações › Sobre e atualização a lista "Versões publicadas" do canal do app, e pode instalar qualquer uma delas, inclusive uma mais velha, para reproduzir um problema ou sair de uma versão com defeito. A versão escolhida fica fixada (o app para de se atualizar sozinho) até alguém clicar em "Voltar a atualizar sozinho". O papel é conferido com o servidor da conta a cada uso, e a assinatura de cada release continua obrigatória.
- Ao voltar para uma versão mais velha, os ajustes que ela não conhece são guardados e voltam quando o app retorna a uma versão mais nova.

### Atualização: "Este Mac" volta funcionando depois de reiniciar na versão nova
#### Corrigido
- Depois de atualizar com a janela "Este Mac" aberta, o app reabria com "túnel instável: a porta já está em uso" e as conversas deste Mac não respondiam: o backend da versão anterior continuava rodando. Agora ele é encerrado antes da troca, e o app reaberto encerra sozinho um que tenha sobrado.

### Atualizar agora, num clique
#### Novo
- **Botão "Atualizar agora"** em Configurações › Sobre e atualização e no menu do app: procura a versão mais nova, baixa e reinicia nela, sem esperar a verificação de hora em hora. Com uma resposta em andamento, ele pergunta antes de interromper, como o "Reiniciar e atualizar".
#### Melhorado
- Sobre e atualização mostra de que commit veio o app aberto, ao lado da versão.
- Num app empacotado neste Mac (fora de uma release), a tela diz "Build local do commit …" em vez de "Você está na versão mais recente": a versão dele não muda a cada mudança no código, e nenhuma versão publicada é mais nova.
- "Notas de lançamento" abre a página da versão instalada; num build local, abre o que vem na próxima versão.

### Baixar o meu-bot: um instalador de verdade
#### Melhorado
- O botão de download do site entrega um instalador: abre uma janela com o meu-bot e a pasta Aplicativos, e é só arrastar. Antes vinha um .zip e o app ficava solto em Downloads. Vale para o site e para o site de staging, cada um com o seu app.
- No site, o passo "Abrir Mesmo Assim" (Privacidade e Segurança) vem grifado e com um ⚠️ animado, para ninguém passar batido.

### Conversa: login do Claude vencido não trava mais o turno
#### Corrigido
- Quando o login de uma das contas do Claude vence, ela sai da fila e a conversa continua na próxima conta, em vez de parar com erro.

### Navegador
#### Melhorado
- A aba Navegador abre com fundo branco, como uma aba nova do Chrome, em vez de escura.

### Admin: "este Mac" no seletor
#### Novo
- O meu-bot-admin-gestao mostra "este Mac" no seletor, como o meu-bot, e abre como pessoa do suporte (por SSH local).
- O card "Uso do app" mostra o histórico de aberturas do app: produção ou staging, versão e Mac.
- Depois de desligar o suporte deste Mac, aparece "Religar o suporte deste Mac", e religar mantém o plano.
#### Melhorado
- Este Mac usa o plano da conta meu-bot, mostra o backend dos apps na saúde e não oferece mais Instalar/Reiniciar backend nem ações de VM, que não se aplicam a ele.
- O seletor do admin não mostra mais o falso "sem backend".
- Numa instalação nova, o controle externo (MCP) já vem ligado.

### Console da conta (agentesgrok.com)
#### Novo
- O super admin vê as janelas de suporte de todas as pessoas pelo site.
- Na tabela de devices do admin, cada Mac mostra quantos devices a conta já usa e o limite do plano, com o aviso "no limite" quando o próximo Mac novo entraria como pendente.

---

## 9 de novembro de 2026 · v0.79.3

### Atualização: pronto para o app assinado pela Apple
- O atualizador passa a aceitar uma versão nova assinada com o Developer ID da Apple, uma única vez, na troca da assinatura local pela da Apple. Isso prepara o app notarizado, que vai abrir direto em qualquer Mac sem passar por Privacidade e Segurança. O caminho inverso continua recusado.

### Controle externo: o Navegador abre sozinho

#### Melhorado

- **O "🤖 agente pode usar" não depende mais de a aba Navegador estar aberta.** Quando o Claude Code ou o Cursor pedem o
  Navegador de uma máquina cuja janela está aberta mas a aba não, o app abre a aba em segundo plano, espera o serviço
  subir e atende; antes dava "nenhuma aba Navegador aberta". Sem janela da máquina, ou com o 🤖 desligado nela, o erro
  diz exatamente isso.

### Link direto para uma seção das Configurações

#### Novo

- **`meu-bot://app/v1/settings?id=sobre` abre as Configurações naquela seção**, no mesmo formato do atalho do Grok Bot
  (`grokbot://app/v1/settings?id=update-status`, que também funciona aqui e cai em "Sobre e atualização"). Serve para
  o admin mandar o link certo ("abra `meu-bot://app/v1/settings?id=mcp`") e para páginas do site e da conta levarem a
  pessoa direto ao lugar. Ids: `seguranca`, `espaco`, `sobre`, `texto`, `mcp`, `suporte`, `conta`, mais os apelidos em
  inglês e os do Grok Bot. Abre na janela em uso; sem janela, reabre a última máquina; id desconhecido só abre as
  Configurações. O staging tem o esquema próprio (`meu-bot-staging://`), como no login.

### Admin: a pressão da box não fica vermelha para sempre

#### Corrigido

- **Uma morte por memória de dias atrás não mantém a box "estrangulada".** Na aba Usuários, a coluna Pressão só pinta a
  box de estrangulada ou apertada por morte por memória ou teto batido quando isso aconteceu agora há pouco (desde a
  leitura anterior, por 10 minutos); o acumulado desde que a box subiu aparece no título da célula, como histórico.
  Antes, um único processo morto pelo Linux 13 dias antes deixava a box "estrangulada" mesmo depois de subir a RAM máx e
  com a espera por memória em zero.

### Claude Code Global: no limite, troca de conta na hora

#### Corrigido

- **O agente não fica mais "trabalhando" para sempre quando o Claude Code Global esgota.** Com todas as contas do
  rodízio do admin no limite, o intermediário respondia um 429 sem os cabeçalhos de limite, e o Claude Code ficava
  tentando de novo por minutos, sem avisar ninguém; o Daniel no WhatsApp mostrava "waiting for response" sem fim.
  Agora a resposta é igual à de um limite de verdade (status rejeitado e a hora em que a primeira conta volta), e a
  mensagem diz a hora. O porteiro do `claude` (WhatsApp pelo OpenClaw, Terminal) troca para a próxima conta no mesmo
  turno, relançando a pergunta sem a pessoa ver o erro; sem outra conta livre, a resposta diz "no limite até HH:MM"
  na hora, e não depois de minutos. O backend do app já fazia a troca no mesmo turno e passa a receber o sinal certo.

### Controle externo (MCP)

#### Novo

- **O Claude Code ou o Cursor usando o app por você.** Configurações › Controle externo (MCP): ligue, copie o texto
  pronto e cole no seu cliente (no Claude Code é um comando no terminal; no Cursor, um trecho do mcp.json). A partir
  daí ele abre janelas e páginas, lê os terminais e as abas do Navegador, clica, tira print e troca o tema, tudo
  aparecendo na tela com o selo de quem fez. Rodar comandos no terminal e código nas páginas fica atrás de um
  segundo interruptor, desligado até você ligar. Só aceita conexões deste próprio Mac e só com a chave, que fica
  guardada ao desligar; "Gerar outra" é o que invalida a anterior. A porta é própria de cada app (meu-bot 7830,
  staging 7831…) e pode ser trocada; nada precisa de "Salvar".
- **Ferramentas novas também pelo `app-mcp.mjs`:** `app`, `janela_abrir`, `pagina_abrir`, `tema` e `print_janela`
  entraram como rotas do `term.sock`, então quem usa o caminho antigo (stdio) ganha as mesmas.
- **`terminal_fechar` e uma `nota` honesta.** O cliente consegue encerrar o terminal que abriu (antes a aba ficava lá),
  e a `nota` responde `visivel: false` quando o modo de depuração está desligado: quem anunciou sabe que ninguém viu.

### O agente sabe do backup

#### Melhorado

- **"Você consegue ver se o meu backup entrou?"** Perguntado pelo WhatsApp, o agente da conta dizia que não achava
  backup nenhum e sugeria o guia de mudança de máquina do OpenClaw, porque a máquina não guardava registro do que o
  meu-bot sobe ao Drive. Agora cada conjunto que sobe deixa na conta o quê, quando e onde, e o contexto dos agentes
  diz que backup e restauro são pelo meu-bot (Conta Google › Restaurar uma cópia).

### Tutorial 13: o passo diz o que falta

#### Melhorado

- **"Ver o seu link" diz se a máquina tem o Link Público Global.** Numa máquina em que o admin ainda não instalou o
  global (nginx e o túnel da Cloudflare), o passo dizia só "seu link ainda não está ligado" e "Conferir de novo" não
  achava nada, sem explicar. Agora ele diz que é o admin quem instala (Preparar máquina › Link Público Global) e,
  quando o global existe mas o seu link está desligado, que é só ligar na linha da sua conta.
### Tutorial 11: o código do GitHub se cola sozinho

#### Melhorado

- **Conectar o GitHub sem digitar nem clicar.** O `gh` imprime um código de uso único e a página do GitHub abre no
  Navegador do app; agora, quando ela carrega (depois do login, se precisar), o app passa pelo "Continue" da conta,
  cola o código, envia e autoriza o GitHub CLI, só para o código deste login. O código continua à mostra com o
  "Copiar", para o caso de a página mudar.
- **A aba que o tutorial abre tem o selo "🎓 Tutorial 11"** na tira do Navegador, como as abas que uma conversa está
  usando têm o selo dela; antes aparecia como "da pessoa".
- **O 🤖 do Navegador vem ligado.** O agente podia usar o Navegador só depois de você ligar o 🤖 em cada máquina; agora
  é o padrão, como o 📱 do WhatsApp. Desligar continua lembrado por máquina.
### Voz das respostas numa box apertada

#### Corrigido

- **"A voz alex não passou no teste ()"** numa box com teto de RAM de 2 GB: o Kokoro (vozes dora e alex) precisa de
  ~550 MB de pico, e sem folga a síntese travava por minutos e o teste do OpenClaw caía sem dizer nada. Agora, antes
  de baixar a voz, o instalador confere a folga no teto da conta e diz quanto falta e o que pedir ao admin; e o teste
  mudo explica que a conta pode estar no teto. O admin cria as contas novas com 3 GB.

### Tutorial 11: o Cloudflare acha o Node

#### Corrigido

- **"Esta máquina não tem o Node (npx) para o Cloudflare" numa máquina com OpenClaw para todos.** O wrangler exige
  Node 22 ou mais novo; o do sistema (Debian) é o 20 e vem sem npx, mas o Node 24 do OpenClaw em /opt serve: o tutorial
  passa a procurá-lo e a usá-lo só nesse comando. Quando não há nenhum, a frase diz o que pedir ao admin.

### O app do admin tem nome próprio

#### Melhorado

- **O meu-bot-admin agora se chama meu-bot-admin-gestao.** É o app de gestão: suporte, licenças e plano, espelho das
  máquinas, auditoria e produtos. Na primeira abertura ele traz sozinho as pessoas, configurações e produtos do
  meu-bot-admin antigo, que fica no lugar como cópia de segurança. Quem tinha o meu-bot-admin instalado instala o
  novo uma vez; dali em diante ele se atualiza sozinho.

### Restaurar a cópia do Drive sem sair do app

#### Novo

- **Restaurar a cópia do Drive pela aba Conta Google.** Em "Backup no Drive" › "Restaurar uma cópia…", escolha
  a máquina de origem (pode ser outra, que já morreu) e o que volta: CRM, financeiro, conversas e skills do
  agente, trabalho, credenciais. A cópia entra por cima do que há; cada arquivo substituído fica guardado numa
  pasta de segurança na máquina, e o que só existe nela continua. As conversas antigas do agente aparecem ao
  lado das de hoje. O WhatsApp só é trocado se você marcar "substituir", e o Hermes de uma máquina antiga não
  entra numa máquina OpenClaw (nem o contrário).

### A atualização pergunta antes de interromper, e sabe se recuperar

#### Novo

- **"Parar e atualizar".** Quando a versão nova fica pronta com o bot no meio de uma resposta, o app
  espera. Esgotada a espera, ele mostra a escolha em vez de reiniciar por cima da conversa: parar agora,
  ou deixar a resposta terminar.
- **Mover para Aplicativos.** Abrindo o app de dentro da imagem do instalador, ou de uma pasta sem
  escrita, agora há um botão que copia o app para a pasta Aplicativos e reabre de lá. Antes a tela só
  mandava arrastar.
- **Ações de atualização no menu do aplicativo:** "Verificar atualizações" e, com uma versão pronta,
  "Reiniciar para atualizar".
- **Registro legível do que aconteceu com a atualização.** Cada desfecho — verificou, preparou, trocou,
  voltou atrás, não pegou — entra no modo de depuração com o motivo, em vez de só no log corrido.

#### Melhorado

- O aviso de reiniciar acompanha uma versão mais nova que fique pronta no meio. Antes ele recusava e
  pedia para conferir e clicar de novo.

#### Corrigido

- **WhatsApp no OpenClaw numa conta criada pelo admin não respondia.** A conta usa o Claude Code Global (sem login
  próprio) e o pareamento não gravava o modelo nem punha o porteiro do Claude no gateway: a primeira mensagem dava erro
  de "openai" ou "Not logged in". Agora o pareamento cuida dos dois.
- **A janela da máquina abria errada na 0.78.4:** sem a lateral certa (no admin, a de gestão virava a cara do app
  comum) e sem responder. Um canal novo do "localizar na página" não estava na lista permitida e derrubava a janela
  na abertura. Quem instalou a 0.78.4 recebe esta versão sozinho.
- **O app podia parar de atualizar para sempre dizendo que estava em dia.** Uma versão publicada com o
  arquivo faltando, sem assinatura, ou sem o arquivo desta arquitetura, aparecia como "você está na
  versão mais recente". Agora o app diz o que houve e continua tentando.
- **Disco cheio.** Antes virava um erro genérico e o que já tinha sido baixado ficava ocupando o espaço
  que faltava. Agora o app apaga o que baixou, diz quanto resta livre e para de insistir.
- **Duas contas do Mac usando o app ao mesmo tempo** podiam atrapalhar uma à outra na hora de atualizar,
  a ponto de uma apagar a versão de reserva da outra. Agora elas se revezam.
- **Troca interrompida.** Se o app fosse fechado no meio da atualização, uma das cópias podia sumir e a
  versão de reserva era apagada trinta segundos depois. Agora a cópia é reposta em qualquer abertura, e
  a reserva só sai quando o app está no lugar dela.
- **O conteúdo da versão preparada é reconferido** antes de ser reaproveitado numa abertura seguinte.
- Quando o GitHub limita as consultas, o app diz isso e a que horas libera, em vez de dar um erro
  genérico.

### A casca do app: localizar, atalhos, corretor e aceleração

#### Novo

- **Localizar na página, com ⌘F.** Uma faixa de busca com "3 de 12", ↑ e ↓, e Esc para fechar. Ela segue
  o foco: com o terminal na frente, busca dentro do terminal; com o Navegador, dentro da página aberta;
  no resto, no conteúdo da janela. Com texto selecionado, ele já entra no campo.
- **Folha de atalhos, com ⌘/.** Todos os atalhos do app numa tela só, por assunto. Também em Ajuda ›
  Atalhos de teclado.
- **Corretor ortográfico enquanto você digita.** O erro fica sublinhado e o botão direito mostra as
  sugestões e "Adicionar ao dicionário". O idioma é o do seu Mac. Campos de endereço, código e chave
  continuam de fora. Dá para desligar em Configurações › Texto e desempenho.
- **Preferência de aceleração por hardware.** Desligue se a janela piscar, rasgar ou ficar preta neste
  Mac. Vale depois de fechar e abrir o app.
- O menu Editar agora é completo: desfazer, refazer, recortar, copiar, colar, selecionar tudo,
  Localizar e os comandos de fala do macOS.

#### Corrigido

- **A preferência "atualizar sozinho quando o Mac estiver ocioso" não ficava desligada.** O interruptor
  salvava, mas o app continuava lendo "ligado" e a tela remarcava a caixa no primeiro repinte.

---

## 4 de novembro de 2026

### v0.78.4 · O app de mesa, o WhatsApp e as máquinas

Primeira entrada do changelog. Reúne tudo o que o app faz hoje, depois de 455 mudanças.

#### Novo

**Conversa e janela**

- Uma janela por máquina, como o Cursor com SSH: o app abre num seletor (`local`, `colima`, `agente-box`,
  `grokbot-1`) e cada janela mostra só as conversas daquela máquina.
- Abas de conversa que ficam vivas em segundo plano, com ponto azul quando chega resposta, renomear com
  dois cliques e reordenar arrastando. A ordem e os nomes sobrevivem a fechar o app.
- Paleta de comandos com ⌘K, que acha conversas, ações e configurações.
- Entrada rápida: ⌘⇧Espaço de qualquer app abre uma janelinha e o Enter manda para a conversa ativa.
- Lista lateral com ⌘B, agrupada por data, com busca que ignora acento e arquivar.
- Exportar uma conversa em Markdown ou JSON, e ramificar a partir de qualquer mensagem.
- Resumo contínuo: passando do orçamento de contexto, o meio da conversa vira um resumo gerado em
  segundo plano, e uma memória local de perfil e notas entra em toda mensagem.
- Modo de depuração com uma faixa no topo mostrando build, batimento do processo principal, estado do
  túnel e o que chega de fora.

**WhatsApp**

- O agente atende no WhatsApp por três gateways intercambiáveis: Hermes, OpenClaw e PicoClaw. A pessoa
  escolhe em "Escolha o agente" e pode trocar depois; a tela explica o que cada um não faz.
- Pareamento por QR dentro do app, sem abrir terminal.
- Pausar o agente por contato, por 2 h, 24 h ou até retomar. O que chegou durante a pausa aparece na
  conversa numa bolha tracejada.
- Um dono por agente: quem manda nele, quem ele responde e quem ele ignora, com a regra num lugar só.
- Grupos, marcas nas conversas, renomear contato e "digitando…" enquanto o agente pensa.
- Guarda anti-laço, para o agente não ficar respondendo outro robô sem parar.
- Voz: o agente responde em áudio, com escolha de voz.

**As máquinas**

- O seletor sonda todas as máquinas em paralelo, mostra o estado de cada uma e instala o backend onde
  falta, com um clique.
- Aba Terminal com PTY remoto, várias abas por máquina.
- Aba Navegador com webviews, abas por conversa, espaços, favoritos e uma API para o agente navegar.
- Túnel SSH com ControlMaster, que revalida ao acordar o Mac.
- Botão ⇅ no seletor que preenche o `~/.ssh/config` a partir do arquivo de hosts do projeto.
- Tailscale SSH sem pedir aprovação, detectado pelo seletor e desligável pela API do tailnet.
- Vigia do `tailscaled`, para a máquina não sumir da rede.

**Contas, CRM e dinheiro**

- Conta Google por máquina, com Gmail, Agenda, Planilhas, Contatos e backup no Drive.
- CRM próprio dentro do Gmail, por extensão, aberto pela licença da máquina.
- Financeiro da máquina, com Curva ABC e importação de planilha.
- Licença da máquina com portões por módulo pago.
- Registro de auditoria de quem fez o quê em cada máquina.

**Administração (meu-bot-admin)**

- Aba Usuários que cria contas de login na máquina já com tetos de memória e CPU, para um cliente não
  derrubar os vizinhos.
- Código de suporte, que deixa o admin ver o que a pessoa escolheu mostrar.
- Log ao vivo de criar e preparar um usuário.

**Tutoriais**

- Trilha de tutoriais guiados ao vivo, numerados na ordem, com cartões, "pular" e arquivados.

#### Melhorado

- Streaming real: o texto chega palavra a palavra, e o Claude Code retoma a sessão em vez de reler tudo.
- Corrente de fallback de modelo configurada no backend, com aviso na conversa quando troca.
- Status line no rodapé com modelo, contexto, conta e os limites de 5 h e 7 dias do Claude, avisando ao
  passar de 80, 90 e 95%.
- Quando a máquina não tem a status line, o seletor avisa e oferece instalar, sem travar a abertura.
- O app detecta o que cada máquina sabe fazer por uma tabela de capacidades, nunca pelo nome do
  framework, então um gateway novo entra sem espalhar condição pelo código.
- Fuses do Electron travados no app gerado: sem executar como Node, sem inspeção por linha de comando e
  com integridade do pacote ligada.
- Canal staging ao lado do estável, como o VS Code Insiders, com ícone de faixa laranja, dados e porta
  próprios.
- Atualização automática no app instalado: baixa em segundo plano com retomada e progresso, guarda a
  versão preparada entre aberturas, só instala a versão que o botão mostrou, troca sozinha com o Mac
  ocioso ou ao fechar, e volta para a versão anterior se a nova não abrir.
- Cada zip de release sai com assinatura Ed25519, e o app só instala o que a chave da release assinou,
  sem nunca reassinar.

#### Corrigido

- O estado do WhatsApp aparece rápido ao abrir, sem "desconectado" falso.
- Gerar o QR com a sessão deslogada começa do zero em vez de insistir numa sessão morta.
- Apagar um usuário funciona mesmo com a conta sempre ligada.
- O backend e os plugins da máquina só sobem de versão, nunca rebaixam, mesmo com o estável e o staging
  falando com a mesma máquina.

---

## Antes disto

As releases v0.1.0 (22 de outubro de 2026) a v0.4.0-staging.3 (28 de outubro de 2026) saíram sem
changelog. O histórico está nos commits e nas notas de release do GitHub.
