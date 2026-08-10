-- Retire the heuristic Phase 3 suggestion feature. The Suggested Data
-- Assets / Systems / People panels were removed from the UI, and their
-- backend endpoints and services are gone. The suggestion_dismissals
-- table backed the "hide this suggestion" learning loop, which no longer
-- has a producer or consumer. Drop it.
DROP TABLE "suggestion_dismissals";
