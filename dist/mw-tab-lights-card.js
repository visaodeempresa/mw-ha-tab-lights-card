/* mw-ha-tab-lights-card — custom:mw-tab-lights-card
 * A tela de iluminação de um cômodo inteiro a partir de UMA chave: a área.
 * O card descobre as luzes pelo registro do frontend e compõe o desenho que
 * antes era escrito à mão em ~190 linhas de YAML:
 *   aba LUZES   → grade de custom:simple-button-card (papel + relevo 3D)
 *   aba BRILHO  → custom:mushroom-light-card em `conditional` (só o que está aceso)
 * tudo dentro de um custom:mw-tab-card, que é quem desenha casca, abas e papel.
 *
 * Nada é redesenhado aqui: este card é o COMPOSITOR. Editor visual rico
 * (incluir/excluir luz, ícones, ordem, colunas, cores, abas) e YAML editável
 * pedaço por pedaço, como no editor aninhado do Lovelace.
 *
 * Sem build, sem dependências de bundler: JS puro + <ha-form> do HA.
 * Repo: https://github.com/visaodeempresa/mw-ha-tab-lights-card
 */
(() => {
  "use strict";

  const VERSION = "0.3.1";

  /* ------------------------------------------------------------ utilidades */

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

  /** merge profundo; array substitui (lista é decisão, não acúmulo). */
  const deepMerge = (base, over) => {
    if (!isObj(over)) return over === undefined ? base : over;
    const out = { ...(isObj(base) ? base : {}) };
    for (const [k, v] of Object.entries(over)) {
      if (v === null) { delete out[k]; continue; }
      out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
    }
    return out;
  };

  /** tira vazio: default intacto não polui o YAML (regra da família). */
  const clean = (o) => {
    const out = {};
    for (const [k, v] of Object.entries(o || {})) {
      if (v === undefined || v === null || v === "") continue;
      out[k] = v;
    }
    return out;
  };

  /** o que MUDOU de `base` para `next` — é isso que vira override no YAML. */
  const diffObj = (base, next) => {
    const out = {};
    for (const [k, v] of Object.entries(next || {})) {
      if (JSON.stringify(base ? base[k] : undefined) !== JSON.stringify(v)) out[k] = v;
    }
    return out;
  };

  const sig = (v) => { try { return JSON.stringify(v); } catch (_) { return String(v); } };

  // >>> paper-palette v1 — fonte canônica: /Volumes/SSD-T1-01/CLAUDE-SSD/IA/lib/paper-palette/paper-palette.js
  // 49 papéis encardidos: 7 matizes do arco-íris × 7 tons (1 = quase branco,
  // 7 = mais encardido). Saturação baixa de propósito — papel descansa a vista.
  const PAPER_HUES = [
    ["red", "Vermelho", 6], ["orange", "Laranja", 27], ["yellow", "Amarelo", 47],
    ["green", "Verde", 96], ["blue", "Azul", 203], ["indigo", "Anil", 236],
    ["violet", "Violeta", 283],
  ];
  const PAPER_TONES = [[97, 6], [96, 9], [94, 12], [92, 15], [90, 18], [88, 21], [85, 24]];
  const paperOptions = () => [{ value: "paper", label: "Papel original (creme)" }].concat(
    ...PAPER_HUES.map((h) => PAPER_TONES.map((t, i) => ({
      value: `${h[0]}-${i + 1}`,
      label: `${h[1]} · tom ${i + 1}${i === 0 ? " (mais claro)" : i === 6 ? " (mais encardido)" : ""}`,
    }))));
  // <<< paper-palette v1

  // >>> paper-dark-palette v1 — fonte canônica: IA/lib/paper-palette/paper-dark-palette.js
  const PAPER_DARK_TONES = [[26, 10], [24, 13], [21, 16], [19, 19], [16, 22], [14, 25], [11, 28]];
  const paperDarkOptions = () => [{ value: "paper", label: "Papel de noite (grafite)" }].concat(
    ...PAPER_HUES.map((h) => PAPER_DARK_TONES.map((t, i) => ({
      value: `${h[0]}-${i + 1}`,
      label: `${h[1]} · tom ${i + 1}${i === 0 ? " (mais claro)" : i === 6 ? " (mais escuro)" : ""}`,
    }))));
  // <<< paper-dark-palette v1

  // ---- cor: parse / compose (mantém alfa, que o desenho usa muito) ----
  const parseColor = (str) => {
    const s = String(str || "").trim();
    let m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) { const n = parseInt(m[1], 16); return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 }; }
    m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) { const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16)); return { r, g, b, a: 1 }; }
    return { r: 128, g: 128, b: 128, a: 1 };
  };
  const toHex = ({ r, g, b }) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  const toRgba = ({ r, g, b, a }) => `rgba(${r}, ${g}, ${b}, ${a})`;

  /* ------------------------------------------------------------- defaults */

  // O vidro do YAML de referência: fundo escuro translúcido + desfoque. Fica
  // editável porque é gosto, não regra — mas nasce igual ao que já estava na
  // tela, senão a primeira impressão do card é "ficou diferente".
  const GLASS = `ha-card {
  background: rgba(0, 0, 0, 0.25) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
`;

  const DEFAULTS = {
    area: "",
    columns: 3,
    square: true,
    auto_add: true,            // luz nova da área entra sozinha, no fim da fila
    hide_unavailable: false,
    brightness_tab: true,
    paper_color: "orange-7",
    shell_color: "rgba(68, 68, 68, 0.5)",
  };

  const BUTTON_DEFAULTS = {
    confirm: true,
    confirm_3d: true,
    hide_label: true,
  };

  const BRIGHTNESS_DEFAULTS = {
    only_when_on: true,        // o card do brilho só aparece com a luz acesa
    hide_tab_when_off: true,   // sem luz acesa, a aba BRILHO some (volta sozinha)
    use_light_color: true,
    show_brightness_control: true,
    show_color_temp_control: true,
    glass: true,
  };

  const TABS_DEFAULTS = {
    tab_display: "icon",
    tab_icon_size: 32,
    tab_position: "right",
    keep_alive: false,
  };

  const BUTTONS_TAB = { label: "LUZES", icon: "mdi:ceiling-light-multiple" };
  const BRIGHT_TAB = { label: "BRILHO", icon: "mdi:tune-variant" };

  /* ------------------------------------------- descoberta das luzes da área */

  // A área da ENTIDADE vence a do DISPOSITIVO — é a regra do próprio HA. Quem
  // inverte isso mostra luz do cômodo errado quando o dono move uma entidade.
  const areaOfEntity = (hass, id) => {
    const e = hass.entities && hass.entities[id];
    if (!e) return "";
    if (e.area_id) return e.area_id;
    const d = e.device_id && hass.devices && hass.devices[e.device_id];
    return (d && d.area_id) || "";
  };

  /** aceita area_id ou o nome escrito pelo dono ("Escritório"). */
  const resolveArea = (hass, area) => {
    const a = String(area || "").trim();
    if (!a || !hass) return "";
    if (hass.areas && hass.areas[a]) return a;
    const low = a.toLowerCase();
    for (const [id, ar] of Object.entries(hass.areas || {})) {
      if (String(ar.name || "").toLowerCase() === low) return id;
    }
    // último recurso: slug batendo com o id (escritorio ↔ escritório)
    for (const id of Object.keys(hass.areas || {})) {
      if (id.toLowerCase() === low.replace(/\s+/g, "_")) return id;
    }
    return a;
  };

  const areaName = (hass, areaId) =>
    (hass && hass.areas && hass.areas[areaId] && hass.areas[areaId].name) || areaId || "—";

  const friendly = (hass, id) => {
    const st = hass && hass.states && hass.states[id];
    return (st && st.attributes && st.attributes.friendly_name) || id;
  };

  /** luzes da área, já sem o que o HA esconde da interface. */
  const discoverLights = (hass, area) => {
    if (!hass || !hass.states) return [];
    const areaId = resolveArea(hass, area);
    if (!areaId) return [];
    const out = [];
    for (const id of Object.keys(hass.states)) {
      if (id.indexOf("light.") !== 0) continue;
      const reg = (hass.entities && hass.entities[id]) || {};
      if (reg.hidden_by || reg.disabled_by || reg.hidden === true) continue;
      if (areaOfEntity(hass, id) !== areaId) continue;
      out.push(id);
    }
    return out.sort((a, b) => friendly(hass, a).localeCompare(friendly(hass, b), "pt-BR"));
  };

  const deviceOfEntity = (hass, id) =>
    (hass && hass.entities && hass.entities[id] && hass.entities[id].device_id) || "";

  /** sensores de luminosidade da área */
  const discoverIlluminance = (hass, area) => {
    if (!hass || !hass.states) return [];
    const areaId = resolveArea(hass, area);
    if (!areaId) return [];
    const out = [];
    for (const id of Object.keys(hass.states)) {
      if (id.indexOf("sensor.") !== 0) continue;
      const st = hass.states[id];
      const dc = st && st.attributes && st.attributes.device_class;
      const uom = st && st.attributes && st.attributes.unit_of_measurement;
      const isIllum = dc === "illuminance" || uom === "lx" || uom === "lux" || id.indexOf("illuminance") !== -1;
      if (!isIllum) continue;
      const reg = (hass.entities && hass.entities[id]) || {};
      if (reg.hidden_by || reg.disabled_by || reg.hidden === true) continue;
      if (areaOfEntity(hass, id) !== areaId) continue;
      out.push(id);
    }
    return out.sort((a, b) => friendly(hass, a).localeCompare(friendly(hass, b), "pt-BR"));
  };

  const RAINBOW_STYLE = "p {\n  padding-top: 5px !important;\n  padding-bottom: 5px !important;\n  letter-spacing: 1.5px !important;\n  text-shadow:\n    0 1px 2px rgba(0, 0, 0, 0.60),\n    0 2px 8px rgba(0, 0, 0, 0.35) !important;\n}\n\nha-icon {\n  color: gold;\n  padding-left: 5px !important;\n  padding-right: 0px !important;\n  filter:\n    drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55))\n    drop-shadow(0 2px 6px rgba(0, 0, 0, 0.30));\n}\n\nha-card {\n  background: rgba(68, 68, 68, 0.0) !important;\n  border: 0px solid rgba(255, 255, 255, 0.08);\n  border-radius: 12px 12px 12px 12px !important;\n}\n";

  const getRainbowSensorId = (sec) => {
    if (!sec) return "";
    return (sec.entities && sec.entities.illuminance) || sec.illuminance || sec.entity || "";
  };

  const mergeRainbow = (hass, cfg) => {
    const rb = cfg && cfg.rainbow;
    const rawSections = (rb && Array.isArray(rb.sections)) ? rb.sections : [];
    const listadas = rawSections.map((s) => {
      const eid = getRainbowSensorId(s);
      return {
        entity: eid,
        device: s.device || (hass && deviceOfEntity(hass, eid)) || "",
        hidden: s.hidden === true,
      };
    }).filter((s) => !!s.entity);

    const vistas = new Set(listadas.map((s) => s.entity));
    const achadas = discoverIlluminance(hass, cfg && cfg.area);
    for (const id of achadas) {
      if (vistas.has(id)) continue;
      listadas.push({
        entity: id,
        device: (hass && deviceOfEntity(hass, id)) || "",
        hidden: false,
        _discov: true,
      });
    }
    const naArea = new Set(achadas);
    return listadas.map((s) => ({ ...s, _orfa: !naArea.has(s.entity) }));
  };

  const makeRainbowCard = (hass, sensors, baseRainbow) => {
    const existing = baseRainbow || {};
    const sections = (sensors || []).map((s) => {
      const dev = s.device || (hass && deviceOfEntity(hass, s.entity)) || "";
      const sec = {
        entities: { illuminance: s.entity }
      };
      if (dev) sec.device = dev;
      if (s.hidden === true) sec.hidden = true;
      return sec;
    });
    return {
      type: "custom:mw-rainbow-card",
      name: existing.name || "LUMINOSIDADE",
      bands: existing.bands || [{ metric: "illuminance" }],
      sections,
      section_labels: existing.section_labels || "none",
      band_labels: existing.band_labels || "none",
      name_size: existing.name_size !== undefined ? existing.name_size : 15,
      card_mod: existing.card_mod || { style: RAINBOW_STYLE },
    };
  };

  // Ícone que o dono escreveria: o nome da luz já diz o que ela é. É palpite
  // com queda garantida — nunca fica sem ícone.
  // A ORDEM importa: «LED da Mesa» casa com os dois, e o que ela é mesmo é
  // fita de LED — a regra mais específica vem primeiro.
  const ICON_GUESS = [
    [/(led|fita|strip|r[ií]tmo)/, "mdi:led-strip-variant", "mdi:led-strip-variant-off"],
    [/(mesa|desk|escrivan|bancada|workbench)/, "mdi:desk-lamp", "mdi:desk-lamp-off"],
    [/(estante|prateleira|shelf|livro|book)/, "mdi:bookshelf", "mdi:bookshelf"],
    [/(coluna|colunin|torch|floor|ch[aã]o)/, "mdi:floor-lamp-torchiere", "mdi:floor-lamp-torchiere"],
    [/(teto|ceiling|plafon)/, "mdi:ceiling-light", "mdi:ceiling-light"],
    [/(lustre|chandelier)/, "mdi:chandelier", "mdi:chandelier"],
    [/(spot|trilho)/, "mdi:spotlight-beam", "mdi:spotlight-beam"],
    [/(espelho|mirror|camarim)/, "mdi:mirror", "mdi:mirror"],
    [/(cabeceira|criado|bedside|noite)/, "mdi:lamp", "mdi:lamp"],
    [/(cozinha|kitchen|pia|bancad)/, "mdi:countertop", "mdi:countertop"],
    [/(banh|chuveiro|shower|box)/, "mdi:shower-head", "mdi:shower-head"],
    [/(jardim|garden|externa|quintal|varanda|outdoor)/, "mdi:outdoor-lamp", "mdi:outdoor-lamp"],
    [/(abajur|lamp)/, "mdi:lamp", "mdi:lamp"],
  ];
  const guessIcons = (hass, id) => {
    const nome = (friendly(hass, id) + " " + id).toLowerCase();
    for (const [re, on, off] of ICON_GUESS) if (re.test(nome)) return { on, off };
    const st = hass && hass.states && hass.states[id];
    const icone = st && st.attributes && st.attributes.icon;
    return { on: icone || "mdi:lightbulb", off: icone || "mdi:lightbulb-off" };
  };

  // A marca da integração de origem: a mesma arte que o HA usa nas telas de
  // dispositivos (brands.home-assistant.io). `platform` vem do registro que o
  // frontend já tem em mãos — não precisa de WebSocket. Sem internet ou sem
  // marca publicada, o selo some e a linha continua legível.
  const BRANDS = "https://brands.home-assistant.io";
  const platformOf = (hass, id) => {
    const e = hass && hass.entities && hass.entities[id];
    return (e && e.platform) || "";
  };

  /** lista final: a ordem do YAML manda; luz nova da área entra no fim;
   *  excluída (`exclude:`) NÃO volta — é a decisão de quem apagou. */
  const mergeLights = (hass, cfg) => {
    const listadas = Array.isArray(cfg.lights) ? cfg.lights.map((l) => ({ ...l })) : [];
    const vistas = new Set(listadas.map((l) => l.entity));
    const exclidas = new Set(Array.isArray(cfg.exclude) ? cfg.exclude : []);
    const achadas = discoverLights(hass, cfg.area);
    if (cfg.auto_add !== false) {
      for (const id of achadas) {
        if (vistas.has(id) || exclidas.has(id)) continue;
        listadas.push({ entity: id, _discov: true });   // descoberta de agora
      }
    }
    const naArea = new Set(achadas);
    return listadas.map((l) => ({ ...l, _orfa: !naArea.has(l.entity) }));
  };

  /** alguma luz acesa? — decide se a aba BRILHO existe. Conta só o que a
   * aba mostraria (mesmo filtro de buildConfig): estado "on" estrito —
   * indisponível também esconde a aba, porque o conditional de dentro não
   * mostraria nada. Sem hass/states, não mexe (devolve true). */
  const algumaAcesa = (hass, cfg) => {
    if (!hass || !hass.states) return true;
    cfg = cfg || {};
    const luzes = mergeLights(hass, cfg).filter((l) => l.hidden !== true && l.entity);
    const visiveis = cfg.hide_unavailable === true
      ? luzes.filter((l) => hass.states[l.entity])
      : luzes;
    return visiveis.some((l) => hass.states[l.entity] && hass.states[l.entity].state === "on");
  };

  /** o compositor deve esconder a aba? (opt-out em brightness_options) */
  const escondeAba = (cfg) => (cfg.brightness_options || {}).hide_tab_when_off !== false;

  /* ------------------------------------------------ composição da config */

  const buttonConfig = (hass, cfg, l) => {
    const over = { ...l };
    delete over.hidden; delete over.button_yaml; delete over.bright_yaml;
    delete over.entity; delete over._orfa; delete over._discov;
    const g = guessIcons(hass, l.entity);
    const base = {
      type: "custom:simple-button-card",
      entity: l.entity,
      icon_on: g.on,
      icon_off: g.off,
      ...BUTTON_DEFAULTS,
      ...clean(cfg.button_defaults || {}),
      ...clean(over),
    };
    return deepMerge(base, l.button_yaml || {});
  };

  const brightConfig = (hass, cfg, l) => {
    const b = { ...BRIGHTNESS_DEFAULTS, ...(cfg.brightness_options || {}) };
    const g = guessIcons(hass, l.entity);
    const card = {
      type: "custom:mushroom-light-card",
      entity: l.entity,
      name: l.name || friendly(hass, l.entity),
      icon: l.icon_on || g.on,
      use_light_color: b.use_light_color !== false,
      show_brightness_control: b.show_brightness_control !== false,
      show_color_temp_control: b.show_color_temp_control !== false,
      primary_info: "name",
      secondary_info: "none",
      tap_action: { action: "none" },
      hold_action: { action: "none" },
      double_tap_action: { action: "none" },
      grid_options: { columns: "full" },
    };
    if (b.glass !== false) card.card_mod = { style: b.style || GLASS };
    const full = deepMerge(card, l.bright_yaml || {});
    if (b.only_when_on === false) return full;
    return {
      type: "conditional",
      conditions: [{ condition: "state", entity: l.entity, state: "on" }],
      card: full,
    };
  };

  /** a config do custom:mw-tab-card que este card vai montar. */
  const buildConfig = (hass, cfg) => {
    const luzes = mergeLights(hass, cfg).filter((l) => l.hidden !== true && l.entity);
    const visiveis = cfg.hide_unavailable === true
      ? luzes.filter((l) => hass && hass.states && hass.states[l.entity])
      : luzes;

    const extras = cfg.extra_cards || {};
    let rainbowCard = cfg.rainbow;
    if (rainbowCard && Array.isArray(rainbowCard.sections)) {
      const activeSections = rainbowCard.sections.filter((s) => s && s.hidden !== true);
      if (activeSections.length > 0) {
        rainbowCard = {
          ...rainbowCard,
          sections: activeSections.map((s) => {
            const cleanSec = { ...s };
            delete cleanSec.hidden;
            return cleanSec;
          }),
        };
      } else {
        rainbowCard = null;
      }
    }
    const preCards = []
      .concat(rainbowCard ? [rainbowCard] : [])
      .concat(Array.isArray(extras.before) ? extras.before : [])
      .concat(Array.isArray(extras.header) ? extras.header : []);

    const grade = {
      type: "grid",
      square: cfg.square !== false,
      columns: Math.max(1, Math.min(6, Number(cfg.columns) || DEFAULTS.columns)),
      cards: visiveis.map((l) => buttonConfig(hass, cfg, l))
        .concat(Array.isArray(extras.buttons) ? extras.buttons : []),
    };

    const tabs = [];
    const tb = { ...BUTTONS_TAB, ...clean(cfg.buttons_tab || {}) };
    tabs.push(deepMerge({ label: tb.label, icon: tb.icon, cards: [...preCards, grade] },
      (cfg.tabs_yaml || {}).buttons || {}));

    if (cfg.brightness_tab !== false && (!escondeAba(cfg) || algumaAcesa(hass, cfg))) {
      const bt = { ...BRIGHT_TAB, ...clean(cfg.brightness_tab_options || {}) };
      const pilha = {
        type: "grid",
        square: false,
        columns: 1,
        grid_options: { columns: "full", rows: "auto" },
        cards: visiveis.map((l) => brightConfig(hass, cfg, l))
          .concat(Array.isArray(extras.brightness) ? extras.brightness : []),
      };
      tabs.push(deepMerge({ label: bt.label, icon: bt.icon, cards: [pilha] },
        (cfg.tabs_yaml || {}).brightness || {}));
    }

    for (const t of (Array.isArray(cfg.extra_tabs) ? cfg.extra_tabs : [])) tabs.push(t);

    const root = {
      type: "custom:mw-tab-card",
      tabs,
      paper_color: cfg.paper_color || DEFAULTS.paper_color,
      shell_color: cfg.shell_color || DEFAULTS.shell_color,
      ...TABS_DEFAULTS,
      ...clean(cfg.tabs_options || {}),
    };
    return deepMerge(root, cfg.yaml_override || {});
  };

  /* ------------------------------------------------------------------ CARD */

  class MwTabLightsCard extends HTMLElement {
    static getConfigElement() { return document.createElement("mw-tab-lights-card-editor"); }
    static getStubConfig(hass) {
      const areas = Object.keys((hass && hass.areas) || {});
      return { area: areas[0] || "", columns: 3, brightness_tab: true };
    }

    setConfig(config) {
      this._config = { ...DEFAULTS, ...(config || {}) };
      this._built = null;          // força recomposição no próximo hass
      this._update();
    }

    set hass(hass) {
      const antes = this._hass;
      this._hass = hass;
      // registros mudam por REFERÊNCIA; comparar as três (mais a contagem de
      // states, para pegar luz que nasceu) evita recompor a cada tique de
      // qualquer entidade da casa — que é o que faz a tela engasgar.
      const mexeu = !antes
        || antes.entities !== hass.entities
        || antes.devices !== hass.devices
        || antes.areas !== hass.areas
        || Object.keys(antes.states || {}).length !== Object.keys(hass.states || {}).length;
      if (mexeu) {
        this._acesa = algumaAcesa(hass, this._config);
        this._update();
        return;
      }
      // liga/desliga não recompõe — exceto a transição tudo-apagado ↔
      // alguma-acesa, que cria/remove a aba BRILHO (barato: só na virada).
      if (escondeAba(this._config)) {
        const acesa = algumaAcesa(hass, this._config);
        if (acesa !== this._acesa) { this._acesa = acesa; this._update(); return; }
      }
      if (this._child) this._child.hass = hass;
    }
    get hass() { return this._hass; }

    set editMode(v) { this._editMode = v; if (this._child) this._child.editMode = v; }
    get editMode() { return this._editMode; }

    connectedCallback() { this._update(); }

    async getCardSize() {
      try { return this._child && this._child.getCardSize ? await this._child.getCardSize() : 6; }
      catch (_) { return 6; }
    }
    getLayoutOptions() { return { grid_min_rows: 3, grid_columns: "full" }; }
    getGridOptions() { return { columns: "full", min_rows: 3 }; }

    _shell() {
      if (!this._root) {
        this._root = this.attachShadow({ mode: "open" });
        this._root.innerHTML = `<style>
          :host{display:block;}
          .aviso{padding:14px 16px;border-radius:14px;font-size:13px;line-height:1.45;
            background:rgba(0,0,0,.25);color:var(--primary-text-color);
            border:1px solid var(--divider-color);}
          .aviso b{font-weight:700;}
          .aviso code{font-family:monospace;font-size:12px;opacity:.85;}
        </style><div id="host"></div>`;
        this._host = this._root.querySelector("#host");
      }
      return this._host;
    }

    _aviso(html) {
      const host = this._shell();
      this._child = null;
      host.innerHTML = `<div class="aviso">${html}</div>`;
    }

    async _update() {
      if (!this._config || !this.isConnected) return;
      const host = this._shell();
      if (!this._hass) return;                      // sem hass não há registro

      if (!this._config.area && (!Array.isArray(this._config.lights) || !this._config.lights.length)) {
        this._aviso("<b>MW Tab Lights</b><br>Escolha a <b>área</b> no editor ou declare as luzes em <code>lights</code>.");
        return;
      }
      const cfg = buildConfig(this._hass, this._config);
      const gradeCard = cfg.tabs[0] && cfg.tabs[0].cards.find((c) => c && c.type === "grid");
      const temLuz = (gradeCard && gradeCard.cards || []).length > 0;
      if (!temLuz) {
        const aTxt = this._config.area ? ` na área <b>${esc(areaName(this._hass, resolveArea(this._hass, this._config.area)))}</b>` : "";
        this._aviso(`<b>MW Tab Lights</b><br>Nenhuma luz encontrada${aTxt}.<br>
          Confira em <code>Configurações → Áreas</code> ou inclua as luzes à mão no editor.`);
        return;
      }

      const s = sig(cfg);
      if (this._child && s === this._built) { this._child.hass = this._hass; return; }
      this._built = s;

      if (this._child) {                            // já montado: só reconfigura
        try {
          this._child.setConfig(cfg);
          this._child.hass = this._hass;
          if (this._editMode !== undefined) this._child.editMode = this._editMode;
          return;
        } catch (_) { this._child = null; }
      }

      let helpers = null;
      try { helpers = window.loadCardHelpers ? await window.loadCardHelpers() : null; } catch (_) { /* segue */ }
      let el;
      try {
        el = helpers ? helpers.createCardElement(cfg) : null;
        if (!el) throw new Error("loadCardHelpers indisponível");
      } catch (e) {
        this._aviso(`<b>MW Tab Lights</b> não conseguiu montar o <code>custom:mw-tab-card</code>.<br>
          ${esc(e && e.message ? e.message : e)}<br>
          Instale <b>MW Tab Card</b>, <b>MW Simple Button Card</b> e <b>Mushroom</b> pelo HACS.`);
        return;
      }
      el.hass = this._hass;
      if (this._editMode !== undefined) el.editMode = this._editMode;
      el.addEventListener("ll-rebuild", (ev) => { ev.stopPropagation(); this._built = null; this._child = null; this._update(); });
      host.innerHTML = "";
      host.appendChild(el);
      this._child = el;
    }
  }

  /* ---------------------------- EDITOR VISUAL ---------------------------- */

  const LABELS = {
    area: "Área (é daqui que saem as luzes)",
    columns: "Colunas da grade de botões",
    square: "Botões quadrados (1:1)",
    auto_add: "Luz nova da área entra sozinha",
    hide_unavailable: "Esconder luz indisponível",
    brightness_tab: "Criar a aba de BRILHO",
    paper_color: "Cor do papel (painel)",
    shell_color: "Casca (fundo do card)",
    // botão
    name: "Nome",
    icon_on: "Ícone (ligado)",
    icon_off: "Ícone (desligado)",
    icon_unavailable: "Ícone (indisponível)",
    animate: "Animar ícone quando ligado (girar)",
    control: "Permitir ligar/desligar no toque",
    icon_shadow: "Sombra no ícone quando ligado",
    haptic: "Vibrar ao tocar (feedback táctil no celular)",
    confirm: "Pedir confirmação antes de ligar/desligar",
    confirm_text: "Mensagem da confirmação ({nome} e {acao} são substituídos)",
    confirm_3d: "Balão 3D (a confirmação em papel com relevo)",
    confirm_paper_dark: "Balão em papel escuro",
    confirm_paper_color: "Cor do papel do balão",
    hide_label: "Esconder o label (só o ícone, centralizado)",
    name_position: "Posição do label",
    icon_size: "Tamanho do ícone (vazio = automático)",
    name_size: "Tamanho do texto do label",
    name_gap: "Distância entre label e ícone",
    color_on_name: "Ligado: texto/ícone",
    color_off_name: "Desligado: texto",
    color_off_bg: "Desligado: fundo",
    color_on_border: "Ligado: borda",
    color_off_border: "Desligado: borda",
    color_unavail: "Indisponível: destaque",
    // abas (espelho do MW Tab Card)
    label: "Texto da aba",
    icon: "Ícone da aba",
    tab_position: "Posição das abas",
    tab_display: "O que aparece na aba",
    tab_stretch: "Abas dividem a faixa em partes iguais",
    tab_align: "Onde a fila de abas encosta",
    tab_size: "Espessura da faixa de abas (0 = automático)",
    tab_font_size: "Tamanho do texto da aba",
    tab_icon_size: "Tamanho do ícone da aba",
    tab_rotate: "Deitar a aba lateral",
    tab_rotate_angle: "Ângulo da aba deitada",
    tab_rotate_what: "O que gira na aba deitada",
    default_tab: "Aba inicial",
    remember_tab: "Lembrar a última aba aberta (neste navegador)",
    keep_alive: "Manter as abas já abertas montadas",
    preload: "Montar todas as abas de uma vez",
    header: "Faixa de título (opcional)",
    header_icon: "Ícone da faixa de título",
    header_inset: "Faixa de título: recuo lateral",
    header_overlap: "Faixa de título: quanto o painel cobre",
    shell_radius: "Arredondamento da casca",
    panel_radius: "Arredondamento do painel",
    notch_radius: "Recorte côncavo (fusão aba↔painel)",
    padding: "Respiro entre casca e painel",
    content_padding: "Respiro interno do painel",
    card_gap: "Espaço entre os cards de dentro",
    panel_min_height: "Altura mínima do painel",
    elevation: "Relevo 3D no painel",
    flat_children: "Achatar os cards de dentro",
    tab_active_color: "Aba ativa: texto",
    tab_inactive_color: "Aba inativa: texto",
    content_text_color: "Texto dentro do painel",
    header_color: "Faixa de título (vazio = clareia a casca)",
    header_text_color: "Texto da faixa de título",
    // brilho
    only_when_on: "Só mostrar a luz que estiver acesa",
    hide_tab_when_off: "Esconder a aba BRILHO quando todas apagarem",
    use_light_color: "Usar a cor da própria luz",
    show_brightness_control: "Barra de brilho",
    show_color_temp_control: "Barra de temperatura de cor",
    glass: "Fundo de vidro (escuro translúcido)",
  };

  const POS_OPTIONS = [
    { value: "bottom", label: "Embaixo" }, { value: "top", label: "Em cima" },
    { value: "left", label: "À esquerda" }, { value: "right", label: "À direita" },
  ];
  const DISP_OPTIONS = [
    { value: "both", label: "Ícone e texto" }, { value: "icon", label: "Só ícone" },
    { value: "text", label: "Só texto" },
  ];

  // Os editores internos do HA não vêm carregados: só entram quando alguma
  // tela de edição os pede. Instanciar o editor da pilha vertical puxa o
  // conjunto. Se não vier, o editor cai em JSON — feio, mas nunca sem saída.
  const loadHuiEditors = async () => {
    if (customElements.get("hui-card-element-editor")) return true;
    try {
      const helpers = await window.loadCardHelpers();
      const stack = helpers.createCardElement({ type: "vertical-stack", cards: [] });
      await stack.constructor.getConfigElement();
      await Promise.race([
        customElements.whenDefined("hui-card-element-editor"),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch (_) { /* segue no plano B */ }
    return !!customElements.get("hui-card-element-editor");
  };

  const loadYamlEditor = async () => {
    if (customElements.get("ha-yaml-editor")) return true;
    await loadHuiEditors();
    await Promise.race([
      customElements.whenDefined("ha-yaml-editor"),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    return !!customElements.get("ha-yaml-editor");
  };

  /**
   * Caixa de código de um pedaço da config. YAML quando o HA entrega o
   * ha-yaml-editor; JSON num textarea quando não entrega. Nos dois casos o
   * valor só é gravado no botão «Aplicar» — escrever a cada tecla tiraria o
   * foco de quem está digitando.
   */
  const yamlBox = async (host, hass, value, onApply, dica) => {
    host.innerHTML = `<div class="mtl-warn"></div><div class="yhost"></div>
      <div class="mtl-row"><span class="nm">${esc(dica || "")}</span>
      <button class="mtl-chip" data-apply="1">Aplicar</button></div>`;
    const warn = host.querySelector(".mtl-warn");
    const yhost = host.querySelector(".yhost");
    const ok = await loadYamlEditor();
    let ler = () => value;
    if (ok) {
      const ed = document.createElement("ha-yaml-editor");
      ed.hass = hass;
      ed.defaultValue = value;
      try { if (ed.setValue) ed.setValue(value); } catch (_) { /* versão antiga */ }
      let atual = value, valido = true;
      ed.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        valido = ev.detail.isValid !== false;
        if (valido) { atual = ev.detail.value; warn.textContent = ""; }
        else warn.textContent = "YAML inválido — corrija antes de aplicar.";
      });
      yhost.appendChild(ed);
      ler = () => { if (!valido) throw new Error("YAML inválido"); return atual; };
    } else {
      warn.textContent = "Editor YAML do HA indisponível — mostrando JSON.";
      yhost.innerHTML = `<textarea class="mtl-ta" spellcheck="false"></textarea>`;
      const ta = yhost.querySelector("textarea");
      ta.value = JSON.stringify(value, null, 2);
      ler = () => JSON.parse(ta.value);
    }
    host.querySelector("[data-apply]").addEventListener("click", () => {
      try { onApply(ler()); warn.textContent = "Aplicado."; }
      catch (e) { warn.textContent = `Não aplicado: ${e && e.message ? e.message : e}`; }
    });
  };

  const CSS = `
    .mtl-h{font-size:13px;font-weight:600;margin:14px 0 6px;opacity:.85;}
    .mtl-sec{margin-top:12px;border:1px solid var(--divider-color);border-radius:10px;padding:10px 12px;}
    .mtl-sec>summary{cursor:pointer;font-weight:600;font-size:13px;}
    .mtl-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--divider-color);}
    .mtl-row:first-of-type{border-top:0;}
    .mtl-row .nm{flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    /* a fila de luzes respira: linha mais alta e o selo da integração antes do nome */
    .mtl-row.luz{min-height:46px;padding:9px 0;gap:10px;}
    .mtl-row.luz .nm{font-size:14px;line-height:1.25;white-space:normal;}
    .mtl-row.luz .nm small{display:block;font-size:11px;}
    .mtl-brand{width:24px;height:24px;flex:0 0 24px;object-fit:contain;border-radius:5px;
      background:rgba(255,255,255,.06);}
    .mtl-brand[hidden]{visibility:hidden;display:inline-block;}
    .mtl-row .nm small{opacity:.6;font-size:11px;}
    .mtl-row.off .nm{opacity:.45;text-decoration:line-through;}
    .mtl-ib{border:0;background:transparent;cursor:pointer;color:var(--secondary-text-color);
      font:inherit;font-size:15px;line-height:1;padding:4px 6px;border-radius:6px;}
    .mtl-ib:hover{background:var(--divider-color);color:var(--primary-text-color);}
    .mtl-ib[disabled]{opacity:.3;cursor:default;}
    .mtl-ib.on{color:var(--primary-color);}
    /* o "checkbox" da lista (☐/☑): glifo grande e alvo de toque 44px — no
     * celular o de 15px era impossível de acertar com o dedo */
    .mtl-row.luz .mtl-ib.vis{font-size:26px;line-height:1;padding:9px 10px;min-width:44px;min-height:44px;}
    .mtl-ib.del:hover{color:var(--error-color, #db4437);}
    .mtl-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;
      border:1px solid var(--divider-color);background:transparent;color:var(--primary-text-color);
      font:inherit;font-size:12px;cursor:pointer;}
    .mtl-chip.add{border-style:dashed;}
    .mtl-edit{margin-top:10px;border:1px solid var(--divider-color);border-radius:10px;padding:10px;}
    .mtl-edit .top{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;font-weight:600;}
    .mtl-ta{width:100%;box-sizing:border-box;min-height:180px;font-family:monospace;font-size:12px;
      background:var(--code-editor-background-color, rgba(0,0,0,.06));color:var(--primary-text-color);
      border:1px solid var(--divider-color);border-radius:8px;padding:8px;}
    .mtl-warn{font-size:12px;color:var(--error-color, #db4437);min-height:16px;}
    .mtl-info{font-size:12px;opacity:.7;margin:4px 0 8px;}
    .mtl-crow{display:grid;grid-template-columns:1fr 44px 110px minmax(110px,1fr);gap:10px;align-items:center;padding:6px 0;}
    .mtl-crow .lbl{font-size:13px;}
    .mtl-crow input[type=color]{width:40px;height:28px;border:none;background:none;cursor:pointer;padding:0;}
    .mtl-crow code{font-size:11px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  `;

  class MwTabLightsCardEditor extends HTMLElement {
    setConfig(config) {
      this._config = { ...config };
      this._render();
    }
    set hass(hass) {
      this._hass = hass;
      for (const f of this._forms || []) f.hass = hass;
      // lista de luzes e sensores muda quando o registro muda — não a cada estado
      if (this._reg !== (hass && hass.entities)) {
        this._reg = hass && hass.entities;
        this._renderLights();
        this._renderRainbow();
      }
    }

    /* Chaves que a casa reconhece: o que sobrar fora delas é entulho (ex.: o
     * `header: UPDATE PAYMENT METHOD` herdado do stub do mw-tab-card, morto
     * no YAML). Tudo de verdade continua passando — wrapper do HA, extras e
     * o `yaml_override` inteiro — e o que a casa não conhece sai na hora do
     * salvo, sem sombra no YAML. */
    _emit(next) {
      const CASA = new Set(["area", "columns", "square", "auto_add", "hide_unavailable",
        "brightness_tab", "paper_color", "shell_color", "lights", "exclude",
        "button_defaults", "brightness_options", "buttons_tab", "brightness_tab_options",
        "tabs_options", "tabs_yaml", "extra_cards", "extra_tabs", "yaml_override", "rainbow"]);
      const limpo = {};
      for (const [k, v] of Object.entries(next || {})) {
        if (k === "type" || k === "grid_options" || k.startsWith("view_layout")
          || k.startsWith("layout") || k === "visibility" || CASA.has(k)) limpo[k] = v;
      }
      this._config = limpo;
      this.dispatchEvent(new CustomEvent("config-changed",
        { bubbles: true, composed: true, detail: { config: limpo } }));
    }
    _patch(patch) {
      const next = { ...this._config, ...patch };
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === null) delete next[k];
        else if (k in DEFAULTS && v === DEFAULTS[k] && k !== "area") delete next[k];
      }
      this._emit(next);
    }
    _lights() { return (this._config.lights || []).map((l) => ({ ...l })); }
    /** Fica no YAML o que já era decisão E o que o dono tocou agora. Luz só
     *  descoberta, sem toque nenhum, volta para o automático — é o que impede
     *  o editor de descobrir TODA a área no YAML a cada mexidinha. */
    _setLights(luzes, tocadas) {
      const antes = new Map((this._config.lights || []).map((l) => [l.entity, l]));
      const toque = tocadas instanceof Set ? tocadas : null;
      const limpo = luzes
        .filter((l) => l.entity && (!toque || antes.has(l.entity) || toque.has(l.entity)))
        .map((l) => { const c = { ...l }; delete c._orfa; delete c._discov; return c; });
      const next = { ...this._config };
      if (limpo.length) next.lights = limpo; else delete next.lights;
      this._emit(next);
    }
    /** luz desapareceu do YAML e não pode voltar na redescoberta exclusão. */
    _excluir(entity) {
      if (!entity) return;
      const excl = new Set(Array.isArray(this._config.exclude) ? this._config.exclude : []);
      excl.add(entity);
      this._emit({ ...this._config, exclude: [...excl] });
    }
    /** o dono chamou de volta: sai da exclusão (senão ela devorava a volta). */
    _desexcluir(entity) {
      const excl = (this._config.exclude || []).filter((e) => e !== entity);
      const next = { ...this._config };
      if (excl.length) next.exclude = excl; else delete next.exclude;
      this._emit(next);
    }

    /* ------------------------------- layout ------------------------------ */

    _render() {
      if (!this._root) {
        this._forms = [];
        this._root = document.createElement("div");
        this._root.innerHTML = `<style>${CSS}</style>
          <div id="areaform"></div>
          <div class="mtl-h">Luzes da área</div>
          <div class="mtl-info" id="ainfo"></div>
          <div id="lights"></div>
          <div id="lightedit"></div>
          <details class="mtl-sec" id="rbsec" open><summary>Sensores de luminosidade da área (Rainbow)</summary>
            <div class="mtl-info" id="rbinfo"></div>
            <div id="rblist"></div>
            <div id="rbedit"></div></details>
          <details class="mtl-sec" id="defsec"><summary>Padrão de TODOS os botões</summary>
            <div class="mtl-info">Vale para todos; o que você mexer numa luz vence este padrão.</div>
            <div id="defform"></div></details>
          <details class="mtl-sec" id="tabsec"><summary>Abas (rótulo, ícone, posição, tamanho…)</summary>
            <div class="mtl-h">Aba dos botões</div><div id="tab1form"></div>
            <div class="mtl-h">Aba do brilho</div><div id="tab2form"></div>
            <div class="mtl-h">Comportamento e geometria</div><div id="tabsform"></div></details>
          <details class="mtl-sec" id="colorsec"><summary>Cores (papel, casca e textos)</summary>
            <div id="paperform"></div><div id="colorrows"></div></details>
          <details class="mtl-sec" id="brisec"><summary>Aba de brilho (mushroom)</summary>
            <div id="briform"></div>
            <div class="mtl-h">Estilo do card (card_mod)</div>
            <textarea class="mtl-ta" id="glass" spellcheck="false" style="min-height:120px"></textarea>
            <div class="mtl-row"><span class="nm">vale para todos os cards de brilho</span>
              <button class="mtl-chip" id="glassapply">Aplicar</button></div></details>
          <details class="mtl-sec" id="yamlsec"><summary>Código YAML (avançado)</summary>
            <div class="mtl-h">Config gerada — é isto que vai para o mw-tab-card</div>
            <div id="yamlgen"></div>
            <div class="mtl-h">Ajustes crus (merge por cima do gerado)</div>
            <div id="yamlover"></div></details>`;
        this.appendChild(this._root);

        const form = (sel, cb) => {
          const f = document.createElement("ha-form");
          f.computeLabel = (x) => LABELS[x.name] || x.name;
          f.addEventListener("value-changed", (ev) => { ev.stopPropagation(); cb(ev.detail.value || {}); });
          this._root.querySelector(sel).appendChild(f);
          this._forms.push(f);
          return f;
        };
        this._areaForm = form("#areaform", (v) => this._onArea(v));
        this._defForm = form("#defform", (v) => this._emit({ ...this._config, button_defaults: clean(v) }));
        this._tab1Form = form("#tab1form", (v) => this._patch({ buttons_tab: clean(v) }));
        this._tab2Form = form("#tab2form", (v) => this._patch({ brightness_tab_options: clean(v) }));
        this._tabsForm = form("#tabsform", (v) => this._onTabs(v));
        this._paperForm = form("#paperform", (v) => this._patch({ paper_color: v.paper_color }));
        this._briForm = form("#briform", (v) => this._onBri(v));

        this._lightsEl = this._root.querySelector("#lights");
        this._editEl = this._root.querySelector("#lightedit");
        this._rbList = this._root.querySelector("#rblist");
        this._rbEdit = this._root.querySelector("#rbedit");
        this._rbInfo = this._root.querySelector("#rbinfo");
        this._colorRows = this._root.querySelector("#colorrows");
        this._glass = this._root.querySelector("#glass");
        this._root.querySelector("#glassapply").addEventListener("click", () => {
          const b = { ...(this._config.brightness_options || {}) };
          const v = this._glass.value.trim();
          if (v && v !== GLASS.trim()) b.style = this._glass.value; else delete b.style;
          this._patch({ brightness_options: clean(b) });
        });
        this._root.querySelector("#yamlsec").addEventListener("toggle", () => this._renderYaml(), { once: false });
      }
      this._renderAreaForm();
      this._renderLights();
      this._renderRainbow();
      this._renderDefForm();
      this._renderTabForms();
      this._renderColors();
      this._renderBri();
    }

    /* -------------------------------- área ------------------------------- */

    _renderAreaForm() {
      const c = { ...DEFAULTS, ...this._config };
      this._areaForm.hass = this._hass;
      this._areaForm.schema = [
        { name: "area", selector: { area: {} } },
        {
          name: "", type: "grid", schema: [
            { name: "columns", selector: { number: { min: 1, max: 6, step: 1, mode: "box" } } },
            { name: "square", selector: { boolean: {} } },
            { name: "auto_add", selector: { boolean: {} } },
            { name: "brightness_tab", selector: { boolean: {} } },
            { name: "hide_unavailable", selector: { boolean: {} } },
          ],
        },
      ];
      this._areaForm.data = {
        area: c.area, columns: c.columns, square: c.square !== false,
        auto_add: c.auto_add !== false, brightness_tab: c.brightness_tab !== false,
        hide_unavailable: c.hide_unavailable === true,
      };
      const info = this._root.querySelector("#ainfo");
      if (this._hass && c.area) {
        const aid = resolveArea(this._hass, c.area);
        const n = discoverLights(this._hass, c.area).length;
        info.textContent = `${n} luz(es) encontrada(s) em «${areaName(this._hass, aid)}».`;
      } else info.textContent = "Escolha a área para o card descobrir as luzes.";
    }

    _onArea(v) {
      const area = Array.isArray(v.area) ? v.area[0] : v.area;
      const trocou = area !== this._config.area;
      const patch = {
        area: area || "",
        columns: Number(v.columns) || DEFAULTS.columns,
        square: v.square !== false,
        auto_add: v.auto_add !== false,
        brightness_tab: v.brightness_tab !== false,
        hide_unavailable: v.hide_unavailable === true,
      };
      // área nova: o que sobrou da antiga não faz sentido, mas o que continua
      // na área nova mantém os ajustes do dono
      if (trocou && this._hass) {
        const naNova = new Set(discoverLights(this._hass, patch.area));
        const fica = (this._config.lights || []).filter((l) => naNova.has(l.entity));
        patch.lights = fica.length ? fica : undefined;
        if (!fica.length) delete patch.lights;
        else patch.lights = fica;
        this._sel = null;
      }
      this._patch(patch);
      this._renderAreaForm();
      this._renderLights();
      this._renderRainbow();
    }

    /* ------------------------------- luzes ------------------------------- */

    _renderLights() {
      if (!this._lightsEl || !this._config) return;
      const luzes = this._hass ? mergeLights(this._hass, { ...DEFAULTS, ...this._config }) : this._lights();
      this._vis = luzes;
      const s = sig(luzes.map((l) => [l.entity, l.hidden, l.name, l.icon_on, l.icon_off, l._orfa]));
      if (s === this._lightsSig && this._lightsEl.children.length) return;
      this._lightsSig = s;
      const n = luzes.length;
      this._lightsEl.innerHTML = luzes.map((l, i) => {
        const nome = (l.name || (this._hass ? friendly(this._hass, l.entity) : l.entity));
        const plat = this._hass ? platformOf(this._hass, l.entity) : "";
        const selo = plat
          ? `<img class="mtl-brand" data-plat="${esc(plat)}" title="${esc(plat)}" alt="${esc(plat)}"
               src="${BRANDS}/${encodeURIComponent(plat)}/icon.png">`
          : `<span class="mtl-brand"></span>`;
        return `<div class="mtl-row luz ${l.hidden === true ? "off" : ""}">
          <button class="mtl-ib vis ${l.hidden === true ? "" : "on"}" data-a="vis" data-i="${i}"
            title="${l.hidden === true ? "excluída da grade" : "aparece na grade"}">${l.hidden === true ? "☐" : "☑"}</button>
          ${selo}
          <span class="nm">${esc(nome)} <small>${esc(l.entity)}${l._orfa ? " · ⚠ fora da área" : ""}</small></span>
          <button class="mtl-ib" data-a="edit" data-i="${i}" title="opções do botão">✎</button>
          <button class="mtl-ib" data-a="up" data-i="${i}" ${i === 0 ? "disabled" : ""} title="subir">↑</button>
          <button class="mtl-ib" data-a="down" data-i="${i}" ${i === n - 1 ? "disabled" : ""} title="descer">↓</button>
          <button class="mtl-ib del" data-a="del" data-i="${i}" title="apagar (some do YAML e não volta)">✕</button>
        </div>`;
      }).join("") + `<div class="mtl-row"><span class="nm"></span>
        <button class="mtl-chip add" data-a="re">↻ redescobrir</button>
        <button class="mtl-chip add" data-a="add">+ luz de outra área</button></div>`;
      this._lightsEl.querySelectorAll("[data-a]").forEach((b) =>
        b.addEventListener("click", () => this._lightAction(b.dataset.a, +b.dataset.i)));
      // `onerror` inline não passa pela política de conteúdo do HA: o laço
      // abaixo é o mesmo fallback do frontend (marca própria → `_/` → nada)
      this._lightsEl.querySelectorAll("img.mtl-brand").forEach((img) => {
        img.addEventListener("error", () => {
          if (!img.dataset.fallback) {
            img.dataset.fallback = "1";
            img.src = `${BRANDS}/_/${encodeURIComponent(img.dataset.plat)}/icon.png`;
          } else img.hidden = true;
        });
      });
      this._renderLightEditor();
    }

    _lightAction(a, i) {
      const luzes = (this._vis || []).map((l) => { const c = { ...l }; delete c._orfa; return c; });
      if (a === "re") {
        // materializa o que está na tela (inclusive o que entrou por auto_add)
        this._sel = null; this._lightsSig = null;
        this._setLights(luzes); this._renderLights(); return;
      }
      if (a === "add") { this._adding = true; this._renderLightEditor(); return; }
      if (a === "edit") { this._sel = this._sel === i ? null : i; this._adding = false; this._renderLightEditor(); return; }
      if (a === "vis") {
        if (luzes[i].hidden === true) delete luzes[i].hidden; else luzes[i].hidden = true;
        // tocada: materializa SÓ a luz que o dono marcou, não a fila inteira
        this._lightsSig = null;
        this._setLights(luzes, new Set([luzes[i].entity]));
        this._renderLights();
        return;
      }
      else if (a === "up" && i > 0) [luzes[i - 1], luzes[i]] = [luzes[i], luzes[i - 1]];
      else if (a === "down" && i < luzes.length - 1) [luzes[i + 1], luzes[i]] = [luzes[i], luzes[i + 1]];
      else if (a === "del") {
        const fora = luzes[i].entity;
        luzes.splice(i, 1);
        this._sel = null;
        // exclusão de verdade: some do YAML e não volta na redescoberta
        this._excluir(fora);
        this._lightsSig = null;
        this._setLights(luzes, new Set());
        this._renderLights();
        return;
      }
      else return;
      this._lightsSig = null;
      this._setLights(luzes);   // ordem é decisão da fila inteira: materializa
      this._renderLights();
    }

    _writeLight(i, patch) {
      const luzes = (this._vis || []).map((l) => { const c = { ...l }; delete c._orfa; return c; });
      if (!luzes[i]) return;
      luzes[i] = { entity: luzes[i].entity, ...clean({ ...luzes[i], ...patch }) };
      if (patch.hidden === true) luzes[i].hidden = true;
      this._setLights(luzes, new Set([luzes[i].entity]));
      this._lightsSig = null;
      this._renderLights();
    }

    _buttonSchema(data, comEntidade) {
      const bare = data.hide_label === true;
      return [
        ...(comEntidade ? [{ name: "entity", required: true,
          selector: { entity: { domain: ["light", "switch", "fan", "input_boolean"] } } }] : []),
        { name: "name", selector: { text: {} } },
        { name: "", type: "grid", schema: [
          { name: "icon_on", selector: { icon: {} } },
          { name: "icon_off", selector: { icon: {} } },
          { name: "icon_unavailable", selector: { icon: {} } },
        ] },
        { name: "", type: "grid", schema: [
          { name: "animate", selector: { boolean: {} } },
          { name: "control", selector: { boolean: {} } },
          { name: "icon_shadow", selector: { boolean: {} } },
          { name: "haptic", selector: { boolean: {} } },
          { name: "hide_label", selector: { boolean: {} } },
          { name: "confirm", selector: { boolean: {} } },
        ] },
        ...(data.confirm === true ? [
          { name: "confirm_text", selector: { text: {} } },
          { name: "confirm_3d", selector: { boolean: {} } },
          ...(data.confirm_3d === true ? [
            { name: "confirm_paper_dark", selector: { boolean: {} } },
            { name: "confirm_paper_color", selector: { select: { mode: "dropdown",
              options: data.confirm_paper_dark === true ? paperDarkOptions() : paperOptions() } } },
          ] : []),
        ] : []),
        { name: "paper_color", selector: { select: { mode: "dropdown", options: paperOptions() } } },
        { name: "icon_size", selector: { number: { min: 8, max: 200, step: 1, mode: "box", unit_of_measurement: "px" } } },
        ...(bare ? [] : [
          { name: "name_position", selector: { select: { mode: "dropdown", options: [
            { value: "bottom", label: "Abaixo do ícone" }, { value: "top", label: "Acima do ícone" },
            { value: "left", label: "À esquerda do ícone" }, { value: "right", label: "À direita do ícone" },
          ] } } },
          { name: "name_size", selector: { number: { min: 6, max: 40, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "name_gap", selector: { number: { min: 0, max: 40, step: 1, mode: "box", unit_of_measurement: "px" } } },
        ]),
        { name: "", type: "expandable", title: "Cores deste botão", schema: [
          { name: "color_on_name", selector: { text: {} } },
          { name: "color_off_name", selector: { text: {} } },
          { name: "color_off_bg", selector: { text: {} } },
          { name: "color_on_border", selector: { text: {} } },
          { name: "color_off_border", selector: { text: {} } },
          { name: "color_unavail", selector: { text: {} } },
        ] },
      ];
    }

    _renderDefForm() {
      const data = { ...BUTTON_DEFAULTS, ...(this._config.button_defaults || {}) };
      this._defForm.hass = this._hass;
      this._defForm.schema = this._buttonSchema(data, false);
      this._defForm.data = data;
    }

    async _renderLightEditor() {
      if (!this._editEl) return;
      this._editEl.innerHTML = "";
      if (this._adding) {
        const box = document.createElement("div");
        box.className = "mtl-edit";
        box.innerHTML = `<div class="top"><span>Incluir uma luz (ou tomada) de qualquer área</span>
          <span style="flex:1"></span><button class="mtl-ib" data-close="1">✕</button></div><div class="host"></div>`;
        box.querySelector("[data-close]").addEventListener("click", () => { this._adding = false; this._renderLightEditor(); });
        this._editEl.appendChild(box);
        const f = document.createElement("ha-form");
        f.hass = this._hass;
        f.computeLabel = (x) => LABELS[x.name] || x.name;
        f.schema = [{ name: "entity", selector: { entity: { domain: ["light", "switch", "fan", "input_boolean"] } } }];
        f.data = {};
        f.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          const id = ev.detail.value && ev.detail.value.entity;
          if (!id) return;
          const luzes = (this._vis || []).map((l) => { const c = { ...l }; delete c._orfa; return c; });
          if (!luzes.some((l) => l.entity === id)) luzes.push({ entity: id });
          this._adding = false; this._lightsSig = null;
          this._desexcluir(id);                       // quem chamou de volta
          this._setLights(luzes, new Set([id]));      // materializa só a nova
          this._renderLights();
        });
        box.querySelector(".host").appendChild(f);
        return;
      }
      const i = this._sel;
      const l = (this._vis || [])[i];
      if (i == null || !l) return;

      const box = document.createElement("div");
      box.className = "mtl-edit";
      box.innerHTML = `<div class="top"><span>${esc(l.name || (this._hass ? friendly(this._hass, l.entity) : l.entity))}</span>
        <span style="flex:1"></span><button class="mtl-ib" data-close="1" title="fechar">✕</button></div>
        <div class="host"></div>
        <details class="mtl-sec"><summary>Código YAML deste botão</summary><div class="yb"></div></details>
        <details class="mtl-sec"><summary>Código YAML do card de brilho desta luz</summary><div class="yb2"></div></details>`;
      box.querySelector("[data-close]").addEventListener("click", () => { this._sel = null; this._renderLightEditor(); });
      this._editEl.appendChild(box);

      const gerado = this._hass ? buttonConfig(this._hass, { ...DEFAULTS, ...this._config }, l) : { ...l };
      const f = document.createElement("ha-form");
      f.hass = this._hass;
      f.computeLabel = (x) => LABELS[x.name] || x.name;
      const data = { ...gerado };
      delete data.type; delete data.entity;
      f.schema = this._buttonSchema(data, false);
      f.data = data;
      f.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const v = { ...ev.detail.value };
        // só o que difere do padrão (defaults do card + palpite de ícone) vai
        // para o YAML da luz — senão cada botão nasce com 20 linhas iguais
        const base = this._hass
          ? buttonConfig(this._hass, { ...DEFAULTS, ...this._config }, { entity: l.entity })
          : {};
        delete base.type; delete base.entity;
        const over = diffObj(base, v);
        if (l.hidden === true) over.hidden = true;
        if (l.button_yaml) over.button_yaml = l.button_yaml;
        if (l.bright_yaml) over.bright_yaml = l.bright_yaml;
        const luzes = (this._vis || []).map((x) => { const c = { ...x }; delete c._orfa; return c; });
        luzes[i] = { entity: l.entity, ...clean(over) };
        if (over.hidden === true) luzes[i].hidden = true;
        this._setLights(luzes, new Set([l.entity]));
        this._lightsSig = null;
        // a lista mostra nome/ícone: atualiza só o rótulo, sem remontar o form
        const row = this._lightsEl.children[i];
        if (row) row.querySelector(".nm").innerHTML =
          `${esc(v.name || (this._hass ? friendly(this._hass, l.entity) : l.entity))} <small>${esc(l.entity)}</small>`;
      });
      box.querySelector(".host").appendChild(f);

      yamlBox(box.querySelector(".yb"), this._hass, gerado, (val) => {
        const luzes = (this._vis || []).map((x) => { const c = { ...x }; delete c._orfa; return c; });
        luzes[i] = { ...luzes[i], button_yaml: diffObj(gerado, val) };
        this._setLights(luzes, new Set([luzes[i].entity]));
        this._lightsSig = null; this._renderLights();
      }, "grava só o que você mudou (merge sobre o gerado)");

      const geradoBri = this._hass ? brightConfig(this._hass, { ...DEFAULTS, ...this._config }, l) : {};
      const alvo = geradoBri.card || geradoBri;
      yamlBox(box.querySelector(".yb2"), this._hass, alvo, (val) => {
        const luzes = (this._vis || []).map((x) => { const c = { ...x }; delete c._orfa; return c; });
        luzes[i] = { ...luzes[i], bright_yaml: diffObj(alvo, val) };
        this._setLights(luzes, new Set([luzes[i].entity]));
        this._lightsSig = null; this._renderLights();
      }, "mushroom-light-card desta luz");
    }

    /* ------------------------------ rainbow ------------------------------ */

    _renderRainbow() {
      if (!this._rbList || !this._config) return;
      const sensors = this._hass ? mergeRainbow(this._hass, this._config) : (this._config.rainbow_sensors || []);
      this._visRb = sensors;
      const s = sig(sensors.map((x) => [x.entity, x.hidden, x.device, x._orfa]));
      if (s === this._rbSig && this._rbList.children.length) return;
      this._rbSig = s;
      const n = sensors.length;
      if (this._rbInfo) {
        if (this._hass && this._config.area) {
          const aid = resolveArea(this._hass, this._config.area);
          this._rbInfo.textContent = `${n} sensor(es) de luminosidade em «${areaName(this._hass, aid)}».`;
        } else {
          this._rbInfo.textContent = "Sensores de luminosidade adicionados ao Rainbow do card.";
        }
      }
      this._rbList.innerHTML = sensors.map((x, i) => {
        const nome = this._hass ? friendly(this._hass, x.entity) : x.entity;
        const plat = this._hass ? platformOf(this._hass, x.entity) : "";
        const selo = plat
          ? `<img class="mtl-brand" data-plat="${esc(plat)}" title="${esc(plat)}" alt="${esc(plat)}"
               src="${BRANDS}/${encodeURIComponent(plat)}/icon.png">`
          : `<span class="mtl-brand"></span>`;
        return `<div class="mtl-row luz ${x.hidden === true ? "off" : ""}">
          <button class="mtl-ib vis ${x.hidden === true ? "" : "on"}" data-ra="vis" data-ri="${i}"
            title="${x.hidden === true ? "excluído do rainbow" : "aparece no rainbow"}">${x.hidden === true ? "☐" : "☑"}</button>
          ${selo}
          <span class="nm">${esc(nome)} <small>${esc(x.entity)}${x._orfa ? " · ⚠ fora da área" : ""}</small></span>
          <button class="mtl-ib" data-ra="up" data-ri="${i}" ${i === 0 ? "disabled" : ""} title="subir">↑</button>
          <button class="mtl-ib" data-ra="down" data-ri="${i}" ${i === n - 1 ? "disabled" : ""} title="descer">↓</button>
          <button class="mtl-ib del" data-ra="del" data-ri="${i}" title="apagar do rainbow">✕</button>
        </div>`;
      }).join("") + `<div class="mtl-row"><span class="nm"></span>
        <button class="mtl-chip add" data-ra="re">↻ redescobrir</button>
        <button class="mtl-chip add" data-ra="add">+ sensor de outra área</button></div>`;

      this._rbList.querySelectorAll("[data-ra]").forEach((b) =>
        b.addEventListener("click", () => this._rainbowAction(b.dataset.ra, +b.dataset.ri)));

      this._rbList.querySelectorAll("img.mtl-brand").forEach((img) => {
        img.addEventListener("error", () => {
          if (!img.dataset.fallback) {
            img.dataset.fallback = "1";
            img.src = `${BRANDS}/_/${encodeURIComponent(img.dataset.plat)}/icon.png`;
          } else img.hidden = true;
        });
      });
      this._renderRainbowEditor();
    }

    _rainbowAction(a, i) {
      const sensors = (this._visRb || []).map((x) => ({ ...x }));
      if (a === "re") {
        this._rbSig = null;
        this._setRainbowSensors(sensors);
        this._renderRainbow();
        return;
      }
      if (a === "add") {
        this._addingRb = true;
        this._renderRainbowEditor();
        return;
      }
      if (a === "vis") {
        if (sensors[i].hidden === true) delete sensors[i].hidden; else sensors[i].hidden = true;
        this._rbSig = null;
        this._setRainbowSensors(sensors);
        this._renderRainbow();
        return;
      }
      if (a === "up" && i > 0) {
        [sensors[i - 1], sensors[i]] = [sensors[i], sensors[i - 1]];
      } else if (a === "down" && i < sensors.length - 1) {
        [sensors[i + 1], sensors[i]] = [sensors[i], sensors[i + 1]];
      } else if (a === "del") {
        sensors.splice(i, 1);
      } else {
        return;
      }
      this._rbSig = null;
      this._setRainbowSensors(sensors);
      this._renderRainbow();
    }

    _setRainbowSensors(sensors) {
      const activeOrListed = sensors.filter((s) => !!s.entity);
      if (!activeOrListed.length) {
        const next = { ...this._config };
        delete next.rainbow;
        this._emit(next);
        return;
      }
      const updatedRainbow = makeRainbowCard(this._hass, activeOrListed, this._config.rainbow);
      this._emit({ ...this._config, rainbow: updatedRainbow });
    }

    _renderRainbowEditor() {
      if (!this._rbEdit) return;
      this._rbEdit.innerHTML = "";
      if (this._addingRb) {
        const box = document.createElement("div");
        box.className = "mtl-edit";
        box.innerHTML = `<div class="top"><span>Incluir um sensor de luminosidade de qualquer área</span>
          <span style="flex:1"></span><button class="mtl-ib" data-close-rb="1">✕</button></div><div class="host"></div>`;
        box.querySelector("[data-close-rb]").addEventListener("click", () => {
          this._addingRb = false;
          this._renderRainbowEditor();
        });
        this._rbEdit.appendChild(box);
        const f = document.createElement("ha-form");
        f.hass = this._hass;
        f.computeLabel = (x) => LABELS[x.name] || x.name;
        f.schema = [{ name: "entity", selector: { entity: { domain: ["sensor"] } } }];
        f.data = {};
        f.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          const id = ev.detail.value && ev.detail.value.entity;
          if (!id) return;
          const sensors = (this._visRb || []).map((x) => ({ ...x }));
          if (!sensors.some((x) => x.entity === id)) {
            sensors.push({
              entity: id,
              device: (this._hass && deviceOfEntity(this._hass, id)) || "",
              hidden: false,
            });
          }
          this._addingRb = false;
          this._rbSig = null;
          this._setRainbowSensors(sensors);
          this._renderRainbow();
        });
        box.querySelector(".host").appendChild(f);
      }
    }

    /* -------------------------------- abas ------------------------------- */

    _renderTabForms() {
      const t1 = { ...BUTTONS_TAB, ...(this._config.buttons_tab || {}) };
      const t2 = { ...BRIGHT_TAB, ...(this._config.brightness_tab_options || {}) };
      const tabSchema = [{ name: "", type: "grid", schema: [
        { name: "label", selector: { text: {} } },
        { name: "icon", selector: { icon: {} } },
      ] }];
      this._tab1Form.hass = this._hass; this._tab1Form.schema = tabSchema; this._tab1Form.data = t1;
      this._tab2Form.hass = this._hass; this._tab2Form.schema = tabSchema; this._tab2Form.data = t2;

      const o = { ...TABS_DEFAULTS, ...(this._config.tabs_options || {}) };
      const horiz = o.tab_position === "top" || o.tab_position === "bottom";
      this._tabsForm.hass = this._hass;
      this._tabsForm.schema = [
        { name: "", type: "grid", schema: [
          { name: "tab_position", selector: { select: { mode: "dropdown", options: POS_OPTIONS } } },
          { name: "tab_display", selector: { select: { mode: "dropdown", options: DISP_OPTIONS } } },
          { name: "tab_icon_size", selector: { number: { min: 10, max: 48, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "tab_font_size", selector: { number: { min: 7, max: 28, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "tab_size", selector: { number: { min: 0, max: 240, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "default_tab", selector: { number: { min: 0, max: 5, step: 1, mode: "box" } } },
        ] },
        ...(horiz ? [{ name: "tab_stretch", selector: { boolean: {} } }] : [
          { name: "tab_rotate", selector: { select: { mode: "dropdown", options: [
            { value: "auto", label: "Automático (deita em retrato)" },
            { value: "true", label: "Sempre deitada" },
            { value: "false", label: "Nunca" }] } } },
          { name: "tab_rotate_angle", selector: { select: { mode: "dropdown", options: [
            { value: "auto", label: "Automático" }, { value: "90", label: "90°" }, { value: "270", label: "270°" }] } } },
          { name: "tab_rotate_what", selector: { select: { mode: "dropdown", options: [
            { value: "both", label: "Ícone e texto" }, { value: "text", label: "Só o texto" },
            { value: "icon", label: "Só o ícone" }] } } },
        ]),
        { name: "tab_align", selector: { select: { mode: "dropdown", options: [
          { value: "", label: "Automático" }, { value: "start", label: "No começo" },
          { value: "center", label: "No centro" }, { value: "end", label: "No fim" } ] } } },
        { name: "header", selector: { text: {} } },
        { name: "header_icon", selector: { icon: {} } },
        { name: "", type: "grid", schema: [
          { name: "shell_radius", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "panel_radius", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "notch_radius", selector: { number: { min: 0, max: 40, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "padding", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "content_padding", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "card_gap", selector: { number: { min: 0, max: 60, step: 1, mode: "box", unit_of_measurement: "px" } } },
          { name: "panel_min_height", selector: { number: { min: 0, max: 800, step: 4, mode: "box", unit_of_measurement: "px" } } },
        ] },
        { name: "", type: "grid", schema: [
          { name: "elevation", selector: { boolean: {} } },
          { name: "flat_children", selector: { boolean: {} } },
          { name: "haptic", selector: { boolean: {} } },
          { name: "keep_alive", selector: { boolean: {} } },
          { name: "remember_tab", selector: { boolean: {} } },
          { name: "preload", selector: { boolean: {} } },
        ] },
      ];
      const data = { ...o };
      for (const k of Object.keys(data)) if (data[k] === "" || data[k] === undefined) delete data[k];
      this._tabsForm.data = data;
    }

    _onTabs(v) {
      const o = clean({ ...(this._config.tabs_options || {}), ...v });
      for (const [k, val] of Object.entries(TABS_DEFAULTS)) {
        // default do MW Tab Lights fica no YAML (é ele que define o desenho);
        // o resto sai quando volta ao valor do mw-tab-card
        if (o[k] === undefined) o[k] = val;
      }
      this._patch({ tabs_options: o });
      this._renderTabForms();
    }

    /* ------------------------------- cores ------------------------------- */

    _renderColors() {
      this._paperForm.hass = this._hass;
      this._paperForm.schema = [{ name: "paper_color", selector: { select: { mode: "dropdown", options: paperOptions() } } }];
      this._paperForm.data = { paper_color: this._config.paper_color || DEFAULTS.paper_color };

      const campos = [
        ["shell_color", null],
        ["tab_active_color", "tabs_options"], ["tab_inactive_color", "tabs_options"],
        ["content_text_color", "tabs_options"], ["header_color", "tabs_options"],
        ["header_text_color", "tabs_options"],
      ];
      const valor = (name, onde) => (onde ? (this._config[onde] || {})[name] : this._config[name])
        ?? (name === "shell_color" ? DEFAULTS.shell_color : "");
      this._colorRows.innerHTML = campos.map(([name, onde]) => {
        const cur = valor(name, onde);
        const col = parseColor(cur || "rgba(128,128,128,1)");
        return `<div class="mtl-crow" data-name="${name}" data-onde="${onde || ""}">
          <span class="lbl">${LABELS[name] || name}</span>
          <input type="color" value="${toHex(col)}" title="cor">
          <input type="range" min="0" max="1" step="0.01" value="${col.a}" title="transparência (alfa)">
          <code>${esc(cur || "—")}</code></div>`;
      }).join("");
      this._colorRows.querySelectorAll(".mtl-crow").forEach((row) => {
        const name = row.dataset.name, onde = row.dataset.onde;
        const apply = () => {
          const { r, g, b } = parseColor(row.querySelector("input[type=color]").value);
          const a = parseFloat(row.querySelector("input[type=range]").value);
          const v = toRgba({ r, g, b, a });
          if (onde) this._patch({ [onde]: { ...(this._config[onde] || {}), [name]: v } });
          else this._patch({ [name]: v });
          row.querySelector("code").textContent = v;
        };
        row.querySelector("input[type=color]").addEventListener("input", apply);
        row.querySelector("input[type=range]").addEventListener("input", apply);
      });
    }

    /* ------------------------------- brilho ------------------------------ */

    _renderBri() {
      const b = { ...BRIGHTNESS_DEFAULTS, ...(this._config.brightness_options || {}) };
      this._briForm.hass = this._hass;
      this._briForm.schema = [{ name: "", type: "grid", schema: [
        { name: "only_when_on", selector: { boolean: {} } },
        { name: "hide_tab_when_off", selector: { boolean: {} } },
        { name: "use_light_color", selector: { boolean: {} } },
        { name: "show_brightness_control", selector: { boolean: {} } },
        { name: "show_color_temp_control", selector: { boolean: {} } },
        { name: "glass", selector: { boolean: {} } },
      ] }];
      this._briForm.data = {
        only_when_on: b.only_when_on !== false,
        hide_tab_when_off: b.hide_tab_when_off !== false,
        use_light_color: b.use_light_color !== false,
        show_brightness_control: b.show_brightness_control !== false,
        show_color_temp_control: b.show_color_temp_control !== false,
        glass: b.glass !== false,
      };
      if (this._glass && document.activeElement !== this._glass) this._glass.value = b.style || GLASS;
    }

    _onBri(v) {
      const b = { ...(this._config.brightness_options || {}), ...v };
      for (const [k, val] of Object.entries(BRIGHTNESS_DEFAULTS)) {
        if (b[k] === val) delete b[k];
      }
      this._patch({ brightness_options: Object.keys(b).length ? b : undefined });
      this._renderBri();
    }

    /* -------------------------------- yaml ------------------------------- */

    async _renderYaml() {
      const sec = this._root.querySelector("#yamlsec");
      if (!sec.open || !this._hass) return;
      const gen = this._root.querySelector("#yamlgen");
      const over = this._root.querySelector("#yamlover");
      const gerado = buildConfig(this._hass, { ...DEFAULTS, ...this._config });
      await yamlBox(gen, this._hass, gerado, (val) => {
        this._patch({ yaml_override: diffObj(gerado, val) });
        this._renderYaml();
      }, "editar aqui grava as diferenças em yaml_override");
      await yamlBox(over, this._hass, this._config.yaml_override || {}, (val) => {
        this._patch({ yaml_override: isObj(val) && Object.keys(val).length ? val : undefined });
      }, "merge por cima do gerado (null apaga uma chave)");
    }
  }

  /* --------------------------------- registro -------------------------------- */

  customElements.define("mw-tab-lights-card", MwTabLightsCard);
  customElements.define("mw-tab-lights-card-editor", MwTabLightsCardEditor);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "mw-tab-lights-card",
    name: "MW Tab Lights",
    description: "As luzes de uma área em abas: grade de botões de papel + brilho, montados sozinhos.",
    preview: true,
    documentationURL: "https://github.com/visaodeempresa/mw-ha-tab-lights-card",
  });

  // o probe headless importa estas peças; no navegador não atrapalha ninguém
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      buildConfig,
      discoverLights,
      discoverIlluminance,
      mergeLights,
      mergeRainbow,
      makeRainbowCard,
      resolveArea,
      deepMerge,
      diffObj,
      VERSION
    };
  }

  console.info(`%c MW-TAB-LIGHTS-CARD %c ${VERSION} `,
    "background:#1a1a1a;color:#fdfaf3;font-weight:700;", "background:#e8e3d8;color:#1a1a1a;font-weight:700;");
})();
