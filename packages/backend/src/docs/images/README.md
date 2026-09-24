# Help Guide screenshots

The `renderMarkdownToHtml` service (`packages/backend/src/services/markdown-html.ts`) reads every image in this directory at module load, base64-encodes it, and rewrites any `![](images/<filename>)` reference in `HELP.md` into an inline `<img src="data:...">` at render time.

**Drop a PNG in here → the help guide renders it on the next request.** No route registration, no restart of anything beyond the backend.

If a file referenced by the markdown is missing, the guide renders a striped placeholder card in its place naming the expected filename. Open `/api/v1/docs/help.html` after adding these to see which are still outstanding.

## Filenames the current `HELP.md` expects

| Filename | Section | What to capture |
|---|---|---|
| `dashboard-hero.png` | 3. Dashboard | Dashboard page, top-third crop. Show the full-width **My Dashboard** row (the "Needs Attention" triage queue beside the 14-day "Schedule") and the half-width **Tasks** / **Issues** sections beneath — each list header carrying its open count and an inline weekly-trend sparkline. The dashboard is you-scoped now; there is no Overview KPI row to capture. Sign in as **Susan Chen** on the Tidewater Utilities fixture so the personal sections are populated. |
| `process-catalog-tree.png` | 4. Processes → Process Catalog | Process Catalog tree with one value stream expanded to at least one Activity. Ideally show the Inputs / Outputs panel open on one activity so a reader sees where data linkage happens. |
| `data-assets-list.png` | 5. Data → Data Assets | Data Assets list with several rows. **Must include at least one row carrying a green "Live" / "Synced N min ago" chip** next to the name (connector-sourced freshness). Governance-tier badges and health scores should be visible in the columns. |
| `connectors-panel.png` | 6. Systems → On-prem connectors | Settings → On-prem connectors panel with at least one paired connector row. Status chip green (Online), systems column populated, "Add connector" button visible in the header. Empty-state also OK — it just tells a different story. |
| `connector-pairing.png` | 6. Systems → On-prem connectors | The pairing-code modal after clicking "Add connector" and hitting Generate. The eight-digit code should dominate visually; the `docker run` hint underneath should be readable. |
| `chat-panel.png` | 10. Cross-cutting → Ask AI assistant | AI assistant chat panel opened on the right. A grounded question ("Where are our data gaps?" is a good one) and an answer that includes at least one clickable entity citation and a green pill-shaped **Open** navigation chip at the end. |
| `council-scorecard.png` | 8. → Council | The merged **Council** page (`/council`). Show the slim briefing bar (council roster · next meeting) across the top, then the "Scorecard" heading + status pill above the division table — with the neutral **No data** status on divisions with nothing to assess yet. Page-header actions (Print, All / Governed, Versions ▾, Save snapshot) should be visible. Tidewater Utilities fixture. |
| `scorecard-value-drivers.png` | 8. → Council | The **Governance value drivers** card (ROI Phase 1) on the Council page — the four leading-indicator tiles (Ownership coverage, Value at risk, Resolved 30 days, Avg days to resolve) with the LEADING INDICATORS pill. Element-clip of the card, not the whole page. Tidewater Utilities fixture. |
| `scorecard-value.png` | 8. → Council | The **Estimated governance value** card (ROI Phases 2–3) on the Council page — the four monetized tiles stamped YOUR ASSUMPTIONS above the By value stream attribution table. Requires a value model set on Governance → Foundation → Value model. Element-clip of the card. Tidewater Utilities fixture. |
| `settings-data-tab.png` | Settings → Data tab | Settings on the **Data** tab. Lead with the **Data classification regimes** card (CUI / ITAR / Export-Controlled), then the **Compliance frameworks** card (the org-editable framework chips + "Add a framework" input + "Reset to built-in defaults"), then **Council Scorecard targets** (editable thresholds), then Backup & Restore, then Load demo data / Reset everything. Show the four-tab bar so the Data tab reads as selected. |

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
