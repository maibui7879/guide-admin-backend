import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export interface RichMark {
  type: 'bold' | 'italic' | 'strike' | 'code' | 'link';
  attrs?: { href: string };
}
export interface RichNode {
  type: string;
  text?: string;
  attrs?: { level?: number; start?: number; mediaId?: string; alt?: string; caption?: string };
  marks?: RichMark[];
  content?: RichNode[];
}

const escape = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!,
  );

export function safeHttpsUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048 || !/^https:\/\//.test(input)) {
    throw new BadRequestException('Only HTTPS links are supported');
  }
  try {
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      [...input].some((character) => character.charCodeAt(0) <= 32)
    )
      throw new Error();
    return url.href;
  } catch {
    throw new BadRequestException('Invalid link');
  }
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Invalid editor document');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key)))
    throw new BadRequestException('Unsupported editor field');
  return record;
}

/** A bounded subset of the ProseMirror/Tiptap JSON format, never arbitrary HTML. */
export function parseRichDocument(input: unknown): RichNode {
  let count = 0;
  let characters = 0;
  const blocks = [
    'paragraph',
    'heading',
    'bulletList',
    'orderedList',
    'blockquote',
    'codeBlock',
    'horizontalRule',
    'image',
  ];
  function visit(value: unknown, parent: string, depth: number): RichNode {
    if (++count > 2000 || depth > 12)
      throw new BadRequestException('Editor document is too complex');
    const node = object(value, ['type', 'text', 'attrs', 'marks', 'content']);
    const type = node.type;
    const allowed =
      parent === ''
        ? ['doc']
        : ['paragraph', 'heading'].includes(parent)
          ? ['text', 'hardBreak']
          : parent === 'codeBlock'
            ? ['text']
            : ['bulletList', 'orderedList'].includes(parent)
              ? ['listItem']
              : blocks;
    if (typeof type !== 'string' || !allowed.includes(type))
      throw new BadRequestException('Unsupported editor node');
    const result: RichNode = { type };
    if (type === 'image') {
      if (node.text !== undefined || node.marks !== undefined || node.content !== undefined)
        throw new BadRequestException('Images are block leaves');
      const parsed = z
        .object({
          mediaId: z.uuid(),
          alt: z.string().trim().min(1).max(300),
          caption: z.string().trim().max(500).default(''),
        })
        .strict()
        .safeParse(node.attrs);
      if (!parsed.success) throw new BadRequestException('Invalid image attributes');
      result.attrs = parsed.data;
      return result;
    }
    if (type === 'text') {
      if (typeof node.text !== 'string' || !node.text.length || node.content || node.attrs)
        throw new BadRequestException('Invalid editor text');
      characters += node.text.length;
      if (characters > 100000) throw new BadRequestException('Editor text is too long');
      result.text = node.text;
      if (node.marks !== undefined) {
        if (!Array.isArray(node.marks) || node.marks.length > 5 || parent === 'codeBlock')
          throw new BadRequestException('Invalid text marks');
        const types = new Set<string>();
        result.marks = node.marks.map((value): RichMark => {
          const mark = object(value, ['type', 'attrs']);
          if (
            typeof mark.type !== 'string' ||
            !['bold', 'italic', 'strike', 'code', 'link'].includes(mark.type) ||
            types.has(mark.type)
          )
            throw new BadRequestException('Unsupported text mark');
          types.add(mark.type);
          if (mark.type === 'link') {
            const attrs = object(mark.attrs, ['href']);
            return { type: 'link', attrs: { href: safeHttpsUrl(attrs.href) } };
          }
          if (mark.attrs !== undefined)
            throw new BadRequestException('Unsupported mark attributes');
          return { type: mark.type as RichMark['type'] };
        });
      }
      return result;
    }
    if (node.text !== undefined || node.marks !== undefined)
      throw new BadRequestException('Invalid editor node fields');
    if (type === 'heading') {
      const attrs = object(node.attrs, ['level']);
      if (![1, 2, 3].includes(attrs.level as number))
        throw new BadRequestException('Invalid heading');
      result.attrs = { level: attrs.level as number };
    } else if (type === 'orderedList' && node.attrs !== undefined) {
      const attrs = object(node.attrs, ['start']);
      if (!Number.isInteger(attrs.start) || Number(attrs.start) < 1 || Number(attrs.start) > 1000)
        throw new BadRequestException('Invalid list start');
      result.attrs = { start: attrs.start as number };
    } else if (node.attrs !== undefined)
      throw new BadRequestException('Unsupported node attributes');
    if (['hardBreak', 'horizontalRule'].includes(type)) {
      if (node.content !== undefined)
        throw new BadRequestException('Leaf nodes cannot contain children');
    } else {
      const children = node.content ?? [];
      if (
        !Array.isArray(children) ||
        (['doc', 'bulletList', 'orderedList', 'listItem', 'blockquote'].includes(type) &&
          !children.length)
      )
        throw new BadRequestException('Invalid editor children');
      result.content = children.map((child) => visit(child, type, depth + 1));
      if (type === 'listItem' && result.content[0]?.type !== 'paragraph')
        throw new BadRequestException('List items must begin with a paragraph');
    }
    return result;
  }
  return visit(input, '', 0);
}

export function documentText(node: RichNode): string {
  return node.text ?? (node.content ?? []).map(documentText).join(' ');
}

/** Construct HTML from validated nodes and escape all text/attributes. */
export function renderRichDocument(input: unknown, privateMedia = false): string {
  const render = (node: RichNode): string => {
    if (node.type === 'image') {
      const attrs = node.attrs!;
      const url = `/api/v1/${privateMedia ? 'admin/' : ''}media/${attrs.mediaId}/file`;
      return `<figure><img src="${url}" alt="${escape(attrs.alt!)}" loading="lazy">${attrs.caption ? `<figcaption>${escape(attrs.caption)}</figcaption>` : ''}</figure>`;
    }
    if (node.type === 'text') {
      let text = escape(node.text!);
      for (const mark of node.marks ?? []) {
        if (mark.type === 'link')
          text = `<a href="${escape(mark.attrs!.href)}" rel="noopener noreferrer">${text}</a>`;
        else {
          const tag = { bold: 'strong', italic: 'em', strike: 's', code: 'code' }[mark.type];
          text = `<${tag}>${text}</${tag}>`;
        }
      }
      return text;
    }
    const children = (node.content ?? []).map(render).join('');
    if (node.type === 'doc') return children;
    if (node.type === 'hardBreak') return '<br>';
    if (node.type === 'horizontalRule') return '<hr>';
    if (node.type === 'codeBlock') return `<pre><code>${children}</code></pre>`;
    const tag =
      node.type === 'heading'
        ? `h${node.attrs!.level}`
        : {
            paragraph: 'p',
            bulletList: 'ul',
            orderedList: 'ol',
            listItem: 'li',
            blockquote: 'blockquote',
          }[node.type]!;
    const attrs =
      node.type === 'orderedList' && node.attrs?.start ? ` start="${node.attrs.start}"` : '';
    return `<${tag}${attrs}>${children}</${tag}>`;
  };
  return render(parseRichDocument(input));
}
