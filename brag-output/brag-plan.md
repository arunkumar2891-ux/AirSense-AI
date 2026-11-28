# Brag Plan: AirSense AI

## What is this app?
AirSense AI is an urban air-quality assistant for families and communities that turns modelled US AQI, PM2.5, weather, and retrieval freshness into deterministic outdoor exposure decisions, 12-hour GoWindow activity schedules, and child-aware household plans where AI can explain the plan—never override the safety engine.

## The angle
People usually see one AQI number and still have to guess whether a 45-minute run, a commute, or children's outdoor play makes sense right now or later today—while generic chatbots happily rewrite a cautious reading into reassuring filler. AirSense AI separates the safety decision from the explanation: `server/logic.js` scores US AQI (0–500 scale), PM2.5, activity intensity, age/sensitivity, wind, and retrieval freshness deterministically, `GoWindow` finds contiguous suitable intervals in the next 12 hours without rewriting the current reading, and `Family air plan` governs shared outings by the child safety profile before validating any AI explanation against `allowedClaims`.

## Hook (first 2-3 seconds)
Frame 0 opens directly on the `AirSense AI · URBAN AIR INTELLIGENCE` lockup and the bold claim **"One AQI number isn't a plan."**, followed briskly on Beat 1 (`0.56s`) by the real `CURRENT MODELLED AIR` card (`Sample forecast · Default · Chennai`) showing `US AQI 108` (`Unhealthy for Sensitive Groups`, `0–500 SCALE`) and `Running right now · 45 min → AVOID`, cutting cleanly at `2.73s` to keep the reel moving.

## Key moments (the middle)
- **GoWindow 12-hour scheduling (`2.73s–9.83s`):** A simulated cursor clicks `Find my best time` (`Running · Adult · 45 minutes · Daytime`). Four forecast blocks from the 12-hour `ActivityTimeline` (`10 AM · 82`, `1 PM · 52`, `4 PM · 39`, `7 PM · 68`) cascade onto the beat grid before locking onto the enlarged mobile `Best forecast window`: **`4:00 PM – 4:45 PM · US AQI 39 · Good`** (`PM2.5 9.8 µg/m³ · Low · Suitable forecast`) while keeping **Now** separate.
- **Child-aware Family air plan & guardrailed AI (`9.83s–15.84s`):** The `Family air plan` card (`1 Young child · 2 Adults · 45 min · Daytime`) scores enlarged mobile recommendations for `Children's outdoor play` on the child safety profile (`Now: Avoid outdoor play`, `Window: 4:00 PM – 4:45 PM · Good`) while keeping `Adult-only commute: Caution` (`Does not apply to children · Walking & cycling separate`) separate—ending on the `Explain using AI` guardrail: **"The decision is deterministic."** / `"The safety decision stays with the exposure engine."`

## Outro / punchline
The blue Wind emblem (`#2563eb`) and `AirSense AI` lockup resolve onto the verbatim tagline: **"Understand the air you have. Choose a time that fits the activity."**

## User flow worth showing
1. **Entry (`Environmental overview`):** Check current modelled US AQI (`108 · Unhealthy for Sensitive Groups`, `FORECAST ESTIMATE`) on `Default · Chennai` (`Sample forecast`) and see `Avoid` for vigorous outdoor running right now.
2. **Key action (`GoWindow`):** Set `Running · 45 minutes · Daytime` and click `Find my best time` to scan the next 12 forecast hours.
3. **Result (`GoWindow` + `Family air plan`):** Receive `Best forecast window` (`4:00 PM – 4:45 PM · US AQI 39 · Good`) without altering the current reading, and inspect a child-governed `Family air plan` where `Explain using AI` is checked against the deterministic exposure engine.

## Tone
- Preset: `polished`
- Creative direction: Crisp environmental-telemetry product film — editorial calm, precision UI choreography, zero hype
- Interpretation: Clean light-surface typography (`#101722` on `#f4f6f9` and `#ffffff`), deliberate beat-locked reveals, generous reading holds, and honest model-estimate badges rather than flashy SaaS slogans.

## Format: vertical (9:16, 4K delivery) — authored 1080x1920, rendered 2160x3840 (`portrait-4k`) at 30fps
## Duration: 20s

