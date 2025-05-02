import { AppShell } from '@/components/app-shell';
import { CalendarView } from '@/components/calendar-view';

export default function CalendarPage() {
  return (
    <AppShell>
      {/* CalendarView now handles its own growth within AppShell's flex container */}
      <CalendarView />
    </AppShell>
  );
}
