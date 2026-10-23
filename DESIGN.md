---
name: Barbershop Virtual Queue
description: A walk-in queue held on the Customer's own phone, run from the Owner's.
colors:
  barber-burgundy: "oklch(0.42 0.14 15)"
  barber-burgundy-foreground: "oklch(0.985 0.005 15)"
  focus-ring: "oklch(0.55 0.12 15)"
  ember-destructive: "oklch(0.58 0.2 38)"
  turn-amber: "oklch(0.8 0.16 75)"
  turn-amber-foreground: "oklch(0.25 0.06 60)"
  waiting-blue: "oklch(0.93 0.03 250)"
  waiting-blue-foreground: "oklch(0.35 0.08 255)"
  served-green: "oklch(0.52 0.13 150)"
  served-green-foreground: "oklch(0.985 0 0)"
  warm-paper: "oklch(0.995 0.003 15)"
  card-white: "oklch(1 0 0)"
  ink: "oklch(0.17 0.01 15)"
  blush-muted: "oklch(0.96 0.006 15)"
  muted-ink: "oklch(0.53 0.012 15)"
  blush-accent: "oklch(0.95 0.015 15)"
  blush-accent-foreground: "oklch(0.3 0.08 15)"
  hairline: "oklch(0.91 0.008 15)"
typography:
  ticket-number:
    fontFamily: "Clarity City, ui-sans-serif, system-ui, sans-serif"
    fontSize: "4.5rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: "\"tnum\""
  ticket-number-called:
    fontFamily: "Clarity City, ui-sans-serif, system-ui, sans-serif"
    fontSize: "6rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: "\"tnum\""
  headline:
    fontFamily: "Clarity City, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Clarity City, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Clarity City, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Clarity City, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.43
  eyebrow:
    fontFamily: "Clarity City, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    letterSpacing: "0.025em"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.875rem"
  full: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.barber-burgundy}"
    textColor: "{colors.barber-burgundy-foreground}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "2.75rem"
  button-call-next:
    backgroundColor: "{colors.barber-burgundy}"
    textColor: "{colors.barber-burgundy-foreground}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    height: "3.5rem"
    width: "100%"
  button-outline:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "2.75rem"
  button-destructive:
    backgroundColor: "{colors.ember-destructive}"
    textColor: "{colors.card-white}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    height: "2.75rem"
  input:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.25rem 0.75rem"
    height: "2.75rem"
  card:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "1.5rem"
  badge-waiting:
    backgroundColor: "{colors.waiting-blue}"
    textColor: "{colors.waiting-blue-foreground}"
    rounded: "{rounded.full}"
    padding: "0.25rem 0.75rem"
  badge-called:
    backgroundColor: "{colors.turn-amber}"
    textColor: "{colors.turn-amber-foreground}"
    rounded: "{rounded.full}"
    padding: "0.25rem 0.75rem"
  badge-served:
    backgroundColor: "{colors.served-green}"
    textColor: "{colors.served-green-foreground}"
    rounded: "{rounded.full}"
    padding: "0.25rem 0.75rem"
  badge-ended:
    backgroundColor: "{colors.blush-muted}"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.full}"
    padding: "0.25rem 0.75rem"
  called-screen:
    backgroundColor: "{colors.turn-amber}"
    textColor: "{colors.turn-amber-foreground}"
    typography: "{typography.ticket-number-called}"
    width: "100vw"
    height: "100vh"
---

# Design System: Barbershop Virtual Queue

## Overview

**Creative North Star: "The Ticket Stub"**

The interface behaves like the paper ticket a counter hands you: one big number, a few plain words, readable at arm's length and held up for the barber to see. Everything that isn't the number or the next action stays quiet (warm off-white paper, near-black ink, hairline borders) so the four status colours can do the talking. A Customer glances at it in bursts between other things, and an Owner taps it with one hand between haircuts. Both need to read it in a second.

The system is built from stock shadcn/ui (new-york style) on Tailwind 4, re-themed rather than restyled. Identity lives in the theme tokens: a burgundy primary, neutrals tinted toward that burgundy (hue 15), the Clarity City typeface, and a status palette that means the same thing on the Customer page and the Owner's board. Density is low on the Customer page (one column, 24rem max) and moderate on the dashboard (one column, 42rem max). Neither surface ever lays content out in more than one column.

Dark mode follows the device and is a full second token set, not an inversion. Every foreground and background pair meets WCAG AA in both modes.

