# POP-ORN-35 · Aprovar inventário

**Quem:** supervisor ou administrador (`inventory.approve`), que **não** tenha contado no inventário (segregação de funções). **Onde:** tela do inventário › Fluxo de validação.

1. Depois de submetido, a folha mostra esperado, contado, diferença e as rodadas de cada item.
2. Se você contou neste inventário, o botão é trocado por "Você contou neste inventário. Outro supervisor precisa aprovar."
3. **Alçada:** diferença fora da tolerância com valor acima da alçada da classe (padrão R$ 500) só o perfil indicado aprova (padrão Administrador). O motivo aparece antes de você tentar.
4. **Aprovar e ajustar estoque:** informe a observação e, se usar, o centro de custo.
   - diferenças dentro da tolerância são ajustadas automaticamente;
   - cada ajuste grava custo unitário (último preço de compra ou custo médio), código do motivo (INV_SOBRA/INV_FALTA) e centro de custo;
   - um evento `inventory.adjustment_posted` sai por linha para o ERP (sem duplicar).
5. Se o saldo de algum item mudou desde a foto, **só esse item** volta para recontagem e o inventário volta a "em contagem".
6. Para recontar sem aprovar, use **Devolver itens para recontagem** (escolha os itens e informe o motivo, mínimo de 5 caracteres).
