# Original provider display restored — 1.20.2

The common English stream formatter has been removed from all 103 providers.
Each provider once again returns its own original stream name and title,
including its original layout, symbols and available metadata.

The rollback does not remove the anime mapping repair from 1.20.1. Provider
extraction, headers, URLs, subtitle tracks, settings and registration remain
unchanged. The imported upstream source hashes remain valid.

The former formatter helper is now a compatibility passthrough. Running
`python3 scripts/embed_stream_display.py` removes any remaining old formatter;
it cannot reinstall the rejected display. Validation rejects an active formatter.

This ZIP uses repository-root paths and contains no YML files.
