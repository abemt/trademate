import { CheckinCard, DisciplineCard } from "../components/TodayCards";
import { DayStructureCard } from "../components/DayStructureCard";
import { UrgeLogCard } from "../components/UrgeCatch";

/** The day around the chart: habits, state, the catch log and the discipline score. */
export function Life() {
  return (
    <div className="space-y-4">
      <div className="px-1">
        <h1 className="text-2xl font-bold text-white">Life</h1>
        <p className="mt-1 text-sm text-ink-300">A shaped day is what keeps you off the chart in the empty hours.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <div className="flex flex-col lg:row-span-2 [&>section]:flex-1">
          <DayStructureCard />
        </div>
        <CheckinCard />
        <UrgeLogCard />
        <DisciplineCard />
      </div>
    </div>
  );
}
