Cloudbank 1.20.70 — NetMirror manifest fix

Apply after 1.20.69 using the existing patch workflow. NetMirror was already removed in the reported repository, but its manifest entry remained. This patch removes that entry only and increments the manifest version. VidRock stays at 2.1.0 and Peachify remains listed, pending deletion. No provider files, dependencies, workflows or deletion scripts are included.

Validation passed with 40 provider files and matching manifest entries. Both VidRock regression suites passed. The npm deprecation and audit warnings are separate from the reported missing-provider validation failure; dependencies are unchanged.
