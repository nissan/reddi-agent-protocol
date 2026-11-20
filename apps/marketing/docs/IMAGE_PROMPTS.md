# Image prompt log for site collateral

Every image on the marketing site that came from an image model is recorded in `lib/image-prompts.ts` with the exact
prompt that made it. The log exists for two reasons: so the same image can be made again, and so providers can be
compared on quality over time using the same prompts.

## How it works

Each record is one version of one prompt. It names where the image goes, its size, a shared style block and the subject.
The text sent to a provider is always the style block, then the subject, then the size (`fullPrompt` builds it), so two
providers given the same record receive the same words.

A run is one generation: the day, the provider, the model, the file it produced if the image is kept, a score and notes.
Images kept in the site live under `public/art/`.

## Rules

1. Never edit a prompt or a style block after it has been run. Add the next version and leave the old one in place.
2. Log the run in the same change that adds the image. `tests/image-prompts.test.ts` fails when a file under
   `public/art/` has no run, when a run names a missing file, or when two runs claim one file.
3. No text, logos or brand marks in generated images. Words are set in the page, where they can be read aloud and
   translated.
4. An image shows an idea, never a result. Nothing in it may suggest a product state the status page does not list.
5. Record a score only after someone has looked at the image at full size.

## Scoring

One mark out of 5, the lowest of these four:

| Question | 5 | 1 |
|---|---|---|
| Does it follow the palette and line style? | Only the listed colours, even outlines | Other colours, gradients or glow |
| Is the subject what the prompt asked for? | Every named element, nothing extra | Missing or invented elements |
| Is it free of text and marks? | None | Any letters, numbers or logos |
| Does it hold up at the stated size? | Clean edges, no artefacts | Smears, broken shapes |

## Adding a run

1. Generate with `fullPrompt(record)` unchanged.
2. Save a kept image as `public/art/<id>-v<version>-<provider>.webp`, lower case.
3. Add the run to the record with the provider's own model name and the day.
4. Run `npm test`.

No image has been generated from these prompts yet. The campaign's own prompts (IMG-01 onwards) are kept with the
campaign plan; this log covers only images used on the site.
