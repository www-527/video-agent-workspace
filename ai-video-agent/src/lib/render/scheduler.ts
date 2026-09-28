export async function runBoundedTasks<T>(args: {
  items: T[];
  concurrency: number;
  worker: (item: T, index: number) => Promise<void>;
}): Promise<void> {
  if (!args.items.length) return;
  const concurrency = Math.max(1, Math.min(Math.floor(args.concurrency), args.items.length));
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= args.items.length) return;
      await args.worker(args.items[index], index);
    }
  });
  const results = await Promise.allSettled(workers);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected) throw rejected.reason;
}
