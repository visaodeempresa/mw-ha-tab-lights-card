---
name: mw-tab-lights-card
description: Mexer na tela de iluminação do Home Assistant (custom:mw-tab-lights-card) — a grade de botões de luz de um cômodo a partir da área. Use quando o Maycon falar em "tela de iluminação", "grade de luzes", "botões de luz", "aba BRILHO", "luz não aparece na grade", "excluir luz", ou pedir cor de botão por botão.
---

# MW Tab Lights Card

`custom:mw-tab-lights-card` — **compositor, não desenhista**: descobre as
luzes da área e monta um `custom:mw-tab-card` (casca, abas, painel) com grade
de `custom:simple-button-card` + aba de brilho (`mushroom-light-card`).
Arquivo único (`dist/mw-tab-lights-card.js`), sem build, HACS (Dashboard).

## Arquitetura (o que vai para onde)

- `paper_color`/`shell_color` → **só** o `mw-tab-card` gerado (`buildConfig`).
  Tonar a superfície nunca toca nos botões.
- Botões: `buttonConfig()` = `{...BUTTON_DEFAULTS,
  ...button_defaults, ...opções_da_luz, ...button_yaml}`. Cada luz aceita
  **qualquer** opção do simple-button (`paper_color`, `trim`, `confirm`…).
- `button_defaults` = o padrão de todos os botões (ex.
  `{paper_color: "orange-7"}`); por luz, o editor ✎ escreve só o que difere
  do gerado.
- `tabs_options` = repassado ao tab-card (`tab_position`, `elevation`…).
  **Sem `elevation: false`**: ele desliga o relevo do painel.
- Linha grafite (v0.4.0): `paperOptions().concat(grafiteOptions())` nos
  selects de papel do painel. Filete (v0.5.0): `trim`/`trim_animate`
  espelhados no `_buttonSchema` — quem desenha é o botão (v0.9.0+).

## Fluxo

1. Editar `dist/mw-tab-lights-card.js` — `_buttonSchema()` (editor),
   `LABELS`, `buildConfig`/`buttonConfig`.
2. `node --check dist/mw-tab-lights-card.js && node tools/probe.js`
3. `IA/tools/check-embeds.sh` (o bloco grafite tem de bater com `IA/lib/`).
4. Commit assinado (regra 00), feature branch, PR. **Merge é do dono.**

## Armadilhas

- Painel "chapado" sem relevo: `tabs_options` com `elevation: false`.
- Campo novo no simple-button não aparece no ✎ da luz: `_buttonSchema` é
  espelho manual — acrescentar lá (e em `LABELS`) e republicar este card.
- Luz excluída que volta: ✕ vai para `exclude:` — sem isso a descoberta
  traz de volta. Reverter: "+ luz de outra área".
- Versão em `const VERSION` (não banner): o auto-release sincroniza sozinho;
  não subir à mão em PR pré-merge.

## Verificação

```bash
node --check dist/mw-tab-lights-card.js
node tools/probe.js                      # espera: "83 verificações passaram"
IA/tools/check-embeds.sh                 # espera: grafite ok
git log -1 --pretty='%G? %an'            # espera: G + MAYCON WILLIAN OLIVEIRA
```

Conferência de tela é do dono (regra global 30).
