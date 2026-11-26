# Image prompts for the marketing versions of these diagrams

These prompts turn the Mermaid diagrams on the other pages into collateral art: slides, the article (Choose, Pay,
Verify), social cards and video backdrops. They follow the site's image rules
([`apps/marketing/docs/IMAGE_PROMPTS.md`](../../apps/marketing/docs/IMAGE_PROMPTS.md)) and its palette
(`apps/marketing/app/globals.css`):

1. **No text in the image.** Image models garble labels, and words belong in the page where they can be read aloud and
   translated. Each prompt asks for blank label plates; the labels are set over the art afterwards (SVG or HTML), from
   the Mermaid source, so the marketing version can never say something the diagram does not.
2. **An image shows an idea, never a result.** Nothing may suggest a product state the status page does not list
   (no "live on mainnet" before it is).
3. **Never edit a prompt that has been run.** Add the next version and leave the old one.
4. **Log every run** below: day, provider, model, file, score (1 to 5, the lowest of palette, subject, no text, holds up
   at size) and notes.
5. **Programmatic first.** Our own CSS/JS versions come first; a paid run (OpenAI Images, Nano Banana) only after the
   owner has seen these prompts and said go. rtwin1 (`z-image-turbo`, free) may be used for drafts once the owner OKs
   the job list.

The text sent to a provider is always the style block, then the subject, then the size.

## Style block `diagram-v1`

> Flat editorial technical illustration, like a page from a well-made printed field guide. Palette only: paper #f4f0e6
> background, card #fffdf7 for panels, ink #14161a for outlines, violet #6a35d9 as the single strong accent (used only
> for the on-chain program), mint #14f195 for small highlights where money moves, green #0b7a4b sparingly for things
> that are working, amber #f2b53c only for things still being built, drawn with dashed outlines. Thick, even ink
> outlines, simple geometric shapes, flat front view, generous empty space, consistent line weight across the whole
> image. No gradients, no glow, no 3D rendering, no isometric perspective, no photorealism. No text, letters, numbers,
> logos or brand marks anywhere in the image; where a label belongs, leave a blank rounded plate in card colour with an
> ink outline. No people's faces. No coins, coin stacks, rising charts or other symbols of financial gain; money is a
> small plain mint disc.

## Style block `diagram-night-v1` (dark slides and video)

> The same as `diagram-v1`, on a night #101216 background with panels in #181b21, outlines in #ece9df, violet #b49cff
> as the single strong accent, mint #14f195 for money. Everything else unchanged.

## Prompts

| Id | Diagram | Use | Size |
|---|---|---|---|
| DIAG-01 | [01 System architecture](01-system-architecture.md) | Article header, deck "How it fits together" | 1920x1080 |
| DIAG-02 | [02 Mainnet target layout](02-mainnet-target-layout.md) | Deck "Built to keep keys apart" | 1920x1080 |
| DIAG-03 | [03 Per-call x402](03-per-call-x402.md) | Article, "Pay" section | 1600x900 |
| DIAG-04 | [04 Metered escrow](04-metered-escrow.md) | Article, "Pay for what you use" | 1600x900 |
| DIAG-05 | [05 Budget lifecycle](05-budget-lifecycle.md) | Hero of the Budget launch, social card | 1920x1080 and 1080x1350 |
| DIAG-06 | [06 Budget judge](06-budget-judge.md) | Article, "Verify" section | 1600x900 |
| DIAG-07 | [07 Ratings and attestations](07-rating-attestation.md) | Deck "Reputation you earn" | 1600x900 |
| DIAG-08 | [08 Receipts v2](08-receipts-v2.md) | Article, "Verify" section; share card | 1600x900 |

### DIAG-01 v1 (style `diagram-v1`, 1920x1080)

> A wide system map read left to right. On the left, three small rounded figures without faces: a person holding a
> plain wallet card, a small boxy robot agent holding a slim key, and a person at a workbench. In the middle, four
> separate rounded rectangular rooms drawn as flat panels with ink outlines, each with two or three blank label plates
> inside: the largest room has a small doorway the robot's key fits; the second, smaller room holds a sealed safe with a
> tiny padlock; the third holds three small identical machines in a row; the fourth is a simple storefront. Below them,
> a row of three plain cylinders for stored records. On the right, one large violet hexagonal block standing for the
> on-chain program, with a smaller vault box beside it joined by a short line carrying a mint disc. Thin ink connector
> lines with small arrowheads link the figures to the rooms and the rooms to the violet block. Two small clock faces
> without numerals sit above the largest room, one drawn with a dashed amber outline. Paper background, even spacing,
> nothing else in frame.

### DIAG-02 v1 (style `diagram-v1`, 1920x1080)

