import { AppShell } from '@/components/app-shell';
import { TaskManager } from '@/components/task-manager';

export default function Home() {
  return (
    <AppShell>
      <TaskManager />
    </AppShell>
  );
}
