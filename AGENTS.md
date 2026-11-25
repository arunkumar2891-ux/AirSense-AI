# AirSense AI development instructions
- Keep the repository lightweight; never commit node_modules, dist, API keys, or .env.
- Keep all work on the single `main` branch.
- Do not invent live air-quality values or medical claims.
- Keep AQI scale labels explicit; US AQI and European AQI are not interchangeable.
- Prefer deterministic, tested safety rules; use the LLM only to explain supplied facts.
- Validate external input and handle API timeouts/failures.
- Run `npm run check` before committing.
- Keep secrets in environment variables only.

## Agent skills

Project skills mirror [CareerPilot-AI](https://github.com/arunkumar2891-ux/CareerPilot-AI): vendored guides under `.cursor/skills/` and `.cursor/references/`, with `skills-lock.json` for lockfile installs.

After clone, restore lockfile skills into `.agents/skills/`:

```bash
npx skills experimental_install -y
```

The `brag` skill assets live under `.agents/skills/brag/`; other lockfile skills are re-downloaded by the command above (not duplicated in git).
