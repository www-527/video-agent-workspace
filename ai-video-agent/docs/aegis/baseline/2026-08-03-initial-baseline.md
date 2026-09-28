# Initial Baseline

- Application: Next.js 14 local AI video studio.
- Existing lifecycle owner: `src/app/api/shutdown/route.ts` and `src/components/shutdown-button.tsx` implement application shutdown.
- Runtime finding: the active server is a production `next start` process; source changes are not hot-loaded.
- Constraint: a child service cannot reliably terminate and restart its own parent launcher.
