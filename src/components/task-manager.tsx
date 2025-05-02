/**
 * @fileoverview Main component for managing tasks, including adding, displaying, prioritizing, and deleting tasks.
 * Integrates AI chatbot 'Airi' for task prioritization, creation via chat, motivation, and advice.
 */
'use client';

// import type { Task } from '@/ai/flows/prioritize-tasks'; // No longer needed directly
// import { prioritizeTasks } from '@/ai/flows/prioritize-tasks'; // No longer called directly
// import { createTaskFromVoice } from '@/ai/flows/create-task-from-voice'; // Removed
import { airiChat, type AiriChatInput, type AiriChatOutput } from '@/ai/flows/airi-chat-flow'; // Import the new chat flow
import { sendPersistentNotification } from '@/services/notification';
import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { Button, buttonVariants } from '@/components/ui/button';
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
import { Trash2, Sparkles, Zap, Calendar as CalendarIcon, Mic, MicOff, Clock, Bot, SendHorizontal, User } from 'lucide-react'; // Added Bot, SendHorizontal, User; Removed Mic related if not needed elsewhere
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, isPast, parseISO, setHours, setMinutes, startOfDay, isValid } from 'date-fns';
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
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter, SheetDescription, SheetClose } from "@/components/ui/sheet"; // Import Sheet components

// Removed SpeechRecognition declaration as voice input is replaced by chat

// Keep PrioritizedTask interface consistent
export interface PrioritizedTask { // Make sure to export if needed by flows/tools
  id: string;
  name: string;
  description: string;
  dueDate: Date; // Ensure dueDate is always Date object
  category: 'goal' | 'chore';
  completed: boolean;
  priority?: number;
  reason?: string;
}

// Chat message structure
interface ChatMessage {
    id: string;
    sender: 'user' | 'airi';
    text: string;
    timestamp: Date;
    // Optional: include task data if relevant to the message
    taskData?: PrioritizedTask | { name: string; priority?: number; reason?: string }[];
}

const taskFormSchema = z.object({
  name: z.string().min(1, { message: 'Task name cannot be empty.' }),
  description: z.string().min(1, { message: 'Description cannot be empty.' }),
  dueDate: z.date({ required_error: "A due date and time is required." }),
  category: z.enum(['goal', 'chore']),
});

type TaskFormData = z.infer<typeof taskFormSchema>;

// --- Motivational/Taunting Messages (Keep as before) ---
const motivationalMessages = [ /* ... keep existing messages ... */ ];
const tauntingMessages = [ /* ... keep existing messages ... */ ];