**Key Characteristics:**
- One huge tabular ticket number per Customer screen, never smaller than 4rem.
- Status colour is the loudest thing on screen and means the same thing everywhere.
- Burgundy marks the shop's own actions; orange-red marks anything destructive, and the two never blur.
- Flat, bordered surfaces; depth comes from borders and tone, not shadows.
- Every tap target is at least 2.75rem; the most-used action is 3.5rem and pinned within thumb reach.

## Colors

A warm, paper-and-ink base with one burgundy voice and a four-colour status code.

### Primary
- **Barber Burgundy** (`barber-burgundy`): the shop's own colour. Filled primary buttons (Call next, Join queue, Stop the alert), the Heads-up banner ("Head back to the shop now"), the selected Last Call choice, the filled Last Call badge, and the border of the Last Call question card. In dark mode it lifts to `oklch(0.52 0.16 15)` so it still reads on near-black.
- **Focus Ring** (`focus-ring`): a lighter burgundy for keyboard focus rings at 50% opacity, 3px wide.

### Secondary
- **Ember** (`ember-destructive`): orange-red, shifted to hue 38 so it never reads as the burgundy. Only for Close Shop, Remove and other actions that end something. White text on it.

### Tertiary: Ticket status
The status palette is a fixed code shared by the Customer page and the queue board.
- **Waiting Blue** (`waiting-blue` on `waiting-blue-foreground`): a pale, cool chip for "N ahead of you" and Waiting rows. Deliberately calm; waiting is not urgent.
- **Turn Amber** (`turn-amber` on `turn-amber-foreground`): the Called colour, and the loudest colour in the system. It floods the whole Customer screen when Called and borders each Called card on the dashboard.
- **Served Green** (`served-green` on `served-green-foreground`): done.
- **Ended** (`blush-muted` on `muted-ink`): No-show, Left and Removed share the muted neutral. An ending is not an alarm.

### Neutral
- **Warm Paper** (`warm-paper`): page background, a hair warmer than white.
- **Card White** (`card-white`): cards, popovers and the dashboard header bar.
- **Ink** (`ink`): all body text, near-black with the burgundy tint.
- **Muted Ink** (`muted-ink`): secondary lines ("called 3 min ago", the in-person note, estimates).
- **Blush Muted / Blush Accent** (`blush-muted`, `blush-accent`): quiet fills for secondary buttons, hover states and the Ended status.
- **Hairline** (`hairline`): every border and input stroke. In dark mode borders become white at 10% (inputs 15%).

### Named Rules
**The Status Is Sacred Rule.** A status colour means one Ticket status and nothing else. Never use Turn Amber for a warning, or Served Green for a generic success toast.

**The Two Reds Rule.** Burgundy means "the shop's next step"; Ember means "this ends something". A destructive action is never burgundy, and a normal action is never Ember.

**The Token-Only Rule.** Colours come from theme tokens only, never fixed Tailwind palette colours or arbitrary values, so a Shop's look can later be changed by overriding tokens. `lib/theme-tokens.test.ts` enforces it.

## Typography

**Display Font:** Clarity City (with ui-sans-serif, system-ui, sans-serif)
**Body Font:** Clarity City
**Label/Mono Font:** Clarity City, with tabular numerals for every ticket number and countdown

**Character:** One geometric, slightly technical sans for everything. Clarity City's open forms keep numbers unambiguous at a distance, which is the whole job. It is self-hosted from `@clr/city` (Regular 400, Medium 500, SemiBold 600, Bold 700) via `next/font/local`.

### Hierarchy
- **Ticket Number** (`ticket-number`): the Customer's number on the Waiting card. Bold, tight, tabular. Sized so a four-digit `#1000` still fits a 360px card.
- **Ticket Number, Called** (`ticket-number-called`): the number on the full-screen Called state, one step bigger.
- **Headline** (`headline`): "It's your turn" on the Called screen; page titles on Owner pages are one step down at 1.5rem.
- **Title** (`title`): the shop name in the dashboard header, card titles, the Call next label.
- **Body** (`body`): running text and inputs. 1rem on phones so iOS does not zoom on focus.
- **Label** (`label`): form labels, badges, secondary lines, the dashboard's section names ("In chair", "Waiting"), whose counts sit beside them one step up at 1.125rem semibold.
- **Eyebrow** (`eyebrow`): uppercase, slightly tracked, muted. Used once, above the ticket number ("Your number").

### Named Rules
**The Tabular Number Rule.** Every ticket number, count and countdown uses tabular figures, so digits don't shift as they tick.

