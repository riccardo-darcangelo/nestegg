'use strict';

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
const { contextBridge, ipcRenderer } = require('electron');

/**
 * Einzige Brücke zwischen Oberfläche und Hauptprozess.
 * Die Oberfläche bekommt keinen Zugriff auf Node, nur auf diese Aufrufe.
 */

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('kontor', {
  bootstrap: () => invoke('app:bootstrap'),
  snapshot: () => invoke('data:snapshot'),

  entries: {
    save: (entry) => invoke('entries:save', entry),
    remove: (id) => invoke('entries:remove', id),
    preview: (entry) => invoke('entries:preview', entry)
  },

  invoices: {
    save: (invoice) => invoke('invoices:save', invoice),
    remove: (id) => invoke('invoices:remove', id),
    finalize: (payload) => invoke('invoices:finalize', payload),
    validate: (invoice) => invoke('invoices:validate', invoice),
    pdf: (payload) => invoke('invoices:pdf', payload),
    xml: (payload) => invoke('invoices:xml', payload),
    addPayment: (payload) => invoke('invoices:addPayment', payload),
    bookPayment: (payload) => invoke('invoices:bookPayment', payload),
    duplicate: (id) => invoke('invoices:duplicate', id),
    cancel: (id) => invoke('invoices:cancel', id)
  },

  offers: {
    setStatus: (payload) => invoke('offers:setStatus', payload),
    convertToInvoice: (id) => invoke('offers:convertToInvoice', id)
  },

  theme: {
    preview: (payload) => invoke('theme:preview', payload),
    applyPreset: (payload) => invoke('theme:applyPreset', payload),
    save: (theme) => invoke('theme:save', theme),
    reset: () => invoke('theme:reset')
  },

  customers: {
    save: (customer) => invoke('customers:save', customer),
    remove: (id) => invoke('customers:remove', id)
  },

  dunning: {
    overdue: () => invoke('dunning:overdue'),
    prepare: (payload) => invoke('dunning:prepare', payload),
    create: (payload) => invoke('dunning:create', payload),
    removeLast: (id) => invoke('dunning:removeLast', id),
    pdf: (payload) => invoke('dunning:pdf', payload)
  },

  spheres: {
    review: (payload) => invoke('spheres:review', payload)
  },

  members: {
    save: (member) => invoke('members:save', member),
    remove: (id) => invoke('members:remove', id),
    overview: (payload) => invoke('members:overview', payload),
    duesPlan: (payload) => invoke('members:duesPlan', payload),
    runDues: (payload) => invoke('members:runDues', payload),
    saveTiers: (payload) => invoke('members:saveTiers', payload),
    preNotification: (payload) => invoke('members:preNotification', payload),
    preNotificationPdf: (payload) => invoke('members:preNotificationPdf', payload)
  },

  claims: {
    overview: (payload) => invoke('claims:overview', payload),
    save: (claim) => invoke('claims:save', claim),
    remove: (id) => invoke('claims:remove', id),
    waive: (payload) => invoke('claims:waive', payload)
  },

  sepa: {
    plan: (payload) => invoke('sepa:plan', payload),
    export: (payload) => invoke('sepa:export', payload),
    saveSettings: (payload) => invoke('sepa:saveSettings', payload)
  },

  reserves: {
    overview: (payload) => invoke('reserves:overview', payload),
    save: (reserve) => invoke('reserves:save', reserve),
    remove: (id) => invoke('reserves:remove', id),
    move: (payload) => invoke('reserves:move', payload),
    document: (payload) => invoke('reserves:document', payload)
  },

  donations: {
    overview: (payload) => invoke('donations:overview', payload),
    prepare: (payload) => invoke('donations:prepare', payload),
    create: (payload) => invoke('donations:create', payload),
    issued: (payload) => invoke('donations:issued', payload)
  },

  travel: {
    preview: (trip) => invoke('travel:preview', trip),
    book: (trip) => invoke('travel:book', trip)
  },

  times: {
    save: (entry) => invoke('times:save', entry),
    remove: (id) => invoke('times:remove', id),
    start: (payload) => invoke('times:start', payload),
    stop: (id) => invoke('times:stop', id),
    overview: (payload) => invoke('times:overview', payload),
    toInvoice: (payload) => invoke('times:toInvoice', payload)
  },

  datev: {
    preview: (payload) => invoke('datev:preview', payload),
    export: (payload) => invoke('datev:export', payload),
    saveAccounts: (payload) => invoke('datev:saveAccounts', payload)
  },

  gobd: {
    documentation: () => invoke('gobd:documentation'),
    dataExport: (payload) => invoke('gobd:dataExport', payload)
  },

  einvoice: {
    choose: () => invoke('einvoice:choose'),
    commit: (payload) => invoke('einvoice:commit', payload)
  },

  profiles: {
    list: () => invoke('profiles:list'),
    create: (payload) => invoke('profiles:create', payload),
    switch: (id) => invoke('profiles:switch', id),
    rename: (payload) => invoke('profiles:rename', payload),
    remove: (id) => invoke('profiles:remove', id),
    open: () => invoke('profiles:open')
  },

  bank: {
    choose: () => invoke('bank:choose'),
    commit: (payload) => invoke('bank:commit', payload),
    saveRules: (rules) => invoke('bank:saveRules', rules)
  },

  deadlines: {
    list: (payload) => invoke('deadlines:list', payload)
  },

  recurring: {
    save: (template) => invoke('recurring:save', template),
    remove: (id) => invoke('recurring:remove', id),
    due: () => invoke('recurring:due'),
    generate: (payload) => invoke('recurring:generate', payload),
    skip: (payload) => invoke('recurring:skip', payload)
  },

  projects: {
    save: (project) => invoke('projects:save', project),
    remove: (id) => invoke('projects:remove', id),
    totals: (id) => invoke('projects:totals', id)
  },

  segments: {
    save: (list) => invoke('segments:save', list)
  },

  assets: {
    save: (asset) => invoke('assets:save', asset),
    remove: (id) => invoke('assets:remove', id),
    schedule: (id) => invoke('assets:schedule', id)
  },

  receipts: {
    attach: (meta) => invoke('receipts:attach', meta),
    open: (id) => invoke('receipts:open', id),
    reveal: (id) => invoke('receipts:reveal', id),
    verify: (id) => invoke('receipts:verify', id),
    scan: (id) => invoke('receipts:scan', id),
    remove: (id) => invoke('receipts:remove', id)
  },

  reports: {
    euer: (year) => invoke('reports:euer', year),
    vat: (payload) => invoke('reports:vat', payload),
    vatYear: (year) => invoke('reports:vatYear', year),
    dashboard: (year) => invoke('reports:dashboard', year),
    analytics: (year) => invoke('reports:analytics', year),
    ecSales: (payload) => invoke('reports:ecSales', payload),
    reserve: (year) => invoke('reports:reserve', year),
    liquidity: (months) => invoke('reports:liquidity', months),
    exportYear: (year) => invoke('reports:exportYear', year),
    exportCsv: (year) => invoke('reports:exportCsv', year),
    thresholds: (payload) => invoke('reports:thresholds', payload)
  },

  settings: {
    update: (patch) => invoke('settings:update', patch),
    chooseDataDir: () => invoke('settings:chooseDataDir'),
    chooseLogo: () => invoke('settings:chooseLogo'),
    chooseSignature: () => invoke('settings:chooseSignature'),
    openDataDir: () => invoke('settings:openDataDir'),
    backup: () => invoke('settings:backup')
  },

  /**
   * Die Verschlüsselung.
   *
   * Hier gehen Passwörter hinein und Ja oder Nein kommt heraus. Der
   * Datenschlüssel selbst bleibt im Hauptprozess und taucht in dieser Brücke
   * nirgends auf.
   */
  security: {
    state: () => invoke('security:state'),
    strength: (password) => invoke('security:strength', password),
    enable: (password, remember) => invoke('security:enable', { password, remember }),
    disable: (password) => invoke('security:disable', { password }),
    changePassword: (current, next) => invoke('security:changePassword', { current, next }),
    newRecoveryKey: (password) => invoke('security:newRecoveryKey', { password }),
    printRecoveryKey: (recoveryKey) => invoke('security:printRecoveryKey', { recoveryKey }),
    setRemember: (remember, password) => invoke('security:setRemember', { remember, password })
  },

  on: (channel, handler) => {
    const allowed = ['app:toast', 'app:navigate', 'security:progress'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
