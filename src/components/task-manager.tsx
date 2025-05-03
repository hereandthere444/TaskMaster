/**
 * @fileoverview Task management component with AI chat integration (Airi).
 * Allows adding, viewing, completing, deleting tasks, and interacting with Airi.
 */
'use client';

import * as React from 'react';
import { format, isValid, parseISO, startOfDay, endOfDay, parse as dateParse } from 'date-fns'; // Added dateParse
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  CalendarIcon,
  CheckCircle,
  Circle,
  Clock,
  Trash2,
  Plus,
  Sparkles,
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Target, // Icon for Goals
  ListChecks, // Icon for Chores
} from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { airiChat, type AiriChatInput, type AiriChatOutput, type PrioritizedTaskData as AiriPrioritizedTaskData } from '@/ai/flows/airi-chat-flow';
// Ensure correct import path if CreateTaskOutput is moved or defined elsewhere
import type { CreateTaskOutput as AiriCreatedTask } from '@/ai/schemas'; // Assuming schema definition file


// Define the structure of a task - dueDate can be Date or null
export interface PrioritizedTask {
  id: string;
  name: string;
  description: string;
  dueDate: Date | null; // Allow null for no due date
  category: 'goal' | 'chore';
  completed: boolean;
  priority?: number;
  reason?: string;
}

// --- Form Schemas ---

// Schema for adding/editing tasks - make dueDate and dueTime optional
const taskFormSchema = z.object({
  name: z.string().min(1, { message: 'Task name is required.' }),
  description: z.string().optional(),
  dueDate: z.date().optional().nullable(), // Allow null or undefined for date
  // Make time optional, regex ensures format if provided
  dueTime: z.string().regex(/^(0?[1-9]|1[0-2]):([0-5]\d) (AM|PM)$/i, { message: 'Invalid time (hh:mm AM/PM).' }).optional().nullable(),
  category: z.enum(['goal', 'chore']),
}).refine(data => {
    // Refine logic: Time requires a date.
    // If dueTime is provided (not empty/null/undefined), dueDate must also be provided.
    if (data.dueTime && !data.dueDate) {
        return false;
    }
    return true;
}, {
    message: "Cannot set a time without a date.",
    path: ["dueTime"], // Attach error to dueTime field
});


type TaskFormData = z.infer<typeof taskFormSchema>;

// Schema for Airi chat input
const airiChatFormSchema = z.object({
  message: z.string().min(1, { message: 'Message cannot be empty.' }),
});
type AiriChatFormData = z.infer<typeof airiChatFormSchema>;

// --- Speech Recognition ---
// Check for SpeechRecognition API availability
const SpeechRecognition =
  (typeof window !== 'undefined' && window.SpeechRecognition) ||
  (typeof window !== 'undefined' && (window as any).webkitSpeechRecognition);

