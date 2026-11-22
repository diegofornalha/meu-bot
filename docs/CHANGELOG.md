# Changelog

O que mudou no meu-bot, em linguagem de quem usa. Cada item é uma frase; detalhe de implementação fica
no [diário técnico](GUIA.md). O que ainda não saiu fica em [`changelog/`](changelog/README.md), um arquivo por PR,
e entra aqui na seção da versão quando ela vira estável.

> **Sobre a numeração.** O meu-bot foi de 0.4.0 direto para 0.78.4. Não houve 77 versões no meio: o salto
> alinha a numeração com a do Grok Bot, de onde este app nasceu, para dar para comparar os dois lado a
> lado. As quatro releases anteriores (v0.1.0 a v0.4.0-staging.3) não têm entrada própria aqui; esta
> primeira entrada descreve o app inteiro como ele está hoje.
> Em 17 de novembro de 2026 a base foi de 0.84.0 para 1.2.0, de novo para acompanhar o Grok Bot, que está na
> 1.2.0. A 0.84.0 não saiu como estável: a próxima estável depois da v0.83.0 é a v1.2.0.

---

## Ainda não lançado

---

## 22 de novembro de 2026 · v1.2.0

### Console de staging: assinar o Módulos do Diego
#### Novo
- O console de staging oferece o add-on Módulos do Diego por R$ 997/mês, como o Finanças. A produção entra quando o produto existir na AbacatePay de produção.

### meu-bot-inspector-staging: o MCP Inspector dentro do app
#### Novo
- Um app de teste novo, o meu-bot-inspector-staging, com o botão Inspector na barra lateral: ele abre a interface oficial do MCP Inspector já conectada ao controle externo (MCP) do próprio app, para listar e chamar as ferramentas dali. Precisa do Node.js 22.19 ou mais novo neste Mac; se faltar algo, a página diz o que é.

### App: atalho para o Marketplace
#### Novo
- O menu da conta e a página Módulos ganharam "Marketplace", que abre no site o que dá para somar à sua conta: apps, máquinas e Macs a mais.
#### Melhorado
- O app passa a chamar o add-on de "Finanças", o mesmo nome do site e da cobrança (antes aparecia "Financeiro" em alguns lugares).

#### Novo

- Configurações: grupo "Notificações", para ligar ou desligar o aviso de quando o agente responde e escolher se ele toca som, com um botão de teste.

#### Corrigido

- Atualização: o app instalado na pasta Aplicativos por outra conta do Mac atualiza normalmente, sem o aviso "pasta só de leitura". Aberto direto da imagem do instalador, "Reiniciar e atualizar" já instala a versão nova na pasta Aplicativos e reabre de lá, sem um segundo botão.

### Aviso de plano: assinar pelo site
#### Novo
- Quando um recurso pede o Pro (ou um app pago) e o admin não gravou instruções de pagamento, o aviso agora mostra "Como assinar", com o botão "Assinar pelo site", que abre a página do plano. Antes o aviso ficava sem dizer como pagar.

### Pagamento já preenchido a partir da segunda compra
#### Mudado
- Depois da primeira compra paga, a página de pagamento da AbacatePay (Pro, Pix do cupom, Marketplace e extras) já abre com o seu nome, CPF, e-mail e telefone. A conta guarda só o código do seu cadastro na AbacatePay.

### Console: sem conexão, a ação avisa em vez de travar
#### Corrigido
- Quando a conexão cai no meio de uma ação do console (salvar, ocultar, excluir), o botão ficava desativado e nada aparecia. Agora o console mostra que a API não respondeu e o botão volta.

### Console: quem tem o Pro sem assinatura consegue assinar
#### Corrigido
- No console › Plano, quem já tinha o Pro liberado sem cobrança (ou cancelou e ainda está no mês pago) não via o "Assinar por R$ 97/mês". Agora o botão aparece, com o aviso de que o prazo que a pessoa já tem não é encurtado; ele só some para quem já tem a assinatura do Pro em andamento.

### Console › Assinaturas: remover uma assinatura
#### Novo
- Cada assinatura da tela Assinaturas tem "Remover" no lugar de "Ocultar" (só o super admin, com confirmação): a cobrança é cancelada na AbacatePay e a assinatura é apagada, então sai da lista e da receita mensal de vez. Serve para compra de teste e para venda desfeita por fora. Se a AbacatePay não confirmar o cancelamento, nada é apagado.
- Os pagamentos da assinatura removida não são apagados: ficam ocultos e aparecem na Auditoria. O acesso que a pessoa já pagou não muda; quem tira é o admin, pelas ações de sempre.
- No staging, a tela Auditoria ganhou "Zerar", ao lado de "Recarregar" (só o super admin, com confirmação): cancela na AbacatePay as assinaturas ocultas, apaga elas, os pagamentos ocultos, as contas apagadas e o registro de ações, para recomeçar depois de uma rodada de testes. Fica uma linha dizendo quem zerou. Em produção o botão não aparece e a API recusa.

### Console: página Auditoria para o super admin
#### Novo
- O menu do super admin ganha "Auditoria": as contas apagadas (o e-mail que tinham, quando e por quem foram apagadas, a licença que ficou gravada e o total pago) e as 500 ações mais recentes de todas as contas, com filtro. Só leitura.

### Console: "Tenho um cupom" leva direto ao pagamento
#### Mudou
- "Tenho um cupom" não abre mais um campo no console: leva direto à página de pagamento (no cartão), onde você digita o código em "Código do cupom" e toca em Aplicar.

### Console: seus Macs e máquinas em cartões, e você remove um Mac sozinho
#### Novo
- Na página Devices, cada Mac com o app e cada máquina do agente aparece num cartão, como no Marketplace.
- "Remover este Mac" tira um Mac da sua conta sem depender do admin: a vaga abre na hora e, se havia um Mac esperando, ele entra. O app do Mac removido pede o login de novo.
- A Visão geral mostra onde a sua conta é usada, pelos nomes dos Macs e das máquinas.
#### Melhorado
- Lista de Macs vazia explica como um Mac passa a aparecer. No console de teste, avisa que os Macs da produção ficam no outro console.
- Quem chega do Marketplace sem estar logado vê que precisa entrar para contratar, e volta para a mesma página depois do login.

### Console: máquina e Mac a mais com nomes pelo uso
#### Melhorado
- Na página Plano, os dois extras dizem para que servem: "Mais uma máquina para o agente" e "Mais um Mac com o app", cada um avisando que não é o outro.
- O extra vendido abaixo do preço de tabela mostra "De R$ 97 por R$ 47 por mês".

### Console › Contas: o editor de licença perde os campos sem uso
#### Alterado
- O editor de licença de uma conta não mostra mais "Add-ons concedidos", "Como pagar" e "Link": a pessoa assina o Pro e os add-ons sozinha, pelo console. Salvar a licença não mexe no que já estiver gravado nesses campos.

### Console: a lista de máquinas mostra todas as que você usa
#### Mudou
- Em Devices, "Máquinas que você usa" passa a listar toda máquina remota que você abre pelo app com a conta logada. As que rodam com a licença gravada pelo admin aparecem como "Em uso · licença do admin" e não ocupam vaga; dá para tirá-las da lista.
- O cartão "Máquinas" da Visão geral conta só as máquinas em uso (antes contava também as tiradas).

