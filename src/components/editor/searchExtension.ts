// Lightweight Notepad-style Find & Replace match highlighting for CodeMirror 6 (no extra deps)
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

export interface SearchRange {
  from: number;
  to: number;
}

export interface SearchConfig {
  query: string;
  matchCase: boolean;
  activeIndex: number;
}

export const setSearchConfigEffect = StateEffect.define<SearchConfig>();

export function findMatches(text: string, query: string, matchCase: boolean): SearchRange[] {
  if (!query) return [];
  const haystack = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  const ranges: SearchRange[] = [];
  let pos = 0;
  while (pos <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    ranges.push({ from: idx, to: idx + needle.length });
    pos = idx + Math.max(1, needle.length);
  }
  return ranges;
}

const matchMark = Decoration.mark({ class: 'cm-find-match' });
const activeMatchMark = Decoration.mark({ class: 'cm-find-match-active' });

function buildDecorations(text: string, config: SearchConfig): DecorationSet {
  if (!config.query) return Decoration.none;
  const ranges = findMatches(text, config.query, config.matchCase);
  if (!ranges.length) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  ranges.forEach((range, index) => {
    builder.add(range.from, range.to, index === config.activeIndex ? activeMatchMark : matchMark);
  });
  return builder.finish();
}

export const searchConfigField = StateField.define<SearchConfig>({
  create: () => ({ query: '', matchCase: false, activeIndex: -1 }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSearchConfigEffect)) return effect.value;
    }
    return value;
  }
});

export const searchDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    const config = tr.state.field(searchConfigField);
    const configChanged = tr.effects.some((e) => e.is(setSearchConfigEffect));
    if (configChanged || (tr.docChanged && config.query)) {
      return buildDecorations(tr.state.doc.toString(), config);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field)
});

export const searchHighlightExtension = [searchConfigField, searchDecorationsField];
