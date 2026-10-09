# Guia Andrelândia — cobrança manual, termos e evolução futura para Pix Automático

**Ambiente permitido neste desenvolvimento:** Supabase STAGING `jbttwihctuibchhcyqtl`.
**Produção não autorizada:** `xdmbkflufsfqziixzpxc`.
**Branch:** `feat/asaas-faturas-saques-seguros`; PR #39 deve continuar Draft.

## Cobrança mensal agora e Pix Automático no futuro

- Modalidade atual: **Pix manual mensal** da fatura de comissões elegíveis (5% plataforma, 2% motoboy quando aplicável).
- A nova tabela `catalogo_cobranca_preferencias` associa o estabelecimento ao método, usando `pix_manual` como padrão.
- `pix_automatico` é apenas uma opção de esquema para o futuro: exige autorização externa confirmada e identificador do mandato antes de poder ser marcado como autorizado.
- A Edge atual **não oferece ativação nem débito automático**; não há CNPJ PJ nem permissão comercial de produção para isso.
- Ao migrar, manter conta Guia, loja, catálogo, clientes e histórico de pedidos; obter **nova autorização de Pix Automático no banco** de cada comerciante que desejar aderir. Não converter faturas passadas nem iniciar débitos sem autorização.
- Não registrar chaves/API Asaas ou tokens de pagamento no frontend ou no GitHub. Implantação futura precisa de testes de antecedência de cobranças, webhook de mandato, cancelamento bancário, retries, titularidade e limites de débito.

## Termos e política para dois perfis

- Documentos versionados: `pages/termos-comercios.html`, `pages/termos-motoboys.html` (versão **2026-10-09**), e a `pages/politica-privacidade.html` atualizada.
- Os painéis exigem **dois campos distintos** inicialmente vazios: aceite contratual e ciência da privacidade; nenhum é consentimento de marketing.
- O backend valida autenticação e papel antes de gravar as duas linhas em `catalogo_aceites_operacionais`. Usuários comuns não têm INSERT direto nessa tabela.
- Antes de novas operações, os endpoints de pagamento, saques, configuração/ativação de catálogo e aceite/atribuição de entregas conferem a versão vigente.
- Entregas já iniciadas mantêm caminhos de conclusão, ocorrência e cancelamento para não aprisionar obrigações anteriores.
- Alterar qualquer cláusula material exige nova versão **nos documentos, na Edge e nas verificações dos outros serviços** e novo aceite. A versão está definida no código; extrair para configuração única é melhoria futura.
- Antes do go-live, pedir revisão jurídica, especialmente responsabilidade por comissões e retenção de dados.

## Saque Pix mínimo: R$ 100,00

- `catalogo_asaas_reservar_saque` é quem bloqueia valor abaixo de **10.000 centavos**, usando apenas créditos financiados e liquidados.
- A carteira mostra o saldo disponível e o progresso para o mínimo.
- Créditos retidos mostram estabelecimento e competência, diferenciando fechamento, fatura aguardando pagamento, vencida e pagamento em conferência.
- **Não há corte de 100, 1.000 ou outro número fixo de comissões por saque.** Créditos liberados podem se acumular por vários meses, sem expiração automática implementada; o valor disponível soma todos os registros elegíveis em `BIGINT`.
- A reserva `catalogo_asaas_reservar_saque` usa uma transação PostgreSQL, `advisory lock`, bloqueio de linhas e uma soma acumulada para incluir tantas comissões quantas couberem no **teto financeiro** da transferência. O webhook usa `catalogo_asaas_validar_reserva_saque`, que retorna **um único JSON** com soma, contagem e conferência de elegibilidade, sem truncamento pelo `max-rows` do PostgREST.
- O teto de segurança inicial nesta homologação é **R$ 5.000 por Pix** (500.000 centavos), não um teto de carteira. Está alinhado ao limite informado pelo Asaas para novas contas, mas poderá ser ajustado quando o provedor aprovar outro limite e a mudança for novamente testada.
- Quando o saldo excede R$ 5.000, o banco tenta preservar **ao menos R$ 100 no saldo remanescente** para o próximo saque. Exemplo: R$ 5.010 disponíveis → primeiro Pix R$ 4.910 e R$ 100 permanecem. Comissões individuais que ultrapassem o teto bancário não são debitadas ou divididas automaticamente; exigem tratamento específico com o provedor.
- O saldo total da carteira permanece livre de um prazo de saque imposto pelo código. Não confundir com garantia legal ou contratual de custódia; a operação real exige revisão jurídica e provisão de caixa correspondente.
- A tabela privada `catalogo_asaas_saldos_residuais` e a opção na carteira permitem solicitar **análise do saldo liberado de R$ 0,01 até R$ 99,99** em situações de encerramento ou interrupção de atividades. O pedido não realiza Pix, não altera a remuneração e é limitado a uma análise aberta por motoboy.
- **Entregador inativo (branch, ainda não implantado):** a Edge permite consultar a carteira e o histórico após a inativação, atualizar os aceites dos termos e solicitar **somente a revisão excepcional** dos créditos já liquidados. A consulta do saldo mantém `saque_habilitado=false` quando `catalogo_motoboys.ativo=false`, e o saque regular continua exigindo perfil ativo, token de autorização e Sandbox. Inativação não autoriza movimentação nem elimina créditos anteriores. Testes: `tests/catalogo-asaas-residual-inativos.test.cjs`.
- **CI reforçada:** o workflow aplica a sequência completa de SQL de `supabase/pending-migrations/` em clone PostgreSQL descartável e executa `supabase/tests/isolated/catalogo-asaas-staged-guards-postgres.sql` em transação revertida. A migração pública de status revoga explicitamente `SELECT` de `comercios_publicados` para `anon` e `authenticated` para eliminar diferenças com bancos históricos.
- **Proteção de segurança adicionada e testada em STAGING:** `20261009185000_bloquear_conclusao_saldo_residual_sem_prova.sql` impede marcar uma análise como `concluida` antes de existir conciliação financeira comprovada, bloqueia alteração do titular/valor original, exige justificativa de recusa e preserva decisões finais. Os testes foram transacionais com `ROLLBACK` e não enviaram Pix.
- **Revisão administrativa na branch:** a ação `revisar_analise_residual_admin` exige sessão de administrador, UUID de solicitação, transição `pendente → em_analise` ou `pendente/em_analise → recusada`, compara o estado anterior no `UPDATE` e exige justificativa de pelo menos 20 caracteres (máximo de 1.000) para recusar. O painel `admin-encerramentos.html` exibe essa fila e não oferece opção `concluida`. A recusa é exclusivamente da análise, **não da dívida ou do direito de receber**. O campo `analisado_por` só é preenchido na recusa final, respeitando o CHECK do banco. Testes Node e SQL em STAGING validaram o fluxo, com `ROLLBACK` e zero solicitações fictícias persistidas.
- **Pendente:** implementar mecanismo comprovado de pagamento excepcional, com autorização financeira, identificação da transferência, baixa transacional dos créditos, prova de liquidação no provedor, tratamento de divergências e contestação. A proteção atual impede encerramento fictício, mas **não faz o pagamento**.
- Saldos residuais **não podem ser perdidos nem apagados**, independentemente do estado do cadastro.

