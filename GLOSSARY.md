# Glossary

The words Mat Stats counts by. Where a term has one owner in the code, it is named.

**Finish**: how a match ended, one of submission, stoppage, fastest_escape, points, decision,
disqualification, walkover, other (most decisive first). Smoothcomp's codes come finer
("submission_armbar", "tko", "fullippon"); each counts under one finish. A forfeit is a walkover.
Owner: `rules.js` (`finishOf`, and `finishSql` for the server's queries).
_Avoid_: win type, method, "escape" (an older name for fastest_escape, still read).

**Detail**: the finer part of a code, as a line shows it: "Submission (armbar)". Owner: `rules.js` `detailOf`.

**Belt**: white through black. A label names one belt or none ("Purple/Brown" names none).
Owner: `rules.js` `beltOf`.

**Grade field**: the registration field that grades an athlete, named Belt, Level, Rank, Skill level
or Grade by the organiser. Owner: `rules.js` `isGrade`.

**Record**: an athlete's [won, lost] by finish, event by event, at the events they showed at (Attendance): their
profile's match lists where one was read (with the results' walkovers there), else the results read. Owner: `rules.js`
`eventRecords`; the server's `TALLY` counts the same, a parity test running both over the same rows
(`tests/records.test.cjs`).

**Attendance**: whether an athlete showed at an event. They didn't where they had walkovers alone (a no-show), where
their profile lists it with no match, win or medal there (an absent Outcome), or where they registered and the results
read hold no match of theirs; results saying they fought win over the last two. An event's results are read once a
results row is (`events.fought`); it is over at its end, else two days from its start. Owner: `rules.js` (`noShow`,
`showed`, `overAt`, `wonNothing`, each with a SQL twin: `playedSql`, `missedSql`, `overSql`, `wonNothingSql`,
`presentSql`).
_Avoid_: "missed" for an event still on: until it is over, a registrant without a result is still to fight.

**Outcome**: one event of an athlete as their profile's match lists give it (finishes, losses,
everyone met, each match's id from v 3), or the results read give it where a match list never answers; `absent` where
they didn't show (Attendance). Kept on the browser and in D1 `outcomes`, cleaned to one bounded shape. Owner: `rules.js`
`Outcome` (`fromMatchList`, `fromBouts`, `clean`; `tests/outcome.test.cjs`).

**Seat**: which registration in a match list is the athlete's: the one in the most of a division's
matches, their name settling a tie. Owner: `rules.js` `Outcome.fromMatchList`.

**Match identity**: whether two records are the same match (a profile's match list, the results read, the schedule, a
card read, a match Mat Stats keeps). By its id, else its division (or bracket, which decides over the division's name),
round and either side, names spelt either way ("Hüseyin" is "Huseyin"); a round robin's numbered match by its number;
one kept without its round by the two who fought it, only where they met once there. Owner: `rules.js` (`matchKeys`,
`sameMatch`, `matchFinder`; `tests/match.test.cjs`).
_Avoid_: the opponent alone: it names every match they fought there.

**Place**: where an athlete finished a division. Published results give it; until then the
matches do, by the round each side went out in, a round robin by its record once every match is fought; a no-show
(walkover losses alone, nothing won) is left out. Owner: `rules.js` `divisionResults` (with `placeOf`, `poolPlaces`,
`unplaced`), fed by the results page (`model.js` `build`) and Smoothcomp's JSON (`eventResults`); one event through both
agrees (`tests/results.test.cjs`).

**Academy totals**: an academy's athletes added up (athletes, wins, submissions, points, medals, record), each
athlete under the academy their latest event gave. The list's Min. wins and Min. events are the academy's own, Country where
it is. Kept under the default filters (`club_board`, `club_recent`), else added up live; both give the same rows
(`tests/server.test.cjs`). Owner: `server/stats.js` `academyTotals`.

**Rival**: someone who beat the athlete more than once, opponents known by name. Owner:
`rules.js` `rivalsOf`.

**Upload**: what a page (or the crawler) sends the server about an event or athlete. The server
cleans it apart from writing it. Owner: `server/worker.js` `upload` (an Outcome, `rules.js` `Outcome.clean`).
