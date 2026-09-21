// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { el, document as xmlDocument, type XmlNode } from './xml';
import { decimalString } from '../domain/money';
import * as sepa from '../domain/sepa';
import type { Cents, IsoDate } from '../shared/types';
import type { Creditor, Debit, PainVersionId, SchemeId, SepaSettings, SequenceTypeId } from '../domain/sepa';

/**
 * The SEPA direct debit file (pain.008).
 *
 * Turns checked rows into the XML that gets uploaded to online banking. The
 * checking happens in `domain/sepa`; whatever arrives here counts as
 * collectable.
 *
 * Two versions, because the switchover falls mid year: pain.008.001.08 is the
 * only permitted one from 14 November 2026, until then some banks still take
 * pain.008.001.02. For a debit of this kind the differences are small, the
 * most visible being the name of the BIC element.
 *
 * All amounts in cents.
 */

/**
 * A reference that stays unique.
 *
 * Banks run a duplicate check over message id, creation date and submitter
 * name. Two files of the same day with the same id count as a mistake and get
 * rejected, which is why the time of day is part of it.
 */
export function messageId(now: Date, prefix = 'NESTEGG'): string {
  const stamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return sepa.sepaText(`${prefix}-${stamp}`, 35);
}

export function fileNameFor(dueDate: IsoDate, created: Date): string {
  const stamp = created.toISOString().slice(11, 16).replace(':', '');
  return `sepa-lastschrift-${dueDate}-${stamp}.xml`;
}

/** The creditor identifier as an element group, needed identically twice. */
function creditorSchemeId(creditorId: string): XmlNode {
  return el('CdtrSchmeId',
    el('Id',
      el('PrvtId',
        el('Othr', [
          el('Id', creditorId),
          el('SchmeNm', el('Prtry', 'SEPA'))
        ])
      )
    )
  );
}

/**
 * One debit.
 *
 * The element order is not free: the schema prescribes it, and a file with
 * elements out of order is rejected even when every value in it is right.
 */
function transaction(row: Debit): XmlNode {
  return el('DrctDbtTxInf', [
    el('PmtId', el('EndToEndId', row.endToEndId || 'NOTPROVIDED')),
    el('InstdAmt', { Ccy: 'EUR' }, decimalString(row.amount)),
    el('DrctDbtTx',
      el('MndtRltdInf', [
        el('MndtId', row.mandateRef),
        el('DtOfSgntr', row.mandateDate)
      ])
    ),
    // The payer's bank is left out: since February 2016 the IBAN suffices
    // within SEPA, and guessing a BIC the app does not know would be worse
    // than omitting it.
    el('DbtrAgt', el('FinInstnId', el('Othr', el('Id', 'NOTPROVIDED')))),
    el('Dbtr', el('Nm', row.sepaName)),
    el('DbtrAcct', el('Id', el('IBAN', row.iban))),
    row.reference ? el('RmtInf', el('Ustrd', row.reference)) : null
  ]);
}

function creditorAgent(creditor: Creditor, bicTag: string): XmlNode {
  return el('CdtrAgt', el('FinInstnId', creditor.bic
    ? el(bicTag, sepa.sepaText(creditor.bic, 11))
    : el('Othr', el('Id', 'NOTPROVIDED'))));
}

export interface BuildInput {
  creditor: Creditor;
  rows: readonly Debit[];
  dueDate: IsoDate;
  settings?: Partial<SepaSettings> | null;
  /** Injectable so a test gets a stable message id and file name. */
  now?: Date;
}

export interface SepaFile {
  xml: string;
  fileName: string;
  messageId: string;
  version: PainVersionId;
  scheme: SchemeId;
  sequenceType: SequenceTypeId;
  count: number;
  total: Cents;
  dueDate: IsoDate;
}

/**
 * Builds the complete file.
 *
 * One batch per due date, because the collection date sits on the batch and
 * not on the individual debit.
 */
export function build({ creditor, rows, dueDate, settings, now }: BuildInput): SepaFile {
  const config: SepaSettings = { ...sepa.DEFAULT_SETTINGS, ...(settings ?? {}) };
  const version = sepa.getPainVersion(config.painVersion);
  const scheme = sepa.getScheme(config.scheme);
  const created = now ?? new Date();

  const list = rows ?? [];
  const total = list.reduce((sum, row) => sum + row.amount, 0);
  const id = messageId(created);
  const creditorName = sepa.sepaText(config.creditorName || creditor.name, 70);
  const sequenceType = config.sequenceType || 'RCUR';

  const root = el('Document', {
    xmlns: version.namespace,
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance'
  }, el('CstmrDrctDbtInitn', [
    el('GrpHdr', [
      el('MsgId', id),
      el('CreDtTm', created.toISOString().slice(0, 19)),
      el('NbOfTxs', String(list.length)),
      el('CtrlSum', decimalString(total)),
      el('InitgPty', el('Nm', creditorName))
    ]),
    el('PmtInf', [
      el('PmtInfId', sepa.sepaText(`${id}-1`, 35)),
      el('PmtMtd', 'DD'),
      el('BtchBookg', config.batchBooking === false ? 'false' : 'true'),
      el('NbOfTxs', String(list.length)),
      el('CtrlSum', decimalString(total)),
      el('PmtTpInf', [
        el('SvcLvl', el('Cd', 'SEPA')),
        el('LclInstrm', el('Cd', scheme.id)),
        el('SeqTp', sequenceType)
      ]),
      el('ReqdColltnDt', dueDate),
      el('Cdtr', el('Nm', creditorName)),
      el('CdtrAcct', el('Id', el('IBAN', sepa.normalizeIban(creditor.iban)))),
      creditorAgent(creditor, version.bicTag),
      // SLEV: each side carries the cost of its own bank. Nothing else is
      // permitted within SEPA.
      el('ChrgBr', 'SLEV'),
      creditorSchemeId(config.creditorId),
      list.map((row) => transaction(row))
    ])
  ]));

  return {
    xml: xmlDocument(root),
    fileName: fileNameFor(dueDate, created),
    messageId: id,
    version: version.id,
    scheme: scheme.id,
    sequenceType,
    count: list.length,
    total,
    dueDate
  };
}
