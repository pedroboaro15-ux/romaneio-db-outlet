-- =====================================================================
--  ADICIONAR UM SEGUNDO DONO (você e seu pai)
--
--  O seed-estoque.sql cria UM dono só: o dono da conta que rodou o seed.
--  Este arquivo acrescenta os outros — é o que faz "eu e meu pai somos os
--  admins" valer de verdade, sem depender da variável ADMIN_EMAILS.
--
--  Quem tem papel = 'dono' aqui entra no painel do romaneio E manda no
--  estoque. É a tabela que o api/lib/auth.js consulta.
--
--  COMO USAR
--    1. Crie a conta de cada um no Supabase, em Authentication > Users >
--       Add user (e-mail e senha; marque "Auto Confirm User" pra a pessoa não
--       precisar confirmar por e-mail).
--    2. Escreva os e-mails e nomes na lista marcada abaixo, um por linha.
--    3. Cole tudo no SQL Editor e clique em Run.
--
--  Seguro rodar de novo: se a pessoa já tiver perfil, ele só vira 'dono'.
-- =====================================================================
do $adicionar$
declare
  -- <<<<<< A LISTA: um par (e-mail, nome) por linha. Acrescente quantos quiser.
  v_donos text[][] := array[
    ['email-do-seu-pai@exemplo.com', 'Pai']
  ];
  v_email text;
  v_nome  text;
  v_user  uuid;
  v_org   uuid;
  i       int;
begin
  -- A loja é a mesma de quem já é dono. Assim não há risco de criar uma
  -- organização nova por engano e a pessoa entrar num estoque vazio, sem
  -- entender por que não vê nada.
  select org_id into v_org from perfis where papel = 'dono' limit 1;

  if v_org is null then
    raise exception
      'Ainda não existe nenhum dono. Rode o seed-estoque.sql primeiro.';
  end if;

  for i in 1 .. array_length(v_donos, 1) loop
    v_email := trim(v_donos[i][1]);
    v_nome  := trim(v_donos[i][2]);

    select id into v_user
      from auth.users
     where lower(email) = lower(v_email);

    if v_user is null then
      raise exception
        'Não achei o usuário %. Crie em Authentication > Users antes de rodar isto.', v_email;
    end if;

    insert into perfis (id, org_id, nome, papel)
    values (v_user, v_org, v_nome, 'dono')
    on conflict (id) do update
      set org_id = excluded.org_id,
          nome   = excluded.nome,
          papel  = 'dono';

    raise notice 'Pronto: % agora é dono da loja.', v_email;
  end loop;
end
$adicionar$;

-- Conferir quem são os donos hoje:
--   select p.nome, u.email, p.papel
--     from perfis p join auth.users u on u.id = p.id
--    where p.papel = 'dono';
