'use server';
/**
 * @fileOverview A utility flow to create a task object from structured data.
 * This is primarily intended to be used as a tool by other flows (like the chatbot).
 *
 * - createTask - Creates a task object.
 * - CreateTaskInput - Input type for createTask.
 * - CreateTaskOutput - Output type for createTask (the created task object).
 */

import { ai } from '@/ai/ai-instance';
import { z } from 'genkit';
import { parseISO, isValid } from 'date-fns';
import type { PrioritizedTask } from '@/components/task-manager'; // Assuming type is defined here
import { CreateTaskOutputSchema } from '@/ai/schemas'; // Import shared schema

// Input schema matches the details needed to create a task - make dueDate optional
const CreateTaskInputSchema = z.object({
  name: z.string().describe('The concise name of the task.'),
  description: z.string().describe('A detailed description of the task.'),
  // Expect ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ) from the LLM tool input, but make it optional
  dueDate: z
    .string()
    .describe(
      'The due date and time in ISO 8601 UTC format (e.g., "2024-08-15T14:30:00.000Z"). Optional.'
    )
    .optional()
    .nullable(), // Allow null as well
  category: z
    .enum(['goal', 'chore'])
    .describe("The category: 'goal' (important) or 'chore' (less important)."),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

// Output type is the structure of a task object used in the frontend
// This type is derived from the imported CreateTaskOutputSchema
export type CreateTaskOutput = z.infer<typeof CreateTaskOutputSchema>;


// This function is the main entry point for this flow.
// It takes structured input and returns a structured task object.
export async function createTask(input: CreateTaskInput): Promise<CreateTaskOutput> {
  let finalDueDateISO: string | null = null;

  // Validate the dueDate string immediately if provided
  if (input.dueDate) {
      const parsedDate = parseISO(input.dueDate);
      if (!isValid(parsedDate)) {
        console.error(`[createTaskFlow] Invalid date format received: ${input.dueDate}`);
        // Handle invalid date - perhaps throw an error or return a specific error structure?
        // For now, let's throw, as the tool/LLM should provide a valid date if it provides one.
        throw new Error(`Invalid date format provided: ${input.dueDate}. Expected ISO 8601 UTC or null/undefined.`);
      }
      finalDueDateISO = parsedDate.toISOString(); // Use valid ISO string
  }


  const newTask: CreateTaskOutput = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    dueDate: finalDueDateISO, // Assign the ISO string or null
    category: input.category,
    completed: false,
    // priority and reason are usually added later by the prioritization flow
  };

  console.log("[createTaskFlow] Task created:", newTask);
  return newTask;
}

// Define the Genkit flow (optional if only used as a simple function/tool target)
// If we want Genkit tracing/monitoring for this specific creation step, we define a flow.
// Otherwise, the `createTask` function can be directly imported and used by the tool.
// Let's define it for better observability.
const createTaskFlow = ai.defineFlow<
  typeof CreateTaskInputSchema,
  typeof CreateTaskOutputSchema // Use the imported schema here
>(
  {
    name: 'createTaskFlow',
    inputSchema: CreateTaskInputSchema,
    outputSchema: CreateTaskOutputSchema, // Use the imported schema here
  },
  async (input) => {
    // The core logic is already in the exported function
    return await createTask(input);
  }
);

// Export the flow if you intend to call it directly with genkit.runFlow, etc.
// export { createTaskFlow }; // Don't export the flow directly if only used as tool target
