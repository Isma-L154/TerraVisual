# Accessibility audit — 2026-09-08

Target: WCAG 2.2 level AA.
Scope: the whole application — editor, diagram, outline, details, problems,
import, sharing — in light and dark themes.

Seven defects were found and fixed. One of them was not an accessibility defect
at all: the diagram's selection had stopped working for **everybody**, and the
keyboard test is what noticed.

Everything the audit could not verify is listed at the end rather than left out.
The most important entry there is that no real screen reader has been run.

---

## How it was checked

| Method | What it covers | What it cannot |
|--------|----------------|----------------|
| axe-core across seven reachable states, both themes | Names, roles, contrast, structure | Whether an announcement is *useful* |
| Lighthouse (desktop, navigation) | The same mechanical third, independently | Its own report names ten items only a person can judge |
| A keyboard journey driven by real key presses | Reach, operation, focus visibility, traps | What any of it sounds like |
| Reading the accessibility tree | The exact names and roles handed to assistive technology | How a given screen reader renders them |
| Computed contrast against the theme tokens | 1.4.3 and 1.4.11 arithmetic | Perception |

**Focus was moved by pressing Tab, never by calling `focus()`.** That distinction
produced two false failures early on and one real one: Chrome only treats focus
as keyboard focus when it arrived from the keyboard, so a scripted `focus()`
reports focus rings that a real user would never see, and hides ones they would.

---

## What was found and fixed

### 1. A focused diagram node showed no focus at all — WCAG 2.4.7, serious

React Flow's stylesheet contains:

```css
.react-flow__node.selectable:focus,
.react-flow__node.selectable:focus-visible {
  outline: none;
}
```

A keyboard user tabbing into the diagram had no indication of where they were.
Confirmed in the browser rather than inferred: the focused element matched
`:focus-visible` and computed `outline-style: none`.

Fixed in `web/src/styles.css` with a rule specific enough to outrank it, using a
negative offset so the ring sits inside the node's footprint rather than over
its neighbour.

### 2. Selecting a node did nothing — WCAG 2.1.1, and a functional bug

Pressing Enter on a focused node did not select it. Neither did clicking one.
The details pane stayed empty and the code was never revealed, so the whole
diagram-to-code direction of the product was inert.

The cause was not accessibility-shaped. `nodes` is a controlled prop, and React
Flow will not apply a selection to a controlled array — it emits the change and
waits for the owner to apply it. With no `onNodesChange` handler, it emitted
into nothing:

```
onNodesChange log for a click:
  (never called with a select change)
```

Fixed in `web/src/diagram/Diagram.tsx` by handling `onNodesChange` and
translating selection changes into the application's own `selectedId`, which is
already what the editor and the outline read. After the fix, the same probe
records `[{"id":"aws_route_table.public","type":"select","selected":true}]`.

Worth stating plainly: this had been broken since the diagram was built, and no
unit test caught it because the failure only exists in a real browser with real
layout. It was found by a test asking whether a keyboard user could operate the
diagram.

### 3. Diagram nodes had no accessible name — WCAG 4.1.2

Each node exposed `role="group"` with `aria-roledescription="node"` and no
`aria-label`, so a screen reader announced "node, group" and then read whatever
text was inside. The outline, meanwhile, had carefully written descriptions.

Fixed by giving both views the same words. The announcement builder moved to
`web/src/diagram/catalog.ts` and is used by the outline and the diagram alike:

```
aws_subnet.private -> "private, Subnet, aws, in main, 1 value not determinable, contains 1"
aws_vpc.main       -> "main, VPC, aws, in eu-west-1, contains 4"
```

Two views of one model should not need two vocabularies, and somebody moving
between them should never find that the picture said something the text did not.

### 4. The diagram promised interactions it does not have — WCAG 3.3.2

React Flow's default description is read on every node:

> "Press enter or space to select a node. You can then use the arrow keys to
> move the node around. Press delete to remove it and escape to cancel."

Nothing here can be moved or deleted: positions come from the layout module, and
the only way to change the picture is to change the Terraform. The instruction
wasted the time of exactly the users this description exists for.

Replaced through `ariaLabelConfig` with what is actually true — that selecting
shows the details and highlights the code that declares it. The edge description
was corrected too: edges here are neither focusable nor selectable, so offering
to select one was the same mistake in miniature.

### 5. The editor took Tab with no advertised way out — WCAG 2.1.2

Tab indents inside CodeMirror, which is right for an editor and is a keyboard
trap unless the exit is documented. The exit existed — Escape, then Tab — but
was written only in a source comment.

Fixed with a visible line under the editor, wired as the editor's accessible
description:

> Tab indents. To leave the editor, press Escape and then Tab.

Visible rather than screen-reader-only on purpose: a sighted keyboard user is
just as stuck, and hears nothing.

### 6. Three syntax colours failed contrast — WCAG 1.4.3

Measured against the active-line background, not only against the page:

| Token | Was | Against active line | Now | Now |
|-------|-----|--------------------|-----|-----|
| `--syntax-comment` (light) | `#6b7280` | **4.25** | `#5f6570` | 5.15 |
| `--syntax-string` (light) | `#0a7d55` | 4.52 | `#097049` | 5.38 |
| `--syntax-type` (light) | `#b45309` | **4.41** | `#a34a08` | 5.21 |
| `--syntax-comment` (dark) | `#7b7b90` | **3.89** | `#9090a6` | 5.16 |