### Console: aba Marketplace
#### Novo
- O menu do console ganhou a aba Marketplace: mostra o que a sua conta tem e o que dá para somar (apps como o Finanças, mais uma máquina para o agente, mais um Mac com o app).
- A página Plano fica só com o plano, o prazo e as suas assinaturas. Depois de pagar um app ou uma unidade a mais, você volta para o Marketplace.

### Console: a oferta do Pro é a primeira coisa da Visão geral
#### Mudou
- Ao abrir o console, o painel "Assinar o Pro" aparece no topo da Visão geral, com o preço "de R$ 997 por R$ 97 por mês". Ele continua também na página Plano.

### Console: quem já tem o Pro não vê a oferta do Pro
#### Corrigido
- O painel "Assinar o Pro" não aparece mais para a conta que já tem o Pro valendo. Ele volta nos últimos 7 dias do prazo, para a pessoa assinar antes de ficar sem.
- Para quem já tem o Pro, o topo da Visão geral mostra os add-ons que a conta ainda não tem, como o Finanças.

### Console: contagem regressiva do plano
#### Novo
- Na página Plano do console, o cabeçalho mostra quanto falta do teste ou do Pro, ao lado do "lido às": em dias, em horas no último dia, e há quanto tempo venceu.

### Console › Contas: o super admin exclui a conta de qualquer pessoa
#### Novo
- No editor de uma conta, ao lado da senha, o super admin tem "Excluir conta". É a mesma exclusão de "Apagar conta" do perfil: a conta some das telas e a pessoa sai de todos os Macs, e a licença, os pagamentos, os pedidos e a auditoria ficam guardados. Conta com perfil de acesso ou dona de organização precisa perder o perfil ou passar a organização antes.

### Console: "Tenho um cupom" ao lado do Assinar
#### Novo
- No painel "Assinar o Pro" (Visão geral e Plano), quem tem um código de cupom toca em "Tenho um cupom", digita e assina com ele. O console confere o cupom na hora, abre o pagamento no cartão e já deixa o código copiado para colar na página da AbacatePay. Vale na primeira assinatura do Pro da conta.

### Console › Assinaturas: ocultar o que você não quer ver
#### Novo
- Cada assinatura e cada pagamento da tela Assinaturas tem "Ocultar": a linha sai da tela e dos totais e vai para a Auditoria, de onde volta com "Mostrar de novo". É só visualização: a assinatura, a licença da pessoa e a cobrança não mudam.

- Console: quem paga e volta com a sessão vencida (ela dura 1 hora) entra de novo e cai na mesma página com o aviso de pagamento recebido, em vez de uma página sem aviso.

#### Novo

- Conta: dá para cancelar a assinatura do Pro (ou de um app à parte) no próprio console, em Plano › Suas assinaturas. O acesso continua até o fim do mês já pago.

### Contas do Claude: "Sair" avisa quando não consegue
#### Corrigido
- Se o "Sair" do Login padrão não conseguir sair da conta, o motivo aparece no próprio cartão. Antes o cartão continuava logado, sem explicação, e o tutorial 1 voltava ao passo 1 mesmo assim.

### Contas do Claude: sair do Login padrão
#### Novo
- No tutorial "Mais contas do Claude", o cartão do **Login padrão** ganhou o botão **Sair**: faz logout do Claude Code da máquina e volta o tutorial 1 ("Entrar no Claude Code") ao passo 1. As outras contas ficam como estão. O Login padrão não tem "Remover" porque não é uma pasta de conta: é o login normal da máquina.
#### Corrigido
- Uma conta deslogada não mostra mais o uso antigo ("Sessão 40% · Semanal 23%") no cartão: esses números eram de um login que já não existe.

### Console do admin: cortesias com prazo
#### Novo
- Na ficha da conta (Plano › Editar), "O que a conta tem" separa o que é pago do que é cortesia: o Pro com a origem (pago, cortesia, teste, ajuste do admin), os add-ons e extras pagos com o Encerrar, e as cortesias com quem deu, o motivo, Renovar e Encerrar.
- "Dar cortesia": Pro, add-on, máquinas, devices ou usuários de uma organização da conta, até uma data (30 dias por padrão, no máximo 365) e com o motivo. Acaba sozinha no prazo.
- Histórico na ficha: cortesias que acabaram e encerramentos, com o motivo e o que a AbacatePay respondeu.
- Pedido "Revisar pagamento" (reembolso, disputa) ganhou "Ver a conta", que abre a ficha para encerrar com o motivo.
#### Mudado
- A lista de contas mostra "Pro pago", "Pro cortesia" ou "Pro em teste"; o cartão "Pro ativo" diz quantas são cortesia.
- Ajustar a licença pede o motivo, e só vai o que mudou. O admin comum só estende o teste grátis; dar a mais é cortesia.
- Liberar um device com a conta no limite dá 1 device de cortesia por 30 dias, em vez de subir o limite do plano.
- Admin › Organizações: coluna dos usuários de cortesia.

### Console: cortesias com data
#### Novo
- Quando o suporte libera algo de cortesia (o Pro, um app, máquinas, Macs ou usuários de organização), o Plano e a Visão geral mostram "Cortesia: … até …". Nos últimos 7 dias, o aviso diz que ela acaba e que é preciso contratar para continuar.
- No Marketplace, o selo do item diz "Cortesia até …", e o que a conta tem marca "(cortesia)".
- As vagas explicam a conta com a cortesia: "1 inclusa + 1 de cortesia + 1 extra". Na organização: "1 incluso + 2 de cortesia + 1 pago".
- Cortesia encerrada antes do prazo aparece como "encerrada pelo suporte em …".
- Termos de uso: itens sobre cortesias e sobre o encerramento pelo suporte em caso de reembolso ou disputa.

### CRM: funil de leads em que o agente anota sozinho, e o CRM passa a funcionar com o Hermes
#### Novo
- Modelo de pipeline "Leads do site" no tutorial do CRM: etapas Novo, Respondido, Link enviado, Baixou, Assinou e Perdido, com os campos Origem, Ref do anúncio, Produto de interesse e Sistema já criados.
- Um pipeline pode ser marcado como autônomo: nele o agente cria a caixa, preenche os campos e muda a etapa sem perguntar a você. Nos outros pipelines ele continua pedindo a sua confirmação, e apagar continua sendo só seu. O "Leads do site" já nasce assim. Só você liga ou desliga a autonomia; se o agente tentar, o CRM recusa e deixa o pedido registrado.
- O agente sabe tratar o lead que chega pelo WhatsApp: procura a caixa pelo telefone antes de criar outra, guarda de qual anúncio a pessoa veio e anota em cada conversa o que aconteceu e o próximo passo. Vale para máquina em que o CRM é instalado agora; numa máquina que já tinha o CRM, as instruções antigas do agente são mantidas e a instalação mostra onde está o texto novo.
- Daqui em diante, ao reinstalar o CRM, as instruções do agente se atualizam sozinhas quando ele não as editou; as que ele editou ficam como estão.
#### Corrigido
- Numa máquina com Hermes, o agente não recebia as instruções do CRM e por isso não usava o CRM. Agora elas são instaladas também onde o Hermes as lê.

### Console: "Tenho um cupom" com Cartão ou Pix
#### Novo
- Quando o Pix do cupom está ligado, "Tenho um cupom" pergunta como você quer pagar. No cartão, vai direto à página de pagamento, como antes. No Pix, você digita o código no console e paga o primeiro mês do Pro por Pix; nesse caso não há renovação automática, e no fim do mês o console oferece a assinatura.
#### Corrigido
- Ao voltar do pagamento, o aviso de confirmação aparece na página Plano mesmo depois que o painel "Assinar o Pro" some.

