# Cloudbank provider review queue

Review providers one at a time in this order, as agreed on 21 October 2026
(Malaysia). This is a review queue, not evidence that these providers have never
received an earlier patch or that they are all broken. The historical repair
inventory was incomplete when the queue was assembled.

Current: **MovieBox v3.0.0 patch prepared; waiting for device playback/subtitle test.**

KissKH v1.4.0 is deferred: the user reported the site down; no playback confirmation.
Next: **AllMovieLand**, after MovieBox testing or a new user instruction.

Passed device test: **OneTouchTV v1.5.0**, confirmed by the user after My Demon
(TMDb 218539) S1E3: one source, 38 caption tracks received, 32 forwarded by VUEO,
1.48-second discovery. This confirms that sample, not every title in the catalog.

1. KissKH — deferred: site down as reported by user; device testing pending.
2. MovieBox — v3.0.0 patch prepared; device testing pending.
3. AllMovieLand
4. CineFreak
5. CinemaCity
6. DooFlix
7. HDGharTV
8. HindMoviez
9. MoviesDrive
10. MoviesHunt
11. Movies4u
12. NetMirror
13. VidEasy
14. VidSrc
15. VixSrc
16. VidFast
17. ZinkMovies
18. Mapple
19. Vidnest
20. HDHub4u
21. PencuriMovie
22. MSM21
23. CineMode
24. 1Shows
25. DesiFlix
26. Cineby
27. MoonFlix
28. FibWatch
29. MovieBlast
30. Peachify
31. VidRock
32. VegaMovies
33. VidLove
34. XPass
35. OnlyKDrama
36. StreamFlix
37. YFlix

For each provider: inspect actual current code and site behavior; review metadata,
search, title/year/season/episode matching, direct media, subtitles and latency.
Separate static tests, successful discovery and confirmed device playback. Keep
providers already repaired and working out of this queue unless the user reports
a new issue. Do not change VUEO or delete providers as part of a review patch
without an instruction to do so.
