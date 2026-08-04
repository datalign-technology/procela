# Data Ownership — UI vs. Edge Agents

Which tables and columns are written by the interactive **UI / REST API**
versus the on-prem **edge agent** (`@procela/connector`).

## The governing principle

The edge agent **never writes Procela's database directly.** It runs inside
the customer's network, scans their *own* source databases (Postgres, Oracle,
MySQL, SQL Server) for catalog metadata, and ships **metadata only** — table
names, row counts, freshness timestamps, column names/types — back over an
outbound HTTPS connection. No row data, no connection strings, no credentials
cross the wire. See [`../packages/connector/README.md`](../packages/connector/README.md).

The Procela **backend** performs every database write, on behalf of connector
traffic arriving at three endpoints:

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /connectors/pair/claim` | pairing code | Exchange a one-time code for a long-lived bearer token |
| `POST /connectors/heartbeat` | connector token | Liveness ping |
| `POST /connectors/report` | connector token | Ship a metadata snapshot (assets + columns) |

Every agent-driven write is deliberately **additive / audit-only**: the agent
path *creates* and *refreshes*, but it **never deletes** rows and **never
overwrites** the governance/ownership fields a human curates in the UI. A
report that omits `columns[]` (an older agent) skips the column block
entirely, so it can never wipe a hand-curated schema.

Of the ~60 models in the Prisma schema, the agent path touches exactly
**four tables**. Everything else is 100% UI / API.

---

## The four tables the edge-agent path writes

### `connectors` — co-managed
The UI creates and configures the connector row; the agent maintains its
token and liveness.

| Column | Written by |
|---|---|
| `id`, `orgId`, `name`, `systemIds` | **UI** (`pair/start`; `PATCH /:id` to rename / re-scope) |
| `pairingCode`, `pairingCodeExpiresAt` | **UI** sets at `pair/start`; **agent** clears at `pair/claim` |
| `tokenHash` | **agent** (minted on `pair/claim`; stored as a SHA-256 hash) |
| `agentVersion`, `lastHeartbeatAt` | **agent** (`claim` / `heartbeat` / `report`) |
| `status` | **agent** → `ONLINE` on claim; **server** offline-scan → `OFFLINE`; delete route → `REVOKED` |
| `createdAt`, `updatedAt` | system |

### `connector_events` — agent / system telemetry (read-only in UI)
Entirely written by the agent path: `PAIRED` and `ASSETS_REPORTED` rows, with
per-report counts in the `data` JSON. The UI only reads them
(`GET /connectors/:id/events`).

### `data_assets` — co-managed; the agent owns only a freshness slice
| Column | Written by |
|---|---|
| `name`, `description`, `systemId` | **UI** — but the agent will **create** a new asset (as `BRONZE`) with these if `/report` discovers a table not yet in the catalog |
| `healthScore`, `healthScoreAt`, `lastSyncedByConnectorId`, `lastSyncedAt` | **agent** (`/report` freshness refresh) |
| `ownerPersonId`, `stewardIds`, `dataDomainId`, `governanceTier`, `sensitivityTags`, `rejectedSensitivityTags`, `dataClassification`, `dataType`, `refreshFrequency`, `origin`, `retentionDuration`, `retentionReason` | **UI only** — the agent never touches any governance / ownership field |

### `data_asset_columns` — co-managed; the agent is the primary populator
| Column | Written by |
|---|---|
| `columnName`, `dataType`, `sourceAsset`, `sourceColumn` | **agent** (`/report` — creates new columns, refreshes a changed `dataType`) |
| `description`, `sourceConnectionId` | **UI** (manual curation) |
| `createdAt`, `updatedAt` | system |

Audit-only here too: columns that stop being reported are left in place, and a
manually-added column is never overwritten except for a `dataType` refresh.

---

## Everything else is UI / API-only

All other models are never written by the connector path, including:

- **Process hierarchy** — `ProcessNode` (and its `*Org` / `*Control` /
  `*Skill` / `*System` join tables), `FlowRelationship`
- **Registry & mapping** — `System`, `DataDomain`, `DataAsset*` stewards/bindings,
  `Mapping`, `DataLineageLink`, `AssetLineageEdge`, `DataQualityRule`
- **Governance** — `GovernanceTask`, `GovernanceIssue`, `GovernancePolicy`,
  `GovernanceControl`, `GovernanceGroup`, `GovernanceProgram`, `DecisionRight`
- **People & skills** — `Person`, `PersonOrg`, `Skill`, `PersonSkill`,
  `DamaRole`, `RaciOverride`
- **Docs & ops** — `Sop`, `GlossaryTerm`, `OperationsManual`, `CalendarEvent`,
  `Comment`, `Attachment`, `Tag`, `SavedView`, `Report`, `AnalysisReport`
- **Sync / dbt** — `SyncConnection`, `Connection`, `ConnectionSystemLink`,
  `DbtCloudConnection`, `DbtAssetMapping`, `DbtTestMapping`
- **Platform** — `Organization`, `AppSetting`, `AuditLog`, `Notification`,
  `RefreshToken`, `OidcProvider`, `ScimGroup`, snapshots, `SuggestionDismissal`

### Not an edge agent
The `Agent` / `AgentSchedule` / `AgentExecution` models describe the in-app
**AI** agent (`agentType = "AI"`, with `instructions` and `skillIds`), which
runs **server-side** and is fully UI-managed. Despite the name, it is not an
edge / on-prem agent and shares nothing with the connector path.

### Connector-triggered server automation
Two writes are triggered by connector traffic but are **server-side
automation**, not the UI and not the agent itself:

- the scheduled offline-scan flips `connectors.status` to `OFFLINE` and inserts
  a `notifications` row when a connector goes silent past its threshold;
- connector auth events append `PAIRED` / `BACK_ONLINE` rows to `audit_logs`.
