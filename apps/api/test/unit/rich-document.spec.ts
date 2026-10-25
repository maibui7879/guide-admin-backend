import {
  documentText,
  parseRichDocument,
  renderRichDocument,
} from '../../src/modules/guides/domain/rich-document';

const doc = (content: unknown[]) => ({ type: 'doc', content });
const text = (value: string, marks?: unknown[]) => ({
  type: 'paragraph',
  content: [{ type: 'text', text: value, ...(marks ? { marks } : {}) }],
});

describe('guide document boundary and renderer', () => {
  it('renders image blocks by uploaded ID and escapes alt/caption text', () => {
    const id = '03d6b90a-69ca-43bb-80a4-5dbff11b8e78';
    const value = doc([
      text('Before'),
      {
        type: 'image',
        attrs: { mediaId: id, alt: 'A "diagram"', caption: '<script>caption</script>' },
      },
      text('After'),
    ]);
    const rendered = renderRichDocument(value);
    expect(rendered).toContain(`/api/v1/media/${id}/file`);
    expect(rendered).toContain('alt="A &quot;diagram&quot;"');
    expect(rendered).toContain('&lt;script&gt;caption&lt;/script&gt;');
    expect(renderRichDocument(value, true)).toContain(`/api/v1/admin/media/${id}/file`);
    expect(() =>
      parseRichDocument(doc([{ type: 'image', attrs: { mediaId: id, alt: '' } }])),
    ).toThrow();
    expect(() =>
      parseRichDocument(
        doc([{ type: 'image', attrs: { mediaId: id, alt: 'x', src: 'https://example.com/a' } }]),
      ),
    ).toThrow();
    expect(() =>
      parseRichDocument(
        doc([
          { type: 'paragraph', content: [{ type: 'image', attrs: { mediaId: id, alt: 'x' } }] },
        ]),
      ),
    ).toThrow();
  });
  it('escapes markup in text and link attributes while preserving supported formatting', () => {
    const input = doc([
      text('<img src=x onerror=alert(1)> & "text"', [
        { type: 'bold' },
        { type: 'link', attrs: { href: 'https://example.com/?a=1&b=2' } },
      ]),
    ]);
    const html = renderRichDocument(input);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;text&quot;');
    expect(html).not.toContain('<img');
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(html).toContain('<strong>');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,<svg/onload=alert(1)>',
    '//evil.example',
    'http://example.com',
    'https://name:password@example.com',
    'https://example.com/\nattack',
  ])('rejects unsafe link %s', (href) => {
    expect(() =>
      parseRichDocument(doc([text('click', [{ type: 'link', attrs: { href } }])])),
    ).toThrow();
  });
  it.each([
    { type: 'html', text: '<script>alert(1)</script>' },
    { type: 'image', attrs: { src: 'https://example.com/a.png' } },
    { type: 'paragraph', attrs: { onclick: 'alert(1)' } },
    { type: 'heading', attrs: { level: 8 }, content: [] },
    { type: 'text', text: 'block text without paragraph' },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'x',
          marks: [{ type: 'link', attrs: { href: 'https://example.com', target: 'anything' } }],
        },
      ],
    },
  ])('rejects unsupported nodes/attributes and invalid nesting', (node) => {
    expect(() => parseRichDocument(doc([node]))).toThrow();
  });
  it('bounds depth, node count and text size before rendering', () => {
    let deep: unknown = text('x');
    for (let i = 0; i < 14; i++) deep = { type: 'blockquote', content: [deep] };
    expect(() => parseRichDocument(doc([deep]))).toThrow();
    expect(() => parseRichDocument(doc(Array.from({ length: 2001 }, () => text('x'))))).toThrow();
    expect(() => parseRichDocument(doc([text('x'.repeat(100001))]))).toThrow();
  });
  it('renders supported headings, lists, code and breaks without inventing document fields', () => {
    const value = doc([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [{ type: 'listItem', content: [text('Step')] }],
      },
      { type: 'codeBlock', content: [{ type: 'text', text: '<script>' }] },
      { type: 'horizontalRule' },
    ]);
    expect(renderRichDocument(value)).toBe(
      '<h2>Title</h2><ol start="3"><li><p>Step</p></li></ol><pre><code>&lt;script&gt;</code></pre><hr>',
    );
    expect(documentText(parseRichDocument(value))).toContain('Step');
  });
});
