'use server';

/**
 * @fileOverview An AI agent that prioritizes tasks based on description and due date.
 *
 * - prioritizeTasks - A function that prioritizes tasks.
 * - Task - The input type for the prioritizeTasks function.
 * - PrioritizedTasksOutput - The return type for the prioritizeTasks function.
 */

import {ai} from '@/ai/ai-instance';
import {z} from 'genkit';

const TaskSchema = z.object({
  description: z.string().describe('The description of the task.'),
  dueDate: z.string().describe('The due date of the task in ISO format.'),
});

export type Task = z.infer<typeof TaskSchema>;

const PrioritizedTasksInputSchema = z.array(TaskSchema).describe('A list of tasks to prioritize.');
export type PrioritizedTasksInput = z.infer<typeof PrioritizedTasksInputSchema>;

const PrioritizedTasksOutputSchema = z.array(
  z.object({
    description: z.string().describe('The description of the task.'),
    dueDate: z.string().describe('The due date of the task in ISO format.'),
    priority: z.number().describe('The priority of the task (1 being highest).'),
    reason: z.string().describe('The reasoning behind the assigned priority.'),
  })
);
export type PrioritizedTasksOutput = z.infer<typeof PrioritizedTasksOutputSchema>;

export async function prioritizeTasks(input: PrioritizedTasksInput): Promise<PrioritizedTasksOutput> {
  return prioritizeTasksFlow(input);
}

const prompt = ai.definePrompt({
  name: 'prioritizeTasksPrompt',
  input: {
    schema: z.object({
      tasks: z.array(
        z.object({
          description: z.string().describe('The description of the task.'),
          dueDate: z.string().describe('The due date of the task in ISO format.'),
        })
      ),
    }),
  },
  output: {
    schema: z.array(
      z.object({
        description: z.string().describe('The description of the task.'),
        dueDate: z.string().describe('The due date of the task in ISO format.'),
        priority: z.number().describe('The priority of the task (1 being highest).'),
        reason: z.string().describe('The reasoning behind the assigned priority.'),
      })
    ),
  },
  prompt: `You are an AI assistant that prioritizes a list of tasks based on their descriptions and due dates.

  Given the following tasks, please provide a priority (1 being the highest) and a brief reason for the priority.  The current date is {{currentDate}}.

  Tasks:
  {{#each tasks}}
  - Description: {{{description}}}, Due Date: {{{dueDate}}}
  {{/each}}

  Prioritized Tasks (JSON array):
  `,
});

const prioritizeTasksFlow = ai.defineFlow<
  typeof PrioritizedTasksInputSchema,
  typeof PrioritizedTasksOutputSchema
>({
  name: 'prioritizeTasksFlow',
  inputSchema: PrioritizedTasksInputSchema,
  outputSchema: PrioritizedTasksOutputSchema,
},
async input => {
  const currentDate = new Date().toISOString().slice(0, 10);
  const {output} = await prompt({
    tasks: input,
    currentDate,
  });
  return output!;
});