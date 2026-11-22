// Smoothcomp and AJP Tour always in English: a page under another language's path
// (/es/, /pt_BR/ …) is swapped for its /en/ one before it loads.
const lang = location.pathname.match(/^\/([a-z]{2}(?:_[A-Z]{2})?)(?=\/|$)/)?.[1];
if (lang && lang !== 'en') location.replace(`/en${location.pathname.slice(lang.length + 1)}${location.search}${location.hash}`);
