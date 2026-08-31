# AGRIANS v2.1 — Modern UI Upgrade

Maria Cristina P. Belcar Agricultural High School · S.Y. 2026–2027

## What was improved

- Modern AGRIANS visual system using the existing green/gold school identity.
- Welcoming entry panel for **Student, Teacher, and Admin** accounts.
- Animated tab/page transitions and staggered content reveals.
- Interactive hover/focus states, progress rings, animated bars, and performance trend visualization.
- More visual dashboard hierarchy with KPI cards and structured insight panels.
- Student dashboard: academic snapshot and term-performance trend.
- Teacher dashboard: class readiness and learner-average distribution.
- Admin dashboard: enrollment distribution by grade and school-structure overview.
- Responsive desktop/tablet/mobile presentation.
- Reduced-motion accessibility support.
- Cleaner spacing, typography, cards, buttons, forms, and navigation behavior.
- No additional UI framework or chart library required.

## Important compatibility rule

The existing **SF2, SF4, and SF9 generation logic was intentionally preserved unchanged**. The UI upgrade only adds presentation components and styling around the existing application logic.

## GitHub deployment

This remains a Vite + React application. Push the project contents to GitHub and use the existing build/deployment configuration. The existing Supabase environment variables and backend functions remain part of the project.

Recommended build command:

```bash
npm ci
npm run build
```

The generated `dist/` folder can be deployed through the existing GitHub/hosting workflow.

## Suggested next phase

For a future v2.2, consider:
1. Global search / command palette.
2. Notification center for appointments and incomplete encoding.
3. Dashboard filters by grade, section, and term.
4. Export center with clear status history.
5. Empty-state illustrations and contextual help.
6. PWA/offline shell for school connectivity conditions.
7. Accessibility pass using keyboard navigation and ARIA labels.
8. Optional dark mode toggle instead of relying only on system preference.


## AGRIANS v2.2

- Android-installable PWA shell with manifest, service worker and install prompt.
- Capacitor configuration included for native Android packaging.
- GitHub Actions workflow included at `.github/workflows/android-apk.yml`; it builds a debug APK automatically on pushes to `main` or manually from Actions.
- SF2, SF4 and SF9 generation logic is intentionally preserved.


## AGRIANS v2.3 — Android-first UX

- Mobile-first touch targets and safe-area support
- Online/offline connection awareness
- Pull-to-refresh gesture on supported mobile browsers
- PWA install experience retained
- Capacitor-ready Android packaging retained
- SF2, SF4 and SF9 generation logic intentionally preserved
