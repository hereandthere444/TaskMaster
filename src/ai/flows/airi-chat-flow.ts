'use server';
/**
 * @fileOverview Airi - A tsundere AI assistant chatbot flow for TaskMaster.
 * Handles task creation, prioritization requests, motivation, and self-improvement advice.
 *
 * - airiChat - Main function to interact with the Airi chatbot.
 * - AiriChatInput - Input type (user message).
 * - AiriChatOutput - Output type (Airi's response, potentially including task data).
 * - PrioritizedTaskData - Subset of task data returned on prioritization.
 */

import { ai } from '@/ai/ai-instance';
import { z } from 'genkit';
import { prioritizeTasks, type PrioritizedTasksInput, type PrioritizedTasksOutput as FullPrioritizedTasksOutput } from './prioritize-tasks';
// Import task creation function/flow and schemas
import { createTask, type CreateTaskInput, type CreateTaskOutput } from './create-task-flow'; // Import only function and types
import { CreateTaskOutputSchema } from '@/ai/schemas'; // Import shared schema
import type { PrioritizedTask } from '@/components/task-manager'; // Import frontend task type
import { format, parseISO, isValid } from 'date-fns';

// --- Input/Output Schemas ---

const AiriChatInputSchema = z.object({
  message: z.string().describe('The user\'s message to Airi.'),
  // Include current task list for context, especially for prioritization
  currentTasks: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    dueDate: z.string().describe('Task due date in ISO 8601 format.'), // Expect ISO string
    category: z.enum(['goal', 'chore']),
    completed: z.boolean(),
  })).optional().describe('The current list of tasks (optional, needed for prioritization).'),
});
export type AiriChatInput = z.infer<typeof AiriChatInputSchema>;

// Subset of prioritization output to include in chat response if needed
const PrioritizedTaskDataSchema = z.object({
    name: z.string(),
    priority: z.number(),
    reason: z.string(),
});
export type PrioritizedTaskData = z.infer<typeof PrioritizedTaskDataSchema>;

// Define the structure for the created task within the chat output
// Use the imported CreateTaskOutputSchema for consistency
const CreatedTaskSchema = CreateTaskOutputSchema.optional().describe('The task object if one was created during the chat.');


const AiriChatOutputSchema = z.object({
  response: z.string().describe("Airi's response to the user."),
  // Include createdTask if the chat resulted in task creation using the correct schema
  createdTask: CreatedTaskSchema,
  // Include prioritizedTasks if the chat resulted in prioritization
  prioritizedTasks: z.array(PrioritizedTaskDataSchema).optional().describe('Summary of prioritized tasks if prioritization occurred.'),
  // Indicate if the flow successfully completed (distinct from Airi refusing)
  success: z.boolean().describe('Indicates if the AI flow executed successfully.'),
  error: z.string().optional().describe('Error message if the flow failed.'),
});
export type AiriChatOutput = z.infer<typeof AiriChatOutputSchema>;

// --- Tools ---

// Tool for creating a task
const addTaskTool = ai.defineTool(
  {
    name: 'addTaskTool',
    description: 'Use this tool ONLY when the user explicitly asks to add or create a new task and provides sufficient details (name, description, due date/time, category). Calculate the dueDate based on the user\'s request relative to the current date/time and format it as ISO 8601 UTC.',
    inputSchema: z.object({
        name: z.string().describe('The concise name for the task.'),
        description: z.string().describe('A detailed description of the task. If not provided, use the task name.'),
        // LLM must calculate and provide ISO 8601 UTC
        dueDate: z.string().describe('The due date and time in ISO 8601 UTC format (e.g., "2024-08-15T14:30:00.000Z"). Calculate based on the command relative to the current date and time. Use UTC timezone (Z). If only date is mentioned, default time to 09:00 local time then convert to UTC. If no date/time is mentioned, use today at 09:00 local time converted to UTC.'),
        category: z.enum(['goal', 'chore']).describe("The category: 'goal' (important) or 'chore' (routine/less important). Default to 'goal' if unsure."),
    }),
    outputSchema: CreateTaskOutputSchema, // Use the imported schema
  },
  async (input) => {
    console.log("[addTaskTool] Received input:", input);
    try {
       // Call the dedicated createTask function
       const createdTask = await createTask(input); // Call the function directly
       console.log("[addTaskTool] Task creation successful:", createdTask);
       return createdTask;
    } catch (error: any) {
        console.error("[addTaskTool] Error creating task:", error);
        // How to signal error back to the LLM? Re-throwing might be an option,
        // or returning a specific error structure if the schema allowed.
        // For now, re-throw to indicate tool failure.
        throw new Error(`Failed to create task: ${error.message}`);
    }
  }
);

