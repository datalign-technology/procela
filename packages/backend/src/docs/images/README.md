# Help Guide screenshots

The `renderMarkdownToHtml` service (`packages/backend/src/services/markdown-html.ts`) reads every image in this directory at module load, base64-encodes it, and rewrites any `![](images/<filename>)` reference in `HELP.md` into an inline `<img src="data:...">` at render time.

**Drop a PNG in here → the help guide renders it on the next request.** No route registration, no restart of anything beyond the backend.

If a file referenced by the markdown is missing, the guide renders a striped placeholder card in its place naming the expected filename. Open `/api/v1/docs/help.html` after adding these to see which are still outstanding.

## Filenames the current `HELP.md` expects

| Filename | Section | What to capture |
|---|---|---|
| `dashboard-hero.png` | 3. Dashboard | Dashboard page, top crop. Sign in as **Susan Chen** on the Tidewater Utilities fixture so the personal sections populate. Show the greeting header (role · org · date), the **Program health** pulse strip (Open gaps / Classified / Ownership coverage / Program maturity), and the **Needs you** action queue (All / Tasks / Issues tabs + weekly-trend sparkline) beside the portfolio rail (next meeting, Portfolio Health). The dashboard is you-scoped; there is no Overview KPI row. |
| `process-catalog-tree.png` | 4. Processes → Process Catalog | Process Catalog in its two-pane master-detail layout: the navigation tree (filter pills, per-row status dot + required-fields completeness) on the left with a node selected, and that node's record open in the detail pane on the right. |
| `data-assets-list.png` | 5. Data → Data Assets | Data Assets list with several rows. Governance-tier badges should be visible in the Tier column, with a separate **Certified column** carrying a pill on at least one row — a green "Certified" and an amber "Pending" (the Tidewater fixture has both: NPDES Discharge Records = Certified, Meter Reads = Pending). The **"Pending certification" attention card** should be in the Needs-attention row. A green "Live" / "Synced N min ago" connector-freshness chip next to a name is a bonus when a sync source is paired. |
| `connectors-panel.png` | 6. Systems → On-prem connectors | Settings → On-prem connectors panel with at least one paired connector row. Status chip green (Online), systems column populated, "Add connector" button visible in the header. Empty-state also OK — it just tells a different story. |
| `connector-pairing.png` | 6. Systems → On-prem connectors | The pairing-code modal after clicking "Add connector" and hitting Generate. The eight-digit code should dominate visually; the `docker run` hint underneath should be readable. |
| `chat-panel.png` | 10. Cross-cutting → Ask AI assistant | AI assistant chat panel opened on the right. A grounded question ("Where are our data gaps?" is a good one) and an answer that includes at least one clickable entity citation and a green pill-shaped **Open** navigation chip at the end. |
| `council-scorecard.png` | 8. → Council | The merged **Council** page (`/council`). Show the slim briefing bar (council roster · next meeting) across the top, a **Verdict** card beside the **Needs a decision** panel, then the "Scorecard" division table (Domains · Tier-1 coverage · Classification · Open issues · Exceptions · Status) — with the neutral **No data** status on divisions with nothing to assess yet. Page-header actions (Print, All entities / Governed only, Saved snapshots ▾, Save snapshot) should be visible. Tidewater Utilities fixture. |
| `scorecard-value-drivers.png` | 8. → Council | The **Value drivers** band of the Governance value card (ROI Phase 1) on the Council page — the five leading-indicator tiles (Ownership coverage, **Certified coverage**, Open risk items, Resolved 30 days, Avg days to resolve) with the LEADING INDICATORS pill. Element-clip of the band, not the whole page. Tidewater Utilities fixture. |
| `scorecard-value.png` | 8. → Council | The **Estimated value** band of the Governance value card (ROI Phases 2–3) on the Council page — the four monetized tiles stamped YOUR ASSUMPTIONS (Estimated annual value, Ownership value, Resolution value, Money at risk) above the By value stream attribution table. Requires a value model set on Governance → Foundation → Value model. Element-clip of the band. Tidewater Utilities fixture. |
| `settings-data-tab.png` | Settings → Data | Settings in its left **nav-rail** layout (General / Sign-in & Security / Integrations / Data / Backup & Restore), with **Data** selected. The Data section lists its panels as index rows: **Data classification regimes** (CUI / ITAR / Export-Controlled), **Compliance frameworks**, **Load demo data**, **Reset everything**. Note: Council Scorecard targets moved to Governance → Foundation → Targets, and Backup & Restore is now its own rail section. |

## Recommended shape

- **PNG format.** JPEG works too but PNG is sharper for UI captures.
- **Width ~1200–1600 px.** The Help Guide's `main.doc-body` caps images at `max-width: 100%` inside a ~800px column, and browsers scale down cleanly. Bigger than 1600 wastes bytes; smaller than 1000 gets blurry on high-DPI screens.
- **Retina / 2× exports** are fine if your capture tool offers them — the layout downscales.
- **Trim the browser chrome.** No address bar, no tab bar. Show the app UI only.
- **Neutral demo data** — use the Tidewater Utilities fixture (`test-data/utility/`), or a fresh org with a few realistic-looking rows. Nothing PII, nothing that names a real customer.

## Adding a new screenshot

1. Save the PNG here with a lowercase-with-dashes name (`billing-detail.png`, not `Billing Detail.PNG`).
2. Reference it from `HELP.md` with a descriptive alt text:
   ```markdown
   ![Descriptive one-sentence caption for accessibility + fallback.](images/billing-detail.png)
   ```
3. That's it. On next `GET /api/v1/docs/help.html` the image renders.

The `alt` text is *not* rendered as a visible caption — it's what screen readers read out and what shows up if the file is missing. Keep it meaningful ("Data Assets list with three rows and one Synced chip visible") rather than filler ("Screenshot 1").
