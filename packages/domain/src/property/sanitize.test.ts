import { describe, expect, it } from 'vitest';
import { stripMarkdownHtml, stripMarkup } from './sanitize';

describe('stripMarkup', () => {
  it('removes tags, scripts, styles and comments', () => {
    expect(stripMarkup('<b>Villa</b> Mare')).toBe('Villa Mare');
    expect(stripMarkup('a<script>alert(1)</script>b')).toBe('ab');
    expect(stripMarkup('a<style>p{}</style>b<!-- hidden -->c')).toBe('abc');
    expect(stripMarkup('<img src=x onerror="alert(1)">ok')).toBe('ok');
  });

  it('removes control characters but keeps tabs and newlines', () => {
    expect(stripMarkup('a\u0000b\u0007c\u001bd\te\nf')).toBe('abcd\te\nf');
  });

  it('normalises line endings and trims', () => {
    expect(stripMarkup('  one\r\ntwo\rthree  ')).toBe('one\ntwo\nthree');
  });

  it('keeps a lone less-than sign', () => {
    expect(stripMarkup('5 < 6 and 7 > 3')).toBe('5 < 6 and 7 > 3');
  });

  it('folds lines into one when asked', () => {
    expect(stripMarkup('Villa\n  Mare\n\nSplit', { singleLine: true })).toBe('Villa Mare Split');
  });
});

describe('stripMarkdownHtml', () => {
  it('keeps Markdown syntax and newlines', () => {
    const body =
      '# Arrival\n\n**Bold** and _italic_\n\n- one\n- two\n\n[Map](https://example.com/a?b=1)';
    expect(stripMarkdownHtml(body)).toBe(body);
  });

  it('keeps autolinks', () => {
    expect(stripMarkdownHtml('See <https://example.com>')).toBe('See <https://example.com>');
  });

  it('removes HTML inside Markdown', () => {
    expect(stripMarkdownHtml('**Hi**<script>x()</script>\n<div>text</div>')).toBe('**Hi**\ntext');
  });
});
