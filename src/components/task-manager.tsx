/**
 * @fileoverview Main component for managing tasks, including adding, displaying, prioritizing, and deleting tasks.
 * Integrates AI for task prioritization and voice command interpretation.
 */
'use client';

import type { Task } from '@/ai/flows/prioritize-tasks';
import { prioritizeTasks } from '@/ai/flows/prioritize-tasks';
import { createTaskFromVoice } from '@/ai/flows/create-task-from-voice'; // Import the new flow
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
import { Trash2, Sparkles, Zap, Calendar as CalendarIcon, Mic, MicOff, Clock } from 'lucide-react'; // Added Mic, MicOff, Clock
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format, isPast, parseISO, setHours, setMinutes, startOfDay, isValid } from 'date-fns'; // Added parseISO, setHours, setMinutes, startOfDay, isValid
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'; // Import Select components

// Extend window type for SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}


interface PrioritizedTask extends Task {
  id: string;
  name: string;
  priority?: number;
  reason?: string;
  category: 'goal' | 'chore';
  completed: boolean;
  dueDate: Date; // Ensure dueDate is always Date object, now including time
}

const taskFormSchema = z.object({
  name: z.string().min(1, { message: 'Task name cannot be empty.' }),
  description: z.string().min(1, { message: 'Description cannot be empty.' }),
  // dueDate will now hold both date and time
  dueDate: z.date({ required_error: "A due date and time is required." }),
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

// Helper component for combined date and time selection with AM/PM
function DateTimePicker({
  value,
  onChange,
  disabled,
}: {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  disabled?: (date: Date) => boolean;
}) {
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(value ? startOfDay(value) : undefined);
  // Use 'hh' for 12-hour format, default to '09' (9 AM)
  const [hour12, setHour12] = React.useState<string>(value ? format(value, 'hh') : '09');
  const [minute, setMinute] = React.useState<string>(value ? format(value, 'mm') : '00');
  // Use 'a' for AM/PM, default to 'AM'
  const [period, setPeriod] = React.useState<'AM' | 'PM'>(value ? (format(value, 'a') as 'AM' | 'PM') : 'AM');

  // Update internal state if the external value changes
  React.useEffect(() => {
    if (value && isValid(value)) {
      setSelectedDate(startOfDay(value));
      setHour12(format(value, 'hh'));
      setMinute(format(value, 'mm'));
      setPeriod(format(value, 'a') as 'AM' | 'PM');
    } else {
      // Default to today 9:00 AM if no value or invalid value
      const defaultDate = setMinutes(setHours(new Date(), 9), 0);
      setSelectedDate(startOfDay(defaultDate));
      setHour12('09');
      setMinute('00');
      setPeriod('AM');
      // Optionally call onChange to set a default value initially if `value` was undefined
      // if (!value) onChange(defaultDate);
    }
  }, [value]); // Removed onChange from dependencies to avoid potential loops

  const updateDateTime = (newDate: Date | undefined, newHour12: string, newMinute: string, newPeriod: 'AM' | 'PM') => {
      if (!newDate) {
          onChange(undefined);
          return;
      }

      let hour24 = parseInt(newHour12, 10);
      if (newPeriod === 'PM' && hour24 !== 12) {
          hour24 += 12;
      } else if (newPeriod === 'AM' && hour24 === 12) { // Handle 12 AM (midnight)
          hour24 = 0;
      }

      const minuteVal = parseInt(newMinute, 10);

      if (!isNaN(hour24) && !isNaN(minuteVal)) {
          const newDateTime = setMinutes(setHours(newDate, hour24), minuteVal);
          if (isValid(newDateTime)) {
            onChange(newDateTime);
          } else {
              console.error("Generated invalid date in DateTimePicker:", { newDate, hour24, minuteVal });
          }
      }
  };

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    updateDateTime(date, hour12, minute, period);
  };

  const handleTimeChange = (type: 'hour' | 'minute' | 'period', val: string) => {
    let newHour12 = hour12;
    let newMinute = minute;
    let newPeriod = period;

    if (type === 'hour') newHour12 = val;
    if (type === 'minute') newMinute = val;
    if (type === 'period') newPeriod = val as 'AM' | 'PM';

    setHour12(newHour12);
    setMinute(newMinute);
    setPeriod(newPeriod);

    updateDateTime(selectedDate, newHour12, newMinute, newPeriod);
  };

  // 12-hour format hours (01-12)
  const hours12 = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  const minutes = Array.from({ length: 60 / 5 }, (_, i) => String(i * 5).padStart(2, '0')); // 5-minute increments

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          className={cn(
            "w-full justify-start text-left font-normal",
            !value && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value && isValid(value) ? format(value, "PPP p") : <span>Pick a date and time</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleDateSelect}
          disabled={(date) => {
            const today = startOfDay(new Date());
            return date < today || (disabled?.(date) ?? false);
           }}
          initialFocus
        />
        <div className="p-4 border-t border-border flex items-center justify-center space-x-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          {/* Hour Select (12-hour) */}
          <Select value={hour12} onValueChange={(val) => handleTimeChange('hour', val)}>
            <SelectTrigger className="w-[60px]">
              <SelectValue placeholder="HH" />
            </SelectTrigger>
            <SelectContent>
              {hours12.map((h) => (
                <SelectItem key={h} value={h}>{h}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>:</span>
          {/* Minute Select */}
          <Select value={minute} onValueChange={(val) => handleTimeChange('minute', val)}>
            <SelectTrigger className="w-[60px]">
              <SelectValue placeholder="MM" />
            </SelectTrigger>
            <SelectContent>
              {minutes.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* AM/PM Select */}
          <Select value={period} onValueChange={(val) => handleTimeChange('period', val)}>
              <SelectTrigger className="w-[65px]">
                  <SelectValue placeholder="AM/PM"/>
              </SelectTrigger>
              <SelectContent>
                  <SelectItem value="AM">AM</SelectItem>
                  <SelectItem value="PM">PM</SelectItem>
              </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
}


export function TaskManager() {
  const [tasks, setTasks] = React.useState<PrioritizedTask[]>([]);
  const [forceMode, setForceMode] = React.useState(false);
  const [isLoadingAI, setIsLoadingAI] = React.useState(false);
  const [isLoadingTasks, setIsLoadingTasks] = React.useState(true);
  const [isRecording, setIsRecording] = React.useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = React.useState(false);
  const [transcript, setTranscript] = React.useState('');
  const { toast } = useToast();
  const notificationIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = React.useRef<any>(null);

  // Default dueDate to today at 9:00 AM
  const defaultDueDate = setMinutes(setHours(new Date(), 9), 0);

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      name: '',
      description: '',
      dueDate: undefined, // Let the DateTimePicker handle the default display
      category: 'goal',
    },
  });

   // Load tasks from localStorage on mount
   React.useEffect(() => {
    try {
      const savedTasks = localStorage.getItem('tasks');
      if (savedTasks) {
          const parsedTasks: PrioritizedTask[] = JSON.parse(savedTasks).map((task: any) => {
             // Try parsing the stored date string
            let parsedDate = task.dueDate ? parseISO(task.dueDate) : null;
            // If invalid or missing, default to current date+time
            if (!parsedDate || !isValid(parsedDate)) {
                console.warn(`Invalid or missing dueDate for task "${task.name}". Defaulting to now.`);
                parsedDate = new Date();
            }
              return {
                  ...task,
                  name: task.name || task.description,
                  dueDate: parsedDate, // Store as Date object
              }
          });
          setTasks(parsedTasks);
      }
    } catch (error) {
        console.error("Failed to load tasks from localStorage:", error);
        toast({
          title: "Error Loading Tasks",
          description: "Could not load tasks from local storage.",
          variant: "destructive",
        });
    } finally {
        setIsLoadingTasks(false);
    }
   }, [toast]);

  // Save tasks to localStorage whenever tasks change
  React.useEffect(() => {
      if (!isLoadingTasks) {
          try {
              // Convert dueDate back to ISO string for storage
              const tasksToSave = tasks.map(task => ({
                  ...task,
                  dueDate: task.dueDate.toISOString(),
              }));
              localStorage.setItem('tasks', JSON.stringify(tasksToSave));
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
          const now = new Date();
          // Find tasks due within the next hour or overdue
          const urgentTasks = incompleteTasks.filter(task => task.dueDate && (isPast(task.dueDate) || (task.dueDate.getTime() - now.getTime()) < 60 * 60 * 1000));
          if (urgentTasks.length > 0) {
              const taskToSend = urgentTasks[Math.floor(Math.random() * urgentTasks.length)];

              const messageType = Math.random() < 0.5 ? 'motivational' : 'taunting';
              const messages = messageType === 'motivational' ? motivationalMessages : tauntingMessages;
              const randomMessage = messages[Math.floor(Math.random() * messages.length)];
              const notificationMessage = `Reminder: "${taskToSend.name}" ${isPast(taskToSend.dueDate) ? 'was due' : 'is due'} ${format(taskToSend.dueDate, 'Pp')}. ${randomMessage}`;

              sendPersistentNotification(notificationMessage);

              toast({
                title: `🚨 Task Reminder (${messageType}) 🚨`,
                description: notificationMessage,
                variant: isPast(taskToSend.dueDate) ? "destructive" : "default",
                duration: 10000,
              });
          } else if (incompleteTasks.length > 0) {
             // Send a general reminder if no urgent tasks
             const taskToSend = incompleteTasks[Math.floor(Math.random() * incompleteTasks.length)];
             const messageType = Math.random() < 0.5 ? 'motivational' : 'taunting';
             const messages = messageType === 'motivational' ? motivationalMessages : tauntingMessages;
             const randomMessage = messages[Math.floor(Math.random() * messages.length)];
             const notificationMessage = `Gentle Reminder: Don't forget about "${taskToSend.name}" due ${format(taskToSend.dueDate, 'Pp')}. ${randomMessage}`;

             sendPersistentNotification(notificationMessage);
             toast({
                title: `🔔 Task Reminder (${messageType}) 🔔`,
                description: notificationMessage,
                variant: "default",
                duration: 10000,
             });
          }

        }
      }, 30000); // Check every 30 seconds

      toast({
        title: "⚡ Force Mode Activated! ⚡",
        description: "Get ready for persistent, slightly annoying reminders.",
        variant: "default"
      });

    } else {
      if (notificationIntervalRef.current) {
        clearInterval(notificationIntervalRef.current);
        notificationIntervalRef.current = null;
      }
      // Don't show deactivation toast if it wasn't active initially
      // (prevents toast on initial load if forceMode starts as false)
      if (notificationIntervalRef.current !== null || forceMode) { // Check if it *was* running or is *currently* true
          toast({
            title: "😌 Force Mode Deactivated.",
            description: "You're on your own now. Good luck.",
            variant: "default"
          });
      }
    }

    // Cleanup interval on component unmount
    return () => {
      if (notificationIntervalRef.current) {
        clearInterval(notificationIntervalRef.current);
      }
    };
  }, [forceMode, tasks, toast]);

  // Initialize Speech Recognition
  React.useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const currentTranscript = event.results[0][0].transcript;
        setTranscript(currentTranscript);
        handleVoiceCommand(currentTranscript);
        setIsRecording(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        let description = `Error: ${event.error}. Please try again.`;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            description = "Microphone access denied. Please grant permission in your browser settings.";
        } else if (event.error === 'network') {
            description = "Network error during speech recognition. Check your internet connection.";
        } else if (event.error === 'no-speech') {
            description = "No speech detected. Please speak clearly.";
        } else if (event.error === 'audio-capture') {
             description = "Audio capture failed. Check microphone connection/settings.";
        }
        toast({
          title: 'Voice Recognition Error',
          description: description,
          variant: 'destructive',
        });
        setIsRecording(false);
        setIsProcessingVoice(false);
      };

      recognitionRef.current.onend = () => {
        // Ensure recording stops if recognition ends unexpectedly
         if (isRecording) { // Only update state if it was supposed to be recording
             setIsRecording(false);
             // Maybe add a toast if it ended unexpectedly without a result or error?
             // console.log("Speech recognition ended.");
         }
      };
    } else {
      console.warn('Speech Recognition not supported in this browser.');
      // Maybe disable the mic button if not supported
    }

    // Cleanup: Stop recognition if component unmounts while recording
    return () => {
        if (recognitionRef.current && isRecording) {
             console.log("Stopping speech recognition on unmount.");
            recognitionRef.current.stop();
        }
    };
  // isRecording is removed to prevent re-initialization loops on state change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]); // Keep toast dependency

  const startRecording = () => {
    if (!recognitionRef.current) {
         toast({
            title: 'Voice Input Not Supported',
            description: 'Your browser does not support speech recognition.',
            variant: 'destructive',
         });
         return; // Stop if not supported
    }

    if (isRecording) {
        // If already recording, stop it
        stopRecording();
    } else {
        // If not recording, start it
        try {
            setTranscript(''); // Clear previous transcript
            recognitionRef.current.start();
            setIsRecording(true);
            toast({
                title: '🎙️ Listening...',
                description: 'Speak your task command clearly.',
            });
        } catch (error: any) {
            console.error("Error starting speech recognition:", error);
             toast({
                title: 'Could not start recording',
                // Provide more specific error messages if possible
                description: error.name === 'NotAllowedError' ? 'Microphone permission denied.' : (error.message || 'Please ensure microphone permissions are granted and the mic is working.'),
                variant: 'destructive',
             });
             setIsRecording(false); // Ensure state is reset on error
        }
    }
  };

  // Explicit function to stop recording
  const stopRecording = () => {
    if (recognitionRef.current && isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
      // Optional: Add a toast indicating recording stopped manually
      // toast({ title: 'Recording stopped.'});
    }
  };

  const handleVoiceCommand = async (command: string) => {
    if (!command) return;

    setIsProcessingVoice(true);
    toast({
        title: '🧠 Processing Voice Command...',
        description: `"${command}"`,
    });

    try {
        // Pass the current date and time to the AI flow
        const result = await createTaskFromVoice({ command });

        if (result.success && result.task) {
            const { name, description, dueDate: dueDateString, category } = result.task;
            // Attempt to parse the date-time string from AI (expects ISO 8601 UTC)
            let dueDate = parseISO(dueDateString);

            // Validate the parsed date
            if (!isValid(dueDate)) {
                 console.warn(`Invalid date/time format from AI: ${dueDateString}. Defaulting to today 9 AM.`);
                 dueDate = defaultDueDate; // Fallback to default
                 toast({
                     title: 'Date Parsing Warning',
                     description: `AI provided an invalid date/time (${dueDateString}). Task set to today 9 AM.`,
                     variant: 'default', // Use default variant for warning
                     duration: 6000,
                 });
            }
            // No need to check for 00:00 time, as the AI prompt asks for specific time calculation including defaults.

            const newTask: PrioritizedTask = {
              id: crypto.randomUUID(),
              name: name,
              description: description,
              dueDate: dueDate, // Use the validated/defaulted Date object
              category: category,
              completed: false,
            };
            setTasks((prevTasks) => [...prevTasks, newTask].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())); // Sort by due date
            form.reset({ // Reset form including the date picker state visually
                name: '',
                description: '',
                dueDate: undefined, // Reset to trigger placeholder
                category: 'goal',
            });
            toast({
              title: '✅ Task Created from Voice!',
              description: `"${name}" added. Due: ${format(dueDate, 'Pp')}`, // Format includes AM/PM
            });
        } else {
            toast({
              title: '⚠️ Could Not Create Task',
              description: result.explanation || 'The AI couldn\'t understand the task details. Please try again or add manually.',
              variant: 'destructive',
              duration: 7000,
            });
        }
    } catch (error) {
        console.error('Error processing voice command with AI:', error);
        toast({
            title: 'AI Processing Failed',
            description: 'Could not process the voice command. Please try again.',
            variant: 'destructive',
        });
    } finally {
        setIsProcessingVoice(false);
        setTranscript(''); // Clear transcript after processing
    }
};


  async function onSubmit(data: TaskFormData) {
    // The DateTimePicker now handles setting a valid date with time (including default 9 AM)
    let finalDueDate = data.dueDate;

     // Double check if somehow the date is invalid right before adding
     if (!finalDueDate || !isValid(finalDueDate)) {
         console.error("Invalid date submitted in form:", data.dueDate);
         toast({
             title: "Invalid Date Error",
             description: "The selected due date is invalid. Please select a valid date and time.",
             variant: "destructive",
         });
         return; // Prevent adding task with invalid date
     }

    // No need to default time here as DateTimePicker should handle it.
    // if (format(finalDueDate, 'HH:mm:ss') === '00:00:00') { ... }

    const newTask: PrioritizedTask = {
      id: crypto.randomUUID(),
      name: data.name,
      description: data.description,
      dueDate: finalDueDate, // Use the validated date object
      category: data.category,
      completed: false,
    };
    setTasks((prevTasks) => [...prevTasks, newTask].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())); // Sort by due date
    form.reset({ // Reset form fully after submission
        name: '',
        description: '',
        dueDate: undefined, // Reset date picker visual state
        category: 'goal',
    });
    toast({
      title: "Task Added",
      description: `"${data.name}" added. Due: ${format(finalDueDate, 'Pp')}`, // Format includes AM/PM
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
      // Prepare tasks for AI, ensuring dueDate is a valid Date and in ISO format
      const tasksToPrioritize = tasks
        .filter(task => task.dueDate && isValid(task.dueDate)) // Ensure valid dates
        .map(task => ({
            description: `${task.name} - ${task.description}`, // Combine name and desc for more context
            dueDate: task.dueDate.toISOString(), // Send full ISO string with time
      }));

        if (tasksToPrioritize.length === 0) {
             toast({
                title: 'No valid tasks to prioritize',
                description: 'Ensure tasks have valid descriptions and due dates.',
                variant: 'destructive',
             });
             setIsLoadingAI(false);
             return;
        }

      const prioritizedResult = await prioritizeTasks(tasksToPrioritize);

      // Create a map for easy lookup using the combined description + ISO dueDate string
      const priorityMap = new Map(prioritizedResult.map(p => [p.description + p.dueDate, p]));

      const updatedTasks = tasks.map(task => {
          // Use the same key format to find the priority data
          const key = `${task.name} - ${task.description}` + (task.dueDate && isValid(task.dueDate) ? task.dueDate.toISOString() : '');
          const priorityData = key ? priorityMap.get(key) : undefined;
          return priorityData
             ? { ...task, priority: priorityData.priority, reason: priorityData.reason }
             : task; // Keep original task if no priority info found (or date was invalid)
        }).sort((a, b) => {
            // Sort primarily by priority (lower number is higher priority)
            const priorityDiff = (a.priority ?? Infinity) - (b.priority ?? Infinity);
            if (priorityDiff !== 0) return priorityDiff;
            // If priorities are the same (or both undefined), sort by due date (earlier first)
            const dateA = a.dueDate && isValid(a.dueDate) ? a.dueDate.getTime() : Infinity;
            const dateB = b.dueDate && isValid(b.dueDate) ? b.dueDate.getTime() : Infinity;
            return dateA - dateB;
        });

      setTasks(updatedTasks);
      toast({
        title: '✨ Tasks Prioritized!',
        description: 'AI has reordered your tasks based on importance and urgency.',
      });

    } catch (error) {
      console.error('Error prioritizing tasks:', error);
      toast({
        title: 'AI Prioritization Failed',
        description: 'Could not prioritize tasks. Please try again later.',
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
      description: `"${taskToDelete?.name}" removed from your list.`,
      variant: 'destructive' // Use destructive variant for delete confirmation
    });
  };

  const toggleTaskCompletion = (id: string) => {
    let toggledTaskName = '';
    let isNowCompleted: boolean | undefined = undefined;

    setTasks(prevTasks =>
      prevTasks.map((task) => {
        if (task.id === id) {
            toggledTaskName = task.name;
            isNowCompleted = !task.completed; // Capture the *new* state
            return { ...task, completed: !task.completed };
        }
        return task;
      })
    );

    // Show toast *after* state update, using the captured new state
    if (toggledTaskName && isNowCompleted !== undefined) {
         toast({
          title: isNowCompleted ? 'Task Completed! 🎉' : 'Task Marked Incomplete',
          description: `"${toggledTaskName}" status updated.`,
         });
     }
  };

  // Separate lists based on completion status *first*
  const incompleteTasks = tasks.filter(task => !task.completed);
  const completedTasks = tasks.filter(task => task.completed);

  // Then categorize incomplete tasks
  const goals = incompleteTasks.filter(task => task.category === 'goal');
  const chores = incompleteTasks.filter(task => task.category === 'chore');


  const renderTaskList = (taskList: PrioritizedTask[], title: string) => (
    <Card className="mb-6 shadow-md hover:shadow-lg transition-shadow duration-200">
      <CardHeader>
        <CardTitle className="text-xl flex items-center">
            {title.includes('Goals') && '🎯 '}
            {title.includes('Chores') && '🧹 '}
            {title.includes('Completed') && '✅ '}
           {title} <Badge variant="secondary" className="ml-2">{taskList.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoadingTasks ? (
          <div className="space-y-3">
             <Skeleton className="h-16 w-full rounded-md" />
             <Skeleton className="h-16 w-full rounded-md" />
             <Skeleton className="h-16 w-full rounded-md" />
          </div>
        ) : taskList.length === 0 ? (
          <p className="text-muted-foreground italic text-center py-4">
            {title.includes('Completed') ? "Nothing done yet... Let's change that!" : "No tasks here. Add some above!"}
          </p>
        ) : (
          <ul className="space-y-3">
            {taskList.map((task) => {
              // Ensure dueDate is valid before proceeding with rendering involving it
               const isDueDateValid = task.dueDate && isValid(task.dueDate);
               const formattedDueDate = isDueDateValid ? format(task.dueDate, 'Pp') : 'Invalid Date';
               const isTaskOverdue = isDueDateValid && isPast(task.dueDate) && !task.completed;

               return (
                <li
                  key={task.id}
                  className={cn(
                    "flex items-start md:items-center justify-between p-4 rounded-lg border transition-all duration-200 group", // Use group for hover effects
                    task.completed ? 'bg-secondary/30 border-dashed' : 'bg-card hover:bg-accent/40 hover:border-primary/50',
                    isTaskOverdue ? 'border-destructive shadow-sm shadow-destructive/20' : 'border-border'
                  )}
                >
                  <div className="flex items-start space-x-4 flex-grow mr-2 overflow-hidden">
                     {/* Checkbox - slightly larger and more padding */}
                     <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={() => toggleTaskCompletion(task.id)}
                        className="form-checkbox h-6 w-6 text-primary rounded-md border-gray-300 focus:ring-primary cursor-pointer mt-1 shrink-0"
                        aria-label={`Mark task ${task.name} as ${task.completed ? 'incomplete' : 'complete'}`}
                      />

                    <div className="flex-grow overflow-hidden pt-0.5">
                       {/* Task Name */}
                      <span
                        className={cn(
                          "block font-semibold text-base truncate", // Slightly larger font
                          task.completed ? 'line-through text-muted-foreground/80' : 'text-foreground'
                        )}
                        title={task.name}
                      >
                        {task.name}
                         {/* Priority Badge */}
                         {task.priority && !task.completed && (
                          <Badge
                            variant={task.priority <= 2 ? "destructive" : task.priority <= 5 ? "default" : "secondary"}
                            className="ml-2 align-middle text-xs" // Align middle
                            title={task.reason ? `Priority Reason: ${task.reason}` : `Priority: ${task.priority}`}
                           >
                           🔥 P{task.priority}
                          </Badge>
                        )}
                      </span>
                      {/* Task Description */}
                       <span
                        className={cn(
                          "block text-sm mt-1 truncate",
                          task.completed ? 'text-muted-foreground/60' : 'text-muted-foreground'
                        )}
                        title={task.description}
                      >
                        {task.description}
                      </span>
                       {/* Due Date, Overdue, Category */}
                      <div className={cn("text-xs mt-2 flex items-center gap-2 flex-wrap", task.completed ? 'text-muted-foreground/60' : 'text-muted-foreground')}>
                        <span className="flex items-center gap-1">
                            <CalendarIcon className="h-3 w-3" />
                            Due: {formattedDueDate}
                        </span>
                        {isTaskOverdue && (
                           <Badge variant="destructive" className="text-xs px-1.5 py-0.5">🚨 Overdue</Badge>
                        )}
                         <Badge variant="outline" className="capitalize text-xs px-1.5 py-0.5">{task.category}</Badge>
                      </div>
                    </div>
                  </div>
                   {/* Delete Button */}
                   <AlertDialog>
                     <AlertDialogTrigger asChild>
                      <Button
                           variant="ghost"
                           size="icon"
                           className={cn(
                               "text-muted-foreground hover:text-destructive shrink-0 transition-opacity duration-200",
                               task.completed ? "opacity-50" : "opacity-70 group-hover:opacity-100" // Show on hover
                           )}
                      >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Delete Task</span>
                       </Button>
                     </AlertDialogTrigger>
                     <AlertDialogContent>
                       <AlertDialogHeader>
                         <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                         <AlertDialogDescription>
                           This action cannot be undone. This will permanently delete the task
                           <strong className="px-1">{task.name}</strong>
                           due on <strong className="px-1">{formattedDueDate}</strong>.
                         </AlertDialogDescription>
                       </AlertDialogHeader>
                       <AlertDialogFooter>
                         <AlertDialogCancel>Cancel</AlertDialogCancel>
                         <AlertDialogAction onClick={() => deleteTask(task.id)} className={buttonVariants({ variant: "destructive"})}>
                           Yes, Delete Task
                         </AlertDialogAction>
                       </AlertDialogFooter>
                     </AlertDialogContent>
                   </AlertDialog>
                </li>
            );
         })}
          </ul>
        )}
      </CardContent>
    </Card>
  );


 return (
    <div className="container mx-auto p-4 md:p-6 lg:p-8 max-w-4xl"> {/* Limit max width */}
      <header className="mb-8 flex flex-col sm:flex-row items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-2">
          {/* <AppLogo className="w-8 h-8 text-primary" /> */}
           <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7"><path d="M15 6.002v12m-6-12v12M19 8.002H5M19 16H5"/></svg> {/* Simple Hash/List Icon */}
             TaskMaster
           </h1>
        </div>
        <div className="flex items-center space-x-3">
         {/* Voice Command Button */}
         <Button
            variant={isRecording ? "destructive" : "outline"}
            size="icon"
            onClick={startRecording} // Use unified function
            disabled={isProcessingVoice || isLoadingTasks || !recognitionRef.current} // Disable if not supported
            className={cn(
                "transition-colors duration-200",
                isRecording && "animate-pulse",
                !recognitionRef.current && "opacity-50 cursor-not-allowed" // Style if not supported
             )}
            aria-label={isRecording ? "Stop recording" : "Start recording voice command"}
            title={!recognitionRef.current ? "Voice input not supported" : (isRecording ? "Stop Recording" : "Record Voice Command")}
          >
            {isProcessingVoice ? (
                <Sparkles className="h-5 w-5 animate-spin" />
            ) : isRecording ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </Button>

          {/* Prioritize Button */}
          <Button onClick={handlePrioritize} disabled={isLoadingAI || isLoadingTasks || tasks.length === 0}>
            {isLoadingAI ? (
              <>
                <Sparkles className="mr-2 h-4 w-4 animate-spin" /> Prioritizing...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" /> AI Priority
              </>
            )}
             <span className="sr-only">Prioritize tasks with AI</span>
          </Button>

           {/* Force Mode Switch */}
          <div className="flex items-center space-x-2 p-2 rounded-md bg-secondary/50 border">
             <Zap className={`h-5 w-5 transition-colors ${forceMode ? 'text-destructive animate-pulse' : 'text-muted-foreground/80'}`} />
             <Label htmlFor="force-mode" className={cn("text-sm font-medium cursor-pointer", forceMode ? 'text-destructive' : 'text-muted-foreground')}>
               Force Mode
             </Label>
             <Switch
               id="force-mode"
               checked={forceMode}
               onCheckedChange={setForceMode}
               aria-label="Toggle force mode (persistent reminders)"
               className="data-[state=checked]:bg-destructive"
             />
           </div>
        </div>
      </header>

       {/* Task Form */}
      <Card className="mb-8 shadow-md border border-primary/20">
        <CardHeader>
          <CardTitle className="text-xl">Add New Task</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6"> {/* Increased spacing */}
             <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Task Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Finish project report" {...field} />
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
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea placeholder="e.g., Include Q3 data, proofread, and send to manager..." {...field} rows={3} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6"> {/* Increased gap */}
                 <FormField
                      control={form.control}
                      name="dueDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Due Date & Time</FormLabel>
                          <DateTimePicker
                              value={field.value}
                              onChange={field.onChange}
                              disabled={(date) => date < startOfDay(new Date())} // Disable past days
                          />
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
                               {/* Styled Radio Group */}
                              <div className="flex space-x-4 pt-2">
                                <Label
                                  htmlFor="goal-radio"
                                  className={cn(
                                    "flex items-center space-x-2 cursor-pointer rounded-md border p-3 transition-colors hover:bg-accent",
                                    field.value === 'goal' && "bg-primary/10 border-primary"
                                  )}
                                >
                                  <FormControl>
                                    <input
                                      type="radio"
                                      id="goal-radio"
                                      value="goal"
                                      checked={field.value === 'goal'}
                                      onChange={() => field.onChange('goal')}
                                      className="form-radio h-4 w-4 text-primary focus:ring-primary cursor-pointer"
                                    />
                                  </FormControl>
                                  <span className="font-medium">🎯 Goal</span>
                                </Label>
                                <Label
                                  htmlFor="chore-radio"
                                  className={cn(
                                    "flex items-center space-x-2 cursor-pointer rounded-md border p-3 transition-colors hover:bg-accent",
                                     field.value === 'chore' && "bg-primary/10 border-primary"
                                  )}
                                >
                                  <FormControl>
                                    <input
                                      type="radio"
                                      id="chore-radio"
                                      value="chore"
                                      checked={field.value === 'chore'}
                                      onChange={() => field.onChange('chore')}
                                      className="form-radio h-4 w-4 text-primary focus:ring-primary cursor-pointer"
                                    />
                                  </FormControl>
                                   <span className="font-medium">🧹 Chore</span>
                                </Label>
                              </div>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
              </div>

              <div className="flex justify-end"> {/* Align button to the right */}
                 <Button type="submit" size="lg">Add Task</Button> {/* Larger button */}
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

       {/* Task Lists */}
       <div className="space-y-8"> {/* Add space between task list cards */}
          {renderTaskList(goals, 'Current Goals')}
          {renderTaskList(chores, 'Current Chores')}
          {completedTasks.length > 0 && renderTaskList(completedTasks, 'Completed Tasks')}
      </div>

    </div>
  );
}


// Helper function removed as buttonVariants is imported and used directly.
