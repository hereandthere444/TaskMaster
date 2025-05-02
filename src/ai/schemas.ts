/**
 * @fileOverview Shared Zod schemas used across multiple 'use server' Genkit flows/tools.
 * This prevents exporting non-async values from 'use server' files.
 */

import { z } from 'zod';

// Output schema is the structure of a task object used in the frontend
// Ensure this matches the `PrioritizedTask` type structure in TaskManager
export const CreateTaskOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  dueDate: z.string().describe('The due date in ISO 8601 format.'), // Keep as string for flow output consistency
  category: z.enum(['goal', 'chore']),
  completed: z.boolean(),
  priority: z.number().optional(),
  reason: z.string().optional(),
});
