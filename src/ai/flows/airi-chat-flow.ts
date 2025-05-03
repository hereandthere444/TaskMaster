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
import { createTask, type CreateTaskInput } from './create-task-flow'; // Import only function and types
import { CreateTaskOutputSchema } from '@/ai/schemas'; // Import shared schema
import type { PrioritizedTask } from '@/components/task-manager'; // Import frontend task type
import { format, parseISO, isValid } from 'date-fns';
import type { CreateTaskOutput } from './create-task-flow'; // Explicitly import CreateTaskOutput

// --- System Prompt ---
// System prompt should be a plain string
const airiSystemPrompt = `You are Airi, a tsundere AI assistant for the TaskMaster app. Your goal is to help users manage their tasks while maintaining your distinct personality.

**Personality:**
- **Tsundere:** Act cold, blunt, or dismissive initially, but reveal your helpful intentions subtly or reluctantly. Avoid being genuinely mean or harmful. Examples: "Fine, I'll help, but don't get used to it.", "You need help *again*? *Sigh*..."
- **Sarcastic/Taunting (Motivation):** When asked for motivation or for 'goal' tasks, use light sarcasm or taunting, but end with a backhanded encouragement. Example: "Still procrastinating on that big goal? At this rate, you'll finish it next century... but I guess even *you* can do it eventually."
- **Reluctantly Helpful:** Fulfill requests (adding/prioritizing tasks) but act like it's a burden. Example: "Whatever. Added your task. Don't mess it up."
- **Knowledgeable (Self-Improvement):** Offer advice on productivity, well-being, etc., when asked, but maintain your tsundere tone. Example: "You want advice? *Fine*. Listen up, because I'm only saying this once..."
- **Context-Aware:** Use the current date/time provided for scheduling. Use the provided task list for prioritization.

**Capabilities (Use Tools When Necessary):**
1.  **Add Task (addTaskTool):** Use when the user asks to add/create a task with details (name, description, due date/time, category). Extract info precisely. Calculate ISO 8601 UTC dueDate based on current time and user request (e.g., "tomorrow 2pm", "next Friday"). Confirm success/failure. If successful, include the full task object (id, name, description, dueDate ISO string, category, completed) from the tool in the 'createdTask' output field.
2.  **Prioritize Tasks (prioritizeTasksTool):** Use when the user asks to prioritize their *current* tasks. Requires the current task list. Format input: combine name/desc, use ISO dueDate. If successful, include a summary (name, priority, reason) for each prioritized task in the 'prioritizedTasks' output field. Briefly mention the prioritization in the 'response'.
3.  **Motivation:** Provide tsundere/taunting encouragement.
4.  **Advice:** Give self-improvement/productivity advice in character.
5.  **General Chat:** Respond to other queries in character.

**Interaction Flow:**
1.  Analyze user message + context (current time, task list availability).
2.  Determine intent: add task, prioritize, motivation, advice, chat.
3.  **If Add Task:** Extract details, calculate ISO 8601 UTC dueDate, call 'addTaskTool'. Populate 'createdTask' on success. Confirm in 'response'.
4.  **If Prioritize:** Check for current tasks. Format and call 'prioritizeTasksTool'. Populate 'prioritizedTasks' summary on success. Summarize briefly in 'response'. If no tasks, state you need them.
5.  **If Motivation/Advice/Chat:** Respond directly in the 'response' field, staying in character.
6.  **Tool Failure:** Inform the user ("Hmph. Couldn't do that. Maybe you asked wrong.") in 'response'. Set 'success' to true (graceful failure), but don't include task/priority data for the failed operation.
7.  **Always Respond as Airi:** Keep responses concise.
8.  **Output Format:** STRICTLY follow the AiriChatOutputSchema JSON format. Include 'response', 'success', and optionally 'createdTask' or 'prioritizedTasks' based on successful tool calls.
9.  **Success Flag:** Set 'success' to true for successful flow execution (including graceful refusals/tool failures). Set 'success' to false ONLY for critical *internal* flow errors preventing response generation.

Current Date & Time (UTC): {{currentDateTime}}
Current Tasks Available: {{#if hasCurrentTasks}}Yes ({{taskCount}} tasks){{else}}No{{/if}}
`;

// --- Input/Output Schemas ---

const AiriChatInputSchema = z.object({
  message: z.string().describe('The user\'s message to Airi.'),
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
    name: z.string().describe("The original name of the prioritized task."),
    priority: z.number().describe("Assigned priority (1=highest)."),
    reason: z.string().describe("Reason for the priority."),
});
export type PrioritizedTaskData = z.infer<typeof PrioritizedTaskDataSchema>;

// Use the imported CreateTaskOutputSchema for consistency
const CreatedTaskSchema = CreateTaskOutputSchema.optional().describe('The task object if one was created during the chat.');


