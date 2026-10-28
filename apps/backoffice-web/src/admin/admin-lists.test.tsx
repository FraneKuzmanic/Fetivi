// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AdminOverview, AdminPropertyRow, HostSummary } from '../api';
import { formatDay } from '../forms/datetime';
import { Tabs } from '../shell/Tabs';
import { adminAttention } from './AdminTodayPage';
import { approvalOrder, unitsLine } from './ApprovalsTable';
import { auditAction } from './AuditPage';
import { dueText } from './curation/StalenessPage';
import { hostStatus } from './HostsPage';

const HOST: HostSummary = {
  id: 'h1',
  email: 'host@example.test',
  emailVerified: true,
  suspended: false,
  createdAt: '2026-10-01T10:00:00Z',
  propertyCount: 1,
};

describe('hostStatus', () => {
  it('puts a suspension before an unconfirmed email, else the host is active', () => {
    expect(hostStatus(HOST)).toEqual(['Active', 'ok']);
    expect(hostStatus({ ...HOST, emailVerified: false })).toEqual(['Email not confirmed', 'wait']);
    expect(hostStatus({ ...HOST, emailVerified: false, suspended: true })).toEqual([
      'Suspended',
      'fail',
    ]);
  });
});

const PROPERTY: AdminPropertyRow = {
  id: 'p1',
  name: 'Villa Mare',
  city: 'Trogir',
  hostEmail: 'host@example.test',
  unitCount: 3,
  readyUnitCount: 2,
  createdAt: '2026-10-01T10:00:00Z',
  approvedAt: null,
};

describe('unitsLine', () => {
  it('counts the ready units while waiting, and just the units once approved', () => {
    expect(unitsLine(PROPERTY)).toBe('2 of 3 ready');
    const approved = { ...PROPERTY, approvedAt: '2026-10-02T10:00:00Z' };
    expect(unitsLine(approved)).toBe('3 units');
    expect(unitsLine({ ...approved, unitCount: 1 })).toBe('1 unit');
  });
});

describe('approvalOrder', () => {
  it('lists the waiting oldest first, then the approved newest first', () => {
    const rows: AdminPropertyRow[] = [
      { ...PROPERTY, id: 'approved-old', approvedAt: '2026-10-03T10:00:00Z' },
      { ...PROPERTY, id: 'waiting-new', createdAt: '2026-10-05T10:00:00Z' },
      { ...PROPERTY, id: 'approved-new', approvedAt: '2026-10-09T10:00:00Z' },
      { ...PROPERTY, id: 'waiting-old', createdAt: '2026-10-02T10:00:00Z' },
    ];
    expect(rows.sort(approvalOrder).map((r) => r.id)).toEqual([
      'waiting-old',
      'waiting-new',
      'approved-new',
      'approved-old',
    ]);
  });
});

describe('auditAction', () => {
  it('reads each request as a sentence', () => {
    const cases: [string, string, string][] = [
      ['POST', '/api/admin/act-as', 'Started acting as the host'],
      ['POST', '/api/admin/act-as/stop', 'Stopped acting as the host'],
      ['PATCH', '/api/host/properties/:id', 'Changed a property'],
      ['DELETE', '/api/host/stays/:id', 'Deleted a stay'],
      ['POST', '/api/host/properties/:id/blocks', 'Added a guide entry'],
      ['POST', '/api/host/blocks/:id/translations/retry', 'Retried a translation'],
    ];
    for (const [method, route, sentence] of cases) {
      expect(auditAction({ method, route })).toBe(sentence);
    }
  });
});

const NOTHING: AdminOverview = {
  approvalsPending: 0,
  curationOpen: 0,
  curationNeedsVisit: 0,
  recordsDue: 0,
  paymentProblems: 0,
  ordersNeedAction: 0,
};

describe('adminAttention', () => {
  it('is empty when nothing waits', () => {
    expect(adminAttention(NOTHING)).toEqual([]);
  });

  it('lists money first, each linked, in the singular for one', () => {
    const items = adminAttention({
      approvalsPending: 1,
      curationOpen: 1,
      curationNeedsVisit: 4,
      recordsDue: 1,
      paymentProblems: 1,
      ordersNeedAction: 1,
    });
    expect(items.map((i) => [i.key, i.text, i.to])).toEqual([
      ['orders', '1 order needs you', '/admin/orders?view=needs_action'],
      ['payments', '1 payment check needs a look', '/admin/reconciliation'],
      ['approvals', '1 property waits for approval', '/admin/approvals'],
      ['curation', '1 draft to review before guests see it', '/admin/curation'],
      ['due', '1 place is due for a re-check', '/admin/curation/staleness'],
    ]);
  });

  it('says the plural for more than one and leaves out what is zero', () => {
    const items = adminAttention({
      ...NOTHING,
      ordersNeedAction: 3,
      curationOpen: 2,
      recordsDue: 5,
    });
    expect(items.map((i) => i.text)).toEqual([
      '3 orders need you',
      '2 drafts to review before guests see them',
      '5 places are due for a re-check',
    ]);
  });
});

describe('dueText', () => {
  it('says overdue, due or never checked', () => {
    const at = '2026-10-12T10:00:00Z';
    expect(dueText({ staleness: { status: 'stale', staleAt: at } })).toBe(
      `Overdue since ${formatDay(at)}`,
    );
    expect(dueText({ staleness: { status: 'fresh', staleAt: at } })).toBe(`Due ${formatDay(at)}`);
    expect(dueText({ staleness: { status: 'never_verified', staleAt: null } })).toBe(
      'Never checked',
    );
  });
});

let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

type View = 'a' | 'b' | 'c';

function Harness() {
  const [value, setValue] = useState<View>('a');
  return (
    <Tabs
      label="Status"
      items={[
        { id: 'a', label: 'First' },
        { id: 'b', label: 'Second', count: 4 },
        { id: 'c', label: 'Third' },
      ]}
      value={value}
      onChange={setValue}
    />
  );
}

describe('Tabs', () => {
  it('moves and chooses with the arrows, Home and End, with only the current tab in the Tab order', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<Harness />));
    const list = document.querySelector<HTMLElement>('[role="tablist"]');
    if (!list) throw new Error('no tablist');
    expect(list.getAttribute('aria-label')).toBe('Status');
    const tabs = () => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const selected = () => tabs().find((t) => t.getAttribute('aria-selected') === 'true');
    const press = (key: string) =>
      act(async () => {
        list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });

    expect(tabs().map((t) => t.textContent)).toEqual(['First', 'Second4', 'Third']);
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);

    await press('ArrowRight');
    expect(selected()?.textContent).toBe('Second4');
    expect(document.activeElement).toBe(selected());
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0, -1]);

    await press('End');
    expect(selected()?.textContent).toBe('Third');
    await press('ArrowRight');
    expect(selected()?.textContent).toBe('First');
    await press('ArrowLeft');
    expect(selected()?.textContent).toBe('Third');
    await press('Home');
    expect(selected()?.textContent).toBe('First');
    expect(document.activeElement).toBe(selected());

    await press('Enter');
    expect(selected()?.textContent).toBe('First');
  });
});
