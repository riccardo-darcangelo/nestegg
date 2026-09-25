'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/**
 * Ersetzt die Electron-Brücke für die Browser-Vorschau.
 *
 * Die Antworten stammen aus tools/fixture.json und wurden mit denselben Modulen
 * gerechnet, die auch in der App laufen. Schreibende Aufrufe verändern nur den
 * Zustand im Speicher, damit sich die Oberfläche trotzdem bedienen lässt.
 */

(function mockBridge() {
  const ok = (data) => Promise.resolve({ ok: true, data });
  const fail = (error) => Promise.resolve({ ok: false, error });

  let fixture = null;
  let nextId = 1000;

  const ready = fetch('fixture.json')
    .then((r) => r.json())
    .then((json) => {
      fixture = json;
      // Der Ausgangszustand, um nach einem Profilwechsel zurückzufinden.
      fixture.businessBoot = clone(fixture.boot);
      fixture.businessData = clone(fixture.data);
    });

  const after = (fn) => ready.then(fn);

  const post = (url, payload) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then((r) => r.json());
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function notInPreview(what) {
    return () => {
      alert(`${what} braucht die echte App. In der Vorschau ist nur die Oberfläche zu sehen.`);
      return fail(`${what} ist in der Vorschau nicht verfügbar.`);
    };
  }

  window.kontor = {
    bootstrap: () => after(() => ok(clone(fixture.boot))),
    snapshot: () => after(() => ok(clone(fixture.data))),

    entries: {
      preview: (entry) => after(() => {
        // Grobe Nachbildung der Aufteilung, nur für die Anzeige in der Vorschau.
        const rate = Number(entry.vatRate) || 0;
        const raw = String(entry.amount || '0').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
        const gross = Math.round((Number.parseFloat(raw) || 0) * 100);
        const net = rate ? Math.round(gross / (1 + rate / 100)) : gross;
        return ok({
          entry: { ...entry, gross, net, vat: gross - net },
          effect: { businessNet: net, euerAmount: net, inputVat: gross - net, outputVat: gross - net },
          errors: [],
          warnings: entry.paidDate ? [] : ['Ohne Zahlungsdatum gilt die Buchung als offen.']
        });
      }),
      save: (entry) => after(() => {
        const record = { ...entry, id: entry.id || `buch_${nextId++}` };
        const list = fixture.data.entries;
        const index = list.findIndex((e) => e.id === record.id);
        if (index === -1) list.push(record); else list[index] = record;
        return ok(record);
      }),
      remove: (id) => after(() => {
        fixture.data.entries = fixture.data.entries.filter((e) => e.id !== id);
        return ok(true);
      })
    },

    invoices: {
      save: (invoice) => after(() => ok({ ...invoice, id: invoice.id || `re_${nextId++}` })),
      remove: () => ok(true),
      finalize: (id) => after(() => ok(fixture.data.invoices.find((i) => i.id === id))),
      validate: () => ok({ errors: [], warnings: [], totals: {} }),
      duplicate: () => ok({}),
      addPayment: () => ok({}),
      bookPayment: () => ok({}),
      pdf: notInPreview('Der PDF-Export'),
      xml: notInPreview('Der XML-Export')
    },

    customers: {
      save: (customer) => after(() => {
        const record = { ...customer, id: customer.id || `kd_${nextId++}` };
        const list = fixture.data.customers;
        const index = list.findIndex((c) => c.id === record.id);
        if (index === -1) list.push(record); else list[index] = record;
        return ok(record);
      }),
      remove: (id) => after(() => {
        fixture.data.customers = fixture.data.customers.filter((c) => c.id !== id);
        return ok(true);
      })
    },

    dunning: {
      overdue: () => after(() => ok(clone(fixture.dunningOverdue))),
      prepare: (payload) => after(() => {
        // Die Vorschau rechnet nicht neu, sie zeigt den vorbereiteten Stand.
        const base = clone(fixture.dunningPrepared);
        if (payload && payload.deadline) base.deadline = payload.deadline;
        if (payload && payload.level) {
          const level = base.levels.find((l) => l.level === Number(payload.level)) || base.levels[0];
          base.level = level.level;
          base.levelLabel = level.label;
          base.bodyText = level.tone.replace('{DEADLINE}', base.deadline.split('-').reverse().join('.'));
        }
        return ok(base);
      }),
      create: notInPreview('Das Anlegen einer Mahnung'),
      removeLast: notInPreview('Das Zurücknehmen'),
      pdf: notInPreview('Der Mahnungsdruck')
    },

    deadlines: {
      list: () => after(() => ok(clone(fixture.deadlines)))
    },

    travel: {
      preview: (trip) => after(() => ok(clone(fixture.travel))),
      book: notInPreview('Das Buchen einer Reise')
    },

    times: {
      overview: () => after(() => ok(clone(fixture.times))),
      save: (entry) => after(() => {
        const record = { ...entry, id: entry.id || `zeit_${nextId++}` };
        const list = fixture.data.times;
        const index = list.findIndex((t) => t.id === record.id);
        if (index === -1) list.push(record); else list[index] = { ...list[index], ...record };
        return ok(record);
      }),
      remove: (id) => after(() => {
        fixture.data.times = fixture.data.times.filter((t) => t.id !== id);
        return ok(true);
      }),
      start: (payload) => after(() => {
        const record = { ...payload, id: `zeit_${nextId++}`, minutes: 0, startedAt: new Date().toISOString(), billable: true, rateCents: 9000 };
        fixture.data.times.push(record);
        fixture.times.running = record;
        return ok(record);
      }),
      stop: (id) => after(() => {
        const record = fixture.data.times.find((t) => t.id === id);
        if (record) {
          record.minutes = 30;
          record.startedAt = null;
          record.date = fixture.boot.today;
        }
        fixture.times.running = null;
        return ok(record || {});
      }),
      toInvoice: notInPreview('Das Abrechnen von Zeiten')
    },

    datev: {
      // Im Vereinsprofil die Vereinszuordnung, sonst die des Unternehmens.
      preview: () => after(() => ok(clone(
        fixture.boot.entity && fixture.boot.entity.kind === 'club' ? fixture.club.datev : fixture.datev
      ))),
      export: notInPreview('Der DATEV-Export'),
      saveAccounts: (payload) => after(() => ok(payload))
    },

    gobd: {
      documentation: notInPreview('Die Verfahrensdokumentation'),
      dataExport: notInPreview('Die Datenüberlassung')
    },

    einvoice: {
      choose: () => after(() => ok(clone(fixture.eInvoice))),
      commit: notInPreview('Das Buchen einer empfangenen E-Rechnung')
    },

    spheres: {
      review: () => after(() => ok(clone(fixture.club.spheres)))
    },

    claims: {
      overview: () => after(() => ok(clone(fixture.club.claims))),
      save: (claim) => after(() => ok({ ...claim, id: claim.id || 'anp_' + nextId++, amount: claim.amount || 0 })),
      remove: notInPreview('Das Löschen eines Anspruchs'),
      waive: notInPreview('Das Buchen eines Verzichts')
    },

    sepa: {
      /**
       * Der Einzugstag lässt sich in der Vorschau wirklich verschieben: die
       * Mandatsprüfung hängt daran, und genau das soll sich ansehen lassen.
       */
      plan: ({ collectionDate } = {}) => after(() => {
        const base = clone(fixture.club.sepa);
        if (!collectionDate) return ok(base);

        for (const group of base.collections) {
          group.plannedDate = collectionDate;
          for (const row of group.rows) {
            row.dueDate = collectionDate;
            const spaet = row.mandateDate && row.mandateDate > collectionDate;
            row.problems = row.problems.filter((p) => !/später unterschrieben/.test(p));
            if (spaet) row.problems.push('Das Mandat ist später unterschrieben als der Einzug fällig wird.');
            row.ready = row.problems.length === 0;
          }
          const offen = group.rows.filter((row) => row.ready && !row.exported);
          group.count = offen.length;
          group.total = offen.reduce((sum, row) => sum + row.amount, 0);
          group.blocked = group.rows.filter((row) => !row.ready).length;
        }
        return ok(base);
      }),
      export: notInPreview('Das Erzeugen der SEPA-Lastschriftdatei'),
      saveSettings: (payload) => after(() => ok(payload))
    },

    members: {
      overview: () => after(() => ok(clone(fixture.club.members))),
      duesPlan: () => after(() => ok(clone(fixture.club.duesPlan))),
      preNotification: () => after(() => ok(clone(fixture.club.preNotification))),
      preNotificationPdf: notInPreview('Der Serienbrief zur Vorabankündigung'),
      save: notInPreview('Das Speichern eines Mitglieds'),
      remove: notInPreview('Das Löschen eines Mitglieds'),
      runDues: notInPreview('Der Beitragslauf'),
      saveTiers: (payload) => after(() => ok(payload))
    },

    reserves: {
      overview: () => after(() => ok(clone(fixture.club.reserves))),
      save: notInPreview('Das Anlegen einer Rücklage'),
      remove: notInPreview('Das Löschen einer Rücklage'),
      move: notInPreview('Zuführung und Auflösung'),
      document: notInPreview('Die Vermögensübersicht')
    },

    donations: {
      overview: () => after(() => ok(clone(fixture.club.donations))),
      issued: () => after(() => ok(clone(fixture.club.issued))),
      prepare: ({ entryIds }) => after(() => {
        const base = clone(fixture.club.prepared);
        if (!base) return fail('Keine Zuwendung vorbereitet.');
        // Grob nachgebildet: die Auswahl ändert Summe und Anzahl.
        base.entries = base.entries.filter((entry) => (entryIds || []).includes(entry.id));
        base.total = base.entries.reduce((sum, entry) => sum + entry.amount, 0);
        base.collective = base.entries.length > 1;
        return ok(base);
      }),
      create: notInPreview('Das Ausstellen einer Zuwendungsbestätigung')
    },

    profiles: {
      list: () => after(() => ok(clone(fixture.boot.profiles))),
      /**
       * Der Profilwechsel schaltet in der Vorschau wirklich um: das zweite
       * Profil ist ein gemeinnütziger Verein mit eigenen Kategorien, eigenen
       * Buchungen und eigener Navigation.
       */
      switch: (id) => after(() => {
        for (const profile of fixture.boot.profiles.profiles) profile.active = profile.id === id;
        fixture.boot.profiles.activeProfileId = id;

        const club = fixture.boot.profiles.profiles.find((p) => p.id === id && /verein/i.test(p.name));
        if (club) {
          Object.assign(fixture.boot, fixture.club.boot);
          fixture.data = fixture.club.data;
        } else if (fixture.businessBoot) {
          Object.assign(fixture.boot, fixture.businessBoot);
          fixture.data = fixture.businessData;
        }
        return ok(clone(fixture.boot.profiles));
      }),
      create: ({ name }) => after(() => {
        const id = `prf_${nextId++}`;
        for (const profile of fixture.boot.profiles.profiles) profile.active = false;
        fixture.boot.profiles.profiles.push({
          id, name, dir: `${fixture.boot.profiles.root}\\${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          active: true, exists: true, createdAt: new Date().toISOString()
        });
        fixture.boot.profiles.activeProfileId = id;
        return ok(clone(fixture.boot.profiles));
      }),
      rename: ({ id, name }) => after(() => {
        const profile = fixture.boot.profiles.profiles.find((p) => p.id === id);
        if (profile) profile.name = name;
        return ok(clone(fixture.boot.profiles));
      }),
      remove: (id) => after(() => {
        fixture.boot.profiles.profiles = fixture.boot.profiles.profiles.filter((p) => p.id !== id);
        const first = fixture.boot.profiles.profiles[0];
        if (first && !fixture.boot.profiles.profiles.some((p) => p.active)) {
          first.active = true;
          fixture.boot.profiles.activeProfileId = first.id;
        }
        return ok(clone(fixture.boot.profiles));
      }),
      open: notInPreview('Das Öffnen eines vorhandenen Profilordners')
    },

    bank: {
      // In der Vorschau gibt es keinen Dateidialog: der Auszug liegt fertig
      // eingelesen in den Beispieldaten und wird hier einfach ausgeliefert.
      choose: () => after(() => ok(clone(
        fixture.boot.entity && fixture.boot.entity.kind === 'club' ? fixture.club.bankStatement : fixture.bankStatement
      ))),
      commit: (payload) => after(() => {
        const rows = (payload && payload.rows) || [];
        return ok({
          entries: rows.filter((r) => r.action !== 'payment').length,
          payments: rows.filter((r) => r.action === 'payment').length,
          skipped: 0,
          rules: rows.filter((r) => r.draft && r.draft.rememberRule).length,
          problems: []
        });
      }),
      saveRules: (rules) => after(() => {
        fixture.data.settings.bankRules = rules;
        return ok(rules);
      })
    },

    recurring: {
      save: (template) => after(() => {
        const record = { ...template, id: template.id || `wdh_${nextId++}` };
        const list = fixture.data.recurrences;
        const index = list.findIndex((r) => r.id === record.id);
        if (index === -1) list.push(record); else list[index] = record;
        return ok(record);
      }),
      remove: (id) => after(() => {
        fixture.data.recurrences = fixture.data.recurrences.filter((r) => r.id !== id);
        return ok(true);
      }),
      due: () => after(() => ok(clone(fixture.recurringDue))),
      generate: notInPreview('Das Anlegen wiederkehrender Posten'),
      skip: notInPreview('Das Überspringen')
    },

    projects: {
      save: (project) => after(() => {
        const record = { ...project, id: project.id || `prj_${nextId++}` };
        const list = fixture.data.projects;
        const index = list.findIndex((p) => p.id === record.id);
        if (index === -1) list.push(record); else list[index] = record;
        return ok(record);
      }),
      remove: (id) => after(() => {
        fixture.data.projects = fixture.data.projects.filter((p) => p.id !== id);
        return ok(true);
      }),
      totals: (id) => after(() => ok(fixture.projectTotals[id] || null))
    },

    segments: {
      save: (list) => after(() => {
        fixture.data.settings.segments = list;
        fixture.boot.segments = list;
        return ok(list);
      })
    },

    assets: {
      save: (asset) => ok({ ...asset, id: asset.id || `anl_${nextId++}` }),
      remove: () => ok(true),
      schedule: (id) => after(() => ok(fixture.schedules[id] || []))
    },

    receipts: {
      attach: notInPreview('Das Anhängen von Belegen'),
      open: notInPreview('Das Öffnen von Belegen'),
      reveal: notInPreview('Das Anzeigen im Ordner'),
      verify: () => ok({ ok: true }),
      remove: () => ok(true)
    },

    reports: {
      euer: () => after(() => ok(clone(fixture.reports.euer))),
      dashboard: () => after(() => ok(clone({ ...fixture.reports.dashboard, recurringDue: fixture.recurringDue.count }))),
      analytics: () => after(() => ok(clone(fixture.analytics))),
      reserve: () => after(() => ok(clone(fixture.reserve))),
      liquidity: () => after(() => ok(clone(fixture.liquidity))),
      ecSales: ({ periodKey } = {}) => after(() => ok(clone({
        detail: periodKey
          ? fixture.ecSales.periods[periodKey] || Object.values(fixture.ecSales.periods)[0]
          : Object.values(fixture.ecSales.periods)[0],
        overview: fixture.ecSales.overview,
        mode: 'quarterly',
        needsMonthly: fixture.ecSales.needsMonthly
      }))),
      vatYear: () => after(() => ok(clone(fixture.reports.vatYear))),
      vat: ({ periodKey }) => after(() => {
        const found = fixture.reports.vatPeriods[periodKey]
          || Object.values(fixture.reports.vatPeriods)[0];
        return ok(clone(found));
      }),
      exportYear: notInPreview('Der Excel-Export'),
      exportCsv: notInPreview('Der CSV-Export'),
      thresholds: () => after(() => ok(clone(fixture.thresholds)))
    },

    // In der Vorschau liegt der Bestand offen: der Abschnitt zeigt dann seine
    // Warnung, und mehr als das Aussehen ist hier nicht zu prüfen.
    security: {
      state: () => after(() => ok({ encrypted: false })),
      strength: (wert) => after(() => ok(
        String(wert || '').length >= 12
          ? { level: 3, label: 'Stark' }
          : { level: 1, label: 'Zu kurz' }
      )),
      enable: notInPreview('Die Verschlüsselung'),
      disable: notInPreview('Das Aufheben der Verschlüsselung'),
      changePassword: notInPreview('Der Passwortwechsel'),
      newRecoveryKey: notInPreview('Ein neuer Wiederherstellungsschlüssel'),
      printRecoveryKey: notInPreview('Das Ausdrucken'),
      setRemember: notInPreview('Das Merken des Passworts')
    },

    settings: {
      update: (patch) => after(() => {
        fixture.data.settings = { ...fixture.data.settings, ...patch };
        fixture.boot.settings = fixture.data.settings;
        return ok(fixture.data.settings);
      }),
      chooseDataDir: notInPreview('Der Ordnerwechsel'),
      // Einen Dateidialog gibt es in der Vorschau nicht, einen gewählten Pfad
      // schon: nur so lässt sich prüfen, dass die Auswahl die daneben
      // eingetippten Felder stehen lässt.
      chooseLogo: () => after(() => ok('C:/Beispiel/logo.png')),
      chooseSignature: () => after(() => ok('C:/Beispiel/unterschrift.png')),
      openDataDir: notInPreview('Das Öffnen des Ordners'),
      backup: notInPreview('Die Sicherung')
    },

    offers: {
      setStatus: ({ id, status }) => after(() => {
        const doc = fixture.data.invoices.find((i) => i.id === id);
        if (doc) { doc.status = status; doc.resolvedStatus = status; }
        return ok(doc);
      }),
      convertToInvoice: notInPreview('Das Umwandeln in eine Rechnung')
    },

    // Die Vorschau rendert der Entwicklungsserver mit denselben Modulen wie
    // die App. Dadurch verhaelt sich der Gestaltungsdialog hier wie dort.
    theme: {
      preview: (payload) => post('/api/theme-preview', payload),
      applyPreset: (payload) => post('/api/theme-preset', payload),
      save: (theme) => after(() => {
        fixture.data.settings.theme = theme;
        fixture.boot.settings = fixture.data.settings;
        return ok(theme);
      }),
      reset: () => after(() => {
        fixture.data.settings.theme = { ...fixture.boot.defaultTheme };
        return ok(fixture.data.settings.theme);
      })
    },

    on: () => () => {}
  };
})();
