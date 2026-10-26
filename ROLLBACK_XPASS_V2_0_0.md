# XPass rollback to 2.0.0

providers/xpass.js restored byte-for-byte from Cloudbank-main (14).zip; identical to the snapshot taken before 2.0.1. SHA256: 370d9e303c3f9dac0e6789e5bf8e32120be924b9aafe4a9067f1d737cc0272e9.

All provider changes introduced in 2.0.1–2.0.4 removed, including media probes, request lifecycle changes, subtitle waiting/filter changes and identity guards. Restore original current/pipeline tests. Legacy identity-test command forwards to original pipeline tests. Manifest XPass version 2.0.0, repository version 1.20.132; other provider entries remain unchanged.

Validation: original cipher and movie/TV pipeline tests pass, 25-provider validation passes. No VUEO edits or YAML.
