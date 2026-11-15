/**
 * Which of the four things the area below the header shows. It was a chain of
 * `v-if` / `v-else-if` in the template, and the order was wrong: the
 * empty-list message came before the results table, so a search run while the
 * open list happened to be empty reported its matches in the header and then
 * showed "This list is empty" underneath. Searching and the state of the
 * current list are independent questions, and answering them in one place is
 * what stops them being confused for one another again.
 */
export type BodyView = 'no-results' | 'results' | 'empty-list' | 'list'

export const bodyView = (s: {
  /** A search is running: there is a query. */
  searching: boolean
  /** That search has at least one group with at least one station. */
  hasResults: boolean
  /** The current list is still being fetched. */
  loading: boolean
  /** The current list has stations. */
  hasStations: boolean
}): BodyView => {
  // While searching, only the search decides: the current list is not what is
  // on screen, and whether it is empty says nothing about the results.
  if (s.searching) return s.hasResults ? 'results' : 'no-results'
  if (!s.loading && !s.hasStations) return 'empty-list'
  return 'list'
}

/** The online directory is not asked about fewer characters than this. */
export const MIN_DIRECTORY_QUERY = 2

/**
 * What the results area says when a search has nothing to show, in order of
 * what matters: the directory could not be asked (and why), the answer is
 * still coming, the query is too short to send, or there is truly nothing.
 * A chain of template conditions in `App` until 1.2.0, beside the one this
 * file was created to replace after it put its branches in the wrong order.
 * A directory problem is only spoken of in the directory scope.
 */
export const emptyMessage = (s: {
  scope: 'list' | 'all' | 'directory'
  query: string
  /** The directory's own account of what went wrong, or '' when nothing did. */
  directoryProblem: string
  /** Something is still being read or asked for. */
  working: boolean
}): string => {
  const directory = s.scope === 'directory'
  if (directory && s.directoryProblem) return s.directoryProblem
  if (s.working) return 'Searching…'
  if (directory && s.query.trim().length < MIN_DIRECTORY_QUERY) {
    const count = ['no', 'one', 'two', 'three', 'four'][MIN_DIRECTORY_QUERY] ?? String(MIN_DIRECTORY_QUERY)
    return `Type at least ${count} characters to search the online directory.`
  }
  return `No stations match “${s.query}”.`
}
