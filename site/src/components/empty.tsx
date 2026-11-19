import { Button } from '@/components/ui/button';

export function Empty({ title, text, action }: { title: string; text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <h3 className="font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{text}</p>
      {action && <Button variant="outline" size="sm" className="mt-2" onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}

export const PageHead = ({ title, text, aside }: { title: React.ReactNode; text?: React.ReactNode; aside?: React.ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
    <div className="flex max-w-3xl flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {text && <p className="text-sm text-muted-foreground">{text}</p>}
    </div>
    {aside}
  </div>
);
