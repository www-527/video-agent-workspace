/**
 * Starts both frame prerequisites synchronously before exposing their joint
 * completion. Keeping this tiny primitive separate makes the no-serial-await
 * guarantee executable in tests.
 */
export function startFramePrerequisites<TAudio, TImage>(
  startAudio: () => Promise<TAudio>,
  startImage: () => Promise<TImage>,
) {
  const audioPromise = startAudio();
  const imagePromise = startImage();
  return {
    audioPromise,
    imagePromise,
    settled: Promise.all([audioPromise, imagePromise] as const),
  };
}
