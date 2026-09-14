-- =====================================================================
--  SEED — dados reais extraidos de "ESTOQUE OUTLET.xlsx"
--  222 produtos | 3320 pecas | R$ 3.005.043,00
--
--  Fabricas ja corrigidas:
--    - "dala costa LUKALIAN" virou Dalla Costa + Lukalian (empresas diferentes)
--    - "Colchoes" e "Mesas e cadeiras" eram abas, nao fabricas -> Sem fabrica definida
--  Tudo isso e editavel na tela Fabricas depois.
--
--  IMPORTANTE: rode DEPOIS de criar seu usuario no Supabase Auth.
--  Troque o e-mail abaixo pelo seu antes de executar.
-- =====================================================================
do $seed$
declare
  v_org  uuid;
  v_user uuid;
  v_email text := 'troque-pelo-seu@email.com';   -- <<<<<< TROQUE AQUI
begin
  -- Esta trava vem ANTES de tudo, inclusive da conferência do usuário.
  --
  -- Este arquivo é o único da pasta que não pode ser repetido: ele insere 222
  -- produtos sem conferir se já existem, então rodar duas vezes duplicaria a loja
  -- inteira — e o estoque ficaria com o dobro das peças sem ninguém entender por
  -- quê. Como o schema.sql, ao lado, é feito pra ser repetido e vive sendo, é fácil
  -- confundir os dois.
  --
  -- Vem primeiro porque, pra quem já rodou, a resposta certa é "isso já foi feito",
  -- e não "crie o usuário" — que é o que apareceria se a outra conferência viesse
  -- antes, mandando resolver um problema que não existe.
  select id into v_org from organizacoes limit 1;
  if v_org is not null then
    raise exception
      'O estoque já foi populado uma vez. Rodar de novo duplicaria os 222 produtos. Se você quer mesmo recomeçar do zero, apague os dados do estoque antes.';
  end if;

  select id into v_user from auth.users where email = v_email;
  if v_user is null then
    raise exception 'Crie o usuario % em Authentication > Users antes de rodar o seed.', v_email;
  end if;

  insert into organizacoes (nome) values ('Outlet dos Móveis') returning id into v_org;

  insert into perfis (id, org_id, nome, papel)
  values (v_user, v_org, 'Dono', 'dono')
  on conflict (id) do update set org_id = excluded.org_id, papel = 'dono';

  -- ---------- fabricas ----------
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Bianchi', 45);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Caemmun', 40);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Carolima Baby', 35);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Dalla Costa', 40);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Fatto JC', 45);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Fino Tok', 30);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Imope', 45);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'JB Bechara', 35);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Lukalian', 40);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Monalipe', 30);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Mundial', 25);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'San Marino', 45);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Sem fábrica definida', 30);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Sofá Conceito', 30);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Tebarrot', 30);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Telasul', 40);
  insert into fabricas (org_id, nome, prazo_entrega_dias) values (v_org, 'Vitor Cadeiras', 25);

  -- ---------- categorias ----------
  insert into categorias (org_id, nome, ordem) values (v_org, 'Sofás e Poltronas', 0);
  insert into categorias (org_id, nome, ordem) values (v_org, 'Roupeiros e Cômodas', 1);
  insert into categorias (org_id, nome, ordem) values (v_org, 'Mesas e Cadeiras', 2);
  insert into categorias (org_id, nome, ordem) values (v_org, 'Racks, Painéis e Homes', 3);
  insert into categorias (org_id, nome, ordem) values (v_org, 'Buffets e Cristaleiras', 4);
  insert into categorias (org_id, nome, ordem) values (v_org, 'Camas e Colchões', 5);
  insert into categorias (org_id, nome, ordem) values (v_org, 'Decoração', 6);
  insert into categorias (org_id, nome, ordem) values (v_org, 'Infantil', 7);
  insert into categorias (org_id, nome, ordem) values (v_org, 'Cozinha', 8);
  insert into categorias (org_id, nome, ordem) values (v_org, 'Escritório', 9);

  -- ---------- produtos ----------
  insert into produtos (org_id, fabrica_id, categoria_id, nome, variacao, preco, estoque, estoque_minimo)
  select v_org, f.id, c.id, d.nome, d.variacao, d.preco, d.estoque, d.minimo
  from (values
    ('Sofá Conceito','Sofás e Poltronas','SOFA PRIME 180','CACAU',899.00,0,1),
    ('Sofá Conceito','Sofás e Poltronas','POLTRONA DO PAPAI','cacau',899.00,13,2),
    ('Sofá Conceito','Sofás e Poltronas','LONDRES 2.10','bege',1799.00,15,2),
    ('Sofá Conceito','Sofás e Poltronas','SOFA LONDRES 170 LINHO','BEGE',1299.00,7,1),
    ('Sofá Conceito','Sofás e Poltronas','Costela','bege linho',1799.00,1,1),
    ('Sofá Conceito','Sofás e Poltronas','costela','cinza',1799.00,5,1),
    ('Sofá Conceito','Sofás e Poltronas','POLTRONA IGUATU','COURINO',899.00,18,3),
    ('Fatto JC','Sofás e Poltronas','LAZIO 240 LARGURA','119',2999.00,8,1),
    ('Fatto JC','Sofás e Poltronas','lazio 290 largura','120',2999.00,5,1),
    ('Fatto JC','Sofás e Poltronas','lazio 290 largura','119',299.00,0,1),
    ('Fatto JC','Sofás e Poltronas','lazio240 largura','120',2799.00,7,1),
    ('Fatto JC','Sofás e Poltronas','savana 100','120 bege',2499.00,9,1),
    ('Fatto JC','Sofás e Poltronas','savana 100','119 cinza',2499.00,6,1),
    ('Fatto JC','Camas e Colchões','SOFA CAMA GABRIELA 100 CM','318',2799.00,4,1),
    ('Fatto JC','Sofás e Poltronas','SOFA PARATY','512',1999.00,3,1),
    ('Fatto JC','Sofás e Poltronas','SOFA PARATY','511',1999.00,2,1),
    ('Sem fábrica definida','Camas e Colchões','COLCHAO D20','188X88',179.00,3,1),
    ('Sem fábrica definida','Camas e Colchões','bicam a aiam','solteirao',799.00,6,1),
    ('Sem fábrica definida','Camas e Colchões','bau nova','bege',899.00,15,2),
    ('Sem fábrica definida','Camas e Colchões','bau queen','bege',1699.00,1,1),
    ('Sem fábrica definida','Camas e Colchões','cama amsterd casal aian',null,1100.00,1,1),
    ('Sem fábrica definida','Camas e Colchões','cama queen amsterd aian',null,1299.00,1,1),
    ('Sem fábrica definida','Camas e Colchões','colvhaodavi qeen',null,1399.00,3,1),
    ('Sem fábrica definida','Camas e Colchões','cama dublin casal',null,999.00,19,3),
    ('Sem fábrica definida','Camas e Colchões','cama dublin queen',null,1199.00,9,1),
    ('Sem fábrica definida','Camas e Colchões','cama dublin king',null,1499.00,18,3),
    ('Sem fábrica definida','Camas e Colchões','KEIKO CASAL','1,68X218 ROSA',1999.00,2,1),
    ('Sem fábrica definida','Camas e Colchões','KEIKO SOL','1,18X218 ROSA',1899.00,1,1),
    ('Lukalian','Decoração','TB89 ESPELHO',null,699.00,4,1),
    ('Lukalian','Decoração','f17 wjg',null,499.00,3,1),
    ('Lukalian','Decoração','TB116L WJ',null,1899.00,1,1),
    ('Lukalian','Decoração','F29WJ',null,599.00,2,1),
    ('Lukalian','Decoração','R 514',null,549.00,4,1),
    ('Lukalian','Decoração','tb300',null,799.00,2,1),
    ('Dalla Costa','Racks, Painéis e Homes','BANCADA ALBI','JEQUITIBA',899.00,4,1),
    ('Dalla Costa','Racks, Painéis e Homes','BANCADA ALBI','OFF',899.00,5,1),
    ('Dalla Costa','Buffets e Cristaleiras','BUFFET ATLANTA','OFF',999.00,15,2),
    ('Dalla Costa','Buffets e Cristaleiras','BUFFET ATLANTA','JEQUITIBA',999.00,18,3),
    ('Dalla Costa','Buffets e Cristaleiras','BUFFET ELEGANTE','JEQUITIBA',899.00,11,2),
    ('Dalla Costa','Buffets e Cristaleiras','BUFFET ELEGANTE','OFF',899.00,11,2),
    ('Dalla Costa','Buffets e Cristaleiras','BUFFET MARSALA','JEQUITIBA',899.00,9,1),
    ('Dalla Costa','Buffets e Cristaleiras','BUFFET MARSALA','OFF',899.00,6,1),
    ('Dalla Costa','Buffets e Cristaleiras','CRISTALEIRA ADALIA','JEQUITIBA',1899.00,12,2),
    ('Dalla Costa','Buffets e Cristaleiras','CRISTALEIRA ADALIA','OFF',1899.00,12,2),
    ('Dalla Costa','Racks, Painéis e Homes','HOME ATLANTA 2,4','JEQUITIBA',1799.00,9,1),
    ('Dalla Costa','Racks, Painéis e Homes','HOME ATLANTA 2,4','OFF',1799.00,12,2),
    ('Telasul','Roupeiros e Cômodas','penteadeira',null,699.00,3,1),
    ('Telasul','Cozinha','cozinha lumina',null,2999.00,2,1),
    ('Bianchi','Roupeiros e Cômodas','ROUP ANGRA 2P','NT/OFF',1699.00,45,7),
    ('Bianchi','Roupeiros e Cômodas','ROUP ANGRA 2P','BRANCO',1699.00,0,1),
    ('Bianchi','Roupeiros e Cômodas','ROUP SERGIPE 4PTS','BRANCO',799.00,0,1),
    ('Bianchi','Roupeiros e Cômodas','ROUP SERGIPE 4PTS','NT/OFF',799.00,0,1),
    ('Bianchi','Roupeiros e Cômodas','ROUP SERGIPE 6PTS','NT/OFF',999.00,35,5),
    ('Bianchi','Roupeiros e Cômodas','ROUP SERGIPE 6PTS','BRANCO',999.00,0,1),
    ('Bianchi','Roupeiros e Cômodas','ROUP VENEZA 2PTS','NT/OFF',1999.00,0,1),
    ('Bianchi','Roupeiros e Cômodas','ROUP VENEZA 2PTS','BR',1999.00,15,2),
    ('Bianchi','Roupeiros e Cômodas','ROUP CAPRI 3PTS','NT/OFF',2399.00,0,1),
    ('Bianchi','Roupeiros e Cômodas','ROUP CAPRI 3PTS','BR',2399.00,12,2),
    ('Bianchi','Roupeiros e Cômodas','COMODA CAPRI','NAT/OFF',499.00,19,3),
    ('Bianchi','Roupeiros e Cômodas','COMODA CAPRI','BR',499.00,14,2),
    ('Bianchi','Roupeiros e Cômodas','COMODA ZEUS','BR',599.00,3,1),
    ('Bianchi','Roupeiros e Cômodas','COMODA ZEUS','NAT/OFF',599.00,0,1),
    ('Bianchi','Racks, Painéis e Homes','nexus 2,70','NAT OFF',2999.00,4,1),
    ('Bianchi','Roupeiros e Cômodas','ROUPEIRO BIANCA','NAT OFF',1999.00,70,11),
    ('Bianchi','Roupeiros e Cômodas','ROUPEIRO VIENA','NAT OFF',1999.00,21,3),
    ('Bianchi','Roupeiros e Cômodas','ROUPEIRO VIENA','BRANCO',1999.00,0,1),
    ('Bianchi','Roupeiros e Cômodas','CRIADO MALIBU','BRANCO',199.00,29,4),
    ('Bianchi','Roupeiros e Cômodas','CRIADO MALIBU','NAT OFF',199.00,0,1),
    ('Bianchi','Roupeiros e Cômodas','ROUPEIRO ZURICH','NAT OFF',2299.00,0,1),
    ('Bianchi','Roupeiros e Cômodas','ROUPEIRO ZURICH','NAT NAT',2299.00,0,1),
    ('Caemmun','Roupeiros e Cômodas','ROUPEIRO REFLEX 2,4','FREIJO',3499.00,15,2),
    ('Caemmun','Roupeiros e Cômodas','ROUPEIRO CLEO 2,30','FREIJO OFF',1999.00,13,2),
    ('Caemmun','Buffets e Cristaleiras','cristaleira mandrian',null,699.00,22,3),
    ('Caemmun','Roupeiros e Cômodas','ROUPEIRO AMARA','FREIJO OFF',2799.00,0,1),
    ('Caemmun','Racks, Painéis e Homes','BANCADA TANEN','FREIJO OFF',369.00,29,4),
    ('Caemmun','Roupeiros e Cômodas','ROUPEIRO COARI','FREIJO OFF',3199.00,4,1),
    ('Caemmun','Buffets e Cristaleiras','BUFFET MANDRIAN','FREIJO OFF',599.00,5,1),
    ('Caemmun','Roupeiros e Cômodas','ROUPEIRO ARCADIUS','BRANCO',1799.00,29,4),
    ('Caemmun','Roupeiros e Cômodas','ROUPEIRO ARCADIUS','FREIJO OFF',1799.00,17,3),
    ('Caemmun','Roupeiros e Cômodas','COMODA PEGAZUZ','FREIJO OFF',799.00,15,2),
    ('Caemmun','Racks, Painéis e Homes','TECH','BRANCO',399.00,24,4),
    ('Caemmun','Racks, Painéis e Homes','TECH','FREIJO OFF',399.00,56,8),
    ('Caemmun','Racks, Painéis e Homes','COMPOSICAO FLORA 1,8','FREIJO OFF',699.00,0,1),
    ('Caemmun','Roupeiros e Cômodas','CABECEIRA LUCIUS','FREIJO OFF',799.00,0,1),
    ('Caemmun','Racks, Painéis e Homes','BANCADAMANDRIAN 1.36','FREIJO OFF',319.00,22,3),
    ('Caemmun','Roupeiros e Cômodas','new reflex 1,8',null,2499.00,0,1),
    ('Caemmun','Roupeiros e Cômodas','roupeiro francis','freijo off',1699.00,6,1),
    ('Caemmun','Roupeiros e Cômodas','new reflex 2,7','freijo',3999.00,1,1),
    ('Caemmun','Buffets e Cristaleiras','cristaleira lumy',null,1299.00,28,4),
    ('Caemmun','Racks, Painéis e Homes','composicao bancada mandrian',null,599.00,7,1),
    ('Caemmun','Racks, Painéis e Homes','PAINEL JADE 1,5','FREIJO OFF',499.00,46,7),
    ('Carolima Baby','Infantil','berco eloa','bra betu',599.00,7,1),
    ('Carolima Baby','Infantil','berco eloa','113',599.00,1,1),
    ('Carolima Baby','Infantil','comoda eloa','br betul',499.00,7,1),
    ('Carolima Baby','Infantil','comoda eloa','113',499.00,1,1),
    ('Carolima Baby','Infantil','roup eloa','br betul',699.00,6,1),
    ('Carolima Baby','Infantil','branco',null,699.00,0,1),
    ('Sem fábrica definida','Mesas e Cadeiras','CADEIRA ISIS',null,699.00,0,1),
    ('Sem fábrica definida','Mesas e Cadeiras','mesa bridisi','2,20x1,10',2999.00,0,1),
    ('Sem fábrica definida','Mesas e Cadeiras','mesa florenca','2,20X 1,10',2999.00,1,1),
    ('Sem fábrica definida','Mesas e Cadeiras','CAD DUBAI TELINHA','629',499.00,2,1),
    ('Sem fábrica definida','Mesas e Cadeiras','cad florenca','629',799.00,0,1),
    ('Sem fábrica definida','Mesas e Cadeiras','cad florenca','671',799.00,0,1),
    ('Sem fábrica definida','Mesas e Cadeiras','cad florenca','808',799.00,32,5),
    ('Sem fábrica definida','Mesas e Cadeiras','cadeira APOLLO','629',299.00,4,1),
    ('Sem fábrica definida','Mesas e Cadeiras','mesa maju','madeira',3500.00,2,1),
    ('Sem fábrica definida','Mesas e Cadeiras','mesa DIANA','MADEIRA',2999.00,3,1),
    ('Sem fábrica definida','Mesas e Cadeiras','MESA PEDRO',null,999.00,29,4),
    ('Sem fábrica definida','Mesas e Cadeiras','mesa 2x1 samira',null,1799.00,2,1),
    ('Fino Tok','Mesas e Cadeiras','MESA CEBOLA LATERAL','60 cm',299.00,30,5),
    ('Fino Tok','Mesas e Cadeiras','MESA CEBOLA LATERAL','70 cm',299.00,10,2),
    ('Fino Tok','Mesas e Cadeiras','mesa cebola centro','45',299.00,15,2),
    ('Fino Tok','Mesas e Cadeiras','mesa cebola centro','35',299.00,15,2),
    ('Fino Tok','Buffets e Cristaleiras','aparador tokio cebola',null,599.00,26,4),
    ('Fino Tok','Mesas e Cadeiras','mesa 1,20 amadeira off',null,1299.00,49,7),
    ('Fino Tok','Mesas e Cadeiras','mesa 1,20 amadeira','MADEIRA',1299.00,0,1),
    ('Fino Tok','Mesas e Cadeiras','MESA 1,10','BRANCA',1299.00,11,2),
    ('Fino Tok','Mesas e Cadeiras','MESA 1,10','PRETA',1299.00,11,2),
    ('Fino Tok','Mesas e Cadeiras','MESA SOFIA lateral',null,399.00,7,1),
    ('Fino Tok','Mesas e Cadeiras','mesa cebola jantar 1,10 diametro',null,1099.00,3,1),
    ('Fino Tok','Mesas e Cadeiras','prato giratorio','cin',299.00,30,5),
    ('Fino Tok','Decoração','BANDEJA ESPELHADA','cin',199.00,15,2),
    ('Fino Tok','Mesas e Cadeiras','MESA FEIJAO',null,1599.00,22,3),
    ('Fino Tok','Mesas e Cadeiras','MESA FEIJAO','branca',1599.00,1,1),
    ('Fino Tok','Decoração','ESPELHO SLIN 60',null,299.00,30,5),
    ('Fino Tok','Mesas e Cadeiras','CONJ ORG SLIN 3UNI',null,1099.00,3,1),
    ('Fino Tok','Decoração','CONE 90','OFF',999.00,9,1),
    ('Fino Tok','Decoração','CONE 90','CATANHO',999.00,16,2),
    ('Fino Tok','Mesas e Cadeiras','MESA OVAL 220','OFF',2499.00,14,2),
    ('Fino Tok','Mesas e Cadeiras','MESA OVAL 220','CATANHO',2499.00,10,2),
    ('Fino Tok','Mesas e Cadeiras','MESA OVAL 150','AMADEIR',1799.00,19,3),
    ('Fino Tok','Mesas e Cadeiras','MESA OVAL 150','OFF',1799.00,7,1),
    ('Fino Tok','Mesas e Cadeiras','MESA OVAL 180','AMADEIR',1999.00,9,1),
    ('Fino Tok','Mesas e Cadeiras','MESA OVAL 180','OFF',1999.00,16,2),
    ('Fino Tok','Decoração','ORGANIVA 180X1 2 BASE','AMADEIR',1999.00,10,2),
    ('Monalipe','Sofás e Poltronas','poltrona andara','5003',699.00,5,1),
    ('Monalipe','Sofás e Poltronas','poltrona andara','5027',699.00,2,1),
    ('Monalipe','Sofás e Poltronas','poltrona andara','5049',699.00,10,2),
    ('Monalipe','Sofás e Poltronas','perseus',null,299.00,45,7),
    ('Monalipe','Sofás e Poltronas','sofa sirius',null,1999.00,3,1),
    ('Monalipe','Sofás e Poltronas','poltrona doris',null,799.00,10,2),
    ('Monalipe','Sofás e Poltronas','poltrona mona',null,799.00,14,2),
    ('Monalipe','Sofás e Poltronas','roma 05',null,1799.00,6,1),
    ('Tebarrot','Decoração','luminaria',null,399.00,24,4),
    ('Tebarrot','Mesas e Cadeiras','cadeira detroit',null,399.00,238,36),
    ('Tebarrot','Racks, Painéis e Homes','rack amsterdan','gianduia',399.00,0,1),
    ('Tebarrot','Buffets e Cristaleiras','BUFET ARES 3 PORTAS',null,499.00,2,1),
    ('Tebarrot','Decoração','placa 45 cm x250',null,299.00,5,1),
    ('Tebarrot','Sofás e Poltronas','poltrona polo','105',699.00,1,1),
    ('Tebarrot','Sofás e Poltronas','poltrona polo','128',699.00,23,3),
    ('Tebarrot','Sofás e Poltronas','poltrona polo','226',699.00,6,1),
    ('Tebarrot','Sofás e Poltronas','poltrona polo','232',699.00,3,1),
    ('Tebarrot','Sofás e Poltronas','poltrona polo','234',699.00,17,3),
    ('Tebarrot','Sofás e Poltronas','poltrona polo','235',699.00,2,1),
    ('Tebarrot','Sofás e Poltronas','poltrona polo','236',699.00,17,3),
    ('Tebarrot','Sofás e Poltronas','poltrona polo','237',699.00,1,1),
    ('Tebarrot','Sofás e Poltronas','poltrona polo','244',699.00,1,1),
    ('Tebarrot','Sofás e Poltronas','poltrona polo','521',699.00,2,1),
    ('Tebarrot','Sofás e Poltronas','poltrona polo','531',699.00,1,1),
    ('Tebarrot','Sofás e Poltronas','poltrona polo','337',699.00,1,1),
    ('Tebarrot','Sofás e Poltronas','poltrona tip','104',599.00,2,1),
    ('Tebarrot','Sofás e Poltronas','poltrona tip','105',599.00,7,1),
    ('Tebarrot','Sofás e Poltronas','poltrona tip','128',599.00,3,1),
    ('Tebarrot','Sofás e Poltronas','poltrona tip','227',599.00,4,1),
    ('Tebarrot','Sofás e Poltronas','poltrona tip','234',599.00,2,1),
    ('Tebarrot','Sofás e Poltronas','poltrona tip','305',599.00,5,1),
    ('Tebarrot','Sofás e Poltronas','poltrona tip','518',599.00,7,1),
    ('Tebarrot','Sofás e Poltronas','poltrona up','104',599.00,5,1),
    ('Tebarrot','Sofás e Poltronas','poltrona up','105',599.00,1,1),
    ('Tebarrot','Sofás e Poltronas','poltrona up','106',599.00,1,1),
    ('Tebarrot','Sofás e Poltronas','poltrona up','128',599.00,9,1),
    ('Tebarrot','Sofás e Poltronas','poltrona up','305',599.00,4,1),
    ('Tebarrot','Sofás e Poltronas','poltrona up','337',599.00,4,1),
    ('Tebarrot','Sofás e Poltronas','poltrona up','418',599.00,3,1),
    ('Tebarrot','Sofás e Poltronas','poltrona up','518',599.00,3,1),
    ('Tebarrot','Sofás e Poltronas','poltrona up','531',599.00,1,1),
    ('JB Bechara','Escritório','escrivaninha jb 6055','off',399.00,7,1),
    ('JB Bechara','Roupeiros e Cômodas','cabeceira casal ripada','off nat',999.00,57,9),
    ('JB Bechara','Buffets e Cristaleiras','buffet tucupi 136','off pe dourado',599.00,54,8),
    ('JB Bechara','Buffets e Cristaleiras','cristaleira tucupi','off pe dourado',899.00,23,3),
    ('JB Bechara','Buffets e Cristaleiras','cristaleira tucuma','off nature',999.00,15,2),
    ('JB Bechara','Racks, Painéis e Homes','painel ripado 1,80','off nature',1199.00,45,7),
    ('JB Bechara','Racks, Painéis e Homes','painel ripado 2,30','off nature',1499.00,73,11),
    ('JB Bechara','Racks, Painéis e Homes','home 2,60 ripado','off nature',2599.00,20,3),
    ('JB Bechara','Racks, Painéis e Homes','BANCADA ACAI 1,40','OFF WITW',499.00,25,4),
    ('JB Bechara','Racks, Painéis e Homes','BANCADA ACAI 1,80','OFF WHITE',599.00,0,1),
    ('JB Bechara','Racks, Painéis e Homes','BANCADA TUCUMA 1,8','OFF',499.00,85,13),
    ('JB Bechara','Racks, Painéis e Homes','BANCADA TUCUMA 1,8','NAT OFF',499.00,37,6),
    ('JB Bechara','Racks, Painéis e Homes','BANCADA TUCUMA 1,4',null,399.00,54,8),
    ('JB Bechara','Buffets e Cristaleiras','CRISTALEIRA BURITI','OFF NATURE',999.00,27,4),
    ('JB Bechara','Racks, Painéis e Homes','BANCADA 1,8 BURITI','OFF NATURE',699.00,23,3),
    ('JB Bechara','Buffets e Cristaleiras','BUFET ARUMA','OFF NATURE',599.00,42,6),
    ('JB Bechara','Racks, Painéis e Homes','TORRE','off',999.00,23,3),
    ('JB Bechara','Racks, Painéis e Homes','PAINEL BOTO 1,4','OFF',299.00,54,8),
    ('JB Bechara','Racks, Painéis e Homes','PAINEL BOTO 1,8','OFF',349.00,54,8),
    ('JB Bechara','Racks, Painéis e Homes','HOME 1,8 CARVALHO','CARVALHO',1799.00,12,2),
    ('JB Bechara','Racks, Painéis e Homes','HOME 2,3 CARVALHO','CARVALHO',2199.00,13,2),
    ('Vitor Cadeiras','Mesas e Cadeiras','MESA SAFIRA','180x90',1499.00,1,1),
    ('Vitor Cadeiras','Mesas e Cadeiras','MESA RUBI','120x80',999.00,1,1),
    ('Vitor Cadeiras','Mesas e Cadeiras','CADEIRA AMETISTA',null,599.00,40,6),
    ('Vitor Cadeiras','Mesas e Cadeiras','CADEIRA LIRIO',null,599.00,56,8),
    ('Vitor Cadeiras','Mesas e Cadeiras','MESA IMPERIAL','off',1799.00,5,1),
    ('Vitor Cadeiras','Mesas e Cadeiras','MESA IMPERIAL','amadeirada',1799.00,8,1),
    ('Vitor Cadeiras','Mesas e Cadeiras','MESA IMPERATRIZ','off',2299.00,4,1),
    ('Vitor Cadeiras','Mesas e Cadeiras','MESA IMPERATRIZ','amadeirada',2299.00,10,2),
    ('Vitor Cadeiras','Sofás e Poltronas','POLTRONA VENEZA',null,599.00,36,5),
    ('San Marino','Roupeiros e Cômodas','ARMARIO MULTIFUNSIONAL VEGAS','113',299.00,0,1),
    ('San Marino','Roupeiros e Cômodas','roupeiro new calabria','217',999.00,13,2),
    ('San Marino','Roupeiros e Cômodas','MULT VEGAS','217',299.00,0,1),
    ('Mundial','Mesas e Cadeiras','mesa slim 120x90',null,1199.00,9,1),
    ('Mundial','Mesas e Cadeiras','cadeira turim',null,599.00,76,11),
    ('Mundial','Mesas e Cadeiras','CADEIRA VALENCIA TELINHA',null,499.00,77,12),
    ('Mundial','Mesas e Cadeiras','CADEIRA ISA',null,299.00,166,25),
    ('Mundial','Mesas e Cadeiras','MESA PEDRO 120X80',null,999.00,39,6),
    ('Mundial','Mesas e Cadeiras','CADEIRA DALIA',null,599.00,40,6),
    ('Mundial','Mesas e Cadeiras','CADEIRA GRECIA',null,799.00,18,3),
    ('Imope','Buffets e Cristaleiras','CRISTALEIRA CANADA','cin off',1599.00,21,3),
    ('Imope','Roupeiros e Cômodas','rou londres 6pts','cin off',1799.00,7,1),
    ('Imope','Roupeiros e Cômodas','rou portugal 6pts','cin off',1199.00,0,1),
    ('Imope','Roupeiros e Cômodas','rou potenza 6pts','cin off',2499.00,0,1),
    ('Imope','Roupeiros e Cômodas','comoda dubai','cin off',549.00,1,1),
    ('Imope','Roupeiros e Cômodas','roupeiro monterrey',null,1499.00,31,5)
  ) as d(fabrica, categoria, nome, variacao, preco, estoque, minimo)
  join fabricas   f on f.org_id = v_org and f.nome = d.fabrica
  join categorias c on c.org_id = v_org and c.nome = d.categoria;

  raise notice 'Seed concluido: % produtos.', (select count(*) from produtos where org_id = v_org);
end $seed$;