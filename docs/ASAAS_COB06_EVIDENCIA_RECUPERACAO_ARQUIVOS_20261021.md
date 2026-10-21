# COB-06 — evidência da recuperação local de arquivos (21/10/2026)

**Estado:** recuperação e comparação dos arquivos do backup criptografado **APROVADAS**, conforme saída do PowerShell apresentada pelo operador; **COB-06 continua HOLD** para homologação de produção.

## Escopo e evidência

- Backup original SQL: `D:\GuiaAndrelandiaBackupsPrivados\20261013T212912Z-34019e86` (sete SQLs e manifesto, já verificados anteriormente).
- Backup original do Storage: `D:\GuiaAndrelandiaBackupsPrivados\storage-cob06-20261020T185621Z-afee4956` (exportação concluída, cinco buckets e 128 objetos; manifesto SHA-256 local conferido anteriormente).
- Arquivo cifrado criado manualmente no disco físico **E:** (disco 1, barramento SATA), distinto do disco **D:** (disco 0, SATA). Nome: `GuiaAndrelandia-Backup-20261020.7z`. Tamanho mostrado pelo operador: 0,08 GB; 7-Zip configurado com AES-256 e criptografia de nomes na interface. **O próprio volume E: não usa BitLocker**. Senha e conteúdo não foram fornecidos ao chat.
- Arquivo extraído localmente para `D:\GuiaAndrelandiaBackupsPrivados\_teste_recuperacao_20261021\GuiaAndrelandia-Backup-20261020`, em D: BitLocker ativo.
- O operador confirmou que as pastas SQL e Storage estão presentes no conteúdo extraído.
- O PowerShell enumerou todos os arquivos das duas pastas de origem e suas correspondentes extraídas e comparou SHA-256 individual de cada arquivo; resultado: duas saídas `PASTA_CONFERIDA_OK`, **`RECUPERACAO_ARQUIVOS_OK: 143 arquivos comparados por SHA256.`**
- Inventário do Storage extraído: **128 objetos, 133855024 bytes**, com sucesso `STORAGE_OK: 128 objetos e 133855024 bytes.` e `BACKUP_CRIPTOGRAFADO_RECUPERADO_E_CONFERIDO`.
- Nenhum dado privado, senha, arquivo SQL, hash individual ou mídia foi enviado ao repositório; somente esta síntese operacional. Nenhuma operação de produção ou pagamento ocorreu nessa verificação.

## Limites e gates remanescentes

1. Isso valida **extração de arquivos cifrados e igualdade com os originais locais**, não uma reconstrução funcional do Supabase/serviço inteiro, nem a autenticidade externa do conteúdo.
2. O backup SQL de 13/10 e o snapshot Storage de 20/10 não são uma captura transacional única; ainda é necessário projetar consistência e janela de recuperação.
3. A unidade E: é um segundo **disco físico com barramento SATA segundo enumeração**, distinto do D:. **Em 21/10/2026, o operador informou que consegue desconectar fisicamente esse HD.** Isso confirma a possibilidade de guarda separada, mas **ainda não comprova que ele já foi desconectado e guardado fora do computador**. O próprio E: não é criptografado, embora o arquivo `.7z` tenha sido configurado com AES-256. Comprovar que a senha funciona no destino externo e guardá-la separadamente antes de declarar redundância off-host.
4. Recuperação de Edge Functions publicadas, configurações, integrações, webhooks e segredos continua fora do pacote SQL/Storage; revisar sem exportar segredos para logs ou GitHub.
5. Manter bloqueadas publicação financeira produtiva, saques Pix, Pix Automático e merge integral da PR #39 até gates específicos COB-06/COB-07.

**Resultado desta etapa:** `COB06_ARQUIVOS_CIFRADOS_EXTRAIDOS_E_SHA256_CONFERIDOS`; nenhum gate produtivo foi liberado.
