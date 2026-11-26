# POP-ORN-34 · Contar

**Quem:** qualquer perfil operacional (`inventory.count`). **Onde:** coletor › Inventário, ou a folha de contagem na web.

1. **Leia o endereço.** A partir dessa leitura o endereço fica **bloqueado** para separação, reposição, transferência e armazenagem ("Endereço em contagem (INV-xxxx)"). O mapa mostra as iniciais de quem está contando.
2. **Contagem cega:** o coletor não lista o que deveria haver no endereço e a folha mostra "oculto" no esperado. Leia **cada produto que encontrar** e informe a quantidade.
3. Produto que não constava: é incluído como **item encontrado**. Se o endereço estava previsto vazio, a linha "vazio" fecha sozinha. Para confirmar um endereço vazio, informe 0 na linha dele.
4. Retorno no coletor:
   - **✓ verde com pulso**: dentro da tolerância, item fechado;
   - **vermelho com tremida**: fora da tolerância, o item vai para "A recontar".
5. **Rodadas:**
   - 2ª contagem cega: **outro operador** (o sistema recusa o mesmo usuário);
   - 3ª contagem (desempate): **supervisor**. Vale o valor que se repetir; se as três diferirem, vale a 3ª.
6. Quando todos os itens fecharem, o coletor mostra **Submeter para aprovação**.

Na web, linhas alteradas ficam destacadas; a barra no rodapé mostra quantas e **Salvar contagens**. Sair da página com alterações pede confirmação.
