---
name: build-learn-app
description: Generate an interactive visual learning app for any codebase. Analyzes the project, asks calibration questions, then generates markdown notes + animated visual diagrams + a React app.
---

# Build Learn App

You are building an interactive visual learning application for this project. The app will help team members understand the codebase through animated diagrams, step-by-step visual walkthroughs, and rendered markdown notes.

## Phase 1: Calibration (ASK BEFORE DOING ANYTHING)

Before generating any content, you MUST ask the user these calibration questions. Ask them one at a time, provide multiple choice where possible, and mark your recommended option.

### Question 1: What to Cover

> What should this learning app cover?
>
> - **(A) Full tech stack overview** — cover every technology, architecture pattern, and system component (recommended for onboarding new team members)
> - **(B) Specific features / business logic** — focus on particular features, flows, or domain logic that are hard to understand from code alone
> - **(C) New technology deep-dive** — deep-dive into specific technologies the team is adopting
> - **(D) Architecture & patterns** — focus on system design, service boundaries, data flows, communication patterns
> - **(E) Custom** — let the user describe exactly what to cover
>
> If they pick (B) or (E), ask them to list the specific areas.

### Question 2: Depth Level

> How deep should the explanations go?
>
> - **(A) Surface overview** — what each thing does, how they connect, enough to navigate the codebase (5-10 visuals per topic)
> - **(B) Working knowledge** — how things work internally, key patterns, enough to make changes confidently (10-20 visuals per topic) **(recommended)**
> - **(C) Deep internals** — how everything works under the hood, algorithms, data structures, failure modes (20+ visuals per topic, like Eatiko Learn)

### Question 3: End User Knowledge Level

> Who will use this learning app?
>
> - **(A) Junior developers** — new to programming, need fundamentals explained (more analogies, simpler language)
> - **(B) Mid-level developers joining the team** — know programming but new to this codebase (recommended — focus on "why" decisions and codebase-specific patterns)
> - **(C) Senior developers** — deep technical knowledge, just need codebase-specific context (skip fundamentals, focus on architecture decisions and non-obvious patterns)

### Question 4: Visual Style

> How visually dense should the diagrams be?
>
> - **(A) Key concepts only** — 1-2 visuals per section, high-level diagrams
> - **(B) Comprehensive** — visual for every major concept, animated step-by-step (recommended)
> - **(C) Maximum** — every single concept gets a visual, nothing left as text-only

### Question 5: Existing Documentation

> Does this project have existing documentation?
>
> - If YES: ask where the docs are located. The app will render them alongside visuals.
> - If NO: the AI will generate learning notes from codebase analysis.
> - If PARTIAL: the AI will supplement existing docs with generated content for undocumented areas.

### Question 6: App Location

> Where should the learning app be created?
>
> Default: `./learning/app/` in the project root. If the project is a monorepo, suggest `./apps/learn/` instead.
> Notes default: `./learning/notes/` (or use existing docs path if provided).

After all questions are answered, summarize the plan and ask for confirmation before proceeding.

---

## Phase 2: Codebase Analysis

Once calibrated, analyze the project to understand what to teach.

### Step 2.1: Explore the Codebase

Use the Explore agent or direct file reads to understand:

- **Project structure** — directories, key files, monorepo layout if applicable
- **Tech stack** — languages, frameworks, databases, message brokers, ORMs, etc.
- **Architecture** — service boundaries, communication patterns, data flow
- **Key patterns** — authentication, error handling, middleware, DI, etc.
- **Complex areas** — business logic, algorithms, non-obvious flows
- **Existing docs** — README, architecture docs, ADRs, inline comments

Read these files if they exist:
- `README.md`, `CLAUDE.md`, `AGENTS.md`
- `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml`
- `docker-compose.yml` / `Dockerfile`
- Any `docs/` or `doc/` directory
- Architecture decision records (ADRs)
- Configuration files that reveal the stack

### Step 2.2: Define the Topic Tree

Based on the analysis and calibration, define topics and modules:

```
Topic: "Database Layer"
  Module: "Schema Design"
    Visuals: schema diagram, relation map, migration flow
  Module: "Query Patterns"
    Visuals: repository pattern, transaction handling, N+1 prevention
```

Rules for topic organization:
- Group by **conceptual area**, not by file structure
- Order from **foundational → advanced** (what you need to know first → what builds on it)
- Each module should have **3-15 visuals** depending on depth level chosen
- Name topics for what the learner will understand, not what the code is called

---

## Phase 3: Scaffold the App

### Step 3.1: Fetch the Template

```bash
npx degit howincodes/basha-learn-kit/template <app-location>
cd <app-location>
npm install  # or pnpm install
```

If `degit` is not available or fails, manually create the template files. The template structure is:

```
<app-location>/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
└── src/
    ├── main.tsx
    ├── app.tsx
    ├── index.css
    ├── types.ts
    ├── vite-env.d.ts
    ├── store/app-store.ts
    ├── store/index.ts
    ├── hooks/use-markdown-content.ts
    ├── data/content.ts               ← YOU FILL THIS
    ├── components/
    │   ├── sidebar.tsx
    │   ├── main-content.tsx
    │   ├── step-controls.tsx
    │   ├── visual-canvas.tsx          ← YOU FILL THIS
    │   ├── markdown-renderer.tsx
    │   └── code-block.tsx
    └── components/visuals/
        ├── visual-wrapper.tsx
        ├── animated-box.tsx
        └── templates/                 ← Reusable visual templates
            ├── flow-diagram.tsx
            ├── comparison-table.tsx
            ├── layer-stack.tsx
            ├── state-machine.tsx
            ├── pipeline.tsx
            ├── terminal-output.tsx
            ├── timeline.tsx
            └── architecture-diagram.tsx
```

