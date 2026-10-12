# Fireworks and open-weight generation

Status: integration under benchmark validation, 2026-10-12. This is not a claim of Golpo parity.

## Setup

Run `pnpm cast keys set fireworks` from the repository root. The hidden prompt stores the key through the existing vault (macOS Keychain on this machine). Never put a key in source control or chat. `pnpm cast keys validate fireworks` checks authentication; it does not prove that the account has inference credits.

Automatic selection prefers Fireworks when its key exists. Set `INKCAST_PLANNER=anthropic` to explicitly use the existing Anthropic adapter, or `INKCAST_PLANNER=local` for the local planner. An explicitly selected provider without its key does not silently switch to another cloud provider. A failed cloud lesson is diagnostic fallback content and fails the strict gate before narration. Missing requested drawings in a cloud-authored lesson also fail before narration.

The initial default is `accounts/fireworks/models/deepseek-v4p1-flash`. Its [current model listing](https://app.fireworks.ai/models/fireworks/deepseek-v4p1-flash) exposes serverless inference, image input and tool calling. Both the authenticated model catalog and a live structured tool request succeeded on 2026-10-12. This establishes availability, not educational quality.

`INKCAST_FIREWORKS_MODEL` changes the default across model stages. Existing lane overrides (`INKCAST_LESSON_MODEL`, `INKCAST_DRAW_MODEL`, `INKCAST_ROUTER_MODEL`) take precedence. Use model IDs belonging to the selected provider. A visual stage requires image input support. Default DeepSeek V4.1 requests cap reasoning at 4,096 tokens; `INKCAST_FIREWORKS_REASONING` can specify a documented effort or numeric budget. Other models interpret these controls differently: consult the [reasoning parameter documentation](https://docs.fireworks.ai/api-reference/post-chatcompletions).

For the default DeepSeek model, lesson authoring and edits allow 65,536 output tokens; drawing authoring allows 32,768. Any truncated response gets one fresh attempt at the model card's 131,072-token budget. Reasoning counts toward output. Both attempts contribute to reported usage. Context overflow is an error instead of silently reducing the budget, and incomplete output is rejected even if its JSON looks valid. Requests have a bounded timeout scaled to the output allowance. Unknown model overrides retain caller budgets (minimum 8,192); we do not assume every model supports the same ceiling.

## What runs where

- Fireworks: lesson authoring, bounded script rewrite/review, diagram marks, drawing correction, art routing, free-form edits, rendered-frame review.
- Local: SVG/vector composition, editable text labels, label-to-part leader geometry, animation, rendering, video encoding, Kokoro speech.
- Optional fal/Replicate: raster illustrations. These remain separate providers and separate data disclosures.

Fireworks [deprecated audio inference and image generation on June 10, 2026](https://docs.fireworks.ai/updates/changelog#audio-inference-and-image-generation-deprecation). There is no new adapter pointing at those retired endpoints. A full one-key product with generated raster illustrations still needs a local image-model service. The current one-key path can draw vector graphics, but must not be advertised as supporting every image style locally.

With Fireworks selected, the default speech chain uses Kokoro, system speech, then a reported silent fallback; it does not silently use a stored ElevenLabs key. An explicit `elevenlabs:` voice opts into that provider. Use `--voice kokoro:af_heart` to pin local speech in a benchmark. System/silent fallbacks are not evidence of publishable narration.

## Data handling and claims

Fireworks' [privacy policy](https://fireworks.ai/privacy-policy) says API inputs are not used for training without explicit opt-in. Its [data-handling documentation](https://docs.fireworks.ai/guides/security_compliance/data_handling) describes default zero persistent retention of prompt/generation content for open models, with volatile prompt caching, usage metadata and opt-in exceptions. The Responses API has different storage defaults; this adapter uses Chat Completions.

Open weights alone do not establish privacy, commercial licensing, or lower total cost. The hosted provider receives prompts and images. Inkcast itself keeps source documents, lessons, generated assets and review caches locally. Optional image/voice providers have their own policies. Do not claim “everything stays on your device” for a Fireworks run, or “all providers never train on data” without checking each enabled service and account setting.

Appropriate scoped wording after deployment review: “Open-weight models, local rendering and speech, and inference providers configured without training opt-in.” Any stronger contractual promise requires checking the actual deployment, retention settings, model licenses and enabled providers.

## Cost and quality

The default model's published standard uncached rates were $0.30/M input and $1.20/M output tokens at the date above. Cost reports use provider token counts and mark the resulting list-price totals as estimates; prompt-cache discounts, account discounts and failed requests without reported usage prevent invoice reconciliation. Unknown Fireworks model rates are marked unpriced rather than charged at Anthropic rates.

The GPS source packet and acceptance checklist are in `examples/benchmarks/gps/`. Run:

```sh
pnpm cast examples/benchmarks/gps/source.md --project gps-fireworks --preset deepdive --seconds 150 --style blueprint --voice kokoro:af_heart
```

This is a source-assisted benchmark: the engine authors the lesson and drawings from supplied facts. It does not prove reliable retrieval for arbitrary bare topics. A successful render, schema validation, or model critique alone does not prove factual accuracy, correct label semantics, or parity with a curated competitor example.

## Narration quality upgrade (2026-10-12)

Neural speech now receives a whole scene paragraph rather than separately generated sentences. The assembler inserts no artificial pauses inside that paragraph and no longer slows an entire sentence to emphasize a word. ElevenLabs receives surrounding scene text for continuity; both it and Kokoro retain word alignment for visual cues. The renderer protects each cue from delays introduced by the pen queue, and QC checks the final label/equation schedule against the spoken words.

The opt-in ElevenLabs adapter defaults to `eleven_multilingual_v2` for controlled narration pace. The latest `eleven_v4` was live-tested, but ignores the speed control; its model-specific adapter sends only supported settings and does not claim a rate correction. See [ElevenLabs’ model-specific voice settings](https://github.com/elevenlabs/skills/blob/main/text-to-speech/references/voice-settings.md). `ELEVENLABS_MODEL_ID` still overrides it. This is a paid, proprietary voice option; it does not replace the zero-key Kokoro default or establish the all-open-weight deployment goal. The review voice is `SAz9YHcvj6GT2YYXdXww` (River, described in the account catalogue as relaxed, neutral and informative). [Timestamp and continuity API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps).

A stronger local speech service remains necessary to meet the open-weight quality target. [Qwen3-TTS 1.7B CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice) is an Apache-2.0 candidate with delivery instructions. It needs a separate serving and alignment evaluation before becoming an Inkcast adapter; it is not served by the current Fireworks text endpoint and has not been substituted into this benchmark. Any local service must preserve the TypeScript runtime contract and report the actual model, voice, alignment quality and hardware cost.

Lesson generation now checks the final script and visual instructions against supplied source text, with per-beat evidence and a bounded correction loop. A source correction is not subsequently shortened by another duration-fitting pass. The review is content-hashed so editing the script invalidates its verdict. A bare-topic consistency review explicitly does not count as source grounding. These are model checks, not a guarantee of factual truth or correct generated pixels.