## Visual identity (from the project)
- Background: `#f4f6f9` (`--bg`), elevated card surfaces `#ffffff` (`--surface`), subtle panels `#f8fafc` (`--surface-subtle`), borders `#dfe4ec` / `#c7cfda`
- Accent: `#2563eb` (`--blue`), readable cobalt `#174ea6` (`--blue-readable`), soft blue `#e8f0ff` (`--blue-soft`), caution amber `#b45309` on `#fff5dc`, avoid crimson `#b91c1c` on `#fef2f2`
- Text: `#101722` (`--text`), secondary `#3f4b5d` (`--text-secondary`), muted `#566579` (`--text-muted`)
- Display font: `Inter` (700/800/900, tight negative tracking matching `src/design-system.css`)
- Body font: `Inter` (500/600/700) with `JetBrains Mono` for telemetry kickers and timestamps
- Strongest visual element: The `CURRENT MODELLED AIR QUALITY` card (`3px` top accent bar, giant `US AQI · 0–500 SCALE` numeral, 6-band EPA color bar `#2563eb` → `#991b1b`, `FORECAST ESTIMATE` pill) paired with the `GoWindow` ranked window card and `ActivityTimeline` strip.
- Stand-in / sample disclosure: All forecast numbers shown (`US AQI 108` now, `US AQI 39` at `4:00 PM – 4:45 PM`) are deterministic outputs computed directly through `server/logic.js`, `server/gowindow.js`, and `server/family-plan.js` for an explicitly badged `SAMPLE FORECAST` on `Default · Chennai`—never presented as live station measurements or medical advice.

## Share copy (draft)
One AQI number doesn't tell you if a 45-minute run or kids' outdoor play makes sense right now. Built AirSense AI: deterministic US AQI exposure rules, 12-hour GoWindow scheduling, and child-aware family plans where AI explains the result—never overrides the safety engine.

## Audio direction
- Role: Steady, clean instrumental bed with sparse, low-HF-risk UI accents
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (~109.96 BPM, CC BY 4.0 Sascha Ende / ende.app)
- Music treatment: Starts at `0.0s` at `0.32` volume, `0.45s` fade-in, `1.6s` fade-out under the final tagline hold
- Music cue guidance: Bundled preset `.agents/skills/brag/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json` (`109.96 BPM`); beat locks at `0.56s` (`CURRENT MODELLED AIR` card snap), `2.73s` (`GoWindow` cut), `6.56s` (`Best forecast window` reveal), `9.83s` (`Family air plan` scene entrance), `10.93s` (`Adult-only commute` strongCue), `12.55s` (`Deterministic engine` AI guardrail strongCue), and `15.84s` (`Outro` strongCue + `16.38s` tagline hold); beat-grid window `4.39s, 4.91s, 5.34s, 6.00s` for the 4 forecast hour blocks in Scene 2
- Audio-reactive treatment: Subtle; extract per-frame RMS/bass bands via Hyperframes `extract-audio-data.py` and modulate the atmospheric cobalt/amber aura behind the product cards (`3–6%` scale/opacity breathing at build time). No waveform or equalizer bars.
- SFX posture: Sparse (4 cues total), motion-matched, low/medium HF risk only (`click_003.ogg`, `impactSoft_medium_001.ogg`, `drop_001.ogg`, `bong_001.ogg`)
- Audio-coupled moments: Simulated button click on `Find my best time` (`3.82s`), beat-grid forecast timeline blocks (`4.39s–6.00s`), beat-locked `Best forecast window` reveal (`6.56s`), `Family air plan` entrance (`9.83s`), and final lockup bell (`15.84s`)
- Restraint rule: Never stack overlapping bright SFX, never pulse readable text, and keep all effects softly tucked under the music bed.

## Storyboard

