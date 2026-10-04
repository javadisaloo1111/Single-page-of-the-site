/**
 * TextPipeline — the single place where raw recognition output becomes final text.
 *
 * Order of operations (deliberate, each step depends on the previous one):
 *   1. normalize spacing / Arabic letter variants
 *   2. spoken numbers → digits (must run before commands: «دو نقطه پنج» == 2.5, not «نقطه»)
 *   3. custom dictionary + code-switching (Persian transliteration → canonical Latin term)
 *   4. voice commands  → ordered ops (text / key / edit / clipboard / lang)
 *   5. smart punctuation on each text op (terminal mark only on the final text op)
 *   6. Persian half-space + spacing normalization
 *   7. de-duplication against already committed text
 */
import { normalizePersian, fixHalfSpace, normalizeSpacing } from './persian.js';
import { numbersToDigits } from './numbers.js';
import { applyCodeSwitch, getDefaultTermIndex, buildTermIndex } from './codeSwitch.js';
import { smartPunctuate } from './punctuation.js';
import { parseVoiceCommands } from './commands.js';
import { Reconciler } from './dedupe.js';
import { detectLanguage } from './languageDetect.js';

export class TextPipeline {
  /**
   * @param {{getSettings:Function}} deps
   */
  constructor({ getSettings }) {
    this.getSettings = getSettings;
    this.reconciler = new Reconciler();
    this.indexCache = { key: '', index: getDefaultTermIndex() };
    this.lastMeta = null;
  }

  reset() {
    this.reconciler.reset();
  }

  get committedText() {
    return this.reconciler.committedText;
  }

  /** Rebuild the term index when the user dictionary/vocabulary changed. */
  getIndex(settings) {
    const terms = settings?.dictionary?.terms || [];
    const key = JSON.stringify(terms);
    if (this.indexCache.key !== key) {
      this.indexCache = { key, index: buildTermIndex(terms) };
    }
    return this.indexCache.index;
  }

  /** Light, non-destructive processing used for live preview of interim results. */
  processInterim(transcript, meta = {}) {
    const settings = this.getSettings();
    const raw = String(transcript ?? '');
    if (!raw.trim()) return { tail: '', raw, text: '' };
    let text = raw;
    if (settings.text.normalize) text = normalizeSpacing(text);
    if (settings.text.numbers?.enabled) {
      text = numbersToDigits(text, {
        mode: settings.text.persianDigits,
        expandScales: Boolean(settings.text.numbers?.expandScales)
      }).text;
    }
    if (settings.text.preserveEnglishWords) {
      text = applyCodeSwitch(text, {
        index: this.getIndex(settings),
        preserveEnglishWords: true,
        englishizeGenericTerms: settings.text.englishizeGenericTerms,
        fuzzyMatch: settings.text.fuzzyMatch,
        customRules: settings.dictionary?.rules || []
      }).text;
    }
    const tail = this.reconciler.setInterim(text);
    this.lastMeta = { ...meta, interim: true };
    return { tail, raw: text, text: tail };
  }

