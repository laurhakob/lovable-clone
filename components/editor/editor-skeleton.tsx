import { Skeleton } from "@/components/ui/skeleton";

export function EditorSkeleton() {
  return (
    <div className="flex h-full w-full bg-background">
      <div className="hidden w-52 shrink-0 space-y-2 border-r border-border p-3 md:block">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton
            key={i}
            className="h-4"
            style={{ width: `${55 + ((i * 17) % 40)}%`, marginLeft: (i % 3) * 8 }}
          />
        ))}
      </div>
      <div className="flex flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center border-b border-border px-3">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex-1 space-y-2 p-4">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton
              key={i}
              className="h-3"
              style={{ width: `${30 + ((i * 23) % 60)}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
