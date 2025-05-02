'use client';

import type { Task } from '@/ai/flows/prioritize-tasks';
import { prioritizeTasks } from '@/ai/flows/prioritize-tasks';
import { sendPersistentNotification } from '@/services/notification';
import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Trash2, Sparkles, Zap, Calendar as CalendarIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, isPast } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"


interface PrioritizedTask extends Task {
  id: string;
  name: string; // Added name field
  priority?: number;
  reason?: string;
  category: 'goal' | 'chore';
  completed: boolean;
}

const taskFormSchema = z.object({
  name: z.string().min(1, { message: 'Task name cannot be empty.' }), // Added name field
  description: z.string().min(1, { message: 'Description cannot be empty.' }),
  dueDate: z.date({ required_error: "A due date is required." }),
  category: z.enum(['goal', 'chore']),
});

type TaskFormData = z.infer<typeof taskFormSchema>;

const motivationalMessages = [
    "Don't stop when you're tired. Stop when you're done.",
    "Success is not final, failure is not fatal: It is the courage to continue that counts.",
    "Believe you can and you're halfway there.",
    "The only way to do great work is to love what you do.",
    "Your limitation—it's only your imagination.",
    "Push yourself, because no one else is going to do it for you."
];

const tauntingMessages = [
    "Still haven't done it? What are you waiting for?",
    "Procrastination called, it wants its champion back.",
    "Is this task too hard, or are you just avoiding it?",
    "Don't worry, the task will wait... forever, maybe?",
    "Tick tock... Are you going to do this today, or just add it to tomorrow's list again?",
    "Even snails make progress eventually. What's your excuse?"
];