// --- TaskManager Component ---
export function TaskManager() {
  const [tasks, setTasks] = React.useState<PrioritizedTask[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = React.useState(true);
  const [isSubmittingTask, setIsSubmittingTask] = React.useState(false);
  const [isAiLoading, setIsAiLoading] = React.useState(false); // State for AI loading
  const [editingTask, setEditingTask] = React.useState<PrioritizedTask | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
  const [chatMessages, setChatMessages] = React.useState<{ role: 'user' | 'airi' | 'system'; content: string }[]>([]);
  const [isChatOpen, setIsChatOpen] = React.useState(false);
  const [isListening, setIsListening] = React.useState(false);
  const [isTTSEnabled, setIsTTSEnabled] = React.useState(true);
  const [voices, setVoices] = React.useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = React.useState<SpeechSynthesisVoice | null>(null);


  const { toast } = useToast();
  const recognitionRef = React.useRef<any>(null); // Ref for SpeechRecognition instance
  const chatScrollAreaRef = React.useRef<HTMLDivElement>(null); // Ref for chat scroll area viewport

  // --- Initialization and Data Loading ---

  // Load tasks from localStorage on mount
  React.useEffect(() => {
    try {
      const savedTasks = localStorage.getItem('tasks');
      if (savedTasks) {
        const parsedTasks: PrioritizedTask[] = JSON.parse(savedTasks).map(
          (task: any) => {
             // Handle potentially null dueDate from storage
            let parsedDate: Date | null = null;
            if (task.dueDate) {
                parsedDate = parseISO(task.dueDate);
                if (!isValid(parsedDate)) {
                    console.warn(`Invalid stored dueDate "${task.dueDate}" for task "${task.name}". Setting to null.`);
                    parsedDate = null; // Set to null if invalid
                }
            }
            return {
                ...task,
                name: task.name || task.description || 'Unnamed Task', // Ensure name exists
                dueDate: parsedDate, // Store as Date or null
                category: task.category || 'goal', // Default category
                completed: task.completed || false, // Default completion
            };
          }
        ).filter(task => task.dueDate === null || isValid(task.dueDate)); // Allow null or valid dates
        setTasks(parsedTasks);
      }
    } catch (error) {
      console.error('Failed to load tasks from localStorage:', error);
      toast({
        title: 'Error Loading Tasks',
        description: 'Could not load your tasks.',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingTasks(false);
    }
  }, [toast]);

  // Save tasks to localStorage whenever they change
  React.useEffect(() => {
    if (!isLoadingTasks) { // Only save after initial load
      try {
        localStorage.setItem('tasks', JSON.stringify(tasks));
      } catch (error) {
        console.error('Failed to save tasks to localStorage:', error);
        toast({
          title: 'Error Saving Tasks',
          description: 'Could not save task changes.',
          variant: 'destructive',
        });
      }
    }
  }, [tasks, isLoadingTasks, toast]);

   // Load TTS Voices and Select Best Female English Voice
   React.useEffect(() => {
    const loadVoices = () => {
        const availableVoices = window.speechSynthesis.getVoices();
        if (availableVoices.length > 0) {
            setVoices(availableVoices);

            console.log("All Available Voices:", availableVoices.map(v => ({ name: v.name, lang: v.lang, default: v.default, quality: (v as any).quality || 'N/A' })));

            // --- Refined Voice Selection Logic ---
            // 1. Filter for English voices, prioritizing US English but including others.
            const englishVoices = availableVoices.filter(v => v.lang.startsWith('en'));

            // 2. Filter for female voices within the English list.
            const femaleEnglishVoices = englishVoices.filter(v =>
                v.name.toLowerCase().includes('female') ||
                v.name.toLowerCase().includes('woman') ||
                // Some voices don't explicitly mention gender but are known female
                v.name.match(/Samantha|Victoria|Karen|Tessa|Google UK English Female|Google US English|Zira|Natasha/i) // Added Zira/Natasha
            );

            // 3. Prioritize "Google" or higher quality voices if available.
            let bestVoice = femaleEnglishVoices.find(v => v.name.startsWith('Google') && v.lang === 'en-US');
             if (!bestVoice) {
                 bestVoice = femaleEnglishVoices.find(v => v.name.startsWith('Google')); // Any Google female voice
             }
             // Add prioritization for known high-quality OS voices (examples)
             if (!bestVoice) {
                 bestVoice = femaleEnglishVoices.find(v => v.name.includes('Samantha') || v.name.includes('Victoria') || v.name.includes('Zira') || v.name.includes('Natasha')); // Example: macOS/Windows voices
             }

             // 4. Fallback: Any female English voice.
             if (!bestVoice) {
                 bestVoice = femaleEnglishVoices.find(v => v.lang === 'en-US'); // Prefer US Female
             }
             if (!bestVoice) {
                 bestVoice = femaleEnglishVoices[0]; // Any Female English voice
             }

            // 5. Fallback: Any English voice.
            if (!bestVoice) {
                bestVoice = englishVoices.find(v => v.lang === 'en-US'); // Prefer US English
            }
             if (!bestVoice) {
                 bestVoice = englishVoices[0]; // Any English voice
             }

            // 6. Absolute Fallback: Browser/OS default (might not be female or English).
            if (!bestVoice) {
                 bestVoice = availableVoices.find(v => v.default);
            }

            // Try to find a Japanese voice specifically for the accent attempt
            const japaneseVoices = availableVoices.filter(v => v.lang.startsWith('ja') && v.name.toLowerCase().includes('female'));
            const selectedJapaneseVoice = japaneseVoices.find(v => v.name.startsWith('Google')) || japaneseVoices[0]; // Prefer Google Japanese

            // If a Japanese voice is found, use it, otherwise fallback to the best English voice
            setSelectedVoice(selectedJapaneseVoice || bestVoice || null);
            console.log("Selected TTS Voice:", selectedJapaneseVoice ? selectedJapaneseVoice.name : (bestVoice?.name || 'None found'), selectedJapaneseVoice ? selectedJapaneseVoice.lang : (bestVoice?.lang || 'N/A'));

            // setSelectedVoice(bestVoice || null); // Use the best found voice or null
            // console.log("Selected TTS Voice:", bestVoice?.name, bestVoice?.lang, `(Default: ${bestVoice?.default})`);

        } else {
            console.log("Waiting for voices to load...");
        }
    };

    if ('speechSynthesis' in window) {
        loadVoices(); // Try immediate load
        // Use timeout as fallback if onvoiceschanged doesn't fire reliably
        const voiceLoadTimeout = setTimeout(loadVoices, 500);
        window.speechSynthesis.onvoiceschanged = () => {
            clearTimeout(voiceLoadTimeout); // Clear timeout if event fires
            loadVoices();
        };
    } else {
        console.warn("Text-to-Speech synthesis not supported in this browser.");
        setIsTTSEnabled(false);
    }

    return () => {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.onvoiceschanged = null; // Cleanup listener
            window.speechSynthesis.cancel(); // Cancel any speech on unmount
        }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array ensures this runs once on mount


  // --- Form Handling ---
  const taskForm = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      name: '',
      description: '',
      dueDate: null, // Initialize as null
      dueTime: null, // Initialize as null
      category: 'goal', // Default to 'goal' as tabs are removed
    },
  });

   // Reset form if needed (e.g., when edit dialog opens/closes)
   React.useEffect(() => {
      if (!isEditDialogOpen) {
          taskForm.reset({ // Reset form to default when dialog closes
             name: '',
             description: '',
             dueDate: null, // Reset to null
             dueTime: null, // Reset to null
             category: 'goal', // Reset category to default
           });
       }
    // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [isEditDialogOpen]); // Depend on dialog state


  const airiChatForm = useForm<AiriChatFormData>({
    resolver: zodResolver(airiChatFormSchema),
    defaultValues: {
      message: '',
    },
  });

  // --- Task Operations ---

   // Function to combine date and time (Handles HH:MM AM/PM) - Returns Date or null if date is missing
   const combineDateTime = (date?: Date | null, time?: string | null): Date | null => {
       if (!date || !isValid(date)) return null; // Return null if no valid date is provided

       const newDate = new Date(date);
       newDate.setSeconds(0, 0); // Reset seconds and milliseconds

       // Only attempt to set time if time is provided and valid
       if (time) {
           const timeParts = time.match(/(\d{1,2}):(\d{2}) (AM|PM)/i);
           if (timeParts) {
               let hours = parseInt(timeParts[1], 10);
               const minutes = parseInt(timeParts[2], 10);
               const ampm = timeParts[3].toUpperCase();

               if (ampm === 'PM' && hours < 12) hours += 12;
               if (ampm === 'AM' && hours === 12) hours = 0; // Midnight case

               if (!isNaN(hours) && !isNaN(minutes)) {
                   newDate.setHours(hours, minutes);
               } else {
                   // Fallback if parsing somehow fails despite regex - should not happen
                   console.warn(`Invalid time parts parsed from "${time}", defaulting time.`);
                   newDate.setHours(9, 0); // Default to 9 AM on the given date
               }
           } else {
               // Fallback for invalid time format string (shouldn't happen with validation)
               console.warn(`Invalid time format "${time}", defaulting time.`);
                newDate.setHours(9, 0); // Default to 9 AM on the given date
           }
       } else {
           // If date is provided but no time, just use the start of that day (or default time like 9 AM)
           // newDate.setHours(9, 0); // Default to 9 AM on the given date
           // If no time is provided, just return the date part (start of day)
           newDate.setHours(0, 0, 0, 0);
       }

       if (!isValid(newDate)) {
            console.error("Resulting combined date/time is invalid:", newDate);
            return date; // Fallback to just the date part if combination fails
       }

       return newDate;
   };


  // Handle task form submission (add or edit)
  const onSubmitTask = (data: TaskFormData) => {
    setIsSubmittingTask(true);
    // Combine date and time only if a valid date is provided
    const combinedDueDate = data.dueDate && isValid(data.dueDate)
      ? combineDateTime(data.dueDate, data.dueTime)
      : null; // If no valid date, dueDate is null

    // Validation of the combination logic (handled within combineDateTime)
    // Additional check for schema refine condition (handled by zodResolver)

    try {
      if (editingTask) {
        // Update existing task
        setTasks(
          tasks.map((task) =>
            task.id === editingTask.id
              ? { ...task, ...data, dueDate: combinedDueDate } // Update with combined date or null
              : task
          )
        );
        toast({ title: 'Task Updated', description: `"${data.name}" has been updated.` });
      } else {
        // Add new task
        const newTask: PrioritizedTask = {
          id: crypto.randomUUID(), // Use modern browser API
          name: data.name,
          description: data.description || '',
          dueDate: combinedDueDate, // Assign combined date or null
          category: data.category,
          completed: false,
          // Priority/reason might be added later by AI
        };
        setTasks([newTask, ...tasks]);
        toast({ title: 'Task Added', description: `"${data.name}" has been added.` });
      }
      // Form reset is handled by useEffect based on isEditDialogOpen
      setEditingTask(null);
      setIsEditDialogOpen(false); // Close dialog after submission
    } catch (error) {
      console.error('Error submitting task:', error);
      toast({
        title: 'Error Submitting Task',
        description: 'Could not save the task. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmittingTask(false);
    }
  };

  // Open edit dialog and populate form
  const handleEdit = (task: PrioritizedTask) => {
    setEditingTask(task);
    // Handle potentially null dueDate
    const validDueDate = task.dueDate && isValid(task.dueDate) ? task.dueDate : null; // Use null if invalid/missing
    const dueTimeValue = validDueDate ? format(validDueDate, 'hh:mm a') : null; // null if no valid date

    taskForm.reset({
      name: task.name,
      description: task.description,
      dueDate: validDueDate, // Set to null if invalid/missing
      dueTime: dueTimeValue, // Set to null if no valid date
      category: task.category,
    });
    setIsEditDialogOpen(true);
  };

  // Delete task
  const handleDelete = (id: string, name: string) => {
    setTasks(tasks.filter((task) => task.id !== id));
    toast({ title: 'Task Deleted', description: `"${name}" has been removed.` });
  };

  // Toggle task completion
  const handleToggleComplete = (id: string) => {
    setTasks(
      tasks.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task
      )
    );
  };

  // --- Airi Chat ---

  // Scroll chat to bottom when new messages arrive or chat opens
  React.useEffect(() => {
    if (isChatOpen && chatScrollAreaRef.current) {
        chatScrollAreaRef.current.scrollTop = chatScrollAreaRef.current.scrollHeight;
    }
  }, [chatMessages, isChatOpen]);

    // Text-to-Speech Function
    const speakText = React.useCallback((text: string) => {
        if (!isTTSEnabled || !('speechSynthesis' in window) || !text) {
            return; // Do nothing if disabled, not supported, or no text
        }

        window.speechSynthesis.cancel(); // Cancel any ongoing speech

        const utterance = new SpeechSynthesisUtterance(text);
        if (selectedVoice) {
            utterance.voice = selectedVoice;
             // Apply minor adjustments - these are highly voice-dependent
             // Pitch/rate adjustments for perceived accent (experimental)
             if (selectedVoice.lang.startsWith('ja')) {
                // If using a Japanese voice to speak English
                utterance.pitch = 1.0; // May need adjustment
                utterance.rate = 0.9; // Slightly slower might emphasize accent
             } else if (selectedVoice.name.includes("Google")) {
                 utterance.pitch = 1.1; // Slightly higher pitch for Google voices might sound better
                 utterance.rate = 1.05; // Slightly faster rate
             } else {
                 utterance.pitch = 1.0; // Default pitch
                 utterance.rate = 1.0;  // Default rate
             }
        } else {
            console.warn("No suitable TTS voice found, using system default.");
            // Use default pitch/rate if no voice selected
            utterance.pitch = 1.0;
            utterance.rate = 1.0;
        }


        utterance.onerror = (event) => {
            console.error("SpeechSynthesis Error:", event.error);
            toast({
                title: "TTS Error",
                description: `Could not speak: ${event.error}`,
                variant: "destructive",
            });
        };

        console.log(`Speaking with voice: ${utterance.voice?.name || 'default'}, lang: ${utterance.voice?.lang || 'default'}, rate: ${utterance.rate}, pitch: ${utterance.pitch}`);
        window.speechSynthesis.speak(utterance);
    }, [isTTSEnabled, selectedVoice, toast]);


  // Handle sending message to Airi
  const onSubmitAiriChat = async (data: AiriChatFormData) => {
    const userMessage = data.message;
    airiChatForm.reset(); // Reset input field immediately
    setIsAiLoading(true);

    // Add user message to chat history
    setChatMessages((prev) => [...prev, { role: 'user', content: userMessage }]);

    try {
      // Prepare input for Airi
      const airiInput: AiriChatInput = {
        message: userMessage,
        // Provide current non-completed tasks for prioritization context
        currentTasks: tasks.filter(t => !t.completed).map(t => ({
            id: t.id,
            name: t.name,
            description: `${t.name}: ${t.description}`, // Combine name and description for better context
            // Send ISO string if dueDate exists and is valid, otherwise send undefined/null
            dueDate: (t.dueDate && isValid(t.dueDate)) ? t.dueDate.toISOString() : null, // Use null instead of undefined
            category: t.category,
            completed: t.completed,
        })),
      };
      console.log("Sending to Airi:", JSON.stringify(airiInput, null, 2)); // Log input

      // Call the Airi chat flow
      const airiOutput: AiriChatOutput = await airiChat(airiInput);
      console.log("Received from Airi:", JSON.stringify(airiOutput, null, 2)); // Log output

      // Add Airi's response to chat history
       // Check if response exists before adding
        if (airiOutput.response) {
            setChatMessages((prev) => [
            ...prev,
            { role: 'airi', content: airiOutput.response },
            ]);
            speakText(airiOutput.response); // Speak Airi's response
        } else if (!airiOutput.success) {
             // If no response and it failed, add the error message
             const errorMessage = airiOutput.error || "Something went wrong, but Airi didn't say what.";
              setChatMessages((prev) => [
                ...prev,
                { role: 'system', content: `Error: ${errorMessage}` },
              ]);
             speakText(`Error: ${errorMessage}`);
        } else {
            // Success but no response (should ideally not happen with the prompt asking for a response)
             const defaultResponse = "Hmph. I processed that, but have nothing else to say.";
              setChatMessages((prev) => [
                ...prev,
                { role: 'airi', content: defaultResponse },
              ]);
             speakText(defaultResponse);
        }


      // --- Handle side effects from Airi's response ---

      // 1. Task Creation
       if (airiOutput.createdTask) {
           const createdTaskData = airiOutput.createdTask;
           console.log("Airi reported task creation:", createdTaskData);

           // Validate mandatory fields
           if (createdTaskData.id && createdTaskData.name) {
               let finalDueDate: Date | null = null;
               // Check if dueDate exists and is a string before parsing
               if (createdTaskData.dueDate && typeof createdTaskData.dueDate === 'string') {
                   finalDueDate = parseISO(createdTaskData.dueDate);
                   if (!isValid(finalDueDate)) {
                       console.warn(`Airi created a task with an invalid date string: "${createdTaskData.dueDate}". Setting dueDate to null.`);
                       finalDueDate = null;
                       toast({
                           title: "Airi Task Date Error",
                           description: "Airi tried to add a task, but the date was invalid. It's been added without one.",
                           variant: "destructive",
                       });
                   }
               } else if (createdTaskData.dueDate) {
                    // If dueDate exists but is not a string (unexpected, log warning)
                     console.warn(`Airi created a task with an unexpected dueDate type:`, createdTaskData.dueDate, `. Setting dueDate to null.`);
                    finalDueDate = null;
               }


               const newTask: PrioritizedTask = {
                   id: createdTaskData.id,
                   name: createdTaskData.name,
                   description: createdTaskData.description || '',
                   dueDate: finalDueDate, // Use the validated Date object or null
                   category: createdTaskData.category || 'goal',
                   completed: createdTaskData.completed || false,
                   priority: createdTaskData.priority,
                   reason: createdTaskData.reason,
               };
               setTasks((prevTasks) => [newTask, ...prevTasks]);
               toast({
                   title: "Airi Added a Task",
                   description: `"${newTask.name}" was created. It wasn't *that* hard.`,
               });
           } else {
               console.warn("Airi reported task creation, but data is incomplete or malformed:", createdTaskData);
               toast({
                   title: "Airi Task Creation Issue",
                   description: "Airi tried to add a task, but the details seem incomplete.",
                   variant: "destructive",
               });
           }
       }


      // 2. Task Prioritization
      if (airiOutput.prioritizedTasks && airiOutput.prioritizedTasks.length > 0) {
          // The output schema for prioritizedTasks now includes 'id' and 'name'
          const priorities: AiriPrioritizedTaskData[] = airiOutput.prioritizedTasks;
          console.log("Priorities received from Airi:", priorities);

          setTasks(prevTasks => {
               const taskMap = new Map(prevTasks.map(task => [task.id, task]));
               const updatedTasks: PrioritizedTask[] = [];
               let prioritiesApplied = false;

               priorities.forEach(p => {
                   const task = taskMap.get(p.id); // Use the ID provided by the tool output
                   if (task && p.priority !== undefined) {
                       console.log(`Applying priority to task ${task.id} (${task.name}):`, p);
                       updatedTasks.push({
                           ...task,
                           priority: p.priority,
                           reason: p.reason,
                       });
                       taskMap.delete(p.id);
                       prioritiesApplied = true;
                   } else {
                       console.warn(`Could not find task with ID ${p.id} or priority data is missing for prioritization update. Airi name: ${p.name}`);
                   }
               });

               // Add back tasks that were not in the prioritization result
               taskMap.forEach(task => {
                    // Clear old priority/reason for tasks not returned by Airi this time? Optional.
                    // updatedTasks.push({ ...task, priority: undefined, reason: undefined });
                   updatedTasks.push(task); // Keep existing priorities for non-updated tasks
               });

               if (prioritiesApplied) {
                    toast({
                        title: "Airi Prioritized Tasks",
                        description: "Hmph. Fine, I prioritized them. Now get to work.",
                    });
               } else if (airiOutput.prioritizedTasks.length > 0) {
                    toast({
                        title: "Airi Prioritization Mismatch",
                        description: "Airi tried to prioritize, but couldn't match the tasks. Maybe they changed?",
                        variant: "destructive",
                    });
               }

               console.log("Tasks after potential priority update:", updatedTasks);
               return updatedTasks.sort((a, b) => { // Re-sort after update
                    if (a.completed !== b.completed) return a.completed ? 1 : -1;
                    if (a.priority !== undefined && b.priority !== undefined) {
                        if (a.priority !== b.priority) return a.priority - b.priority;
                    } else if (a.priority !== undefined) return -1;
                    else if (b.priority !== undefined) return 1;

                    // Sort tasks without due dates after tasks with due dates
                    const timeA = a.dueDate && isValid(a.dueDate) ? a.dueDate.getTime() : Infinity;
                    const timeB = b.dueDate && isValid(b.dueDate) ? b.dueDate.getTime() : Infinity;

                    if (timeA === Infinity && timeB !== Infinity) return 1; // a has no date, b has date
                    if (timeA !== Infinity && timeB === Infinity) return -1; // a has date, b has no date
                    if (timeA === Infinity && timeB === Infinity) return 0; // both have no date (keep original relative order or sort by name/id?)

                    return timeA - timeB; // Sort by date if both have one
                });
           });
      }


      if (!airiOutput.success) {
         console.error("Airi flow reported failure:", airiOutput.error);
        toast({
          title: "Airi Error",
          description: airiOutput.error || "Something went wrong, according to Airi.",
          variant: "destructive",
        });
      }

    } catch (error: any) {
      console.error('Critical Error interacting with Airi:', error);
       const errorMessage = `Hmph. My circuits are fried or something. (${error.message || 'Unknown error'}) Try again, maybe?`;
       // Add error to chat for visibility
       setChatMessages((prev) => [...prev, { role: 'system', content: `System Error: ${error.message}` }]);
       speakText("Hmph. My circuits are fried or something. Try again, maybe?"); // Speak error
       toast({
           title: 'Airi Communication Error',
           description: 'Could not reach Airi. Check console for details.',
           variant: 'destructive',
       });
    } finally {
      setIsAiLoading(false);
    }
  };


    // --- Speech Recognition Handling ---
    React.useEffect(() => {
        if (!SpeechRecognition) {
            console.warn("Speech recognition not supported in this browser.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false; // Process single utterances
        recognition.lang = 'en-US'; // Set language
        recognition.interimResults = false; // Only final results

        recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            console.log("Voice input transcript:", transcript);
            airiChatForm.setValue('message', transcript); // Set transcript in input
            // Automatically submit the form after transcript is received
             // Check if the form is valid before submitting
            airiChatForm.trigger('message').then(isValid => {
                if (isValid) {
                   onSubmitAiriChat({ message: transcript }); // Manually pass data as form state might not update instantly
                } else {
                   // Handle invalid state if needed, though min(1) should be met by transcript
                   console.warn("Transcript generated but form validation failed (unexpected).");
                }
            });

            setIsListening(false); // Stop listening animation
        };

        recognition.onerror = (event: any) => {
            console.error('Speech recognition error:', event.error);
            let errorMsg = 'Speech recognition error. Please try again.';
            if (event.error === 'no-speech') {
                errorMsg = 'No speech detected. Did you say something?';
            } else if (event.error === 'audio-capture') {
                errorMsg = 'Microphone error. Ensure it\'s connected and permission is granted.';
            } else if (event.error === 'not-allowed') {
                errorMsg = 'Microphone permission denied. Please allow access in browser settings.';
            } else if (event.error === 'network') {
                 errorMsg = 'Network error during speech recognition. Check your connection.';
             }
            toast({
                title: 'Voice Input Error',
                description: errorMsg,
                variant: 'destructive',
            });
            setIsListening(false); // Stop listening animation
        };

        recognition.onend = () => {
            // Only set listening to false if it wasn't stopped manually or by error/result
             // if (isListening) { // Check if it was supposed to be listening
             //    setIsListening(false);
             //    console.log("Speech recognition ended unexpectedly.");
             // }
             // Safer: Rely on result/error handlers or manual toggle to set false
             setIsListening(false); // Simpler approach: always set false on end
        };

        recognitionRef.current = recognition;

        // Cleanup function
        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.abort(); // Stop recognition if component unmounts
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [toast]); // Removed airiChatForm, onSubmitAiriChat dependency


    const toggleListening = () => {
        if (!recognitionRef.current) {
            toast({ title: "Voice Input Not Ready", description: "Speech recognition is not available or hasn't initialized.", variant: "destructive"});
            return;
        }

        if (isListening) {
            try {
                recognitionRef.current.stop();
                console.log("Speech recognition stopped manually.");
            } catch (error) {
                console.error("Error stopping speech recognition:", error);
                 // Might happen if already stopped, usually safe to ignore
            } finally {
               setIsListening(false);
            }
        } else {
            // Request microphone permission proactively if possible (or rely on browser prompt)
            navigator.mediaDevices.getUserMedia({ audio: true })
             .then(() => {
                 try {
                     airiChatForm.setValue('message', ''); // Clear input field
                     recognitionRef.current.start();
                     setIsListening(true);
                     console.log("Speech recognition started.");
                 } catch (error: any) {
                     console.error("Failed to start speech recognition:", error);
                     let errorMsg = "Could not start voice input.";
                     if (error.name === 'NotAllowedError') { // Double check error name
                         errorMsg = 'Microphone permission denied. Please allow access.';
                     } else if (error.name === 'InvalidStateError') {
                          errorMsg = 'Speech recognition is already active or in an invalid state.';
                          // Don't try to restart here, might cause loops. Let user try again.
                     }
                     toast({ title: "Voice Input Error", description: errorMsg, variant: "destructive"});
                     setIsListening(false); // Ensure state is reset
                 }
             })
             .catch(err => {
                 console.error("Microphone access denied or error:", err);
                 let errorMsg = 'Microphone access is required for voice input.';
                 if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                     errorMsg = 'Microphone permission denied. Please allow access in your browser settings.';
                 } else if (err.name === 'NotFoundError') {
                      errorMsg = 'No microphone found. Please connect a microphone.';
                 }
                 toast({ title: "Microphone Error", description: errorMsg, variant: "destructive"});
                 setIsListening(false);
             });
        }
    };



  // --- Task Filtering and Sorting ---
  const sortedTasks = React.useMemo(() => {
    return [...tasks].sort((a, b) => {
      // Sort by completion status (incomplete first)
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      // Then sort by priority (lower number = higher priority)
      if (a.priority !== undefined && b.priority !== undefined) {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
      } else if (a.priority !== undefined) {
        return -1; // Prioritized tasks before unprioritized
      } else if (b.priority !== undefined) {
        return 1; // Unprioritized tasks after prioritized
      }

      // Sort tasks without due dates after tasks with due dates
      const timeA = a.dueDate && isValid(a.dueDate) ? a.dueDate.getTime() : Infinity;
      const timeB = b.dueDate && isValid(b.dueDate) ? b.dueDate.getTime() : Infinity;

      if (timeA === Infinity && timeB !== Infinity) return 1; // a has no date, b has date
      if (timeA !== Infinity && timeB === Infinity) return -1; // a has date, b has no date
      // If both have dates, sort normally (earlier first)
      // If neither has a date, you might want secondary sorting (e.g., by name or creation date)
      if (timeA === Infinity && timeB === Infinity) {
         // Example: sort by name alphabetically if no date
         return a.name.localeCompare(b.name);
         // return 0; // Or keep original relative order
      }

      return timeA - timeB; // Sort by date if both have one
    });
  }, [tasks]);

  const pendingGoals = React.useMemo(() => sortedTasks.filter(task => !task.completed && task.category === 'goal'), [sortedTasks]);
  const pendingChores = React.useMemo(() => sortedTasks.filter(task => !task.completed && task.category === 'chore'), [sortedTasks]);
  const completedTasks = React.useMemo(() => sortedTasks.filter(task => task.completed), [sortedTasks]);

   // --- Task List Rendering Function ---
   const renderTaskList = (taskList: PrioritizedTask[], isCompletedList = false) => {
    if (isLoadingTasks && !isCompletedList) { // Only show loading skeleton for pending lists initially
        return (
            <div className="space-y-3 p-1">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
            </div>
        );
    }

    if (taskList.length === 0) {
        return (
             // Wrap the empty state message in a div that centers it
             <div className="flex items-center justify-center h-full">
                <p className="text-center text-muted-foreground italic py-6">
                    {isCompletedList ? "No completed tasks yet." : "No tasks here. Add one!"}
                </p>
             </div>
        );
    }

    return (
        <ul className="space-y-3">
            {taskList.map((task) => (
                <li
                    key={task.id}
                    className={cn(
                        "flex items-start gap-3 p-3 border rounded-lg transition-opacity duration-300 ease-in-out animate-in fade-in-0", // Added animation classes
                        isCompletedList
                            ? 'bg-secondary/30 border-dashed opacity-70' // Style for completed tasks
                            : cn(
                                'hover:bg-accent/50', // Hover for pending
                                task.priority === 1 && "border-l-4 border-l-destructive",
                                task.priority === 2 && "border-l-4 border-l-orange-500",
                                task.priority === 3 && "border-l-4 border-l-yellow-500"
                              )
                    )}
                    style={{ animationDelay: `${Math.random() * 0.2}s` }} // Stagger animation slightly
                >
                    <Checkbox
                        id={`task-${task.id}`}
                        checked={task.completed}
                        onCheckedChange={() => handleToggleComplete(task.id)}
                        aria-label={`Mark task "${task.name}" as ${task.completed ? 'incomplete' : 'complete'}`}
                        className={cn("mt-1 shrink-0", isCompletedList && "opacity-70")}
                    />
                    <div className="flex-1 overflow-hidden mr-2">
                        <Label
                            htmlFor={`task-${task.id}`}
                            className={cn(
                                "font-medium cursor-pointer block",
                                task.completed ? 'line-through text-muted-foreground/80' : ''
                            )}
                        >
                            {!isCompletedList && task.priority && (
                                <Badge variant="secondary" className="mr-1.5 px-1 py-0 text-[10px]">
                                    P{task.priority}
                                </Badge>
                            )}
                            {task.name}
                        </Label>
                        {/* Conditionally render due date */}
                        {task.dueDate && isValid(task.dueDate) ? (
                            <p className={cn(
                                "text-xs mt-0.5",
                                task.completed ? "text-muted-foreground/60" : "text-muted-foreground"
                             )}>
                                Due: {format(task.dueDate, 'MMM d, yyyy, h:mm a')}
                            </p>
                         ) : (
                             <p className={cn(
                                 "text-xs mt-0.5 italic",
                                 task.completed ? "text-muted-foreground/50" : "text-muted-foreground/70"
                              )}>
                                 No due date
                             </p>
                         )}
                        {(task.description || task.reason) && (
                            <p className={cn(
                                "text-xs mt-1 line-clamp-2",
                                task.completed ? "text-muted-foreground/50" : "text-muted-foreground/80"
                            )} title={task.description + (task.reason ? ` (Reason: ${task.reason})` : '')}>
                                {task.description} {!isCompletedList && task.reason && <span className="italic">(Reason: {task.reason})</span>}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-1 mt-0.5 shrink-0">
                        <Badge variant={task.category === 'goal' ? 'default' : 'secondary'} className={cn("capitalize text-xs shrink-0 h-5 px-1.5", isCompletedList && "opacity-60")}>
                            {task.category}
                        </Badge>
                         {!isCompletedList && ( // Only show edit button for pending tasks
                            <TooltipProvider delayDuration={100}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleEdit(task)}>
                                            <span className="sr-only">Edit Task</span>
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                                                <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
                                            </svg>
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Edit Task</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                        <TooltipProvider delayDuration={100}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className={cn("h-7 w-7 text-destructive hover:text-destructive shrink-0", isCompletedList && "opacity-70")} onClick={() => handleDelete(task.id, task.name)}>
                                        <span className="sr-only">Delete Task</span>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete Task</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </li>
            ))}
        </ul>
    );
};


  // --- Render ---
  return (
    // Remove fixed height (h-screen) and overflow-hidden to allow scrolling
    <div className="flex flex-col bg-background">
      {/* Main Task Area */}
      <div className="flex-1 flex flex-col p-4 md:p-6 lg:p-8"> {/* Removed overflow-hidden */}
        {/* Header */}
        <header className="flex items-center justify-between mb-6 border-b pb-4 animate-in fade-in slide-in-from-top-4 duration-500"> {/* Header animation */}
          <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
            <CheckCircle className="w-7 h-7" /> TaskMaster
          </h1>
          <div className="flex items-center gap-2">
             {/* Chatbot Trigger */}
             <Sheet open={isChatOpen} onOpenChange={setIsChatOpen}>
                <SheetTrigger asChild>
                   <Button variant="outline" size="sm" className="gap-1.5 transition-transform hover:scale-105 active:scale-95"> {/* Button animation */}
                     <img src="https://picsum.photos/32/32?random=3" alt="Airi Avatar" data-ai-hint="cute anime girl side profile" className="w-4 h-4 rounded-full" />
                     Airi Assistant
                   </Button>
                </SheetTrigger>
                 <SheetContent className="w-full max-w-lg flex flex-col p-0"> {/* Adjust width and remove padding */}
                    <SheetHeader className="p-6 pb-2">
                      <SheetTitle>Chat with Airi</SheetTitle>
                      <SheetDescription>
                        Your tsundere assistant for tasks, motivation, and advice.
                      </SheetDescription>
                    </SheetHeader>
                    {/* Chat Message Area */}
                    <ScrollArea className="flex-1 px-6 py-4 bg-muted/40" viewportRef={chatScrollAreaRef}>
                      <div className="space-y-4">
                         {/* Welcome Message */}
                        {chatMessages.length === 0 && (
                          <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground italic justify-center animate-in fade-in delay-150 duration-500"> {/* Welcome message animation */}
                            <img src="https://picsum.photos/32/32?random=2" alt="Airi Avatar" data-ai-hint="cute anime girl blush" className="w-5 h-5 rounded-full" />
                            <span>What do you want? Don't waste my time...</span>
                          </div>
                        )}
                        {chatMessages.map((msg, index) => (
                          <div
                            key={index}
                            className={cn(
                              "flex items-end gap-2 text-sm animate-in fade-in slide-in-from-bottom-2 duration-300", // Chat message animation
                              msg.role === 'user' ? 'justify-end slide-in-from-right-4' : 'justify-start slide-in-from-left-4' // Directional slide
                            )}
                            style={{ animationDelay: `${index * 0.05}s` }} // Stagger message animation slightly
                          >
                            {msg.role === 'airi' && <img src="https://picsum.photos/32/32?random=3" alt="Airi Avatar" data-ai-hint="cute anime girl side profile" className="w-5 h-5 rounded-full mb-1" />}
                            {msg.role === 'system' && (
                               <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-destructive shrink-0 mb-1" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                              </svg>
                            )}
                            <div
                              className={cn(
                                "p-3 rounded-lg max-w-[85%]", // Increased max width slightly
                                msg.role === 'user'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-background border',
                                msg.role === 'system' && 'bg-destructive/10 border border-destructive/30 text-destructive dark:text-red-400' // Distinct system message style
                              )}
                            >
                              {/* Basic markdown rendering for lists/bold */}
                              {msg.content.split('\n').map((line, lineIndex) => (
                                <p key={lineIndex} className="my-0.5" dangerouslySetInnerHTML={{
                                    __html: line
                                      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
                                      .replace(/^- (.*)/gm, '<span class="ml-4 block">&bull; $1</span>') // Basic list item
                                      .replace(/^(\d+)\. (.*)/gm, '<span class="ml-4 block">$1. $2</span>') // Basic numbered list
                                 }} />
                              ))}

                               {/* Timestamp (Optional) */}
                               {/* <span className="block text-xs text-muted-foreground/70 mt-1 text-right">
                                   {format(new Date(), 'p')}
                               </span> */}
                            </div>
                             {msg.role === 'user' && (
                               <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-muted-foreground shrink-0 mb-1" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                               </svg>
                             )}
                          </div>
                        ))}
                         {isAiLoading && (
                           <div className="flex justify-start items-center gap-2 p-3 animate-pulse"> {/* Loading indicator animation */}
                              <img src="https://picsum.photos/32/32?random=4" alt="Airi Avatar Thinking" data-ai-hint="cute anime girl thinking" className="w-5 h-5 rounded-full" />
                             <span className="text-sm text-muted-foreground italic">Airi is thinking...</span>
                           </div>
                         )}
                      </div>
                    </ScrollArea>
                    {/* Chat Input Area */}
                    <SheetFooter className="p-4 border-t bg-background">
                      <Form {...airiChatForm}>
                        <form
                          onSubmit={airiChatForm.handleSubmit(onSubmitAiriChat)}
                          className="flex items-center gap-2 w-full"
                        >
                          <FormField
                            control={airiChatForm.control}
                            name="message"
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormControl>
                                  <Input
                                    placeholder="Ask Airi something... (e.g., 'Add task: Buy milk' or 'Prioritize my tasks')"
                                    {...field}
                                    disabled={isAiLoading || isListening}
                                    autoComplete="off"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          {SpeechRecognition && ( // Conditionally render mic button
                               <TooltipProvider delayDuration={100}>
                                 <Tooltip>
                                   <TooltipTrigger asChild>
                                      <Button
                                         type="button"
                                         variant="ghost"
                                         size="icon"
                                         onClick={toggleListening}
                                         disabled={isAiLoading}
                                         className={cn("shrink-0 transition-transform hover:scale-110 active:scale-90", isListening && "text-destructive animate-pulse ring-2 ring-destructive/50 rounded-full")}
                                       >
                                         {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} {/* Ensure icon size consistency */}
                                         <span className="sr-only">{isListening ? 'Stop Listening' : 'Start Listening'}</span>
                                       </Button>
                                   </TooltipTrigger>
                                   <TooltipContent>
                                      {isListening ? 'Stop Listening' : 'Start Listening'}
                                   </TooltipContent>
                                 </Tooltip>
                               </TooltipProvider>
                           )}
                            <TooltipProvider delayDuration={100}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setIsTTSEnabled(prev => !prev)}
                                            className="shrink-0 transition-transform hover:scale-110 active:scale-90"
                                        >
                                            {isTTSEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />} {/* Ensure icon size consistency */}
                                            <span className="sr-only">{isTTSEnabled ? 'Disable TTS' : 'Enable TTS'}</span>
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {isTTSEnabled ? 'Disable Text-to-Speech' : 'Enable Text-to-Speech'}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                          <Button type="submit" size="icon" disabled={isAiLoading || isListening} className="shrink-0 transition-transform hover:scale-110 active:scale-90">
                            <Send className="h-4 w-4" /> {/* Ensure icon size consistency */}
                            <span className="sr-only">Send message</span>
                          </Button>
                        </form>
                      </Form>
                    </SheetFooter>
                 </SheetContent>
             </Sheet>
            {/* Add/Edit Task Dialog Trigger */}
            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 transition-transform hover:scale-105 active:scale-95" onClick={() => { setEditingTask(null); taskForm.reset({ name: '', description: '', dueDate: null, dueTime: null, category: 'goal' }); setIsEditDialogOpen(true); }}> {/* Reset form with nulls */}
                  <Plus className="w-4 h-4" />
                  Add Task
                </Button>
              </DialogTrigger>
              {/* Dialog Content animation is handled by ShadCN */}
              <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                  <DialogTitle>{editingTask ? 'Edit Task' : 'Add New Task'}</DialogTitle>
                  <DialogDescription>
                    {editingTask ? 'Update the details of your task.' : 'Fill in the details for your new task.'}
                  </DialogDescription>
                </DialogHeader>
                <Form {...taskForm}>
                  <form onSubmit={taskForm.handleSubmit(onSubmitTask)} className="space-y-4 pt-2">
                    {/* Task Name */}
                    <FormField
                      control={taskForm.control}
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
                    {/* Task Description */}
                    <FormField
                      control={taskForm.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description (Optional)</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Add more details..." {...field} value={field.value ?? ''} rows={3} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {/* Due Date & Time Combined Input */}
                     <div className="flex flex-col gap-2">
                       <FormLabel>Due Date & Time (Optional)</FormLabel>
                         <div className="flex flex-col sm:flex-row gap-2">
                             {/* Date Picker */}
                             <FormField
                               control={taskForm.control}
                               name="dueDate"
                               render={({ field }) => (
                                 <FormItem className="flex flex-col flex-1">
                                   {/* <FormLabel>Date</FormLabel> */}
                                   <Popover>
                                     <PopoverTrigger asChild>
                                       <FormControl>
                                         <Button
                                           variant={"outline"}
                                           className={cn(
                                             "w-full justify-start text-left font-normal",
                                             !field.value && "text-muted-foreground"
                                           )}
                                         >
                                           <CalendarIcon className="mr-2 h-4 w-4" />
                                           {field.value && isValid(field.value) ? format(field.value, 'PPP') : <span>Pick a date</span>}
                                         </Button>
                                       </FormControl>
                                     </PopoverTrigger>
                                     <PopoverContent className="w-auto p-0" align="start">
                                       <Calendar
                                         mode="single"
                                         selected={field.value ?? undefined} // Pass undefined if null
                                         onSelect={(date) => field.onChange(date ?? null)} // Set to null if undefined
                                         // No need to disable past dates if optional, or adjust logic if needed
                                         // disabled={(date) => date < startOfDay(new Date())}
                                         initialFocus
                                       />
                                     </PopoverContent>
                                   </Popover>
                                   <FormMessage className="mt-1" /> {/* Ensure message shows below */}
                                 </FormItem>
                               )}
                             />
                             {/* Time Input (AM/PM) */}
                             <FormField
                                 control={taskForm.control}
                                 name="dueTime"
                                 render={({ field }) => (
                                   <FormItem className="flex flex-col w-full sm:w-[150px]">
                                     {/* <FormLabel>Time</FormLabel> */}
                                     <div className="relative">
                                         <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                         <FormControl>
                                            {/* Use text input for HH:MM AM/PM */}
                                            <Input
                                                placeholder="hh:mm AM/PM" // Placeholder indicates format
                                                className="pl-10"
                                                {...field}
                                                value={field.value ?? ''} // Handle null value
                                                // Disable time input if no date is selected
                                                disabled={!taskForm.watch('dueDate')}
                                             />
                                         </FormControl>
                                      </div>
                                     <FormMessage className="mt-1" /> {/* Ensure message shows below */}
                                   </FormItem>
                                 )}
                               />
                         </div>
                     </div>


                    {/* Category */}
                    <FormField
                      control={taskForm.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a category" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="goal">Goal (Important)</SelectItem>
                              <SelectItem value="chore">Chore (Routine)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <DialogFooter className="pt-4">
                      <DialogClose asChild>
                         <Button type="button" variant="outline">Cancel</Button>
                      </DialogClose>
                      <Button type="submit" disabled={isSubmittingTask}>
                        {isSubmittingTask ? 'Saving...' : (editingTask ? 'Update Task' : 'Add Task')}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {/* Task Display Area - Combined Goals and Chores */}
        {/* Removed flex-1 and overflow-hidden to allow natural height */}
        <div className="flex flex-col gap-6 animate-in fade-in delay-150 duration-500"> {/* Container animation */}

            {/* Goals Section */}
            <div className="flex flex-col">
                <h2 className="text-xl font-semibold mb-3 flex items-center gap-1.5">
                    <Target className="w-5 h-5" /> Goals ({pendingGoals.length})
                </h2>
                 {/* Ensure Card and CardContent don't restrict height unnecessarily */}
                <Card className="shadow-md">
                    <CardContent className="p-0">
                        {/* Adjust max-height as needed or use a different approach */}
                        <ScrollArea className="h-72 p-4"> {/* Increased height example */}
                           {renderTaskList(pendingGoals)}
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>

            {/* Chores Section */}
            <div className="flex flex-col">
                <h2 className="text-xl font-semibold mb-3 flex items-center gap-1.5">
                    <ListChecks className="w-5 h-5" /> Chores ({pendingChores.length})
                </h2>
                 {/* Ensure Card and CardContent don't restrict height unnecessarily */}
                 <Card className="shadow-md">
                    <CardContent className="p-0">
                         {/* Adjust max-height as needed or use a different approach */}
                        <ScrollArea className="h-72 p-4"> {/* Increased height example */}
                          {renderTaskList(pendingChores)}
                        </ScrollArea>
                    </CardContent>
                 </Card>
            </div>

            {/* Completed Tasks Accordion (at the bottom) */}
            {/* Removed mt-auto, keep shrink-0 */}
            <Accordion type="single" collapsible className="shrink-0">
              {/* Accordion animation is handled by ShadCN */}
              <AccordionItem value="completed-tasks">
                <AccordionTrigger>
                  <div className="flex items-center gap-2 text-lg font-medium">
                     <CheckCircle className="w-5 h-5 text-green-600" /> Completed Tasks ({completedTasks.length})
                   </div>
                </AccordionTrigger>
                <AccordionContent>
                   {/* ScrollArea within Accordion */}
                   <ScrollArea className="max-h-60">
                     <div className="p-1">
                        {renderTaskList(completedTasks, true)}
                     </div>
                   </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
        </div>
      </div>
    </div>
  );
}
