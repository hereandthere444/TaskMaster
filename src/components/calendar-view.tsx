/**
 * @fileoverview Calendar view component to display tasks on a calendar grid.
 * Highlights days based on the ratio of pending goals to chores.
 */
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
  parse, // Added parse for safety if needed, but parseISO should handle it
  isToday as dateIsToday, // Alias to avoid conflict
} from 'date-fns';
import { Skeleton } from './ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'; // Import CalendarDays

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
            // Check validity rigorously
            if (!parsedDate || !isValid(parsedDate)) {
              // Try parsing with a common format if ISO fails, as a fallback
              // Example: parsedDate = parse(task.dueDate, 'yyyy-MM-dd HH:mm:ss', new Date());
              if (!parsedDate || !isValid(parsedDate)) {
                 console.warn(
                  `Invalid or missing dueDate "${task.dueDate}" for task "${task.name || task.description}" in Calendar. Defaulting to now.`
                 );
                 parsedDate = new Date(); // Default if invalid
              }
            }
            return {
              ...task,
              name: task.name || task.description || 'Unnamed Task',
              dueDate: parsedDate, // Store as Date object
              category: task.category || 'goal', // Default category if missing
              completed: task.completed || false, // Default completion if missing
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
    // Filter tasks ensuring dueDate is a valid Date object before comparison
    return tasks.filter((task) => task.dueDate && isValid(task.dueDate) && isSameDay(task.dueDate, selectedDate));
  }, [selectedDate, tasks]);

  // Calculate task ratios for each day in the current month
  const dailyTaskRatios = React.useMemo(() => {
    const ratios = new Map<string, DailyTaskRatio>();
    const monthInterval = {
      start: startOfMonth(currentMonth),
      end: endOfMonth(currentMonth),
    };

    // Ensure interval is valid before proceeding
    if (!isValid(monthInterval.start) || !isValid(monthInterval.end) || monthInterval.start > monthInterval.end) {
        console.error("Invalid month interval for ratio calculation:", monthInterval);
        return ratios; // Return empty map if interval is invalid
    }

    const daysInMonth = eachDayOfInterval(monthInterval);

    daysInMonth.forEach((day) => {
      const dayKey = format(day, 'yyyy-MM-dd');
      const tasksOnDay = tasks.filter((task) => task.dueDate && isValid(task.dueDate) && isSameDay(task.dueDate, day));
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
    if (!isValid(day)) return <div className="text-destructive">Invalid Date</div>; // Handle invalid date rendering

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

    const isSelected = selectedDate && isValid(selectedDate) && isSameDay(day, selectedDate);
    const isCurrentDay = dateIsToday(day); // Use alias

    return (
      <Popover>
        <PopoverTrigger asChild>
          <div
            className={cn(
              'relative flex h-full w-full items-center justify-center rounded-md transition-colors duration-150',
              highlightClass,
              isSelected && 'ring-2 ring-ring ring-offset-2 bg-primary/30',
              isCurrentDay && !isSelected && 'border-2 border-foreground', // Use alias here
              !highlightClass && 'hover:bg-accent/50' // Hover effect for days without tasks
            )}
            role="button" // Make it seem interactive
            aria-label={`Date ${format(day, 'PPP')}${tooltipContent ? `, ${tooltipContent}` : ''}`}
            tabIndex={0} // Make it focusable
            onClick={() => handleDateSelect(day)} // Allow clicking div to select
             onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleDateSelect(day); }} // Keyboard selection
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
    // Validate dates before comparison
    if (!isValid(date) || !isValid(displayMonth)) {
        return <div className="text-destructive">Invalid Date</div>;
    }

    // Check if the date belongs to the currently displayed month
    if (date.getMonth() !== displayMonth.getMonth() || date.getFullYear() !== displayMonth.getFullYear()) {
      // Render days outside the current month differently
      return <div className="text-muted-foreground/50 flex h-full w-full items-center justify-center opacity-50">{format(date, 'd')}</div>;
    }
    // Render days within the current month using the highlight logic
    return renderDayWithHighlight(date);
  };


  const CustomCaption = (props: { displayMonth: Date }) => {
    if (!isValid(props.displayMonth)) return null; // Don't render caption for invalid month

    const handlePreviousMonth = () => {
       setCurrentMonth((prev) => {
           if (!isValid(prev)) return startOfMonth(new Date()); // Fallback if prev is invalid
           const newMonth = new Date(prev);
           newMonth.setMonth(newMonth.getMonth() - 1);
           return startOfMonth(newMonth);
       });
    };
    const handleNextMonth = () => {
       setCurrentMonth((prev) => {
           if (!isValid(prev)) return startOfMonth(new Date()); // Fallback if prev is invalid
           const newMonth = new Date(prev);
           newMonth.setMonth(newMonth.getMonth() + 1);
           return startOfMonth(newMonth);
        });
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
    // Use flex layout to grow and fill vertical space
    <div className="flex flex-col flex-grow p-4 md:p-6 lg:p-8 w-full">
      <header className="mb-6 border-b pb-4">
        <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
          <CalendarDays className="w-7 h-7" /> Calendar View
        </h1>
        <p className="text-muted-foreground mt-1">
            Visualize your tasks and deadlines. Days highlighted by task type ratio (Goals/Chores).
        </p>
      </header>

      {/* Main content area using grid, allowing sections to grow */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-grow">
        {/* Calendar Column - Takes more space */}
        <div className="lg:col-span-2 flex flex-col">
          <Card className="shadow-md flex flex-col flex-grow"> {/* Make card grow */}
            <CardContent className="p-0 flex flex-col flex-grow"> {/* Content grows */}
              {isLoadingTasks ? (
                 <Skeleton className="aspect-video w-full" />
              ) : (
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  // onSelect={handleDateSelect} // Selection is handled by CustomDay onClick now
                  month={isValid(currentMonth) ? currentMonth : startOfMonth(new Date())} // Ensure valid month
                  onMonthChange={handleMonthChange}
                  // Make calendar itself take full width and potentially height
                  className="w-full p-0 flex-grow flex flex-col [&>div]:flex-grow [&>div>div]:flex-grow"
                  classNames={{
                    // Adjust table/row/cell for better height distribution
                    table: "w-full border-collapse flex-grow flex flex-col",
                    head_row: "flex border-b",
                    head_cell: "w-full text-muted-foreground font-medium text-sm capitalize py-2 px-1 text-center",
                    // Let rows grow and distribute space
                    row: "flex w-full mt-0 border-b last:border-b-0 flex-grow",
                    // Cells should also fill height within the row
                    cell: cn(
                      "relative p-0 w-full text-center text-sm focus-within:relative focus-within:z-20 flex items-stretch justify-center", // Use items-stretch
                      "border-r last:border-r-0" // Vertical borders
                    ),
                    // Ensure day fills the cell
                    day: "h-full w-full p-0 font-normal flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
                    day_selected: "", // We handle selection style in CustomDay
                    day_today: "", // We handle today style in CustomDay
                    day_outside: "", // Handling outside days in CustomDay component now
                    day_disabled: "text-muted-foreground opacity-50 cursor-not-allowed", // Keep disabled style
                    // day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
                    // day_hidden: "invisible",
                    caption: "hidden", // Hide default caption
                  }}
                  components={{
                     Day: CustomDay, // Use custom Day component
                     Caption: CustomCaption, // Use custom Caption component
                  }}
                  modifiersClassNames={{
                      // You might not need these if CustomDay handles all styling
                      // selected: 'bg-primary/30 ring-2 ring-ring ring-offset-2',
                      // today: 'border-2 border-foreground',
                  }}
                  // Ensure selected date is valid before passing
                  // selected={selectedDate && isValid(selectedDate) ? selectedDate : undefined}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Selected Date Details Column - Also allow to grow */}
        <div className="lg:col-span-1 flex flex-col">
          <Card className="shadow-md flex flex-col flex-grow"> {/* Card grows */}
            <CardHeader>
              <CardTitle className="text-xl">
                {selectedDate && isValid(selectedDate) ? format(selectedDate, 'PPP') : 'Select a date'}
              </CardTitle>
            </CardHeader>
            {/* Let CardContent and ScrollArea grow */}
            <CardContent className="flex-grow flex flex-col">
              <ScrollArea className="flex-grow pr-4"> {/* Remove fixed height, allow grow */}
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
                             {/* Ensure dueDate is valid before formatting */}
                             {task.dueDate && isValid(task.dueDate) ? format(task.dueDate, 'p') : 'Invalid Time'} - {task.description}
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

