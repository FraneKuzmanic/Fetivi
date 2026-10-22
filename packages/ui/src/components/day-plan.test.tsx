// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { componentPart, type DayPlanPayload, type PlanItemPayload } from '../payloads';
import { DayPlan, type DayPlanLabels } from './day-plan/DayPlan';

let root: Root | null = null;
let host: HTMLElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

const LABELS: DayPlanLabels = {
  day: (date) => `Day ${date}`,
  today: 'Today',
  anyTime: 'Any time',
  nothingPlanned: 'Nothing planned yet',
  booked: 'Booked',
  orderStatus: (status) => (status === 'confirmed' ? 'Confirmed' : status),
  ask: (title) => `Ask Fetivi about ${title}`,
  askShort: 'Ask Fetivi',
  plan: 'Day plan',
};

const item = (over: Partial<PlanItemPayload> = {}): PlanItemPayload => ({
  id: 'i1',
  kind: 'suggestion',
  date: '2027-07-15',
  time: null,
  title: 'Swim at Pantan',
  note: null,
  placeId: null,
  offerId: null,
  orderId: null,
  orderStatus: null,
  ...over,
});

const plan: DayPlanPayload = {
  checkIn: '2027-07-14',
  checkout: '2027-07-16',
  today: '2027-07-15',
  days: [
    { date: '2027-07-14', items: [] },
    {
      date: '2027-07-15',
      items: [
        item({ id: 'a', title: 'Dinner in the old town' }),
        item({
          id: 'o1',
          kind: 'order',
          time: '09:00',
          title: 'Blue Lagoon boat trip',
          orderId: 'o1',
          offerId: 'off1',
          orderStatus: 'confirmed',
        }),
        item({ id: 'b', time: '08:00', title: 'Morning swim', note: 'Bring masks' }),
      ],
    },
    { date: '2027-07-16', items: [] },
  ],
};

const titles = () => [...host.querySelectorAll('.fv-plan-title')].map((p) => p.textContent);

describe('DayPlan', () => {
  it('renders days in order, timed items before the any-time group', () => {
    mount(<DayPlan days={plan.days} today={plan.today} labels={LABELS} />);
    const headings = [...host.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['Day 2027-07-14', 'Day 2027-07-15Today', 'Day 2027-07-16']);
    expect(titles()).toEqual(['Morning swim', 'Blue Lagoon boat trip', 'Dinner in the old town']);
    const times = [...host.querySelectorAll('.fv-plan-time')].map((t) => t.textContent);
    expect(times).toEqual(['08:00', '09:00', 'Any time']);
    expect(host.textContent).toContain('Bring masks');
    expect(host.querySelectorAll('.fv-plan-empty')).toHaveLength(2);
  });

  it('marks a booked item with its status', () => {
    mount(<DayPlan days={plan.days} today={plan.today} labels={LABELS} />);
    const booked = host.querySelector('[data-kind="order"]');
    expect(booked?.textContent).toContain('Booked');
    expect(booked?.textContent).toContain('Confirmed');
    expect(host.querySelectorAll('.fv-plan-booked')).toHaveLength(1);
  });

  it('has no Ask button without onAsk', () => {
    mount(<DayPlan days={plan.days} today={plan.today} labels={LABELS} />);
    expect(host.querySelectorAll('button')).toHaveLength(0);
  });

  it('calls onAsk with the item', () => {
    const onAsk = vi.fn();
    mount(<DayPlan days={plan.days} today={plan.today} labels={LABELS} onAsk={onAsk} />);
    const ask = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Ask Fetivi about Blue Lagoon boat trip"]',
    );
    expect(ask?.textContent).toBe('Ask Fetivi');
    act(() => ask?.click());
    expect(onAsk).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1', kind: 'order' }));
  });

  it('hides empty days when asked', () => {
    mount(<DayPlan days={plan.days} today={plan.today} labels={LABELS} showEmptyDays={false} />);
    expect(host.querySelectorAll('h3')).toHaveLength(1);
    expect(host.textContent).not.toContain('Nothing planned yet');
  });
});

describe('day-plan payload', () => {
  it('accepts a plan and rejects an unknown kind', () => {
    expect(componentPart.safeParse({ name: 'day-plan', payload: plan }).success).toBe(true);
    const bad = {
      ...plan,
      days: [{ date: '2027-07-15', items: [{ ...item(), kind: 'idea' }] }],
    };
    expect(componentPart.safeParse({ name: 'day-plan', payload: bad }).success).toBe(false);
  });

  it('accepts the longest Stay and rejects no days', () => {
    const days = Array.from({ length: 91 }, (_, i) => ({ date: `d${i}`, items: [] }));
    expect(componentPart.safeParse({ name: 'day-plan', payload: { ...plan, days } }).success).toBe(
      true,
    );
    expect(
      componentPart.safeParse({ name: 'day-plan', payload: { ...plan, days: [] } }).success,
    ).toBe(false);
  });
});
