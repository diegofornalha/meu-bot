-- Preços das ferramentas, definidos pelo super admin no console (rotas/admin-ferramentas.ts). Antes ficavam num
-- arquivo do repositório: mudar um preço exigia alterar código, criar o produto à mão na AbacatePay e publicar o site.

-- O que está valendo: uma linha por ferramenta do catálogo (ferramentas-catalogo.ts) que já teve preço definido.
CREATE TABLE ferramentas_ofertas (
  slug TEXT PRIMARY KEY,           -- o slug do catálogo ("gmail", "google_search_console")
  produto TEXT NOT NULL,           -- prod_... da AbacatePay, o do preço atual
  centavos INTEGER NOT NULL,
  a_venda INTEGER NOT NULL,        -- 1 = aparece no Marketplace; 0 = tem preço mas está fora de venda
  atualizado_em TEXT NOT NULL,
  atualizado_por TEXT NOT NULL     -- e-mail do super admin
);

-- Todo produto já criado para uma ferramenta, um por preço. A AbacatePay não edita o preço de um produto: preço novo é
-- produto novo. Guardar os antigos serve para reaproveitar o produto quando o preço volta a um valor que já existiu (o
-- externalId é único na loja) e para conferir a cobrança de quem assinou por um preço antigo.
CREATE TABLE ferramentas_produtos (
  produto TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  centavos INTEGER NOT NULL,
  criado_em TEXT NOT NULL,
  criado_por TEXT NOT NULL
);
CREATE INDEX ferramentas_produtos_slug ON ferramentas_produtos (slug, centavos);
