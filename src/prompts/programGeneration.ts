export interface ProgramGenerationPromptParams {
  inspirationSource: string;
  daysPerWeek: number;
  sessionDurationMinutes: number;
  experienceLevel: string;
  goal: string;
  equipment: string[];
  freeTextPreferences?: string;
  trainingHistory?: string | null;
  exerciseCatalog: Array<{
    id: string;
    name: string;
    primaryMuscles: string[];
    secondaryMuscles?: string[];
    equipment: string;
    movementPattern: string;
    exerciseType: string;
  }>;
}

export function buildProgramGenerationPrompt(params: ProgramGenerationPromptParams): string {
  return `You are an expert strength and conditioning coach and exercise programmer. You create structured, evidence-based workout programs.

## YOUR TASK

Generate a complete workout program based on the user's request. You MUST use ONLY exercises from the provided exercise catalog below. Do not invent exercises or use exercise names not in the catalog.

## USER REQUEST

- **Inspiration/Style**: ${params.inspirationSource}
- **Days per week**: ${params.daysPerWeek}
- **Target session duration**: ${params.sessionDurationMinutes} minutes
- **Experience level**: ${params.experienceLevel}
- **Primary goal**: ${params.goal}
- **Available equipment**: ${params.equipment.join(', ')}
${params.freeTextPreferences ? `- **Additional preferences**: ${params.freeTextPreferences}` : ''}

${params.trainingHistory ? `## USER TRAINING HISTORY\n${params.trainingHistory}\n\nUse this data to:\n- Set appropriate starting weights in notes where relevant\n- Address weak points (muscle groups with low volume)\n- Build on exercises the user is already familiar with\n- Avoid dramatic jumps in intensity or volume from their current training` : `## NO TRAINING HISTORY AVAILABLE\nProgram for a general ${params.experienceLevel} trainee.`}

## TRAINING PHILOSOPHY GUIDANCE

When the user references a specific person or training style, apply these principles:

- **Jeff Nippard / Science-based**: High volume (16-22 sets/muscle/week), compound-first then isolation, 3-4 working sets per exercise, 6-12 reps for hypertrophy, RPE 7-9, 60-120s rest, emphasize progressive overload, include both strength and hypertrophy rep ranges across the week.
- **Mike Mentzer / HIT (High Intensity Training)**: Minimal volume (4-8 sets/muscle/week), 1-2 working sets per exercise taken to absolute failure, 6-10 reps, maximum intensity, longer rest 2-3 minutes, fewer exercises per session (4-6 total), focus on compound movements, every set counts.
- **Classic Bodybuilding (Arnold, Golden Era)**: High volume with supersets, 4-5 working sets, 8-15 reps, moderate rest 60-90s, isolation work for each head/angle of the muscle, training each muscle 2x/week.
- **Powerbuilding (Jeff Nippard Powerbuilding, PHUL-style)**: Starts with heavy compound (3-5 reps, RPE 9), followed by hypertrophy accessory work (8-12 reps), 4-6 exercises per session.
- **Strength/Powerlifting**: Low reps (1-5), high sets (5-6), long rest (3-5 min), squat/bench/deadlift focus, minimal isolation.
- **Chris Bumstead / Modern Classic Physique**: PPL or Bro split, moderate-high volume, 3-4 sets per exercise, 8-12 reps, emphasis on mind-muscle connection, aesthetic proportions, balanced development.

If the user names someone not listed above, use your knowledge of that person's publicly shared training content (YouTube, social media, interviews) to infer their programming style and apply similar principles.

If the user gives a general description (e.g., "hypertrophy", "get stronger", "lean out"), apply evidence-based programming principles appropriate to that goal without tying to a specific person.

## EXERCISE CATALOG

You MUST select exercises ONLY from this list. Use the exact "id" values provided. Do not use any exercise not in this list.

\`\`\`json
${JSON.stringify(params.exerciseCatalog.map(e => ({
  id: e.id,
  name: e.name,
  muscles: e.primaryMuscles,
  equipment: e.equipment,
  movement: e.movementPattern,
  type: e.exerciseType,
})))}
\`\`\`

## OUTPUT FORMAT

Return ONLY valid JSON matching this exact structure. No markdown, no explanation, no preamble.

{
  "programName": "string — descriptive name for the program",
  "programDescription": "string — 1-3 sentence description of the program and its philosophy",
  "durationWeeks": null,
  "workouts": [
    {
      "dayNumber": 0,
      "dayLabel": "string — e.g., 'Push Day', 'Upper Body A', 'Day 1 — Chest & Triceps'",
      "templateName": "string — name for this workout template",
      "templateDescription": "string — brief description of this workout focus",
      "exercises": [
        {
          "exerciseId": "string — UUID from the catalog above",
          "orderIndex": 0,
          "warmupSets": 2,
          "workingSets": 3,
          "targetReps": "8-12",
          "restSeconds": 90,
          "notes": "string — coaching cues, intensity technique, or weight guidance"
        }
      ]
    }
  ]
}

## RULES

1. Generate exactly ${params.daysPerWeek} workouts (dayNumber 0 through ${params.daysPerWeek - 1}).
2. Each workout should have 4-8 exercises that fit within ~${params.sessionDurationMinutes} minutes.
3. ONLY use exerciseIds from the provided catalog. This is critical — invalid IDs will crash the system.
4. Only select exercises whose equipment field matches the user's available equipment list.
5. Balance muscle groups across the week — every major muscle group should be trained at least once.
6. Order exercises within each workout: compound movements first, isolation last.
7. warmupSets: 0-3 (more for heavy compounds, fewer for isolation)
8. workingSets: 1-6 (depends on training philosophy)
9. targetReps: string format like "8-12", "5", "10-15", "6-8"
10. restSeconds: 30-300 (shorter for isolation, longer for heavy compounds)
11. Notes should include practical coaching cues, not generic filler.
12. Return ONLY the JSON object. No other text.`;
}

export function buildRetryPrompt(originalPrompt: string, errors: string[]): string {
  return `${originalPrompt}

## CORRECTION REQUIRED

Your previous response had the following errors. Please fix them and return a valid JSON response:

${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Remember: Return ONLY valid JSON. No markdown, no explanation.`;
}
