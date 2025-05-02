'use server';
/**
 * @fileOverview An AI flow that interprets a voice command to create a task, including date and time.
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
// Updated dueDate description to request ISO 8601 format including time.
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
        .describe('A more detailed description of the task. If not provided, use the task name.'),
      // Use ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ or YYYY-MM-DDTHH:mm)
      dueDate: z
        .string()
        .describe(
          'The due date and time of the task in ISO 8601 format (e.g., "2024-08-15T14:30:00.000Z" or "2024-08-15T09:00"). Calculate based on the command relative to the current date and time. Use UTC timezone (Z). If only date is mentioned, default time to 09:00 local time then convert to UTC. If no date/time is mentioned, use today at 09:00 local time converted to UTC.'
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
      currentDateTime: z.string().describe("Current date and time in ISO 8601 format (UTC)."),
    }),
  },
  output: {
    schema: CreateTaskFromVoiceOutputSchema, // Use the defined output schema
  },
  // Updated prompt to include time handling and ISO 8601 format requirement.
  prompt: `You are an AI assistant helping a user manage their tasks in a TaskMaster application. Your goal is to extract task details from the user's voice command.

Current Date & Time (UTC): {{currentDateTime}}

User Command: "{{command}}"

Analyze the command and extract the following information:
1.  **Task Name:** A short, concise name for the task (e.g., "Buy groceries", "Schedule meeting").
2.  **Task Description:** A more detailed description if provided, otherwise use the task name.
3.  **Due Date & Time:** Determine the due date and time based on the command (e.g., "tomorrow at 3 PM", "next Friday morning", "August 15th 2pm", "tonight"). Calculate the exact date and time and return it in **ISO 8601 format using UTC timezone (ending with 'Z')**, like "2024-08-15T14:30:00.000Z".
    *   Base calculations on the provided current date and time.
    *   Interpret terms like "morning" as 9:00 AM, "afternoon" as 2:00 PM, "evening" or "tonight" as 7:00 PM local time before converting to UTC.
    *   If only a date is mentioned (e.g., "tomorrow", "August 15th"), default the time to **9:00 AM local time** and then convert to the equivalent UTC ISO 8601 string.
    *   If no date or time is mentioned, default to **today at 9:00 AM local time** and convert to the equivalent UTC ISO 8601 string.
4.  **Category:** Classify the task as either 'goal' (for important, significant tasks) or 'chore' (for routine or less critical tasks). If unsure, default to 'goal'.

Respond with a JSON object matching the specified output format.

If you can successfully extract the details, set 'success' to true and provide the task details in the 'task' object.

If you cannot reliably extract the required information (e.g., the command is unclear, ambiguous, or not a task request), set 'success' to false and provide a brief 'explanation' of why (e.g., "Could not determine a task name.", "Please specify a clear due date and time."). Do not include the 'task' object if 'success' is false. Ensure the dueDate is always a valid ISO 8601 string in UTC when success is true.
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
    // Get current date and time in ISO format (UTC)
    const currentDateTime = new Date().toISOString();
    console.log("Current DateTime sent to AI:", currentDateTime);

    const {output} = await prompt({
      command: input.command,
      currentDateTime: currentDateTime,
    });

    // Validate the output against the schema
    const parsedOutput = CreateTaskFromVoiceOutputSchema.safeParse(output);
    if (parsedOutput.success) {
       console.log("AI Response (Valid):", parsedOutput.data);
      // Additional check for dueDate format if needed, though Zod handles basic structure
      if (parsedOutput.data.success && parsedOutput.data.task) {
          try {
              // Attempt to parse the date to ensure it's truly valid ISO 8601
              const parsedDate = parseISO(parsedOutput.data.task.dueDate);
              if (!isValid(parsedDate)) {
                  console.error("AI returned an invalid ISO date format:", parsedOutput.data.task.dueDate);
                   return {
                       success: false,
                       explanation: `AI returned an invalid date format: ${parsedOutput.data.task.dueDate}. Please try again or add manually.`,
                   };
              }
          } catch (e) {
               console.error("Error parsing AI date output:", parsedOutput.data.task.dueDate, e);
               return {
                   success: false,
                   explanation: `AI returned a date that couldn't be parsed: ${parsedOutput.data.task.dueDate}. Please try again or add manually.`,
               };
          }
      }
      return parsedOutput.data;
    } else {
      console.error("AI output validation failed:", parsedOutput.error);
      console.error("Invalid AI Raw Output:", output); // Log the raw invalid output
      return {
        success: false,
        explanation: 'AI failed to generate a response in the expected format. Please try rephrasing your command.',
      };
    }
  }
);

// Helper function to check if a date is valid (already available in date-fns isValid)
// function isValidDate(d: any) {
//   return d instanceof Date && !isNaN(d.getTime());
// }