# MW Tab Lights Card

`custom:mw-tab-lights-card` — a tela de iluminação de um cômodo inteiro a
partir de **uma** chave: a área.

O card descobre as luzes da área pelo registro do frontend e **compõe** o
desenho que antes era escrito à mão em ~190 linhas de YAML:

| aba | o que entra |
|---|---|
| **LUZES** | grade de `custom:simple-button-card` (papel, relevo 3D, confirmação) |
| **BRILHO** | `custom:mushroom-light-card` em `conditional` — só a luz que está acesa |

A casca, as abas e o papel são do `custom:mw-tab-card`. Nada é redesenhado
aqui: este card é o **compositor**.

## Depende de (HACS)

`MW Tab Card` · `MW Simple Button Card` · `Mushroom`

## Exemplo

```yaml
type: custom:mw-tab-lights-card
area: escritorio
columns: 3
paper_color: orange-7
shell_color: rgba(68, 68, 68, 0.5)
tabs_options:
  tab_position: right
  tab_display: icon
  tab_icon_size: 32
  keep_alive: false
```

## Editor visual

Área · luzes (incluir/excluir, ordem, ícones, nome) · **todas** as opções de
cada botão · padrão para todos os botões · colunas da grade · abas (rótulo,
ícone, posição, geometria, comportamento) · cores (papel, casca, textos) ·
aba de brilho (mushroom + `card_mod`) · **YAML editável pedaço por pedaço**
(botão, card de brilho, config inteira), com merge sobre o gerado — editar o
código não congela a descoberta automática.

## Chaves

| chave | padrão | o quê |
|---|---|---|
| `area` | — | `area_id` ou nome da área |
| `columns` | `3` | colunas da grade de botões |
| `square` | `true` | botões 1:1 |
| `auto_add` | `true` | luz nova da área entra sozinha |
| `hide_unavailable` | `false` | esconde luz sem estado |
| `brightness_tab` | `true` | cria a aba de brilho |
| `lights[]` | descoberto | `entity`, `hidden`, `name`, `icon_on/off` + qualquer opção do simple-button-card |
| `button_defaults` | `confirm`, `confirm_3d`, `hide_label` | vale para todos os botões |
| `brightness_options` | — | `only_when_on`, `hide_tab_when_off`, `use_light_color`, `show_*_control`, `glass`, `style` |

`hide_tab_when_off: true` (padrão) esconde a aba BRILHO inteira quando nenhuma
luz da área está acesa — ela volta sozinha ao acender qualquer uma (o
`mw-tab-card` cai de volta para a aba LUZES sem quebrar). Para manter a aba
sempre visível: `brightness_options: { hide_tab_when_off: false }`.
| `tabs_options` | `right`/`icon`/`32`/`keep_alive:false` | espelho das chaves do `mw-tab-card` |
| `buttons_tab`, `brightness_tab_options` | `LUZES`, `BRILHO` | rótulo e ícone de cada aba |
| `extra_cards` | — | cards avulsos em cada aba (`buttons`, `brightness`) |
| `tabs_yaml`, `yaml_override` | — | merge cru sobre o gerado |

## Verificação

```bash
node --check dist/mw-tab-lights-card.js && node tools/probe.js
```

---

Autoria: MAYCON WILLIAN OLIVEIRA <visaodeempresa@gmail.com>
