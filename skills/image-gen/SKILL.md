---
name: image-gen
description: Generate an image from a text prompt and send it back through the active channel
version: 0.1.0
tools: [Bash]
triggers: ["generate an image", "make an image", "draw me", "draw a picture", "create an illustration", "make a picture", "mockup", "image of", "diagram showing", "visualize this", "render", "dall-e", "flux"]
effort: low
---

## When to use this

The user asks for an image: a diagram, a mockup, a cover art, a meme,
an illustration, "draw me X", "what would X look like", etc.

## The one-liner

```bash
bajaclaw image "<prompt>" --attach --caption "<short caption>"
```

That's the whole flow. `bajaclaw image`:

- Picks a provider automatically: OpenAI (gpt-image-1) if
  `OPENAI_API_KEY` is set, otherwise FAL (flux-schnell) if `FAL_KEY`
  is set.
- Saves the PNG to `~/.bajaclaw/profiles/<profile>/images/<ts>.png`.
- With `--attach`, pushes the image to the originating channel so the
  user sees it inline on Telegram or Discord, and as an iMessage
  attachment.

## Provider + model selection

- `--provider openai` pairs with `--model gpt-image-1` (default) or
  `dall-e-3`. `--size 1024x1024` / `1792x1024` / `1024x1792`.
- `--provider fal` pairs with `--model fal-ai/flux/schnell` (fast,
  cheap) or `fal-ai/flux/dev` (slower, higher quality). `--size
  landscape_4_3` / `square_hd` / `portrait_16_9`.
- `--provider auto` (default) picks whichever key is present.

## Procedure

1. Keep the prompt specific: subject, style, composition, lighting,
   color, mood. Vague prompts produce vague images.

2. Run the command. Example:

   ```bash
   bajaclaw image "flat vector illustration of a rocket launching through clouds, teal and orange palette, simple geometric shapes" --attach --caption "rocket launch illustration"
   ```

3. If the provider errors (rate limit, content policy), explain the
   specific error to the user and suggest a prompt rewrite. Do not
   retry indefinitely.

4. In your final reply, mention the image was generated and attached
   (or saved to a path if no channel is active). Do not re-describe
   the image at length; the user is looking at it.

## Pitfalls

- No API key set: command exits with a clear error. Tell the user to
  export `OPENAI_API_KEY` or `FAL_KEY` and rerun.
- `--attach` when running from the chat REPL (not a channel): no
  outbound channel to target. The file path is still printed; mention
  it in your reply.
- Large images on iMessage: AppleScript send is slow for files over
  a few MB. Prefer `--size 1024x1024` unless the user asks for a
  specific size.

## Verification

The command prints either a path (success) or a clear error
(failure). A successful `--attach` also returns ok:true from the
dashboard - the CLI prints `✓ attached <path>`.
