/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderMarkdown } from './markdown';

function md(text: string) {
  return render(<div>{renderMarkdown(text)}</div>);
}

describe('renderMarkdown', () => {
  it('renders headings at the right level', () => {
    const { container } = md('# Title\n\n## Sub\n\n### Sub-sub');
    expect(container.querySelector('h1')?.textContent).toBe('Title');
    expect(container.querySelector('h2')?.textContent).toBe('Sub');
    expect(container.querySelector('h3')?.textContent).toBe('Sub-sub');
  });

  it('renders headings with slugified ids for anchor navigation', () => {
    const { container } = md('## My Section');
    expect(container.querySelector('h2')?.getAttribute('id')).toBe('my-section');
  });

  it('renders a paragraph with inline emphasis', () => {
    const { container } = md('Hello **world** and *friends*.');
    const html = container.querySelector('p')?.innerHTML || '';
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<em>friends</em>');
  });

  it('renders inline code spans', () => {
    const { container } = md('Use `npm test` to run tests.');
    expect(container.querySelector('code')?.textContent).toBe('npm test');
  });

  it('renders fenced code blocks preserving content', () => {
    const { container } = md('```\nline one\nline two\n```');
    const pre = container.querySelector('pre code');
    expect(pre?.textContent).toBe('line one\nline two');
  });

  it('renders unordered lists', () => {
    const { container } = md('- one\n- two\n- three');
    const items = container.querySelectorAll('ul li');
    expect(items.length).toBe(3);
    expect(items[1].textContent).toBe('two');
  });

  it('renders ordered lists', () => {
    const { container } = md('1. one\n2. two');
    const list = container.querySelector('ol');
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll('li').length).toBe(2);
  });

  it('renders GitHub-flavoured tables', () => {
    const { container } = md('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
    const headers = container.querySelectorAll('th');
    const cells = container.querySelectorAll('td');
    expect(headers.length).toBe(2);
    expect(cells.length).toBe(4);
    expect(headers[0].textContent).toBe('A');
    expect(cells[3].textContent).toBe('4');
  });

  it('renders blockquotes', () => {
    const { container } = md('> An important note.');
    expect(container.querySelector('blockquote')?.textContent).toBe('An important note.');
  });

  it('renders horizontal rules', () => {
    const { container } = md('text\n\n---\n\nmore text');
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('renders markdown links as anchors opening in a new tab', () => {
    const { container } = md('Read [the docs](https://example.com).');
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.textContent).toBe('the docs');
  });

  it('does not break on empty input', () => {
    const { container } = md('');
    expect(container.textContent).toBe('');
  });
});
