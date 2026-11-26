# POP-ORN-38 · Liberar pela qualidade

**Quem:** supervisor ou administrador (`quality.release`). **Onde:** Qualidade.

1. Produto acabado (entrada da produção) e devolução apta entram **aguardando qualidade**, com o saldo **bloqueado** na quarentena (ou no endereço da linha, se o depósito não tiver zona de quarentena). Nenhuma armazenagem é gerada.
2. Em cada retenção, registre o **laudo** (mínimo de 5 caracteres) e, se houver, o link do anexo.
3. Escolha a decisão:
   - **Aprovar:** o saldo sai da quarentena e o sistema gera a tarefa de armazenagem; fica disponível na confirmação;
   - **Reprovar:** o saldo é descartado com movimento próprio;
   - **Retrabalhar:** o saldo continua bloqueado e a retenção volta para nova decisão.
4. Cada decisão fica gravada com laudo, usuário e data (histórico imutável e auditoria).

Parâmetro: Configurações › Qualidade › *Qualidade obrigatória no produto acabado e na devolução* (ligado por padrão).