**The One Giant Rule.** A screen has at most one display-sized element, and on a Customer screen it is always the ticket number.

## Layout

Single column everywhere, mobile-first from a 360px minimum width with a 1rem side gutter.

- **Customer page:** centred column, 24rem max, 1.5rem vertical rhythm between blocks. The Leave button sits at the bottom of the column (`mt-auto`), away from anything the Customer taps often.
- **Owner dashboard:** centred column, 42rem max, 1rem between blocks. A bordered header bar holds the shop name and one 2.75rem menu button. The board is two headed sections, "In chair N" then "Waiting N", 0.5rem from heading to list. **Call next** is a sticky bottom bar, full-width, with a top hairline, naming the Ticket it will take on a second line. Last Call and Close Shop sit at the far end of the scroll from Call next, and the 5.5rem gap above the sticky bar is reserved for toasts so an Undo toast never covers a control.
- **Login:** centred column, 24rem max, vertically centred.
- **Spacing rhythm:** 0.5 / 0.75 / 1 / 1.5rem (`spacing.sm`–`xl`) carries almost everything; 0.25rem only inside badges.
- **Flexbox first:** every layout, from page columns to the rows inside a card, is a flex container (`flex flex-col` with `gap-*` for stacks, `flex items-center` for rows, `flex-1` and `mt-auto` to push an action to the end). Spacing between siblings comes from `gap`, not margins on the children. Grid is used only inside stock shadcn components (the card header) and is not reached for in app code.
- No breakpoint changes the structure: wider screens only get more margin.

### Named Rules
**The Rem Rule.** Every size, padding, gap, radius, width and font size is in rem (in Tailwind, the spacing and size scale: `h-11`, `px-4`, `max-w-sm`), so the whole interface grows with the reader's browser text size. Only hairlines stay in px: 1px borders, 2px emphasis borders and the 3px focus ring. Never fix a height or width in px (`h-[44px]`), and never cap a text container's height so larger text would clip.

**The Flex-First Rule.** Reach for flexbox before grid. The interface is a single column of stacks and rows, and flex with `gap` expresses that directly and wraps gracefully when text grows.

**The Thumb Reach Rule.** The Owner's most frequent action lives at the bottom of the screen; actions that end the day live as far from it as the page allows.

## Elevation & Depth

Flat by default. Depth comes from tone (Warm Paper page, Card White surface) and 1px Hairline borders, not shadows. The only shadows are shadcn's stock ones: a faint `shadow-sm` on cards, `shadow-xs` on outline buttons and inputs, and the default popover and toast shadows. Emphasis comes from a 2px coloured border (burgundy for the Last Call question, Turn Amber for Called cards) or from a full colour fill, not from lifting a surface.

### Named Rules
**The Border, Not Shadow Rule.** To make a card stand out, give it a 2px status or burgundy border. Never a bigger shadow.

## Shapes

Gently rounded, from one base radius of 0.625rem (`--radius: 0.625rem`). Buttons and inputs take 0.5rem (`rounded.md`), cards 0.875rem (`rounded.xl`), and badges and status chips are full pills. The Called screen is the one shape with no corners: it is the whole viewport.

## Components

Big, calm, sure: large flat targets with a light border, and one strong button per screen.

### Buttons
- **Shape:** gently rounded (0.5rem).
- **Primary:** Barber Burgundy fill, near-white text, 500 weight. Hover takes the fill to 90% opacity.
- **Sizes in use:** the shadcn default is 2.25rem, but app buttons are always raised to 2.75rem (`h-11`) or more: 3rem for Join queue and the Last Call choices, 3.5rem with 1.125rem semibold text for Call next and "Stop the alert".
- **Outline:** Warm Paper with a Hairline border; hover fills Blush Accent. Used for secondary actions (Last Call, the menu button, the unchosen Last Call option).
- **Destructive:** Ember fill, white text. Always behind a confirmation dialog.
- **Focus:** 3px Focus Ring at 50% opacity plus a ring-coloured border.
- **Disabled:** 50% opacity, no pointer events. Buttons disable while their action is pending, so a double tap can't fire twice.
- **Selected state:** a toggle choice becomes Primary with a leading "✓" and `aria-pressed`.