### Console: o Pix do cupom está ligado
#### Novo
- "Tenho um cupom" agora pergunta Cartão ou Pix. No Pix, o cupom vale o primeiro mês do Pro e não renova sozinho.

#### Novo

- Devices: quando um Mac passa do limite do plano, o chat explica o que houve e traz "Adicionar um device" e "Já adicionei: conferir", sem depender do admin.

#### Mudou

- Devices: se o limite cai (um device extra venceu), ficam os Macs que entraram há mais tempo e o mais novo volta a esperar vaga.

#### Mudou

- Devices: o Mac que esperava vaga numa máquina entra sozinho na próxima abertura quando o limite sobe, e o limite de devices da conta passa a valer também na máquina (vale o maior entre o da conta e o que o admin gravou).

### Console do admin: encerrar com motivo para a cobrança
#### Mudado
- Encerrar um add-on ou uma unidade extra paga agora pede o motivo (reembolso, disputa, pedido da pessoa, erro ou teste, outro) e para a cobrança na AbacatePay antes de tirar o acesso. Se a AbacatePay não confirmar, nada muda.
#### Novo
- "Encerrar o Pro" na ficha da conta, com o mesmo motivo: para a cobrança do Pro e tira o Pro na hora. O reembolso em dinheiro continua no painel da AbacatePay.
- Cada encerramento fica no histórico da conta, com o motivo e quem encerrou.

### Fallback: o Ollama do modo grátis pode ser o primário
#### Novo
- No tutorial "Fallback: Claude e Grok", o seletor **Primário nesta máquina** ganha a opção **Ollama, modo grátis (ollama-local)** onde o modo grátis está instalado. Com ele de primário, as conversas novas começam no modelo que roda na própria máquina, e Claude e Grok ficam de reserva. A linha de cima mostra também o estado do Ollama, ao lado das contas do Claude e da xAI.

### Modo grátis no Mac (staging): tutorial 16 com o Ollama
#### Novo
- No staging, quem não tem Claude nem Grok pode usar o meu-bot de graça: o tutorial 16 confere o Mac, instala o Ollama e o modelo com um clique (numa pasta própria do meu-bot) e mostra a primeira resposta no chat.
- A opção "Não tenho nenhuma" da primeira abertura leva direto a esse tutorial.
- Depois de instalado, o Ollama aparece na lateral abaixo do Claude Code e da xAI, com "parar"/"ligar"; dá para removê-lo pelo tutorial.
#### Corrigido
- Preparar o Grok neste Mac não apaga mais as outras entradas do providers.json do backend local.

### Primeira abertura (staging): "Você já tem assinatura de IA?"
#### Novo
- No staging, a primeira abertura pergunta qual assinatura de IA você tem (Claude, Grok, as duas ou nenhuma) e leva direto ao tutorial certo; quem não tem nenhuma vê como assinar. O tour continua em Tutoriais.

### Marketplace com busca
#### Novo
- O Marketplace ganhou um campo de busca, no site e no console da conta: digite o nome do que procura, ou o que quer fazer ("planilha", "agenda"), e a lista mostra só o que combina. Não precisa de acento.
- O Marketplace está preparado para vender **ferramentas**: conexões do seu agente com apps como Gmail, Google Agenda e Notion, contratadas uma a uma. Ainda não há nenhuma à venda; elas chegam nas próximas versões.

### Finanças: aviso claro quando o Financeiro virou módulo
#### Corrigido
- Com o módulo Finanças ligado, a página Finanças antiga mostrava em vermelho, como erro, "o Financeiro desta máquina agora é o módulo Finanças…". Agora ela mostra um cartão explicando onde o financeiro está, com o botão **Abrir Módulos**.