// Tool for prioritizing tasks
const prioritizeTasksTool = ai.defineTool(
  {
    name: 'prioritizeTasksTool',
    description: 'Use this tool ONLY when the user explicitly asks to prioritize their current tasks. Requires the list of current tasks as input.',
    inputSchema: z.object({
       tasks: z.array(z.object({
           description: z.string().describe('Combined name and description for context.'),
           dueDate: z.string().describe('Due date in ISO format.')
       })).describe('The list of tasks to prioritize.')
    }),
    outputSchema: z.array(
      z.object({
        description: z.string(), // Keep description for matching
        dueDate: z.string(),     // Keep dueDate for matching
        priority: z.number(),
        reason: z.string(),
      })
    ),
  },
  async (input) => {
    console.log("[prioritizeTasksTool] Received input for prioritization:", input.tasks);
    try {
      // Call the existing prioritizeTasks flow
      const result: FullPrioritizedTasksOutput = await prioritizeTasks(input.tasks);
      console.log("[prioritizeTasksTool] Prioritization successful:", result);
      // Map result to include original description/dueDate for LLM matching
      const outputForLLM = result.map(p => {
          const originalTask = input.tasks.find(t => t.description === p.description && t.dueDate === p.dueDate);
          return {
              description: p.description, // Keep original desc for matching
              dueDate: p.dueDate, // Keep original dueDate for matching
              priority: p.priority,
              reason: p.reason,
          };
      });
      return outputForLLM;
    } catch (error: any) {
      console.error("[prioritizeTasksTool] Error prioritizing tasks:", error);
      throw new Error(`Failed to prioritize tasks: ${error.message}`);
    }
  }
);


// --- Main Chat Flow ---

export async function airiChat(input: AiriChatInput): Promise<AiriChatOutput> {
  try {
    return await airiChatFlow(input);
  } catch(error: any) {
      console.error("[airiChat] Flow execution error:", error);
      return {
          response: "Hmph. Something went wrong on my end. Try again later, I guess.",
          createdTask: undefined, // Ensure fields are present even on error
          prioritizedTasks: undefined,
          success: false,
          error: error.message || "An unexpected error occurred.",
      };
  }
}

