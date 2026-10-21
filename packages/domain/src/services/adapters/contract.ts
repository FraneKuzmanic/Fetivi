import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AdapterContext,
  AdapterError,
  type AvailabilityQuery,
  type HoldRequest,
  type ProviderAdapter,
} from './interface';

// The contract every Provider adapter keeps, written once and run per adapter (allotment here,
// on request in 36, live in 37). Not a test file itself: an adapter's `*.contract.int.test.ts`
// calls `describeAdapterContract`. Capacity checks are skipped where the system does not say.

export interface ContractFixture {
  adapter: ProviderAdapter;
  ctx: AdapterContext;
  /** The query that finds the fixture's start for `quantity`. */
  query(quantity: number): AvailabilityQuery;
  /** A fresh Order and proposal ready to hold `quantity`. */
  newProposal(quantity: number): Promise<HoldRequest>;
  /** Capacity the system reports for the fixture's start, for conservation checks; null if unknowable. */
  capacityLeft(): Promise<number | null>;
  teardown(): Promise<void>;
}

async function rejectsWith(promise: Promise<unknown>, code: AdapterError['code']) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AdapterError);
  expect((error as AdapterError).code).toBe(code);
}

export function describeAdapterContract(name: string, setup: () => Promise<ContractFixture>) {
  describe(`${name} adapter contract`, () => {
    let f: ContractFixture;
    beforeEach(async () => {
      f = await setup();
    });
    afterEach(async () => {
      await f?.teardown();
    });

    it('lists a start with enough capacity and omits it when the quantity exceeds it', async () => {
      const starts = await f.adapter.checkAvailability(f.ctx, f.query(1));
      expect(starts.length).toBeGreaterThan(0);
      const left = await f.capacityLeft();
      if (left === null) return;
      expect(starts[0]?.remaining).toBe(left);
      expect(await f.adapter.checkAvailability(f.ctx, f.query(left + 1))).toEqual([]);
    });

    it('takes capacity on hold, and a repeated hold is the same hold', async () => {
      const before = await f.capacityLeft();
      const request = await f.newProposal(2);
      const first = await f.adapter.hold(f.ctx, request);
      const again = await f.adapter.hold(f.ctx, request);
      expect(again.ref).toBe(first.ref);
      expect(first.expiresAt.getTime()).toBe(request.expiresAt.getTime());
      if (before !== null) expect(await f.capacityLeft()).toBe(before - 2);
      expect((await f.adapter.lookup(f.ctx, request.orderId)).state).toBe('held');
    });

    it('commits under the Order id, idempotently', async () => {
      const request = await f.newProposal(1);
      await f.adapter.hold(f.ctx, request);
      const { externalRef } = await f.adapter.commit(f.ctx, request);
      expect(externalRef).toBe(request.orderId);
      expect((await f.adapter.commit(f.ctx, request)).externalRef).toBe(request.orderId);
      const found = await f.adapter.lookup(f.ctx, request.orderId);
      expect(found.state).toBe('committed');
      expect(found.proposalId).toBe(request.proposalId);
    });

    it('restores capacity once on release, however often it is released', async () => {
      const before = await f.capacityLeft();
      const request = await f.newProposal(2);
      await f.adapter.hold(f.ctx, request);
      await f.adapter.release(f.ctx, request);
      await f.adapter.release(f.ctx, request);
      if (before !== null) expect(await f.capacityLeft()).toBe(before);
      expect((await f.adapter.lookup(f.ctx, request.orderId)).state).toBe('released');
    });

    it('restores capacity once when a committed reservation is cancelled', async () => {
      const before = await f.capacityLeft();
      const request = await f.newProposal(1);
      await f.adapter.hold(f.ctx, request);
      await f.adapter.commit(f.ctx, request);
      // Release frees only an uncommitted hold.
      await f.adapter.release(f.ctx, request);
      if (before !== null) expect(await f.capacityLeft()).toBe(before - 1);
      await f.adapter.cancel(f.ctx, request);
      await f.adapter.cancel(f.ctx, request);
      if (before !== null) expect(await f.capacityLeft()).toBe(before);
    });

    it('refuses to commit a released hold', async () => {
      const request = await f.newProposal(1);
      await f.adapter.hold(f.ctx, request);
      await f.adapter.release(f.ctx, request);
      await rejectsWith(f.adapter.commit(f.ctx, request), 'hold-gone');
    });

    it('refuses a hold beyond capacity and changes nothing', async () => {
      const before = await f.capacityLeft();
      if (before === null) return;
      const request = await f.newProposal(before + 1);
      await rejectsWith(f.adapter.hold(f.ctx, request), 'sold-out');
      expect(await f.capacityLeft()).toBe(before);
      expect((await f.adapter.lookup(f.ctx, request.orderId)).state).toBe('not_found');
    });

    it('maps references to Orders, and unknown references to nothing', async () => {
      expect((await f.adapter.lookup(f.ctx, randomUUID())).state).toBe('not_found');
      expect((await f.adapter.lookup(f.ctx, 'not-a-reference')).state).toBe('not_found');
      expect(await f.adapter.resolveInboundCancellation(f.ctx, { reference: randomUUID() })).toBe(
        null,
      );
      const request = await f.newProposal(1);
      await f.adapter.hold(f.ctx, request);
      expect(
        await f.adapter.resolveInboundCancellation(f.ctx, { reference: request.orderId }),
      ).toEqual({ orderId: request.orderId, proposalId: request.proposalId });
    });
  });
}
