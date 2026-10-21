# Remove AllMovieLand

After applying this ZIP to the Cloudbank repository, run from the repository root:

```sh
node scripts/remove-allmovieland.mjs
npm run validate
```

Commit the changed manifest and deleted provider files. The existing ZIP workflow only copies files, so uploading the ZIP alone does not perform the deletion. This script edits the current manifest and preserves other providers, including MovieBox. No YML changes.