### Chips (Badges)
- **Style:** full pill, 0.75rem/500 by default; status chips in Customer or board context are scaled to 0.875–1.125rem with 0.75rem horizontal padding.
- **Status variants:** `waiting`, `called`, `served`, `ended`, each the status token pair. On the board, a Called ticket number is a Turn Amber chip in 1.125rem semibold tabular figures.
- **Joining state:** "Open" is an outline chip; "Last Call" is a filled burgundy chip, so a closing shop is hard to miss.

### Cards / Containers
- **Corner Style:** 0.875rem.
- **Background:** Card White on Warm Paper.
- **Shadow Strategy:** stock `shadow-sm` only (see Elevation).
- **Border:** 1px Hairline; 2px burgundy or Turn Amber when it needs the eye.
- **Internal Padding:** 1.5rem stock; dashboard Called cards tighten to 1rem.

### Inputs / Fields
- **Style:** 1px Hairline stroke, transparent fill (15% white in dark mode), 0.5rem radius, 1rem text.
- **Height:** 3rem (`h-12`) on the login form and the Customer's name field, matching the main button below them and leaving room for a 2.75rem icon button inside the field.
- **Focus:** the same 3px Focus Ring as buttons.
- **Error:** Ember border and a faint Ember ring via `aria-invalid`.

### Navigation
The dashboard has no nav bar: one 2.75rem outline menu button in the header opens a dropdown (Queue, History, Settings, Sign out), each item at least 2.75rem tall with a leading Lucide icon. The Customer page has no navigation at all; only the EN | BM toggle.

### Called Screen (signature)
The one state a Customer must notice from across a room. A fixed, full-viewport Turn Amber flood with the dark amber foreground; "It's your turn" as headline, the ticket number at `ticket-number-called`, "Go to the counter" at 1.5rem, then a 3.5rem burgundy "Stop the alert" button (only while the chime rings) and a transparent Leave button outlined in the foreground at 40%. Announced with `role="alert"` and `aria-live="assertive"`.

### Ticket Card (signature)
The Waiting state: a centred card with the eyebrow "Your number", the ticket number, an optional "Moved from previous day" secondary chip, and a Waiting Blue chip saying how many are ahead. The Heads-up banner sits directly beneath it as a full burgundy block. Before the Queue Day's first Call next it is replaced by a calm centred line in body text, no colour ("You're first in line. We'll alert you when the shop starts calling", or "The shop hasn't started calling yet. Your place in line is kept").

### Out-of-date Notice
Said only while a live screen has stopped hearing from the server: a Lucide wifi-off icon, "Not up to date", "As of 3:42 pm. Trying again…" and a Retry button, in neutral ink, never a status colour (nothing about any one Ticket changed). Two tones from one component (`components/out-of-date-notice.tsx`):
- **Quiet** (Owner's board): Blush Muted fill, 1px Hairline, 0.875rem text, outline Retry. The Owner is looking at the board anyway.
- **Strong** (Customer page): the ink inverted, near-black on light and light on dark, 1rem semibold title, secondary Retry, placed *above* the Ticket Card, which dims to 60% beneath it. The open page is the alert of last resort, and the quiet tone went unnoticed under a confident ticket number on a real phone.

## Do's and Don'ts

### Do:
- **Do** use stock shadcn/ui components and theme them through tokens; plain Tailwind is for layout only (flex, grid, spacing, sizing).
- **Do** make every tap target at least 2.75rem tall (44px at the default 16px text size), and the screen's main action 3–3.5rem.
- **Do** size everything in rem through Tailwind's scale, and lay it out with flexbox and `gap`.
- **Do** show ticket numbers and countdowns in tabular figures, at 4rem or more on the Customer page.
- **Do** pair every status colour with words; colour alone never carries a status.
- **Do** check both light and dark token sets when adding a colour pair; both must pass WCAG AA.
- **Do** put a confirmation dialog in front of every Ember action.

### Don't:
- **Don't** use fixed Tailwind palette colours (`bg-red-500`) or arbitrary values (`bg-[#…]`); the theme-token test will fail.
- **Don't** hand-style a control with Tailwind instead of using a shadcn variant.
- **Don't** use a status colour for anything except its Ticket status.
- **Don't** make a destructive action burgundy, or a normal action Ember.
- **Don't** add shadows for emphasis; use a 2px border or a fill.
- **Don't** fix heights or widths in px or arbitrary values (`h-[44px]`, `w-[320px]`); only 1–3px borders and focus rings are px.
- **Don't** use grid in app code where a flex stack or row does the job.
- **Don't** lay out the Customer page or the dashboard in more than one column.
- **Don't** add a theme toggle; dark mode follows the device.
