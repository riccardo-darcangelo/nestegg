// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Riccardo D'Arcangelo
import type { Id, Settings } from '../shared/types';

/**
 * Business segments.
 *
 * To the outside this stays one trade and one profit statement. Internally it
 * matters a lot whether a euro came from the own product, a client job or a
 * marketplace, so every booking and document carries a segment.
 *
 * Segments live in the settings rather than in code, because they change when
 * the business does.
 */

export type SegmentKind = 'service' | 'product' | 'other';

export interface Segment {
  id: Id;
  label: string;
  kind: SegmentKind;
  /** Hex colour, used in charts. */
  color: string;
  note: string;
  active: boolean;
}

const FALLBACK_COLOR = '#8d99ab';

export const DEFAULT_SEGMENTS: Segment[] = [
  {
    id: 'seg_saas',
    label: 'Produkt',
    kind: 'product',
    color: '#5b9cf8',
    note: 'Abos und Lizenzen, abgerechnet über die Plattform',
    active: true
  },
  {
    id: 'seg_services',
    label: 'Dienstleistung',
    kind: 'service',
    color: '#45c08a',
    note: 'Kundenaufträge: Beratung, Entwicklung, Betreuung',
    active: true
  },
  {
    id: 'seg_products',
    label: 'Produkte',
    kind: 'product',
    color: '#e8b446',
    note: 'Themes und Vorlagen über Marktplätze',
    active: true
  },
  {
    id: 'seg_other',
    label: 'Sonstiges',
    kind: 'other',
    color: FALLBACK_COLOR,
    note: 'Alles, was in keinen der anderen Bereiche gehört',
    active: true
  }
];

export const SEGMENT_KINDS: Array<{ id: SegmentKind; label: string }> = [
  { id: 'service', label: 'Dienstleistung' },
  { id: 'product', label: 'Produkt' },
  { id: 'other', label: 'Sonstiges' }
];

function isSegmentKind(value: unknown): value is SegmentKind {
  return SEGMENT_KINDS.some((kind) => kind.id === value);
}

function isHexColor(value: unknown): value is string {
  return /^#[0-9a-fA-F]{6}$/.test(String(value ?? ''));
}

export function normalizeSegment(raw: Partial<Segment>, index = 0): Segment {
  return {
    id: raw.id || `seg_${Date.now().toString(36)}${index}`,
    label: String(raw.label ?? '').trim(),
    kind: isSegmentKind(raw.kind) ? raw.kind : 'other',
    color: isHexColor(raw.color) ? raw.color : FALLBACK_COLOR,
    note: String(raw.note ?? '').trim(),
    active: raw.active !== false
  };
}

export function listSegments(settings: Settings | null | undefined): Segment[] {
  const configured = (settings?.segments as Segment[] | undefined) ?? [];
  return configured.length ? configured : DEFAULT_SEGMENTS;
}

export function getSegment(settings: Settings | null | undefined, id: Id): Segment | null {
  return listSegments(settings).find((segment) => segment.id === id) ?? null;
}

export function segmentLabel(settings: Settings | null | undefined, id: Id): string {
  return getSegment(settings, id)?.label ?? 'Ohne Bereich';
}

/** Suggested for new bookings. */
export function defaultSegmentId(settings: Settings | null | undefined): Id | null {
  return listSegments(settings).find((segment) => segment.active)?.id ?? null;
}
