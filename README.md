# Gestão de Obra
1. `npm install`
2. `npm start`
3. Abra http://localhost:3000 e crie sua conta.
Defina `JWT_SECRET` antes de usar em produção.
## API para sincronização

A API usa o mesmo login do sistema. Faça login em `POST http://localhost:3000/api/login` com `email` e `senha`. Depois envie o token retornado no cabeçalho `Authorization: Bearer SEU_TOKEN`.

Para obter todos os dados do usuário, consulte `GET http://localhost:3000/api/v1/sync`. O retorno contém obras, compras, itens, parcelas, orçamentos, retiradas e estoque. Os endpoints existentes em `/api/obras`, `/api/compras`, `/api/parcelas`, `/api/orcamentos` e `/api/retiradas` podem ser usados pelo aplicativo para enviar alterações com o mesmo token.