### Step 3.2: Adjust Markdown Loader Path

In `src/hooks/use-markdown-content.ts`, update the glob path to point to where notes live relative to the app:

```typescript
// If notes are at ../../learning/notes/ relative to src/hooks/:
const markdownFiles = import.meta.glob<string>(
  '../../learning/notes/**/*.md',  // ← adjust this path
  { query: '?raw', import: 'default', eager: false },
);
```

The glob key used for lookup must match:
```typescript
const globKey = `../../learning/notes/${noteFile}`;  // ← same prefix
```

### Step 3.3: Update vite.config.ts Port

Set a port that doesn't conflict with the project's dev server. Default: 5200.

---

## Phase 4: Generate Content

### Step 4.1: Generate Markdown Notes

For each module, generate a markdown file in the notes directory:

```
learning/notes/
├── database/
│   ├── 01-schema-design.md
│   └── 02-query-patterns.md
├── auth/
│   └── 01-authentication-flow.md
└── api/
    ├── 01-rest-endpoints.md
    └── 02-middleware-chain.md
```

Writing guidelines:
- Start each module with **WHY** (the problem this solves) before **WHAT** (how it works)
- Use the project's actual code examples, file paths, and configuration
- Include actual commands the reader can run
- Reference specific files: "See `src/middleware/auth.ts` for the implementation"
- Match the depth level from calibration
- Use GFM (tables, code blocks with language tags, callout blocks)

### Step 4.2: Generate Visual Components

For each visual, create a component using the template library where possible:

**Prefer template components** for common patterns:
- Architecture overview → `<ArchitectureDiagram>`
- Request flow → `<Pipeline>`
- A vs B comparison → `<ComparisonTable>`
- State transitions → `<StateMachine>`
- Layer/stack diagrams → `<LayerStack>`
- CLI walkthroughs → `<TerminalOutput>`
- Event sequences → `<Timeline>`
- Data/service flows → `<FlowDiagram>`

**Use custom SVG** only when templates can't express the concept (rare, complex, or highly specific visuals).

Each visual component:
- Goes in `src/components/visuals/<topic>/<visual-id>.tsx`
- Exports a named component accepting `{ step: number }`
- Uses `VisualWrapper` for layout + step description
- Has a barrel export in `src/components/visuals/<topic>/index.ts`

### Step 4.3: Fill the Content Registry

Update `src/data/content.ts` with all topics, modules, and visual definitions:

```typescript
export const TOPICS: Topic[] = [
  {
    id: 'database',
    title: 'Database Layer',
    tier: 1,
    icon: '🗄️',
    modules: [
      {
        id: 'database-schema',
        title: 'Schema Design',
        topicId: 'database',
        noteFile: 'database/01-schema-design.md',
        visuals: [
          {
            id: 'DB-1',
            title: 'Entity Relationship Diagram',
            moduleId: 'database-schema',
            steps: [
              { title: 'Core Entities', description: 'The 5 main tables...' },
              // ...
            ],
          },
        ],
      },
    ],
  },
];
```

After defining TOPICS, call `rebuildMaps()` to populate the lookup helpers.

### Step 4.4: Wire the Visual Canvas

Update `src/components/visual-canvas.tsx`:
1. Import all visual components from their barrel exports
2. Register them in `VISUAL_REGISTRY` mapping visual ID → component

```typescript
import { DB1EntityDiagram, DB2QueryFlow } from '@/components/visuals/database/index';

const VISUAL_REGISTRY: Record<string, ComponentType<VisualComponentProps>> = {
  'DB-1': DB1EntityDiagram,
  'DB-2': DB2QueryFlow,
  // ...
};
```

---

## Phase 5: Verify

1. Run `npx tsc --noEmit` — must pass with zero errors
2. Run the build: `npm run build` or `pnpm run build` — must succeed
3. Start dev server: `npm run dev` — verify at http://localhost:5200
4. Check that:
   - Sidebar shows all topics and modules
   - Clicking a visual shows the animated diagram
   - Arrow keys navigate between steps
   - Split mode shows both visual and notes
   - Notes render with syntax highlighting

---

## Visual ID Convention

Use a prefix based on the topic:
- `DB-1`, `DB-2` for database
- `API-1`, `API-2` for API
- `AUTH-1` for authentication
- `ARCH-1` for architecture
- etc.

---

## Animation Guidelines

- **Duration:** 300-500ms transitions, 150ms hover
- **Easing:** Spring-based (`type: 'spring', bounce: 0`) for enter/leave
- **Colors:** Use consistent semantic colors:
  - `#3b82f6` (blue) — primary, services, processes
  - `#10b981` (green) — success, completed, safe
  - `#f59e0b` (amber) — warnings, storage, databases
  - `#ef4444` (red) — errors, failures, dangerous
  - `#8b5cf6` (purple) — network, communication, events
  - `#64748b` (slate) — neutral, infrastructure
- **Stagger:** 50-80ms between elements appearing in sequence
- **Every animation serves understanding** — no gratuitous motion

---

## Quality Checklist

Before claiming the learn app is complete:

- [ ] Every module has at least 3 visuals (or matches calibration depth)
- [ ] Every visual has meaningful step descriptions (not generic)
- [ ] Notes reference actual project files and code
- [ ] TypeScript strict mode passes
- [ ] Vite build succeeds
- [ ] Dev server runs and all topics are navigable
- [ ] Visuals render correctly (not blank/collapsed)
- [ ] Notes render with syntax highlighting
- [ ] Step controls work (arrow keys, auto-play)
- [ ] Progress tracking persists across page reloads
