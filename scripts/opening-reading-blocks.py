"""Offline HTML -> inert reading blocks; no source attribute/URL is rendered."""
from html.parser import HTMLParser
import json
import re
import sys

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
HIDDEN = {'head', 'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript'}
TYPES = {'p': 'paragraph', 'h1': 'heading', 'h2': 'heading', 'h3': 'heading',
         'h4': 'heading', 'ul': 'list', 'ol': 'list', 'li': 'item', 'blockquote': 'quote',
         'strong': 'strong', 'b': 'strong', 'em': 'emphasis', 'i': 'emphasis',
         'code': 'code', 'pre': 'code', 'table': 'group', 'tr': 'group', 'td': 'group'}


class ReadingBlocks(HTMLParser):
    def __init__(self, remove_navigation=True):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.stack = []
        self.hidden = 0
        self.remove_navigation = remove_navigation
        self.removed_navigation = 0
        self.malformed = False
        self.prose = []
        self.links = []

    def append(self, block):
        target = next((frame[2]['children'] for frame in reversed(self.stack) if frame[2] is not None), self.blocks)
        target.append(block)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        nav = tag in ('nav', 'aside') or bool(set(attrs.get('class', '').lower().split()) & {'navbar', 'sidebar'})
        suppress = tag in HIDDEN or (nav and self.remove_navigation)
        if nav and self.remove_navigation:
            self.removed_navigation += 1
        block = None
        if not self.hidden and not suppress:
            if tag == 'a' and attrs.get('href'):
                line, column = self.getpos()
                locator = f'{line}:{column}'
                block = dict(type='link', anchor=locator, children=[])
                self.links.append(locator)
            elif tag == 'img':
                alt = attrs.get('alt', '')[:1024]
                if alt.lower().startswith('fen:'):
                    self.append(dict(type='diagram_candidate', raw_fen=alt[4:].strip().rstrip(';').strip()))
                else:
                    self.append(dict(type='unavailable', text=alt or 'Source image unavailable offline'))
            elif tag in ('video', 'audio'):
                self.append(dict(type='unavailable', text='Source media unavailable offline'))
            elif tag == 'br':
                self.append(dict(type='break'))
            elif tag in TYPES:
                block = dict(type=TYPES[tag], children=[])
                if tag.startswith('h'):
                    block['level'] = int(tag[1])
                if tag in ('ul', 'ol'):
                    block['ordered'] = tag == 'ol'
            if block is not None:
                self.append(block)
        if tag not in VOID:
            self.stack.append((tag, suppress, block))
            self.hidden += int(suppress)

    def handle_endtag(self, tag):
        index = next((i for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if index is None:
            if tag not in VOID:
                self.malformed = True
            return
        # Common HTML optional end tags are tolerated; this is never a browser DOM.
        self.hidden -= sum(int(frame[1]) for frame in self.stack[index:])
        del self.stack[index:]

    def handle_data(self, text):
        if self.hidden or not text.strip():
            return
        text = re.sub(r'\s+', ' ', text)
        self.append(dict(type='text', text=text))
        if not any(frame[0] == 'a' for frame in self.stack):
            self.prose.append(text)


def normalize(html):
    if not isinstance(html, str) or len(html) > 8_000_000:
        raise ValueError('Article body exceeds offline conversion limit')
    parser = ReadingBlocks()
    parser.feed(html)
    parser.close()
    # An unclosed suppressed container can hide prose. Retain a safe whole-body
    # fallback rather than claiming questionable content was navigation.
    fallback = parser.hidden > 0 or (not parser.removed_navigation and bool(html.strip()))
    if parser.hidden > 0:
        parser = ReadingBlocks(remove_navigation=False)
        parser.feed(html)
        parser.close()
    prose = ' '.join(parser.prose).strip()
    def plain(blocks):
        return ' '.join(block.get('text', '') + ' ' + plain(block.get('children', [])) for block in blocks)
    return dict(blocks=parser.blocks, meaningful=len(prose) >= 100,
                plain_text=' '.join(plain(parser.blocks).split()),
                fallback=fallback, malformed=parser.malformed, links=parser.links,
                removed_navigation=parser.removed_navigation)


if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps([normalize(body) for body in json.load(sys.stdin)], ensure_ascii=False))
