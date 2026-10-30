/* Probe headless do mw-tab-lights-card — monta card e editor fora do
 * navegador com o mesmo shim de DOM dos irmãos. Pega o que dói perder sem
 * abrir o HA: a descoberta das luzes por área, a grade, a aba de brilho, a
 * ordem/exclusão, os overrides de YAML e o editor montando sem `hass` e sem
 * os elementos internos do HA.
 *
 * Roda no CI e antes de qualquer PR:  node tools/probe.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

/* ------------------------------- shim DOM ------------------------------- */

const mkStyle = () => {
  const s = { _p: {} };
  s.setProperty = (k, v) => { s._p[k] = String(v); };
  s.removeProperty = (k) => { delete s._p[k]; };
  s.get = (k) => s._p[k];
  return s;
};

class Node {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.style = mkStyle();
    this.children = [];
    this.dataset = {};
    this._attrs = {};
    this._listeners = {};
    this._q = new Map();
    this._classes = new Set();
    this.innerHTML = "";
    this.textContent = "";
    this.hidden = false;
    this.classList = {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      contains: (c) => this._classes.has(c),
      toggle: (c, on) => (on === undefined
        ? (this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c))
        : (on ? this._classes.add(c) : this._classes.delete(c))),
    };
  }
  appendChild(n) { this.children.push(n); n.parentNode = this; return n; }
  append(...n) { n.forEach((x) => this.appendChild(x)); }
  insertBefore(n, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    n.parentNode = this;
    return n;
  }
  replaceChild(nw, old) {
    const i = this.children.indexOf(old);
    if (i >= 0) this.children[i] = nw;
    nw.parentNode = this;
  }
  removeChild(n) { this.children = this.children.filter((c) => c !== n); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
  removeEventListener() {}
  dispatchEvent(ev) { (this._listeners[ev && ev.type] || []).forEach((f) => f(ev)); return true; }
  // memoiza por seletor: o código só consulta seletores fixos
  querySelector(sel) {
    if (!this._q.has(sel)) this._q.set(sel, new Node("div"));
    return this._q.get(sel);
  }
  querySelectorAll() { return []; }
  getElementById(id) { return this.querySelector("#" + id); }
  focus() {}
}

global.Node = Node;
global.HTMLElement = class extends Node {
  attachShadow() { this.shadowRoot = new Node("shadow-root"); return this.shadowRoot; }
};
global.CustomEvent = class {
  constructor(type, init) { this.type = type; Object.assign(this, init || {}); }
};
const reg = {};
global.customElements = {
  define: (n, c) => { reg[n] = c; },
  get: (n) => reg[n],
  whenDefined: () => Promise.resolve(),
};
global.document = { createElement: (t) => new Node(t), body: new Node("body") };
// no Node 24 `navigator` é getter-only: define por cima, não por atribuição
Object.defineProperty(global, "navigator", { value: { vibrate: () => {} }, configurable: true });

// helpers de bolso: os "cards de dentro" viram nós marcados
global.window = {
  customCards: [],
  localStorage: { _v: {}, getItem(k) { return k in this._v ? this._v[k] : null; }, setItem(k, v) { this._v[k] = v; } },
  dispatchEvent: () => {},
  loadCardHelpers: async () => ({
    createCardElement(cfg) {
      const el = new Node("div");
      el._cfg = cfg;
      el.getCardSize = () => 2;
      return el;
    },
  }),
};

const infoBanner = [];
const realInfo = console.info;
console.info = (...a) => infoBanner.push(a.join(" "));
global.setTimeout = global.setTimeout || ((f) => f());

const SRC = path.join(__dirname, "..", "dist", "mw-tab-lights-card.js");
const SRC_TXT = fs.readFileSync(SRC, "utf8");
eval(SRC_TXT);
console.info = realInfo;

let pass = 0; const fails = [];
const ok = (cond, msg) => { if (cond) pass++; else fails.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${msg} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);

/* ------------------------------- hass falso ------------------------------ */

