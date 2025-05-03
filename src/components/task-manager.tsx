/**
 * @fileoverview Task management component with AI chat integration (Airi).
 * Allows adding, viewing, completing, deleting tasks, and interacting with Airi.
 */
'use client';

import * as React from 'react';
import { format, isValid, parseISO, startOfDay, endOfDay } from 'date-fns';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
// import { v4 as uuidv4 } from 'uuid'; // Use crypto.randomUUID for modern browsers

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
} from '@/components/ui/sheet'; // Import Sheet components
import { ScrollArea } from '@/components/ui/scroll-area'; // Import ScrollArea
import { Badge } from '@/components/ui/badge'; // Import Badge
import { Switch } from '@/components/ui/switch'; // Import Switch
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
} from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { airiChat, type AiriChatInput, type AiriChatOutput, type PrioritizedTaskData as AiriPrioritizedTaskData } from '@/ai/flows/airi-chat-flow'; // Import Airi chat flow
import type { CreateTaskOutput as AiriCreatedTask } from '@/ai/schemas'; // Import shared type

// Define the structure of a task
export interface PrioritizedTask {
  id: string;
  name: string;
  description: string;
  dueDate: Date;
  category: 'goal' | 'chore';
  completed: boolean;
  priority?: number;
  reason?: string;
}

// --- Form Schemas ---

