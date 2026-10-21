# Remove CineFreak

Apply this ZIP, then run from the repository root:

```sh
node scripts/remove-cinefreak.mjs
npm run validate
```

Commit the manifest changes and provider deletions. The script also preserves the earlier request to delete AllMovieLand. It edits the current manifest and does not overwrite other provider updates. Running it again is safe. No YML changes.

The existing ZIP workflow only copies files: uploading this ZIP alone does not execute the removal.