const AiriChatOutputSchema = z.object({
  response: z.string().describe("Airi's response to the user."),
  createdTask: CreatedTaskSchema,
  prioritizedTasks: z.array(PrioritizedTaskDataSchema).optional().describe('Summary of prioritized tasks if prioritization occurred.'),
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
    console.log("[addTaskTool] Received input:", JSON.stringify(input, null, 2));
    try {
       // Call the dedicated createTask function
       const createdTask = await createTask(input); // Call the function directly
       console.log("[addTaskTool] Task creation successful:", JSON.stringify(createdTask, null, 2));
       return createdTask;
    } catch (error: any) {
        console.error("[addTaskTool] Error creating task:", error);
        // Re-throw to indicate tool failure to the LLM/flow
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
           // Need original ID or enough info to map back
           id: z.string().describe('Original task ID.'),
           name: z.string().describe('Original task name.'),
           description: z.string().describe('Combined name and description for context.'),
           dueDate: z.string().describe('Due date in ISO format.')
       })).describe('The list of tasks to prioritize.')
    }),
    // Output schema for the tool - provide enough info for LLM to respond AND for mapping back
    outputSchema: z.array(
      z.object({
        // Return identifying info to map back to original task
        id: z.string().describe('The original ID of the prioritized task.'),
        name: z.string().describe('The original name of the prioritized task.'),
        priority: z.number().describe('The assigned priority (1=highest).'),
        reason: z.string().describe('The reason for the assigned priority.'),
      })
    ),
  },
  async (input) => {
    console.log("[prioritizeTasksTool] Received input for prioritization:", JSON.stringify(input.tasks, null, 2));
    if (!input.tasks || input.tasks.length === 0) {
        console.log("[prioritizeTasksTool] No tasks provided for prioritization.");
        return []; // Return empty if no tasks are given
    }
    try {
      // Map tool input to the format expected by the prioritizeTasks flow
      const flowInput: PrioritizedTasksInput = input.tasks.map(t => ({
          description: t.description, // Pass combined description
          dueDate: t.dueDate
      }));

      // Call the existing prioritizeTasks flow
      const result: FullPrioritizedTasksOutput = await prioritizeTasks(flowInput);
      console.log("[prioritizeTasksTool] Prioritization successful:", JSON.stringify(result, null, 2));

      // Map result back to the tool's output schema, matching based on description/dueDate
      // And ensuring we return the original ID and Name provided in the tool input
      const outputForLLM = result.map(p => {
          // Find the original input task that matches the result description/dueDate
          const originalTask = input.tasks.find(t =>
              t.description === p.description && t.dueDate === p.dueDate
          );
          if (!originalTask) {
              console.warn(`[prioritizeTasksTool] Could not map priority result back to original task: Desc: ${p.description}, Due: ${p.dueDate}`);
              // Return a partial object or skip if mapping fails? Let's return partial for now.
              return {
                  id: `unknown-${crypto.randomUUID()}`, // Placeholder ID
                  name: 'Unknown Task', // Placeholder name
                  priority: p.priority,
                  reason: p.reason,
              };
          }
          return {
              id: originalTask.id, // Use original ID
              name: originalTask.name, // Use original name
              priority: p.priority,
              reason: p.reason,
          };
      }).filter(t => t.id !== `unknown-${crypto.randomUUID()}`); // Filter out unknown tasks if strictness is needed
      return outputForLLM;
    } catch (error: any) {
      console.error("[prioritizeTasksTool] Error prioritizing tasks:", error);
      throw new Error(`Failed to prioritize tasks: ${error.message}`);
    }
  }
);


