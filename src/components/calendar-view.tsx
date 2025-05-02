'use client';

import * as React from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  format,
  isSameDay,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  parseISO,
  isValid,
  startOfDay,
  getDay,
} from 'date-fns';
import { Skeleton } from './ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Define the Task structure matching TaskManager's state
interface CalendarTask {
  id: string;
  name: string;
  description: string;
  dueDate: Date; // Should be a Date object
  category: 'goal' | 'chore';
  completed: boolean;
}

// Define the structure for daily task ratios
interface DailyTaskRatio {
  goalCount: number;
  choreCount: number;
  total: number;
}

export function CalendarView() {
  const [tasks, setTasks] = React.useState<CalendarTask[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = React.useState(true);
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(
    new Date()
  );
  const [currentMonth, setCurrentMonth] = React.useState<Date>(
    startOfMonth(new Date())
  );
  const { toast } = useToast();

  // Load tasks from localStorage on mount
  React.useEffect(() => {
    try {
      const savedTasks = localStorage.getItem('tasks');
      if (savedTasks) {
        const parsedTasks: CalendarTask[] = JSON.parse(savedTasks).map(
          (task: any) => {
            let parsedDate = task.dueDate ? parseISO(task.dueDate) : null;
            if (!parsedDate || !isValid(parsedDate)) {
              console.warn(
                `Invalid or missing dueDate for task "${task.name}" in Calendar. Defaulting to now.`
              );
              parsedDate = new Date(); // Default if invalid
            }
            return {
              ...task,
              name: task.name || task.description || 'Unnamed Task',
              dueDate: parsedDate, // Store as Date object
            };
          }
        );
        setTasks(parsedTasks);
      }
    } catch (error) {
      console.error('Failed to load tasks from localStorage:', error);
      toast({
        title: 'Error Loading Tasks',
        description: 'Could not load tasks from local storage for calendar.',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingTasks(false);
    }
  }, [toast]);

  const handleMonthChange = (month: Date) => {
    setCurrentMonth(startOfMonth(month));
  };

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    if (date) {
      // Optionally navigate month if a date outside current month view is clicked
      // setCurrentMonth(startOfMonth(date));
    }
  };

  const tasksForSelectedDate = React.useMemo(() => {
    if (!selectedDate) return [];
    return tasks.filter((task) => isSameDay(task.dueDate, selectedDate));
  }, [selectedDate, tasks]);

  // Calculate task ratios for each day in the current month
  const dailyTaskRatios = React.useMemo(() => {
    const ratios = new Map<string, DailyTaskRatio>();
    const daysInMonth = eachDayOfInterval({
      start: startOfMonth(currentMonth),
      end: endOfMonth(currentMonth),
    });

    daysInMonth.forEach((day) => {
      const dayKey = format(day, 'yyyy-MM-dd');
      const tasksOnDay = tasks.filter((task) => isSameDay(task.dueDate, day));
      const goalCount = tasksOnDay.filter(
        (t) => t.category === 'goal' && !t.completed
      ).length;
      const choreCount = tasksOnDay.filter(
        (t) => t.category === 'chore' && !t.completed
      ).length;
      ratios.set(dayKey, {
        goalCount,
        choreCount,
        total: goalCount + choreCount,
      });
    });
    return ratios;
  }, [tasks, currentMonth]);

  // Unique Feature: Custom day rendering with highlighting based on task ratio
  const renderDayWithHighlight = (day: Date): React.ReactNode => {
    const dayKey = format(day, 'yyyy-MM-dd');
    const ratio = dailyTaskRatios.get(dayKey);
    const dayNumber = format(day, 'd');

    let highlightClass = '';
    let tooltipContent = '';

    if (ratio && ratio.total > 0) {
      const goalPercentage =
        ratio.total > 0 ? (ratio.goalCount / ratio.total) * 100 : 0;
      if (goalPercentage >= 75) {
        highlightClass = 'bg-primary/20 border border-primary/50'; // Strong goal highlight
        tooltipContent = `${ratio.goalCount} Goal(s)${ratio.choreCount > 0 ? `, ${ratio.choreCount} Chore(s)` : ''}`;
      } else if (goalPercentage >= 40) {
        highlightClass = 'bg-accent/40 border border-accent/60'; // Mixed highlight
        tooltipContent = `${ratio.goalCount} Goal(s), ${ratio.choreCount} Chore(s)`;
      } else {
        highlightClass = 'bg-secondary/30 border border-secondary/50'; // Chore heavy highlight
        tooltipContent = `${ratio.choreCount} Chore(s)${ratio.goalCount > 0 ? `, ${ratio.goalCount} Goal(s)` : ''}`;
      }
    }

    const isSelected = selectedDate && isSameDay(day, selectedDate);
    const isToday = isSameDay(day, new Date());

    return (
      <Popover>
        <PopoverTrigger asChild>
          <div
            className={cn(
              'relative flex h-full w-full items-center justify-center rounded-md transition-colors duration-150',
              highlightClass,
              isSelected && 'ring-2 ring-ring ring-offset-2 bg-primary/30',
              isToday && !isSelected && 'border-2 border-foreground',
              !highlightClass && 'hover:bg-accent/50' // Hover effect for days without tasks
            )}
          >
            {dayNumber}
            {ratio && ratio.total > 0 && (
              <Badge
                variant="secondary"
                className="absolute bottom-0.5 right-0.5 h-4 min-w-[1rem] p-0.5 text-[10px] leading-none"
              >
                {ratio.total}
              </Badge>
            )}
          </div>
        </PopoverTrigger>
        {tooltipContent && (
          <PopoverContent className="w-auto p-2 text-sm">
            {tooltipContent}
          </PopoverContent>
        )}
      </Popover>
    );
  };

  // Custom components for react-day-picker
  const CustomDay = ({ date, displayMonth }: { date: Date; displayMonth: Date }) => {
    if (!isSameDay(startOfMonth(date), startOfMonth(displayMonth))) {
      // Render days outside the current month differently (optional)
      return <div className="text-muted-foreground/50 flex h-full w-full items-center justify-center">{format(date, 'd')}</div>;
    }
    return renderDayWithHighlight(date);
  };

  const CustomCaption = (props: { displayMonth: Date }) => {
    const handlePreviousMonth = () => {
      setCurrentMonth((prev) => startOfMonth(new Date(prev.setMonth(prev.getMonth() - 1))));
    };
    const handleNextMonth = () => {
      setCurrentMonth((prev) => startOfMonth(new Date(prev.setMonth(prev.getMonth() + 1))));
    };

    return (
      <div className="flex items-center justify-between px-2 py-4">
        <h2 className="text-lg font-semibold text-foreground">
          {format(props.displayMonth, 'MMMM yyyy')}
        </h2>
        <div className="space-x-1">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={handlePreviousMonth}>
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Previous month</span>
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={handleNextMonth}>
            <ChevronRight className="h-4 w-4" />
            <span className="sr-only">Next month</span>
          </Button>
        </div>
      </div>
    );
  };


  return (
    <div className="container mx-auto p-4 md:p-6 lg:p-8">
      <header className="mb-6 border-b pb-4">
        <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
          <CalendarDays className="w-7 h-7" /> Calendar View
        </h1>
        <p className="text-muted-foreground mt-1">
            Visualize your tasks and deadlines. Days highlighted by task type ratio (Goals/Chores).
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar Column */}
        <div className="lg:col-span-2">
          <Card className="shadow-md">
            <CardContent className="p-0">
              {isLoadingTasks ? (
                 <Skeleton className="aspect-video w-full" />
              ) : (
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateSelect}
                  month={currentMonth}
                  onMonthChange={handleMonthChange}
                  className="w-full p-0 [&_button]:rounded-md"
                  classNames={{
                    table: "w-full border-collapse",
                    head_row: "flex border-b",
                    head_cell: "w-full text-muted-foreground font-medium text-sm capitalize py-2 px-1 text-center",
                    row: "flex w-full mt-0 border-b last:border-b-0", // Remove mt-2 and ensure border
                    cell: cn(
                      "relative p-0 h-20 w-full text-center text-sm focus-within:relative focus-within:z-20 flex items-center justify-center", // Adjust height, center content
                      // "[&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md", // Existing styles, might need adjustment
                      "border-r last:border-r-0" // Add vertical borders between cells
                    ),
                    day: "h-full w-full p-0 font-normal flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1", // Full size day button
                    day_selected: "", // Removed default selection style, handled by customDay
                    day_today: "", // Removed default today style, handled by customDay
                    day_outside: "text-muted-foreground opacity-50", // Style for days outside month
                    day_disabled: "text-muted-foreground opacity-50 cursor-not-allowed",
                    // day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
                    // day_hidden: "invisible", // Hide days completely outside the month if needed
                    caption: "hidden", // Hide default caption, using CustomCaption
                  }}
                  components={{
                     Day: CustomDay, // Use custom Day component for highlighting
                     Caption: CustomCaption, // Use custom Caption component
                  }}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Selected Date Details Column */}
        <div className="lg:col-span-1">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-xl">
                {selectedDate ? format(selectedDate, 'PPP') : 'Select a date'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px] pr-4"> {/* Adjust height as needed */}
                {isLoadingTasks ? (
                  <div className="space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : tasksForSelectedDate.length === 0 ? (
                  <p className="text-muted-foreground italic text-center py-4">
                    {selectedDate ? "No tasks scheduled for this day." : "Click a date to see tasks."}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {tasksForSelectedDate.map((task) => (
                      <li
                        key={task.id}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-lg border",
                          task.completed ? 'bg-secondary/30 border-dashed' : 'bg-card hover:bg-accent/40',
                          task.category === 'goal' && !task.completed && 'border-l-4 border-l-primary/80',
                          task.category === 'chore' && !task.completed && 'border-l-4 border-l-secondary-foreground/50'
                        )}
                      >
                        <div className="flex-grow overflow-hidden">
                          <span
                            className={cn(
                              "block font-medium text-sm truncate",
                              task.completed ? 'line-through text-muted-foreground/80' : 'text-foreground'
                            )}
                            title={task.name}
                          >
                            {task.name}
                          </span>
                          <span
                            className={cn(
                              "block text-xs mt-0.5 text-muted-foreground truncate",
                              task.completed && 'text-muted-foreground/60'
                            )}
                            title={task.description}
                          >
                             {format(task.dueDate, 'p')} {/* Show time */} - {task.description}
                          </span>
                        </div>
                        <Badge
                            variant={task.category === 'goal' ? 'default' : 'secondary'}
                            className={cn("ml-2 capitalize text-xs shrink-0 px-1.5 py-0.5", task.completed && 'opacity-60')}
                            >
                           {task.category}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
