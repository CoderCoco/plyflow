# Crew Roster

Shared vocabulary for all mission agents and skills. Use these terms
consistently. Do not invent synonyms.

## Tone rule

**Space / mission flavor goes in prose. Payloads stay plain.**

If another machine or another reviewer will parse it (JSON, commit messages,
PR descriptions, PR replies, code, agent return blocks), use plain English.
Space-flavor the narration; never the payload.

## Shared vocabulary

| Term | Meaning |
|---|---|
| mission | The full workflow from issue → merged PR |
| flight plan | The plan (Flight Director's output) |
| liftoff | Begin executing the plan |
| systems-check | Full-diff code review phase |
| docking | Open the PR |
| comms | Handle PR comments |
| mission debrief | Update the review rubric |
| crew | Sub-agents collectively |
| anomaly | A code-review finding |
| abort | Stop, reverse course |
| go / no-go | Yes / no |
| resume mission | Resume an interrupted mission |
| Mission Control | The main session (model running /mission) |
| all systems nominal | No issues / nothing to do |
| abort sequence | Failure / halt-and-ask state |
| mission log | The mission chronicle / history |

## Task name roster (52 names, A–Z twice)

Tasks are named from this roster in execution order. The Flight Director assigns
all roster names at planning time, in dependency-wave order, starting from
index 0 (or the index Mission Control provides for a re-plan). Repair tasks
created during systems-check or comms are not roster-named.

If a plan would require more than 52 tasks, halt and ask the Flight Director to
decompose further rather than wrapping to a third pass.

### Round 1

| Index | Name | | Index | Name | | Index | Name |
|---|---|---|---|---|---|---|---|
| 0 | Apollo | | 9 | Jemison | | 18 | Saturn |
| 1 | Borman | | 10 | Kepler | | 19 | Tereshkova |
| 2 | Cassini | | 11 | Lovell | | 20 | Uhuru |
| 3 | Drake | | 12 | Mars | | 21 | Voyager |
| 4 | Europa | | 13 | NASA | | 22 | Webb |
| 5 | Feynman | | 14 | Orion | | 23 | XMM |
| 6 | Gemini | | 15 | Pioneer | | 24 | Young |
| 7 | Hubble | | 16 | Quasar | | 25 | Zond |
| 8 | Io | | 17 | Ride | | | |

### Round 2

| Index | Name | | Index | Name | | Index | Name |
|---|---|---|---|---|---|---|---|
| 26 | Aldrin | | 34 | Interstellar | | 42 | Quirrenbach |
| 27 | Bean | | 35 | Juno | | 43 | Rosetta |
| 28 | Chang-Diaz | | 36 | Kelly | | 44 | Shepard |
| 29 | Discovery | | 37 | Leonov | | 45 | Titan |
| 30 | Eagle | | 38 | Mir | | 46 | Ulysses |
| 31 | Feustel | | 39 | Nereid | | 47 | Vostok |
| 32 | Glenn | | 40 | Ochoa | | 48 | Whitson |
| 33 | Hadfield | | 41 | Pluto | | 49 | Xenon |
| | | | | | | 50 | Yuri |
| | | | | | | 51 | Zarya |

All names are ASCII-safe (no apostrophes, spaces, or Unicode) — safe as JSON
string values and in commit messages.
