'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/*
 * NestEgg: Offline-Buchhaltung für Einzelunternehmer und kleine Vereine.
 * Copyright (C) 2026 Riccardo D'Arcangelo
 *
 * Dieses Programm ist freie Software: Sie können es weitergeben und/oder
 * verändern unter den Bedingungen der GNU General Public License, wie von
 * der Free Software Foundation veröffentlicht, entweder in Version 3 der
 * Lizenz oder einer späteren Version.
 *
 * Die Veröffentlichung erfolgt in der Hoffnung, dass sie nützlich ist, aber
 * OHNE JEDE GEWÄHRLEISTUNG, sogar ohne die stillschweigende Zusicherung der
 * MARKTREIFE oder EIGNUNG FÜR EINEN BESTIMMTEN ZWECK. Einzelheiten stehen in
 * der GNU General Public License.
 *
 * Eine Kopie der Lizenz liegt diesem Programm bei (LICENSE), sonst unter
 * <https://www.gnu.org/licenses/>.
 */

/**
 * Zusammenhalt der Oberfläche: Zustand laden, Navigation, Jahreswechsel.
 *
 * Jede Ansicht ist eine Funktion, die einen Knoten zurückgibt. Nach jeder
 * Änderung wird neu gerendert. Bei dieser Datenmenge ist das schnell genug
 * und erspart jede Art von Zustandsabgleich.
 */

