/**
 * Run an async worker over `items` with bounded concurrency.
 *
 * Up to `concurrency` workers pull items off a shared cursor and process them
 * in parallel; the call resolves once every item is done (or `shouldStop`
 * returns true). A worker that throws is the caller's responsibility — wrap the
 * body in try/catch if individual failures should not abort siblings.
 */
export async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let cursor = 0
  const lanes = Math.max(1, Math.min(concurrency, items.length))

  async function runLane(): Promise<void> {
    while (!shouldStop()) {
      const i = cursor++
      if (i >= items.length) return
      await worker(items[i], i)
    }
  }

  await Promise.all(Array.from({ length: lanes }, runLane))
}
