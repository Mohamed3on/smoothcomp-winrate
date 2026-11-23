// Dev only: flips the athletes ranking between the real API and the fixtures in fixtures.ts.
// Plain chrome on purpose, so it never reads as part of the design under test.
const SEGMENTS = [['', 'Demo data'], ['worst', 'Worst case'], ['empty', 'Empty'], ['one', 'One'], ['error', 'Error']] as const;

export default function DataToggle() {
  const current = new URLSearchParams(location.search).get('data') ?? '';
  const pick = (value: string) => {
    const url = new URL(location.href);
    if (value) url.searchParams.set('data', value); else url.searchParams.delete('data');
    location.assign(url); // a reload: the query cache never mixes fixture and real rows
  };
  return (
    <div role="group" aria-label="Data" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-0.5 rounded-full bg-neutral-300 p-0.5 font-[system-ui] text-xs text-neutral-700 shadow">
      {SEGMENTS.map(([value, label]) => (
        <button key={value} type="button" aria-pressed={current === value} onClick={() => pick(value)}
          className="rounded-full px-2.5 py-1 whitespace-nowrap aria-pressed:bg-white aria-pressed:text-neutral-900">{label}</button>
      ))}
    </div>
  );
}
