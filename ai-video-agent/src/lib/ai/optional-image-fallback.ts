export async function runWithOptionalImageFallback<T>(opts: {
  hasImages: boolean;
  primary: () => Promise<T>;
  fallback: () => Promise<T>;
  isAborted?: () => boolean;
  onFallback?: (error: unknown) => void;
}): Promise<T> {
  try {
    return await opts.primary();
  } catch (error) {
    if (!opts.hasImages || opts.isAborted?.()) throw error;
    opts.onFallback?.(error);
    return opts.fallback();
  }
}
