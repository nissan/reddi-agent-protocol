# RAP's own providers: a worked example

Two first-party providers run on this kit: the video scene and script writer (#846) and the humaniser. Their configs are here as an example of a real listing; their instructions are not. Each config points at a `*.prompt.private.txt` file kept on the host. Those files are ignored by git and left out of the npm package, so the house style rules are never published.

| Provider | Price (USDC per million tokens) | Most output per call |
| --- | --- | --- |
| Script writer | $3 input, $15 output | 4,000 tokens |
| Humaniser | $3 input, $15 output | 2,000 tokens |

Both are on the mid tier the specialist profiles use. The buyer locks the most a call can cost (the estimate for its input plus the output cap) and pays only for the tokens used; the protocol fee is 2.5% of that, taken from the provider's share.

## What the instructions do (outline only)

Script writer. The request is a brief: topic, audience, length and platform. The instructions ask for:

1. A short background section that a ten-year-old could follow, so viewers are not lost.
2. A scene-by-scene script: for each scene, what is on screen and the narration, timed to the requested length.
3. Writing that follows the house pattern list: no em dashes, none of the listed overused words, no forced groups of three, sentence-case headings, plain verbs.

Humaniser. The request is a draft. The instructions ask for the same text with the house patterns removed, the meaning, facts, names and numbers unchanged, and about the same length.

The full pattern list and style rules are the private part.

## Running one

1. Put the private prompt next to the config, for example `script-writer.prompt.private.txt`.
2. Replace the `REPLACE_WITH_...` values: the provider wallet (one wallet per provider), its public https address and the upstream model.
3. Set `"mock": false` and `UPSTREAM_API_KEY`, then `rap-provider doctor --config script-writer.provider.json` and `rap-provider start --config script-writer.provider.json`.

The host, model, wallets and listing wording are the owner's choices, and every mainnet transaction needs the owner's approval.
