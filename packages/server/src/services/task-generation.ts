import { z } from 'zod';
import { runClaude } from './claude-ai.js';
import {
  getRequirementInput,
  createAITaskSuggestion,
} from '../db/queries/tasks.js';
import { getProjectMembers } from '../db/queries/projects.js';
import { getUserById } from '../db/queries/users.js';
import { getUserProfile } from '../db/queries/ai.js';

const TaskSuggestionSchema = z.array(z.object({
  title: z.string(),
  description: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  effort: z.enum(['xs', 's', 'm', 'l', 'xl']),
  suggestedAssigneeId: z.number().nullable().optional(),
}));

type TaskSuggestion = z.infer<typeof TaskSuggestionSchema>;

/**
 * Generate task suggestions from a requirement input using AI.
 */
export async function generateTaskSuggestions(requirementInputId: number): Promise<void> {
  const input = await getRequirementInput(requirementInputId);
  if (!input || !input.content) {
    throw new Error('Requirement input not found or empty');
  }

  // Get project members for assignee suggestions
  const members = await getProjectMembers(input.projectId);
  const memberProfiles = await Promise.all(
    members.map(async (m: any) => {
      const user = await getUserById(m.userId);
      const profile = await getUserProfile(m.userId);
      return {
        id: m.userId,
        name: user?.name || 'Unknown',
        skills: profile?.profile ? extractSkills(profile.profile) : [],
      };
    })
  );

  const prompt = buildTaskGenerationPrompt(input.content, input.inputType, memberProfiles);

  try {
    const { data: suggestedTasks } = await runClaude({
      prompt,
      systemPrompt: 'You are a JSON API. You analyze requirements and generate structured tasks. Respond with ONLY valid JSON, no markdown formatting, no explanation text. Just the raw JSON array.',
      schema: TaskSuggestionSchema,
      timeout: 60000,
    });

    await createAITaskSuggestion({
      requirementInputId,
      projectId: input.projectId,
      suggestedTasks,
    });

    console.log(`[task-generation] Generated ${suggestedTasks.length} task suggestions for requirement ${requirementInputId}`);
  } catch (err) {
    console.error(`[task-generation] Failed to generate tasks for requirement ${requirementInputId}:`, err);
    throw err;
  }
}

function buildTaskGenerationPrompt(
  content: string,
  inputType: string,
  members: Array<{ id: number; name: string; skills: string[] }>
): string {
  const memberList = members.map(m =>
    `- ${m.name} (ID: ${m.id})${m.skills.length > 0 ? ` — skills: ${m.skills.join(', ')}` : ''}`
  ).join('\n');

  return `You are a project manager. Analyze the following ${inputType === 'document' ? 'document' : 'meeting notes/requirements'} and generate structured tasks.

## Input
${content}

## Team Members
${memberList || '(No members assigned yet)'}

## Instructions
Generate a JSON array of task objects. Each task should have:
- title: clear, actionable task title
- description: detailed description of what needs to be done
- priority: "low", "medium", "high", or "urgent"
- effort: "xs" (< 1 hour), "s" (1-4 hours), "m" (1-2 days), "l" (3-5 days), "xl" (1+ week)
- suggestedAssigneeId: team member ID who would be best suited (based on their skills), or null if unsure

Return ONLY a JSON array, no other text. Example:
[
  {
    "title": "Implement user authentication",
    "description": "Set up JWT-based auth with login/register endpoints...",
    "priority": "high",
    "effort": "m",
    "suggestedAssigneeId": 1
  }
]`;
}

function extractSkills(profileText: string): string[] {
  // Simple extraction from AI profile text
  const skills: string[] = [];
  const lower = profileText.toLowerCase();

  const languages = ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'php', 'ruby', 'swift', 'kotlin', 'c#', 'react', 'vue', 'angular', 'node.js', 'express', 'fastify', 'django', 'laravel', 'spring'];
  for (const lang of languages) {
    if (lower.includes(lang)) skills.push(lang);
  }

  const domains = ['frontend', 'backend', 'devops', 'database', 'api', 'mobile', 'testing', 'security', 'infrastructure'];
  for (const domain of domains) {
    if (lower.includes(domain)) skills.push(domain);
  }

  return skills.slice(0, 8); // Limit to 8 top skills
}

export { buildTaskGenerationPrompt };