The active line matters: it is where the cursor is, so it is the background the
code being written is read against.

### 7. The outline miscounted siblings — WCAG 4.1.2

`aria-setsize` and `aria-posinset` counted every item at the same depth rather
than the items sharing a parent, so a screen reader announced "2 of 14" where 14
was every resource on that level of the diagram. Somebody navigating by ear was
told there were things beside this one that were not there.

Fixed, with a test that fails without the fix — two VPCs each holding one
subnet is the only shape where counting by depth and counting by parent
disagree.

Also corrected while there: connection phrasing read "to internet to main",
because the catalog's labels are already prepositional. It now reads
"connects to main (to internet)".

---

## What passes, with the evidence

| Criterion | Result | Evidence |
|-----------|--------|----------|
| 1.4.3 Contrast (minimum) | Pass | axe reports no contrast violations on seven states in both themes, after the token fixes |
| 1.4.4 Resize text | Pass | Root font size at 200%: `scrollWidth 1280 <= clientWidth 1280` — no horizontal scrolling |
| 1.4.10 Reflow | Pass | At a 320-pixel viewport: `scrollWidth 320 <= clientWidth 320` |
| 1.4.11 Non-text contrast | Pass | Every category colour against its surface: light 4.76–7.90, dark 6.93–10.84 (3.0 required). Focus ring 5.67 light, 7.14 dark |
| 1.4.12 Text spacing | Pass | Layout is flex and grid throughout, with no fixed text-block heights |
| 2.1.1 Keyboard | Pass, after fix 2 | The whole journey runs from the keyboard: write, read the diagram, walk the outline, fix a problem, share |
| 2.1.2 No keyboard trap | Pass, after fix 5 | Escape then Tab leaves the editor, asserted in the suite; the way out is on the page |
| 2.4.1 Bypass blocks | Pass | The skip link is the first tab stop and moves focus to the workspace |
| 2.4.3 Focus order | Pass | The tab order follows the visual order: skip link, import, reset, editor, view switch, diagram, details, problems, share |
| 2.4.7 Focus visible | Pass, after fix 1 | Every stop in the tab order has an outline or a ring, asserted on each stop |
| 2.5.8 Target size | Pass | No interactive element is under 24 by 24 CSS pixels, outline rows included |
| 1.1.1 / 1.3.1 Structure | Pass | Landmarks, one `h1`, each pane a named region, the outline a real ARIA tree |
| 1.4.1 Use of colour | Pass | Provider, category, severity and unknown counts are words as well as colour. In Chromium's forced-colours mode everything stays legible and no information is lost, because nothing was carried by colour alone |
| 2.3.3 Animation from interactions | Pass | `prefers-reduced-motion` caps every transition and animation; asserted by measuring computed durations, not by trusting the media query |

Lighthouse scores accessibility **100** on the opening screen — and its own
report says why that is a floor rather than a verdict: 23 automated checks
applied, and ten items are listed as things only a person can judge, including
"the page has a logical tab order", "user focus is not accidentally trapped",
and "interactive elements indicate their purpose and state". Those ten are what
the keyboard journey and this report are for.

---

## What could not be verified

1. **No real screen reader has been run.** This is the significant gap. The
   accessibility *tree* was read directly — names, roles, levels, set sizes —
   and it is correct. How NVDA, JAWS or VoiceOver actually voice it is a
   different question: verbosity settings, punctuation handling, and how each
   one treats `aria-roledescription="node"` all change what a person hears. The
   issue asked for a pass on two screen readers; that has not happened, and no
   automated check substitutes for it.
2. **Real Windows High Contrast.** Chromium's forced-colours emulation was used.
   A real high contrast theme with the user's own colour choices can differ.
3. **Voice control and switch access.** Not tested. Voice control in particular
   depends on visible labels matching accessible names, which is likely fine
   here but unverified.
4. **Screen magnification at high zoom.** 200% text was tested; 400% zoom with a
   magnifier, where reflow and focus tracking usually break, was not.
5. **Mobile screen readers.** TalkBack and iOS VoiceOver have their own gestures
   for trees and groups. Untested.
6. **2.4.11 Focus not obscured.** No case was found where a focused element ends
   up behind a sticky element, but this was not exhaustively checked across
   viewport sizes.
7. **Cognitive accessibility.** Whether the diagram actually makes infrastructure
   easier to understand — the product's entire purpose — is a question for
   people learning Terraform, not for a scanner. It needs user testing.

---

## What stops this regressing

Twenty-two browser tests run on every pull request, against the real deployment
Worker serving the real build, under the production Content Security Policy:

- axe-core over seven reachable states, in both themes;
- the complete keyboard journey, driven by key presses;
- focus visibility at every stop in the tab order;
- the editor's escape hatch, and that it stays documented;
- reflow at 320 pixels, text at 200%, target sizes;
- reduced motion, measured rather than assumed;
- that the diagram never again promises an interaction it does not have.

Every one of the seven defects above would fail one of these tests today. That
is the point: the audit is a moment, and the suite is what carries its result
forward.
