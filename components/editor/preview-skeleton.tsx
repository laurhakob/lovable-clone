import { Skeleton } from "@/components/ui/skeleton";

export function PreviewSkeleton() {
  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Skeleton className="size-5 rounded" />
        <Skeleton className="h-6 flex-1 rounded-md" />
        <Skeleton className="size-5 rounded" />
      </div>
      <div className="flex-1 space-y-4 p-6">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    </div>
  );
}
