import { createContext, useContext } from 'react'

// Technician decisions recorded in this session (in memory until the
// backend exists).
export const ReviewsContext = createContext({ reviews: [], record: () => {} })

export function useReviews() {
  return useContext(ReviewsContext)
}

// Referred samples that no technician has decided yet.
export function countWaiting(queue, reviews) {
  const reviewed = new Set(reviews.map((r) => r.id))
  return queue.filter((s) => s.decision === 'referred' && !reviewed.has(s.id)).length
}
