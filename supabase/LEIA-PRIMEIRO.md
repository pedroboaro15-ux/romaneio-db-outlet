# Ordem pra rodar no Supabase

Cole cada um no **SQL Editor → New query → Run**, nesta ordem.

| # | Arquivo | Quando rodar | Pode repetir? |
|---|---|---|---|
| 1 | `schema.sql` | Sempre que eu avisar que tem coluna nova | **Sim**, é feito pra isso |
| 2 | `schema-estoque.sql` | **Uma vez só**, na instalação | **Não.** Ele usa `create table` sem guarda e dá erro na segunda vez |
| 2b | `migracao-produtos-detalhes.sql` | Agora, uma vez (e pode repetir) | **Sim** |
| 3 | `seed-estoque.sql` | **Uma vez só**, na instalação | **Não.** Ele se recusa se já tiver rodado |
| 4 | `adicionar-dono.sql` | Quando entrar um novo dono | Sim |

Antes do 3 e do 4 você precisa ter criado as pessoas em **Authentication → Users**, e escrever os e-mails delas dentro do arquivo (está marcado onde).

O 3 e o 4 são de instalação: no dia a dia você só volta aqui pro `schema.sql`.