### Scene 1 — Hook & Current Overview — 2.73s (`0.00s – 2.73s`)
Frame 0 opens immediately with the `AirSense AI · URBAN AIR INTELLIGENCE` header pill and the headline **"One AQI number isn't a plan."** On Beat 1 (`0.56s`), the `CURRENT MODELLED AIR` card rises briskly into view (`Sample forecast · Default · Chennai`, `FORECAST ESTIMATE` badge, **`108`** `US AQI · 0–500 SCALE`, `Unhealthy for Sensitive Groups`, 6-band US EPA scale bar, and `Running right now · 45 min · AVOID`). Settled hold `0.90s–2.54s` (`1.64s` settled / `~2.0s` visible) before cutting cleanly at `2.73s` so the reel stays brisk.
Sequential/interaction: none — fast beat-1 entrance (`0.56s`) followed by a tight, legible hold.
Audio intent: Confident, brisk opening pulse that lands the problem immediately and hands off to GoWindow under 3 seconds.
Audio-coupled idea: Overview card entrance aligned to Beat 1 (`0.56s`), scene cut on beat `2.73s`.
Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`
Transition mood: Clean lift-and-swap on the shared light stage → Scene 2 (`2.73s`)

### Scene 2 — GoWindow 12-Hour Scheduler — 7.10s (`2.73s – 9.83s`)
`FORECAST PLANNING · GoWindow` opens with the profile chips (`Running · Adult · 45 minutes · Daytime`) and the blue **`Find my best time`** primary button. A pointer glides in and clicks **`Find my best time`** on beat `3.82s`. Four compact blocks from the 12-hour `ActivityTimeline` (`10 AM · 82`, `1 PM · 52`, `4 PM · 39`, `7 PM · 68`) cascade onto consecutive beats (`4.39s`, `4.91s`, `5.34s`, `6.00s`), then the enlarged mobile **`Best forecast window`** card locks in right on the next beat (`6.56s`): **`4:00 PM – 4:45 PM`** (`76px`) · **`US AQI 39 · Good`** · `PM2.5 9.8 µg/m³ · Low · Suitable forecast` · `"Now stays Avoid. Later stays separate."` Settled hold `6.96s–9.63s` (`2.67s`).
Sequential/interaction: yes — simulated cursor click on `Find my best time` (`3.82s`), followed by 4 forecast hour blocks arriving sequentially on the beat grid (`4.39s–6.00s`) and holding together on screen, then the enlarged `Best forecast window` card locking on `6.56s`.
Audio intent: Tactile UI click followed by rhythmic forward momentum and a warm, decisive payoff when the 4:00 PM window locks in.
Audio-coupled idea: Simulated click SFX at `3.82s`; 4 timeline hour blocks snapped to `beats[]` (`4.39s, 4.91s, 5.34s, 6.00s`); `Best forecast window` beat-locked to `6.56s` with a soft reveal hit.
Transition mood: Clean slide-and-focus → Scene 3 (`9.83s`)

### Scene 3 — Family Air Plan & Guardrailed AI — 6.01s (`9.83s – 15.84s`)
Enters on beat `9.83s` with `HOUSEHOLD PLANNING · Family air plan` (`1 Young child · 2 Adults · 45 min · Daytime`). Two enlarged mobile recommendation cards show how the same deterministic engine governs a household without collapsing profiles:
1) `Children's outdoor play` (`Child profile`): **`Now: Avoid outdoor play`** / **`Window: 4:00 PM – 4:45 PM · Good`**
2) `Adult-only commute`: **`Caution`** (`Does not apply to children · Walking & cycling separate`)
At `strongCue 12.55s`, the enlarged **`Explain using AI`** verified banner locks in below: **"The decision is deterministic."** / `"The safety decision stays with the exposure engine."` Settled hold `12.95s–15.61s` (`2.66s`).
Sequential/interaction: yes — household rows reveal in order (`10.37s`, `10.93s` — held together on screen for ~5s), followed by the `Explain using AI` deterministic guardrail card locking on `strongCue 12.55s`.
Audio intent: Calm authority — reinforcing trust and safety restraint.
Audio-coupled idea: Scene entrance locked to beat `9.83s` (`drop_001.ogg`); adult card on `strongCue 10.93s`; deterministic guardrail lock on `strongCue 12.55s`.
Transition mood: Soft crossfade → Scene 4 (`15.84s`)

### Scene 4 — Brand Lockup & Tagline Outro — 4.16s (`15.84s – 20.00s`)
Enters on `strongCue 15.84s` with the centered `AirSense AI` Wind icon (`#2563eb`), **`AirSense AI`** wordmark, and `URBAN AIR INTELLIGENCE` subtitle. On beat `16.38s`, the verbatim tagline lands and holds dead still through `20.00s` (`3.28s` settled hold):
**"Understand the air you have. Choose a time that fits the activity."**
Below it sits the crisp provenance pill: `US AQI · Open-Meteo / CAMS` and `Informational guidance · not medical advice`.
Sequential/interaction: none — confident brand lockup + 3.28s final hold.
Audio intent: Warm resolution with a gentle bell accent as the music fades out cleanly.
Audio-coupled idea: Outro entrance beat-locked to `strongCue 15.84s` (`bong_001.ogg`), tagline reveal on beat `16.38s`, music fade-out `18.4s–20.0s`.

**Music mood for this video:** `polished` (steady, clean, intelligent pulse)
**Audio summary:** A clean 110 BPM instrumental bed (`vol-12`) carries a subtle RMS-reactive atmospheric glow from hook to outro, punctuated by four warm, low-HF-risk UI and reveal accents at `3.82s`, `6.56s`, `9.83s`, and `15.84s` before fading smoothly under the final tagline.
