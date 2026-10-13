# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
People making educational explainers from topics, documents, or web pages. The studio supports short videos for social feeds and longer explanations for lessons and presentations.

## Product Purpose
Inkcast turns source material into a narrated whiteboard video. A successful session ends with a video the user can preview, download, share, or revise.

## Operating Context
The public landing page introduces the output and sends a topic into the studio. The studio accepts text, files, and URLs, configures format and narration, shows generation progress, and opens the resulting project. The library holds projects. Settings manages personal provider keys.

## Capabilities and Constraints
Next.js / React / Tailwind v4 with Base UI primitives. The existing app supports light and dark themes, local planning and speech, optional cloud providers, account-aware access, generation progress, editing, download and public sharing. Hosted access requires sign-in when configured. Local self-hosting can operate without provider keys. Preserve authentication, API contracts, project ownership and provider isolation.

## Brand Commitments
Inkcast is the name. The user requested a substantial redesign, an improved logo including favicon, reusable design tokens throughout, and an intentional result without generic AI-template styling. The previous neo-brutalist appearance is being replaced.

## Evidence on Hand
Existing example sources in examples/, generated videos in projects/, and the live site at https://inkcast.video. No customer testimonials, adoption counts or new commercial promises are supplied.

## Product Principles
- Show the actual output and make the next action clear.
- Keep advanced production choices available without overwhelming a first-time creator.
- Explain loading, failure, empty and success states in useful language.
- Use consistent, accessible controls across every route and both themes.