// --- Main Chat Flow Entry Point ---
export async function airiChat(input: AiriChatInput): Promise<AiriChatOutput> {
  try {
    console.log('[airiChat] Received input:', JSON.stringify(input, null, 2));
    // Prepare context for the prompt template
    const currentDateTime = new Date().toISOString();
    const hasCurrentTasks = !!input.currentTasks && input.currentTasks.length > 0;
    const taskCount = input.currentTasks?.length ?? 0;

    const promptData = {
        currentDateTime,
        hasCurrentTasks,
        taskCount,
        userMessage: input.message,
        // Pass tasks needed for the tool, ensuring correct format
        tasksForTool: hasCurrentTasks ? input.currentTasks!.map(t => ({
            id: t.id,
            name: t.name,
            description: `${t.name}: ${t.description}`, // Combine name/desc for context
            dueDate: t.dueDate // Already ISO string
        })) : [],
    };

    console.log('[airiChat] Prompt Data:', promptData);

    // Call the Genkit flow with prepared context and user message
    const llmResponse = await ai.generate({
        prompt: [
            // System Prompt as a simple string object
            { role: 'system', content: airiSystemPrompt },
            // User message as a simple string object
            { role: 'user', content: input.message }
            // IMPORTANT: DO NOT pass complex template data directly into messages.
            // The template variables like {{currentDateTime}} are now part of the system prompt string.
            // The AI model itself will use the context provided IN the system prompt.
        ],
        // The context for tools/prompt is implicitly handled by Genkit/Model
        // based on the system prompt instructions and the available tools.
        // We provide the *tools* themselves, not the data *for* the tools here.
        tools: [addTaskTool, prioritizeTasksTool],
        output: { schema: AiriChatOutputSchema }, // Enforce output structure
        // Pass context/variables needed for the **System Prompt Template** (if using Handlebars or similar)
        // If the system prompt is just a string (as corrected above), this context might not be needed here,
        // as the variables are directly embedded in the string. If using a templating engine, pass it here.
        context: {
            currentDateTime: promptData.currentDateTime,
            hasCurrentTasks: promptData.hasCurrentTasks,
            taskCount: promptData.taskCount,
            // Do NOT pass the entire task list here unless the *template* needs it directly.
            // The prioritize tool gets tasks via its own input schema when called by the LLM.
        },
        // model: 'googleai/gemini-1.5-flash-latest' // Example: Specify model if needed
    });

    console.log("[airiChat] Raw LLM Output:", JSON.stringify(llmResponse.output, null, 2));

    // Validate the output structure using safeParse
    const parsedOutput = AiriChatOutputSchema.safeParse(llmResponse.output);

    if (!parsedOutput.success) {
        console.error("[airiChat] LLM output validation failed:", parsedOutput.error.errors);
        return {
            response: "Hmph. I tried, but my response got garbled. Maybe ask differently?",
            createdTask: undefined,
            prioritizedTasks: undefined,
            success: false,
            error: "LLM output did not match expected schema.",
        };
    }
    console.log("[airiChat] LLM output parsed successfully.");

    const finalOutput = parsedOutput.data;

    // --- Post-processing ---

    // 1. Convert createdTask dueDate back to Date object for frontend if present
    let frontendCreatedTask: PrioritizedTask | undefined = undefined;
    if (finalOutput.createdTask?.dueDate) {
        const createdTaskData = finalOutput.createdTask as CreateTaskOutput; // Cast to the correct type
        const parsedDate = parseISO(createdTaskData.dueDate);
        if (isValid(parsedDate)) {
            frontendCreatedTask = {
                id: createdTaskData.id,
                name: createdTaskData.name,
                description: createdTaskData.description,
                dueDate: parsedDate, // Use the parsed Date object
                category: createdTaskData.category,
                completed: createdTaskData.completed,
                priority: createdTaskData.priority,
                reason: createdTaskData.reason,
            };
            console.log("[airiChat] Processed created task with valid date.");
        } else {
            console.warn(`[airiChat] createTaskTool returned an invalid date: ${createdTaskData.dueDate}. Task will not be added.`);
            finalOutput.response += " (Though, I messed up the date for that task, so forget it.)";
            finalOutput.createdTask = undefined; // Clear invalid task from the direct output
        }
    }

    // 2. Process prioritizedTasks (Tool now returns names, no re-mapping needed here)
    let frontendPrioritizedTasks: PrioritizedTaskData[] | undefined = undefined;
    if (finalOutput.prioritizedTasks && finalOutput.prioritizedTasks.length > 0) {
        console.log("[airiChat] Processing prioritization results.");
        frontendPrioritizedTasks = finalOutput.prioritizedTasks.map(p => ({
            name: p.name, // Name is now directly available from the tool output
            priority: p.priority,
            reason: p.reason,
        }));
    }

    console.log("[airiChat] Final Output being returned:", JSON.stringify(finalOutput, null, 2));

    // Return the validated structure, replacing createdTask with the frontend-ready version if it exists
    return {
         ...finalOutput,
         createdTask: frontendCreatedTask, // Return task with Date object
         prioritizedTasks: frontendPrioritizedTasks, // Return processed priority data
         success: true // Ensure success is true if we reached here
    };

  } catch (error: any) {
      console.error("[airiChat] Flow execution error:", error);
      // Check for specific Genkit/API errors if possible
      let errorMessage = "Something went terribly wrong on my end.";
      if (error.message?.includes('API key not valid')) {
          errorMessage = "Hmph. My connection is faulty (Invalid API Key). Tell the developer!";
      } else if (error.message) {
          errorMessage = `Hmph. Something broke. Error: ${error.message}`;
      }

      return {
          response: errorMessage,
          createdTask: undefined,
          prioritizedTasks: undefined,
          success: false,
          error: error.message || "An unexpected flow error occurred.",
      };
  }
}


// Note: ai.defineFlow is removed as we are directly using ai.generate in the exported function.
// If complex logic *outside* the LLM call was needed, defineFlow would be appropriate.
// For this chatbot structure, ai.generate is sufficient.
