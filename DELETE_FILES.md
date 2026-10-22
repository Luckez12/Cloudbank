# Files to delete — NetMirror and Peachify

Delete these exact files if they still exist. If already absent, no action is needed.

- `providers/netmirror.js`
- `providers/peachify.js`

The included manifest 1.20.71 already removes both entries. VidRock remains at 2.1.0. Do not delete any other provider as part of this patch.

The existing Apply Cloudbank ZIP Patch workflow copies files only. It does not execute this list or delete existing files automatically. No deletion script or workflow change is included.
