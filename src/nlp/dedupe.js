/**
 * Reconciliation of recognition output into a monotonic text stream.
 *
 * The Web Speech API re-emits text: every `interim` result repeats the sentence-so-far,
 * and after an automatic restart the engine frequently repeats the last words. Naively
 * concatenating results is the #1 source of duplicated text in dictation extensions.
 *
 * `Reconciler` owns the committed text and guarantees:
 *   - identical finals are dropped,
 *   - partial overlaps between two finals are merged instead of duplicated,
 *   - interim results are reduced to the *uncommitted tail* so the UI can preview them.
 */
import { normalizeForMatch } from './persian.js';

export function normalizeForCompare(text) {
  return normalizeForMatch(String(text ?? ''))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function words(text) {
  const n = normalizeForCompare(text);
  return n ? n.split(' ') : [];
}

/**
 * Words that are too common to be treated as an "engine repeat": merging two sentences
 * that merely both start with "و" or "the" would delete legitimate text.
 */
const OVERLAP_STOPWORDS = new Set([
  'و', 'در', 'به', 'از', 'که', 'با', 'تا', 'را', 'بر', 'هم', 'من', 'ما', 'او', 'شما', 'این', 'آن',
  'the', 'a', 'an', 'and', 'of', 'to', 'in', 'is', 'it', 'i', 'we', 'you', 'my', 'so', 'but'
]);

export class Reconciler {
  constructor(options = {}) {
    this.minOverlapWords = Number.isFinite(options.minOverlapWords) ? options.minOverlapWords : 1;
    this.maxOverlapWords = Number.isFinite(options.maxOverlapWords) ? options.maxOverlapWords : 12;
    this.reset();
  }

  reset() {
    this.committed = '';
    this.segments = [];
    this.interim = '';
    /** Set after an operation whose effect on the text is unknown (paste/undo): the next chunk
     *  must not get an automatic separator, because we cannot know what the caret sits after. */
    this.boundary = false;
    this.stats = { duplicates: 0, overlaps: 0, segments: 0 };
  }

  get committedText() {
    return this.committed;
  }

  /**
   * Add one final segment.
   * @returns {{text:string, duplicate:boolean, overlap:number, appended:boolean}}
   */
  commitFinal(segment) {
    const incoming = String(segment ?? '').trim();
    if (!incoming) return { text: '', duplicate: false, overlap: 0, appended: false };
    this.interim = '';

    const prevWords = words(this.committed);
    const inWords = words(incoming);

    if (inWords.length === 0) {
      // punctuation-only segment: append without dedupe bookkeeping
      const text = this.appendRaw(incoming);
      return { text, duplicate: false, overlap: 0, appended: true };
    }

    // 1) exact duplicate of the last segment / of the whole committed text
    if (inWords.length) {
      const lastSeg = this.segments[this.segments.length - 1];
      if (lastSeg && normalizeForCompare(lastSeg) === normalizeForCompare(incoming)) {
        this.stats.duplicates += 1;
        return { text: '', duplicate: true, overlap: inWords.length, appended: false };
      }
      const tail = prevWords.slice(-inWords.length).join(' ');
      if (inWords.length <= prevWords.length && tail === inWords.join(' ')) {
        this.stats.duplicates += 1;
        return { text: '', duplicate: true, overlap: inWords.length, appended: false };
      }
    }

    // 2) overlap between the tail of the committed text and the head of the segment
    let overlap = 0;
    const maxK = Math.min(this.maxOverlapWords, prevWords.length, inWords.length);
    for (let k = maxK; k >= this.minOverlapWords; k -= 1) {
      const a = prevWords.slice(prevWords.length - k).join(' ');
      const b = inWords.slice(0, k).join(' ');
      if (a !== b) continue;
      if (k === 1) {
        const word = inWords[0];
        // a single repeated word is only an engine repeat when it is distinctive
        if (OVERLAP_STOPWORDS.has(word) || word.length < 3) continue;
      }
      overlap = k;
      break;
    }

    let toAppend = incoming;
    if (overlap > 0) {
      this.stats.overlaps += 1;
      toAppend = stripLeadingWords(incoming, overlap);
      if (!toAppend.trim()) return { text: '', duplicate: true, overlap, appended: false };
    }

    const text = this.appendRaw(toAppend);
    this.segments.push(text);
    this.stats.segments += 1;
    return { text, duplicate: false, overlap, appended: true };
  }

  appendRaw(chunk, { forceNoSpace = false } = {}) {
    const piece = String(chunk ?? '');
    if (!piece) return '';
    const boundary = this.boundary;
    this.boundary = false;
    if (!this.committed) {
      this.committed = piece;
      return piece;
    }
    const needsSpace = !forceNoSpace && !boundary
      && !/[\s\u200C\n]$/.test(this.committed)
      && !/^[،؛؟!.:…)\]]/.test(piece)
      && !/^[\s\u200C\n]/.test(piece);
    const inserted = needsSpace ? ` ${piece}` : piece;
    this.committed += inserted;
    return inserted;
  }

  /** Apply an external edit (user pressed Backspace, a voice command, …). */
  replaceCommitted(text) {
    this.committed = String(text ?? '');
    this.segments = this.committed ? [this.committed] : [];
  }

  clearAll() {
    this.committed = '';
    this.segments = [];
    this.interim = '';
  }

  /** Remove the last inserted segment (used by the «پاک کن» command). */
  deleteLastSegment() {
    if (this.segments.length === 0) {
      this.committed = this.committed.replace(/[\s،]+$/, '');
      return { removed: '' };
    }
    const removed = this.segments.pop();
    if (this.committed.endsWith(removed)) {
      this.committed = this.committed.slice(0, this.committed.length - removed.length);
    } else {
      this.committed = this.committed.slice(0, Math.max(0, this.committed.length - removed.length));
    }
    this.committed = this.committed.replace(/[\s،]+$/, '');
    return { removed };
  }

  /** Set the current interim text; returns the un-committed tail for display. */
  setInterim(text) {
    const interim = String(text ?? '').trim();
    this.interim = interim;
    if (!interim) return '';
    const prevWords = words(this.committed);
    const inWords = words(interim);
    let overlap = 0;
    for (let k = Math.min(this.maxOverlapWords, prevWords.length, inWords.length); k >= 1; k -= 1) {
      const a = prevWords.slice(prevWords.length - k).join(' ');
      const b = inWords.slice(0, k).join(' ');
      if (a === b) { overlap = k; break; }
    }
    return overlap > 0 ? stripLeadingWords(interim, overlap) : interim;
  }

  get interimTail() {
    return this.setInterim(this.interim);
  }
}

/** Remove the first `count` words from a string, preserving the rest verbatim. */
export function stripLeadingWords(text, count) {
  const src = String(text ?? '');
  let seen = 0;
  let i = 0;
  for (; i < src.length && seen < count; i += 1) {
    if (!/[\s\u200C]/.test(src[i])) {
      // consume the whole word
      while (i < src.length && !/[\s\u200C]/.test(src[i])) i += 1;
      seen += 1;
      i -= 1;
    }
  }
  return src.slice(i).replace(/^[\s\u200C]+/, '');
}
