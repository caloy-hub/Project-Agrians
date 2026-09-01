# Student Name Display Rule

AGRIANS stores the learner's encoded name exactly as entered so official DepEd forms can preserve the required order.

## Automatic display rule

If a learner name is encoded in comma-separated surname-first form:

- `DELA CRUZ, JUAN, D.` → `JUAN D. DELA CRUZ`
- `SANTOS, MARIA, L.` → `MARIA L. SANTOS`
- `DELA CRUZ, JUAN D.` → `JUAN D. DELA CRUZ`

Names without a comma, or ambiguous multi-part comma names, are left unchanged rather than guessed.

## Official form exceptions

- **SF2** keeps the stored/encoded name order.
- **SF9** keeps the stored/encoded name order.

The application database is not rewritten by this feature. Only the presentation layer (and non-SF2/SF9 learner-facing output where explicitly applied) is formatted.
