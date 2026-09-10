# GokBall — Neo-Brutalism / Flat Gaming UI Overhaul

## Objective

Redesign the existing GokBall web interface around a **Neo-Brutalism / Flat Gaming** visual system inspired by professional multiplayer football-game lobbies.

The result should feel like a polished, competitive multiplayer game interface rather than a generic SaaS dashboard or template.

**Important:** Preserve all existing functionality, game logic, networking, routing, backend integrations, room behavior, commands, and data flow. This task is a UI/UX redesign unless a small structural change is strictly required for the visual implementation.

---

## 1. Design Direction

Use a combination of:

- Neo-Brutalism
- Flat Gaming UI
- Esports / competitive game HUD
- Dark multiplayer lobby aesthetics
- Angular geometric panels
- Strong visual hierarchy

The interface should communicate:

- Competitive
- Modern
- Fast
- Confident
- Technical
- Football-focused
- Multiplayer
- Premium without looking luxurious or corporate

---

## 2. Color System

Create centralized design tokens / CSS variables for the following colors.

### Core

- Background: `#121212`
- Card / Panel: `#1E1E24`
- Secondary Surface: `#17171D`
- White: `#FFFFFF`
- Secondary Text: `#AEB4C0`
- Dark Border / Stroke: `#08090C` or `#0B0C10`

### Team Colors

- Red Team: `#FF5252`
- Blue Team: `#448AFF`

### Main Action

- Primary Action / Start: `#00E676`

Do not introduce random colors throughout the application.

Use the centralized tokens consistently across buttons, panels, borders, text, states, badges, controls and team elements.

---

## 3. Neo-Brutalist Rules

### Borders

Important UI containers should have a strong dark outline, approximately 2px where appropriate.

Borders should be visually intentional and consistent.

### Corners

Avoid the typical modern SaaS design where every element has large rounded corners.

Prefer:

- Sharp corners
- Slightly rounded corners
- Angular corners
- Chamfered / clipped corners
- Polygon-inspired details

Use rounded corners only where they improve usability.

### Shadows

Do not use large, soft, floating shadows.

Avoid:

- Heavy blur shadows
- Soft elevation systems
- Excessive drop shadows

If depth is needed, use:

- Borders
- Offset hard shadows
- Color blocks
- Layered panels
- Contrast

### Gradients

Avoid decorative gradients.

Do not use gradients simply to make the UI look “modern”.

The interface should primarily use flat colors and strong contrast.

### Glow

Do not use excessive neon glow.

Team colors and the green primary action can be strong without becoming neon/glowing effects.

---

## 4. Overall Layout

The lobby should have a strong game-room hierarchy.

Recommended desktop structure:

```text
┌─────────────────────────────────────────────────────────────┐
│                     TOP / ROOM HEADER                       │
├───────────────────────────────┬─────────────────────────────┤
│                               │                             │
│        GAME LOBBY              │           CHAT              │
│                               │                             │
│  RED TEAM   SPECTATORS  BLUE  │                             │
│                               │                             │
│                               │                             │
├───────────────────────────────┴─────────────────────────────┤
│                    GAME SETTINGS / CONTROLS                  │
├─────────────────────────────────────────────────────────────┤
│                     START GAME ACTION                       │
└─────────────────────────────────────────────────────────────┘
```

Do not blindly follow this exact structure if the current application has a better existing information architecture. Preserve existing functionality while improving hierarchy.

---

## 5. Header

Redesign the room header as a gaming HUD.

It should clearly communicate:

- Room name
- Room status
- Player count
- Host state
- Important room actions
- Leave / exit action

Avoid making the header look like a standard website navbar.

The header should feel like the top bar of a multiplayer game.

Use:

- Strong typography
- Dark background
- Angular separators
- Subtle geometric details
- Clear action buttons

---

## 6. Team Lobby

The team lobby is the visual centerpiece.

Create three distinct areas:

1. Red Team
2. Spectators
3. Blue Team

### Red Team

Use `#FF5252` as the main accent.

The team header should include:

- Team indicator
- Team name
- Player count
- Join button
- Jersey / kit selection action if available

### Blue Team

Use `#448AFF` as the main accent.

The structure should mirror the Red Team.

### Spectators

Use neutral dark colors.

Include:

- Eye / spectator icon
- Spectator count
- Watch / spectator controls where applicable

The three areas should feel like parts of one unified game lobby, not unrelated cards.

---

## 7. Player Rows

Player rows should be compact and information-dense.

Where supported by the existing application, display:

- Avatar
- Player name
- Player number / level
- Host indicator
- Connection / ping state
- Ready state
- Team information

Do not make player rows unnecessarily tall.

Use strong spacing and typography so the lobby can support multiple players without becoming visually crowded.

The host should be visually distinguishable but not oversized.

---

## 8. Primary Actions

The main action such as:

**OYUNU BAŞLAT**

should be visually dominant.

Use:

`#00E676`

for the main action.

Button rules:

- Strong dark border
- Flat color
- No unnecessary gradient
- No excessive rounding
- Strong typography
- Clear icon
- Good click target

### Interaction

Hover:

- Small upward movement or subtle scale
- Slight visual contrast increase

Active:

- Small downward movement
- Create a physical “pressed” feeling

Do not use excessive animation.

---

## 9. Secondary Buttons

Secondary controls should use:

- Dark surface
- Strong border
- White / secondary text
- Team color when the action is team-specific

Examples:

- Katıl
- Forma Seç
- İzle
- Takımları Kilitle
- Saha Yükle

These should look like game controls rather than generic web buttons.

---

## 10. Game Settings

Settings such as:

