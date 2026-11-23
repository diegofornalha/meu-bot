### Admin: apagar um usuário de primeira
#### Corrigido
- Na aba Usuários, apagar um box podia falhar na primeira tentativa ("não consegui apagar"), porque o próprio admin mantinha uma conexão aberta como aquele usuário. Agora o admin fecha essa conexão antes de apagar.
