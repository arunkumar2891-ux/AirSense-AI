# Hyperframes Composition Brief: AirSense AI

## Objective
Create a short, vertical (9:16) 4K launch-style brag video for AirSense AI (`2160x3840` MP4 rendered from a `1080x1920` 30fps Hyperframes composition via `--resolution portrait-4k`).

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4` (`2160x3840`, 30fps, 20.000s, frame 0 poster baked)
- Poster image: `brag-output/brag.jpg` (`2160x3840`)
- Format: `vertical` — `1080x1920` composition viewport, rendered at `portrait-4k` (`2160x3840`)
- Duration: `20s`

## Source Material
- Project root: `/agent/repos/AirSense-AI`
- Primary files read: `index.html`, `src/design-system.css`, `README.md`, `package.json`, `src/App.tsx`, `src/GoWindowPanel.tsx`, `src/FamilyPanel.tsx`, `src/ActivityTimeline.tsx`, `src/reliability.ts`, `src/gowindow.ts`, `src/family.ts`, `server/logic.js`, `server/gowindow.js`, `server/family-plan.js`
- Product name: `AirSense AI`
- Tagline / strongest claim: `"Understand the air you have. Choose a time that fits the activity."` / `"The decision is deterministic."`
- Key UI or visual moment to recreate:
  1. `CURRENT MODELLED AIR QUALITY` overview card (`US AQI · 0–500 SCALE`, `FORECAST ESTIMATE`, 6-band US EPA scale bar, `Default · Chennai` with explicit `SAMPLE FORECAST` badge)
  2. `GoWindow` scheduler (`Find my best time` click → 12-hour `ActivityTimeline` blocks → `Best forecast window` `4:00 PM – 4:45 PM · US AQI 39 · Good`)
  3. `Family air plan` card (`Children's outdoor play` child safety profile vs `Adult-only commute: Does not apply to children`, plus `Explain using AI` deterministic guardrail)
- Copy that must appear verbatim:
  - `AirSense AI`
  - `URBAN AIR INTELLIGENCE`
  - `CURRENT MODELLED AIR QUALITY`
  - `US AQI · 0–500 SCALE`
  - `FORECAST ESTIMATE`
  - `Find my best time`
  - `Best forecast window`
  - `Family air plan`
  - `The safety decision stays with the exposure engine.`
  - `Understand the air you have. Choose a time that fits the activity.`

## Creative Direction
- Tone preset: `polished`
- Creative direction: Crisp environmental-telemetry product film — editorial calm, precision UI choreography, zero hype
- Interpretation: Generous whitespace on AirSense AI's real cool-slate `#f4f6f9` canvas and `#ffffff` cards, high-legibility mobile typography (`≥ 28px` everywhere on `1080x1920`), crisp `expo.out` arrivals that settle dead still for reading, and explicit `US AQI` / `SAMPLE FORECAST` disclosures.
- Angle: One AQI number leaves people guessing whether a run, commute, or kids' outdoor play makes sense—and generic AI chatbots can soften a cautious reading. AirSense AI keeps every exposure decision, 12-hour GoWindow schedule, and child-governed household plan inside a deterministic rule engine, using AI only to explain validated facts.
- Hook: Frame 0 opens on the `AirSense AI` lockup and `"One AQI number isn't a plan."`, followed at `1.09s` by the `US AQI 108` (`Unhealthy for Sensitive Groups`) overview card showing `Running now · AVOID`.
- Outro / punchline: `"Understand the air you have. Choose a time that fits the activity."`
- Avoid:
  - Generic SaaS language ("streamline your workflow", "supercharge")
  - Abstract filler visuals or equalizer bars
  - Claiming live station measurements or medical advice (explicitly label sample forecast estimates and `US AQI`)
  - Text smaller than `28px` on the `1080x1920` canvas

