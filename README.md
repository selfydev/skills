<picture><source media="(prefers-color-scheme: dark)" srcset=".github/banner-dark.png"><img alt="skills: two claude code skills for designing in figma" src=".github/banner-light.png" width="960"></picture>

<a href="#install"><picture><source media="(prefers-color-scheme: dark)" srcset=".github/btn-install-dark.png"><img alt="install" src=".github/btn-install-light.png" width="95"></picture></a>&nbsp;<a href="https://snts.im/skills"><picture><source media="(prefers-color-scheme: dark)" srcset=".github/btn-site-dark.png"><img alt="snts.im/skills" src=".github/btn-site-light.png" width="140"></picture></a>&nbsp;<a href="https://github.com/southleft/figma-console-mcp"><picture><source media="(prefers-color-scheme: dark)" srcset=".github/btn-mcp-dark.png"><img alt="figma-console mcp" src=".github/btn-mcp-light.png" width="183"></picture></a>

two claude code skills i use when i design in figma. figma-render builds a screen from a layout spec. figma-verify checks a frame against your design system. you ask claude, and it writes the spec or runs the check through the figma desktop bridge.

&nbsp;

## figma-render

you describe the layout in json and the renderer builds it in figma. it calls the plugin api in an order that's been tested, so nodes land where the spec puts them, every frame uses auto-layout, and values bind to your variables. after each render a gate runs nine checks and names any node that fails one.

<picture><source media="(prefers-color-scheme: dark)" srcset=".github/render-dark.png"><img alt="a settings screen rendered in english and in arabic from one spec, with a gate table where all nine checks pass" src=".github/render-light.png" width="960"></picture>

<sub>illustration of a render and its gate output</sub>

### when i use it

- building a screen from the components and tokens in the file instead of placing layers by hand
- making the arabic version of a screen from the same spec, with the layout and icons mirrored
- importing design tokens (dtcg resolver format) as figma variables and text styles
- catching hand edits, since spec-parity fails once a frame drifts from its spec

<details>
<summary>the spec behind that frame</summary>

```json
{
  "screen": "Settings",
  "size": [390, 240],
  "direction": "ltr",
  "fill": "color.surface",
  "textColor": "color.text",
  "pad": "space.inset.md",
  "gap": "space.stack.sm",
  "children": [
    { "text": "Notifications", "style": "Title/Small" },
    {
      "stack": "Email row", "dir": "row", "justify": "between", "align": "center",
      "w": "fill", "pad": "space.inset.sm", "radius": "radius.md", "fill": "color.surface.raised",
      "children": [
        { "text": "Email updates", "style": "Body/Medium" },
        { "instance": "Switch", "props": { "State": "On" } }
      ]
    }
  ]
}
```

for the arabic frame, set `"direction": "rtl"` and `"lang": "ar"`. the renderer mirrors the layout, plus any icon listed in your mirroring manifest.

</details>

&nbsp;

## figma-verify

run it on a frame after a change and it compares colours, radii, borders, fonts, type scale and spacing with your design system, and flags any node that spills outside its parent. each finding gives the node, the value it found and the value it expected.

<picture><source media="(prefers-color-scheme: dark)" srcset=".github/verify-dark.png"><img alt="six findings on a checkout card: two high, three medium, one low, each with the found and expected value" src=".github/verify-light.png" width="960"></picture>

<sub>illustration of a verify report</sub>

### when i use it

- after claude or a teammate edits a frame, to see what drifted from the system
- before handoff, to get every off-token colour and stray radius in one list
- to apply fixes from a list i've approved, with each before and after logged

the palette, radii and font in `references/contract-baseline.md` and in the two `CONTRACT` blocks are placeholders. put your own in before you rely on the results.

&nbsp;

## install

```sh
git clone https://github.com/selfydev/skills
cp -R skills/figma-render skills/figma-verify ~/.claude/skills/
```

restart claude code and both appear in the skills list. ask for a screen, or ask claude to verify the frame you have selected.

## needs

- figma desktop running the [figma-console mcp](https://github.com/southleft/figma-console-mcp) desktop bridge, connected to claude code
- node 20 or later for figma-render (it has no dependencies)

## license

mit
