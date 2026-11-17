# Windows em produção: o que falta e em que ordem

Estado em 17 de novembro de 2026. Não há prazo: este arquivo existe para a decisão não depender de memória.

## Onde estamos

- O meu-bot para Windows é um **cliente remoto** (x64): a janela roda no Windows e o agente roda numa máquina por SSH.
  Não há backend local, agente no Navegador ou no Gmail, atalhos da mesa nem o painel Computador (`capsFor`,
  `src/main/app/variant-core.ts`; `docs/guia/app.md`, seção "Windows (x64, cliente remoto)").
- Só o `meu-bot-staging` sai para Windows (`windows: true`). O instalador NSIS é montado no Mac
  (`scripts/instalador-win.mjs`) e **não tem assinatura Authenticode**: o SmartScreen avisa na instalação.
- O site entrega o instalador só no staging: `/baixar-windows` e `/download/windows(.json)` respondem 404 em produção.
- A campanha de Pesquisa não separa Mac de Windows no computador. Desde 17/11 o site desvia o visitante de Windows
  para a lista de espera (`lista_espera`, `conta-api/README.md`, "Lista de espera (Windows)").

## O que falta, na ordem

1. **Assinatura Authenticode.** Decisão e compra de quem responde pela Coflow: Azure Trusted Signing (assinatura em
   nuvem, exige validar a empresa) ou certificado OV/EV. Depois: ligar a assinatura em `scripts/instalador-win.mjs`
   (hoje `signAndEditExecutable: false`) e conferir num Windows limpo que o SmartScreen não avisa.
2. **Prova de saúde no Windows.** Hoje a estável é promovida só pela saúde do `meu-bot-staging` deste Mac
   (`saudeStaging`, `scripts/release-core.mjs`); nada confere o Windows. Mínimo: roteiro manual num Windows (instalar
   por cima, abrir uma máquina, mandar uma mensagem, atualizar sozinho) antes de cada promoção.
3. **Produto estável com `windows: true`** em `variant-core.ts` (o `meu-bot`), com o `.ico` ao lado do `.icns`.
4. **Site.**
   - `conta-api/src/index.ts`: tirar os dois `env.CANAL === "staging"` (download e página do Windows).
   - `conta-api/src/site-core.ts`: tirar `/site/baixar-windows.html` de `SO_NO_STAGING`.
   - `conta-api/src/release-github.ts`: `WINDOWS_RE` e `downloadWindows` aceitando o instalador da estável, por canal,
     como o `downloadMac`.
   - Reescrever `baixar-windows.html` (hoje fala em "versão de teste" e ensina a passar pelo SmartScreen), o FAQ
     "Funciona no Windows ou em Mac Intel?" (home e /perguntas, texto e JSON-LD) e o `llms.txt`.
   - `site.js`: o visitante de Windows passa a receber o download, não a lista.
5. **Oferta.** Como o Windows depende de uma máquina remota, decidir antes de anunciar: a Coflow hospeda a máquina de
   cada cliente (plano e preço próprios) ou o Windows fica para quem já tem um Mac ou servidor.
6. **Avisar a lista.** Exportar `lista_espera` (console › Assinaturas › Lista de espera), mandar o aviso por e-mail e
   WhatsApp e gravar `avisado_em`.

## O que não fazer antes disso

- Publicar `/baixar-windows` em produção sem a assinatura: o aviso do SmartScreen derruba a instalação.
- Marcar `lista_windows` como conversão de lance no Google Ads: o Google passaria a buscar mais gente de Windows.
