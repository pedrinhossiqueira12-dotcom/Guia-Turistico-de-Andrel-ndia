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
- Até 1.000 créditos entram em uma solicitação; para grande volume de créditos unitários mínimos, revisar paginação e limites de consulta antes de produção.
- Saldos residuais inferiores ao mínimo, especialmente em encerramento de conta, precisam de rotina de liquidação específica com revisão jurídica; **não podem ser perdidos nem apagados**.

## Encerramento de comércio com pendências

- O botão da página local agora chama `solicitar_encerramento`, que verifica propriedade e usa uma RPC transacional.
- O processo interrompe **novos pedidos**, guarda o pedido de encerramento e apura faturas não pagas, comissões abertas e pedidos em andamento.
- Dívida e histórico não são apagados. O estado pode ficar em `aguardando_quitacao` ou `pendente_arquivamento`.
- Com dívida, o proprietário pode pagar a fatura na área específica de regularização mesmo com o catálogo bloqueado.
- **Pendente de integração:** remoção definitiva da vitrine pública e desabilitação do antigo endpoint `whatsapp-bot/marcar_meu_comercio_deletado`, cuja implementação não está no repositório atual. O novo botão não usa mais essa rota, mas o backend legado deve ser auditado e bloqueado antes do go-live.
- O estabelecimento pode sair da vitrine e encerrar novas vendas sem perder o direito de consultar/corrigir dados e contestar faturas.

## Lista de verificação antes de liberação real

1. [ ] CI integral bem-sucedido em branch e PR revisados.
2. [ ] Verificar Edge Functions implantadas e fluxos com usuário de teste legítimo no STAGING.
3. [ ] Revisar termos e Política de Privacidade com profissional habilitado; disponibilizar canal real de contestação.
4. [ ] Testar migração de conta existente sem aceite (bloqueio de NOVAS operações, leitura e regularização continuam).
5. [ ] Integrar e auditar o arquivamento público e o endpoint legado de exclusão.
6. [ ] Implementar liquidação excepcional de saldo residual inferior a R$ 100 em encerramentos.
7. [ ] Validar fechamento automático mensal: no STAGING `fechamento_offline_ativo=false` mesmo com o cron presente; manter desativado até uma homologação supervisionada.
8. [ ] Obter autorização comercial e contratual Asaas, condições de tarifas e conta de produção PJ elegível para Pix Automático, se e quando for implantado.
9. [ ] Somente após autorização expressa implantar em produção, começando com flags de cobrança/saque **desligadas**.

**Nunca realizar Pix real, ativar Pix Automático ou mesclar PR #39 automaticamente.**
