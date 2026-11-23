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

**Record**: an athlete's [won, lost] by finish, event by event: their profile's match lists where
one was read (with the results' walkovers there), else the results read. Owner: `rules.js`
`eventRecords`; the server's `TALLY` counts the same (`tests/records.test.cjs`).

**Outcome**: one event of an athlete as their profile's match lists give it (finishes, losses,
everyone met). Kept on the browser and in D1 `outcomes`. Owner: `profile-model.js`.

**Seat**: which registration in a match list is the athlete's: the one in the most of a division's
matches, their name settling a tie. Owner: `profile-model.js` `outcomes`.

**Place**: where an athlete finished a division. Published results give it; until then the
matches do, by the round each side went out in, a round robin by its record. Owner: `rules.js`
`placeOf`, `poolPlaces`.

**Rival**: someone who beat the athlete more than once, opponents known by name. Owner:
`rules.js` `rivalsOf`.

**Upload**: what a page (or the crawler) sends the server about an event or athlete. The server
cleans it apart from writing it. Owner: `server/worker.js` `upload`, `cleanOut`.
