# AirSense AI development instructions
- Keep the repository lightweight; never commit node_modules, dist, API keys, or .env.
- Keep all work on the single `main` branch.
- Do not invent live air-quality values or medical claims.
- Keep AQI scale labels explicit; US AQI and European AQI are not interchangeable.
- Prefer deterministic, tested safety rules; use the LLM only to explain supplied facts.
- Validate external input and handle API timeouts/failures.
- Run `npm run check` before committing.
- Keep secrets in environment variables only.
