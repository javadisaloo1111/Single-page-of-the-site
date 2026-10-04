/**
 * LocalAiEngine — placeholder for a fully local, in-browser model (transformers.js Whisper /
 * whisper.cpp WASM with a WebGPU backend).
 *
 * It exists so the architecture is proven to be engine-agnostic: the class implements the same
 * `SpeechEngine` contract, advertises its capabilities, and returns a precise reason while it
 * is unavailable. Wiring a real model means implementing `start/stop/onAudioLevel` here — no
 * other file in the extension has to change.
 *
 * Status: not implemented (deliberate). Building it requires shipping model weights
 * (40–600 MB) or downloading them at first run, which is a product decision, not a blocker.
 */
import { SpeechEngine } from './base.js';
import { ENGINES, ERR, STATE } from '../common/constants.js';

export class LocalAiEngine extends SpeechEngine {
  constructor(options) {
    super(options);
    this.id = ENGINES.LOCAL_AI;
  }

  get capabilities() {
    return {
      id: this.id,
      label: 'Local AI (in-browser)',
      streaming: true,
      interim: true,
      multiLanguage: true,
      offline: true,
      perWordLanguage: true,
      finalizeOnDemand: true,
      needsNetwork: false,
      needsApiKey: false,
      implemented: false
    };
  }

  static async probe() {
    const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    return {
      available: false,
      reason: 'not-implemented',
      roadmap: {
        recommended: 'transformers.js Whisper (whisper-small / distil) in the offscreen document',
        requirements: [
          'first-run model download with explicit user consent',
          hasWebGpu ? 'WebGPU detected — realtime is feasible' : 'WebGPU unavailable — CPU-only would be too slow for realtime'
        ]
      }
    };
  }

  async start() {
    this.setState(STATE.ERROR, 'local-ai-not-implemented');
    this.fail(ERR.UNSUPPORTED, { fatal: true, detail: 'local-ai-engine-not-implemented' });
    return false;
  }

  async stop() { this.running = false; }
  abort() { this.running = false; }
}

/**
 * Roadmap notes kept in code so the contract stays honest:
 *
 *  1. Move the model into the existing offscreen document (it already owns the microphone and
 *     the audio graph, and it is not affected by page CSP).
 *  2. Streaming strategy: 30s sliding window with 5s stride, Silero-VAD driven segmentation,
 *     `WhisperForConditionalGeneration` with `language: null` (auto-detect per chunk) — this is
 *     what makes true per-word code-switching possible offline.
 *  3. Prompt/`initial_prompt` can be reused from HttpWhisperEngine.buildVocabularyPrompt().
 *  4. Keep the interim event contract: emit partial hypotheses from the sliding decoder.
 */
export default LocalAiEngine;
