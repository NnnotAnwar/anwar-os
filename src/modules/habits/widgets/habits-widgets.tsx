import Link from "next/link"
import { actions } from "../actions"
import { TodayHabitList } from "../components/today-habits"

/** Today: the habits scheduled for today, checkable in place. */
export async function TodaysHabits() {
  const { habits } = await actions.today.handler({})
  if (habits.length === 0) {
    const { habits: all } = await actions.overview.handler({ includeArchived: false })
    return (
      <p className="text-meta text-muted-foreground">
        {all.length ? "Nothing scheduled today." : "No habits yet."}{" "}
        <Link href={all.length ? "/app/habits" : "/app/habits?new=1"} className="text-text-accent underline-offset-4 hover:underline">
          {all.length ? "See all habits" : "Start one"}
        </Link>
      </p>
    )
  }
  return <TodayHabitList habits={habits} />
}