> The same kind of flat system map, now showing rooms deliberately set apart. Five separate rounded panels spaced
> widely on a paper background, with clear gaps between them: a front room with a doorway; a room holding a safe with a
> padlock, drawn twice side by side with a thin wall between the two safes; a room with three small machines and their
> own small wallet cards; a small watchtower panel with a bell, drawn with a dashed amber outline; and a small booth
> with a gavel resting on a plain block, also with a dashed amber outline. Each panel has one or two blank label
> plates. At the bottom centre, one large violet hexagonal block with a vault box beside it marked by two of three
> small keyholes filled. Thin ink lines run from each panel down to the violet block; no panel connects directly to
> another except the front room to the safe room. Generous empty space between panels to show separation.

### DIAG-03 v1 (style `diagram-v1`, 1600x900)

> A simple left to right sequence in three beats on a paper background. Left: a small boxy robot agent holds up a slim
> request card. Middle: a plain shop counter with a small bell; above it a blank ticket plate showing where the price
> would be. A single ink line runs from the robot's wallet card through a small split junction: most of the line
> carries one mint disc to the counter, a thin branch carries a much smaller mint disc to a small vault box. Right: the
> counter hands back an answer card with a long receipt slip attached and a small violet seal on it. Three blank label
> plates under the three beats. Nothing else in frame.

### DIAG-04 v1 (style `diagram-v1`, 1600x900)

> A clear glass jar with a ruled scale on its side, drawn in ink outline, standing on a paper background, filled to the
> top mark with small mint discs. A thin ink line leads from the jar to a small machine on the right that answers a
> request card. Below the jar, three short lines leave it: one to the machine carrying several mint discs, one very
> thin line to a small vault box carrying a single tiny disc, and one curling back to a robot agent on the left
> carrying the discs that were not used. The jar's level is shown dropping to a lower mark with a dashed outline of the
> old level. A small violet hexagon sits behind the jar as its lid. Blank label plates under the jar, the machine and
> the robot.

### DIAG-05 v1 (style `diagram-v1`, 1920x1080; also run at 1080x1350 with the same subject stacked top to bottom)

> A horizontal timeline story in five panels joined by one thin ink line, on a paper background. Panel one: a person's
> hand places mint discs into a large clear jar with a violet hexagonal lid and hands a slim key to a small boxy robot
> agent. Panel two: the jar's contents are divided by thin vertical ink dividers into three slices, each slice tagged
> with a blank plate and joined by a thin line to one of three small identical machines. Panel three: the robot holds
> the key up to a small doorway; behind the doorway a closed safe with a padlock, with only a small mint tick
> beside it; the machines each fill a short receipt slip. Panel four: the jar's lid closes, an hourglass stands beside
> it, a small bell rings above it. Panel five: the slices empty into three small open hands of the machines, a thin
> branch carries one tiny disc to a vault box, and leftover discs curl back to the person. A small gavel on a block
> sits beneath panel four with a dashed amber outline. Blank label plate under each panel.

### DIAG-06 v1 (style `diagram-v1`, 1600x900)

> A balance scale in ink outline at the centre of a paper background, its beam level. On the left pan, a short stack of
> receipt slips each with a small violet seal; on the right pan, a single slice of a jar drawn as a wedge. Behind the
> scale, a plain booth with a gavel resting on a block, drawn with a dashed amber outline because it is still being
> built. To the left, a person holds up a small flag; to the right, a small machine holds its receipt slips. Below, two
> thin lines leave the scale: one to the machine carrying a mint disc, one back to the person carrying a mint disc.
> Blank label plates under the person, the booth and the machine.

### DIAG-07 v1 (style `diagram-v1`, 1600x900)

> Two small figures facing each other across a plain table, one a person and one a small boxy machine, on a paper
> background. Each slides a sealed envelope into a shared ink-outlined box in the middle with a violet lid. In a second
> beat to the right, the box is open and both envelopes are open, each showing a blank card with a row of ten small
> empty circles where one is filled in mint. Above the table, two simple ledger books, each with one new ruled line
> filled. A third, smaller figure stands at the edge holding a clipboard with five blank ruled rows. Blank label plates
> under each beat.

### DIAG-08 v1 (style `diagram-v1`, 1600x900)

> A single long receipt slip lying flat on a paper background, divided by dashed lines into six blank ruled sections of
> different heights, the top section the largest. A small violet wax seal at the bottom of the slip. Thin ink leader
> lines from four of the sections run out to small plain icons around the slip: a speech bubble, an answer card, a
> small hexagon with a mint disc, and a short chain of three linked slips. A small magnifying glass in ink outline
> rests over the seal. Blank label plates at the end of each leader line. Nothing else in frame.

## Runs

No prompt here has been run yet.

| Id | Version | Day | Provider | Model | File | Score | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
