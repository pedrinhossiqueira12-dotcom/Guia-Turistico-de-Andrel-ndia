# Guia Andrelândia — MFA/TOTP real no STAGING sem movimentação financeira

**Status em 10/10/2026:** teste GoTrue REAL local passou pela CI anterior
12/12. No STAGING `jbttwihctuibchhcyqtl`, a auditoria ainda apontou
**zero fatores TOTP**. Portanto a etapa real em homologação está PENDENTE,
apesar das provas local/offline.

## Objetivo e escopo

Permitir que o proprietário, **no seu próprio terminal interativo e com
uma conta de laboratório exclusiva**, realize login AAL1, inscrição de um
fator TOTP, criação do desafio com GoTrue, verificação do código do
aplicativo autenticador e confirmação da mesma sessão em AAL2.

A ferramenta está em
`scripts/validacao-pagamentos/validar-gotrue-totp-staging-manual.ts`.
Ela somente usa endpoints `/auth/v1` do projeto **STAGING FIXO**
`https://jbttwihctuibchhcyqtl.supabase.co`. Não possui opção para
trocar URL, chamar produção, `service_role`, RLS/SQL privado, Asaas,
faturas, Pix, saques, pareceres ou Baixa.

**Não é um recurso do site e NÃO deve ser implantado como Edge Function.**
Não autoriza nada financeiramente e NÃO valida a assinatura JWT por conta
própria; valida o usuário recebido do GoTrue e usa claims apenas para
comprovar o smoke test AAL1→AAL2. A autorização financeira ainda exigirá
serviço próprio auditado e consulta de sessão.

## Pré-requisitos manuais

1. No dashboard do projeto **STAGING** (verifique o ID
   `jbttwihctuibchhcyqtl`), confira que cadastro e verificação de
   fatores Auth TOTP estão habilitados. Não altere o projeto de produção
   `xdmbkflufsfqziixzpxc`.
2. No Auth → Users desse projeto, crie **uma conta nova de teste**,
   confirmada e com senha exclusiva. Para segurança, o script exige
   e-mail com formato `mfa-teste+qualquer-identificador@seudominio.com`.
   Não use uma conta de administrador, vendedor, usuário real ou senha
   compartilhada com produção. A conta deverá ser dedicada apenas à
   homologação do MFA.
3. Copie a chave **Publishable (sb_publishable_...)** do projeto STAGING,
   em Settings → API Keys. **Nunca** copie `sb_secret_`, `service_role`,
   a connection string PostgreSQL ou qualquer token financeiro.
4. No **seu computador** (não no chat nem no runner CI), instale Deno 2,
   abra PowerShell na raiz da branch do PR #39 e execute os comandos
   abaixo. Não encaminhe senhas, códigos, tokens ou segredos ao assistente.

## Comandos PowerShell — terminal privado

```powershell
# Substitua SOMENTE pela chave PUBLICÁVEL do projeto STAGING.
$env:STAGING_PUBLISHABLE_KEY = 'sb_publishable_SUBSTITUA_PELA_CHAVE_STAGING'

# Somente a URL fixa do projeto de homologacao é alcançável.
deno run --allow-env=STAGING_PUBLISHABLE_KEY --allow-net=jbttwihctuibchhcyqtl.supabase.co:443 scripts/validacao-pagamentos/validar-gotrue-totp-staging-manual.ts --staging-manual-auth-only

# Limpe a variável pública ao terminar.
Remove-Item Env:\STAGING_PUBLISHABLE_KEY
```

O script exige digitar `HOMOLOGACAO` explicitamente e vai solicitar
o e-mail exclusivo e a senha de testes (entrada de senha oculta). Se
a conta não tiver TOTP, cadastrará um fator **nesse usuário de testes**,
pedirá aprovação para exibir **uma única vez no seu próprio terminal**
a chave Base32 gerada pelo GoTrue e solicitará que você a cadastre em
um aplicativo autenticador. Em seguida solicitará o código de 6
dígitos e executará `challenge` + `verify`.

**A chave Base32 é confidencial.** Se ela apareceu na tela, evite
gravação de sessão, captura de tela, transmissão ao vivo e
compartilhamento do terminal. Se a inscrição for abandonada, pode
restar um fator NÃO verificado: revise/limpe manualmente APENAS a
conta de testes pelo método Auth apropriado antes de reinscrever.

Se a conta de teste já possuir um fator TOTP verificado, o script
criará novo challenge e exigirá código do aplicativo, sem inscrever
um segundo fator.

## Resultado esperado e prova externa não confidencial

O terminal deverá informar:

```text
PASS: GoTrue STAGING confirmou fator TOTP, AAL1=>AAL2 e MESMA sessao.
FINANCEIRO: HOLD_OBRIGATORIO; nenhum Pix, parecer ou saque autorizado.
```

**Compartilhe apenas `TOTP STAGING PASS`, sem segredo, QR, OTP, senha
ou JWT.** Em seguida outra auditoria somente-leitura no STAGING pode
confirmar que há pelo menos um fator TOTP `status='verified'`.
Essa contagem **não prova autoria/titularidade** e não libera
pagamentos: o vínculo requer prova de sessão e desafio no backend.

## Testes automáticos e condição para encerrar a etapa

A CI da branch executa `deno check` e testes offline da ferramenta
em `validar-gotrue-totp-staging-manual.test.ts` com HTTP fictício.
Eles verificam que a origem é o STAGING e que não há acesso a rotas
financeiras, recusam conta normal/produção, simulam MFA com JWTs
fictícios e verificam igualdade `sub`/`session_id`.

**A etapa 1/8 só está concluída quando** um operador executar a prova
real no STAGING e o resultado puder ser auditado com fatores verificados,
não quando o teste simulado ou GoTrue local passar.

## Bloqueios que continuam

O PR #39 continua `DRAFT` e em `HOLD_OBRIGATORIO`.
Faltam backend privado de mínimo privilégio, vínculo de desafio
verdadeiro e autorização dos revisores, titularidade bancária Pix
(#41) e aprovação dupla/baixa atômica (#43).

Referências:
- https://supabase.com/docs/guides/auth/auth-mfa
- https://supabase.com/docs/guides/auth/auth-mfa/totp
- https://supabase.com/docs/reference/javascript/auth-mfa