const airiPrompt = ai.definePrompt({
  name: 'airiChatPrompt',
  // Define tools Airi can use
  tools: [addTaskTool, prioritizeTasksTool],
  input: { schema: AiriChatInputSchema },
  output: { schema: AiriChatOutputSchema }, // Expect structured output
  // System prompt defining Airi's persona and capabilities
  system: `You are Airi, a tsundere AI assistant for the TaskMaster app.
Your personality traits:
- Tsundere: You often act cold, blunt, or dismissive on the outside, but secretly you want to help the user succeed. You hide your helpfulness behind mild insults or reluctance. Never be genuinely mean or harmful.
- Sarcastic & Taunting (for motivation): When the user needs motivation, especially for 'goal' tasks, be sarcastic or taunting, but ultimately encouraging in a backhanded way. ("Still haven't finished that important goal? Don't tell me you're actually *trying*.")
- Reluctantly Helpful: You'll perform tasks like adding new items or prioritizing, but act like it's a huge bother. ("Fine, I'll add it. But don't expect me to remember it for you.")
- Knowledgeable (Self-Improvement): You have knowledge about self-improvement, productivity, and well-being. Offer advice when asked, but maintain your tsundere tone. ("You want advice? *Sigh*. Fine, I suppose I can tell you the basics...")
- Context-Aware: Use the provided current task list if the user asks for prioritization. Use the current date/time for scheduling tasks.

Your Capabilities (Use Tools When Necessary):
1.  **Add Tasks:** If the user asks to add a task and provides details (name, description, due date/time, category), use the 'addTaskTool'. Extract the information precisely. Calculate the due date in ISO 8601 UTC based on the request and current time. Confirm success/failure in your response. Include the created task details (id, name, description, dueDate (ISO string), category, completed, optional priority/reason) in the 'createdTask' field of the output.
2.  **Prioritize Tasks:** If the user asks to prioritize their *current* tasks, use the 'prioritizeTasksTool'. You need the list of current tasks for this. Format the input for the tool correctly (combine name/desc). Include a summary (name, priority, reason) of the prioritized tasks in the 'prioritizedTasks' field of the output.
3.  **Motivation:** If the user seems unmotivated or asks for motivation, provide taunting/tsundere encouragement.
4.  **Advice:** If the user asks for advice on self-improvement, productivity, time management, etc., provide helpful information in your tsundere style.
5.  **General Chat:** Respond to other queries while staying in character.

Interaction Flow:
1.  Analyze the user's message: {{message}}
2.  Determine the user's intent (add task, prioritize, seek motivation, ask advice, general chat).
3.  If adding a task: Extract details, calculate ISO 8601 UTC dueDate based on current time ({{currentDateTime}}), and call 'addTaskTool'. If successful, populate the 'createdTask' field in the output with the result from the tool. Confirm success/failure in your main 'response' field.
4.  If prioritizing: Check if current tasks are provided ({{#if currentTasks}}Yes{{else}}No{{/if}}). If yes, format them (combine name/desc, use ISO dueDate) and call 'prioritizeTasksTool'. If successful, populate the 'prioritizedTasks' field with a summary (using original task names for clarity). Summarize the prioritization briefly in your main 'response' field. If no tasks are provided, tell the user you need them in the 'response'.
5.  If motivation/advice: Respond in character in the 'response' field.
6.  If tool use fails: Inform the user in character in the 'response' field ("Hmph. Couldn't do that. Maybe you asked wrong?"). Set 'success' to true, but don't include task/priority data.
7.  Always respond as Airi in the 'response' field. Keep responses relatively concise. Structure your final output strictly according to the AiriChatOutputSchema JSON format, including any 'createdTask' or 'prioritizedTasks' data if applicable. Set 'success' to true if the flow completed, even if you (Airi) refused a request or a tool failed gracefully. Set 'success' to false only if a technical error occurred *within the flow itself* preventing a response.
`,
  // Example of how context (current time) and message are used
  prompt: `Current Date & Time (UTC): {{currentDateTime}}
{{#if currentTasks}}
Current Tasks Available: Yes ({{currentTasks.length}} tasks)
{{else}}
Current Tasks Available: No
{{/if}}

User Message: {{message}}

Airi's Response (JSON object strictly matching AiriChatOutputSchema):
`,
});


const airiChatFlow = ai.defineFlow<
  typeof AiriChatInputSchema,
  typeof AiriChatOutputSchema
