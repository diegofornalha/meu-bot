### Site: a produção só recebe o que foi conferido e aprovado no staging
#### Mudou
- O site de teste (site-staging.agentesgrok.com) passa a receber cada mudança sozinho, logo depois de ela entrar. O site de verdade (agentesgrok.com) deixa de ser publicado sozinho: só recebe a versão que está no site de teste e que o dono aprovou.
#### Novo
- Cada ambiente do site diz qual versão do código está no ar, e a conferência mostra se a produção está atrás do staging no mesmo histórico.
- A conferência do site passa a olhar o conteúdo, além de as páginas abrirem: os dias do teste grátis escritos na home, o ambiente e a medição de cada site.
#### Corrigido
- Um teste automático compara a configuração do site de teste com a do site de verdade e reprova diferença sem motivo escrito. As diferenças temporárias têm data para acabar.
