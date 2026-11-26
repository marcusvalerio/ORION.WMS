# POP-ORN-33 · Abrir inventário

**Quem:** supervisor ou administrador (`inventory.create`). **Onde:** Inventário › Abrir nova contagem.

1. Escolha o depósito e o tipo:
   - **Rotativo**: exige zona, endereço ou produto.
   - **Geral**: o depósito inteiro.
   - **Linha de produção (WIP)**: só endereços das zonas de produção.
2. Para fechamento de período, informe a **data de referência** (ela alimenta o Registro de inventário / Bloco H).
3. Clique em **Abrir contagem**. O sistema tira a foto do saldo:
   - cada produto/lote/endereço com saldo vira uma linha, com a classe ABC do produto;
   - endereços **sem saldo** entram como "esperado 0" (só sem filtro de produto);
   - a origem do saldo (disponível, bloqueado, quarentena) fica registrada.
4. Rotativo pelo calendário: Inventário › **Calendário** › **Gerar contagens de hoje** (um inventário por dia e depósito; repetir o clique não duplica).
5. Contagens automáticas: falta na separação e endereço zerado na separação abrem um rotativo do endereço.

**Modo de bloqueio** (Configurações › Inventário): *Bloquear* (padrão) impede movimentar o endereço enquanto é contado; *Conciliar* não bloqueia e recalcula o esperado na aprovação.