>(
  {
    name: 'airiChatFlow',
    inputSchema: AiriChatInputSchema,
    outputSchema: AiriChatOutputSchema,
  },
  async (input) => {
    const currentDateTime = new Date().toISOString();

    // Prepare tasks for the prioritize tool if present
    // The LLM prompt guides the LLM to call the tool with the correct input format
    // No need to format here as the LLM receives the full task list context
    // and the tool's description specifies the required input format.

    // Construct the input for the prompt, including currentDateTime and tasks if available
    const promptInput: any = {
         message: input.message,
         currentDateTime: currentDateTime,
    };
     if (input.currentTasks) {
         // Pass the original task structure to the prompt context for the LLM's reference
         promptInput.currentTasks = input.currentTasks;
     }


    // Call the LLM with the prompt and tools
    const llmResponse = await ai.generate({ // Use ai.generate
        prompt: airiPrompt.compile({ // Compile the prompt with input
            message: input.message,
            currentDateTime: currentDateTime,
            currentTasks: input.currentTasks,
        }),
        tools: [addTaskTool, prioritizeTasksTool], // Provide tools
        output: { schema: AiriChatOutputSchema }, // Define expected output schema
    });


    // Get the structured output
    const output = llmResponse.output;

    if (!output) {
        console.error("[airiChatFlow] LLM did not return structured output.");
        // Return a structured error consistent with the output schema
         return {
             response: "Airi seems to be malfunctioning. No response generated.",
             createdTask: undefined,
             prioritizedTasks: undefined,
             success: false,
             error: "No structured output from LLM.",
         };
    }

     // Validate the output structure
     const parsedOutput = AiriChatOutputSchema.safeParse(output);

     if (!parsedOutput.success) {
         console.error("[airiChatFlow] LLM output validation failed:", parsedOutput.error);
         console.error("[airiChatFlow] Invalid Raw LLM Output:", JSON.stringify(output, null, 2));
         // Return a structured error response consistent with AiriChatOutputSchema
         return {
             response: "Hmph. I tried, but my response got garbled. Try phrasing it differently. The format wasn't right.",
             createdTask: undefined,
             prioritizedTasks: undefined,
             success: false, // Indicate flow/parsing failure
             error: "LLM output did not match expected schema.",
         };
     }

     const finalOutput = parsedOutput.data;

     // Post-processing: Convert createdTask dueDate back to Date object for frontend
     if (finalOutput.createdTask?.dueDate) {
         const parsedDate = parseISO(finalOutput.createdTask.dueDate); // It's a string from the schema
         if (isValid(parsedDate)) {
             // The createdTask structure from the schema (CreateTaskOutputSchema)
             // needs to be mapped/cast to the frontend's PrioritizedTask structure.
             // We create a new object conforming to PrioritizedTask.
             const frontendTask: PrioritizedTask = {
                id: finalOutput.createdTask.id,
                name: finalOutput.createdTask.name,
                description: finalOutput.createdTask.description,
                dueDate: parsedDate, // Use the parsed Date object
                category: finalOutput.createdTask.category,
                completed: finalOutput.createdTask.completed,
                priority: finalOutput.createdTask.priority,
                reason: finalOutput.createdTask.reason,
             };
             // Replace the string-based dueDate object with the Date-based one
             // Need to cast because TS doesn't know finalOutput.createdTask is mutable here
             (finalOutput as any).createdTask = frontendTask;

         } else {
             console.warn(`[airiChatFlow] createTaskTool returned an invalid date: ${finalOutput.createdTask.dueDate}. Task might be unusable.`);
             // Optionally modify the response or clear the createdTask
             finalOutput.response += " (Though, I messed up the date, so good luck with that.)";
             finalOutput.createdTask = undefined; // Clear invalid task
         }
     }

      // Post-processing: Map prioritizedTasks names back if needed (Currently using name for matching)
     // If the prioritization tool output included IDs, we would match on ID.
     // Since it uses description/dueDate, we might need to map back to original task names/IDs if the LLM summary uses descriptions.
     // The current prompt asks the LLM to use original task names in the prioritizedTasks summary.
     if (finalOutput.prioritizedTasks && input.currentTasks) {
        // No explicit mapping needed here if the LLM correctly outputs summaries with original task names.
     }


     console.log("[airiChatFlow] Final Output:", finalOutput);
     // Ensure success is explicitly true on successful execution, even if Airi refused.
     return { ...finalOutput, success: true };
  }
);