const App = (() => {
  const { h, clear, toast, unwrap } = UI;

  const NAV = [
    { id: 'dashboard', label: 'Übersicht', icon: '◆', section: null },
    { id: 'entries', label: 'Buchungen', icon: '≡', section: 'Erfassen' },
    { id: 'offers', label: 'Angebote', icon: '◈', section: null },
    { id: 'invoices', label: 'Rechnungen', icon: '▤', section: null },
    { id: 'customers', label: 'Kunden', icon: '◇', section: null },
    { id: 'projects', label: 'Projekte', icon: '◱', section: null },
    { id: 'time', label: 'Zeiten', icon: '◴', section: null },
    { id: 'recurring', label: 'Wiederkehrendes', icon: '↻', section: null },
    { id: 'bank', label: 'Kontoauszug', icon: '⇄', section: null },
    { id: 'assets', label: 'Anlagen', icon: '▣', section: null },
    { id: 'analytics', label: 'Auswertung', icon: '◔', section: 'Auswerten' },
    // Ein Verein rechnet in Sphären, ein Einzelunternehmen in einer EÜR. Beides
    // nebeneinander anzuzeigen wäre nur verwirrend, deshalb die Weiche.
    { id: 'euer', label: 'EÜR', icon: '∑', section: null, entity: 'business' },
    { id: 'spheres', label: 'Sphären', icon: '◫', section: null, entity: 'club' },
    { id: 'members', label: 'Mitglieder', icon: '◍', section: null, entity: 'club' },
    { id: 'donations', label: 'Zuwendungen', icon: '♡', section: null, entity: 'club' },
    { id: 'reserves', label: 'Rücklagen', icon: '▦', section: null, entity: 'club' },
    { id: 'vat', label: 'Umsatzsteuer', icon: '%', section: null },
    { id: 'forecast', label: 'Rücklage', icon: '◇', section: null, entity: 'business' },
    { id: 'deadlines', label: 'Fristen', icon: '◷', section: null },
    { id: 'design', label: 'Aussehen', icon: '◐', section: 'Verwalten' },
    { id: 'settings', label: 'Einstellungen', icon: '⚙', section: null }
  ];

  const state = {
    boot: null,
    data: null,
    year: new Date().getFullYear(),
    view: 'dashboard',
    filters: {}
  };

  async function start() {
    const boot = unwrap(await window.kontor.bootstrap(), 'Start fehlgeschlagen');
    if (!boot) return;
    state.boot = boot;
    state.year = boot.settings.ui.lastYear || new Date().getFullYear();

    await reload();

    // Ohne Firmenangaben kann keine Rechnung entstehen. Also gleich dorthin.
    if (!boot.settings.company.name) {
      state.view = 'settings';
      toast('Willkommen. Trage zuerst deine Firmendaten ein, dann funktioniert alles Weitere.');
    }
    render();
  }

  async function reload() {
    const data = unwrap(await window.kontor.snapshot(), 'Daten konnten nicht geladen werden');
    if (data) state.data = data;
    return state.data;
  }

  /** Neu laden und neu zeichnen. Der Weg nach jeder Änderung. */
  async function refresh() {
    await reload();
    render();
  }

  /**
   * Alles von vorn: Stammdaten und Daten.
   *
   * Nötig nach einem Profilwechsel, denn dann stimmt nichts mehr von dem, was
   * beim Start geladen wurde: andere Firmendaten, andere Kategorien, andere
   * Nummernkreise. In der App lädt das Fenster ohnehin neu, in der Vorschau
   * nicht, und hier greift beides.
   */
  async function reboot() {
    const boot = unwrap(await window.kontor.bootstrap(), 'Neu laden fehlgeschlagen');
    if (boot) state.boot = boot;
    state.filters = {};
    // Ansichtszustände gehören zum alten Bestand und sind jetzt gegenstandslos.
    for (const key of Object.keys(state)) {
      if (!['boot', 'data', 'year', 'view', 'filters'].includes(key)) delete state[key];
    }
    await refresh();
  }

  function navigate(view) {
    state.view = view;
    render();
  }

  async function setYear(year) {
    state.year = Number(year);
    await window.kontor.settings.update({ ui: { lastYear: state.year } });
    render();
  }

  /** Alle Jahre, in denen etwas passiert ist, plus das laufende. */
  function knownYears() {
    const years = new Set([new Date().getFullYear(), state.year]);
    for (const entry of state.data.entries) {
      if (entry.paidDate) years.add(Number(entry.paidDate.slice(0, 4)));
      if (entry.date) years.add(Number(entry.date.slice(0, 4)));
    }
    for (const invoice of state.data.invoices) {
      if (invoice.issueDate) years.add(Number(invoice.issueDate.slice(0, 4)));
    }
    return [...years].filter(Boolean).sort((a, b) => b - a);
  }

  function renderNav() {
    const nav = clear(document.getElementById('nav'));
    const ofYear = (doc) => String(doc.issueDate).slice(0, 4) === String(state.year);
    const groupOf = (doc) => {
      const type = state.boot.documentTypes[doc.documentType || 'invoice'];
      return type ? type.group : 'invoice';
    };

    const counts = {
      entries: state.data.entries.filter((e) => {
        const y = e.paidDate ? e.paidDate.slice(0, 4) : e.date.slice(0, 4);
        return Number(y) === state.year;
      }).length,
      invoices: state.data.invoices.filter((i) => ofYear(i) && groupOf(i) === 'invoice').length,
      offers: state.data.invoices.filter((i) => ofYear(i) && groupOf(i) === 'offer').length,
      customers: state.data.customers.length,
      projects: state.data.projects.filter((p) => ['planned', 'active'].includes(p.status)).length,
      recurring: state.data.recurrences.filter((r) => r.active).length,
      assets: state.data.assets.length
    };

    const entity = (state.boot.entity && state.boot.entity.kind) || 'business';

    for (const item of NAV) {
      if (item.entity && item.entity !== entity) continue;
      if (item.section) nav.appendChild(h('div', { class: 'nav-section' }, item.section));
      nav.appendChild(
        h('button', {
          class: `nav-item ${state.view === item.id ? 'active' : ''}`.trim(),
          onClick: () => navigate(item.id)
        }, [
          h('span', { class: 'icon' }, item.icon),
          h('span', item.label),
          counts[item.id] ? h('span', { class: 'badge' }, String(counts[item.id])) : null
        ])
      );
    }

    const years = knownYears();
    document.getElementById('brand-year').textContent = '';
    const foot = clear(document.getElementById('sidebar-foot'));
    foot.appendChild(
      UI.field('Wirtschaftsjahr', UI.select(
        years.map((y) => ({ value: y, label: String(y) })),
        state.year,
        { onChange: (e) => setYear(e.target.value) }
      ))
    );
    foot.appendChild(h('div', { class: 'small faint' }, `Version ${state.boot.version}`));
  }

  function render() {
    if (!state.data) return;
    renderNav();
    window.Profiles.renderSwitch(api, document.getElementById('profile-switch'));
    const main = clear(document.getElementById('main'));
    const view = window.Views[state.view];
    if (!view) {
      main.appendChild(UI.empty('Diese Ansicht gibt es nicht.'));
      return;
    }
    main.appendChild(view(api));
    main.scrollTop = 0;
  }

  function pageHead(title, subtitle, actions) {
    return h('div', { class: 'page-head' }, [
      h('div', [
        h('h1', { class: 'page-title' }, title),
        subtitle ? h('p', { class: 'page-sub' }, subtitle) : null
      ]),
      actions ? h('div', { class: 'page-actions' }, actions) : null
    ]);
  }

  /** Was die Ansichten bekommen. */
  const api = {
    get state() { return state; },
    get data() { return state.data; },
    get boot() { return state.boot; },
    get settings() { return state.data.settings; },
    /**
     * Der Zustand der Verschlüsselung.
     *
     * Kommt aus dem Start und lässt sich zwischendurch setzen, wenn sich
     * etwas geändert hat, ohne dass gleich alles neu geladen werden muss.
     */
    get security() { return (state.boot && state.boot.security) || {}; },
    set security(value) { if (state.boot) state.boot.security = value; },
    get year() { return state.year; },
    refresh,
    reboot,
    navigate,
    setYear,
    pageHead,
    render,
    categoryLabel(id) {
      const all = [...state.boot.categories.income, ...state.boot.categories.expense];
      const found = all.find((c) => c.id === id);
      return found ? found.label : id;
    },
    customer(id) {
      return state.data.customers.find((c) => c.id === id) || null;
    },
    customerName(id) {
      const c = api.customer(id);
      return c ? c.name : '';
    },
    receipt(id) {
      return state.data.receipts.find((r) => r.id === id) || null;
    },
    paymentLabel(id) {
      const found = state.boot.paymentMethods.find((p) => p.id === id);
      return found ? found.label : id;
    }
  };

  return { start, render, refresh, navigate, api, get state() { return state; } };
})();

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.start());
