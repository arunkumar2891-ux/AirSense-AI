# Brag Plan: AirSense AI

## What is this app?
AirSense AI is an urban air-quality assistant for families and communities that turns modelled US AQI, PM2.5, weather, and retrieval freshness into deterministic outdoor exposure decisions, 12-hour GoWindow activity schedules, and child-aware household plans where AI can explain the plan—never override the safety engine.

## The angle
People usually see one AQI number and still have to guess whether a 45-minute run, a commute, or children's outdoor play makes sense right now or later today—while generic chatbots happily rewrite a cautious reading into reassuring filler. AirSense AI separates the safety decision from the explanation: `server/logic.js` scores US AQI (0–500 scale), PM2.5, activity intensity, age/sensitivity, wind, and retrieval freshness deterministically, `GoWindow` finds contiguous suitable intervals in the next 12 hours without rewriting the current reading, and `Family air plan` governs shared outings by the child safety profile before validating any AI explanation against `allowedClaims`.

## Hook (first 2-3 seconds)
Frame 0 opens directly on the `AirSense AI · URBAN AIR INTELLIGENCE` lockup and the bold claim **"One AQI number isn't a plan."**, followed immediately (`1.09s`) by the real `CURRENT MODELLED AIR QUALITY` card (`Sample forecast · Default · Chennai`) showing `US AQI 108` (`Unhealthy for Sensitive Groups`, `0–500 SCALE`) and `Running now → AVOID`.

## Key moments (the middle)
- **GoWindow 12-hour scheduling (`4.39s–11.46s`):** A simulated cursor clicks `Find my best time` (`Running · 45 minutes · Daytime`). Four forecast blocks from the 12-hour `ActivityTimeline` (`10 AM · 82`, `1 PM · 52`, `4 PM · 39`, `7 PM · 68`) cascade onto the beat grid before locking onto the `Best forecast window`: **`4:00 PM – 4:45 PM · US AQI 39 · Good`** (`PM2.5 9.8 µg/m³ · Low · Suitable forecast`) while keeping **Now** separate.
- **Child-aware Family air plan & guardrailed AI (`11.46s–17.47s`):** The `Family air plan` card (`1 Young child · 2 Adults · 45 min`) scores `Children's outdoor play` on the child safety profile (`Avoid now`, `4:00 PM – 4:45 PM` window later) while keeping `Adult-only commute: Caution` (`Does not apply to children`) separate—ending on the `Explain using AI` guardrail: **"The decision is deterministic."** / `"The safety decision stays with the exposure engine."`

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
## Duration: 22s

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
- Music treatment: Starts at `0.0s` at `0.32` volume, `0.5s` fade-in, `1.8s` fade-out under the final tagline hold
- Music cue guidance: Bundled preset `.agents/skills/brag/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json` (`109.96 BPM`); strongCue locks at `8.74s` (`Best forecast window` reveal), `11.46s` (`Family air plan` scene entrance), `13.11s` (`Deterministic engine` AI guardrail lock), and `17.47s` (`Outro` brand lockup + `18.02s` tagline hold); beat-grid window `6.00s, 6.56s, 7.09s, 7.64s` for the 4 forecast hour blocks in Scene 2
- Audio-reactive treatment: Subtle; extract per-frame RMS/bass bands via Hyperframes `extract-audio-data.py` and modulate the atmospheric cobalt/amber aura behind the product cards (`3–6%` scale/opacity breathing at build time). No waveform or equalizer bars.
- SFX posture: Sparse (4 cues total), motion-matched, low/medium HF risk only (`click_003.ogg`, `impactSoft_medium_001.ogg`, `drop_001.ogg`, `bong_001.ogg`)
- Audio-coupled moments: Simulated button click on `Find my best time` (`5.34s`), beat-grid forecast timeline blocks (`6.00s–7.64s`), beat-locked `Best forecast window` reveal (`8.74s`), and final tagline bell (`17.47s`)
- Restraint rule: Never stack overlapping bright SFX, never pulse readable text, and keep all effects softly tucked under the music bed.

## Storyboard

