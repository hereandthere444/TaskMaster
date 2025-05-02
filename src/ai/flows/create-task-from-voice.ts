'use server';
/**
 * @fileOverview An AI flow that interprets a voice command to create a task.
 *
 * - createTaskFromVoice - A function that processes a voice command string.
 * - CreateTaskFromVoiceInput - The input type for the createTaskFromVoice function.
 * - CreateTaskFromVoiceOutput - The return type for the createTaskFromVoice function.
 */

import {ai} from '@/ai/ai-instance';
import {z} from 'genkit';
import {format} from 'date-fns';

const CreateTaskFromVoiceInputSchema = z.object({
  command: z.string().describe('The voice command transcribed into text.'),
});
export type CreateTaskFromVoiceInput = z.infer<
  typeof CreateTaskFromVoiceInputSchema
>;

// Output schema should align with the TaskFormData structure + success/explanation
const CreateTaskFromVoiceOutputSchema = z.object({
  success: z
    .boolean()
    .describe('Whether the task details could be extracted successfully.'),
  explanation: z
    .string()
    .optional()
    .describe(
      'An explanation if extraction failed or clarification if needed.'
    ),
  task: z
    .object({
      name: z.string().describe('The concise name of the task.'),
      description: z
        .string()
        .describe('A more detailed description of the task.'),
      // Use string for dueDate initially, conversion happens client-side
      dueDate: z
        .string()
        .describe(
          'The due date of the task in YYYY-MM-DD format. Calculate based on the command relative to the current date.'
        ),
      category: z
        .enum(['goal', 'chore'])
        .describe(
          "The category of the task, either 'goal' (important) or 'chore' (less important)."
        ),
    })
    .optional()
    .describe('The extracted task details if successful.'),
});
export type CreateTaskFromVoiceOutput = z.infer<
  typeof CreateTaskFromVoiceOutputSchema
>;

export async function createTaskFromVoice(
  input: CreateTaskFromVoiceInput
): Promise<CreateTaskFromVoiceOutput> {
  return createTaskFromVoiceFlow(input);
}

const prompt = ai.definePrompt({
  name: 'createTaskFromVoicePrompt',
  input: {
    schema: z.object({
      command: z.string(),
      currentDate: z.string(),
    }),
  },
  output: {
    schema: CreateTaskFromVoiceOutputSchema, // Use the defined output schema
  },
  prompt: `You are an AI assistant helping a user manage their tasks in a TaskMaster application. Your goal is to extract task details from the user's voice command.

Current Date: {{currentDate}}

User Command: "{{command}}"

Analyze the command and extract the following information:
1.  **Task Name:** A short, concise name for the task (e.g., "Buy groceries", "Schedule meeting").
2.  **Task Description:** A more detailed description if provided, otherwise use the name.
3.  **Due Date:** Determine the due date based on the command (e.g., "tomorrow", "next Friday", "August 15th"). Calculate the exact date in YYYY-MM-DD format based on the current date. If no date is mentioned, use today's date.
4.  **Category:** Classify the task as either 'goal' (for important, significant tasks) or 'chore' (for routine or less critical tasks). If unsure, default to 'goal'.

Respond with a JSON object matching the specified output format.

If you can successfully extract the details, set 'success' to true and provide the task details in the 'task' object.

If you cannot reliably extract the required information (e.g., the command is unclear, ambiguous, or not a task request), set 'success' to false and provide a brief 'explanation' of why (e.g., "Could not determine a task name.", "Please specify a due date."). Do not include the 'task' object if 'success' is false.
`,
});

const createTaskFromVoiceFlow = ai.defineFlow<
  typeof CreateTaskFromVoiceInputSchema,
  typeof CreateTaskFromVoiceOutputSchema
>(
  {
    name: 'createTaskFromVoiceFlow',
    inputSchema: CreateTaskFromVoiceInputSchema,
    outputSchema: CreateTaskFromVoiceOutputSchema,
  },
  async (input) => {
    const currentDate = format(new Date(), 'yyyy-MM-dd');
    const {output} = await prompt({
      command: input.command,
      currentDate: currentDate,
    });

    // Ensure output matches the schema, return a default failure state if not
    const parsedOutput = CreateTaskFromVoiceOutputSchema.safeParse(output);
    if (parsedOutput.success) {
      return parsedOutput.data;
    } else {
        console.error("AI output validation failed:", parsedOutput.error);
      return {
        success: false,
        explanation: 'AI failed to generate a valid response structure.',
      };
    }
  }
);
