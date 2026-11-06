# skills

three claude code skills i use for design work. two of them drive figma, one writes replies.

## what's here

### design-reply

paste a message, ticket or issue that needs a reply. it gives you a short honest assessment first (what they're really asking, where they're right, where they're wrong), then a draft you can paste. it keeps a small file per thread so follow-ups pick up where they left off, and it runs every draft through a check for writing that reads as ai.

the voice is yours, not mine. `voice.md` is a template: on first run it asks for a few messages you actually sent and fills itself in. every time you correct a draft, the correction gets logged and the next draft avoids it. thread files go in `design-reply/threads/`, which is gitignored because they hold real conversations.

### figma-render

builds screens and components in figma from a json layout spec instead of hand-written plugin scripts. one tested renderer handles the plugin api call order, so you get auto-layout everywhere, bound variables, component sets and right-to-left mirroring without nodes landing in the wrong place. it also imports design tokens (dtcg resolver format) as figma variables and text styles, and runs a gate after each render that checks for overlap, overflow, clipped text, half pixels, default names and unbound values.

`src/token-values.mjs` holds no tokens of its own, only the rules that map token names to figma scopes and code syntax. bring your own resolver file. needs node 20 or later, no dependencies.

### figma-verify

checks a figma change against your design system after you make it: colours, radii, borders, fonts, type scale, nodes outside their parent's bounds. it's a set of read-only snippets you run through `figma_execute`, plus one that applies a curated list of property fixes with before and after logged. the palette, radii and font in `references/contract-baseline.md` and the two `CONTRACT` blocks are example values. replace them with yours before you rely on the results.

## install

copy the folders you want into `~/.claude/skills/`:

```sh
cp -R design-reply figma-render figma-verify ~/.claude/skills/
```

restart claude code and they show up in the skills list.

## requirements

- figma-render and figma-verify need figma desktop with the [figma-console mcp](https://github.com/southleft/figma-console-mcp) desktop bridge plugin running and the mcp connected to claude code.
- figma-render needs node 20 or later.
- design-reply needs nothing extra.

## license

mit, see `LICENSE`.