export function TaskManager() {
  const [tasks, setTasks] = React.useState<PrioritizedTask[]>([]);
  const [forceMode, setForceMode] = React.useState(false);
  const [isLoadingAI, setIsLoadingAI] = React.useState(false);
  const [isLoadingTasks, setIsLoadingTasks] = React.useState(true); // Assume loading initially
  const { toast } = useToast();
  const notificationIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      name: '', // Default value for name
      description: '',
      dueDate: undefined,
      category: 'goal',
    },
  });

   // Load tasks from localStorage on mount
   React.useEffect(() => {
    try {
      const savedTasks = localStorage.getItem('tasks');
      if (savedTasks) {
          const parsedTasks: PrioritizedTask[] = JSON.parse(savedTasks).map((task: any) => ({
              ...task,
              name: task.name || task.description, // Add name, fallback to description for old tasks
              // Ensure dueDate is a Date object
              dueDate: task.dueDate ? new Date(task.dueDate) : new Date(),
          }));
          setTasks(parsedTasks);
      }
    } catch (error) {
        console.error("Failed to load tasks from localStorage:", error);
        // Handle error, maybe show a toast notification
        toast({
          title: "Error Loading Tasks",
          description: "Could not load tasks from local storage.",
          variant: "destructive",
        });
    } finally {
        setIsLoadingTasks(false); // Set loading to false after attempting to load
    }
   }, [toast]);

  // Save tasks to localStorage whenever tasks change
  React.useEffect(() => {
      if (!isLoadingTasks) { // Only save after initial load
          try {
              localStorage.setItem('tasks', JSON.stringify(tasks));
          } catch (error) {
              console.error("Failed to save tasks to localStorage:", error);
              toast({
                title: "Error Saving Tasks",
                description: "Could not save tasks to local storage.",
                variant: "destructive",
              });
          }
      }
  }, [tasks, isLoadingTasks, toast]);


  // Force mode effect
  React.useEffect(() => {
    if (forceMode) {
      notificationIntervalRef.current = setInterval(() => {
        const incompleteTasks = tasks.filter(task => !task.completed);
        if (incompleteTasks.length > 0) {
          const randomTask = incompleteTasks[Math.floor(Math.random() * incompleteTasks.length)];
          const messageType = Math.random() < 0.5 ? 'motivational' : 'taunting';
          const messages = messageType === 'motivational' ? motivationalMessages : tauntingMessages;
          const randomMessage = messages[Math.floor(Math.random() * messages.length)];
          const notificationMessage = `Reminder: "${randomTask.name}" is due ${format(randomTask.dueDate, 'PPP')}. ${randomMessage}`; // Use task name

          // Send persistent notification (console log for now)
          sendPersistentNotification(notificationMessage);

          // Show toast notification
          toast({
            title: `🚨 Task Reminder (${messageType}) 🚨`,
            description: notificationMessage,
            variant: isPast(randomTask.dueDate) ? "destructive" : "default",
            duration: 10000, // Show for 10 seconds
          });
        }
      }, 30000); // Send reminder every 30 seconds in force mode

      toast({
        title: "Force Mode Activated!",
        description: "Persistent reminders are now active.",
        variant: "default"
      });

    } else {
      if (notificationIntervalRef.current) {
        clearInterval(notificationIntervalRef.current);
        notificationIntervalRef.current = null;
      }
      toast({
        title: "Force Mode Deactivated.",
        description: "Persistent reminders stopped.",
        variant: "default"
      });
    }

    // Cleanup interval on component unmount or when forceMode changes
    return () => {
      if (notificationIntervalRef.current) {
        clearInterval(notificationIntervalRef.current);
      }
    };
  }, [forceMode, tasks, toast]);

  async function onSubmit(data: TaskFormData) {
    const newTask: PrioritizedTask = {
      id: crypto.randomUUID(),
      name: data.name, // Add name
      description: data.description,
      dueDate: data.dueDate, // Keep as Date object
      category: data.category,
      completed: false,
    };
    setTasks((prevTasks) => [...prevTasks, newTask]);
    form.reset();
    toast({
      title: "Task Added",
      description: `"${data.name}" added to your list.`, // Use name in toast
    });
  }

  const handlePrioritize = async () => {
    if (tasks.length === 0) {
      toast({
        title: 'No tasks to prioritize',
        description: 'Add some tasks first!',
        variant: 'destructive',
      });
      return;
    }
    setIsLoadingAI(true);
    try {
        // Note: AI flow currently uses description, not name.
        // If name should affect prioritization, update the AI flow.
      const tasksToPrioritize = tasks.map(task => ({
        description: task.description, // AI uses description
        dueDate: task.dueDate.toISOString(),
      }));

      const prioritizedResult = await prioritizeTasks(tasksToPrioritize);

      // Create a map for easy lookup based on description + dueDate as the AI doesn't know the ID or name
      const priorityMap = new Map(prioritizedResult.map(p => [p.description + p.dueDate, p]));

      const updatedTasks = tasks.map(task => {
        const key = task.description + task.dueDate.toISOString();
        const priorityData = priorityMap.get(key);
        return priorityData
          ? { ...task, priority: priorityData.priority, reason: priorityData.reason }
          : task; // Keep original task if not found in prioritized results
      }).sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity)); // Sort by priority

      setTasks(updatedTasks);
      toast({
        title: 'Tasks Prioritized!',
        description: 'AI has reordered your tasks by priority.',
      });

    } catch (error) {
      console.error('Error prioritizing tasks:', error);
      toast({
        title: 'AI Prioritization Failed',
        description: 'Could not prioritize tasks. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingAI(false);
    }
  };

  const deleteTask = (id: string) => {
    const taskToDelete = tasks.find(task => task.id === id);
    setTasks(tasks.filter((task) => task.id !== id));
    toast({
      title: 'Task Deleted',
      description: `"${taskToDelete?.name}" removed from your list.`, // Use name in toast
      variant: 'destructive'
    });
  };

  const toggleTaskCompletion = (id: string) => {
    const updatedTask = tasks.find(task => task.id === id);
    if (!updatedTask) return;

    setTasks(
      tasks.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task
      )
    );

     toast({
      title: updatedTask.completed ? 'Task Marked Incomplete' : 'Task Completed!',
      description: `"${updatedTask.name}" status updated.`, // Use name in toast
     });
  };

  const goals = tasks.filter(task => task.category === 'goal' && !task.completed);
  const chores = tasks.filter(task => task.category === 'chore' && !task.completed);
  const completedTasks = tasks.filter(task => task.completed);


  const renderTaskList = (taskList: PrioritizedTask[], title: string) => (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-xl">{title} ({taskList.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoadingTasks ? (
          <div className="space-y-3">
             <Skeleton className="h-10 w-full" />
             <Skeleton className="h-10 w-full" />
             <Skeleton className="h-10 w-full" />
          </div>
        ) : taskList.length === 0 ? (
          <p className="text-muted-foreground">No tasks here yet!</p>
        ) : (
          <ul className="space-y-3">
            {taskList.map((task) => (
              <li
                key={task.id}
                className={cn(
                  "flex items-center justify-between p-3 rounded-md border transition-all duration-200",
                  task.completed ? 'bg-secondary/50' : 'bg-card hover:bg-accent/50',
                  isPast(task.dueDate) && !task.completed ? 'border-destructive' : 'border-border'
                )}
              >
                <div className="flex items-center space-x-3 flex-grow mr-2 overflow-hidden">
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={() => toggleTaskCompletion(task.id)}
                    className="form-checkbox h-5 w-5 text-primary rounded focus:ring-primary cursor-pointer shrink-0"
                    aria-label={`Mark task ${task.name} as ${task.completed ? 'incomplete' : 'complete'}`} // Use name in aria-label
                  />
                  <div className="flex-grow overflow-hidden">
                    <span
                      className={cn(
                        "block font-semibold truncate", // Changed from font-medium to font-semibold
                        task.completed ? 'line-through text-muted-foreground' : 'text-foreground'
                      )}
                      title={task.name} // Use name in title attribute
                    >
                      {task.name} {/* Display task name */}
                    </span>
                     <span
                      className={cn(
                        "block text-sm truncate", // Added description display
                        task.completed ? 'text-muted-foreground/70' : 'text-muted-foreground'
                      )}
                      title={task.description}
                    >
                      {task.description}
                    </span>
                    <span className={cn("text-xs pt-1", task.completed ? 'text-muted-foreground/70' : 'text-muted-foreground')}> {/* Adjusted text size and padding */}
                      Due: {format(task.dueDate, 'PPP')}
                      {isPast(task.dueDate) && !task.completed && (
                         <Badge variant="destructive" className="ml-2">Overdue</Badge>
                      )}
                       {task.priority && !task.completed && (
                        <Badge variant={task.priority <= 3 ? "default" : "secondary"} className="ml-2" title={task.reason ?? undefined}> {/* Ensure title is string or undefined */}
                          P{task.priority}
                        </Badge>
                      )}
                       <Badge variant="outline" className="ml-2 capitalize">{task.category}</Badge>
                    </span>
                  </div>
                </div>
                <AlertDialog>
                   <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive shrink-0">
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Delete Task</span>
                     </Button>
                   </AlertDialogTrigger>
                   <AlertDialogContent>
                     <AlertDialogHeader>
                       <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                       <AlertDialogDescription>
                         This action cannot be undone. This will permanently delete the task
                         "{task.name}". {/* Use name in dialog */}
                       </AlertDialogDescription>
                     </AlertDialogHeader>
                     <AlertDialogFooter>
                       <AlertDialogCancel>Cancel</AlertDialogCancel>
                       <AlertDialogAction onClick={() => deleteTask(task.id)} className={buttonVariants({ variant: "destructive"})}>
                         Delete
                       </AlertDialogAction>
                     </AlertDialogFooter>
                   </AlertDialogContent>
                 </AlertDialog>

              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );


 return (
    <div className="container mx-auto p-4 md:p-6 lg:p-8">
      <header className="mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-primary">TaskMaster</h1>
        <div className="flex items-center space-x-4">
          <Button onClick={handlePrioritize} disabled={isLoadingAI || isLoadingTasks || tasks.length === 0}>
            {isLoadingAI ? (
              <>
                <Sparkles className="mr-2 h-4 w-4 animate-spin" /> Prioritizing...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" /> Prioritize with AI
              </>
            )}
          </Button>
          <div className="flex items-center space-x-2">
             <Zap className={`h-5 w-5 ${forceMode ? 'text-destructive animate-pulse' : 'text-muted-foreground'}`} />
             <Label htmlFor="force-mode" className={cn("font-semibold", forceMode ? 'text-destructive' : 'text-muted-foreground')}>
               Force Mode
             </Label>
             <Switch
               id="force-mode"
               checked={forceMode}
               onCheckedChange={setForceMode}
               aria-label="Toggle force mode"
             />
           </div>
        </div>
      </header>

      <Card className="mb-8 shadow-md">
        <CardHeader>
          <CardTitle>Add New Task</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
             <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Task Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Project Phoenix Kickoff" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Task Description</FormLabel>
                    <FormControl>
                      <Textarea placeholder="e.g., Prepare presentation slides, coordinate with team..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <FormField
                      control={form.control}
                      name="dueDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Due Date</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                    "w-full pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {field.value ? (
                                    format(field.value, "PPP")
                                  ) : (
                                    <span>Pick a date</span>
                                  )}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                disabled={(date) => date < new Date(new Date().setHours(0,0,0,0))} // Disable past dates
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                        control={form.control}
                        name="category"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Category</FormLabel>
                            <FormControl>
                            <div className="flex space-x-4 pt-2">
                                <FormItem className="flex items-center space-x-2">
                                <FormControl>
                                    <input
                                        type="radio"
                                        id="goal"
                                        value="goal"
                                        checked={field.value === 'goal'}
                                        onChange={field.onChange}
                                        className="form-radio h-4 w-4 text-primary focus:ring-primary"
                                    />
                                </FormControl>
                                <Label htmlFor="goal" className="font-normal cursor-pointer">Goal (Important)</Label>
                                </FormItem>
                                <FormItem className="flex items-center space-x-2">
                                <FormControl>
                                    <input
                                        type="radio"
                                        id="chore"
                                        value="chore"
                                        checked={field.value === 'chore'}
                                        onChange={field.onChange}
                                         className="form-radio h-4 w-4 text-primary focus:ring-primary"
                                    />
                                </FormControl>
                                <Label htmlFor="chore" className="font-normal cursor-pointer">Chore (Less Important)</Label>
                                </FormItem>
                            </div>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
              </div>


              <Button type="submit" className="w-full md:w-auto">Add Task</Button>
            </form>
          </Form>
        </CardContent>
      </Card>


      {renderTaskList(goals, '🎯 Goals')}
      {renderTaskList(chores, '🧹 Chores')}
      {completedTasks.length > 0 && renderTaskList(completedTasks, '✅ Completed Tasks')}

    </div>
  );
}

// Helper function used in AlertDialog
const buttonVariants = (options: { variant: 'destructive' | 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | null | undefined }) => {
    if (options.variant === 'destructive') {
        return "bg-destructive text-destructive-foreground hover:bg-destructive/90";
    }
    // Add other variants if needed, returning ShadCN button style classes
    return "bg-primary text-primary-foreground hover:bg-primary/90";
};
