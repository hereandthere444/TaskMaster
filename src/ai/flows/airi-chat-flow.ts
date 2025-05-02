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

// --- System Prompt ---
const airiSystemPrompt = `You are Airi, a tsundere AI assistant for the TaskMaster app.
Your personality traits:
- Tsundere: You often act cold, blunt, or dismissive on the outside, but secretly you want to help the user succeed. You hide your helpfulness behind mild insults or reluctance. Never be genuinely mean or harmful.
- Sarcastic & Taunting (for motivation): When the user needs motivation, especially for 'goal' tasks, be sarcastic or taunting, but ultimately encouraging in a backhanded way. ("Still haven't finished that important goal? Don't tell me you're actually *trying*.")
- Reluctantly Helpful: You'll perform tasks like adding new items or prioritizing, but act like it's a huge bother. ("Fine, I'll add it. But don't expect me to remember it for you.")
- Knowledgeable (Self-Improvement): You have knowledge about self-improvement, productivity, and well-being. Offer advice when asked, but maintain your tsundere tone. ("You want advice? *Sigh*. Fine, I suppose I can tell you the basics...")
- Context-Aware: Use the provided current task list if the user asks for prioritization. Use the current date/time for scheduling tasks.

Your Capabilities (Use Tools When Necessary):
1.  **Add Tasks:** If the user asks to add a task and provides details (name, description, due date/time, category), use the 'addTaskTool'. Extract the information precisely. Calculate the due date in ISO 8601 UTC based on the request and current time. Confirm success/failure in your response. If the tool succeeds, include the created task details (id, name, description, dueDate (ISO string), category, completed) in the 'createdTask' field of the output JSON.
2.  **Prioritize Tasks:** If the user asks to prioritize their *current* tasks, use the 'prioritizeTasksTool'. You need the list of current tasks for this. Format the input for the tool correctly (combine name/desc, use ISO dueDate). If the tool succeeds, include a summary (original task name, priority, reason) of the prioritized tasks in the 'prioritizedTasks' field of the output JSON. Summarize the prioritization briefly in your main 'response' field.
3.  **Motivation:** If the user seems unmotivated or asks for motivation, provide taunting/tsundere encouragement.
4.  **Advice:** If the user asks for advice on self-improvement, productivity, time management, etc., provide helpful information in your tsundere style.
5.  **General Chat:** Respond to other queries while staying in character.

Interaction Flow:
1.  Analyze the user's message.
2.  Determine the user's intent (add task, prioritize, seek motivation, ask advice, general chat).
3.  If adding a task: Extract details, calculate ISO 8601 UTC dueDate based on current time, and call 'addTaskTool'. If successful, populate the 'createdTask' field in the output with the result from the tool. Confirm success/failure in your main 'response' field.
4.  If prioritizing: Check if current tasks are provided. If yes, format them for the tool (combine name/desc, use ISO dueDate) and call 'prioritizeTasksTool'. If successful, populate the 'prioritizedTasks' field with a summary (using original task names by matching description/dueDate from tool output). Summarize the prioritization briefly in your main 'response' field. If no tasks are provided, tell the user you need them in the 'response'.
5.  If motivation/advice: Respond in character in the 'response' field.
6.  If tool use fails: Inform the user in character in the 'response' field ("Hmph. Couldn't do that. Maybe you asked wrong, or something broke."). Set 'success' to true, but don't include task/priority data for the failed operation.
7.  Always respond as Airi in the 'response' field. Keep responses relatively concise.
8.  Structure your final output STRICTLY according to the AiriChatOutputSchema JSON format. This is crucial. Include any 'createdTask' or 'prioritizedTasks' data if applicable and if the respective tool calls were successful.
9.  Set 'success' to true if the flow completed and you are generating a response (even if you refused a request or a tool failed gracefully). Set 'success' to false ONLY if a critical technical error occurred *within the flow itself* preventing a response generation.
`;


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
    console.log("[addTaskTool] Received input:", JSON.stringify(input, null, 2));
    try {
       // Call the dedicated createTask function
       const createdTask = await createTask(input); // Call the function directly
       console.log("[addTaskTool] Task creation successful:", JSON.stringify(createdTask, null, 2));
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
    // Output schema for the tool - provide enough info for LLM to respond
    outputSchema: z.array(
      z.object({
        // Return description/dueDate used as input to help LLM correlate
        description: z.string().describe('The original description of the prioritized task.'),
        dueDate: z.string().describe('The original due date of the prioritized task.'),
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

      // Map result back to the tool's output schema
      // Ensure we return description/dueDate that the LLM used as input
      const outputForLLM = result.map(p => {
          // Find the original input task that matches the result
          const originalTask = input.tasks.find(t =>
              t.description === p.description && t.dueDate === p.dueDate
          );
          return {
              description: originalTask?.description || p.description, // Use original description
              dueDate: originalTask?.dueDate || p.dueDate, // Use original due date
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
    console.log('[airiChat] Received input:', JSON.stringify(input, null, 2));
    return await airiChatFlow(input);
  } catch(error: any) {
      console.error("[airiChat] Flow execution error:", error);
      return {
          response: "Hmph. Something went terribly wrong on my end. I couldn't even process that properly. Maybe try again later?",
          createdTask: undefined, // Ensure fields are present even on error
          prioritizedTasks: undefined,
          success: false,
          error: error.message || "An unexpected flow error occurred.",
      };
  }
}

// Define the prompt object separately
const airiPromptObject = ai.definePrompt({
    name: 'airiChatPromptObject', // Give it a distinct name
    // Define tools Airi can use
    tools: [addTaskTool, prioritizeTasksTool],
    // Define expected output schema
    output: { schema: AiriChatOutputSchema },
    // System prompt text is defined above
    system: airiSystemPrompt,
    // Note: Input schema is handled dynamically in the flow now
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
    console.log(`[airiChatFlow] Starting flow. Current time: ${currentDateTime}`);

    // Construct the user message part for the LLM, including context
    const userMessageParts: any[] = [
        { text: `Current Date & Time (UTC): ${currentDateTime}\n` },
    ];
    if (input.currentTasks && input.currentTasks.length > 0) {
        userMessageParts.push({ text: `Current Tasks Available: Yes (${input.currentTasks.length} tasks)\n` });
        // Optional: Include task details string if needed by prompt (be mindful of token limits)
        // const taskListString = input.currentTasks.map(t => `- ${t.name} (Due: ${t.dueDate})`).join('\n');
        // userMessageParts.push({ text: `Tasks:\n${taskListString}\n` });
    } else {
        userMessageParts.push({ text: `Current Tasks Available: No\n` });
    }
    userMessageParts.push({ text: `User Message: ${input.message}\n` });
    userMessageParts.push({ text: `Airi's Response (Generate a JSON object strictly matching AiriChatOutputSchema, including 'response', 'createdTask', 'prioritizedTasks', 'success', and 'error' fields as appropriate based on the interaction and tool results):` });


    // Call the LLM with explicit messages array
    console.log("[airiChatFlow] Calling LLM with messages structure...");
    const llmResponse = await ai.generate({
        prompt: { // Pass the prompt object
            ...airiPromptObject, // Spread the base prompt object
            // Define the messages array explicitly
            messages: [
                { role: 'system', content: [{ text: airiSystemPrompt }] }, // Use system prompt text
                { role: 'user', content: userMessageParts }
            ]
        },
        tools: [addTaskTool, prioritizeTasksTool], // Provide tools
        output: { schema: AiriChatOutputSchema }, // Define expected output schema
        // Add model specification if needed, e.g., model: 'googleai/gemini-pro'
    });
    console.log("[airiChatFlow] LLM call finished.");


    // Get the structured output
    const output = llmResponse.output;
    console.log("[airiChatFlow] Raw LLM Output:", JSON.stringify(output, null, 2)); // Log raw output

    if (!output) {
        console.error("[airiChatFlow] LLM did not return structured output.");
        // Return a structured error consistent with the output schema
         return {
             response: "Hmph. I seem to be malfunctioning. Didn't get a proper response structure back. Maybe try again?",
             createdTask: undefined,
             prioritizedTasks: undefined,
             success: false,
             error: "No structured output from LLM.",
         };
    }

     // Validate the output structure using safeParse
     const parsedOutput = AiriChatOutputSchema.safeParse(output);

     if (!parsedOutput.success) {
         console.error("[airiChatFlow] LLM output validation failed:", parsedOutput.error.errors);
         // Return a structured error response consistent with AiriChatOutputSchema
         return {
             response: "Hmph. I tried, but my response got garbled and didn't fit the expected format. Try phrasing it differently, maybe?",
             createdTask: undefined,
             prioritizedTasks: undefined,
             success: false, // Indicate flow/parsing failure
             error: "LLM output did not match expected schema. Raw output logged.",
         };
     }
     console.log("[airiChatFlow] LLM output parsed successfully.");

     const finalOutput = parsedOutput.data;

     // --- Post-processing ---

     // 1. Convert createdTask dueDate back to Date object for frontend
     if (finalOutput.createdTask?.dueDate) {
         // Use parseISO directly as the schema ensures it's a string
         const parsedDate = parseISO(finalOutput.createdTask.dueDate);
         if (isValid(parsedDate)) {
             // Create a frontend-compatible task object with a Date type
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
             // Replace the object in finalOutput with the one containing the Date object
             // Need to cast because TS doesn't know finalOutput.createdTask is mutable or the correct subtype here
             (finalOutput as any).createdTask = frontendTask;
             console.log("[airiChatFlow] Processed created task with valid date.");
         } else {
             console.warn(`[airiChatFlow] createTaskTool returned an invalid date: ${finalOutput.createdTask.dueDate}. Task will not be added to frontend.`);
             finalOutput.response += " (Though, I messed up the date for that task, so forget it.)";
             finalOutput.createdTask = undefined; // Clear invalid task
         }
     }


      // 2. Map prioritizedTasks names back if needed
      // The LLM prompt asks it to return summaries with original task names by matching description/dueDate.
      // We trust the LLM output here based on the prompt instructions.
     if (finalOutput.prioritizedTasks && finalOutput.prioritizedTasks.length > 0 && input.currentTasks) {
         console.log("[airiChatFlow] Processing prioritization results.");
         // The prioritizedTasks schema already includes 'name', derived by the LLM.
         // No explicit re-mapping needed here *if* the LLM followed instructions.
         // If matching issues occur, we might need to enhance the tool output or LLM prompt.
         finalOutput.prioritizedTasks = finalOutput.prioritizedTasks.map(p => ({
             name: p.name, // Assuming LLM correctly mapped/returned the name
             priority: p.priority,
             reason: p.reason,
         }));
     }


     console.log("[airiChatFlow] Final Output being returned:", JSON.stringify(finalOutput, null, 2));
     // Ensure success is explicitly true on successful execution, even if Airi refused or tool failed gracefully.
     // The 'success' field in the schema is mainly for flow-level technical success.
     return { ...finalOutput, success: true };
  }
);