## Visual Identity
- LOOK: Cool-slate telemetry paper `#f4f6f9` ground with crisp `#ffffff` cards (`1px` `#dfe4ec` border, `24px` video radius), `#101722` primary ink, `#3f4b5d` secondary ink, `#2563eb` cobalt brand accent (`#174ea6` readable cobalt on `#e8f0ff`), `#b45309` caution amber (`#fff5dc` fill), `#b91c1c` avoid crimson (`#fef2f2` fill); `Inter` 700/800 display (`-0.04em` tracking) + `Inter` 500/600 body + `JetBrains Mono` 600 telemetry labels; BANNED: dark neon cyberpunk redesigns, sub-28px micro-text, continuous floating/bouncing loops on landed cards, waveform visualizers.
- Background: `#f4f6f9`
- Text: `#101722`
- Accent: `#2563eb` (with `#174ea6` readable blue, `#b45309` caution, `#b91c1c` avoid)
- Display font: `Inter` (bundled in Hyperframes)
- Body font: `Inter` + `JetBrains Mono` for telemetry kickers/timestamps (both bundled in Hyperframes)
- Visual references from the project:
  - `.brand-icon` (`#2563eb` rounded square with white Wind SVG) + `AirSense AI` / `URBAN AIR INTELLIGENCE`
  - `.aqi-card.orange` (`3px` `#f59e0b` top border, `108` numeral, `US AQI · 0–500 SCALE`, `.scale-bar` 6-color gradient `#2563eb` → `#991b1b`)
  - `.gowindow-panel` + `.primary-btn` (`Find my best time`) + `.timeline-hour` blocks + `.gowindow-card.best` (`Best forecast window`)
  - `.family-panel` + `Explain using AI` guardrail note

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. `hook` — `2.73s` (`0.00s–2.73s`) — Frame 0 shows `AirSense AI` pill + `"One AQI number isn't a plan."`; on Beat 1 (`0.56s`) the `CURRENT MODELLED AIR` card (`Sample forecast · Default · Chennai`, `US AQI 108`, `Unhealthy for Sensitive Groups`, `Running right now · 45 min · AVOID`) rises briskly and cuts cleanly at `2.73s`.
2. `gowindow` — `7.10s` (`2.73s–9.83s`) — `GoWindow` profile (`Running · Adult · 45 minutes · Daytime`), simulated click on `Find my best time` (`3.82s`), 4 `ActivityTimeline` forecast blocks on the beat grid (`4.39s, 4.91s, 5.34s, 6.00s`), and enlarged mobile `Best forecast window` (`4:00 PM – 4:45 PM · US AQI 39 · Good`) beat-locked to `6.56s`.
3. `family` — `6.01s` (`9.83s–15.84s`) — `Family air plan` (`1 Young child · 2 Adults · 45 min · Daytime`) entering on `9.83s`, contrasting enlarged mobile recommendation cards for `Children's outdoor play` (`Now: Avoid outdoor play` / `Window: 4:00 PM – 4:45 PM · Good`) and `Adult-only commute: Caution` (`Does not apply to children · Walking & cycling separate`), then locking the enlarged `Explain using AI` guardrail (`"The decision is deterministic."` / `"The safety decision stays with the exposure engine."`) on `12.55s`.
4. `outro` — `4.16s` (`15.84s–20.00s`) — `AirSense AI · URBAN AIR INTELLIGENCE` lockup (`15.84s`) and beat-locked tagline (`16.38s`) `"Understand the air you have. Choose a time that fits the activity."` holding dead still through `20.00s`.

## Audio
- Audio role: Steady, clean instrumental support with sparse tactile UI accents
- Audio arc: Clean 110 BPM pulse from `0.0s` (`0.45s` fade-in), crisp click + warm reveal on GoWindow (`3.82s`, `6.56s`), soft card placement on Family (`9.83s`), gentle chime on the final lockup (`15.84s`), smooth `1.6s` fade-out to `20.0s`
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`
- Music treatment: `data-volume="0.32"`, `data-fade-in="0.45"`, `data-fade-out="1.6"`
- Music cue guidance: Bundled preset `.agents/skills/brag/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json` (`109.96 BPM`); beat cues `0.56s`, `2.73s`, `6.56s`, `9.83s`, `10.93s`, `12.55s`, `15.84s`; beat grid `4.39s, 4.91s, 5.34s, 6.00s`
- Audio-reactive treatment: Subtle; extract 30fps RMS/band energy via `extract-audio-data.py` and drive subtle build-time breathing (`opacity` / `scale` within 3–6%) on the `#atmosphere` radial glow layer behind the cards
- Audio-coupled moments:
  - Scene 2 (`3.82s`) — simulated cursor click on `Find my best time` (`interface/click_003.ogg`)
  - Scene 2 (`4.39s–6.00s`) — 4 forecast timeline blocks snapping onto `beats[]`
  - Scene 2 (`6.56s`) — `Best forecast window` reveal (`impact/impactSoft_medium_001.ogg`)
  - Scene 3 (`9.83s`) — `Family air plan` card entrance (`interface/drop_001.ogg`)
  - Scene 4 (`15.84s`) — Outro lockup payoff (`interface/bong_001.ogg`)
- SFX selection guidance: Low/medium HF risk sounds at restrained volumes (`0.36–0.46`) on non-overlapping or clean tracks
- SFX analysis guidance: `.agents/skills/brag/assets/sfx/sfx-analysis.md`
- Exact SFX choice: Hyperframes selects and copies exact files into `brag-output/composition/assets/sfx/`
- Audio files: Copy music and selected SFX into `brag-output/composition/assets/`

## Hyperframes Instructions
Load the composition-building Hyperframes skills — `hyperframes`, `media-use`, and `hyperframes-cli`. Skip generic storyline/SPEC/REVIEW steps per `/brag`; use `npx hyperframes check` as the pre-render gate, then render at 4K vertical (`--resolution portrait-4k --quality delivery`).
