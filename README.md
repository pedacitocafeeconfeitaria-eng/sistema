# Pedacito · Sistema de gestão

Sistema interno da Pedacito Café e Confeitaria (Villa Schlosser e Souza Cruz).

- **App:** páginas estáticas (HTML/CSS/JS, sem etapa de build), publicadas pelo GitHub Pages.
- **Banco e login:** Supabase (região São Paulo). Quem pode ver/editar cada módulo é controlado no banco (RLS),
  pelas funções definidas em *Configurações*.
- `banco/`: scripts SQL do esquema, na ordem em que foram aplicados.

A chave em `js/config.js` é a chave **publicável** do Supabase, feita para ficar no navegador.
Nenhuma senha ou chave secreta fica neste repositório.