const LUZES = [
  ["light.mesa", "Mesa"],
  ["light.led_da_mesa", "LED da Mesa"],
  ["light.estantes", "Estantes"],
  ["light.coluninhas", "Coluninhas"],
  ["light.luz_do_teto_do_escritorio", "Luz do Teto do Escritório"],
];
const HASS = {
  areas: { escritorio: { name: "Escritório" }, sala: { name: "Sala" } },
  devices: { dev1: { area_id: "escritorio" } },
  entities: {},
  states: {},
  callService() {},
};
for (const [id, nome] of LUZES) {
  HASS.states[id] = { state: "off", attributes: { friendly_name: nome } };
  HASS.entities[id] = { area_id: "escritorio" };
}
// uma luz herdando a área pelo DISPOSITIVO (sem area_id próprio)
HASS.states["light.abajur"] = { state: "on", attributes: { friendly_name: "Abajur" } };
HASS.entities["light.abajur"] = { device_id: "dev1" };
// uma escondida pelo registro — não pode virar botão
HASS.states["light.oculta"] = { state: "off", attributes: { friendly_name: "Oculta" } };
HASS.entities["light.oculta"] = { area_id: "escritorio", hidden_by: "user" };
// uma de outra área
HASS.states["light.sala"] = { state: "off", attributes: { friendly_name: "Sala" } };
HASS.entities["light.sala"] = { area_id: "sala" };

const mk = (cfg) => {
  const el = new (customElements.get("mw-tab-lights-card"))();
  el.isConnected = true;
  el.setConfig(cfg);
  el.hass = HASS;
  return el;
};
/* ------------------------------- descoberta ------------------------------ */

ok(!!customElements.get("mw-tab-lights-card"), "custom element mw-tab-lights-card não foi registrado");
ok(!!customElements.get("mw-tab-lights-card-editor"), "editor não foi registrado");

