'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
/** Einstellungen: Firmendaten, Besteuerung, Rechnungsvorgaben, Datenordner. */
window.Views.settings = function settingsView(app) {
  const { h, fmt, panel, field, select, checkbox } = UI;

  const root = h('div');
  render();
  return root;

  async function save(patch, message) {
    const res = await window.kontor.settings.update(patch);
    if (!UI.unwrap(res, 'Speichern')) return;
    await app.refresh();
    if (message) UI.toast(message, 'success');
  }

  /**
   * A file picker with the chosen path beside it.
   *
   * The picker stores the path itself, so nothing here needs saving. What it
   * must not do is refresh: the panel keeps the typed values in a copy that
   * only the save button writes back, and re-rendering would drop every field
   * the user has filled in but not saved yet. So the two labels are swapped in
   * place.
   */
  function filePicker(pick, current, texts, onPicked) {
    const path = h('span', { class: 'small faint' }, current || texts.empty);
    const button = h('button', {
      class: 'btn small',
      onClick: async () => {
        const file = UI.unwrap(await pick(), texts.subject);
        if (!file) return;
        onPicked(file);
        path.textContent = file;
        button.textContent = texts.replace;
        UI.toast(texts.done, 'success');
      }
    }, current ? texts.replace : texts.choose);

    return [button, path];
  }

  function render() {
    UI.clear(root);
    const s = app.settings;

    root.appendChild(app.pageHead(
      'Einstellungen',
      'Diese Angaben landen auf jeder Rechnung und in jeder E-Rechnung. Ohne sie ist kein gültiges Dokument möglich.'
    ));

    /* ----------------------------------------------------- Firma */

    const company = { ...s.company };
    root.appendChild(panel('Firmendaten', h('div', [
      h('div', { class: 'grid grid-2' }, [
        field('Firmenname', UI.input({
          value: company.name, onInput: (e) => { company.name = e.target.value; }
        }), 'So, wie er auf der Rechnung stehen soll'),
        field('Inhaber', UI.input({
          value: company.owner, onInput: (e) => { company.owner = e.target.value; }
        }))
      ]),
      field('Straße und Hausnummer', UI.input({
        value: company.street, onInput: (e) => { company.street = e.target.value; }
      })),
      h('div', { class: 'grid grid-3' }, [
        field('PLZ', UI.input({ value: company.zip, onInput: (e) => { company.zip = e.target.value; } })),
        field('Ort', UI.input({ value: company.city, onInput: (e) => { company.city = e.target.value; } })),
        field('Land', UI.input({
          value: company.country, maxlength: '2',
          onInput: (e) => { company.country = e.target.value.toUpperCase(); }
        }))
      ]),
      h('div', { class: 'grid grid-3' }, [
        field('E-Mail', UI.input({ type: 'email', value: company.email, onInput: (e) => { company.email = e.target.value; } })),
        field('Telefon', UI.input({ type: 'tel', value: company.phone, onInput: (e) => { company.phone = e.target.value; } })),
        field('Website', UI.input({ value: company.website, onInput: (e) => { company.website = e.target.value; } }))
      ]),

      socialBlock(company),
      signatureSettings(company, s),
      qrBlock(company),

      h('div', { class: 'grid grid-2' }, [
        field('Steuernummer', UI.input({
          value: company.taxNumber, placeholder: '12/345/67890',
          onInput: (e) => { company.taxNumber = e.target.value; }
        }), 'Steuernummer oder USt-IdNr. ist Pflicht auf der Rechnung'),
        field('USt-IdNr.', UI.input({
          value: company.vatId, placeholder: 'DE123456789',
          onInput: (e) => { company.vatId = e.target.value.toUpperCase(); }
        }), 'Nötig für EU-Geschäfte und Reverse Charge')
      ]),
      h('div', { class: 'grid grid-4' }, [
        field('Bank', UI.input({ value: company.bankName, onInput: (e) => { company.bankName = e.target.value; } })),
        field('IBAN', UI.input({ value: company.iban, onInput: (e) => { company.iban = e.target.value; } })),
        field('BIC', UI.input({ value: company.bic, onInput: (e) => { company.bic = e.target.value; } })),
        field('Kontoinhaber', UI.input({
          value: company.accountHolder, placeholder: company.name,
          onInput: (e) => { company.accountHolder = e.target.value; }
        }))
      ]),
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, [
        ...filePicker(() => window.kontor.settings.chooseLogo(), company.logoPath, {
          subject: 'Logo',
          choose: 'Logo wählen',
          replace: 'Logo ersetzen',
          empty: 'Kein Logo hinterlegt',
          done: 'Logo gesetzt.'
        }, (file) => { company.logoPath = file; s.company.logoPath = file; }),
        h('div', { style: { flex: '1' } }),
        h('button', {
          class: 'btn primary',
          onClick: () => save({ company }, 'Firmendaten gespeichert.')
        }, 'Firmendaten speichern')
      ])
    ])));

    /* ----------------------------------------------------- Besteuerung */

    const tax = { ...s.tax };
    root.appendChild(panel('Besteuerung', h('div', [
      h('div', { class: 'grid grid-2' }, [
        field('Besteuerungsart', select([
          { value: 'ist', label: 'Ist-Versteuerung: Steuer entsteht mit Zahlungseingang' },
          { value: 'soll', label: 'Soll-Versteuerung: Steuer entsteht mit Rechnungsstellung' }
        ], tax.vatMethod, { onChange: (e) => { tax.vatMethod = e.target.value; } }),
          'Die Ist-Versteuerung nach §20 UStG muss das Finanzamt genehmigen'),
        field('Abgabezeitraum', select([
          { value: 'monthly', label: 'Monatlich' },
          { value: 'quarterly', label: 'Vierteljährlich' },
          { value: 'yearly', label: 'Nur Jahreserklärung' }
        ], tax.vatPeriod, { onChange: (e) => { tax.vatPeriod = e.target.value; } }))
      ]),
      h('div', { class: 'grid grid-2' }, [
        field('Vorsteuerabzug abgrenzen nach', select([
          { value: 'invoice', label: 'Rechnungsdatum' },
          { value: 'payment', label: 'Zahlungsdatum' }
        ], tax.inputVatBasis, { onChange: (e) => { tax.inputVatBasis = e.target.value; } }),
          'Auch bei Ist-Versteuerung hängt der Vorsteuerabzug an Leistung und Rechnung, nicht an der Zahlung'),
        field('Steuerliche Stellung', select([
          { value: 'regel', label: 'Regelbesteuert' },
          { value: 'klein', label: 'Kleinunternehmer nach §19 UStG' }
        ], tax.scheme, { onChange: (e) => { tax.scheme = e.target.value; } }))
      ]),
      h('div', { class: 'field-group-title' }, 'Nacherfassung früherer Jahre'),
      h('div', { class: 'grid grid-2' }, [
        field('Buchführung in dieser App ab', UI.input({
          type: 'number', class: 'num',
          value: tax.bookkeepingFrom ? String(tax.bookkeepingFrom) : '',
          placeholder: 'alle Jahre zählen voll',
          onInput: (e) => {
            const wert = Number(e.target.value);
            tax.bookkeepingFrom = wert >= 1990 && wert <= 2999 ? wert : null;
          }
        }), 'Frühere Jahre lassen sich nacherfassen, zählen aber nur für die Auswertung'),
        h('div', { class: 'field' }, [
          h('label', 'Was das bedeutet'),
          h('div', { class: 'help' }, [
            'Rechnungen aus einem früheren Jahr behalten beim Festschreiben ihre eigene Nummer, ',
            'der laufende Nummernkreis wird nicht weitergezählt. EÜR und Umsatzsteuer weisen ',
            'solche Jahre als nacherfasst aus, Fristen und Mahnwesen lassen sie ganz aus.'
          ].join(''))
        ])
      ]),

      checkbox('Dauerfristverlängerung: Abgabe einen Monat später', tax.dauerfristverlaengerung,
        (v) => { tax.dauerfristverlaengerung = v; }),
      h('div', { class: 'right' }, h('button', {
        class: 'btn primary',
        onClick: () => save({ tax }, 'Besteuerung gespeichert.')
      }, 'Besteuerung speichern'))
    ])));

    /* ----------------------------------------------------- Rechnungen */

    const invoice = JSON.parse(JSON.stringify(s.invoice));
    const eInvoice = { ...s.eInvoice };
    const texts = JSON.parse(JSON.stringify(s.texts));
    const yearKey = String(app.year);

    root.appendChild(panel('Dokumentvorgaben', h('div', [
      h('div', { class: 'grid grid-4' }, [
        field('Zahlungsziel in Tagen', UI.input({
          type: 'number', class: 'num', value: String(invoice.paymentTermsDays),
          onInput: (e) => { invoice.paymentTermsDays = Number(e.target.value) || 0; }
        })),
        field('Bindefrist Angebote', UI.input({
          type: 'number', class: 'num', value: String(invoice.quoteValidityDays || 30),
          onInput: (e) => { invoice.quoteValidityDays = Number(e.target.value) || 0; }
        }), 'Tage ab Angebotsdatum'),
        field('Toleranz Kostenvoranschlag', UI.input({
          type: 'number', class: 'num', value: String(invoice.estimateTolerance || 15),
          onInput: (e) => { invoice.estimateTolerance = Number(e.target.value) || 0; }
        }), 'Prozent zulässige Abweichung'),
        field('Steuersatz voreingestellt', select(
          [{ value: 19, label: '19 Prozent' }, { value: 7, label: '7 Prozent' }, { value: 0, label: '0 Prozent' }],
          invoice.defaultVatRate,
          { onChange: (e) => { invoice.defaultVatRate = Number(e.target.value); } }
        ))
      ]),
      field('Anrede', UI.input({
        value: invoice.salutation || '',
        placeholder: 'Sehr geehrte Damen und Herren,',
        onInput: (e) => { invoice.salutation = e.target.value; }
      }), 'Steht über der Einleitung. Leer lassen, wenn du ohne Anrede schreibst.'),

      h('h3', { class: 'panel-title', style: { margin: '18px 0 4px' } }, 'Nummernkreise'),
      h('div', { class: 'small faint', style: { marginBottom: '12px' } },
        'Jede Dokumentart zählt für sich. Platzhalter: {YYYY} Jahr, {YY} Jahr zweistellig, {MM} Monat, {####} laufende Nummer, {KK} Kundennummer. Die Zahl der Zeichen bestimmt die Breite: R-{YY}{MM}-{KK}{##} ergibt R-2609-0101.'),
      h('div', { class: 'grid grid-2' }, Object.entries(app.boot.documentTypes).map(([id, type]) =>
        field(type.plural, UI.input({
          value: invoice.numberPatterns[id] || type.defaultPattern,
          onInput: (e) => { invoice.numberPatterns[id] = e.target.value; }
        }), `Nächste Nummer ${app.year}: ${nextNumberPreview(invoice, id, yearKey, type)}`)
      )),

      field('Voreingestelltes E-Rechnungsformat', select([
        { value: 'zugferd', label: 'ZUGFeRD: PDF mit eingebettetem XML' },
        { value: 'pdf', label: 'PDF ohne XML' }
      ], eInvoice.defaultFormat, { onChange: (e) => { eInvoice.defaultFormat = e.target.value; } }),
        'Gilt nur für Rechnungen und Stornos. Angebote haben kein Rechnungs-XML.'),

      h('div', { class: 'right' }, h('button', {
        class: 'btn primary',
        onClick: () => save({ invoice, eInvoice }, 'Vorgaben gespeichert.')
      }, 'Vorgaben speichern'))
    ])));

    root.appendChild(panel('Textbausteine', h('div', [
      h('div', { class: 'small faint', style: { marginBottom: '14px' } },
        'Diese Texte stehen in jedem neuen Dokument der jeweiligen Art und lassen sich dort einzeln überschreiben.'),
      ...Object.entries(app.boot.documentTypes).map(([id, type]) => {
        if (!texts[id]) texts[id] = { intro: '', body: '', outro: '' };
        return h('details', { style: { marginBottom: '10px' } }, [
          h('summary', { class: 'small muted', style: { cursor: 'pointer', marginBottom: '10px' } }, type.plural),
          field('Einleitung', h('textarea', {
            value: texts[id].intro || '',
            onInput: (e) => { texts[id].intro = e.target.value; }
          })),
          field(type.group === 'offer' ? 'Hinweis zur Gültigkeit' : 'Zahlungshinweis', h('textarea', {
            value: texts[id].body || '',
            onInput: (e) => { texts[id].body = e.target.value; }
          }), placeholderHint(type)),
          field('Schlusstext', h('textarea', {
            value: texts[id].outro || '',
            onInput: (e) => { texts[id].outro = e.target.value; }
          }))
        ]);
      }),
      h('div', { style: { display: 'flex', gap: '8px' } }, [
        h('button', {
          class: 'btn ghost',
          onClick: () => save({ texts: JSON.parse(JSON.stringify(app.boot.defaultTexts)) }, 'Textbausteine zurückgesetzt.')
        }, 'Auf Standard zurücksetzen'),
        h('div', { style: { flex: '1' } }),
        h('button', {
          class: 'btn primary',
          onClick: () => save({ texts }, 'Textbausteine gespeichert.')
        }, 'Texte speichern')
      ])
    ])));

    /* ----------------------------------------------------- Daten */

    /* ----------------------------------------------------- Geschäftsbereiche */

    const segmentList = JSON.parse(JSON.stringify(app.boot.segments));
    const segmentBox = h('div');

    const renderSegments = () => {
      UI.clear(segmentBox);
      segmentBox.appendChild(h('div', { class: 'small faint', style: { marginBottom: '14px' } },
        'Nach außen bleibt alles ein Gewerbe und eine EÜR. Die Bereiche zeigen dir intern, welcher Teil des Geschäfts trägt und welcher nur beschäftigt.'));

      for (const [index, segment] of segmentList.entries()) {
        segmentBox.appendChild(h('div', { class: 'segment-row' }, [
          h('input', {
            type: 'color', class: 'color-input', value: segment.color,
            'aria-label': `Farbe des Bereichs ${index + 1}`,
            onInput: (e) => { segment.color = e.target.value; }
          }),
          UI.input({
            value: segment.label, placeholder: 'Name des Bereichs',
            onInput: (e) => { segment.label = e.target.value; }
          }),
          select(
            app.boot.segmentKinds.map((k) => ({ value: k.id, label: k.label })),
            segment.kind,
            {
              'aria-label': `Art des Bereichs ${index + 1}`,
              onChange: (e) => { segment.kind = e.target.value; }
            }
          ),
          UI.input({
            value: segment.note, placeholder: 'Notiz, optional',
            onInput: (e) => { segment.note = e.target.value; }
          }),
          h('button', {
            class: 'btn small ghost',
            title: segmentList.length > 1 ? 'Bereich entfernen' : 'Der letzte Bereich bleibt',
            disabled: segmentList.length <= 1,
            onClick: () => { segmentList.splice(index, 1); renderSegments(); }
          }, '✕')
        ]));
      }

      segmentBox.appendChild(h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } }, [
        h('button', {
          class: 'btn small ghost',
          onClick: () => {
            segmentList.push({ label: '', kind: 'other', color: '#8d99ab', note: '', active: true });
            renderSegments();
          }
        }, '+ Bereich'),
        h('div', { style: { flex: '1' } }),
        h('button', {
          class: 'btn primary',
          onClick: async () => {
            const saved = UI.unwrap(await window.kontor.segments.save(segmentList), 'Bereiche');
            if (!saved) return;
            UI.toast('Bereiche gespeichert.', 'success');
            app.navigate('settings');
            app.refresh();
          }
        }, 'Bereiche speichern')
      ]));
    };
    renderSegments();

    root.appendChild(panel('Geschäftsbereiche', segmentBox));

    /* ----------------------------------------------------- Mahnwesen */

    const dunning = { ...(s.dunning || {}) };
    const rates = () => [
      `${fmt.percent(Number(dunning.baseRate || 0) + Number(dunning.consumerSurcharge || 0))} gegenüber Verbrauchern`,
      `${fmt.percent(Number(dunning.baseRate || 0) + Number(dunning.businessSurcharge || 0))} im Geschäftsverkehr`
    ].join(', ');

    root.appendChild(panel('Mahnwesen', h('div', [
      UI.note([
        'Der Basiszinssatz wird von der Deutschen Bundesbank halbjährlich zum 1. Januar und 1. Juli festgesetzt. Das Programm kennt ihn nicht und erfindet ihn auch nicht: trage ihn hier ein und prüfe ihn zweimal im Jahr.',
        `Mit den aktuellen Angaben rechnet die Mahnung ${rates()}.`
      ]),
      h('div', { class: 'grid grid-2' }, [
        field('Basiszinssatz', UI.input({
          type: 'number', step: '0.01', class: 'num',
          value: String(dunning.baseRate ?? 0),
          onInput: (e) => { dunning.baseRate = Number(e.target.value) || 0; }
        }), 'In Prozent, ohne Aufschlag. Er darf auch negativ sein.'),
        field('Stand des Satzes', UI.input({
          value: dunning.baseRateNote || '',
          placeholder: 'z. B. Stand 01.07.2026',
          onInput: (e) => { dunning.baseRateNote = e.target.value; }
        }), 'Nur eine Notiz für dich, damit du siehst, wann du zuletzt nachgesehen hast.')
      ]),
      h('div', { class: 'grid grid-2' }, [
        field('Aufschlag gegenüber Verbrauchern', UI.input({
          type: 'number', step: '0.5', class: 'num',
          value: String(dunning.consumerSurcharge ?? 5),
          onInput: (e) => { dunning.consumerSurcharge = Number(e.target.value) || 0; }
        }), 'Fünf Prozentpunkte nach §288 Abs. 1 BGB.'),
        field('Aufschlag im Geschäftsverkehr', UI.input({
          type: 'number', step: '0.5', class: 'num',
          value: String(dunning.businessSurcharge ?? 9),
          onInput: (e) => { dunning.businessSurcharge = Number(e.target.value) || 0; }
        }), 'Neun Prozentpunkte nach §288 Abs. 2 BGB, wenn kein Verbraucher beteiligt ist.')
      ]),
      h('div', { class: 'grid grid-2' }, [
        field('Pauschale nach §288 Abs. 5 BGB', UI.amountInput({
          value: UI.amountValue(dunning.businessFlatFee ?? 4000),
          onInput: (e) => { dunning.businessFlatFee = UI.parseAmount(e.target.value); }
        }), 'Vierzig Euro, nur zwischen Unternehmen. Sie wird auf spätere Rechtsverfolgungskosten angerechnet.'),
        field('Eigene Mahngebühr', UI.amountInput({
          value: UI.amountValue(dunning.feePerLevel ?? 250),
          onInput: (e) => { dunning.feePerLevel = UI.parseAmount(e.target.value); }
        }), 'Nur tatsächlich entstandene Kosten sind zulässig, also Porto und Papier. Pauschale Bearbeitungsgebühren sind es nicht.')
      ]),
      h('div', { class: 'charge-options', style: { marginTop: '4px' } }, [
        checkbox(
          'Mahngebühr von vornherein ankreuzen',
          Boolean(dunning.chargeFees),
          (v) => { dunning.chargeFees = v; }
        ),
        checkbox(
          'Verzug tritt ohne Mahnung nach dreißig Tagen ein',
          dunning.useAutomaticDefault !== false,
          (v) => { dunning.useAutomaticDefault = v; }
        )
      ]),
      h('div', { class: 'small muted', style: { marginTop: '6px' } },
        'Die Dreißig-Tage-Regel nach §286 Abs. 3 BGB gilt gegenüber Verbrauchern nur, wenn in der Rechnung darauf hingewiesen wurde. Steht der Hinweis nicht in deinen Schlusstexten, schalte sie besser ab.'),
      h('div', { class: 'right' }, h('button', {
        class: 'btn primary',
        onClick: () => save({ dunning }, 'Mahnwesen gespeichert.')
      }, 'Mahnwesen speichern'))
    ])));

    /* ----------------------------------------------------- Rücklage */

    const reserve = { ...(s.reserve || {}) };
    root.appendChild(panel('Rücklage und Vorschau', h('div', [
      h('div', { class: 'grid grid-2' }, [
        field('Steuersatz für die Rücklage', UI.input({
          type: 'number', class: 'num', value: String(reserve.incomeTaxRate || 35),
          onInput: (e) => { reserve.incomeTaxRate = Number(e.target.value) || 0; }
        }), 'Dein höchster Einkommensteuersatz, nicht der durchschnittliche. Der Gewinn kommt zum übrigen Einkommen hinzu und wird oben besteuert.'),
        field('Gewerbesteuer-Hebesatz', UI.input({
          type: 'number', class: 'num', value: String(reserve.tradeTaxRate || ''),
          placeholder: 'leer lassen, wenn nicht relevant',
          onInput: (e) => { reserve.tradeTaxRate = Number(e.target.value) || 0; }
        }), 'Der Hebesatz deiner Gemeinde. Bis 24.500 Euro Gewinn fällt ohnehin keine Gewerbesteuer an.')
      ]),
      h('div', { class: 'grid grid-2' }, [
        field('Aktueller Kontostand', UI.amountInput({
          value: reserve.accountBalance ? UI.amountValue(reserve.accountBalance) : '',
          onInput: (e) => { reserve.accountBalance = UI.parseAmount(e.target.value); }
        }), 'Grundlage der Liquiditätsvorschau. Das Programm kennt dein Konto nicht.'),
        field('Stand vom', UI.dateInput({
          value: reserve.accountBalanceDate || app.boot.today,
          onChange: (e) => { reserve.accountBalanceDate = e.target.value; }
        }))
      ]),
      h('div', { class: 'right' }, h('button', {
        class: 'btn primary',
        onClick: () => save({ reserve }, 'Annahmen gespeichert.')
      }, 'Annahmen speichern'))
    ])));

    /* ----------------------------------------------------- Körperschaft */

    const entity = { ...(s.entity || {}) };
    const isClub = entity.kind === 'club';

    root.appendChild(panel('Körperschaft', h('div', [
      UI.note([
        'Ein Einzelunternehmen rechnet in Betriebseinnahmen und Betriebsausgaben und gibt eine EÜR ab. Ein gemeinnütziger Verein rechnet in vier Sphären, und erst die Zuordnung entscheidet über Steuerpflicht und Vorsteuerabzug.',
        'Die Umstellung wechselt Kategorien, Auswertung und Navigation. Bereits erfasste Buchungen behalten ihre alte Kategorie: stelle möglichst um, bevor du die erste Buchung anlegst.'
      ], isClub ? '' : null),

      field('Art', UI.segmented([
        { value: 'business', label: 'Einzelunternehmen' },
        { value: 'club', label: 'Gemeinnütziger Verein' }
      ], entity.kind || 'business', (value) => {
        entity.kind = value;
        entity.charitable = value === 'club';
        save({ entity }, 'Art der Körperschaft gespeichert.').then(() => app.reboot());
      })),

      isClub ? h('div', [
        h('div', { class: 'charge-options' }, [
          checkbox(
            'Als steuerbegünstigt anerkannt (§5 Abs. 1 Nr. 9 KStG)',
            entity.charitable !== false,
            (v) => { entity.charitable = v; }
          )
        ]),

        h('div', { class: 'grid grid-2' }, [
          field('Begünstigter Zweck', UI.input({
            value: entity.purpose || '',
            placeholder: 'z. B. des Sports',
            onInput: (e) => { entity.purpose = e.target.value; }
          }), 'Wortlaut aus dem Freistellungsbescheid. Er steht auf jeder Zuwendungsbestätigung.'),
          field('Art des Bescheids', select([
            { value: 'freistellung', label: 'Freistellungsbescheid' },
            { value: 'anlage', label: 'Anlage zum Körperschaftsteuerbescheid' }
          ], entity.noticeType || 'freistellung', {
            onChange: (e) => { entity.noticeType = e.target.value; }
          }))
        ]),

        h('div', { class: 'grid grid-3' }, [
          field('Datum des Bescheids', UI.dateInput({
            value: entity.noticeDate || '',
            onChange: (e) => { entity.noticeDate = e.target.value; }
          }), 'Älter als fünf Jahre: keine Bestätigung mehr möglich'),
          field('Finanzamt', UI.input({
            value: entity.noticeOffice || '',
            placeholder: 'z. B. Augsburg-Stadt',
            onInput: (e) => { entity.noticeOffice = e.target.value; }
          })),
          field('Letzter Veranlagungszeitraum', UI.input({
            value: entity.noticeYear || '',
            placeholder: 'z. B. 2024',
            onInput: (e) => { entity.noticeYear = e.target.value; }
          }))
        ]),

        h('div', { class: 'grid grid-2' }, [
          field('Unterzeichnet von', UI.input({
            value: entity.boardName || '',
            onInput: (e) => { entity.boardName = e.target.value; }
          })),
          field('Funktion', UI.input({
            value: entity.boardRole || 'Vorstand',
            onInput: (e) => { entity.boardRole = e.target.value; }
          }))
        ]),

        h('div', { class: 'right' }, h('button', {
          class: 'btn primary',
          onClick: () => save({ entity }, 'Angaben zur Körperschaft gespeichert.')
        }, 'Speichern'))
      ]) : null
    ])));

    /* ----------------------------------------------------- Zeiterfassung */

    const time = { ...(s.time || {}) };
    root.appendChild(panel('Zeiterfassung', h('div', [
      h('div', { class: 'grid grid-2' }, [
        field('Stundensatz als Vorgabe', UI.amountInput({
          value: time.defaultRateCents ? UI.amountValue(time.defaultRateCents) : '',
          placeholder: '0,00',
          onInput: (e) => { time.defaultRateCents = UI.parseAmount(e.target.value); }
        }), 'Gilt, wenn das Projekt keinen eigenen Satz hat. Netto, ohne Umsatzsteuer.'),
        field('Beim Anhalten runden', select(
          [
            { value: 1, label: 'minutengenau' },
            { value: 5, label: 'auf 5 Minuten' },
            { value: 15, label: 'auf 15 Minuten' },
            { value: 30, label: 'auf 30 Minuten' }
          ],
          time.roundToMinutes ?? 15,
          { onChange: (e) => { time.roundToMinutes = Number(e.target.value); } }
        ))
      ]),
      h('div', { class: 'charge-options' }, [
        checkbox(
          'Angefangene Einheiten aufrunden',
          time.roundUp !== false,
          (v) => { time.roundUp = v; }
        )
      ]),
      h('div', { class: 'right' }, h('button', {
        class: 'btn primary',
        onClick: () => save({ time }, 'Zeiterfassung gespeichert.')
      }, 'Speichern'))
    ])));

    /* ----------------------------------------------------- Kanzlei */

    root.appendChild(window.Kanzlei.datevPanel(app));
    root.appendChild(window.Kanzlei.gobdPanel(app));

    root.appendChild(window.Profiles.panel(app));

    // Direkt vor dem Datenordner: dort steht, wo die Daten liegen, hier steht,
    // wie gut sie dort geschützt sind. Das gehört nebeneinander.
    root.appendChild(window.Security.panel(app));

    root.appendChild(panel('Daten und Sicherung', h('div', [
      UI.note([
        `Datenordner: ${app.boot.dataDir}`,
        'Darin liegen die Buchungsdatei, die Belege, die Exporte, tägliche Sicherungen und das Änderungsprotokoll.',
        'Die Daten verlassen diesen Rechner nicht. Der Ordner gehört deshalb in deine reguläre Datensicherung.',
        'Aufbewahrungsfristen nach §147 AO: Buchungsbelege acht Jahre, die Aufzeichnungen selbst und damit die Buchungsdatei zehn Jahre. Gerechnet wird ab dem Ende des Jahres, in dem der letzte Eintrag entstanden ist.'
      ]),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
        h('button', { class: 'btn', onClick: () => window.kontor.settings.openDataDir() }, 'Ordner öffnen'),
        h('button', {
          class: 'btn',
          onClick: async () => {
            const res = UI.unwrap(await window.kontor.settings.backup(), 'Sicherung');
            if (res) UI.toast(`Sicherung gespeichert: ${res.file}`, 'success');
          }
        }, 'Sicherung anlegen'),
        h('button', {
          class: 'btn',
          onClick: async () => {
            const res = UI.unwrap(await window.kontor.reports.exportYear(app.year), 'Export');
            if (res) UI.toast(`Gespeichert: ${res.file}`, 'success');
          }
        }, `Jahresmappe ${app.year}`),
        h('div', { style: { flex: '1' } }),
        h('button', {
          class: 'btn ghost',
          onClick: () => window.kontor.settings.chooseDataDir()
        }, 'Datenordner wechseln')
      ])
    ])));

    root.appendChild(panel('Was dieses Programm nicht tut', h('div', { class: 'small muted' }, [
      h('p', { style: { marginTop: 0 } }, 'Es übermittelt nichts an das Finanzamt. Die Umsatzsteuer-Voranmeldung trägst du in ELSTER ein, die Zahlen stehen in der Ansicht Umsatzsteuer bereit.'),
      h('p', 'Es ersetzt keine steuerliche Beratung. Kategorien, Abzugsgrenzen und die Zuordnung der EÜR-Positionen sind nach bestem Wissen umgesetzt, die Verantwortung für die Erklärung bleibt bei dir.'),
      h('p', { style: { marginBottom: 0 } }, 'Es führt keine doppelte Buchführung. Für eine Bilanz ist es nicht gedacht.')
    ])));

    /* ----------------------------------------------------- Lizenz */

    // Die GPL verlangt, dass jeder Empfänger von der Lizenz erfährt und an den
    // Quelltext kommt. Ein Hinweis in der Anwendung selbst ist der ehrlichste
    // Ort dafür: die Lizenzdatei im Programmordner sieht sonst niemand.
    root.appendChild(panel('Lizenz und Gewährleistung', h('div', { class: 'small muted' }, [
      h('p', { style: { marginTop: 0 } }, [
        'NestEgg ist freie Software unter der GNU General Public License, Version 3 ',
        'oder später. Du darfst das Programm weitergeben und verändern. Gibst du es ',
        'weiter, müssen die Empfänger dieselben Rechte bekommen, einschließlich des ',
        'Quelltextes.'
      ].join('')),
      h('p', [
        'Der vollständige Lizenztext liegt als Datei LICENSE im Programmordner, die ',
        'Lizenzen der mitgelieferten Bibliotheken in THIRD-PARTY-NOTICES.md.'
      ].join('')),
      h('p', { style: { marginBottom: 0 } }, [
        'Für dieses Programm besteht keine Gewährleistung, soweit gesetzlich zulässig. ',
        'Rechnest du mit falschen Zahlen, liegt die Verantwortung dafür bei dir: prüfe ',
        'die Auswertungen, bevor du sie einer Erklärung zugrunde legst.'
      ].join(''))
    ])));
  }

  /**
   * Social-Media-Kanäle.
   *
   * Sie erscheinen in der Fußzeile der Dokumente. Eingetragen wird der Name
   * oder Pfad, nicht die ganze Adresse: aus "meinbetrieb" wird auf dem
   * Dokument "@meinbetrieb". Wer die vollständige Adresse einträgt,
   * bekommt sie unverändert.
   */
  /**
   * Die eigene Unterschrift unter dem Schlusstext.
   *
   * Ein hinterlegtes Bild geht vor, sonst steht der Name in Schreibschrift da.
   * Beides ist ein Faksimile: auf Rechnung und Angebot ist ohnehin keine
   * eigenhändige Unterschrift nötig.
   */
  function signatureSettings(company, s) {
    if (!company.signature) company.signature = { imagePath: '', text: '', height: 16 };
    const sig = company.signature;

    // Sichtbar, sobald ein Bild hinterlegt ist, auch wenn es gerade erst
    // gewählt wurde. Das Entfernen schreibt die Firmendaten mit, weil der
    // leere Pfad sonst nur in der Ansicht stünde.
    const removeSignature = h('button', {
      class: 'btn small ghost danger',
      hidden: !sig.imagePath,
      onClick: async () => {
        sig.imagePath = '';
        await save({ company }, 'Bild entfernt.');
      }
    }, 'Bild entfernen');

    return h('div', [
      h('div', { class: 'field-group-title' }, 'Unterschrift'),
      h('div', { class: 'grid grid-3' }, [
        field('Name in Schreibschrift', UI.input({
          value: sig.text || '',
          placeholder: company.owner || company.name || 'Vorname Nachname',
          onInput: (e) => { sig.text = e.target.value; }
        }), 'Wird gesetzt, solange kein Bild hinterlegt ist'),
        field('Grußformel', UI.input({
          value: sig.greeting === undefined ? 'Mit freundlichen Grüßen' : sig.greeting,
          onInput: (e) => { sig.greeting = e.target.value; }
        }), 'Leer lassen, um sie wegzulassen'),
        field('Höhe des Bildes', UI.input({
          type: 'number', class: 'num', value: String(sig.height || 16),
          onInput: (e) => { sig.height = Number(e.target.value) || 16; }
        }), 'Millimeter')
      ]),
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px' } }, [
        ...filePicker(() => window.kontor.settings.chooseSignature(), sig.imagePath, {
          subject: 'Unterschrift',
          choose: 'Bild wählen',
          replace: 'Bild ersetzen',
          empty: 'Kein Bild, der Name wird in Schreibschrift gesetzt',
          done: 'Unterschrift gesetzt.'
        }, (file) => { sig.imagePath = file; removeSignature.hidden = false; }),
        removeSignature
      ])
    ]);
  }

  function socialBlock(company) {
    // Die Liste steht in der Funktion: ein const außerhalb würde hier zu früh
    // gelesen, weil render() vor den Deklarationen läuft.
    const felder = [
      { id: 'instagram', label: 'Instagram', hint: 'ohne @, etwa meinbetrieb' },
      { id: 'linkedin', label: 'LinkedIn', hint: 'der Teil hinter /in/' },
      { id: 'facebook', label: 'Facebook', hint: 'der Seitenname' },
      { id: 'xing', label: 'Xing', hint: 'der Teil hinter /profile/' },
      { id: 'youtube', label: 'YouTube', hint: 'der Kanalname ohne @' },
      { id: 'mastodon', label: 'Mastodon', hint: 'vollständig, etwa @name@server.de' }
    ];
    if (!company.social) company.social = {};

    return h('div', [
      h('div', { class: 'field-group-title' }, 'Social Media'),
      h('div', { class: 'grid grid-3' }, felder.map((feld) =>
        field(feld.label, UI.input({
          value: company.social[feld.id] || '',
          placeholder: feld.hint,
          onInput: (e) => { company.social[feld.id] = e.target.value; }
        }))
      ))
    ]);
  }

  /**
   * Der QR-Code auf dem Dokument.
   *
   * Der GiroCode ist der nützlichere von beiden: wer ihn scannt, hat die
   * Überweisung fertig ausgefüllt im Banking. Er erscheint deshalb nur dort,
   * wo es etwas zu überweisen gibt.
   */
  function qrBlock(company) {
    if (!company.qr) company.qr = { mode: 'none', url: '', size: 24 };
    const qr = company.qr;

    const zeile = h('div', { class: 'grid grid-3' });
    const build = () => {
      UI.clear(zeile);

      zeile.appendChild(field('QR-Code auf dem Dokument', UI.select([
        { value: 'none', label: 'keiner' },
        { value: 'giro', label: 'GiroCode zum Bezahlen' },
        { value: 'url', label: 'feste Adresse' }
      ], qr.mode, { onChange: (e) => { qr.mode = e.target.value; build(); } }),
      qr.mode === 'giro'
        ? 'Steht nur auf Rechnungen mit offenem Betrag, nicht auf Angeboten'
        : (qr.mode === 'url' ? 'Etwa die Website oder eine Visitenkarte' : null)));

      if (qr.mode === 'url') {
        zeile.appendChild(field('Adresse', UI.input({
          value: qr.url || '',
          placeholder: 'https://beispiel.de',
          onInput: (e) => { qr.url = e.target.value; }
        })));
      }

      if (qr.mode !== 'none') {
        zeile.appendChild(field('Größe', UI.input({
          type: 'number', class: 'num', value: String(qr.size || 24),
          onInput: (e) => { qr.size = Number(e.target.value) || 24; }
        }), 'Millimeter'));
      }
    };

    build();
    return h('div', [h('div', { class: 'field-group-title' }, 'QR-Code'), zeile]);
  }

  function nextNumberPreview(invoice, typeId, yearKey, type) {
    const perType = (invoice.counters && invoice.counters[typeId]) || {};
    const counter = perType[yearKey] || 0;
    return String(invoice.numberPatterns[typeId] || type.defaultPattern)
      .replace(/\{YYYY\}/g, yearKey)
      .replace(/\{YY\}/g, yearKey.slice(2))
      .replace(/\{MM\}/g, '01')
      .replace(/\{(#+)\}/g, (_, hashes) => String(counter + 1).padStart(hashes.length, '0'))
      // In der Vorschau steht eine Beispielkundennummer, beim Festschreiben
      // die des Empfängers.
      .replace(/\{(K+)\}/g, (_, ks) => '0001'.padStart(ks.length, '0').slice(-ks.length));
  }

  /** Welche Platzhalter in welchem Dokument sinnvoll sind. */
  function placeholderHint(type) {
    const common = '{NUMBER}, {DATE}, {AMOUNT}, {CUSTOMER}';
    if (type.nonBinding) return `Platzhalter: ${common}, {VALIDUNTIL}, {TOLERANCE}`;
    if (type.group === 'offer') return `Platzhalter: ${common}, {VALIDUNTIL}`;
    return `Platzhalter: ${common}, {DUEDATE}`;
  }
};