- Saha
- Gol Limiti
- Süre
- Hız
- Uzatma
- Other room/game settings

should be displayed as compact gaming controls.

Example:

```text
[ SÜRE: 3 DK ] [ GOL: 3 ] [ HIZ: X1.00 ] [ SAHA: KLASİK ]
```

These controls should not look like standard SaaS form inputs.

They should feel integrated into the multiplayer game lobby.

Use:

- Dark surfaces
- Strong borders
- Compact spacing
- Clear labels
- Strong values
- Consistent icons

---

## 11. Chat

The chat should visually belong to the same gaming interface.

Use:

- `#1E1E24` panel
- Strong dark border
- Compact header
- Clear message hierarchy
- Dark input field
- Green send button

Header:

**Sohbet**

Include an appropriate chat icon.

System information can use secondary text.

Team-related messages can use the relevant team color.

Do not make chat visually more important than the game lobby.

---

## 12. Background

Base:

`#121212`

The background should not be completely empty.

Use subtle geometric decoration such as:

- Large angular lines
- Dark diagonal shapes
- Clipped corner elements
- Very low-contrast blue/gray geometric blocks
- Thin structural strokes

These elements must remain subtle.

They should support the gaming identity without distracting from gameplay controls.

---

## 13. Typography

Use **Space Grotesk** as the primary font.

Especially use Space Grotesk for:

- Player names
- Player numbers
- Room name
- Headings
- Game values
- Buttons
- Team labels

Typography should be:

- Bold
- Compact
- Clear
- Strong
- Highly readable

Use a limited number of font weights.

Avoid overly thin typography for important game information.

---

## 14. GokBall Brand Identity

Do not turn the interface into a generic “gaming dashboard”.

The design should clearly feel like **GokBall**.

Maintain the football/multiplayer identity.

Use football-related visual language subtly:

- Small football icons
- Match indicators
- Score-oriented layouts
- Pitch-inspired geometry
- Competitive HUD details

Do not fill the interface with football icons.

The branding should remain clean.

---

## 15. Cards and Panels

Create a consistent panel system.

Every major panel should follow:

```text
Dark surface
+
Strong dark outline
+
Angular / controlled corners
+
Consistent padding
+
Strong typography
```

Do not make every piece of content its own card.

Avoid a “card collection” appearance.

Use large structural sections where appropriate.

---

## 16. Responsive Design

Desktop should be the primary design target.

However, the UI must remain fully responsive.

### Desktop

Use:

- Main lobby
- Three team columns
- Chat panel
- Settings controls
- Primary action

### Mobile

Stack the content logically:

1. Room header
2. Red Team
3. Blue Team
4. Spectators
5. Game settings
6. Start/action area
7. Chat

Do not create horizontal page overflow.

Buttons must remain easy to tap.

Player rows must remain readable.

Avoid fixed widths that break on small screens.

---

## 17. Interaction States

Implement consistent:

- Default
- Hover
- Active
- Focus
- Disabled
- Selected
- Loading

states.

Team selection should clearly communicate the selected team using the appropriate team color.

Focus states must remain accessible.

Animations should be:

- Fast
- Subtle
- Functional

Avoid excessive motion.

---

## 18. Existing Functionality Must Remain Intact

Before changing the UI:

1. Inspect the current application architecture.
2. Identify reusable components.
3. Identify existing design tokens.
4. Identify existing routes.
5. Identify room/game state management.
6. Identify team/player components.
7. Identify chat components.
8. Identify settings components.
9. Identify responsive behavior.

Then redesign the UI around the existing architecture.

Do not unnecessarily rewrite working business logic.

Do not break:

- Multiplayer functionality
- Room creation/joining
- Player movement
- Team assignment
- Spectator functionality
- Chat
- Room settings
- Game start
- Host functionality
- Commands
- Backend communication
- Networking
- Authentication
- Existing routes

---

## 19. Code Quality

Prefer reusable components over duplicated markup.

Create a consistent design system for:

- Buttons
- Panels
- Team headers
- Player rows
- Inputs
- Select controls
- Badges
- Icons
- Chat messages
- Settings controls

Use CSS variables / theme tokens for colors.

Do not scatter hex values throughout the codebase.

Avoid unnecessary dependencies.

Preserve the project's existing technology stack unless there is a strong reason to change it.

---

## 20. Visual Quality Checklist

Before considering the redesign complete, verify:

- [x] Background is `#121212`
- [x] Main panels use `#1E1E24`
- [x] Red team uses `#FF5252`
- [x] Blue team uses `#448AFF`
- [x] Primary action uses `#00E676`
- [x] Text uses `#FFFFFF` / appropriate secondary text
- [x] Strong dark borders are visible
- [x] Large soft shadows are removed
- [x] Excessive gradients are removed
- [x] Excessive glow is removed
- [x] Excessive rounded cards are removed
- [x] Angular / geometric design language is consistent
- [x] Space Grotesk is used as the primary font
- [x] Lobby hierarchy is immediately understandable
- [x] Team colors are immediately recognizable
- [x] Main action is visually dominant
- [x] Chat is secondary to the lobby
- [x] Mobile layout does not overflow
- [x] Existing functionality still works
- [x] No generic SaaS-dashboard appearance remains

---

## Final Design Target

The final result should feel like:

**“A professional multiplayer football game's room/lobby interface built with Neo-Brutalist design principles.”**

It should combine:

**Dark + Angular + Flat + Competitive + Football + Multiplayer + Clean**

without becoming:

**Glossy + Overly Neon + Glassmorphism + Generic SaaS + Excessively Rounded + Overdesigned.**