## Encerramento de comércio com pendências

- O botão da página local agora chama `solicitar_encerramento`, que verifica propriedade e usa uma RPC transacional.
- O processo interrompe **novos pedidos**, guarda o pedido de encerramento e apura faturas não pagas, comissões abertas e pedidos em andamento.
- Dívida e histórico não são apagados. O estado pode ficar em `aguardando_quitacao` ou `pendente_arquivamento`.
- Com dívida, o proprietário pode pagar a fatura na área específica de regularização mesmo com o catálogo bloqueado.
- **Implementado em STAGING:** função administrativa `catalogo_finalizar_encerramento_financeiro` reconta as faturas, comissões e pedidos, impede arquivamento com pendências e, quando quitado, altera `comercios_publicados.status` para `arquivado`, sem apagar o cadastro ou o histórico. O painel `pages/admin-encerramentos.html` só solicita a operação após autenticação administrativa.
- Há triggers de banco para bloquear despublicação com dívida, exclusão física de histórico e reabertura automática de loja encerrada.
- **Vitrine estática protegida na branch:** `js/index.js` e `js/local.js` consultam `catalogo_status_publicacao(text[])`. A RPC foi publicada **somente em STAGING** em 2026-10-09, com lote máximo de 100 IDs, sem `SELECT` público sobre `comercios_publicados`; o registro de encerramento `arquivado` prevalece mesmo após remoção de publicação legada. Se não houver confirmação do RPC (erro, ausência de cliente ou formato inválido), a listagem de comércios falha fechada, podendo ocultar temporariamente lojas ativas. Comércios editoriais sem registro no banco continuam visíveis se não houver tombstone de encerramento. É necessário conferir outros caminhos de listagem e o legado `whatsapp-bot/marcar_meu_comercio_deletado` antes da produção.
- **Atenção de segurança:** por ser uma RPC pública `SECURITY DEFINER` com retorno intencionalmente restrito a `local_id` e `status`, o Security Advisor do STAGING sinaliza execução por `anon` e `authenticated`; revisão de privilégios, limites, contrato de resposta e possibilidade de projeção pública invoker permanece obrigatória antes de produção. A tabela base continua com RLS e sem SELECT público.
- O estabelecimento pode sair da vitrine e encerrar novas vendas sem perder o direito de consultar/corrigir dados e contestar faturas.

## Lista de verificação antes de liberação real

1. [ ] CI integral bem-sucedido em branch e PR revisados.
2. [ ] Verificar Edge Functions implantadas e fluxos com usuário de teste legítimo no STAGING.
3. [ ] Revisar termos e Política de Privacidade com profissional habilitado; disponibilizar canal real de contestação.
4. [ ] Testar migração de conta existente sem aceite (bloqueio de NOVAS operações, leitura e regularização continuam).
5. [ ] Testar o painel administrativo de encerramento com usuários de homologação; verificar remoção em todas as listagens e links diretos (há teste automatizado da vitrine e RPC validada em STAGING), concluir auditoria do endpoint legado `whatsapp-bot/marcar_meu_comercio_deletado` e revisar alertas do Security Advisor para a RPC pública.
6. [ ] Revisar pedidos de saldo residual já registrados e implementar liquidação excepcional comprovada inferior a R$ 100 em encerramentos; a fila de solicitação está pronta, a transferência excepcional não.
7. [ ] Validar fechamento automático mensal: no STAGING `fechamento_offline_ativo=false` mesmo com o cron presente; manter desativado até uma homologação supervisionada.
8. [ ] Obter autorização comercial e contratual Asaas, condições de tarifas e conta de produção PJ elegível para Pix Automático, se e quando for implantado.
9. [ ] Somente após autorização expressa implantar em produção, começando com flags de cobrança/saque **desligadas**.

**Nunca realizar Pix real, ativar Pix Automático ou mesclar PR #39 automaticamente.**
