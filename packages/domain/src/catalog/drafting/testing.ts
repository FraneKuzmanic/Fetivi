import { readFileSync } from 'node:fs';
import type { DraftingModel, DraftingModelResult } from './model';
import type { DraftingInput } from './prompt';
import type { DraftExtractionData } from './schema';

/** One recorded page or response from `./recorded`, as text. */
export function readRecordedPage(name: string): string {
  return readFileSync(new URL(`./recorded/${name}`, import.meta.url), 'utf8');
}

/** How the stand-in answers one URL: a recorded file, an inline body, a status or a redirect. */
export type RecordedAnswer =
  | { file: string; contentType?: string }
  | { body: string; contentType?: string }
  | { status: number }
  | { redirect: string };

export type RecordedFetch = typeof globalThis.fetch & { requests: string[] };

/**
 * A `globalThis.fetch` stand-in for `vi.stubGlobal('fetch', …)`, so the real egress wraps it and
 * re-checks every hop. Records each URL asked; an unknown URL answers 404. Like the platform
 * fetch, a response carries its URL.
 */
export function recordedPagesFetch(map: Record<string, RecordedAnswer>): RecordedFetch {
  const requests: string[] = [];
  const stub = async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    const answer = map[url];
    let response: Response;
    if (!answer) response = new Response('not found', { status: 404 });
    else if ('redirect' in answer) {
      response = new Response(null, { status: 302, headers: { location: answer.redirect } });
    } else if ('status' in answer) response = new Response('', { status: answer.status });
    else {
      const body = 'file' in answer ? readRecordedPage(answer.file) : answer.body;
      response = new Response(body, {
        status: 200,
        headers: { 'content-type': answer.contentType ?? 'text/html; charset=utf-8' },
      });
    }
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  return Object.assign(stub, { requests }) as RecordedFetch;
}

export type ScriptedDraftingModel = DraftingModel & { inputs: DraftingInput[] };

/** Answers each call with the next scripted output (or a function of the input); records inputs. */
export function scriptedDraftingModel(
  script:
    | (DraftExtractionData | DraftingModelResult)[]
    | ((input: DraftingInput) => DraftExtractionData | DraftingModelResult),
): ScriptedDraftingModel {
  const inputs: DraftingInput[] = [];
  return {
    inputs,
    async extract(input) {
      inputs.push(input);
      const next = typeof script === 'function' ? script(input) : script.shift();
      if (!next) throw new Error('scriptedDraftingModel: no output left');
      return 'ok' in next ? next : { ok: true, output: next };
    },
  };
}

/** A DraftExtractionData with every field null, to spread a few fields over. */
export const EMPTY_EXTRACTION: DraftExtractionData = {
  title: null,
  description: null,
  address: null,
  phone: null,
  websiteUrl: null,
  openingHours: null,
  seasons: null,
  permanentlyClosed: null,
};
