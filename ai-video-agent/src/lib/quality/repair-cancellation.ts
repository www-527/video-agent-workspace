const repairAbortControllers = new Map<string, AbortController>();

export function registerQualityRepairAbortController(frameId: string, controller: AbortController) {
  repairAbortControllers.get(frameId)?.abort();
  repairAbortControllers.set(frameId, controller);
}

export function abortQualityRepair(frameId: string) {
  repairAbortControllers.get(frameId)?.abort();
}

export function unregisterQualityRepairAbortController(frameId: string, controller?: AbortController) {
  const activeController = repairAbortControllers.get(frameId);
  if (!controller || activeController === controller) {
    repairAbortControllers.delete(frameId);
  }
}