const card = mk({ area: "escritorio" });
// _update é assíncrono (loadCardHelpers); espera o microtask assentar
const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  await tick(); await tick(); await tick();
  const cfg = card._child && card._child._cfg;
  ok(!!cfg, "o card não montou o custom:mw-tab-card");
  if (cfg) {
    eq(cfg.type, "custom:mw-tab-card", "tipo do filho");
    eq(cfg.paper_color, "orange-7", "papel padrão");
    eq(cfg.tab_position, "right", "abas à direita por padrão");
    eq(cfg.tab_icon_size, 32, "ícone de aba 32px");
    eq(cfg.keep_alive, false, "keep_alive desligado");
    eq(cfg.tabs.length, 2, "duas abas (luzes + brilho)");
    const grade = cfg.tabs[0].cards[0];
    eq(grade.type, "grid", "a aba de luzes é uma grade");
    eq(grade.columns, 3, "3 colunas");
    eq(grade.square, true, "botões quadrados");
    eq(grade.cards.length, 6, "6 luzes na área (5 + a do dispositivo)");
    ok(!grade.cards.some((c) => c.entity === "light.oculta"), "luz escondida pelo registro virou botão");
    ok(!grade.cards.some((c) => c.entity === "light.sala"), "luz de outra área entrou na grade");
    const mesa = grade.cards.find((c) => c.entity === "light.mesa");
    eq(mesa.type, "custom:simple-button-card", "tipo do botão");
    eq(mesa.icon_on, "mdi:desk-lamp", "palpite de ícone da mesa");
    eq(mesa.hide_label, true, "botão sem label por padrão");
    eq(mesa.confirm, true, "confirmação ligada por padrão");
    eq(mesa.confirm_3d, true, "balão 3D ligado por padrão");
    const led = grade.cards.find((c) => c.entity === "light.led_da_mesa");
    eq(led.icon_on, "mdi:led-strip-variant", "palpite de ícone do LED");
    const pilha = cfg.tabs[1].cards[0];
    eq(pilha.columns, 1, "brilho em coluna única");
    eq(pilha.cards[0].type, "conditional", "brilho só com a luz acesa");
    const mush = pilha.cards[0].card;
    eq(mush.type, "custom:mushroom-light-card", "card de brilho");
    eq(mush.use_light_color, true, "cor da própria luz");
    ok(mush.card_mod && /backdrop-filter/.test(mush.card_mod.style), "vidro do card_mod");
  }

  // ordem, exclusão e override por luz
  const c2 = mk({
    area: "Escritório",                       // pelo NOME, não pelo id
    columns: 2,
    brightness_tab: false,
    lights: [
      { entity: "light.estantes", name: "ESTANTES", icon_on: "mdi:bookshelf" },
      { entity: "light.mesa" },
      { entity: "light.coluninhas", hidden: true },
    ],
    auto_add: false,
  });
  await tick(); await tick(); await tick();
  const cfg2 = c2._child && c2._child._cfg;
  ok(!!cfg2, "área pelo nome não resolveu");
  if (cfg2) {
    eq(cfg2.tabs.length, 1, "sem aba de brilho quando desligada");
    const g = cfg2.tabs[0].cards[0];
    eq(g.columns, 2, "colunas do YAML");
    eq(g.cards.map((c) => c.entity), ["light.estantes", "light.mesa"], "ordem do YAML e luz excluída");
    eq(g.cards[0].name, "ESTANTES", "nome do YAML");
  }

  // yaml_override faz merge por cima do gerado
  const c3 = mk({ area: "escritorio", yaml_override: { shell_color: "#123456", tab_display: "both" } });
  await tick(); await tick(); await tick();
  const cfg3 = c3._child && c3._child._cfg;
  if (cfg3) {
    eq(cfg3.shell_color, "#123456", "override da casca");
    eq(cfg3.tab_display, "both", "override do modo da aba");
    eq(cfg3.tabs.length, 2, "override não derruba as abas geradas");
  }

  // área sem luz: aviso honesto, nunca grade vazia
  const c4 = mk({ area: "inexistente" });
  await tick(); await tick();
  ok(!c4._child, "área sem luz não pode montar card");
  ok(/Nenhuma luz|Escolha a/.test(String(c4._host.innerHTML)), "faltou o aviso da área sem luz");

  // aba BRILHO some quando tudo apaga (hide_tab_when_off, ligado por padrão)
  const offStates = (onIds) => Object.fromEntries(
    Object.entries(HASS.states).map(([k, v]) => [k, { ...v, state: onIds.includes(k) ? "on" : "off" }]));
  const mkHass = (onIds) => ({ areas: HASS.areas, devices: HASS.devices, entities: HASS.entities,
    states: offStates(onIds), callService() {} });
  const mnt = (config, hassObj) => {
    const el = new (customElements.get("mw-tab-lights-card"))();
    el.isConnected = true;
    el.setConfig(config);
    el.hass = hassObj;
    return el;
  };
  const cOff = mnt({ area: "escritorio" }, mkHass([]));
  await tick(); await tick(); await tick();
  const cfgOff = cOff._child && cOff._child._cfg;
  ok(!!cfgOff, "montou com tudo apagado");
  if (cfgOff) {
    eq(cfgOff.tabs.length, 1, "tudo apagado: só a aba LUZES");
    eq(cfgOff.tabs[0].label, "LUZES", "a aba que sobra é a de luzes");
  }

  // opt-out: a aba continua mesmo apagada
  const cKeep = mnt({ area: "escritorio", brightness_options: { hide_tab_when_off: false } }, mkHass([]));
  await tick(); await tick(); await tick();
  const cfgKeep = cKeep._child && cKeep._child._cfg;
  if (cfgKeep) eq(cfgKeep.tabs.length, 2, "opt-out mantém BRILHO mesmo apagada");

  // transição na mesma instância: acende → 2 abas; apaga tudo → 1; acende → 2
  const H = mkHass(["light.mesa"]);
  const cT = mnt({ area: "escritorio" }, H);
  await tick(); await tick(); await tick();
  let cfgT = cT._child && cT._child._cfg;
  if (cfgT) eq(cfgT.tabs.length, 2, "transição: começa com BRILHO (mesa acesa)");
  H.states["light.mesa"] = { ...H.states["light.mesa"], state: "off" };
  cT.hass = H;
  await tick(); await tick(); await tick();
  cfgT = cT._child && cT._child._cfg;
  if (cfgT) eq(cfgT.tabs.length, 1, "transição: apagou tudo, BRILHO sumiu");
  H.states["light.abajur"] = { ...H.states["light.abajur"], state: "on" };
  cT.hass = H;
  await tick(); await tick(); await tick();
  cfgT = cT._child && cT._child._cfg;
  if (cfgT) {
    eq(cfgT.tabs.length, 2, "transição: acendeu, BRILHO voltou");
    const names = cfgT.tabs.map((t) => t.label);
    eq(names, ["LUZES", "BRILHO"], "ordem das abas preservada");
  }

  // editor: monta sem hass e sem os elementos internos do HA
  const ed = new (customElements.get("mw-tab-lights-card-editor"))();
  let erro = null;
  try { ed.setConfig({ area: "escritorio" }); } catch (e) { erro = e; }
  ok(!erro, `editor quebrou sem hass: ${erro && erro.message}`);
  erro = null;
  try { ed.hass = HASS; } catch (e) { erro = e; }
  ok(!erro, `editor quebrou com hass: ${erro && erro.message}`);

  // default intacto não polui o YAML
  const emitido = [];
  ed.addEventListener("config-changed", (ev) => emitido.push(ev.detail.config));
  ed._patch({ columns: 3, paper_color: "orange-7" });
  const last = emitido[emitido.length - 1] || {};
  ok(!("columns" in last), "columns igual ao default foi escrito no YAML");
  ok(!("paper_color" in last), "paper_color igual ao default foi escrito no YAML");

  /* --------- excluir de verdade (✕ → `exclude:`) ---------
     O ✕ antigo só tirava da fila e, com auto_add, a luz voltava na
     redescoberta seguinte — apagar era impossível. Agora a luz sai do YAML
     E vai para `exclude:`; «+ luz de outra área» a traz de volta. */
  const edDel = new (customElements.get("mw-tab-lights-card-editor"))();
  edDel.setConfig({ area: "escritorio" });
  edDel.hass = HASS;
  await tick();
  const excluido = [];
  edDel.addEventListener("config-changed", (ev) => excluido.push(ev.detail.config));
  const iMesa = (edDel._vis || []).map((l) => l.entity).indexOf("light.mesa");
  ok(iMesa >= 0, "luz de teste não está na fila do editor");
  edDel._lightAction("del", iMesa);
  const cDel = excluido[excluido.length - 1] || {};
  ok(!(cDel.lights || []).some((l) => l.entity === "light.mesa"),
    "luz apagada não pode continuar no YAML");
  ok((cDel.exclude || []).includes("light.mesa"),
    "luz apagada precisa persistir em `exclude:`");
  ok(!((edDel._vis || []).some((l) => l.entity === "light.mesa")),
    "luz excluída NÃO pode voltar a aparecer na fila (era o bug do ✕)");
  const cSemMesa = mnt(cDel, mkHass([]));
  await tick(); await tick(); await tick();
  const cfgSemMesa = cSemMesa._child && cSemMesa._child._cfg;
  if (cfgSemMesa) {
    const grade2 = cfgSemMesa.tabs[0].cards[0];
    ok(!grade2.cards.some((c) => c.entity === "light.mesa"),
      "com o YAML salvo, a luz excluída não volta na grade");
  }

  /* marcar ☐ numa luz descoberta materializa SÓ ela, não a fila inteira —
     era o que enchia o YAML de `hidden: true` de toda a área */
  const edT = new (customElements.get("mw-tab-lights-card-editor"))();
  edT.setConfig({ area: "escritorio" });
  edT.hass = HASS;
  await tick();
  const materia = [];
  edT.addEventListener("config-changed", (ev) => materia.push(ev.detail.config));
  const iLed = (edT._vis || []).map((l) => l.entity).indexOf("light.led_da_mesa");
  edT._lightAction("vis", iLed);
  const cMat = materia[materia.length - 1] || {};
  eq((cMat.lights || []).map((l) => l.entity), ["light.led_da_mesa"],
    "só a luz tocada pode materializar no YAML");
  eq((cMat.lights || [])[0] && (cMat.lights || [])[0].hidden, true,
    "e ela entra oculta");
  ok(!("header" in cMat) && !("tabs_yaml" in cMat),
    "salvo de materialização não pode trazer chave fora da casa");

  /* «redescobrir» materializa a fila VISÍVEL: luz excluída não renasce */
  const edRe = new (customElements.get("mw-tab-lights-card-editor"))();
  edRe.setConfig({ area: "escritorio", exclude: ["light.coluninhas"] });
  edRe.hass = HASS;
  await tick();
  const recfg = [];
  edRe.addEventListener("config-changed", (ev) => recfg.push(ev.detail.config));
  edRe._lightAction("re");
  const cRe = recfg[recfg.length - 1] || {};
  ok((cRe.lights || []).some((l) => l.entity === "light.mesa"),
    "redescobrir materializa a fila");
  ok(!(cRe.lights || []).some((l) => l.entity === "light.coluninhas"),
    "excluída continua fora MESMO redescobrindo");
  ok((cRe.exclude || []).includes("light.coluninhas"),
    "a exclusão sobrevive ao redescobrir");

  /* lixo de colagem/versão antiga morre no salvo (header do stub, etc.) */
  const edLixo = new (customElements.get("mw-tab-lights-card-editor"))();
  edLixo.setConfig({ header: "UPDATE PAYMENT METHOD", area: "escritorio", codfish: 1 });
  edLixo.hass = HASS;
  await tick();
  const lixado = [];
  edLixo.addEventListener("config-changed", (ev) => lixado.push(ev.detail.config));
  edLixo._patch({ columns: 2 });
  const cLixo = lixado[lixado.length - 1] || {};
  ok(!("header" in cLixo) && !("codfish" in cLixo),
    "lixo de versão antiga/colagem não pode sobreviver ao salvo");
  ok(cLixo.area === "escritorio" && cLixo.columns === 2,
    "o que era da casa continua");
  /* chamada de volta: `_desexcluir` tira do exclude (a luz volta na fila) */
  edLixo._emit({ ...edLixo._config, exclude: ["light.mesa"] });
  edLixo.setConfig(edLixo._config);           // eco que o HA devolve após o emit
  eq((edLixo._vis || []).map((l) => l.entity).indexOf("light.mesa"), -1,
    "light excluída não deve aparecer na fila");
  edLixo._desexcluir("light.mesa");
  ok(!((edLixo._config.exclude || []).includes("light.mesa")),
    "desexcluir tira a luz da exclusão");
  edLixo.setConfig(edLixo._config);           // eco que o HA devolve após o emit
  ok((edLixo._vis || []).some((l) => l.entity === "light.mesa"),
    "luz chamada de volta aparece de novo na fila");

  // banner de versão no formato que o CI procura
  ok(infoBanner.some((l) => /MW-TAB-LIGHTS-CARD/.test(l)), "banner de versão ausente");

  // checkbox da lista (☐/☑): classe dedicada + alvo de toque 44px
  const rowsHtml = (ed._lightsEl && ed._lightsEl.innerHTML) || "";
  ok(/mtl-ib vis/.test(rowsHtml), "botão vis sem classe dedicada");
  ok(/\.mtl-ib\.vis\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/.test(SRC_TXT),
    "sem regra de toque 44px para o vis");

  if (fails.length) {
    console.error(`\n✗ probe: ${fails.length} falha(s), ${pass} ok\n`);
    for (const f of fails) console.error("  · " + f);
    process.exit(1);
  }
  console.log(`✓ probe mw-tab-lights-card: ${pass} verificações passaram`);
})();
