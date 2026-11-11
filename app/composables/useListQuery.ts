/**
 * The job list's filter state, which lives in the route query and nowhere else. Writes use
 * `replace` (typing must not fill the back stack) and reset `page`, since page 7 of the old result
 * set is meaningless.
 */
export const useListQuery = () => {
  const route = useRoute()
  const router = useRouter()
  const filters = computed(() => parseFilters(route.query))
  const set = (patch: Record<string, string | number | undefined>) =>
    router.replace({ query: { ...route.query, page: undefined, ...patch } })
  return { filters, set }
}