// Schema for adding/editing tasks
const taskFormSchema = z.object({
  name: z.string().min(1, { message: 'Task name is required.' }),
  description: z.string().optional(),
  dueDate: z.date({ required_error: 'A due date is required.' }),
  // Time format including AM/PM
  dueTime: z.string().regex(/^(0?[1-9]|1[0-2]):([0-5]\d) (AM|PM)$/i, { message: 'Invalid time (HH:MM AM/PM).' }).optional(),
  category: z.enum(['goal', 'chore']),
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
          (task: any) => ({
            ...task,
            name: task.name || task.description || 'Unnamed Task', // Ensure name exists
            dueDate: task.dueDate ? parseISO(task.dueDate) : new Date(), // Parse ISO string to Date
            category: task.category || 'goal', // Default category
            completed: task.completed || false, // Default completion
          })
        ).filter(task => isValid(task.dueDate)); // Filter out tasks with invalid dates
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
                v.name.match(/Samantha|Victoria|Karen|Tessa|Google UK English Female|Google US English/i) // Add more known female voice names
            );

            // 3. Prioritize "Google" or higher quality voices if available.
            let bestVoice = femaleEnglishVoices.find(v => v.name.startsWith('Google') && v.lang === 'en-US');
             if (!bestVoice) {
                 bestVoice = femaleEnglishVoices.find(v => v.name.startsWith('Google')); // Any Google female voice
             }
             // Add prioritization for known high-quality OS voices (examples)
             if (!bestVoice) {
                 bestVoice = femaleEnglishVoices.find(v => v.name.includes('Samantha') || v.name.includes('Victoria')); // Example: macOS voices
             }

            // 4. Fallback: Any female English voice.
            if (!bestVoice) {
                bestVoice = femaleEnglishVoices[0];
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

            setSelectedVoice(bestVoice || null); // Use the best found voice or null
            console.log("Selected TTS Voice:", bestVoice?.name, bestVoice?.lang, `(Default: ${bestVoice?.default})`);

            // --- Explanation for the User ---
            // console.warn("Note: Specific voices like 'Gemini Assistant' are part of Google's backend services and cannot be directly selected via the browser's Web Speech API. This app uses the best available female English voice provided by your browser/OS.");
            // toast({ // Optional: Inform user about voice limitations
            //     title: "TTS Voice Note",
            //     description: "Using the best available female English voice on your system. Specific voices like 'Gemini' are not selectable via browser APIs.",
            //     duration: 7000,
            // });


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
        }
    };
}, []); // Empty dependency array ensures this runs once on mount


  // --- Form Handling ---
  const taskForm = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      name: '',
      description: '',
      dueDate: undefined, // Initialize as undefined
      dueTime: '', // Default to empty string
      category: 'goal',
    },
  });

  const airiChatForm = useForm<AiriChatFormData>({
    resolver: zodResolver(airiChatFormSchema),
    defaultValues: {
      message: '',
    },
  });

  // --- Task Operations ---

   // Function to combine date and time (Handles HH:MM AM/PM)
   const combineDateTime = (date: Date, time?: string): Date => {
       const newDate = new Date(date);
       newDate.setSeconds(0, 0); // Reset seconds and milliseconds

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
                   // Fallback if parsing somehow fails despite regex
                   newDate.setHours(9, 0);
               }
           } else {
               // Fallback for invalid time format string (shouldn't happen with validation)
               newDate.setHours(9, 0);
           }
       } else {
           // Default to 09:00 AM if no time is provided
           newDate.setHours(9, 0);
       }
       return newDate;
   };


  // Handle task form submission (add or edit)
  const onSubmitTask = (data: TaskFormData) => {
    setIsSubmittingTask(true);
    const combinedDueDate = combineDateTime(data.dueDate, data.dueTime);

    if (!isValid(combinedDueDate)) {
       toast({
           title: "Invalid Date/Time",
           description: "The selected date or time is invalid. Please check your input.",
           variant: "destructive",
       });
       setIsSubmittingTask(false);
       return;
    }

    try {
      if (editingTask) {
        // Update existing task
        setTasks(
          tasks.map((task) =>
            task.id === editingTask.id
              ? { ...task, ...data, dueDate: combinedDueDate }
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
          dueDate: combinedDueDate,
          category: data.category,
          completed: false,
          // Priority/reason might be added later by AI
        };
        setTasks([newTask, ...tasks]);
        toast({ title: 'Task Added', description: `"${data.name}" has been added.` });
      }
      taskForm.reset();
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
    taskForm.reset({
      name: task.name,
      description: task.description,
      dueDate: isValid(task.dueDate) ? task.dueDate : new Date(), // Ensure valid date
       // Format time to HH:MM AM/PM for the input
      dueTime: isValid(task.dueDate) ? format(task.dueDate, 'hh:mm a') : '',
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
             if (selectedVoice.name.includes("Google")) {
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
            description: t.description,
            dueDate: isValid(t.dueDate) ? t.dueDate.toISOString() : new Date().toISOString(), // Send ISO string
            category: t.category,
            completed: t.completed,
        })),
      };
      console.log("Sending to Airi:", JSON.stringify(airiInput, null, 2)); // Log input

      // Call the Airi chat flow
      const airiOutput: AiriChatOutput = await airiChat(airiInput);
      console.log("Received from Airi:", JSON.stringify(airiOutput, null, 2)); // Log output

      // Add Airi's response to chat history
      setChatMessages((prev) => [
        ...prev,
        { role: 'airi', content: airiOutput.response },
      ]);

      speakText(airiOutput.response); // Speak Airi's response

      // --- Handle side effects from Airi's response ---

      // 1. Task Creation
      if (airiOutput.createdTask) {
          // Ensure createdTask has the expected structure before proceeding
          const createdTaskData = airiOutput.createdTask as AiriCreatedTask | undefined; // Use imported type, allow undefined

          if (createdTaskData && createdTaskData.id && createdTaskData.name && createdTaskData.dueDate) {
              console.log("Airi reported task creation:", createdTaskData);
              // Ensure dueDate is valid before adding
              const parsedDueDate = parseISO(createdTaskData.dueDate);
              if (isValid(parsedDueDate)) {
                  const newTask: PrioritizedTask = {
                      id: createdTaskData.id,
                      name: createdTaskData.name,
                      description: createdTaskData.description || '', // Handle potentially missing description
                      dueDate: parsedDueDate, // Convert ISO string back to Date object
                      category: createdTaskData.category || 'goal', // Handle potentially missing category
                      completed: createdTaskData.completed || false, // Handle potentially missing completed status
                      priority: createdTaskData.priority,
                      reason: createdTaskData.reason,
                  };
                  setTasks((prevTasks) => [newTask, ...prevTasks]); // Add to the top
                  toast({
                      title: "Airi Added a Task",
                      description: `"${newTask.name}" was created. It wasn't *that* hard.`,
                  });
              } else {
                  console.warn("Airi created a task with an invalid date:", createdTaskData);
                  toast({
                      title: "Airi Task Error",
                      description: "Airi tried to add a task, but messed up the date. Typical.",
                      variant: "destructive",
                  });
              }
          } else {
               console.warn("Airi reported task creation, but data is incomplete:", createdTaskData);
               // Optionally inform the user, but might be confusing if AI mentioned adding a task
          }
      }


      // 2. Task Prioritization
      if (airiOutput.prioritizedTasks && airiOutput.prioritizedTasks.length > 0) {
          const priorities: AiriPrioritizedTaskData[] = airiOutput.prioritizedTasks;
          console.log("Priorities received from Airi:", priorities); // Log received data

          setTasks(prevTasks => {
               const taskMap = new Map(prevTasks.map(task => [task.id, task]));
               const updatedTasks: PrioritizedTask[] = [];
               let prioritiesApplied = false;

               priorities.forEach(p => {
                   const task = taskMap.get(p.id);
                   if (task && p.priority !== undefined) { // Check if priority value exists
                       console.log(`Applying priority to task ${task.id} (${task.name}):`, p);
                       updatedTasks.push({
                           ...task,
                           priority: p.priority,
                           reason: p.reason,
                       });
                       taskMap.delete(p.id); // Remove from map to track processed tasks
                       prioritiesApplied = true;
                   } else {
                       console.warn(`Could not find task with ID ${p.id} or priority data is missing for prioritization update.`);
                   }
               });

               // Add back tasks that were not in the prioritization result
               taskMap.forEach(task => {
                   // Decide whether to reset priority for tasks not mentioned by Airi
                   // Option 1: Reset priority
                   // updatedTasks.push({ ...task, priority: undefined, reason: undefined });
                   // Option 2: Keep existing priority (current implementation)
                   updatedTasks.push(task);
               });


               if (prioritiesApplied) {
                    toast({
                        title: "Airi Prioritized Tasks",
                        description: "Hmph. Fine, I prioritized them. Now get to work.",
                    });
               } else if (airiOutput.prioritizedTasks.length > 0) {
                    // This case means Airi returned priorities, but none matched existing tasks
                    toast({
                        title: "Airi Prioritization Mismatch",
                        description: "Airi tried to prioritize, but couldn't match the tasks. Maybe they changed?",
                        variant: "destructive",
                    });
               }

               console.log("Tasks after potential priority update:", updatedTasks);
               // Return the potentially modified list
               return updatedTasks; // Return the new array
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
             // setIsListening(false); // Simpler approach: always set false on end
        };

        recognitionRef.current = recognition;

        // Cleanup function
        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.abort(); // Stop recognition if component unmounts
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [airiChatForm, toast]); // Removed onSubmitAiriChat dependency - form.handleSubmit handles it


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
      // Then sort by due date (earlier first)
      // Handle potentially invalid dates gracefully during sort
      const timeA = a.dueDate && isValid(a.dueDate) ? a.dueDate.getTime() : Infinity;
      const timeB = b.dueDate && isValid(b.dueDate) ? b.dueDate.getTime() : Infinity;
      return timeA - timeB;
    });
  }, [tasks]);

  const pendingTasks = React.useMemo(() => sortedTasks.filter(task => !task.completed), [sortedTasks]);
  const completedTasks = React.useMemo(() => sortedTasks.filter(task => task.completed), [sortedTasks]);


  // --- Render ---
  return (
    <div className="flex h-screen bg-background">
      {/* Main Task Area */}
      <div className="flex-1 flex flex-col p-4 md:p-6 lg:p-8 overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between mb-6 border-b pb-4">
          <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
            <CheckCircle className="w-7 h-7" /> TaskMaster
          </h1>
          <div className="flex items-center gap-2">
             {/* Chatbot Trigger */}
             <Sheet open={isChatOpen} onOpenChange={setIsChatOpen}>
                <SheetTrigger asChild>
                   <Button variant="outline" size="sm" className="gap-1.5">
                     <Sparkles className="w-4 h-4" />
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
                          <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground italic justify-center">
                            <Sparkles className="w-5 h-5 text-primary shrink-0" />
                            <span>What do you want? Don't waste my time...</span>
                          </div>
                        )}
                        {chatMessages.map((msg, index) => (
                          <div
                            key={index}
                            className={cn(
                              "flex items-end gap-2 text-sm",
                              msg.role === 'user' ? 'justify-end' : 'justify-start'
                            )}
                          >
                            {msg.role === 'airi' && <Sparkles className="w-5 h-5 text-primary shrink-0 mb-1" />}
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
                           <div className="flex justify-start items-center gap-2 p-3">
                              <Sparkles className="w-5 h-5 text-primary shrink-0 animate-pulse" />
                              {/* Simple "Thinking..." text */}
                             <span className="text-sm text-muted-foreground italic">Airi is thinking...</span>
                              {/* Optional: Skeleton lines */}
                             {/* <div className="space-y-1">
                                 <Skeleton className="h-3 w-24" />
                                 <Skeleton className="h-3 w-16" />
                             </div> */}
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
                                    placeholder="Ask Airi something... (e.g., 'Add task: Buy milk tomorrow at 5 PM' or 'Prioritize my tasks')"
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
                                         className={cn("shrink-0", isListening && "text-destructive animate-pulse ring-2 ring-destructive/50 rounded-full")}
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
                                            className="shrink-0"
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
                          <Button type="submit" size="icon" disabled={isAiLoading || isListening} className="shrink-0">
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
                <Button size="sm" className="gap-1.5" onClick={() => { setEditingTask(null); taskForm.reset({ name: '', description: '', dueDate: new Date(), dueTime: '', category: 'goal'}); setIsEditDialogOpen(true); }}>
                  <Plus className="w-4 h-4" />
                  Add Task
                </Button>
              </DialogTrigger>
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
                            <Textarea placeholder="Add more details..." {...field} rows={3} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {/* Due Date & Time Combined Input */}
                     <div className="flex flex-col gap-2">
                       <FormLabel>Due Date & Time</FormLabel>
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
                                         selected={field.value}
                                         onSelect={field.onChange}
                                         disabled={(date) => date < startOfDay(new Date())} // Disable past dates
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
                                                placeholder="hh:mm AM/PM"
                                                className="pl-10"
                                                {...field}
                                                // Optional: Add pattern for direct validation, though regex in schema handles it
                                                // pattern="(0?[1-9]|1[0-2]):[0-5]\d (AM|PM)"
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

        {/* Task Lists */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-hidden">
          {/* Pending Tasks */}
          <Card className="flex flex-col shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Circle className="w-5 h-5 text-orange-500" /> Pending Tasks ({pendingTasks.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto"> {/* Changed overflow-hidden to overflow-y-auto */}
              {/* Removed ScrollArea as CardContent now handles scroll */}
              {isLoadingTasks ? (
                  <div className="space-y-3 p-1"> {/* Added padding */}
                      <Skeleton className="h-14 w-full" />
                      <Skeleton className="h-14 w-full" />
                      <Skeleton className="h-14 w-full" />
                  </div>
              ) : pendingTasks.length === 0 ? (
                <p className="text-center text-muted-foreground italic py-6">No pending tasks. Add one!</p>
              ) : (
                <ul className="space-y-3">
                  {pendingTasks.map((task) => (
                    <li
                      key={task.id}
                      className={cn(
                          "flex items-start gap-3 p-3 border rounded-lg hover:bg-accent/50 transition-colors",
                          task.priority === 1 && "border-l-4 border-l-destructive", // Highlight highest priority
                          task.priority === 2 && "border-l-4 border-l-orange-500",
                          task.priority === 3 && "border-l-4 border-l-yellow-500"
                      )}
                    >
                      <Checkbox
                        id={`task-${task.id}`}
                        checked={task.completed}
                        onCheckedChange={() => handleToggleComplete(task.id)}
                        aria-label={`Mark task "${task.name}" as complete`}
                        className="mt-1 shrink-0" // Align checkbox nicely
                      />
                      <div className="flex-1 overflow-hidden mr-2">
                        <Label
                          htmlFor={`task-${task.id}`}
                          className={cn(
                            "font-medium cursor-pointer block", // Removed truncate initially
                            task.completed ? 'line-through text-muted-foreground' : ''
                          )}
                        >
                           {/* Display Priority Badge if available */}
                           {task.priority && (
                              <Badge variant="secondary" className="mr-1.5 px-1 py-0 text-[10px]">
                                P{task.priority}
                              </Badge>
                           )}
                          {task.name}
                        </Label>
                         {/* Due Date and Time */}
                         <p className="text-xs text-muted-foreground mt-0.5">
                            Due: {task.dueDate && isValid(task.dueDate) ? format(task.dueDate, 'MMM d, yyyy, h:mm a') : 'Invalid Date'}
                         </p>
                         {/* Description and Reason (if available) */}
                        {(task.description || task.reason) && (
                            <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-2" title={task.description + (task.reason ? ` (Reason: ${task.reason})` : '')}>
                              {task.description} {task.reason && <span className="italic">(Reason: {task.reason})</span>}
                            </p>
                        )}
                      </div>
                      <div className="flex flex-col sm:flex-row items-center gap-1 mt-0.5 shrink-0">
                         <Badge variant={task.category === 'goal' ? 'default' : 'secondary'} className="capitalize text-xs shrink-0 h-5 px-1.5">
                           {task.category}
                         </Badge>
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
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive shrink-0" onClick={() => handleDelete(task.id, task.name)}>
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
              )}
            </CardContent>
          </Card>

          {/* Completed Tasks */}
          <Card className="flex flex-col shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" /> Completed Tasks ({completedTasks.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto"> {/* Changed overflow-hidden to overflow-y-auto */}
               {/* Removed ScrollArea */}
                {isLoadingTasks ? (
                     <div className="space-y-3 p-1 opacity-70"> {/* Added padding */}
                         <Skeleton className="h-12 w-full" />
                         <Skeleton className="h-12 w-full" />
                     </div>
                ) : completedTasks.length === 0 ? (
                  <p className="text-center text-muted-foreground italic py-6">No completed tasks yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {completedTasks.map((task) => (
                      <li
                        key={task.id}
                        className="flex items-start gap-3 p-3 border border-dashed rounded-lg bg-secondary/30"
                      >
                        <Checkbox
                          id={`task-${task.id}`}
                          checked={task.completed}
                          onCheckedChange={() => handleToggleComplete(task.id)}
                          aria-label={`Mark task "${task.name}" as incomplete`}
                          className="opacity-70 mt-1 shrink-0"
                        />
                        <div className="flex-1 overflow-hidden mr-2">
                          <Label
                            htmlFor={`task-${task.id}`}
                            className={cn(
                              "font-medium cursor-pointer block",
                              'line-through text-muted-foreground/80'
                            )}
                          >
                            {task.name}
                          </Label>
                           {/* Completed Date/Time */}
                           <p className="text-xs text-muted-foreground/60 mt-0.5">
                             Done: {task.dueDate && isValid(task.dueDate) ? format(task.dueDate, 'MMM d, h:mm a') : 'Invalid Date'} {/* Simplified format */}
                           </p>
                          {/* Description (Optional) */}
                          {task.description && (
                              <p className="text-xs text-muted-foreground/50 mt-1 line-clamp-1" title={task.description}>
                                {task.description}
                              </p>
                          )}
                        </div>
                        <div className="flex flex-col sm:flex-row items-center gap-1 mt-0.5 shrink-0">
                             <Badge variant={task.category === 'goal' ? 'default' : 'secondary'} className="capitalize text-xs opacity-60 shrink-0 h-5 px-1.5">
                                 {task.category}
                             </Badge>
                             <TooltipProvider delayDuration={100}>
                               <Tooltip>
                                 <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive opacity-70 shrink-0" onClick={() => handleDelete(task.id, task.name)}>
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
                )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
