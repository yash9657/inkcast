# GPS landing showcase

The landing page features the GPS V4 review film approved by the user on
2026-10-13. Only the approved MP4, its English captions and an extracted poster
are public assets. Source projects, provider credentials and working files stay
outside the build.

- Source: `projects/gps-review-v4-20261012/out.mp4`
- Public film: `apps/web/public/showcase/gps-v4.mp4` (byte-for-byte copy)
- SHA-256: `266931a9d72dc158cee95b965142475a9a428a0422cdf661bfda30a6f7a99db9`
- Duration: 166.833 seconds; 1920 × 1080; H.264 video and AAC audio.
- Captions: copied from the same project's `captions.vtt`.
- Poster: actual frame at **78.64 seconds**, after both range circles and their
  highlighted intersections have been drawn. This shows the finished diagram
  without changing the film or seeking past its opening when playback starts.

Extract the poster with:

```sh
ffmpeg -ss 78.64 -i projects/gps-review-v4-20261012/out.mp4 \
  -frames:v 1 -q:v 2 apps/web/public/showcase/gps-v4-poster.jpg
```

The native player is user-initiated, supports inline playback and captions, and
uses `preload="none"` so landing-page visitors need not download the film before
pressing play. The approved media ships as static files with both hosted and
self-hosted builds, independently of project storage and account permissions.

Verified on a production Blob-mode build on the Mac mini: TypeScript and build
pass; Chromium playback, captions, seeking, and layouts at 1440, 768, 390 and
360 px pass, including light and dark themes. The browser fetches no MP4 before
play. Public media matches the approved SHA-256 and supports HTTP byte ranges.
A blocked video download shows a recovery link, and retry plays successfully
once the download is available again.

The film used Fireworks DeepSeek V4.1 Flash, ElevenLabs Multilingual v2 / River,
and cached fal illustrations, plus editorial repairs. See the
[review record](research/principal-audit-2026-10-12/gps-fireworks-v4.json) and
[pipeline handoff](PLAN-ENGINE-PARITY-2026-10-12.md) for quality evidence and
limitations; this showcase does not claim first-attempt or universal accuracy.