  /**
   * Full processing of a final segment.
   * @returns {{ops:Array<object>, text:string, matches:Array<object>, meta:object, duplicate:boolean}}
   */
  processFinal(transcript, meta = {}) {
    const settings = this.getSettings();
    const raw = String(transcript ?? '').trim();
    if (!raw) {
      return { ops: [], text: '', matches: [], meta: { ...meta }, duplicate: false };
    }

    // The engine may hand us a full detection, a bare language tag, or nothing at all.
    // Either way the pipeline guarantees a complete detection object (lang/confidence/…) so the
    // controller can always apply its switch rules.
    const computed = detectLanguage(raw, { candidates: this.candidates(settings) });
    const hint = meta.detected;
    const detected = typeof hint === 'string'
      ? { ...computed, lang: hint, engineReported: true }
      : (hint && typeof hint === 'object' && hint.lang
        ? { ...computed, ...hint }
        : computed);
    const lang = meta.lang || detected.lang;
    const replacements = [];

    let text = raw;
    if (settings.text.normalize) text = normalizeSpacing(text);
    // Arabic must keep its own letter forms: ي/ك → ی/ک is a Persian-only normalization.
    if (settings.text.persianChars && lang !== 'ar-SA') {
      text = normalizePersian(text, { fixArabicChars: true, fixPunctuation: false });
    }

    // 2) numbers (before commands so decimals win over the «نقطه» command)
    if (settings.text.numbers?.enabled) {
      const num = numbersToDigits(text, {
        mode: settings.text.persianDigits,
        expandScales: Boolean(settings.text.numbers?.expandScales),
        english: true
      });
      text = num.text;
    }

    // 3) dictionary + code switching
    if (settings.text.preserveEnglishWords || (settings.dictionary?.rules || []).length) {
      const cs = applyCodeSwitch(text, {
        index: this.getIndex(settings),
        preserveEnglishWords: settings.text.preserveEnglishWords !== false,
        englishizeGenericTerms: Boolean(settings.text.englishizeGenericTerms),
        fuzzyMatch: settings.text.fuzzyMatch !== false,
        customRules: settings.dictionary?.rules || []
      });
      text = cs.text;
      replacements.push(...cs.replacements);
    }

    // 4) voice commands
    const parsed = parseVoiceCommands(text, {
      enabled: settings.commands?.enabled !== false,
      strict: Boolean(settings.commands?.strict),
      allowTrailing: settings.commands?.allowTrailing !== false,
      allowedIds: settings.commands?.allowedIds || null,
      lang
    });
    const ops = parsed.ops.length ? parsed.ops : (text.trim() ? [{ type: 'text', value: text }] : []);

    // 5/6) per-op text finishing + 7) de-duplication
    const lastTextIdx = ops.reduce((acc, op, i) => (op.type === 'text' ? i : acc), -1);
    const out = [];
    let inserted = '';
    let duplicate = false;
    const lang_ = lang === 'auto' ? detected.lang : lang;

    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i];
      if (op.type !== 'text') {
        // Keep the reconciler's mirror of the field in sync with non-text ops: inserts are
        // mirrored exactly (so no stray separator is added after a newline) and unknown ops
        // mark a boundary instead of guessing.
        if (op.type === 'key' && op.key === 'Enter') this.reconciler.appendRaw('\n'.repeat(op.count || 1), { forceNoSpace: true });
        else if (op.type === 'key' && op.key === 'Tab') this.reconciler.appendRaw(' '.repeat(4), { forceNoSpace: true });
        else if (op.type === 'edit' && op.op === 'clearAll') this.reconciler.clearAll();
        else if (op.type === 'edit' && op.op === 'deleteLast') this.reconciler.deleteLastSegment();
        else this.reconciler.boundary = true;
        out.push(op);
        continue;
      }

      let piece = op.value;
      const isTerminalOp = i === lastTextIdx;
      const lang_ = lang === 'auto' ? detected.lang : lang;

      if (settings.text.punctuation?.enabled) {
        piece = smartPunctuate(piece, {
          lang: lang_,
          level: settings.text.punctuation?.level || 'safe',
          enabled: true,
          autoCapitalize: settings.text.autoCapitalize !== false,
          terminal: isTerminalOp
        });
      }
      if (settings.text.persianHalfSpace) piece = fixHalfSpace(piece, { joinWords: true, applySuffixes: true });
      if (settings.text.normalize) piece = normalizeSpacing(piece);
      piece = piece.replace(/\s+([،؛؟!.:…])/g, '$1');

      const result = this.reconciler.commitFinal(piece);
      if (result.duplicate) { duplicate = true; continue; }
      if (!result.appended) continue;
      inserted += result.text;
      out.push({ ...op, value: result.text });
    }

    // punctuation ops placed inline need a trailing space so the next text op is not glued to them
    for (let i = 0; i < out.length - 1; i += 1) {
      const op = out[i];
      if (op.type === 'text' && /^[،؛؟!.:…]$/.test(op.value)) op.value += ' ';
    }

    const resultMeta = {
      ...meta,
      lang: lang_,
      detected,
      replacements,
      commandMatches: parsed.matches,
      committedLength: this.reconciler.committedText.length
    };
    this.lastMeta = resultMeta;
    return { ops: out, text: inserted, matches: parsed.matches, meta: resultMeta, duplicate };
  }

  candidates(settings) {
    const list = ['fa-IR', 'en-US', 'ar-SA'];
    const manual = settings.language?.manualLang;
    if (manual && !list.includes(manual)) list.unshift(manual);
    for (const extra of settings.language?.extraCandidates || []) {
      if (!list.includes(extra)) list.push(extra);
    }
    return list;
  }
}
