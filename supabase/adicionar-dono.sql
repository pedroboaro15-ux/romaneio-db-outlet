-- =====================================================================
--  ADICIONAR UM SEGUNDO DONO (você e seu pai)
--
--  O seed-estoque.sql cria UM dono só: o dono da conta que rodou o seed.
--  Este arquivo acrescenta os outros — é o que faz "eu e meu pai somos os
--  admins" valer de verdade, sem depender da variável ADMIN_EMAILS.
--
--  Quem tem papel = 'dono' aqui entra no painel do romaneio E manda no
--  estoque. É a tabela que o netlify/functions/lib/auth.js consulta.
--
--  COMO USAR
--    1. Crie a conta dele no Supabase, em Authentication > Users > Add user
--       (e-mail e senha; marque "Auto Confirm User" pra ele não precisar
--       confirmar por e-mail).
--    2. Troque o e-mail e o nome nas duas linhas marcadas abaixo.
--    3. Cole tudo no SQL Editor e clique em Run.
--
--  Seguro rodar de novo: se a pessoa já tiver perfil, ele só vira 'dono'.
-- =====================================================================
do $adicionar$
declare
  v_email text := 'email-do-seu-pai@exemplo.com';   -- <<<<<< TROQUE AQUI
  v_nome  text := 'Pai';                            -- <<<<<< E AQUI
  v_user  uuid;
  v_org   uuid;
begin
  select id into v_user
    from auth.users
   where lower(email) = lower(trim(v_email));

  if v_user is null then
    raise exception
      'Não achei o usuário %. Crie em Authentication > Users antes de rodar isto.', v_email;
  end if;

  -- A loja é a mesma de quem já é dono. Assim não há risco de criar uma
  -- organização nova por engano e a pessoa entrar num estoque vazio, sem
  -- entender por que não vê nada.
  select org_id into v_org from perfis where papel = 'dono' limit 1;

  if v_org is null then
    raise exception
      'Ainda não existe nenhum dono. Rode o seed-estoque.sql primeiro.';
  end if;

  insert into perfis (id, org_id, nome, papel)
  values (v_user, v_org, v_nome, 'dono')
  on conflict (id) do update
    set org_id = excluded.org_id,
        nome   = excluded.nome,
        papel  = 'dono';

  raise notice 'Pronto: % agora é dono da loja.', v_email;
end
$adicionar$;

-- Conferir quem são os donos hoje:
--   select p.nome, u.email, p.papel
--     from perfis p join auth.users u on u.id = p.id
--    where p.papel = 'dono';
