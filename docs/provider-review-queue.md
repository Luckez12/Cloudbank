# Cloudbank provider review queue

Review providers one at a time in this order, as agreed on 21 October 2026
(Malaysia). This is a review queue, not evidence that these providers have never
received an earlier patch or that they are all broken. The historical repair
inventory was incomplete when the queue was assembled.

Current: **OneTouchTV v1.5.0 patch prepared; waiting for device playback/subtitle test.**

KissKH v1.4.0 is deferred: the user reported the site down; no playback confirmation.
Next: **MovieBox**, after OneTouchTV testing or a new user instruction.

1. KissKH — deferred: site down as reported by user; device testing pending.
2. OneTouchTV — v1.5.0 patch prepared; device testing pending.
3. MovieBox
4. AllMovieLand
5. CineFreak
6. CinemaCity
7. DooFlix
8. HDGharTV
9. HindMoviez
10. MoviesDrive
11. MoviesHunt
12. Movies4u
13. NetMirror
14. VidEasy
15. VidSrc
16. VixSrc
17. VidFast
18. ZinkMovies
19. Mapple
20. Vidnest
21. HDHub4u
22. PencuriMovie
23. MSM21
24. CineMode
25. 1Shows
26. DesiFlix
27. Cineby
28. MoonFlix
29. FibWatch
30. MovieBlast
31. Peachify
32. VidRock
33. VegaMovies
34. VidLove
35. XPass
36. OnlyKDrama
37. StreamFlix
38. YFlix

For each provider: inspect actual current code and site behavior; review metadata,
search, title/year/season/episode matching, direct media, subtitles and latency.
Separate static tests, successful discovery and confirmed device playback. Keep
providers already repaired and working out of this queue unless the user reports
a new issue. Do not change VUEO or delete providers as part of a review patch
without an instruction to do so.
