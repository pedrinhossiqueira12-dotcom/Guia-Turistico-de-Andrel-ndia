# Continuidade do Guia Andrelândia

- Repositório: `pedrinhossiqueira12-dotcom/Guia-Turistico-de-Andrel-ndia`; trabalho financeiro na branch `feat/asaas-faturas-saques-seguros`, PR #39 Draft.
- Leia integralmente `docs/BACKLOG_FINANCEIRO_PR39_EXECUCAO.md` antes de continuar. É a fila financeira canônica; notas antigas não reabrem aceites posteriores. COB-00–05 concluídas; continuar COB-06, COB-07, COB-08 e só depois SAQ.
- Trabalhe sobre o código existente, sem novos módulos fora da backlog. Avance autonomamente nas pendências locais seguras, com commits pequenos, testes proporcionais e evidências na backlog.
- Autorizados: edição local, testes isolados, commits e push normal desta branch. Não force-push, merge, deploy, migrations remotas, alterações de Secrets/flags, chamadas Asaas (inclusive Sandbox), Pix, saques, quitações, estornos ou operações em PROD/STAGING sem autorização específica. Uma autorização histórica delimitada não é autorização para repetir a operação.
- Não contorne HOLDs. O lote QA histórico já consultado não pode receber novo GET/reserva nem ter prova reconstruída. Não crie lote para contornar unicidade.
- Regra V2: 7% total; entrega 5% plataforma + 2% motoboy; retirada/consumo 7% plataforma. Preserve V1 histórico. Não apague dívidas, snapshots, aceites ou histórico; não invente crédito ou pagamento.
- Cobranças, saques e Pix Automático têm liberações independentes. O pacote seletivo de nove SQLs é candidato; CI verde e ZIP de revisão não autorizam publicação. Não aplique `pending-migrations` em lote.
- Testes locais não usam dados/credenciais reais nem rede bancária. Use os harnesses existentes; testes SQL somente em bancos descartáveis explicitamente permitidos. Não acesse backups privados nem o clone real do operador para repetir provas já aceitas.
- Nunca publique tokens, documentos pessoais, chaves Pix, dumps ou valores de Secrets. Registre somente evidências sanitizadas e limites de cada prova.
- Preserve as instruções úteis existentes. Registre bloqueios operacionais e avance em outras pendências seguras da mesma etapa; não inicie saques enquanto cobranças não estiverem concluídas.

## Verificação

- Node: `npm test` (dependências fixadas em `package-lock.json`). Testes específicos em `tests/` e Deno em `supabase/functions/tests/`.
- Consulte `.github/workflows/database-tests.yml` para os comandos isolados e requisitos de cada suíte; não execute comandos remotos de implantação.
- Ao retomar, confira pasta, branch, HEAD, estado Git, PR e CI. Ao encerrar, registre alterações, testes, commits, bloqueios e próxima ação sem declarar homologação produtiva por testes simulados.
