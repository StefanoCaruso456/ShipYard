# Frontend UI Rules

## Purpose
Define the visual system and interaction style for all frontend surfaces in this application.

This rule ensures the UI remains consistent, high-quality, and aligned with a professional AI coding workspace experience.

---

## Core Design Principle

The UI should feel like a **premium coding environment**, not a consumer app.

- calm
- dense
- structured
- minimal noise
- tool-focused

---

## Visual Style

### Theme
- Dark-first interface
- High contrast between surface layers, not text only
- Avoid bright or saturated colors

### Neumorphic Influence (Subtle)
- Use **soft depth**, not exaggerated neumorphism
- Combine:
  - subtle outer shadows
  - soft inner shadows (sparingly)
- Surfaces should feel slightly elevated, not inflated

### Panels
- Rounded corners (medium radius)
- Soft borders or no borders
- Slight background separation between layers

### Shadows
- Low blur, low opacity
- Used for hierarchy, not decoration
- Avoid heavy drop shadows

---

## Layout System (Codex-Inspired)

The app should follow a **workspace layout**, not a page layout.

### Structure
- Left sidebar -> navigation + threads
- Main panel -> active thread/workspace
- Bottom composer -> primary interaction
- Optional right/lower panels -> tools (diff, terminal, etc.)

### Density
- Compact but readable
- No oversized padding or spacing
- Designed for productivity, not browsing

---

## Typography

- Clean, modern sans-serif
- Consistent sizing scale
- Avoid large hero text except in empty states
- Use subtle color hierarchy:
  - primary text
  - secondary text
  - muted labels

---

## Interaction Model

- Fast, minimal transitions
- No heavy animations
- UI should feel responsive and immediate
- Focus on keyboard + command-style workflows over clicks

---

## Components

### Buttons
- Low-profile
- Minimal elevation
- Clear hover states

### Inputs
- Integrated into layout (not floating blocks)
- Subtle background contrast
- No heavy borders

### Lists (threads, projects)
- Tight spacing
- Clear active state
- Subtle hover state

---

## What To Avoid

- Bright gradients
- Glassmorphism-heavy effects
- Cartoonish or playful UI
- Large card-based marketing layouts
- Overuse of shadows
- Excessive whitespace

---

## Codex-Inspired Guidance

The UI should resemble:
- a coding workspace
- a task/thread-based system
- a multi-pane tool environment

It should NOT be:
- a chatbot page
- a landing page
- a generic dashboard

---

## Consistency Rule

All new frontend work must:
- follow this style
- reuse existing components when possible
- not introduce conflicting visual patterns

---

## Enforcement

If a UI decision conflicts with this rule:
- prefer consistency over novelty
- align with existing layout and style
