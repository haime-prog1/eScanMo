// Tools tab. Phase 3 fills these in; for now they're listed as "coming soon".
import { h } from './toast.js';

const TOOLS = [
  ['Merge PDFs', 'Combine documents into one'], ['Split / Extract', 'Pull out selected pages'],
  ['Compress', 'Make files smaller'], ['Password protect', 'Lock a PDF'],
  ['Sign', 'Draw or type a signature'], ['Annotate', 'Pen, highlighter, text, watermark'],
  ['ID card', 'Front + back on one page'], ['Book mode', 'Split two-page spreads'],
];

export function renderTools(root) {
  root.append(h('div', { class: 'page' }, h('h1', {}, 'Tools'),
    h('div', { class: 'tool-grid' }, TOOLS.map(([t, d]) =>
      h('div', { class: 'tool-card disabled' }, h('strong', {}, t), h('span', { class: 'muted' }, d), h('em', {}, 'Coming soon'))))));
}