### Scene 1 — Hook & Current Overview — 4.39s (`0.00s – 4.39s`)
Frame 0 opens immediately with the `AirSense AI · URBAN AIR INTELLIGENCE` header pill and the headline **"One AQI number isn't a plan."** At `1.09s`, the `CURRENT MODELLED AIR QUALITY` card rises into view (`Sample forecast · Default · Chennai`, `FORECAST ESTIMATE` badge, **`108`** `US AQI · 0–500 SCALE`, `Unhealthy for Sensitive Groups`, 6-band US EPA scale bar, and `Running now · AVOID`). Settled hold `1.45s–4.15s` (`2.70s`).
Sequential/interaction: none — fast crisp entrance at `0.0s` / `1.09s` followed by a steady 2.7s hold so every badge reads cleanly.
Audio intent: Confident, clean opening pulse that lets the hook headline land immediately.
Audio-coupled idea: Overview card entrance aligned to beat `1.09s`.
Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`
Transition mood: Clean blur-and-lift swap on the shared light stage → Scene 2 (`4.39s`)

### Scene 2 — GoWindow 12-Hour Scheduler — 7.07s (`4.39s – 11.46s`)
`FORECAST PLANNING · GoWindow` opens with the profile chips (`Running · Adult · 45 minutes · Daytime`) and the blue **`Find my best time`** primary button. A pointer glides in and clicks **`Find my best time`** at `5.34s`. Four compact blocks from the 12-hour `ActivityTimeline` (`10 AM · 82`, `1 PM · 52`, `4 PM · 39`, `7 PM · 68`) cascade onto consecutive beats (`6.00s`, `6.56s`, `7.09s`, `7.64s`), then the **`Best forecast window`** card locks in on `strongCue 8.74s`: **`4:00 PM – 4:45 PM`** · **`US AQI 39 · Good`** · `PM2.5 9.8 µg/m³ · Low · Suitable forecast` · `"Now stays Avoid. Later stays separate."` Settled hold `9.12s–11.25s` (`2.13s`).
Sequential/interaction: yes — simulated cursor click on `Find my best time` (`5.34s`), followed by 4 forecast hour blocks arriving sequentially on the beat grid (`6.00s–7.64s`) and holding together on screen, then the `Best forecast window` card locking on `8.74s`.
Audio intent: Tactile UI click followed by rhythmic forward momentum and a warm, decisive payoff when the 4:00 PM window locks in.
Audio-coupled idea: Simulated click SFX at `5.34s`; 4 timeline hour blocks snapped to `beats[]` (`6.00s, 6.56s, 7.09s, 7.64s`); `Best forecast window` beat-locked to `strongCue 8.74s` with a soft reveal hit.
Transition mood: Clean slide-and-focus → Scene 3 (`11.46s`)

### Scene 3 — Family Air Plan & Guardrailed AI — 6.01s (`11.46s – 17.47s`)
Enters on beat `11.46s` with `HOUSEHOLD PLANNING · Family air plan` (`1 Young child · 2 Adults · 45 min · Daytime`). Two stacked rows show how the same deterministic engine governs a household without collapsing profiles:
1) `Children's outdoor play` (`Child profile`): **`Now: Avoid`** → **`4:00 PM – 4:45 PM (Good)`**
2) `Adult-only commute`: **`Caution`** (`Does not apply to children · Walking & cycling separate`)
At `strongCue 13.11s`, the **`Explain using AI`** verified banner locks in below: **"The decision is deterministic."** / `"The safety decision stays with the exposure engine."` Settled hold `13.51s–17.24s` (`3.73s`).
Sequential/interaction: yes — household rows reveal in order (`12.02s`, `12.55s` — held together on screen), followed by the `Explain using AI` deterministic guardrail card locking on `strongCue 13.11s`.
Audio intent: Calm authority — reinforcing trust and safety restraint.
Audio-coupled idea: Scene entrance locked to beat `11.46s` (`drop_001.ogg`); deterministic guardrail lock on `strongCue 13.11s`.
Transition mood: Soft crossfade → Scene 4 (`17.47s`)

### Scene 4 — Brand Lockup & Tagline Outro — 4.53s (`17.47s – 22.00s`)
Enters on `strongCue 17.47s` with the centered `AirSense AI` Wind icon (`#2563eb`), **`AirSense AI`** wordmark, and `URBAN AIR INTELLIGENCE` subtitle. On beat `18.02s`, the verbatim tagline lands and holds dead still through `22.00s` (`3.62s` settled hold):
**"Understand the air you have. Choose a time that fits the activity."**
Below it sits the crisp provenance pill: `US AQI · Open-Meteo / CAMS` and `Informational guidance · not medical advice`.
Sequential/interaction: none — confident brand lockup + 3.62s final hold.
Audio intent: Warm resolution with a gentle bell accent as the music fades out cleanly.
Audio-coupled idea: Outro entrance beat-locked to `strongCue 17.47s` (`bong_001.ogg`), tagline reveal on beat `18.02s`, music fade-out `20.2s–22.0s`.

**Music mood for this video:** `polished` (steady, clean, intelligent pulse)
**Audio summary:** A clean 110 BPM instrumental bed (`vol-12`) carries a subtle RMS-reactive atmospheric glow from hook to outro, punctuated by four warm, low-HF-risk UI and reveal accents at `5.34s`, `8.74s`, `11.46s`, and `17.47s` before fading smoothly under the final tagline.