### Financeiro como módulo
#### Novo
- Com o Financeiro na licença da máquina, a página Módulos traz o módulo Finanças, baixado do repositório público meu-bot-finance. Ligado, ele tem página própria (o mês, as contas, o DRE e a Curva ABC) e passa a ser o dono dos dados do financeiro. A página Finanças de antes avisa que o financeiro agora abre pelos Módulos; desligando o módulo, tudo volta como era, com os mesmos dados (issue #312).

### Financeiro: preparo para virar módulo
#### Mudou
- Numa máquina com o módulo Finanças ligado, o Financeiro antigo do app sai do caminho. A página antiga avisa que o Financeiro agora abre pela página Módulos, o backend para de gravar nos dados (o módulo passa a ser o único dono deles) e o app não reinstala o plugin antigo por cima do módulo. Sem o módulo, nada muda (issue #312).

### Finanças agora é só módulo
#### Mudou
- A página Finanças saiu do app: o Financeiro passa a existir só como o módulo Finanças, na página Módulos. Seus lançamentos, contas e comprovantes ficam onde estão, na máquina; ligue o módulo e ele abre com os mesmos números.
- O tutorial "Seu financeiro no WhatsApp" saiu da trilha; o passo a passo agora está na ficha do módulo. Os tutoriais seguintes desceram um número.
- O app de teste meu-bot-finance-staging deixou de ser publicado.

### Primeira abertura (staging): a pergunta da IA cabe na tela
#### Corrigido
- A pergunta "Você já tem assinatura de IA?" passava da altura da janela e escondia o botão Continuar. Agora ela sai sem a ilustração, fica mais compacta em janela baixa e nunca passa da tela.

### Tutoriais: o log da instalação não passa mais por cima do próximo passo
#### Corrigido
- No passo de instalar (modo grátis, Grok) e no login do Claude, o log crescia por cima do passo seguinte. Agora ele fica numa caixa com rolagem, em letra pequena, e mostra sempre a linha mais nova.

### Gestão: atribuir uma máquina a uma conta pelo e-mail
#### Novo
- No meu-bot-admin-gestao, o card "Conta e licença" de uma máquina ganhou "Atribuir a esta conta": você digita o e-mail e a máquina passa a aparecer no console dessa pessoa, em "Máquinas que você usa", como "Em uso · licença do admin". Não muda a licença gravada na máquina nem ocupa vaga, e dá para desfazer.

### Gestão: avisos mais claros na máquina atribuída a uma conta
#### Corrigido
- Numa máquina atribuída a uma conta pelo admin, o card "Conta e licença" não acusa mais "Diferença" entre a licença da máquina e o plano da conta: explica que os dois são independentes.
- Um plano ativo sem vencimento não mostra mais a data de um teste antigo como validade, nem "Pro venceu há N dias", na gestão e no console.
- Quando a API da conta ainda não tem a atribuição, a gestão diz que aguarda publicação em vez de "rota desconhecida".

#### Novo

- Gestão: a página Suporte mostra a conta da pessoa como o console mostra (plano, prazo, devices, máquinas, add-ons e pedidos), lida da API, e avisa quando a máquina e a conta discordam.

### Gestão: avisos certos para um Mac e nenhuma conexão sem admin logado
#### Corrigido
- meu-bot-admin-gestao: numa máquina que é um Mac (o próprio Mac como pessoa do suporte), o WhatsApp aparecia como "gateway fora do ar" com o gateway rodando. Os comandos por SSH agora funcionam no macOS como já funcionavam no Mac local.
- meu-bot-admin-gestao: a página Suporte dizia "sem status line" quando a máquina tinha outra status line (a global do Mac). Agora diz que ela é de outra origem e que os limites do Claude não chegam ao meu-bot.
- meu-bot-admin-gestao: sem uma conta de admin logada, o app ainda lia o plano das pessoas e retomava a preparação de contas nas máquinas. Agora não conecta em nenhuma máquina até um admin entrar.

### Gestão: saem os campos "Como pagar" e "Link de pagamento"
#### Removido
- meu-bot-admin-gestao › Suporte: os campos "Como pagar" e "Link de pagamento" saíram da licença da pessoa. A assinatura é feita pelo site, e o aviso de plano no app dela mostra "Assinar pelo site". Uma máquina que ainda tem uma orientação antiga gravada mostra o texto e o botão "Apagar orientação", para o aviso dela voltar ao normal.

### Gestão: só admin e super admin abrem o app
#### Corrigido
- meu-bot-admin-gestao: qualquer conta que entrasse via as pessoas e abria as máquinas delas. Agora só conta com papel de admin ou super admin: para as outras o seletor fica vazio, não conecta em máquina nenhuma e explica o motivo. O papel é conferido no servidor na hora de abrir uma máquina; sem internet, vale o último papel confirmado.

#### Novo

- Gestão: botão "Zerar" ao lado de "Aberturas recentes", para apagar o histórico de aberturas da máquina da pessoa depois de uma rodada de testes.

### Grupos do WhatsApp: o aviso diz quando o que falta é conectar
#### Corrigido
- Com o WhatsApp da máquina desconectado, o tutorial dos grupos dizia que "o agente desta máquina ainda não permite ligar o grupo", mesmo no OpenClaw e no Hermes, que permitem. Agora o aviso diz que falta conectar o WhatsApp (tutorial 3) e só fala em agente sem suporte quando é esse o caso.

### Grupos do WhatsApp: máquina com o OpenClaw em outro perfil
#### Corrigido
- Numa máquina em que o OpenClaw roda num perfil próprio (pasta `~/.openclaw-<nome>`), "atualizar a lista" de grupos falhava mandando reinstalar o plugin do WhatsApp, que já estava instalado. Agora o erro diz que o WhatsApp está em outro perfil e que o meu-bot só trabalha com o perfil padrão.

### WhatsApp (Hermes): quem pede "só texto" para de receber áudio
#### Corrigido
- Quando um contato pedia ao agente para não responder em áudio, o agente dizia que sim e o áudio continuava chegando. Agora o agente desliga de fato o áudio daquela conversa (e religa se a pessoa pedir).

### WhatsApp: voz feminina também no agente Hermes
#### Novo
- Em "Áudio no WhatsApp", as máquinas com o agente Hermes agora mostram a escolha de voz (Masculina, Feminina e Masculina natural). Antes só havia a masculina e os cartões nem apareciam.

### Voz do Hermes: voz reprovada no teste não muda nada
#### Corrigido
- Ao escolher uma voz que não consegue falar na máquina (por exemplo, com a conta no limite de memória), o agente continua com a voz de antes e o app avisa; antes a resposta em áudio podia ficar ligada sem voz.

### Inspector: o zoom acompanha na hora
#### Corrigido
- No meu-bot-inspector-staging, a letra do Inspector acompanha cada Cmd+= e Cmd+- na hora, sem ficar um passo atrás.

### Inspector: o zoom da janela vale também para a interface
#### Corrigido
- No meu-bot-inspector-staging, aumentar o zoom da janela (Cmd+=) agora aumenta também a letra do Inspector. Antes ela encolhia para caber e ficava pequena.

#### Corrigido

- Modo instagramável: as marcas agora acompanham a aba. Cada aba do Navegador guarda as marcas da sua última leitura, e a janela mostra as da aba que está à vista; ao trocar de aba, trocam as marcas, e ao ir para outra tela (o terminal, por exemplo) elas somem e voltam quando você volta. Valem por 1 minuto depois da leitura, ou até a página daquela aba mudar.
- O cursor do agente não fica mais parado em cima de outra página: sai na hora quando a aba onde ele agiu deixa de estar à vista.

#### Mudou

- **Modo instagramável agora é funcional.** Saíram os cursores com nomes sorteados da organização, o voo, as partículas e as formações. No lugar, quando o agente lê uma página do Navegador, cada elemento que está à vista ganha uma marca colorida com o número e o texto dele, o mesmo número que o agente usa para clicar e digitar. Aparecem até 20 marcas; o resto vira o aviso "+N elementos à vista". As marcas saem quando a página muda ou depois de 20 segundos sem ação; se você rolar a página à mão, elas ficam fora do lugar até a próxima leitura.
- Os outros logs (notas, abrir aba, terminal) ficam numa lista fixa no canto de baixo da página, com quem agiu e o que fez.

#### Novo

- `nav_print` aceita `marcas=true`: a imagem sai com o número de cada elemento da última leitura desenhado em cima dele. Sem a opção, o print continua limpo.

#### Corrigido

- Modo instagramável: o cursor real e o show não ficam mais se intercalando a cada pausa do agente. Depois de uma ação na página, o real segura a cena por 30 segundos; o show só volta depois disso.

#### Mudou

- **Modo instagramável com dois modos, o real e o show.** O cursor real (o que anda até onde o agente clicou ou digitou) agora tem a cena só para ele: enquanto está à vista, os cursores coloridos do show saem do palco, e o que cada ação fez aparece num balão junto do cursor real. O show volta sozinho quando o real some, depois de alguns segundos sem ação na página.

### Lateral: Módulos e Finanças mostram a etiqueta "Custom"
#### Alterado
- Na barra lateral, Módulos e Finanças agora trazem a etiqueta "Custom", como os itens do plano Pro trazem "Pro": eles fazem parte do pacote sob medida. Em Finanças, a etiqueta dá lugar ao aviso "N para confirmar" quando há lançamentos esperando você.

### Leads: o Analytics recusou, dá para tentar de novo
#### Corrigido
- Quando o Analytics recusa ou está fora na hora de qualificar um lead, chamar de novo reenvia o evento. Antes ele se perdia. Depois de enviado, o lead não é contado outra vez.

### Site: código por visita nas conversas do WhatsApp
#### Novo
- Na página inicial, a mensagem pronta dos botões de WhatsApp leva um código curto da visita ("cód: ABC234"). Quem atende consulta o código e vê de qual campanha a conversa veio.
- Marcar o lead como qualificado manda o evento `qualify_lead` ao Analytics, na mesma visita em que a pessoa clicou.
- A página de privacidade explica o código e como pedir para apagá-lo.

### Console: as máquinas que usam o plano da sua conta
#### Novo
- Em Devices, o console lista as máquinas que usam a licença da conta, com a data até quando ela vale lá, e o botão "Tirar a licença".
- Em Plano, um cartão mostra quantas máquinas estão em uso do limite da conta.

### Máquina fora do limite: o app avisa, e o admin encerra uma máquina extra
#### Melhorado
- App › Sua conta: quando a conta passa a usar a licença em mais máquinas do que o plano cobre, a máquina que ficou de fora mostra o motivo e que a licença de lá vale só até vencer. Antes ela perdia a licença sem aviso.
- Console (admin): a lista de contas mostra as máquinas extras pagas de cada conta, com o prazo, e o botão "Encerrar" tira a vaga na hora, para reembolso ou disputa.

### Máquina extra: a base para usar o Pro em mais de uma máquina pagando por máquina
#### Novo
- Conta: o Pro inclui uma máquina; cada máquina a mais poderá ser assinada à parte, por mês, no console › Plano (painel "Máquinas"). Cada assinatura abre uma vaga, e cancelar mantém a vaga até o fim do mês pago. A venda fica desligada até o produto ser criado na AbacatePay.
- Console › Plano e Devices: o número de máquinas mostra quantas são do plano e quantas são extras ("1 de 2 (1 inclusa + 1 extra)").
#### Melhorado
- Conta: quando a conta usa a licença em mais máquinas do que o plano cobre (uma máquina extra venceu, ou o limite foi reduzido), as máquinas que entraram por último deixam de renovar a licença; as mais antigas continuam. Antes, uma máquina já ligada à conta renovava para sempre.
- App: a frase sobre onde a licença da conta vale passa a dizer o número de máquinas do seu plano, em vez de "uma máquina por vez" para todo mundo.

### Marketplace: cancelar pela página do item
#### Novo
- A página de cada item do Marketplace que você paga mostra a sua assinatura (valor, situação e até quando vale) e o botão "Cancelar". Continua dando para cancelar também em Plano.

### Marketplace em cartões: primeiro saber mais, depois contratar
#### Melhorado
- No console e no site, o Marketplace virou uma grade de cartões, no mesmo desenho da página Módulos do app. Cada cartão mostra o que você já tem e o que está disponível.
- Tocar num cartão abre a página do item, com o que ele faz, o que inclui e o preço. O botão de contratar fica só nessa página.

### Marketplace: página do item sem texto repetido
#### Melhorado
- Na página de um item, o nome e a descrição aparecem uma vez só. O quadro de contratar passou a mostrar apenas a situação da sua conta, como o pagamento funciona e o botão.

### Seletor: sem assinatura de IA, dá para entrar pelo modo grátis
#### Novo
- Em "este Mac" sem o Claude Code (ou com ele deslogado), o seletor de máquinas mostra o botão **Usar o modo grátis** ao lado de "Entrar no Claude Code". Ele abre a janela já no tutorial que instala um modelo no próprio Mac. Vale onde o modo grátis existe: Mac com chip Apple, por enquanto no staging.
#### Corrigido
- Com o modo grátis já instalado, o seletor volta a abrir "este Mac" mesmo sem o Claude Code: antes ele dizia "Claude Code não encontrado" e deixava o botão "Abrir" apagado, embora o modelo local já respondesse.

### Modo grátis também na máquina por SSH
#### Novo
- O modo grátis (tutorial 16) passa a valer na janela de uma máquina por SSH, não só em "este Mac": o app instala o Ollama e o modelo na própria máquina (Linux x86_64, sem sudo, numa pasta do meu-bot) e o `ollama-local` aparece em "Modos do agente" dela. Serve para quem não tem assinatura de IA naquela máquina. Sem placa de vídeo o modelo responde mais devagar que num Mac (cerca de 20 palavras por segundo numa VPS de 4 núcleos) e a primeira resposta depois de um tempo parado demora uns 20 segundos a mais. Por enquanto no staging.
- A linha do Ollama na lateral, com "parar"/"ligar", e o "Remover o modo grátis…" funcionam na máquina remota como no Mac.

### Depuração: o cursor do agente e o modo instagramável
#### Novo
- Com a depuração ligada, um cursor com o nome de quem age (Claude Code, WhatsApp…) anda até o ponto exato da página do Navegador onde o agente clica ou digita, e fica ali até a próxima ação.
- Um ✨ ao lado do "Intro", no seletor, liga o modo instagramável (também na paleta): cada log que chega vira um cursor, cada um de uma cor, com o primeiro nome de alguém da sua organização e um balão que diz o que aquele log fez (sem e-mail nem endereço completo). Ele voa até onde a ação aconteceu, ou até a faixa de depuração, e fica parado com o balão para dar para ler: entram um a um, acumulam até 20 e o mais novo toma o lugar do mais antigo; eles flutuam, se reorganizam a cada log e trocam de formação a cada 7 s (grade, onda, roda, colunas, diagonal); sem logs por 20 s, saem aos poucos até sumirem todos. Log com erro treme e explode em vermelho.

### Console e site: depois de pagar um add-on, a tela diz o que falta
#### Corrigido
- Depois de pagar um add-on (Finanças, Módulos do Diego), a página Plano dizia só que ele estava "ativo nesta conta", e a pessoa não entendia por que o módulo não aparecia no app. Agora ela diz os dois passos: o pagamento foi confirmado e o add-on está ativo na conta; falta a liberação na máquina, o pedido já está com o suporte e, quando for liberado, o add-on aparece na página Módulos do app. O aviso continua na página enquanto o pedido está aberto, e depois que o suporte o atende a tela diz que a liberação foi marcada como feita e o que fazer se o add-on não aparecer. O Pro não muda.
- No celular, "Mandar o link para o meu Mac" mandava sempre o endereço de produção. Agora o link é o do site em que a pessoa está: quem testa no staging recebe o link do staging.
- Com a promoção desligada, a página dela ainda respondia pelo caminho do arquivo sem ".html". Agora responde "página não encontrada" por todos os caminhos.

### Módulos: o CRM aparece em "Já incluído", com o botão de instalar
#### Novo
- A página Módulos ganhou o bloco "Já incluído", com o cartão do CRM: mostra se ele está instalado na máquina, o pipeline padrão e quantos pipelines e caixas existem. Dali você instala o CRM, abre o Gmail com o CRM e abre o guia de configuração.
- A página Módulos agora aparece em toda máquina acessada por SSH, mesmo sem nenhum produto de módulos na licença: nesse caso ela mostra só o "Já incluído". Em "Este Mac" ela continua aparecendo só para quem tem um produto de módulos.
#### Corrigido
- Não havia caminho na tela para instalar o CRM numa máquina: o botão ficava num tutorial que saiu da lista. Agora ele está no cartão do CRM, na página Módulos.
- O topo da página Módulos mostrava o nome de um produto só ("módulos · Financeiro"). Agora é só "módulos", e cada bloco leva o nome do seu produto.

### meu-bot-diego-staging: módulos com ficha
#### Novo
- A página Módulos mostra cada módulo numa ficha: o que dá para pedir ao agente, Testar conexão, as ferramentas que ele ganha, o guia e os primeiros passos. Os módulos vêm do repositório do produto, e o app os baixa sozinho.

### Módulos do Diego sem licença
#### Mudou
- Os módulos do meu-bot-diego não pedem mais o add-on na licença da máquina. A trava passa a ser o acesso ao repositório privado: quem não tem acesso nem baixa os módulos. O Financeiro, que é pago, continua pedindo a licença.
- Quando um add-on pede a licença, o aviso da página Módulos agora diz onde liberar: no meu-bot-admin, em Suporte › Conta e licença.

### Página do módulo leva perguntas ao chat
#### Novo
- A página de um módulo pode sugerir uma mensagem para o agente. O app só preenche a caixa do chat, com um aviso de onde veio, e quem envia é você.

### Módulos pela licença
#### Mudou
- A página Módulos deixa de ser só do meu-bot-diego-staging. Um add-on marcado para chegar como módulos aparece em qualquer app de cliente quando está na licença da máquina, cada um num bloco com o repositório de onde veio. Por enquanto nenhum add-on está marcado; o primeiro será o Financeiro, quando o módulo dele estiver pronto (issue #312).
- O `modulos.json` de um repositório de módulos precisa declarar o mesmo produto do repositório. Assim um repositório não consegue mais pegar carona na licença de outro add-on.

### Página do módulo importa do Google Sheets, com a sua confirmação
#### Novo
- A página de um módulo pode pedir para ler uma planilha do Google Sheets. O meu-bot mostra um cartão acima da página e só lê com o seu clique, usando a Conta Google da máquina. O conteúdo vai só para aquele módulo: primeiro vem a prévia do que entraria, e importar é outro clique. É o caminho da importação de planilhas no Financeiro como módulo (issue #312).

### Página própria de um módulo
#### Novo
- Um módulo pode trazer uma página própria. O botão "Abrir" na ficha dele mostra essa página numa aba do app, carregada da máquina por um túnel. A página fica isolada do app e só abre com a chave de acesso daquela instalação. É o caminho para o Financeiro virar módulo (issue #312).

### Navegador: o selo "legado" das abas vira "sem identificação"
#### Mudou
- Quando alguém usa o Navegador sem dizer quem é, a aba mostrava o selo "🤖 legado", que parecia um backend antigo rodando. Agora mostra "❔ sem identificação". O comportamento é o mesmo: quem não se identifica continua com as próprias abas e não mexe nas dos outros.

### Tutoriais: o Navegador não fica mais "consultando" em Este Mac
#### Corrigido
- No tutorial 9 (Navegador), em **Este Mac**, o passo "Preparar a máquina para o agente" ficava em "Consultando a máquina…" para sempre, com o botão desligado. Esse passo só existe nas máquinas por SSH; agora, neste Mac, ele diz que não há o que preparar e o tutorial segue.

### Navegador pelo WhatsApp também com o Hermes
#### Novo
- O agente do WhatsApp que roda no Hermes agora também usa o Navegador do app: você escreve para ele do celular ("está vendo o navegador aí?", "abre tal página") e ele abre, lê e clica nas abas, com os seus logins. Antes isso só existia para o OpenClaw.
- No 📱 da barra do Navegador você escolhe os números que podem pedir isso ao agente, na conversa direta. Para todos os outros contatos ele responde normalmente, sem navegador.
#### Corrigido
- Em máquina com Hermes, abrir o Navegador mostrava um erro do WhatsApp, porque o app tentava ligar o recurso do jeito do OpenClaw. Onde o recurso não existe, o 📱 agora fica apagado e diz o motivo.

### Modo grátis: o Qwen do Ollama aparece em "Modos do agente"
#### Novo
- Depois de instalar o modo grátis (tutorial 16), o menu "Modos do agente" mostra o **ollama-local** com o modelo que está neste Mac (por exemplo, Qwen 2.5 7B), e dá para trocar a conversa para ele e de volta com um clique. Antes só se chegava nele pelo tutorial ou pela paleta (⌘K).

- Organizações em produção: só uma por conta, com o Pro valendo; a dona vem incluída e cada usuário a mais custa R$ 47 por mês (de R$ 97), com o Pro incluído para ele.

### Organizações: adicione usuários pelo console
#### Novo
- Na página de membros da organização, quem é dona ou admin adiciona um usuário por R$ 47 por mês. A vaga abre assim que o pagamento é confirmado, e o convite passa a caber.
- A página mostra quantos usuários estão em uso, quantos são pagos e quem ficou sem cobertura.
- Quem usa o Pro pela organização vê isso no Plano e na Visão geral, com a data até quando vale.
- O Marketplace ganhou o item "Mais um usuário na organização".

### Organizações: criar faz parte do Pro, uma por conta
#### Mudou
- Para criar uma organização é preciso ter o Pro assinado; o teste grátis não inclui. Cada conta cria uma. Quem não pode vê o motivo e o caminho na própria tela.
- Quem precisa de mais de uma organização fala com o suporte, que libera na conta.

### Organizações: o usuário usa o Pro pela organização
#### Novo
- Quem é usuário de uma organização usa o Pro enquanto fizer parte dela, sem assinar o próprio. Vale enquanto o Pro de quem é a dona estiver ativo, e até a mesma data.
- Só o Pro vem da organização: apps, máquinas e Macs a mais continuam sendo de cada conta. Quem já tem o próprio Pro por mais tempo não muda nada.

### Site: organizações e usuários explicados
#### Mudou
- A página inicial, os Termos e a Privacidade passam a explicar a organização com o Pro: uma por conta, e R$ 47 por mês por pessoa a mais, com o Pro incluído para ela.

### Organizações: começam com você, e cada pessoa a mais é um usuário
#### Mudou
- A organização passa a incluir 1 usuário, quem a criou. Antes nascia com 5 lugares. Organização que já tinha mais gente fica com os lugares que já usa.
- Cada pessoa a mais é um usuário pago da organização. A compra pelo console entra na próxima etapa; até lá, o convite sem vaga explica o que falta.

### Testes do servidor no CI
#### Corrigido
- Os testes do servidor da conta passam a rodar em toda PR. Antes só rodavam na hora de publicar o site, e uma PR foi mesclada com um deles quebrado.
- A conferência de paridade entre staging e produção exige a promoção do primeiro mês igual nos dois ambientes.

### Conta: entrar com passkey
#### Novo
- Você pode criar uma passkey no console da conta (Perfil › Login e segurança) e entrar com a digital, o rosto ou a senha do aparelho, sem senha da conta e sem esperar e-mail. Na página de login, use "Entrar com passkey".
- O console lista as passkeys da conta, com quando cada uma foi criada e usada, e deixa remover.

### O Pro da sua conta numa máquina, sem esperar o admin
#### Novo
- Quem assina pelo site agora aplica o plano sozinho numa máquina por SSH: o aviso de plano mostra "Usar o meu Pro nesta máquina" e o bloqueio some na hora. A licença da conta vale em uma máquina por vez.
- Em Configurações › Sua conta, "Tirar o Pro desta máquina" libera a licença para usar em outra.
#### Mudou
- O aviso de plano passa a mandar assinar pelo site, em vez de pedir ao admin. O pedido ao admin continua só nas máquinas em que ele gravou um "Como pagar" próprio.
- O Pro que o admin liberou numa máquina continua valendo, junto com o da conta.
#### Corrigido
- Em Este Mac, entrar na conta ou pagar o plano não atualizava o que estava bloqueado até reabrir a janela.

### Conta: o plano passa a incluir 2 Macs
#### Novo
- Toda conta passa a ter 2 devices (dois Macs com o app) no lugar de 1. Quem já tinha um limite maior continua com ele.
- O Mac que estava pendente entra sozinho no próximo login quando passa a caber no limite, sem esperar o admin.

### Este Mac: disco e memória na saúde da máquina
#### Melhorado
- Com o "Este Mac" escolhido, a saúde da máquina passa a mostrar o disco livre, a memória disponível e o swap, como já mostrava nas máquinas por SSH.

### Console: tocar duas vezes em "Assinar" não abre dois pagamentos
#### Corrigido
- Console › Plano: com a promoção do primeiro mês na tela, tocar duas vezes rápido em "Assinar" podia abrir dois pagamentos. Agora o botão trava no primeiro toque.

### Promoção do primeiro mês: o aviso diz onde colar o cupom, e quem prefere Pix tem caminho
#### Melhorado
- Console › Plano: o aviso da promoção agora começa com "Seu teste acabou" e explica o passo que faltava: na página de pagamento, colar o cupom em "Código do cupom" e tocar em Aplicar, e o total cai para R$ 1. O botão "Copiar cupom" copia o código, e o "Assinar" também tenta copiá-lo.
- Console › Plano: durante a promoção, o link "Prefiro pagar com Pix: R$ 97 por mês, sem o desconto" abre o pagamento normal, com Pix e cartão. Antes, nesses dias, só dava para pagar no cartão.

### Primeiro mês do Pro por R$ 1 para quem terminou o teste
#### Novo
- Conta: quando o teste grátis acaba, a pessoa tem 3 dias para assinar o Pro pagando R$ 1 no primeiro mês; a partir do segundo mês, R$ 97. Vale uma vez por conta, só no cartão de crédito. Passado o prazo, ou para quem assina durante o teste, vale o preço normal desde o primeiro mês.
- Console › Plano: quem tem direito vê o aviso com o preço, até quando vale, o código do cupom (caso a página de pagamento o peça) e o link "Ver as regras". O botão vira "Assinar por R$ 1 no primeiro mês".
- As regras ficam em `/promocao`, página que só o console abre: não aparece na home, no menu nem no Google. Os termos de uso ganharam o item da promoção.
- A promoção liga por ambiente com o código do cupom (`PROMO_CUPOM`): ligada no staging, desligada em produção até o dono ligar.
- Em "Suas assinaturas" e na receita mensal do admin, a assinatura feita com a promoção aparece pelo valor do mês (R$ 97); o R$ 1 da primeira cobrança aparece na lista de pagamentos.

### Promoção do primeiro mês por R$ 1, ligada em produção
#### Novo
- Quem terminou o teste grátis tem 3 dias para assinar o Pro com o primeiro mês por R$ 1, no cartão. A oferta aparece no console, na página Plano, e as regras ficam em agentesgrok.com/promocao.

### Promoção do primeiro mês por R$ 1 também no Pix
#### Mudado
- A página da promoção diz que o primeiro mês por R$ 1 vale no cartão ou no Pix, e que no Pix nada renova sozinho.

### Seletor de máquinas: o selo "PRO" aparece para quem assinou pelo site
#### Corrigido
- Quem recebia o Pro pela conta do site (console) já usava o Navegador na máquina, mas o selo "PRO" não aparecia ao lado dela no seletor, nem na lista do meu-bot-admin. Agora o selo acompanha o plano que está de fato em vigor na máquina.

### Site: quem chega pelo celular vira conversa, e o download no Mac conta para o anúncio
#### Novo
- Na home aberta pelo celular, o botão principal é "Falar com a gente no WhatsApp". "Mandar o link para o meu Mac" continua logo abaixo.
- A mensagem pronta do WhatsApp diz de qual anúncio a pessoa veio.
#### Corrigido
- O link que a pessoa manda para o próprio Mac leva a campanha do anúncio. Antes o download feito no Mac não contava para o anúncio.
- O iPad é tratado como celular. Antes recebia o download do Mac.

### Site: a página inicial diz logo o que o meu-bot é, e o download mostra o passo que faltava
#### Mudou
- A página inicial abre dizendo a categoria: agentes de IA para a sua empresa, no Mac. A promessa "Pare de ser o gargalo da sua empresa" continua.
- A página de obrigado pelo download avisa que o teste de 3 dias só começa depois de criar a conta no app.
- O guia dos 4 caminhos passa a usar a expressão "automação de WhatsApp com IA" no título e na abertura, e a página de download diz que o meu-bot é um app de agentes de IA para Mac.

### Site: página pública do Marketplace
#### Novo
- O site ganhou o Marketplace em agentesgrok.com/marketplace: uma página com tudo o que dá para somar ao meu-bot (apps e extras), o preço de cada item e o caminho para contratar pelo console.

### Site: a produção só recebe o que foi conferido e aprovado no staging
#### Mudou
- O site de teste (site-staging.agentesgrok.com) passa a receber cada mudança sozinho, logo depois de ela entrar. O site de verdade (agentesgrok.com) deixa de ser publicado sozinho: só recebe a versão que está no site de teste e que o dono aprovou.
#### Novo
- Cada ambiente do site diz qual versão do código está no ar, e a conferência mostra se a produção está atrás do staging no mesmo histórico.
- A conferência do site passa a olhar o conteúdo, além de as páginas abrirem: os dias do teste grátis escritos na home, o ambiente e a medição de cada site.
#### Corrigido
- Um teste automático compara a configuração do site de teste com a do site de verdade e reprova diferença sem motivo escrito. As diferenças temporárias têm data para acabar.

### Site: o staging mostra o que a produção vai mostrar
#### Corrigido
- A home do staging (site-staging.agentesgrok.com) trocava o conteúdo: mostrava um plano "Beta tester" grátis no lugar dos planos de verdade, uma resposta diferente para "O que acontece no fim dos 3 dias?" e links para um rascunho de planos. Agora ela tem os mesmos planos, preços, botões e respostas da produção; só a faixa, o selo "staging" e o título dizem que é o staging.
- O rascunho de planos em /suporte, que só existia no staging, saiu do ar: o endereço responde "página não encontrada" nos dois ambientes.

#### Novo

- Site: quem chega de Windows não recebe mais o download do Mac. Vê "Avise-me quando sair para Windows", pode falar com a gente no WhatsApp ou deixar um e-mail ou WhatsApp para ser avisado do lançamento, na home e na página de download.

### Acervo: importar a sua skill pelo link do repositório
#### Novo
- O Acervo ganhou "Minhas skills": cole o link de um repositório do GitHub com a sua skill e a máquina baixa com o GitHub conectado nela (repositório privado funciona). Antes de instalar, você vê o nome, a descrição, os arquivos e o commit. A skill vai para o Claude Code da máquina e para o agente do WhatsApp, e usar a sua própria skill não custa nada.
- Cada skill importada mostra de que repositório e de que commit veio, com Atualizar (mostra o novo commit e os arquivos antes de trocar) e Remover. Se o agente editou a skill, a atualização mantém o texto dele.
- Importar, atualizar e remover uma skill ficam registrados na Auditoria da máquina, com o repositório e o commit.

### Skills do meu-bot também no Hermes
#### Corrigido
- Numa máquina com Hermes, as skills que o meu-bot instala para o agente (financeiro, sites do Navegador, grupos do WhatsApp, computador do bot e voz das respostas) iam só para a pasta do Claude Code, e o Hermes não as via. Agora vão também para `~/.hermes/skills`, como a do CRM já ia.
#### Mudou
- Ao reinstalar ou atualizar, a skill que o agente não editou recebe o texto novo; a que ele editou fica como está, e a saída do instalador diz onde está o texto novo para comparar. Antes, as skills dos grupos do WhatsApp, do computador do bot e da voz eram regravadas por cima a cada instalação, e as dos sites do Navegador nunca eram atualizadas.

### Release: staging do site não espera 1 h depois do conserto
#### Corrigido
- Quando a publicação do staging do site falha, o agente espera 1 h só para tentar de novo o mesmo commit. Se a main andar (o conserto entrou), ele tenta na rodada seguinte.
- `conta-api/README.md`: a propriedade do Analytics de cada ambiente vem com o número dela.

### Site: roteiro de conferência do staging antes de aprovar a produção
#### Novo
- `docs/STAGING.md`: o que conferir no staging antes de aprovar a produção do site, uma linha por fluxo com o resultado esperado (site no computador e no celular, cadastro e teste grátis, página Plano, pagamento no Modo Teste com a promoção do primeiro mês, admin, Analytics do ensaio), as diferenças conscientes entre os dois ambientes, a regra de cada serviço de fora (AbacatePay, Analytics, Google Ads, banco) e o registro que vai no `--aprovar <sha> --roteiro <arquivo>`.
- `scripts/staging-contas.mjs`: põe as contas de teste do staging nos estados que o roteiro usa (em teste, teste vencido ontem, prazo da promoção vencido, Pro ativo) pela API de admin, sem escrever no banco. Só fala com o staging: recusa qualquer outro endereço.

### Site: o staging é sempre a main
#### Corrigido
- O endereço de ensaio do site (site-staging.agentesgrok.com) podia receber uma versão ainda em preparo, por cima da que estava sendo conferida. Agora ele só recebe o que já entrou na versão principal.

### WhatsApp: modo sugestão, em que o agente escreve e você aprova (staging)
#### Novo
- No meu-bot-staging, a lista do WhatsApp ganhou o modo sugestão. Com ele ligado, a resposta do agente não sai sozinha: ela aparece no topo da lista e você aprova, edita antes de enviar ou descarta. O botão "WhatsApp" mostra quantas esperam. A conversa do seu número com ele mesmo continua direta.

### Super admin: Pro sem prazo (∞)
#### Novo
- A conta de um super admin tem o Pro sem prazo: nunca vence, nunca está em teste e nunca fica expirada, no console, no app e nas máquinas que usam a licença da conta. Os limites de devices e de máquinas continuam os mesmos.
- No console, onde aparecia a data ou a contagem regressiva do plano aparece "∞": no cabeçalho da página Plano ("∞ sem prazo"), no cartão "Vale até" (Plano e Visão geral) e na lista de contas do admin ("Pro · ∞"). No app, o menu da conta mostra "∞ sem prazo".
- O super admin não vê a promoção do primeiro mês nem o painel "Assinar o Pro"; os add-ons continuam podendo ser assinados.
- No editor de licença do admin, a conta de um super admin abre com o aviso de que o que está gravado ali só volta a valer se a pessoa deixar de ser super admin.

### Super admin: tudo liberado, e a lista de contas mais limpa
#### Alterado
- A conta de super admin passa a ter todos os add-ons (os de hoje e os que vierem), devices sem limite e máquinas sem limite, sem assinar nada. No console, esses campos aparecem como "∞" e os painéis "Assinar" somem do Plano dele.
- Console › Contas: a coluna Add-ons saiu da lista; os add-ons de cada conta aparecem ao clicar em "Editar" (o botão que se chamava "Mudar").

### Testes: o teste do Autenticador não falha mais em pasta nova
#### Corrigido
- O teste do bundle do Autenticador pulava só quando faltava o Autenticador compilado. Numa pasta nova com o Autenticador e sem o CRM, ele falhava ao ler o manifesto do CRM. Agora pula também quando falta o CRM, com o qual ele compara o id.

### Teste grátis de 3 dias, com mais tempo dado pelo admin
#### Novo
- O teste grátis do Pro passa a durar 3 dias para conta nova. Quem já está em teste mantém a data que tinha.
- No console do admin, o botão "+30 dias de teste" preenche Pro, Trial e a data de hoje mais 30 dias na licença da conta.
- O site convida quem precisa de mais tempo a falar pelo WhatsApp.
#### Corrigido
- Um teste automático confere se os dias de teste escritos no site, no login e no app são os da configuração. Antes o número estava escrito à mão em 77 lugares, sem conferência.

### O nome da máquina aparece no canto da janela
#### Novo
- A barra do topo mostra, no canto esquerdo, o nome da máquina aberta naquela janela, com a bolinha na cor dela. Com mais de uma janela aberta, dá para saber qual é qual sem procurar.

### Tutoriais: o passo não fica mais "consultando" para sempre
#### Corrigido
- Nos tutoriais do Navegador, da status line, da guarda do WhatsApp, do CRM, das contas de linha de comando e do link público, quando a consulta à máquina falhava o passo ficava em "Consultando a máquina…" contando segundos, com o botão desligado. Agora ele diz por que não conseguiu e oferece **Tentar de novo**.
- No tutorial do CRM, em **Este Mac**, o passo "Instalar" diz que não há o que instalar aqui, em vez de ficar consultando.
- No tutorial da guarda do WhatsApp, a máquina sem OpenClaw recebe o aviso de que a guarda não se aplica, em vez de ficar consultando.

### Tutoriais: o número da lateral some depois de pular o tour
#### Corrigido
- Quem pulava o tour continuava vendo "1" ao lado de Tutoriais, com a lista vazia. Agora o tour pulado conta como arquivado, como a página já mostrava.

### Tutorial do Navegador: conclui em Este Mac quando o agente navega
#### Corrigido
- No tutorial 9 (Navegador), em **Este Mac**, depois de "Ir para a conversa" o agente abria o site, mas o passo "Deixar o agente navegar" não concluía e o tutorial ficava em 3 de 4. Agora o passo reconhece a navegação do agente também neste Mac.

### Tutorial do WhatsApp: dá para voltar e trocar o agente escolhido
#### Corrigido
- No tutorial 3, quem escolhia o agente errado (Hermes em vez de OpenClaw, ou o contrário) não tinha como voltar ao passo 1. Agora a linha "Agente: …" tem um "Trocar", que reabre a escolha sem recomeçar o tutorial.

### WhatsApp: a mensagem que o agente da máquina manda aparece na conversa mesmo depois de limpar o histórico
#### Corrigido
- Numa máquina com Hermes, quando você pedia ao chat para mandar uma mensagem a um contato cuja conversa tinha sido limpa, a mensagem chegava no celular mas a conversa do app continuava "Sem mensagens ainda". Agora ela aparece na conversa, e o agente do WhatsApp sabe o que foi enviado.

### WhatsApp neste Mac: dá para escolher o Hermes
#### Novo
- No tutorial "Conectar o WhatsApp ao agente", em Este Mac, o cartão do Hermes agora pode ser escolhido quando o Hermes está instalado no Mac. Antes só o OpenClaw era aceito aqui, e o "Trocar" não tinha para onde ir.
- Quem se arrepende do agente escolhido troca na hora, mesmo com o QR na tela: o clique no outro agente cancela o pareamento e faz a troca, sem precisar ler o QR nem esperar ele expirar.

### Windows: a versão de teste passa a sair junto com a do Mac
#### Adicionado
- Cada versão de teste (staging) agora traz também o instalador do meu-bot-staging para Windows (64 bits), com a mesma numeração da versão do Mac. No Windows o app conecta numa máquina remota por SSH e se atualiza sozinho. O instalador ainda não tem assinatura da Microsoft: o Windows mostra um aviso na instalação.

### Grok: entrar na xAI numa máquina ainda não preparada
#### Corrigido
- Numa máquina por SSH em que o Grok ainda não foi preparado, "Entrar na xAI" terminava em "o login da xAI não concluiu (código 127)", sem dizer o que fazer. Agora o app leva ao tutorial 4 para preparar primeiro, e a mensagem de erro diz que falta o passo "Preparar o Grok nesta máquina".

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