// --- DateTimePicker Component (Keep as before) ---
function DateTimePicker({ value, onChange, disabled }: { value: Date | undefined; onChange: (date: Date | undefined) => void; disabled?: (date: Date) => boolean }) {
    const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(value ? startOfDay(value) : undefined);
    const [hour12, setHour12] = React.useState<string>(value ? format(value, 'hh') : '09');
    const [minute, setMinute] = React.useState<string>(value ? format(value, 'mm') : '00');
    const [period, setPeriod] = React.useState<'AM' | 'PM'>(value ? (format(value, 'a') as 'AM' | 'PM') : 'AM');

    React.useEffect(() => {
      if (value && isValid(value)) {
        setSelectedDate(startOfDay(value));
        setHour12(format(value, 'hh'));
        setMinute(format(value, 'mm'));
        setPeriod(format(value, 'a') as 'AM' | 'PM');
      } else {
        const defaultDate = setMinutes(setHours(new Date(), 9), 0);
        setSelectedDate(startOfDay(defaultDate));
        setHour12('09');
        setMinute('00');
        setPeriod('AM');
        // if (!value) onChange(defaultDate); // Removed to avoid potential loops if onChange was in deps
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const updateDateTime = (newDate: Date | undefined, newHour12: string, newMinute: string, newPeriod: 'AM' | 'PM') => {
        if (!newDate) {
            onChange(undefined);
            return;
        }
        let hour24 = parseInt(newHour12, 10);
        if (newPeriod === 'PM' && hour24 !== 12) hour24 += 12;
        else if (newPeriod === 'AM' && hour24 === 12) hour24 = 0;
        const minuteVal = parseInt(newMinute, 10);
        if (!isNaN(hour24) && !isNaN(minuteVal)) {
            const newDateTime = setMinutes(setHours(newDate, hour24), minuteVal);
            if (isValid(newDateTime)) onChange(newDateTime);
            else console.error("Generated invalid date in DateTimePicker:", { newDate, hour24, minuteVal });
        }
    };

    const handleDateSelect = (date: Date | undefined) => {
      setSelectedDate(date);
      updateDateTime(date, hour12, minute, period);
    };

    const handleTimeChange = (type: 'hour' | 'minute' | 'period', val: string) => {
      let newHour12 = hour12, newMinute = minute, newPeriod = period;
      if (type === 'hour') newHour12 = val;
      if (type === 'minute') newMinute = val;
      if (type === 'period') newPeriod = val as 'AM' | 'PM';
      setHour12(newHour12); setMinute(newMinute); setPeriod(newPeriod);
      updateDateTime(selectedDate, newHour12, newMinute, newPeriod);
    };

    const hours12 = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const minutes = Array.from({ length: 60 / 5 }, (_, i) => String(i * 5).padStart(2, '0'));

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal", !value && "text-muted-foreground")}>
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value && isValid(value) ? format(value, "PPP p") : <span>Pick a date and time</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar mode="single" selected={selectedDate} onSelect={handleDateSelect} disabled={(date) => date < startOfDay(new Date()) || (disabled?.(date) ?? false)} initialFocus />
          <div className="p-4 border-t border-border flex items-center justify-center space-x-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <Select value={hour12} onValueChange={(val) => handleTimeChange('hour', val)}>
              <SelectTrigger className="w-[60px]"><SelectValue placeholder="HH" /></SelectTrigger>
              <SelectContent>{hours12.map((h) => (<SelectItem key={h} value={h}>{h}</SelectItem>))}</SelectContent>
            </Select>
            <span>:</span>
            <Select value={minute} onValueChange={(val) => handleTimeChange('minute', val)}>
              <SelectTrigger className="w-[60px]"><SelectValue placeholder="MM" /></SelectTrigger>
              <SelectContent>{minutes.map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}</SelectContent>
            </Select>
            <Select value={period} onValueChange={(val) => handleTimeChange('period', val)}>
                <SelectTrigger className="w-[65px]"><SelectValue placeholder="AM/PM"/></SelectTrigger>
                <SelectContent><SelectItem value="AM">AM</SelectItem><SelectItem value="PM">PM</SelectItem></SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>
    );
}


export function TaskManager() {
  const [tasks, setTasks] = React.useState<PrioritizedTask[]>([]);
  const [forceMode, setForceMode] = React.useState(false);
  const [isLoadingAI, setIsLoadingAI] = React.useState(false); // Now used for chat processing
  const [isLoadingTasks, setIsLoadingTasks] = React.useState(true);
  // Removed recording/voice states
  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = React.useState('');
  const [isChatOpen, setIsChatOpen] = React.useState(false); // State for chat sheet
  const chatScrollAreaRef = React.useRef<HTMLDivElement>(null);

  const { toast } = useToast();
  const notificationIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  // Removed recognitionRef

  // Default dueDate (Keep as before)
  const defaultDueDate = setMinutes(setHours(new Date(), 9), 0);

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: { name: '', description: '', dueDate: undefined, category: 'goal' },
  });

  // --- useEffect Hooks (Keep Load/Save and Force Mode as before) ---
  React.useEffect(() => {
    // Load tasks logic (no changes needed)
    try {
      const savedTasks = localStorage.getItem('tasks');
      if (savedTasks) {
          const parsedTasks: PrioritizedTask[] = JSON.parse(savedTasks).map((task: any) => {
            let parsedDate = task.dueDate ? parseISO(task.dueDate) : null;
            if (!parsedDate || !isValid(parsedDate)) {
                console.warn(`Invalid or missing dueDate for task "${task.name}". Defaulting to now.`);
                parsedDate = new Date();
            }
              return { ...task, name: task.name || task.description, dueDate: parsedDate };
          });
          setTasks(parsedTasks);
      }
    } catch (error) { /* ... error handling ... */ }
    finally { setIsLoadingTasks(false); }
   }, [toast]);

  React.useEffect(() => {
    // Save tasks logic (no changes needed)
      if (!isLoadingTasks) {
          try {
              const tasksToSave = tasks.map(task => ({ ...task, dueDate: task.dueDate.toISOString() }));
              localStorage.setItem('tasks', JSON.stringify(tasksToSave));
          } catch (error) { /* ... error handling ... */ }
      }
  }, [tasks, isLoadingTasks, toast]);

  React.useEffect(() => {
    // Force mode logic (no changes needed in the notification sending part)
    if (forceMode) { /* ... interval setup ... */ }
    else { /* ... interval cleanup ... */ }
    return () => { /* ... interval cleanup on unmount ... */ };
  }, [forceMode, tasks, toast]);


  // --- Chat Handling ---

  // Scroll to bottom of chat messages when new messages are added
  React.useEffect(() => {
    if (chatScrollAreaRef.current) {
        chatScrollAreaRef.current.scrollTo({ top: chatScrollAreaRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [chatMessages]);

  const handleChatSubmit = async (e?: React.FormEvent<HTMLFormElement>) => {
      e?.preventDefault(); // Prevent form submission if used in a form
      const messageText = chatInput.trim();
      if (!messageText || isLoadingAI) return;

      const newUserMessage: ChatMessage = {
          id: crypto.randomUUID(),
          sender: 'user',
          text: messageText,
          timestamp: new Date(),
      };

      setChatMessages((prev) => [...prev, newUserMessage]);
      setChatInput(''); // Clear input immediately
      setIsLoadingAI(true);

      try {
          // Prepare input for Airi, including current tasks if relevant intent suspected
          // The AI determines if tasks are needed based on the prompt.
          const airiInput: AiriChatInput = {
              message: messageText,
              currentTasks: tasks.map(t => ({ // Send simplified task structure
                  id: t.id,
                  name: t.name,
                  description: t.description,
                  dueDate: t.dueDate.toISOString(), // Send ISO string
                  category: t.category,
                  completed: t.completed,
              })),
          };

          const airiOutput: AiriChatOutput = await airiChat(airiInput);

          const newAiriMessage: ChatMessage = {
              id: crypto.randomUUID(),
              sender: 'airi',
              text: airiOutput.response || "...", // Default response if empty
              timestamp: new Date(),
          };

          // Handle side effects based on Airi's output
          if (airiOutput.createdTask) {
              // Add the task created by Airi
              // The flow output `createdTask` should already have dueDate as a Date object after post-processing
              const newTask = airiOutput.createdTask; // Type should be PrioritizedTask
              setTasks((prevTasks) => [...prevTasks, newTask].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()));
              newAiriMessage.taskData = newTask; // Attach task data to message for potential rendering
              toast({
                  title: `✅ Airi added task: ${newTask.name}`,
                  description: `Due: ${format(newTask.dueDate, 'Pp')}`,
              });
          }

          if (airiOutput.prioritizedTasks && airiOutput.prioritizedTasks.length > 0) {
              // Update task list with new priorities/reasons from Airi
              const priorityMap = new Map(airiOutput.prioritizedTasks.map(p => [p.name, p])); // Use name as key (assuming unique for this batch)
              const updatedTasks = tasks.map(task => {
                  const priorityData = priorityMap.get(task.name); // Match by name
                  return priorityData
                     ? { ...task, priority: priorityData.priority, reason: priorityData.reason }
                     : task;
                }).sort((a, b) => {
                    const priorityDiff = (a.priority ?? Infinity) - (b.priority ?? Infinity);
                    if (priorityDiff !== 0) return priorityDiff;
                    const dateA = a.dueDate && isValid(a.dueDate) ? a.dueDate.getTime() : Infinity;
                    const dateB = b.dueDate && isValid(b.dueDate) ? b.dueDate.getTime() : Infinity;
                    return dateA - dateB;
                });
              setTasks(updatedTasks);
               newAiriMessage.taskData = airiOutput.prioritizedTasks; // Attach prioritization summary
               toast({
                 title: '✨ Airi prioritized your tasks!',
                 description: 'Check the list for the new order and reasons.',
               });
          }

           if (!airiOutput.success && airiOutput.error) {
               newAiriMessage.text = `Hmph. Something went wrong: ${airiOutput.error}`; // Show error in chat
               toast({
                   title: 'Airi Malfunction!',
                   description: airiOutput.error,
                   variant: 'destructive',
               });
           }


          setChatMessages((prev) => [...prev, newAiriMessage]);

      } catch (error) {
          console.error('Error communicating with Airi:', error);
          const errorResponseMessage: ChatMessage = {
              id: crypto.randomUUID(),
              sender: 'airi',
              text: "Hmph. I couldn't process that. Maybe try again?",
              timestamp: new Date(),
          };
          setChatMessages((prev) => [...prev, errorResponseMessage]);
          toast({
              title: 'Chat Error',
              description: 'Could not get a response from Airi.',
              variant: 'destructive',
          });
      } finally {
          setIsLoadingAI(false);
          // Ensure input focus is maintained or returned after interaction
          // Might need ref to input field
      }
  };

  // --- Task Form Submission (Keep as before) ---
  async function onSubmit(data: TaskFormData) {
    let finalDueDate = data.dueDate;
    if (!finalDueDate || !isValid(finalDueDate)) { /* ... validation ... */ return; }
    const newTask: PrioritizedTask = {
      id: crypto.randomUUID(),
      name: data.name, description: data.description, dueDate: finalDueDate,
      category: data.category, completed: false,
    };
    setTasks((prevTasks) => [...prevTasks, newTask].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()));
    form.reset({ name: '', description: '', dueDate: undefined, category: 'goal' });
    toast({ title: "Task Added", description: `"${data.name}" added. Due: ${format(finalDueDate, 'Pp')}` });
  }

  // --- handlePrioritize Removed (handled by chat now) ---

  // --- deleteTask & toggleTaskCompletion (Keep as before) ---
  const deleteTask = (id: string) => {
    const taskToDelete = tasks.find(task => task.id === id);
    setTasks(tasks.filter((task) => task.id !== id));
    toast({ title: 'Task Deleted', description: `"${taskToDelete?.name}" removed.`, variant: 'destructive' });
  };

  const toggleTaskCompletion = (id: string) => {
    let toggledTaskName = '';
    let isNowCompleted: boolean | undefined = undefined;
    setTasks(prevTasks =>
      prevTasks.map((task) => {
        if (task.id === id) {
            toggledTaskName = task.name;
            isNowCompleted = !task.completed;
            return { ...task, completed: !task.completed };
        }
        return task;
      })
    );
    if (toggledTaskName && isNowCompleted !== undefined) {
         toast({ title: isNowCompleted ? 'Task Completed! 🎉' : 'Task Marked Incomplete', description: `"${toggledTaskName}" status updated.` });
     }
  };

  // --- Task List Filtering (Keep as before) ---
  const incompleteTasks = tasks.filter(task => !task.completed);
  const completedTasks = tasks.filter(task => task.completed);
  const goals = incompleteTasks.filter(task => task.category === 'goal');
  const chores = incompleteTasks.filter(task => task.category === 'chore');

  // --- Task List Rendering (Keep as before, slight adjustments maybe) ---
  const renderTaskList = (taskList: PrioritizedTask[], title: string) => (
    <Card className="mb-6 shadow-md hover:shadow-lg transition-shadow duration-200">
      <CardHeader>
        <CardTitle className="text-xl flex items-center">
            {title.includes('Goals') && '🎯 '} {title.includes('Chores') && '🧹 '} {title.includes('Completed') && '✅ '}
           {title} <Badge variant="secondary" className="ml-2">{taskList.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoadingTasks ? ( /* ... skeleton ... */ ''
        ) : taskList.length === 0 ? ( /* ... empty state ... */ ''
        ) : (
          <ul className="space-y-3">
            {taskList.map((task) => {
               const isDueDateValid = task.dueDate && isValid(task.dueDate);
               const formattedDueDate = isDueDateValid ? format(task.dueDate, 'Pp') : 'Invalid Date';
               const isTaskOverdue = isDueDateValid && isPast(task.dueDate) && !task.completed;
               return (
                <li key={task.id} className={cn("flex items-start md:items-center justify-between p-4 rounded-lg border transition-all duration-200 group", task.completed ? 'bg-secondary/30 border-dashed' : 'bg-card hover:bg-accent/40 hover:border-primary/50', isTaskOverdue ? 'border-destructive shadow-sm shadow-destructive/20' : 'border-border')}>
                  <div className="flex items-start space-x-4 flex-grow mr-2 overflow-hidden">
                     <input type="checkbox" checked={task.completed} onChange={() => toggleTaskCompletion(task.id)} className="form-checkbox h-6 w-6 text-primary rounded-md border-gray-300 focus:ring-primary cursor-pointer mt-1 shrink-0" aria-label={`Mark task ${task.name} as ${task.completed ? 'incomplete' : 'complete'}`} />
                    <div className="flex-grow overflow-hidden pt-0.5">
                      <span className={cn("block font-semibold text-base truncate", task.completed ? 'line-through text-muted-foreground/80' : 'text-foreground')} title={task.name}>
                        {task.name}
                         {task.priority && !task.completed && ( <Badge variant={task.priority <= 2 ? "destructive" : task.priority <= 5 ? "default" : "secondary"} className="ml-2 align-middle text-xs" title={task.reason ? `Priority Reason: ${task.reason}` : `Priority: ${task.priority}`}>🔥 P{task.priority}</Badge> )}
                      </span>
                       <span className={cn("block text-sm mt-1 truncate", task.completed ? 'text-muted-foreground/60' : 'text-muted-foreground')} title={task.description}> {task.description} </span>
                      <div className={cn("text-xs mt-2 flex items-center gap-2 flex-wrap", task.completed ? 'text-muted-foreground/60' : 'text-muted-foreground')}>
                        <span className="flex items-center gap-1"><CalendarIcon className="h-3 w-3" />Due: {formattedDueDate}</span>
                        {isTaskOverdue && (<Badge variant="destructive" className="text-xs px-1.5 py-0.5">🚨 Overdue</Badge>)}
                         <Badge variant="outline" className="capitalize text-xs px-1.5 py-0.5">{task.category}</Badge>
                      </div>
                    </div>
                  </div>
                   <AlertDialog>
                     <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className={cn("text-muted-foreground hover:text-destructive shrink-0 transition-opacity duration-200", task.completed ? "opacity-50" : "opacity-70 group-hover:opacity-100")}> <Trash2 className="h-4 w-4" /> <span className="sr-only">Delete Task</span> </Button></AlertDialogTrigger>
                     <AlertDialogContent>
                       <AlertDialogHeader> <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle> <AlertDialogDescription> This action cannot be undone. This will permanently delete the task <strong className="px-1">{task.name}</strong> due on <strong className="px-1">{formattedDueDate}</strong>. </AlertDialogDescription> </AlertDialogHeader>
                       <AlertDialogFooter> <AlertDialogCancel>Cancel</AlertDialogCancel> <AlertDialogAction onClick={() => deleteTask(task.id)} className={buttonVariants({ variant: "destructive"})}> Yes, Delete Task </AlertDialogAction> </AlertDialogFooter>
                     </AlertDialogContent>
                   </AlertDialog>
                </li>
            ); })}
          </ul>
        )}
      </CardContent>
    </Card>
  );


 return (
    <div className="container mx-auto p-4 md:p-6 lg:p-8 max-w-4xl">
      <header className="mb-8 flex flex-col sm:flex-row items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-2">
           <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7"><path d="M15 6.002v12m-6-12v12M19 8.002H5M19 16H5"/></svg>
             TaskMaster
           </h1>
        </div>
        <div className="flex items-center space-x-3">

         {/* Airi Chat Button */}
         <Sheet open={isChatOpen} onOpenChange={setIsChatOpen}>
              <SheetTrigger asChild>
                  <Button variant="outline">
                      <Bot className="mr-2 h-5 w-5" /> Ask Airi
                  </Button>
              </SheetTrigger>
              <SheetContent className="w-full max-w-md flex flex-col p-0" side="right">
                 <SheetHeader className="p-6 pb-4 border-b">
                      <SheetTitle className="flex items-center gap-2 text-xl">
                          <Bot className="h-6 w-6 text-primary" /> Chat with Airi
                      </SheetTitle>
                      <SheetDescription>
                         Your tsundere assistant for tasks, motivation, and advice.
                      </SheetDescription>
                 </SheetHeader>
                  {/* Chat Messages Area */}
                  <ScrollArea className="flex-grow p-4" ref={chatScrollAreaRef}>
                     <div className="space-y-4">
                          {chatMessages.map((msg) => (
                              <div key={msg.id} className={cn("flex items-end gap-2", msg.sender === 'user' ? 'justify-end' : 'justify-start')}>
                                  {msg.sender === 'airi' && <Bot className="h-6 w-6 text-primary shrink-0 mb-1" />}
                                  <div className={cn("rounded-lg p-3 max-w-[80%]", msg.sender === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                                      <p className="text-sm">{msg.text}</p>
                                      {/* Optionally render task data if present */}
                                      {/* {msg.taskData && <pre className="text-xs mt-2 bg-background/50 p-1 rounded">{JSON.stringify(msg.taskData, null, 2)}</pre>} */}
                                      <p className="text-xs mt-1 opacity-70 text-right">{format(msg.timestamp, 'p')}</p>
                                  </div>
                                   {msg.sender === 'user' && <User className="h-6 w-6 text-muted-foreground shrink-0 mb-1" />}
                              </div>
                          ))}
                          {isLoadingAI && (
                              <div className="flex items-center gap-2 justify-start">
                                  <Bot className="h-6 w-6 text-primary shrink-0" />
                                  <Skeleton className="h-10 w-20 rounded-lg bg-muted" />
                              </div>
                          )}
                     </div>
                  </ScrollArea>
                  {/* Chat Input Area */}
                  <SheetFooter className="p-4 border-t bg-background">
                      <form onSubmit={handleChatSubmit} className="flex items-center gap-2 w-full">
                          <Input
                              type="text"
                              placeholder="Ask Airi..."
                              value={chatInput}
                              onChange={(e) => setChatInput(e.target.value)}
                              disabled={isLoadingAI}
                              className="flex-grow"
                              autoComplete="off"
                          />
                          <Button type="submit" size="icon" disabled={isLoadingAI || !chatInput.trim()}>
                              {isLoadingAI ? <Sparkles className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
                              <span className="sr-only">Send message</span>
                          </Button>
                      </form>
                  </SheetFooter>
              </SheetContent>
         </Sheet>

          {/* Removed Prioritize Button */}
          {/* Removed Voice Command Button */}

          {/* Force Mode Switch (Keep as before) */}
          <div className="flex items-center space-x-2 p-2 rounded-md bg-secondary/50 border">
             <Zap className={`h-5 w-5 transition-colors ${forceMode ? 'text-destructive animate-pulse' : 'text-muted-foreground/80'}`} />
             <Label htmlFor="force-mode" className={cn("text-sm font-medium cursor-pointer", forceMode ? 'text-destructive' : 'text-muted-foreground')}> Force Mode </Label>
             <Switch id="force-mode" checked={forceMode} onCheckedChange={setForceMode} aria-label="Toggle force mode (persistent reminders)" className="data-[state=checked]:bg-destructive" />
           </div>
        </div>
      </header>

       {/* Task Form (Keep as before) */}
      <Card className="mb-8 shadow-md border border-primary/20">
        <CardHeader><CardTitle className="text-xl">Add New Task</CardTitle></CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
             <FormField control={form.control} name="name" render={({ field }) => ( <FormItem><FormLabel>Task Name</FormLabel><FormControl><Input placeholder="e.g., Finish project report" {...field} /></FormControl><FormMessage /></FormItem> )} />
              <FormField control={form.control} name="description" render={({ field }) => ( <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea placeholder="e.g., Include Q3 data, proofread, and send to manager..." {...field} rows={3} /></FormControl><FormMessage /></FormItem> )} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <FormField control={form.control} name="dueDate" render={({ field }) => ( <FormItem className="flex flex-col"><FormLabel>Due Date & Time</FormLabel><DateTimePicker value={field.value} onChange={field.onChange} disabled={(date) => date < startOfDay(new Date())} /><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="category" render={({ field }) => ( <FormItem><FormLabel>Category</FormLabel><FormControl>
                              <div className="flex space-x-4 pt-2">
                                <Label htmlFor="goal-radio" className={cn( "flex items-center space-x-2 cursor-pointer rounded-md border p-3 transition-colors hover:bg-accent", field.value === 'goal' && "bg-primary/10 border-primary" )}>
                                  <FormControl><input type="radio" id="goal-radio" value="goal" checked={field.value === 'goal'} onChange={() => field.onChange('goal')} className="form-radio h-4 w-4 text-primary focus:ring-primary cursor-pointer" /></FormControl>
                                  <span className="font-medium">🎯 Goal</span>
                                </Label>
                                <Label htmlFor="chore-radio" className={cn( "flex items-center space-x-2 cursor-pointer rounded-md border p-3 transition-colors hover:bg-accent", field.value === 'chore' && "bg-primary/10 border-primary" )}>
                                  <FormControl><input type="radio" id="chore-radio" value="chore" checked={field.value === 'chore'} onChange={() => field.onChange('chore')} className="form-radio h-4 w-4 text-primary focus:ring-primary cursor-pointer" /></FormControl>
                                   <span className="font-medium">🧹 Chore</span>
                                </Label>
                              </div>
                            </FormControl><FormMessage /></FormItem> )} />
              </div>
              <div className="flex justify-end"><Button type="submit" size="lg">Add Task</Button></div>
            </form>
          </Form>
        </CardContent>
      </Card>

       {/* Task Lists (Keep as before) */}
       <div className="space-y-8">
          {renderTaskList(goals, 'Current Goals')}
          {renderTaskList(chores, 'Current Chores')}
          {completedTasks.length > 0 && renderTaskList(completedTasks, 'Completed Tasks')}
      </div>

    </div>
  );
}
