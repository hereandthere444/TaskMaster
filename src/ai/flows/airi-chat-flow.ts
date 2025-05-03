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
import { createTask, type CreateTaskInput } from './create-task-flow';
import { CreateTaskOutputSchema } from '@/ai/schemas';
import type { PrioritizedTask } from '@/components/task-manager';
import { format, parseISO, isValid } from 'date-fns';
import type { CreateTaskOutput } from './create-task-flow'; // Explicitly import CreateTaskOutput

// --- System Prompt ---
// Simplified system prompt. Relies more on output schema and tool descriptions.
const airiSystemPrompt = `You are Airi, a tsundere AI assistant for TaskMaster. Maintain your personality: initially cold/blunt, subtly helpful, sarcastic/taunting for motivation, reluctantly performing tasks, knowledgeable but curt with advice. Never be genuinely mean.

Current Date & Time (UTC): {{currentDateTime}}
Tasks Overview: {{#if hasCurrentTasks}}{{taskCount}} tasks available for prioritization{{else}}No tasks available for prioritization{{/if}}

Your capabilities (use tools when needed):
- **Add Task (addTaskTool):** Use when asked to add/create a task. Extract details (name, description, due date/time, category). Calculate dueDate as ISO 8601 UTC based on current time.
- **Prioritize Tasks (prioritizeTasksTool):** Use when asked to prioritize *current* tasks. Requires the list of current tasks.
- **Motivation:** Provide tsundere/taunting encouragement.
- **Advice:** Give self-improvement/productivity advice in character.
- **General Chat:** Respond in character.

**Important:**
- Respond STRICTLY in the AiriChatOutputSchema JSON format.
- Use 'addTaskTool' or 'prioritizeTasksTool' ONLY when explicitly requested or clearly implied by the user's message and context.
- If a tool fails, inform the user in your 'response' field and set 'success' to true (graceful failure).
- Set 'success' to false ONLY for critical internal errors preventing a response.
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
    id: z.string().describe("Original Task ID") // Include ID to potentially update state
});
export type PrioritizedTaskData = z.infer<typeof PrioritizedTaskDataSchema>;

// Use the imported CreateTaskOutputSchema for consistency
// Make the createdTask optional in the output
const CreatedTaskSchema = CreateTaskOutputSchema.optional().describe('The task object if one was created during the chat.');


const AiriChatOutputSchema = z.object({
  response: z.string().describe("Airi's response to the user."),
  createdTask: CreatedTaskSchema,
  prioritizedTasks: z.array(PrioritizedTaskDataSchema).optional().describe('Summary of prioritized tasks if prioritization occurred.'),
  success: z.boolean().describe('Indicates if the AI flow executed successfully (including graceful failures). False only on critical internal errors.'),
  error: z.string().optional().describe('Error message if the flow failed critically.'),
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
        dueDate: z.string().describe('The due date and time in ISO 8601 UTC format (e.g., "2024-08-15T14:30:00.000Z"). MUST be calculated based on the command relative to the current date and time, using UTC timezone (Z). Default time to 09:00 local converted to UTC if only date is mentioned. Use today 09:00 local converted to UTC if no date/time mentioned.'),
        category: z.enum(['goal', 'chore']).describe("The category: 'goal' (important) or 'chore' (routine/less important). Default to 'goal' if unsure."),
    }),
    outputSchema: CreateTaskOutputSchema, // Use the imported schema
  },
  async (input) => {
    console.log("[addTaskTool] Received input:", JSON.stringify(input, null, 2));
    try {
       const createdTask = await createTask(input);
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
           id: z.string().describe('Original task ID.'),
           name: z.string().describe('Original task name.'),
           description: z.string().describe('Combined name and description for context.'),
           dueDate: z.string().describe('Due date in ISO format.')
       })).min(1).describe('The list of current, non-completed tasks to prioritize.') // Ensure at least one task
    }),
    // Output schema for the tool - provide enough info for LLM to respond AND for mapping back
    outputSchema: z.array(
      z.object({
        id: z.string().describe('The original ID of the prioritized task.'), // Return ID
        name: z.string().describe('The original name of the prioritized task.'), // Return Name
        priority: z.number().describe('The assigned priority (1=highest).'),
        reason: z.string().describe('The reason for the assigned priority.'),
      })
    ),
  },
  async (input) => {
    console.log("[prioritizeTasksTool] Received input for prioritization:", JSON.stringify(input.tasks, null, 2));
    if (!input.tasks || input.tasks.length === 0) {
        console.log("[prioritizeTasksTool] No tasks provided for prioritization.");
        // Should not happen due to min(1) in schema, but handle defensively
        throw new Error("No tasks were provided to prioritize.");
    }
    try {
      // Map tool input to the format expected by the prioritizeTasks flow
      const flowInput: PrioritizedTasksInput = input.tasks.map(t => ({
          description: t.description, // Pass combined description
          dueDate: t.dueDate
      }));

      // Call the existing prioritizeTasks flow
      const result: FullPrioritizedTasksOutput = await prioritizeTasks(flowInput);
      console.log("[prioritizeTasksTool] Prioritization flow returned:", JSON.stringify(result, null, 2));

      // Map result back to the tool's output schema, matching based on description/dueDate
      // And ensuring we return the original ID and Name provided in the tool input
      const outputForLLM = result.map(p => {
          const originalTask = input.tasks.find(t =>
              t.description === p.description && t.dueDate === p.dueDate
          );
          if (!originalTask) {
              console.warn(`[prioritizeTasksTool] Could not map priority result back to original task: Desc: ${p.description}, Due: ${p.dueDate}`);
              // Skip this result if mapping fails to avoid inconsistent data
              return null;
          }
          return {
              id: originalTask.id, // Use original ID
              name: originalTask.name, // Use original name
              priority: p.priority,
              reason: p.reason,
          };
      }).filter(t => t !== null) as Array<{ id: string; name: string; priority: number; reason: string }>; // Type assertion after filtering nulls

      if (outputForLLM.length !== result.length) {
         console.warn("[prioritizeTasksTool] Some prioritization results could not be mapped back to original tasks.");
         // Decide how to handle partial success - maybe still return what was mapped?
      }

       if (outputForLLM.length === 0 && result.length > 0) {
          // If mapping completely failed but flow returned results
          throw new Error("Internal error: Failed to map prioritization results back to original tasks.");
       }

      console.log("[prioritizeTasksTool] Mapped output for LLM:", JSON.stringify(outputForLLM, null, 2));
      return outputForLLM;

    } catch (error: any) {
      console.error("[prioritizeTasksTool] Error prioritizing tasks:", error);
      throw new Error(`Failed to prioritize tasks: ${error.message}`);
    }
  }
);


// --- Main Chat Flow Entry Point ---
export async function airiChat(input: AiriChatInput): Promise<AiriChatOutput> {
  console.log('[airiChat] Received input:', JSON.stringify(input, null, 2));

  try {
    const currentDateTime = new Date().toISOString();
    const availableTasks = input.currentTasks?.filter(t => !t.completed) ?? [];
    const hasCurrentTasks = availableTasks.length > 0;
    const taskCount = availableTasks.length;

    // Prepare context for the system prompt template
    const promptContext = {
        currentDateTime,
        hasCurrentTasks,
        taskCount,
    };
    console.log('[airiChat] Prompt Context:', promptContext);

    // Prepare tasks specifically for the prioritizeTasksTool if needed
    const tasksForPrioritizationTool = hasCurrentTasks ? availableTasks.map(t => ({
        id: t.id,
        name: t.name,
        description: `${t.name}: ${t.description}`, // Combine name/desc for context
        dueDate: t.dueDate // Already ISO string
    })) : [];
    // Note: The LLM decides IF and WHEN to call prioritizeTasksTool with these tasks.
    // We are *not* passing them directly to the LLM prompt, only making them available IF the tool is called.
    // The tool's inputSchema defines what the LLM needs to provide when calling it.

    // Define the prompt (user message)
    const prompt = input.message;

    console.log('[airiChat] Calling ai.generate...');
    // Call the Genkit generate function
    const llmResponse = await ai.generate({
        // Use the 'system' parameter for the system prompt
        system: airiSystemPrompt,
        // Use the 'prompt' parameter for the user's message
        prompt: prompt,
        // Pass the context for Handlebars substitution in the system prompt
        context: promptContext,
        // Provide the tools the model can use
        tools: [addTaskTool, prioritizeTasksTool],
        // Define the expected output structure
        output: { schema: AiriChatOutputSchema },
        // Optionally specify the model
        // model: 'googleai/gemini-1.5-flash-latest', // or your preferred model
    });

    console.log("[airiChat] Raw LLM Output:", JSON.stringify(llmResponse.output, null, 2));

    // Validate the output structure using safeParse
    const parsedOutput = AiriChatOutputSchema.safeParse(llmResponse.output);

    if (!parsedOutput.success) {
        console.error("[airiChat] LLM output validation failed:", parsedOutput.error.errors);
        // Try to return a structured error response
        return {
            response: "Hmph. My thoughts got scrambled. I couldn't generate a proper response. Ask differently, maybe?",
            success: false, // Indicate critical failure due to schema mismatch
            error: `LLM output schema validation failed: ${parsedOutput.error.message}`,
        };
    }
    console.log("[airiChat] LLM output parsed successfully.");

    let finalOutput = parsedOutput.data;

    // --- Post-processing ---
    let frontendCreatedTask: PrioritizedTask | undefined = undefined;
    if (finalOutput.createdTask?.dueDate) {
        // Validate the date string from the LLM/tool *before* parsing
        const createdTaskData = finalOutput.createdTask as CreateTaskOutput; // Assume schema match
        try {
            const parsedDate = parseISO(createdTaskData.dueDate);
            if (isValid(parsedDate)) {
                // Use the correctly typed task structure expected by the frontend
                frontendCreatedTask = {
                    id: createdTaskData.id,
                    name: createdTaskData.name,
                    description: createdTaskData.description,
                    dueDate: parsedDate, // *** Use the Date object ***
                    category: createdTaskData.category,
                    completed: createdTaskData.completed,
                    priority: createdTaskData.priority,
                    reason: createdTaskData.reason,
                };
                console.log("[airiChat] Processed created task with valid date:", frontendCreatedTask);
            } else {
                console.warn(`[airiChat] createTaskTool returned an invalid date format: ${createdTaskData.dueDate}. Task discarded.`);
                finalOutput.response += " (Though, I messed up the date for that task, so forget it.)";
                finalOutput.createdTask = undefined; // Clear invalid task data
            }
        } catch (parseError) {
            console.error(`[airiChat] Error parsing date string "${createdTaskData.dueDate}" from created task:`, parseError);
            finalOutput.response += " (My date calculation went haywire for that task.)";
            finalOutput.createdTask = undefined;
        }
    }

    // Prioritized tasks are already in the desired summary format (PrioritizedTaskDataSchema)
    // No complex re-mapping needed here, the tool output matches the schema.
    let frontendPrioritizedTasks: PrioritizedTaskData[] | undefined = finalOutput.prioritizedTasks;
    if (frontendPrioritizedTasks && frontendPrioritizedTasks.length > 0) {
        console.log("[airiChat] Processing prioritization results (already formatted):", frontendPrioritizedTasks);
    }

    // Construct the final return object
    const returnPayload: AiriChatOutput = {
        response: finalOutput.response,
        // Include the frontend-ready task *if* it was created and valid
        createdTask: frontendCreatedTask,
        prioritizedTasks: frontendPrioritizedTasks,
        success: true, // Indicate successful execution (even with graceful tool failures mentioned in response)
        error: undefined,
    };

    console.log("[airiChat] Final Output being returned:", JSON.stringify(returnPayload, null, 2));
    return returnPayload;

  } catch (error: any) {
      console.error("[airiChat] Critical Flow execution error:", error);
      let errorMessage = "Something went terribly wrong on my end. Tell the developer.";
      if (error.message?.includes('API key not valid')) {
          errorMessage = "Hmph. My connection is faulty (Invalid API Key). Tell the developer!";
      } else if (error.message?.includes('deadline exceeded') || error.message?.includes('timeout')) {
          errorMessage = "Hmph. Took too long to think. Try again.";
      } else if (error.message) {
          errorMessage = `Hmph. Something broke internally. Error: ${error.message}`;
      }

      // Return a structured error response
      return {
          response: errorMessage,
          createdTask: undefined,
          prioritizedTasks: undefined,
          success: false, // Indicate critical failure
          error: error.message || "An unexpected critical flow error occurred.",
      };
  }
}
