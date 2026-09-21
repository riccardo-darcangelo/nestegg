// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import { sum } from './money';
import type {
  BusinessDocument,
  Cents,
  Entry,
  Id,
  IsoDate,
  IsoTimestamp,
  Project,
  ProjectStatus
} from '../shared/types';

export type { Project, ProjectStatus } from '../shared/types';

/**
 * A job usually spans several invoices and causes costs of its own. Only when
 * both meet can you tell whether it paid off, and the project is the bracket
 * that holds them together.
 */

export const PROJECT_STATUS = {
  planned: 'Geplant',
  active: 'Laufend',
  done: 'Abgeschlossen',
  cancelled: 'Abgebrochen'
} as const;

/** What a booking is worth after private shares and deduction limits. */
export interface TaxEffect {
  businessNet: Cents;
  euerAmount: Cents;
}

export interface ProjectTotals {
  project: Project;
  invoiceCount: number;
  offerCount: number;
  billedNet: Cents;
  openGross: Cents;
  revenueNet: Cents;
  costNet: Cents;
  marginNet: Cents;
  /** Null when there is no revenue to divide by. */
  marginPercent: number | null;
  budgetUsedPercent: number | null;
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && value in PROJECT_STATUS;
}

function nonNegativeCents(value: unknown): Cents {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

export function normalizeProject(raw: Partial<Project> & Record<string, unknown>): Project {
  const now = new Date().toISOString();

  return {
    id: raw.id ?? null,
    name: String(raw.name ?? '').trim(),
    customerId: raw.customerId ?? null,
    segmentId: raw.segmentId ?? null,
    status: isProjectStatus(raw.status) ? raw.status : 'active',
    budgetCents: nonNegativeCents(raw.budgetCents),
    hourlyRateCents: nonNegativeCents(raw.hourlyRateCents),
    startDate: raw.startDate ?? null,
    endDate: raw.endDate ?? null,
    note: String(raw.note ?? '').trim(),
    createdAt: raw.createdAt ?? now,
    updatedAt: now
  };
}

export function validateProject(project: Project): string[] {
  const errors: string[] = [];

  if (!project.name) errors.push('Das Projekt braucht einen Namen.');
  if (project.startDate && project.endDate && project.endDate < project.startDate) {
    errors.push('Das Ende liegt vor dem Anfang.');
  }

  return errors;
}

/** Documents carry their computed totals alongside, added when reading. */
type ComputedDocument = BusinessDocument & {
  computed?: { netTotal: Cents; openAmount: Cents };
};

function percentOfTotal(part: Cents, whole: Cents): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Everything is counted net, because VAT is a pass-through item that only
 * obscures the result.
 */
export function projectTotals(
  project: Project,
  invoices: readonly ComputedDocument[],
  entries: readonly Entry[],
  effectOf: (entry: Entry) => TaxEffect
): ProjectTotals {
  const own = invoices.filter((document) => document.projectId === project.id);
  const billed = own.filter((document) => document.documentType === 'invoice' || !document.documentType);
  const offers = own.filter(
    (document) => document.documentType === 'quote' || document.documentType === 'estimate'
  );

  const ownEntries = entries.filter((entry) => entry.projectId === project.id);
  const revenueNet = sum(
    ownEntries.filter((entry) => entry.type === 'income').map((entry) => effectOf(entry).businessNet)
  );
  const costNet = sum(
    ownEntries.filter((entry) => entry.type === 'expense').map((entry) => effectOf(entry).euerAmount)
  );

  const billedNet = sum(billed.map((document) => document.computed?.netTotal ?? 0));
  const openGross = sum(billed.map((document) => document.computed?.openAmount ?? 0));

  return {
    project,
    invoiceCount: billed.length,
    offerCount: offers.length,
    billedNet,
    openGross,
    revenueNet,
    costNet,
    marginNet: revenueNet - costNet,
    marginPercent: percentOfTotal(revenueNet - costNet, revenueNet),
    budgetUsedPercent: percentOfTotal(billedNet, project.budgetCents)
  };
}
