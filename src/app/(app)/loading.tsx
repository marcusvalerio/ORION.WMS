export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Carregando">
      <div className="h-6 w-64 rounded bg-slate-200" />
      <div className="h-4 w-96 max-w-full rounded bg-slate-100" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-slate-100" />
        ))}
      </div>
      <div className="h-72 rounded-lg bg-slate-100" />
    </div>
  );
}
